import { NextResponse } from 'next/server';
import { ACTIVITY_ID, fetchActivityHistory, fetchActivityStreams } from '@/lib/activities';
import { resolveToday } from '@/lib/dates';
import { bestEfforts } from '@/lib/training/bestEfforts';
import type { BestEffort } from '@/lib/training/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_IDS = 8;
const CONCURRENCY = 4;

/**
 * Best efforts for a batch of runs. The client keeps the results (localStorage)
 * and backfills its history a batch at a time — there is no server database.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { ids?: unknown; today?: unknown };
  const ids = Array.isArray(body.ids)
    ? Array.from(new Set(body.ids.filter((x): x is string => typeof x === 'string' && ACTIVITY_ID.test(x)))).slice(0, MAX_IDS)
    : [];
  if (!ids.length) return NextResponse.json({ error: 'ids required' }, { status: 400 });

  const { activities } = await fetchActivityHistory(resolveToday(body.today));
  const runs = ids
    .map(id => activities.find(a => a.id === id))
    .filter((a): a is NonNullable<typeof a> => !!a && a.sport === 'running');

  const results: Record<string, { date: string; efforts: BestEffort[] }> = {};
  const failed: string[] = [];
  for (let i = 0; i < runs.length; i += CONCURRENCY) {
    await Promise.all(runs.slice(i, i + CONCURRENCY).map(async a => {
      try {
        const s = await fetchActivityStreams(a);
        results[a.id] = { date: a.date, efforts: s ? bestEfforts(s.t, s.dist) : [] };
      } catch {
        failed.push(a.id);
      }
    }));
  }
  // ids that aren't runs (or unknown) are answered with no efforts so the client stops asking
  for (const id of ids) if (!results[id] && !failed.includes(id)) results[id] = { date: '', efforts: [] };
  return NextResponse.json({ results, failed });
}

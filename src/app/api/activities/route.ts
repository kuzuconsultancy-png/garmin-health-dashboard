import { NextRequest, NextResponse } from 'next/server';
import { fetchActivityHistory } from '@/lib/activities';
import { resolveToday } from '@/lib/dates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Activity summaries from Jan 1 last year (or 400 days back) to today. */
export async function GET(req: NextRequest) {
  const today = resolveToday(req.nextUrl.searchParams.get('today'));
  try {
    const { activities, isDemo, since } = await fetchActivityHistory(today);
    return NextResponse.json({ activities, isDemo, since, today });
  } catch (err) {
    console.error('[api/activities] failed:', err);
    return NextResponse.json({ error: 'Failed to load activities' }, { status: 500 });
  }
}

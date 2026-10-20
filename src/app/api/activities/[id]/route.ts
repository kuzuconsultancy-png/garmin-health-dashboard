import { NextRequest, NextResponse } from 'next/server';
import { ACTIVITY_ID, fetchActivityHistory, fetchActivityStreams, fetchHeartRateZones } from '@/lib/activities';
import { resolveToday } from '@/lib/dates';
import { analyzeActivity } from '@/lib/training/analysis';
import { estimateHRMax } from '@/lib/training/effort';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** One activity: summary + analysis from its sample streams (splits, GAP, zones, best efforts). */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!ACTIVITY_ID.test(params.id)) return NextResponse.json({ error: 'Invalid activity id' }, { status: 400 });
  const q = req.nextUrl.searchParams;
  const today = resolveToday(q.get('today'));

  const { activities, isDemo } = await fetchActivityHistory(today);
  const summary = activities.find(a => a.id === params.id);
  if (!summary) return NextResponse.json({ error: 'Activity not found' }, { status: 404 });

  const hrMaxParam = Number(q.get('hrMax'));
  const vdotParam = Number(q.get('vdot'));
  const hrMax = hrMaxParam >= 140 && hrMaxParam <= 230 ? hrMaxParam : estimateHRMax(activities);
  const zones = (await fetchHeartRateZones()) ?? hrMax;
  const vdot = vdotParam >= 20 && vdotParam <= 90 ? vdotParam : null;

  try {
    const streams = await fetchActivityStreams(summary);
    const splitM = summary.sport === 'cycling' ? 5000 : 1000;
    const analysis = streams ? analyzeActivity(streams, { isRun: summary.sport === 'running', zones, vdot, splitM }) : null;
    return NextResponse.json({ summary, analysis, zones, vdot, isDemo });
  } catch (err) {
    console.error('[api/activities/:id] streams failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ summary, analysis: null, zones, vdot, isDemo });
  }
}

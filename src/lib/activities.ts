import { format, parseISO, startOfYear, subDays, subYears } from 'date-fns';
import { getClient } from './garmin';
import type { ActivitySummary, ActivityStreams } from './training/types';
import { sportOf } from './training/effort';
import { generateDemoHistory, generateDemoStreams } from './training/demo';

// Server-side Garmin access for the training features: full activity history
// (paginated summaries) and per-activity sample streams.

const GC_API = 'https://connectapi.garmin.com';
type GCClient = Record<string, (...args: unknown[]) => Promise<unknown>>;

/** Valid activity ids: Garmin numeric ids or our demo ids. Guards the URL we build. */
export const ACTIVITY_ID = /^(\d{1,20}|demo-\d{4}-\d{2}-\d{2}-\d)$/;

/** Jan 1 of last year (year-over-year) or 400 days back (fitness warm-up), whichever is earlier. */
export function historyStart(today: string): string {
  const d = parseISO(today);
  const jan1 = startOfYear(subYears(d, 1));
  const d400 = subDays(d, 400);
  return format(jan1 < d400 ? jan1 : d400, 'yyyy-MM-dd');
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function parseActivitySummary(raw: Record<string, unknown>): ActivitySummary | null {
  if (raw?.activityId == null) return null;
  const start = String(raw.startTimeLocal ?? '');
  if (!/^\d{4}-\d{2}-\d{2}/.test(start)) return null;
  const type = raw.activityType as Record<string, unknown> | undefined;
  const sportKey = String(type?.typeKey ?? 'other');
  const zones = [1, 2, 3, 4, 5].map(i => num(raw[`hrTimeInZone_${i}`]));
  const load = num(raw.activityTrainingLoad);
  const aero = num(raw.aerobicTrainingEffect);
  const anaero = num(raw.anaerobicTrainingEffect);
  const vo2 = num(raw.vO2MaxValue);
  return {
    id: String(raw.activityId),
    name: String(raw.activityName ?? sportKey),
    date: start.slice(0, 10),
    startTimeLocal: start.slice(0, 19),
    sport: sportOf(sportKey),
    sportKey,
    durationSec: Math.round(num(raw.duration) || num(raw.movingDuration) || num(raw.elapsedDuration)),
    distanceM: Math.round(num(raw.distance)),
    elevationGainM: Math.round(num(raw.elevationGain)),
    avgHR: Math.round(num(raw.averageHR)),
    maxHR: Math.round(num(raw.maxHR)),
    avgSpeed: num(raw.averageSpeed),
    calories: Math.round(num(raw.calories)),
    ...(load > 0 ? { trainingLoad: Math.round(load) } : {}),
    ...(aero > 0 ? { aerobicTE: Math.round(aero * 10) / 10 } : {}),
    ...(anaero > 0 ? { anaerobicTE: Math.round(anaero * 10) / 10 } : {}),
    ...(vo2 > 0 ? { vo2max: Math.round(vo2) } : {}),
    ...(zones.some(z => z > 0) ? { hrZoneSec: zones.map(Math.round) } : {}),
  };
}

// ── History ─────────────────────────────────────────────────────────────────

interface HistoryEntry { activities: ActivitySummary[]; isDemo: boolean; ts: number }
const historyCache = new Map<string, HistoryEntry>();
const HISTORY_TTL = 20 * 60 * 1000;
const PAGE = 100;
const MAX_PAGES = 15; // 1,500 activities

export async function fetchActivityHistory(today: string): Promise<{ activities: ActivitySummary[]; isDemo: boolean; since: string }> {
  const since = historyStart(today);
  const key = `${since}|${today}`;
  const hit = historyCache.get(key);
  if (hit && Date.now() - hit.ts < HISTORY_TTL) return { activities: hit.activities, isDemo: hit.isDemo, since };

  const client = await getClient();
  if (!client) {
    const activities = generateDemoHistory(since, today);
    historyCache.set(key, { activities, isDemo: true, ts: Date.now() });
    return { activities, isDemo: true, since };
  }

  try {
    const gc = client as GCClient;
    const byId = new Map<string, ActivitySummary>();
    for (let page = 0; page < MAX_PAGES; page++) {
      const raw = await gc.getActivities(page * PAGE, PAGE) as unknown[];
      if (!Array.isArray(raw) || raw.length === 0) break;
      const parsed = raw
        .map(r => parseActivitySummary(r as Record<string, unknown>))
        .filter((a): a is ActivitySummary => a !== null);
      for (const a of parsed) byId.set(a.id, a);
      const oldest = parsed.reduce((m, a) => (a.date < m ? a.date : m), '9999');
      if (raw.length < PAGE || oldest < since) break;
    }
    const activities = Array.from(byId.values())
      .filter(a => a.date >= since && a.date <= today)
      .sort((a, b) => a.startTimeLocal.localeCompare(b.startTimeLocal));
    historyCache.set(key, { activities, isDemo: false, ts: Date.now() });
    return { activities, isDemo: false, since };
  } catch (err) {
    console.error('[activities] history fetch failed:', err instanceof Error ? err.message : err);
    return { activities: generateDemoHistory(since, today), isDemo: true, since };
  }
}

// ── Streams ─────────────────────────────────────────────────────────────────

interface Descriptor { metricsIndex: number; key: string }

/**
 * Garmin's /activity-service/activity/{id}/details payload: `metricDescriptors`
 * name the columns, `activityDetailMetrics[].metrics` are the rows. Nulls are
 * carried forward; rows going back in time or distance are dropped.
 */
export function parseActivityDetails(raw: Record<string, unknown>): ActivityStreams | null {
  const desc = (raw?.metricDescriptors ?? []) as Descriptor[];
  const rows = (raw?.activityDetailMetrics ?? []) as { metrics: (number | null)[] }[];
  if (!Array.isArray(desc) || !Array.isArray(rows) || rows.length < 2) return null;
  const col = (key: string) => desc.find(d => d.key === key)?.metricsIndex;

  const iTime = col('sumDuration') ?? col('sumElapsedDuration');
  const iTs = col('directTimestamp');
  const iDist = col('sumDistance');
  const iHr = col('directHeartRate');
  const iSpeed = col('directSpeed');
  const iEle = col('directElevation');
  if (iTime === undefined && iTs === undefined) return null;

  const t: number[] = [];
  const dist: number[] = [];
  const hr: number[] = [];
  const speed: number[] = [];
  const ele: number[] = [];
  let ts0: number | null = null;
  let lastEle: number | null = null;
  let lastSpeed = 0;

  for (const { metrics: m } of rows) {
    if (!Array.isArray(m)) continue;
    let time: number | null = null;
    if (iTime !== undefined && typeof m[iTime] === 'number') time = m[iTime] as number;
    else if (iTs !== undefined && typeof m[iTs] === 'number') {
      ts0 ??= m[iTs] as number;
      time = ((m[iTs] as number) - ts0) / 1000;
    }
    if (time === null) continue;
    const d = iDist !== undefined && typeof m[iDist] === 'number' ? (m[iDist] as number) : (dist.at(-1) ?? 0);
    if (t.length && (time < t[t.length - 1] || d < dist[dist.length - 1])) continue;

    t.push(time);
    dist.push(d);
    hr.push(iHr !== undefined && typeof m[iHr] === 'number' ? (m[iHr] as number) : 0);
    if (iSpeed !== undefined && typeof m[iSpeed] === 'number') lastSpeed = m[iSpeed] as number;
    speed.push(lastSpeed);
    if (iEle !== undefined && typeof m[iEle] === 'number') lastEle = m[iEle] as number;
    ele.push(lastEle ?? NaN);
  }
  if (t.length < 2) return null;

  // Elevation: back-fill leading gaps with the first real value; drop if none
  const firstEle = ele.find(e => !Number.isNaN(e));
  const hasEle = firstEle !== undefined;
  const eleOut = hasEle ? ele.map(e => (Number.isNaN(e) ? (firstEle as number) : e)) : undefined;

  // Speed: derive from distance/time when the device didn't record it
  const speedOut = iSpeed !== undefined
    ? speed
    : dist.map((d, i) => (i === 0 ? 0 : (d - dist[i - 1]) / Math.max(1e-6, t[i] - t[i - 1])));

  return {
    t,
    dist,
    ...(hr.some(h => h > 0) ? { hr } : {}),
    ...(dist[dist.length - 1] > 0 ? { speed: speedOut } : {}),
    ...(eleOut ? { ele: eleOut } : {}),
  };
}

const streamCache = new Map<string, ActivityStreams>();
const STREAM_CACHE_MAX = 40;

export async function fetchActivityStreams(a: ActivitySummary): Promise<ActivityStreams | null> {
  if (a.id.startsWith('demo-')) return generateDemoStreams(a);
  if (!ACTIVITY_ID.test(a.id)) return null;
  const hit = streamCache.get(a.id);
  if (hit) return hit;

  const client = await getClient();
  if (!client) return null;
  const gc = client as GCClient;
  const raw = await gc.get(`${GC_API}/activity-service/activity/${a.id}/details?maxChartSize=10000&maxPolylineSize=100`);
  const streams = raw && typeof raw === 'object' ? parseActivityDetails(raw as Record<string, unknown>) : null;
  if (streams) {
    if (streamCache.size >= STREAM_CACHE_MAX) streamCache.delete(streamCache.keys().next().value as string);
    streamCache.set(a.id, streams);
  }
  return streams;
}

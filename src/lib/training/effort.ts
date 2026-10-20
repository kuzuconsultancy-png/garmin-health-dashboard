import type { ActivitySummary, Sport } from './types';

// Effort = Edwards TRIMP: minutes in HR zone k × k (k = 1…5). Same idea as
// Strava's Relative Effort (HR-zone weighted time); Strava's exact weights are
// not public, so the scale is ours: 60 min in Z2 = 120.

/** Lower bounds of zones 1–5 as a fraction of max HR (Garmin's default zones). */
export const ZONE_LOWER_PCT = [0.5, 0.6, 0.7, 0.8, 0.9] as const;

export function sportOf(typeKey: string): Sport {
  const k = typeKey.toLowerCase();
  if (k.includes('run')) return 'running';
  if (k.includes('cycl') || k.includes('bik') || k.includes('ride')) return 'cycling';
  if (k.includes('swim')) return 'swimming';
  if (k.includes('walk')) return 'walking';
  if (k.includes('hik')) return 'hiking';
  if (k.includes('strength') || k.includes('weight')) return 'strength';
  return 'other';
}

/**
 * Max HR: the higher of the highest plausible HR you recorded and the age
 * formula (208 − 0.7 × age, Tanaka) — a lower recorded max usually just means
 * you never went all-out with the watch on.
 */
export function estimateHRMax(activities: ActivitySummary[], age?: number): number {
  const observed = Math.max(0, ...activities.map(a => a.maxHR).filter(h => h >= 120 && h <= 230));
  const formula = age && age > 0 ? Math.round(208 - 0.7 * age) : 0;
  const best = Math.max(observed, formula);
  return best >= 150 ? best : 190;
}

/** 0 = below zone 1, else 1–5. */
export function zoneOf(hr: number, hrMax: number): number {
  const pct = hr / hrMax;
  let z = 0;
  ZONE_LOWER_PCT.forEach((lo, i) => { if (pct >= lo) z = i + 1; });
  return z;
}

export function effortFromZones(zoneSec: number[]): number {
  return Math.round(zoneSec.reduce((s, sec, i) => s + (sec / 60) * (i + 1), 0));
}

export interface ActivityEffort {
  effort: number | null;            // null = no HR data
  source: 'zones' | 'avgHR' | null;
}

/** Uses Garmin's time-in-zone when present; otherwise puts the whole session in the zone of its average HR. */
export function activityEffort(a: ActivitySummary, hrMax: number): ActivityEffort {
  const zones = a.hrZoneSec;
  if (zones && zones.length === 5 && zones.some(s => s > 0)) {
    return { effort: effortFromZones(zones), source: 'zones' };
  }
  if (a.avgHR > 0 && a.durationSec > 0) {
    return { effort: Math.round((a.durationSec / 60) * zoneOf(a.avgHR, hrMax)), source: 'avgHR' };
  }
  return { effort: null, source: null };
}

export type WeekStatus = 'recovery' | 'maintain' | 'build' | 'spike' | 'none';

/** Weekly range from the previous 3 weeks' average. Thresholds are our heuristics, not Strava's. */
export const WEEK_RANGE = { low: 0.8, high: 1.2, spike: 1.5 } as const;

export function weeklyEffortStatus(week: number, prev3: number[]): {
  low: number; high: number; status: WeekStatus;
} {
  const base = prev3.length ? prev3.reduce((s, v) => s + v, 0) / prev3.length : 0;
  if (base <= 0) return { low: 0, high: 0, status: 'none' };
  const low = Math.round(base * WEEK_RANGE.low);
  const high = Math.round(base * WEEK_RANGE.high);
  const ratio = week / base;
  const status: WeekStatus =
    ratio < WEEK_RANGE.low ? 'recovery'
      : ratio <= WEEK_RANGE.high ? 'maintain'
        : ratio <= WEEK_RANGE.spike ? 'build'
          : 'spike';
  return { low, high, status };
}

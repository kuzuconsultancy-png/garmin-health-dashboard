import { format, parseISO, subDays, addDays } from 'date-fns';
import type {
  RecentActivity, TrendPoint, CoachDay, CoachMetrics, CoachFlag, UserProfile,
} from './types';
import { calculateSleepDebt } from './scoring';

// Pure functions only — everything the coach needs is computed here, before the
// LLM call, so the numbers are testable and the model never does arithmetic.

export const WINDOW_DAYS = 14;

/** Rule thresholds. Heuristics, not clinical cut-offs. */
export const THRESHOLDS = {
  hrvWarnPct: -15,        // last night vs previous-7-night mean
  hrvAlertPct: -30,
  rhrWarnBpm: 5,          // today vs previous-7-day mean
  rhrAlertBpm: 10,
  sleepWarnH: 7,
  sleepAlertH: 6,
  sleepDebtWarnH: 5,      // 7-day debt vs 8h/night
  rampWarnPct: 30,        // last 7d load vs previous 7d
  rampAlertPct: 50,
  rampMinBase: { training_load: 100, minutes: 60 }, // ignore ramps off a tiny base
  noRestWarnDays: 6,
  noRestAlertDays: 10,
  hardAerobicTE: 4,       // Garmin TE ≥ 4.0 aerobic or ≥ 3.0 anaerobic = hard session
  hardAnaerobicTE: 3,
} as const;

const round = (n: number) => Math.round(n);
const round1 = (n: number) => Math.round(n * 10) / 10;
const mean = (arr: number[]) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);
const positive = (arr: number[]) => arr.filter(v => v > 0);

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  if (!s.length) return 0;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Window dates, oldest → newest, ending on (and including) `today`. */
export function windowDates(today: string, days = WINDOW_DAYS): string[] {
  const end = parseISO(today);
  return Array.from({ length: days }, (_, i) => format(subDays(end, days - 1 - i), 'yyyy-MM-dd'));
}

/** The `n` days after `today`. */
export function upcomingDates(today: string, n = 3): string[] {
  const start = parseISO(today);
  return Array.from({ length: n }, (_, i) => format(addDays(start, i + 1), 'yyyy-MM-dd'));
}

/** Merge activities and recovery points into one row per day of the window. */
export function buildCoachDays(
  today: string,
  activities: RecentActivity[],
  trend: TrendPoint[],
  days = WINDOW_DAYS,
): CoachDay[] {
  const byDate = new Map(trend.map(p => [p.date, p]));
  return windowDates(today, days).map(date => {
    const p = byDate.get(date);
    return {
      date,
      hrv: p?.hrv ?? 0,
      rhr: p?.rhr ?? 0,
      sleepHours: p?.sleepHours ?? 0,
      recovery: p?.recovery ?? 0,
      activities: activities.filter(a => a.date === date),
    };
  });
}

export function isHardSession(a: RecentActivity): boolean {
  return (a.aerobicTE ?? 0) >= THRESHOLDS.hardAerobicTE
    || (a.anaerobicTE ?? 0) >= THRESHOLDS.hardAnaerobicTE;
}

/**
 * Load per session. Uses Garmin training load when at least half the sessions
 * have it (missing ones estimated from the median load-per-minute); otherwise
 * falls back to plain minutes so the unit is never a silent mix.
 */
export function loadModel(activities: RecentActivity[]): {
  unit: 'training_load' | 'minutes';
  loadOf: (a: RecentActivity) => number;
} {
  const withLoad = activities.filter(a => (a.trainingLoad ?? 0) > 0);
  if (!activities.length || withLoad.length / activities.length < 0.5) {
    return { unit: 'minutes', loadOf: a => a.durationMinutes };
  }
  const perMinute = median(withLoad.map(a => (a.trainingLoad as number) / Math.max(1, a.durationMinutes)));
  return {
    unit: 'training_load',
    loadOf: a => ((a.trainingLoad ?? 0) > 0 ? (a.trainingLoad as number) : round(perMinute * a.durationMinutes)),
  };
}

export function computeFlags(m: Omit<CoachMetrics, 'flags' | 'confidence'>): CoachFlag[] {
  const T = THRESHOLDS;
  const flags: CoachFlag[] = [];
  const { recovery: r, load: l } = m;

  if (r.hrvDeltaPct !== null && r.hrvDeltaPct <= T.hrvWarnPct) {
    flags.push({ id: 'hrv_suppressed', severity: r.hrvDeltaPct <= T.hrvAlertPct ? 'alert' : 'warning', value: r.hrvDeltaPct });
  }
  if (r.rhrDelta !== null && r.rhrDelta >= T.rhrWarnBpm) {
    flags.push({ id: 'rhr_elevated', severity: r.rhrDelta >= T.rhrAlertBpm ? 'alert' : 'warning', value: r.rhrDelta });
  }
  if (r.sleepLastNight > 0 && r.sleepLastNight < T.sleepWarnH) {
    flags.push({ id: 'short_sleep', severity: r.sleepLastNight < T.sleepAlertH ? 'alert' : 'warning', value: r.sleepLastNight });
  }
  if (r.sleepDebt7d >= T.sleepDebtWarnH) {
    flags.push({ id: 'sleep_debt', severity: 'warning', value: r.sleepDebt7d });
  }
  if (l.rampPct !== null && l.prev7 >= T.rampMinBase[l.unit] && l.rampPct >= T.rampWarnPct) {
    flags.push({ id: 'load_spike', severity: l.rampPct >= T.rampAlertPct ? 'alert' : 'warning', value: l.rampPct });
  }
  if (l.consecutiveTrainingDays >= T.noRestWarnDays) {
    flags.push({
      id: 'no_rest',
      severity: l.consecutiveTrainingDays >= T.noRestAlertDays ? 'alert' : 'warning',
      value: l.consecutiveTrainingDays,
    });
  }
  const hasNegative = flags.length > 0;
  if (!hasNegative && r.hrvDeltaPct !== null && r.hrvDeltaPct >= 5
      && (r.rhrDelta === null || r.rhrDelta <= 0) && r.sleepLastNight >= T.sleepWarnH) {
    flags.push({ id: 'well_recovered', severity: 'positive', value: r.hrvDeltaPct });
  }

  const rank = { alert: 0, warning: 1, positive: 2 } as const;
  return flags.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** `days` must be the full window, oldest → newest, last entry = today. */
export function computeCoachMetrics(days: CoachDay[]): CoachMetrics {
  if (!days.length) throw new Error('computeCoachMetrics: empty window');
  const todayRow = days[days.length - 1];
  const all = days.flatMap(d => d.activities);
  const { unit, loadOf } = loadModel(all);

  const last7Days = days.slice(-7);
  const prev7Days = days.slice(-14, -7);
  const sumLoad = (ds: CoachDay[]) => round(ds.flatMap(d => d.activities).reduce((s, a) => s + loadOf(a), 0));
  const last7 = sumLoad(last7Days);
  const prev7 = sumLoad(prev7Days);

  // Today isn't over: a morning without a workout doesn't break the streak yet.
  let i = days.length - 1;
  if (days[i].activities.length === 0) i--;
  let consecutiveTrainingDays = 0;
  while (i >= 0 && days[i].activities.length > 0) { consecutiveTrainingDays++; i--; }

  const sportMinutes14d: Record<string, number> = {};
  for (const a of all) sportMinutes14d[a.sportType] = (sportMinutes14d[a.sportType] ?? 0) + a.durationMinutes;

  const prevNights = days.slice(-8, -1);
  const hrvBaseline = round1(mean(positive(prevNights.map(d => d.hrv))));
  const rhrBaseline = round1(mean(positive(prevNights.map(d => d.rhr))));
  const hrvLastNight = todayRow.hrv;
  const rhrToday = todayRow.rhr;
  const last7Sleep = last7Days.map(d => d.sleepHours);

  const base = {
    today: todayRow.date,
    load: {
      unit,
      last7,
      prev7,
      rampPct: prev7 > 0 ? round(((last7 - prev7) / prev7) * 100) : null,
      sessionsLast7: last7Days.reduce((s, d) => s + d.activities.length, 0),
      hardSessionsLast7: last7Days.flatMap(d => d.activities).filter(isHardSession).length,
      consecutiveTrainingDays,
      sportMinutes14d,
    },
    recovery: {
      hrvLastNight,
      hrvBaseline,
      hrvDeltaPct: hrvLastNight > 0 && hrvBaseline > 0 ? round(((hrvLastNight - hrvBaseline) / hrvBaseline) * 100) : null,
      rhrToday,
      rhrBaseline,
      rhrDelta: rhrToday > 0 && rhrBaseline > 0 ? round(rhrToday - rhrBaseline) : null,
      sleepLastNight: todayRow.sleepHours,
      sleepAvg7d: round1(mean(positive(last7Sleep))),
      sleepDebt7d: calculateSleepDebt(last7Sleep, 8),
      recoveryToday: todayRow.recovery,
    },
    coverage: {
      recoveryDays: days.filter(d => d.hrv > 0 || d.sleepHours > 0).length,
      activitiesWithHR: all.filter(a => a.averageHR > 0).length,
      windowDays: days.length,
    },
  };

  const lastNightKnown = todayRow.hrv > 0 || todayRow.sleepHours > 0;
  const confidence: CoachMetrics['confidence'] =
    base.coverage.recoveryDays >= 10 && lastNightKnown ? 'high'
      : base.coverage.recoveryDays >= 5 ? 'medium'
        : 'low';

  return { ...base, flags: computeFlags(base), confidence };
}

export type AdviceProfile = Pick<UserProfile, 'age' | 'sex' | 'fitnessLevel' | 'goal'> & { weight?: number };

/** The exact JSON the model sees. Compact: one row per day, metrics, flags. */
export function buildAdviceInput(params: {
  metrics: CoachMetrics;
  days: CoachDay[];
  profile: AdviceProfile | null;
  language: 'en' | 'es';
}) {
  const { metrics, days, profile, language } = params;
  const weekday = (d: string) => format(parseISO(d), 'EEEE');
  return {
    language,
    today: { date: metrics.today, weekday: weekday(metrics.today) },
    planFor: upcomingDates(metrics.today).map(d => ({ date: d, weekday: weekday(d) })),
    athlete: profile ?? 'unknown (no profile set)',
    metrics: {
      load: metrics.load,
      recovery: metrics.recovery,
      dataCoverage: metrics.coverage,
    },
    flags: metrics.flags,
    days: days.map(d => ({
      date: d.date,
      hrv: d.hrv || null,
      rhr: d.rhr || null,
      sleepH: d.sleepHours || null,
      recovery: d.recovery || null,
      sessions: d.activities.map(a => ({
        sport: a.sportType,
        min: a.durationMinutes,
        km: a.distanceKm || undefined,
        avgHR: a.averageHR || undefined,
        load: a.trainingLoad,
        aerobicTE: a.aerobicTE,
        anaerobicTE: a.anaerobicTE,
      })),
    })),
  };
}

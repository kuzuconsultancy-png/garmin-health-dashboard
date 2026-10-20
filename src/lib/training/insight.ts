import { format, parseISO } from 'date-fns';
import type { ActivityAnalysis, ActivitySummary } from './types';
import { activityEffort } from './effort';
import { EFFORT_LABELS } from './format';

// Everything the activity-insight prompt needs, computed in code: comparison
// with recent same-sport sessions, pacing, zones, PRs, recovery that morning.

export interface InsightPR { distM: number; timeSec: number; rank: 1 | 2 | 3 }

export interface InsightRecovery {
  hrvLastNight: number;
  hrvBaseline: number;
  sleepHours: number;
}

const round = (n: number, d = 0) => Math.round(n * 10 ** d) / 10 ** d;
const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const paceOf = (sec: number, m: number) => (m > 0 ? round((sec / m) * 1000) : null);

/** Pacing from splits: 2nd-half vs 1st-half pace (s/km, + = slower). Ignores a short final split. */
export function pacingSplit(analysis: ActivityAnalysis): { firstHalfPace: number; secondHalfPace: number; diff: number; type: 'negative' | 'even' | 'positive' } | null {
  const full = analysis.splits.filter(s => s.distM >= 900);
  if (full.length < 4) return null;
  const mid = Math.floor(full.length / 2);
  const pace = (xs: typeof full) => (xs.reduce((s, x) => s + x.timeSec, 0) / xs.reduce((s, x) => s + x.distM, 0)) * 1000;
  const first = pace(full.slice(0, mid));
  const second = pace(full.slice(mid));
  const diff = round(second - first);
  return { firstHalfPace: round(first), secondHalfPace: round(second), diff, type: diff <= -3 ? 'negative' : diff >= 3 ? 'positive' : 'even' };
}

export function buildInsightInput(p: {
  activity: ActivitySummary;
  analysis: ActivityAnalysis | null;
  history: ActivitySummary[];
  hrMax: number;
  prs: InsightPR[];
  recovery: InsightRecovery | null;
  language: 'en' | 'es';
}) {
  const a = p.activity;
  const effort = activityEffort(a, p.hrMax).effort;
  const similar = p.history
    .filter(h => h.sport === a.sport && h.id !== a.id && h.startTimeLocal < a.startTimeLocal)
    .slice(-10);
  const withDist = similar.filter(h => h.distanceM > 0);
  const withHR = similar.filter(h => h.avgHR > 0);
  const simEfforts = similar.map(h => activityEffort(h, p.hrMax).effort).filter((e): e is number => e !== null);

  const thisPace = paceOf(a.durationSec, a.distanceM);
  const avgPace = withDist.length
    ? paceOf(withDist.reduce((s, h) => s + h.durationSec, 0), withDist.reduce((s, h) => s + h.distanceM, 0))
    : null;
  const avgHR = withHR.length ? round(avg(withHR.map(h => h.avgHR))) : null;
  const avgEffort = simEfforts.length ? round(avg(simEfforts)) : null;
  const avgDistKm = withDist.length ? round(avg(withDist.map(h => h.distanceM)) / 1000, 1) : null;

  const zonesPct = (sec: number[] | null) => {
    const total = sec?.reduce((s, v) => s + v, 0) ?? 0;
    return sec && total > 0 ? sec.map(v => round((v / total) * 100)) : null;
  };

  const an = p.analysis;
  const splits = an?.splits ?? [];
  const step = Math.max(1, Math.ceil(splits.length / 25)); // keep the prompt small on long rides

  return {
    language: p.language,
    activity: {
      name: a.name,
      sport: a.sportKey,
      date: a.date,
      weekday: format(parseISO(a.date), 'EEEE'),
      durationMin: round(a.durationSec / 60),
      distanceKm: a.distanceM ? round(a.distanceM / 1000, 2) : null,
      paceSecPerKm: thisPace,
      gapSecPerKm: an?.gapSecPerKm ?? null,
      avgHR: a.avgHR || null,
      maxHR: a.maxHR || null,
      hrMax: p.hrMax,
      elevationGainM: a.elevationGainM,
      effort,
      garminTrainingLoad: a.trainingLoad ?? null,
      aerobicTE: a.aerobicTE ?? null,
      anaerobicTE: a.anaerobicTE ?? null,
    },
    splits: splits.filter((_, i) => i % step === 0).map(s => ({
      km: round((s.index * s.distM) / 1000, 1), pace: s.paceSecPerKm, gap: s.gapSecPerKm, hr: s.avgHR || null,
    })),
    pacing: an ? pacingSplit(an) : null,
    hrDriftPct: an?.hrDriftPct ?? null,
    hrZonesPct: zonesPct(an?.hrZoneSec ?? null),
    paceZonesPct: zonesPct(an?.paceZoneSec ?? null), // Easy, Marathon, Threshold, Interval, Repetition
    personalRecords: p.prs.map(pr => ({ distance: EFFORT_LABELS[pr.distM] ?? `${pr.distM} m`, time: pr.timeSec, rank: pr.rank })),
    comparedToLast: similar.length ? {
      sessions: similar.length,
      avgDistanceKm: avgDistKm,
      avgPaceSecPerKm: avgPace,
      avgHR,
      avgEffort,
      paceDiffSecPerKm: thisPace !== null && avgPace !== null ? round(thisPace - avgPace) : null, // − = faster
      hrDiff: a.avgHR && avgHR ? round(a.avgHR - avgHR) : null,
      effortDiffPct: effort !== null && avgEffort ? round(((effort - avgEffort) / avgEffort) * 100) : null,
    } : null,
    recoveryThatMorning: p.recovery ? {
      ...p.recovery,
      hrvDeltaPct: p.recovery.hrvLastNight && p.recovery.hrvBaseline
        ? round(((p.recovery.hrvLastNight - p.recovery.hrvBaseline) / p.recovery.hrvBaseline) * 100)
        : null,
    } : null,
  };
}

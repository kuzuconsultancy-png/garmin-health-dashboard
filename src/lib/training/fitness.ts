import { addDays, format, parseISO, startOfWeek, differenceInCalendarDays } from 'date-fns';
import type { ActivitySummary, HrRef } from './types';
import { activityEffort, weeklyEffortStatus, type WeekStatus } from './effort';

// Fitness & Freshness (Banister impulse-response, as in TrainingPeaks/Strava):
//   fitness_t = fitness_{t-1} + (load_t − fitness_{t-1}) / 42
//   fatigue_t = fatigue_{t-1} + (load_t − fatigue_{t-1}) / 7
//   form_t    = fitness_t − fatigue_t
// Load = daily sum of effort (see effort.ts).

export const FITNESS_DAYS = 42;
export const FATIGUE_DAYS = 7;

export interface FitnessPoint {
  date: string;
  load: number;
  fitness: number;
  fatigue: number;
  form: number;
}

const iso = (d: Date) => format(d, 'yyyy-MM-dd');

export function dateRange(from: string, to: string): string[] {
  const start = parseISO(from);
  const n = differenceInCalendarDays(parseISO(to), start) + 1;
  return Array.from({ length: Math.max(0, n) }, (_, i) => iso(addDays(start, i)));
}

/** Daily effort totals for every day in [from, to] (0 on rest days). */
export function dailyLoads(activities: ActivitySummary[], zones: HrRef, from: string, to: string): { date: string; load: number }[] {
  const byDate = new Map<string, number>();
  for (const a of activities) {
    if (a.date < from || a.date > to) continue;
    const { effort } = activityEffort(a, zones);
    if (effort) byDate.set(a.date, (byDate.get(a.date) ?? 0) + effort);
  }
  return dateRange(from, to).map(date => ({ date, load: byDate.get(date) ?? 0 }));
}

/** Runs the model over consecutive days; starts from 0 so feed ≥ 3×42 days of warm-up history. */
export function fitnessSeries(loads: { date: string; load: number }[]): FitnessPoint[] {
  let fitness = 0;
  let fatigue = 0;
  return loads.map(({ date, load }) => {
    fitness += (load - fitness) / FITNESS_DAYS;
    fatigue += (load - fatigue) / FATIGUE_DAYS;
    return { date, load, fitness: round1(fitness), fatigue: round1(fatigue), form: round1(fitness - fatigue) };
  });
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export interface EffortWeek {
  weekStart: string;         // Monday
  effort: number;
  low: number;
  high: number;
  status: WeekStatus;
}

/** Weekly effort totals (Mon–Sun) with the range from the previous 3 weeks. Newest last. */
export function weeklyEfforts(activities: ActivitySummary[], zones: HrRef, today: string, weeks = 12): EffortWeek[] {
  const thisMonday = startOfWeek(parseISO(today), { weekStartsOn: 1 });
  const total = weeks + 3; // 3 extra weeks to seed the first range
  const starts = Array.from({ length: total }, (_, i) => iso(addDays(thisMonday, -7 * (total - 1 - i))));
  const sums = starts.map(ws => {
    const we = iso(addDays(parseISO(ws), 6));
    return activities
      .filter(a => a.date >= ws && a.date <= we)
      .reduce((s, a) => s + (activityEffort(a, zones).effort ?? 0), 0);
  });
  return starts.slice(3).map((weekStart, i) => {
    const effort = sums[i + 3];
    return { weekStart, effort, ...weeklyEffortStatus(effort, sums.slice(i, i + 3)) };
  });
}

import {
  format, parseISO, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear,
  differenceInCalendarDays,
} from 'date-fns';
import type { ActivitySummary, Goal, GoalMetric, GoalPeriod, Sport } from './types';

const iso = (d: Date) => format(d, 'yyyy-MM-dd');

export function periodRange(period: GoalPeriod, today: string): { start: string; end: string } {
  const d = parseISO(today);
  if (period === 'week') return { start: iso(startOfWeek(d, { weekStartsOn: 1 })), end: iso(endOfWeek(d, { weekStartsOn: 1 })) };
  if (period === 'month') return { start: iso(startOfMonth(d)), end: iso(endOfMonth(d)) };
  return { start: iso(startOfYear(d)), end: iso(endOfYear(d)) };
}

/** Value of one activity in the goal's unit: km, hours, meters, or 1 session. */
export function metricValue(a: ActivitySummary, metric: GoalMetric): number {
  switch (metric) {
    case 'distance': return a.distanceM / 1000;
    case 'time': return a.durationSec / 3600;
    case 'elevation': return a.elevationGainM;
    case 'count': return 1;
  }
}

export function matchesSport(a: ActivitySummary, sport: Sport | 'all'): boolean {
  return sport === 'all' || a.sport === sport;
}

export interface GoalProgress {
  current: number;
  target: number;
  pct: number;               // current / target × 100
  elapsedPct: number;        // share of the period passed, incl. today
  projected: number;         // current extrapolated to period end
  onPace: boolean;
  remaining: number;
  perDayNeeded: number;      // remaining / days left (incl. today)
  daysLeft: number;
}

export function goalProgress(goal: Goal, activities: ActivitySummary[], today: string): GoalProgress {
  const { start, end } = periodRange(goal.period, today);
  const current = activities
    .filter(a => a.date >= start && a.date <= today && matchesSport(a, goal.sport))
    .reduce((s, a) => s + metricValue(a, goal.metric), 0);

  const totalDays = differenceInCalendarDays(parseISO(end), parseISO(start)) + 1;
  const elapsedDays = differenceInCalendarDays(parseISO(today), parseISO(start)) + 1;
  const daysLeft = totalDays - elapsedDays + 1; // today still counts
  const projected = (current / elapsedDays) * totalDays;
  const remaining = Math.max(0, goal.target - current);

  return {
    current: round2(current),
    target: goal.target,
    pct: goal.target > 0 ? Math.round((current / goal.target) * 100) : 0,
    elapsedPct: Math.round((elapsedDays / totalDays) * 100),
    projected: round2(projected),
    onPace: current >= goal.target || projected >= goal.target,
    remaining: round2(remaining),
    perDayNeeded: round2(remaining / daysLeft),
    daysLeft,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

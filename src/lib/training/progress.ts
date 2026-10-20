import { getDayOfYear, parseISO } from 'date-fns';
import type { ActivitySummary, GoalMetric, Sport } from './types';
import { matchesSport, metricValue } from './goals';

/** Cumulative total per day of `year` (index 0 = Jan 1). Stops at `upToDate` when given. */
export function cumulativeByDay(
  activities: ActivitySummary[], sport: Sport | 'all', metric: GoalMetric, year: number, upToDate?: string,
): number[] {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = leap ? 366 : 365;
  const perDay = new Array<number>(days).fill(0);
  for (const a of activities) {
    if (!a.date.startsWith(`${year}-`) || !matchesSport(a, sport)) continue;
    perDay[getDayOfYear(parseISO(a.date)) - 1] += metricValue(a, metric);
  }
  const last = upToDate && upToDate.startsWith(`${year}-`) ? getDayOfYear(parseISO(upToDate)) : days;
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < last; i++) { sum += perDay[i]; out.push(Math.round(sum * 10) / 10); }
  return out;
}

export function monthlyTotals(activities: ActivitySummary[], sport: Sport | 'all', metric: GoalMetric, year: number): number[] {
  const months = new Array<number>(12).fill(0);
  for (const a of activities) {
    if (!a.date.startsWith(`${year}-`) || !matchesSport(a, sport)) continue;
    months[Number(a.date.slice(5, 7)) - 1] += metricValue(a, metric);
  }
  return months.map(v => Math.round(v * 10) / 10);
}

export interface YearComparison {
  thisYear: number[];        // cumulative up to today
  lastYear: number[];        // cumulative, full year
  thisYearToDate: number;
  lastYearToDate: number;    // last year at the same day of year
  deltaPct: number | null;
}

export function yearComparison(activities: ActivitySummary[], sport: Sport | 'all', metric: GoalMetric, today: string): YearComparison {
  const year = Number(today.slice(0, 4));
  const thisYear = cumulativeByDay(activities, sport, metric, year, today);
  const lastYear = cumulativeByDay(activities, sport, metric, year - 1);
  const thisYearToDate = thisYear[thisYear.length - 1] ?? 0;
  const lastYearToDate = lastYear[Math.min(thisYear.length, lastYear.length) - 1] ?? 0;
  return {
    thisYear,
    lastYear,
    thisYearToDate,
    lastYearToDate,
    deltaPct: lastYearToDate > 0 ? Math.round(((thisYearToDate - lastYearToDate) / lastYearToDate) * 100) : null,
  };
}

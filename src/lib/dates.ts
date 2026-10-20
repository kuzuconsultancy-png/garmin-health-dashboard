import { format, parseISO, differenceInCalendarDays } from 'date-fns';

/** Client's local date (so windows match the athlete's day), clamped to ±1 day of server time. */
export function resolveToday(raw: unknown): string {
  const serverToday = format(new Date(), 'yyyy-MM-dd');
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return serverToday;
  const diff = differenceInCalendarDays(parseISO(raw), parseISO(serverToday));
  return Number.isFinite(diff) && Math.abs(diff) <= 1 ? raw : serverToday;
}

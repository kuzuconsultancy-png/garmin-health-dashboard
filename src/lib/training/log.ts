import { addDays, format, parseISO, startOfWeek } from 'date-fns';
import type { ActivitySummary, HrRef, Sport } from './types';
import { activityEffort } from './effort';

export interface LogSession extends ActivitySummary {
  effort: number | null;
}

export interface LogTotals {
  count: number;
  durationSec: number;
  distanceM: number;
  elevationM: number;
  effort: number;
}

export interface LogWeek {
  weekStart: string;                       // Monday
  days: { date: string; sessions: LogSession[] }[]; // Mon … Sun
  totals: LogTotals;
  bySport: Partial<Record<Sport, LogTotals>>;
}

const iso = (d: Date) => format(d, 'yyyy-MM-dd');
const emptyTotals = (): LogTotals => ({ count: 0, durationSec: 0, distanceM: 0, elevationM: 0, effort: 0 });

function add(t: LogTotals, s: LogSession) {
  t.count += 1;
  t.durationSec += s.durationSec;
  t.distanceM += s.distanceM;
  t.elevationM += s.elevationGainM;
  t.effort += s.effort ?? 0;
}

/** The last `weeks` Mon–Sun weeks ending with the week containing `today`. Newest first. */
export function buildTrainingLog(activities: ActivitySummary[], zones: HrRef, today: string, weeks = 12): LogWeek[] {
  const thisMonday = startOfWeek(parseISO(today), { weekStartsOn: 1 });
  const byDate = new Map<string, LogSession[]>();
  for (const a of activities) {
    const list = byDate.get(a.date) ?? [];
    list.push({ ...a, effort: activityEffort(a, zones).effort });
    byDate.set(a.date, list);
  }

  return Array.from({ length: weeks }, (_, w) => {
    const monday = addDays(thisMonday, -7 * w);
    const days = Array.from({ length: 7 }, (_, d) => {
      const date = iso(addDays(monday, d));
      const sessions = (byDate.get(date) ?? []).sort((a, b) => a.startTimeLocal.localeCompare(b.startTimeLocal));
      return { date, sessions };
    });
    const totals = emptyTotals();
    const bySport: Partial<Record<Sport, LogTotals>> = {};
    for (const s of days.flatMap(d => d.sessions)) {
      add(totals, s);
      add((bySport[s.sport] ??= emptyTotals()), s);
    }
    return { weekStart: iso(monday), days, totals, bySport };
  });
}

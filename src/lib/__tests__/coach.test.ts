import {
  windowDates, upcomingDates, buildCoachDays, loadModel, computeCoachMetrics,
  buildAdviceInput, isHardSession,
} from '../coach';
import type { CoachDay, RecentActivity, TrendPoint } from '../types';

const TODAY = '2026-10-16'; // a Friday

function act(date: string, o: Partial<RecentActivity> = {}): RecentActivity {
  return {
    date, sportType: 'running', durationMinutes: 45, distanceKm: 8,
    averageHR: 150, maxHR: 170, calories: 500, ...o,
  };
}

/** 14 days ending TODAY; `fill` sets defaults, `over` overrides by offset from today (0 = today). */
function window14(fill: Partial<CoachDay>, over: Record<number, Partial<CoachDay>> = {}): CoachDay[] {
  return windowDates(TODAY).map((date, i) => {
    const offset = 13 - i;
    return { date, hrv: 0, rhr: 0, sleepHours: 0, recovery: 0, activities: [], ...fill, ...(over[offset] ?? {}) };
  });
}

describe('dates', () => {
  test('windowDates ends on today, oldest first', () => {
    expect(windowDates(TODAY, 3)).toEqual(['2026-10-14', '2026-10-15', '2026-10-16']);
  });
  test('windowDates crosses month boundaries', () => {
    expect(windowDates('2026-03-01', 2)).toEqual(['2026-02-28', '2026-03-01']);
  });
  test('upcomingDates starts tomorrow', () => {
    expect(upcomingDates(TODAY)).toEqual(['2026-10-17', '2026-10-18', '2026-10-19']);
  });
});

describe('buildCoachDays', () => {
  test('aligns activities and trend points by date; missing days are zeros', () => {
    const trend: TrendPoint[] = [{ date: '2026-10-15', hrv: 44, sleepHours: 7.2, rhr: 52, recovery: 70, strain: 9 }];
    const days = buildCoachDays(TODAY, [act('2026-10-16'), act('2026-09-01')], trend, 3);
    expect(days.map(d => d.date)).toEqual(['2026-10-14', '2026-10-15', '2026-10-16']);
    expect(days[0]).toMatchObject({ hrv: 0, rhr: 0, sleepHours: 0, activities: [] });
    expect(days[1]).toMatchObject({ hrv: 44, rhr: 52, sleepHours: 7.2, recovery: 70 });
    expect(days[2].activities).toHaveLength(1); // out-of-window activity dropped
  });
});

describe('loadModel', () => {
  test('uses Garmin load and estimates a missing one from median load/min', () => {
    // 100/50 = 2.0/min, 60/30 = 2.0/min → missing 40 min session ≈ 80
    const a = act(TODAY, { trainingLoad: 100, durationMinutes: 50 });
    const b = act(TODAY, { trainingLoad: 60, durationMinutes: 30 });
    const c = act(TODAY, { durationMinutes: 40 });
    const m = loadModel([a, b, c]);
    expect(m.unit).toBe('training_load');
    expect([a, b, c].map(m.loadOf)).toEqual([100, 60, 80]);
  });
  test('falls back to minutes when under half the sessions have load', () => {
    const m = loadModel([act(TODAY, { trainingLoad: 90 }), act(TODAY), act(TODAY)]);
    expect(m.unit).toBe('minutes');
    expect(m.loadOf(act(TODAY, { durationMinutes: 33 }))).toBe(33);
  });
});

describe('isHardSession', () => {
  test('aerobic TE ≥ 4 or anaerobic TE ≥ 3', () => {
    expect(isHardSession(act(TODAY, { aerobicTE: 4.0 }))).toBe(true);
    expect(isHardSession(act(TODAY, { anaerobicTE: 3.1 }))).toBe(true);
    expect(isHardSession(act(TODAY, { aerobicTE: 3.9, anaerobicTE: 2.9 }))).toBe(false);
    expect(isHardSession(act(TODAY))).toBe(false);
  });
});

describe('computeCoachMetrics — load', () => {
  test('7d vs previous 7d ramp: prev 200, last 320 → +60% → load_spike alert', () => {
    const days = window14({ hrv: 50, rhr: 50, sleepHours: 7.5 }, {
      10: { activities: [act('', { trainingLoad: 200, durationMinutes: 60 })] },  // prev7 window
      3:  { activities: [act('', { trainingLoad: 160, durationMinutes: 50 })] },  // last7 window
      1:  { activities: [act('', { trainingLoad: 160, durationMinutes: 50 })] },
    });
    const m = computeCoachMetrics(days);
    expect(m.load).toMatchObject({ unit: 'training_load', last7: 320, prev7: 200, rampPct: 60, sessionsLast7: 2 });
    expect(m.flags.find(f => f.id === 'load_spike')).toEqual({ id: 'load_spike', severity: 'alert', value: 60 });
  });

  test('no ramp flag off a tiny base (prev7 load 50 < 100)', () => {
    const days = window14({ hrv: 50, rhr: 50, sleepHours: 7.5 }, {
      10: { activities: [act('', { trainingLoad: 50 })] },
      2:  { activities: [act('', { trainingLoad: 150 })] },
    });
    const m = computeCoachMetrics(days);
    expect(m.load.rampPct).toBe(200);
    expect(m.flags.map(f => f.id)).not.toContain('load_spike');
  });

  test('streak skips a workout-free today, counts back from yesterday', () => {
    // trained offsets 1..6 (yesterday back 6 days), none today, rest at offset 7
    const over: Record<number, Partial<CoachDay>> = {};
    for (let o = 1; o <= 6; o++) over[o] = { activities: [act('')] };
    const m = computeCoachMetrics(window14({ hrv: 50, rhr: 50, sleepHours: 7.5 }, over));
    expect(m.load.consecutiveTrainingDays).toBe(6);
    expect(m.flags.find(f => f.id === 'no_rest')?.severity).toBe('warning');
  });
});

describe('computeCoachMetrics — recovery flags', () => {
  test('HRV −20% → warning, −32% → alert (baseline = previous 7 nights)', () => {
    const warn = computeCoachMetrics(window14({ hrv: 50, rhr: 50, sleepHours: 7.5 }, { 0: { hrv: 40 } }));
    expect(warn.recovery).toMatchObject({ hrvLastNight: 40, hrvBaseline: 50, hrvDeltaPct: -20 });
    expect(warn.flags[0]).toEqual({ id: 'hrv_suppressed', severity: 'warning', value: -20 });

    const alert = computeCoachMetrics(window14({ hrv: 50, rhr: 50, sleepHours: 7.5 }, { 0: { hrv: 34 } }));
    expect(alert.flags[0]).toEqual({ id: 'hrv_suppressed', severity: 'alert', value: -32 });
  });

  test('RHR +6 bpm → warning; 5.5h sleep → alert; alerts sort first', () => {
    // other nights 8h → 7-day debt = 8 − 5.5 = 2.5h, below the 5h debt threshold
    const m = computeCoachMetrics(window14({ hrv: 50, rhr: 50, sleepHours: 8 }, { 0: { rhr: 56, sleepHours: 5.5 } }));
    expect(m.recovery.rhrDelta).toBe(6);
    expect(m.flags).toEqual([
      { id: 'short_sleep', severity: 'alert', value: 5.5 },
      { id: 'rhr_elevated', severity: 'warning', value: 6 },
    ]);
  });

  test('7-day sleep debt: 7 nights × 7.2h vs 8h = 5.6h → warning', () => {
    const m = computeCoachMetrics(window14({ hrv: 50, rhr: 50, sleepHours: 7.2 }));
    expect(m.recovery.sleepDebt7d).toBe(5.6);
    expect(m.flags.map(f => f.id)).toEqual(['sleep_debt']);
  });

  test('HRV +10%, RHR −1, 7.5h sleep, nothing negative → well_recovered', () => {
    const m = computeCoachMetrics(window14({ hrv: 50, rhr: 50, sleepHours: 8 }, { 0: { hrv: 55, rhr: 49, sleepHours: 7.5 } }));
    expect(m.flags).toEqual([{ id: 'well_recovered', severity: 'positive', value: 10 }]);
  });

  test('missing last night → deltas null, no recovery flags', () => {
    const m = computeCoachMetrics(window14({ hrv: 50, rhr: 50, sleepHours: 8 }, { 0: { hrv: 0, rhr: 0, sleepHours: 0 } }));
    expect(m.recovery.hrvDeltaPct).toBeNull();
    expect(m.recovery.rhrDelta).toBeNull();
    expect(m.flags).toEqual([]);
  });
});

describe('computeCoachMetrics — confidence from data coverage', () => {
  test('14/14 days incl. last night → high', () => {
    expect(computeCoachMetrics(window14({ hrv: 50, sleepHours: 8 })).confidence).toBe('high');
  });
  test('full history but last night missing → medium', () => {
    expect(computeCoachMetrics(window14({ hrv: 50, sleepHours: 8 }, { 0: { hrv: 0, sleepHours: 0 } })).confidence).toBe('medium');
  });
  test('2 days of data → low', () => {
    expect(computeCoachMetrics(window14({}, { 0: { hrv: 50 }, 1: { hrv: 50 } })).confidence).toBe('low');
  });
});

describe('buildAdviceInput', () => {
  test('gives the model dates + weekdays for today and the 3 plan days', () => {
    const days = window14({ hrv: 50, rhr: 50, sleepHours: 8 });
    const input = buildAdviceInput({ metrics: computeCoachMetrics(days), days, profile: null, language: 'es' });
    expect(input.today).toEqual({ date: TODAY, weekday: 'Friday' });
    expect(input.planFor).toEqual([
      { date: '2026-10-17', weekday: 'Saturday' },
      { date: '2026-10-18', weekday: 'Sunday' },
      { date: '2026-10-19', weekday: 'Monday' },
    ]);
    expect(input.language).toBe('es');
    expect(input.days).toHaveLength(14);
  });
});

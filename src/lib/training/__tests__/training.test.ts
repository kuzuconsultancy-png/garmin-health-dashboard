import type { ActivitySummary, ActivityStreams, StoredEffort } from '../types';
import { sportOf, estimateHRMax, zoneOf, effortFromZones, activityEffort, weeklyEffortStatus } from '../effort';
import { fitnessSeries, dailyLoads, weeklyEfforts } from '../fitness';
import { buildTrainingLog } from '../log';
import { goalProgress, periodRange } from '../goals';
import { cumulativeByDay, monthlyTotals, yearComparison } from '../progress';
import {
  riegel, predictRace, vdotFromPerformance, raceTimeFromVdot, speedAtFraction, currentVdot,
} from '../predictions';
import { bestEfforts, prRank, personalRecords } from '../bestEfforts';
import { minettiCost, computeSplits, overallGap, hrZoneSeconds, paceZoneSeconds, hrDrift } from '../analysis';
import { formatDuration, formatPace } from '../format';

function act(o: Partial<ActivitySummary>): ActivitySummary {
  return {
    id: 'a', name: 'Run', date: '2026-10-14', startTimeLocal: '2026-10-14 07:00:00',
    sport: 'running', sportKey: 'running', durationSec: 3600, distanceM: 10000, elevationGainM: 50,
    avgHR: 150, maxHR: 175, avgSpeed: 2.78, calories: 700, ...o,
  };
}

/** Constant-speed stream at 1 Hz. */
function stream(speed: number, seconds: number, extra: Partial<ActivityStreams> = {}): ActivityStreams {
  const t = Array.from({ length: seconds + 1 }, (_, i) => i);
  return { t, dist: t.map(s => s * speed), speed: t.map(() => speed), ...extra };
}

describe('effort', () => {
  test('sport mapping from Garmin type keys', () => {
    expect(sportOf('trail_running')).toBe('running');
    expect(sportOf('indoor_cycling')).toBe('cycling');
    expect(sportOf('lap_swimming')).toBe('swimming');
    expect(sportOf('strength_training')).toBe('strength');
    expect(sportOf('yoga')).toBe('other');
  });

  test('HRmax = max(recorded, 208 − 0.7·age); 190 when nothing usable', () => {
    expect(estimateHRMax([act({ maxHR: 186 })], 40)).toBe(186); // formula 180
    expect(estimateHRMax([act({ maxHR: 165 })], 30)).toBe(187); // formula 187
    expect(estimateHRMax([], undefined)).toBe(190);
  });

  test('zones by % of max HR (190): 94 → 0, 95 → Z1, 152 → Z4, 171 → Z5', () => {
    expect([94, 95, 152, 171].map(h => zoneOf(h, 190))).toEqual([0, 1, 4, 5]);
  });

  test('Edwards TRIMP: 10 min Z1 + 30 min Z2 + 20 min Z4 = 10 + 60 + 80 = 150', () => {
    expect(effortFromZones([600, 1800, 0, 1200, 0])).toBe(150);
  });

  test('falls back to avg HR zone × minutes; null without HR', () => {
    // 60 min at 140 bpm with max 190 → 73.7 % → Z3 → 180
    expect(activityEffort(act({ avgHR: 140 }), 190)).toEqual({ effort: 180, source: 'avgHR' });
    expect(activityEffort(act({ hrZoneSec: [0, 3600, 0, 0, 0] }), 190)).toEqual({ effort: 120, source: 'zones' });
    expect(activityEffort(act({ avgHR: 0 }), 190)).toEqual({ effort: null, source: null });
  });

  test('weekly range = 0.8–1.2 × previous 3-week mean', () => {
    // mean(300, 400, 500) = 400 → range 320–480
    expect(weeklyEffortStatus(400, [300, 400, 500])).toEqual({ low: 320, high: 480, status: 'maintain' });
    expect(weeklyEffortStatus(300, [300, 400, 500]).status).toBe('recovery');
    expect(weeklyEffortStatus(560, [300, 400, 500]).status).toBe('build');  // 1.4×
    expect(weeklyEffortStatus(640, [300, 400, 500]).status).toBe('spike');  // 1.6×
    expect(weeklyEffortStatus(100, [0, 0, 0]).status).toBe('none');
  });
});

describe('fitness & freshness', () => {
  test('constant load 100/day for 42 days', () => {
    const loads = Array.from({ length: 42 }, (_, i) => ({ date: `d${i}`, load: 100 }));
    const last = fitnessSeries(loads).at(-1)!;
    // fitness = 100·(1 − (41/42)^42) = 63.66 ; fatigue = 100·(1 − (6/7)^42) = 99.85
    expect(last.fitness).toBeCloseTo(63.7, 1);
    expect(last.fatigue).toBeCloseTo(99.8, 0);
    expect(last.form).toBeCloseTo(-36.2, 0);
  });

  test('daily loads include rest days as 0 and sum same-day sessions', () => {
    const acts = [
      act({ id: '1', date: '2026-10-01', hrZoneSec: [0, 1800, 0, 0, 0] }), // 60
      act({ id: '2', date: '2026-10-01', hrZoneSec: [600, 0, 0, 0, 0] }),  // 10
      act({ id: '3', date: '2026-10-03', hrZoneSec: [0, 0, 1200, 0, 0] }), // 60
    ];
    expect(dailyLoads(acts, 190, '2026-10-01', '2026-10-03').map(d => d.load)).toEqual([70, 0, 60]);
  });

  test('weekly efforts are Mon–Sun with a range from the 3 weeks before', () => {
    const acts = [
      act({ id: '1', date: '2026-09-22', hrZoneSec: [0, 6000, 0, 0, 0] }), // wk of Sep 21: 200
      act({ id: '2', date: '2026-09-29', hrZoneSec: [0, 6000, 0, 0, 0] }), // wk of Sep 28: 200
      act({ id: '3', date: '2026-10-06', hrZoneSec: [0, 6000, 0, 0, 0] }), // wk of Oct 5: 200
      act({ id: '4', date: '2026-10-13', hrZoneSec: [0, 9000, 0, 0, 0] }), // wk of Oct 12: 300
    ];
    const weeks = weeklyEfforts(acts, 190, '2026-10-14', 1);
    expect(weeks).toEqual([{ weekStart: '2026-10-12', effort: 300, low: 160, high: 240, status: 'build' }]);
  });
});

describe('training log', () => {
  test('groups into Mon–Sun weeks, newest first, with per-sport totals', () => {
    const log = buildTrainingLog([
      act({ id: '1', date: '2026-10-12', distanceM: 8000 }),
      act({ id: '2', date: '2026-10-14', sport: 'cycling', distanceM: 30000, durationSec: 5400 }),
      act({ id: '3', date: '2026-10-08', distanceM: 5000 }),
    ], 190, '2026-10-14', 2);
    expect(log.map(w => w.weekStart)).toEqual(['2026-10-12', '2026-10-05']);
    expect(log[0].days[0].sessions.map(s => s.id)).toEqual(['1']);
    expect(log[0].days[2].sessions.map(s => s.id)).toEqual(['2']);
    expect(log[0].totals).toMatchObject({ count: 2, distanceM: 38000, durationSec: 9000 });
    expect(log[0].bySport.cycling).toMatchObject({ count: 1, distanceM: 30000 });
    expect(log[1].totals.count).toBe(1);
  });
});

describe('goals', () => {
  test('period ranges', () => {
    expect(periodRange('week', '2026-10-14')).toEqual({ start: '2026-10-12', end: '2026-10-18' });
    expect(periodRange('month', '2026-02-10')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(periodRange('year', '2026-10-14')).toEqual({ start: '2026-01-01', end: '2026-12-31' });
  });

  test('30 km/week goal, 12 km done by Wednesday', () => {
    const acts = [
      act({ id: '1', date: '2026-10-12', distanceM: 5000 }),
      act({ id: '2', date: '2026-10-14', distanceM: 7000 }),
      act({ id: '3', date: '2026-10-14', sport: 'cycling', distanceM: 40000 }), // other sport
      act({ id: '4', date: '2026-10-11', distanceM: 9000 }),                    // last week
    ];
    const p = goalProgress({ id: 'g', sport: 'running', metric: 'distance', period: 'week', target: 30 }, acts, '2026-10-14');
    // elapsed 3/7 days; projected = 12 / 3 × 7 = 28 → not on pace; 18 km left over 5 days = 3.6/day
    expect(p).toMatchObject({ current: 12, pct: 40, elapsedPct: 43, projected: 28, onPace: false, remaining: 18, daysLeft: 5, perDayNeeded: 3.6 });
  });
});

describe('progress', () => {
  const acts = [
    act({ id: '1', date: '2025-01-02', distanceM: 10000 }),
    act({ id: '2', date: '2025-03-01', distanceM: 20000 }),
    act({ id: '3', date: '2026-01-01', distanceM: 5000 }),
    act({ id: '4', date: '2026-01-03', distanceM: 15000 }),
  ];
  test('cumulative per day, cut at today', () => {
    expect(cumulativeByDay(acts, 'all', 'distance', 2026, '2026-01-04')).toEqual([5, 5, 20, 20]);
  });
  test('monthly totals', () => {
    expect(monthlyTotals(acts, 'running', 'distance', 2025).slice(0, 3)).toEqual([10, 0, 20]);
  });
  test('year over year at the same day of year', () => {
    const y = yearComparison(acts, 'all', 'distance', '2026-01-04');
    expect(y.thisYearToDate).toBe(20);
    expect(y.lastYearToDate).toBe(10);
    expect(y.deltaPct).toBe(100);
    expect(y.lastYear).toHaveLength(365);
  });
});

describe('predictions', () => {
  test('Riegel: 20:00 5K → 10K = 1200 × 2^1.06 = 2501.7 s', () => {
    expect(riegel(1200, 5000, 10000)).toBeCloseTo(2501.7, 0);
  });

  test('predictRace ignores efforts under a quarter of the distance', () => {
    const efforts = [{ distM: 1000, timeSec: 200 }, { distM: 10000, timeSec: 2700 }];
    const p = predictRace(efforts, 21097.5)!;
    expect(p.from.distM).toBe(10000); // the 1K is < 21.1/4 km
    expect(p.timeSec).toBe(Math.round(riegel(2700, 10000, 21097.5)));
    expect(predictRace(efforts, 42195)).toBeNull(); // 10K < 42.2/4 = 10.55 km
  });

  test('Daniels VDOT 50 table: 5K 19:57, 10K 41:21, half 1:31:35, marathon 3:10:49 (±0.5 %)', () => {
    const table = [[5000, 1197], [10000, 2481], [21097.5, 5495], [42195, 11449]];
    for (const [d, t] of table) {
      expect(Math.abs(raceTimeFromVdot(50, d) - t) / t).toBeLessThan(0.005);
      expect(vdotFromPerformance(d, t)).toBeCloseTo(50, 0);
    }
  });

  test('speed at 100 % VO2max for VDOT 50 is between 5K and 1500 m race speed', () => {
    const v = speedAtFraction(50, 1);
    expect(v).toBeGreaterThan(5000 / 1197);
    expect(v).toBeLessThan(5.2);
  });

  test('currentVdot uses only efforts ≥ 3 km', () => {
    expect(currentVdot([{ distM: 1000, timeSec: 150 }])).toBeNull();
    expect(currentVdot([{ distM: 5000, timeSec: 1197 }, { distM: 10000, timeSec: 3000 }])).toBeCloseTo(50, 0);
  });
});

describe('best efforts', () => {
  test('constant 4:00/km for 12 km → 1K 240 s, 5K 1200 s, 10K 2400 s', () => {
    const s = stream(1000 / 240, 2880);
    const e = bestEfforts(s.t, s.dist, [1000, 5000, 10000, 21097.5]);
    expect(e).toEqual([
      { distM: 1000, timeSec: 240 },
      { distM: 5000, timeSec: 1200 },
      { distM: 10000, timeSec: 2400 },
    ]); // no half: only 12 km
  });

  test('finds a fast kilometre in the middle (3:30) and interpolates between samples', () => {
    // 2 km at 4:00, 1 km at 3:30, 2 km at 4:00, sampled every 5 s
    const t: number[] = [];
    const dist: number[] = [];
    let d = 0;
    for (let s = 0; s <= 1170; s += 5) {
      t.push(s); dist.push(d);
      const v = s >= 480 && s < 690 ? 1000 / 210 : 1000 / 240;
      d += v * 5;
    }
    const [k1] = bestEfforts(t, dist, [1000]);
    expect(k1.timeSec).toBe(210);
  });

  test('PR ranks and records', () => {
    const all: StoredEffort[] = [
      { activityId: 'a', date: '2026-01-01', distM: 5000, timeSec: 1250 },
      { activityId: 'b', date: '2026-05-01', distM: 5000, timeSec: 1200 },
      { activityId: 'c', date: '2026-09-01', distM: 5000, timeSec: 1300 },
      { activityId: 'd', date: '2026-10-01', distM: 5000, timeSec: 1350 },
    ];
    expect(all.map(e => prRank(e, all))).toEqual([2, 1, 3, null]);
    expect(personalRecords(all).get(5000)?.activityId).toBe('b');
    expect(personalRecords(all, '2026-06-01').get(5000)?.activityId).toBe('c');
  });
});

describe('analysis', () => {
  test('Minetti cost: flat 3.6; +5 % ≈ 4.68 (×1.30); −10 % ≈ 2.15', () => {
    expect(minettiCost(0)).toBe(3.6);
    expect(minettiCost(0.05)).toBeCloseTo(4.685, 2);
    expect(minettiCost(-0.1)).toBeCloseTo(2.152, 2);
  });

  test('flat run: GAP equals pace; splits per km', () => {
    const s = stream(1000 / 300, 1500, { ele: Array(1501).fill(10) }); // 5:00/km, 5 km
    const splits = computeSplits(s);
    expect(splits).toHaveLength(5);
    expect(splits[0]).toMatchObject({ index: 1, paceSecPerKm: 300, gapSecPerKm: 300, elevGainM: 0 });
    expect(overallGap(splits)).toBe(300);
  });

  test('steady 5 % climb at 6:00/km → GAP = 360 / 1.30 ≈ 277 s/km', () => {
    const s = stream(1000 / 360, 1080);
    s.ele = s.dist.map(d => d * 0.05);
    const splits = computeSplits(s);
    const factor = minettiCost(0.05) / 3.6;
    expect(splits[1].gapSecPerKm).toBeCloseTo(360 / factor, -1);
    expect(splits[1].elevGainM).toBe(50);
  });

  test('HR zones from a stream (max 190): 60 s at 120 (Z2), 60 s at 175 (Z5)', () => {
    const t = Array.from({ length: 121 }, (_, i) => i);
    const hr = t.map(i => (i <= 60 ? 120 : 175));
    expect(hrZoneSeconds(t, hr, 190)).toEqual([0, 60, 0, 0, 60]);
  });

  test('pace zones for VDOT 50: easy jog lands in E, 5K pace lands in I', () => {
    // zone floors for VDOT 50: M 3.44, T 3.77, I 4.06, R 4.42 m/s; 5K pace = 4.18 m/s
    const t = Array.from({ length: 121 }, (_, i) => i);
    expect(paceZoneSeconds(t, t.map(() => 2.8), 50)).toEqual([120, 0, 0, 0, 0]);
    expect(paceZoneSeconds(t, t.map(() => 5000 / 1197), 50)).toEqual([0, 0, 0, 120, 0]);
  });

  test('HR drift: same speed, HR 140 → 147 in 2nd half = +5 %', () => {
    const t = Array.from({ length: 600 }, (_, i) => i);
    const hr = t.map(i => (i < 300 ? 140 : 147));
    expect(hrDrift(t, hr, t.map(() => 3))).toBeCloseTo(5, 1);
  });
});

describe('format', () => {
  test('durations and paces', () => {
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(605)).toBe('10:05');
    expect(formatPace(275)).toBe('4:35');
    expect(formatPace(null)).toBe('—');
  });
});

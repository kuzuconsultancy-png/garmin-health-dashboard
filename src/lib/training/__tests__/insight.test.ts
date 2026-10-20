import { buildInsightInput, pacingSplit } from '../insight';
import type { ActivityAnalysis, ActivitySummary, Split } from '../types';

const run = (id: string, start: string, o: Partial<ActivitySummary> = {}): ActivitySummary => ({
  id, name: 'Run', date: start.slice(0, 10), startTimeLocal: start, sport: 'running', sportKey: 'running',
  durationSec: 3000, distanceM: 10000, elevationGainM: 40, avgHR: 150, maxHR: 170, avgSpeed: 3.33, calories: 600, ...o,
});
const split = (index: number, pace: number): Split =>
  ({ index, distM: 1000, timeSec: pace, paceSecPerKm: pace, gapSecPerKm: pace, avgHR: 150, elevGainM: 0, elevLossM: 0 });
const analysis = (paces: number[]): ActivityAnalysis => ({
  splits: paces.map((p, i) => split(i + 1, p)), paceSecPerKm: null, gapSecPerKm: 290, hrZoneSec: [0, 600, 1800, 600, 0],
  paceZoneSec: null, bestEfforts: [], hrDriftPct: 3.2, chart: [],
});

describe('pacingSplit', () => {
  test('negative split: 300,300,295,290 → halves 300 vs 292.5 → −7.5 → −7 s/km (Math.round)', () => {
    expect(pacingSplit(analysis([300, 300, 295, 290]))).toEqual({ firstHalfPace: 300, secondHalfPace: 293, diff: -7, type: 'negative' });
  });
  test('even within ±3 s/km; null with fewer than 4 full splits', () => {
    expect(pacingSplit(analysis([300, 301, 299, 302]))?.type).toBe('even');
    expect(pacingSplit(analysis([300, 300, 300]))).toBeNull();
  });
});

describe('buildInsightInput', () => {
  const history = [
    run('a', '2026-10-01 07:00:00', { durationSec: 3100, avgHR: 152, hrZoneSec: [0, 1500, 1600, 0, 0] }),
    run('b', '2026-10-05 07:00:00', { durationSec: 3000, avgHR: 148, hrZoneSec: [0, 1500, 1500, 0, 0] }),
    run('ride', '2026-10-06 07:00:00', { sport: 'cycling' }),
    run('x', '2026-10-10 07:00:00', { durationSec: 2900, avgHR: 156, hrZoneSec: [0, 600, 1800, 500, 0] }),
    run('later', '2026-10-12 07:00:00'),
  ];

  test('compares with earlier same-sport sessions only', () => {
    const input = buildInsightInput({
      activity: history[3], analysis: analysis([292, 291, 290, 287, 285, 290, 290, 290, 290, 285]),
      history, hrMax: 190, prs: [{ distM: 5000, timeSec: 1440, rank: 1 }],
      recovery: { hrvLastNight: 40, hrvBaseline: 50, sleepHours: 6.5 }, language: 'es',
    });
    // previous runs a, b: 6100 s over 20 km → 305 s/km; this one 290 → −15
    expect(input.comparedToLast).toMatchObject({ sessions: 2, avgPaceSecPerKm: 305, paceDiffSecPerKm: -15, avgHR: 150, hrDiff: 6 });
    // efforts: a = 25+53.3 → 78? (1500/60·2 + 1600/60·3 = 50 + 80 = 130), b = 50 + 75 = 125 → avg 127.5; x = 20 + 90 + 33.3 = 143
    expect(input.comparedToLast?.avgEffort).toBe(128);
    expect(input.activity.effort).toBe(143);
    expect(input.personalRecords).toEqual([{ distance: '5 km', time: 1440, rank: 1 }]);
    expect(input.recoveryThatMorning?.hrvDeltaPct).toBe(-20);
    expect(input.hrZonesPct).toEqual([0, 20, 60, 20, 0]);
    expect(input.activity.weekday).toBe('Saturday');
  });

  test('no comparison block for a first session of its sport', () => {
    const input = buildInsightInput({ activity: history[2], analysis: null, history, hrMax: 190, prs: [], recovery: null, language: 'en' });
    expect(input.comparedToLast).toBeNull();
    expect(input.pacing).toBeNull();
  });
});

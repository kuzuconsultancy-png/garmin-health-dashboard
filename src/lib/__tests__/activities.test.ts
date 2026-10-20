import { historyStart, parseActivitySummary, parseActivityDetails, ACTIVITY_ID } from '../activities';
import { generateDemoHistory, generateDemoStreams } from '../training/demo';
import { analyzeActivity } from '../training/analysis';

describe('historyStart', () => {
  test('Jan 1 last year when that is earlier than 400 days back', () => {
    expect(historyStart('2026-10-16')).toBe('2025-01-01');
  });
  test('400 days back early in the year', () => {
    expect(historyStart('2026-01-10')).toBe('2024-12-06');
  });
});

describe('ACTIVITY_ID', () => {
  test('accepts Garmin and demo ids, rejects path tricks', () => {
    expect(ACTIVITY_ID.test('17234567890')).toBe(true);
    expect(ACTIVITY_ID.test('demo-2026-10-14-0')).toBe(true);
    expect(ACTIVITY_ID.test('123/../../user')).toBe(false);
    expect(ACTIVITY_ID.test('')).toBe(false);
  });
});

describe('parseActivitySummary', () => {
  test('maps Garmin list fields, including time in zones and training load', () => {
    const a = parseActivitySummary({
      activityId: 17234567890, activityName: 'Morning Run', startTimeLocal: '2026-10-14 07:02:11',
      activityType: { typeKey: 'trail_running' }, duration: 3011.7, distance: 9876.4, elevationGain: 143.2,
      averageHR: 151.4, maxHR: 176, averageSpeed: 3.28, calories: 702, activityTrainingLoad: 118.6,
      aerobicTrainingEffect: 3.46, anaerobicTrainingEffect: 1.02, vO2MaxValue: 51,
      hrTimeInZone_1: 120.5, hrTimeInZone_2: 900, hrTimeInZone_3: 1500, hrTimeInZone_4: 480, hrTimeInZone_5: 0,
    })!;
    expect(a).toEqual({
      id: '17234567890', name: 'Morning Run', date: '2026-10-14', startTimeLocal: '2026-10-14 07:02:11',
      sport: 'running', sportKey: 'trail_running', durationSec: 3012, distanceM: 9876, elevationGainM: 143,
      avgHR: 151, maxHR: 176, avgSpeed: 3.28, calories: 702, trainingLoad: 119, aerobicTE: 3.5, anaerobicTE: 1,
      vo2max: 51, hrZoneSec: [121, 900, 1500, 480, 0],
    });
  });
  test('omits optional fields Garmin did not send; rejects entries without id/date', () => {
    const a = parseActivitySummary({ activityId: 1, startTimeLocal: '2026-10-14 18:00:00', activityType: { typeKey: 'strength_training' }, duration: 2400 })!;
    expect(a.sport).toBe('strength');
    expect(a).not.toHaveProperty('hrZoneSec');
    expect(a).not.toHaveProperty('trainingLoad');
    expect(parseActivitySummary({ startTimeLocal: '2026-10-14' })).toBeNull();
    expect(parseActivitySummary({ activityId: 2 })).toBeNull();
  });
});

describe('parseActivityDetails', () => {
  const desc = [
    { metricsIndex: 0, key: 'directTimestamp' },
    { metricsIndex: 1, key: 'sumDistance' },
    { metricsIndex: 2, key: 'directHeartRate' },
    { metricsIndex: 3, key: 'directSpeed' },
    { metricsIndex: 4, key: 'directElevation' },
    { metricsIndex: 5, key: 'sumDuration' },
  ];
  test('builds aligned arrays, carries nulls forward, drops rows going backwards', () => {
    const s = parseActivityDetails({
      metricDescriptors: desc,
      activityDetailMetrics: [
        { metrics: [1_700_000_000_000, 0, 120, 2.9, null, 0] },
        { metrics: [1_700_000_001_000, 3, 121, null, 10.2, 1] },
        { metrics: [1_700_000_002_000, 6, null, 3.1, 10.4, 2] },
        { metrics: [1_700_000_003_000, 5, 125, 3.0, 10.5, 3] },   // distance went back → dropped
        { metrics: [1_700_000_004_000, 12, 126, 3.0, 10.6, 4] },
      ],
    })!;
    expect(s.t).toEqual([0, 1, 2, 4]);
    expect(s.dist).toEqual([0, 3, 6, 12]);
    expect(s.hr).toEqual([120, 121, 0, 126]);
    expect(s.speed).toEqual([2.9, 2.9, 3.1, 3.0]);
    expect(s.ele).toEqual([10.2, 10.2, 10.4, 10.6]); // leading gap back-filled
  });
  test('falls back to timestamps when there is no sumDuration; null when nothing usable', () => {
    const s = parseActivityDetails({
      metricDescriptors: [{ metricsIndex: 0, key: 'directTimestamp' }, { metricsIndex: 1, key: 'sumDistance' }],
      activityDetailMetrics: [{ metrics: [5000, 0] }, { metrics: [7000, 8] }],
    })!;
    expect(s.t).toEqual([0, 2]);
    expect(s.speed).toEqual([0, 4]); // derived
    expect(s).not.toHaveProperty('hr');
    expect(parseActivityDetails({ metricDescriptors: [], activityDetailMetrics: [] })).toBeNull();
  });
});

describe('demo data', () => {
  const history = generateDemoHistory('2025-01-01', '2026-10-16');

  test('deterministic, ~2 years of mixed sports with races', () => {
    expect(generateDemoHistory('2025-01-01', '2026-10-16')).toEqual(history);
    expect(history.length).toBeGreaterThan(300);
    expect(new Set(history.map(a => a.sport))).toEqual(new Set(['running', 'cycling', 'strength']));
    expect(history.filter(a => a.name === '10K race').every(a => a.distanceM === 10000)).toBe(true);
    expect(history.some(a => a.date >= '2025-07-20' && a.date <= '2025-08-03')).toBe(false); // summer break
  });

  test('streams match the summary and analyse cleanly', () => {
    const run = history.filter(a => a.name === 'Intervals').at(-1)!;
    const s = generateDemoStreams(run);
    expect(s.dist.at(-1)).toBeCloseTo(run.distanceM, 0);
    expect(s.t.at(-1)).toBeLessThanOrEqual(run.durationSec);
    const an = analyzeActivity(s, { isRun: true, hrMax: 190, vdot: 50 });
    expect(an.splits.length).toBe(Math.floor(run.distanceM / 1000) + (run.distanceM % 1000 >= 100 ? 1 : 0));
    expect(an.bestEfforts.find(e => e.distM === 1000)!.timeSec).toBeLessThan(run.durationSec / (run.distanceM / 1000));
    expect(an.hrZoneSec!.reduce((x, y) => x + y, 0)).toBeGreaterThan(0);
    expect(an.paceZoneSec!.reduce((x, y) => x + y, 0)).toBeGreaterThan(0);
  });
});

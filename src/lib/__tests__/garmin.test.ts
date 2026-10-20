/**
 * Exercises the real-data path of fetchDailyMetrics with a fake Garmin client:
 * the weekly trend must come from per-day Garmin data, never from mockData.
 */
import { mockData } from '../mockData';

type Day = { hrv: number; rhr: number; sleepH: number; sleepScore: number };

// 2026-10-12 is deliberately missing (watch not worn).
const DAYS: Record<string, Day> = {
  '2026-10-10': { hrv: 41, rhr: 55, sleepH: 7.1, sleepScore: 71 },
  '2026-10-11': { hrv: 43, rhr: 54, sleepH: 6.4, sleepScore: 64 },
  '2026-10-13': { hrv: 39, rhr: 57, sleepH: 5.9, sleepScore: 52 },
  '2026-10-14': { hrv: 44, rhr: 53, sleepH: 7.7, sleepScore: 80 },
  '2026-10-15': { hrv: 46, rhr: 52, sleepH: 8.2, sleepScore: 86 },
  '2026-10-16': { hrv: 47, rhr: 51, sleepH: 7.4, sleepScore: 77 },
};

const dateOf = (d: unknown) => (d as Date).toISOString().slice(0, 10);
const dateInUrl = (url: string) => url.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? '';

jest.mock('garmin-connect', () => ({
  GarminConnect: class {
    loadToken() { /* noop */ }
    async getUserProfile() { return { displayName: 'tester' }; }
    async getSleepData(d: unknown) {
      const day = DAYS[dateOf(d)];
      if (!day) throw new Error('no data');
      return {
        dailySleepDTO: {
          sleepTimeSeconds: day.sleepH * 3600,
          sleepScores: { overall: { value: day.sleepScore } },
          averageHrvValue: day.hrv,
        },
      };
    }
    async getHeartRate(d: unknown) {
      const day = DAYS[dateOf(d)];
      if (!day) throw new Error('no data');
      return { restingHeartRate: day.rhr };
    }
    async get(url: string) {
      const day = DAYS[dateInUrl(url)];
      if (url.includes('/hrv-service/')) return day ? { hrvSummary: { lastNight: day.hrv } } : '';
      if (url.includes('/usersummary-service/')) return day ? { totalSteps: 8000, totalKilocalories: 2300 } : null;
      if (url.includes('/bodyBattery/')) return [];
      if (url.includes('/dailyStress/')) return { stressValuesArray: [] };
      return null;
    }
    async getActivities() { return []; }
    async getSteps() { return 8000; }
  },
}));

describe('fetchDailyMetrics — real weekly history', () => {
  const OLD_ENV = process.env;

  beforeAll(() => {
    process.env = {
      ...OLD_ENV,
      GARMIN_USERNAME: 'u@example.com',
      GARMIN_PASSWORD: 'x',
      GARMIN_OAUTH1: '{}',
      GARMIN_OAUTH2: '{}',
    };
  });
  afterAll(() => { process.env = OLD_ENV; });

  test('weekly arrays hold the 6 previous real days + today, 0 for the missing day', async () => {
    const { fetchDailyMetrics } = await import('../garmin');
    const m = await fetchDailyMetrics('2026-10-16');

    expect(m.isDemo).toBe(false);
    expect(m.weeklyTrend.hrv).toEqual([41, 43, 0, 39, 44, 46, 47]);
    expect(m.weeklyTrend.rhr).toEqual([55, 54, 0, 57, 53, 52, 51]);
    expect(m.weeklyTrend.sleepHours).toEqual([7.1, 6.4, 0, 5.9, 7.7, 8.2, 7.4]);
    expect(m.weeklyTrend.sleep).toEqual([71, 64, 0, 52, 80, 86, 77]);
    expect(m.weeklyTrend.recovery[2]).toBe(0);
    expect(m.weeklyTrend.recovery.filter(v => v > 0)).toHaveLength(6);

    // Nothing borrowed from the demo dataset
    expect(m.weeklyTrend.recovery.slice(0, 6)).not.toEqual(mockData.weeklyTrend.recovery.slice(0, 6));
    expect(m.weeklyTrend.sleepHours.slice(0, 6)).not.toEqual(mockData.weeklyTrend.sleepHours.slice(0, 6));
  });

  test('without a Garmin weekly HRV average, the weekly value is the real 7-night mean', async () => {
    const { fetchDailyMetrics } = await import('../garmin');
    const m = await fetchDailyMetrics('2026-10-16');
    // mean(41, 43, 39, 44, 46, 47) = 260 / 6 = 43.33 → 43
    expect(m.hrv.weeklyAverage).toBe(43);
    expect(m.hrv.lastNight).toBe(47);
  });
});

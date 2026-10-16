import { format, parseISO, subDays } from 'date-fns';
import type {
  DailyMetrics, SleepData, HRVData, BodyBatteryData,
  StressData, ActivityData, WeeklyTrend, TrendPoint, RecentActivity,
} from './types';
import {
  calculateSleepScore, calculateRecoveryScore, getRecoveryCategory,
  calculateStrainScore, calculateDailyStrain, getHRVStatus,
} from './scoring';
import { mockData } from './mockData';

// ─── In-memory cache ──────────────────────────────────────────────────────────
interface CacheEntry { data: DailyMetrics; ts: number }
const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 15 * 60 * 1000; // 15 min

// ─── Singleton Garmin client ──────────────────────────────────────────────────
let garminClient: unknown = null;
let clientTs = 0;
const CLIENT_TTL = 55 * 60 * 1000; // 55 min

async function getClient(): Promise<unknown> {
  // Reuse warm singleton
  if (garminClient && Date.now() - clientTs < CLIENT_TTL) return garminClient;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { GarminConnect } = require('garmin-connect');

  const hasCredentials = !!(process.env.GARMIN_USERNAME && process.env.GARMIN_PASSWORD);
  if (!hasCredentials) return null;

  const client = new GarminConnect({
    username: process.env.GARMIN_USERNAME,
    password: process.env.GARMIN_PASSWORD,
  });

  // ── Strategy 1: restore from pre-fetched OAuth tokens (no login needed) ──
  const rawOauth1 = process.env.GARMIN_OAUTH1;
  const rawOauth2 = process.env.GARMIN_OAUTH2;

  if (rawOauth1 && rawOauth2) {
    try {
      const oauth1 = JSON.parse(rawOauth1);
      const oauth2 = JSON.parse(rawOauth2);
      client.loadToken(oauth1, oauth2);
      garminClient = client;
      clientTs = Date.now();
      console.log('[Garmin] session restored from OAuth tokens');
      return client;
    } catch (e) {
      console.warn('[Garmin] token restore failed, falling back to login:', e);
    }
  }

  // ── Strategy 2: full login (triggers MFA/rate-limit risk) ──────────────
  try {
    await client.login();
    garminClient = client;
    clientTs = Date.now();
    console.log('[Garmin] login successful');
    return client;
  } catch (err) {
    console.error('[Garmin] login failed:', err);
    garminClient = null;
    return null;
  }
}

// ─── Parsers ──────────────────────────────────────────────────────────────────
function parseSleep(raw: Record<string, unknown>): SleepData {
  const dto = (raw?.dailySleepDTO ?? raw ?? {}) as Record<string, unknown>;
  const total = (dto.sleepTimeSeconds ?? dto.totalSleepSeconds ?? 0) as number;
  return {
    totalSleepSeconds: total,
    deepSleepSeconds: (dto.deepSleepSeconds ?? 0) as number,
    remSleepSeconds: (dto.remSleepSeconds ?? 0) as number,
    lightSleepSeconds: (dto.lightSleepSeconds ?? 0) as number,
    awakeSleepSeconds: (dto.awakeSleepSeconds ?? 0) as number,
    sleepScore: ((dto.sleepScores as Record<string, unknown> | undefined)?.overall as Record<string, unknown> | undefined)?.value as number ?? (dto.sleepScore as number) ?? 0,
    averageSpO2: (dto.averageSpO2Value ?? dto.averageSpO2 ?? 0) as number,
    averageHRV: (dto.averageHrvValue ?? dto.averageHRV ?? 0) as number,
    averageRespiration: (dto.averageRespirationValue ?? dto.averageRespiration ?? 0) as number,
    startTime: (dto.sleepStartTimestampLocal ?? dto.startTime ?? '') as string,
    endTime: (dto.sleepEndTimestampLocal ?? dto.endTime ?? '') as string,
  };
}

function parseHRV(raw: Record<string, unknown>, trend: number[], sleepHRVFallback = 0): HRVData {
  const s = (raw?.hrvSummary ?? raw ?? {}) as Record<string, unknown>;
  const weekly = (s.weeklyAvg ?? s.weeklyAverage ?? 0) as number;
  // Some devices only expose HRV via the sleep endpoint — use it when the dedicated endpoint has no data
  const last = ((s.lastNight ?? s.lastNightAvg ?? 0) as number) || sleepHRVFallback;
  const weeklyFinal = weekly || (sleepHRVFallback > 0 ? sleepHRVFallback : 0);
  return {
    weeklyAverage: weeklyFinal,
    lastNight: last,
    status: getHRVStatus(last, weeklyFinal),
    trend,
  };
}

function parseBodyBattery(raw: unknown[], summary?: Record<string, unknown> | null): BodyBatteryData {
  // Fallback: extract Body Battery aggregates from the daily usersummary
  if (!Array.isArray(raw) || raw.length === 0) {
    const current = (summary?.bodyBatteryMostRecentValue ?? 0) as number;
    const high = (summary?.bodyBatteryHighestValue ?? summary?.bodyBatteryAtWakeTime ?? 0) as number;
    const low = (summary?.bodyBatteryLowestValue ?? 0) as number;
    if (current > 0 || high > 0) {
      // Summary has BB data — show aggregates (no intraday chart)
      // "drained" = units consumed from today's peak (charged - current)
      const consumed = high > current ? high - current : 0;
      return { isAvailable: true, current, charged: high, drained: consumed, data: [] };
    }
    return { isAvailable: false, current: 0, charged: 0, drained: 0, data: [] };
  }
  const readings = raw.map((r: unknown) => {
    const rec = r as Record<string, unknown>;
    const ts = (rec.startTimestampLocal ?? rec.startTimestampGMT) as number;
    return {
      time: new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false }),
      value: (rec.dynamicFeedbackScore ?? rec.bodyBatteryScore ?? 50) as number,
    };
  });
  const latest = raw[raw.length - 1] as Record<string, unknown>;
  const currentVal = (latest?.dynamicFeedbackScore ?? latest?.bodyBatteryScore ?? 50) as number;
  const chargedVal = Math.max(...readings.map(r => r.value));
  return {
    isAvailable: true,
    current: currentVal,
    charged: chargedVal,
    drained: Math.max(0, chargedVal - currentVal),
    data: readings,
  };
}

function parseStress(raw: Record<string, unknown>): StressData {
  const arr = (raw?.stressValuesArray ?? []) as [number, number][];
  const valid = arr.filter(([, v]) => v >= 0).map(([ts, v]) => ({
    time: new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false }),
    value: v,
  }));
  const avg = valid.length ? valid.reduce((s, v) => s + v.value, 0) / valid.length : 30;
  const highCount = valid.filter(v => v.value > 50).length;
  const restingCount = arr.filter(([, v]) => v === -1).length;
  return {
    average: Math.round(avg),
    data: valid,
    highStressPercentage: valid.length ? Math.round((highCount / valid.length) * 100) : 0,
    restingPercentage: arr.length ? Math.round((restingCount / arr.length) * 100) : 0,
  };
}

function parseActivities(raw: unknown[]): ActivityData[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 5).map((a: unknown) => {
    const act = a as Record<string, unknown>;
    const avgHR = (act.averageHR ?? act.averageHeartRateInBeatsPerMinute ?? 0) as number;
    const maxHR = (act.maxHR ?? act.maxHeartRateInBeatsPerMinute ?? 0) as number;
    const dur = (act.duration ?? act.movingDuration ?? 0) as number;
    const type = act.activityType as Record<string, unknown> | undefined;
    return {
      name: (act.activityName ?? act.name ?? 'Activity') as string,
      duration: dur,
      calories: (act.calories ?? 0) as number,
      strain: 0,
      averageHR: avgHR,
      maxHR,
      type: (type?.typeKey ?? type?.key ?? 'other') as string,
    };
  });
}

// ─── Main fetch ───────────────────────────────────────────────────────────────
export async function fetchDailyMetrics(dateStr?: string): Promise<DailyMetrics> {
  const date = dateStr ?? format(new Date(), 'yyyy-MM-dd');

  const cached = cache.get(date);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const hasCredentials = !!(process.env.GARMIN_USERNAME && process.env.GARMIN_PASSWORD)
    || !!(process.env.GARMIN_OAUTH1 && process.env.GARMIN_OAUTH2);

  const client = await getClient();
  if (!client) {
    return {
      ...mockData,
      date,
      isDemo: true,
      demoReason: hasCredentials ? 'login_failed' : 'no_credentials',
    };
  }

  try {
    const gc = client as Record<string, (...args: unknown[]) => Promise<unknown>>;
    const today = new Date(date);
    const GC_API = 'https://connectapi.garmin.com';

    // Get displayName first — needed for the usersummary endpoint
    let displayName = '';
    try {
      const profile = await gc.getUserProfile() as Record<string, unknown>;
      displayName = (profile.displayName ?? '') as string;
    } catch { /* ignore — usersummary will just fail silently */ }

    // Previous 6 days for the weekly trend — real per-day data (4h cache), fetched
    // alongside today's calls. A day that fails stays 0 (= missing), never mock.
    const priorDates = Array.from({ length: 6 }, (_, i) => format(subDays(parseISO(date), 6 - i), 'yyyy-MM-dd'));
    const priorPromise = Promise.allSettled(
      priorDates.map(d => fetchDayTrend(gc as GCClient, GC_API, d, displayName || undefined)),
    );

    // Parallel fetch — silence individual failures with allSettled
    // Note: getSleepData/getHeartRate expect Date objects; HRV/battery/stress
    // are not in garmin-connect@1.6.2 so we call the raw endpoints via gc.get()
    const [sleepRes, hrvRes, hrRes, bbRes, bbAltRes, stressRes, actsRes, stepsRes, summaryRes] = await Promise.allSettled([
      gc.getSleepData(today),
      gc.get(`${GC_API}/hrv-service/hrv/${date}`),
      gc.getHeartRate(today),
      gc.get(`${GC_API}/wellness-service/wellness/bodyBattery/event/${date}/${date}`),
      // Alternative BB URL format (query params) — some devices use this
      gc.get(`${GC_API}/wellness-service/wellness/bodyBattery/event?startDate=${date}&endDate=${date}`),
      gc.get(`${GC_API}/wellness-service/wellness/dailyStress/${date}`),
      gc.getActivities(0, 5),
      gc.getSteps(today),
      // Daily summary — reliable fallback for BB aggregates
      displayName
        ? gc.get(`${GC_API}/usersummary-service/usersummary/daily/${displayName}?calendarDate=${date}`)
        : Promise.resolve(null),
    ]);

    const prior = (await priorPromise).map(r => (r.status === 'fulfilled' ? r.value : EMPTY_DAY));

    // Guard: HRV API returns "" (empty string) when device hasn't synced yet — treat as {}
    const todayHrvRaw = (
      hrvRes.status === 'fulfilled' &&
      typeof hrvRes.value === 'object' &&
      hrvRes.value !== null
        ? hrvRes.value
        : {}
    ) as Record<string, unknown>;
    const todayHrvSummary = (todayHrvRaw?.hrvSummary ?? todayHrvRaw) as Record<string, unknown>;
    const garminWeeklyAvg = (todayHrvSummary?.weeklyAvg ?? todayHrvSummary?.weeklyAverage ?? 0) as number;

    const sleep = parseSleep(sleepRes.status === 'fulfilled' ? sleepRes.value as Record<string, unknown> : {});
    // Prefer Garmin's native sleep score (parseSleep extracts sleepScores.overall.value).
    // Fall back to our custom duration+quality algo only when Garmin returns 0.
    const sleepScore = sleep.sleepScore > 0 ? sleep.sleepScore : calculateSleepScore(sleep);
    sleep.sleepScore = sleepScore;

    const hrv = parseHRV(todayHrvRaw, [], sleep.averageHRV);
    hrv.trend = [...prior.map(p => p.hrv), hrv.lastNight];
    // No Garmin weekly average (device only reports HRV via sleep) → use the real
    // 7-night mean instead of echoing last night as the "weekly" value.
    const realHRV = hrv.trend.filter(v => v > 0);
    if (!garminWeeklyAvg && realHRV.length >= 3) {
      hrv.weeklyAverage = Math.round(realHRV.reduce((s, v) => s + v, 0) / realHRV.length);
      hrv.status = getHRVStatus(hrv.lastNight, hrv.weeklyAverage);
    }

    // Daily summary — parse first so it can be used as fallback for BB and HR
    const summaryData = summaryRes.status === 'fulfilled'
      ? summaryRes.value as Record<string, unknown> | null
      : null;

    const hrData = (hrRes.status === 'fulfilled' ? hrRes.value : {}) as Record<string, unknown>;
    const summaryRestingHR = (summaryData?.restingHeartRateValue ?? summaryData?.restingHeartRate ?? 0) as number;
    const restingHR = ((hrData?.restingHeartRate ?? (hrData?.statisticsDTO as Record<string, unknown> | undefined)?.restingHeartRate ?? 0) as number) || summaryRestingHR;

    // Body Battery: try primary endpoint, then alt URL, then extract aggregates from usersummary
    const bbRaw =
      (bbRes.status === 'fulfilled' && Array.isArray(bbRes.value) && (bbRes.value as unknown[]).length > 0)
        ? bbRes.value as unknown[]
        : (bbAltRes.status === 'fulfilled' && Array.isArray(bbAltRes.value) && (bbAltRes.value as unknown[]).length > 0)
          ? bbAltRes.value as unknown[]
          : [];
    const bodyBattery = parseBodyBattery(bbRaw, summaryData);

    const stress = parseStress(
      stressRes.status === 'fulfilled' ? stressRes.value as Record<string, unknown> : {},
    );

    const allActivities = actsRes.status === 'fulfilled' ? actsRes.value as unknown[] ?? [] : [];
    const todayActivities = allActivities.filter((a: unknown) => {
      const act = a as Record<string, unknown>;
      const ts = (act.startTimeLocal ?? act.startTimeGMT ?? act.activityDate ?? '') as string;
      return String(ts).startsWith(date);
    });
    const activities = parseActivities(todayActivities)
      .map(a => ({ ...a, strain: calculateStrainScore([a], restingHR || 60) }));

    const steps = stepsRes.status === 'fulfilled' ? (stepsRes.value as number) ?? 0 : 0;
    // Total daily calories from summary (includes BMR + NEAT + exercise)
    const totalCals = (
      (summaryData?.totalKilocalories ?? summaryData?.activeKilocalories ?? 0) as number
    ) || activities.reduce((s, a) => s + a.calories, 0);

    // Enriched background activity data from usersummary
    const floorsAscended     = (summaryData?.floorsAscended     ?? 0) as number;
    const highlyActiveSeconds = (summaryData?.highlyActiveSeconds ?? 0) as number;
    const activeSeconds       = (summaryData?.activeSeconds       ?? 0) as number;

    const dailyStrain = calculateDailyStrain(activities, steps, totalCals, {
      highlyActiveSeconds,
      activeSeconds,
      floorsAscended,
      stressAverage:       stress.average,
      bodyBatteryDrained:  bodyBattery.drained,  // HRV-derived physiological load
    });

    // Baselines from real history: Garmin's own weekly HRV average when present,
    // otherwise the mean of the previous nights; RHR baseline = previous days' mean.
    const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
    const priorHRV = prior.map(p => p.hrv).filter(v => v > 0);
    const priorRHR = prior.map(p => p.rhr).filter(v => v > 0);
    const baselineHRV = garminWeeklyAvg || (priorHRV.length ? mean(priorHRV) : 0) || hrv.lastNight || 50;
    const baselineRHR = priorRHR.length ? mean(priorRHR) : (restingHR || 60);
    const recoveryScore = calculateRecoveryScore({
      lastNightHRV: hrv.lastNight || baselineHRV,
      baselineHRV,
      restingHR: restingHR || baselineRHR,
      baselineRHR,
      sleepScore,
    });

    // Weekly trend: 6 real previous days + today. Missing days are 0.
    const todaySleepHours = Math.round((sleep.totalSleepSeconds / 3600) * 10) / 10;
    const priorRecovery = computeRecoverySeries(prior);
    const weeklyTrend: WeeklyTrend = {
      dates: Array.from({ length: 7 }, (_, i) => format(subDays(parseISO(date), 6 - i), 'EEE')),
      recovery: [...priorRecovery, recoveryScore],
      hrv: hrv.trend,
      sleep: [...prior.map(p => p.sleepScore), sleepScore],
      sleepHours: [...prior.map(p => p.sleepHours), todaySleepHours],
      rhr: [...prior.map(p => p.rhr), restingHR],
      strain: [...prior.map(p => p.strain), dailyStrain],
    };

    const metrics: DailyMetrics = {
      date,
      isDemo: false,
      recovery: {
        score: recoveryScore,
        category: getRecoveryCategory(recoveryScore),
        hrv: hrv.lastNight,
        restingHR,
        sleepScore,
      },
      sleep,
      hrv,
      bodyBattery,
      stress,
      activities,
      steps,
      calories: totalCals,
      floorsAscended,
      highlyActiveSeconds,
      activeSeconds,
      strain: dailyStrain,
      weeklyTrend,
    };

    cache.set(date, { data: metrics, ts: Date.now() });
    return metrics;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Garmin] fetch failed:', msg);
    return { ...mockData, date, isDemo: true, demoReason: 'fetch_error' };
  }
}

// ─── Historical trend fetching (for 30/90d charts) ────────────────────────────

interface DayTrend { hrv: number; sleepHours: number; sleepScore: number; rhr: number; strain: number }
interface DayTrendEntry extends DayTrend { ts: number }
const EMPTY_DAY: DayTrend = { hrv: 0, sleepHours: 0, sleepScore: 0, rhr: 0, strain: 0 };
const dayTrendCache = new Map<string, DayTrendEntry>();
const DAY_TREND_TTL = 4 * 60 * 60 * 1000; // 4h — historical data is immutable

interface TrendsCacheEntry { data: TrendPoint[]; ts: number }
const trendsCache = new Map<string, TrendsCacheEntry>();
const TRENDS_CACHE_TTL = 60 * 60 * 1000; // 1h

type GCClient = Record<string, (...args: unknown[]) => Promise<unknown>>;

async function fetchDayTrend(gc: GCClient, GC_API: string, date: string, displayName?: string): Promise<DayTrend> {
  // Check lightweight cache first
  const cached = dayTrendCache.get(date);
  if (cached && Date.now() - cached.ts < DAY_TREND_TTL) {
    const { ts: _ts, ...day } = cached;
    return day;
  }
  // Re-use full DailyMetrics cache if available
  const fullCached = cache.get(date);
  if (fullCached && Date.now() - fullCached.ts < CACHE_TTL) {
    const d = fullCached.data;
    return {
      hrv: d.hrv.lastNight,
      sleepHours: Math.round((d.sleep.totalSleepSeconds / 3600) * 10) / 10,
      sleepScore: d.sleep.sleepScore,
      rhr: d.recovery.restingHR,
      strain: d.strain,
    };
  }

  const today = new Date(date);
  const calls: Promise<unknown>[] = [
    gc.getSleepData(today),
    gc.get(`${GC_API}/hrv-service/hrv/${date}`),
    gc.getHeartRate(today),
  ];
  if (displayName) {
    calls.push(gc.get(`${GC_API}/usersummary-service/usersummary/daily/${displayName}?calendarDate=${date}`));
  }
  const [sleepRes, hrvRes, hrRes, summaryRes] = await Promise.allSettled(calls);

  const sleep = parseSleep((sleepRes.status === 'fulfilled' ? sleepRes.value : {}) as Record<string, unknown>);
  const sleepSeconds = sleep.totalSleepSeconds;
  const sleepHRV = Number(sleep.averageHRV);
  // Garmin's native score when present, else the duration+quality fallback (same rule as fetchDailyMetrics)
  const sleepScore = sleepSeconds > 0 ? (sleep.sleepScore > 0 ? sleep.sleepScore : calculateSleepScore(sleep)) : 0;

  const hrvRaw = (
    hrvRes.status === 'fulfilled' && typeof hrvRes.value === 'object' && hrvRes.value !== null
      ? hrvRes.value : {}
  ) as Record<string, unknown>;
  const hrvSummary = (hrvRaw?.hrvSummary ?? hrvRaw) as Record<string, unknown>;
  const hrvMs = Number(hrvSummary.lastNight ?? hrvSummary.lastNightAvg ?? 0) || sleepHRV;

  const hrRaw = (hrRes.status === 'fulfilled' ? hrRes.value : {}) as Record<string, unknown>;
  const rhr = Number(
    hrRaw?.restingHeartRate ??
    (hrRaw?.statisticsDTO as Record<string, unknown> | undefined)?.restingHeartRate ??
    0
  );

  // Estimate daily strain from usersummary aggregates (no per-activity data needed)
  let strain = 0;
  if (summaryRes && summaryRes.status === 'fulfilled' && summaryRes.value) {
    const s = summaryRes.value as Record<string, unknown>;
    const highlyActiveSeconds = Number(s.highlyActiveSeconds ?? 0);
    const activeSeconds = Number(s.activeSeconds ?? 0);
    const steps = Number(s.totalSteps ?? s.steps ?? 0);
    const totalCals = Number(s.totalKilocalories ?? s.activeKilocalories ?? 0);
    const floorsAscended = Number(s.floorsAscended ?? 0);
    strain = calculateDailyStrain([], steps, totalCals, { highlyActiveSeconds, activeSeconds, floorsAscended, stressAverage: 0 });
  }

  const result: DayTrend = { hrv: hrvMs, sleepHours: Math.round((sleepSeconds / 3600) * 10) / 10, sleepScore, rhr, strain };
  dayTrendCache.set(date, { ...result, ts: Date.now() });
  return result;
}

/**
 * Recovery per day, using the trailing 7-day window (incl. the day itself) as
 * HRV/RHR baseline. Days with no data at all score 0 (= missing), never a guess.
 */
function computeRecoverySeries(days: DayTrend[]): number[] {
  return days.map((pt, i) => {
    if (pt.hrv === 0 && pt.rhr === 0 && pt.sleepHours === 0) return 0;
    const window = days.slice(Math.max(0, i - 6), i + 1);
    const validHRV = window.filter(p => p.hrv > 0);
    const validRHR = window.filter(p => p.rhr > 0);
    const baseHRV = validHRV.length ? validHRV.reduce((s, p) => s + p.hrv, 0) / validHRV.length : 50;
    const baseRHR = validRHR.length ? validRHR.reduce((s, p) => s + p.rhr, 0) / validRHR.length : 62;
    const sleepScore = pt.sleepScore > 0 ? pt.sleepScore : Math.min(100, Math.round((pt.sleepHours / 8) * 100));
    return calculateRecoveryScore({
      lastNightHRV: pt.hrv || baseHRV,
      baselineHRV: baseHRV,
      restingHR: pt.rhr || baseRHR,
      baselineRHR: baseRHR,
      sleepScore,
    });
  });
}

// ── Demo/fallback trend generator ────────────────────────────────────────────
// Used when no Garmin credentials are configured. Produces a realistic 7-day
// training-cycle pattern so all pages work in demo mode.
function generateMockTrendPoints(range: number, endDateStr: string): TrendPoint[] {
  const endDate = new Date(endDateStr);
  // Strain by day-of-week (Sun=0…Sat=6): Sun=rest, Tue/Thu/Sat=hard, others=moderate
  const STRAIN_BY_DOW = [3.0, 8.5, 14.2, 9.5, 13.8, 8.0, 11.5];
  const HRV_OFFSET    = [+6,  0,   -5,   +2,  -4,   +1,  -2  ];
  const RHR_OFFSET    = [-2,  0,   +3,   0,   +3,   0,   +1  ];
  const SLEEP_OFFSET  = [+0.6, 0, -0.4, +0.2, -0.3, 0, +0.3];

  const HRV_BASE  = 50;
  const RHR_BASE  = 58;
  const SLEEP_BASE = 7.2;

  const dates = Array.from({ length: range }, (_, i) =>
    format(subDays(endDate, range - 1 - i), 'yyyy-MM-dd')
  );

  return dates.map((date, i) => {
    const dow = new Date(date).getDay();
    // Deterministic jitter using index
    const jitter = (Math.sin(i * 2.7 + 1.3) * 0.5); // -0.5..+0.5 range

    const strain      = Math.max(0, Math.min(21, STRAIN_BY_DOW[dow] + jitter * 3));
    const hrv         = Math.max(20, HRV_BASE   + HRV_OFFSET[dow]   + jitter * 6);
    const rhr         = Math.max(40, RHR_BASE   + RHR_OFFSET[dow]   + jitter * 3);
    const sleepHours  = Math.max(4,  SLEEP_BASE + SLEEP_OFFSET[dow]  + jitter * 0.5);

    // Compute recovery from hrv/rhr/sleep relative to a stable baseline
    const sleepScore  = Math.min(100, Math.round((sleepHours / 8) * 100));
    const recovery    = calculateRecoveryScore({
      lastNightHRV: hrv,
      baselineHRV:  HRV_BASE,
      restingHR:    rhr,
      baselineRHR:  RHR_BASE,
      sleepScore,
    });

    return {
      date,
      hrv:        Math.round(hrv * 10) / 10,
      sleepHours: Math.round(sleepHours * 10) / 10,
      rhr:        Math.round(rhr),
      recovery:   Math.round(recovery),
      strain:     Math.round(strain * 10) / 10,
    };
  });
}

export async function fetchTrendData(range: number, endDateStr: string): Promise<TrendPoint[]> {
  const cacheKey = `${endDateStr}-${range}`;
  const cached = trendsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < TRENDS_CACHE_TTL) return cached.data;

  const client = await getClient();
  if (!client) {
    const mock = generateMockTrendPoints(range, endDateStr);
    trendsCache.set(cacheKey, { data: mock, ts: Date.now() });
    return mock;
  }

  const gc = client as GCClient;
  const GC_API = 'https://connectapi.garmin.com';
  const endDate = new Date(endDateStr);

  const dates = Array.from({ length: range }, (_, i) =>
    format(subDays(endDate, range - 1 - i), 'yyyy-MM-dd')
  );

  // Fetch displayName once so fetchDayTrend can request usersummary for strain
  let displayName: string | undefined;
  try {
    const profile = await gc.getUserProfile() as Record<string, unknown>;
    displayName = (profile?.displayName ?? profile?.userName) as string | undefined;
  } catch { /* optional */ }

  // Batch in groups of 7 to avoid overwhelming Garmin's API
  const BATCH = 7;
  const rawPoints: DayTrend[] = [];

  for (let i = 0; i < dates.length; i += BATCH) {
    const batch = dates.slice(i, i + BATCH);
    const results = await Promise.allSettled(batch.map(d => fetchDayTrend(gc, GC_API, d, displayName)));
    for (const r of results) {
      rawPoints.push(r.status === 'fulfilled' ? r.value : EMPTY_DAY);
    }
    if (i + BATCH < dates.length) {
      await new Promise(res => setTimeout(res, 200));
    }
  }

  const recovery = computeRecoverySeries(rawPoints);
  const points: TrendPoint[] = dates.map((date, i) => {
    const pt = rawPoints[i];
    return { date, hrv: pt.hrv, sleepHours: pt.sleepHours, rhr: pt.rhr, recovery: recovery[i], strain: pt.strain };
  });

  trendsCache.set(cacheKey, { data: points, ts: Date.now() });
  return points;
}

// ─── Recent activities (for AI advice) ────────────────────────────────────────

interface RecentActivitiesCacheEntry { data: RecentActivity[]; ts: number }
const activitiesCache = new Map<number, RecentActivitiesCacheEntry>();
const ACTIVITIES_CACHE_TTL = 30 * 60 * 1000; // 30 min

function generateMockRecentActivities(days: number): RecentActivity[] {
  // Realistic 14-day training pattern: 3 runs, 2 bikes, 1 strength, mix of rest
  const today = new Date();
  const plan: Array<Omit<RecentActivity, 'date'> | null> = [
    { sportType: 'running',          durationMinutes: 42, distanceKm: 7.2,  averageHR: 152, maxHR: 174, trainingLoad: 85, calories: 450 },
    null, // rest
    { sportType: 'cycling',          durationMinutes: 70, distanceKm: 28.5, averageHR: 138, maxHR: 162, trainingLoad: 110, calories: 680 },
    { sportType: 'strength_training',durationMinutes: 50, distanceKm: 0,    averageHR: 118, maxHR: 148, trainingLoad: 45, calories: 320 },
    null,
    { sportType: 'running',          durationMinutes: 58, distanceKm: 10.0, averageHR: 158, maxHR: 181, trainingLoad: 135, calories: 620 },
    { sportType: 'running',          durationMinutes: 35, distanceKm: 5.8,  averageHR: 144, maxHR: 166, trainingLoad: 62, calories: 370 },
    null,
    { sportType: 'cycling',          durationMinutes: 90, distanceKm: 36.0, averageHR: 142, maxHR: 168, trainingLoad: 155, calories: 890 },
    { sportType: 'strength_training',durationMinutes: 45, distanceKm: 0,    averageHR: 115, maxHR: 142, trainingLoad: 40, calories: 280 },
    null,
    { sportType: 'running',          durationMinutes: 48, distanceKm: 8.1,  averageHR: 154, maxHR: 178, trainingLoad: 98, calories: 510 },
    null,
    { sportType: 'running',          durationMinutes: 75, distanceKm: 12.5, averageHR: 149, maxHR: 172, trainingLoad: 145, calories: 740 },
  ];
  const out: RecentActivity[] = [];
  for (let i = 0; i < days; i++) {
    const slot = plan[(days - 1 - i) % plan.length];
    if (slot) {
      out.push({ date: format(subDays(today, days - 1 - i), 'yyyy-MM-dd'), ...slot });
    }
  }
  return out;
}

export async function fetchRecentActivities(days = 14): Promise<{ activities: RecentActivity[]; isDemo: boolean }> {
  const cached = activitiesCache.get(days);
  if (cached && Date.now() - cached.ts < ACTIVITIES_CACHE_TTL) {
    return { activities: cached.data, isDemo: false };
  }

  const client = await getClient();
  if (!client) {
    return { activities: generateMockRecentActivities(days), isDemo: true };
  }

  try {
    const gc = client as Record<string, (...args: unknown[]) => Promise<unknown>>;
    // Pull a generous window — Garmin returns newest first; 50 entries covers 14 days for most athletes.
    const raw = await gc.getActivities(0, 50) as unknown[];
    if (!Array.isArray(raw)) {
      return { activities: generateMockRecentActivities(days), isDemo: true };
    }

    const cutoff = subDays(new Date(), days);
    cutoff.setHours(0, 0, 0, 0);

    const activities: RecentActivity[] = raw
      .map((a) => {
        const act = a as Record<string, unknown>;
        const startStr = (act.startTimeLocal ?? act.startTimeGMT ?? act.activityDate ?? '') as string;
        if (!startStr) return null;
        const start = new Date(startStr);
        if (isNaN(start.getTime()) || start < cutoff) return null;

        const durSec = (act.duration ?? act.movingDuration ?? 0) as number;
        const distM  = (act.distance ?? 0) as number;
        const type   = act.activityType as Record<string, unknown> | undefined;
        const aerobic   = (act.aerobicTrainingEffect ?? 0) as number;
        const anaerobic = (act.anaerobicTrainingEffect ?? 0) as number;
        const load = aerobic + anaerobic;

        return {
          date: format(start, 'yyyy-MM-dd'),
          sportType: (type?.typeKey ?? type?.key ?? 'other') as string,
          durationMinutes: Math.round(durSec / 60),
          distanceKm: Math.round((distM / 1000) * 10) / 10,
          averageHR: Math.round((act.averageHR ?? act.averageHeartRateInBeatsPerMinute ?? 0) as number),
          maxHR: Math.round((act.maxHR ?? act.maxHeartRateInBeatsPerMinute ?? 0) as number),
          trainingLoad: load > 0 ? Math.round(load * 10) / 10 : undefined,
          calories: Math.round((act.calories ?? 0) as number),
        } as RecentActivity;
      })
      .filter((a): a is RecentActivity => a !== null)
      .sort((a, b) => a.date.localeCompare(b.date));

    activitiesCache.set(days, { data: activities, ts: Date.now() });
    return { activities, isDemo: false };
  } catch (err) {
    console.error('[Garmin] fetchRecentActivities failed:', err);
    return { activities: generateMockRecentActivities(days), isDemo: true };
  }
}

import type { ActivityAnalysis, ActivityStreams, ChartPoint, HrRef, Split } from './types';
import { zoneOf } from './effort';
import { bestEfforts } from './bestEfforts';
import { paceZoneSpeeds } from './predictions';

// ── Grade-adjusted pace ─────────────────────────────────────────────────────
// Minetti et al. (2002) energy cost of running on a gradient i (fraction):
//   C(i) = 155.4i⁵ − 30.4i⁴ − 43.3i³ + 46.3i² + 19.5i + 3.6   [J/kg/m]
// Equivalent flat distance of a segment = distance × C(i) / C(0).
// Note: Minetti gives more downhill credit than Strava's HR-calibrated model,
// so steep descents read slower here than on Strava.

const MAX_GRADE = 0.45;     // Minetti's measured range
const GRADE_WINDOW_M = 40;  // grade measured over ≥ 40 m to damp elevation noise
const MIN_MOVING_SPEED = 0.5; // m/s; slower samples count as stopped

export function minettiCost(grade: number): number {
  const i = Math.max(-MAX_GRADE, Math.min(MAX_GRADE, grade));
  return 155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 + 46.3 * i ** 2 + 19.5 * i + 3.6;
}

/** Grade at each sample, measured across a ≥ GRADE_WINDOW_M window centred on it. */
export function gradeSeries(dist: number[], ele: number[]): number[] {
  const n = Math.min(dist.length, ele.length);
  const out = new Array<number>(n).fill(0);
  let lo = 0;
  let hi = 0;
  for (let k = 0; k < n; k++) {
    while (lo < k && dist[k] - dist[lo + 1] >= GRADE_WINDOW_M / 2) lo++;
    if (hi < k) hi = k;
    while (hi < n - 1 && dist[hi] - dist[k] < GRADE_WINDOW_M / 2) hi++;
    const dd = dist[hi] - dist[lo];
    out[k] = dd >= GRADE_WINDOW_M / 2 ? (ele[hi] - ele[lo]) / dd : 0;
  }
  return out;
}

const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

/** Kilometre splits with pace, GAP, HR and elevation. A final partial split is kept if ≥ 100 m. */
export function computeSplits(s: ActivityStreams, splitM = 1000): Split[] {
  const n = Math.min(s.t.length, s.dist.length);
  const grades = s.ele ? gradeSeries(s.dist, s.ele) : null;
  const c0 = minettiCost(0);
  const splits: Split[] = [];

  let startIdx = 0;
  let flatEq = 0;
  let movingTime = 0;
  let gain = 0;
  let loss = 0;
  let hrSum = 0;
  let hrTime = 0;

  const close = (endIdx: number) => {
    const distM = s.dist[endIdx] - s.dist[startIdx];
    const timeSec = s.t[endIdx] - s.t[startIdx];
    if (distM <= 0 || timeSec <= 0) return;
    splits.push({
      index: splits.length + 1,
      distM: Math.round(distM),
      timeSec: Math.round(timeSec),
      paceSecPerKm: Math.round((timeSec / distM) * 1000),
      gapSecPerKm: flatEq > 0 ? Math.round((movingTime / flatEq) * 1000) : Math.round((timeSec / distM) * 1000),
      avgHR: hrTime > 0 ? Math.round(hrSum / hrTime) : 0,
      elevGainM: Math.round(gain),
      elevLossM: Math.round(loss),
    });
  };

  for (let k = 1; k < n; k++) {
    const ds = s.dist[k] - s.dist[k - 1];
    const dt = s.t[k] - s.t[k - 1];
    if (dt > 0 && ds / dt >= MIN_MOVING_SPEED) {
      const cost = grades ? minettiCost(grades[k]) : c0;
      flatEq += ds * (cost / c0);
      movingTime += dt;
    }
    if (s.ele) {
      const de = s.ele[k] - s.ele[k - 1];
      if (de > 0) gain += de; else loss -= de;
    }
    if (s.hr && s.hr[k] > 0 && dt > 0) { hrSum += s.hr[k] * dt; hrTime += dt; }

    if (s.dist[k] - s.dist[startIdx] >= splitM) {
      close(k);
      startIdx = k;
      flatEq = 0; movingTime = 0; gain = 0; loss = 0; hrSum = 0; hrTime = 0;
    }
  }
  if (n > 1 && s.dist[n - 1] - s.dist[startIdx] >= 100) close(n - 1);
  return splits;
}

/** Whole-activity GAP from the splits (time-weighted). */
export function overallGap(splits: Split[]): number | null {
  const time = splits.reduce((s, x) => s + x.timeSec, 0);
  const flat = splits.reduce((s, x) => s + (x.gapSecPerKm > 0 ? (x.timeSec / x.gapSecPerKm) * 1000 : 0), 0);
  return flat > 0 ? Math.round((time / flat) * 1000) : null;
}

// ── Zones ───────────────────────────────────────────────────────────────────

/** Seconds in HR zones 1–5 (Garmin's zones, or default % of max HR). Time below zone 1 is dropped. */
export function hrZoneSeconds(t: number[], hr: number[], zones: HrRef): number[] {
  const out = [0, 0, 0, 0, 0];
  for (let k = 1; k < Math.min(t.length, hr.length); k++) {
    const dt = t[k] - t[k - 1];
    const z = hr[k] > 0 ? zoneOf(hr[k], zones) : 0;
    if (dt > 0 && dt < 30 && z > 0) out[z - 1] += dt;
  }
  return out.map(Math.round);
}

/** Seconds in Daniels pace zones (Easy, Marathon, Threshold, Interval, Repetition); stopped time dropped. */
export function paceZoneSeconds(t: number[], speed: number[], vdot: number): number[] {
  const lower = paceZoneSpeeds(vdot); // lower[0] = 0
  const out = [0, 0, 0, 0, 0];
  for (let k = 1; k < Math.min(t.length, speed.length); k++) {
    const dt = t[k] - t[k - 1];
    const v = speed[k];
    if (!(dt > 0 && dt < 30) || v < MIN_MOVING_SPEED) continue;
    let z = 0;
    lower.forEach((lo, i) => { if (v >= lo) z = i; });
    out[z] += dt;
  }
  return out.map(Math.round);
}

// ── Pacing ──────────────────────────────────────────────────────────────────

/**
 * Aerobic decoupling: (HR per unit speed, 2nd half) / (1st half) − 1, in %.
 * Above ~5 % on a steady run usually means fatigue, heat or dehydration.
 */
export function hrDrift(t: number[], hr: number[], speed: number[]): number | null {
  const n = Math.min(t.length, hr.length, speed.length);
  if (n < 120) return null;
  const mid = t[0] + (t[n - 1] - t[0]) / 2;
  const half = (first: boolean) => {
    const hrs: number[] = [];
    const vs: number[] = [];
    for (let k = 0; k < n; k++) {
      if ((t[k] < mid) !== first || hr[k] <= 0 || speed[k] < MIN_MOVING_SPEED) continue;
      hrs.push(hr[k]); vs.push(speed[k]);
    }
    return vs.length ? mean(hrs) / mean(vs) : 0;
  };
  const a = half(true);
  const b = half(false);
  return a > 0 && b > 0 ? Math.round(((b - a) / a) * 1000) / 10 : null;
}

/** ~`points` evenly spaced (by distance) samples for charts, pace/GAP smoothed over ~200 m. */
export function chartSeries(s: ActivityStreams, points = 200): ChartPoint[] {
  const n = Math.min(s.t.length, s.dist.length);
  if (n < 2) return [];
  const total = s.dist[n - 1];
  const step = total / points;
  const grades = s.ele ? gradeSeries(s.dist, s.ele) : null;
  const c0 = minettiCost(0);
  const out: ChartPoint[] = [];
  let k = 0;
  for (let p = 1; p <= points; p++) {
    const target = p * step;
    const from = k;
    while (k < n - 1 && s.dist[k] < target) k++;
    if (k === from) continue;
    // window of ~200 m ending at k for a stable pace value
    let w = k;
    while (w > 0 && s.dist[k] - s.dist[w - 1] <= 200) w--;
    const dd = s.dist[k] - s.dist[w];
    const dt = s.t[k] - s.t[w];
    let flat = 0;
    for (let i = w + 1; i <= k; i++) {
      const ds = s.dist[i] - s.dist[i - 1];
      flat += ds * ((grades ? minettiCost(grades[i]) : c0) / c0);
    }
    const pace = dd > 20 && dt > 0 ? Math.round((dt / dd) * 1000) : null;
    out.push({
      km: Math.round((s.dist[k] / 1000) * 100) / 100,
      pace: pace && pace < 1800 ? pace : null, // > 30 min/km = stopped
      gap: pace && pace < 1800 && flat > 0 ? Math.round((dt / flat) * 1000) : null,
      hr: s.hr && s.hr[k] > 0 ? s.hr[k] : null,
      ele: s.ele ? Math.round(s.ele[k]) : null,
    });
  }
  return out;
}

/** Everything the activity page shows, from one stream fetch. */
export function analyzeActivity(
  s: ActivityStreams,
  opts: { isRun: boolean; zones: HrRef; vdot: number | null; splitM?: number },
): ActivityAnalysis {
  const hasDist = s.dist.length > 1 && s.dist[s.dist.length - 1] > 100;
  const splits = hasDist ? computeSplits(s, opts.splitM ?? 1000) : [];
  const totalDist = hasDist ? s.dist[s.dist.length - 1] - s.dist[0] : 0;
  const totalTime = s.t.length > 1 ? s.t[s.t.length - 1] - s.t[0] : 0;
  return {
    splits,
    paceSecPerKm: totalDist > 0 ? Math.round((totalTime / totalDist) * 1000) : null,
    gapSecPerKm: opts.isRun ? overallGap(splits) : null,
    hrZoneSec: s.hr && s.hr.some(h => h > 0) ? hrZoneSeconds(s.t, s.hr, opts.zones) : null,
    paceZoneSec: opts.isRun && s.speed && opts.vdot ? paceZoneSeconds(s.t, s.speed, opts.vdot) : null,
    bestEfforts: opts.isRun && hasDist ? bestEfforts(s.t, s.dist) : [],
    hrDriftPct: s.hr && s.speed ? hrDrift(s.t, s.hr, s.speed) : null,
    chart: hasDist ? chartSeries(s) : [],
  };
}

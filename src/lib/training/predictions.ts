import type { BestEffort, StoredEffort } from './types';

export const RACES = [
  { key: '5k', distM: 5000 },
  { key: '10k', distM: 10000 },
  { key: 'half', distM: 21097.5 },
  { key: 'marathon', distM: 42195 },
] as const;

/** Riegel (1981): T2 = T1 × (D2 / D1)^1.06. */
export function riegel(timeSec: number, distM: number, targetM: number, exponent = 1.06): number {
  return timeSec * Math.pow(targetM / distM, exponent);
}

/**
 * Best Riegel prediction for `targetM` from efforts at least a quarter of the
 * target distance (short efforts flatter long-race predictions).
 */
export function predictRace<T extends BestEffort>(efforts: T[], targetM: number): { timeSec: number; from: T } | null {
  let best: { timeSec: number; from: T } | null = null;
  for (const e of efforts) {
    if (e.distM < targetM / 4 || e.timeSec <= 0) continue;
    const t = riegel(e.timeSec, e.distM, targetM);
    if (!best || t < best.timeSec) best = { timeSec: Math.round(t), from: e };
  }
  return best;
}

// ── Daniels & Gilbert VDOT (Daniels' Running Formula) ───────────────────────

/** VO2 cost (ml/kg/min) of running at v metres/minute. */
export function vo2AtVelocity(vMetersPerMin: number): number {
  return -4.6 + 0.182258 * vMetersPerMin + 0.000104 * vMetersPerMin ** 2;
}

/** Fraction of VO2max sustainable for a race lasting tMin minutes. */
export function fractionOfVo2max(tMin: number): number {
  return 0.8 + 0.1894393 * Math.exp(-0.012778 * tMin) + 0.2989558 * Math.exp(-0.1932605 * tMin);
}

export function vdotFromPerformance(distM: number, timeSec: number): number {
  const tMin = timeSec / 60;
  return vo2AtVelocity(distM / tMin) / fractionOfVo2max(tMin);
}

/** Inverse of vdotFromPerformance (bisection; VDOT falls as time rises). */
export function raceTimeFromVdot(vdot: number, distM: number): number {
  let lo = distM / 10;    // 10 m/s — faster than any human
  let hi = distM / 0.5;   // 0.5 m/s — slower than walking
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (vdotFromPerformance(distM, mid) > vdot) lo = mid; else hi = mid;
  }
  return Math.round((lo + hi) / 2);
}

/** Speed (m/s) at a given fraction of VO2max for this VDOT. */
export function speedAtFraction(vdot: number, fraction: number): number {
  const vo2 = vdot * fraction;
  const a = 0.000104, b = 0.182258, c = -(4.6 + vo2);
  const vPerMin = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  return vPerMin / 60;
}

/**
 * Pace-zone lower bounds as fractions of VO2max, after Daniels' training
 * intensities: Easy < 75 %, Marathon 75–84 %, Threshold 84–92 %, Interval
 * 92–102 %, Repetition > 102 %. Boundaries between his ranges are ours.
 */
export const PACE_ZONE_FRACTIONS = [0, 0.75, 0.84, 0.92, 1.02] as const;

export function paceZoneSpeeds(vdot: number): number[] {
  return PACE_ZONE_FRACTIONS.map(f => (f === 0 ? 0 : speedAtFraction(vdot, f)));
}

/** Current VDOT: best performance among efforts ≥ 3 km (shorter ones overstate it). */
export function currentVdot(efforts: StoredEffort[] | BestEffort[]): number | null {
  const v = efforts
    .filter(e => e.distM >= 3000 && e.timeSec > 0)
    .map(e => vdotFromPerformance(e.distM, e.timeSec));
  return v.length ? Math.round(Math.max(...v) * 10) / 10 : null;
}

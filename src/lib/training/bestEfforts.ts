import type { BestEffort, StoredEffort } from './types';

export const EFFORT_DISTANCES = [400, 1000, 1609.34, 5000, 10000, 21097.5, 42195] as const;

/**
 * Fastest time over each distance anywhere inside one activity. Two-pointer
 * sweep over the samples (O(n) per distance); the start point is interpolated
 * between samples so the window covers exactly `d` metres.
 */
export function bestEfforts(t: number[], dist: number[], distances: readonly number[] = EFFORT_DISTANCES): BestEffort[] {
  const n = Math.min(t.length, dist.length);
  const out: BestEffort[] = [];
  if (n < 2) return out;
  const total = dist[n - 1] - dist[0];

  for (const d of distances) {
    if (total < d) continue;
    let best = Infinity;
    let i = 0;
    for (let j = 1; j < n; j++) {
      // advance i while the window from i+1 still covers d metres
      while (i + 1 < j && dist[j] - dist[i + 1] >= d) i++;
      if (dist[j] - dist[i] < d) continue;
      const startDist = dist[j] - d;
      const span = dist[i + 1] - dist[i];
      const frac = span > 0 ? (startDist - dist[i]) / span : 0;
      const startTime = t[i] + (t[i + 1] - t[i]) * frac;
      const time = t[j] - startTime;
      if (time > 0 && time < best) best = time;
    }
    if (Number.isFinite(best)) out.push({ distM: d, timeSec: Math.round(best) });
  }
  return out;
}

/** Top-3 rank of an effort among all stored efforts at the same distance (1 = PR), or null. */
export function prRank(effort: StoredEffort, all: StoredEffort[]): 1 | 2 | 3 | null {
  const sameDist = all
    .filter(e => e.distM === effort.distM)
    .sort((a, b) => a.timeSec - b.timeSec || a.date.localeCompare(b.date));
  const idx = sameDist.findIndex(e => e.activityId === effort.activityId);
  return idx >= 0 && idx < 3 ? ((idx + 1) as 1 | 2 | 3) : null;
}

/** Fastest effort per distance, optionally only since a date. */
export function personalRecords(all: StoredEffort[], since?: string): Map<number, StoredEffort> {
  const best = new Map<number, StoredEffort>();
  for (const e of all) {
    if (since && e.date < since) continue;
    const cur = best.get(e.distM);
    if (!cur || e.timeSec < cur.timeSec) best.set(e.distM, e);
  }
  return best;
}

// Shared types for the training features (Fitness & Freshness, Training Log,
// Goals, Progress, Records, activity analysis). All dates are local YYYY-MM-DD.

export type Sport = 'running' | 'cycling' | 'swimming' | 'walking' | 'hiking' | 'strength' | 'other';

export const SPORTS: Sport[] = ['running', 'cycling', 'swimming', 'walking', 'hiking', 'strength', 'other'];

/** Heart-rate zones: Garmin's configured zone floors (bpm, Z1–Z5) and max HR. */
export interface HrZones {
  hrMax: number;
  floors: number[];
  source: 'garmin' | 'estimate';
}

/** A max HR (→ Garmin's default %-of-max zones) or explicit zones. */
export type HrRef = number | HrZones;

export interface ActivitySummary {
  id: string;
  name: string;
  date: string;              // YYYY-MM-DD
  startTimeLocal: string;    // 'YYYY-MM-DD HH:mm:ss'
  sport: Sport;
  sportKey: string;          // raw Garmin typeKey, e.g. 'trail_running'
  durationSec: number;       // timer time
  distanceM: number;
  elevationGainM: number;
  avgHR: number;             // 0 = no HR
  maxHR: number;
  avgSpeed: number;          // m/s
  calories: number;
  trainingLoad?: number;     // Garmin EPOC load
  aerobicTE?: number;
  anaerobicTE?: number;
  vo2max?: number;           // Garmin VO2max estimate (runs)
  hrZoneSec?: number[];      // Garmin time in HR zones 1–5, seconds
}

/** Per-sample activity data, aligned arrays. */
export interface ActivityStreams {
  t: number[];               // seconds since start (timer)
  dist: number[];            // cumulative meters
  hr?: number[];             // bpm, 0 = missing
  speed?: number[];          // m/s
  ele?: number[];            // meters
}

export interface Split {
  index: number;             // 1-based
  distM: number;             // usually 1000; last split may be shorter
  timeSec: number;
  paceSecPerKm: number;
  gapSecPerKm: number;
  avgHR: number;             // 0 = no HR
  elevGainM: number;
  elevLossM: number;
}

export interface BestEffort {
  distM: number;
  timeSec: number;
}

/** A best effort tagged with where it came from (for PR tables). */
export interface StoredEffort extends BestEffort {
  activityId: string;
  date: string;
}

export interface ChartPoint {
  km: number;
  pace: number | null;       // sec/km
  gap: number | null;        // sec/km
  hr: number | null;
  ele: number | null;
}

export interface ActivityAnalysis {
  splits: Split[];
  paceSecPerKm: number | null;
  gapSecPerKm: number | null;
  hrZoneSec: number[] | null;      // 5 zones, seconds
  paceZoneSec: number[] | null;    // 5 Daniels zones (runs only), seconds
  bestEfforts: BestEffort[];       // runs only
  hrDriftPct: number | null;       // 2nd-half HR/pace vs 1st half
  chart: ChartPoint[];
}

export type GoalMetric = 'distance' | 'time' | 'elevation' | 'count';
export type GoalPeriod = 'week' | 'month' | 'year';

export interface Goal {
  id: string;
  sport: Sport | 'all';
  metric: GoalMetric;
  period: GoalPeriod;
  target: number;            // km | hours | meters | sessions
}

export interface SleepData {
  totalSleepSeconds: number;
  deepSleepSeconds: number;
  remSleepSeconds: number;
  lightSleepSeconds: number;
  awakeSleepSeconds: number;
  sleepScore: number;
  averageSpO2: number;
  averageHRV: number;
  averageRespiration: number;
  startTime: string;
  endTime: string;
}

export interface HRVData {
  weeklyAverage: number;
  lastNight: number;
  status: 'balanced' | 'unbalanced' | 'poor';
  trend: number[];
}

export interface BodyBatteryData {
  /** false when the device doesn't support Body Battery (all endpoints return 404) */
  isAvailable: boolean;
  current: number;
  charged: number;
  drained: number;
  data: Array<{ time: string; value: number }>;
}

export interface StressData {
  average: number;
  data: Array<{ time: string; value: number }>;
  highStressPercentage: number;
  restingPercentage: number;
}

export interface ActivityData {
  name: string;
  duration: number;
  calories: number;
  strain: number;
  averageHR: number;
  maxHR: number;
  type: string;
}

export interface RecoveryData {
  score: number;
  category: 'green' | 'yellow' | 'red';
  hrv: number;
  restingHR: number;
  sleepScore: number;
}

export interface WeeklyTrend {
  dates: string[];
  recovery: number[];
  hrv: number[];
  sleep: number[];       // sleep score 0–100
  sleepHours: number[];  // actual sleep duration in hours
  rhr: number[];
  strain: number[];
}

/** One data point for the trends chart (30/90d historical view). */
export interface TrendPoint {
  date: string;       // 'YYYY-MM-DD'
  hrv: number;        // ms
  sleepHours: number; // hours
  rhr: number;        // bpm
  recovery: number;   // 0–100
  strain: number;     // 0–21 (Whoop-style)
}

// ─── User Profile ─────────────────────────────────────────────────────────────
export type Sex = 'male' | 'female';
export type FitnessLevel = 'beginner' | 'intermediate' | 'advanced' | 'athlete';
export type Goal = 'recovery' | 'performance' | 'weight_loss' | 'general_health';
export type WeightGoal = 'lose' | 'maintain' | 'gain';

export interface UserProfile {
  name?: string;
  age: number;
  sex: Sex;
  height?: number;       // cm (optional)
  weight?: number;       // kg (optional)
  weightGoal?: WeightGoal;
  fitnessLevel: FitnessLevel;
  goal: Goal;
  setupCompleted: boolean;
  units?: 'metric' | 'imperial';
}

export type DemoReason = 'no_credentials' | 'login_failed' | 'fetch_error';

// ─── Training activity (14-day window for advice) ────────────────────────────
export interface RecentActivity {
  date: string;            // YYYY-MM-DD (local)
  sportType: string;       // e.g. 'running', 'cycling', 'strength_training'
  durationMinutes: number;
  distanceKm: number;      // 0 when not applicable
  averageHR: number;       // 0 when not available
  maxHR: number;           // 0 when not available
  trainingLoad?: number;   // aerobic + anaerobic effect sum, if available
  calories: number;
}

// ─── Claude advice response ──────────────────────────────────────────────────
export interface AdviceDay {
  day: string;
  advice: string;
}

export interface AdviceResponse {
  summary: string;
  next3days: AdviceDay[];
  warnings: string[];
  confidence: 'high' | 'medium' | 'low';
}

export interface DailyMetrics {
  date: string;
  isDemo: boolean;
  demoReason?: DemoReason;
  recovery: RecoveryData;
  sleep: SleepData;
  hrv: HRVData;
  bodyBattery: BodyBatteryData;
  stress: StressData;
  activities: ActivityData[];
  steps: number;
  calories: number;
  floorsAscended: number;
  highlyActiveSeconds: number;
  activeSeconds: number;
  strain: number;         // total daily strain: TRIMP + NEAT background
  weeklyTrend: WeeklyTrend;
}

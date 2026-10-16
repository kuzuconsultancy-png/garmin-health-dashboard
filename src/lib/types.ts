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
  trainingLoad?: number;   // Garmin EPOC-based training load (activityTrainingLoad)
  aerobicTE?: number;      // Garmin aerobic training effect, 0–5
  anaerobicTE?: number;    // Garmin anaerobic training effect, 0–5
  calories: number;
}

// ─── Coach metrics (deterministic, computed before the LLM call) ─────────────
export type CoachFlagId =
  | 'hrv_suppressed'
  | 'rhr_elevated'
  | 'short_sleep'
  | 'sleep_debt'
  | 'load_spike'
  | 'no_rest'
  | 'well_recovered';

export interface CoachFlag {
  id: CoachFlagId;
  severity: 'alert' | 'warning' | 'positive';
  value: number;           // the number that tripped the rule (%, bpm, h, days)
}

export interface CoachDay {
  date: string;            // YYYY-MM-DD
  hrv: number;             // ms, 0 = missing
  rhr: number;             // bpm, 0 = missing
  sleepHours: number;      // 0 = missing
  recovery: number;        // 0–100, 0 = missing
  activities: RecentActivity[];
}

export interface CoachMetrics {
  today: string;           // YYYY-MM-DD the window ends on
  load: {
    unit: 'training_load' | 'minutes';
    last7: number;         // sum over today-6 … today
    prev7: number;         // sum over today-13 … today-7
    rampPct: number | null; // (last7 - prev7) / prev7 × 100; null when prev7 = 0
    sessionsLast7: number;
    hardSessionsLast7: number;
    consecutiveTrainingDays: number;
    sportMinutes14d: Record<string, number>;
  };
  recovery: {
    hrvLastNight: number;
    hrvBaseline: number;   // mean of the previous 7 nights with data
    hrvDeltaPct: number | null;
    rhrToday: number;
    rhrBaseline: number;
    rhrDelta: number | null;
    sleepLastNight: number;
    sleepAvg7d: number;
    sleepDebt7d: number;   // vs 8h/night, surplus nights offset deficit nights
    recoveryToday: number;
  };
  coverage: { recoveryDays: number; activitiesWithHR: number; windowDays: number };
  flags: CoachFlag[];
  confidence: 'high' | 'medium' | 'low';
}

// ─── Claude advice response ──────────────────────────────────────────────────
export type AdviceFocus = 'rest' | 'recovery' | 'easy' | 'moderate' | 'hard' | 'long';

export interface AdviceDay {
  date: string;            // YYYY-MM-DD
  focus: AdviceFocus;
  session: string;         // concrete session: type, duration, intensity
  why: string;             // grounded in the athlete's numbers
}

export interface AdviceResponse {
  summary: string;
  next3days: AdviceDay[];
  warnings: string[];
  confidence: 'high' | 'medium' | 'low';
}

export interface AdvicePayload {
  advice: AdviceResponse;
  metrics: CoachMetrics;
  generatedAt: string;
  isDemo: boolean;
  activityCount: number;
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

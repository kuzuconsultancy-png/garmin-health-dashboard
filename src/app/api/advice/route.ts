import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { betaJSONSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import { fetchRecentActivities, fetchTrendData } from '@/lib/garmin';
import { resolveToday } from '@/lib/dates';
import {
  WINDOW_DAYS, buildCoachDays, computeCoachMetrics, buildAdviceInput, upcomingDates,
  type AdviceProfile,
} from '@/lib/coach';
import type { AdviceDay, AdvicePayload } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Override with ANTHROPIC_MODEL / ANTHROPIC_EFFORT. The heavy lifting (load, baselines,
// flags) is done in lib/coach.ts, so the model only synthesizes — low effort is enough.
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const EFFORT = (['low', 'medium', 'high'] as const).find(e => e === process.env.ANTHROPIC_EFFORT) ?? 'low';

const SYSTEM_PROMPT = `You are an experienced endurance and strength coach writing a 3-day training plan for one athlete from their Garmin data.

The input is JSON: today, planFor (the 3 dates to plan), the athlete profile, precomputed metrics, rule-based flags, and one row per day for the last 14 days (null = no data that day).

Rules:
- The metrics and flags are already computed. Use them as given; do not recompute or contradict them.
- Recovery comes first. If any flag has severity "alert", the first plan day must be rest, recovery or easy. With "warning" flags, at most one hard day in the three.
- Never put hard sessions on consecutive days. Stay close to the athlete's recent sport mix and typical session length; only add other activities as mobility or easy cross-training.
- Each day gets one concrete session: sport, duration, and intensity as heart-rate zone (Z1–Z5) or RPE. A rest day says what recovery looks like (sleep target, walk, mobility).
- "why" cites the athlete's own numbers (e.g. "HRV 38 ms vs 47 ms baseline", "load 420 this week vs 300 last week") in one or two sentences.
- Fit the plan to the athlete's goal and fitness level when a profile is given.
- warnings: 0–3 items, only for issues visible in the flags or data. No generic disclaimers. If the numbers point to possible illness (e.g. RHR well above baseline together with suppressed HRV), recommend rest and seeing a doctor if symptoms persist.
- If data coverage is thin, say so in the summary and keep the plan conservative.
- summary: 2–3 sentences on the current state — load trend, recovery status, and the one thing that matters most right now.
- Focus values: rest; recovery (active recovery); easy (Z1–Z2); moderate (Z3, tempo); hard (intervals, threshold); long (long endurance session).
- Return exactly 3 entries in next3days, one per planFor date, using those dates.
- Write every text field in the language given by "language" (en = English, es = Spanish).`;

const ADVICE_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    next3days: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string' },
          focus: { type: 'string', enum: ['rest', 'recovery', 'easy', 'moderate', 'hard', 'long'] },
          session: { type: 'string' },
          why: { type: 'string' },
        },
        required: ['date', 'focus', 'session', 'why'],
        additionalProperties: false,
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'next3days', 'warnings'],
  additionalProperties: false,
} as const;

// ── Server-side cache: one generation per day/profile/language ──────────────
const adviceCache = new Map<string, { payload: AdvicePayload; ts: number }>();
const ADVICE_TTL = 3 * 60 * 60 * 1000; // 3h

// ── Request validation ──────────────────────────────────────────────────────
interface AdviceRequest {
  today?: unknown;
  lang?: unknown;
  profile?: unknown;
  refresh?: unknown;
}

function sanitizeProfile(raw: unknown): AdviceProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined =>
    allowed.find(a => a === v);
  const age = typeof p.age === 'number' && p.age >= 10 && p.age <= 100 ? Math.round(p.age) : undefined;
  const sex = pick(p.sex, ['male', 'female'] as const);
  const fitnessLevel = pick(p.fitnessLevel, ['beginner', 'intermediate', 'advanced', 'athlete'] as const);
  const goal = pick(p.goal, ['recovery', 'performance', 'weight_loss', 'general_health'] as const);
  if (!age || !sex || !fitnessLevel || !goal) return null;
  const weight = typeof p.weight === 'number' && p.weight > 25 && p.weight < 300 ? Math.round(p.weight) : undefined;
  return { age, sex, fitnessLevel, goal, ...(weight ? { weight } : {}) };
}

/** Pin the model's days to the 3 expected dates (by date, else by position). */
function normalizeDays(days: AdviceDay[], expected: string[]): AdviceDay[] {
  return expected
    .map((date, i) => {
      const d = days.find(x => x.date === date) ?? days[i];
      return d ? { ...d, date } : null;
    })
    .filter((d): d is AdviceDay => d !== null);
}

const fail = (error: string, status = 502) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'sk-ant-...') return fail('ANTHROPIC_API_KEY not configured', 503);

  const body = (await req.json().catch(() => ({}))) as AdviceRequest;
  const today = resolveToday(body.today);
  const language = body.lang === 'es' ? 'es' : 'en';
  const profile = sanitizeProfile(body.profile);

  const cacheKey = JSON.stringify([today, language, profile, MODEL]);
  const cached = adviceCache.get(cacheKey);
  if (body.refresh !== true && cached && Date.now() - cached.ts < ADVICE_TTL) {
    return NextResponse.json(cached.payload);
  }

  // ── Garmin data: activities + per-day recovery for the same 14-day window ──
  let days, metrics, isDemo, activityCount;
  try {
    const [acts, trend] = await Promise.all([
      fetchRecentActivities(WINDOW_DAYS + 1), // +1: client date may be a day ahead of server time
      fetchTrendData(WINDOW_DAYS, today),
    ]);
    days = buildCoachDays(today, acts.activities, trend);
    metrics = computeCoachMetrics(days);
    isDemo = acts.isDemo;
    activityCount = days.reduce((s, d) => s + d.activities.length, 0);
  } catch (err) {
    console.error('[advice] Garmin fetch failed:', err);
    return fail('Failed to fetch training data from Garmin');
  }

  const input = buildAdviceInput({ metrics, days, profile, language });

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: EFFORT, format: betaJSONSchemaOutputFormat(ADVICE_SCHEMA) },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify(input) }],
    });

    if (response.stop_reason === 'refusal') {
      console.error('[advice] request declined:', response.stop_details);
      return fail('The advice request was declined. Try again later.');
    }
    if (response.stop_reason === 'max_tokens') {
      console.error('[advice] hit max_tokens');
      return fail('Advice was cut off, try refreshing');
    }
    const out = response.parsed_output;
    if (!out) {
      console.error('[advice] no parsed output');
      return fail('Advice unavailable, try refreshing');
    }

    const next3days = normalizeDays(out.next3days as AdviceDay[], upcomingDates(today));
    if (next3days.length !== 3) {
      console.error('[advice] expected 3 days, got', out.next3days.length);
      return fail('Advice unavailable, try refreshing');
    }

    const payload: AdvicePayload = {
      advice: {
        summary: out.summary,
        next3days,
        warnings: out.warnings.slice(0, 3),
        // From data coverage, not the model's self-assessment
        confidence: metrics.confidence,
      },
      metrics,
      generatedAt: new Date().toISOString(),
      isDemo,
      activityCount,
    };
    adviceCache.set(cacheKey, { payload, ts: Date.now() });
    return NextResponse.json(payload);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return fail('ANTHROPIC_API_KEY was rejected', 503);
    if (err instanceof Anthropic.RateLimitError) return fail('Anthropic rate limit reached, try again in a minute', 429);
    if (err instanceof Anthropic.NotFoundError) return fail(`Model "${MODEL}" not available — check ANTHROPIC_MODEL`);
    if (err instanceof Anthropic.BadRequestError) {
      console.error('[advice] bad request:', err.message);
      return fail('Advice request rejected by the API — check ANTHROPIC_MODEL / ANTHROPIC_EFFORT');
    }
    console.error('[advice] Claude call failed:', err instanceof Error ? err.message : err);
    return fail('Advice unavailable, try refreshing');
  }
}

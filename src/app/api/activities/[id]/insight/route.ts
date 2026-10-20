import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { betaJSONSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import { ACTIVITY_ID, fetchActivityHistory, fetchActivityStreams } from '@/lib/activities';
import { fetchTrendData } from '@/lib/garmin';
import { resolveToday } from '@/lib/dates';
import { CLAUDE_EFFORT, CLAUDE_MODEL, anthropicKey } from '@/lib/claude';
import { analyzeActivity } from '@/lib/training/analysis';
import { estimateHRMax } from '@/lib/training/effort';
import { buildInsightInput, type InsightPR, type InsightRecovery } from '@/lib/training/insight';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SYSTEM_PROMPT = `You write the short analysis shown at the top of one workout in a training app, for the athlete who did it.

The input is JSON with the workout, its splits, pacing, heart-rate drift, zone distribution, any personal records set, a comparison with the athlete's previous sessions of the same sport, and their recovery that morning. All numbers are precomputed; use them as given. Paces are seconds per km — write them as m:ss /km. A negative paceDiffSecPerKm means faster than usual.

Write:
- headline: at most 8 words naming what stands out (a PR, a strong negative split, an unusually hard or easy day).
- body: 2–4 sentences. What kind of session it was, how it compares to recent sessions with specific numbers, and one notable detail (pacing, HR drift above 5 %, time in zones, effect of hills via GAP, or training on a low-HRV morning).

No advice about future training, no generic praise, no disclaimers. Only state what the data shows; if a comparison is missing, leave it out. Write in the language given by "language" (en = English, es = Spanish).`;

const INSIGHT_SCHEMA = {
  type: 'object',
  properties: { headline: { type: 'string' }, body: { type: 'string' } },
  required: ['headline', 'body'],
  additionalProperties: false,
} as const;

const insightCache = new Map<string, { headline: string; body: string; generatedAt: string }>();

function sanitizePRs(raw: unknown): InsightPR[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is InsightPR => !!p && typeof p === 'object'
      && typeof (p as InsightPR).distM === 'number' && typeof (p as InsightPR).timeSec === 'number'
      && [1, 2, 3].includes((p as InsightPR).rank))
    .slice(0, 8)
    .map(p => ({ distM: p.distM, timeSec: Math.round(p.timeSec), rank: p.rank }));
}

const fail = (error: string, status = 502) => NextResponse.json({ error }, { status });

/** Recovery the morning of the workout: that night's HRV vs the 7 nights before, and sleep. */
async function recoveryOn(date: string): Promise<InsightRecovery | null> {
  try {
    const days = await fetchTrendData(8, date);
    const night = days[days.length - 1];
    const prior = days.slice(0, -1).map(d => d.hrv).filter(v => v > 0);
    if (!night || (!night.hrv && !night.sleepHours)) return null;
    return {
      hrvLastNight: night.hrv,
      hrvBaseline: prior.length ? Math.round(prior.reduce((s, v) => s + v, 0) / prior.length) : 0,
      sleepHours: night.sleepHours,
    };
  } catch {
    return null;
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const apiKey = anthropicKey();
  if (!apiKey) return fail('ANTHROPIC_API_KEY not configured', 503);
  if (!ACTIVITY_ID.test(params.id)) return fail('Invalid activity id', 400);

  const body = await req.json().catch(() => ({})) as { today?: unknown; lang?: unknown; hrMax?: unknown; vdot?: unknown; prs?: unknown };
  const language = body.lang === 'es' ? 'es' : 'en';
  const cacheKey = `${params.id}|${language}`;
  const hit = insightCache.get(cacheKey);
  if (hit) return NextResponse.json(hit);

  const { activities } = await fetchActivityHistory(resolveToday(body.today));
  const activity = activities.find(a => a.id === params.id);
  if (!activity) return fail('Activity not found', 404);

  const hrMax = typeof body.hrMax === 'number' && body.hrMax >= 140 && body.hrMax <= 230 ? body.hrMax : estimateHRMax(activities);
  const vdot = typeof body.vdot === 'number' && body.vdot >= 20 && body.vdot <= 90 ? body.vdot : null;

  const [streams, recovery] = await Promise.all([
    fetchActivityStreams(activity).catch(() => null),
    recoveryOn(activity.date),
  ]);
  const analysis = streams
    ? analyzeActivity(streams, { isRun: activity.sport === 'running', hrMax, vdot, splitM: activity.sport === 'cycling' ? 5000 : 1000 })
    : null;
  const input = buildInsightInput({ activity, analysis, history: activities, hrMax, prs: sanitizePRs(body.prs), recovery, language });

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.beta.messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: CLAUDE_EFFORT, format: betaJSONSchemaOutputFormat(INSIGHT_SCHEMA) },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify(input) }],
    });
    if (response.stop_reason === 'refusal') return fail('The insight request was declined.');
    const out = response.parsed_output;
    if (!out || response.stop_reason === 'max_tokens') return fail('Insight unavailable, try again');
    const result = { headline: out.headline, body: out.body, generatedAt: new Date().toISOString() };
    insightCache.set(cacheKey, result);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return fail('ANTHROPIC_API_KEY was rejected', 503);
    if (err instanceof Anthropic.RateLimitError) return fail('Anthropic rate limit reached, try again in a minute', 429);
    if (err instanceof Anthropic.NotFoundError) return fail(`Model "${CLAUDE_MODEL}" not available — check ANTHROPIC_MODEL`);
    console.error('[insight] Claude call failed:', err instanceof Error ? err.message : err);
    return fail('Insight unavailable, try again');
  }
}

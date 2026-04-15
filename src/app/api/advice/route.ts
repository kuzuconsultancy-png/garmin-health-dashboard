import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { fetchRecentActivities } from '@/lib/garmin';
import type { AdviceResponse } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SYSTEM_PROMPT = `You are a personal training coach. Analyze the athlete's last 14 days of training data. Identify patterns in load, recovery, sport distribution, and intensity. Give specific, actionable advice for the next 3 days. Flag any overtraining signals or gaps. Be direct and concrete. No generic advice. Format your response as JSON with these fields: { summary: string, next3days: [{day: string, advice: string}], warnings: string[], confidence: 'high'|'medium'|'low' }`;

function extractJSON(text: string): AdviceResponse | null {
  // Accept raw JSON, or JSON inside ```json fences, or JSON embedded in prose.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;

  // Attempt direct parse
  try {
    const parsed = JSON.parse(candidate);
    return validateAdvice(parsed);
  } catch { /* fall through */ }

  // Attempt to find first { ... } block
  const start = candidate.indexOf('{');
  const end   = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1));
      return validateAdvice(parsed);
    } catch { /* fall through */ }
  }
  return null;
}

function validateAdvice(obj: unknown): AdviceResponse | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  if (typeof o.summary !== 'string') return null;
  if (!Array.isArray(o.next3days)) return null;
  const days = o.next3days
    .filter((d): d is { day: string; advice: string } =>
      !!d && typeof d === 'object' &&
      typeof (d as Record<string, unknown>).day === 'string' &&
      typeof (d as Record<string, unknown>).advice === 'string',
    );
  if (days.length === 0) return null;
  const warnings = Array.isArray(o.warnings)
    ? (o.warnings.filter(w => typeof w === 'string') as string[])
    : [];
  const conf = o.confidence;
  const confidence: AdviceResponse['confidence'] =
    conf === 'high' || conf === 'medium' || conf === 'low' ? conf : 'medium';

  return { summary: o.summary, next3days: days, warnings, confidence };
}

export async function GET() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'sk-ant-...') {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY not configured' },
      { status: 503 },
    );
  }

  // Fetch last 14 days of activities
  let activitiesPayload;
  try {
    activitiesPayload = await fetchRecentActivities(14);
  } catch (err) {
    console.error('[advice] Garmin fetch failed:', err);
    return NextResponse.json(
      { error: 'Failed to fetch training data from Garmin' },
      { status: 502 },
    );
  }

  const { activities, isDemo } = activitiesPayload;

  // Build compact user message — just the activity list as structured data
  const userMessage = JSON.stringify(
    {
      windowDays: 14,
      totalActivities: activities.length,
      activities: activities.map(a => ({
        date: a.date,
        sport: a.sportType,
        minutes: a.durationMinutes,
        km: a.distanceKm,
        avgHR: a.averageHR,
        maxHR: a.maxHR,
        trainingLoad: a.trainingLoad,
      })),
    },
    null,
    2,
  );

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1200,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userMessage }],
    });

    const textBlock = response.content.find(b => b.type === 'text');
    const text = textBlock && textBlock.type === 'text' ? textBlock.text : '';
    const advice = extractJSON(text);

    if (!advice) {
      console.error('[advice] Could not parse Claude response:', text.slice(0, 300));
      return NextResponse.json(
        { error: 'Advice unavailable, try refreshing' },
        { status: 502 },
      );
    }

    return NextResponse.json({
      advice,
      generatedAt: new Date().toISOString(),
      isDemo,
      activityCount: activities.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[advice] Claude call failed:', msg);
    return NextResponse.json(
      { error: 'Advice unavailable, try refreshing' },
      { status: 502 },
    );
  }
}

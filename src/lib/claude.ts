// Shared model settings for the Claude-powered features (advice, activity insights).
// Override with ANTHROPIC_MODEL / ANTHROPIC_EFFORT. Metrics are computed in code
// beforehand, so the model only writes — low effort is enough.
export const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
export const CLAUDE_EFFORT = (['low', 'medium', 'high'] as const).find(e => e === process.env.ANTHROPIC_EFFORT) ?? 'low';

export function anthropicKey(): string | null {
  const k = process.env.ANTHROPIC_API_KEY;
  return k && k !== 'sk-ant-...' ? k : null;
}

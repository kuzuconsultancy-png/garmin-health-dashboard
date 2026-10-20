/**
 * Route-level test with Garmin and the Anthropic SDK mocked: checks what is sent
 * to the model and how its structured output is turned into the API response.
 */
import { format, subDays, addDays } from 'date-fns';

const TODAY = format(new Date(), 'yyyy-MM-dd');
const plus = (n: number) => format(addDays(new Date(), n), 'yyyy-MM-dd');

const mockParse = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  const actual = jest.requireActual('@anthropic-ai/sdk');
  class FakeAnthropic {
    static AuthenticationError = actual.AuthenticationError;
    static RateLimitError = actual.RateLimitError;
    static NotFoundError = actual.NotFoundError;
    static BadRequestError = actual.BadRequestError;
    beta = { messages: { parse: mockParse } };
  }
  return { __esModule: true, default: FakeAnthropic };
});

jest.mock('@/lib/garmin', () => {
  const { format: f, subDays: sub } = jest.requireActual('date-fns');
  const day = (n: number) => f(sub(new Date(), n), 'yyyy-MM-dd');
  return {
    fetchRecentActivities: jest.fn(async () => ({
      isDemo: false,
      activities: [
        { date: day(1), sportType: 'running', durationMinutes: 50, distanceKm: 9, averageHR: 150, maxHR: 172, calories: 600, trainingLoad: 110, aerobicTE: 3.5 },
        { date: day(3), sportType: 'cycling', durationMinutes: 80, distanceKm: 30, averageHR: 135, maxHR: 160, calories: 800, trainingLoad: 130, aerobicTE: 3.1 },
      ],
    })),
    // 14 nights of data; last night HRV clearly suppressed (36 vs 50)
    fetchTrendData: jest.fn(async () =>
      Array.from({ length: 14 }, (_, i) => ({
        date: day(13 - i), hrv: i === 13 ? 36 : 50, sleepHours: 7.6, rhr: 52, recovery: 60, strain: 8,
      }))),
  };
});

const req = (body: unknown) => new Request('http://localhost/api/advice', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const modelOutput = (dates: string[]) => ({
  stop_reason: 'end_turn',
  parsed_output: {
    summary: 'HRV is down; keep it easy.',
    next3days: dates.map((date, i) => ({
      date, focus: (['recovery', 'easy', 'moderate'] as const)[i], session: `Session ${i + 1}`, why: 'HRV 36 vs 50',
    })),
    warnings: ['a', 'b', 'c', 'd'],
  },
});

const PROFILE = { age: 34, sex: 'male', fitnessLevel: 'intermediate', goal: 'performance', setupCompleted: true, name: 'Should not be sent' };

describe('POST /api/advice', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    mockParse.mockReset();
    process.env = { ...OLD_ENV, ANTHROPIC_API_KEY: 'sk-ant-test' };
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.ANTHROPIC_EFFORT;
  });
  afterAll(() => { process.env = OLD_ENV; });

  test('sends precomputed metrics + plan dates and returns 3 normalized days', async () => {
    mockParse.mockResolvedValue(modelOutput([plus(1), plus(2), plus(3)]));
    const { POST } = await import('../route');

    const res = await POST(req({ today: TODAY, lang: 'es', profile: PROFILE }));
    expect(res.status).toBe(200);

    const params = mockParse.mock.calls[0][0];
    expect(params.model).toBe('claude-sonnet-5-5');
    expect(params.fallbacks).toBe('default');
    expect(params.output_config.effort).toBe('low');
    expect(params.output_config.format.type).toBe('json_schema');

    const input = JSON.parse(params.messages[0].content);
    expect(input.language).toBe('es');
    expect(input.today.date).toBe(TODAY);
    expect(input.planFor.map((d: { date: string }) => d.date)).toEqual([plus(1), plus(2), plus(3)]);
    expect(input.athlete).toEqual({ age: 34, sex: 'male', fitnessLevel: 'intermediate', goal: 'performance' });
    expect(input.flags).toContainEqual({ id: 'hrv_suppressed', severity: 'warning', value: -28 }); // (36-50)/50
    expect(input.days).toHaveLength(14);

    const body = await res.json();
    expect(body.advice.next3days.map((d: { date: string }) => d.date)).toEqual([plus(1), plus(2), plus(3)]);
    expect(body.advice.warnings).toHaveLength(3);          // capped
    expect(body.advice.confidence).toBe('high');           // 14/14 nights, from coverage
    expect(body.metrics.load).toMatchObject({ unit: 'training_load', last7: 240, sessionsLast7: 2 });
    expect(body.activityCount).toBe(2);
  });

  test('second request is served from cache; refresh=true regenerates', async () => {
    mockParse.mockResolvedValue(modelOutput([plus(1), plus(2), plus(3)]));
    const { POST } = await import('../route');
    await POST(req({ today: TODAY, lang: 'en' }));
    await POST(req({ today: TODAY, lang: 'en' }));
    expect(mockParse).toHaveBeenCalledTimes(1);
    await POST(req({ today: TODAY, lang: 'en', refresh: true }));
    expect(mockParse).toHaveBeenCalledTimes(2);
  });

  test('wrong dates from the model are pinned to the plan dates by position', async () => {
    mockParse.mockResolvedValue(modelOutput(['Monday', 'Tuesday', 'Wednesday']));
    const { POST } = await import('../route');
    const body = await (await POST(req({ today: TODAY }))).json();
    expect(body.advice.next3days.map((d: { date: string }) => d.date)).toEqual([plus(1), plus(2), plus(3)]);
    expect(body.advice.next3days[0].session).toBe('Session 1');
  });

  test('a refusal is reported, not parsed', async () => {
    mockParse.mockResolvedValue({ stop_reason: 'refusal', stop_details: { category: null }, parsed_output: null });
    const { POST } = await import('../route');
    const res = await POST(req({ today: TODAY }));
    expect(res.status).toBe(502);
  });

  test('a date outside ±1 day of server time falls back to the server date', async () => {
    mockParse.mockResolvedValue(modelOutput([plus(1), plus(2), plus(3)]));
    const { POST } = await import('../route');
    await POST(req({ today: format(subDays(new Date(), 30), 'yyyy-MM-dd') }));
    expect(JSON.parse(mockParse.mock.calls[0][0].messages[0].content).today.date).toBe(TODAY);
  });

  test('missing API key → 503 without calling the model', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { POST } = await import('../route');
    const res = await POST(req({}));
    expect(res.status).toBe(503);
    expect(mockParse).not.toHaveBeenCalled();
  });
});

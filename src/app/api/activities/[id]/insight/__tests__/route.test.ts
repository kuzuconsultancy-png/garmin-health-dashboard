const mockParse = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  const actual = jest.requireActual('@anthropic-ai/sdk');
  class FakeAnthropic {
    static AuthenticationError = actual.AuthenticationError;
    static RateLimitError = actual.RateLimitError;
    static NotFoundError = actual.NotFoundError;
    beta = { messages: { parse: mockParse } };
  }
  return { __esModule: true, default: FakeAnthropic };
});

jest.mock('@/lib/garmin', () => ({
  fetchTrendData: jest.fn(async () => Array.from({ length: 8 }, (_, i) => ({
    date: `2026-10-${10 + i}`, hrv: i === 7 ? 40 : 50, sleepHours: 7, rhr: 50, recovery: 60, strain: 8,
  }))),
  getClient: jest.fn(async () => null),
}));

const req = (body: unknown) => new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body) });

describe('POST /api/activities/[id]/insight', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    jest.resetModules();
    mockParse.mockReset();
    process.env = { ...OLD_ENV, ANTHROPIC_API_KEY: 'sk-ant-test' };
  });
  afterAll(() => { process.env = OLD_ENV; });

  test('sends precomputed context for a demo run and caches the result', async () => {
    mockParse.mockResolvedValue({ stop_reason: 'end_turn', parsed_output: { headline: 'Solid intervals', body: 'Text.' } });
    const { POST } = await import('../route');
    const { fetchActivityHistory } = await import('@/lib/activities');
    const today = new Date().toISOString().slice(0, 10);
    const { activities } = await fetchActivityHistory(today);
    const target = activities.filter(a => a.name === 'Intervals').at(-1)!;

    const res = await POST(req({ today, lang: 'es', hrMax: 190, prs: [{ distM: 1000, timeSec: 210, rank: 1 }, { bogus: true }] }), { params: { id: target.id } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ headline: 'Solid intervals', body: 'Text.' });

    const params = mockParse.mock.calls[0][0];
    expect(params.output_config.format.type).toBe('json_schema');
    const input = JSON.parse(params.messages[0].content);
    expect(input.language).toBe('es');
    expect(input.activity.name).toBe('Intervals');
    expect(input.splits.length).toBeGreaterThan(5);
    expect(input.personalRecords).toEqual([{ distance: '1 km', time: 210, rank: 1 }]); // bogus entry dropped
    expect(input.recoveryThatMorning).toMatchObject({ hrvLastNight: 40, hrvBaseline: 50, hrvDeltaPct: -20 });
    expect(input.comparedToLast.sessions).toBe(10);

    await POST(req({ today, lang: 'es' }), { params: { id: target.id } });
    expect(mockParse).toHaveBeenCalledTimes(1); // cached
  });

  test('rejects bad ids and missing keys', async () => {
    const { POST } = await import('../route');
    expect((await POST(req({}), { params: { id: '../etc' } })).status).toBe(400);
    delete process.env.ANTHROPIC_API_KEY;
    jest.resetModules();
    const { POST: POST2 } = await import('../route');
    expect((await POST2(req({}), { params: { id: '123' } })).status).toBe(503);
    expect(mockParse).not.toHaveBeenCalled();
  });
});

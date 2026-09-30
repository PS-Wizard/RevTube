// Unit tests for the Anomaly API client payload normalization.
// Regression: the /anomalies list row read `anomaly.baseline` directly and
// crashed with "Cannot read properties of undefined (reading 'toLocaleString')"
// because the backend serializes baseline_value/actual_value/unit/ai — mapped
// here at the fetch boundary. `fetch`, `apiBase`, `authHeaders` and
// `analyticsService` are mocked — no network/Firebase.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/apiBase', () => ({
  apiUrl: (p: string) => `https://api.test${p}`,
}));
vi.mock('./authHeaders', () => ({
  getFirebaseAuthHeader: vi.fn(async () => ({ 'X-Firebase-Token': 'tok' })),
}));
vi.mock('./analyticsService', () => ({
  tryExtractUsage: vi.fn(),
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const { getAnomalies, getAnomaly, getAnomalySeries, explainAnomaly, scanAnomalies } =
  await import('./anomalyService');

function mockJsonResponse(body: unknown) {
  fetchMock.mockResolvedValue({ ok: true, json: async () => body } as Response);
}

/** Raw mapRow shape exactly as the backend serializes it. */
const RAW_ANOMALY = {
  id: 42,
  channelId: 'UC1',
  channelTitle: 'Chan',
  metric: 'views',
  metricLabel: 'Views',
  unit: 'views',
  integer: true,
  kind: 'spike',
  direction: 'up',
  severity: 'high',
  score: 82,
  anomalyDate: '2026-09-20',
  baselineValue: 1200,
  actualValue: 4800,
  delta: 3600,
  deltaPct: 3,
  zScore: 4.2,
  runLength: 1,
  method: 'weekday-median-mad',
  windowDays: 28,
  status: 'open',
  evidence: {
    method: 'weekday-median-mad',
    signals: [
      { key: 'upload', label: 'New upload drove the spike', detail: '"V" was published the same day.', weight: 0.85 },
    ],
    drivers: [
      { videoId: 'v1', title: 'Video One', thumbnailUrl: 'https://img/v1.jpg', deltaViews: 2400, sharePct: 0.66 },
      { videoId: 'v2', title: 'Video Two', thumbnailUrl: null, deltaViews: -50, sharePct: null },
    ],
  },
  ai: {
    explanation: {
      source: 'ai',
      headline: 'Views spiked 300%',
      summary: 'A new upload carried the spike.',
      likelyCategory: 'upload',
      confidence: 0.82,
      rootCauses: [{ signal: 'upload', weight: 0.85, explanation: 'V landed that day.' }],
      impactAssessment: 'Views moved +3,600 versus baseline.',
      recommendedActions: [{ action: 'Pin a comment', rationale: 'Ride momentum.', priority: 'high' }],
      caveats: ['YouTube does not expose the exact cause.'],
    },
    model: 'deepseek-chat',
    generatedAt: '2026-09-21T10:00:00.000Z',
  },
  detectedAt: '2026-09-21T10:00:00.000Z',
  updatedAt: '2026-09-21T10:00:00.000Z',
};

const RAW_MARKER = {
  id: 42,
  date: '2026-09-20',
  kind: 'spike',
  severity: 'high',
  score: 82,
  delta: 3600,
  deltaPct: 3,
  status: 'open',
};

beforeEach(() => {
  fetchMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('anomalyService payload normalization', () => {
  it('maps baselineValue/actualValue/unit so the list row never reads undefined', async () => {
    mockJsonResponse({
      items: [RAW_ANOMALY],
      total: 1,
      counts: { total: 1, critical: 0, high: 1, open: 1 },
    });
    const { items, total, counts } = await getAnomalies({}, 50, 0);
    expect(total).toBe(1);
    expect(counts.high).toBe(1);
    const a = items[0];
    expect(a.baseline).toBe(1200);
    expect(a.actual).toBe(4800);
    expect(a.metricUnit).toBe('views');
    // The exact call that used to throw a TypeError on /anomalies.
    expect(a.baseline.toLocaleString()).toBe((1200).toLocaleString());
    expect(a.actual.toLocaleString()).toBe((4800).toLocaleString());
    expect(fetchMock.mock.calls[0][0]).toContain('/anomalies?limit=50&offset=0');
  });

  it('maps evidence: signal label, thumbnailUrl → thumbnail, nullable sharePct', async () => {
    mockJsonResponse({ anomaly: RAW_ANOMALY });
    const a = await getAnomaly(42);
    expect(a.evidence?.summary).toBe('New upload drove the spike');
    expect(a.evidence?.signals[0]).toEqual({
      signal: 'New upload drove the spike',
      detail: '"V" was published the same day.',
    });
    expect(a.evidence?.drivers[0].thumbnail).toBe('https://img/v1.jpg');
    expect(a.evidence?.drivers[0].sharePct).toBe(0.66);
    expect(a.evidence?.drivers[1].thumbnail).toBeNull();
    expect(a.evidence?.drivers[1].sharePct).toBeNull();
  });

  it('maps ai → explanation with confidence band and string actions', async () => {
    mockJsonResponse({ anomaly: RAW_ANOMALY });
    const a = await getAnomaly(42);
    expect(a.explanation?.confidence).toBe('high');
    expect(a.explanation?.recommendedActions).toEqual(['Pin a comment']);
    expect(a.explanation?.cached).toBe(true);
    expect(a.explanation?.fallback).toBe(false);
    expect(a.explanation?.model).toBe('deepseek-chat');
    expect(a.explanation?.generatedAt).toBe('2026-09-21T10:00:00.000Z');
  });

  it('returns null explanation when the row has no cached AI', async () => {
    mockJsonResponse({ anomaly: { ...RAW_ANOMALY, ai: null } });
    const a = await getAnomaly(42);
    expect(a.explanation).toBeNull();
  });

  it('unwraps the explain envelope and maps rules fallback', async () => {
    mockJsonResponse({
      anomaly: RAW_ANOMALY,
      explanation: {
        source: 'rules',
        headline: 'Views spiked',
        summary: 'Deterministic summary.',
        confidence: 0.4,
        recommendedActions: [{ action: 'Check traffic sources' }],
      },
      cached: false,
    });
    const ex = await explainAnomaly(42);
    expect(ex.headline).toBe('Views spiked');
    expect(ex.confidence).toBe('low');
    expect(ex.fallback).toBe(true);
    expect(ex.cached).toBe(false);
    expect(ex.recommendedActions).toEqual(['Check traffic sources']);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/anomalies/42/explain');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
  });

  it('series: label/unit → metricLabel/metricUnit, anomaly marker → isAnomaly', async () => {
    mockJsonResponse({
      channelId: 'UC1',
      metric: 'views',
      label: 'Views',
      unit: 'views',
      integer: true,
      windowDays: 28,
      points: [
        { date: '2026-09-19', value: 100, expected: 90, anomaly: null },
        { date: '2026-09-20', value: 4800, expected: 1200, anomaly: RAW_MARKER },
      ],
      anomalies: [RAW_MARKER],
    });
    const series = await getAnomalySeries('UC1', 'views');
    expect(series.metricLabel).toBe('Views');
    expect(series.metricUnit).toBe('views');
    expect(series.points.map((p) => p.isAnomaly)).toEqual([false, true]);
    expect(series.points[1].expected).toBe(1200);
    expect(series.anomalies[0].id).toBe(42);
    expect(fetchMock.mock.calls[0][0]).toContain(
      '/anomalies/series?channelId=UC1&metric=views&days=60',
    );
  });

  it('scan maps stored/detected onto total for the toast', async () => {
    mockJsonResponse({ channelId: 'UC1', scanned: true, detected: 3, stored: 3 });
    const res = await scanAnomalies('UC1');
    expect(res).toEqual({ scanned: true, total: 3 });
  });

  it('scan surfaces the skip reason when history is insufficient', async () => {
    mockJsonResponse({ scanned: false, reason: 'insufficient-history', detected: 0, stored: 0 });
    const res = await scanAnomalies('UC1');
    expect(res.scanned).toBe(false);
    expect(res.total).toBe(0);
    expect(res.reason).toBe('insufficient-history');
  });
});
import { describe, expect, it } from 'vitest';
import { fetchGoalBaseline } from './fetchGoalBaseline';
import type { AnalyticsReport, AnalyticsService } from '../../services/analyticsService';
import type { GoalMetric } from '../../types/goals';

/** Per-metric cell value used to build fake daily rows. */
const CELL_VALUES: Record<string, number> = {
  views: 100,
  likes: 10,
  comments: 2,
  shares: 0,
  subscribersGained: 9,
  subscribersLost: 1,
  averageViewPercentage: 45.5,
  cardImpressions: 1000,
  cardClicks: 50,
};

/** 14 daily rows starting 2026-01-01, column order [day, ...metrics]. */
function buildReport(metrics: string): AnalyticsReport {
  const names = metrics.split(',');
  return {
    kind: 'analytics',
    columnHeaders: [
      { name: 'day', columnType: 'DIMENSION', dataType: 'STRING' },
      ...names.map((name) => ({ name, columnType: 'METRIC', dataType: 'NUMBER' })),
    ],
    rows: Array.from({ length: 14 }, (_, i) => {
      const day = `2026-01-${String(i + 1).padStart(2, '0')}`;
      return [day, ...names.map((n) => String(CELL_VALUES[n] ?? 0))];
    }),
  };
}

/** Fake AnalyticsService that records the metrics each request asked for. */
function makeFakeSvc(calls: string[]): AnalyticsService {
  return {
    getReport: async (params: { metrics: string }): Promise<AnalyticsReport> => {
      calls.push(params.metrics);
      return buildReport(params.metrics);
    },
  } as unknown as AnalyticsService;
}

describe('fetchGoalBaseline', () => {
  it.each<[GoalMetric, string[], number]>([
    // metric, expected YT-compatible group (as ordered), expected current
    // Baseline is the value AS OF the goal start date (2026-01-11), i.e. the
    // 10 days before it: views 10*100=1000, net subs 10*(9-1)=80.
    ['views', ['views'], 1000],
    ['subscribers', ['subscribersGained', 'subscribersLost'], 80],
    ['engagement_rate', ['views', 'likes', 'comments', 'shares'], 12],
    ['retention', ['views', 'averageViewPercentage'], 45.5],
    ['ctr', ['views', 'cardImpressions', 'cardClicks', 'cardClickRate'], 5],
  ])(
    'uses only the YT-compatible group for %s and computes a real current',
    async (metric, expectedMetrics, expectedCurrent) => {
      const calls: string[] = [];
      const snap = await fetchGoalBaseline(
        makeFakeSvc(calls),
        'ch-1',
        metric,
        '2026-01-11',
        'quarters',
      );

      // Regression guard: never a single mixed-group request -- that is what
      // blanked *every* metric out in production (YT 400 "query not supported").
      expect(calls).toHaveLength(1);
      expect(calls[0]).toBe(expectedMetrics.join(','));
      expect(calls[0].split(',')).toEqual(expectedMetrics);

      expect(snap.current).toBeCloseTo(expectedCurrent, 5);
      expect(snap.daily).toHaveLength(14);
    },
  );

  it('subtracts gains since the start date from the lifetime total for Views', async () => {
    const fake = {
      getReport: async (p: { metrics: string }) => buildReport(p.metrics),
      getAuthorizedChannels: async () => [{ id: 'ch-1', statistics: { viewCount: '3000' } }],
    } as unknown as AnalyticsService;
    // Start 2026-01-01: the full 14-day report (14*100=1400 views) was gained
    // on/after the start, so the as-of-start baseline is 3000-1400=1600.
    const snap = await fetchGoalBaseline(fake, 'ch-1', 'views', '2026-01-01', 'quarters');
    expect(snap.current).toBe(1600);
    expect(snap.lifetime).toBe(3000);
  });

  it('subtracts net gains since the start date from the lifetime total for Subscribers', async () => {
    const fake = {
      getReport: async (p: { metrics: string }) => buildReport(p.metrics),
      getAuthorizedChannels: async () => [{ id: 'ch-1', statistics: { subscriberCount: '4500' } }],
    } as unknown as AnalyticsService;
    // Net subs gained on/after start: 14*(9-1)=112 → 4500-112=4388.
    const snap = await fetchGoalBaseline(fake, 'ch-1', 'subscribers', '2026-01-01', 'quarters');
    expect(snap.current).toBe(4388);
    expect(snap.lifetime).toBe(4500);
  });

  it('respects the chosen range window for percentage baselines', async () => {
    const names = ['views', 'likes', 'comments', 'shares'];
    const rows = Array.from({ length: 20 }, (_, i) => {
      const day = `2026-01-${String(i + 1).padStart(2, '0')}`;
      const views = i < 10 ? 100 : 200;
      return [day, views, 10, 2, 0];
    });
    const fake = {
      getReport: async () => ({
        kind: 'analytics',
        columnHeaders: [
          { name: 'day', columnType: 'DIMENSION', dataType: 'STRING' },
          ...names.map((n) => ({ name: n, columnType: 'METRIC', dataType: 'NUMBER' })),
        ],
        rows,
      }),
    } as unknown as AnalyticsService;

    // Start after the data (2026-01-21): the baseline window is the last N days
    // BEFORE the goal starts. Last 7 days: views=200, engagement = 12/200*100 = 6%.
    const snap7 = await fetchGoalBaseline(fake, 'ch-1', 'engagement_rate', '2026-01-21', 'quarters', 7);
    expect(snap7.current).toBeCloseTo(6, 5);

    // Range clamps to available window (20 days): eng = (240/3000)*100 = 8%.
    const snap30 = await fetchGoalBaseline(fake, 'ch-1', 'engagement_rate', '2026-01-21', 'quarters', 30);
    expect(snap30.current).toBeCloseTo(8, 5);
  });

  it('falls back to the cardClickRate column when impressions/clicks are 0', async () => {
    // Production case: some channels return zero cardImpressions/cardClicks in
    // the day report but a usable cardClickRate. CTR must not collapse to 0.
    const names = ['views', 'cardImpressions', 'cardClicks', 'cardClickRate'];
    const rows = Array.from({ length: 14 }, (_, i) => [
      `2026-01-${String(i + 1).padStart(2, '0')}`,
      100, // views
      0,   // cardImpressions
      0,   // cardClicks
      4.2, // cardClickRate (%)
    ]);
    const fake = {
      getReport: async () => ({
        kind: 'analytics',
        columnHeaders: [
          { name: 'day', columnType: 'DIMENSION', dataType: 'STRING' },
          ...names.map((n) => ({ name: n, columnType: 'METRIC', dataType: 'NUMBER' })),
        ],
        rows,
      }),
    } as unknown as AnalyticsService;
    const snap = await fetchGoalBaseline(fake, 'ch-1', 'ctr', '2026-01-15', 'quarters');
    expect(snap.current).toBeCloseTo(4.2, 5);
    expect(snap.daily.every((d) => d.value === 4.2)).toBe(true);
  });
});
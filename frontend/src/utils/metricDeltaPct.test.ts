import { describe, expect, it } from 'vitest';
import { calcMetricDeltaPct, getMetricDeltaPct } from './metricDeltaPct';

describe('calcMetricDeltaPct', () => {
  it('returns a signed percent when previous is non-zero', () => {
    expect(calcMetricDeltaPct(110, 100)).toBe(10);
    expect(calcMetricDeltaPct(90, 100)).toBe(-10);
  });

  it('treats empty-to-empty as 0 and growth from zero as 100', () => {
    expect(calcMetricDeltaPct(0, 0)).toBe(0);
    expect(calcMetricDeltaPct(50, 0)).toBe(100);
  });
});

describe('getMetricDeltaPct', () => {
  it('reads 7/30/90d percents from multi-period stats', () => {
    const stats = {
      d7: { current: { views: 120 }, previous: { views: 100 } },
      d30: { current: { views: 200 }, previous: { views: 100 } },
      d90: { current: { views: 90 }, previous: { views: 100 } },
    };
    expect(getMetricDeltaPct(7, 'views', stats, [], false)).toBe(20);
    expect(getMetricDeltaPct(30, 'views', stats, [], false)).toBe(100);
    expect(getMetricDeltaPct(90, 'views', stats, [], false)).toBe(-10);
  });

  it('reads watchTime aliases used by postgres and live pills', () => {
    const stats = {
      d30: {
        current: { watch_time: 40 },
        previous: { minutesWatched: 20 },
      },
    };
    expect(getMetricDeltaPct(30, 'watchTime', stats, [], false)).toBe(100);
  });

  it('aggregates raw YouTube report rows when stats were not flattened', () => {
    const report = (views: number) => ({
      columnHeaders: [{ name: 'day' }, { name: 'views' }],
      rows: [['2026-08-01', views]],
    });
    const stats = {
      d7: { current: report(20), previous: report(10) },
    };
    expect(getMetricDeltaPct(7, 'views', stats, [], false)).toBe(100);
  });

  it('falls back to chart series when pill stats are missing', () => {
    const chartData = Array.from({ length: 14 }, (_, i) => ({
      date: `2026-08-${String(i + 1).padStart(2, '0')}`,
      views: i < 7 ? 10 : 20,
      minutesWatched: 1,
      retention: 5,
    }));
    expect(getMetricDeltaPct(7, 'views', null, chartData, false)).toBe(100);
    expect(getMetricDeltaPct(7, 'views', undefined, chartData, false)).toBe(100);
  });
});

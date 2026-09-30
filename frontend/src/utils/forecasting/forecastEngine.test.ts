import { describe, expect, it } from 'vitest';
import { holtForecast, linearRegressionForecast, smaForecast, winsorize } from './forecastModels';
import { selectBestModel } from './forecastBacktest';
import { forecastNumericSeries, seriesForMetric } from './forecastEngine';
import { InsufficientDataError, MetricNotAvailableError } from './forecastTypes';
import { splineFrameAdds, yoyGrowthPct, rollingFrameAdds, snapAdds } from './goalForecast';

describe('forecast models', () => {
  it('picks linear regression on a perfectly linear series', () => {
    const series = Array.from({ length: 40 }, (_, i) => 10 + i * 2);
    const selected = selectBestModel(series);
    expect(selected.model).toBe('linear');
    expect(selected.mae).toBeLessThan(0.01);
  });

  it('SMA stays near the recent mean on a flat series', () => {
    const series = Array.from({ length: 14 }, () => 50);
    const pred = smaForecast(series, 3);
    expect(pred).toEqual([50, 50, 50]);
  });

  it('Holt follows a constant trend', () => {
    const series = Array.from({ length: 20 }, (_, i) => 5 + i);
    const pred = holtForecast(series, 2);
    expect(pred[0]).toBeGreaterThan(24);
    expect(pred[1]).toBeGreaterThan(pred[0]);
  });

  it('linear regression extrapolates y = a + b x', () => {
    const series = [0, 1, 2, 3, 4];
    const pred = linearRegressionForecast(series, 2);
    expect(pred[0]).toBeCloseTo(5, 8);
    expect(pred[1]).toBeCloseTo(6, 8);
  });
});

describe('anomaly down-weighting', () => {
  it('winsorize caps a 10x spike so trend models are not dragged', () => {
    const flat = Array.from({ length: 20 }, () => 10);
    flat[10] = 100;
    const capped = winsorize(flat, 3);
    expect(capped[10]).toBeLessThan(100);
    expect(capped[10]).toBeGreaterThan(10);

    const holtRaw = holtForecast(flat, 1)[0];
    const holtCap = holtForecast(capped, 1)[0];
    expect(Math.abs(holtCap - 10)).toBeLessThan(Math.abs(holtRaw - 10));
  });
});

describe('insufficient data', () => {
  it('returns null when the series is shorter than 5 points after lag strip', () => {
    expect(forecastNumericSeries([1, 2, 3, 4], 3, '2026-01-10', 'views')).toBeNull();
  });
});

describe('metric availability', () => {
  it('refuses CTR forecasting until impressions ingestion exists', () => {
    expect(() => seriesForMetric([{ date: '2026-01-01', views: 10, ctr: 5 }], 'ctr')).toThrow(
      MetricNotAvailableError,
    );
  });

  it('throws when required engagement fields are missing', () => {
    expect(() => seriesForMetric([{ date: '2026-01-01', views: 10 }], 'engagement')).toThrow(
      InsufficientDataError,
    );
  });
});

describe('goal forecast helpers', () => {
  it('spline first frame uses the hint and remaining frames sum to the total', () => {
    const adds = splineFrameAdds(100, 4, 15);
    expect(adds[0]).toBe(15);
    expect(adds.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 8);
    expect(adds[1]).toBeLessThanOrEqual(adds[adds.length - 1] + 1e-9);
  });

  it('each subframe uses the three periods immediately before it', () => {
    const history = [10, 20, 30];
    const adds = rollingFrameAdds(100, 4, history);
    expect(adds).toHaveLength(4);
    expect(adds.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 8);
    const q1 = (10 + 20 + 30) / 3;
    const q2 = (20 + 30 + q1) / 3;
    expect(adds[0] / adds[1]).toBeCloseTo(q1 / q2, 5);
  });

  it('snaps view/sub adds to integers without losing the total', () => {
    const snapped = snapAdds([10.4, 20.4, 30.2], 61, true);
    expect(snapped.every((n) => Number.isInteger(n))).toBe(true);
    expect(snapped.reduce((a, b) => a + b, 0)).toBe(61);
  });

  it('computes last-year vs this-year growth', () => {
    expect(yoyGrowthPct(120, 100)).toBeCloseTo(20);
    expect(yoyGrowthPct(80, 100)).toBeCloseTo(-20);
    expect(yoyGrowthPct(10, 0)).toBeNull();
  });
});

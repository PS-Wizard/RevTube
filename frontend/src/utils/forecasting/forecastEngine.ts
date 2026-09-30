import { selectBestModel } from './forecastBacktest';
import { winsorize } from './forecastModels';
import {
  InsufficientDataError,
  MetricNotAvailableError,
  MIN_FORECAST_POINTS,
  YT_ANALYTICS_LAG_DAYS,
  type DailyMetricPoint,
  type ForecastMetric,
  type ForecastResult,
} from './forecastTypes';

function addUtcDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function stripLag(points: DailyMetricPoint[]): DailyMetricPoint[] {
  if (points.length <= YT_ANALYTICS_LAG_DAYS) return [];
  return points.slice(0, -YT_ANALYTICS_LAG_DAYS);
}

export function seriesForMetric(points: DailyMetricPoint[], metric: ForecastMetric): number[] {
  if (metric === 'ctr') {
    throw new MetricNotAvailableError('ctr');
  }

  const values: number[] = [];
  for (const p of points) {
    let v: number | undefined;
    switch (metric) {
      case 'views':
        v = p.views;
        break;
      case 'subscribers':
        if (p.subscribersGained === undefined && p.subscribersLost === undefined) {
          throw new InsufficientDataError('Subscriber daily deltas are missing');
        }
        v = (p.subscribersGained ?? 0) - (p.subscribersLost ?? 0);
        break;
      case 'engagement': {
        if (p.likes === undefined && p.comments === undefined) {
          throw new InsufficientDataError('Engagement fields are missing');
        }
        v = p.views > 0 ? (((p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0)) / p.views) * 100 : 0;
        break;
      }
      case 'retention':
        if (p.avgViewPercentage === undefined) {
          throw new InsufficientDataError('Retention (average view percentage) is missing');
        }
        v = p.avgViewPercentage;
        break;
      default:
        throw new MetricNotAvailableError(metric);
    }
    values.push(v);
  }
  return values;
}

export function forecastMetric(
  points: DailyMetricPoint[],
  metric: ForecastMetric,
  horizon: number,
  originDate?: string,
): ForecastResult | null {
  if (metric === 'ctr') {
    throw new MetricNotAvailableError('ctr');
  }

  const ready = stripLag(points);
  if (ready.length < MIN_FORECAST_POINTS) return null;

  const raw = seriesForMetric(ready, metric);
  if (raw.length < MIN_FORECAST_POINTS) return null;

  const series = winsorize(raw);
  const selected = selectBestModel(series);
  const predicted = selected.predict(series, horizon);
  const lastDate = originDate ?? ready[ready.length - 1].date;

  return {
    metric,
    modelUsed: selected.model,
    confidence: selected.confidence,
    generatedAt: new Date().toISOString(),
    points: predicted.map((value, i) => ({
      date: addUtcDays(lastDate, i + 1),
      predicted: value,
    })),
  };
}

export function forecastNumericSeries(
  series: number[],
  horizon: number,
  lastDate: string,
  metric: ForecastMetric,
): ForecastResult | null {
  if (metric === 'ctr') {
    throw new MetricNotAvailableError('ctr');
  }
  const trimmed = series.length > YT_ANALYTICS_LAG_DAYS ? series.slice(0, -YT_ANALYTICS_LAG_DAYS) : series;
  if (trimmed.length < MIN_FORECAST_POINTS) return null;
  const prepared = winsorize(trimmed);
  const selected = selectBestModel(prepared);
  const predicted = selected.predict(prepared, horizon);
  return {
    metric,
    modelUsed: selected.model,
    confidence: selected.confidence,
    generatedAt: new Date().toISOString(),
    points: predicted.map((value, i) => ({
      date: addUtcDays(lastDate, i + 1),
      predicted: value,
    })),
  };
}

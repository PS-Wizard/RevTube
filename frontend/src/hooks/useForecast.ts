import { useMemo } from 'react';
import { forecastMetric, forecastNumericSeries } from '../utils/forecasting/forecastEngine';
import {
  MetricNotAvailableError,
  type DailyMetricPoint,
  type ForecastMetric,
  type ForecastResult,
} from '../utils/forecasting/forecastTypes';

export function useForecast(
  points: DailyMetricPoint[] | number[] | undefined,
  metric: ForecastMetric,
  horizon: number,
  lastDate?: string,
): ForecastResult | null {
  return useMemo(() => {
    try {
      if (!points || points.length === 0 || horizon <= 0) return null;
      if (typeof points[0] === 'number') {
        if (!lastDate) return null;
        return forecastNumericSeries(points as number[], horizon, lastDate, metric);
      }
      return forecastMetric(points as DailyMetricPoint[], metric, horizon);
    } catch (err) {
      if (err instanceof MetricNotAvailableError) return null;
      return null;
    }
  }, [points, metric, horizon, lastDate]);
}

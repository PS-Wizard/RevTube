export type ForecastMetric = 'views' | 'subscribers' | 'engagement' | 'retention' | 'ctr';
export type ForecastModelId = 'sma' | 'holt' | 'linear';
export type ForecastConfidence = 'high' | 'medium' | 'low';

/** YouTube Analytics lag, matching goalsService D-1 plus one extra incomplete day. */
export const YT_ANALYTICS_LAG_DAYS = 2;

export const MIN_FORECAST_POINTS = 5;

export interface DailyMetricPoint {
  date: string;
  views: number;
  likes?: number;
  comments?: number;
  shares?: number;
  subscribersGained?: number;
  subscribersLost?: number;
  avgViewPercentage?: number;
  ctr?: number;
}

export interface ForecastPoint {
  date: string;
  predicted: number;
  lowerBound?: number;
  upperBound?: number;
}

export interface ForecastResult {
  metric: ForecastMetric;
  /** Internal only. Do not render this in the UI. */
  modelUsed: ForecastModelId;
  confidence: ForecastConfidence;
  points: ForecastPoint[];
  generatedAt: string;
}

export class InsufficientDataError extends Error {
  readonly code = 'INSUFFICIENT_DATA';
  constructor(message = 'Not enough data yet to forecast') {
    super(message);
    this.name = 'InsufficientDataError';
  }
}

export class MetricNotAvailableError extends Error {
  readonly code = 'METRIC_NOT_AVAILABLE';
  constructor(metric: ForecastMetric) {
    super(`${metric} forecasting is not yet available`);
    this.name = 'MetricNotAvailableError';
  }
}

export type ModelPredictFn = (train: number[], horizon: number) => number[];

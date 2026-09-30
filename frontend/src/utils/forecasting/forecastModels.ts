export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function meanAbsoluteError(predicted: number[], actual: number[]): number {
  const n = Math.min(predicted.length, actual.length);
  if (n === 0) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += Math.abs(predicted[i] - actual[i]);
  }
  return sum / n;
}

/** Cap outliers at mean ± k * stddev (keep the day, shrink the spike). */
export function winsorize(series: number[], k = 3): number[] {
  if (series.length < 3) return series.slice();
  const m = mean(series);
  const variance = mean(series.map((v) => (v - m) ** 2));
  const std = Math.sqrt(variance);
  if (std === 0) return series.slice();
  const lo = m - k * std;
  const hi = m + k * std;
  return series.map((v) => Math.min(hi, Math.max(lo, v)));
}

export function smaForecast(series: number[], horizon: number, n?: number): number[] {
  if (series.length === 0 || horizon <= 0) return [];
  const window = Math.min(n ?? 7, series.length);
  const avg = mean(series.slice(-window));
  return Array.from({ length: horizon }, () => avg);
}

export function holtForecast(series: number[], horizon: number, alpha = 0.3, beta = 0.1): number[] {
  if (series.length === 0 || horizon <= 0) return [];
  if (series.length === 1) return Array.from({ length: horizon }, () => series[0]);

  let level = series[0];
  let trend = series[1] - series[0];

  for (let t = 1; t < series.length; t++) {
    const prevLevel = level;
    level = alpha * series[t] + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
  }

  return Array.from({ length: horizon }, (_, h) => level + (h + 1) * trend);
}

export function linearRegressionForecast(series: number[], horizon: number): number[] {
  const n = series.length;
  if (n === 0 || horizon <= 0) return [];
  if (n === 1) return Array.from({ length: horizon }, () => series[0]);

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += series[i];
    sumXY += i * series[i];
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  const b = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  const a = (sumY - b * sumX) / n;

  return Array.from({ length: horizon }, (_, h) => a + b * (n + h));
}

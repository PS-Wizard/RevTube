import type { GoalMetric } from '../../types/goals';
import type { ForecastMetric } from './forecastTypes';

export function goalMetricToForecast(metric: GoalMetric): ForecastMetric {
  if (metric === 'engagement_rate') return 'engagement';
  return metric;
}

export function isLevelGoalMetric(metric: GoalMetric): boolean {
  return metric === 'ctr' || metric === 'engagement_rate' || metric === 'retention';
}

export function meanOf(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Cosine ease between first increment and remaining budget so Q1 is not an exponential jump. */
export function splineFrameAdds(
  remainingTotal: number,
  frameCount: number,
  firstAddHint?: number,
): number[] {
  if (frameCount <= 0) return [];
  if (frameCount === 1) return [remainingTotal];

  const equal = remainingTotal / frameCount;
  const first = firstAddHint !== undefined && Number.isFinite(firstAddHint)
    ? Math.max(0, Math.min(remainingTotal, firstAddHint))
    : equal;

  const restBudget = remainingTotal - first;
  const restCount = frameCount - 1;
  if (restCount === 0) return [first];

  const weights: number[] = [];
  for (let i = 0; i < restCount; i++) {
    const t = restCount === 1 ? 1 : i / (restCount - 1);
    const eased = 0.5 - 0.5 * Math.cos(Math.PI * t);
    weights.push(1 + eased);
  }
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const rest = weights.map((w) => (w / weightSum) * restBudget);
  return [first, ...rest];
}

export function snapAdds(adds: number[], remainingTotal: number, integer: boolean): number[] {
  if (!integer || adds.length === 0) return adds;
  const rounded = adds.map((v) => Math.round(v));
  const target = Math.round(remainingTotal);
  const drift = target - rounded.reduce((a, b) => a + b, 0);
  rounded[rounded.length - 1] += drift;
  return rounded;
}

/**
 * Each subframe add is the mean of the 3 same-granularity periods before it
 * (history Q-2, Q-1, Q0 for Q1; then Q-1, Q0, Q1 for Q2, and so on), then
 * scaled so the adds sum to remainingTotal.
 */
export function rollingFrameAdds(
  remainingTotal: number,
  frameCount: number,
  historyAdds: number[],
): number[] {
  if (frameCount <= 0) return [];
  if (frameCount === 1) return [remainingTotal];

  const prior = historyAdds.filter((n) => Number.isFinite(n));
  const raw: number[] = [];
  for (let i = 0; i < frameCount; i++) {
    const window = [...prior, ...raw].slice(-3);
    const hint = window.length > 0 ? meanOf(window) : remainingTotal / frameCount;
    raw.push(Math.max(0, hint));
  }
  const sum = raw.reduce((a, b) => a + b, 0);
  if (sum <= 0) {
    return Array.from({ length: frameCount }, () => remainingTotal / frameCount);
  }
  return raw.map((v) => (v / sum) * remainingTotal);
}

export function yoyGrowthPct(current: number, prior: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(prior) || prior === 0) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}

export function shiftDateByYears(iso: string, years: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y + years, m - 1, d));
  return dt.toISOString().slice(0, 10);
}

/**
 * Custom KPI cards (`custom:*` widgets) — pure helpers.
 *
 * Metric options reuse the `dashboard:channelAnalytics` registry (single
 * home for ids + labels); values resolve from the flattened channel
 * multi-period stats the channel tab query writes to the dashboard store.
 */

import {
  CHANNEL_ANALYTICS_CARD_SURFACE,
  getStatCardDefinitions,
} from '../../config/statCardRegistry';
import { formatSeconds } from '../../utils/timeUtils';
import type { CustomCardPeriod } from '../../stores/customCardsStore';

export interface CustomCardMetricOption {
  id: string;
  label: string;
}

/** Metric picker options for the custom-card builder. */
export function customCardMetricOptions(): CustomCardMetricOption[] {
  return getStatCardDefinitions(CHANNEL_ANALYTICS_CARD_SURFACE).map((d) => ({
    id: d.id,
    label: d.label,
  }));
}

const SECONDS_METRICS = new Set(['averageViewDuration']);
const PERCENT_METRICS = new Set(['viewerPercentage', 'cardClickRate', 'cardTeaserClickRate']);

/** Human value for a channel metric (missing data renders as `—`, never `0`). */
export function formatCustomCardValue(metric: string, value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  if (SECONDS_METRICS.has(metric)) return formatSeconds(value);
  if (PERCENT_METRICS.has(metric)) return `${value.toFixed(1)}%`;
  return Math.round(value).toLocaleString();
}

/** Period-over-period delta as a percent — re-exported shared helper. */
export { calcMetricDeltaPct } from '../../utils/metricDeltaPct';

/** `d7` | `d30` | `d90` window key for a builder period. */
export function windowKeyForPeriod(period: CustomCardPeriod): 'd7' | 'd30' | 'd90' {
  return `d${period}` as 'd7' | 'd30' | 'd90';
}

/** Form validation for the builder dialog; null when the input is valid. */
export function validateCustomCard(input: {
  label: string;
  metric: string;
  period: unknown;
}): string | null {
  if (input.label.trim().length === 0) return 'Give the card a name.';
  if (input.label.trim().length > 60) return 'Keep the name under 60 characters.';
  const known = customCardMetricOptions().some((o) => o.id === input.metric);
  if (!known) return 'Pick a metric for the card.';
  if (input.period !== 7 && input.period !== 30 && input.period !== 90) {
    return 'Pick a comparison window.';
  }
  return null;
}

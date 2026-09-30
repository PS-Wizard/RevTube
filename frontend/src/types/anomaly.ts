/**
 * Anomaly detection surface types — the UI contract consumed by pages/anomalies.
 *
 * These do NOT mirror the backend wire shape 1:1: `services/anomalyService.ts`
 * normalizes raw payloads (`baselineValue`/`actualValue`/`unit`/`ai`, evidence
 * `{key,label}` signals, series `anomaly` markers) into these types at the
 * fetch boundary, so no component ever reads an unmapped field.
 */

export type AnomalyKind = 'spike' | 'dip' | 'trend';
export type AnomalySeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type AnomalyStatus = 'open' | 'acknowledged' | 'dismissed';

export interface AnomalyDriver {
  videoId: string;
  title: string;
  thumbnail: string | null;
  deltaViews: number;
  /** Share of the day's total movement as a 0..1 fraction; null when the metric has no view-like base. */
  sharePct: number | null;
}

export interface AnomalyEvidenceSignal {
  signal: string;
  detail: string;
}

export interface AnomalyEvidence {
  /** One-line cause label for the list row (strongest signal). */
  summary: string;
  drivers: AnomalyDriver[];
  signals: AnomalyEvidenceSignal[];
}

export interface AnomalyExplanation {
  headline: string;
  summary: string;
  likelyCategory: string;
  confidence: 'low' | 'medium' | 'high';
  rootCauses: Array<{ signal: string; weight: number; explanation: string }>;
  impactAssessment: string;
  recommendedActions: string[];
  caveats: string[];
  generatedAt: string;
  model: string;
  cached: boolean;
  fallback: boolean;
}

export interface Anomaly {
  id: number;
  channelId: string;
  metric: string;
  metricLabel: string;
  metricUnit: string;
  anomalyDate: string;
  endDate: string | null;
  kind: AnomalyKind;
  severity: AnomalySeverity;
  score: number;
  baseline: number;
  actual: number;
  delta: number;
  deltaPct: number | null;
  zScore: number;
  windowDays: number;
  status: AnomalyStatus;
  evidence: AnomalyEvidence | null;
  explanation: AnomalyExplanation | null;
  detectedAt: string;
  updatedAt: string;
}

export interface AnomalyMetricMeta {
  key: string;
  label: string;
  unit: string;
  integer: boolean;
  direction: 'upGood' | 'downGood' | 'neutral';
}

export interface AnomalyCounts {
  total: number;
  critical: number;
  high: number;
  open: number;
}

export interface AnomalyListResult {
  items: Anomaly[];
  total: number;
  counts: AnomalyCounts;
}

export interface AnomalySeriesPoint {
  date: string;
  value: number;
  expected: number | null;
  isAnomaly: boolean;
}

/** Compact per-day marker returned by GET /anomalies/series (not a full Anomaly row). */
export interface AnomalySeriesMarker {
  id: number;
  date: string;
  kind: AnomalyKind;
  severity: AnomalySeverity;
  score: number;
  delta: number;
  deltaPct: number;
  status: AnomalyStatus;
}

export interface AnomalySeriesResult {
  channelId: string;
  metric: string;
  metricLabel: string;
  metricUnit: string;
  points: AnomalySeriesPoint[];
  anomalies: AnomalySeriesMarker[];
}

export interface AnomalyFilters {
  channelId?: string;
  metrics?: string[];
  kinds?: AnomalyKind[];
  severities?: AnomalySeverity[];
  statuses?: AnomalyStatus[];
  from?: string;
  to?: string;
}

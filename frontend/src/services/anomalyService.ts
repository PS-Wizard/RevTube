import { apiUrl } from '../utils/apiBase';
import { getFirebaseAuthHeader } from './authHeaders';
import { tryExtractUsage } from './analyticsService';
import type {
  Anomaly,
  AnomalyCounts,
  AnomalyEvidence,
  AnomalyEvidenceSignal,
  AnomalyExplanation,
  AnomalyFilters,
  AnomalyKind,
  AnomalyListResult,
  AnomalyMetricMeta,
  AnomalySeriesMarker,
  AnomalySeriesResult,
  AnomalySeverity,
  AnomalyStatus,
} from '../types/anomaly';

async function request<T>(path: string, init?: RequestInit, orgId?: string | null): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(await getFirebaseAuthHeader()),
      ...(orgId ? { 'X-Org-Id': orgId } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(
      (errBody as { error?: { message?: string } })?.error?.message ??
        `Anomaly API request failed (${res.status})`,
    );
  }
  const body = (await res.json()) as T;
  tryExtractUsage(body, path);
  return body;
}

function buildListQuery(filters: AnomalyFilters, limit: number, offset: number): string {
  const q = new URLSearchParams();
  if (filters.channelId) q.set('channelId', filters.channelId);
  if (filters.metrics?.length) q.set('metrics', filters.metrics.join(','));
  if (filters.kinds?.length) q.set('kinds', (filters.kinds as string[]).join(','));
  if (filters.severities?.length) q.set('severities', (filters.severities as string[]).join(','));
  if (filters.statuses?.length) q.set('statuses', (filters.statuses as string[]).join(','));
  if (filters.from) q.set('from', filters.from);
  if (filters.to) q.set('to', filters.to);
  q.set('limit', String(limit));
  q.set('offset', String(offset));
  return q.toString();
}

// ── Wire-shape normalization ─────────────────────────────────────────────────
// The backend (`backend/services/anomalyService.js` mapRow/getSeries) serializes
// baseline_value / actual_value / unit / ai and evidence `{ key, label }`
// signals; the app consumes the normalized Anomaly contract from
// types/anomaly.ts. Map once here so no component ever sees the raw payload —
// the list row previously read `anomaly.baseline` (undefined) and crashed with
// "Cannot read properties of undefined (reading 'toLocaleString')".

/** Explanation JSON as stored on the row / returned by POST /:id/explain. */
interface RawExplanation {
  source?: string;
  headline?: string;
  summary?: string;
  likelyCategory?: string;
  confidence?: number;
  rootCauses?: AnomalyExplanation['rootCauses'];
  impactAssessment?: string;
  recommendedActions?: Array<{ action?: string } | string>;
  caveats?: string[];
}

/** Evidence JSONB as written by buildEvidence — signals carry key+label, drivers thumbnailUrl. */
interface RawEvidence {
  summary?: string;
  signals?: Array<{ key?: string; label?: string; detail?: string }>;
  drivers?: Array<{
    videoId: string;
    title?: string;
    thumbnailUrl?: string | null;
    deltaViews?: number | string;
    sharePct?: number | null;
  }>;
}

/** Anomaly row as serialized by mapRow. */
interface RawAnomaly {
  id: number;
  channelId: string;
  metric: string;
  metricLabel: string;
  unit?: string;
  kind: AnomalyKind;
  severity: AnomalySeverity;
  score: number;
  anomalyDate: string;
  baselineValue?: number | string;
  actualValue?: number | string;
  delta: number;
  deltaPct: number;
  zScore: number;
  windowDays: number;
  status: AnomalyStatus;
  evidence?: RawEvidence | null;
  ai?: { explanation?: RawExplanation | null; model?: string | null; generatedAt?: string | null } | null;
  detectedAt: string;
  updatedAt: string;
}

/** Series payload as returned by getSeries: label/unit + per-point anomaly marker. */
interface RawSeries {
  channelId: string;
  metric: string;
  label?: string;
  unit?: string;
  points?: Array<{ date: string; value: number; expected?: number | null; anomaly?: unknown }>;
  anomalies?: Array<AnomalySeriesMarker>;
}

/** Backend confidence is a 0..1 score; the UI renders a band. */
function confidenceBand(value: unknown): AnomalyExplanation['confidence'] {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'medium';
  return n >= 0.7 ? 'high' : n >= 0.45 ? 'medium' : 'low';
}

/**
 * Map an explanation blob onto the UI contract: numeric confidence → band,
 * `{ action }` objects → strings, `source: 'rules'` → fallback flag. `meta`
 * supplies the row-level cache flags that live outside the blob itself.
 */
function normalizeExplanation(
  raw: RawExplanation | null | undefined,
  meta: { cached: boolean; model?: string | null; generatedAt?: string | null },
): AnomalyExplanation | null {
  if (!raw) return null;
  const actions = Array.isArray(raw.recommendedActions) ? raw.recommendedActions : [];
  return {
    headline: raw.headline ?? '',
    summary: raw.summary ?? '',
    likelyCategory: raw.likelyCategory ?? 'unknown',
    confidence: confidenceBand(raw.confidence),
    rootCauses: Array.isArray(raw.rootCauses) ? raw.rootCauses : [],
    impactAssessment: raw.impactAssessment ?? '',
    recommendedActions: actions
      .map((a) => (typeof a === 'string' ? a : a.action ?? ''))
      .filter((a) => a.length > 0),
    caveats: Array.isArray(raw.caveats) ? raw.caveats : [],
    generatedAt: meta.generatedAt ?? '',
    model: meta.model ?? '',
    cached: meta.cached,
    fallback: raw.source === 'rules',
  };
}

/** Map stored evidence: signal key/label → display label, driver thumbnailUrl → thumbnail. */
function normalizeEvidence(raw: RawEvidence | null | undefined): AnomalyEvidence {
  const signals: AnomalyEvidenceSignal[] = [];
  for (const s of raw?.signals ?? []) {
    if (!s?.detail) continue;
    signals.push({ signal: s.label || s.key || 'signal', detail: s.detail });
  }
  const drivers = (raw?.drivers ?? [])
    .filter((d) => !!d?.videoId)
    .map((d) => ({
      videoId: d.videoId,
      title: d.title || d.videoId,
      thumbnail: d.thumbnailUrl ?? null,
      deltaViews: Number(d.deltaViews ?? 0),
      sharePct: d.sharePct === null || d.sharePct === undefined ? null : Number(d.sharePct),
    }));
  return {
    summary: raw?.summary || signals[0]?.signal || '',
    drivers,
    signals,
  };
}

function normalizeAnomaly(raw: RawAnomaly): Anomaly {
  return {
    id: Number(raw.id),
    channelId: raw.channelId,
    metric: raw.metric,
    metricLabel: raw.metricLabel,
    metricUnit: raw.unit ?? '',
    anomalyDate: raw.anomalyDate,
    endDate: null,
    kind: raw.kind,
    severity: raw.severity,
    score: Number(raw.score),
    baseline: Number(raw.baselineValue ?? 0),
    actual: Number(raw.actualValue ?? 0),
    delta: Number(raw.delta),
    deltaPct: Number(raw.deltaPct),
    zScore: Number(raw.zScore),
    windowDays: Number(raw.windowDays),
    status: raw.status,
    evidence: normalizeEvidence(raw.evidence),
    explanation: normalizeExplanation(raw.ai?.explanation, {
      cached: true,
      model: raw.ai?.model,
      generatedAt: raw.ai?.generatedAt,
    }),
    detectedAt: raw.detectedAt,
    updatedAt: raw.updatedAt,
  };
}

function normalizeSeries(raw: RawSeries): AnomalySeriesResult {
  return {
    channelId: raw.channelId,
    metric: raw.metric,
    metricLabel: raw.label ?? raw.metric,
    metricUnit: raw.unit ?? '',
    points: (raw.points ?? []).map((p) => ({
      date: p.date,
      value: Number(p.value),
      expected: p.expected ?? null,
      isAnomaly: !!p.anomaly,
    })),
    anomalies: (raw.anomalies ?? []).map((m) => ({
      id: Number(m.id),
      date: m.date,
      kind: m.kind,
      severity: m.severity,
      score: Number(m.score),
      delta: Number(m.delta),
      deltaPct: Number(m.deltaPct),
      status: m.status,
    })),
  };
}

export async function getAnomalyMetrics(orgId?: string | null): Promise<{
  metrics: AnomalyMetricMeta[];
  kinds: AnomalyKind[];
  severities: AnomalySeverity[];
  statuses: AnomalyStatus[];
}> {
  return request('/anomalies/metrics', undefined, orgId);
}

export async function getAnomalies(
  filters: AnomalyFilters,
  limit = 50,
  offset = 0,
  orgId?: string | null,
): Promise<AnomalyListResult> {
  const data = await request<{
    items: RawAnomaly[];
    total: number;
    counts: AnomalyCounts;
  }>(`/anomalies?${buildListQuery(filters, limit, offset)}`, undefined, orgId);
  return {
    items: (data.items ?? []).map(normalizeAnomaly),
    total: Number(data.total ?? 0),
    counts: data.counts,
  };
}

export async function getAnomalySeries(
  channelId: string,
  metric: string,
  days = 60,
  orgId?: string | null,
): Promise<AnomalySeriesResult> {
  const q = new URLSearchParams({ channelId, metric, days: String(days) });
  const data = await request<RawSeries>(`/anomalies/series?${q.toString()}`, undefined, orgId);
  return normalizeSeries(data);
}

export async function getAnomaly(id: number, orgId?: string | null): Promise<Anomaly> {
  const data = await request<{ anomaly: RawAnomaly }>(`/anomalies/${id}`, undefined, orgId);
  return normalizeAnomaly(data.anomaly);
}

export async function setAnomalyStatus(
  id: number,
  status: AnomalyStatus,
  orgId?: string | null,
): Promise<void> {
  await request(`/anomalies/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }, orgId);
}

export async function scanAnomalies(
  channelId: string,
  orgId?: string | null,
): Promise<{ scanned: boolean; total: number; reason?: string }> {
  const body = await request<{ scanned?: boolean; stored?: number; detected?: number; reason?: string }>(
    '/anomalies/scan',
    { method: 'POST', body: JSON.stringify({ channelId }) },
    orgId,
  );
  return {
    scanned: !!body.scanned,
    total: Number(body.stored ?? body.detected ?? 0),
    ...(body.reason ? { reason: body.reason } : {}),
  };
}

export async function explainAnomaly(
  id: number,
  refresh = false,
  orgId?: string | null,
): Promise<AnomalyExplanation> {
  // The backend returns an envelope `{ anomaly, explanation, cached, source, model }`.
  const body = await request<{
    anomaly?: RawAnomaly;
    explanation?: RawExplanation | null;
    cached?: boolean;
    model?: string | null;
  }>(`/anomalies/${id}/explain${refresh ? '?refresh=true' : ''}`, { method: 'POST' }, orgId);
  const explanation = normalizeExplanation(body.explanation, {
    cached: !!body.cached,
    model: body.model ?? body.anomaly?.ai?.model,
    // Freshly generated responses carry no timestamp; the row does after refetch.
    generatedAt: body.cached ? body.anomaly?.ai?.generatedAt : new Date().toISOString(),
  });
  if (!explanation) throw new Error('Anomaly explanation was empty.');
  return explanation;
}

export type { AnomalySeverity };

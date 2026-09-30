/**
 * Anomaly detection configuration — single source of truth.
 *
 * Consumed by:
 *   · backend/services/anomalyService.js   (detection + attribution)
 *   · backend/ingestion/store.js           (catalog view snapshots)
 *   · backend/cron.js                      (scheduled scan + snapshot prune)
 *   · backend/routes/anomalies.js          (validation + metric metadata)
 *
 * KISS/DRY: metric labels, units and thresholds live here only. The API returns
 * each metric's label/unit so the frontend never mirrors this table.
 */

/** Severity buckets — score (0-100) → label. Ordered ascending. */
const SEVERITY_BUCKETS = [
  { min: 85, label: 'critical' },
  { min: 70, label: 'high' },
  { min: 50, label: 'medium' },
  { min: 30, label: 'low' },
  { min: 0, label: 'info' },
];

/**
 * Metric registry.
 *  · column      — source column on analytics_video_metrics_daily (filters_key = '')
 *  · derive      — optional (row) => number for metrics not stored directly
 *  · direction   — 'upGood' (a dip is bad), 'downGood' (a spike is bad), 'neutral'
 *  · minAbsDelta — absolute floor, scales with the metric's natural magnitude
 *  · minRelDelta — optional per-metric relative floor (defaults to the global one)
 *  · integer     — render without decimals
 */
const METRIC_REGISTRY = [
  { key: 'views', label: 'Views', unit: 'views', column: 'views', direction: 'upGood', minAbsDelta: 50, integer: true },
  { key: 'watchTime', label: 'Watch time', unit: 'minutes', column: 'estimated_minutes_watched', direction: 'upGood', minAbsDelta: 200, integer: true },
  { key: 'retention', label: 'Average view percentage', unit: '%', column: 'average_view_percentage', direction: 'neutral', minAbsDelta: 0, minRelDelta: 0.08 },
  { key: 'avgViewDuration', label: 'Average view duration', unit: 'seconds', column: 'average_view_duration', direction: 'upGood', minAbsDelta: 0, minRelDelta: 0.12 },
  { key: 'engagedViews', label: 'Engaged views', unit: 'views', column: 'engaged_views', direction: 'upGood', minAbsDelta: 20, integer: true },
  { key: 'subscribersGained', label: 'Subscribers gained', unit: 'subs', column: 'subscribers_gained', direction: 'upGood', minAbsDelta: 3, integer: true },
  { key: 'subscribersLost', label: 'Subscribers lost', unit: 'subs', column: 'subscribers_lost', direction: 'downGood', minAbsDelta: 3, integer: true },
  {
    key: 'netSubscribers',
    label: 'Net subscribers',
    unit: 'subs',
    derive: (row) => Number(row.subscribers_gained || 0) - Number(row.subscribers_lost || 0),
    direction: 'upGood',
    minAbsDelta: 3,
    integer: true,
  },
  { key: 'likes', label: 'Likes', unit: 'likes', column: 'likes', direction: 'upGood', minAbsDelta: 5, integer: true },
  { key: 'comments', label: 'Comments', unit: 'comments', column: 'comments', direction: 'upGood', minAbsDelta: 3, integer: true },
  { key: 'shares', label: 'Shares', unit: 'shares', column: 'shares', direction: 'upGood', minAbsDelta: 3, integer: true },
  { key: 'peakConcurrentViewers', label: 'Peak concurrent viewers', unit: 'viewers', column: 'peak_concurrent_viewers', direction: 'upGood', minAbsDelta: 20, integer: true },
];

const METRIC_BY_KEY = METRIC_REGISTRY.reduce((acc, m) => {
  acc[m.key] = m;
  return acc;
}, {});

/** SQL columns needed to build every metric series in one query. */
const METRIC_SOURCE_COLUMNS = [
  'metric_date',
  'views',
  'estimated_minutes_watched',
  'average_view_percentage',
  'average_view_duration',
  'engaged_views',
  'subscribers_gained',
  'subscribers_lost',
  'likes',
  'comments',
  'shares',
  'peak_concurrent_viewers',
];


const DEFAULTS = {
  /** Days of history pulled per channel (detection window + trailing baseline). */
  lookbackDays: 120,
  /** Trailing baseline window (days) used for the per-weekday median. */
  windowDays: 28,
  /** Consecutive same-direction days collapsed into a single 'trend' anomaly. */
  trendMinRunDays: 3,
  /** Minimum history before a channel is scanned (avoids false positives). */
  minHistoryDays: 21,
  /** Robust (modified) z-score threshold. */
  zThreshold: 3.5,
  /** Global relative floor: |delta| must be >= this share of the baseline. */
  minRelDelta: 0.15,
  /** Cap on stored anomalies per scan per channel. */
  maxPerScan: 200,
  /** Drop anomalies scoring below this (0-100) — keeps the list signal-dense. */
  minScore: 20,
  /** Catalog videos snapshotted per sync (top N by lifetime views). */
  snapshotMaxVideos: 200,
  /** Always snapshot videos published within this many days. */
  snapshotRecentDays: 90,
  /** Snapshot retention — older rows are pruned by the scheduled scan. */
  snapshotRetentionDays: 180,
  /** Auto-explain (AI) only for anomalies at/above this severity. */
  autoExplainSeverity: 'high',
  /** Hard cap on automatic AI explanations per scan per channel. */
  autoExplainMaxPerScan: 3,
  /** Ignore the last N days (YouTube Analytics reporting lag). */
  lagDays: 2,
};

function intFromEnv(raw, fallback) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function floatFromEnv(raw, fallback) {
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Resolve runtime config (env-overridable). Pure — safe to unit test. */
function getAnomalyConfig(env = process.env) {
  return {
    ...DEFAULTS,
    lookbackDays: intFromEnv(env.ANOMALY_LOOKBACK_DAYS, DEFAULTS.lookbackDays),
    windowDays: intFromEnv(env.ANOMALY_WINDOW_DAYS, DEFAULTS.windowDays),
    minHistoryDays: intFromEnv(env.ANOMALY_MIN_HISTORY_DAYS, DEFAULTS.minHistoryDays),
    zThreshold: floatFromEnv(env.ANOMALY_Z_THRESHOLD, DEFAULTS.zThreshold),
    minRelDelta: floatFromEnv(env.ANOMALY_MIN_REL_DELTA, DEFAULTS.minRelDelta),
    maxPerScan: intFromEnv(env.ANOMALY_MAX_PER_SCAN, DEFAULTS.maxPerScan),
    snapshotMaxVideos: intFromEnv(env.ANOMALY_SNAPSHOT_MAX_VIDEOS, DEFAULTS.snapshotMaxVideos),
    snapshotRecentDays: intFromEnv(env.ANOMALY_SNAPSHOT_RECENT_DAYS, DEFAULTS.snapshotRecentDays),
    snapshotRetentionDays: intFromEnv(env.ANOMALY_SNAPSHOT_RETENTION_DAYS, DEFAULTS.snapshotRetentionDays),
    autoExplainMaxPerScan: intFromEnv(env.ANOMALY_AUTO_EXPLAIN_MAX, DEFAULTS.autoExplainMaxPerScan),
    lagDays: intFromEnv(env.ANOMALY_LAG_DAYS, DEFAULTS.lagDays),
  };
}

/** Map a 0-100 score to a severity label. Pure. */
function severityFromScore(score) {
  const s = Number.isFinite(score) ? score : 0;
  return (SEVERITY_BUCKETS.find((b) => s >= b.min) || SEVERITY_BUCKETS[SEVERITY_BUCKETS.length - 1]).label;
}

const SEVERITY_RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

/** Severity ordering helper (e.g. "is this at least high?"). Pure. */
function severityAtLeast(severity, minSeverity) {
  return (SEVERITY_RANK[severity] ?? -1) >= (SEVERITY_RANK[minSeverity] ?? 0);
}

module.exports = {
  METRIC_REGISTRY,
  METRIC_BY_KEY,
  METRIC_SOURCE_COLUMNS,
  SEVERITY_BUCKETS,
  SEVERITY_RANK,
  DEFAULTS,
  getAnomalyConfig,
  severityFromScore,
  severityAtLeast,
};

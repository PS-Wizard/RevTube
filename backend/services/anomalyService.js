/**
 * Anomaly detection service.
 *
 * Deterministic engine (no AI) that scans a channel's persisted daily metric
 * series — `analytics_video_metrics_daily` with `filters_key = ''` — for spikes
 * and dips across 12 metrics, and attributes each one to the videos that moved.
 *
 * Why not the old heuristic (frontend resolveVideoAnomalyInsights):
 *   · Baseline = trailing per-WEEKDAY median (seasonality-aware) instead of a
 *     mean over the selected period, so one spike can no longer inflate σ and
 *     hide the anomalies after it (masking).
 *   · Scoring = robust modified z-score (MAD) → immune to outliers in the
 *     baseline itself; absolute floors scale per metric.
 *   · Every metric, not just views; each anomaly carries structured evidence
 *     (driver videos, uploads, correlated metric moves) so "why" is answerable.
 *   · Results are persisted (`analytics_anomalies`) → history, statuses, cached
 *     AI explanations, notifications, zero recomputation per page view.
 *
 * Pure helpers are exported separately so tests need no DB.
 */

const {
  METRIC_REGISTRY,
  METRIC_BY_KEY,
  METRIC_SOURCE_COLUMNS,
  getAnomalyConfig,
  severityFromScore,
  severityAtLeast,
} = require('../config/anomalyConfig');

/** MAD → σ consistency constant for the modified z-score. */
const MAD_SCALE = 0.6745;
/** Minimum same-weekday samples before weekday medians are trusted. */
const MIN_WEEKDAY_SAMPLES = 3;
/** Minimum points inside the trailing window before a day can be scored. */
const MIN_WINDOW_SAMPLES = 10;
/** Relative move treated as "flat" when describing correlated metrics. */
const FLAT_MOVE_REL = 0.05;
/** Days of context stored per anomaly for the detail chart + AI prompt. */
const CONTEXT_DAYS = 14;
/** Max driver videos stored per anomaly. */
const MAX_DRIVERS = 8;

// ── Pure date helpers (UTC, 'YYYY-MM-DD') ──────────────────────────────────

function dayStr(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function addDays(iso, n) {
  const d = new Date(`${dayStr(iso)}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dayOfWeek(iso) {
  return new Date(`${dayStr(iso)}T00:00:00.000Z`).getUTCDay();
}

function daysBetween(a, b) {
  return Math.round(
    (new Date(`${dayStr(b)}T00:00:00.000Z`).getTime() - new Date(`${dayStr(a)}T00:00:00.000Z`).getTime()) / 86400000,
  );
}

// ── Pure statistics ────────────────────────────────────────────────────────

function median(values) {
  const nums = (values || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!nums.length) return 0;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function mean(values) {
  const nums = (values || []).map(Number).filter(Number.isFinite);
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Median absolute deviation around the supplied centre. */
function medianAbsoluteDeviation(values, centre) {
  const nums = (values || []).map(Number).filter(Number.isFinite);
  if (!nums.length) return 0;
  const c = Number.isFinite(centre) ? centre : median(nums);
  return median(nums.map((v) => Math.abs(v - c)));
}

/** Clamp helper. */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Detect anomalies in ONE metric series. Pure — the unit-test entry point.
 * Returns anomalies newest-first; consecutive same-direction days collapse into
 * a single 'trend' record when the run reaches config.trendMinRunDays.
 */
function detectSeriesAnomalies(rawPoints, metricKey, config = getAnomalyConfig()) {
  const metric = METRIC_BY_KEY[metricKey];
  if (!metric) return [];

  const points = normalizeSeries(rawPoints);
  if (points.length < config.minHistoryDays) return [];

  const { expected, residual } = computeExpectedSeries(points, config.windowDays);
  const lastScorable = points.length - 1 - Math.max(0, config.lagDays);
  const minAbs = Number(metric.minAbsDelta) || 0;
  const minRel = Number.isFinite(metric.minRelDelta) ? metric.minRelDelta : config.minRelDelta;
  const candidates = [];

  for (let i = config.windowDays; i <= lastScorable; i += 1) {
    const windowResiduals = residual.slice(Math.max(0, i - config.windowDays), i);
    if (windowResiduals.length < MIN_WINDOW_SAMPLES) continue;

    const exp = expected[i];
    const res = residual[i];
    const absRes = Math.abs(res);
    if (absRes < minAbs) continue;

    const rel = Math.abs(exp) > 0 ? absRes / Math.abs(exp) : (absRes > 0 ? 1 : 0);
    if (rel < minRel) continue;

    const z = robustZScore(res, windowResiduals, {
      fallbackSpan: Math.max(minAbs * 2, Math.abs(exp) * 0.5),
      zThreshold: config.zThreshold,
    });
    if (Math.abs(z) < config.zThreshold) continue;

    const zPart = clamp((Math.abs(z) - config.zThreshold) / (config.zThreshold * 2), 0, 1);
    const relPart = clamp((rel - minRel) / Math.max(minRel, 0.5), 0, 1);
    const score = Math.round(clamp(100 * (0.6 * zPart + 0.4 * relPart), 0, 100));
    if (score < (config.minScore ?? 0)) continue;

    const ctxStart = Math.max(0, i - CONTEXT_DAYS);
    const ctxEnd = Math.min(points.length, i + CONTEXT_DAYS + 1);
    const context = [];
    for (let j = ctxStart; j < ctxEnd; j += 1) {
      context.push({ date: points[j].date, actual: points[j].value, expected: expected[j] });
    }

    candidates.push({
      metric: metricKey,
      metricLabel: metric.label,
      unit: metric.unit,
      integer: !!metric.integer,
      direction: res > 0 ? 'up' : 'down',
      kind: res > 0 ? 'spike' : 'dip',
      severity: severityFromScore(score),
      score,
      anomalyDate: points[i].date,
      baselineValue: exp,
      actualValue: points[i].value,
      delta: res,
      deltaPct: exp !== 0 ? res / Math.abs(exp) : 0,
      zScore: z,
      windowDays: config.windowDays,
      runLength: 1,
      runDays: [points[i].date],
      context,
    });
  }

  return mergeRuns(candidates, config);
}

/**
 * Collapse consecutive same-direction days into one record — a 3-day slide is
 * one trend, not three separate one-off dips. Representative = highest score;
 * runLength/runDays describe the whole run. Pure.
 */
function mergeRuns(candidates, config = getAnomalyConfig()) {
  const ordered = [...candidates].sort((a, b) => a.anomalyDate.localeCompare(b.anomalyDate));
  const merged = [];
  for (const item of ordered) {
    const prev = merged[merged.length - 1];
    const contiguous = prev && daysBetween(prev.anomalyDate, item.anomalyDate) <= 1 && prev.direction === item.direction;
    if (!contiguous) {
      merged.push({ ...item, runLength: 1, runDays: [...item.runDays] });
      continue;
    }
    prev.runLength += 1;
    prev.runDays.push(item.anomalyDate);
    if (item.score > prev.score) {
      const runLength = prev.runLength;
      const runDays = prev.runDays;
      Object.assign(prev, item, { runLength, runDays });
    }
  }
  return merged
    .map((item) => (item.runLength >= (config.trendMinRunDays || 3) ? { ...item, kind: 'trend' } : item))
    .sort((a, b) => b.anomalyDate.localeCompare(a.anomalyDate));
}

// ── Deterministic cause analysis (evidence + local explanation) ────────────

/** Classify a same-day metric move as up / down / flat. Pure. */
function classifyMovement(current, expected) {
  const delta = Number(current) - Number(expected);
  if (!expected) return { delta, deltaPct: 0, direction: delta === 0 ? 'flat' : delta > 0 ? 'up' : 'down' };
  const deltaPct = delta / Math.abs(expected);
  const direction = Math.abs(deltaPct) < FLAT_MOVE_REL ? 'flat' : delta > 0 ? 'up' : 'down';
  return { delta, deltaPct, direction };
}

/**
 * Which OTHER metrics moved on the same day — the correlation story shared by
 * the deterministic signals, the UI and the AI prompt. Pure.
 */
function summarizeMovements(seriesByMetric, anomalyDate, windowDays, primaryMetric) {
  const out = [];
  for (const metric of METRIC_REGISTRY) {
    if (metric.key === primaryMetric) continue;
    const points = normalizeSeries(seriesByMetric[metric.key] || []);
    const idx = points.findIndex((p) => p.date === anomalyDate);
    if (idx < windowDays) continue;
    const expected = expectedAt(points, idx, windowDays);
    const move = classifyMovement(points[idx].value, expected);
    if (move.direction === 'flat') continue;
    out.push({
      metric: metric.key,
      label: metric.label,
      unit: metric.unit,
      expected,
      actual: points[idx].value,
      delta: move.delta,
      deltaPct: move.deltaPct,
      direction: move.direction,
    });
  }
  return out.sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));
}

/** Lookup a same-day movement by metric key. Pure. */
function movementFor(movements, key) {
  return (movements || []).find((m) => m.metric === key) || null;
}

/** Count how many drivers moved in the same direction as the anomaly. */
function splitDrivers(drivers) {
  const list = (drivers || []).filter((d) => d && Number.isFinite(Number(d.deltaViews)));
  const gainers = list.filter((d) => Number(d.deltaViews) > 0).sort((a, b) => Number(b.deltaViews) - Number(a.deltaViews));
  const losers = list.filter((d) => Number(d.deltaViews) < 0).sort((a, b) => Number(a.deltaViews) - Number(b.deltaViews));
  return { gainers, losers };
}

/**
 * Deterministic cause signals derived from the anomaly + correlated metric
 * moves + driver videos + nearby uploads. These power both the rule-based
 * explanation and the AI prompt (the AI reasons over this evidence and never
 * invents numbers). Pure.
 */
function buildSignals({ anomaly, movements = [], drivers = [], uploads = [], daysSinceUpload = null }) {
  const signals = [];
  const metric = anomaly.metric;
  const isUp = anomaly.direction === 'up';
  const topDriver = drivers[0] || null;
  const reachesViews = ['views', 'watchTime', 'engagedViews'].includes(metric);

  if (isUp && uploads.length && reachesViews) {
    const up = uploads[0];
    signals.push({
      key: 'upload',
      label: 'New upload drove the spike',
      detail: `"${up.title || up.videoId}" was published ${up.daysBefore === 0 ? 'the same day' : `${up.daysBefore}d before`} the spike.`,
      weight: 0.85,
    });
  }

  if (topDriver && Number(topDriver.sharePct) >= 0.25) {
    signals.push({
      key: 'driver',
      label: 'One video dominated the change',
      detail: `"${topDriver.title || topDriver.videoId}" moved ${Math.round(topDriver.deltaViews)} views (${Math.round(topDriver.sharePct * 100)}% of the day's total movement).`,
      weight: 0.8,
    });
  }

  const retention = movementFor(movements, 'retention');
  if (metric === 'views' && isUp && retention && retention.direction === 'down') {
    signals.push({
      key: 'retention-divergence',
      label: 'Views rose while retention fell',
      detail: `Average view percentage moved ${(retention.deltaPct * 100).toFixed(1)}% — the traffic is shallower than usual (typically external, Browse/suggested or a viral Short).`,
      weight: 0.7,
    });
  }

  const subsGained = movementFor(movements, 'subscribersGained');
  const netSubs = movementFor(movements, 'netSubscribers');
  const subsDown = (netSubs && netSubs.direction === 'down') || (subsGained && subsGained.direction === 'down');
  if (!isUp && reachesViews && subsDown) {
    signals.push({
      key: 'algorithm',
      label: 'Subscriptions moved with views',
      detail: 'Subscription gains fell alongside views — the signature of a distribution (impressions/algorithm) shift rather than one video under-performing.',
      weight: 0.75,
    });
  }

  if (['likes', 'comments', 'shares'].includes(metric)) {
    signals.push({
      key: 'engagement',
      label: 'Engagement-only move',
      detail: `Only ${String(anomaly.metricLabel || metric).toLowerCase()} moved sharply — a community/comment activity pattern rather than a reach change.`,
      weight: 0.5,
    });
  }

  const concurrency = movementFor(movements, 'peakConcurrentViewers');
  if (concurrency && concurrency.direction === anomaly.direction) {
    signals.push({
      key: 'concurrency',
      label: 'Concurrent viewers moved too',
      detail: 'Peak concurrent viewers moved the same way — a live stream / Premiere / watch-party pattern.',
      weight: 0.65,
    });
  }

  if (Array.isArray(anomaly.runDays) && Number(anomaly.runLength) >= 3) {
    signals.push({
      key: 'trend',
      label: `Multi-day ${anomaly.direction} trend`,
      detail: `${anomaly.metricLabel} sat ${isUp ? 'above' : 'below'} its expected level on ${anomaly.runLength} consecutive days (${anomaly.runDays[0]} → ${anomaly.runDays[anomaly.runDays.length - 1]}).`,
      weight: 0.6,
    });
  }

  if (!isUp && daysSinceUpload !== null && daysSinceUpload > 14) {
    signals.push({
      key: 'content-gap',
      label: 'Upload gap',
      detail: `No new upload in ${daysSinceUpload} days before the dip.`,
      weight: 0.55,
    });
  }

  if (!uploads.length && !topDriver) {
    signals.push({
      key: 'no-driver',
      label: 'No single video explains this',
      detail: 'No upload landed nearby and no individual video moved enough to account for the change — external traffic, algorithm or seasonality are the likely drivers.',
      weight: 0.45,
    });
  }

  return signals.sort((a, b) => b.weight - a.weight).slice(0, 6);
}

// ── Rule-based explanation (always-available fallback for the AI) ──────────

/** Strongest signal → likely cause category. Drives copy + recommendations. */
const SIGNAL_CATEGORY = {
  upload: 'upload',
  driver: 'content',
  'retention-divergence': 'externalTraffic',
  algorithm: 'algorithm',
  engagement: 'engagement',
  concurrency: 'live',
  trend: 'trend',
  'content-gap': 'content',
  'no-driver': 'unknown',
};

const CATEGORY_GUIDANCE = {
  upload: [
    'Ride the momentum: end-screen or pin a comment pointing at the next upload within 48h.',
    'Check which traffic source carried the spike and repeat that surface (Shorts feed, suggested, Browse).',
  ],
  content: [
    'Compare the dominant video against the rest (topic, thumbnail, hook) and reuse what it has.',
    'Hold the same publishing cadence for the next 7 days so the algorithm keeps testing the format.',
  ],
  externalTraffic: [
    'Open the Traffic sources report for that day to confirm the source before acting on it.',
    'Expect retention to normalise — do not plan future content around shallow viral traffic.',
  ],
  algorithm: [
    'Rule out external factors first (policy notices, monetisation changes, seasonality) before changing content.',
    'Keep the upload schedule steady; reach dips recover faster when output does not change.',
  ],
  engagement: [
    'Reply to the comment wave — the thread itself is driving additional watch time.',
    'Re-ask the same question in the next video or community post to repeat the engagement.',
  ],
  live: [
    'Reuse the live/Premiere format that produced the concurrent-viewer peak.',
    'Clip the strongest moments into Shorts to convert the temporary peak into evergreen views.',
  ],
  trend: [
    'Treat this as a trend, not a single day — compare the whole run with the previous period first.',
    'If the run is down, audit the packaging (thumbnails/titles) of the last uploads before changing topics.',
  ],
  unknown: [
    'Check Traffic sources and Geography for that day — the answer is usually in the source split.',
    'Ask the AI assistant to break the anomaly down further with a channel-specific question.',
  ],
};

/**
 * Rule-based explanation used when AI is disabled, unavailable or fails, so the
 * "why" panel is never empty and the page never blocks on an LLM call. Pure.
 */
function explainLocally({ anomaly, evidence = {} }) {
  const signals = evidence.signals || [];
  const drivers = evidence.drivers || [];
  const movements = evidence.movements || [];
  const category = SIGNAL_CATEGORY[signals[0]?.key] || 'unknown';
  const pct = `${anomaly.deltaPct > 0 ? '+' : ''}${(Number(anomaly.deltaPct) * 100).toFixed(1)}%`;
  const headline = `${anomaly.metricLabel} ${anomaly.direction === 'up' ? 'spiked' : 'dipped'} ${pct} on ${anomaly.anomalyDate}`;
  return {
    source: 'rules',
    headline,
    summary: [
      `Expected about ${Math.round(Number(anomaly.baselineValue))} ${anomaly.unit} (weekday baseline); actual was ${Math.round(Number(anomaly.actualValue))}.`,
      signals.length ? signals[0].detail : 'No dominant single cause was detected from the available data.',
    ].join(' '),
    likelyCategory: category,
    confidence: Math.min(0.85, 0.35 + signals.length * 0.1),
    rootCauses: signals.map((s) => ({ signal: s.key, weight: s.weight, explanation: s.detail })),
    impactAssessment: `${anomaly.metricLabel} moved ${Math.round(Number(anomaly.delta))} ${anomaly.unit} (${pct}) versus its weekday baseline${Number(anomaly.runLength) > 1 ? `, part of a ${anomaly.runLength}-day run` : ''}.`,
    recommendedActions: (CATEGORY_GUIDANCE[category] || CATEGORY_GUIDANCE.unknown).map((action, i) => ({
      action,
      rationale: i === 0 ? 'Highest-leverage follow-up for this pattern.' : 'Secondary check to confirm the pattern.',
      priority: i === 0 ? 'high' : 'medium',
    })),
    caveats: [
      'Derived from detected metric movements and per-video view snapshots; YouTube does not expose the exact cause.',
      drivers.length
        ? 'Driver videos are ranked from daily catalog snapshots (refreshed every sync).'
        : 'No per-video snapshot was available for this day.',
      movements.length
        ? `${movements.length} other metric(s) moved materially the same day.`
        : 'No other metric moved materially the same day.',
    ],
  };
}

// ── Service factory (Postgres-backed) ──────────────────────────────────────

/** Channel-wide daily series written by ingestion (filters_key = ''). */
function dailySeriesSql() {
  return `SELECT ${METRIC_SOURCE_COLUMNS.join(', ')}
     FROM analytics_video_metrics_daily
     WHERE channel_id = $1
       AND filters_key = ''
       AND metric_date BETWEEN $2::date AND $3::date
     ORDER BY metric_date ASC`;
}

function createAnomalyService(deps = {}) {
  const {
    query: rawQuery,
    isPostgresConfigured,
    deepSeekJson,
    notificationService,
    buildExplainPrompt,
    buildBatchExplainPrompt,
    normalizeExplanation,
  } = deps;
  const configProvider = deps.getAnomalyConfig || getAnomalyConfig;
  const aiModel = deps.deepSeekModel || process.env.DEEPSEEK_MODEL || 'deepseek-chat';

  function pgReady() {
    return typeof isPostgresConfigured === 'function' ? isPostgresConfigured() : true;
  }

  async function loadDailyRows(channelId, startDate, endDate) {
    if (!pgReady()) return [];
    const res = await rawQuery(dailySeriesSql(), [channelId, startDate, endDate]);
    return res?.rows || [];
  }

  /**
   * Build one series per metric from a single daily-rows fetch. Metrics the
   * channel has no data for at all (all zeros, e.g. no subs activity) are
   * skipped so they can never produce noise anomalies.
   */
  function buildSeriesByMetric(rows) {
    const out = {};
    for (const metric of METRIC_REGISTRY) {
      const series = (rows || [])
        .map((row) => ({
          date: dayStr(row.metric_date),
          value: metric.derive ? metric.derive(row) : Number(row[metric.column] || 0),
        }))
        .filter((p) => !!p.date && Number.isFinite(p.value));
      if (series.length && series.some((p) => p.value !== 0)) out[metric.key] = series;
    }
    return out;
  }

  /** Ranked per-video movement for a day, from the dated catalog snapshots. */
  async function fetchDriverRows(channelId, anomalyDate, limit = MAX_DRIVERS) {
    if (!pgReady()) return [];
    const res = await rawQuery(
      `WITH snapshots AS (
         SELECT video_id, snapshot_date, view_count,
                LAG(view_count) OVER (PARTITION BY video_id ORDER BY snapshot_date) AS prev_views,
                LAG(snapshot_date) OVER (PARTITION BY video_id ORDER BY snapshot_date) AS prev_date
         FROM analytics_video_view_snapshots
         WHERE channel_id = $1
           AND snapshot_date <= $2::date
       )
       SELECT s.video_id, v.title, v.thumbnail_url, v.published_at,
              s.prev_date, s.snapshot_date, s.prev_views, s.view_count,
              (s.view_count - s.prev_views) AS delta_views
       FROM snapshots s
       JOIN analytics_videos v ON v.video_id = s.video_id
       WHERE s.snapshot_date = $2::date
         AND s.prev_views IS NOT NULL
       ORDER BY ABS(s.view_count - s.prev_views) DESC
       LIMIT $3`,
      [channelId, anomalyDate, limit],
    );
    return res?.rows || [];
  }

  function mapDrivers(rows, { metricKey, actualValue }) {
    const viewLike = ['views', 'watchTime', 'engagedViews'].includes(metricKey);
    const base = viewLike && Number(actualValue) > 0 ? Math.abs(Number(actualValue)) : null;
    return (rows || []).map((r) => {
      const deltaViews = Number(r.delta_views || 0);
      return {
        videoId: r.video_id,
        title: r.title || r.video_id,
        thumbnailUrl: r.thumbnail_url || null,
        publishedAt: r.published_at ? dayStr(r.published_at) : null,
        prevDate: r.prev_date ? dayStr(r.prev_date) : null,
        snapshotDate: dayStr(r.snapshot_date),
        viewCount: Number(r.view_count || 0),
        deltaViews,
        sharePct: base ? Math.abs(deltaViews) / base : null,
      };
    });
  }

  /** Uploads published in the 2 days before (and including) the anomaly day. */
  async function fetchUploadsNear(channelId, anomalyDate, lookbackDays = 2) {
    if (!pgReady()) return [];
    const res = await rawQuery(
      `SELECT video_id, title, thumbnail_url, published_at, view_count
       FROM analytics_videos
       WHERE channel_id = $1
         AND published_at IS NOT NULL
         AND published_at::date BETWEEN ($2::date - $3::int) AND $2::date
       ORDER BY published_at DESC
       LIMIT 10`,
      [channelId, anomalyDate, lookbackDays],
    );
    return (res?.rows || []).map((r) => ({
      videoId: r.video_id,
      title: r.title || r.video_id,
      thumbnailUrl: r.thumbnail_url || null,
      publishedAt: dayStr(r.published_at),
      viewCount: Number(r.view_count || 0),
      daysBefore: Math.max(0, daysBetween(dayStr(r.published_at), anomalyDate)),
    }));
  }

  async function fetchLastUploadDate(channelId, anomalyDate) {
    if (!pgReady()) return null;
    const res = await rawQuery(
      `SELECT MAX(published_at)::date AS last_upload
       FROM analytics_videos
       WHERE channel_id = $1 AND published_at IS NOT NULL AND published_at::date <= $2::date`,
      [channelId, anomalyDate],
    );
    const value = res?.rows?.[0]?.last_upload;
    return value ? dayStr(value) : null;
  }

  async function fetchChannelTitle(channelId) {
    if (!pgReady()) return null;
    const res = await rawQuery(`SELECT title FROM analytics_channels WHERE channel_id = $1`, [channelId]);
    return res?.rows?.[0]?.title || null;
  }

  /**
   * Structured evidence stored on every anomaly: correlated metric moves, ranked
   * driver videos, nearby uploads, the deterministic signals and the ±14d
   * context. `memo` avoids re-querying when many metrics flag the same day.
   */
  async function buildEvidence({ channelId, anomaly, seriesByMetric, config, memo }) {
    const date = anomaly.anomalyDate;
    if (!memo.drivers.has(date)) memo.drivers.set(date, await fetchDriverRows(channelId, date));
    if (!memo.uploads.has(date)) memo.uploads.set(date, await fetchUploadsNear(channelId, date));
    if (!memo.lastUpload.has(date)) memo.lastUpload.set(date, await fetchLastUploadDate(channelId, date));

    const uploads = memo.uploads.get(date);
    const lastUpload = memo.lastUpload.get(date);
    const movements = summarizeMovements(seriesByMetric, date, config.windowDays, anomaly.metric);
    const drivers = mapDrivers(memo.drivers.get(date), {
      metricKey: anomaly.metric,
      actualValue: anomaly.actualValue,
    });
    const daysSinceUpload = lastUpload ? Math.max(0, daysBetween(lastUpload, date)) : null;
    const signals = buildSignals({ anomaly, movements, drivers, uploads, daysSinceUpload });

    return {
      method: 'weekday-median-mad',
      signals,
      movements: movements.slice(0, 8),
      drivers,
      uploads,
      daysSinceUpload,
      context: anomaly.context,
      seriesDays: (seriesByMetric[anomaly.metric] || []).length,
    };
  }

  /**
   * Idempotent write keyed on (channel, metric, day). Preserves the user's
   * status and any cached AI explanation; `is_new` says whether the row was
   * created by this call (used for one-shot notifications).
   */
  async function upsertAnomaly({ channelId, organizationId, anomaly, evidence }) {
    const res = await rawQuery(
      `INSERT INTO analytics_anomalies(
         channel_id, organization_id, metric, kind, severity, score, anomaly_date,
         baseline_value, actual_value, delta, delta_pct, z_score, method, window_days, run_length, evidence
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7::date,
         $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb
       )
       ON CONFLICT (channel_id, metric, anomaly_date) DO UPDATE SET
         organization_id = COALESCE(EXCLUDED.organization_id, analytics_anomalies.organization_id),
         kind = EXCLUDED.kind,
         severity = EXCLUDED.severity,
         score = EXCLUDED.score,
         baseline_value = EXCLUDED.baseline_value,
         actual_value = EXCLUDED.actual_value,
         delta = EXCLUDED.delta,
         delta_pct = EXCLUDED.delta_pct,
         z_score = EXCLUDED.z_score,
         method = EXCLUDED.method,
         window_days = EXCLUDED.window_days,
         run_length = EXCLUDED.run_length,
         evidence = EXCLUDED.evidence,
         detected_at = NOW(),
         updated_at = NOW()
       RETURNING id, (xmax = 0) AS is_new`,
      [
        channelId,
        organizationId || null,
        anomaly.metric,
        anomaly.kind,
        anomaly.severity,
        anomaly.score,
        anomaly.anomalyDate,
        anomaly.baselineValue,
        anomaly.actualValue,
        anomaly.delta,
        anomaly.deltaPct,
        anomaly.zScore,
        'weekday-median-mad',
        anomaly.windowDays,
        anomaly.runLength,
        JSON.stringify(evidence || {}),
      ],
    );
    const row = res?.rows?.[0];
    return { id: row ? Number(row.id) : null, isNew: !!row?.is_new };
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  function mapRow(row) {
    const metric = METRIC_BY_KEY[row.metric] || {};
    const delta = Number(row.delta);
    return {
      id: Number(row.id),
      channelId: row.channel_id,
      channelTitle: row.channel_title || null,
      metric: row.metric,
      metricLabel: metric.label || row.metric,
      unit: metric.unit || '',
      integer: !!metric.integer,
      kind: row.kind,
      direction: delta >= 0 ? 'up' : 'down',
      severity: row.severity,
      score: Number(row.score),
      anomalyDate: dayStr(row.anomaly_date),
      baselineValue: Number(row.baseline_value),
      actualValue: Number(row.actual_value),
      delta,
      deltaPct: Number(row.delta_pct),
      zScore: Number(row.z_score),
      runLength: Number(row.run_length || 1),
      windowDays: Number(row.window_days || 28),
      status: row.status,
      evidence: row.evidence || {},
      ai: row.ai_explanation
        ? { explanation: row.ai_explanation, model: row.ai_model, generatedAt: row.ai_generated_at }
        : null,
      detectedAt: row.detected_at,
      updatedAt: row.updated_at,
    };
  }

  function buildAnomalyWhere(filters, params) {
    const where = [];
    const p = (value) => {
      params.push(value);
      return `$${params.length}`;
    };
    if (filters.channelIds?.length) where.push(`a.channel_id = ANY(${p(filters.channelIds)}::text[])`);
    if (filters.metrics?.length) where.push(`a.metric = ANY(${p(filters.metrics)}::text[])`);
    if (filters.kinds?.length) where.push(`a.kind = ANY(${p(filters.kinds)}::text[])`);
    if (filters.severities?.length) where.push(`a.severity = ANY(${p(filters.severities)}::text[])`);
    if (filters.statuses?.length) where.push(`a.status = ANY(${p(filters.statuses)}::text[])`);
    if (filters.from) where.push(`a.anomaly_date >= ${p(filters.from)}::date`);
    if (filters.to) where.push(`a.anomaly_date <= ${p(filters.to)}::date`);
    if (filters.minScore != null) where.push(`a.score >= ${p(filters.minScore)}`);
    return where.length ? `WHERE ${where.join(' AND ')}` : '';
  }

  /**
   * Paged anomaly list, newest first (anomaly_date DESC, then detection time and
   * score) — the ordering the Anomalies page and the dashboard markers rely on.
   */
  async function getAnomalies(filters = {}) {
    const empty = { items: [], total: 0, counts: { total: 0, critical: 0, high: 0, open: 0 } };
    if (!pgReady()) return empty;

    const params = [];
    const whereSql = buildAnomalyWhere(filters, params);
    const countParams = [...params];
    const limit = clamp(Number(filters.limit) || 50, 1, 200);
    const offset = Math.max(0, Number(filters.offset) || 0);
    params.push(limit, offset);

    const [rowsRes, countRes] = await Promise.all([
      rawQuery(
        `SELECT a.*, c.title AS channel_title
         FROM analytics_anomalies a
         LEFT JOIN analytics_channels c ON c.channel_id = a.channel_id
         ${whereSql}
         ORDER BY a.anomaly_date DESC, a.detected_at DESC, a.score DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      ),
      rawQuery(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE a.severity = 'critical')::int AS critical,
                COUNT(*) FILTER (WHERE a.severity = 'high')::int AS high,
                COUNT(*) FILTER (WHERE a.status = 'open')::int AS open
         FROM analytics_anomalies a ${whereSql}`,
        countParams,
      ),
    ]);

    const countsRow = countRes?.rows?.[0] || {};
    return {
      items: (rowsRes?.rows || []).map(mapRow),
      total: Number(countsRow.total || 0),
      counts: {
        total: Number(countsRow.total || 0),
        critical: Number(countsRow.critical || 0),
        high: Number(countsRow.high || 0),
        open: Number(countsRow.open || 0),
      },
      limit,
      offset,
    };
  }

  async function getAnomaly(id) {
    if (!pgReady()) return null;
    const res = await rawQuery(
      `SELECT a.*, c.title AS channel_title
       FROM analytics_anomalies a
       LEFT JOIN analytics_channels c ON c.channel_id = a.channel_id
       WHERE a.id = $1`,
      [id],
    );
    const row = res?.rows?.[0];
    return row ? mapRow(row) : null;
  }

  const VALID_STATUSES = ['open', 'acknowledged', 'dismissed'];

  async function setStatus(id, status) {
    if (!VALID_STATUSES.includes(status)) throw new Error('validation_invalid_status');
    const res = await rawQuery(
      `UPDATE analytics_anomalies SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING id`,
      [id, status],
    );
    return !!res?.rows?.length;
  }

  /**
   * Channel daily series for one metric with the expected baseline and the
   * detected anomalies merged in — one call powers the detail chart AND the
   * dashboard "views" markers (replacing the old frontend-only detector).
   */
  async function getSeries({ channelId, metric = 'views', from, to, excludeDismissed = true } = {}) {
    const config = configProvider();
    const resolvedMetric = METRIC_BY_KEY[metric] ? metric : 'views';
    const endDate = to ? dayStr(to) : dayStr(new Date());
    const startDate = from ? dayStr(from) : addDays(endDate, -(config.lookbackDays - 1));
    const rows = await loadDailyRows(channelId, startDate, endDate);
    const series = buildSeriesByMetric(rows)[resolvedMetric] || [];
    const points = normalizeSeries(series);
    const { expected } = computeExpectedSeries(points, config.windowDays);

    let markers = [];
    if (pgReady() && points.length) {
      const res = await rawQuery(
        `SELECT id, anomaly_date, kind, severity, score, delta, delta_pct, status
         FROM analytics_anomalies
         WHERE channel_id = $1 AND metric = $2 AND anomaly_date BETWEEN $3::date AND $4::date
           ${excludeDismissed ? "AND status <> 'dismissed'" : ''}
         ORDER BY anomaly_date ASC`,
        [channelId, resolvedMetric, startDate, endDate],
      );
      markers = (res?.rows || []).map((r) => ({
        id: Number(r.id),
        date: dayStr(r.anomaly_date),
        kind: r.kind,
        severity: r.severity,
        score: Number(r.score),
        delta: Number(r.delta),
        deltaPct: Number(r.delta_pct),
        status: r.status,
      }));
    }

    const byDate = new Map(markers.map((m) => [m.date, m]));
    const descriptor = METRIC_BY_KEY[resolvedMetric];
    return {
      channelId,
      metric: resolvedMetric,
      label: descriptor.label,
      unit: descriptor.unit,
      integer: !!descriptor.integer,
      windowDays: config.windowDays,
      points: points.map((p, i) => ({
        date: p.date,
        value: p.value,
        expected: expected[i],
        anomaly: byDate.get(p.date) || null,
      })),
      anomalies: markers,
    };
  }

  /** Drop snapshot rows older than the retention window. */
  async function pruneSnapshots(retentionDays) {
    if (!pgReady()) return 0;
    const days = Math.max(30, Number(retentionDays) || 180);
    const res = await rawQuery(
      `DELETE FROM analytics_video_view_snapshots WHERE snapshot_date < CURRENT_DATE - $1::int`,
      [days],
    );
    return res?.rowCount || 0;
  }

  // ── Scan ─────────────────────────────────────────────────────────────────

  /**
   * Scan one channel: detect anomalies across every metric with data, attach
   * evidence, upsert them, then (optionally) notify a user on newly-detected
   * high/critical ones and auto-explain the top few with the LLM.
   *
   * `notifyUserId` is supplied by the route (the scanning user). Scheduled cron
   * scans pass nothing — recipient resolution for cron would need channel
   * ownership lookups, so cron stays silent by design (see docs/context).
   */
  async function scanChannel(channelId, opts = {}) {
    const config = configProvider();
    const endDate = opts.endDate ? dayStr(opts.endDate) : dayStr(new Date());
    const days = clamp(Number(opts.days) || config.lookbackDays, config.minHistoryDays + 5, 365);
    const startDate = addDays(endDate, -(days - 1));

    const rows = await loadDailyRows(channelId, startDate, endDate);
    if (rows.length < config.minHistoryDays) {
      return {
        channelId,
        scanned: false,
        reason: 'insufficient-history',
        historyDays: rows.length,
        metricsScanned: 0,
        detected: 0,
        stored: 0,
        pruned: 0,
        notified: 0,
        explained: 0,
        items: [],
      };
    }

    const seriesByMetric = buildSeriesByMetric(rows);
    const detected = [];
    for (const metric of METRIC_REGISTRY) {
      const series = seriesByMetric[metric.key];
      if (!series || series.length < config.minHistoryDays) continue;
      detected.push(...detectSeriesAnomalies(series, metric.key, config));
    }
    detected.sort((a, b) => b.anomalyDate.localeCompare(a.anomalyDate) || b.score - a.score);
    const capped = detected.slice(0, config.maxPerScan);

    const memo = { drivers: new Map(), uploads: new Map(), lastUpload: new Map() };
    const stored = [];
    for (const anomaly of capped) {
      const evidence = await buildEvidence({ channelId, anomaly, seriesByMetric, config, memo });
      const saved = await upsertAnomaly({
        channelId,
        organizationId: opts.organizationId,
        anomaly,
        evidence,
      });
      stored.push({ id: saved.id, isNew: saved.isNew, anomaly });
    }

    const notified = await notifyNewAnomalies(stored, config, opts);
    const pruned = await pruneSnapshots(config.snapshotRetentionDays);
    const explained = opts.autoExplain === false ? 0 : await autoExplain(stored, config);

    return {
      channelId,
      scanned: true,
      historyDays: rows.length,
      metricsScanned: Object.keys(seriesByMetric).length,
      detected: detected.length,
      stored: stored.length,
      pruned,
      notified,
      explained,
      items: stored.map((s) => ({
        id: s.id,
        metric: s.anomaly.metric,
        date: s.anomaly.anomalyDate,
        kind: s.anomaly.kind,
        severity: s.anomaly.severity,
        score: s.anomaly.score,
        deltaPct: s.anomaly.deltaPct,
        isNew: s.isNew,
      })),
    };
  }

  /** Notify the scanning user about newly-detected high/critical anomalies. */
  async function notifyNewAnomalies(stored, config, opts) {
    if (!notificationService?.createNotification || !opts.notifyUserId || !stored.length) return 0;
    const targets = stored.filter((s) => s.isNew && severityAtLeast(s.anomaly.severity, 'high'));
    let sent = 0;
    for (const target of targets.slice(0, 5)) {
      try {
        const pct = `${target.anomaly.deltaPct > 0 ? '+' : ''}${(target.anomaly.deltaPct * 100).toFixed(1)}%`;
        await notificationService.createNotification({
          userId: opts.notifyUserId,
          type: 'anomalyDetected',
          title: `${target.anomaly.severity === 'critical' ? 'Critical' : 'Notable'} ${target.anomaly.kind}: ${target.anomaly.metricLabel}`,
          body: `${target.anomaly.metricLabel} moved ${pct} on ${target.anomaly.anomalyDate} versus its weekday baseline.`,
          link: `/anomalies?id=${target.id}`,
        });
        sent += 1;
      } catch (err) {
        console.warn('[Anomaly] notification failed:', err.message);
      }
    }
    return sent;
  }

  /**
   * Explain one anomaly with the LLM, grounded strictly in the stored evidence,
   * cached on the row. Falls back to the deterministic rule-based explanation
   * when AI is unavailable or fails, so the page always has a "why".
   */
  async function explainAnomaly(id, { refresh = false } = {}) {
    const anomaly = await getAnomaly(id);
    if (!anomaly) return null;

    const cached = anomaly.ai?.explanation;
    if (cached && !refresh && cached.source !== 'rules') {
      return { anomaly, explanation: cached, cached: true, source: 'ai', model: anomaly.ai.model };
    }

    const fallback = explainLocally({ anomaly, evidence: anomaly.evidence || {} });
    if (!deepSeekJson || !buildExplainPrompt) {
      return { anomaly, explanation: fallback, cached: false, source: 'rules', aiAvailable: false };
    }

    try {
      const channelTitle = await fetchChannelTitle(anomaly.channelId);
      const prompt = buildExplainPrompt({ anomaly, channelTitle, evidence: anomaly.evidence || {} });
      const raw = await deepSeekJson({ prompt });
      const explanation = normalizeExplanation ? normalizeExplanation(raw, { anomaly }) : raw;
      if (!explanation) {
        return { anomaly, explanation: fallback, cached: false, source: 'rules', aiError: 'unparseable-response' };
      }
      await rawQuery(
        `UPDATE analytics_anomalies
         SET ai_explanation = $2::jsonb, ai_model = $3, ai_generated_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [id, JSON.stringify(explanation), aiModel],
      );
      return { anomaly, explanation, cached: false, source: 'ai', model: aiModel };
    } catch (err) {
      console.warn(`[Anomaly] AI explain failed for ${id}:`, err.message);
      return { anomaly, explanation: fallback, cached: false, source: 'rules', aiError: err.message };
    }
  }

  /** Auto-explain new high/critical anomalies in ONE LLM call — protects cost. */
  async function autoExplain(stored, config) {
    const ids = stored
      .filter((s) => s.isNew && s.id && severityAtLeast(s.anomaly.severity, config.autoExplainSeverity))
      .slice(0, config.autoExplainMaxPerScan)
      .map((s) => s.id);
    if (!ids.length) return 0;
    const result = await explainAnomaliesBatch(ids);
    return result.explained;
  }

  /**
   * Explain MULTIPLE anomalies with a SINGLE LLM call, grounded in each row's
   * stored evidence, caching every usable explanation on its row. Anomalies
   * that already carry an AI explanation are skipped (no wasted tokens);
   * entries the model garbles are left unexplained for the on-demand path.
   * Never throws — any failure degrades to `{ explained: 0 }`.
   */
  async function explainAnomaliesBatch(ids) {
    const list = [...new Set((Array.isArray(ids) ? ids : []).filter((id) => Number.isInteger(id) && id > 0))];
    if (!list.length) return { total: 0, explained: 0, results: [] };
    const pending = [];
    for (const id of list) {
      const anomaly = await getAnomaly(id);
      if (!anomaly) continue;
      const cached = anomaly.ai?.explanation;
      if (cached && cached.source !== 'rules') continue;
      pending.push({ id, anomaly, evidence: anomaly.evidence || {} });
    }
    if (!pending.length) return { total: 0, explained: 0, results: [] };
    if (!deepSeekJson || !buildBatchExplainPrompt) {
      return { total: pending.length, explained: 0, results: [], aiAvailable: false };
    }
    try {
      const channelTitle = await fetchChannelTitle(pending[0].anomaly.channelId);
      const prompt = buildBatchExplainPrompt({ items: pending, channelTitle });
      const raw = await deepSeekJson({ prompt });
      const byId = raw?.explanations && typeof raw.explanations === 'object' ? raw.explanations : {};
      let explained = 0;
      const results = [];
      for (const { id, anomaly } of pending) {
        const explanation = normalizeExplanation
          ? normalizeExplanation(byId[String(id)] ?? byId[id], { anomaly })
          : null;
        if (!explanation) {
          results.push({ id, source: 'unparsed' });
          continue;
        }
        await rawQuery(
          `UPDATE analytics_anomalies
           SET ai_explanation = $2::jsonb, ai_model = $3, ai_generated_at = NOW(), updated_at = NOW()
           WHERE id = $1`,
          [id, JSON.stringify(explanation), aiModel],
        );
        explained += 1;
        results.push({ id, source: 'ai' });
      }
      return { total: pending.length, explained, results };
    } catch (err) {
      console.warn(`[Anomaly] batch explain failed for ${pending.length} anomalies:`, err.message);
      return { total: pending.length, explained: 0, results: [], aiError: err.message };
    }
  }

  return {
    scanChannel,
    getAnomalies,
    getAnomaly,
    getSeries,
    setStatus,
    explainAnomaly,
    explainAnomaliesBatch,
    pruneSnapshots,
    buildSeriesByMetric,
    fetchDriverRows,
  };
}

module.exports = {
  addDays,
  dayStr,
  dayOfWeek,
  daysBetween,
  median,
  mean,
  medianAbsoluteDeviation,
  clamp,
  normalizeSeries,
  expectedAt,
  computeExpectedSeries,
  robustZScore,
  detectSeriesAnomalies,
  mergeRuns,
  classifyMovement,
  summarizeMovements,
  movementFor,
  splitDrivers,
  buildSignals,
  explainLocally,
  SIGNAL_CATEGORY,
  CATEGORY_GUIDANCE,
  createAnomalyService,
};



/** Normalise raw points ({date, value} | [date, value]) → sorted, finite, deduped. */
function normalizeSeries(rawPoints) {
  const byDate = new Map();
  for (const raw of rawPoints || []) {
    const date = dayStr(Array.isArray(raw) ? raw[0] : raw?.date);
    const value = Number(Array.isArray(raw) ? raw[1] : raw?.value);
    if (!date || !Number.isFinite(value)) continue;
    byDate.set(date, value);
  }
  return Array.from(byDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, value]) => ({ date, value }));
}

/**
 * Seasonality-aware expected value for point i: median of the SAME WEEKDAY in
 * the trailing window, falling back to the whole-window median when fewer than
 * MIN_WEEKDAY_SAMPLES same-weekday points exist. Pure.
 */
function expectedAt(points, i, windowDays) {
  const start = Math.max(0, i - windowDays);
  const sameWeekday = [];
  const window = [];
  for (let j = start; j < i; j += 1) {
    window.push(points[j].value);
    if (dayOfWeek(points[j].date) === dayOfWeek(points[i].date)) sameWeekday.push(points[j].value);
  }
  if (sameWeekday.length >= MIN_WEEKDAY_SAMPLES) return median(sameWeekday);
  return median(window);
}

/** Expected value + residual for every point of a series. Pure. */
function computeExpectedSeries(points, windowDays) {
  const expected = points.map((_, i) => (i === 0 ? points[0].value : expectedAt(points, i, windowDays)));
  const residual = points.map((p, i) => p.value - expected[i]);
  return { expected, residual };
}

/**
 * Robust modified z-score for one point, scaled by the residuals strictly
 * BEFORE it — so a big day can never inflate its own baseline (the masking
 * problem in the old ±σ implementation). Pure.
 */
function robustZScore(residual, windowResiduals, { fallbackSpan = 0, zThreshold = 3.5 } = {}) {
  let mad = medianAbsoluteDeviation(windowResiduals, median(windowResiduals));
  if (!mad) mad = mean(windowResiduals.map((r) => Math.abs(r)));
  if (mad > 0) return (MAD_SCALE * residual) / mad;
  // Perfectly flat baseline (MAD = 0): a move beyond the fallback span is
  // reported as just past the threshold instead of dividing by zero.
  if (fallbackSpan > 0 && Math.abs(residual) >= fallbackSpan) return Math.sign(residual) * zThreshold * 1.5;
  return 0;
}

# Anomaly Detection

Anomaly Detection finds the days a channel's performance broke pattern, and explains
why. It lives at `/anomalies`.

## Design principle: detection is deterministic, only explanation uses AI

This split is the single most important thing to understand about the subsystem.

- **Detection is pure statistics.** No LLM decides that something is anomalous. That
  makes results reproducible, testable, and free.
- **AI is only ever used to explain** a detection that deterministic code already
  made. If no AI key is configured, or the call fails, the user still gets a
  rule-based explanation.

An LLM asked "is this day weird?" produces different answers on repeated runs and
cannot be regression-tested. An LLM asked "why did this spike happen, given this
evidence?" is doing a task it is actually good at.

## Why the older heuristic was replaced

The previous approach (`frontend/src/utils/resolveVideoAnomalyInsights.ts`, still
present for the video-chart tooltip) had three defects:

1. **Masking.** The baseline was a mean over the selected period, so one large spike
   inflated σ and hid every anomaly after it.
2. **Fragile statistics.** A mean and standard deviation are not robust to outliers
   in the baseline itself.
3. **Views only.** No other metric was scanned, and no evidence was attached, so
   "why" was unanswerable.

The replacement uses a **trailing per-weekday median** baseline (seasonality-aware, so
weekends are not compared against weekdays) and a **robust modified z-score** based
on the median absolute deviation, which is immune to outliers in the baseline.

## Statistics

| Constant | Value | Purpose |
|---|---|---|
| `MAD_SCALE` | 0.6745 | MAD to σ consistency factor |
| `MIN_WEEKDAY_SAMPLES` | 3 | Minimum same-weekday samples before weekday medians are trusted |
| `MIN_WINDOW_SAMPLES` | 10 | Minimum points in the trailing window before a day is scorable |
| `FLAT_MOVE_REL` | 0.05 | Relative move treated as "flat" when correlating metrics |
| `CONTEXT_DAYS` | 14 | Days of context stored per anomaly for the chart and the prompt |
| `MAX_DRIVERS` | 8 | Max driver videos stored per anomaly |

## Configuration

[`backend/config/anomalyConfig.js`](../../backend/config/anomalyConfig.js) is the
single source of truth for metric labels, units, thresholds and severity buckets. The
API returns each metric's label and unit so the frontend never mirrors that table.

| Key | Default | Env override | Meaning |
|---|---|---|---|
| `lookbackDays` | 120 | `ANOMALY_LOOKBACK_DAYS` | History pulled per channel (window + trailing baseline) |
| `windowDays` | 28 | `ANOMALY_WINDOW_DAYS` | Trailing baseline window |
| `trendMinRunDays` | 3 | | Consecutive same-direction days collapsed into one `trend` |
| `minHistoryDays` | 21 | `ANOMALY_MIN_HISTORY_DAYS` | Minimum history before a channel is scanned |
| `zThreshold` | 3.5 | `ANOMALY_Z_THRESHOLD` | Robust modified z-score threshold |
| `minRelDelta` | 0.15 | `ANOMALY_MIN_REL_DELTA` | Global relative floor on the absolute delta |
| `maxPerScan` | 200 | `ANOMALY_MAX_PER_SCAN` | Cap on stored anomalies per scan |
| `minScore` | 20 | | Drop anomalies below this 0-100 score |
| `snapshotMaxVideos` | 200 | `ANOMALY_SNAPSHOT_MAX_VIDEOS` | Catalog videos snapshotted per sync |
| `snapshotRecentDays` | 90 | `ANOMALY_SNAPSHOT_RECENT_DAYS` | Always snapshot videos newer than this |
| `snapshotRetentionDays` | 180 | `ANOMALY_SNAPSHOT_RETENTION_DAYS` | Snapshot retention before prune |
| `autoExplainSeverity` | `high` | | Auto-explain AI threshold |
| `autoExplainMaxPerScan` | 3 | `ANOMALY_AUTO_EXPLAIN_MAX` | Hard cap on AI calls per scan |
| `lagDays` | 2 | `ANOMALY_LAG_DAYS` | Ignore the last N days (YouTube reporting lag) |

`lagDays` matters: YouTube Analytics reporting lags real time, so the most recent days
are always incomplete. Scoring them would generate anomalies out of missing data.

### Severity buckets

Score 0-100 maps to a label through `SEVERITY_BUCKETS`:
`>= 85 critical`, `>= 70 high`, `>= 50 medium`, `>= 30 low`, else `info`.
`severityAtLeast` gives ordering comparisons, used to decide auto-explanation.

## Metrics

Twelve metrics, all from `analytics_video_metrics_daily` with `filters_key = ''`:

| Key | Label | Unit | Direction | Absolute floor |
|---|---|---|---|---|
| `views` | Views | views | upGood | 50 |
| `watchTime` | Watch time | minutes | upGood | 200 |
| `retention` | Average view percentage | % | neutral | rel 0.08 |
| `avgViewDuration` | Average view duration | seconds | upGood | rel 0.12 |
| `engagedViews` | Engaged views | views | upGood | 20 |
| `subscribersGained` | Subscribers gained | subs | upGood | 3 |
| `subscribersLost` | Subscribers lost | subs | downGood | 3 |
| `netSubscribers` | Net subscribers | subs | upGood | 3 (derived) |
| `likes` | Likes | likes | upGood | 5 |
| `comments` | Comments | comments | upGood | 3 |
| `shares` | Shares | shares | upGood | 3 |
| `peakConcurrentViewers` | Peak concurrent viewers | viewers | upGood | 20 |


## Data sources

| Table | Role |
|---|---|
| `analytics_video_metrics_daily` | The daily series that is scanned |
| `analytics_video_view_snapshots` | Dated per-video lifetime counters for attribution |
| `analytics_anomalies` | Persisted detections, evidence and cached AI explanations |

`analytics_video_view_snapshots` is the reason attribution costs **zero extra YouTube
API calls**: the ingestion loop already refetches the catalog every 6 hours, and the
scraper snapshots those counters. True day-over-day per-video deltas are then a
subtract, not an API call.

## Kinds and statuses

| Kind | Meaning |
|---|---|
| `spike` | Single day materially above baseline |
| `dip` | Single day materially below baseline |
| `trend` | 3 or more consecutive same-direction days, collapsed into one record |

| Status | Meaning |
|---|---|
| `open` | Unreviewed (default) |
| `acknowledged` | Seen, no action needed |
| `dismissed` | Not a real signal |

## Endpoints

| Method | Path | Middleware | Notes |
|---|---|---|---|
| `GET` | `/api/anomalies/metrics` | `resolveUser` | Metric catalog for the filter bar, no DB work |
| `GET` | `/api/anomalies` | `analyticsReadLimiter`, `resolveUser` | Paged list, newest first |
| `GET` | `/api/anomalies/series` | `analyticsReadLimiter`, `resolveUser` | Daily series + expected baseline + markers |
| `GET` | `/api/anomalies/:id` | `analyticsReadLimiter`, `resolveUser` | One anomaly with evidence and cached AI |
| `PATCH` | `/api/anomalies/:id` | `resolveUser` | Acknowledge / dismiss / reopen |
| `POST` | `/api/anomalies/scan` | `analyticsReadLimiter`, `resolveUser`, `checkPremiumAccess('anomalies')`, `requireQuota('anomalies')` | Scan a channel now |
| `POST` | `/api/anomalies/:id/explain` | `resolveUser`, `checkPremiumAccess('anomalies')`, `requireQuota('anomalies')` | Generate or refresh the AI explanation |

`GET /api/anomalies` defaults to the caller's **connected channels** when no channel
filter is supplied, and returns an empty result rather than an error when the caller
has none. `POST /scan` verifies the requested channel is one of the caller's connected
channels and returns **403** otherwise.

## Evidence and attribution

Each anomaly stores structured evidence so "why" is answerable without re-querying:

- **Drivers**: up to 8 videos ranked by how much they moved, with `deltaViews` and
  `sharePct` of the total change, plus thumbnail URL.
- **Signals**: correlated metric moves on the same day.
- **Uploads**: whether a new video published that day, which often explains a spike
  with no further analysis.
- **Context**: 14 days of surrounding series for the detail chart and the AI prompt.

## AI explanation layer

`backend/services/anomalyPrompts.js` builds the prompts;
`videoAuditLLM.deepSeekJson` is the raw JSON LLM call.

Auto-explanation runs at **scan time** for anomalies at or above
`autoExplainSeverity`, capped at `autoExplainMaxPerScan` calls per scan per channel.
Batching is used (`buildBatchExplainPrompt`) so a scan with several high-severity
anomalies costs one call, not N.

Explanations are cached on the row (`ai_explanation`, `ai_model`, `ai_generated_at`).
`POST /:id/explain` returns the cached one unless `refresh=true`, and returns the
deterministic rule-based text when AI is unavailable.

The `anomalies` feature-config page gates both the scan and the explain endpoint.

## Storage

`analytics_anomalies` is uniquely keyed on `(channel_id, metric, anomaly_date)`, so
re-scanning a day **upserts** rather than duplicating history. It carries the full
statistical evidence (`baseline_value`, `actual_value`, `delta`, `delta_pct`,
`z_score`, `method`, `window_days`, `run_length`) plus the ranked driver payload and
the cached AI explanation. The foreign key to `analytics_channels` cascades on delete.

## Frontend

| Concern | File |
|---|---|
| Service (with wire-shape normalization) | `frontend/src/services/anomalyService.ts` |
| Query hooks | `frontend/src/hooks/queries/useAnomaliesQuery.ts` |
| Page | `frontend/src/pages/anomalies/` (`AnomaliesPage`, `useAnomalies`, `anomaliesUtils`, `components/`) |
| Types | `frontend/src/types/anomaly.ts` |

The service normalizes the backend wire shape (`baseline_value`, `actual_value`, the
`ai` envelope, evidence signals carrying `key` + `label`) into the app's `Anomaly`
contract. This matters: normalizing once in the service is what stopped components
from reading `anomaly.baseline` when the field is actually `baselineValue`, which
crashed the list with "Cannot read properties of undefined".

The AI panel is deliberately compact and shows no model or cache internals. The
detail dialog opens at 70% width, matching the other heavy dialogs in the app.

## Related

Video-chart tooltips still use the older local heuristic
(`resolveVideoAnomalyInsights`). It was intentionally left in place; deep integration
of the persisted detector into that chart is not done.

`direction` decides which way is bad. For `downGood` metrics a spike is the anomaly,
not a dip. `netSubscribers` is the one derived metric (gained minus lost); the rest
map straight to a column. The per-metric absolute floors scale with each metric's
natural magnitude, so 3 subscribers matters and 3 views does not.

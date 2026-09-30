## PostgreSQL Ingestion & Read Models

Relevant source files

-   [README.md](../README.md)
-   [backend/db/client.js](../../backend/db/client.js)
-   [backend/db/migrate.js](../../backend/db/migrate.js)
-   [backend/db/schema.js](../../backend/db/schema.js)
-   [backend/db/drizzle.js](../../backend/db/drizzle.js)
-   [backend/drizzle.config.js](../../backend/drizzle.config.js)
-   [backend/ingestion/readModels.js](../../backend/ingestion/readModels.js)
-   [backend/ingestion/readModelsDrizzle.js](../../backend/ingestion/readModelsDrizzle.js)
-   [backend/ingestion/store.js](../../backend/ingestion/store.js)
-   [backend/start.sh](../../backend/start.sh)
-   [PROJECT_GUIDE](../20-Reference/Legacy Project Guide)
-   [frontend/src/machines/dashboardMachine.ts](../../frontend/src/machines/dashboardMachine.ts)

RevTube utilizes a "PostgreSQL-first" analytics strategy to provide high-performance dashboarding and historical data tracking. While live data can be fetched from the YouTube API, the system prioritizes materialized data stored in PostgreSQL to support complex comparisons, trend analysis, and dashboard snapshots without hitting YouTube API quota limits on every page load [PROJECT_GUIDE#76-77](../20-Reference/Legacy Project Guide)

## System Overview

The PostgreSQL subsystem consists of a migration framework, an ingestion engine that maps YouTube API responses to relational tables, and a read model layer that provides optimized data bundles for the frontend.

### Data Flow: Ingestion to Read Model

The following diagram illustrates the lifecycle of analytics data from the external YouTube APIs into the PostgreSQL storage and finally to the React frontend via Read Models.

Analytics Data Lifecycle

Sources: [PROJECT_GUIDE#11-65](../20-Reference/Legacy Project Guide) [backend/ingestion/store.js#99-179](../../backend/ingestion/store.js) [backend/ingestion/readModels.js#166-200](../../backend/ingestion/readModels.js)

## Database Schema & Migrations

The database is managed via a custom migration runner located in `backend/db/migrate.js`. This runner executes versioned SQL scripts found in `backend/db/migrations/` and tracks state in a `schema_migrations` table [backend/db/migrate.js#5-12](../../backend/db/migrate.js)

### Core Tables

Sources: [backend/db/migrate.js#1-58](../../backend/db/migrate.js) [backend/ingestion/store.js#1-189](../../backend/ingestion/store.js) [PROJECT_GUIDE#140-145](../20-Reference/Legacy Project Guide)

## Ingestion Pipeline (`store.js`)

The ingestion layer is responsible for idempotent writes (upserts) to the database. It uses the `ON CONFLICT` PostgreSQL clause to ensure that daily metrics can be overwritten if a sync is re-run for the same date [backend/ingestion/store.js#112-121](../../backend/ingestion/store.js)

### Metric-group tolerance (resilient ingestion)

`ingestChannelDaily` no longer sends one mega-query to the YouTube Analytics API. YouTube rejects the **entire query** if any single metric is unsupported for a channel, so metrics are fetched in **five independent groups**, each degrading gracefully on a 400/403:

1. **Watch:** `views, estimatedMinutesWatched, averageViewPercentage, averageViewDuration, engagedViews`
2. **Engagement:** `subscribersGained, subscribersLost, likes, shares, comments`
3. **Viewer%:** `viewerPercentage`
4. **Cards:** all `card*` metrics
5. **Live:** `averageConcurrentViewers, peakConcurrentViewers` (live-stream-only; rejected for most channels)

Rejected groups log `[ingest] Skipping unsupported metric group (...)` as a warning; the run always succeeds with the supported metrics. `withRetry` preserves `err.response` so the tolerant handler can detect HTTP status. Rejected groups become zero-filled columns downstream — no schema changes needed.

### Privacy status persistence

`upsertVideos` stores `privacy_status` (canonical `public | unlisted | private`) from the Data API `videos.list?part=status`. Migration `backend/db/drizzle/0015_video_privacy_status.sql` adds the column; read models map it back as `privacyStatus`. This powers the dashboard's per-status video filtering — the frontend sends `privacy=public|private|unlisted|all` to the videos endpoints and the backend filters server-side with per-status cache keys (`p=` suffix).

### Key Functions

-   `normalizeFiltersKey(filters)`: Normalizes filter strings (e.g., specific video IDs) into a canonical format to ensure consistent indexing in the `filters_key` column [backend/ingestion/store.js#3-18](../../backend/ingestion/store.js)
-   `upsertVideos(channelId, videos)`: A transactional batch operation that updates video metadata. It uses `BEGIN/COMMIT` to ensure atomicity [backend/ingestion/store.js#51-97](../../backend/ingestion/store.js)
-   `upsertVideoMetricsDaily(channelId, rows, filters)`: Maps raw YouTube Analytics rows to the daily metrics table, associating them with a specific `filters_key` [backend/ingestion/store.js#99-143](../../backend/ingestion/store.js)

Sources: [backend/ingestion/store.js#1-190](../../backend/ingestion/store.js)

## Read Model Layer (`readModels.js`)

Read models provide a high-level API for the backend to retrieve analytics data without writing raw SQL in the route handlers. They handle date range calculations, comparison window logic, and data aggregation.

### Implementation Logic

The read models use `safeQuery` to gracefully handle missing tables (e.g., if migrations haven't run), falling back to live YouTube API paths where necessary [backend/ingestion/readModels.js#8-18](../../backend/ingestion/readModels.js)

## Stale LatestDate Override Flow

A common data freshness issue arises when the client caches a `latestDate` timestamp from a prior session (e.g., in Zustand or localStorage) while PostgreSQL has been updated with newer data by a subsequent cron ingestion cycle. The dashboard tab endpoint resolves this as follows:

```
Client request arrives with stale latestDate (e.g. "2026-07-05")
  ↓
  Redis cache miss (first request for this key)
  ↓
  PostgreSQL check: getLatestMetricDate(channelId, '')
  ↓
  If PG has a newer date (e.g. "2026-07-13"):
    → resolvedLatestDate overridden to PG date
    → response carries correct "As of Jul 13"
  ↓
  Cache warmed with corrected date
  → Subsequent requests for other tabs benefit immediately
```

This override runs on every uncached request — including when the cached probe is itself stale — so Postgres can always correct the anchor date regardless of which tab probes first. The corrected date is then cached under the standard `latestDate` cache key so all tabs share the same correct value.

Sources: [backend/routes/dashboardTabs.js#102-120](../../backend/routes/dashboardTabs.js) [backend/ingestion/readModels.js](../../backend/ingestion/readModels.js)

Read Model Interaction Map

Sources: [backend/ingestion/readModels.js#166-203](../../backend/ingestion/readModels.js) [backend/ingestion/readModels.js#25-38](../../backend/ingestion/readModels.js)

---

## Drizzle ORM Integration

RevTube has adopted **Drizzle ORM** as an optional, incrementally-adopted query layer alongside the existing raw-SQL read models. The Drizzle integration provides parameterized queries and type-safe schema definitions without replacing the existing infrastructure.

### Schema Definitions (`db/schema.js`)

All 7 analytics tables are defined as Drizzle `pgTable` objects:

| Drizzle export | PostgreSQL table | Purpose |
|---|---|---|
| `analyticsChannels` | `analytics_channels` | YouTube channel metadata |
| `analyticsVideos` | `analytics_videos` | Individual video metadata |
| `channelMetricsDaily` | `analytics_channel_metrics_daily` | Daily channel engagement |
| `videoMetricsDaily` | `analytics_video_metrics_daily` | Daily per-video metrics |
| `dashboardSnapshots` | `analytics_dashboard_snapshots` | Pre-computed JSONB snapshots |
| `userAccessFlags` | `user_access_flags` | User role and package |
| `syncRuns` | `analytics_sync_runs` | Ingestion audit log |

### Drizzle Instance (`db/drizzle.js`)

Singleton factory wrapping the shared `pg.Pool`:

```js
const db = drizzle(pool, { schema });
```

- **Lazy initialization**: `getDb()` returns `null` when Postgres is not configured — callers must null-check.
- **Shared pool**: Same `pg.Pool` as the application, no additional connection overhead.
- **Schema reference**: Passes all `pgTable` definitions to enable Drizzle's query builder.

### Read Models (`ingestion/readModelsDrizzle.js`)

Six parameterized replacements for the core analytics read functions, each with an identical signature to its counterpart in `readModels.js`:

| Drizzle function | Raw-SQL equivalent | Purpose |
|---|---|---|
| `loadBundleFromPostgres` | `loadBundleFromPostgres` | Channel metrics for dashboard chart |
| `loadBundleComparison` | `loadBundleComparison` | Previous-period comparison |
| `loadChannelTotals` | `loadChannelTotals` | Aggregated channel-level totals |
| `loadChartMetrics` | `loadChartMetrics` | Combined channel + video metrics |
| `loadBestTimeToPost` | `loadBestTimeToPost` | Hourly engagement distribution |
| `loadWeeklyEngagement` | `loadWeeklyEngagement` | Day-of-week engagement breakdown |

All queries use Drizzle's `sql`` tagged templates or query builder, guaranteeing every user-supplied value is passed as a bind parameter — zero SQL injection risk.

### Migration System

The migration runner (`db/migrate.js`) was rewritten to support Drizzle-generated `.sql` files:

- **Hash-based tracking**: Each migration is tracked by content hash (8-char hex, Bernstein/djb2 variant) in a `__drizzle_migrations` table, not by filename.
- **Drizzle-kit generate**: The Docker build runs `npx drizzle-kit generate` to auto-produce migration files from `schema.js` changes.
- **Custom SQL runner**: Uses `pg.Pool.query()` directly rather than Drizzle's built-in `migrate()`, which in drizzle-orm >= 0.45 fails on `CREATE TABLE` statements (`table.primaryKey is not a function`).

See [Drizzle ORM & Migration Runner](../07-Infrastructure & Deployment/03-Drizzle ORM & Migration Runner) for the complete Drizzle workflow.

---

### Key Read Model Functions

-   `loadBundleFromPostgres`: The primary loader for the main dashboard. It fetches current and previous period data, along with fixed windows (D7, D30, D90) to populate the comparison widgets [backend/ingestion/readModels.js#166-210](../../backend/ingestion/readModels.js)
-   `computeStatsFromReports`: Aggregates raw row data into summary statistics like `totalViews`, `avgViewPercentage`, and net subscriber growth [backend/ingestion/readModels.js#149-164](../../backend/ingestion/readModels.js)
-   `buildRange`: A utility that calculates start and end dates based on a provided `period` (days) relative to the `latestDate` available in the database [backend/ingestion/readModels.js#40-49](../../backend/ingestion/readModels.js)
-   `getLatestMetricDate(channelId, filtersKey)`: Returns the most recent date with metric data for a given channel from `analytics_video_metrics_daily`. Used by the dashboard tab endpoint to correct stale client `latestDate` values that may have been cached from a prior session. Without this function, a user opening the dashboard tab could see "As of Jul 5" when PostgreSQL already has data through Jul 13. [backend/ingestion/readModels.js#315](../../backend/ingestion/readModels.js) [backend/routes/dashboardTabs.js#105-120](../../backend/routes/dashboardTabs.js)
-   `loadChannelTotalsFromPostgres`: Aggregates channel-level metrics (views, watch_time, subscribers_gained/lost, likes, comments, shares) from `analytics_video_metrics_daily` with `filters_key = ''`, used to populate headline pill totals that are structurally consistent with chart bar data [backend/ingestion/readModels.js#includes](../../backend/ingestion/readModels.js)

Sources: [backend/ingestion/readModels.js#1-215](../../backend/ingestion/readModels.js)

## Startup & Connectivity

The backend initialization script (`start.sh`) ensures the database is ready before the application starts. It includes a retry loop that waits for the PostgreSQL port to become reachable, which is critical in Docker Compose environments where the database container may take longer to initialize than the Node.js process [backend/start.sh#12-31](../../backend/start.sh)

Once reachable, it executes `node db/migrate.js` to ensure the schema is up to date before calling `node index.js` [backend/start.sh#33-39](../../backend/start.sh)

Sources: [backend/start.sh#1-40](../../backend/start.sh) [backend/db/client.js#19-35](../../backend/db/client.js)
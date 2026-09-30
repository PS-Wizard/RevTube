## Database Schema & Migrations

Relevant source files

-   [backend/db/client.js](../../backend/db/client.js)
-   [backend/db/migrate.js](../../backend/db/migrate.js)
-   [backend/db/schema.js](../../backend/db/schema.js)
-   [backend/db/drizzle.js](../../backend/db/drizzle.js)
-   [backend/drizzle.config.js](../../backend/drizzle.config.js)
-   [backend/ingestion/readModels.js](../../backend/ingestion/readModels.js)
-   [backend/ingestion/readModelsDrizzle.js](../../backend/ingestion/readModelsDrizzle.js)
-   [backend/ingestion/store.js](../../backend/ingestion/store.js)
-   [backend/start.sh](../../backend/start.sh)

The RevTube (TubeKeter) backend utilizes a PostgreSQL database to implement a "postgres-first" analytics strategy. This system provides a materialized read model for YouTube Analytics data, enabling high-performance dashboard loading, historical trend analysis, and multi-period comparisons without hitting YouTube API quotas for every request [backend/ingestion/readModels.js#1-10](../../backend/ingestion/readModels.js)

---

## Data Architecture & Schema

The schema is designed around time-series metrics and video metadata. It supports both channel-level and video-level granularity, with a specialized `filters_key` mechanism to handle segmented data (e.g., specific video or playlist filters).

### Core Tables

| Table Name | Purpose | Key Columns |
| --- | --- | --- |
| `analytics_channels` | YouTube channel metadata (name, description, custom URL, country) | `channel_id` (PK), `title`, `custom_url`, `country` |
| `analytics_videos` | Stores metadata for all videos associated with tracked channels. | `video_id` (PK), `channel_id`, `tags` (JSONB), `view_count` |
| `analytics_video_metrics_daily` | Time-series metrics for videos, partitioned by date and filter. | `channel_id`, `metric_date`, `filters_key`, `views`, `estimated_minutes_watched` |
| `analytics_channel_metrics_daily` | Time-series metrics for the entire channel (e.g., subscriber churn). | `channel_id`, `metric_date`, `subscribers_gained`, `subscribers_lost` |
| `analytics_dashboard_snapshots` | Cached bundles of dashboard data for rapid retrieval. | `channel_id`, `snapshot_key`, `data` (JSONB) |
| `user_access_flags` | User role and package access control. | `user_id`, `role`, `package_type` |
| `analytics_sync_runs` | Audit log of background ingestion jobs. | `id`, `channel_id`, `status`, `stats` (JSONB), `error_message` |

### The Filter Key Mechanism

To support filtered analytics (e.g., viewing data for a specific subset of videos), the system uses `normalizeFiltersKey` [backend/ingestion/store.js#3-18](../../backend/ingestion/store.js) This function sorts and joins IDs to create a deterministic string (e.g., `video==id1,id2`) used as a unique constraint component in `analytics_video_metrics_daily` [backend/ingestion/store.js#100-111](../../backend/ingestion/store.js)

### Data Entity Map

The following diagram maps the logical data concepts to their implementation in the PostgreSQL schema and the ingestion logic.

Data Entity Mapping

Sources: [backend/ingestion/store.js#20-26](../../backend/ingestion/store.js) [backend/ingestion/store.js#51-97](../../backend/ingestion/store.js) [backend/ingestion/store.js#99-143](../../backend/ingestion/store.js) [backend/ingestion/store.js#145-179](../../backend/ingestion/store.js)

---

## Drizzle ORM Schema Definitions

All 7 analytics tables are defined as Drizzle `pgTable` objects in `backend/db/schema.js`. These definitions serve a dual purpose: they enable Drizzle's type-safe query builder for parameterized read models, and they serve as the source of truth for `drizzle-kit generate` to auto-produce migration SQL files.

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

### Drizzle Config (`drizzle.config.js`)

The configuration file for Drizzle Kit points to the schema file and the output directory for auto-generated migrations:

```js
export default {
  schema: './db/schema.js',
  out: './db/drizzle',
  dialect: 'postgresql',
};
```

Generated `.sql` files are output to `backend/db/drizzle/` and applied at startup by `node db/migrate.js`.

Sources: [backend/db/schema.js](../../backend/db/schema.js) [backend/db/drizzle.js](../../backend/db/drizzle.js) [backend/ingestion/readModelsDrizzle.js](../../backend/ingestion/readModelsDrizzle.js) [backend/drizzle.config.js](../../backend/drizzle.config.js)

---

## Migration System

RevTube uses a custom, lightweight migration runner located in `backend/db/migrate.js` that supports both traditional hand-authored SQL files and Drizzle-generated `.sql` files. The runner uses a **hash-based tracking** system to determine which migrations have already been applied.

### Migration Runner (`migrate.js`)

The runner performs the following steps:

1. **Configuration Check**: Verifies that PostgreSQL environment variables are set [backend/db/migrate.js#15-17](../../backend/db/migrate.js)
2. **Initialization**: Ensures both the `schema_migrations` table (legacy) **and** the `__drizzle_migrations` table exist. The `__drizzle_migrations` table records migrations by content hash, not by filename [backend/db/migrate.js#5-12](../../backend/db/migrate.js)
3. **Discovery**: Reads `.sql` files from `backend/db/migrations/` (hand-authored) and `backend/db/drizzle/` (Drizzle-generated), sorted alphabetically by filename [backend/db/migrate.js#19-30](../../backend/db/migrate.js)
4. **Hash-based deduplication**: Each SQL file is hashed using `simpleHash()` (a Bernstein/djb2 variant producing an 8-character hex string). If the hash already exists in `__drizzle_migrations`, the file is skipped [backend/db/migrate.js#35-44](../../backend/db/migrate.js)
5. **Execution**: New or unhashed migrations are executed within a SQL `BEGIN/COMMIT` block. On failure, the transaction is rolled back.

#### The `simpleHash` Function

```js
function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h = h & h;
  }
  return Math.abs(h).toString(16).padStart(8, '0');
}
```

This is a Bernstein (djb2) variant that:
- Processes each character in the input string
- Uses the characteristic `h = h * 33 + charCode` pattern via bit shift
- Masks to 32 bits (`h = h & h` — a JavaScript idiom for `h >>> 0`)
- Returns an absolute-value 8-character hex string for compact storage

### Migration Files

**Hand-authored** (in `backend/db/migrations/`):
1. `001_init_analytics.sql`: Creates the core tables: `analytics_channels`, `analytics_videos`, `analytics_video_metrics_daily`, `analytics_channel_metrics_daily`, and `analytics_sync_runs`.
2. `002_dashboard_snapshots.sql`: Introduces the `analytics_dashboard_snapshots` table to store pre-computed JSON bundles for the frontend.
3. `003_user_access_flags.sql`: Extends user-related schema for feature gating and access control.

**Drizzle-generated** (in `backend/db/drizzle/`):
- Auto-produced by `npx drizzle-kit generate` from changes to `backend/db/schema.js`
- Tracked via content hash in `__drizzle_migrations`, allowing renames and reordering without re-execution

**Audit / optimizer feature tables** (in `backend/db/drizzle/`, run by the same runner):
- `0007_thumbnail_audits.sql` -> `thumbnail_audits`
- `0008_playlist_audits.sql` -> `playlist_audits`
- `0009_audits.sql` -> `audits`
- `0010_video_audits.sql` -> `video_audits` (id, uid, name, channel_id, channel_title, results JSONB, created_at, updated_at; index on `uid`)

### Why Hash-Based Tracking?

Drizzle ORM's built-in `migrate()` function (from drizzle-orm >= 0.45) fails on `CREATE TABLE` statements with a `table.primaryKey is not a function` error. The custom runner solves this by:

1. Using `pg.Pool.query()` directly instead of Drizzle's migration layer
2. Tracking applied migrations by **content hash** rather than filename, so regenerated SQL files (identical content) are not reapplied
3. Supporting both traditional hand-authored SQL files and auto-generated Drizzle files from the same runner

### Docker Integration

The backend multi-stage Docker build auto-generates Drizzle migrations:

```
Stage 1 (deps):
  pnpm install (all deps including drizzle-kit)
  COPY source files
  npx drizzle-kit generate  ← produces db/drizzle/*.sql
  pnpm prune --prod          ← removes drizzle-kit
  COPY generated .sql files to runtime image

Stage 2 (runtime):
  node db/migrate.js  ← applies both hand-authored + generated SQL
```

This ensures that schema changes in `schema.js` are automatically reflected in the migration files at build time without manual `drizzle-kit generate` steps.

Sources: [backend/db/migrate.js#1-58](../../backend/db/migrate.js) [backend/start.sh#32-33](../../backend/start.sh) [backend/Dockerfile](../../backend/Dockerfile)

---

## Data Flow: Ingestion to Read Model

The system operates on an "Upsert" pattern. When the background cron job runs, it fetches data from the YouTube API and persists it into the database using `ON CONFLICT` clauses to ensure idempotency [backend/ingestion/store.js#62-74](../../backend/ingestion/store.js)

### Ingestion Logic Flow

Sources: [backend/ingestion/store.js#20-49](../../backend/ingestion/store.js) [backend/ingestion/store.js#51-97](../../backend/ingestion/store.js) [backend/ingestion/store.js#99-143](../../backend/ingestion/store.js)

### Querying the Read Model

The `readModels.js` and `readModelsDrizzle.js` files provide functions to reconstruct the analytics reports expected by the frontend from the normalized SQL tables.

-   `loadBundleFromPostgres`: The primary entry point. It calculates the date ranges for the "current" and "previous" periods and aggregates data from both `analytics_video_metrics_daily` and `analytics_channel_metrics_daily` [backend/ingestion/readModels.js#166-181](../../backend/ingestion/readModels.js)
-   `getVideoMetricsRows`: Executes a `BETWEEN` query on `metric_date` and filters by `filters_key` [backend/ingestion/readModels.js#57-69](../../backend/ingestion/readModels.js)
-   `safeQuery`: A wrapper that catches `42P01` (missing relation) errors, allowing the system to gracefully fall back to the live YouTube API if migrations haven't run or tables are missing [backend/ingestion/readModels.js#8-18](../../backend/ingestion/readModels.js)
-   **Drizzle replacements**: The six functions in `readModelsDrizzle.js` provide injection-safe alternatives using Drizzle's parameterized query builder, with identical signatures to their `readModels.js` counterparts.

#### Stale LatestDate Override Flow

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

Sources: [backend/routes/dashboardTabs.js#102-120](../../backend/routes/dashboardTabs.js) [backend/ingestion/readModels.js#315](../../backend/ingestion/readModels.js)

---

## Database Connection & Startup

The backend container manages its own database lifecycle via `backend/start.sh`.

### Connection Management (`client.js`)

The application uses a `pg.Pool` with a default maximum of 10 connections [backend/db/client.js#1-13](../../backend/db/client.js) It includes a `isPostgresConfigured()` check to allow the backend to run in "YouTube-only" mode if database credentials are missing [backend/db/client.js#19-35](../../backend/db/client.js)

### Startup Sequence

When the backend container starts, `start.sh` performs a network check to ensure the PostgreSQL host is reachable before attempting to run migrations. It retries up to 30 times with a 2-second interval [backend/start.sh#12-31](../../backend/start.sh) Once reachable, it executes `node db/migrate.js` — which applies both hand-authored and Drizzle-generated migration files [backend/start.sh#33](../../backend/start.sh)

Sources: [backend/db/client.js#6-17](../../backend/db/client.js) [backend/db/client.js#37-52](../../backend/db/client.js) [backend/start.sh#1-39](../../backend/start.sh)

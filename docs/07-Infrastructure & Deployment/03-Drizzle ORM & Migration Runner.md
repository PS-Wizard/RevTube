# Drizzle ORM Integration

RevTube uses **Drizzle ORM** (with PostgreSQL) as an optional, incrementally-adopted query layer for analytics read models. This document covers the schema definitions, migration pipeline, query strategies, and how Drizzle integrates with the Docker build process.

---

## Table of Contents

1. [Overview & Motivation](#1-overview--motivation)
2. [File Layout](#2-file-layout)
3. [Schema Definitions (`db/schema.js`)](#3-schema-definitions-dbschemajs)
4. [Drizzle Instance (`db/drizzle.js`)](#4-drizzle-instance-dbdrizzlejs)
5. [Configuration (`drizzle.config.js`)](#5-configuration-drizzleconfigjs)
6. [Migration Pipeline](#6-migration-pipeline)
7. [Read Models (`ingestion/readModelsDrizzle.js`)](#7-read-models-ingestionreadmodelsdrizzlejs)
8. [Docker Build Integration](#8-docker-build-integration)
9. [Incremental Adoption](#9-incremental-adoption)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Overview & Motivation

Prior to Drizzle, all PostgreSQL queries were hand-written SQL strings in `ingestion/readModels.js`. This introduced two problems:

1. **SQL injection risk** -- filter values from user input (video IDs, playlist filters) were concatenated into query strings.
2. **No type safety** -- query results were plain objects with no schema-level validation at the query boundary.

Drizzle ORM solves both:

- **Parameterized queries** -- The Drizzle query builder and `sql`` tagged templates guarantee every user-supplied value is passed as a bind parameter, never as string interpolation.
- **Schema enforcement** -- Every table is defined as a `pgTable` in one place, and read models use `getTableColumns()` so field names are always correct.
- **Zero-runtime queries** -- Drizzle compiles queries at runtime in about 1µs per query -- negligible overhead compared to network + postgres planning time.

Drizzle is **not** replacing the existing raw-SQL read models. Both `readModels.js` and `readModelsDrizzle.js` export the same function signatures, and callers choose which to import. See [Incremental Adoption](#9-incremental-adoption).

---

## 2. File Layout

```
backend/db/
├── drizzle/                  # Auto-generated migration files
│   ├── 0000_initial.sql      # Initial schema (created by drizzle-kit generate)
│   └── meta/
│       └── _journal.json     # Drizzle-kit journal (tracks applied baseline)
├── drizzle.js                # Singleton getDb() -- wraps pg Pool with Drizzle
├── migrate.js                # Migration runner (used at startup)
├── schema.js                 # pgTable definitions for all analytics tables
└── ...

backend/
├── drizzle.config.js         # Drizzle-kit CLI configuration
├── ingestion/
│   ├── readModels.js         # Original raw-SQL read models (unchanged)
│   └── readModelsDrizzle.js  # Drizzle-based read models (parameterized)
└── ...
```

---

## 3. Schema Definitions (`db/schema.js`)

All 7 analytics tables are defined as Drizzle `pgTable` objects, re-exported for use in both read models and future migrations.

### Tables

| Drizzle export name | PostgreSQL table | Primary key | Purpose |
|---|---|---|---|
| `analyticsChannels` | `analytics_channels` | `channel_id` | YouTube channel metadata synced from YT API |
| `analyticsVideos` | `analytics_videos` | `video_id` | Individual video metadata + counters |
| `channelMetricsDaily` | `analytics_channel_metrics_daily` | `(channel_id, metric_date)` | Daily channel-level engagement metrics |
| `videoMetricsDaily` | `analytics_video_metrics_daily` | `(channel_id, metric_date, filters_key)` | Daily per-video metrics, filterable by playlist/video set |
| `dashboardSnapshots` | `analytics_dashboard_snapshots` | `snapshot_key` | Pre-computed dashboard state snapshots (JSONB) |
| `userAccessFlags` | `user_access_flags` | `uid` | User role and package (admin/pro/free) |
| `syncRuns` | `analytics_sync_runs` | `id` (serial) | Operational log of ingestion runs |

### Column definitions match the existing PostgreSQL schema exactly:

```js
const analyticsVideos = pgTable('analytics_videos', {
  videoId: text('video_id').primaryKey(),
  channelId: text('channel_id').notNull(),
  title: text('title'),
  description: text('description'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  thumbnailUrl: text('thumbnail_url'),
  duration: text('duration'),
  tags: jsonb('tags'),
  viewCount: bigint('view_count', { mode: 'number' }),
  likeCount: bigint('like_count', { mode: 'number' }),
  commentCount: bigint('comment_count', { mode: 'number' }),
  position: integer('position'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
```

**Note on `filters_key` in `videoMetricsDaily`**: This column stores filter strings like `playlist==PL...` or `video==v1,v2`. In the original raw-SQL read models, these were parsed and injected via `WHERE ... LIKE` clauses. In Drizzle, the `sql`` tagged template handles this safely.

**Note on `mode: 'number'` for `bigint`**: Drizzle's `bigint('col', { mode: 'number' })` returns JavaScript `number` (53-bit safe). Very large YouTube view counts (>9 quadrillion) would overflow, but in practice YouTube's 64-bit integers for views fit within `Number.MAX_SAFE_INTEGER` (9e15). If a channel had truly astronomical view counts, switch to `mode: 'bigint'` which returns native `BigInt`.

---

## 4. Drizzle Instance (`db/drizzle.js`)

A singleton wrapper around the existing `pg` Pool:

```js
const { getPool } = require('./client');
const { drizzle } = require('drizzle-orm/node-postgres');

let db;

function getDb() {
  if (!db) {
    const pool = getPool();
    if (!pool) return null;
    db = drizzle(pool, { schema });
  }
  return db;
}
```

- **Lazy initialization** -- `getDb()` returns `null` when Postgres is not configured, so callers must guard with a null check.
- **Single pool** -- Shares the same `pg.Pool` as the rest of the application, so no additional connection limit or memory overhead.
- **Schema reference** -- The `schema` import passes all table definitions to Drizzle, enabling the query builder to resolve column names and relationships.

Usage pattern in read models:

```js
const db = getDb();
if (!db) return fallbackResult;  // Postgres not configured
```

---

## 5. Configuration (`drizzle.config.js`)

```
/** @type { import("drizzle-kit").Config } */
module.exports = {
  schema: './db/schema.js',
  out: './db/drizzle',
  dialect: 'postgresql',
};
```

- **`schema`**: Path to `db/schema.js` -- Drizzle reads the `pgTable` definitions to generate migration SQL.
- **`out`**: Output directory for generated `.sql` migration files and the `meta/_journal.json`.
- **`dialect`**: Must match the target database (`postgresql`).

This file is consumed by `npx drizzle-kit generate` during Docker builds and optionally during local development.

---

## 6. Migration Pipeline

RevTube uses a **custom migration runner** (`db/migrate.js`) rather than Drizzle ORM's built-in `migrate()` function, because `drizzle-orm >= 0.45` processes SQL files through its internal dialect API rather than executing them as raw SQL, causing `table.primaryKey is not a function` on standard CREATE TABLE statements.

### Runner Architecture

```
start.sh → node db/migrate.js
                     │
                     ▼
             Read .sql files from db/drizzle/
             (sorted by filename)
                     │
                     ▼
             Compute content hash (simpleHash)
                     │
                     ▼
             Check hash in __drizzle_migrations table
                     │
               ┌─────┴─────┐
               │            │
            Found         Not found
               │            │
           SKIP          APPLY:
                           │
                     BEGIN TRANSACTION
                     pool.query(sql)
                     INSERT INTO __drizzle_migrations (hash)
                     COMMIT
```

### `__drizzle_migrations` tracking table

```sql
CREATE TABLE IF NOT EXISTS __drizzle_migrations (
  id SERIAL PRIMARY KEY,
  hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- **`hash`**: Stable 32-bit integer hash of the entire `.sql` file content. This means:
  - Migrations are tracked by content, not by filename -- renaming a file doesn't trigger re-application.
  - If the content of a migration changes after it was applied, it won't re-run (same hash). A manual `DELETE` from `__drizzle_migrations` is needed to force re-application.

### Hash function (`simpleHash`)

```js
function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h = h & h;  // Convert to 32-bit integer
  }
  return Math.abs(h).toString(16).padStart(8, '0');
}
```

Uses a Bernstein/`djb2` variant. Returns an 8-character hex string (e.g., `f3a2b1c0`). Not cryptographic -- only used for dedup, not integrity verification.

### Migration workflow (local development)

```bash
# 1. Edit schema.js
# 2. Generate migration file
npx drizzle-kit generate

# 3. Review generated SQL in db/drizzle/0001_*.sql
# 4. Run migration (same as startup)
node db/drizzle/migrate.js

# 5. Commit: the new .sql file, updated _journal.json, and schema.js
```

### Migration workflow (Docker build)

See [Docker Build Integration](#8-docker-build-integration) -- migrations are auto-generated at build time and auto-applied at startup.

---

## 7. Read Models (`ingestion/readModelsDrizzle.js`)

Six core analytics read functions are re-implemented using Drizzle's query builder and `sql`` tagged templates. Each function has the same signature as its counterpart in `readModels.js`.

### Function map

| Drizzle function | Raw-SQL equivalent | Purpose |
|---|---|---|
| `loadBundleFromPostgres` | `loadBundleFromPostgres` | Channel metrics for dashboard chart (date range) |
| `loadBundleComparison` | `loadBundleComparison` | Previous-period comparison data |
| `loadChannelTotals` | `loadChannelTotals` | Aggregated channel-level totals |
| `loadChartMetrics` | `loadChartMetrics` | Channel + video metrics for chart rows |
| `loadBestTimeToPost` | `loadBestTimeToPost` | Hourly engagement distribution |
| `loadWeeklyEngagement` | `loadWeeklyEngagement` | Day-of-week engagement breakdown |

### Parameterized query pattern

```js
const { sql, getTableColumns, inArray, and, gte, lte, eq } = require('drizzle-orm');

async function loadBundleFromPostgres(channelId, startDate, endDate) {
  const db = getDb();
  if (!db) return [];
  
  const rows = await db
    .select({ ...getTableColumns(channelMetricsDaily) })
    .from(channelMetricsDaily)
    .where(
      and(
        eq(channelMetricsDaily.channelId, channelId),
        gte(channelMetricsDaily.metricDate, startDate),
        lte(channelMetricsDaily.metricDate, endDate),
      ),
    )
    .orderBy(channelMetricsDaily.metricDate);
    
  return rows.map(r => ({ ...r, views: Number(r.views || 0) }));
}
```

### Handling filters_key (playlist/video filters)

For queries that include filter conditions (playlist scoping, video scoping), the Drizzle version uses `sql`` tagged templates:

```js
const filtersClause = filters
  ? sql`AND filters_key LIKE ${`%${filters}%`}`
  : sql``;

const rows = await db.execute(sql`
  SELECT ...
  FROM ${videoMetricsDaily}
  WHERE channel_id = ${channelId}
    AND metric_date >= ${startDate}
    AND metric_date <= ${endDate}
  ${filtersClause}
`);
```

The `sql`` tagged template automatically escapes bind parameters, so the `filters` string is safely parameterized -- never concatenated into SQL.

### Null-safety on bigint casts

All `bigint` fields are cast to JavaScript `Number` in the return mapping to maintain API compatibility with the existing code:

```js
return rows.map(r => ({
  ...r,
  subscribersGained: Number(r.subscribersGained || 0),
  likes: Number(r.likes || 0),
  comments: Number(r.comments || 0),
  shares: Number(r.shares || 0),
}));
```

---

## 8. Docker Build Integration

The Docker build process auto-generates Drizzle migration files to ensure the runtime image always has the correct schema applied.

### Multi-stage build flow

```
Stage 1 (dependencies)
├── pnpm install --frozen-lockfile  # ALL deps including drizzle-kit
├── COPY . .                        # Source code
├── npx drizzle-kit generate        # Generates .sql migration files
└── pnpm prune --prod               # Strip dev deps

Stage 2 (runtime)
├── COPY --from=dependencies /app/node_modules ./node_modules
├── COPY . .                        # Source without node_modules
└── COPY --from=dependencies /app/db/drizzle ./db/drizzle  # Generated migrations
```

### Key details

1. **`pnpm install` without `--prod`**: drizzle-kit is a dev dependency, so the full dependency tree (including TypeScript and drizzle-kit itself) must be installed in Stage 1. `pnpm prune --prod` strips these after the generate step, keeping the runtime image small.

2. **`drizzle-kit generate`**: Reads `schema.js` and `drizzle.config.js` to produce new migration `.sql` files in `db/drizzle/`. The `_journal.json` meta file tells drizzle-kit what's already been generated -- if `schema.js` matches the latest migration, `drizzle-kit generate` is a no-op (produces no new files).

3. **`COPY --from=dependencies /app/db/drizzle ./db/drizzle`**: After `COPY . .` copies the build context's source, this overwrites `db/drizzle/` with the version from Stage 1, which includes any newly generated files. This is critical because the build context (Docker COPY) may not contain files that were just generated.

4. **`node db/migrate.js`** in `start.sh`: At runtime, the migration runner reads the `.sql` files in `db/drizzle/` (alphabetically sorted), computes content hashes, and applies any that haven't been applied yet.

### What happens when schema.js changes

1. Developer commits a change to `db/schema.js`.
2. Docker build runs `npx drizzle-kit generate`, which diffs `schema.js` against the `_journal.json` baseline and produces `0001_*.sql` (only the changes from the baseline).
3. The new migration file is included in the Docker image.
4. Container startup runs `node db/migrate.js`, sees the new hash, and applies the migration.
5. No manual migration command needed -- the pipeline is fully automatic.

---

## 9. Incremental Adoption

Drizzle read models are **opt-in** -- the existing `readModels.js` continues to work unchanged. Migration plan:

1. **Current state**: `backend/services/dashboardBundle.js` imports from `readModels.js`. The Drizzle versions (`readModelsDrizzle.js`) exist but are unused.
2. **Phase 1** (complete): Schema + migration pipeline + read model implementations -- all infrastructure in place.
3. **Phase 2**: Wire `readModelsDrizzle.js` into the service layer. Each function swap is independent -- `loadBundleFromPostgres` can be replaced while `loadBestTimeToPost` stays on raw SQL.
4. **Phase 3**: Deprecate and remove `readModels.js` once all callers have been migrated.

### Phase 2 transition pattern

```js
// In services/dashboardBundle.js, import the Drizzle version:
const {
  loadBundleFromPostgres,
  loadBundleComparison,
  loadChannelTotals,
} = require('../ingestion/readModelsDrizzle');

// The function signatures are identical, so no other code changes needed
// within the service module.
```

If the Drizzle instance is unavailable (`getDb()` returns `null`), the read model returns fallback data (empty arrays / zeros). The caller must handle this gracefully (the existing code does -- it treats empty results as "no data"). This means **Drizzle being unavailable never crashes a request** -- it produces stale/empty analytics but the dashboard continues to render.

---

## 10. Troubleshooting

### `table.primaryKey is not a function`

**Cause**: Using `drizzle-orm`'s built-in `migrate()` from `drizzle-orm/node-postgres/migrator`. This function tries to process SQL files through Drizzle's internal dialect API, which fails on raw `CREATE TABLE` statements.

**Fix**: Use the custom SQL-based runner in `db/migrate.js` instead. It reads `.sql` files directly and executes them through `pg.Pool.query()`.

### Migration not applied

```bash
# Check the __drizzle_migrations table
psql -d reverb -c "SELECT * FROM __drizzle_migrations;"

# If hash matches but migration wasn't applied, remove the row and restart
psql -d reverb -c "DELETE FROM __drizzle_migrations WHERE hash = 'xxxxxxxx';"
```

### `drizzle-kit generate` produces no output

- Check that `drizzle.config.js` has the correct `schema` path and `out` directory.
- Check that `meta/_journal.json` has the correct baseline. If it's out of sync, drizzle-kit thinks nothing has changed. Reset by removing files in `db/drizzle/` and re-running `drizzle-kit generate`.
- Ensure `pnpm install` was run (drizzle-kit needs to be available).

### Docker build fails at `drizzle-kit generate`

```bash
# Test locally first
docker build --no-cache --progress=plain -t revtube-backend-test . 2>&1 | grep drizzle
```

Common causes:
- `schema.js` imports something not available in the Docker build context (e.g., a missing `node_modules` file).
- `drizzle-kit` can't find a peer dependency (`drizzle-orm` must be in `node_modules`).
- Network timeout during `pnpm install` (retry the build).

---

## Related files

- `backend/db/schema.js` -- All 7 Drizzle table definitions
- `backend/db/drizzle.js` -- Singleton `getDb()` factory
- `backend/db/migrate.js` -- Custom migration runner
- `backend/drizzle.config.js` -- Drizzle-kit configuration
- `backend/ingestion/readModelsDrizzle.js` -- Parameterized read model implementations
- `backend/db/drizzle/0000_initial.sql` -- Initial migration
- `backend/db/drizzle/meta/_journal.json` -- Drizzle-kit journal
- `backend/Dockerfile` -- Multi-stage build with auto-generation
- `backend/start.sh` -- Entrypoint that runs migrations before Node

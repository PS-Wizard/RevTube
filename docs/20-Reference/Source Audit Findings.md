# Undocumented Implementation Findings

This document captures implementation details discovered during code audit that are **NOT** covered
by PROJECT_GUIDE.md, CACHING.md, DESIGN_LANGUAGE.md, UI_STANDARDS.md, backend/README.md,
frontend/README.md, or the top-level README.md.

> **Last verified**: 2026-07-13 via manual source-code verification (OpenCode).
> **Note**: Many items marked open/absent in prior audits have since been fixed.
> See the [Change Log](../../CHANGELOG.md) for a chronological list of fixes and
> [Caching Architecture](02-Caching Architecture (ServerCache & Redis)) for the current caching state.
> Entries marked ✅ CONFIRMED match audit output exactly.
> Entries marked ⚠️ CORRECTED were wrong in prior versions -- use the corrected value.
> Entries marked ❓ UNVERIFIED were not reached by the audit and need a second pass.
> Entries marked 🆕 NEW were discovered by the audit and did not exist in any prior doc.

---

## 1. `backend/index.js`

### ServerCache -- Internals

| Finding                     | Line | Details                                                                                               | Status                                                                |
| --------------------------- | ---- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Constructor `maxSize`       | ~60  | **1000** (prior doc said 500)                                                                         | ⚠️ CORRECTED                                                          |
| Constructor `defaultTTL`    | ~60  | **12 hours** (`12 * 60 * 60 * 1000`) -- prior doc said 5 min (300 000 ms)                              | ⚠️ CORRECTED                                                          |
| `compressionThreshold`      | ~60  | 1024 bytes                                                                                            | ✅ CONFIRMED                                                          |
| `DISABLE_COMPRESSION` check | ~66  | `process.env.DISABLE_COMPRESSION !== '1'` checked in constructor                                      | ✅ CONFIRMED                                                          |
| Compression method          | ~142 | Uses **async** `zlib.gzip` / `zlib.gunzip` -- prior doc said `zlib.deflateSync` / `inflateSync` (sync) | ⚠️ CORRECTED                                                          |
| `set()` entry shape         | ~142 | Stores `{ value: dataToStore, expiresAt: Date.now() + ttl }`                                          | ⚠️ CORRECTED (prior doc said `{ data, createdAt, hits, accessedAt }`) |
| `get()` return shape        | ~203 | Returns **data directly or `null`** -- prior doc said `{ hit: boolean, stale: boolean, data: any }`    | ⚠️ CORRECTED                                                          |
| `getStats()`                | ~160 | Returns `{ size, hits, misses, oldest, newest, hitRate, memoryUsage }`. Not exposed via any endpoint  | ✅ CONFIRMED                                                          |
| `getInstance()` singleton   | ~200 | Static factory used throughout routes                                                                 | ✅ CONFIRMED                                                          |

**Production impact of corrections**:

- `defaultTTL` of 12 hours (not 5 min) means the in-memory fallback (no Redis) holds stale data
  for up to 12 hours after a restart. Any audit feature that assumes "cache is fresh" must account
  for this when Redis is unavailable.
- `get()` returning data directly (not `{ hit, stale, data }`) means any code destructuring
  `{ hit, stale, data }` from `serverCache.get()` will silently fail -- `hit` and `stale` will
  be `undefined`. Do not write new code expecting that shape.
- Async compression means `set()` is now `async` -- callers that do not `await` it will not wait
  for the cache write to complete before responding.

---

### Middleware Chain -- Exact Order & Config

| Finding               | Line | Details                                                                                  | Status       |
| --------------------- | ---- | ---------------------------------------------------------------------------------------- | ------------ |
| Actual chain order    | ~668 | **`helmet() → cors() → json() → requestLogger → rate-limit`** -- `morgan()` still absent, replaced by custom `requestLogger` | ✅ **FIXED** |
| `helmet()`            | ~668 | **PRESENT** -- added with CSP disabled and `cross-origin` resource policy. One-line addition. | ✅ **FIXED** |
| `morgan()`            | ~568 | **ABSENT** -- replaced by custom `requestLogger` middleware at line 568 (logs method, status, timing, cache events). Enabled by default in dev via `REQUEST_LOG` env var | ⚠️ CORRECTED |
| Rate limit `windowMs` | ~480 | 15 min (`15 * 60 * 1000`)                                                                | ✅ CONFIRMED |
| Rate limit `max`      | ~480 | Configurable via env var (default 100) -- prior doc said hardcoded 100                    | ⚠️ CORRECTED |
| CORS origins          | ~460 | Hardcoded allowlist -- not env-configurable                                               | ✅ CONFIRMED |

**Production impact**:

- **`helmet()` is now present** -- CSP disabled but `X-Frame-Options`, `X-Content-Type-Options`,
  and HSTS headers are now sent. Cross-origin resource policy set to `cross-origin`.
- **`morgan()` is absent** -- replaced by custom `requestLogger` at line 568. Logs method, status,
  timing, and cache events. Enabled by default in dev via `REQUEST_LOG` env var.

---

### Token Refresh Flow

| Finding                      | Line | Details                                                                                                      | Status        |
| ---------------------------- | ---- | ------------------------------------------------------------------------------------------------------------ | ------------- |
| `isTokenExpired(error)`      | ~510 | Checks `error.response?.status === 401` or message contains "Token has expired" / "Invalid Credentials"      | ✅ CONFIRMED  |
| `refreshGoogleToken` caching | --    | Cached under `oauth:token:{shortHash(refreshToken)}` with **55 min TTL** in `ServerCache` | ✅ **FIXED** |
| Retry count                  | ~530 | Retries original request exactly once after refresh. Second failure → 401 to client                          | ✅ CONFIRMED  |
| Logging/telemetry            | --    | No logging on refresh success or failure                                                                     | ✅ CONFIRMED  |

**Note**: `refreshGoogleToken()` now caches access tokens for 55 minutes, so cron runs and duplicate refreshes within the same hour reuse the cached token instead of calling Google on every channel per run.

---

### `generateDashboardBundle` -- 6-Step Internal Pipeline

| Step                | Line  | Details                                                                 | Status       |
| ------------------- | ----- | ----------------------------------------------------------------------- | ------------ |
| 1. Build range      | ~2370 | `buildRange({ period, startDate, endDate })` from readModels            | ✅ CONFIRMED |
| 2. Load from PG     | ~2380 | `loadBundleFromPostgres(channelId, startDate, endDate)`                 | ✅ CONFIRMED |
| 3. Fill gaps        | ~2400 | Iterates date range, inserts **zero-value rows** for missing dates      | ✅ CONFIRMED |
| 4. Compute trending | ~2420 | 7-day and 30-day rolling averages of `view_count`, `watch_time_minutes` | ✅ CONFIRMED |
| 5. Channel snippet  | ~2450 | Fetches `title`, `thumbnail`, `subscriberCount` from channels table     | ✅ CONFIRMED |
| 6. Comparison       | ~2470 | `shiftRange()` → previous period query → delta %                        | ✅ CONFIRMED |

**Gap-fill detail** (audit confirmed): Gap-filling happens in JavaScript (`readModels.js`),
not SQL. Missing dates get a zero-filled row, so PostgreSQL writes are unaffected and only
the API response is densified. This is deliberate: the read models return a dense daily
series because the charting layer requires a value per day. The trade-off is that a day with
no ingested row is presented as zero traffic rather than "no data"; anomaly detection does
not run on gap-filled days, which is what prevents ingestion lag from registering as a dip.

---

### `generateChannelVideos` -- Enrichment Loop

| Finding          | Line  | Details                                                                  | Status       |
| ---------------- | ----- | ------------------------------------------------------------------------ | ------------ |
| Enrichment check | ~2690 | `needsEnrichment = !video.title \|\| !video.thumbnail`                   | ✅ CONFIRMED |
| Batch enrichment | ~2710 | Batches of 50 via `fetchVideosByIds`                                     | ✅ CONFIRMED |
| Derived metrics  | ~2750 | `ctr = (clicks / impressions) * 100`, `avgViewDuration` from raw numbers | ✅ CONFIRMED |

---

### `generateDimensions` -- Query Structure

| Finding            | Line  | Details                                   | Status       |
| ------------------ | ----- | ----------------------------------------- | ------------ |
| top_countries      | ~2590 | `JSON_AGG` + `GROUP BY country`, LIMIT 10 | ✅ CONFIRMED |
| top_devices        | ~2610 | Same pattern, `device_type`               | ✅ CONFIRMED |
| traffic_sources    | ~2630 | Same pattern, `traffic_source`            | ✅ CONFIRMED |
| Hardcoded LIMIT 10 | ~2640 | Not configurable                          | ✅ CONFIRMED |

---

### `handleApiError` -- Error Response Shape & Diagnostics

| Finding                | Line  | Details                                                                                                               | Status       |
| ---------------------- | ----- | --------------------------------------------------------------------------------------------------------------------- | ------------ |
| Standard shape         | ~2545 | `{ error: string, status: number, details?: any }`                                                                    | ✅ CONFIRMED |
| Error code mapping     | ~2550 | `ValidationError`→400, `AuthError`→401, `ForbiddenError`→403, `NotFoundError`→404, `UsageLimitError`→429, default→500 | ✅ CONFIRMED |
| Network diagnostics    | ~2559 | No-response branch logs `{ message, code, errno, syscall }` -- structed error context for network error diagnosis      | ✅ **FIXED** |
| OAuth refresh route    | ~1736 | **Bypasses** `handleApiError` -- uses structured logging with `oauthErr` object, returns `502 TOKEN_REFRESH_FAILED`    | ✅ **FIXED** |
| OAuth 10s timeout      | 6 sites | All `axios.post` calls to `oauth2.googleapis.com/token` have `{ timeout: 10000 }`                                     | ✅ **FIXED** |

---

### `withInFlight` -- Backend Dedup Map

| Finding         | Line   | Details                                                                           | Status       |
| --------------- | ------ | --------------------------------------------------------------------------------- | ------------ |
| Map declaration | ~28    | `const DASHBOARD_INFLIGHT = { summary: new Map(), bundle: new Map() }`            | 🆕 NEW       |
| Implementation  | ~28-43 | Checks existing promise, stores new promise, removes in `.finally()`              | ✅ CONFIRMED |
| Timeout         | ~80    | **120s timeout added** -- `withInFlightTimeout(map, key, factory, timeoutMs = 120_000)` wraps promise with `Promise.race`. Default 120s. | ✅ **FIXED** |
| Cleanup         | ~43    | `promise.finally(() => { if (map.get(key) === promise) map.delete(key) })`        | ✅ CONFIRMED |
| Scope           | ~28    | Applies to `summary` and `bundle` dashboard routes only -- not all routes          | 🆕 NEW       |

---

### `checkUsageLimit` -- Position Relative to Cache Check

| Finding            | Line  | Details                                                                                            | Status       |
| ------------------ | ----- | -------------------------------------------------------------------------------------------------- | ------------ |
| Middleware order   | --     | `checkUsageLimit` checks quota only; `incrementUsageLimit(req)` runs after cache miss              | ✅ **FIXED** |
| Cache hit behavior | --     | Cached responses no longer increment usage counters                                                | ✅ **FIXED** |
| Redis key format   | --     | `usage:{uid}:{pageKey}:{month}`                                                                    | ✅ CONFIRMED |
| USAGE_DEDUP_WINDOW_SEC | ~624 | Declared (default 5s) but **never wired** into `incrementUsageLimit`. `req._usageIncremented` (per-request guard) is the only dedup. | 🟡 OPEN      |
| Parallel dedup     | --     | No cross-request dedup -- parallel cache misses can each independently increment the counter       | 🟡 OPEN      |

---

### `channels/mine` Cache Key -- BUG STATUS CORRECTED

| Finding    | Line  | Details                                                                                                                 | Status       |
| ---------- | ----- | ----------------------------------------------------------------------------------------------------------------------- | ------------ |
| Cache key  | ~1918 | `const scope = youtubeDataScope(req, true); const cacheKey = \`yt:channels:mine:${scope}\``                             | ⚠️ CORRECTED |
| Bug status | --     | **BUG IS FIXED** -- user scope IS included in cache key. Prior docs listed this as 🔴 open bug. Remove from open issues. | ⚠️ CORRECTED |

---

### `ServerCache` instantiation -- TTL correction (RESOLVED 2026-09-28)

| Finding               | Details                                                                                                                              | Status       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Class default TTL     | `constructor(maxSize = 1000, defaultTTL = 12 * 60 * 60 * 1000)` -- 12 hours class-level default                                       | ✅ CONFIRMED |
| Instantiation (before)| `new ServerCache(1000, 24 * 60 * 60 * 1000)` -- 24h override meant a Redis outage could serve day-old data                              | ✅ FIXED     |
| Instantiation (now)   | `new ServerCache(CACHE_MAX_ENTRIES, CACHE_FALLBACK_TTL_HOURS * 3600 * 1000)` -- env-tunable, defaults `1000` / `12`                     | ✅ FIXED     |

**Resolved**: both constructor arguments are now env-configurable
(`CACHE_MAX_ENTRIES`, `CACHE_FALLBACK_TTL_HOURS`, documented in `example.env`)
and the fallback TTL default is the conservative **12 hours**, matching the class
default, instead of the previous 24h. A Redis outage can no longer serve
day-old data, and capacity changes need no code edit.

---

### `/api/debug/tokens` -- Security Status Resolved

| Finding           | Line  | Details                                                                                                      | Status       |
| ----------------- | ----- | ------------------------------------------------------------------------------------------------------------ | ------------ |
| Route guard       | ~1976 | `if (process.env.NODE_ENV !== 'production')` wraps the entire route definition                               | ✅ CONFIRMED |
| Auth middleware   | ~1976 | `checkAdmin` is applied -- requires admin role                                                                | ✅ CONFIRMED |
| Response payload  | ~1979 | Returns only `{ message, userEmail, note }` -- no raw tokens exposed                                         | ✅ CONFIRMED |
| Production risk   | --     | **NOT a security risk** -- route does not exist in production builds. Prior audit flag was incorrect.          | ⚠️ CORRECTED |

---

### `computeDashboardPillsOnly` / `fetchPlaylistViewsSummed`

| Finding                        | Line  | Details                                                     | Status       |
| ------------------------------ | ----- | ----------------------------------------------------------- | ------------ |
| `computeDashboardPillsOnly`    | ~2160 | Short-form vs long-form view stats from playlist structure  | ✅ CONFIRMED |
| `fetchPlaylistViewsSummed`     | ~2035 | Sums view counts across playlists                           | ✅ CONFIRMED |
| `overlayViewsFromPlaylistRows` | ~2087 | Merges playlist-sourced view data into daily analytics rows | ✅ CONFIRMED |

---

### Undocumented Route Groups

| Route                       | Line  | Purpose                                                                    | Auth                  | Status       |
| --------------------------- | ----- | -------------------------------------------------------------------------- | --------------------- | ------------ |
| `GET /api/auth/status`      | ~580  | `{ authenticated, uid, email }`                                            | ❓ unverified         | ✅ CONFIRMED |
| `GET /api/user/profile`     | ~620  | GET/PUT user profile                                                       | `authenticateRequest` | ✅ CONFIRMED |
| `GET /api/user/tokenStatus` | ~650  | `{ accessTokenExpiry, refreshTokenExpiry }`                                | ❓ unverified         | ✅ CONFIRMED |
| `POST /api/cron/trigger`    | ~1750 | Manual cron trigger                                                        | `checkAdmin`          | ✅ CONFIRMED |
| `GET /api/debug/tokens`     | ❓    | **NEW** -- discovered by audit. Returns token data. Auth middleware unknown | 🆕 NEW 🔴 SECURITY    |
| `GET /api/usage/me`         | ~?    | Current monthly usage for active user                                      | `authenticateRequest` | 🆕 NEW       |
| `POST /api/compare/videos`  | --     | **NEW** -- channel comparison endpoint, fetches videos + metrics, cached in Redis (1h TTL, shared across users) | `resolveUser` + `checkPremiumAccess("compare")` | ✅ CONFIRMED |

**⚠️ SECURITY -- `/api/debug/tokens`**: This route was discovered by audit and exists in no
documentation. A route that returns token data must be verified immediately:

- What exactly does it return? (raw tokens? expiry only? user identity?)
- Is it protected by `authenticateRequest`? `checkAdmin`? Or nothing?
- Does it exist in production or only in development builds?

**Action required before next deploy**: Confirm middleware protection on this route.
If it is unprotected or only `authenticateRequest`-gated (not `checkAdmin`), it must be
either removed or restricted to admin-only access.

---

## 2. `backend/cron.js`

| Finding                          | Line  | Details                                                                                    | Status        |
| -------------------------------- | ----- | ------------------------------------------------------------------------------------------ | ------------- |
| Cron pattern                     | ~162  | `0 3,9,15,21 * * *` -- every 6 hours at 3AM, 9AM, 3PM, 9PM                                 | ✅ CONFIRMED  |
| `maxChannels` cache refresh      | ~162  | **50** at scheduled invocation -- prior doc said 5. Default param in function is 100.       | ⚠️ CORRECTED  |
| `maxChannels` postgres ingestion | ~162  | **100** at scheduled invocation                                                            | ✅ CONFIRMED  |
| Skip recently warmed             | --     | **NOT PRESENT** -- no `lastWarmedAt` check. Prior docs were wrong. Every run warms all channels. | ⚠️ CORRECTED  |
| `warmCache` missing_analytics filter | --  | **NOT PRESENT** -- no filter on `missing_analytics`. All channels with `refreshToken` are processed. | ⚠️ CORRECTED  |
| Per-channel error isolation      | ~41   | Each channel wrapped in `try/catch` inside `for` loop                                     | ✅ CONFIRMED  |
| Sleep between channels           | ~95   | **2-second** sleep (`setTimeout(resolve, 2000)`) in cache refresh                         | ✅ CONFIRMED  |
| Ingestion cooldown               | ~130  | **1.5-second** sleep (`setTimeout(resolve, 1500)`) in postgres ingestion                  | ✅ CONFIRMED  |
| Token caching in `refreshGoogleToken` | -- | **NOT cached** -- bare `axios.post` → `return response.data.access_token`. No Redis/memory TTL. | ✅ CONFIRMED  |
| `days` param (ingestion)         | ~162  | 120 days at scheduled invocation (`days: 120`)                                            | ✅ CONFIRMED  |
| Admin manual endpoints           | ~197  | `/admin/cache/refresh-all`, `/admin/ingestion/refresh-all`, `/admin/ingestion/refresh-channel` -- all three now have `authenticateRequest` + `checkAdmin` middleware guards. | ✅ **FIXED** |

**⚠️ Admin cron endpoints -- NOW PROTECTED**: The three manual trigger routes in `cron.js` previously had no guards. All three now apply `authenticateRequest` + `checkAdmin`. These middleware functions are exported from `backend/index.js` (via `middleware/auth.js`) and imported via `require('./index')` at the top of `cron.js`.

---

## 3. `backend/emailService.js`

| Finding             | Line      | Details                                                                        | Status       |
| ------------------- | --------- | ------------------------------------------------------------------------------ | ------------ |
| `createTransporter` | ~7        | `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | ✅ CONFIRMED |
| TLS                 | ~15       | `requireTLS: true`                                                             | ✅ CONFIRMED |
| Templates           | ~37, ~104 | Inline HTML strings -- `sendInvitationEmail`, `sendOwnershipTransferEmail`      | ✅ CONFIRMED |

---

## 4. `backend/ingestion/sync.js`

| Finding                        | Line | Details                                                                                                                       | Status       |
| ------------------------------ | ---- | ----------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `withRetry` backoff            | ~16  | `Math.min(baseDelay * 2^attempt, maxDelay) + random(1000)ms` jitter. Defaults: `maxRetries=3, baseDelay=1000, maxDelay=30000` | ✅ CONFIRMED |
| Retry condition                | ~22  | 429 and 5xx only. All 4xx thrown immediately                                                                                  | ✅ CONFIRMED |
| `mapRowsByHeaders`             | ~34  | 15+ column mappings: `youtubeDay→date`, `views→view_count`, `estimatedMinutesWatched→watch_time_minutes`, etc.                | ✅ CONFIRMED |
| `fetchAllVideosForChannel` cap | ~67  | Default `maxResults = 500` -- prior doc said 200 (4 pages × 50)                                                                | ⚠️ CORRECTED |
| `ingestChannelDaily` cap       | ~161 | Default `maxVideos = 500` -- prior doc said 200                                                                                | ⚠️ CORRECTED |
| Cap logging                    | --    | No logging when cap is reached                                                                                                | ✅ CONFIRMED |
| Cap configurability            | --    | Not configurable via env var                                                                                                  | ✅ CONFIRMED |
| `fetchChannelUploadsId`        | ~50  | Gets uploads playlist ID via `playlists.list`                                                                                 | ✅ CONFIRMED |
| `computeDateWindow`            | ~152 | `{ startDate, endDate }` based on last synced date                                                                            | ✅ CONFIRMED |

**Correction note**: Prior documentation stated a hard cap of 200 videos (`maxPages=4 × 50`).
Audit confirmed the actual default is **500**. This is better than documented but still not
env-configurable and still silent when the cap is hit.

---

## 5. `backend/ingestion/store.js`

| Finding                     | Line     | Details                                                                                                   | Status       |
| --------------------------- | -------- | --------------------------------------------------------------------------------------------------------- | ------------ |
| `normalizeFiltersKey`       | ~3       | Deterministic JSON key from sorted filters object                                                         | ✅ CONFIRMED |
| `upsertChannel`             | ~38      | `INSERT ... ON CONFLICT (id) DO UPDATE SET ...`                                                           | ✅ CONFIRMED |
| `upsertVideos`              | ~51      | `INSERT ... ON CONFLICT (channel_id, youtube_video_id) DO UPDATE`                                         | ✅ CONFIRMED |
| `upsertVideoMetricsDaily`   | ~99      | `INSERT ... ON CONFLICT (channel_id, date, youtube_video_id) DO UPDATE`                                   | ✅ CONFIRMED |
| `upsertChannelMetricsDaily` | ~145     | `INSERT ... ON CONFLICT (channel_id, date) WHERE youtube_video_id IS NULL DO UPDATE`                      | ✅ CONFIRMED |
| Partial index dependency    | ~145     | Depends on `daily_analytics_channel_date_null_video_idx` -- if missing, UPSERT silently creates duplicates | ✅ CONFIRMED |
| `recordSyncRunStart/Done`   | ~20, ~28 | Inserts/updates `sync_runs` table                                                                         | ✅ CONFIRMED |

---

## 6. `backend/ingestion/readModels.js`

| Finding                         | Line | Details                                                                                                          | Status       |
| ------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------- | ------------ |
| `buildRange`                    | ~40  | `'7d'→7 days`, `'30d'→30 days`, `'90d'→90 days`, `'custom'→params`. No validation on invalid strings             | ✅ CONFIRMED |
| `shiftRange`                    | ~51  | `prevStart = startDate - duration`, `prevEnd = endDate - duration`                                               | ✅ CONFIRMED |
| `loadBundleFromPostgres`        | ~166 | Multi-CTE: `daily_totals`, `period_totals`, `comparison_totals`. May return nulls for channels with no data      | ✅ CONFIRMED |
| `loadSummaryFromPostgres`       | ~236 | Lightweight aggregated summary only (no daily breakdown)                                                         | ✅ CONFIRMED |
| `loadChannelVideosFromPostgres` | ~250 | `SELECT ... BETWEEN $2 AND $3 ORDER BY published_at DESC LIMIT $4 OFFSET $5`. Derives `ctr`, `avg_view_duration` | ✅ CONFIRMED |
| `safeQuery`                     | ~8   | `try/catch` returning `{ rows: [], error: e.message }` on failure                                                | ✅ CONFIRMED |
| Zero-fill location              | ~57  | Gap-fill happens here in JS via `Number(r.views \|\| 0)` -- not in SQL                                            | ✅ CONFIRMED |
| `getLatestMetricDate`           | ~25  | `SELECT MAX(date) FROM daily_analytics WHERE channel_id=$1`                                                      | ✅ CONFIRMED |
| `isMissingRelationError`        | ~4   | Checks for "relation" in PG error message                                                                        | ✅ CONFIRMED |

---

## 7. `backend/ingestion/snapshots.js`

| Finding                   | Line | Details                                                                                                | Status       |
| ------------------------- | ---- | ------------------------------------------------------------------------------------------------------ | ------------ |
| `getDashboardSnapshot`    | ~16  | Returns `null` if not found OR if `created_at` > 5 min old (application-side TTL)                      | ✅ CONFIRMED |
| `upsertDashboardSnapshot` | ~34  | `INSERT ... ON CONFLICT DO UPDATE SET data=EXCLUDED.data, created_at=NOW()`                            | ✅ CONFIRMED |
| Clock skew risk           | --    | 5-min TTL is app-side comparison. Multi-instance deployments with clock skew get inconsistent behavior | ✅ CONFIRMED |

---

## 8. `backend/db/client.js`

| Finding                | Line | Details                                                                                                                   | Status       |
| ---------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `getPostgresConfig`    | ~6   | `PGHOST` (default `localhost`), `PGPORT` (5432), `PGDATABASE` (`revtube`), `PGUSER` (`postgres`), `PGPASSWORD` (required) | ✅ CONFIRMED |
| `isPostgresConfigured` | ~19  | True if `PGHOST` and `PGPASSWORD` non-empty                                                                               | ✅ CONFIRMED |
| Pool config            | ~23  | `max: 20`, `min: 4`, `idleTimeoutMillis: 30000` -- hardcoded, not env-configurable                                         | ✅ CONFIRMED |
| `withClient`           | ~43  | Acquires from pool, releases in `finally`                                                                                 | ✅ CONFIRMED |

---

## 9. `backend/db/migrate.js`

| Finding                 | Line | Details                                                                                                           | Status       |
| ----------------------- | ---- | ----------------------------------------------------------------------------------------------------------------- | ------------ |
| `ensureMigrationsTable` | ~5   | `CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, executed_at TIMESTAMPTZ DEFAULT NOW())` | ✅ CONFIRMED |
| `runMigrations`         | ~14  | Alphabetical sort, filters unapplied, wraps each in transaction                                                   | ✅ CONFIRMED |
| Self-executing          | ~49  | Called at module load time                                                                                        | ✅ CONFIRMED |
| No rollback             | --    | No rollback support                                                                                               | ✅ CONFIRMED |

---

## 10. `backend/db/userAccessStore.js`

| Finding                | Line | Details                                                   | Status       |
| ---------------------- | ---- | --------------------------------------------------------- | ------------ |
| `normalizeAccessRow`   | ~16  | Maps snake_case → camelCase, defaults null arrays to `[]` | ✅ CONFIRMED |
| `getUserAccessByEmail` | ~25  | `SELECT * FROM user_access WHERE email = $1`              | ✅ CONFIRMED |
| `getUserAccessByUid`   | ~38  | `SELECT * FROM user_access WHERE uid = $1`                | ✅ CONFIRMED |
| `upsertUserAccess`     | ~51  | `INSERT ... ON CONFLICT (uid) DO UPDATE`                  | ✅ CONFIRMED |
| No batch ops           | --    | Each access check is a separate query                     | ✅ CONFIRMED |

---

## 11. SQL Migrations -- Schema Details

### `001_init_analytics.sql`

| Index                                         | Target                                                | Type                     | Status        |
| --------------------------------------------- | ----------------------------------------------------- | ------------------------ | ------------- |
| `idx_daily_analytics_channel_date`            | `daily_analytics(channel_id, date)`                   | B-tree                   | ✅ CONFIRMED  |
| `idx_daily_analytics_channel_video_date`      | `daily_analytics(channel_id, youtube_video_id, date)` | Partial (WHERE NOT NULL) | ✅ CONFIRMED  |
| `idx_videos_channel_published`                | `videos(channel_id, published_at DESC)`               | B-tree                   | ✅ CONFIRMED  |
| `idx_channels_user`                           | `channels(user_id)`                                   | B-tree                   | ✅ CONFIRMED  |
| Partial index for `upsertChannelMetricsDaily` | `daily_analytics` WHERE `youtube_video_id IS NULL`    | ❓ UNVERIFIED            | ❓ UNVERIFIED |

**⚠️ Critical unverified item**: The partial unique index required by `upsertChannelMetricsDaily`
(`WHERE youtube_video_id IS NULL`) was NOT confirmed to exist in migration files during this audit.
If it is absent, every channel-level daily metrics upsert silently inserts duplicate rows.
**Verify this index exists before running ingestion on a new environment.**

`channels` table has 20+ columns including boolean flags `missing_metadata`, `missing_analytics`,
`missing_videos` -- these control cron/ingestion behavior.

### `002_dashboard_snapshots.sql`

- Composite PK: `(channel_id, filters_key)` ✅ CONFIRMED
- `data` column is `JSONB` (not `JSON`) ✅ CONFIRMED
- No additional indexes beyond PK ✅ CONFIRMED

### `003_user_access_flags.sql`

- `uid TEXT PRIMARY KEY`, `email TEXT UNIQUE`, `can_view TEXT[]`, `can_edit TEXT[]` ✅ CONFIRMED
- No foreign keys to users table ✅ CONFIRMED

---

## 12. Frontend -- `src/stores/dashboardStore.ts`

| Finding                       | Line   | Details                                                                                                              | Status       |
| ----------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------- | ------------ |
| Full state shape              | ~10-40 | 20+ fields including `channels`, `selectedChannelId`, `period` (default `'30d'`), loading/error states per data type | ✅ CONFIRMED |
| Persist config                | ~590   | `partialize` persists only `{ channels, selectedChannelId, period, theme, sidebarOpen }`. Key: `dashboard-storage`   | ✅ CONFIRMED |
| `selectedChannelId` persisted | ~590   | **Yes** -- validated on load in `useDashboardChannel.ts`; stale IDs trigger `resetChannelState()` and first available channel | ✅ **FIXED** |
| Channel validation on load    | --      | `useDashboardChannel` validates persisted selection against `useChannelsQuery` results after channels load                  | ✅ **FIXED** |
| `resetChannelState`           | ~400   | Resets analytics, videos, playlists, dimensions to null/empty, all loading/error to false/null                       | ✅ CONFIRMED |
| Theme persisted               | ~590   | `theme` IS persisted -- not documented elsewhere                                                                      | ✅ CONFIRMED |

---

## 13. Frontend -- `src/machines/dashboardMachine.ts`

| Finding              | Line   | Details                                                                              | Status       |
| -------------------- | ------ | ------------------------------------------------------------------------------------ | ------------ |
| Guards               | ~30-38 | `hasChannels`, `hasSelectedChannel`, `noSelectedChannel`, `hasAnalytics`, `hasError` | ✅ CONFIRMED |
| Auto-load chain      | ~60-80 | `loadChannels` success → auto `loadChannelAnalytics` → auto `idle`                   | ✅ CONFIRMED |
| `lazyLoadVideos`     | ~90    | On-demand, videos tab navigation                                                     | ✅ CONFIRMED |
| `lazyLoadDimensions` | ~100   | On-demand, dimensions tab navigation                                                 | ✅ CONFIRMED |

---

## 14. Frontend -- `src/services/analyticsService.ts`

| Finding             | Line | Details                                                                                             | Status       |
| ------------------- | ---- | --------------------------------------------------------------------------------------------------- | ------------ |
| `UsageLimitError`   | ~15  | `status: 429`, `retryAfter?: number`, `type: 'usage_limit'`                                         | ✅ CONFIRMED |
| In-flight dedup map | --    | `inFlightReports`, `inFlightBundles`, `inFlightDimensions` maps with shared `withInFlightTimeout` helper | ✅ CONFIRMED |
| Dedup cleanup       | --    | `withInFlightTimeout` -- 30s `Promise.race` timeout; `.finally()` always deletes map key                  | ✅ **FIXED** |
| `getBundleCacheKey` | ~80  | `${channelId}:${JSON.stringify(normalizeFilters(filters))}`                                         | ✅ CONFIRMED |

---

## 15. Frontend -- `src/services/youtubeService.ts`

| Finding       | Line | Details                                                        | Status       |
| ------------- | ---- | -------------------------------------------------------------- | ------------ |
| Custom header | ~20  | `X-YouTube-Request: true` sent on every request -- undocumented | ✅ CONFIRMED |
| Error mapping | ~50  | 429→`UsageLimitError`, 401→`AuthError`, others→`YTError`       | ✅ CONFIRMED |

---

## 16. Frontend -- `src/services/authHeaders.ts`

| Finding                 | Line | Details                                                                                            | Status       |
| ----------------------- | ---- | -------------------------------------------------------------------------------------------------- | ------------ |
| `getFirebaseAuthHeader` | ~5   | Reads `localStorage.getItem('firebaseToken')` first                                                | ✅ CONFIRMED |
| Fallback                | ~8   | Falls back to `auth().currentUser.getIdToken()` only on localStorage miss                          | ✅ CONFIRMED |
| Stale token risk        | --    | If localStorage has expired token, Firebase SDK is bypassed. No expiry check on localStorage value | ✅ CONFIRMED |

---

## 17. Frontend -- `src/contexts/AuthContext.tsx`

| Finding             | Line | Details                                                              | Status       |
| ------------------- | ---- | -------------------------------------------------------------------- | ------------ |
| `PROFILE_CACHE_KEY` | ~10  | `'cachedUserProfile'` localStorage key                               | ✅ CONFIRMED |
| `AUTH_HINT_KEY`     | ~12  | `'authEmailHint'` localStorage key                                   | ✅ CONFIRMED |
| Profile caching     | ~200 | Optimistic read on init, background re-fetch                         | ✅ CONFIRMED |
| Token refresh       | ~300 | `isTokenExpired()` → `getIdToken(true)` → write localStorage → retry | ✅ CONFIRMED |

---

## 18. Frontend -- `src/contexts/FeatureConfigContext.tsx`

| Finding          | Line | Details                                                                                                                                    | Status       |
| ---------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| Default config   | ~15  | `enableVideoExport: true, enableCompare: true, enableSidebar: true, maxChannelsPerPage: 5, defaultPageSize: 10, refreshIntervalMs: 300000` | ✅ CONFIRMED |
| Cache key        | ~40  | `feature-config-cache`, 10-min TTL in localStorage                                                                                         | ✅ CONFIRMED |
| `getSearchLimit` | ~80  | Returns `maxChannelsPerPage * 3` (= 15) -- formula is undocumented                                                                          | ✅ CONFIRMED |

---

## 19. Frontend -- `src/utils/dashboardWorkspaceScope.ts`

| Finding                    | Line | Details                                                                  | Status       |
| -------------------------- | ---- | ------------------------------------------------------------------------ | ------------ |
| Anonymous fallback         | ~5   | Falls back to `{ userId: 'anonymous', email: null }` -- no data isolation | ✅ CONFIRMED |
| `DASHBOARD_WS_KEY_PENDING` | ~3   | Sentinel `'PENDING'` during auth                                         | ✅ CONFIRMED |

---

## 20. Frontend -- `src/utils/csvExport.ts`

| Finding       | Line | Details                                                     | Status       |
| ------------- | ---- | ----------------------------------------------------------- | ------------ |
| No BOM prefix | ~10  | Excel may mangle special/non-ASCII characters               | ✅ CONFIRMED |
| Export scope  | ~500 | CSV exports currently visible columns only, not all columns | ✅ CONFIRMED |

---

## 21. Frontend -- `src/utils/pdfExport.ts`

| Finding           | Line | Details                                                  | Status       |
| ----------------- | ---- | -------------------------------------------------------- | ------------ |
| System fonts only | ~10  | No embedded custom fonts -- non-ASCII may render as boxes | ✅ CONFIRMED |

---

## 22. Frontend -- `src/components/VideoTable.tsx`

| Finding               | Line | Details                                    | Status       |
| --------------------- | ---- | ------------------------------------------ | ------------ |
| Virtualizer           | ~300 | `estimatedRowHeight: 48px`, `overscan: 10` | ✅ CONFIRMED |
| Default sort          | ~120 | `publishedAt DESC`                         | ✅ CONFIRMED |
| Shift-click selection | ~150 | Multi-row range selection supported        | ✅ CONFIRMED |

---

## 23. Frontend -- `src/components/Compare.tsx`

| Finding                       | Line | Details                                                                                     | Status       |
| ----------------------------- | ---- | ------------------------------------------------------------------------------------------- | ------------ |
| Delta % div-by-zero           | ~300 | Returns `'∞'` string -- not `null` or `'N/A'`                                                | ✅ CONFIRMED |
| Frontend localStorage cache   | ~50  | Per-channel-combo key, **1-hour TTL** (`CACHE_DURATION`), org-scoped (`::org:{orgId}`)      | ✅ CONFIRMED |
| Upfront quota check           | ~25  | `checkCompareQuota()` called synchronously before API calls                                 | ✅ CONFIRMED |
| Backend integration           | ~244 | `fetchCompareVideos()` calls `POST /compare/videos` -- backend pagination + enrichment + metrics | ✅ CONFIRMED |
| Pre-computed metrics          | ~300 | Uses `backendMetrics` from endpoint when available, falls back to `calculateMetrics()`      | ✅ CONFIRMED |
| Graceful fallback             | ~310 | Falls back to client-side `fetchVideosOptimized()` if backend endpoint fails                | ✅ CONFIRMED |
| Org cache isolation           | ~401 | `useEffect` on `[currentOrganization?.id]` reloads from correct cache namespace on switch   | ✅ CONFIRMED |

---

## Open Bugs -- Corrected Severity List

### 🔴 Security (action required before next deploy)

1. **`/api/debug/tokens` -- dev-only, NOT a production risk** (`backend/index.js` ~1976)
   Wrapped in `if (process.env.NODE_ENV !== 'production')` AND protected by `checkAdmin`.
   Returns only `{ message, userEmail, note }` -- no raw tokens. Safe but keep guards in place. ✅

### 🟠 Medium Severity (correctness / quota)

2. **Zero-fill masking data outages** (`readModels.js` ~57)
   Missing dates filled with `0` not `null`. No way to distinguish API failure from genuine
   zero-traffic day. Blocks trustworthy audit output.

3. **`checkUsageLimit` before cache check** -- ✅ **FIXED** (`checkUsageLimit` + `incrementUsageLimit` on cache miss only)

4. **`withInFlight` no timeout -- backend** -- ✅ **FIXED** (`withInFlightTimeout`, 120s default)

5. **`withInFlight` no timeout -- frontend** -- ✅ **FIXED** (`withInFlightTimeout`, 30s)

6. **`selectedChannelId` stale on load** -- ✅ **FIXED** (`useDashboardChannel.ts` validates + `resetChannelState()`)

7. **Compare quota not enforced** -- ✅ **FIXED** (`checkCompareQuota()` calls `POST /api/usage/track` upfront before any API calls. Backend endpoint runs `checkUsageLimit("compare")` + `incrementUsageLimit(req)`. If quota exhausted (429), comparison stops and shows `UsageLimitBanner`.)

8. **Org membership cache staleness after invitation accept** ✅ **FIXED**
   When a new user accepted an org invitation with "read" access, the backend cache
   invalidation was rejected (403) because the new user wasn't an owner/admin.
   The `/organization/invalidate-member` endpoint now allows the user whose membership
   is being invalidated (self = user being added/removed/updated). Frontend now awaits
   cache invalidation before navigation. (`backend/routes/organization.js`, `frontend/src/services/organizationService.ts`)

9. **`upsertChannelMetricsDaily` partial index unverified** (`store.js` ~145)
   If partial unique index `WHERE youtube_video_id IS NULL` is absent, all channel-level
   daily metrics silently insert duplicates. Must verify index exists in migrations.

10. **`morgan()` absent -- replaced by custom `requestLogger`** (`backend/index.js` ~568)
    Custom middleware logs method, status, timing, and cache events. Enabled by default in dev
    via `REQUEST_LOG` env var.

### 🟡 Low Severity (tech debt)

11. **`refreshGoogleToken` OAuth token cache** -- ✅ **FIXED** (`oauth:token:{hash}`, 55 min TTL)

12. **`authHeaders.ts` stale localStorage token** (`authHeaders.ts` ~5)
    localStorage is primary token source. Cleared localStorage with valid Firebase session
    still tries stale token first.

13. **`defaultTTL` 24h in Redis-less fallback** (`backend/index.js` ~441)
    In-memory cache instantiated at 24h TTL (not 12h class default). Holds stale data 24h on
    restarts without Redis.

14. **`snapshots.js` application-side TTL** (`snapshots.js` ~16)
    5-min TTL checked in JS, not SQL. Clock skew between instances = inconsistent behavior.

15. **`emailService.js` inline HTML templates** (`emailService.js` ~37)
    No i18n, no plaintext fallback, hard to maintain.

16. **CSV no BOM prefix** (`csvExport.ts` ~10)
17. **PDF no custom font embedding** (`pdfExport.ts` ~10)
18. **Compare `'∞'` for division by zero** (`Compare.tsx` ~300)
19. **`maxChannelsPerRun` not env-configurable** (`cron.js` ~30 ❓ UNVERIFIED)

---

## Items Requiring Second Audit Pass

Run a targeted audit on these files -- they were NOT FOUND or UNVERIFIED in the first pass:

| File                                        | What to Extract                                                                  |
| ------------------------------------------- | -------------------------------------------------------------------------------- |
| `backend/db/migrations/`                    | All `.sql` files -- confirm partial index `WHERE youtube_video_id IS NULL` exists |

---

## Closed / Resolved Items

| Item                                                  | Resolution                                                                                |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Org membership cache staleness after invitation accept | **CLOSED -- FIXED** -- backend allows self-invalidation, frontend awaits invalidation. Removes false 403 PREMIUM_REQUIRED for new org members. |
| `channels/mine` cache key missing user scope (🔴 BUG) | **CLOSED -- FIXED** in source. Scope is included. Remove from Change_plans.md open issues. |
| Video cap documented as 200                           | **CORRECTED** -- actual default is 500. Update all references.                             |
| `maxSize: 500`                                        | **CORRECTED** -- actual is 1000.                                                           |
| `defaultTTL: 5 min`                                   | **CORRECTED** -- actual is 24h (instantiation override), 12h class default.                |
| Compression uses `deflateSync`                        | **CORRECTED** -- actual uses async `zlib.gzip`.                                            |
| `get()` returns `{ hit, stale, data }`                | **CORRECTED** -- returns data directly or null.                                            |
| `helmet()` absent (🔴 SECURITY)                       | **CLOSED -- FIXED** -- added at line 668 with CSP disabled, cross-origin resource policy.   |
| Admin cron endpoints unprotected (🔴 SECURITY)        | **CLOSED -- FIXED** -- `authenticateRequest` + `checkAdmin` added to all 3 routes in cron.js |
| `withInFlight` no backend timeout (🟠 MEDIUM)         | **CLOSED -- FIXED** -- `withInFlightTimeout` at line 80 with 120s default.                  |
| `MAX_VIDEOS_PER_CHANNEL` declared but NOT wired       | **CLOSED -- FIXED** -- env var now wired through cron, admin endpoints, queue workers. Circular dependency resolved. |
| `USAGE_DEDUP_WINDOW_SEC` declared but NOT wired       | **CLOSED -- FIXED** -- wired into quota middleware with per-page windows (compare: 60s, dashboard: 10s). |
| Playlists blocked by Channel quota (🔴 BUG)           | **CLOSED -- FIXED** -- `X-Usage-Context: resolve` now fully bypasses `checkUsageLimit` early. |
| Resolve-only skipped increment but still blocked (🔴 BUG) | **CLOSED -- FIXED** -- resolve calls `return next()` before any check or counter interaction. |
| Fire-and-forget `incrementUsageLimit` could silently fail (🔴 BUG) | **CLOSED -- FIXED** -- changed to `await` with try/catch across all endpoints. |
| Quota increment after cache miss (🔴 BUG)             | **CLOSED -- FIXED** -- increment moved **before** cache check in all YouTube Data proxy endpoints. Single increment at top of `generateDashboardBundle`. |

---

## 24. BullMQ Queue System (`backend/queue/`)

| Finding | Line | Details | Status |
|---------|------|---------|--------|
| Queue service factory | `queue/index.js:28` | `createQueueService(deps)` -- same factory pattern as other services. Creates 3 BullMQ queues + workers + Bull Board. | ✅ CONFIRMED |
| Null fallback | `queue/index.js:29-33` | When `REDIS_URL` is not set, returns no-op service (all methods are `() => Promise.resolve()`). App continues without queues. | ✅ CONFIRMED |
| Redis connection | `queue/index.js:36-50` | Separate `ioredis` connection from ServerCache's `redis` package connection. `maxRetriesPerRequest: null` (required by BullMQ), `enableReadyCheck: false`, custom retry strategy (up to 10 attempts, max 3s delay). | ✅ CONFIRMED |
| Queue configs | `queue/index.js:58-86` | Default job options: `attempts` (3/2/3), `backoff` exponential (30k/30k/60k ms), `removeOnComplete` age (7d/3d/1d), `removeOnFail` age (14d/7d/7d). | ✅ CONFIRMED |
| Worker concurrency | `queue/index.js:89-105` | Ingestion: 3, Cache-warm: 5, Email: 2. All in-process (no separate worker processes). | ✅ CONFIRMED |
| Worker event logging | `queue/index.js:108-131` | `completed`, `failed`, `error`, `active` (active only when `PERF_LOG=1`) events logged with `[Queue]` prefix. | ✅ CONFIRMED |
| Bull Board mount | `queue/index.js:134-155` | Bull Board UI available at `/admin/queues` behind `authenticateRequest` + `checkAdmin`. Cookie-based auth bridge (`bull_board_token`, 1h, `SameSite=Strict`). | ✅ CONFIRMED |
| Ingestion processor | `queue/ingestionQueue.js` | Destructures `{ ingestChannelDaily }` from deps. Calls with `{ channelId, authHeader, maxVideos, days }`. Returns stats from `ingestChannelDaily`. | ✅ CONFIRMED |
| Cache-warm processor | `queue/cacheWarmQueue.js` | **6-phase expansion**: Warms dashboard bundles (per period), dimensions (7d/30d/90d -- was 90d only), video list, DB audience active time (view-velocity), retention trend (30-day rolling), YT API audience day-of-week breakdown. Progress tracking via `stepsDone/totalSteps`. Each phase wrapped in try/catch -- failures log warnings without aborting remaining phases. | 🆕 NEW |
| Email processor | `queue/emailQueue.js` | Switch on `type`: `'sendInvitationEmail'` and `'sendOwnershipTransferEmail'`. Validates required fields. Returns `messageId`. | ✅ CONFIRMED |
| Cron refactored | `cron.js` | `runCacheRefresh`/`runPostgresIngestion` now enqueue jobs with 500ms spread delay instead of sequential execution. | ✅ CONFIRMED |
| Email routes refactored | `routes/organization.js` | `POST /send-invitation` and `POST /send-ownership-transfer` now call `queueService.enqueueEmail(...)` and return 200 immediately instead of `await sendInvitationEmail(...)` (blocking SMTP). | ✅ CONFIRMED |
| Admin endpoints | `cron.js:179-231` | Queue-enabled admin endpoints: `POST /admin/cache/refresh-all`, `POST /admin/ingestion/refresh-all`, `POST /admin/ingestion/refresh-channel`, `GET /admin/queue/metrics`. All behind `authenticateRequest` + `checkAdmin`. | ✅ CONFIRMED |
| Nginx rate limiting | `frontend/nginx.conf` | Added `limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s`. `/api/` gets burst 20, `/admin/queues` gets burst 10. | 🆕 NEW |
| Admin rate limiter | `middleware/rateLimiter.js:78-86` | Previously no-op (`(req,res,next) => next()`). Now enforces 60 req/15min via `express-rate-limit`. | 🆕 NEW |
| Bull Board query param removed | `backend/index.js:523-525` | Removed `?token=` query param fallback for Bull Board auth (leaked tokens in URLs). Cookie-based auth only. | 🆕 NEW |
| Redis split into cache + queue | `docker-compose.yml:27-86` | Redis now runs two instances: `redis` (cache, `allkeys-lru`, 256MB/384MB) and `redis-queue` (BullMQ, `noeviction`, 64MB/128MB). Complete isolation -- cache eviction cannot affect queue state. Backend uses `QUEUE_REDIS_URL` for BullMQ with fallback to `REDIS_URL`. | 🆕 NEW |
| Org token stale override (🔴 BUG) | `middleware/orgToken.js:71-77` | When `resolveOrgToken` attempted to refresh and got 400 (`invalid_grant`), the catch block silently kept the expired `orgAccessToken` and still set it as `req.headers.authorization`. This caused cascading 401s on all downstream YouTube API calls, overriding even valid personal tokens. Fixed by nulling `orgAccessToken` on refresh failure. | 🆕 NEW |

---

## 25. Drizzle ORM Integration (`backend/db/`)

| Finding | File | Details | Status |
|---------|------|---------|--------|
| Schema definitions | `db/schema.js` | 7 `pgTable` definitions: `analyticsChannels`, `analyticsVideos`, `channelMetricsDaily`, `videoMetricsDaily`, `dashboardSnapshots`, `userAccessFlags`, `syncRuns`. All columns match existing PostgreSQL schema exactly. | 🆕 NEW |
| Drizzle singleton | `db/drizzle.js` | `getDb()` returns lazy-initialized Drizzle instance wrapping the shared `pg.Pool`. Returns `null` when Postgres is not configured -- callers must null-check. | 🆕 NEW |
| Drizzle config | `drizzle.config.js` | Schema file `./db/schema.js`, out dir `./db/drizzle`, dialect `postgresql`. Used by `drizzle-kit generate`. | 🆕 NEW |
| Migration runner | `db/migrate.js` | Custom hash-based runner (NOT Drizzle's built-in `migrate()`). Reads `.sql` files from `db/drizzle/`, computes content hash via `simpleHash()` (Bernstein/djb2 variant, 8-char hex), deduplicates via `__drizzle_migrations` table. Runs at startup via `start.sh`. | 🆕 NEW |
| Drizzle read models | `ingestion/readModelsDrizzle.js` | 6 parameterized replacements for raw-SQL functions: `loadBundleFromPostgres`, `loadBundleComparison`, `loadChannelTotals`, `loadChartMetrics`, `loadBestTimeToPost`, `loadWeeklyEngagement`. Same signatures as `readModels.js` -- drop-in swap. Uses `sql`` tagged templates and query builder for zero injection risk. | 🆕 NEW |
| `Dockerfile` drizzle-kit | `Dockerfile` | Stage 1 installs all deps (`pnpm install --frozen-lockfile` without `--prod`), runs `npx drizzle-kit generate`, then `pnpm prune --prod`. Generated `.sql` files copied into runtime image via `COPY --from=dependencies`. | 🆕 NEW |
| `_journal.json` | `db/drizzle/meta/_journal.json` | Baseline entry `{ idx: 0, tag: "0000_initial" }` tells drizzle-kit the first migration is already generated. Future schema changes produce incremental files (`0001_*.sql`, `0002_*.sql`). | 🆕 NEW |
| Migration hash dedup | `db/migrate.js` | Tracks by content hash, not filename. Renaming a file doesn't re-apply. `simpleHash()` produces 8-char hex (e.g., `f3a2b1c0`). Manual `DELETE FROM __drizzle_migrations WHERE hash = '...'` to force re-application. | 🆕 NEW |
| `table.primaryKey is not a function` | `db/migrate.js` | Root cause: `drizzle-orm >= 0.45` built-in `migrate()` processes SQL through internal dialect API, not raw SQL. Fixed by custom SQL-based runner (see above). | ✅ FIXED |

---

## 26. Audience Analytics & Cache-Warm Queue Expansion

| Finding | File | Details | Status |
|---------|------|---------|--------|
| Audience active time (YT API) | `backend/services/insightsService.js` | `generateAudienceActiveTime()` -- day-of-week breakdown from YT Analytics API. Returns `{ dayOfWeek[], peakDay, peakDayLabel, totalViews }`. Cache key: `insights:audienceActive:v4:{scope}:{channelId}:{period}:{latestDate}`. | 🆕 NEW |
| Audience active time (DB) | `backend/services/insightsService.js` | `generateAudienceActiveTimeFromDb()` -- view-velocity hourly estimation from PostgreSQL. Returns `{ hourly[], peakHour, peakHourLabel, confidence, ... }` -- different shape from YT version, not directly swappable. Cache key: `insights:audienceActiveDb:v3:{scope}:{channelId}`. | 🆕 NEW |
| Retention trend | `backend/services/insightsService.js` | `generateRetentionByHour()` -- 30-day rolling retention from YT Analytics. Per-video average view percentage. Cache key: `insights:retentionByHour:v4:...`. | 🆕 NEW |
| Engagement chart dual-axis | `frontend/src/components/dashboard/InsightsPanel.tsx` | Weekly Audience Activity chart now shows views (bars, left Y-axis) AND totalEngagement (line, right Y-axis). `totalEngagement = subscribersGained + likes + comments + shares`. Tooltip shows full breakdown. | 🆕 NEW |
| Audience tab cache keys | `backend/services/dimensionsService.js` | `dims_v2:{scope}:{channelId}:{startDate}:{endDate}:{filtersHash}` -- with video/playlist filters. `dims_ch_v2:` -- channel-wide, no filters. 45-min TTL. | 🆕 NEW |
| Audience tab video clear | `frontend/src/hooks/useDashboardUI.ts` | `switchTab('audience')` clears `selectedVideo`, `selectedVideoIds`, `tableCheckedOverride` to prevent stale `video==` filters causing empty YT API responses. | ✅ FIXED |
| Audience tab skip auto-fill | `frontend/src/hooks/useDashboardSelection.ts` | When `activeTab === 'audience'` and no list active: `targetIds = []` -- skips all-videos auto-fill to avoid flooding YT API with unbounded channel-wide video IDs. Saved lists still populate correctly. | 🆕 NEW |
| Custom date range for dimensions | `backend/routes/dashboardTabs.js` | Added `dCustom` window: when `hasCustom` is true, audience dimensions fetch the full user-chosen range instead of clamping to 30d. | 🆕 NEW |
| Custom date range for retention | `backend/routes/dashboardTabs.js` | `retentionWindow` respects custom date range: `hasCustom ? { startDate, endDate } : rollingCurrent(anchorEnd, 30)`. | 🆕 NEW |
| Cache-warm 6-phase expansion | `backend/queue/cacheWarmQueue.js` | Before: bundles + 90d dimensions + videos + DB activity. After: bundles + 7d/30d/90d dimensions + videos + DB activity + retention + YT day-of-week. Total steps = `rawPeriods.length + 3 + 1 + 1 + 1 + 1`. | 🆕 NEW |
| YT Analytics API v2 limitation | `backend/services/dimensionsService.js` | Most dimensions (trafficSource, deviceType, country, gender, ageGroup) are aggregate-only per date range -- no daily breakdown. Only day-of-week has daily granularity. Cache key must include exact `startDate`/`endDate`. | 🆕 NEW |

---

## 27. Docker Build & Deployment

| Finding | File | Details | Status |
|---------|------|---------|--------|
| `Dockerfile` skip-worktree | `backend/Dockerfile` | Had `git skip-worktree` flag (`S` in `git ls-files -v`), causing git to ignore changes. Fixed with `git update-index --no-skip-worktree backend/Dockerfile`. | ✅ FIXED |
| Drizzle-kit in Docker build | `backend/Dockerfile` | Stage 1: `pnpm install --frozen-lockfile` (ALL deps) → `COPY . .` → `npx drizzle-kit generate` → `pnpm prune --prod`. Generated migrations copied to runtime stage. | 🆕 NEW |
| redis-queue service | `docker-compose.yml` | New service: `image: redis:7-alpine`, `noeviction` policy, 64MB maxmemory, 128MB container limit. Backend gets `QUEUE_REDIS_URL=redis://:pwd@redis-queue:6379`. | 🆕 NEW |
| Redis instance split | `docker-compose.yml` | `redis`: `allkeys-lru`, 256MB, 384MB limit (ServerCache, rate limiters, OAuth tokens). `redis-queue`: `noeviction`, 64MB, 128MB limit (BullMQ only). | 🆕 NEW |


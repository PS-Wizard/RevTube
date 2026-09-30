## Scheduled Tasks & Queue System

Relevant source files

- [backend/cron.js](../../backend/cron.js)
- [backend/queue/index.js](../../backend/queue/index.js)
- [backend/queue/ingestionQueue.js](../../backend/queue/ingestionQueue.js)
- [backend/queue/cacheWarmQueue.js](../../backend/queue/cacheWarmQueue.js)
- [backend/queue/emailQueue.js](../../backend/queue/emailQueue.js)
- [backend/ingestion/readModels.js](../../backend/ingestion/readModels.js)
- [backend/ingestion/readModelsDrizzle.js](../../backend/ingestion/readModelsDrizzle.js)
- [backend/services/insightsService.js](../../backend/services/insightsService.js)

The RevTube background task system uses **BullMQ** job queues running on a dedicated `redis-queue` instance (separate from the `redis` cache instance). This isolation ensures that cache eviction on `redis` never affects queue state, locks, or stall-detection. Scheduled work (cache warming, PostgreSQL ingestion, email delivery) is enqueued as jobs rather than executed sequentially, enabling parallel processing, built-in retries with exponential backoff, and full observability via the Bull Board monitoring UI.

---

## Architecture Overview

Three BullMQ queues run in-process workers (I/O-bound work: API calls, DB queries):

| Queue | Jobs | Concurrency | Retries | Backoff |
|-------|------|-------------|---------|---------|
| `ingestion` | `ingestChannelDaily` | 3 | 3 | 30s, 2m, 5m |
| `cache-warm` | Dashboard bundles, dimensions (7d/30d/90d), channel videos, DB audience activity, retention trend, YT audience day-of-week | 5 | 2 | 30s, 2m |
| `email` | `sendInviteEmail`, `sendOwnershipTransfer` | 2 | 3 | 1m, 5m, 15m |

### Queue Service Factory

The queue system follows the same `createQueueService(deps)` factory pattern used throughout the backend. It is created in `backend/index.js` after the other service dependencies and injected into route handlers and cron via the shared `deps` object.

**Connection:** BullMQ uses its own `ioredis` connection to the same `REDIS_URL` as ServerCache (which uses the `redis` package). Each maintains its own connection — this is fine and avoids coupling the queue system to ServerCache's internal state.

**Null fallback:** When `REDIS_URL` is not set, the factory returns a no-op service so the app still works without Redis.

Source: [backend/queue/index.js#28-33](../../backend/queue/index.js)

### Queue Files

```
backend/queue/
├── index.js              # createQueueService(deps) — creates all queues, workers, Bull Board
├── ingestionQueue.js     # Ingestion job processor
├── cacheWarmQueue.js     # Cache-warming job processor
└── emailQueue.js         # Email job processor
```

---

## Execution Schedule & Lifecycle

The scheduler is initialized in `backend/index.js` and uses `node-cron` running every 6 hours (`0 3,9,15,21 * * *`). Instead of executing work directly, it discovers channels from Firestore and enqueues jobs for parallel processing.

### Task Flow Overview (Current, Queue-Driven)

1. **Identity Discovery**: Cron queries Firestore's `youtubeTokens` collection group to find all unique YouTube channels connected to the platform. Tokens are deduplicated by channel and ordered **most-recently-active first** using each document's `updatedAt`, so the two scheduled caps always cover the channels in active use.
2. **Token Refresh**: For each channel, it exchanges the stored `refreshToken` for an ephemeral `accessToken` using the cached `refreshGoogleToken()` function (55-min OAuth token cache).
3. **Job Enqueuing**: Each channel's work is enqueued as a BullMQ job:
   - `runCacheRefresh` → one `warm` job per channel (added to `cache-warm` queue)
   - `runPostgresIngestion` → one `ingest` job per channel (added to `ingestion` queue)
4. **Parallel Processing**: Workers process jobs concurrently (up to 5 for cache warming, up to 3 for ingestion), with `CRON_STAGGER_MS` (default 500ms) staggered delays between enqueues to spread the initial load.
5. **Built-in Retries**: Failed jobs retry with exponential backoff (e.g., ingestion: 30s → 2m → 5m) instead of waiting for the next 6-hour cron cycle.
6. **Dead-letter tracking**: Jobs that exhaust all retries are retained in Redis for 14 days (`removeOnFail: { age: 3600 * 24 * 14 }`) for debugging via Bull Board.

### Scheduled caps

The scheduled runs apply a per-run channel cap so a single cycle cannot flood
YouTube's API. Both are env-tunable (`0` disables the cap), so scaling to a
larger channel base is a config change rather than a code change:

| Variable | Default | Governs |
|---|---|---|
| `CRON_WARM_MAX_CHANNELS` | `50` | Channels warmed per scheduled cache refresh |
| `CRON_INGEST_MAX_CHANNELS` | `100` | Channels ingested per scheduled Postgres run |
| `CRON_INGEST_DAYS` | `730` | Days of metric history re-ingested per run |
| `CRON_STAGGER_MS` | `500` | Delay between enqueues |

Because discovery is activity-ordered, a capped run skips the least recently
used channels rather than an arbitrary subset.

### Task Flow Overview (Before Queue System)

The old system ran everything sequentially within the same Node.js process:
- Each channel waited for the previous one to complete (2s cooldown for warm, 1.5s for ingestion)
- A single failure could delay the entire remaining batch by the cooldown time
- No retry mechanism — a transient API error meant waiting 6 hours for the next cron
- No visibility into failures beyond log lines

### Comparison: Sequential vs Queue-Driven

| Aspect | Before (Sequential) | After (Queue-Driven) |
|--------|--------------------|-------------------|
| 4-channel cache warm | ~20s+ wall time | ~5s wall time |
| Transient API failure | Lost, wait 6h | Retried 3× with backoff |
| Processing visibility | Log lines only | Bull Board dashboard |
| Email delivery | Blocks HTTP response (user waits) | Returns 200 immediately, sends async |
| Job history | None | 7–14 day retention in Redis |

---

## Cache Warming (`runCacheRefresh`)

The cache warming routine discovers channels and enqueues `warm` jobs to the `cache-warm` queue. Workers then proactively populate Redis with expensive-to-calculate analytics bundles.

### Discovery & Enqueue

1. Queries Firestore `youtubeTokens` collection group for active tokens.
2. Maps `channelId` to `orgId` to ensure cache warming uses the correct multi-tenant scope (`org:{orgId}:{channelId}`).
3. Refreshes each token (with 55-min OAuth token cache).
4. Enqueues a `warm` job with `{ channelId, authHeader, periods, orgId }` per channel.

### Warming Strategy (Worker-Side) — 6-Phase Expansion

Each `cache-warm` worker executes **6 warming phases** in sequence with progress tracking (`stepsDone/totalSteps`). A failure in any phase logs a warning but does NOT abort the remaining phases — cold hits still fall through to the synchronous path.

1. **Dashboard bundles** — `generateDashboardBundle` for 7d, 30d, and 90d periods (with comparison data).
2. **Dimensions** — `generateDimensions` for 7d, 30d, **and 90d ranges** (was 90d only). Each range calls 5 YT Analytics API calls for traffic source, device type, country, gender/age, and subscribed status.
3. **Video list** — `generateChannelVideos` (up to 500 videos, org-scoped cache key).
4. **DB audience active time** — `generateAudienceActiveTimeFromDb` — view-velocity hourly estimation from PostgreSQL (zero YT API cost).
5. **Retention trend** — `generateRetentionByHour` — 30-day rolling retention from YT Analytics API.
6. **YT audience day-of-week** — `generateAudienceActiveTime` — day-of-week breakdown with engagement data (likes, comments, shares).

Uses org-scoped cache keys (`org:{orgId}:{channelId}`) when the channel belongs to an organization; otherwise `cron:{channelId}` for personal channels.

### Stale Cache Clearing Before Re-Warming

Before enqueuing warming jobs, `cron.js` **wipes stale Redis keys** to prevent the cache-hit branch from returning old data immediately without recomputing from fresh PostgreSQL data. This is critical because `generateDashboardBundle` returns immediately on cache hit and has no built-in PostgreSQL staleness check.

The clearing step scans for two key prefixes:

| Prefix | What it affects | Purpose |
|--------|-----------------|---------|
| `snapshot:` | Cached dashboard snapshot payloads (charts, tables) | Forces fresh snapshot computation from PG |
| `summary:` | Cached dashboard summary/pill metadata (including `latestDate`) | Ensures pill numbers and "as of" date reflect the latest ingested data |

**Mechanism**: Calls `serverCache.deleteKeysContaining(prefix)` for each prefix before the warming loop starts. Failures are logged as warnings but do not abort the run — the warming loop continues even if Redis clearing partially fails.

**Edge case eliminated**: If PostgreSQL ingestion succeeds but the Redis cache still holds stale entries, dashboard users would see old data until the TTL expires (up to 24h). Clearing first ensures the cache is populated with fresh data during the same cron cycle.

### Quota Management

- Concurrency: Workers process up to 5 cache-warm jobs simultaneously.
- Burst spread: Jobs are enqueued with a `delay` option starting at 0ms and incrementing by 500ms per channel, preventing a thundering-herd against YouTube's API.
- Batching: The `maxChannels` parameter (default 100) limits the total number of channels processed in a single run.

Sources: [backend/cron.js#9-137](../../backend/cron.js)

---

## PostgreSQL Ingestion (`runPostgresIngestion`)

This task discovers channels and enqueues `ingest` jobs to the `ingestion` queue. Workers synchronize data from the YouTube Analytics API into PostgreSQL to support long-term trend analysis.

### Data Flow: API to DB

Each `ingestion` worker runs `ingestChannelDaily`, which:
1. Fetches daily metrics for up to 120 days and up to 500 videos per channel.
2. Upserts records into `analytics_video_metrics_daily` and `analytics_channel_metrics_daily`.
3. Returns detailed stats including `videosSynced`, `videoMetricDays`, `channelMetricDays`, and `elapsedMs`.

### Ingestion Logging

Workers provide detailed per-channel logging via BullMQ events:

- **Completion**: Logs `[Queue] ingest:{channelId} completed ({jobId})` with stats returned from the processor.
- **Failure**: Logs `[Queue] ingest:{channelId} failed after N attempt(s): {error.message}`.
- **Active**: When `PERF_LOG=1`, logs `[Queue] ingest:{channelId} active` when processing starts.

**`withRetry` error enhancement**: Failed YouTube API calls include the response body (truncated to 500 chars) in the thrown error message. Previously only the status code was available:
```
// Before:  [fetchAnalyticsReport] Request failed with status code 403
// After:   [fetchAnalyticsReport] Request failed with status code 403 — body: {"error":{"code":403,"message":"Access forbidden.","errors":[...]}}
```

Sources: [backend/cron.js#139-175](../../backend/cron.js) [backend/ingestion/readModels.js#25-38](../../backend/ingestion/readModels.js) [backend/ingestion/sync.js#31-34](../../backend/ingestion/sync.js)

---

## Email Queue

Email delivery (invitations, ownership transfers) previously blocked the HTTP response — users waited for `transporter.sendMail` to resolve before getting a 200. Now, route handlers enqueue email jobs and return immediately.

### Route Changes

| Endpoint | Before | After |
|----------|--------|-------|
| `POST /api/organization/send-invitation` | `await sendInvitationEmail(...)` — blocked on SMTP | `queueService.enqueueEmail('invitation', payload)` — returns 200 immediately |
| `POST /api/organization/send-ownership-transfer` | `await sendOwnershipTransferEmail(...)` — blocked on SMTP | `queueService.enqueueEmail('ownershipTransfer', payload)` — returns 200 immediately |

### Email Worker (`emailQueue.js`)

The processor uses a type switch:
- `'invitation'` → calls `sendInvitationEmail(orgId, orgName, inviteeEmail, role)`
- `'ownershipTransfer'` → calls `sendOwnershipTransferEmail(orgId, orgName, newOwnerEmail)`

Validates required fields before proceeding. On success, logs the `messageId`.

### Retry & Failure

- Retries: 3 attempts with exponential backoff (1m, 5m, 15m).
- Dead-letter: Failed jobs are retained for 7 days for debugging.
- Concurrency: 2 concurrent email sends (respects SMTP connection limits).

Sources: [backend/queue/emailQueue.js](../../backend/queue/emailQueue.js) [backend/routes/organization.js](../../backend/routes/organization.js)

---

## Admin Control & Manual Triggers

While the scheduler runs automatically, administrative endpoints allow manual intervention. These endpoints are protected by `authenticateRequest` + `checkAdmin` middleware.

### Queue-Enabled Admin Endpoints (in `cron.js`)

| Endpoint | Queue | Purpose |
| --- | --- | --- |
| `POST /admin/cache/refresh-all` | `cache-warm` | Enqueue cache-warm jobs for all channels. Default periods: `[7, 30, 90]`, maxChannels: 100. |
| `POST /admin/ingestion/refresh-all` | `ingestion` | Enqueue ingestion jobs for all channels. Options: `maxChannels`, `days`, `maxVideos`. |
| `POST /admin/ingestion/refresh-channel` | `ingestion` | Enqueue ingestion for a single channel. Body: `{ channelId, refreshToken, days, maxVideos }`. |
| `GET /admin/queue/metrics` | All | Returns queue job counts: `{ ingestion: {waiting, active, completed, failed, ...}, cacheWarm: {...}, email: {...} }` |

### Bull Board Queue Monitoring UI

Accessible at `/admin/queues` by authenticated admin users. Provides:
- Live job counts (waiting, active, completed, failed, delayed)
- Job details with data payload, progress, and error stack traces
- Manual retry of failed jobs
- Queue pause/resume controls

**Auth mechanism**: The AdminPage has an "Open Queue Dashboard" button that:
1. Fetches the current Firebase ID token via `auth.currentUser.getIdToken()`
2. Sets a `bull_board_token` cookie with the token (1h TTL, `SameSite=Strict`)
3. Opens `/admin/queues` in a new tab
4. The backend middleware reads the cookie and injects it as the `X-Firebase-Token` header

### Frontend Manual Trigger UI

The AdminPage's **danger zone** features:
- **"Refresh All Cache"** button — triggers `POST /admin/cache/refresh-all`
- **"Refresh YouTube Ingestion"** button with confirmation modal — triggers `POST /admin/ingestion/refresh-all`
- **Queue Dashboard CTA** — "Open Queue Dashboard" button that opens Bull Board

Both refresh buttons now show job counts returned by the backend (e.g., `"Enqueued cache refresh for 8 channels"`).

### Configuration Options

Manual triggers support JSON payloads to override default behavior:
- `periods`: Array of day counts (e.g., `[7, 30, 90, 365]`).
- `maxChannels`: Limit the number of channels to process.
- `days`: For ingestion, specifies how many days of history to fetch.
- `maxVideos`: Maximum videos per channel to process during ingestion.

---

## Error Handling & Reliability

The queue-based system has multiple layers of resilience:

1. **Job-level retries**: Each queue has its own retry policy (see architecture table). Transient YouTube API errors (429, 5xx) trigger automatic retries with exponential backoff — no manual intervention needed.

2. **Isolation**: A failure in one channel's job does not affect other jobs. BullMQ manages each job independently, unlike the old sequential `for` loop where a failure blocked the remaining channels.

3. **Worker concurrency limits**: Ingestion (3), cache-warm (5), email (2) — prevents resource exhaustion while maintaining parallelism.

4. **Job TTLs**: Completed jobs are cleaned up after 3–7 days; failed jobs after 7–14 days. This prevents Redis from growing unboundedly.

5. **Redis connection resilience**: The BullMQ `ioredis` connection uses a `retryStrategy` with exponential backoff (up to 10 retries, max delay 3s). If Redis is permanently unavailable, the queue service returns no-op functions and the app continues without queues.

6. **Stale cache guard**: Before re-warming, stale `snapshot:` and `summary:` Redis keys are cleared to prevent the cache-hit branch from serving old data after a fresh PostgreSQL ingestion.

7. **Postgres Check**: Ingestion jobs skip processing if PostgreSQL is not configured, preventing crashes in Redis-only environments.

8. **Read Model Fallbacks**: If the Postgres tables are missing (migrations not run), `safeQuery` logs a warning and allows the system to fall back to live YouTube API requests.

Sources: [backend/cron.js#6-12](../../backend/cron.js) [backend/queue/index.js#36-50](../../backend/queue/index.js) [backend/ingestion/readModels.js#4-18](../../backend/ingestion/readModels.js) [backend/ingestion/sync.js#31-34](../../backend/ingestion/sync.js)

---

## Bull Board — Queue Monitoring UI

Bull Board is an optional monitoring UI that provides a visual dashboard for all BullMQ queues.

### Mounting

Mounted at `/admin/queues` behind the full middleware stack:
1. **Auth bridge middleware**: Reads `bull_board_token` cookie as fallback for `X-Firebase-Token`.
2. `authenticateRequest`: Verifies the Firebase ID token.
3. `checkAdmin`: Confirms admin role.
4. Bull Board Express router: Serves the UI.

### Features

- **Queue dashboard**: Shows live counts for all 6 queues (ingestion, cache-warm, email, video-audit, audit, optimizer)
- **Job details**: Click any job to see its data payload, progress, timestamps, and error stack traces
- **Actions**: Retry failed jobs, remove completed/failed jobs, pause/resume queues
- **Real-time updates**: Auto-refreshes via WebSocket (Bull Board built-in)

### Dependencies

Added to `backend/package.json`:
```json
{
  "@bull-board/api": "^8.1.2",
  "@bull-board/express": "^8.1.2"
}
```

### Nginx Proxy

The frontend nginx config proxies `/admin/queues` to the backend with header forwarding (including `Cookie` for the auth bridge):

```nginx
location /admin/queues {
    set $backend_upstream backend;
    proxy_pass http://$backend_upstream:3000;
    proxy_set_header Cookie $http_cookie;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

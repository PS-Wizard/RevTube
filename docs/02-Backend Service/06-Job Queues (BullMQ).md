# BullMQ Queue System

The RevTube backend uses **BullMQ** (on top of Redis) to manage async background work with parallelism, retries, and full observability.

---

## Queues

Six queues run **in-process workers** (no separate worker process -- all work is I/O-bound):

| Queue | Jobs | Concurrency | Retries | Backoff | Completion clean | Failure clean |
|---|---|---|---|---|---|---|
| `ingestion` | `ingestChannelDaily` | 3 | 3 | 30s → 2m → 5m | 7 days | 14 days |
| `cache-warm` | Dashboard bundles (per period), dimensions (7d/30d/90d), channel videos, DB audience activity, retention trend, YT audience day-of-week | 5 | 2 | 30s → 2m | 3 days | 7 days |
| `email` | `sendInvitationEmail`, `sendOwnershipTransferEmail`, `sendAuditCompleteEmail` | 2 | 3 | 1m → 5m → 15m | 1 day | 7 days |
| `video-audit` | `video-audit` (LLM-scored video audits, DeepSeek + Gemini) | 2 | 3 | 1m → 5m → 15m | 1 day | 7 days |
| `audit` | `audit` (deterministic channel audits) | 2 | 3 | 1m → 5m → 15m | 1 day | 7 days |
| `optimizer` | `optimizer` -- thumbnail audit or playlist analysis, dispatched by `job.data.kind` | 2 | 3 | 1m → 5m → 15m | 1 day | 7 days |

The `video-audit`, `audit`, and `optimizer` workers override `lockDuration` to `AUDIT_LOCK_MS = 5min` (and `maxStalledCount: 3`). Audits fetch all of a channel's videos/playlists, which can exceed BullMQ's default 30s lock window; the longer lock lets long-running audit jobs complete instead of being marked stalled and retried forever.

### Default job options

Every queue has standard defaults set at construction:

```js
{
  attempts: 3,                         // retry count varies per queue (2 or 3)
  backoff: { type: 'exponential' },    // delay doubles each attempt
  removeOnComplete: { age: 3600 * 24 * N },  // auto-cleanup after N days
  removeOnFail: { age: 3600 * 24 * N },      // keep failures longer for debugging
}
```

---

## File structure

```
backend/queue/
├── index.js              # createQueueService(deps) -- factory: queues + workers + Bull Board
├── ingestionQueue.js     # Ingestion job processor
├── cacheWarmQueue.js     # Cache-warming job processor
├── emailQueue.js         # Email job processor
├── videoAuditQueue.js    # Video-audit job processor
├── auditQueue.js         # Deterministic channel-audit job processor
└── optimizerQueue.js     # Thumbnail / playlist optimizer job processor (dispatched by job.data.kind)
```

---

## Architecture

### Connection

BullMQ uses its own `ioredis` connection to a **separate Redis instance** (`redis-queue`) than the ServerCache (`redis`). This ensures BullMQ's job state is isolated from cache data:

| Instance | Service | Eviction | Purpose |
|---|---|---|---|
| `redis` | ServerCache, rate limiters | `allkeys-lru` 256MB | Analytics cache, OAuth tokens, rate limiter data |
| `redis-queue` | BullMQ | `noeviction` 64MB | Queue state, locks, stalled-job detection, job data |

BullMQ connects via a `QUEUE_REDIS_URL` env var (falls back to `REDIS_URL`). ServerCache uses `redis` package on `REDIS_URL` -- each library maintains a separate connection to its own Redis instance.

```js
const redisUrl = process.env.QUEUE_REDIS_URL || process.env.REDIS_URL;
const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,  // required by BullMQ
  enableReadyCheck: false,
  retryStrategy: (times) => {
    const delay = Math.min(times * 100, 3000);
    if (times > 10) return null;  // give up after 10 retries
    return delay;
  },
});
```

### Null fallback

When neither `QUEUE_REDIS_URL` nor `REDIS_URL` is set, `createQueueService` returns a no-op service. All methods resolve silently, the app continues without queues.

```js
function createNullQueueService() {
  const noop = () => Promise.resolve();
  return {
    enqueueIngestion: noop,
    enqueueCacheWarm: noop,
    enqueueEmail: noop,
    enqueueVideoAudit: noop,
    jobsGet: async () => null,
    enqueueAudit: noop,
    auditJobsGet: async () => null,
    enqueueOptimizer: noop,
    optimizerJobsGet: async () => null,
    queues: { ingestion: null, cacheWarm: null, email: null, videoAudit: null, audit: null, optimizer: null },
    getQueueMetrics: async () => ({ ingestion: {}, cacheWarm: {}, email: {}, videoAudit: {}, audit: {}, optimizer: {} }),
    close: noop,
  };
}
```

### Dependency injection

Follows the existing `create*Service(deps)` factory pattern. The queue service is created in `backend/index.js` after other service deps and injected into the shared `deps` object passed to routes and cron.

---

## Queue Service API

```js
const queueService = createQueueService({ serverCache, ingestChannelDaily, ...sharedDeps });

// Enqueue a channel-ingestion job
await queueService.enqueueIngestion(
  { channelId, authHeader, maxVideos, days },
  { delay: 500 },           // optional: stagger delay in ms
);

// Enqueue a cache-warming job
await queueService.enqueueCacheWarm(
  { channelId, authHeader, periods, orgId },
  { delay: 500 },
);

// Enqueue an email job
await queueService.enqueueEmail(
  'invitation',                               // type
  { orgId, orgName, inviteeEmail, role },      // payload
);

// Enqueue a video audit job
await queueService.enqueueVideoAudit(
  { channelId, videoIds, authHeader, uid, email, orgId },  // payload
  { delay: 500 },
);

// Get a video audit job (for /video-audit/jobs/:id polling)
const job = await queueService.jobsGet('bull-job-id');

// Enqueue a deterministic channel audit (for /audit)
await queueService.enqueueAudit({ channelId, authHeader, uid, email, orgId });

// Get an audit job (for /audit/jobs/:id polling)
const auditJob = await queueService.auditJobsGet('bull-job-id');

// Enqueue a thumbnail OR playlist optimizer job (dispatched by kind)
await queueService.enqueueOptimizer({
  kind: 'thumbnail',                          // or 'playlist'
  payload: { urls, niche, ... },              // thumbnail: { urls, niche, targetAudience, brandVoice, channelId, channelTitle }
                                              // playlist:  { videos, channelIdentifier, filterConfig, channelId, channelTitle }
  uid, email, orgId,
});

// Get an optimizer job (for /:scope/jobs/:id polling)
const optimizerJob = await queueService.optimizerJobsGet('bull-job-id');

// Get job counts for all queues
const metrics = await queueService.getQueueMetrics();
// { ingestion: {...}, cacheWarm: {...}, email: {...},
//   videoAudit: {...}, audit: {...}, optimizer: {...} }

// Graceful shutdown
await queueService.close();

// Bull Board router (mount at /admin/queues)
app.use('/admin/queues', authMiddleware, adminMiddleware, queueService.bullBoardRouter);
```

---

## Job Processors

### Ingestion (`ingestionQueue.js`)

```js
async function processIngestion(job) {
  const { channelId, authHeader, maxVideos = 500, days = 90 } = job.data;
  const stats = await ingestChannelDaily({ channelId, authHeader, maxVideos, days });
  return stats;  // { videosSynced, videoMetricDays, channelMetricDays, elapsedMs }
}
```

- **Called by**: Cron `runPostgresIngestion`, admin `POST /admin/ingestion/refresh-all`, `POST /admin/ingestion/refresh-channel`
- **Data shape**: `{ channelId, authHeader: "Bearer <accessToken>", maxVideos?: number, days?: number }`
- **Retry strategy**: Transient YouTube API failures (429, 5xx) → 3 attempts with exponential backoff

### Cache-warming (`cacheWarmQueue.js`)

The cache-warm processor pre-computes audience and analytics data through **6 phases** with progress tracking:

```js
async function processCacheWarm(job) {
  const { channelId, authHeader, periods = [7, 30, 90], orgId } = job.data;

  // Total steps: bundles(periods.length) + dimensions(3 periods) + videos +
  //              db-activity + retention + yt-activity
  const totalSteps = rawPeriods.length + 3 + 1 + 1 + 1 + 1;
  let stepsDone = 0;

  // Phase 1: Warm dashboard bundles (one per period)
  for (const period of periods) {
    await generateDashboardBundle({ channelId, period, compare: true, ... });
    job.updateProgress(Math.round((++stepsDone / totalSteps) * 100));
  }

  // Phase 2: Warm dimensions for 7d, 30d, AND 90d (was 90d only)
  for (const period of [7, 30, 90]) {
    await generateDimensions({ channelId, startDate, endDate, ... });
    job.updateProgress(Math.round((++stepsDone / totalSteps) * 100));
  }

  // Phase 3: Warm video list
  await generateChannelVideos({ channelId, maxResults: 500, cacheScope, ... });
  job.updateProgress(Math.round((++stepsDone / totalSteps) * 100));

  // Phase 4: Warm DB-powered audience active time (view-velocity model)
  await generateAudienceActiveTimeFromDb({ channelId, scope, timezone: 'UTC' });
  job.updateProgress(Math.round((++stepsDone / totalSteps) * 100));

  // Phase 5: Warm retention trend (30-day rolling)
  await generateRetentionByHour({ channelId, period: 30, scope, req: null, ... });
  job.updateProgress(Math.round((++stepsDone / totalSteps) * 100));

  // Phase 6: Warm YT API audience day-of-week breakdown
  await generateAudienceActiveTime({ channelId, period: 30, scope, req: null, ... });
  job.updateProgress(Math.round((++stepsDone / totalSteps) * 100));

  return { warmed: true, channelId, stepsDone, totalSteps };
}
```

**Progress calculation**:
- Dashboard bundles: 1 step per period (e.g., 3 steps for [7, 30, 90])
- Dimensions: 3 steps (7d, 30d, 90d)
- Video list: 1 step
- DB audience activity: 1 step
- Retention trend: 1 step
- YT audience activity: 1 step

Each phase is wrapped in a try/catch -- a failure in one phase logs a warning but does not abort the remaining phases.

**Service deps used by the processor**:
- `generateDashboardBundle` (from `services/dashboardBundle.js`)
- `generateDimensions` (from `services/dimensionsService.js`)
- `generateChannelVideos` (from `services/channelVideosService.js`)
- `generateAudienceActiveTimeFromDb` (from `services/insightsService.js`)
- `generateRetentionByHour` (from `services/insightsService.js`)
- `generateAudienceActiveTime` (from `services/insightsService.js`)

- **Called by**: Cron `runCacheRefresh`, admin `POST /admin/cache/refresh-all`
- **Scope**: Uses `org:{orgId}:{channelId}` cache key when orgId is provided (via `cacheScope` param); otherwise `cron:{channelId}` for personal channels
- **Stale cache guard**: Before enqueuing, cron clears `snapshot:` and `summary:` Redis prefixes so the cache-hit branch doesn't serve stale data

### Email (`emailQueue.js`)

```js
async function processEmail(job) {
  const { type, payload } = job.data;
  switch (type) {
    case 'invitation':
      const result = await sendInvitationEmail(payload.orgId, payload.orgName, payload.inviteeEmail, payload.role);
      job.log(`Invitation sent: ${result.messageId}`);
      break;
    case 'ownershipTransfer':
      const result = await sendOwnershipTransferEmail(payload.orgId, payload.orgName, payload.newOwnerEmail);
      job.log(`Transfer email sent: ${result.messageId}`);
      break;
  }
}
```

- **Called by**: `POST /api/organization/send-invitation`, `POST /api/organization/send-ownership-transfer`
- **Async delivery**: Route handlers return 200 immediately; SMTP delivery happens in the worker
- **Validation**: Each type validates required fields before calling the email service

### Optimizer (`optimizerQueue.js`)

One queue serves **both** thumbnail audits and playlist analyses, dispatched on `job.data.kind`. Because the frontend enqueues instead of calling the sync `/analyze`, an analysis keeps running on the worker even if the user navigates away or closes the tab.

```js
async function processOptimizer(job) {
  const { kind, payload } = job.data || {};
  if (kind !== 'thumbnail' && kind !== 'playlist') {
    throw new Error(`Invalid optimizer job kind: ${kind}`);
  }
  if (kind === 'thumbnail') {
    const { urls = [], niche, targetAudience, brandVoice } = payload || {};
    const result = await thumbnailOptimizerService.analyze(urls, niche, targetAudience, brandVoice);
    const id = await persistThumbnail(job, payload || {}, result.results, result.errors);
    // INSERT INTO thumbnail_audits ... RETURNING id
    job.updateProgress(100);
    return { savedId: id, kind, result };
  }
  const { videos = [], channelIdentifier, filterConfig } = payload || {};
  const result = await playlistOptimizerService.analyze(videos, channelIdentifier, filterConfig);
  const id = await persistPlaylist(job, payload || {}, result);
  // INSERT INTO playlist_audits ... RETURNING id
  job.updateProgress(100);
  return { savedId: id, kind, result };
}
```

- **Called by**: `POST /api/thumbnail-optimizer/jobs`, `POST /api/playlist-optimizer/jobs` (via `queueService.enqueueOptimizer`)
- **Persistence**: the worker itself inserts into `thumbnail_audits` / `playlist_audits` before returning -- no separate client-side auto-save call is needed
- **Return value**: `{ savedId, kind, result }` -- the completion handler reads `job.returnvalue` to notify
- **Completion notification**: the optimizer worker's `completed` handler cannot use a fixed `label` (one queue, two kinds), so it derives one per job:
  ```js
  optimizerWorker.on('completed', (job) => {
    const kind = job.data?.kind;
    const label = kind === 'thumbnail' ? 'thumbnail-optimizer' : kind === 'playlist' ? 'playlist-optimizer' : 'optimizer';
    handleAuditCompleted({ notificationService, emailQueue, serverCache }, { label, job });
  });
  ```
- **Ownership**: the route runs `channelOwnership.validateVideos` before enqueueing, so non-admins may only submit their own connected-channel videos; admins bypass

---

## Cron integration (`cron.js`)

The `node-cron` scheduler (`0 3,9,15,21 * * *`) no longer executes work directly. Instead it:

1. **Discovers** channels from Firestore `youtubeTokens` collection group
2. **Refreshes** OAuth tokens (cached: 55-min TTL)
3. **Enqueues** one job per channel with 500ms stagger delay:

```js
// Cache warming -- enqueue with increasing delays
channels.forEach((channel, i) => {
  queueService.enqueueCacheWarm(
    { channelId: channel.id, authHeader: `Bearer ${accessToken}`, periods: [7, 30, 90] },
    { delay: i * 500 },
  );
});

// Ingestion -- same stagger pattern
channels.forEach((channel, i) => {
  queueService.enqueueIngestion(
    { channelId: channel.id, authHeader: `Bearer ${accessToken}`, maxVideos, days },
    { delay: i * 500 },
  );
});
```

Before enqueuing warm jobs, cron clears stale `snapshot:` and `summary:` Redis keys. Failures in this phase are logged but don't abort the run.

---

## Bull Board monitoring UI

Accessible at `/admin/queues` to authenticated admin users.

### Access

The AdminPage has an "Open Queue Dashboard" button that:
1. Calls `auth.currentUser.getIdToken()` to get the current Firebase ID token
2. Sets it as a `bull_board_token` cookie (1h TTL, `SameSite=Strict`, `path=/admin/queues`)
3. Opens `/admin/queues` in a new tab

The backend reads the cookie and injects it into `req.headers['x-firebase-token']` so the standard `authenticateRequest` middleware can verify it. The `?token=` query param fallback was removed as a security hardening measure (tokens in URLs can leak via nginx logs).

### Features

- **Dashboard**: Live job counts (waiting, active, completed, failed, delayed) for all 6 queues
- **Job detail view**: Click any job to inspect its data payload, progress %, timestamps, error stack traces, and retry history
- **Actions**: Retry failed jobs, remove completed/failed jobs, pause/resume entire queues
- **Search/Filter**: Filter jobs by state (active, waiting, failed, completed)

---

## Admin endpoints

All queue admin endpoints are registered directly on `app` (not `apiRouter`) with `authenticateRequest` + `checkAdmin` guards.

| Endpoint | Method | Queue | Description |
|---|---|---|---|
| `/admin/cache/refresh-all` | POST | `cache-warm` | Enqueue warm jobs for all channels (maxChannels: 100) |
| `/admin/ingestion/refresh-all` | POST | `ingestion` | Enqueue ingest jobs for all channels (body: `{ maxChannels, days, maxVideos }`) |
| `/admin/ingestion/refresh-channel` | POST | `ingestion` | Enqueue single-channel ingest job (body: `{ channelId, refreshToken, days, maxVideos }`) |
| `/admin/queue/metrics` | GET | All | Return job counts per queue |

All three trigger endpoints show job counts in their response (e.g., `{ message: "Enqueued 8 ingestion jobs", result: { success: 8, failed: 0 } }`).

---

## Worker event logging

Every worker logs to stdout with the `[Queue]` prefix, picked up by `docker-compose logs`:

```
[Queue] Connected to Redis (BullMQ)
[Queue] BullMQ queues initialized: ingestion (×3), cache-warm (×5), email (×2), video-audit (×2), audit (×2), optimizer (×2)
[Queue] ingest:UC123456 completed (bull:ingestion:abc123)
[Queue] warm:UC789012 completed (bull:cache-warm:def456)
[Queue] email:user@example.com completed (bull:email:ghi789)
[Queue] thumbnail-optimizer:bull:optimizer:abc123 completed
[Queue] playlist-optimizer:bull:optimizer:def456 completed
[Queue] ingest:UC123456 failed after 2 attempt(s): YouTube API 403 -- quota exceeded
```

Verbose active-job logging (when `PERF_LOG=1`):
```
[Queue] ingest:UC123456 active (bull:ingestion:abc123)
```

---

## Redis key patterns

BullMQ stores job data under these key prefixes on the same Redis instance:

| Pattern | Example | Purpose | Cleanup |
|---|---|---|---|
| `bull:{name}:id` | `bull:ingestion:abc123` | Job data | Via `removeOnComplete`/`removeOnFail` |
| `bull:{name}:id:logs` | `bull:ingestion:abc123:logs` | Job log entries | Same |
| `bull:{name}:wait` | `bull:ingestion:wait` | Waiting job list | Managed by BullMQ |
| `bull:{name}:active` | `bull:ingestion:active` | Active job list | Managed by BullMQ |
| `bull:{name}:failed` | `bull:ingestion:failed` | Failed job list | Managed by BullMQ |
| `bull:{name}:repeat` | `bull:cache-warm:repeat` | Repeatable job metadata | Managed by BullMQ |

BullMQ's `redis-queue` instance uses `noeviction` -- queue state, locks, and stall-detection keys must never be evicted. Completed/failed jobs are bounded by the `removeOnComplete`/`removeOnFail` TTLs, so memory growth is predictable. The cache `redis` instance uses `allkeys-lru` independently, so cache eviction never risks queue integrity.

---

## Error handling & resilience

| Scenario | Behavior |
|---|---|
| Redis unavailable at startup | No-op queue service returned, app continues |
| Redis drops mid-operation | ioredis retries up to 10 times (max 3s delay), then gives up |
| Job throws (transient) | Retried with exponential backoff per queue config |
| Job exhausts retries | Moved to failed set, retained for 7-14 days, visible in Bull Board |
| Worker crash | In-flight jobs auto-recover when the worker reconnects (Redis retains job state) |
| Worker concurrency capped | Ingestion max 3, cache-warm max 5, email max 2, video-audit/audit/optimizer max 2 each -- prevents OOM/thundering-herd |
| Job TTL exceedance | Cleaned by `removeOnComplete`/`removeOnFail` age config -- no infinite Redis growth |

---

## Dependencies

Added to `backend/package.json`:

```json
{
  "bullmq": "^5.46.3",
  "ioredis": "^5.6.1",
  "@bull-board/api": "^8.1.2",
  "@bull-board/express": "^8.1.2"
}
```

BullMQ requires `ioredis` (not the `redis` package that ServerCache uses). Peer dep warning: `bullmq` expects `redis@>=5` but the project uses `redis@4.7.1` -- this is harmless because `bullmq` uses `ioredis` internally and never touches the `redis` package import.

---

## Adding a new queue

1. Create a processor file in `backend/queue/` (e.g., `myThingQueue.js`)
2. Export `createMyThingProcessor(deps)` -- an async function taking `(job)`
3. In `backend/queue/index.js`, add to the `createQueueService()` factory:
   ```js
   const { createMyThingProcessor } = require('./myThingQueue');
   const myThingQueue = new Queue('myThing', { connection, defaultJobOptions: {...} });
   const myThingWorker = new Worker('myThing', createMyThingProcessor(deps), { connection, concurrency: 2 });
   setupWorkerEvents(myThingWorker, 'myThing');
   ```
4. Add `enqueueMyThing()` to the returned service object
5. Use `queueService.enqueueMyThing(data)` from route handlers or cron

> **Note (notifications):** the audit-completion notification does **not** use a
> dedicated queue. Instead, the `audit` / `video-audit` / `optimizer` workers' `completed`
> handler in `backend/queue/index.js` calls `handleAuditCompleted(...)`, which creates
> the in-app notification (via `notificationService`) and enqueues a
> `sendAuditCompleteEmail` job on the existing `email` queue. See
> [Notification System](../13-Notification System/02-Notification Reference). A per-job idempotency lock
> (`serverCache.setIfAbsent('notif:lock:${jobId}', ...)`) prevents duplicate
> notifications, because `worker.on('completed')` is a *global* event delivered to
> every worker/pod on the queue.
>
> `handleAuditCompleted` accepts four labels: `'video-audit'`, `'audit'`,
> `'thumbnail-optimizer'`, `'playlist-optimizer'`. The optimizer worker derives its
> label per job from `job.data.kind` because one queue serves both kinds.

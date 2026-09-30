## API Endpoints & Middleware

Relevant source files

-   [backend/index.js](../../backend/index.js)
-   [backend/routes/*.js](../../backend/routes)
-   [backend/middleware/*.js](../../backend/middleware)
-   [backend/middleware/auth.js](../../backend/middleware/auth.js)
-   [backend/middleware/premiumAccess.js](../../backend/middleware/premiumAccess.js)
-   [backend/middleware/quota.js](../../backend/middleware/quota.js)
-   [backend/middleware/rateLimiter.js](../../backend/middleware/rateLimiter.js)
-   [backend/middleware/orgToken.js](../../backend/middleware/orgToken.js)
-   [backend/middleware/configVersion.js](../../backend/middleware/configVersion.js)
-   [backend/utils/cacheScope.js](../../backend/utils/cacheScope.js)

> **How this document was built.** Every `router.<verb>(…)` call site in
> `backend/routes/*.js`, `backend/index.js` and `backend/chat/index.js` was parsed
> to produce the route table at the end. It is exhaustive rather than curated, so
> if a route is not in that table it does not exist. Re-derive it after adding or
> removing any route.

The RevTube backend is an Express 5 (CommonJS) application that orchestrates between
the React frontend and YouTube Data/Analytics, PostgreSQL, Redis, Firestore and the
LLM providers. The code is split across `routes/`, `middleware/`, `services/`,
`queue/`, `cache/`, `config/`, `utils/`, `ingestion/`, `db/` and `chat/`.
`backend/index.js` is the wiring hub: it constructs every service, then injects them
into the router factories.

## The app shape

```
app (Express 5)
├── helmet()            enforced CSP + cross-origin resource policy (config/securityHeaders.js)
├── cors()              allowlist + credentials
├── express.json()
├── requestLogger
├── GET  /health                 liveness, outside /api
├── GET  /api/proxy-image        image proxy, outside the auth wall
└── /api  (apiRouter)
    ├── GET  /admin/config       PUBLIC, before the auth wall
    ├── /oauth                   PUBLIC (own rate limit), before the auth wall
    │── ── AUTH WALL ──
    ├── checkConfigVersion
    ├── authLimiter
    ├── authenticateRequest
    ├── _usage injection         auto-attaches req.usageInfo to JSON responses
    └── authenticated routers
```

`app.set('trust proxy', 1)` is set for Coolify/nginx.

## CORS

`parseAllowedOrigins` builds the allowlist from a built-in set plus `FRONTEND_URL`,
`VITE_FRONTEND_URL`, `SERVICE_URL_FRONTEND` and `CORS_ORIGINS` (comma-separated
allowed). Origins are normalized by trimming and stripping trailing slashes. When
`NODE_ENV !== 'production'` the localhost API origins are added.

A blocked origin is logged together with the full allowlist, which is the fastest
way to diagnose a CORS failure in production.

## Auth wall ordering

The order below is load-bearing:

1. **`checkConfigVersion`** runs first, so a client on a stale config is told to
   reload before any work happens.
2. **`authLimiter`** is keyed on the verified uid where available, making it
   meaningfully per-user rather than per-IP.
3. **`authenticateRequest`** verifies the `X-Firebase-Token`.
4. The **`_usage` injection** middleware patches `res.json` to attach
   `body._usage = { used, limit, pageKey }` whenever `req.usageInfo` is set and the
   body is a plain object. This is why any quota-gated response can update the usage
   bar without a second round trip.


## Middleware reference

| Middleware | File | Responsibility |
|---|---|---|
| `authenticateRequest` | `middleware/auth.js` | Verify the Firebase ID token, set `req.authUser` |
| `checkAdmin` | `middleware/auth.js` | Require admin role |
| `resolveUser` | `middleware/auth.js` | Load the user profile and package into `req.currentUser` |
| `checkPremiumAccess(pageKey)` | `middleware/premiumAccess.js` | Block a page for non-Pro users and orgs |
| `requireQuota(pageKey)` | `middleware/quota.js` | Pre-flight the monthly limit, then consume 1 unit |
| `consumeQuota` | `middleware/quota.js` | Idempotent extra consumption (no-op after `requireQuota`) |
| `resolveOrgToken(param)` | `middleware/orgToken.js` | Resolve the org YouTube token when `X-Org-Id` is present |
| `requireOrgWrite` | `middleware/orgRole.js` | Require org write permission |
| `checkConfigVersion` | `middleware/configVersion.js` | Reject clients on a stale config version |
| `analyticsReadLimiter` | `middleware/rateLimiter.js` | High-limit bucket for read-heavy analytics |
| `authLimiter` / `oauthLimiter` / `adminLimiter` | `middleware/rateLimiter.js` | Per-scope rate limits |
| `createResolveLimiter` | `middleware/rateLimiter.js` | Tier-aware channel resolution limit |
| `requestLogger` | `middleware/requestLogger.js` | Structured request logging |
| `sanitizeCacheSegment` | `utils/cacheScope.js` | Strip colons, control chars and null bytes from cache keys |

`analyticsReadLimiter` exists as a separate, much higher bucket because the dashboard
fires many read calls per page view. Bucketing those under the general API limit
would break normal usage.

### `resolveOrgToken` and `_orgTokenResolved`

When a request carries `X-Org-Id`, `resolveOrgToken(paramName)` swaps the YouTube
credential to the org's token and sets `req._orgTokenResolved`. Downstream handlers
check that flag and skip their own inline resolution, so the org token is resolved
exactly once per request rather than once per handler.

### Quota semantics

`requireQuota(pageKey)`:

1. Resolves the user if not already resolved.
2. Admins bypass entirely.
3. Reads the current count. At or over the limit it returns **429** with
   `LIMIT_EXCEEDED`.
4. Sets `req.quotaContext` and `req.usageInfo`.
5. **Consumes 1 unit immediately**, on every route hit, cache hit or miss.

> **Correction.** This was previously documented as a read-only "check" that
> incremented only on a cache miss. That is not the current behaviour. The header
> comment in `middleware/quota.js` is explicit: "*Every* route hit counts,
> regardless of whether the response comes from cache." Consequence: a repeated
> request for identical data still costs a unit, mitigated only by the short dedup
> window.

A later `consumeQuota` call inside a handler is a no-op, because `requireQuota` set
`req._quotaConsumed`. The dedup window (default 5s, `QUOTA_DEDUP_WINDOW_SEC`) still
collapses genuinely simultaneous requests. Even on a dedup the current Redis count
is re-read, so the `_usage` block never carries a stale pre-increment value.

The org's plan is honoured: a free user who belongs to a Pro org gets the Pro limit.

### `POST /api/usage/track`

A synthetic quota endpoint for page keys with no route of their own, such as
`compare`. It runs `requireQuota` and returns 429 at the limit, so the Compare page
can check its budget upfront before firing any data request.

## Service Registration Pattern

All service factories follow the `create*Service(deps)` pattern with dependency injection. The main `backend/index.js` instantiates services, then spreads their public methods into a `serviceDeps` object that is consumed by route factories.

### Service Instantiation Order

```javascript
// In backend/index.js:

// 1. Shared dependencies (cache, config, DB helpers, etc.)
const sharedDeps = { /* ... */ };

// 2. Quota service (needed by data services for billable-work marking)
const quotaService = createQuotaService({ /* ... */ });

// 3. Data services (each receives sharedDeps + quota billing)
const analyticsService    = createAnalyticsService(sharedDeps);
const dashboardBundleService = createDashboardBundleService({ ...sharedDeps, ...analyticsService, markQuotaBillable: quotaService.markBillable });
const dimensionsService   = createDimensionsService({ ...sharedDeps, markQuotaBillable: quotaService.markBillable });
const insightsService     = createInsightsService({ ...sharedDeps, markQuotaBillable: quotaService.markBillable });
const channelVideosService = createChannelVideosService({ ...sharedDeps, markQuotaBillable: quotaService.markBillable });
const tokenService        = createTokenService(sharedDeps);

// 4. Merge all service methods into one deps bag available to every route factory
const serviceDeps = {
  ...sharedDeps,
  ...analyticsService,
  ...dashboardBundleService,
  ...dimensionsService,
  ...insightsService,
  ...channelVideosService,
  ...tokenService,
};
```

The `insightsService` (via `createInsightsService` in [services/insightsService.js](../../backend/services/insightsService.js)) exposes generators that are spread into `serviceDeps` and consumed by the dashboard tabs router:

- `generateBestTimeToPost` — YT API-powered (fallback)
- `generateBestTimeToPostFromDb` — PostgreSQL-powered (primary, returned as `bestTimeToPostV2`)
- `generateRetentionByHour`
- `generateRetentionByPublishHour`

The DB-powered analysis uses the `bestTimeToPostService` ([services/bestTimeToPostService.js](../../backend/services/bestTimeToPostService.js)), which implements rolling median normalization, winsorized z-score composites, empirical-Bayes shrinkage, bootstrap CIs, and Kruskal-Wallis testing — all from the `analytics_videos` table. Zero YT API quota consumed. Falls back to `generateBestTimeToPost` (YT API) when <10 videos exist in Postgres.

Sources: [index.js](../../backend/index.js) [services/insightsService.js](../../backend/services/insightsService.js) [services/bestTimeToPostService.js](../../backend/services/bestTimeToPostService.js) [utils/statistics.js](../../backend/utils/statistics.js) [routes/dashboardTabs.js](../../backend/routes/dashboardTabs.js)

## API Reference

The API is mounted under the `/api` prefix. It categorizes routes by their data source and administrative requirements.

### YouTube Data & Analytics

These endpoints proxy requests to Google APIs or retrieve materialized data from PostgreSQL.

#### `GET /api/captions/:videoId`

Fetches video captions/subtitles from the YouTube Captions API. Used by the VideoDetailDialog to display timestamped captions.

- **Middleware**: `resolveUser` (authenticated user required)
- **Auth**: Requires the caller to send their YouTube OAuth access token in the `Authorization: Bearer <token>` header. The API key alone is insufficient — the captions download endpoint requires OAuth.
- **Quota cost**: ~250 YouTube API units per successful fetch (50 for `captions.list` + ~200 for `captions/{id}` download)
- **No caching**: Captions are fetched live each time (they're typically small and requested infrequently)
- **Response shape**:
  ```json
  {
    "captions": [
      { "text": "Hello world", "start": 1.5, "duration": 2.0 },
      { "text": "This is a caption", "start": 3.5, "duration": 3.0 }
    ],
    "source": "youtube-api",
    "language": "en"
  }
  ```
- **Error states**:
  - `401` — Missing or expired YouTube OAuth token
  - `404` — No captions available for this video
- **Sources**: [routes/captions.js](../../backend/routes/captions.js)

### Video Audit

Async, LLM-scored video audit (`pageKey: videoAudit`). See [Video Audit](../12-Video Audit/02-Video Audit Reference) for the full feature reference.

**`POST /api/video-audit`** (enqueue a batch audit)
- **Middleware**: `resolveUser`, `checkPremiumAccess("videoAudit")`, `requireQuota("videoAudit")`, channel-ownership validation.
- **Body**: `{ "channelId": string, "videoIds": string[] }`. `channelId` must be one of the caller's connected channels (`ownership.getConnectedChannelIds`).
- **Response**: `{ "jobId": string }` (a BullMQ "video-audit" job).
- **Errors**: `400` missing/invalid body, `403` channel not owned, `429` quota exceeded.
- **Sources**: [routes/videoAudit.js](../../backend/routes/videoAudit.js), [queue/videoAuditQueue.js](../../backend/queue/videoAuditQueue.js).

**`GET /api/video-audit/jobs/:id`** (poll job status)
- **Middleware**: `resolveUser`.
- **Response**: `{ jobId, state, progress, result? }` where `result` (on `completed`) matches the scoring contract `{ results, overall, auditedAt }`.

**`POST /api/video-audit/history`** (save an audit result)
- **Middleware**: `resolveUser`.
- **Body**: `{ name?, channelId?, channelTitle?, results }` (results JSONB).
- **Response**: `{ id, createdAt }`.

**`GET /api/video-audit/history`** (paginated list)
- **Middleware**: `resolveUser`.
- **Query**: `limit` (default 20, max 50), `page` (default 1), `search` (case-insensitive match on the report `name`).
- **Response**: `{ items: [{ id, name, channelId, channelTitle, createdAt }], total, page }`.

**`GET /api/video-audit/history/:id`** (view one saved audit)
- **Middleware**: `resolveUser`. Returns `{ id, name, channelId, channelTitle, createdAt, results }` (results parsed from JSONB).

**`DELETE /api/video-audit/history/:id`**
- **Middleware**: `resolveUser`. Returns `{ success: true }`.

**Admin — `GET /api/admin/audit-criteria`** / **`PUT /api/admin/audit-criteria`**
- **Middleware**: `checkAdmin`. Read/write the freeform criteria config (`{ video: [...] }`).

### Channel Audit

Deterministic (no LLM) channel/video/playlist/general scoring (`pageKey: audit`).
Scores a channel across **four categories** (each sums to 100; overall is their
average). Heavy input gathering (channel metadata + **all** videos + **all**
playlists) and scoring run **asynchronously on a BullMQ "audit" queue**, so
`POST /api/audit` enqueues a job and the client polls it.

**`POST /api/audit`** (enqueue a deterministic audit)
- **Middleware**: `resolveUser`, `checkPremiumAccess("audit")`, `requireQuota("audit")`, channel-ownership validation.
- **Body**: `{ "channelId": string }`.
- **Response**: `{ "jobId": string }` (a BullMQ "audit" job).
- **Sources**: [routes/audit.js](../../backend/routes/auditOrchestrator.js), [queue/auditQueue.js](../../backend/queue/auditOrchestratorQueue.js).

**`GET /api/audit/jobs/:id`** (poll job status)
- **Response**: `{ jobId, state, progress, result? }` where `result` (on `completed`) is `{ results: { video, channel, playlist, general }, overall, input }`. `input` is the collected data (channel, videos, playlists) enriched with per-item `health` (0-100) for the color-coded "data the audit used" view.

Because gathering **all** videos/playlists can exceed BullMQ's default 30s lock
window, the `audit` and `video-audit` workers run with a **5-minute `lockDuration`**
and `maxStalledCount: 3` so long jobs complete instead of being marked stalled
and retried forever. See [Full Audit Orchestrator](../16-Full Audit Orchestrator/Full Audit Orchestrator) for full criterion
explanations.

**`POST /api/audit/history`** / **`GET /api/audit/history`** / **`GET /api/audit/history/:id`** / **`DELETE /api/audit/history/:id`**
- Save / list / view / delete saved audits in the PostgreSQL `audits` table. The list endpoint accepts `?page=`, `?limit=`, and `?search=` (case-insensitive match on the report `name`).

### Organization Management

Handles multi-tenant collaboration and permissioning.

### Administrative Routes

Protected by `checkAdmin` middleware, these routes manage system configuration and cache state.

#### Feature Config (Public & Admin)

**`GET /api/admin/config`** (Public — no auth required)
- Returns the global `FeatureConfig` (quotas, `premiumOnly` flags) for all users at boot.
- **Caching**: Uses `getFeatureConfig()` ([config/featureConfig.js](../../backend/config/featureConfig.js)) — backed by in-memory cache with a **10-min TTL** before re-reading Firestore. On admin update, cache is cleared instantly so the next request fetches fresh data.
- This is consumed by the frontend's `FeatureConfigProvider`, which further caches in `localStorage` with a **1-min TTL** and auto-polls every 60s via React Query's `refetchInterval`.

**`PUT /api/admin/config`** ([routes/admin.js](../../backend/routes/admin.js)) (Admin only)
- Updates `config/features` in Firestore with new limits and flags.
- Calls `invalidateFeatureConfigCache()` to clear backend in-memory cache ([config/featureConfig.js](../../backend/config/featureConfig.js)).
- Calls `bumpConfigVersion()` ([config/configVersion.js](../../backend/config/configVersion.js)) to increment `config/version`, which triggers `invalidateAnalyticsCache()` on next authenticated request — analytics dashboards reflect new quota/premium rules without waiting for cache TTL.

Sources: [routes/admin.js](../../backend/routes/admin.js) [config/featureConfig.js](../../backend/config/featureConfig.js) [config/configVersion.js](../../backend/config/configVersion.js) [backend/README.md#160-187](../../backend/README.md) [Caching Architecture#54-89](02-Caching Architecture (ServerCache & Redis))

### Dashboard Tab Endpoints

The dashboard tabs router ([routes/dashboardTabs.js](../../backend/routes/dashboardTabs.js)) consolidates per-tab data fetching into **single combined endpoints**. Each tab switch consumes exactly **1 quota unit**, regardless of how many YouTube API calls are made internally.

All tab endpoints share the same middleware pipeline:

```
analyticsReadLimiter → resolveUser → resolveOrgToken(req.body.channelId) → checkPremiumAccess("dashboard") → requireQuota("dashboard")
```

Quota consumption (`consumeQuota(req)`) is called inside the handler only after all data has been fetched, so failed requests do not count against the user's limit.

#### `POST /api/dashboard/tab/channel`

Channel analytics: daily chart data + multi-period (7d/30d/90d) stats + videos uploaded count.

- **Middleware**: analyticsReadLimiter → resolveUser → resolveOrgToken → checkPremiumAccess("dashboard") → requireQuota("dashboard")
- **Request body**:
  - `channelId` (string, required)
  - `period` (number, optional, default 30)
  - `startDate` / `endDate` (string, optional — custom date range)
  - `trueDelta` (boolean, optional — enable true-delta period comparisons)
  - `latestDate` (string, optional — client-provided latest data date anchor)
  - `videosLength` (number, optional — total video count for videosUploaded)
- **Response**:
  - `channelAnalyticsData` — aggregated totals (views, subscribersGained, subscribersLost, watchTime, likes, shares, comments, videosUploaded)
  - `channelAnalyticsChartData` — daily row array with the same metrics
  - `channelMultiPeriodStats` — `{ d7: { current, previous }, d30: { current, previous }, d90: { current, previous } }` each containing raw YT Analytics report rows
  - `latestDate` (string) — the resolved latest data date
- **Quota**: 1 unit per tab switch

The backend chart rows carry only the 7 report metrics — they do **not** include an
`uploads` field. The frontend (`useChannelTabQuery`) merges per-day upload counts from
the `videos` store into `channelAnalyticsChartData` client-side (same catalog that feeds
`videosUploaded`), so the Uploads series / mini bar graph on the Channel Analytics tab has
data. `videos.length` is part of the query key so the merge re-runs when the catalog arrives.

**`latestDate` resolution** (in order of precedence):
1. **Server-cached probe** — if a cached `latestDate:${channelId}` key exists (set with 60-min TTL by any prior analytics request), use it.
2. **Client-provided** `latestDate` — if no cached probe exists but the client sent a date, use it and also write it to the cache to warm subsequent requests.
3. **YouTube Analytics probe** — if neither cached nor client date is available, probe YT Analytics for the most recent day with data (queries 7-day window, 1 row, sorted descending by day).
4. **Fallback** — 2 days ago as a safe default.

The resolved `latestDate` is returned in the response body so the frontend can persist it via the `onPersistLatestDate` callback. The frontend stores it in Zustand (`state.dateRange.latestDataDate`) and passes it back on subsequent requests, breaking the stale-date chain.

#### `POST /api/dashboard/tab/videos`

Video catalog + analytics bundle in one round-trip.

- **Middleware**: Same pipeline as channel tab
- **Request body**:
  - `channelId` (string, required)
  - `period` (number, optional)
  - `startDate` / `endDate` (string, optional)
  - `compare` (boolean, optional — enable period-over-period comparison)
  - `trueDelta` (boolean, optional)
  - `filters` (string, optional — playlist/content filters)
  - `latestDate` (string, optional)
  - `maxResults` (number, optional)
- **Response**: `{ items: VideoMetadata[], bundle: DashboardBundle }`
- **Quota**: 1 unit per tab switch

#### `POST /api/dashboard/tab/playlists`

Playlist catalog + analytics bundle in one round-trip.

- **Middleware**: Same pipeline as channel tab
- **Request body**:
  - `channelId` (string, required)
  - `period`, `startDate`, `endDate`, `compare`, `trueDelta`, `filters`, `latestDate` (optional)
  - `pageToken` (string, optional — pagination for playlists API)
  - `maxResults` (number, optional, default 50)
- **Response**: `{ playlists: YouTubePlaylistsResponse, bundle: DashboardBundle }`
- **Quota**: 1 unit per tab switch

#### `POST /api/dashboard/tab/audience`

Audience dimensions across three time windows (7d/30d/90d) with optional comparison periods.

- **Middleware**: Same pipeline as channel tab
- **Request body**:
  - `channelId` (string, required)
  - `latestDate` (string, required — used to anchor period windows)
  - `filters` (string, optional)
  - `customStartDate` / `customEndDate` (string, optional)
- **Response**: `{ d7: { current, previous }, d30: { current, previous }, d90: { current, previous } }` where each value is a dimensions bundle or null
- **Quota**: 1 unit per tab switch

#### `POST /api/dashboard/tab/insights`

Best Time to Post (DB-powered V2 + YT API fallback) + Audience Retention by publish hour. The handler tries the DB-powered algorithm first; falls back to YT API when <10 videos are in Postgres.

- **Route**: `/api/dashboard/tab/insights`
- **Middleware**: analyticsReadLimiter → resolveUser → resolveOrgToken(req.body.channelId) → checkPremiumAccess("dashboard") → requireQuota("dashboard")
- **Request body**:
  - `channelId` (string, required)
  - `period` (number, optional, default 30)
  - `latestDate` (string, optional)
  - `startDate` / `endDate` (string, optional — custom date range)
- **Response**:
  - `bestTimeToPost` (object | null) — YT API fallback (see `generateBestTimeToPost` below)
  - `bestTimeToPostV2` (object | null) — DB-powered analysis (primary, from Postgres `analytics_videos`)
  - `retention` (object | null) — see `generateRetentionByHour` below
  - `retentionByPublishHour` (object | null) — see `generateRetentionByPublishHour` below

  All fields are nullable — if insufficient data exists, the corresponding field is `null`.
- **Quota**: 1 unit per tab switch

##### `generateBestTimeToPostFromDb` (primary — `bestTimeToPostV2`)

Queries `analytics_videos` from Postgres per-video, then applies:

1. **Rolling median normalization** (W=10) — deconfounds channel growth
2. **Composite score** = `0.6 × z_normalizedViews + 0.4 × z_likeRate` (winsorized at ±3)
3. **Three tracked z-scores per bucket**: `medianViewsZ`, `medianEngagementZ` (like-rate), `medianCommentsZ` (comment-rate) — used for per-metric best hour labels
4. **Hourly bucketing** (24 buckets, 0-23) — primary analysis. Also computes day-of-week (7) and daypart (4) buckets.
5. **Empirical-Bayes shrinkage** (k=4) — pulls low-N buckets toward channel median
6. **Bootstrap CI** (2000 resamples, α=0.05) — per-bucket confidence intervals
7. **Kruskal-Wallis** — tests for statistically significant differences across hours
8. **Confidence tiers** — High (n≥8, CI excludes global median, p<0.05), Medium (n≥4), Exploratory (<4)
9. **Per-metric best hour selection** — identifies the single best hour for each of 3 tracked metrics: views (`bestHourForViews`), engagement (`bestHourForEngagement`), and comments (`bestHourForComments`)

**Per-metric feasibility**: Per-video subscriber gain and retention data are not stored in `analytics_videos` — those exist only in the daily aggregate table. The three feasible per-metric labels use the z-score arrays tracked per bucket:
- **viewsZ** — rolling-median-normalized views (z-scored)
- **engagementZ** — like-rate (likes/views, z-scored)
- **commentsZ** — comment-rate (comments/views, z-scored, proxy for subscriber growth)

**Cache**: 12h TTL, key `insights:bestTimeToPost:v5:{scope}:{channelId}:{period}`

Returns `BestTimeToPostV2Data` — see [frontend types](../../frontend/src/types/dashboard.ts).

##### `generateBestTimeToPost` (fallback — `bestTimeToPost`)

Queries YouTube Analytics API v2 with:
- **Metrics**: `views, averageViewPercentage, subscribersGained, likes, comments, shares`
- **Dimension**: `day`
- **Server-side aggregation**: groups by day of week (0=Sunday through 6=Saturday), averages the percentage metrics, sums the count metrics

Returns:
```typescript
{
  bestDay: number,                    // day-of-week index (0-6)
  bestDayLabel: string,               // e.g. "Monday"
  dailyStats: Array<{
    day: number,
    label: string,
    views: number,
    averageViewPercentage: number,
    subscribersGained: number,
    likes: number,
    comments: number,
    shares: number,
  }>,
  recommendation: string,             // e.g. "Your audience is most active on Mondays"
  bestRetentionDay: number,
  bestRetentionDayLabel: string,
  bestSubscriberDay: number,
  bestSubscriberDayLabel: string,
}
```

##### `generateRetentionByHour`

Queries YouTube Analytics API v2 with:
- **Metrics**: `averageViewPercentage`
- **Dimension**: `day`
- **Aggregation**: returns the daily retention trend directly (hour-level is not available in the API, so "by hour" in the name refers to the trend chart across daily data points)

Returns:
```typescript
{
  dailyRetention: Array<{ date: string, retention: number }>,
  averageRetention: number,
}
```

##### `generateRetentionByPublishHour`

A two-step generator that joins YouTube Analytics data with YouTube Data API metadata:

1. **YT Analytics**: queries `estimatedMinutesWatched, views` with `video` dimension (per-video, up to 200 results)
2. **YT Data API**: fetches `videos.list` with `snippet` part in batches of 50 to extract `publishedAt` timestamps
3. **Server-side join**: groups by UTC publish hour (0-23), computes average minutes-per-view as a retention proxy

Returns:
```typescript
{
  retentionByHour: Array<{
    hour: number,
    label: string,           // e.g. "12AM", "1PM"
    avgRetention: number,     // average minutes-per-view
    videoCount: number,
  }>,
  bestHour: number,
  bestHourLabel: string,
  bestHourRetention: number,
  recommendation: string,
}
```

### Cache Keys for Insights Data

Insights data is cached with slow-changing TTLs since the aggregates are stable over hours.

| Cache Key | TTL | Description |
|---|---|---|
| `insights:bestDay:v3:${scope}:${channelId}:${period}` | 12 hours | Best-time-to-post day-of-week aggregates |
| `insights:bestTimeToPost:v5:${scope}:${channelId}:${period}` | 12 hours | DB-powered hourly best-time-to-post (V2) |
| `insights:bestDay:v3:${scope}:${channelId}:${period}:${startDate}:${endDate}` | 12 hours | Same, with explicit date range suffix |
| `insights:retention:v3:${scope}:${channelId}:${period}` | 12 hours | Daily retention trend data |
| `insights:retention:v3:${scope}:${channelId}:${period}:${startDate}:${endDate}` | 12 hours | Same, with explicit date range suffix |
| `insights:retentionByHour:v1:${scope}:${channelId}:${period}` | 12 hours | Per-video retention grouped by publish hour |
| `insights:retentionByHour:v1:${scope}:${channelId}:${period}:${startDate}:${endDate}` | 12 hours | Same, with explicit date range suffix |
| `latestDate:${channelId}` | 60 minutes | Latest available data date probe, shared across all routes |

The `scope` parameter is resolved via `youtubeDataScope(req, hasAuth)` — it is either `pub`, `u:{email}`, or `org:{orgId}:{channelId}` based on auth context and `X-Org-Id` header. The `latestDate` cache key is **not** scoped — it is global per channel so all tabs benefit from a single probe.

Sources: [routes/dashboardTabs.js](../../backend/routes/dashboardTabs.js) [services/insightsService.js](../../backend/services/insightsService.js) [services/analyticsService.js](../../backend/services/analyticsService.js) [index.js](../../backend/index.js)

## Data Resolution Strategy

The backend employs a "Postgres-First" strategy for analytics. When a request hits `/api/dashboard/bundle`, the system attempts to resolve data in the following order:

1.  Redis Cache: Check for a gzipped JSON response under a scoped key (e.g., `pub:bundle:...`) via [cache/ServerCache.js](../../backend/cache/ServerCache.js).
2.  PostgreSQL (Read Models): If `ANALYTICS_SOURCE` is `postgres-first`, query materialized tables like `analytics_video_metrics_daily` via [ingestion/readModels.js](../../backend/ingestion/readModels.js).
3.  YouTube API: As a final fallback, or if the cache is expired, perform live requests to Google APIs and update both PostgreSQL and Redis.

Entity Mapping: Analytics Resolution

Sources: [services/dashboardBundle.js](../../backend/services/dashboardBundle.js) [ingestion/readModels.js](../../backend/ingestion/readModels.js) [Project Overview#76](../20-Reference/Legacy Project Guide)

## Rate Limiting Architecture

RevTube uses `express-rate-limit` with custom key generators to prevent brute-force attacks and API abuse.

-   `authLimiter` ([middleware/rateLimiter.js](../../backend/middleware/rateLimiter.js)): Scoped to authenticated users. It uses `req.authUser.uid` as the key to ensure one user's activity doesn't block another user behind the same NAT/Proxy IP.
-   `analyticsReadLimiter` ([middleware/rateLimiter.js](../../backend/middleware/rateLimiter.js)): A higher-threshold bucket (1200 requests per 15 min) specifically for the data-heavy dashboard endpoints.
-   `oauthLimiter` ([middleware/rateLimiter.js](../../backend/middleware/rateLimiter.js)): A strict IP-based limit (30 requests per 15 min) for the sensitive `/oauth/exchange` endpoint.
-   `resolveLimiter` ([middleware/rateLimiter.js](../../backend/middleware/rateLimiter.js)): A dedicated rate limiter — **60 requests per 15 min** — for resolve-only endpoints (`/channel-videos/:channelId`, `/video/:videoId`). Prevents data-scraping abuse of resolve endpoints that skip monthly usage quota. Also applied to the full channel metadata routes (handle/username/id) as a secondary rate limit alongside `requireQuota("channel")`.

Sources: [middleware/rateLimiter.js](../../backend/middleware/rateLimiter.js) [backend/README.md#98-128](../../backend/README.md)

## AI Chat System Endpoints

The AI Chat module is a self-contained subsystem in `backend/chat/` mounted at `/api/chat/*`. It implements a streaming DeepSeek-powered agent with tool calling and dual-storage conversation memory.

**Module structure** (`backend/chat/`):

| Component | File | Purpose |
|-----------|------|---------|
| Wiring hub | `index.js` | Creates chat service + Express router with all endpoints |
| Agent loop | `AgentExecutor.js` | DeepSeek streaming agent (max 10 iterations, abort support) |
| Tool registry | `ToolRegistry.js` | 8 YouTube analytics tools |
| Guardrails | `Guardrails.js` | Input/output/tool security (injection detection, PII redaction) |
| Conversation memory | `ConversationMemory.js` | Redis + PostgreSQL conversation persistence |
| Tools | `tools/*.js` | Individual tool implementations (searchVideos, getChannelInfo, etc.) |

**Middleware applied to all chat routes:**

```
authenticateRequest → [optional: requireQuota('chat') on /messages]
```

The `/messages` endpoint additionally runs `requireQuota('chat')` after `authenticateRequest`, consuming one quota unit per message sent.

### `GET /api/chat/conversations`

- **Auth**: Firebase (via `authenticateRequest`)
- **Query params**: `?limit=50&offset=0`
- **Response**: `{ conversations: [...], totalCount, limit, offset }`

### `POST /api/chat/conversations`

- **Auth**: Firebase
- **Body**: None required
- **Response**: `{ conversation: { id, userId, title, createdAt, updatedAt } }`

### `GET /api/chat/conversations/:id`

- **Auth**: Firebase + ownership check
- **Query params**: `?limit=100&offset=0`
- **Response**: `{ conversation: { id, userId, title, messages: [...], totalMessages } }`

### `DELETE /api/chat/conversations/:id`

- **Auth**: Firebase + ownership check
- **Response**: `{ success: true }`

### `POST /api/chat/conversations/:id/messages`

- **Auth**: Firebase + Quota
- **Content-Type**: `application/json`
- **Body**: `{ message: string, contextChannelId?: string }` (message max 500 chars)
- **Response**: SSE stream (see [AI Chat System](../09-AI%20Chat%20System/AI%20Chat%20System.md) for full event reference)
- **Quota**: Consumes 1 unit from `"chat"` page key

### `GET /api/chat/channels`

- **Auth**: Firebase
- **Response**: `{ channels: [{ channelId, channelTitle, thumbnailUrl }] }`

### Service Registration

```javascript
// In backend/index.js:
const chatService = createChatService({ ...sharedDeps });
serviceDeps.chatService = chatService;
router.use('/api/chat', chatRouter);
```

Sources: [chat/index.js](../../backend/chat/index.js) [chat/AgentExecutor.js](../../backend/chat/AgentExecutor.js) [chat/ConversationMemory.js](../../backend/chat/ConversationMemory.js) [frontend/src/hooks/useChat.ts](../../frontend/src/hooks/useChat.ts)

## Complete route table

139 unique routes. Middleware is listed in execution order. Chat routes are served by
both the user router and the admin router, which share these paths; the admin router
adds `/channels/all` and a wider history window.

| Method | Path | Description | Middleware | Source |
|---|---|---|---|---|| `GET` | `/api/admin/audit-criteria` | Read audit criteria config. | checkAdmin | `routes/admin.js` |
| `PUT` | `/api/admin/audit-criteria` | Update audit criteria config. | checkAdmin | `routes/admin.js` |
| `GET` | `/api/admin/audit-parameter-definitions` | Read audit parameter definitions. | checkAdmin | `routes/admin.js` |
| `PUT` | `/api/admin/audit-parameter-definitions` | Update audit parameter definitions. | checkAdmin | `routes/admin.js` |
| `GET` | `/api/admin/audit-scoring-profiles` | Read scoring profiles. | checkAdmin | `routes/admin.js` |
| `PUT` | `/api/admin/audit-scoring-profiles` | Update scoring profiles. | checkAdmin | `routes/admin.js` |
| `POST` | `/api/admin/cache/clear` | Flush the cache. | checkAdmin | `routes/admin.js` |
| `POST` | `/api/admin/cache/metrics/reset` | Reset cache counters. | checkAdmin | `routes/admin.js` |
| `GET` | `/api/admin/cache/stats` | Cache metrics: hit rate, compression ratio, size. | checkAdmin | `routes/admin.js` |
| `GET` | `/api/admin/channels` | List channels across all users. | checkAdmin | `routes/admin.js` |
| `POST` | `/api/admin/cleanup/snapshots` | Prune stale dashboard snapshots. | checkAdmin | `routes/admin.js` |
| `GET` | `/api/admin/config` | Public. Feature config + audit scoring for the client. Before the auth wall. | - | `index.js` |
| `PUT` | `/api/admin/config` | Update the feature config. | checkAdmin | `routes/admin.js` |
| `GET` | `/api/admin/debug/tokens` | Debug view of stored YouTube tokens. | checkAdmin | `routes/admin.js` |
| `GET` | `/api/admin/optimizer-criteria` | Read thumbnail + playlist scoring criteria. | checkAdmin | `routes/admin.js` |
| `PUT` | `/api/admin/optimizer-criteria` | Update optimizer criteria config. | checkAdmin | `routes/admin.js` |
| `GET` | `/api/admin/public-audits` | Public audit history. | checkAdmin | `routes/publicAudit.js` |
| `POST` | `/api/admin/public-audits` | Run a public audit synchronously (bounded). | checkAdmin | `routes/publicAudit.js` |
| `DELETE` | `/api/admin/public-audits/:id` | Delete a saved public audit report. | checkAdmin | `routes/publicAudit.js` |
| `GET` | `/api/admin/public-audits/:id` | One saved public audit report. | checkAdmin | `routes/publicAudit.js` |
| `PATCH` | `/api/admin/public-audits/:id` | Update saved public audit metadata. | checkAdmin | `routes/publicAudit.js` |
| `POST` | `/api/admin/public-audits/jobs` | Enqueue a public audit job. | checkAdmin | `routes/publicAudit.js` |
| `GET` | `/api/admin/public-audits/jobs/:id` | Poll a queued public audit. | checkAdmin | `routes/publicAudit.js` |
| `GET` | `/api/admin/users` | List all users with package and role. | checkAdmin | `routes/admin.js` |
| `PUT` | `/api/admin/users/:uid/package` | Set a user's package (free/pro). | checkAdmin | `routes/admin.js` |
| `PUT` | `/api/admin/users/:uid/role` | Set a user's role. | checkAdmin | `routes/admin.js` |
| `POST` | `/api/analytics/dimensions` | Analytics dimensions. | analyticsReadLimiter > resolveUser > resolveOrgToken > checkPremiumAccess > requireQuota > consumeQuota | `routes/analytics.js` |
| `GET` | `/api/analytics/report` | Analytics report. | analyticsReadLimiter > resolveUser > resolveOrgToken > checkPremiumAccess > requireQuota > consumeQuota | `routes/analytics.js` |
| `GET` | `/api/anomalies` | Paged anomaly list, newest first. Defaults to connected channels. | analyticsReadLimiter > resolveUser | `routes/anomalies.js` |
| `GET` | `/api/anomalies/:id` | One anomaly with evidence and cached AI explanation. | analyticsReadLimiter > resolveUser | `routes/anomalies.js` |
| `PATCH` | `/api/anomalies/:id` | Set status (open/acknowledged/dismissed). | resolveUser | `routes/anomalies.js` |
| `POST` | `/api/anomalies/:id/explain` | Generate or refresh the AI explanation. Quota gated. | resolveUser > checkPremiumAccess > requireQuota | `routes/anomalies.js` |
| `GET` | `/api/anomalies/metrics` | Metric catalog, kinds, severities, statuses. No DB work. | resolveUser | `routes/anomalies.js` |
| `POST` | `/api/anomalies/scan` | Scan a connected channel now. Quota gated. | analyticsReadLimiter > resolveUser > checkPremiumAccess > requireQuota | `routes/anomalies.js` |
| `GET` | `/api/anomalies/series` | Daily series + expected baseline + anomaly markers. | analyticsReadLimiter > resolveUser | `routes/anomalies.js` |
| `POST` | `/api/audit-orchestrator` | Enqueue a Full Audit. Quota gated. | resolveUser > orgTokenMiddleware > checkPremiumAccess > requireQuota | `routes/auditOrchestrator.js` |
| `GET` | `/api/audit-orchestrator/:id` | One run with all sub-runs. | resolveUser | `routes/auditOrchestrator.js` |
| `POST` | `/api/audit-orchestrator/:id/rerun` | Re-enqueue the whole audit. Quota gated. | resolveUser > orgTokenMiddleware > checkPremiumAccess > requireQuota | `routes/auditOrchestrator.js` |
| `POST` | `/api/audit-orchestrator/:id/rerun/:type` | Re-run one sub-audit type. | resolveUser | `routes/auditOrchestrator.js` |
| `GET` | `/api/audit-orchestrator/criteria` | Criteria labels + max points. Safe for any user. | resolveUser | `routes/auditOrchestrator.js` |
| `GET` | `/api/audit-orchestrator/history` | Paged run history. | resolveUser | `routes/auditOrchestrator.js` |
| `DELETE` | `/api/audit-orchestrator/history/:id` | Delete a saved run. | resolveUser | `routes/auditOrchestrator.js` |
| `PATCH` | `/api/audit-orchestrator/history/:id` | Rename a saved run. | resolveUser | `routes/auditOrchestrator.js` |
| `GET` | `/api/audit-orchestrator/jobs/:id` | Poll a Full Audit job. | resolveUser | `routes/auditOrchestrator.js` |
| `GET` | `/api/captions/:videoId` | Caption track for a video. Feature-gated. | - | `routes/captions.js` |
| `GET` | `/api/channel-focus` | Read channel focus (personal or org scoped). | analyticsReadLimiter > resolveUser | `routes/channelFocus.js` |
| `PUT` | `/api/channel-focus` | Save channel focus. | analyticsReadLimiter > resolveUser | `routes/channelFocus.js` |
| `POST` | `/api/channel-focus/generate` | Generate a focus draft from channel data. Quota gated. | analyticsReadLimiter > resolveUser > orgTokenFromBody > quotaGate > consumeQuota | `routes/channelFocus.js` |
| `GET` | `/api/channel-videos/:channelId` | Video list for a channel (paged). | analyticsReadLimiter > resolveUser > resolveOrgToken > checkPremiumAccess > requireQuota | `routes/channelVideos.js` |
| `POST` | `/api/channel/cleanup` | Clean up cached channel data. | resolveUser | `routes/channels.js` |
| `GET` | `/api/channel/handle/:handle` | Channel detail by handle. | resolveUser > checkPremiumAccess > requireQuota > consumeQuota | `routes/channels.js` |
| `GET` | `/api/channel/id/:id` | Channel detail. Supports org token resolution. | resolveUser > resolveOrgToken > checkPremiumAccess > requireQuota > consumeQuota | `routes/channels.js` |
| `GET` | `/api/channel/mine` | List the caller's connected channels. | resolveUser > checkPremiumAccess > requireQuota > consumeQuota | `routes/channels.js` |
| `GET` | `/api/channel/username/:username` | Resolve a channel by legacy username. | resolveUser > checkPremiumAccess > requireQuota > consumeQuota | `routes/channels.js` |
| `GET` | `/api/chat/channels` | Channels available to the chat agent. | - | `chat/index.js` |
| `GET` | `/api/chat/channels/all` | All channels (admin mode). | - | `chat/index.js` |
| `GET` | `/api/chat/conversations` | List conversations. | - | `chat/index.js` |
| `POST` | `/api/chat/conversations` | Create a conversation. | - | `chat/index.js` |
| `DELETE` | `/api/chat/conversations/:id` | Delete a conversation. | - | `chat/index.js` |
| `GET` | `/api/chat/conversations/:id` | One conversation with history. | - | `chat/index.js` |
| `POST` | `/api/chat/conversations/:id/messages` | Send a message (agent turn). | - | `chat/index.js` |
| `POST` | `/api/compare/videos` | Compare videos across channels. | resolveUser > checkPremiumAccess | `routes/compare.js` |
| `GET` | `/api/custom-dashboards` | Read the saved layout. Returns supported:false when Postgres is absent. | authenticateRequest | `routes/customDashboards.js` |
| `PUT` | `/api/custom-dashboards` | Upsert the layout (sanitized). | authenticateRequest | `routes/customDashboards.js` |
| `POST` | `/api/dashboard/bundle` | Full dashboard bundle. | analyticsReadLimiter > resolveUser > resolveOrgToken > checkPremiumAccess > requireQuota > consumeQuota | `routes/dashboard.js` |
| `POST` | `/api/dashboard/dimensions` | Dashboard dimension breakdown. | analyticsReadLimiter > resolveUser > resolveOrgToken > checkPremiumAccess > requireQuota > consumeQuota | `routes/dashboard.js` |
| `GET` | `/api/dashboard/playlist-items/:playlistId` | Playlist items in dashboard scope. | resolveUser > checkPremiumAccess > requireQuota > consumeQuota | `routes/dashboard.js` |
| `GET` | `/api/dashboard/playlist/:id` | One playlist in dashboard scope. | resolveUser > checkPremiumAccess > requireQuota > consumeQuota | `routes/dashboard.js` |
| `POST` | `/api/dashboard/playlists` | Dashboard playlist data. | analyticsReadLimiter > resolveUser > resolveOrgToken > checkPremiumAccess > requireQuota > consumeQuota | `routes/dashboard.js` |
| `POST` | `/api/dashboard/report` | Dashboard analytics report. | analyticsReadLimiter > resolveUser > resolveOrgToken > checkPremiumAccess > requireQuota > consumeQuota | `routes/dashboard.js` |
| `POST` | `/api/dashboard/summary` | Dashboard summary block. | analyticsReadLimiter > resolveUser > resolveOrgToken > checkPremiumAccess | `routes/dashboard.js` |
| `POST` | `/api/dashboard/tab/audience` | Audience tab data. | analyticsReadLimiter > resolveUser > resolveOrgToken > checkPremiumAccess > requireQuota | `routes/dashboardTabs.js` |
| `POST` | `/api/dashboard/tab/channel` | Channel tab data. | analyticsReadLimiter > resolveUser > resolveOrgToken > checkPremiumAccess > requireQuota | `routes/dashboardTabs.js` |
| `POST` | `/api/dashboard/tab/insights` | Insights tab data. | analyticsReadLimiter > resolveUser > resolveOrgToken > checkPremiumAccess > requireQuota | `routes/dashboardTabs.js` |
| `POST` | `/api/dashboard/tab/playlists` | Playlists tab data. | analyticsReadLimiter > resolveUser > resolveOrgToken > checkPremiumAccess > requireQuota | `routes/dashboardTabs.js` |
| `POST` | `/api/dashboard/tab/videos` | Videos tab data. | analyticsReadLimiter > resolveUser > resolveOrgToken > checkPremiumAccess > requireQuota > consumeQuota | `routes/dashboardTabs.js` |
| `POST` | `/api/dashboard/videos` | Dashboard video data. | analyticsReadLimiter > resolveUser > resolveOrgToken > checkPremiumAccess > requireQuota | `routes/dashboard.js` |
| `POST` | `/api/dashboard/videos/by-ids` | Fetch specific videos by id. | resolveUser > checkPremiumAccess > requireQuota > consumeQuota | `routes/dashboard.js` |
| `GET` | `/api/goals` | List goals for a channel with live pacing. | analyticsReadLimiter > resolveUser | `routes/goals.js` |
| `POST` | `/api/goals` | Create a goal. | analyticsReadLimiter > resolveUser | `routes/goals.js` |
| `DELETE` | `/api/goals/:id` | Delete a goal. | analyticsReadLimiter > resolveUser | `routes/goals.js` |
| `GET` | `/api/goals/:id` | One goal with pacing detail. | analyticsReadLimiter > resolveUser | `routes/goals.js` |
| `PUT` | `/api/goals/:id` | Update a goal. | analyticsReadLimiter > resolveUser | `routes/goals.js` |
| `GET` | `/api/goals/summary` | Goal summary for a channel. | analyticsReadLimiter > resolveUser | `routes/goals.js` |
| `GET` | `/api/notifications` | List notifications + unread count. | resolveUser | `routes/notification.js` |
| `PATCH` | `/api/notifications/:id/read` | Mark one read. | resolveUser | `routes/notification.js` |
| `PATCH` | `/api/notifications/read-all` | Mark all read. | resolveUser | `routes/notification.js` |
| `POST` | `/api/oauth/exchange` | Exchange an OAuth code for tokens. Rate limited, before the auth wall. | oauthLimiter > authenticateRequest | `routes/oauth.js` |
| `POST` | `/api/oauth/refresh` | Refresh an expiring YouTube access token. | oauthLimiter > authenticateRequest | `routes/oauth.js` |
| `GET` | `/api/organization/analytics` | Org-wide cross-channel analytics (7d/30d/90d/custom). | resolveUser | `routes/organization.js` |
| `POST` | `/api/organization/invalidate-member` | Invalidate a cached org membership. | - | `routes/organization.js` |
| `POST` | `/api/organization/send-invitation` | Email an org invitation. | - | `routes/organization.js` |
| `POST` | `/api/organization/send-ownership-transfer` | Email an ownership transfer. | - | `routes/organization.js` |
| `POST` | `/api/playlist-optimizer/analyze` | Run a playlist analysis. | resolveUser > checkPremiumAccess > requireQuota | `routes/playlistOptimizer.js` |
| `GET` | `/api/playlist-optimizer/history` | Paged playlist analysis history. | resolveUser > checkPremiumAccess | `routes/playlistOptimizer.js` |
| `DELETE` | `/api/playlist-optimizer/history/:id` | Delete a saved playlist analysis. | resolveUser > checkPremiumAccess | `routes/playlistOptimizer.js` |
| `GET` | `/api/playlist-optimizer/history/:id` | One saved playlist analysis. | resolveUser > checkPremiumAccess | `routes/playlistOptimizer.js` |
| `GET` | `/api/playlist-optimizer/history/by-video/:videoId` | Newest saved run containing a video. | resolveUser > checkPremiumAccess | `routes/playlistOptimizer.js` |
| `POST` | `/api/playlist-optimizer/jobs` | Enqueue a playlist analysis. | resolveUser > checkPremiumAccess > requireQuota | `routes/playlistOptimizer.js` |
| `GET` | `/api/playlist-optimizer/jobs/:id` | Poll a playlist job. | resolveUser | `routes/playlistOptimizer.js` |
| `POST` | `/api/playlist-optimizer/save` | Save a playlist analysis result. | resolveUser > checkPremiumAccess | `routes/playlistOptimizer.js` |
| `GET` | `/api/playlists/:channelId` | Playlist catalog for a channel. | resolveUser > resolveOrgToken > checkPremiumAccess > requireQuota > consumeQuota | `routes/playlists.js` |
| `POST` | `/api/playlists/:channelId/refresh` | Force a playlist refresh. | resolveUser > checkPremiumAccess > requireQuota > consumeQuota | `routes/playlists.js` |
| `GET` | `/api/playlists/items/:playlistId` | Items in a playlist. | resolveUser > checkPremiumAccess > requireQuota > consumeQuota | `routes/playlists.js` |
| `GET` | `/api/playlists/single/:id` | One playlist's details. | resolveUser > checkPremiumAccess > requireQuota > consumeQuota | `routes/playlists.js` |
| `GET` | `/api/proxy-image` | Image proxy for YouTube thumbnails (CORS). 5s timeout, 24h cache header. | - | `index.js` |
| `GET` | `/api/public/admin/config` | Public admin config read. | - | `routes/public.js` |
| `GET` | `/api/public/health` | Public health endpoint. | - | `routes/public.js` |
| `GET` | `/api/public/proxy-image` | Public image proxy. | - | `routes/public.js` |
| `GET` | `/api/readme` | In-app readme content. | - | `index.js` |
| `GET` | `/api/specific-videos` | In-app specific-videos help content. | - | `index.js` |
| `POST` | `/api/thumbnail-optimizer/analyze` | Run a thumbnail analysis. | resolveUser > checkPremiumAccess > requireQuota | `routes/thumbnailOptimizer.js` |
| `GET` | `/api/thumbnail-optimizer/criteria` | Thumbnail pillars. Safe for any user. | resolveUser | `routes/thumbnailOptimizer.js` |
| `GET` | `/api/thumbnail-optimizer/history` | Paged thumbnail audit history. | resolveUser > checkPremiumAccess | `routes/thumbnailOptimizer.js` |
| `DELETE` | `/api/thumbnail-optimizer/history/:id` | Delete a saved thumbnail audit. | resolveUser > checkPremiumAccess | `routes/thumbnailOptimizer.js` |
| `GET` | `/api/thumbnail-optimizer/history/:id` | One saved thumbnail audit. | resolveUser > checkPremiumAccess | `routes/thumbnailOptimizer.js` |
| `GET` | `/api/thumbnail-optimizer/history/by-video/:videoId` | Newest saved run containing a video. | resolveUser > checkPremiumAccess | `routes/thumbnailOptimizer.js` |
| `POST` | `/api/thumbnail-optimizer/jobs` | Enqueue a thumbnail audit. | resolveUser > checkPremiumAccess > requireQuota | `routes/thumbnailOptimizer.js` |
| `GET` | `/api/thumbnail-optimizer/jobs/:id` | Poll a thumbnail audit job. | resolveUser | `routes/thumbnailOptimizer.js` |
| `POST` | `/api/thumbnail-optimizer/save` | Save a thumbnail audit result. | resolveUser > checkPremiumAccess | `routes/thumbnailOptimizer.js` |
| `GET` | `/api/usage/me` | Current user's monthly usage counts. | - | `routes/usage.js` |
| `POST` | `/api/usage/track` | Track a compare-page usage event. | resolveUser > requireQuota > consumeQuota | `routes/usage.js` |
| `POST` | `/api/user/init` | First-run user initialisation. | authenticateRequest | `routes/user.js` |
| `POST` | `/api/user/sync` | Sync the Firebase user profile into the backend store. | authenticateRequest | `routes/user.js` |
| `GET` | `/api/user/ui-preferences` | Read persisted UI preferences (stat cards, etc.). | - | `routes/user.js` |
| `PUT` | `/api/user/ui-preferences` | Persist UI preferences. | - | `routes/user.js` |
| `POST` | `/api/video-audit` | Enqueue a video audit. Quota gated. | resolveUser > orgTokenMiddleware > checkPremiumAccess > requireQuota | `routes/videoAudit.js` |
| `GET` | `/api/video-audit/criteria` | Video audit criteria. Safe for any user. | resolveUser | `routes/videoAudit.js` |
| `GET` | `/api/video-audit/history` | Paged audit history. | resolveUser | `routes/videoAudit.js` |
| `POST` | `/api/video-audit/history` | Save a video audit result. | resolveUser | `routes/videoAudit.js` |
| `DELETE` | `/api/video-audit/history/:id` | Delete a saved audit. | resolveUser | `routes/videoAudit.js` |
| `GET` | `/api/video-audit/history/:id` | One saved audit. | resolveUser | `routes/videoAudit.js` |
| `PATCH` | `/api/video-audit/history/:id` | Update a saved audit. | resolveUser | `routes/videoAudit.js` |
| `GET` | `/api/video-audit/history/by-video/:videoId` | Newest saved run containing a video. | resolveUser | `routes/videoAudit.js` |
| `GET` | `/api/video-audit/jobs/:id` | Poll a video audit job. | resolveUser | `routes/videoAudit.js` |
| `GET` | `/api/videos` | Videos list. | checkPremiumAccess > requireQuota > consumeQuota | `routes/videos.js` |
| `GET` | `/api/videos/:videoId` | Resolve a single video to its channel. Rate limited, no quota. | resolveUser > resolveLimiter | `routes/videos.js` |
| `GET` | `/api/videos/specific` | Specific-videos lookup. | checkPremiumAccess > requireQuota > consumeQuota | `routes/videos.js` |
| `GET` | `/health` | Liveness probe. Timestamp, uptime, memory usage. | - | `index.js` |

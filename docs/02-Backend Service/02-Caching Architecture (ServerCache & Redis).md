## Caching Architecture (ServerCache & Redis)

Relevant source files

-   [cache/ServerCache.js](../../backend/cache/ServerCache.js)
-   [cache/userCache.js](../../backend/cache/userCache.js)
-   [cache/orgCache.js](../../backend/cache/orgCache.js)
-   [utils/cacheScope.js](../../backend/utils/cacheScope.js)
-   [utils/inflight.js](../../backend/utils/inflight.js)
-   [middleware/quota.js](../../backend/middleware/quota.js)
-   [middleware/configVersion.js](../../backend/middleware/configVersion.js)
-   [Caching Architecture](02-Caching Architecture (ServerCache & Redis))
-   [Project Overview](../20-Reference/Legacy Project Guide)

The RevTube caching architecture is a dual-layer system designed to minimize latency and preserve YouTube API quotas. It employs a Redis primary store with an in-memory LRU (Least Recently Used) fallback, utilizing the cache-aside pattern across most backend endpoints [Caching Architecture#1-32](02-Caching Architecture (ServerCache & Redis))

The system uses **two Redis instances** — `redis` for ServerCache data (analytics cache, OAuth tokens, rate limiters) with `allkeys-lru` eviction, and `redis-queue` for BullMQ job state with `noeviction` policy. This isolation prevents cache eviction from ever affecting queue integrity.

## 1\. The ServerCache Layer

The `ServerCache` class in `cache/ServerCache.js` serves as the unified abstraction for all server-side caching. It automatically handles connection management, data serialization, and compression.

### Implementation Details

-   Dual-Layer Logic: If `REDIS_URL` is provided, the system connects to Redis via the `redis` package. If Redis is unavailable or fails, it falls back to a standard JavaScript `Map` (max `CACHE_MAX_ENTRIES` entries, `CACHE_FALLBACK_TTL_HOURS` TTL — both env-tunable, defaulting to 1000 entries / 12 hours).
-   Gzip Compression: To reduce the memory footprint in Redis and speed up network transfers, large JSON payloads are compressed using `zlib.gzip` before storage.
-   Metrics Tracking: The class tracks hits, misses, and compression ratios to monitor performance.

### Cache Key Scoping

To prevent data leakage between tenants, cache keys for dashboard data are scoped using the `dashboardScope` function from `utils/cacheScope.js` [Caching Architecture#82-87](02-Caching Architecture (ServerCache & Redis))

| Priority | Source | Scope Prefix |
| --- | --- | --- |
| 1 | Organization ID (`x-org-id` header) | `org:{orgId}` |
| 2 | Authenticated User Email | `u:{email}` |
| 3 | Bearer Token Hash (Anonymous) | `anon:{hash}` |
| 4 | No Auth | `pub` |

_Sources: [cache/ServerCache.js](../../backend/cache/ServerCache.js) [Caching Architecture#82-94](02-Caching Architecture (ServerCache & Redis))_

## 2\. Data Flow & Cache-Aside Pattern

The backend follows a strict cache-aside pattern. When a request arrives, the system first checks for a deterministic key in `ServerCache`. If found (Hit), the data is decompressed and returned. If not found (Miss), the data is fetched from the primary source (PostgreSQL or YouTube API), stored in the cache, and then returned [Caching Architecture#44-52](02-Caching Architecture (ServerCache & Redis))

### Stale Cache Prevention in Cron

A critical edge case exists in the cache-aside pattern: **the cache-hit branch has no PostgreSQL staleness check**. When a cached response exists, it is returned immediately without verifying whether the underlying PostgreSQL data is fresher.

To prevent this, `cron.js`'s `runCacheRefresh()` now **wipes stale cache keys** (`snapshot:` and `summary:` prefixes) **before** re-warming. This ensures that:

1. The warming loop recomputes bundles from fresh PostgreSQL data.
2. Users don't see stale dashboard numbers or "as of" dates (e.g. "As of Jul 5" when ingestion has already updated to Jul 13).
3. The stale-clearing is scoped to cron — individual user requests still benefit from the fast cache-hit path.

### Post-ingestion invalidation & the `channel_videos:*` gap

- **Automatic (snapshots):** every successful `ingestChannelDaily` run deletes the channel's rows from `analytics_dashboard_snapshots` (`ingestion/snapshots.js` → `deleteDashboardSnapshots`), so the next dashboard request rebuilds from fresh Postgres rows. Failures here log a warning and never fail the ingestion run.
- **Known gap (channel videos):** the admin cache-clear endpoint may not wipe the `channel_videos:*` key family (Redis DB/prefix mismatch). A stale pre-privacy blob in this family causes videos to render "Unknown" status even when Postgres is correct. Manual purge:

    ```bash
    docker compose exec redis sh -c "redis-cli -a <password> --no-auth-warning --scan --pattern '*channel_videos*' | xargs -r redis-cli -a <password> --no-auth-warning DEL"
    ```

See [DATA_COVERAGE.md §7–9](07-Data Coverage & Freshness) for the full multi-tier read path (L1 Redis → L2 Postgres → L3 live API) and ingestion resilience details.

Sources: [Caching Architecture#15-25](02-Caching Architecture (ServerCache & Redis)) [backend/cron.js#15-25](../../backend/cron.js) [backend/index.js#494](../../backend/index.js)

### Caching Sequence Diagram

This diagram bridges the natural language "Request Flow" to the specific code entities involved.

_Sources: [cache/ServerCache.js](../../backend/cache/ServerCache.js) [Caching Architecture#7-28](02-Caching Architecture (ServerCache & Redis))_

## 3\. In-Flight Request Deduplication

To prevent "cache stampedes" (where multiple identical requests hit the backend simultaneously on a cache miss), the system uses two mechanisms:

1.  `withInFlightTimeout` ([utils/inflight.js](../../backend/utils/inflight.js)): A utility that wraps factory functions in a promise. If a request for a specific key is already active, subsequent requests wait for the same promise rather than triggering new upstream calls.
2.  `DASHBOARD_INFLIGHT` (in [index.js](../../backend/index.js)): A specific `Map` used to track active requests for dashboard summaries and bundles.

_Sources: [utils/inflight.js](../../backend/utils/inflight.js) [Caching Architecture#44-52](02-Caching Architecture (ServerCache & Redis))_

## 4\. Feature Config Caching & Invalidation

The FeatureConfig (quotas, `premiumOnly` flags) uses a **two-tier caching strategy** to balance freshness with Firestore read reduction [Caching Architecture#54-89](02-Caching Architecture (ServerCache & Redis))

| Layer | Storage | TTL | Mechanism |
|-------|---------|-----|-----------|
| Backend | In-memory cache in `config/featureConfig.js` | **10 min** | `getFeatureConfig()` checks expiry + hits Firestore on miss |
| Frontend | `localStorage` + React Query | **1 min** | `refetchInterval: 60_000` auto-polls; `staleTime: 60_000` |

### Invalidation Pipeline

Admin updates propagate through the following chain [routes/admin.js](../../backend/routes/admin.js):

1. `PUT /api/admin/config` writes to Firestore `config/features`.
2. `bumpConfigVersion()` ([config/configVersion.js](../../backend/config/configVersion.js)) increments `config/version` — triggers analytics cache invalidation.
3. `invalidateFeatureConfigCache()` ([config/featureConfig.js](../../backend/config/featureConfig.js)) — backend in-memory cache cleared.
4. Frontend's 1-min poll fetches fresh config via `GET /api/admin/config` (cache miss → Firestore read → re-cached 10 min).

- `checkConfigVersion` ([middleware/configVersion.js](../../backend/middleware/configVersion.js)): Middleware that runs on every authenticated request. Compares the live Firestore version against the request-scoped version. On mismatch, calls `invalidateAnalyticsCache()`.
- `invalidateAnalyticsCache()` ([middleware/configVersion.js](../../backend/middleware/configVersion.js)): Scans the cache for specific prefixes (`dashSummary:`, `bundle:`, `yt:ytan:`) and evicts them immediately.

_Sources: [config/featureConfig.js](../../backend/config/featureConfig.js) [config/configVersion.js](../../backend/config/configVersion.js) [middleware/configVersion.js](../../backend/middleware/configVersion.js) [routes/admin.js](../../backend/routes/admin.js) [Caching Architecture#54-89](02-Caching Architecture (ServerCache & Redis))_

## 5\. Usage Accounting & Deduplication

Usage limits (Free vs. Pro) are enforced at the caching layer to ensure that only "fresh" data fetches (cache misses) consume the user's quota [Caching Architecture#78](02-Caching Architecture (ServerCache & Redis))

-   `consumeQuota` ([middleware/quota.js](../../backend/middleware/quota.js)): Called only when a cache miss occurs. It advances the counter in Redis (`usage:{uid}:{pageKey}:{month}`).
-   `isDuplicate` ([services/quotaService.js](../../backend/middleware/quota.js)): A guard that prevents parallel requests from the same user from double-counting. It uses a 5-second window (`USAGE_DEDUP_WINDOW_SEC`) and a Redis `SET NX EX` lock.
-   Resolve routes skip quota entirely — no check, no increment. Rate-limited by `resolveLimiter` instead.

_Sources: [middleware/quota.js](../../backend/middleware/quota.js) [Caching Architecture#68-81](02-Caching Architecture (ServerCache & Redis)) [Caching Architecture#105-115](02-Caching Architecture (ServerCache & Redis))_

## 6\. Channel includeTrailer Caching (2026-06-30)

The `/channel/handle/:handle?includeTrailer=true` endpoint bundles channel metadata + trailer video data in one response:

- **Channel data** is cached normally under `yt:ch:handle:{scope}:{handle}` with the standard **4h TTL** (`YT_DATA_CACHE_TTL_MS.CHANNEL`).
- **Trailer video** is **not separately cached** — it is fetched from the YouTube API on every `includeTrailer=true` request. This avoids stale video metadata while keeping the single-roundtrip pattern.
- **Cache bypass**: When `includeTrailer=true` is set, the `cached && req.query.includeTrailer !== "true"` guard ensures the channel data is always re-fetched from YouTube on `includeTrailer=true` requests (so the trailer is always current). The channel data IS cached for subsequent `includeTrailer=false` (default) requests.
- **No additional quota**: The trailer fetch is an internal server-to-YouTube API call that does not consume the user's monthly quota. Only the `requireQuota("channel")` / `consumeQuota` for the channel lookup itself is billed.

### Frontend localStorage Cache

The frontend also caches `ChannelMetadata` in `localStorage` with **24h TTL**:

- Keyed by input: `channel_inspector_cache_{input}`
- Org-scoped: `::org:{orgId}` suffix appended when in organization mode
- `_last` variant: `channel_inspector_cache_last` stores the most recently viewed channel for session persistence
- Cache keys cleared automatically on org context switch via `useEffect` on `[currentOrganization?.id]`

On cache hit (sidebar auto-load), the trailer video is fetched as a lightweight background call (`fetchVideosByIds([trailerId])`) since the cached payload only contains channel metadata, not trailer data.

## 7\. YouTube Data API & Analytics Cache Prefixes

| Prefix | Route / Context | TTL |
|--------|----------------|-----|
| `yt:ch:user:` | `/channel/username/:username` | 4h |
| `yt:ch:id:` | `/channel/id/:id` | 4h |
| `yt:ch:handle:` | `/channel/handle/:handle` | 4h |
| `yt:pl:list:` | `/playlists/:channelId` | 2h |
| `yt:pl:one:` | `/playlist/:id` | 2h |
| `yt:pl:items:` | `/playlist-items/:playlistId` | 45m |
| `yt:videos:` | `/videos?ids=...` | 25m |
| `yt:channels:mine:` | `/channels/mine` | 12m |
| `yt:ytan:report:` | `/analytics/report` + `POST /dashboard/report` | 6h |
| `channel_videos:` | Internal / `/channel-videos/:channelId` | 90m |
| `oauth:token:` | `refreshGoogleToken()` (internal) | 55m |
| `compare:videos:` | `POST /compare/videos` | 1h |
| `dims_v2:` | Audience dimensions with filters (traffic source, device, country, gender/age) | 45m |
| `dims_ch_v2:` | Audience dimensions channel-wide (no video/playlist filter) | 45m |
| `insights:audienceActive:v4:` | Day-of-week engagement breakdown (`generateAudienceActiveTime`) | 12m |
| `insights:audienceActiveDb:v3:` | Hourly view-velocity estimation (`generateAudienceActiveTimeFromDb`) | 12m |
| `insights:retentionByHour:v4:` | 30-day rolling retention trend (`generateRetentionByHour`) | 12m |
| `insights:bestTimeToPost:v6:` | Best time to post (period-agnostic, DB-powered) | 12m |

**Cache bypass (`?fresh=true`)**: `GET /channels/mine` accepts a `?fresh=true` query param to bypass Redis and always fetch from the YouTube API. Used automatically during the OAuth connect-channel flow so the user sees their current live channel list. During normal data access the cache is used normally.

**Empty results never cached**: When `/channels/mine` returns zero channels (Google account has no YouTube channel), the response is **not** cached. This avoids a 12-minute stale window where the user would see no channels even after creating one.

_Sources: [routes/channels.js](../../backend/routes/channels.js) [routes/videos.js](../../backend/routes/videos.js) [Caching Architecture](02-Caching Architecture (ServerCache & Redis))_

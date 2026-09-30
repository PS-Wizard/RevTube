# Usage Limit / Quota System

## The Core Problem

RevTube proxies YouTube Data API v3 calls. YouTube gives each project a fixed daily quota.
The usage limit system prevents one user from exhausting the shared pool and gates features
by subscription tier (free vs pro).

---

## Architecture (Current -- as of 2026-06-29)

### Key Concepts

| Concept | What it is |
|---------|------------|
| **pageKey** | A named feature bucket: `dashboard`, `videos`, `channel`, `playlists`, `compare`, `specificVideos`. Each has its own independent monthly limit. |
| **monthly limit** | Configured per pageKey per tier (`freeLimit` / `proLimit`). Resets on the 1st. `-1` = unlimited. |
| **resolve scope** | Background ID-resolution calls (handle → channelId → uploads playlist) that **check the limit but don't consume quota**. Used so autocomplete/search keystrokes don't burn the user's monthly allowance. |
| **usage dedup** | A short time-window dedup (default 5s) that prevents N parallel requests from all incrementing the counter. |

### Middleware Chain (per route)

```
authenticateRequest → resolveUser → [resolveOrgToken*]
  → checkPremiumAccess(pageKey) → requireQuota(pageKey) → handler (→ consumeQuota)
```

1. **`authenticateRequest`** -- Verifies Firebase ID token from `X-Firebase-Token` header.
2. **`resolveUser`** -- Looks up user profile (package/role) from Firestore/Postgres cache.
3. **`resolveOrgToken`** -- (org context only) Overrides the auth token with the org channel adder's YouTube OAuth token.
4. **`checkPremiumAccess(pageKey)`** -- Returns 403 if the page is `premiumOnly` and user isn't pro/admin.
5. **`requireQuota(pageKey)`** -- Reads the current counter. If at limit → returns 429. Otherwise sets `req.quotaContext` and `req.usageInfo`.

### The Two-Phase Billing Pattern (`middleware/quota.js`)

**Phase 1 -- Middleware (`requireQuota(pageKey)`)**: Reads the counter. Returns 429 if exhausted.
Sets `req.quotaContext` so the handler can increment later.

**Phase 2 -- Handler (`consumeQuota(req, opts)`)**: Called **after** the YouTube API response, **only
on cache miss**. Cache hits do NOT consume quota.

#### Every gated route follows this pattern:

```js
apiRouter.get("/videos",
  resolveUser,
  checkPremiumAccess("videos"),
  requireQuota("videos"),   // ← checks limit, sets quotaContext
  async (req, res) => {
    const cached = await serverCache.get(key);  // ← check cache FIRST
    if (cached) return res.json(cached);   // ← cache hit → no quota consumed
    // Cache miss → call YouTube API
    const response = await axios.get(url, config);
    // Only increment AFTER successful YouTube API response
    await consumeQuota(req, { billable: true });
    await serverCache.set(cacheKey, response.data, TTL);
    res.json(response.data);
  }
);
```

**Fixed 2026-06-27**: Increment fires only after a **successful YouTube API response** --
failed API calls don't count, cache hits don't count.

#### Exceptions:
- **True resolve-only endpoints** (`/channel-videos/:channelId`, `/video/:videoId`):
  These are cached ID-resolution lookups with **no quota check and no increment** -- the `resolveLimiter`
  rate-limiter prevents abuse instead. This keeps resolution usable even when other pageKey quotas
  are exhausted, so pages like Playlists, Videos, and Compare can still resolve channel handles.
- **Channel metadata routes** (`/channel/handle/:handle`, `/channel/id/:id`, `/channel/username/:username`):
  Full metadata lookups (calling YouTube API with `part: snippet,contentDetails,statistics,brandingSettings`).
  They have `requireQuota("channel")` middleware and `consumeQuota(req, { billable: true })` -- DO check
  and consume channel quota.
- **Dedup window**: If the same uid+pageKey was incremented within the last `USAGE_DEDUP_WINDOW_SEC`
  (default 5s), the increment is skipped. This prevents parallel-request over-counting.
- **Service billable marking (`quotaService.markBillable`)**: Dashboard bundle services call
  `markQuotaBillable(req)` before YouTube Analytics API calls. This sets `req.quotaBillable` so
  `consumeQuota` fires even without an explicit `{ billable: true }` option -- used by
  `generateDashboardBundle` where the quota consumption is deferred to the end of the pipeline.

### Routes and their pageKeys

| Route | pageKey | Quota enforced? | Notes |
|-------|---------|-----------------|-------|
| `GET /channel/username/:username` | `channel` | Yes | Full metadata lookup. `requireQuota("channel")` + `consumeQuota`. |
| `GET /channel/id/:id` | `channel` | Yes | Full metadata lookup. `requireQuota("channel")` + `consumeQuota`. |
| `GET /channel/handle/:handle` | `channel` | Yes | Full metadata lookup. `requireQuota("channel")` + `consumeQuota`. |
| &emsp;`?includeTrailer=true` | `channel` | Yes | Single-request channel + trailer bundle. 1 quota unit. |
| `GET /playlists/:channelId` | `playlists` | Yes | |
| `GET /playlist/:id` | `playlists` | Yes | |
| `GET /playlist-items/:playlistId`| `playlists` | Yes | |
| `GET /videos` | `videos` | Yes | Video statistics |
| `GET /specific-videos` | `specificVideos` | Yes | Higher-cost video endpoint |
| `GET /analytics/report` | `dashboard` | Yes | YouTube Analytics |
| `POST /dashboard/bundle` | `dashboard` | Yes | Aggregated dashboard |
| `POST /dashboard/summary` | `dashboard` | Yes | 7d/30d/90d pills |
| `GET /channel-videos/:channelId`| `videos` | Yes | Cached channel videos |
| `POST /usage/track` | `compare` | Yes | Synthetic: Compare page |
| `POST /compare/videos` | `compare` | Yes | Fetches videos + pre-computed metrics (cached in Redis, 1h TTL) |
| `POST /channels/cleanup` | none | No | Channel cleanup (PostgreSQL + cache) |
| (Summary) `POST /dashboard/...` | `dashboard` | Yes | Fast first-paint |

### Storage Backends

**Primary: Redis** -- Atomic `INCRBY` operations. Keys expire at month-end (TTL calculated
from current time to the 1st of next month, max 45 days).

**Fallback: Firestore** -- `users/{uid}/usage/{month}` document with `FieldValue.increment(1)`.
Used when Redis is unavailable.

The `/usage/me` endpoint reads from both (Redis first, Firestore as fallback) and merges
results. Limits are computed from `FeatureConfig` which is cached in-memory with a 10min TTL
and invalidated instantly on admin save via a config version counter.

### Usage Dedup (`quotaService.isDuplicate`)

Prevents N simultaneous requests from all incrementing the counter:

- **Default window**: 5 seconds (configurable via `USAGE_DEDUP_WINDOW_SEC`)
- **Redis path**: `SET dedup:key 1 NX EX <window>` -- if `NX` returns null, another request
  in this instance already counted for this window.
- **Memory fallback**: In-memory `Map` with TTL per entry. Pruned at 10,000 entries.

### Quota Service (`services/quotaService.js`)

The `quotaService` encapsulates all quota accounting logic:

- **`readCount(uid, pageKey, month)`** -- Reads the current counter from Redis (`usage:{uid}:{pageKey}:{month}`) or Firestore fallback.
- **`incrementCount(uid, pageKey, month)`** -- Atomically increments and returns the new count.
- **`isDuplicate(uid, pageKey, windowSec)`** -- Dedup check via SET NX (Redis) or in-memory Map.
- **`resolvePageLimit(pageKey, user, req)`** -- Resolves the limit for this user/tier, accounting for org-pro inheritance.
- **`markBillable(req)`** -- Called by services before live YouTube API calls to flag the request for quota consumption. `consumeQuota(req)` checks `req.quotaBillable` when `opts.billable` is not explicitly set.
- **`limitExceededPayload(pageCfg, pageKey, limit, used)`** -- Returns a standard 429 JSON response.

### Why the Complexity Accumulated

1. **Resolve scope was removed 2026-06-27** -- channel handle-resolution routes were
   originally intended to be quota-free resolves, but `/channel/handle/:handle`,
   `/channel/id/:id`, and `/channel/username/:username` call the YouTube API with
   `part: snippet,contentDetails,statistics,brandingSettings` -- they are full metadata
   lookups. They now have `requireQuota("channel")` + `consumeQuota` and
   consume channel quota. True resolves (`/channel-videos/:channelId`, `/video/:videoId`)
   use `resolveLimiter` instead.
2. **Two-phase pattern** -- the middleware checks the limit; the handler conditionally
   increments only on cache miss + successful API response.
3. **Per-pageKey limits** exist because different features have different costs. A dashboard
   bundle makes 5+ YouTube API calls; a channel lookup makes 1.
4. **Redis + Firestore dual storage** exists because Redis wasn't in the original design --
   it was added later as a performance optimization, and the Firestore path was kept as
   fallback for backwards compatibility.
5. **Frontend usage store made monotonic (2026-06-29)** -- The `_usage` field on every API
   response previously overwrote the Zustand store unconditionally. Parallel requests (common
   when switching dashboard tabs) returned different values depending on cache-hit vs cache-miss
   timing, causing the sidebar UsageBar to bounce erratically. Fixed by making `updateUsage()`
   only store the value when it is strictly greater than the currently stored value -- since
   monthly quota is additive, a lower value arriving late is always stale.
6. **Channel page single-API-call (2026-06-30)** -- `?includeTrailer=true` on the
   `/channel/handle/:handle` endpoint bundles channel metadata + trailer video data
   in one request. The trailer fetch is an internal server call, not billed to user quota.

---

## How the Frontend Sees Usage

1. **Sidebar UsageBar**: Polls `GET /api/usage/me` every 10s (staleTime) via React Query.
   Displays used/limit for the current page.

2. **`_usage` auto-attach**: Every JSON response from a gated route gets a `_usage` field
   appended by middleware (`backend/index.js`). The frontend's `readJsonResponse()` in
   `utils/readJsonResponse.ts` reads this and pushes it into the Zustand `usageStore` for
   real-time sidebar updates.

3. **Monotonic store** (`stores/usageStore.ts`): `updateUsage()` only ever RAISES the stored
   value. Parallel requests (common when switching dashboard tabs) return different `_usage`
   values depending on cache-hit vs cache-miss timing. A cache-hit response carries a lower
   pre-increment count and can arrive **after** a cache-miss response already stored the higher
   post-increment count. The monotonic check prevents the display from bouncing down.

4. **UsageLimitError**: The frontend `analyticsService.ts` defines a `UsageLimitError` class.
   When a 429 with `LIMIT_EXCEEDED` is received, the page shows a `UsageLimitBanner` and
   prevents further search.

5. **Compare page**: Uses the synthetic `POST /api/usage/track` endpoint. Calls it *before*
   starting any comparison work -- if it returns 429, the compare never starts.

---

## Routes that DON'T run consumeQuota

These routes have **no quota enforcement** (no `requireQuota` middleware):

- `GET /api/channel-videos/:channelId` -- uploads playlist resolution, rate-limited by `resolveLimiter`
- `GET /api/video/:videoId` -- video→channel ID resolution, rate-limited by `resolveLimiter`
- `GET /api/usage/me` -- read-only usage display
- `GET /api/admin/config` -- feature config (read-only, no per-call cost)
- `POST /api/admin/config` -- admin updates (admin-only)
- `GET /api/channels/mine` -- lists authorized channels (one-shot)
- `POST /api/analytics/dimensions` -- dimension bundle (gated via internal path)
- `POST /api/channels/cleanup` -- channel data cleanup (no YouTube API call)
- Cron jobs (`backend/cron.js`) -- server-side only, no user context

---

## Simplification Ideas

### A. Kill Resolve Scope -- **DONE 2026-06-27 (corrected 2026-06-27)**

`markResolveScope` middleware removed. The three `/channel/handle/:handle`,
`/channel/id/:id`, `/channel/username/:username` routes were identified as **full
metadata lookups** (YouTube API `part: snippet,contentDetails,statistics,brandingSettings`),
not lightweight resolves. They now have `requireQuota("channel")` + `consumeQuota`.

True resolve-only endpoints (`/channel-videos/:channelId`, `/video/:videoId`) are
rate-limited by `resolveLimiter` (60 req/15min) and do NOT consume monthly quota.
See changelog above.

### B. Move consumeQuota INTO the Middleware

```js
const requireQuota = (pageKey) => async (req, res, next) => {
  // ... existing checks ...
  await consumeQuota(req, { billable: false }); // ← inline, dedup window still prevents over-counting
  next();
};
```

This eliminates the two-phase pattern. Every request that reaches this middleware would consume
quota even on cache hits. The dedup window still prevents parallel over-counting, but cache-hit
requests would burn quota unnecessarily. The current pattern (check + defer increment) is preferred
so that cached responses are free.

### C. Abandon Per-PageKeys

One global monthly quota per user instead of separate limits for each feature. Dramatically
simplifies the config, the tracking, and the frontend display.

### D. Single Storage

Pick Redis. Drop the Firestore fallback. The Firestore code path adds complexity for a
backup that almost never fires in production.

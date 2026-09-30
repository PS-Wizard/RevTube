# Usage Limits & Feature Gating

## Overview

The usage limit system gates access to YouTube Data API and YouTube Analytics API features
by subscription tier (free vs pro). It tracks per-feature monthly consumption, enforces
hard caps at the middleware level, and surfaces remaining quota to the frontend for
real-time display.

**The system has grown more complex than it needs to be.** See the [Simplification Roadmap](#simplification-roadmap) at the bottom for discussion.

---

## Source Files

| File | Role |
|------|------|
| `backend/middleware/quota.js` + `backend/services/quotaService.js` | `requireQuota`, `consumeQuota`, `quotaService` (readCount, incrementCount, isDuplicate, resolvePageLimit, markBillable) |
| `backend/routes/usage.js` | `GET /usage/me`, `POST /usage/track` endpoints |
| `backend/middleware/premiumAccess.js` | `checkPremiumAccess` (pro-tier gating) |
| `backend/config/featureConfig.js` | Defaults, `getFeatureConfig`, `mergeFeatureConfigPages` |
| `backend/config/configVersion.js` | `getConfigVersion`, `bumpConfigVersion` |
| `backend/middleware/configVersion.js` | `checkConfigVersion` middleware + `invalidateAnalyticsCache` |
| `backend/index.js` | Wiring hub — creates middleware, services, and attaches `_usage` to JSON responses |
| `frontend/src/services/youtubeService.ts` | Frontend API client with `_usage` extraction |
| `frontend/src/services/analyticsService.ts` | Analytics API client + `UsageLimitError` class |
| `frontend/src/hooks/useUsage.ts` | React Query hook polling `/usage/me` |
| `frontend/src/stores/usageStore.ts` | Zustand store for real-time sidebar updates |
| `frontend/src/components/UsageBar.tsx` | Sidebar progress bar |
| `frontend/src/components/UsageLimitBanner.tsx` | Alert banner when at/near limit |
| `frontend/src/components/FeatureGuard.tsx` | Page-level premium gating |
| `frontend/src/components/PremiumFeature.tsx` | Component-level premium gating |
| `frontend/src/contexts/FeatureConfigContext.tsx` | Client-side config cache + defaults |
| `frontend/src/hooks/useFeatureConfig.ts` | Context consumer hook |
| `frontend/src/pages/admin/AdminPage.tsx` | Admin UI for editing config and user packages |
| `backend/cron.js` | Background jobs (bypass usage limits) |

---

## Architecture Diagram

```
                         Request
                           │
                           ▼
                 ┌──────────────────┐
                 │ authenticateReq  │  ← Firebase ID token verification
                 └──────────────────┘
                           │
                           ▼
                 ┌──────────────────┐
                 │   resolveUser    │  ← Lookup user (package, role, org)
                 └──────────────────┘
                           │
                           ▼
          ┌──────────────────────────────┐
          │  resolveOrgToken (optional)  │  ← Override token for org channels
          └──────────────────────────────┘
                           │
                           ▼
          ┌──────────────────────────────┐
          │ checkPremiumAccess(pageKey)  │  ← 403 if premiumOnly + free user
          └──────────────────────────────┘
                           │
                           ▼
          ┌──────────────────────────────┐
          │  requireQuota(pageKey)       │  ← 429 if at limit; sets quotaContext
          └──────────────────────────────┘
                           │
                           ▼
          ┌──────────────────────────────┐
          │     Route Handler            │
          │  ┌────────────────────────┐  │
          │  │ serverCache.get(key)   │  │  ← Cache lookup first
          │  │ if cached → return     │  │  ← Cache hit: NO quota consumed
          │  │ ... call YouTube API   │  │  ← On cache miss
          │  │ consumeQuota()         │  │  ← Only after successful API response
          │  └────────────────────────┘  │
          └──────────────────────────────┘
                           │
                           ▼
          ┌──────────────────────────────┐
          │  _autoAttachUsage middleware │  ← Appends _usage to every JSON response
          └──────────────────────────────┘
```

---

## Feature Configuration (FeatureConfig)

### Defaults (`config/featureConfig.js`)

```js
{
  pages: {
    dashboard:      { label: "Dashboard",       premiumOnly: false, freeLimit: 10,  proLimit: -1 },
    videos:         { label: "Videos",          premiumOnly: false, freeLimit: 20,  proLimit: -1 },
    channel:        { label: "Channel",         premiumOnly: false, freeLimit: 10,  proLimit: -1 },
    playlists:      { label: "Playlists",       premiumOnly: false, freeLimit: 10,  proLimit: -1 },
    compare:        { label: "Compare",         premiumOnly: false, freeLimit: 5,   proLimit: -1 },
    specificVideos: { label: "Specific Videos", premiumOnly: false, freeLimit: 10,  proLimit: -1 },
    chat:           { label: "AI Chat",          premiumOnly: false, freeLimit: 50,  proLimit: 200 },
  }
}
```

- **`freeLimit`**: Monthly request cap for free-tier users. Resets on the 1st.
- **`proLimit`**: Monthly cap for pro users. `-1` = unlimited.
- **`premiumOnly`**: If true, free users get 403 regardless of usage.
- **`label`**: Human-readable name for UI display.

### Loading and Caching

**Backend** (`config/featureConfig.js`):
- `getFeatureConfig()` reads from Firestore `config/featureConfig` document
- Cached in-memory with **10-minute TTL**
- Merges DB config over defaults via `mergeFeatureConfigPages()` — new pageKeys not in
  the DB doc inherit defaults

**Frontend** (`FeatureConfigContext.tsx`):
- Polls `GET /api/admin/config` every 60 seconds (React Query `refetchInterval: 60_000`)
- Falls back to `localStorage` cache (1-minute TTL) if the fetch fails
- Initializes from localStorage cache for instant-first-paint

**Config versioning** (`middleware/configVersion.js`):
- `config/version` Firestore doc is bumped on every admin save via `config/configVersion.js`
- `checkConfigVersion` middleware runs on each request; a version mismatch triggers `invalidateAnalyticsCache()`
- This forces cache misses on the next analytics request so new limits take effect immediately

---

## Routes and Their pageKey Mapping

| Route | pageKey | Resolve? | Premium-gated? | Method |
|-------|---------|----------|----------------|--------|
| `GET /channel/username/:username` | `channel` | No — full lookup with statistics/branding | No | `GET` |
| `GET /channel/id/:id` | `channel` | No — full lookup with statistics/branding | No | `GET` |
| `GET /channel/handle/:handle` | `channel` | No — full lookup with statistics/branding | No | `GET` |
| _(with `?includeTrailer=true`)_ | `channel` | No | No | `GET` |
| `GET /playlists/:channelId` | `playlists` | No | No | `GET` |
| `GET /playlist/:id` | `playlists` | No | No | `GET` |
| `GET /playlist-items/:playlistId` | `playlists` | No | No | `GET` |
| `GET /videos` | `videos` | No | No | `GET` |
| `GET /specific-videos` | `specificVideos` | No | No | `GET` |
| `GET /analytics/report` | `dashboard` | No | Yes | `GET` |
| `POST /dashboard/bundle` | `dashboard` | No | Yes | `POST` |
| `POST /dashboard/summary` | dashboard (but **NO limit check**) | No | Yes | `POST` |
| `GET /channel-videos/:channelId` | `videos` | No | Yes (via dashboard) | `GET` |
| `POST /usage/track` | `compare` | No | No | `POST` |
| `POST /api/chat/conversations/:id/messages` | `chat` | No | Yes | `POST` (SSE) |
| `POST /video-audit` | `videoAudit` | No | No | `POST` |

**NOTE:** `/dashboard/summary` (in `routes/dashboard.js`) has `checkPremiumAccess("dashboard")` but does
**NOT** have `requireQuota` middleware — it's free/unlimited. The comment says:
"fast first paint; no usage increment."

---

## Backend Enforcement — Deep Dive

### 1. `requireQuota(pageKey)` — Two-phase billing middleware (`middleware/quota.js`)

This middleware factory returns an Express middleware that:

1. Reads `req.currentUser` (set by `resolveUser`)
2. Bypasses entirely if user has `admin` role
3. Fetches `FeatureConfig` and finds the page config
4. Determines the user's effective limit:
   - `user.package === "pro"` → `pageCfg.proLimit`
   - Otherwise, checks org membership — if the org has `plan: "pro"`, grants pro limits
   - Otherwise → `pageCfg.freeLimit`
5. If `limit === -1` (unlimited) → pass through
6. **Normal path:**
   - Reads current counter via Redis `INCRBY key 0` (atomic read) or Firestore
   - If at limit → returns **429** (hard block, `LIMIT_EXCEEDED` error code)
   - Sets `req.quotaContext` with pageKey, uid, month, limit, currentCount
   - Sets `req.usageInfo` for downstream `_autoAttachUsage` middleware
   - Calls `next()`

#### Key implementation details:

- **Atomic read**: Uses `INCRBY key 0` instead of `GET` to ensure consistent reads
  under concurrent access. On Firestore fallback, reads the document directly.
- **Org pro inheritance**: An org member with plan:pro inherits pro limits even if
  their personal account is free. Membership is verified via `getCachedOrgMembership`.
- **Admin bypass**: `admin` role users always pass through regardless of limits or
  premium-only status.

### 2. `consumeQuota(req, { billable: true })` — Handler-side increment (`middleware/quota.js`)

Called inside route handlers. Actually advances the counter.

```js
async function consumeQuota(req, opts = {}) {
  const ctx = req?.quotaContext;
  if (!ctx || req._usageIncremented) return;

  // billable check: opts.billable or req.quotaBillable (set by quotaService.markBillable)
  if (!opts.billable && !req.quotaBillable) return;

  // Dedup: skip if another request already counted in this window
  if (await quotaService.isDuplicate(ctx.uid, ctx.pageKey)) {
    req._usageIncremented = true;
    return;
  }

  req._usageIncremented = true;

  const newCount = await quotaService.incrementCount(ctx.uid, ctx.pageKey, ctx.month);
  // Overshoot detection: log if newCount > limit + 1 (race condition)
  if (newCount > ctx.limit + 1) console.warn("Overshoot detected");
  // Updates req.usageInfo with newCount for _autoAttachUsage middleware
  req.usageInfo = { ...req.usageInfo, used: newCount };
}
```

**IMPORTANT — Now fires AFTER cache check (fixed 2026-06-27):**
The function is called **after** the cache check, **only on cache miss**. Cache hits do NOT
consume quota. Previously it fired before the cache check, causing inconsistencies (tabs
showing different usage numbers).

#### Dedup mechanism (`isDuplicate` in `services/quotaService.js`)

| Setting | Default | Env var |
|---------|---------|---------|
| Window | 5 seconds | `USAGE_DEDUP_WINDOW_SEC` |

Prevents N parallel requests from all advancing the counter:
- **Redis**: `SET NX EX <window>` — if the key already exists, another request already
  counted in this time window
- **In-memory fallback**: Local `Map` with per-entry expiry. Pruned at 10,000 entries.

### 3. `markResolveScope` — **Removed 2026-06-27**

Channel handle-resolution routes previously skipped quota entirely. However,
these routes call the YouTube Data API with `part: snippet,contentDetails,statistics,brandingSettings`
— they are **full channel metadata lookups**, not lightweight resolves. They now have
`requireQuota("channel")` middleware and `consumeQuota(req, { billable: true })` after a successful
response, gating them at the same limit as other channel features (`freeLimit: 10`).
`resolveLimiter` (60 req/15min) still applies for rate limiting.

The lightweight resolve calls that other pages need (getting uploads playlist ID from
a handle/channel ID) use the **`/channel-videos/:channelId`** endpoint instead, which
has its own middleware chain and does not consume channel quota.

### 4. `checkPremiumAccess(pageKey)` (`middleware/premiumAccess.js`)

Returns 403 if the page is `premiumOnly: true` and the user is not pro/admin.
Org members inherit pro access if their org has `plan: "pro"`.

### 5. `_autoAttachUsage` middleware (in `index.js`, applied before authenticated routes)

Global Express middleware that monkey-patches `res.json` to append `_usage` metadata
to every JSON object response:

```js
body._usage = { used: req.usageInfo.used, limit: req.usageInfo.limit, pageKey: req.usageInfo.pageKey };
```

The frontend reads this in `tryExtractUsage()` (`youtubeService.ts:10`) and pushes it
into the Zustand `usageStore` for real-time sidebar updates.

---

## Storage

### Primary: Redis
- Key format: `usage:{uid}:{pageKey}:{YYYY-MM}`
- Operations: `INCRBY usageKey 1` (increment), `INCRBY usageKey 0` (atomic read)
- TTL: Set to seconds remaining until the 1st of next month (capped at 45 days)
- Keys auto-expire at month boundary

### Fallback: Firestore
- Path: `users/{uid}/usage/{month}`
- Document shape: `{ [pageKey]: number, updatedAt: timestamp }`
- Increment via `FieldValue.increment(1)` with merge

### Metrics
The server tracks usage Redis vs Firestore hit counts and exposes them via admin cache stats at
`GET /api/admin/cache/stats` (`routes/admin.js`).

---

## Frontend Integration

### Real-time Usage Display

Three mechanisms keep the sidebar UsageBar up to date:

1. **`GET /api/usage/me` polling** (`useUsage` hook):
   - React Query with `staleTime: 10s`, `refetchOnWindowFocus: true`
   - Returns all pageKey usages + limits + current month
   - Automatically invalidated after every successful page search

2. **`_usage` auto-attach** (`tryExtractUsage`):
   - Every gated response includes `_usage` metadata
   - Frontend extracts it on every successful response and calls `usageStore.updateUsage()`
   - This provides sub-second updates without waiting for the /usage/me poll

3. **`POST /api/usage/track`** (Compare page):
   - Called BEFORE work starts, not after
   - Returns 429 if at limit — the compare never starts
   - Response includes `_usage` for immediate sidebar update

### Error Handling

```js
// analyticsService.ts:34
export class UsageLimitError extends Error {
  constructor(message: string, public limit: number, public used: number, public pageKey: string) {
    super(message);
    this.name = 'UsageLimitError';
  }
}
```

The frontend catches `UsageLimitError` in:
- `youtubeService.ts` — every YouTube API method
- `analyticsService.ts` — every analytics API method
- `Compare.tsx` — dedicated quota check

On catch, the page shows `UsageLimitBanner` and disables further search in that tab.

### Visual Components

- **`UsageBar`** — Small progress bar in the sidebar, shows used/limit per pageKey
- **`UsageLimitBanner`** — Full-width alert banner with 3 states:
  - `warning` (≥80% used) — "Approaching your limit"
  - `danger` (at limit) — "Monthly search limit reached"
  - `premium` (premium-only feature) — "Requires Pro"

### Premium Feature Gating

- **`FeatureGuard`** — Wraps entire pages; checks `FeatureConfig.isPagePremiumOnly(pageKey)` +
  `user.package === 'pro'`. Shows upgrade UI for free users.
- **`PremiumFeature`** — Lower-level component for inline feature gating (e.g., a
  premium-only filter inside an otherwise free page).

---

## The Synthetic `/usage/track` Endpoint (`routes/usage.js`)

For pageKeys without a dedicated backend route (currently only `compare`):

```js
POST /api/usage/track
Body: { /* no body needed — pageKey is hardcoded in middleware */ }
Response 200: { success: true, _usage: { used, limit, pageKey } }
Response 429: { error: { code: 'LIMIT_EXCEEDED', ... } }
```

The middleware `requireQuota("compare")` is applied directly to this route.
Calling this endpoint checks + increments in one round-trip. It is called **upfront**
by the Compare page before doing any actual comparison work.

---

## Admin Management

### Admin Config Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `GET /api/admin/config` | GET | Read current FeatureConfig (public) |
| `PUT /api/admin/config` | PUT | Update FeatureConfig (admin-only) |
| `POST /api/admin/users/:uid/package` | POST | Toggle user to pro/free |
| `POST /api/admin/users/:uid/role` | POST | Toggle user to admin/user |

### Admin UI (`AdminPage.tsx`)

- Edit per-pageKey limits (freeLimit, proLimit, premiumOnly)
- Toggle individual users between free/pro and user/admin
- Changes propagate within ~60s via React Query polling
- Config version invalidates analytics caches immediately

---

## Complexity Analysis & Current Pain Points

### Why It's Complex

1. **Two-phase pattern** (`requireQuota` middleware + `consumeQuota` in handler):
   Originally designed so quota was only consumed on cache miss. But over time, every route
   moved the increment before the cache check "for reliability." Now it's a vestigial
   pattern — the increment always fires, making the separation pointless.

2. **Resolve scope** (`markResolveScope` + `_resolveOnly`) — **Removed 2026-06-27**:
   Three routes (channel username/id/handle) previously blocked at-limit even though
   they didn't consume quota. Exhausting channel quota would break Playlists, Videos,
   and Compare pages. Now these routes skip quota entirely (rate-limited by `resolveLimiter`).
   
   But the frontend could just pass channel IDs directly after the first resolve,
   eliminating all of this.

3. **Per-pageKey tracking**: Six independent counters per user per month. Each needs
   its own config, its own storage key, its own UI display. The `/usage/me` endpoint
   iterates over all pageKeys to build the response.

4. **Dual storage (Redis + Firestore)**: The Firestore fallback adds ~60 lines of
   error-prone code and is almost never hit in production.

5. **Dedup window**: Prevents over-counting from parallel requests, but the 5s window
   is arbitrary and the in-memory fallback Map has manual pruning logic.

### The Result

- ~250 lines of middleware code
- 10+ route handlers with the increment-before-cache pattern copy-pasted
- 3 storage backends (Redis, Firestore, in-memory Map) for one counter
- 3 rate limiters (general, analytics, resolve) with unclear boundaries

---

## Simplification Roadmap

### Option A: Kill the Resolve Concept — **DONE 2026-06-27**

`markResolveScope` removed, `_resolveOnly` branch in `requireQuota` removed.
The three `/channel/handle/:handle`, `/channel/id/:id`, `/channel/username/:username`
routes were identified as **full metadata lookups** (not resolves) and now have
`requireQuota("channel")` + `consumeQuota(req, { billable: true })` — they consume channel
quota like any other channel feature. `resolveLimiter` (60 req/15min) still applies
as a secondary rate limit.

True resolve operations (getting uploads playlist ID from handle, video→channel
resolution) use dedicated endpoints (`/channel-videos/:channelId`, `/video/:videoId`)
that are rate-limited by `resolveLimiter` but do NOT consume monthly quota. This
ensures other pages (Playlists, Videos, Compare) can resolve handles even when
channel quota is exhausted.

### Option B: Inline Increment Into the Middleware

**Problem:** The two-phase pattern is pointless when increment always fires.

**What changes:**
```js
// Before
const requireQuota = (pageKey) => async (req, res, next) => {
  // ... check limit ...
  if (overLimit) return res.status(429)...;
  req.quotaContext = { ... };
  next();
};
// Then in EVERY handler:
await consumeQuota(req, { billable: true });  // ← copy-pasted 10+ times

// After
const checkAndIncrement = (pageKey) => async (req, res, next) => {
  // ... check limit ...
  if (overLimit) return res.status(429)...;
  await consumeQuota(req, { billable: true });  // ← inline it here
  next();
};
```

**Lines saved:** ~30 lines (the copy-pasted `await consumeQuota(req, { billable: true })` lines removed)

### Option C: Single Global Quota

**Problem:** Six independent pageKeys per user is complex to configure, track, and display.

**What changes:**
- One `freeLimit` and `proLimit` for the entire app
- No per-page config or tracking
- One key per user per month: `usage:{uid}:{YYYY-MM}`
- Frontend shows one progress bar instead of per-tab bars

**Downside:** A user could exhaust their entire quota on one feature (e.g., dashboard)
and have nothing left for others (e.g., channel lookup). Per-pageKey limits give
granular control.

### Option D: Single Storage

**Problem:** Dual Redis + Firestore adds complexity for a seldom-used fallback.

**What changes:**
- Pick Redis. Delete all Firestore fallback code.
- If Redis goes down, usage tracking stops (but the app still works — limits just
  aren't enforced until Redis comes back).

**Lines saved:** ~50 lines

### Recommended First Step

Do **Option B** first — it's the smallest change with the most immediate payoff:
10+ copy-pasted `await consumeQuota(req, { billable: true })` lines disappear, and the two-phase
mental model simplifies to a single "check and increment" middleware (though the actual refactoring kept two-phase with quotaService separation).

~~Then **Option A** (kill resolve scope)~~ — Done. See changelog.

---

## FAQ

### Q: Does a cache hit consume quota?

**No.** (Fixed 2026-06-27). The increment (`consumeQuota`) fires **after** a successful
YouTube API response. Cache hits skip the increment entirely. Failed API calls also don't count.

The dedup window (5s) additionally prevents parallel cache-miss requests from
over-counting.

### Q: How are channel lookups different from resolves?

Channel metadata routes (`/channel/handle/:handle`, `/channel/id/:id`,
`/channel/username/:username`) return full YouTube channel data including
snippet, statistics, subscriber count, and branding settings — they DO check
and consume monthly channel quota via `requireQuota("channel")` middleware
and `consumeQuota(req, { billable: true })`. These are not "resolve" calls.

True resolve calls (getting uploads playlist ID from a handle, or video →
channel ID resolution) use separate endpoints like `/channel-videos/:channelId`
and `/video/:videoId` that are rate-limited by `resolveLimiter` (60 req/15min)
but do NOT consume monthly quota. This prevents one pageKey's exhaustion from
blocking other pages (Playlists, Videos, Compare) that need basic resolution.

### Q: How does `?includeTrailer=true` affect channel page quota?

The `?includeTrailer=true` parameter on `GET /channel/handle/:handle` bundles the trailer
video fetch into the same request. The user pays **one** `channel` quota unit (the
`requireQuota("channel")` middleware fires once). The trailer video fetch is an internal
server-to-YouTube API call that does not consume user quota.

This was implemented 2026-06-30 to replace the previous two-request pattern
(`getFullChannelDetails` + `fetchVideosByIds`) with a single roundtrip.

### Q: What happens when a user exhausts their quota?

The backend returns `429 LIMIT_EXCEEDED` with `{ used, limit, pageKey }`. The frontend
catches this as `UsageLimitError` and:
1. Shows `UsageLimitBanner` on the current page
2. Updates the sidebar `UsageBar` to show 100%
3. Prevents further search in that tab
4. The banner links to `/profile` for upgrade

### Q: Can pro users ever hit a usage limit?

Only if `proLimit` is set to a finite number (not `-1`). Currently all pro limits are
`-1` (unlimited). Admin can change this in the config.

### Q: How accurate is the usage counter?

Within the dedup window (5s), parallel requests may race and under-count by 1. The
"overshoot detection" in `consumeQuota` logs cases where the counter exceeds
the limit, indicating a race in the read-then-increment pattern. This is rare in
practice.

### Q: What was `req._resolveOnly` and is it still used?

`req._resolveOnly` was **removed 2026-06-27** along with the `markResolveScope` middleware.
Channel resolve routes no longer interact with the quota system at all — they're rate-limited
by `resolveLimiter` instead. This prevents one pageKey's exhaustion from blocking every other
page that needs handle resolution.

`X-Usage-Context: resolve` is a separate CLIENT-SENT header checked in `checkPremiumAccess`
(`middleware/premiumAccess.js`) to bypass premium-only checks for background resolution calls. This is a
legacy pattern and is unrelated to the quota system.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-06-30 | `?includeTrailer=true` added to `/channel/handle/:handle` — fetches trailer video internally, charges 1 `channel` quota unit |
| 2026-06-27 | **Fixed**: Moved `incrementUsageLimit` to after cache check in all routes — cache hits no longer consume quota |
| 2026-06-27 | **Escalated fix**: Moved `incrementUsageLimit` to **after successful YouTube API response** — failed API calls also don't consume quota, fixing premature limit exhaustion on network errors |
| 2026-06-27 | Documented the increment-before-cache bug and its fix |
| 2026-06-27 | Added complexity analysis and simplification roadmap |
| 2026-06-27 | Mapped all routes to their pageKeys and resolve status |

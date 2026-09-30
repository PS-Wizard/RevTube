# RevTube: Complete Feature Test Plan

## PROD vs LOCAL -- Systematic Testing Checklist

**Instructions:** Go through each section in order. For each test:
1. Perform the action listed under **Steps**
2. Verify the **Expected Result** matches what you see
3. Mark `[ ]` → `[x]` and note any deviation

---

## Section 1: Usage Limits & Quota Management

### 1.1 UsageBar Visual Display
- [x] **Test:** Open any page (Dashboard, Videos, etc.). Look for the usage bar in the header/sidebar.
- [x] **Expected:** You see a colored progress bar showing `Used / Limit` with color states:
  - **Green** (ok) -- usage < 60%
  - **Orange** (warning) -- usage 60–85%
  - **Red** (danger) -- usage > 85%
- [x] **Expected:** It shows a remaining count like "145 remaining" beside the bar.

### 1.2 Quota Blocking (requireQuota)
- [x] **Test:** Go to a route that's behind `requireQuota("channel")` -- e.g., search a channel from the Channel page.
- [x] **Expected:** Request succeeds normally when you have quota.

### 1.3 Usage Field in API Responses
- [x] **Test:** Open browser DevTools → Network tab. Make a request to any API endpoint (e.g., load dashboard).
- [x] **Expected:** Every JSON response includes an `_usage` field with exactly `{ used, limit, pageKey }` -- no `source` field.

### 1.4 Quota Not Spent on Cache Hits
- [ ] **Test:** Visit the same page twice quickly. Check the `_usage` value in the response.
- [ ] **Expected:** `_usage.used` stays the same on the second visit (cache hit doesn't increment).

### 1.5 Resolve Calls Don't Burn Quota
- [ ] **Test:** Navigate to a page that does channel resolution (ChannelPage).
- [ ] **Expected:** The `_usage.used` value does NOT increase when the request is a resolve-scope call.

---

## Section 2: Dashboard Tab Endpoints -- 1 Quota Per Tab Switch

### 2.1 Channel Analytics Tab
- [ ] **Test:** Open Dashboard → "Channel Analytics" tab.
- [ ] **Expected:** Daily chart + 7d/30d/90d stats + videos uploaded all load in **one request** to `POST /dashboard/tab/channel`.
- [ ] **Expected:** `_usage.used` increments by exactly **1** (not 7).

### 2.2 Videos Tab
- [ ] **Test:** Switch to "Videos" tab on Dashboard.
- [ ] **Expected:** Video catalog + analytics load in **one request** to `POST /dashboard/tab/videos`.
- [ ] **Expected:** `_usage.used` increments by exactly **1** (not 2).

### 2.3 Playlists Tab
- [ ] **Test:** Switch to "Playlists" tab on Dashboard.
- [ ] **Expected:** Playlist catalog + analytics load in **one request** to `POST /dashboard/tab/playlists`.
- [ ] **Expected:** `_usage.used` increments by exactly **1** (not 2).

### 2.4 Audience Tab
- [ ] **Test:** Switch to "Audience" tab on Dashboard.
- [ ] **Expected:** 7d/30d/90d dimensions + comparison data load in **one request** to `POST /dashboard/tab/audience`.
- [ ] **Expected:** `_usage.used` increments by exactly **1** (not 3–6).

---

## Section 3: Config Versioning & Instant Cache Invalidation

### 3.1 Admin Config Save Clears Cache
- [ ] **Test:** Login as admin → Admin page → Change a config value (e.g., a page limit) → Save.
- [ ] **Expected:** After save, backend caches are immediately invalidated.
- [ ] **Expected:** **New config takes effect on the VERY NEXT request** -- no waiting minutes/hours.

### 3.2 Feature Config Auto-Poll
- [ ] **Test:** Open DevTools → Network tab → Filter for requests to config endpoints.
- [ ] **Expected:** Frontend polls config every **60 seconds** (not 10 minutes).
- [ ] **Expected:** Admin config changes reflect in the UI within ~30 seconds (not hours).

---

## Section 4: Dashboard Bundle v2 -- Channel Totals & Field Selection

### 4.1 Bundle ChannelTotals
- [ ] **Test:** Open Dashboard. Compare the headline "Views" / "Watch time" numbers on the summary cards vs the chart bars.
- [ ] **Expected:** Both come from `channelTotals` -- they should **match exactly** (structural consistency, not 2 different sources that can differ).

### 4.2 Fields Parameter
- [ ] **Test:** Check the `POST /api/dashboard/bundle` request payload in Network tab.
- [ ] **Expected:** It sends an optional `fields` array like `["channelTotals", "chartData", "comparison"]`.
- [ ] **Expected:** Omitting `fields` defaults to all fields.

---

## Section 5: Organization Mode & Multi-Tenant

### 5.1 Org Token Resolution
- [ ] **Test:** Switch to org mode via OrganizationSwitcher. Load a channel that belongs to the org.
- [ ] **Expected:** The channel loads using the org's OAuth token (not your personal token). `X-Org-Id` header is sent.

### 5.2 Independent Cache Namespaces
- [ ] **Test:** 
  1. In org mode, search a channel → loads correctly.
  2. Switch to personal mode → search the **same** channel.
  3. Switch back to org mode.
- [ ] **Expected:** Each mode has its own cache -- switching between them reloads fresh data from the correct context. No data leakage.

### 5.3 Immediate Cache Reload on Org Switch
- [ ] **Test:** While on ChannelPage or Compare page, switch org context.
- [ ] **Expected:** Page immediately reloads data from the new org's cache namespace (no stale data shown).

### 5.4 Membership Caching
- [ ] **Test:** Admin removes a member from an org. Check the backend.
- [ ] **Expected:** Membership cache is invalidated within 7 minutes OR immediately via `POST /api/organization/invalidate-member`.
- [ ] **Expected:** Removed member can no longer access org's channel data.

### 5.5 Tier Display in Header
- [ ] **Test:** Look at the header pill when in different contexts:
  - **Org mode:** Shows "Org" in blue
  - **Admin user:** Shows "Admin" in red
  - **Pro user:** Shows "Pro" in gold
  - **Free user:** Shows "Free" in grey
- [ ] **Expected:** In org mode, email/name are hidden in the header.

### 5.6 Sidebar Navigation Badges
- [ ] **Test:** Look at sidebar navigation items.
- [ ] **Expected:** Items show "Pro", "Admin", or "Locked" badges where applicable.
- [ ] **Expected:** Badges are hidden when sidebar is collapsed or in org mode.

---

## Section 6: Channel Page Redesign

### 6.1 Full Metadata Display
- [ ] **Test:** Search a channel with a complete YouTube About section.
- [ ] **Expected:** See all of: **Channel name, avatar, subscriber count, description, country, email, website, privacy status, made-for-kids flag, uploads playlist ID, likes playlist ID**.

### 6.2 Social Link Chips
- [ ] **Test:** Search a channel that has social links in its description.
- [ ] **Expected:** Links appear as **clickable chip badges** with platform icons -- Instagram, Twitter/X, Facebook, YouTube, etc.
- [ ] **Expected:** Chips are categorized: social / website / youtube / other.

### 6.3 Keyword Tags
- [ ] **Test:** Search a channel with keywords set.
- [ ] **Expected:** Keywords shown as **styled chips** with hover effects.
- [ ] **Expected:** Handles both comma-separated and space-separated formats, preserves quoted phrases.

### 6.4 Featured Video Description Toggle
- [ ] **Test:** Find a channel with a long featured video description.
- [ ] **Expected:** Shows "Show more / Show less" toggle for long descriptions.

### 6.5 High-Quality Banner
- [ ] **Test:** Load a channel page.
- [ ] **Expected:** Banner uses **2560px wide** high-quality version, not the default.

### 6.6 Single API Call
- [ ] **Test:** Check Network tab when loading a channel.
- [ ] **Expected:** A **single** `getChannelWithTrailer` call -- not multiple separate API calls.

### 6.7 Empty States Graceful Handling
- [ ] **Test:** Search a channel with no keywords.
- [ ] **Expected:** Keywords section **gracefully hides** -- no empty boxes or broken UI.
- [ ] **Test:** Search a channel with no social links.
- [ ] **Expected:** Links section gracefully hides.

### 6.8 Responsive Layout
- [ ] **Test:** Resize the browser to mobile width (or use DevTools device mode).
- [ ] **Expected:** Channel page **wraps properly** -- no horizontal scroll, content stacks vertically.

### 6.9 Liked Videos Correctly Gated
- [ ] **Test:** Check the liked-videos playlist condition.
- [ ] **Expected:** Uses `likesPlaylistId` (not `uploadsPlaylistId`) for gating liked videos.

---

## Section 7: Admin Features

### 7.1 Danger Zone -- Package Management
- [ ] **Test:** Login as admin → Admin page → Scroll to "Danger Zone".
- [ ] **Expected:** You see a **package toggle** to upgrade/downgrade users between `free` ↔ `pro`.

### 7.2 Confirmation Dialog
- [ ] **Test:** Click the package toggle on a user.
- [ ] **Expected:** A `window.confirm` dialog appears before the change is made.

### 7.3 Optimistic UI Update
- [ ] **Test:** After confirming a package change.
- [ ] **Expected:** The user's package label changes **immediately** -- no need to wait for server, then backend syncs.

### 7.4 Self-Package Refresh
- [ ] **Test:** Admin changes their own package.
- [ ] **Expected:** Header tier indicator updates automatically without manual reload.

### 7.5 Admin Endpoint Auth Guards
- [ ] **Test:** Try calling `/admin/cache/refresh-all`, `/admin/ingestion/refresh-all` without auth.
- [ ] **Expected:** Returns 401/403 -- endpoints are protected by `authenticateRequest` + `checkAdmin`.

### 7.6 Admin Rate Limiting
- [ ] **Test:** Admin endpoints under heavy load.
- [ ] **Expected:** `adminLimiter` is pass-through (not rate-limited). Only `checkAdmin` guards access.

---

## Section 8: Rate Limiting

### 8.1 User-Based Rate Limit Keys
- [ ] **Test:** Open two different browser sessions logged in as different users.
- [ ] **Expected:** Each user has their **own rate limit bucket** -- one user can't exhaust the shared pool and block others.

### 8.2 Structured 429 Error
- [ ] **Test:** Hit a rate-limited endpoint until you get rate-limited.
- [ ] **Expected:** Returns structured JSON: `{ code: "RATE_LIMITED", message, scope, path, method, limit, remaining, retryAfterSeconds }` -- not a generic text.

### 8.3 Frontend 429 Handling
- [ ] **Test:** While rate-limited, navigate to Compare page or search a channel.
- [ ] **Expected:** Shows a **human-readable error** with retry message -- not a generic network error.

---

## Section 9: OAuth & Authentication

### 9.1 OAuth Refresh Timeout
- [ ] **Test:** (Indirect) Simulate a slow OAuth response -- or check the code.
- [ ] **Expected:** All `axios.post` calls to `oauth2.googleapis.com/token` have **10-second timeout** (no hung threads).

### 9.2 OAuth Error Diagnostics
- [ ] **Test:** Intentionally break the OAuth refresh (e.g., invalidate the refresh token).
- [ ] **Expected:** Returns **502 TOKEN_REFRESH_FAILED** with structured `oauthErr` object containing status, message, code, errno, syscall.

### 9.3 Personal Account Onboarding
- [ ] **Test:** Login with a Firebase account that has no YouTube channels connected.
- [ ] **Expected:** **No repeated "No access token available" error noise** -- dashboard data hooks short-circuit gracefully.

### 9.4 OAuth Token Cache
- [ ] **Test:** Trigger multiple page loads/refreshes that require OAuth token refresh.
- [ ] **Expected:** OAuth token is cached for **55 minutes** -- ~90% of refresh requests return cached token instead of calling Google.

---

## Section 10: Performance & Caching

### 10.1 Gzip-Compressed Redis
- [ ] **Test:** Check backend logs for cache operations.
- [ ] **Expected:** Redis data stored with gzip compression (unless `DISABLE_COMPRESSION=1`). Smaller payloads.

### 10.2 In-Flight Request Dedup
- [ ] **Test:** Rapidly refresh a page (or open two tabs simultaneously) that fetches the same uncached analytics data.
- [ ] **Expected:** **Only one request** reaches YouTube API -- the second awaits the same promise. No double quota burn.
- [ ] **Expected:** If the first request fails, both get the error (not a hang).

### 10.3 Cache Hit/Miss Logging
- [ ] **Test:** Check backend logs while making requests.
- [ ] **Expected:** Cache operations are logged with prefix, key, and event type (hit/miss). With `PERF_LOG=1`, detailed performance logging.

---

## Section 11: Security

### 11.1 Helmet Security Headers
- [x] **Test:** Open DevTools → Network tab → Check response headers on any request. *(automated: `backend/config/securityHeaders.test.mjs`)*
- [x] **Expected:** Headers present: `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`.
- [x] **Expected:** A `Content-Security-Policy` header is present and enforced, defined in `backend/config/securityHeaders.js`.
- [x] **Expected:** `script-src 'self'` -- no inline script, no `unsafe-eval`, no CDN.
- [x] **Expected:** `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`.
- [x] **Expected:** `style-src 'self' 'unsafe-inline'` -- the only relaxation, required by the Bull Board React runtime at `/admin/queues`.
- [x] **Expected:** `cross-origin-resource-policy: cross-origin`, since the API is consumed from a separate frontend origin.

### 11.2 Cache Key Sanitization
- [ ] **Test:** Check backend code for `sanitizeCacheSegment()`.
- [ ] **Expected:** All cache keys from user input are sanitized -- colons, control chars, null bytes stripped. Max 120 chars.

### 11.3 `_usage` Field -- No Internal Leak
- [ ] **Test:** Inspect `_usage` in any API response.
- [ ] **Expected:** Only `{ used, limit, pageKey }` -- no `source: "redis"` or `source: "firestore"`.

### 11.4 Rate Limit Key -- No Docker IP Collapse
- [ ] **Test:** Check rate limiter configuration.
- [ ] **Expected:** Key generator uses `req.authUser?.uid || req.authUser?.email` -- NOT `req.ip` which collapses behind nginx/Docker.

---

## Section 12: Frontend UX Improvements

### 12.1 Recent Item Click Guard (Usage Exhaustion)
- [ ] **Test:** When your quota is exhausted, try clicking a recent channel/item from the sidebar.
- [ ] **Expected:** Click handler checks `isUsageExhausted` and **returns early** -- no confusing API error shown.

### 12.2 Loading Spinner
- [ ] **Test:** Navigate to a page that's loading data.
- [ ] **Expected:** SVG icon animates with the `.spin` CSS class (centered, no margin offset issues).

### 12.3 Connect Button Spinner
- [ ] **Test:** Click "Connect YouTube Channel" button.
- [ ] **Expected:** Spinner is **center-aligned** (not pushed by marginRight offset). Uses `display: inline-flex` + `align-items/justify-content: center`.

### 12.4 Header Plan Pill Colors
- [ ] **Test:** Check the header avatar/pill area in each mode:
- [ ] **Expected:** 
  - Free: Grey pill with "Free" label
  - Pro: Gold pill with "Pro" label
  - Org mode: Blue pill with "Org" label, email/name hidden

---

## Section 13: Clean Architecture Regression

### 13.1 Backend Syntax Check
- [ ] **Test:** Run `node -c backend/index.js` in the terminal.
- [ ] **Expected:** No syntax errors. Returns silently (or prints `index.js`).

### 13.2 API Endpoint Regression
- [ ] **Test:** Quick sanity check -- hit the most common endpoints:
  - `POST /api/dashboard/tab/channel` -- returns dashboard data
  - `GET /api/channel/handle/:handle` -- returns channel data
  - `POST /api/dashboard/bundle` -- returns bundle
  - `GET /api/user/profile` -- returns user data
- [ ] **Expected:** All endpoints respond correctly (200 or 4xx for auth, never 500).

### 13.3 Dependency Injection Pattern
- [ ] **Test:** Check that each route exports `create*Router(deps)`.
- [ ] **Expected:** Consistent DI pattern -- no globals or inline service creation in routes.

---

## Section 14: Documentation Audit

### 14.1 fulldocs Directory
- [ ] **Test:** Verify `fulldocs/` directory exists with subdirectories.
- [ ] **Expected:** 34 files across 8 categories: Project Overview, Backend Service, Auth & Authorization, Analytics Dashboard, Content Discovery Pages, Frontend Architecture, Infrastructure & Deployment, Glossary.

### 14.2 CHANGELOG
- [ ] **Test:** Open `CHANGELOG.md`.
- [ ] **Expected:** 215+ lines covering all major changes.

### 14.3 Architecture Diagrams
- [ ] **Test:** Open `docs/PROJECT_GUIDE.md`.
- [ ] **Expected:** Mermaid architecture diagrams, full API reference, database schemas, state machine documentation.

---

## Section 15: Feature Config System

### 15.1 Config Merging
- [ ] **Test:** Check if a new page key is missing from the Firestore config.
- [ ] **Expected:** `mergeFeatureConfigPages()` merges DB config with `DEFAULT_FEATURE_CONFIG` -- new pages get defaults instead of failing.

### 15.2 Page Key Unification
- [ ] **Test:** Check the config for "report" and "dashboard".
- [ ] **Expected:** Both unified under `"dashboard"` -- no separate "report" entry.

---

## Section 16: Dependency & Lock Files

### 16.1 Deterministic Installs
- [ ] **Test:** Run `pnpm install` in both `backend/` and `frontend/`.
- [ ] **Expected:** Installs succeed without warnings. Lock files (`pnpm-lock.yaml`, `package-lock.json`) ensure deterministic installs across environments.

### 16.2 Helmet Package
- [ ] **Test:** Check that `helmet` is in backend dependencies.
- [ ] **Expected:** `helmet@^8.2.0` present in `backend/package.json`.

---

## Section 17: Compare Page Caching

### 17.1 Backend Cache (Redis)
- [ ] **Test:** Open Compare page, compare two channels. Check backend logs.
- [ ] **Expected:** See `[Compare] Cache MISS for {playlistId}` then `[Compare] Fetched N videos` on first comparison.
- [ ] **Test:** Compare the same two channels again (same date range).
- [ ] **Expected:** See `[Compare] Cache HIT for {playlistId}` -- no YouTube API calls to playlistItems or videos endpoints.

### 17.2 Cross-User Shared Cache
- [ ] **Test:** User A compares @ChannelX vs @ChannelY. User B (different account) compares @ChannelX vs @ChannelZ.
- [ ] **Expected:** User B sees a cache HIT for @ChannelX's data (shared across users). Only @ChannelZ is freshly fetched.

### 17.3 Frontend localStorage Cache
- [ ] **Test:** Compare two channels. Close the Compare tab. Re-open Compare with the same channels and date range.
- [ ] **Expected:** Page loads instantly from localStorage -- no network requests for the comparison data.

### 17.4 Org Cache Isolation
- [ ] **Test:** Compare channels in personal mode. Switch to org mode and compare the same channels.
- [ ] **Expected:** Each mode gets its own localStorage cache entry (`::org:{orgId}` suffix) -- fresh data loads on switch.
- [ ] **Test:** Switch back to personal mode.
- [ ] **Expected:** Personal mode's cached comparison loads -- not stale org-mode data.

### 17.5 Pre-Computed Metrics
- [ ] **Test:** Compare two channels. Check the API response from `POST /compare/videos`.
- [ ] **Expected:** Response includes a `metrics` object with `totalVideos`, `totalViews`, `totalLikes`, `totalComments`, `avgViewsPerVideo`, `avgLikesPerVideo`, `avgCommentsPerVideo`, `avgLikesPerView`.

### 17.6 Graceful Fallback
- [ ] **Test:** Stop the backend server. Compare two channels.
- [ ] **Expected:** Comparison still works -- falls back to client-side `fetchVideosOptimized()`.

### 17.7 Cache Expiry
- [ ] **Test:** Wait 1 hour (or clear Redis cache via admin endpoint). Compare the same channels again.
- [ ] **Expected:** Cache MISS -- fresh data fetched from YouTube API.

### 17.8 Premium Access Gate
- [ ] **Test:** As a free user, try calling `POST /compare/videos` directly (via browser DevTools).
- [ ] **Expected:** Returns 403 PREMIUM_REQUIRED if compare is set to `premiumOnly: true` in FeatureConfig (or passes if it's allowed for free tier).

---

## Quick Reference: Key URLs & API Routes

| Endpoint | Method | Purpose | Section |
|----------|--------|---------|---------|
| `/dashboard/tab/channel` | POST | Combined channel tab | §2.1 |
| `/dashboard/tab/videos` | POST | Combined videos tab | §2.2 |
| `/dashboard/tab/playlists` | POST | Combined playlists tab | §2.3 |
| `/dashboard/tab/audience` | POST | Combined audience tab | §2.4 |
| `/api/dashboard/bundle` | POST | Dashboard bundle with channelTotals | §4 |
| `/api/channel/handle/:handle` | GET | Channel lookup with trailer | §6 |
| `/api/channel/id/:id` | GET | Channel lookup by ID | §6 |
| `/api/analytics/report` | GET | Analytics report | §7 |
| `/api/admin/config` | PUT | Admin config save + cache invalidation | §3 |
| `/api/admin/user/toggle-package` | POST | Danger Zone package toggle | §7.1 |
| `/api/organization/invalidate-member` | POST | Invalidate member cache | §5.4 |
| `/api/oauth/refresh` | POST | OAuth token refresh | §9 |
| `/api/compare/videos` | POST | Compare page videos + pre-computed metrics | §17 |

---

## Environment Setup

Before testing, ensure the app is running:
```bash
cd /app
docker-compose up -d
# OR for bare metal:
cd backend && pnpm dev
cd frontend && pnpm dev
```

Log in as:
- **Admin user** -- `support@revketer.ai` (or your admin email)
- **Free user** -- any non-admin account
- **Pro user** -- a user with pro package
- **Org user** -- a user who belongs to an organization with channels

---
*Generated 2026-07-01 from `docs/PROD_vs_LOCAL_Comparison.md` -- 16 feature sections, ~50+ test cases.*

## Channel Comparison Tool

Relevant source files

-   [frontend/src/components/Compare.tsx](../../frontend/src/components/Compare.tsx)
-   [frontend/src/components/Compare.css](../../frontend/src/components/Compare.css)
-   [frontend/src/services/youtubeService.ts](../../frontend/src/services/youtubeService.ts)
-   [frontend/src/pages/DashboardPage.tsx](../../frontend/src/pages/dashboard/DashboardPage.tsx)
-   [frontend/src/utils/chartRenderer.tsx](../../frontend/src/utils/chartRenderer.tsx)
-   [backend/routes/compare.js](../../backend/routes/compare.js)

The Channel Comparison Tool is a standalone feature that allows users to perform side-by-side benchmarking of multiple YouTube channels. It aggregates public metadata and video-level performance stats across custom date ranges, calculating engagement metrics and rendering multi-series visualizations for comparative analysis.

## 1\. Two-Tier Caching Architecture

The Compare page uses a **two-tier caching strategy** to prevent redundant YouTube API calls. Both layers have a 1-hour TTL.

| Layer | Storage | Key | TTL | Shared? |
|-------|---------|-----|-----|---------|
| **Backend Redis** | `ServerCache` via `POST /compare/videos` | `compare:videos:{playlistId}{:startDate_endDate}` | 1 hour | **Yes** — all users share the same cache entry for a given channel+date range |
| **Frontend localStorage** | Browser cache | `compare_cache::{sortedChannels}::{dateRange}::org:{orgId}` | 5 min | Per-user/per-org (isolated by browser) |

### Backend Cache (Cross-User Shared)

Each channel's videos + pre-computed metrics are cached **independently** in Redis under `compare:videos:{playlistId}...`. The cache key has **no user or org scope** — a free user comparing @MrBeast and a pro user comparing @MrBeast hit the same cache entry. This means:

- If User A compares @ChannelX vs @ChannelY, both channels' data is cached in Redis.
- If User B later compares @ChannelX vs @ChannelZ, @ChannelX's data is a Redis cache hit — only @ChannelZ is freshly fetched.
- The TTL is 1 hour (`COMPARE_CACHE_TTL = 60 * 60 * 1000`).

### Frontend Cache (Per-Channel, Per-Org Isolated)

Individual channel results are cached independently in `localStorage`:

- Key format: `compare_cache::channel::{handle}::{startDate_endDate}::org:{orgId}`
- **Org-scoped**: `::org:{orgId}` suffix prevents data leakage between personal and org modes.
- **Per-channel**: Each channel's `ComparisonMetrics` is cached separately, so adding a new channel to a comparison fetches only the uncached channels while reusing cached data for existing ones.
- **Partial merge**: When comparing 3 channels where only 1 is uncached, the uncached channel is fetched from the backend (Redis-cached) while the other 2 load from localStorage — zero unnecessary API calls or quota burns.
- A 300ms loading indicator is shown even on full cache hits for consistent UX.

---

## 2\. Orchestration and State Management

The comparison logic is encapsulated in the `Compare` component [frontend/src/components/Compare.tsx](../../frontend/src/components/Compare.tsx) It manages a list of `ChannelInput` objects, which support YouTube handles, channel IDs, or full URLs.

### Data Flow: Initialization to Execution

1. **Hydration**: The component initializes state from URL search parameters (`channels`, `startDate`, `endDate`) or falls back to `localStorage` via `loadChannelCache` (per-channel) [frontend/src/components/Compare.tsx#103-111](../../frontend/src/components/Compare.tsx). Cache is **org-scoped** — `compare_cache` for personal mode, `compare_cache::org:{orgId}` for org mode. A `useEffect` on `[currentOrganization?.id]` immediately reloads from the correct cache namespace when the user switches contexts [frontend/src/components/Compare.tsx#401-417](../../frontend/src/components/Compare.tsx).

2. **Input Handling**: Users can add or remove channel slots. The `AutocompleteInput` component is used to suggest channels based on the user's `recentChannels` history [frontend/src/components/Compare.tsx#149-161](../../frontend/src/components/Compare.tsx).

3. **Per-channel cache check (first)**: Before any quota or API calls, each channel's `localStorage` cache is checked via `loadChannelCache()`. If all channels are cached locally, the comparison loads from cache with a brief 300ms loading indicator — **zero quota consumed, zero API calls**.

4. **Conditional quota check**: If any channel is **uncached** in `localStorage`, `checkCompareQuota()` calls `POST /api/usage/track` once. Returns 429 if compare quota is exhausted — comparison never starts. Fully cached comparisons skip this entirely [frontend/src/components/Compare.tsx#25-54](../../frontend/src/components/Compare.tsx).

5. **The `handleCompare` Trigger**: Validates inputs, updates the browser URL for shareability, and executes the fetch pipeline:
   - For each channel, calls `service.fetchCompareVideos(playlistId, startDate, endDate)` (backend endpoint)
   - If backend call fails, falls back to client-side `fetchVideosOptimized()`
   - Uses backend pre-computed metrics when available, otherwise calculates client-side via `calculateMetrics()`
   - Constructs `ComparisonMetrics` with channel metadata, subscriber counts, and top 50 videos
   - Stores each channel's `ComparisonMetrics` in per-channel `localStorage` cache (`saveChannelCache`), so adding a new channel later only fetches what's missing

### Component Architecture

The following diagram illustrates the relationship between the UI state and the data fetching services.

Comparison Logic Overview

Sources: [frontend/src/components/Compare.tsx](../../frontend/src/components/Compare.tsx) [frontend/src/utils/pdfExport.ts](../../frontend/src/utils/pdfExport.ts) (referenced by import).

---

## 3\. Backend Data Ingestion (`POST /compare/videos`)

The backend endpoint `POST /compare/videos` replaces the previous purely client-side fetching approach. It lives in [backend/routes/compare.js](../../backend/routes/compare.js) and performs the following pipeline:

### Pipeline Steps

1. **Paginate all playlist items**: Fetches videos from the channel's uploads playlist in batches of 50, up to 200 videos total. Extracts `videoId`, `title`, `publishedAt`, `channelTitle`, `description`, `thumbnailUrl` from each item.

2. **Enrich with statistics**: Batch-fetches video details (50 per call) via `/videos` API with `part: snippet,statistics,contentDetails`. Extracts `viewCount`, `likeCount`, `commentCount`.

3. **Filter by date range**: Applies `startDate`/`endDate` filters client-side on the enriched data.

4. **Compute analytics metrics**:
   ```json
   {
     "totalVideos": 142,
     "totalViews": 6240000,
     "totalLikes": 124300,
     "totalComments": 8520,
     "avgViewsPerVideo": 43873,
     "avgLikesPerVideo": 875,
     "avgCommentsPerVideo": 60,
     "avgLikesPerView": 2.01
   }
   ```

5. **Cache and return**: Stores the full result in Redis under `compare:videos:{playlistId}{:startDate_endDate}` with 1-hour TTL, then returns `{ videos, channelTitle, metrics }`.

### Access Control

- `resolveUser` — identifies the requesting user
- `checkPremiumAccess("compare")` — gates the endpoint with the `compare` FeatureConfig pageKey (free: 5/mo, pro: unlimited)
- No `requireQuota` middleware on this endpoint — quota is consumed via the separate `POST /api/usage/track` call that the frontend makes upfront

### Cache Behavior

- **Cache key**: `compare:videos:{playlistId}{:startDate_endDate}` — no user scope, shared across all users
- **TTL**: 1 hour (60 * 60 * 1000ms)
- **Cache miss**: Full YouTube API fetch (pagination + enrichment)
- **Cache hit**: Returns cached `{ videos, channelTitle, metrics }` immediately — no YouTube API calls

### Graceful Fallback

If the backend `POST /compare/videos` call fails (network error, server error, etc.), the frontend falls back to the client-side `fetchVideosOptimized()` method, which fetches videos directly from YouTube API via the proxy routes. This ensures zero-regression compatibility.

Sources: [backend/routes/compare.js](../../backend/routes/compare.js) [frontend/src/services/youtubeService.ts](../../frontend/src/services/youtubeService.ts)

---

## 4\. Frontend Caching Details

### `fetchCompareVideos()` (YouTubeService)

Added to `YouTubeService` to call the backend compare endpoint:

```typescript
async fetchCompareVideos(
  playlistId: string,
  startDate?: string,
  endDate?: string
): Promise<{
  videos: VideoMetadata[];
  channelTitle: string | null;
  metrics: CompareMetrics | null;
}>
```

- Sends `POST /compare/videos` with `{ playlistId, startDate, endDate }`
- Extracts `_usage` from response for real-time quota display
- Throws `UsageLimitError` on 429 responses
- Returns the full backend response including pre-computed metrics

### Frontend localStorage Cache (Per-Channel)

Each channel's `ComparisonMetrics` is cached independently so adding a new channel to a comparison only fetches the uncached ones:

```typescript
const cacheKey = `compare_cache::channel::${handle.toLowerCase()}::${dateRange}::org:${orgId}`;
```

- **TTL**: 5 minutes (`CACHE_DURATION = 5 * 60 * 1000`)
- **Per-channel**: Each handle+date+org combo has its own cache entry
- **Partial merge**: When comparing 3 channels where only 1 is uncached, the uncached channel fetches from the backend (Redis-cached) while the other 2 reuse localStorage — zero unnecessary API calls
- **Quota gating**: `checkCompareQuota()` is called ONLY when at least one channel is uncached. If all channels are locally cached, no quota is consumed.
- **On cache hit**: Returns stored `ComparisonMetrics` for that channel immediately
- **On cache miss**: Fetches via `fetchCompareVideos()` (or `fetchVideosOptimized()` fallback), caches, returns

Sources: [frontend/src/services/youtubeService.ts](../../frontend/src/services/youtubeService.ts) [frontend/src/components/Compare.tsx](../../frontend/src/components/Compare.tsx)

---

## 5\. Visualization: Multi-Series Charts

The comparison tool leverages the `chartRenderer` utility to display multiple channels on a single timeline.

### Data Preparation

The `results` array is transformed into a `multiSeriesData` format compatible with the ECharts option builder. Each series is assigned a color from the `MULTI_SERIES_FALLBACK_COLORS` palette [frontend/src/pages/DashboardPage.tsx#50](../../frontend/src/pages/dashboard/DashboardPage.tsx)

### Rendering Pipeline

The `renderChart` function in `chartRenderer.tsx` handles the complexity of drawing multiple `Area` or `Bar` components based on the `multiSeriesData` prop [frontend/src/utils/chartRenderer.tsx#109-118](../../frontend/src/utils/chartRenderer.tsx)

Multi-Series Rendering Flow

Sources: [frontend/src/utils/chartRenderer.tsx#27-107](../../frontend/src/utils/chartRenderer.tsx) [frontend/src/utils/chartRenderer.tsx#109-222](../../frontend/src/utils/chartRenderer.tsx)

---

## 6\. Export Engine

Users can export the generated comparison report as a PDF using `generateComparisonPDF`.

### PDF Generation Flow

1.  Capture: The function takes the current comparison results and the rendered charts.
2.  Layout: It uses `jspdf` and `html2canvas` (or similar utilities) to format the `TABLE_SECTIONS` (Overview, Performance, Averages) into a document [frontend/src/components/Compare.tsx#69-93](../../frontend/src/components/Compare.tsx)
3.  Metadata: The PDF includes channel avatars, banners, and the specific date range selected for the comparison [frontend/src/components/Compare.tsx#225-280](../../frontend/src/components/Compare.tsx)

Sources: [frontend/src/components/Compare.tsx#5](../../frontend/src/components/Compare.tsx) [frontend/src/components/Compare.tsx#69-93](../../frontend/src/components/Compare.tsx)

---

## 7\. Usage Limits and Error Handling

The Compare page enforces the **compare** quota (default free tier: 5 comparisons/month) using a synchronous upfront check before any data-fetching API calls are made.

### Upfront quota check (`checkCompareQuota`)

At the start of each comparison, `checkCompareQuota()` is called [frontend/src/components/Compare.tsx#25-54](../../frontend/src/components/Compare.tsx):
- **POST** to `POST /api/usage/track` on the backend [routes/usage.js](../../backend/routes/usage.js)
- Backend runs `requireQuota("compare")` + `consumeQuota(req, { billable: true })` atomically
- **200 OK** → quota available and already consumed → comparison proceeds
- **429 LIMIT_EXCEEDED** → `UsageLimitError` thrown → caught → `UsageLimitBanner` displayed → comparison stops
- Any other error → logged, **fail open** (comparison proceeds) so transient issues don't block the user

### Error propagation

If `checkCompareQuota()` succeeds but a channel-resolution call later fails with a `UsageLimitError`, the error propagates through the channel promise [frontend/src/components/Compare.tsx#293](../../frontend/src/components/Compare.tsx). The `Promise.all` rejects immediately, the outer catch sets the usage error state, and the comparison is halted.

- Error Detection: Caught during the `handleCompare` execution
- UI Feedback: Displays the `UsageLimitBanner` to prompt the user for an upgrade
- Comparison data is cleared (`setResults([])`) before each attempt, so stale results never persist alongside the error.

### Graceful Backend Fallback

If `fetchCompareVideos()` fails with a non-429 error, the comparison falls back to client-side `fetchVideosOptimized()` which fetches videos directly through YouTube API proxy routes. This ensures the feature works even if the backend compare endpoint is temporarily unavailable.

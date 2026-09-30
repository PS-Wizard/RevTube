## Service Layer & API Client

Relevant source files

-   [frontend/src/services/analyticsService.ts](../../frontend/src/services/analyticsService.ts)
-   [frontend/src/services/youtubeService.ts](../../frontend/src/services/youtubeService.ts)
-   [frontend/src/utils/apiResponseSchemas.ts](../../frontend/src/utils/apiResponseSchemas.ts)

The Service Layer acts as the bridge between the React frontend and the backend REST API. It encapsulates authentication header management, request deduplication, client-side caching, and Zod-based response validation.

## Architecture Overview

The service layer is divided into two primary classes: `YouTubeService` for metadata and resource resolution, and `AnalyticsService` for high-volume data fetching. Both services utilize `analyticsCache` to minimize redundant network calls and `authHeaders` to ensure every request is properly scoped to a Firebase user or an organization.

### Data Flow Diagram

The following diagram illustrates how a request flows from a UI component through the service layer to the backend.

Service Layer Request Flow

Sources: [frontend/src/services/analyticsService.ts#143-162](../../frontend/src/services/analyticsService.ts) [frontend/src/services/youtubeService.ts#30-45](../../frontend/src/services/youtubeService.ts) [frontend/src/utils/apiResponseSchemas.ts#45-52](../../frontend/src/utils/apiResponseSchemas.ts)

___

## YouTubeService

`YouTubeService` handles metadata-related operations such as resolving channel IDs from handles, fetching video details, and retrieving playlist items.

### Key Features

-   Usage Contexts: Formerly used `X-Usage-Context: resolve` headers for background ID resolution calls. This header is now **ignored by the backend** — resolve scoping was removed in 2026-06-27 along with the `markResolveScope` middleware. Quota is now enforced solely via `requireQuota(pageKey)` / `consumeQuota(req, opts)` in `backend/middleware/quota.js` and `backend/services/quotaService.js`. The frontend's `getResolveHeaders()` simply returns standard auth headers [frontend/src/services/youtubeService.ts#47-54](../../frontend/src/services/youtubeService.ts)
-   Multi-Tenant Support: Automatically attaches `X-Org-Id` when initialized within an organization workspace [frontend/src/services/youtubeService.ts#40-42](../../frontend/src/services/youtubeService.ts). All five content pages/components pass `currentOrganization?.id || null` to the `YouTubeService` constructor — VideosPage, PlaylistPage, SpecificVideosPage, ChannelPage, and Compare — so the backend receives the correct org context for scoped cache keys and token resolution.
-   Error Propagation: Maps backend `429` errors into `UsageLimitError` instances for the UI to trigger upgrade modals [frontend/src/services/youtubeService.ts#64-72](../../frontend/src/services/youtubeService.ts)

### Core Methods

| Method | Purpose | Backend Route |
|--------|---------|--------------|
| `getChannelByHandle` | Resolve channel handle to metadata | `GET /channel/handle/:handle` |
| `getChannelByUsername` | Resolve username to channel data | `GET /channel/username/:username` |
| `getChannelById` | Lookup channel by ID | `GET /channel/id/:id` |
| `getChannelWithTrailer` | Channel metadata + featured video (single call) | `GET /channel/handle/:handle?includeTrailer=true` |
| `fetchVideosOptimized` | Client-side video fetching with early stop | (proxied YouTube API) |
| **`fetchCompareVideos`** | **Fetch channel videos + pre-computed metrics (NEW)** | **`POST /compare/videos`** |
| `fetchPlaylistItems` | Get playlist item list | `GET /playlist-items/:playlistId` |
| `getChannelPlaylists` | Get channel's playlists | `GET /playlists/:channelId` |

**`fetchCompareVideos(playlistId, startDate?, endDate?)`** calls the backend `POST /compare/videos` endpoint which:
1. Paginates through the channel's uploads playlist (up to 200 videos)
2. Enriches each video with statistics (views, likes, comments)
3. Pre-computes analytics metrics on the server
4. Caches the result in Redis (1-hour TTL, shared across all users)
5. Returns `{ videos: VideoMetadata[], channelTitle: string | null, metrics: CompareMetrics | null }`

The frontend uses the backend's pre-computed metrics when available, falling back to client-side `calculateMetrics()` if the backend call fails. This is part of the Compare page's two-tier caching strategy (backend Redis + frontend localStorage).

Sources: [frontend/src/services/youtubeService.ts#19-198](../../frontend/src/services/youtubeService.ts)

___

## AnalyticsService

`AnalyticsService` is responsible for fetching time-series data and aggregated reports. It is optimized for performance through request deduplication and heavy caching.

### Request Deduplication (In-Flight Map)

To prevent "waterfall" requests or redundant calls when multiple components mount simultaneously, `AnalyticsService` uses static `Map` objects to track pending promises.

-   `inFlightReports`: Tracks generic report requests [frontend/src/services/analyticsService.ts#77](../../frontend/src/services/analyticsService.ts)
-   `inFlightBundles`: Tracks `getDashboardBundle` calls [frontend/src/services/analyticsService.ts#78](../../frontend/src/services/analyticsService.ts)
-   `withInFlightTimeout`: A wrapper that ensures a hanging network request doesn't permanently block subsequent calls by timing out after 30 seconds [frontend/src/services/analyticsService.ts#52-71](../../frontend/src/services/analyticsService.ts)

### Analytics Methods

-   getDashboardBundle: Fetches a comprehensive snapshot including current/previous periods and d7/d30/d90 comparisons. It utilizes `parseDashboardBundleResponse` for validation [frontend/src/services/analyticsService.ts#258-335](../../frontend/src/services/analyticsService.ts)
-   getDimensionsBundle: Fetches demographic and traffic source data (gender, age, country, device type) [frontend/src/services/analyticsService.ts#337-375](../../frontend/src/services/analyticsService.ts)
-   getReport: The low-level engine for custom analytics queries. It normalizes filters (e.g., sorting video IDs) to ensure stable cache keys [frontend/src/services/analyticsService.ts#132-190](../../frontend/src/services/analyticsService.ts)

Sources: [frontend/src/services/analyticsService.ts#73-375](../../frontend/src/services/analyticsService.ts) [frontend/src/utils/apiResponseSchemas.ts#32-41](../../frontend/src/utils/apiResponseSchemas.ts)

___

## Client-Side Caching & Validation

The system employs a strict validation-on-read strategy using Zod schemas to ensure frontend stability.

### analyticsCache

A utility layer for `localStorage` that manages data persistence.

-   Cache Key Generation: `buildCacheKey` creates deterministic strings based on query parameters (metrics, dimensions, filters, etc.) [frontend/src/services/analyticsService.ts#145-154](../../frontend/src/services/analyticsService.ts)
-   Automatic Invalidation: The cache can be cleared globally via `clearAnalyticsCache` [frontend/src/services/analyticsCache.ts#1](../../frontend/src/services/analyticsCache.ts)
-   Manual Invalidation: The dashboard refresh button calls `clearAnalyticsCache()` followed by React Query `refetch()` calls to force fresh YouTube API data — used as an intentional "pay quota for fresh results" action [frontend/src/pages/DashboardPage.tsx#1757-1762](../../frontend/src/pages/dashboard/DashboardPage.tsx)

### Schema Validation (`apiResponseSchemas.ts`)

Before data reaches the `dashboardStore`, it is passed through Zod parsers:

-   `analyticsReportSchema`: Validates the structure of YouTube Analytics API responses (columnHeaders and rows) [frontend/src/utils/apiResponseSchemas.ts#10-14](../../frontend/src/utils/apiResponseSchemas.ts)
-   `dashboardBundleResponseSchema`: Ensures the complex multi-period bundle matches the expected interface [frontend/src/utils/apiResponseSchemas.ts#32-41](../../frontend/src/utils/apiResponseSchemas.ts)

Entity Mapping: API to Code

Sources: [frontend/src/utils/apiResponseSchemas.ts#1-126](../../frontend/src/utils/apiResponseSchemas.ts) [frontend/src/services/analyticsService.ts#73-85](../../frontend/src/services/analyticsService.ts) [frontend/src/services/youtubeService.ts#19-28](../../frontend/src/services/youtubeService.ts)

___

## API Client Utilities

### authHeaders.ts

This utility manages the injection of Firebase Authentication tokens.

-   `getFirebaseAuthHeader`: Retrieves the current Firebase ID token. If the token is expired or missing, it returns an empty object to allow the backend to handle the unauthorized response [frontend/src/services/authHeaders.ts#1-15](../../frontend/src/services/authHeaders.ts)

### apiBase.ts

Resolves the backend URL based on the environment.

-   `getResolvedApiBaseUrl`: Prioritizes `VITE_API_URL` from environment variables, falling back to a relative `/api` path for production Nginx deployments [frontend/src/utils/apiBase.ts#1-10](../../frontend/src/utils/apiBase.ts)

### UsageLimitError

A custom error class used to propagate quota exhaustion from the API to the UI. It carries the specific `limit`, `used` count, and `pageKey` (e.g., 'dashboard', 'channel') to allow the `FeatureGuard` component to display relevant upsell messaging [frontend/src/services/analyticsService.ts#34-46](../../frontend/src/services/analyticsService.ts)

### `checkCompareQuota()` (Compare page)

The Compare page enforces its quota by calling `checkCompareQuota()` at the **start** of every comparison, before any channel-resolution API calls [frontend/src/components/Compare.tsx#25-54](../../frontend/src/components/Compare.tsx). It sends a synchronous `POST /api/usage/track` to the backend. On `429 LIMIT_EXCEEDED` it throws a `UsageLimitError` (stopping the comparison); on `200` it returns `true` (quota already consumed). Any other error fails open so transient issues do not block the comparison.

Sources: [frontend/src/services/authHeaders.ts#1-15](../../frontend/src/services/authHeaders.ts) [frontend/src/utils/apiBase.ts#1-10](../../frontend/src/utils/apiBase.ts) [frontend/src/services/analyticsService.ts#34-46](../../frontend/src/services/analyticsService.ts)
## Analytics Data Fetching & Query Hooks

Relevant source files

-   [frontend/src/hooks/queries/useAnalyticsQuery.ts](../../frontend/src/hooks/queries/useAnalyticsQuery.ts)
-   [frontend/src/hooks/queries/useChannelAnalyticsQuery.ts](../../frontend/src/hooks/queries/useChannelAnalyticsQuery.ts)
-   [frontend/src/hooks/queries/useChannelTabQuery.ts](../../frontend/src/hooks/queries/useChannelTabQuery.ts)
-   [frontend/src/hooks/queries/useDimensionsQuery.ts](../../frontend/src/hooks/queries/useDimensionsQuery.ts)
-   [frontend/src/hooks/queries/useInsightsTabQuery.ts](../../frontend/src/hooks/queries/useInsightsTabQuery.ts)
-   [frontend/src/hooks/useDashboardAnalytics.ts](../../frontend/src/hooks/useDashboardAnalytics.ts)
-   [frontend/src/services/analyticsService.ts](../../frontend/src/services/analyticsService.ts)
-   [frontend/src/utils/analyticsFilter.ts](../../frontend/src/utils/analyticsFilter.ts)
-   [frontend/src/utils/dashboardUtils.ts](../../frontend/src/utils/dashboardUtils.ts)
-   [frontend/src/utils/resolveVideoAnomalyInsights.ts](../../frontend/src/utils/resolveVideoAnomalyInsights.ts)

This page documents the analytics data pipeline in RevTube, focusing on the transition from the legacy `useDashboardAnalytics` hook to a modern, React Query-based architecture. The system manages complex data fetching for channel-level, video-level, and playlist-level metrics, including multi-period comparisons and anomaly detection.

## Analytics Data Flow

The analytics pipeline follows a "Bundle" pattern where the frontend requests aggregated data packages to minimize network round-trips. Data is fetched via `AnalyticsService`, cached in a client-side LRU cache, and synchronized with the global `dashboardStore`.

### High-Level Data Flow Diagram

This diagram bridges the Natural Language Space of "User Interactions" to the Code Entity Space of "Query Hooks" and "Services".

Sources: [frontend/src/hooks/queries/useAnalyticsQuery.ts#44-161](../../frontend/src/hooks/queries/useAnalyticsQuery.ts) [frontend/src/hooks/queries/useDimensionsQuery.ts#40-153](../../frontend/src/hooks/queries/useDimensionsQuery.ts) [frontend/src/services/analyticsService.ts#132-230](../../frontend/src/services/analyticsService.ts)

## Core Query Hooks

The system utilizes four primary hooks to manage different dashboard tabs. Each hook is responsible for updating specific slices of the `useDashboardStore`.

### 1\. useAnalyticsQuery

Used primarily for the Video Analytics and Playlist Analytics tabs. It fetches a dashboard bundle containing chart data, totals, and comparison metrics [frontend/src/hooks/queries/useAnalyticsQuery.ts#44-60](../../frontend/src/hooks/queries/useAnalyticsQuery.ts)

-   Filter Logic: It dynamically builds filters using the `video==` or `playlist==` syntax based on the `activeTab` and current selection [frontend/src/hooks/queries/useAnalyticsQuery.ts#85-100](../../frontend/src/hooks/queries/useAnalyticsQuery.ts)
-   Insight Enrichment: After fetching the bundle, it triggers `resolveVideoAnomalyInsights` to detect spikes or dips in the data [frontend/src/hooks/queries/useAnalyticsQuery.ts#19](../../frontend/src/hooks/queries/useAnalyticsQuery.ts)
-   Prefetching: Implements an optimization that prefetches bundles for subsets of selected videos to ensure smooth transitions when unchecking items in the video table [frontend/src/hooks/queries/useAnalyticsQuery.ts#163-196](../../frontend/src/hooks/queries/useAnalyticsQuery.ts)

### 2\. useChannelTabQuery

Handles the Channel Analytics tab. Unlike the video-specific query, this hook manually calculates multi-period windows (d7, d30, d90) by making parallel requests to `svc.getReport` [frontend/src/hooks/queries/useChannelTabQuery.ts#127-167](../../frontend/src/hooks/queries/useChannelTabQuery.ts)

-   True Delta Calculation: Adjusts the date ranges if `trueDeltaEnabled` is active, shifting the "current" window to exclude the most recent (often incomplete) 2-3 days of YouTube data [frontend/src/hooks/queries/useChannelTabQuery.ts#115-125](../../frontend/src/hooks/queries/useChannelTabQuery.ts)

-   `onPersistLatestDate` callback: An optional callback that persists the server-resolved `latestDate` from the channel tab response back into the dashboard store via `saveLatestDataDate`. This ensures subsequent tab queries (insights, audience) use the most recent date anchor returned by the server rather than potentially stale local date data. The callback is invoked only when the returned `latestDate` differs from the current store value to avoid unnecessary writes [frontend/src/pages/DashboardPage.tsx#363](../../frontend/src/pages/dashboard/DashboardPage.tsx).

### 3\. useDimensionsQuery

Fetches demographic and traffic source data via `getDimensionsBundle` [frontend/src/hooks/queries/useDimensionsQuery.ts#40-48](../../frontend/src/hooks/queries/useDimensionsQuery.ts) It requests three pairs of windows (current vs. previous) for 7, 30, and 90 days [frontend/src/hooks/queries/useDimensionsQuery.ts#116-146](../../frontend/src/hooks/queries/useDimensionsQuery.ts)

### 4\. useInsightsTabQuery

Fetches insights data (Best Time to Post + Audience Retention by hour) from `POST /dashboard/tab/insights` -- a single combined endpoint that consumes one quota unit per tab switch [frontend/src/hooks/queries/useInsightsTabQuery.ts#1-4](../../frontend/src/hooks/queries/useInsightsTabQuery.ts).

-   **Query key**: `[REVTUBE_DASHBOARD_WS_ROOT, workspaceKey, 'insights', channelId, period, startDate, endDate, latestDataDate]` -- uses the same workspace scoping / org context pattern as other tab hooks [frontend/src/hooks/queries/useInsightsTabQuery.ts#60-69](../../frontend/src/hooks/queries/useInsightsTabQuery.ts).
-   **Enabled condition**: Only fires when a channel is selected, user is authenticated, and `activeTab === "insights"` [frontend/src/pages/DashboardPage.tsx#412-413](../../frontend/src/pages/dashboard/DashboardPage.tsx).
-   **Stale / gc time**: 5 minutes stale time, 10 minutes gc time (matching other tab hooks).
-   **Retries**: 2 retries with `suppressGlobalErrorToast: true` in query meta [frontend/src/hooks/queries/useInsightsTabQuery.ts#128-132](../../frontend/src/hooks/queries/useInsightsTabQuery.ts).
-   **Response fields**: Returns `bestTimeToPost` (YT API fallback), `bestTimeToPostV2` (DB-powered primary), `retention`, and `retentionByPublishHour`. The DB-powered analysis loads per-video data from Postgres using rolling median normalization (W=10), winsorized z-score composites (0.6x viewsZ + 0.4x likeRateZ), three tracked per-metric z-scores (views, engagement via like-rate, comments via comment-rate), empirical-Bayes shrinkage (k=4), bootstrap CIs (2000 resamples), and Kruskal-Wallis significance testing — zero YT API quota consumed for the core analysis. The primary bucketing is hourly (24 buckets, 0-23), with per-metric best hour labels (`bestHourForViews`, `bestHourForEngagement`, `bestHourForComments`) that identify the peak hour for each individual metric.
-   **Stored fields**: On success it calls `setAnalyticsData` with `insightsData` (containing `bestTimeToPost`, `bestTimeToPostV2`, `retention`, `retentionByPublishHour`) and `loadingInsights: false`. On loading it sets `loadingInsights: true` [frontend/src/hooks/queries/useInsightsTabQuery.ts#134-149](../../frontend/src/hooks/queries/useInsightsTabQuery.ts).
-   **Usage limit error handling**: On a 429 `LIMIT_EXCEEDED` response, it throws a `UsageLimitError` which is caught in the effect and stored as `usageError` in the analytics state (rather than setting a generic error) [frontend/src/hooks/queries/useInsightsTabQuery.ts#158-168](../../frontend/src/hooks/queries/useInsightsTabQuery.ts).
-   **Date context**: Uses `latestDataDate` (persisted from the channel tab via `onPersistLatestDate`) and optional custom date range from the dashboard store, sending them as `latestDate` / `startDate` / `endDate` in the request body [frontend/src/hooks/queries/useInsightsTabQuery.ts#88-96](../../frontend/src/hooks/queries/useInsightsTabQuery.ts).

Sources: [frontend/src/hooks/queries/useAnalyticsQuery.ts#1-20](../../frontend/src/hooks/queries/useAnalyticsQuery.ts) [frontend/src/hooks/queries/useChannelTabQuery.ts#1-10](../../frontend/src/hooks/queries/useChannelTabQuery.ts) [frontend/src/hooks/queries/useDimensionsQuery.ts#1-11](../../frontend/src/hooks/queries/useDimensionsQuery.ts) [frontend/src/hooks/queries/useInsightsTabQuery.ts#1-28](../../frontend/src/hooks/queries/useInsightsTabQuery.ts)

## Implementation Details

### The Bundle Pattern

The `AnalyticsService` provides a `getDashboardBundle` method. This server-side (or client-simulated) pattern allows fetching multiple logical reports (e.g., daily chart rows + total metrics) in a single HTTP request [frontend/src/services/analyticsService.ts#232-250](../../frontend/src/services/analyticsService.ts)

### Multi-Period Stats & True Delta

The system calculates "Pills" (d7/d30/d90) by comparing the current period against the immediately preceding period of the same length.

### Anomaly Detection (`resolveVideoAnomalyInsights`)

This utility analyzes the daily views series to find statistical outliers.

1.  Calculate Deltas: Computes the difference in views between consecutive days [frontend/src/utils/resolveVideoAnomalyInsights.ts#44-49](../../frontend/src/utils/resolveVideoAnomalyInsights.ts)
2.  Standard Deviation: Calculates the standard deviation of deltas to set an `anomalyThreshold` [frontend/src/utils/resolveVideoAnomalyInsights.ts#50-57](../../frontend/src/utils/resolveVideoAnomalyInsights.ts)
3.  Attribution: For detected spikes, it makes an additional `day,video` dimensioned query to identify which specific video drove the change [frontend/src/utils/resolveVideoAnomalyInsights.ts#83-103](../../frontend/src/utils/resolveVideoAnomalyInsights.ts)

Sources: [frontend/src/utils/resolveVideoAnomalyInsights.ts#16-25](../../frontend/src/utils/resolveVideoAnomalyInsights.ts) [frontend/src/hooks/useDashboardAnalytics.ts#77-86](../../frontend/src/hooks/useDashboardAnalytics.ts)

## Caching & Request Deduplication

RevTube employs a multi-layered caching strategy to handle the high volume of analytics requests.

### Request Pipeline Diagram

This diagram shows how `AnalyticsService` interacts with local caches and handles in-flight requests.

Sources: [frontend/src/services/analyticsService.ts#145-162](../../frontend/src/services/analyticsService.ts) [frontend/src/services/analyticsService.ts#48-71](../../frontend/src/services/analyticsService.ts)

### Key Mechanisms

-   In-Flight Deduplication: `AnalyticsService` uses static `Map` objects (`inFlightReports`, `inFlightBundles`) to store promises for active requests. If two components request the same data simultaneously, they share the same promise [frontend/src/services/analyticsService.ts#77-80](../../frontend/src/services/analyticsService.ts)
-   Timeout Wrapper: `withInFlightTimeout` ensures that stalled network requests do not permanently block the deduplication map [frontend/src/services/analyticsService.ts#52-71](../../frontend/src/services/analyticsService.ts)
-   React Query Integration: Hooks use `staleTime` (5-10 mins) and `gcTime` to manage memory-level caching, while `analyticsCache` provides persistent storage across sessions [frontend/src/hooks/queries/useAnalyticsQuery.ts#156-157](../../frontend/src/hooks/queries/useAnalyticsQuery.ts)

## Manual Cache Invalidation (Refresh Button)

The dashboard toolbar includes an icon-only refresh button that provides an **explicit user-driven cache invalidation** mechanism [frontend/src/pages/DashboardPage.tsx#1754-1776](../../frontend/src/pages/dashboard/DashboardPage.tsx):

1. **Clears all analytics caches**: Calls `clearAnalyticsCache()` from `analyticsCache.ts`, which purges both the in-memory LRU `Map` and all `yt_analytics_cache:*` keys in `sessionStorage` [frontend/src/services/analyticsCache.ts#79-82](../../frontend/src/services/analyticsCache.ts).

2. **Triggers React Query refetches**: `refetchVideos()`, `refetchPlaylists()`, and `refetchAnalytics()` force fresh queries. Since the analytics cache is cleared first, all subsequent `getDashboardBundle` and `getReport` calls miss their cache layer and make real YouTube Analytics API calls — consuming quota as reported by the backend's `_usage` response field.

3. **Use case**: Normal tab switches read from the 24-hour analytics cache (no quota consumed). The refresh button is the only way to force fresh data from YouTube without waiting for cache TTL expiry.

Sources: [frontend/src/pages/DashboardPage.tsx#1754-1776](../../frontend/src/pages/dashboard/DashboardPage.tsx) [frontend/src/services/analyticsCache.ts#1-82](../../frontend/src/services/analyticsCache.ts)
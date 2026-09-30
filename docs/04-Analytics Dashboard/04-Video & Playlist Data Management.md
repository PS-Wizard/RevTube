## Video & Playlist Data Management

Relevant source files

-   [frontend/src/components/AddListModal.tsx](../../frontend/src/components/AddListModal.tsx)
-   [frontend/src/components/dashboard/EditListModal.tsx](../../frontend/src/components/dashboard/EditListModal.tsx)
-   [frontend/src/components/dashboard/SavedListsPanel.tsx](../../frontend/src/components/dashboard/SavedListsPanel.tsx)
-   [frontend/src/hooks/useDashboardFullListsData.ts](../../frontend/src/hooks/useDashboardFullListsData.ts)
-   [frontend/src/hooks/useDashboardLists.ts](../../frontend/src/hooks/useDashboardLists.ts)
-   [frontend/src/hooks/useDashboardPlaylistViews.ts](../../frontend/src/hooks/useDashboardPlaylistViews.ts)
-   [frontend/src/hooks/useDashboardSelection.ts](../../frontend/src/hooks/useDashboardSelection.ts)
-   [frontend/src/hooks/useDashboardVideos.ts](../../frontend/src/hooks/useDashboardVideos.ts)
-   [frontend/src/services/organizationListService.ts](../../frontend/src/services/organizationListService.ts)

The Video & Playlist Data Management system handles the retrieval, filtering, and selection of content assets within the analytics dashboard. It manages the lifecycle of video metadata, implements fallback pipelines for playlist-specific analytics, and provides a robust "Saved Lists" system for multi-video tracking and performance benchmarking.

## 1\. Video Metadata & Enrichment

The `useDashboardVideos` hook is the primary engine for managing video data. It orchestrates metadata fetching from the YouTube Data API and integrates with the dashboard's filtering state.

### Implementation Details

-   Metadata Fetching: Uses `YouTubeService.fetchChannelVideos` to retrieve video details (titles, thumbnails, published dates) [frontend/src/hooks/useDashboardVideos.ts#199-210](../../frontend/src/hooks/useDashboardVideos.ts)
-   Trend Enrichment: For the active video set, it calls `AnalyticsService.getDashboardBundle` to enrich metadata with performance metrics like `trend` (view growth) and `retention` scores [frontend/src/hooks/useDashboardVideos.ts#250-265](../../frontend/src/hooks/useDashboardVideos.ts)
-   Persistence: Video limits (e.g., loading the top 10, 50, or "all" videos) are persisted to `localStorage` on a per-channel basis [frontend/src/hooks/useDashboardVideos.ts#48-96](../../frontend/src/hooks/useDashboardVideos.ts)
-   Filtering: Implements `getVideosByActiveFilters` to apply client-side logic for search queries, video types (Shorts vs. Long-form), and playlist membership [frontend/src/hooks/useDashboardVideos.ts#7-10](../../frontend/src/hooks/useDashboardVideos.ts)

### Video Data Flow

The following diagram illustrates how video data is fetched, cached in `sessionStorage`, and enriched with analytics.

Diagram: Video Metadata & Analytics Enrichment

Sources: [frontend/src/hooks/useDashboardVideos.ts#48-63](../../frontend/src/hooks/useDashboardVideos.ts) [frontend/src/hooks/useDashboardVideos.ts#144-180](../../frontend/src/hooks/useDashboardVideos.ts) [frontend/src/hooks/useDashboardVideos.ts#192-210](../../frontend/src/hooks/useDashboardVideos.ts)

___

## 2\. Playlist Analytics Pipeline

Because the standard YouTube Analytics "bundle" is video-centric, the system employs a dedicated fallback pipeline for playlist-level metrics via `useDashboardPlaylistViews`.

### Metric Resolution

The hook populates two primary metrics for each playlist:

1.  periodViewCount: Maps to `playlistViews` (or `playlistStarts` as a fallback) representing the number of times the playlist container was viewed [frontend/src/hooks/useDashboardPlaylistViews.ts#40-44](../../frontend/src/hooks/useDashboardPlaylistViews.ts)
2.  videoPeriodViewCount: Maps to `views`, representing the total views of all videos accumulated _while_ being watched within that playlist [frontend/src/hooks/useDashboardPlaylistViews.ts#46-48](../../frontend/src/hooks/useDashboardPlaylistViews.ts)

### Quota-Optimized Batch Fetching

To minimize YouTube Analytics API quota consumption, the hook uses a **two-tier fetch strategy**:

1. **Top Playlists Report** (always): Fetches up to 200 playlists sorted by `-playlistViews`, extracting period view counts for the most-visible playlists in a single API call [frontend/src/hooks/useDashboardPlaylistViews.ts#111-121](../../frontend/src/hooks/useDashboardPlaylistViews.ts).

2. **Missing Playlists Batch** (conditional): Any playlists in the dashboard store that weren't returned by the top report are fetched in a **single batched API call** using `filters: playlist==id1,id2,...,idN` with `dimensions: 'playlist'` [frontend/src/hooks/useDashboardPlaylistViews.ts#140-153](../../frontend/src/hooks/useDashboardPlaylistViews.ts). This replaces the previous approach that made N individual per-playlist calls (chunked by 8 in parallel), reducing quota from ~20 calls to exactly **1 API call** per Playlists tab click.

3. **Per-Playlist Fallback** (error recovery): If the batch call fails (e.g. too many IDs for the YouTube Analytics API filter), the hook falls back to individual per-playlist calls with `dimensions: 'day'`, summing the daily rows to produce totals [frontend/src/hooks/useDashboardPlaylistViews.ts#154-189](../../frontend/src/hooks/useDashboardPlaylistViews.ts).

### Channel ID Fallback

If a request for a specific `channelId` fails, the service attempts a fallback to `channel==MINE` to ensure data availability for the authenticated user [frontend/src/hooks/useDashboardPlaylistViews.ts#122-133](../../frontend/src/hooks/useDashboardPlaylistViews.ts).

Sources: [frontend/src/hooks/useDashboardPlaylistViews.ts#1-8](../../frontend/src/hooks/useDashboardPlaylistViews.ts) [frontend/src/hooks/useDashboardPlaylistViews.ts#107-189](../../frontend/src/hooks/useDashboardPlaylistViews.ts)

___

## 3\. Selection & Scoping Logic

The `useDashboardSelection` hook manages which videos or playlists are currently "active" for the analytics charts and reports.

### Auto-Scope Signature

To prevent infinite update loops while maintaining reactive selection, the hook uses an `autoScopeSig`. This signature is a serialized string of all factors affecting selection: `activeTab :: activeListIds :: filterSettings :: filteredVideoIds` [frontend/src/hooks/useDashboardSelection.ts#32-42](../../frontend/src/hooks/useDashboardSelection.ts)

### Key Features

-   Sentinel Value (`XX_NONE_XX_`): When filters result in zero matches, the system uses this sentinel in `selectedVideoIds` to explicitly signal an empty state to the `AnalyticsService`, preventing it from defaulting to a channel-wide query [frontend/src/hooks/useDashboardSelection.ts#98-100](../../frontend/src/hooks/useDashboardSelection.ts)
-   Table Checked Override: When a user manually toggles a checkbox in the `VideoTable`, `tableCheckedOverride` is set. This prevents the `autoScope` logic from overwriting manual user choices until the underlying data scope (the signature) changes [frontend/src/hooks/useDashboardSelection.ts#54-60](../../frontend/src/hooks/useDashboardSelection.ts)
-   Selection Limits: Limits bulk selection to 50 videos for general queries, but extends to 200 videos when a `SavedList` is active, matching the YouTube Analytics API batch limit [frontend/src/hooks/useDashboardSelection.ts#86-89](../../frontend/src/hooks/useDashboardSelection.ts)

Sources: [frontend/src/hooks/useDashboardSelection.ts#30-42](../../frontend/src/hooks/useDashboardSelection.ts) [frontend/src/hooks/useDashboardSelection.ts#54-60](../../frontend/src/hooks/useDashboardSelection.ts) [frontend/src/hooks/useDashboardSelection.ts#86-100](../../frontend/src/hooks/useDashboardSelection.ts)

___

## 4\. Saved Lists System

Saved Lists allow users to group specific videos or playlists for persistent tracking across sessions. Lists can be stored in a personal context or shared within an organization.

### Data Model

Lists are defined by the `SavedList` interface, which includes:

-   `listType`: Either `'video'` or `'playlist'` [frontend/src/hooks/useDashboardLists.ts#115](../../frontend/src/hooks/useDashboardLists.ts)
-   `trackDate`: A reference date for optimizations or campaigns [frontend/src/hooks/useDashboardLists.ts#118](../../frontend/src/hooks/useDashboardLists.ts)
-   `annotations`: A collection of date-labeled events (e.g., "Thumbnail Change") that appear on analytics charts [frontend/src/hooks/useDashboardLists.ts#120](../../frontend/src/hooks/useDashboardLists.ts)

### Storage & Synchronization

The system uses a dual-service approach for persistence:

-   Personal: `savedListService.ts` handles Firestore operations in the user's private collection [frontend/src/hooks/useDashboardLists.ts#16](../../frontend/src/hooks/useDashboardLists.ts)
-   Organization: `organizationListService.ts` handles shared lists within an organization's subcollection [frontend/src/services/organizationListService.ts#23-37](../../frontend/src/services/organizationListService.ts)

### Multi-List Charting

The `useDashboardFullListsData` hook provides the data layer for the "Multi-List Chart." It fetches daily time-series metrics (`views`, `estimatedMinutesWatched`) for all videos contained within the currently active lists, allowing for aggregated performance overlays [frontend/src/hooks/useDashboardFullListsData.ts#75-109](../../frontend/src/hooks/useDashboardFullListsData.ts)

Diagram: Saved List Entity Mapping

Sources: [frontend/src/hooks/useDashboardLists.ts#112-125](../../frontend/src/hooks/useDashboardLists.ts) [frontend/src/services/organizationListService.ts#17-44](../../frontend/src/services/organizationListService.ts) [frontend/src/components/dashboard/SavedListsPanel.tsx#65-82](../../frontend/src/components/dashboard/SavedListsPanel.tsx)

### Modal Interfaces

-   AddListModal: Handles bulk ID extraction from URLs, CSVs, or text blobs using regex patterns for both videos and playlists [frontend/src/components/AddListModal.tsx#26-50](../../frontend/src/components/AddListModal.tsx)
-   EditListModal: Allows modification of list metadata, management of annotations, and provides export functionality to CSV [frontend/src/components/dashboard/EditListModal.tsx#86-121](../../frontend/src/components/dashboard/EditListModal.tsx)

Sources: [frontend/src/components/AddListModal.tsx#26-55](../../frontend/src/components/AddListModal.tsx) [frontend/src/components/dashboard/EditListModal.tsx#64-67](../../frontend/src/components/dashboard/EditListModal.tsx)
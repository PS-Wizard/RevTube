## Videos & Playlist Browser

Relevant source files

-   [frontend/src/components/VideoTable.tsx](../../frontend/src/components/VideoTable.tsx)
-   [frontend/src/components/dashboard/PlaylistTable.tsx](../../frontend/src/components/dashboard/PlaylistTable.tsx)
-   [frontend/src/pages/PlaylistPage.tsx](../../frontend/src/pages/playlist/PlaylistPage.tsx)
-   [frontend/src/pages/VideosPage.tsx](../../frontend/src/pages/videos/VideosPage.tsx)
-   [frontend/src/services/youtubeService.ts](../../frontend/src/services/youtubeService.ts)

The Videos and Playlist Browser provides standalone interfaces for discovering and filtering YouTube content outside the main analytics dashboard. These pages leverage the `YouTubeService` to resolve identifiers (handles, channel IDs, playlist IDs) and perform batch metadata fetching with client-side caching.

## Videos Page Implementation

The `VideosPage` is designed to browse all videos from a specific channel by resolving its "Uploads" playlist. It supports deep-linking via URL parameters and persists session state to `localStorage`.

### Data Flow and Fetch Modes

When a user provides a channel input (URL, handle, or ID), the system executes a multi-step resolution pipeline:

1.  Resolution: The `extractIdFromUrl` helper [frontend/src/pages/VideosPage.tsx#164-211](../../frontend/src/pages/videos/VideosPage.tsx) identifies the input type. If it's a handle or URL, it calls `YouTubeService.getUploadsPlaylistFromHandle` [frontend/src/services/youtubeService.ts#152-191](../../frontend/src/services/youtubeService.ts) or `getChannelById` [frontend/src/services/youtubeService.ts#101-150](../../frontend/src/services/youtubeService.ts)
2.  Fetch Modes:
    -   Partial: Fetches a specific number of videos defined by `maxResults` [frontend/src/pages/VideosPage.tsx#96](../../frontend/src/pages/videos/VideosPage.tsx)
    -   Fetch All: Recursively fetches all pages of the playlist using `YouTubeService.getPlaylistVideos` [frontend/src/pages/VideosPage.tsx#327-345](../../frontend/src/pages/videos/VideosPage.tsx)
3.  Parallel Mapping: If "Filter by Playlists" is enabled, the page fetches all playlists for the channel and maps videos to their parent playlists in parallel [frontend/src/pages/VideosPage.tsx#347-368](../../frontend/src/pages/videos/VideosPage.tsx)

### Video Source Mapping Diagram

This diagram illustrates how the `VideosPage` maps raw YouTube API responses into the `VideoWithSource` entity used by the UI.

Sources: [frontend/src/pages/VideosPage.tsx#24-26](../../frontend/src/pages/videos/VideosPage.tsx) [frontend/src/pages/VideosPage.tsx#313-370](../../frontend/src/pages/videos/VideosPage.tsx) [frontend/src/services/youtubeService.ts#152-191](../../frontend/src/services/youtubeService.ts)

### Persistence and Export

-   Caching: Data is cached in `localStorage` under `videos_page_cache_[input]` for 24 hours [frontend/src/pages/VideosPage.tsx#19-21](../../frontend/src/pages/videos/VideosPage.tsx)
-   **Org-Scoped Caching**: When the user is in an organization context, cache keys are suffixed with `::org:{orgId}` to create independent namespaces per org. Switching between org and personal mode does not leak stale cached data between contexts [frontend/src/pages/VideosPage.tsx#38-83](../../frontend/src/pages/videos/VideosPage.tsx).
-   Web Share API: The `handleShare` function utilizes the browser's native sharing capabilities to export the current view [frontend/src/pages/VideosPage.tsx#497-513](../../frontend/src/pages/videos/VideosPage.tsx)
-   CSV Export: Uses `generateCSVContent` to transform the filtered table state into a downloadable file [frontend/src/pages/VideosPage.tsx#476-495](../../frontend/src/pages/videos/VideosPage.tsx)

Sources: [frontend/src/pages/VideosPage.tsx#37-80](../../frontend/src/pages/videos/VideosPage.tsx) [frontend/src/pages/VideosPage.tsx#476-513](../../frontend/src/pages/videos/VideosPage.tsx)

___

## Playlist Page Implementation

The `PlaylistPage` offers "Smart Input Detection," allowing users to toggle between browsing a specific playlist's contents or browsing all playlists owned by a channel.

### Smart Input Detection

The `detectInputType` function [frontend/src/pages/PlaylistPage.tsx#64-70](../../frontend/src/pages/playlist/PlaylistPage.tsx) uses regex and prefix matching to determine if an input is a Playlist ID (starting with `PL`, `FL`, etc.) or a Channel handle.

### Playlist Resolution Logic

When a channel is detected, the page enters a "Browse Playlists" mode:

1.  Calls `YouTubeService.getChannelPlaylists` [frontend/src/pages/PlaylistPage.tsx#216](../../frontend/src/pages/playlist/PlaylistPage.tsx)
2.  Renders a grid of playlist cards or a `PlaylistTable` [frontend/src/components/dashboard/PlaylistTable.tsx#29-37](../../frontend/src/components/dashboard/PlaylistTable.tsx)
3.  Selecting a playlist triggers `loadPlaylistVideos`, which resolves the specific metadata and video items for that list [frontend/src/pages/PlaylistPage.tsx#170-205](../../frontend/src/pages/playlist/PlaylistPage.tsx)

### Playlist Browsing Flow

Like the VideosPage, the PlaylistPage uses **org-scoped localStorage cache keys** — when an organization context is active, the `::org:{orgId}` suffix is appended to all cache key names (`playlist_page_cache_`, `playlist_page_last_session`). This isolates playlist data between org and personal contexts [frontend/src/pages/PlaylistPage.tsx#35-73](../../frontend/src/pages/playlist/PlaylistPage.tsx).

Sources: [frontend/src/pages/PlaylistPage.tsx#64-70](../../frontend/src/pages/playlist/PlaylistPage.tsx) [frontend/src/pages/PlaylistPage.tsx#170-210](../../frontend/src/pages/playlist/PlaylistPage.tsx) [frontend/src/services/youtubeService.ts#335-375](../../frontend/src/services/youtubeService.ts)

___

## Shared UI Components

Both pages rely on specialized table components to handle large datasets and complex filtering.

### VideoTable Component

The `VideoTable` [frontend/src/components/VideoTable.tsx#75-112](../../frontend/src/components/VideoTable.tsx) is a highly configurable wrapper around `@tanstack/react-table`.

-   Virtualization: Uses `@tanstack/react-virtual` for high-performance rendering of hundreds of rows [frontend/src/components/VideoTable.tsx#14](../../frontend/src/components/VideoTable.tsx)
-   Client-Side Filtering: Implements an internal search that filters by title, ID, channel, and description [frontend/src/components/VideoTable.tsx#133-143](../../frontend/src/components/VideoTable.tsx)
-   Selection Management: Tracks `checkedVideoIds` to allow users to sub-select content for export or analytics [frontend/src/components/VideoTable.tsx#154-180](../../frontend/src/components/VideoTable.tsx)

### PlaylistTable Component

Used primarily in the dashboard and `PlaylistPage` to manage collections of videos.

-   Metric Toggle: Allows users to switch between `itemCount`, `periodViewCount`, and `videoPeriodViewCount` [frontend/src/components/dashboard/PlaylistTable.tsx#110-114](../../frontend/src/components/dashboard/PlaylistTable.tsx)
-   Indeterminate Checkboxes: Supports bulk selection/deselection with indeterminate states for partial selections [frontend/src/components/dashboard/PlaylistTable.tsx#128-135](../../frontend/src/components/dashboard/PlaylistTable.tsx)

Sources: [frontend/src/components/VideoTable.tsx#13-14](../../frontend/src/components/VideoTable.tsx) [frontend/src/components/VideoTable.tsx#133-143](../../frontend/src/components/VideoTable.tsx) [frontend/src/components/dashboard/PlaylistTable.tsx#58-63](../../frontend/src/components/dashboard/PlaylistTable.tsx) [frontend/src/components/dashboard/PlaylistTable.tsx#125-146](../../frontend/src/components/dashboard/PlaylistTable.tsx)
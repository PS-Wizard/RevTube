## Content Discovery Pages

Relevant source files

-   [frontend/src/pages/ChannelPage.tsx](../../frontend/src/pages/channel/ChannelPage.tsx)
-   [frontend/src/pages/PlaylistPage.tsx](../../frontend/src/pages/playlist/PlaylistPage.tsx)
-   [frontend/src/pages/ProfilePage.tsx](../../frontend/src/pages/profile/ProfilePage.tsx)
-   [frontend/src/pages/SpecificVideosPage.tsx](../../frontend/src/pages/specific-videos/SpecificVideosPage.tsx)
-   [frontend/src/pages/VideosPage.tsx](../../frontend/src/pages/videos/VideosPage.tsx)

Content Discovery Pages are standalone React components within the RevTube frontend that allow users to browse, inspect, and compare YouTube data without being tethered to a specific dashboard workspace. These pages interface directly with the `YouTubeService` to perform real-time metadata resolution and utilize client-side caching to maintain state across sessions.

### System Overview

The discovery subsystem is built around specialized pages that handle high-volume data fetching (e.g., thousands of videos in a playlist) and complex string parsing (e.g., extracting channel handles or video IDs from mixed text).

Discovery Page Data Flow

Sources: [frontend/src/pages/ChannelPage.tsx#92-138](../../frontend/src/pages/channel/ChannelPage.tsx) [frontend/src/pages/VideosPage.tsx#37-80](../../frontend/src/pages/videos/VideosPage.tsx) [frontend/src/pages/PlaylistPage.tsx#64-70](../../frontend/src/pages/playlist/PlaylistPage.tsx)

___

### Channel Inspector & Specific Videos

The Channel Inspector provides a deep dive into a single creator's presence, while the Specific Videos tool allows for batch processing of disparate video links.

-   ChannelPage: Orchestrates channel metadata retrieval. It uses `extractIdFromUrl` to normalize handles (e.g., `@username`), channel IDs (`UC...`), and legacy URLs into a queryable format [frontend/src/pages/ChannelPage.tsx#71-90](../../frontend/src/pages/channel/ChannelPage.tsx) It integrates with `recentsService` to maintain a history of inspected channels [frontend/src/pages/ChannelPage.tsx#121-126](../../frontend/src/pages/channel/ChannelPage.tsx) Cache is org-scoped — `channel_inspector_cache` keys get a `::org:{orgId}` suffix [frontend/src/pages/ChannelPage.tsx#25-47](../../frontend/src/pages/channel/ChannelPage.tsx). A `useEffect` on `[currentOrganization?.id]` reloads from the correct cache namespace on mode switch [frontend/src/pages/ChannelPage.tsx#186-194](../../frontend/src/pages/channel/ChannelPage.tsx).
-   SpecificVideosPage: Designed for bulk analysis. It features a deduplication pipeline that extracts 11-character YouTube IDs from text blobs or CSV/TXT uploads [frontend/src/pages/SpecificVideosPage.tsx#112-124](../../frontend/src/pages/specific-videos/SpecificVideosPage.tsx) It uses a batching strategy via `service.fetchVideosByIds` to minimize API overhead [frontend/src/pages/SpecificVideosPage.tsx#64-65](../../frontend/src/pages/specific-videos/SpecificVideosPage.tsx)

For details, see [Channel Inspector & Specific Videos](01-Channel Inspector & Specific Videos.md).

Sources: [frontend/src/pages/ChannelPage.tsx#1-44](../../frontend/src/pages/channel/ChannelPage.tsx) [frontend/src/pages/SpecificVideosPage.tsx#22-44](../../frontend/src/pages/specific-videos/SpecificVideosPage.tsx)

___

### Videos & Playlist Browser

These pages focus on browsing structured collections of videos, either from a channel's entire upload history or specific playlists.

-   VideosPage: Primarily used to resolve a channel's "Uploads" playlist. It supports various fetch modes and uses a `VideoWithSource` interface to track video-to-playlist relationships [frontend/src/pages/VideosPage.tsx#24-26](../../frontend/src/pages/videos/VideosPage.tsx) It leverages `localStorage` with a 24-hour TTL (`CACHE_DURATION`) to prevent redundant API calls [frontend/src/pages/VideosPage.tsx#19-21](../../frontend/src/pages/videos/VideosPage.tsx)
-   PlaylistPage: Features "Smart Input" detection which automatically distinguishes between a Playlist ID/URL and a Channel handle [frontend/src/pages/PlaylistPage.tsx#64-70](../../frontend/src/pages/playlist/PlaylistPage.tsx) It allows users to browse all playlists owned by a channel and then drill down into specific video lists.

For details, see [Videos & Playlist Browser](02-Videos & Playlist Browser.md).

Sources: [frontend/src/pages/VideosPage.tsx#90-123](../../frontend/src/pages/videos/VideosPage.tsx) [frontend/src/pages/PlaylistPage.tsx#149-168](../../frontend/src/pages/playlist/PlaylistPage.tsx)

___

### Channel Comparison Tool

The Comparison tool enables side-by-side analytics for multiple entities. It orchestrates parallel requests to fetch channel-level statistics and recent video performance.

-   Logic: Uses `handleCompare` to trigger simultaneous data fetches for multiple handles or URLs.
-   Optimization: Employs `fetchVideosOptimized` to stop fetching once enough data for a comparative baseline is established, preserving API quota.
-   Visualization: Renders multi-series charts and calculates relative engagement rates across the selected group.

For details, see [Channel Comparison Tool](03-Channel Comparison Tool.md).

___

### Common Patterns across Discovery Pages

Code Entity Mapping

Sources: [frontend/src/pages/ChannelPage.tsx#115-117](../../frontend/src/pages/channel/ChannelPage.tsx) [frontend/src/pages/VideosPage.tsx#180-185](../../frontend/src/pages/videos/VideosPage.tsx) [frontend/src/pages/PlaylistPage.tsx#170-175](../../frontend/src/pages/playlist/PlaylistPage.tsx)
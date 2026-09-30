## Channel Inspector & Specific Videos

Relevant source files

-   [frontend/src/components/AutocompleteInput.tsx](../../frontend/src/components/AutocompleteInput.tsx)
-   [frontend/src/pages/ChannelPage.tsx](../../frontend/src/pages/channel/ChannelPage.tsx)
-   [frontend/src/pages/SpecificVideosPage.tsx](../../frontend/src/pages/specific-videos/SpecificVideosPage.tsx)
-   [frontend/src/services/recentsService.ts](../../frontend/src/services/recentsService.ts)
-   [frontend/src/utils/csvExport.ts](../../frontend/src/utils/csvExport.ts)
-   [frontend/src/types/youtube.ts](../../frontend/src/types/youtube.ts)
-   [frontend/src/services/youtubeService.ts](../../frontend/src/services/youtubeService.ts)

The Channel Inspector and Specific Videos pages provide targeted discovery tools for analyzing specific entities within the YouTube ecosystem. Unlike the main dashboard, which focuses on owned or managed channels, these tools allow users to inspect public metadata for any channel or set of videos via handles, URLs, or batch file uploads.

---

## Channel Inspector (`ChannelPage`)

The `ChannelPage` component serves as a deep-dive tool for individual YouTube channels. It handles complex input parsing (URLs, handles, IDs), implements a local caching strategy to reduce redundant API calls, and integrates with the `recentsService` to provide search history.

### Input Parsing and Identification

The page uses `extractIdFromUrl` to normalize various YouTube URL formats into a queryable string (either a Channel ID or a Handle starting with `@`).

### Single-API-Call Architecture (2026-06-30)

The Channel Inspector now fetches **channel metadata + trailer video details in a single backend roundtrip** via `YouTubeService.getChannelWithTrailer()`, replacing the previous two-request pattern (`getFullChannelDetails` + `fetchVideosByIds`).

**How it works:**

1. `getChannelWithTrailer(input)` sends a request to `/channel/handle/:handle?includeTrailer=true`
2. The backend's channel route fetches the channel from YouTube API, then checks `brandingSettings.channel.unsubscribedTrailer`
3. If a trailer ID exists, the backend makes an internal YouTube Videos API call and bundles the video data as `{ channel: ..., trailerVideo: ... }`
4. The frontend parses the combined response and sets `channelDetails` + `featuredVideo` from one call

**Cache behavior**: The raw channel data is still cached server-side with the standard `yt:ch:handle:` key (4h TTL). The trailer video is fetched on every `includeTrailer=true` request (no separate cache — it's lightweight). The frontend also caches `ChannelMetadata` in `localStorage` for 24h, using org-scoped keys (`::org:{orgId}` suffix for org mode).

### Featured Video Toggle

The trailer video's description now includes a **Show more / Show less** toggle when the description exceeds 240 characters. This matches the same toggle pattern used for the main channel description.

- `isFeaturedDescExpanded` state controls truncation
- CSS class `.featured-video-description-full` clamps at 4 lines; `.expanded` removes the clamp

### Link Chips

All non-social links extracted from the channel description are now displayed as clickable **link chips** in the Channel Details section under a "Links" label (previously only the first website link was shown). This uses:

- `extractAllLinks()` from `ChannelPage.tsx` — regex-based URL extraction with dedup and social-platform classification
- `.channel-detail-link-chip` CSS — pill-shaped badges with hover effects matching the frontend design system
- The "Links" item spans the full grid width (`grid-column: 1 / -1`) via `.channel-detail-links`

Social links (Instagram, Twitter, Facebook, etc.) remain in the channel header as icon badges via `.channel-social-badge`.

### Keywords as Chips

Channel keywords from `brandingSettings.channel.keywords` are displayed as styled chips with improved design tokens:

- `.channel-detail-tag` — pill badges with `--rt-weight-medium`, `--rt-color-bg-muted` background, hover elevation effect
- Proper wrapping with `flex-wrap: wrap` and `gap: var(--rt-space-1)`
- Hover state transitions to elevated background and strong border

### Responsive Layout

The Channel Inspector now includes comprehensive responsive breakpoints:

| Breakpoint | Changes |
|------------|---------|
| ≤1024px | Stats grid 4→2 cols, intro video 2→1 col |
| ≤768px | Profile section stacks vertically, avatar shrinks to 90px, details grid gaps tighten |
| ≤640px | Stats grid tighter spacing, smaller stat values, channel details grid 2→1 col |
| ≤480px | Banner aspect ratio 4:1, avatar 72px, stat cards compact padding, link/social badges smaller |

### Implementation Details (updated)

1. **Caching**: `localStorage` via `loadCache`/`saveCache` stores `ChannelMetadata` for 24h with org-scoped keys. On cache hit from sidebar auto-load, trailer video is fetched as a lightweight background request. Cache keys are **org-scoped** — `::org:{orgId}` suffix prevents data leakage between personal and org modes. A `useEffect` on `[currentOrganization?.id]` ensures the UI reloads from the correct cache namespace immediately when the user switches contexts.

2. **Usage Limits**: Single `getChannelWithTrailer()` call consumes one unit of `channel` quota (the trailer fetch is an internal server-to-YouTube call, not billed to the user). Requests are wrapped in a try-catch block that specifically listens for `UsageLimitError`. If a user exceeds their tier quota, a `UsageLimitBanner` is displayed.

3. **Recent History**: Successful lookups trigger `saveRecentChannel`, which persists the search to Firebase Firestore under the user's profile.

4. **Featured Content**: Fetching is now part of `getChannelWithTrailer()` — no separate API call. The video's description has a collapsible toggle.

5. **Link Extraction**: `extractAllLinks()` in ChannelPage.tsx handles case-insensitive protocol matching (e.g. "Https://"), deduplicates by normalized hostname, and classifies URLs as social, website, YouTube, or other.

### Channel Discovery Data Flow

The following diagram illustrates how user input is transformed into a rendered channel profile via a single API call.

_Sources: [frontend/src/pages/ChannelPage.tsx](../../frontend/src/pages/channel/ChannelPage.tsx) [frontend/src/services/recentsService.ts](../../frontend/src/services/recentsService.ts) [frontend/src/services/youtubeService.ts](../../frontend/src/services/youtubeService.ts)_

---

## Specific Videos (`SpecificVideosPage`)

The `SpecificVideosPage` allows for batch metadata extraction. It is designed for high-volume workflows where users provide a list of video identifiers via text input or file upload.

### Batch Processing Pipeline

The page implements a deduplication and extraction pipeline to ensure only unique, valid Video IDs are sent to the backend.

1. **Input Extraction**: The `extractVideoId` function uses regex to pull 11-character YouTube IDs from raw text, URLs, or shorts links.
2. **File Upload**: The `handleFileUpload` logic supports `.csv`, `.txt`, and other text-based formats. It splits content by newlines and common delimiters (commas, tabs, semicolons) to find IDs in any cell of a spreadsheet.
3. **Deduplication**: Before fetching, IDs are passed through `new Set()` to prevent redundant API calls.
4. **Filtering**: Users can filter the resulting table by `videoTypeFilter` (Shorts vs. Long-form) based on the `duration` parsed via `parseDuration`.

### Export Engine

The page leverages `csvExport.ts` to generate reports. The `generateCSVContent` function supports:

- **Metric Selection**: Including `viewCount`, `likeCount`, and `commentCount`
- **Dimension Selection**: Including `thumbnailUrl`, `title`, and `duration`
- **Web Share API**: On supported devices, the `handleShare` function allows users to share the generated CSV file directly to other apps using `navigator.share`

### Entity Association Diagram

This diagram maps the UI actions to the underlying code entities and utilities.

_Sources: [frontend/src/pages/SpecificVideosPage.tsx](../../frontend/src/pages/specific-videos/SpecificVideosPage.tsx) [frontend/src/utils/csvExport.ts](../../frontend/src/utils/csvExport.ts) [frontend/src/utils/timeUtils.ts](../../frontend/src/utils/timeUtils.ts)_

---

## Shared Components & Services

### AutocompleteInput

The `ChannelPage` utilizes the `AutocompleteInput` component to provide a "Search History" dropdown.

- It filters `recentChannels` retrieved from Firestore based on the current `inputValue`.
- It supports keyboard navigation (ArrowUp/ArrowDown/Enter) for selecting historical entries.

### Recents Service (`recentsService.ts`)

This service manages the persistence of discovery history.

- **Storage**: Items are stored in a subcollection path: `users/{userId}/recents/{type}/items`.
- **Normalization**: Document IDs are normalized (e.g., lowercase, special characters replaced with underscores) to ensure that searching for the same channel twice updates the timestamp rather than creating a duplicate.
- **Cleanup**: The `cleanupOldRecents` function (called after saves) ensures the history does not exceed `MAX_RECENTS` (10 items).

_Sources: [frontend/src/components/AutocompleteInput.tsx](../../frontend/src/components/AutocompleteInput.tsx) [frontend/src/services/recentsService.ts](../../frontend/src/services/recentsService.ts)_

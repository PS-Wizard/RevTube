# Video Audit: Connected-Channel Video Picker Design

**Goal:** Rework the Video Audit input flow so users pick videos from their **own connected channels** using the shared `ChannelVideoPicker` component (the same chooser the Thumbnail Optimizer and Playlist Optimizer use), with a manual URL-paste mode restricted to connected channels.

## Context / Problem

Today `frontend/src/pages/videoAudit/VideoAuditInputForm.tsx` is a bespoke form:

- It accepts a free-text channel ID / `@handle` / channel URL and loads that channel's videos via `YouTubeService.fetchChannelVideos`.
- It is **not** restricted to the user's own connected channels (any channel handle can be typed).
- It does not reuse the shared `ChannelVideoPicker` / `VideoSearchDialog` / `UrlPasteDialog` components the other optimizers use.

The backend `POST /api/video-audit` already enforces ownership (it validates `channelId` against the user's connected channels via `ownership.getConnectedChannelIds`), so the backend needs no change. This is purely a frontend input-flow change to align with the existing, proven picker pattern.

## Change

Replace the bespoke channel-input + checkbox-list form in `VideoAuditInputForm.tsx` with the shared `ChannelVideoPicker`, configured for the Video Audit contract:

- `allowAnyChannel={false}` -> only the user's own connected channels are offered (personal tokens via `useAuth().allTokens`, org channels via `getOrganizationChannels`).
- `enforceSingleChannel={true}` -> all selected videos must belong to one channel (the backend requires a single `channelId` + `videoIds[]`).
- The picker's two built-in panels provide both requested modes:
  - **Browse Channels** (`VideoSearchDialog`): pick videos from a connected channel.
  - **Add Videos Manually** (`UrlPasteDialog`): paste YouTube URLs, restricted to connected channels via `allowedChannelIds`.
- Derive the owning `channelId` / `channelTitle` by resolving the first selected video via `YouTubeService.getChannelIdFromVideo` (exactly how `PlaylistOptimizerPage` derives and locks its single channel), then feed it back as `lockedChannelId` / `lockedChannelTitle` so the picker locks to that channel.
- Keep the existing `onSubmit({ channelId, videoIds, channelTitle })` contract unchanged so `VideoAuditPage` and its auto-save / history flow are untouched.
- Retain the submit button, validation, and error/loading states.

## Files

- Modify: `frontend/src/pages/videoAudit/VideoAuditInputForm.tsx` (rework to use `ChannelVideoPicker`).
- Reference only (no edits): `frontend/src/pages/thumbnailOptimizer/ChannelVideoPicker.tsx`, `VideoSearchDialog.tsx`, `UrlPasteDialog.tsx`, `PlaylistOptimizerPage.tsx`, `YouTubeService`.
- No backend changes.

## Verification

- `cd frontend && pnpm build` passes (tsc + vite).
- `cd frontend && pnpm test` passes.
- Manual: Video Audit page -> choose connected channel -> pick videos -> audit runs with the owning channel id; manual URL paste from a connected channel works, non-connected URLs are rejected.

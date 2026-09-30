# 2026-09-18 — YouTube API baseline (code-grounded)

Sources: `backend/services/analyticsService.js`, `dimensionsService.js`, `channelVideosService.js`, `tokenService.js`, `backend/utils/channelOwnership.js`, `backend/ingestion/readModels.js`, `frontend/src/services/youtubeOAuth.ts`, `userService.ts`.

## Endpoints used

- Data v3: `channels.list`, `videos.list` (chunked 50), `playlistItems.list` (uploads-playlist enumeration preferred over `search.list` = 100 units).
- Analytics v2: metrics `views, watchTime, subscribersGained/Lost, impressions, ctr, averageViewDuration, audienceRetention`; dimensions `day, video, trafficSource, deviceType, country`. Explicit `startDate/endDate + timezone` on every call.

## Token + org resolution

- `users/{uid}/youtubeTokens/{channelId}` (Firestore) → `tokenService.js` → `resolveOrgToken` middleware on 7 routes (channel, playlists, dashboard summary/bundle, dimensions, channel-videos, report). `syncOrgChannelTokens()` on re-auth. `validateVideos` enforces ownership for non-admin optimizer calls.

## Quota + cache discipline

- Live Google calls only on `ServerCache` miss (org/user-scoped keys via `cacheScope.js`); usage increment on miss only; `withInFlightTimeout` 120s dedup. Known gap: `USAGE_DEDUP_WINDOW_SEC` unwired (Compare-page parallel overcount possible).

## Error → fallback table

401 invalid_grant → re-auth CTA · 403 quotaExceeded → PG snapshot + backoff · 403 accessForbidden → ownership/org check · 404 → drop ID · 5xx/timeout → one retry, then snapshot. Dashboard never hard-fails when a snapshot exists.

## Null rule

Missing data stays `null` end to end (PG → API → KPI/table/tooltip `—`). No `|| 0` zero-fill.

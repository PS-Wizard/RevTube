---
name: youtube-analytics
description: YouTube Data API v3 + Analytics API v2 for RevTube — OAuth tokens, quota, channels/videos/playlists, metrics/dimensions, timezones, snapshots, caching, forecasting, error handling. Use for any YouTube data work in backend/ or frontend/.
---

# YouTube Analytics (RevTube custom)

RevTube is postgres-first: live Google calls happen only on cache miss, then persist to PostgreSQL + `ServerCache`. Never call Google per-render or per-row.

## APIs in play

- **Data API v3** (`backend/utils/channelOwnership.js`, `services/channelVideosService.js`): `channels.list`, `videos.list`, `playlistItems.list`, `search.list` (avoid — 100 quota units). Base URL + `API_KEY` come from `deps` (`YOUTUBE_API_BASE`).
- **Analytics API v2** (`services/analyticsService.js`, `services/dimensionsService.js`): metrics `views, watchTime, subscribersGained/Lost, impressions, ctr, averageViewDuration, audienceRetention`; dimensions `day, video, trafficSource, deviceType, country`. Always pass explicit `startDate/endDate + timezone`.

## Token flow (do not reinvent)

- Frontend OAuth → `frontend/src/services/youtubeOAuth.ts` → `userService.saveYouTubeToken()` writes `users/{uid}/youtubeTokens/{channelId}` in Firestore.
- Backend resolves per-request via `tokenService.js` + `resolveOrgToken` middleware (org `X-Org-Id` channels vs personal tokens). `syncOrgChannelTokens()` keeps the org snapshot fresh on re-auth.
- Owner re-auth invalidates old refresh tokens — stale-token errors mean re-auth, not retry loops.

## Quota rules

- `search.list` = 100 units; `videos.list/channels.list/playlistItems.list` = 1 unit. Prefer `playlistItems` (uploads playlist) over `search` for channel video enumeration.
- Chunk IDs 50 per call (`resolveVideoChannelIds` pattern in `utils/channelOwnership.js`).
- Batch + dedupe: `withInFlightTimeout` (120s) in `backend/index.js` coalesces parallel identical calls. Usage increments **only on cache miss** (`incrementUsageLimit` inside miss path — see `revtube-backend` skill).
- `USAGE_DEDUP_WINDOW_SEC` is declared but unwired (audit note) — do not assume dedup exists for Compare-page parallel calls.

## Metrics semantics

- `views`/`watchTime` aggregate; `CTR` = clicks/impressions (needs impressions context); retention is per-video percentage curves, not scalar.
- Timezone: requests carry explicit tz; daily snapshots in PG are tz-aligned — a "date mismatch" is usually tz vs UTC, not missing data.
- Zero-fill trap: `Number(r.views || 0)` loses missing-vs-zero. Keep source `null` when null.

## Caching + snapshots

- Key scope via `utils/cacheScope.js` (`dashboardScope`/`youtubeDataScope`, org/user/public). Responses depending on token resolution must be org/user-aware.
- Cron warms all channels every 6h (caps 50 cache / 100 ingestion, hardcoded). Historical snapshots live in PG via `backend/ingestion/` + `db/migrations/`.
- Forecasting (`services/goalsService.js`, `bestTimeToPostService.js`) reads PG snapshots, never live API.

## Error handling

| Failure | Cause | Action |
|---|---|---|
| 401 invalid_grant | revoked/rotated refresh token | surface re-auth CTA, don't retry |
| 403 quotaExceeded | daily quota hit | serve PG snapshot + cached data, back off |
| 403 accessForbidden | channel not owned / wrong token | check `validateVideos` + org context |
| 404 notFound | deleted/private video | drop ID, keep rest |
| 5xx / timeout | transient | single retry with backoff, then snapshot fallback |

Always degrade to PG snapshot + `ServerCache` instead of failing the dashboard. Log `channelId + API + quota cost` on every live call.

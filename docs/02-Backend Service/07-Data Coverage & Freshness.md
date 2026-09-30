# YouTube Data & Analytics Coverage

> Source of truth for what this app fetches/uses vs what YouTube offers but we do not.
> References: Dimensions / Metrics / Channel Reports / Content Owner Reports / System-Managed Reports (links at the bottom).

---

## 1. Data sources used (overview)

- **YouTube Data API v3** - channel / video / playlist / caption metadata (live, per-request).
- **YouTube Analytics API v2** - daily channel & per-video activity reports (live, per-request).
- **PostgreSQL** - ingested analytics read-models feed the dashboard when ANALYTICS_SOURCE=postgres-first.
- **YouTube Reporting API (bulk/system-managed)** - NOT used anywhere (see section 5).

Endpoint hosts:

| Host | Used in (backend) |
|---|---|
| www.googleapis.com/youtube/v3 | index.js, all routes/*, services/channelVideosService.js, services/insightsService.js, ingestion/sync.js, utils/channelOwnership.js |
| youtubeanalytics.googleapis.com/v2/reports | analyticsService.js, dimensionsService.js, dashboardBundle.js, routes/dashboardTabs.js, ingestion/sync.js |
| www.googleapis.com/youtube/upload/v3 | not used |
| youtubereporting.googleapis.com/v1 | not used |

---

## 2. Data API v3 - endpoints fetched

| Endpoint | Parts | Where (source ref) |
|---|---|---|
| videos | snippet, statistics, contentDetails, status | index.js:345,756; routes/videos; routes/channels:136,195; routes/compare:162; routes/dashboard:298; channelVideosService:64,219; insightsService:400; sync:120 |
| channels | snippet, statistics, contentDetails, brandingSettings, status | index.js:382; routes/channels:82,115,174,235; channelVideosService:128; sync:73 |
| playlists | snippet, contentDetails, status | index.js:440; routes/playlists; routes/dashboard:174,327; dashboardTabs:400 |
| playlistItems | snippet | routes/playlists:67; routes/compare:94; routes/dashboard:360; channelVideosService:153,176; sync:99 |
| search (type=video, forMine=true) | snippet | channelVideosService:33 (private/unlisted enrichment) |
| captions (+ track download) | snippet | routes/captions:41,62 |

Data API v3 surface we do NOT call: comments/commentThreads, subscriptions, videoCategories, i18n*, watermarks, live*, liveChat*, activities, members/membershipsLevels, videoAbuseReportReasons, and all write ops (playlists.update/delete, videos.rate, videos.update, thumbnails.set).
---

## 3. Analytics API v2 - dimensions used

| Dimension | Meaning | Where |
|---|---|---|
| day | per-day time series | analyticsService, dashboardBundle.js, dashboardTabs.js, ingestion/sync.js |
| video | per-video breakdown | useDashboardVideos.ts, analyticsService.getVideoRetentionMetrics |
| insightTrafficSourceType | traffic source | dimensionsService.js |
| subscribedStatus | viewer is subscribed | dimensionsService.js |
| deviceType | device | dimensionsService.js |
| country | country | dimensionsService.js |
| gender | gender | dimensionsService.js |
| ageGroup | age band | dimensionsService.js |

Dimensions available but NOT used: operatingSystem, province/areaCode, playbackLocationType/Detail, trafficSourceDetail, sharingService, liveOrOnDemand, adType, adPosition, subtitleLanguage, subtitleType, annotationType, cardType, endScreenType, asset/file (content-owner only), claimedStatus, uploaderType (content-owner only).

---

## 4. Analytics API v2 - metrics used (by group)

### Channel daily time-series (merged in routes/dashboardTabs.js)
- Core: views, subscribersGained, subscribersLost, estimatedMinutesWatched, likes, shares, comments
- Retention: averageViewDuration, engagedViews, viewerPercentage, averageViewPercentage
- Cards: cardImpressions, cardClicks, cardClickRate, cardTeaserImpressions, cardTeaserClicks, cardTeaserClickRate
- Live: averageConcurrentViewers, peakConcurrentViewers

### Playlist / per-video
- Playlist: playlistViews, playlistEstimatedMinutesWatched, playlistAverageViewDuration
- Per-video retention: averageViewPercentage, averageViewDuration, engagedViews, estimatedMinutesWatched
- Impressions (channel): videoThumbnailImpressions

### Metrics offered by YouTube but NOT fetched/used
- View/watch time: redViews, redWatchTimeMinutes (Premium-only), videosAddedToPlaylists, videosRemovedFromPlaylists.
- Annotation: annotationClickThroughRate, annotationCloseRate, annotationImpressions, annotationClickableImpressions, annotationClosableImpressions, annotationClicks, annotationCloses.
- End screen: endImpressions, endImpressionsClickable, endClicks, endClickRate, endTeaserImpressions, endTeaserClicks, endTeaserClickRate.
- Playlist/misc: viewsPerPlaylistStart, playlistSaves, dislikes (deprecated).
- Members (content owner): buyMemberships.
- Ad/revenue (content owner & partner, not used anywhere): estimatedPartnerRevenue, estimatedYouTubeAdRevenue, estimatedCpm, adImpressions, estimatedMonetizedPlaybacks, estimatedPlaybackBasedCpm, grossRevenue, transactions.
---

## 5. Reporting API (bulk / system-managed) - NOT used

youtubereporting.googleapis.com is never called.

Relevant report types that could be adopted:
- Daily video metadata v1.4 (content_owner_video_metadata_a4) - includes video_privacy_status, video_title, video_length, views, channel_display_name, embedding_allowed, made-for-kids flags, ad flags.
- channel_basic_a3 - user-activity report (the bulk equivalent of our live fetch).
- Ads / Shorts / Subscriptions / Taxes reports.

Privacy caveat: video_privacy_status is a bulk, content-owner, scheduled field delivered to BigQuery/Cloud Storage. It is NOT queryable via the live Reports API per request. The per-request source of truth for privacy is the Data API videos.list?part=status -> status.privacyStatus (already used). Use the bulk metadata report for a scheduled owner-side privacy backfill, not for live non-owner views.

---

## 6. Privacy status (the all-Public report)

Root cause: channelVideosService.js coerced a missing status.privacyStatus to 'public' both in the enrichment map and in the final per-video mapping. The private/unlisted payload fetch (search.forMine) only runs for an owner OAuth token; on the API-key fallback (non-owner) path, YouTube returns no privacyStatus, so every row was stamped public even though the status was simply unknown.

Fix (applied): removed the || 'public' coercion; privacyStatus is now kept only when YouTube actually returns it. Frontend badge renders Unknown when privacyStatus is absent (neutral dashed style); CSV/copy-table writes 'unknown'. Unlisted/private payloads remain owner-only; non-owner views correctly show Unknown (public-only list). Enabling 'All (incl. private/unlisted)' requires the owner channel token.

## 7. Cache chain (L1 Redis → L2 Postgres → L3 live YouTube)

The dashboard serves videos through a proper multi-tier cache that is consulted **always**, in order:

| Tier | Backing store | What it holds | When used |
|---|---|---|---|
| **L1** | Redis (ServerCache, in-memory LRU fallback) | Scoped channel_videos:* + snapshot:* payloads (24h TTL) | First check on every request |
| **L2** | **Postgres** read-model: analytics_videos (+ analytics_video_metrics_daily for stats) | Cron-ingested video catalog **with privacy_status** and daily metrics | Consulted whenever Redis misses and the DB has data for the channel **regardless of OAuth token** |
| **L3** | Live YouTube Data + Analytics API | Fresh metadata/stats | Only when Redis and Postgres both miss |

Previously the L2 (Postgres) video path was gated behind !accessToken, so owner views skipped the DB and always hit live YouTube (duplicate quota on top of the cron). That gate is removed: the dashboard now reads the cron-ingested DB first and only makes a live YouTube call when the channel has no DB rows.

Privacy is now persisted into analytics_videos.privacy_status (migration 0015_video_privacy_status.sql, written by sync.js, read by loadChannelVideosFromPostgres/getVideosByIds), so the L2 tier serves correct public/unlisted/private filters without a live round-trip. Staleness is handled by the **manual admin ingestion refresh** rather than per-request live fetches. Set ANALYTICS_SOURCE=youtube-only to bypass the DB entirely.

### Status filter is served by the API (not client-only)

The videos endpoints accept a `privacy` parameter (`public | private | unlisted | all`) on `/dashboard/videos` (query), `/dashboard/tabs/videos` (body), and `/channel-videos/:id` (query). The backend filters to the exact status group, runs the owner-only hidden-video fetch only when needed, and caches per status (`channel_videos:{user}:{channel}:{limit}:p={privacy}`). A filter change refires the request with the new `privacy` value; the client-side `matchesVisibilityFilter` remains only as a strict final guard. Stats pills and the chart are computed from the same filtered/all-videos set for the active time range.

### All videos (25-video cap removed)

The dashboard load-toolbar "25 videos" limiter was removed — the videos tab always requests the full channel catalog (`limit: 'all'`, served from L2) and paginates client-side via the table's pagination. Stats/chart calculations use all videos in the selected time range + status filter, not just the first page.

---

## 8. Ingestion resilience (metric-group tolerance)

YouTube's Analytics API rejects an **entire report query** if any single metric is unsupported for that channel (e.g. `averageConcurrentViewers`/`peakConcurrentViewers` on channels without live streaming → HTTP 400). Ingestion previously sent one mega-query, so one unsupported metric failed the whole run.

`ingestion/sync.js` now sends **independent metric groups** per ingestion window, all with `ids=channel=={id}, dimensions=day, sort=day`:

| Group | Metrics | Failure behavior |
|---|---|---|
| Watch | views, estimatedMinutesWatched, averageViewPercentage, averageViewDuration, engagedViews | required |
| Engagement | subscribersGained, subscribersLost, likes, shares, comments | required |
| Viewer % | viewerPercentage | optional (skip on 400/403) |
| Cards | cardImpressions, cardClicks, cardClickRate, cardTeaserImpressions, cardTeaserClicks, cardTeaserClickRate | optional (skip on 400/403) |
| Live | averageConcurrentViewers, peakConcurrentViewers | optional (skip on 400/403) |

- `fetchOptionalMetricGroup` degrades 400/403 to a warning (`[ingest] Skipping unsupported metric group …`) and returns `null`; groups are joined column-wise per date by `mergeReportColumns`.
- `withRetry` preserves `err.response` on wrapped errors (its plain `new Error(enhanced)` previously dropped the status code, which is why the tolerant handler initially never fired).
- The old duplicate engagement call was removed (reuses the engagement group's report) — one fewer Analytics call per window.
- Rejected groups become zeros downstream; a channel with all optional groups rejected still syncs its core metrics.

## 9. Cache invalidation after ingestion

- On every successful `ingestChannelDaily` run, `deleteDashboardSnapshots(channelId)` drops the channel's stale L2 `analytics_dashboard_snapshots` rows (tolerant try/catch — never fails the run), so the next dashboard request rebuilds from fresh Postgres rows.
- **Known gap:** the admin "clear cache" endpoint may not wipe the `channel_videos:*` key family (observed stale L1 entries surviving a flush). Until fixed, remove them directly:
  ```bash
  docker compose exec redis sh -c \
    "redis-cli -a $REDIS_PASSWORD --no-auth-warning --scan --pattern 'channel_videos:*' | xargs -r redis-cli -a $REDIS_PASSWORD --no-auth-warning DEL"
  ```
- Schema/storage reference: `analytics_videos` (catalog + privacy_status), `analytics_video_metrics_daily` (per-day metrics, `filters_key=''` = channel-wide rows), `analytics_channel_metrics_daily`, `analytics_sync_runs`, `analytics_dashboard_snapshots`.

---

## References
- Dimensions: https://developers.google.com/youtube/reporting/v1/reports/dimensions
- Metrics: https://developers.google.com/youtube/reporting/v1/reports/metrics
- Channel Reports: https://developers.google.com/youtube/reporting/v1/reports/channel_reports
- Content Owner Reports: https://developers.google.com/youtube/reporting/v1/reports/content_owner_reports
- Reporting Reports: https://developers.google.com/youtube/reporting/v1/reports
- System-Managed Video Metadata: https://developers.google.com/youtube/reporting/v1/reports/system_managed/videos#daily-video-metadata-version-1.4

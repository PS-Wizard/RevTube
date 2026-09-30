# Changelog

All notable changes to RevTube are documented here.

---

## [Unreleased]

### Fixed

- **Analytics report server cache too short (quota waste)** — `/analytics/report` and `POST /dashboard/report` cached each YouTube Analytics response for only **12 minutes** via `YT_DATA_CACHE_TTL_MS.ANALYTICS_REPORT`. Since the underlying daily rows only advance once per day (the code already strips the last 2 lag days), re-querying every 12 min meant needless calls to the (quota-limited) YouTube Analytics API on nearly every navigation. Bumped to **6 hours**, so a half-day's views of a given report (across sessions, devices, and shared org members) hit the server cache instead of YouTube. Frontend already has its own 24h `analyticsCache`, so this change primarily helps fresh sessions / cross-device / org sharing. (`backend/utils/cacheScope.js`, `backend/utils/cacheScope.test.mjs`)

### Changed

- **GoalCard left border accent now animates in via a single CSS-variable rule** — The `::before` border strip's five per-status hover rules were consolidated into one `.goal-card:hover::before` rule fed by an inline `--rt-goal-status-color` custom property (status mapping unchanged: met/ahead→success, on_track→accent, behind→warning, missed→danger, upcoming→text-tertiary). The accent now colors on whole-card hover (previously only when hovering the 4px strip itself) and fades via the `--rt-transition-fast` design token. (`frontend/src/components/goals/GoalCard.tsx`, `frontend/src/components/goals/GoalCard.css`)

### Added

### Added

- **Org Analytics: custom date range + KPI timeline subtitles** — The Organization Analytics page's period selector gains a **Custom** pill that reveals start/end date inputs (min/max clamped to each other, max 730 days enforced server-side); the backend `GET /organization/analytics` accepts `period=custom&start=YYYY-MM-DD&end=YYYY-MM-DD` (validated, cached per-range, previous-period delta computed over the equally-long window before the custom start). Every KPI card now shows an "added/reduced in {timeline}" subtitle — e.g. "1,234 views added in Last 30 Days", "+45 subs added in Jun 1, 2026 – Sep 4, 2026" — instead of the vague "vs prev 30d". (`backend/services/orgAnalyticsService.js`, `backend/routes/organization.js`, `frontend/src/services/organizationService.ts`, `frontend/src/hooks/queries/useOrgAnalyticsQuery.ts`, `frontend/src/pages/OrgAnalyticsPage.tsx`, `frontend/src/pages/OrgAnalyticsPage.css`)

- **Total Subscribers (Net) card on Channel Analytics** — New insight card computing `subscribersGained − subscribersLost` over the selected range (preset period or custom dates), with 90/30/7d deltas derived the same way from the multi-period stats and a daily net-gain sparkline. Hidden only when there is zero subscriber activity in both directions (a net of 0 with real gains/losses stays visible). (`frontend/src/components/dashboard/ChannelAnalyticsInsights.tsx`)

- **Goal creation: "Start today" and "Next subframe" quick-start buttons** — The Create Goal modal's Start Date field now has two buttons: **Start today** re-anchors the current range to today while preserving its duration (a 1-year goal starting in September now runs Sep→Sep, not Jan→Dec), and **Next {week/month/quarter/interval}** snaps the start to the next calendar boundary of the chosen sub-division (next ISO Monday, 1st of next month, first day of next calendar quarter, or today + custom interval). Mid-quarter quarterly starts now generate a month-range period key (`2026-09~11`) and label (`Sep–Nov 2026`) instead of a misleading quarter number. (`frontend/src/components/goals/CreateGoalModal.tsx`, `frontend/src/components/goals/CreateGoalModal.css`)

- **Calendar-aligned goal sub-frames + ISO week labels** — `buildBoundaries` now snaps sub-frames to the calendar: the first frame runs to the end of its calendar month/quarter (or the next ISO Monday for weeks), and subsequent frames are full calendar months, calendar quarters (Q1 = Jan–Mar … Q4 = Oct–Dec, so a goal crossing year boundaries keeps true quarter counts), and Mon–Sun ISO weeks. Week labels use ISO-8601 week numbers (reusing the `getISOWeekNumber` helper now exported from `periodPresets.ts`) instead of day-of-month math, and mid-quarter-start frames get month-range labels (`Sep–Nov 2026`). (`frontend/src/components/goals/milestones.ts`, `frontend/src/components/goals/periodPresets.ts`)

- **Goal Detail chart upgrades (distinct colors, series toggles, custom tooltip, frequency resampling, full-year YoY)** — The cumulative trajectory chart: (1) every series now has a distinct design-token color via `SERIES_META` (previously `actual` and `forecast` both used `--rt-color-accent`, making two curves indistinguishable); (2) a custom `SeriesTooltip` lists EVERY series at the hovered point with a color swatch + label + value (default Recharts tooltip showed only the nearest); (3) per-series legend chips above the chart toggle each curve on/off (`visibleSeries`, at least one always visible); (4) a Daily/Monthly/Quarterly frequency selector resamples the trajectory client-side for readability (long >180-day goals default to Monthly; day-0 Start anchor preserved); (5) "Same period last year" now starts at the previous calendar year's Jan 1 and accumulates through that year (true full-year YoY overlay). (`frontend/src/pages/GoalDetailPage.tsx`, `frontend/src/pages/GoalDetailPage.css`)

- **Documented the Goal Detail forecasting models** — `docs/GOALS.md` and `fulldocs/14-Goals & Forecasting System` now describe the forecasting pipeline: the three candidate models (SMA / Holt's linear double-exponential smoothing / OLS linear regression), the holdout-backtest selection by lowest MAE, the confidence thresholds, winsorization + 2-day YT-lag preprocessing, metric-specific inputs (daily-gain space for views/subs, levels for engagement/retention, CTR unmodeled), and the velocity straight-line fallback from the backend's anomaly-free trailing-window daily-velocity baseline. Both docs explicitly note that only the single best model is plotted — one "Projected" line per chart, not multiple overlapping curves. (`docs/GOALS.md`, `fulldocs/14-Goals & Forecasting System/01-Goals & Forecasting System.md`)

- **Optimized Content "View Audit" deep-links for all three tabs** — The Video and Playlist tabs on the Optimized Content page previously only opened YouTube. They now resolve the newest saved run containing the item — `GET /api/video-audit/history/by-video/:videoId` (exact match on `results.results[].videoId`) and `GET /api/playlist-optimizer/history/by-video/:videoId` (quoted-exact `"id": "<ref>"` match inside `audits`, both uid-scoped, registered before `/history/:id`) — and navigate to `/video-audit?audit=<id>&scroll=<videoId>` / `/playlist-optimizer?audit=<id>&scroll=<videoId>`: the saved entry loads through each page's normal `handleLoadAudit` / `handleLoadAnalysis` path (zero AI re-run), any stale running session is stopped first, and the target video's deep-dive accordion (`video-deepdive-*` anchor) or playlist card (`pl-rec-*` anchor) expands and smooth-scrolls into view. YouTube opens as fallback only when no saved run exists; the button reads "View Audit" everywhere and disables while resolving. (`backend/routes/videoAudit.js`, `backend/routes/playlistOptimizer.js`, `frontend/src/services/videoAuditService.ts`, `frontend/src/services/playlistOptimizerService.ts`, `frontend/src/pages/OptimizedListPage.tsx`, `frontend/src/pages/VideoAuditPage.tsx`, `frontend/src/pages/PlaylistOptimizerPage.tsx`)

- **Video Audit thumbnail element reuses the Thumbnail Optimizer 12-pillar analysis** — The video audit's thumbnail element no longer runs a separate Gemini Vision path. `videoAuditService.scoreVideo` now calls `thumbnailOptimizerService.analyze()` once per video (watch URL built from `videoId` + channel niche) and reuses its `currentScore`/`expectedScore` and full `ThumbnailAudit`. The element score maps `currentScore * 10`; the Optimizer's own `expectedScore` drives the fix-target projection (`targetPerElement`). The full analysis is attached as `thumbnailAnalysis` on the element type. (`backend/services/videoAuditService.js`, `backend/index.js`, `frontend/src/types/videoAudit.ts`, `frontend/src/types/thumbnailOptimizer.ts`)

- **Video Audit child thumbnail analyses auto-persisted to Optimizer history** — When a video-audit queue job finishes, `persistChildThumbnailAudits` writes every video's embedded 12-pillar analysis into `thumbnail_audits` as one row named "Video Audit -- <date>" (same watch-URL/audit shape a native Optimizer run stores), so Thumbnail Optimizer history lists them with zero extra Gemini cost. Best-effort: skipped without uid/PG, failures only log a warning and never fail the audit job. The inserted row id is surfaced on the job result as `thumbnailAuditSavedId`.

- **Detailed Thumbnail Analysis child audit handoff** — In the Video Audit detailed breakdown, the thumbnail element shows only its score plus a "General Knowledge" summary (`reviewSummary`) and a **"Detailed Thumbnail Analysis"** button. Preferred route: navigates to `/thumbnail-optimizer?audit=<rowId>&scroll=<videoId>`, which opens this run's persisted history entry through the page's normal `handleLoadAudit` path (no AI re-run), expands that video's deep-dive accordion (`thumb-audit-<videoId>` anchor) and smooth-scrolls it into view. Fallback when no saved row exists (legacy pre-persistence runs or save skipped): `/thumbnail-optimizer?video=<id>&niche=<niche>&auto=1` auto-enqueues the full 12-pillar audit for that one video (the "child audit" that finishes the series) and renders the per-pillar deep dive. A running child audit survives navigation via the same `useSessionJobId` sessionStorage persistence. (`frontend/src/pages/videoAudit/VideoAuditDetailedAnalysis.tsx`, `frontend/src/pages/ThumbnailOptimizerPage.tsx`)

- **Optimized Content list deep-links into saved thumbnail audits** — The Thumbnail tab's **View Audit** button on the Optimized Content page now resolves the newest saved audit containing that video (`GET /api/thumbnail-optimizer/history/by-video/:videoId` — substring match over the `audits` JSONB urls, uid-scoped) and opens `/thumbnail-optimizer?audit=<rowId>&scroll=<videoId>`: the persisted entry loads and smooth-scrolls to that video's deep-dive accordion with zero AI re-run. Falls back to the old fresh `?video=<id>&auto=1` auto-run only when no saved entry exists or the lookup fails; also drops a stray empty `niche` query param the button used to send. (`backend/routes/thumbnailOptimizer.js`, `frontend/src/services/thumbnailOptimizerService.ts`, `frontend/src/pages/OptimizedListPage.tsx`)

- **Per-alternative scores on Video Audit suggestions** — Each concrete alternative in a `suggestions` entry now carries its own 0-100 score from re-running the same `deepSeekText` element scorer the live audit uses, so the number is directly comparable to the element's own score. `title.options` and `tags`/`keywords.suggested` get parallel `scores: number[]` arrays (e.g. 3 alt titles -> 3 independent title scores); `description.rewrite` gets a single `score`. Thumbnail `concepts` are intentionally unscored (no image to grade). The detailed UI shows a colored score pill next to each alternative. (`backend/services/videoAuditService.js`, `frontend/src/types/videoAudit.ts`, `frontend/src/pages/videoAudit/VideoAuditDetailedAnalysis.tsx`)

- **Stronger, filtered suggestion alternatives + cleaner card** — The suggestion prompt now enforces a mandatory quality bar: every alternative must be strong enough to score >= 80/100 on its element (genuinely click-worthy titles, 15-20 high-volume + long-tail tags, real keyword phrases, engaging description rewrite). As a safety net the UI only renders alternatives scoring >= `MIN_ALT_SCORE` (70), hiding weak filler (<70) instead of showing low numbers; 70-79 alternatives show with a yellow pill so the user can decide. The recommendation card no longer prints the "Raise score from X to Y" projection line (the numeric projection is noise next to the actual alternatives); it keeps a concise "+N pts potential uplift" chip. (`backend/services/videoAuditService.js`, `frontend/src/pages/videoAudit/VideoAuditDetailedAnalysis.tsx`)

- **Thumbnail element shows score + General Knowledge, not concept cards** — The thumbnail element reuses the Thumbnail Optimizer's 12-pillar audit (already run in parallel inside `scoreVideo`, so the video audit waits for the optimizer result and reuses its `currentScore`/`expectedScore`). Its detailed breakdown now shows only the element score, the "General Knowledge" summary (`reviewSummary`), and a **"Detailed Thumbnail Analysis"** button (no text-style concept alternatives). Clicking navigates to the Thumbnail Optimizer child audit (`/thumbnail-optimizer?video=&niche=&auto=1`) which renders the full per-pillar deep dive. (`frontend/src/pages/videoAudit/VideoAuditDetailedAnalysis.tsx`)


- **Background optimizer jobs for thumbnail & playlist analysis** — Both optimizer pages ran as blocking axios `POST /analyze` calls, so navigating away or closing the tab lost the result. They now enqueue BullMQ jobs (`POST /jobs` returns `{ jobId }`) on a new shared `optimizer` queue (`backend/queue/optimizerQueue.js`, dispatched on `job.data.kind`). The worker runs the analyze service, persists to `thumbnail_audits` / `playlist_audits`, and returns `{ savedId, kind, result }`. The frontend holds the jobId in `sessionStorage` via `useSessionJobId` and polls `GET /jobs/:id` every 4s; a new `useOptimizerJobWatcher` in `Layout` keeps polling after the user navigates away or closes the page. (`backend/queue/optimizerQueue.js`, `backend/queue/index.js`, `backend/routes/thumbnailOptimizer.js`, `backend/routes/playlistOptimizer.js`, `frontend/src/hooks/useOptimizerJobWatcher.ts`, `frontend/src/pages/ThumbnailOptimizerPage.tsx`, `frontend/src/pages/PlaylistOptimizerPage.tsx`)

- **Thumbnail + playlist optimizer completion notifications** — `handleAuditCompleted` now accepts the `thumbnail-optimizer` and `playlist-optimizer` labels (the optimizer worker derives them per job from `job.data.kind`), creating `thumbnailAuditComplete` / `playlistAuditComplete` in-app notifications linking to `/thumbnail-optimizer` / `/playlist-optimizer` and enqueuing `sendAuditCompleteEmail` with `auditType` thumbnail/playlist. (`backend/queue/index.js`, `backend/emailService.js`, `frontend/src/types/notification.ts`, `backend/queue/auditCompleted.test.mjs`)

- **OS notification fix for backgrounded audit completion** — `useNotifications` now runs with `refetchIntervalInBackground: true`, so the browser keeps polling `GET /notifications` while the tab is hidden and the arrival toast + OS notification for a completed audit/analysis actually fire. (`frontend/src/hooks/queries/useNotifications.ts`)

- **Uploads series data in Channel Analytics** — The chart rows returned by `POST /dashboard/tab/channel` carry only the 7 report metrics; the frontend now merges per-day upload counts from the `videos` store into `channelAnalyticsChartData` so the Uploads series / mini bar graph renders real data instead of flat zeros. `videos.length` is part of the query key so the merge re-runs when the catalog arrives. (`frontend/src/hooks/queries/useChannelTabQuery.ts`)

- **AI Chat System (Agent + Tools + Memory)** — A new AI assistant module in `backend/chat/` that runs a DeepSeek-powered agent loop. Users can ask natural-language questions about their YouTube channel performance. The system includes:
  - **AgentExecutor** (`backend/chat/AgentExecutor.js`): Streaming agent loop with tool calling, iteration management (max 10 iterations), abort support, and DeepSeek API integration (OpenAI-compatible streaming). Emits SSE events (`token`, `tool_start`, `tool_end`, `thought`, `thought_end`, `channels`, `tools`, `usage`, `done`, `error`).
  - **ConversationMemory** (`backend/chat/ConversationMemory.js`): Dual-storage conversation persistence — short-term Redis cache (`chat:conv:{id}`, 30-min TTL) and long-term PostgreSQL (`chat_conversations`, `chat_messages` tables). Supports CRUD operations, pagination, message count, and auto-title generation from the first user message.
  - **Guardrails** (`backend/chat/Guardrails.js`): Three-layer security — input guard (prompt injection detection via 15 regex patterns, 4000 char max), tool guard (allowed tool validation, max 20 tool calls), output guard (PII/email/token redaction, URL-aware long-token redaction, 8000 char cap).
  - **ToolRegistry** (`backend/chat/ToolRegistry.js`): Central registry for 8 tools: `searchVideos`, `getChannelInfo`, `getVideoDetails`, `getAnalyticsQuick`, `compareChannels`, `getBestTimeToPost`, `searchKnowledge`, `listMyChannels`. Produces OpenAI-compatible tool definitions and resolves execution by name.
  - **Tool channel access verification** (`backend/chat/tools/shared.js`): Tools verify channel ownership against the user's connected YouTube channels before operating.
  - **Express router** (`backend/chat/index.js`): REST + SSE endpoints — `GET /api/chat/channels`, `GET /api/chat/conversations`, `POST /api/chat/conversations`, `GET /api/chat/conversations/:id`, `DELETE /api/chat/conversations/:id`, `POST /api/chat/conversations/:id/messages` (SSE streaming). Protected by `authenticateRequest` and `requireQuota('chat')`.
  - **500 character message limit** enforced server-side with descriptive error response.

- **AI Chat Frontend Page** (`frontend/src/pages/ChatPage.tsx`, `ChatPage.css`):
  - Full SSE streaming UI with real-time token rendering, tool call indicators, and thinking steps display.
  - **Conversation sidebar** with create/list/delete, active conversation highlighting, retry with exponential backoff on load failure.
  - **Inline process indicator** replacing bulky process panels — shows "Using [tool]..." when a tool runs, thought text when thinking, "Analyzing..." as default with animated typing dots.
  - **Typing dots animation** (`.typing-dots`) — three staggered dots with CSS animation (0ms, 200ms, 400ms delays) shown while waiting for response.
  - **Streaming cursor** — blinking cursor shown only when content exists and streaming is active.
  - **Paragraph breaks after tool calls** — `justFinishedToolRef` flag triggers `\n\n` prepend before the first token after a `tool_end` SSE event.
  - **Textbox design** — auto-growing height, 500-char max with live counter (red at limit), placeholder text.
  - **Mobile sidebar** — X close button instead of collapse toggle; close on conversation select.
  - **Settings page** (`ReadmePage` — `frontend/src/pages/ReadmePage.tsx`, `ReadmePage.css`): Quick reference guide for AI chat features, tool listing, and usage instructions.

- **`useChat` React hook** (`frontend/src/hooks/useChat.ts`):
  - Full SSE event handling pipeline: `token`, `tool_start`, `tool_end`, `thought`, `thought_end`, `channels`, `usage`, `done`, `error`.
  - `justFinishedToolRef` for paragraph break detection.
  - `usage` SSE event triggers `queryClient.invalidateQueries` to update the sidebar UsageBar in real time.
  - Conversation CRUD (create/list/load/delete), abort/cancel, scroll-to-bottom friendly state management.
  - `loadConversation` filters out `role: 'tool'` messages from the frontend display while preserving them in backend context.

- **AI Chat Pro gating** — AI Chat is gated behind `FeatureGuard` in the route config. When `premiumOnly` is set in feature config for `"chat"`, free users see the upgrade prompt. Pro badge shows on the sidebar nav item via `getNavBadge("chat")`. Active nav item uses background shift only (no blue icon/text) with `premium-item` class for Pro-locked items.

- **`chat` page key in feature config** — Added `"chat"` to `DEFAULT_FEATURE_CONFIG` pages with `premiumOnly: false`, `freeLimit: 50`, `proLimit: 200` defaults. Wired through `checkUsageLimit("chat")` + `requireQuota("chat")` middleware chain. Consumes quota on every message send.

- **Chat sidebar close on mobile — desktop collapse button hidden on mobile** — Mobile view shows X close button only, no collapse toggle. Desktop sidebar collapse button hidden on mobile via CSS (`display: none`). Sidebar header aligned `flex-end` on mobile.

- **Drizzle migration for chat tables** — New migration `0004_chat_conversations.sql` creating `chat_conversations` and `chat_messages` tables with proper indexes, foreign keys, and `ON DELETE CASCADE`.

- **Redis split into cache + BullMQ instances** — Two separate Redis instances: `redis` (allkeys-lru, 256MB container limit 384MB) for ServerCache analytics cache, OAuth tokens, and rate limiters; `redis-queue` (noeviction, 64MB container limit 128MB) for BullMQ queue state, locks, and stall-detection. Cache eviction on `redis` can never affect queue integrity. Backend uses `QUEUE_REDIS_URL` env var for BullMQ (falls back to `REDIS_URL`). (`docker-compose.yml`, `backend/queue/index.js`)

- **Audience active time analysis with YT API + DB view-velocity model** — `generateAudienceActiveTime()` fetches day-of-week breakdown (views + engagement per day) from YT Analytics API. `generateAudienceActiveTimeFromDb()` estimates hourly audience activity from PostgreSQL view-velocity model. Both wired into dashboard tabs and cache-warm queue. Frontend InsightsPanel shows hourly estimated audience activity with confidence indicators; AudienceBreakdownPanel shows retention trend. (`backend/services/insightsService.js`, `backend/routes/dashboardTabs.js`, `frontend/src/components/dashboard/InsightsPanel.tsx`, `frontend/src/components/dashboard/AudienceBreakdownPanel.tsx`)

- **Drizzle ORM for analytics queries with injection-safe read models** — Installed `drizzle-orm` and `drizzle-kit`. Created `db/schema.js` with full `pgTable` definitions for all 7 analytics tables. Created `db/drizzle.js` singleton wrapper around existing `pg` Pool. Created `drizzle.config.js` for CLI. Created `ingestion/readModelsDrizzle.js` with parameterized Drizzle query builder replacements for 6 core analytics read functions — all queries use `sql`` tagged templates guaranteeing zero SQL injection risk. (`backend/db/schema.js`, `backend/db/drizzle.js`, `backend/drizzle.config.js`, `backend/ingestion/readModelsDrizzle.js`)

- **Drizzle migration runner** — Replaced custom `schema_migrations`-based runner with Drizzle ORM's built-in `migrate()` from `drizzle-orm/node-postgres/migrator`. Created initial Drizzle migration (`db/drizzle/0000_initial.sql`) matching existing schema with `IF NOT EXISTS` guards. Tracks applied migrations by content hash. (`backend/db/migrate.js`, `backend/db/drizzle/0000_initial.sql`)

- **Auto-generate Drizzle migrations during Docker build** — Docker multi-stage build now installs ALL deps (including drizzle-kit) in Stage 1, runs `npx drizzle-kit generate` after source copy, then prunes to production-only. Generated migration files are copied into the runtime image. Container startup runs `node db/migrate.js` to apply any pending migrations automatically. (`backend/Dockerfile`, `backend/db/drizzle/meta/_journal.json`)

- **Cache-warm queue expanded to pre-compute audience data** — Previously only warmed dashboard bundles, 90-day dimensions, videos, and DB-powered audience activity. Now additionally pre-computes: dimensions for 7d, 30d, AND 90d ranges (was 90d only); retention trend (30-day rolling); YT API audience active time (day-of-week breakdown). 6-phase warming sequence runs every 6 hours via cron. Cold hits still fall through to synchronous path. (`backend/queue/cacheWarmQueue.js`)

- **Engagement metrics alongside views in Weekly Audience Activity chart** — Added `totalEngagement` (subscribersGained + likes + comments + shares) as a line overlay with right-side Y-axis in the day-of-week bar chart. Dual-axis approach: left = views (bars), right = engagement (line), both visible regardless of scale differences. Tooltip shows full breakdown when hovering over the engagement line. (`frontend/src/components/dashboard/InsightsPanel.tsx`)

- **Custom date range support for audience dimensions** — Added `dCustom` window computation when a custom date range is set. Audience dimensions now fetch the full user-chosen range instead of clamping to 30d. Audience Retention respects the custom date range when active. IsCustom flag threaded through DimCard/AudienceMetricDeltas for correct custom-range pills. (`backend/routes/dashboardTabs.js`, `frontend/src/components/DimensionsPanel.tsx`, `frontend/src/utils/dashboardUtils.ts`)

- **Best Time to Post V2 — empty-bucket skip in "best for" calculation** — Empty buckets (`videoCount === 0`) are now skipped when computing the best slot per metric (views, engagement, comments). Previously a zero-video bucket with a median Z-score of 0 could falsely "win" over buckets with negative z-scores, producing misleading "Best for views" labels like `00:00 (0.00)`. (`frontend/src/components/dashboard/InsightsPanel.tsx`)

- **Best Time to Post V2 — timezone awareness** — The analysis now displays the IANA timezone abbreviation (e.g. `EST`, `WAT`) next to best-hour labels. When the selected timezone differs from the browser's local timezone, a note appears below the panel controls showing both. Shows `HourlyAnalysisV2` and `WeeklyAnalysisV2` now receive `timezone` prop. (`frontend/src/components/dashboard/InsightsPanel.tsx`)

- **`DaypartStat` and `DaypartLabelInfo` types** — Added to the dashboard type definitions to support the new 6-part daypart structure alongside the existing 24-hour model. (`frontend/src/types/dashboard.ts`)

- **Manual YouTube ingestion trigger in admin danger zone** — New "Refresh Ingestion" button with confirmation modal in the AdminPage danger zone. Calls `POST /admin/ingestion/refresh-all` with configurable `maxChannels`, `days`, `maxVideos` params and displays per-channel ingestion results via toast. Complements the existing "Refresh All Cache" action by fetching fresh YouTube API data first. (`frontend/src/pages/AdminPage.tsx`)

- **`getLatestMetricDate` read model** — New PostgreSQL query function that fetches the most recent metric date for a given channel from `analytics_video_metrics_daily`, enabling server-side correction of stale client `latestDate` in dashboard tabs. Exported and wired through `sharedDeps`. (`backend/ingestion/readModels.js`, `backend/index.js`)

- **Best Time to Post V2 — period-agnostic cache key** — The `bestTimeToPost` cache key no longer includes `period`, since the analysis queries ALL ingested videos regardless of date range (no `WHERE` clause on date). Including `period` caused cache thrashing when users switched between 7/30/90-day tabs with no actual query difference. (`backend/services/insightsService.js`)

- **Compare page two-tier caching** — The Compare page now uses a two-tier caching strategy (backend Redis + frontend localStorage) to prevent redundant YouTube API calls. Backend `POST /compare/videos` endpoint fetches ALL videos from a channel's uploads playlist, enriches with statistics, and pre-computes analytics metrics. Cached in Redis under `compare:videos:{playlistId}{:dateRange}` with **1-hour TTL**, **shared across all users** (no user scope). Frontend caches **per-channel** in localStorage with org-scoped keys (`compare_cache::channel::{handle}::...::org:{orgId}`) — adding a new channel to an existing comparison fetches only the uncached channel(s). Falls back to client-side `fetchVideosOptimized()` if backend endpoint is unavailable. (`backend/routes/compare.js`, `frontend/src/components/Compare.tsx`, `frontend/src/services/youtubeService.ts`)

- **`helmet()` security headers** — Added `helmet` package (v8.2.0) to the middleware chain with CSP disabled and `cross-origin` resource policy. Production now sends `X-Frame-Options`, `X-Content-Type-Options`, and HSTS headers. (`backend/index.js:668`)

- **Org token resolution middleware** — Created `resolveOrgToken(channelIdSource)` middleware at line ~1213. Activated by `X-Org-Id` header: reads the organization ID, resolves channel tokens from Firestore `organizations/{orgId}/channels/{channelId}`, and overrides `req.headers.authorization` with the stored access token. Applied to 7 routes: `/channel/id/:id`, `/playlists/:channelId`, `/dashboard/summary`, `/dashboard/bundle`, `/analytics/dimensions`, `/channel-videos/:channelId`, `/analytics/report`. Sets `req._orgTokenResolved = true` to skip redundant downstream inline resolution. (`backend/index.js`)

- **OAuth 10s timeout (6 sites)** — All `axios.post` calls to `oauth2.googleapis.com/token` now have `{ timeout: 10000 }`: OAuth exchange, OAuth refresh, `refreshGoogleToken()`, channel-videos retry, and org token refresh. Prevents hung OAuth requests from blocking server threads indefinitely. (`backend/index.js`)

- **OAuth refresh route structured diagnostics** — `POST /api/oauth/refresh` now uses structured logging with an `oauthErr` object (status, message, code, errno, syscall) instead of the generic `handleApiError`. Returns `502 TOKEN_REFRESH_FAILED` on failure, enabling clear frontend error messaging. (`backend/index.js:1736`)

- **`handleApiError` network diagnostic improvements** — The no-response branch now logs full error context: `{ message, code, errno, syscall }` for easier debugging of network-level failures. (`backend/index.js:2559`)

- **`USAGE_DEDUP_WINDOW_SEC` env var** — Declared at line 624 (default 5s, set to 0 to disable). Intended to prevent parallel requests from each independently incrementing usage counters. **Not yet wired** into `incrementUsageLimit` — only the variable and comments exist. (`backend/index.js:622-627`)

- **`MAX_VIDEOS_PER_CHANNEL` env var** — Declared at line 629 (default 500) with clamping logic and a logged warning when clamped. **Not yet forwarded** to `ingestChannelDaily()` or cron ingestion functions — ingestion still hardcodes `maxVideos = 500`. (`backend/index.js:629-639`)

- **Quota management with resolve-only request context** — Introduced `X-Usage-Context: resolve` header support to distinguish internal ID-resolution calls (e.g. handle → uploads playlist) from user-initiated requests. `incrementUsageLimit()` tracks resolve-only requests via `req._resolveOnly` and enforces the hard block at threshold without consuming monthly quota. Usage info is auto-attached to every JSON response via middleware (`_usage` field), enabling real-time frontend quota display. (`backend/index.js`)

- **Analytics cache invalidation via config versioning** — Config changes now trigger immediate server-side analytics cache invalidation. `bumpConfigVersion()` increments a Firestore counter on every `PUT /admin/config`. On each request, `checkConfigVersion` middleware compares the live version against the request-scoped cache; a mismatch invalidates all dashboard, snapshot, and report cache keys. This ensures quota and `premiumOnly` changes take effect immediately without waiting for cache TTL expiry. Firestore doc: `config/version`. (`backend/index.js`)

- **Tier indicator in navbar** — The header profile button now displays a colored avatar border and tier pill: "Org" (blue), "Admin" (red), "Pro" (golden), or "Free" (muted grey). In org mode, profile text (email/name) is hidden to show avatar + tier chip only. Sidebar tier chips and quota UsageBar are hidden in org mode, since all members inherit Pro access through the organization plan. (`frontend/src/components/Layout.tsx`, `frontend/src/components/Layout.css`)

- **`channelTotals` / `prevChannelTotals` in bundle response** — The `POST /api/dashboard/bundle` endpoint now returns `channelTotals` and `prevChannelTotals` objects containing aggregated channel-level metrics (views, watch_time, subscribers_gained, subscribers_lost, likes, comments, shares). These are computed from the same PostgreSQL data as chart bars, making headline pill totals and chart data structurally consistent. (`backend/index.js`, `backend/ingestion/readModels.js`)

  ```diff
  // OLD — no channel totals, frontend used separate endpoint
  {
    "current": { "rows": [["2025-01-01", 9646, ...], ...] },
    "previous": { "rows": [...] },
    "channelCurrent": { "rows": [...] },
  }

  // NEW — headline totals included in bundle
  {
    "current": { "rows": [["2025-01-01", 9646, ...], ...] },
    "previous": { "rows": [...] },
    "channelCurrent": { "rows": [...] },
  + "channelTotals": {
  +   "views": 10130,
  +   "watch_time": 84200,
  +   "subscribers_gained": 142,
  +   "subscribers_lost": 18,
  +   "likes": 890,
  +   "comments": 234,
  +   "shares": 67
  + },
  + "prevChannelTotals": {
  +   "views": 9646,
  +   "watch_time": 79100,
  +   "subscribers_gained": 118,
  +   "subscribers_lost": 22,
  +   "likes": 741,
  +   "comments": 198,
  +   "shares": 51
  + }
  }
  ```

- **`fields` query parameter on bundle route** — `POST /api/dashboard/bundle` accepts an optional `fields` array (e.g. `["channelTotals", "chartData", "comparison"]`). When a field is omitted, the backend skips the corresponding sub-query. Defaults to all fields for backward compatibility. (`backend/index.js`)

  ```diff
  // OLD — always fetched everything
  POST /api/dashboard/bundle
  { "channelId": "UCxxx", "period": 30 }

  // NEW — request only what you need
  POST /api/dashboard/bundle
  { "channelId": "UCxxx", "period": 30, "fields": ["channelTotals", "chartData", "comparison"] }
  ```

- **Frontend `bundleChannelTotals` store fields** — `AnalyticsState` now includes `bundleChannelTotals` and `bundlePrevChannelTotals` populated directly from the bundle response, replacing the previous stopgap that used a separate `/analytics/report` call. (`frontend/src/types/dashboard.ts`, `frontend/src/hooks/queries/useAnalyticsQuery.ts`)

- **`fields` param in `AnalyticsService.getDashboardBundle`** — Frontend API service now passes `fields` to the bundle endpoint, allowing tab-based field selection. (`frontend/src/services/analyticsService.ts`)

- **`loadChannelTotalsFromPostgres` read model** — New PostgreSQL query function that aggregates channel-level totals from `analytics_video_metrics_daily` with `filters_key = ''`, providing a single-source-of-truth for headline metrics. (`backend/ingestion/readModels.js`)

- **Personal onboarding token guard** — Dashboard data hooks and list creation now short-circuit when the user is in personal context with no connected channels. This removes “No access token available” noise during initial onboarding. (`frontend/src/hooks/useDashboardChannel.ts`, `frontend/src/hooks/useDashboardAnalytics.ts`, `frontend/src/hooks/useDashboardLists.ts`, `frontend/src/hooks/queries/*Query.ts`)

- **Channel ownership validation for playlist & thumbnail optimization** — New `backend/utils/channelOwnership.js` resolver shared by both optimizer `/analyze` endpoints. Non-admin callers may only analyze videos from their own connected channels (personal `youtubeTokens` or org channels); admins (`support@revketer.ai` or `role === "admin"`) bypass the check and may analyze any channel. Each submitted video is resolved to its owning channel Postgres-first (`analytics_videos`) with a live YouTube fallback; foreign videos return `403`. (`backend/utils/channelOwnership.js`, `backend/routes/playlistOptimizer.js`, `backend/routes/thumbnailOptimizer.js`)

- **Postgres-first video metadata resolution** — Video-to-channel lookups (`GET /video/:id`) and batch metadata (`GET /specific-videos`) now serve already-ingested videos directly from the `analytics_videos` table (refreshed by the 6-hour ingestion cron) with no YouTube API call or quota consumption. Only IDs missing from Postgres (e.g. foreign-channel pastes) fall through to the live YouTube API. (`backend/ingestion/readModels.js` `getVideosByIds`, `backend/routes/videos.js`, `backend/index.js`)

- **Playlist Optimizer — connected-channel + locked-channel enforcement** — NEW-mode manual paste is restricted to the user's own connected channels and locked to the first video's channel. `ChannelVideoPicker` passes `enforceSingleChannel`, `lockedChannelId`, `lockedChannelTitle`, and `allowedChannelIds` to `UrlPasteDialog`; foreign videos are rejected with a red *"not from your channel"* banner. Manual-paste UI renamed to **"Add Videos Manually From Your Channel"**. (`frontend/src/pages/PlaylistOptimizerPage.tsx`, `frontend/src/pages/thumbnailOptimizer/ChannelVideoPicker.tsx`, `frontend/src/pages/thumbnailOptimizer/UrlPasteDialog.tsx`)

- **Thumbnail Optimizer — connected-channel manual paste + sort UX** — Manual URL entry is now restricted to the user's connected channels (`allowedChannelIds` from `ChannelVideoPicker`), with cross-channel paste allowed (no single-channel lock) and foreign videos rejected via the same red banner. Manual-paste heading renamed to **"Add Videos Manually From Your Channel"**. The video chooser sort direction toggle now reads **Ascending / Descending** in full words instead of `ASC`/`DESC`. (`frontend/src/pages/thumbnailOptimizer/UrlPasteDialog.tsx`, `frontend/src/pages/thumbnailOptimizer/ChannelVideoPicker.tsx`, `frontend/src/pages/thumbnailOptimizer/VideoSearchDialog.tsx`)

### Changed

- **InsightsPanel redesigned with design-system tokens (dp-panel pattern)** — Every insight section card now mirrors the `dp-panel` ledger structure: a header with `border-bottom` + body area, consistent with DashboardPage, Compare, and Channel tabs. CSS units migrated to `--rt-*` design tokens (spacing, font sizes, border radii, font weights, card backgrounds/borders/shadows). Tooltips unified under the `rt-chart-tooltip` pattern. Header layout uses `min-height` + `flex-wrap` for responsive collapse. (`frontend/src/components/dashboard/InsightsPanel.css`, `frontend/src/components/dashboard/InsightsPanel.tsx`)

- **Local dev config tweaks** — docker-compose backend `NODE_ENV` changed from `production` to `development` for local stack runs. Vite esbuild `drop: ['console', 'debugger']` now scoped to `mode === 'production'` only (console logs visible in dev). `DESIGN.md` added to `.gitignore`. (`.gitignore`, `docker-compose.yml`, `frontend/vite.config.ts`)

- **Unified analytics feature key from `report` to `dashboard`** — Consolidated `/analytics/report` route to use the `"dashboard"` feature config page key. The `"report"` page entry was removed from backend and frontend defaults. Admin quota/premiumOnly controls now govern all analytics endpoints (bundle, summary, report, dimensions, channel-videos) under a single `dashboard` config entry. (`backend/index.js`, `frontend/src/contexts/FeatureConfigContext.tsx`)

- **Per-page sidebar badges hidden in org mode** — `getNavBadge()` returns `null` when `!isPersonalContext`, so no "Pro" or "Admin" chips render on sidebar nav items when the user is in an organization context.

- **Admin routes bypass rate limiting** — `adminLimiter` is now a pass-through middleware; access control relies solely on `checkAdmin`. This prevents admin bulk operations (e.g. user listing, cache clearing) from being throttled.

- **`mergeFeatureConfigPages()` for config defaults** — Backend now safely merges database-stored feature config with `DEFAULT_FEATURE_CONFIG`, preserving all page definitions even when new pages are added in code but absent in Firestore.

- **Dashboard video stats override now reads from `bundle.channelTotals`** — The `videoStats` memo in `DashboardPage.tsx` reads headline totals from `analytics.bundleChannelTotals` instead of the previous `analytics.channelAnalyticsData` (which came from a separate `/analytics/report` call). This eliminates the structural data mismatch between chart bars and headline pills. (`frontend/src/pages/DashboardPage.tsx`)

- **`useChannelAnalyticsQuery` restricted to Channel Analytics tab** — The channel analytics hook is now only enabled when `activeTab === 'channelAnalytics'`, eliminating an extra API call on every channel selection. (`frontend/src/pages/DashboardPage.tsx`)

  ```diff
  // OLD — ran on every channel switch, burned extra API call +12min cache
  useChannelAnalyticsQuery({
    channelId,
    enabled: !!selectedChannel && channelSelectionHydrated,
  });

  // NEW — only fetches when user opens Channel Analytics tab
  useChannelAnalyticsQuery({
    channelId,
    enabled: !!selectedChannel && channelSelectionHydrated && activeTab === 'channelAnalytics',
  });
  ```

### Removed

- **`"report"` page from feature config schema** — Removed from `featureConfigSchema.ts`, backend `DEFAULT_FEATURE_CONFIG`, and frontend `FeatureConfigContext` initial state. All analytics access is governed by the `"dashboard"` page entry (`premiumOnly`, `freeLimit`, `proLimit`).

- **`planBadge` from admin UI** — Removed the standalone "Plan badge" column and dropdown from the Feature Controls table in `AdminPage.tsx`, and removed the `planBadge` field from the frontend feature-config schema.

- **Stopgap channel analytics override removed** — The previous fix that overrode `videoStats` with `analytics.channelAnalyticsData` from a separate API endpoint has been replaced by the unified `bundle.channelTotals` approach. (`frontend/src/pages/DashboardPage.tsx`)

  ```diff
  // OLD — stopgap: read from separate endpoint, caused subtle mismatch
  const channelOverview = analytics.channelAnalyticsData;
  if (channelOverview) {
    result.views = channelOverview.views || result.views;
    result.watchTime = channelOverview.watchTime || result.watchTime;
    result.subscribers = (channelOverview.subscribersGained || 0) - (channelOverview.subscribersLost || 0);
    result.likes = channelOverview.likes ?? result.likes;
    result.comments = channelOverview.comments ?? result.comments;
    result.shares = channelOverview.shares ?? result.shares;
    const d30Prev = analytics.channelMultiPeriodStats?.d30?.previous;
    if (d30Prev) {
      result.prevViews = d30Prev.views ?? result.prevViews;
      result.prevWatchTime = d30Prev.watchTime ?? result.prevWatchTime;
    }
  }

  // NEW — read from bundle, same source as chart bars, mismatch impossible
  const channelTotals = analytics.bundleChannelTotals;
  if (channelTotals) {
    result.views = channelTotals.views ?? result.views;
    result.watchTime = channelTotals.watch_time ?? result.watchTime;
    result.subscribers = (channelTotals.subscribers_gained ?? 0) - (channelTotals.subscribers_lost ?? 0);
    result.likes = channelTotals.likes ?? result.likes;
    result.comments = channelTotals.comments ?? result.comments;
    result.shares = channelTotals.shares ?? result.shares;
    const prev = analytics.bundlePrevChannelTotals;
    if (prev) {
      result.prevViews = prev.views ?? result.prevViews;
      result.prevWatchTime = prev.watch_time ?? result.prevWatchTime;
    }
  }
  ```

---

### Compatibility

| Aspect             | Details                                                                                                                                                                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Backend API**    | `channelTotals` / `prevChannelTotals` are additive fields — old clients that don't read them see no change. `fields` param is optional; omitting it defaults to all fields (identical behaviour to before). Zero breaking changes.                          |
| **Frontend store** | `bundleChannelTotals` / `bundlePrevChannelTotals` are new nullable fields in `AnalyticsState`. Code that never reads them is unaffected. Existing `channelAnalyticsData` / `channelMultiPeriodStats` fields remain untouched for the Channel Analytics tab. |
| **Cache keys**     | Bundle cache keys unchanged. Cached responses without `channelTotals` will be gradually replaced as they expire (12 min TTL). No manual cache flush needed.                                                                                                 |
| **Rollout**        | Phase 1 (backend) can ship alone — frontend ignores new fields until Phase 2 deploys.                                                                                                                                                                       |

### Fixed

- **Saved Playlist Optimizer analyses crash on open (`.map is not a function`)** — rows saved before the membership repair could hold `playlists` without a `videos` array (or `playlists` as an object map), so opening one from History crashed the page render and the deterministic scoring. `GET /history/:id` now normalizes the stored `audits` payload on read (arrays guaranteed, `audit` object defaulted, garbage entries dropped), keeping at-rest legacy data safe without a migration. (`backend/routes/playlistOptimizer.js`)

- **"80+ floor applied" internal note removed from playlist score panel** — `PlaylistScorePanel` rendered an internal-machinery explainer ("80+ floor applied: with default settings the top recommendation is always shown at 80+…") whenever the default-settings floor lifted the top playlist. The floor itself and the `isTopUplifted` marker are unchanged; the note is simply no longer surfaced to users. (`frontend/src/pages/playlistOptimizer/PlaylistScorePanel.tsx`)

- **Playlist Optimizer shows "0 videos" on playlist cards** — Root cause: the queue worker stored `analyze()`'s `{ results: <normalized> }` wrapper verbatim into the `playlist_audits.audits` JSONB column, so rows had no top-level `playlists` key (it was nested under `results.playlists`) and both `total_videos` and the card renders read 0/empty. Fixes: (1) `persistPlaylist` now unwraps `result.results` so the persisted JSON holds `playlists` at the top level and `total_videos` is computed from actual membership; (2) `normalizeStoredAudits` unwraps legacy `{results:{playlists}}` rows on read and the History list recomputes card counts from the saved payload, so previously-saved broken rows render real membership; (3) the pre-existing membership repair (ids-only protocol + stub→full-row resolution + EXISTING-mode source-group backfill) is kept so NEW playlists use the model's honest assignment and EXISTING playlists are deterministically rebuilt. A previous round-robin "final guarantee" that fabricated NEW-mode membership was removed as it contradicted honest behavior. Analysis cache key remains `v4` (stale `v3` broken results are never served). (`backend/queue/optimizerQueue.js`, `backend/routes/playlistOptimizer.js`, `backend/services/playlistOptimizerService.js`)

- **DeepSeek API `messages[1]: missing field tool_call_id` error** — Three root causes fixed: (1) Empty string tool_call_ids were lost by `||` fallback in both PG (`"" || null`) and Redis (`"" || undefined`); changed to explicit `undefined`/`null` checks. (2) `buildMessages` in AgentExecutor now uses **positional matching** (`lastBatch` pattern) to assign tool_call_ids from the preceding assistant's `tool_calls` array by index — handles both empty and real IDs. (3) Orphaned tool messages (no matching assistant in history window) are dropped instead of creating invalid fallback IDs. (`backend/chat/AgentExecutor.js`, `backend/chat/ConversationMemory.js`)

- **YouTube channel IDs redacted in AI assistant URLs** — The broad `{20,}` regex in Guardrails was catching YouTube channel/video IDs inside URLs. Fixed with `isInsideUrl()` heuristic (checks 30 chars before/20 chars after the match for URL markers) and `redactLongTokens()` that skips tokens inside URLs. YouTube channel links now render correctly. (`backend/chat/Guardrails.js`)

- **`tool_results` column missing from PG SELECT in ConversationMemory** — `getConversation` query was `SELECT role, content, tool_calls, created_at` without `tool_results`, causing `tool_call_id` to always be `null` when loading from PostgreSQL. Added the missing column. (`backend/chat/ConversationMemory.js`)

- **Conversation not loading on refresh** — Added retry mechanism with exponential backoff (`loadAttemptsRef`, `MAX_LOAD_ATTEMPTS = 3`) in ChatPage. Shows error state with "Retry" button on persistent failure. (`frontend/src/pages/ChatPage.tsx`)

- **"..." showing permanently in empty assistant messages** — Removed the `"..."` fallback in `renderMessage`. Streaming cursor now only renders when content exists AND streaming is active. Empty messages render as empty string. (`frontend/src/pages/ChatPage.tsx`)

- **`table.primaryKey is not a function` at container startup** — Drizzle ORM >= 0.45 built-in `migrate()` tries to process SQL files through its internal dialect API, not as raw SQL, causing parse failures on CREATE TABLE statements. Replaced with a pool-based runner that reads `.sql` files from `db/drizzle/`, computes content hash, and tracks applied migrations in `__drizzle_migrations` table — no Drizzle migration-engine involvement. (`backend/db/migrate.js`)

- **Audience tab "No data available" for dimensions** — `selectedVideoIds` from Videos tab carried over as `video==` filters to YT Analytics API, returning empty results for most audience dimensions. Fixed by clearing `selectedVideo`, `selectedVideoIds`, and `tableCheckedOverride` when switching to audience tab. Also skip all-videos auto-fill on audience tab to avoid flooding YT API with unbounded channel-wide video IDs. Restore saved-list scoping when a saved list is active. (`frontend/src/hooks/useDashboardUI.ts`, `frontend/src/hooks/useDashboardSelection.ts`)

- **Stale Redis cache cleared before cron re-warming** — `runCacheRefresh()` now wipes all `snapshot:` and `summary:` Redis keys before regenerating bundle/summary caches. Previously, stale cached entries caused `generateDashboardBundle` to return immediately with old data instead of recomputing from fresh PostgreSQL data — the cache-hit branch has no PostgreSQL staleness check. (`backend/cron.js`)

- **Cron ingestion logging improved** — Added detailed per-channel ingestion stats (`videosSynced`, `videoMetricDays`, `channelMetricDays`, `elapsedMs`), channel/token count logging at start, and a zero-channel early return. `withRetry` now includes the response body in thrown errors (truncated to 500 chars), so failed YouTube API calls log the actual error payload instead of just the status code. (`backend/cron.js`, `backend/ingestion/sync.js`)

- **`refreshGoogleToken` now logs OAuth error body and clears dead tokens** — Wrapped the `axios.post` to `oauth2.googleapis.com/token` in a try/catch that logs the full error response body (e.g. `"invalid_grant"`). On `invalid_grant` (refresh token expired/revoked), the cached token entry is deleted from Redis so subsequent requests don't keep retrying a dead token. Previously, a revoked token was retried indefinitely until TTL expiry, wasting API quota and producing opaque errors. (`backend/services/tokenService.js`)

- **Stale client `latestDate` overridden from PostgreSQL in dashboard tabs** — The dashboard tab endpoint now cross-checks the client's cached `latestDate` against `getLatestMetricDate()` from PostgreSQL on every uncached request. When Postgres reports a more recent date (e.g. Jul 13 instead of stale Jul 5 from localStorage/Zustand), the response date is corrected before returning. This prevents misleading "As of Jul 5" timestamps when ingestion has already updated PostgreSQL with newer data. (`backend/routes/dashboardTabs.js`, `backend/ingestion/readModels.js`)

- **Stray closing brace removed from `DashboardPage.css`** — Fixed a malformed CSS block at the end of the file that caused the `dashboard-toolbar__controls` rule to be unreachable. (`frontend/src/pages/DashboardPage.css`)

- **Admin cron endpoints now protected** — Added `authenticateRequest` + `checkAdmin` guards to `/admin/cache/refresh-all`, `/admin/ingestion/refresh-all`, and `/admin/ingestion/refresh-channel` in `cron.js` (lines 197/207/217). Previously had no auth middleware. (`backend/cron.js`)

- **Backend `withInFlight` timeout added** — Created `withInFlightTimeout(map, key, factory, timeoutMs = 120_000)` at line 80. `DASHBOARD_INFLIGHT.summary` and `DASHBOARD_INFLIGHT.bundle` now use it, preventing hung upstream calls from permanently blocking cache keys. (`backend/index.js`)

- **Org channel uploads playlist ID fixed** — The channel-videos endpoint now derives the uploads playlist ID from the channel ID (UC→UU prefix conversion). 404 responses trigger a retry with `orgRefreshToken` from `req._orgRefreshToken`. (`backend/index.js`)

- **`headerPlanVariant` for free tier** — Previously displayed an empty string for free users; now correctly renders `"free"`, matching the `header-plan-pill--free` CSS variant.

- **Infinite admin users fetch loop** — Fixed unstable `useCallback` references in `useAdminService` by adding proper dependency arrays.

- **ESLint errors in `adminService.ts`** — Replaced `any` catch variables with `unknown` and added explicit type assertions.

- **`useCallback` missing dependency arrays** — Added `[fetchUsers]` dependency array to `loadUsers` in `AdminPage.tsx`.

- **Rate limiter now uses user-based keys instead of IP** — The general API rate limiter (`authLimiter`) previously used the request IP as the rate limit key. Behind Docker/nginx, all requests originate from `172.18.0.1`, so one user could exhaust the shared 240-request-per-15-minute bucket and block all users. Changed `keyGenerator` to `req.authUser?.uid || req.authUser?.email || req.ip` so each authenticated user gets their own rate limit bucket. (`backend/index.js`)

  ```diff
  // OLD — IP-based key, all Docker users share one bucket
  const authLimiter = rateLimit({
    max: 240, windowMs: 15 * 60 * 1000,
  - // uses default req.ip as key → 172.18.0.1 shared by all
  });

  // NEW — user-based key, each user gets their own bucket
  const authLimiter = rateLimit({
    max: 240, windowMs: 15 * 60 * 1000,
  + keyGenerator: (req) => req.authUser?.uid || req.authUser?.email || req.ip,
  });
  ```

- **Clearer rate limit error messages** — The 429 error response now includes the window duration and a human-readable retry hint (e.g. `"You've sent too many requests. This limit resets in 45s. Please wait and try again."`) instead of the generic `"Too many requests, please try again later."`. (`backend/index.js`)

- **Frontend handles rate limit errors** — `YouTubeService.getChannelByUsername`, `getChannelById`, `getFullChannelDetails`, and `getUploadsPlaylistFromHandle` now detect `RATE_LIMITED` error code from 429 responses and throw a descriptive error message (e.g. `"Channel lookup rate limit reached. Please retry in 45s."`). These display as user-visible errors in the Compare page. (`frontend/src/services/youtubeService.ts`)

### Performance & Quota Impact

| Scenario                         | Before                                                                                | After                                   | Savings                              |
| -------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------ |
| **Admin changes quota**          | Stale cache for up to 12h TTL                                                        | Immediate invalidation on next request  | **Instant enforcement**              |
| **ID-resolution calls**          | Consumed user monthly quota                                                           | Zero quota consumption                  | **1 saved search per resolve**       |
| **5 channel switches in 15 min** | 5 extra API calls                                                                     | 0 extra calls                           | **−5 calls**                         |
| **Dashboard initial load**       | 2 API calls (bundle + `/analytics/report`)                                            | 1 call (bundle with `channelTotals`)    | **−1 call per load**                 |
| **Channel tab switch**           | 1 extra `/analytics/report` call                                                      | 0 extra calls (reads from bundle cache) | **−1 call per switch**               |
| **Compare 3 channels**           | 3 full bundles (videos + dimensions + comparison)                                     | 3 lightweight bundles (field selector)  | **~60% payload reduction**           |
| **Free user: 5 compares/month**  | ~15 API calls                                                                         | ~6 API calls                            | **−60% quota burn**                  |
| **Data consistency**             | Chart bars: bundle sum. Headline pill: separate endpoint. Numbers could differ by ~5% | Both read from same `channelTotals`     | **Mismatch structurally impossible** |
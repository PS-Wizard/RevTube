# Playlist Optimizer

The Playlist Optimizer analyzes YouTube video metadata through the **DeepSeek Chat API** and produces structured playlist strategy recommendations with SEO metadata, audit scores, SWOT analysis, and multi-format export (JSON, CSV, PDF, ZIP). It was ported from the standalone RevTube-Playlist project and integrated as a first-class RevTube feature following the same architecture pattern as the Thumbnail Optimizer but with zero coupling between them.

## Architecture

```
Browser                         Backend (Express)                    DeepSeek API
──────                          ────────────────                    ────────────

POST /api/playlist-optimizer/jobs
  ──► resolveUser ──► checkPremiumAccess ──► requireQuota ──► ownership validateVideos
       │
       ▼
  enqueueOptimizer({ kind: 'playlist', payload, uid, email, orgId })
    ──► BullMQ 'optimizer' queue worker (backend/queue/optimizerQueue.js)
         ├─► playlistOptimizerService.analyze()
         ├─► INSERT INTO playlist_audits   (worker persists, no client save call)
         └─► return { savedId, kind, result }
                │
                ▼
       worker 'completed' ──► handleAuditCompleted
           └─► in-app notification + email + OS toast

  Browser keeps jobId in sessionStorage (useSessionJobId) and polls
  GET /api/playlist-optimizer/jobs/:id every 4s. The Layout-level
  useOptimizerJobWatcher keeps polling even after page nav / tab close.

  ── SYNC ANALYZE FLOW (still supported, direct callers) ──
  POST /api/playlist-optimizer/analyze → immediate response, no notification

  ── HISTORY FLOW ──
  GET /api/playlist-optimizer/history         → paginated list
  GET /api/playlist-optimizer/history/:id     → full analysis
  DELETE /api/playlist-optimizer/history/:id  → remove
```

## Key Design Decisions

| Decision                        | Rationale                                                                                                                                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DeepSeek over Gemini**        | Non-visual analysis only -- DeepSeek's large context window (128k+) handles the full video set in one API call, avoiding the chunking needed in the original Gemini-based RevTube-Playlist app |
| **Server-side AI calls**        | API key never reaches the browser. All 3rd-party AI requests route through the Express backend, matching the Thumbnail Optimizer security model                                                |
| **Single call, no chunking**    | DeepSeek's context accommodates 500 videos in one prompt with the structured JSON response schema                                                                                              |
| **Auto-save**                   | After every successful analysis, results are automatically saved to PostgreSQL -- no manual "Save" button or dialog shown to users                                                             |
| **Minimum coupling**            | No shared state, types, or inheritance with the Thumbnail Optimizer. If one changes, the other is unaffected                                                                                   |
| **Same middleware chain**       | Reuses existing `resolveUser`, `checkPremiumAccess`, and `requireQuota` -- no new middleware needed                                                                                            |
| **Mode-based picker switching** | "New Playlist(s) Strategy" mode shows individual video picker; "Optimize Existing Playlist(s)" mode shows playlist picker -- each opens the appropriate dialog for the workflow                |
| **Membership repair after parse** | DeepSeek may return empty/truncated `videos[]`; the prompt uses an **ids-only membership protocol** (model echoes only input-row GUID strings), and post-parse any echoed stubs (objects or bare id strings) are re-resolved to full input rows and EXISTING-mode playlists backfilled from their source grouping -- deterministic, no second LLM call. Genuinely unmatched NEW-mode playlists stay honestly empty rather than inventing members. The worker unwraps `analyze()`'s `{results}` so `playlists` are persisted at the top level (and read-time normalization unwraps legacy rows), so counts always reflect real membership. Cache key is bumped to `v4` so stale pre-fix results are never served |

## Key Files

### Backend

| File                                           | Purpose                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/services/playlistOptimizerService.js` | DeepSeek API proxy -- prompt construction, response parsing, retry with exponential backoff, ServerCache integration, unique playlist ID dedup                                                                                                                                                                   |
| `backend/routes/playlistOptimizer.js`          | Express router -- `POST /jobs`, `GET /jobs/:id`, `POST /analyze`, `POST /save`, `GET /history`, `GET /history/:id`, `DELETE /history/:id` with auth, premium access, and quota middleware chain. `/jobs` and `/analyze` run server-side channel ownership validation                                                                                    |
| `backend/queue/optimizerQueue.js`              | BullMQ job processor shared with the Thumbnail Optimizer -- dispatches on `job.data.kind`, runs `playlistOptimizerService.analyze`, persists to `playlist_audits`, returns `{ savedId, kind, result }`                                                                                                                                             |
| `backend/utils/channelOwnership.js`            | Shared validator -- `isAdminRequest()`, `getConnectedChannelIds()` (org or personal channels from Firestore), `resolveVideoChannelIds()` (Postgres-first with YouTube fallback), and `validateVideos()` used by both optimizer `/analyze` endpoints. Admins bypass; non-admins are limited to connected channels |
| `backend/db/drizzle/0008_playlist_audits.sql`  | PostgreSQL migration -- `playlist_audits` table + indexes                                                                                                                                                                                                                                                        |
| `backend/config/featureConfig.js`              | Page config: `freeLimit: 5`, `proLimit: 100`, `premiumOnly: false`                                                                                                                                                                                                                                               |
| `backend/index.js`                             | Wiring -- service + router creation, DI injection, route mount                                                                                                                                                                                                                                                   |

### Frontend

| File                                                              | Purpose                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frontend/src/types/playlistOptimizer.ts`                         | TypeScript interfaces (`Video`, `PlaylistRecommendation`, `AuditData`, `AnalysisResult`, `FilterConfig`, API types)                                                                                                                                                                                                                                     |
| `frontend/src/services/playlistOptimizerService.ts`               | API client with generic `authFetch<T>()` helper -- `enqueueJob()`, `getJobStatus()`, `analyze()`, `save()`, `history()`, `getHistory()`, `deleteHistory()`                                                                                                                                                                                            |
| `frontend/src/services/playlistOptimizerExport.ts`                | Export generators -- `downloadJSON()`, `downloadCSV()` (5 view modes), `downloadPDF()` (jsPDF with SWOT/playlist cards), `downloadMasterZip()` (all formats bundled)                                                                                                                                                                                    |
| `frontend/src/hooks/useSessionJobId.ts`                           | Persists the in-flight jobId in `sessionStorage` (`rt:jobId:playlist-optimizer[:org:{orgId}]`) so a running analysis survives navigation/tab close (shared with Thumbnail Optimizer + Video Audit)                                                                                                                                                      |
| `frontend/src/hooks/useOptimizerJobWatcher.ts`                    | App-level poller mounted in `Layout` -- reads leftover optimizer jobIds from sessionStorage, polls every 5s, clears the key once completed/failed                                                                                                                                                                                                      |
| `frontend/src/pages/playlist-optimizer/PlaylistOptimizerPage.tsx`                    | Main user page -- video/playlist input, mode toggle (NEW/EXISTING), settings panel, 5-tab result views, background-job enqueue + polling, export dropdown                                                                                                                                                                                               |
| `frontend/src/pages/playlist-optimizer/PlaylistOptimizerPage.css`                    | Styles for all page components -- cards, badges, tables, SWOT, playlist groups                                                                                                                                                                                                                                                                          |
| `frontend/src/pages/playlist-optimizer/AdminPlaylistOptimizer.tsx` | Admin-only variant -- manual URL entry only, no save/history, simplified result rendering with export                                                                                                                                                                                                                                                   |
| `frontend/src/pages/playlist-optimizer/PlaylistHistoryPanel.tsx`   | Saved analyses panel -- paginated list, search, load, delete with confirmation                                                                                                                                                                                                                                                                          |
| `frontend/src/pages/playlist-optimizer/PlaylistVideoTable.tsx`     | "Included Videos & Data" cross-video comparison table rendered above the Channel Audit -- video, channel, playlist, publish date, views, 7d/30d/90d, time-decay weight + tier                                                                                                             |
| `frontend/src/pages/playlist-optimizer/PlaylistAnalysisDetails.tsx` | "Analysis Details" panel showing what data was used -- channel, mode, data range, videos, playlists included, filters, target strategy                                                                                                                                                   |
| `frontend/src/utils/playlistDecay.ts`                            | Client-side mirror of the backend time-decay formula (`computeDecay`, `computeVideoInsights`) -- fallback table source when a result predates `videoInsights`                                                                                                                             |
| `frontend/src/utils/playlistScoring.ts`                          | Deterministic per-playlist quality scoring (`scorePlaylist`, `scoreAllPlaylists`, `isDefaultSettings`) -- signals, deductions, raise-it tips, and the default-settings 80+ floor                                                                                                           |
| `frontend/src/pages/playlist-optimizer/PlaylistScorePanel.tsx`    | Per-card "Why this score" + "Raise it" breakdown rendered under each playlist's Score                                                                                                                               |
| `frontend/src/pages/playlist-optimizer/PlaylistPickerDialog.tsx`   | Dialog for EXISTING mode -- lists channel playlists with checkboxes, fetches all videos from selected playlists                                                                                                                                                                                                                                         |
| `frontend/src/pages/playlist-optimizer/ChannelPlaylistPicker.tsx`  | Channel selection component that opens PlaylistPickerDialog, shows selected playlist count                                                                                                                                                                                                                                                              |
| `frontend/src/pages/thumbnail-optimizer/ChannelVideoPicker.tsx`    | Reused in NEW mode -- side-by-side layout: browse channels with search + paste URLs directly. Combines both sources into one list. Passes `enforceSingleChannel`, `lockedChannelId`, `lockedChannelTitle`, and its connected `channels` as `allowedChannelIds` to the dialogs                                                                           |
| `frontend/src/pages/thumbnail-optimizer/VideoSearchDialog.tsx`     | Reused in NEW mode -- search and select individual videos. Supports sort by date/views/title with a **Ascending / Descending** direction toggle, view count display, progressive server-side loading beyond 200 videos. Accepts `initialSelectedIds` to pre-check videos from URL paste. When `lockedChannelId` is set the channel dropdown is disabled |
| `frontend/src/pages/thumbnail-optimizer/UrlPasteDialog.tsx`        | Reused in NEW mode -- multi-line textarea for pasting YouTube URLs (regular + Shorts), shown as removable chips. Validates pasted URLs against `allowedChannelIds` (connected channels) with a red _"not from your channel"_ banner, and when `enforceSingleChannel` is set also enforces the locked-channel rule                                       |
| `frontend/src/components/Layout.tsx`                              | Nav item under Channel Analytics section, `pageKeyMap` entry                                                                                                                                                                                                                                                                                            |
| `frontend/src/pages/admin/AdminPage.tsx`                                | Admin tab registration for admin/playlist-optimizer                                                                                                                                                                                                                                                                                                     |

## API Endpoints

| Method   | Path                                  | Auth     | Quota               | Description                                                             |
| -------- | ------------------------------------- | -------- | ------------------- | ----------------------------------------------------------------------- |
| `POST`   | `/api/playlist-optimizer/jobs`        | Required | `playlistOptimizer` | Enqueue a background playlist analysis (survives nav/tab close). Returns `{ jobId }` |
| `GET`    | `/api/playlist-optimizer/jobs/:id`    | Required | --                  | Poll a background job: `{ jobId, state, progress, result? }`           |
| `POST`   | `/api/playlist-optimizer/analyze`     | Required | `playlistOptimizer` | Analyze videos and generate playlist optimization strategy via DeepSeek (sync) |
| `POST`   | `/api/playlist-optimizer/save`        | Required | --                  | Persist a completed analysis to `playlist_audits` table (manual save on sync path) |
| `GET`    | `/api/playlist-optimizer/history`     | Required | --                  | List saved analysis summaries (paginated, searchable)                   |
| `GET`    | `/api/playlist-optimizer/history/by-video/:videoId` | Required | --        | Newest analysis whose recommendation cards contain this item id; returns `{ id } \| null`. Powers the Optimized Content View Audit deep-link |
| `GET`    | `/api/playlist-optimizer/history/:id` | Required | --                  | Retrieve a single saved analysis with full results (audits normalized on read — `playlists[]`/`videos[]`/`unassignedVideos[]` guaranteed arrays) |
| `DELETE` | `/api/playlist-optimizer/history/:id` | Required | --                  | Delete a saved analysis                                                 |

### Enqueue Job Request

Same shape as the sync analyze body plus optional `channelId` / `channelTitle`:

```json
{
  "channelIdentifier": "@channelname or UCxxxxxx",
  "videos": [ /* Analyze Request videos shape */ ],
  "filterConfig": { /* Analyze Request filterConfig shape */ },
  "channelId": "UC...",
  "channelTitle": "My Channel"
}
```

`videos` capped at 500. Before enqueueing, the route runs `channelOwnership.validateVideos` so non-admins may only submit videos from their own connected channels. Returns `{ jobId }`.

### Job Status Response

```json
{
  "jobId": "bull:optimizer:abc123",
  "state": "completed",
  "progress": 100,
  "result": { "savedId": 42, "kind": "playlist", "result": { /* full AnalysisResult */ } }
}
```

`state` is `waiting` / `active` / `completed` / `failed`. `result` present only when `completed`; the worker already persisted the analysis to `playlist_audits` (`savedId`), so no client-side `save()` call is needed.

### Background Job Flow

The user-facing page now runs analyses as **BullMQ background jobs** instead of a blocking axios POST, so an analysis survives navigating to another page or closing the tab:

1. `PlaylistOptimizerPage.runAnalysis` builds the request (with locked channel id/title) and calls `PlaylistOptimizerService.enqueueJob(...)` (`POST /jobs`), which returns a `jobId`.
2. The `jobId` is stored via `useSessionJobId('playlist-optimizer', orgId)` in `sessionStorage` (key `rt:jobId:playlist-optimizer[:org:{orgId}]`).
3. The page polls `GET /jobs/:id` every 4s. On `completed` it renders `result.result`, clears the jobId, and switches to the results view. The worker already persisted the analysis, so it also appears in Saved Analyses.
4. If the user navigates away, the Layout-level `useOptimizerJobWatcher` keeps polling the same jobId every 5s and only handles cleanup. The backend `completed` event fires the in-app notification + email + OS toast via `handleAuditCompleted`, surfaced by `NotificationBell` (which polls globally every 30s).

The sync `POST /analyze` endpoint remains for direct callers.

### Analyze Request

```json
{
  "channelIdentifier": "@channelname or UCxxxxxx",
  "videos": [
    {
      "id": "video_id_11chars",
      "videoId": "video_id_11chars",
      "title": "My Video",
      "url": "https://youtube.com/watch?v=...",
      "originalPlaylistId": "PLxxxxxx",
      "channelId": "UCxxxxxx",
      "channelTitle": "My Channel",
      "customMetadata": { "originalPlaylistTitle": "My Playlist" }
    }
  ],
  "filterConfig": {
    "analysisMode": "NEW | EXISTING",
    "excludeKeywords": "montage, shorts",
    "maxPlaylists": 5,
    "minPlaylists": 2,
    "minVideosPerPlaylist": 3,
    "useTimeDecay": true,
    "enableTargetPlaylist": true,
    "targetName": "React Tutorials",
    "targetTopic": "React.js",
    "targetCriteria": "beginner-friendly",
    "targetGoal": "increase watch time",
    "targetAudience": "web developers"
  }
}
```

- `videos` array capped at 500 items
- `channelIdentifier` is optional -- helps DeepSeek contextualize the channel niche. Auto-populated from locked channel when single-channel restriction is enforced
- `filterConfig` is optional -- defaults applied server-side
- `analysisMode` determines whether DeepSeek optimizes existing playlists or creates fresh recommendations
- `originalPlaylistId` links each video to its source playlist (EXISTING mode)
- `channelId` and `channelTitle` are populated for videos in NEW mode (resolved from first video's channel)

**Server-side ownership validation**: Before calling DeepSeek, the `/analyze` handler runs `channelOwnership.validateVideos(req, cleanVideos)` on non-admin callers. Each submitted video is resolved to its owning channel (Postgres-first via `analytics_videos`, with a live YouTube fallback) and checked against the caller's connected channels. Any foreign video returns `403` with _"N video(s) are not from your connected channels. Only videos from your connected channels can be analyzed."_ **Admins bypass this check** and may analyze any channel's videos.

### Analyze Response

```json
{
  "results": {
    "audit": {
      "channelScore": 7,
      "contentHealthScore": 6,
      "audiencePersona": "Tech learners",
      "primaryNiche": "Web development",
      "contentStrengths": ["Consistent branding", "Good keyword usage"],
      "contentWeaknesses": ["No playlist descriptions"],
      "missedOpportunities": ["Create themed series"],
      "metadataAnalysis": "Channel metadata shows strong title optimization...",
      "totalVideosAnalyzed": 15,
      "existingPlaylists": [
        { "playlistId": "PL...", "title": "React Basics", "videoCount": 10 }
      ]
    },
    "playlists": [
      {
        "id": "pl-uuid",
        "title": "Getting Started with React",
        "description": "A curated playlist for React beginners...",
        "keywords": ["react tutorial", "react for beginners"],
        "tags": ["#reactjs", "#webdev"],
        "reasoning": "Grouped by topic difficulty progression",
        "why": "Beginners need a structured learning path",
        "viralityScore": 8,
        "predictedReach": "High",
        "currentTitle": "Old Playlist Name",
        "currentViralityScore": 5,
        "videos": [
          { "id": "abc123", "videoId": "abc123", "title": "React Basics" }
        ],
        "engagementPrediction": "High watch time expected",
        "topic": "React.js",
        "criteria": "beginner-friendly"
      }
    ],
    "unassignedVideos": [
      {
        "id": "xyz789",
        "videoId": "xyz789",
        "reason": "Does not fit any playlist theme"
      }
    ],
    "videoInsights": [
      {
        "videoId": "abc123",
        "title": "React Basics",
        "url": "https://youtube.com/watch?v=abc123",
        "channelTitle": "My Channel",
        "playlistId": "PL...",
        "playlistTitle": "React Basics",
        "publishDate": "2026-01-10T00:00:00.000Z",
        "ageDays": 213,
        "views": 48210,
        "views7": 0,
        "views30": 0,
        "views90": 0,
        "decayWeight": 0.841,
        "decayTier": "High"
      }
    ],
    "analysisMeta": {
      "channelIdentifier": "@mychannel",
      "mode": "EXISTING",
      "dataRange": "30d",
      "videoCount": 3,
      "playlistsIncluded": [
        { "playlistId": "PL...", "title": "React Basics", "videoCount": 2 }
      ],
      "filters": {
        "excludeKeywords": "montage",
        "maxPlaylists": 5,
        "enableTargetPlaylist": false
      }
    },
    "summary": "Channel has strong tutorial content..."
  }
}
```

`videoInsights` and `analysisMeta` are computed server-side and echoed back so the UI can render the **Included Videos & Data** table and the **Analysis Details** panel (channel, mode, data range, playlists included, filters used). They also persist into saved history, so a loaded analysis renders the same context.

### Save Analysis Request

```json
{
  "name": "Weekly review - Dec 2024",
  "audits": {
    /* full AnalysisResult */
  },
  "errors": [{ "url": "...", "error": "..." }],
  "channelId": "UC...",
  "channelTitle": "My Channel"
}
```

### Save Analysis Response

```json
{
  "id": 42,
  "createdAt": "2024-12-15T10:30:00.000Z"
}
```

### History List Response

```json
{
  "items": [
    {
      "id": 42,
      "name": "Weekly review - Dec 2024",
      "createdAt": "2024-12-15T10:30:00.000Z",
      "channelId": "UC...",
      "channelTitle": "My Channel",
      "totalVideos": 15,
      "hasErrors": false
    }
  ],
  "total": 1,
  "page": 1
}
```

## Scoring Criteria (authoritative)

`backend/config/optimizerCriteria.js` → `DEFAULT_OPTIMIZER_CRITERIA.playlist` is the
single source of truth. Admins can override it at runtime through
`PUT /api/admin/optimizer-criteria`; the values below are the **defaults** shipped in
code.

| # | Key | Label | Weight |
|---|-----|-------|--------|
| 1 | `title_ctr` | Title CTR Power | 12 |
| 2 | `seo_description` | SEO Description Quality | 20 |
| 3 | `keywords` | Keyword Coverage | 12 |
| 4 | `tags` | Tag Priority | 8 |
| 5 | `ordering_flow` | Binge Ordering & Flow | 12 |
| 6 | `theme_coherence` | Thematic Coherence | 8 |
| 7 | `metadata_health` | Metadata Health | 8 |
| 8 | `virality_potential` | Virality Potential | 8 |
| 9 | `video_coverage` | Video Coverage | 4 |
| 10 | `audience_targeting` | Audience & Niche Targeting | 8 |

Weights sum to exactly **100**, so a per-criterion 0-100 score maps linearly onto the
overall score. `seo_description` carries the largest single weight (20), which is why
the prompt pushes hardest on description length and keyword coverage.
`video_coverage` is the lightest (4).

`GET /api/playlist-optimizer/criteria` returns these labels and weights to any
authenticated user, so the in-app help dialog cannot drift from what the engine
actually scores.

## Analysis Dimensions

The DeepSeek prompt instructs the model to evaluate and return structured JSON covering:

1. **Audit** -- Channel strategy score (0-10), content/metadata health score (0-10), audience persona, niche, SWOT (strengths, weaknesses, missed opportunities), metadata analysis, existing playlists inventory
2. **Playlist Recommendations** -- Title, description (700+ chars), keywords (15+), tags (15+), reasoning, why, virality score (0-10), predicted reach (High/Medium/Low/Niche), engagement prediction, before/after state for EXISTING mode
3. **Unassigned Videos** -- Videos that don't fit any recommended playlist, with reason

## Time-Decay Weighting (opt-in)

The optimizer can deliberately weight **recent + performing** videos highest. Newer videos are stronger signals of the channel's current direction, and older videos accumulate views over time, so raw all-time view counts alone would over-weight legacy content. This is controlled by the **"Include based on time decay"** checkbox in the Settings panel and is **off by default**:

- **ON** (`useTimeDecay: true`) -- every analyzed video gets a deterministic `decayWeight` (0..1) and `decayTier` (`High` / `Medium` / `Low` / `Minimal`):
  ```
  decayWeight = recency × performance

  recency     = 0.5 ^ (ageDays / 365)      // halves roughly every 12 months
  performance = 0.3 + 0.7 × (log(1+views) / log(1+maxViews))   // floor 0.3, views unknown -> 1
  ```
  Videos are sorted by `decayWeight` (highest first) before being JSON-serialized into the prompt, and the critical-rules block instructs the model to weight each video's influence on its `decayWeight` (never penalizing an older video for a lower all-time view count).
- **OFF** (default) -- videos are passed to the model in original order with **no** decay fields, and the prompt tells the model to treat every video equally regardless of publish date or age. The Time-Decay column is hidden from the table.

- **Where computed**: `computeDecay()` in `backend/services/playlistOptimizerService.js`; the frontend mirrors the identical formula in `frontend/src/utils/playlistDecay.ts` (fallback when a result predates `videoInsights`).
- **Display**: when ON, each row's `decayWeight` / `decayTier` appears in the **Included Videos & Data** table; the column is hidden entirely when OFF.

## Deterministic Playlist Scoring

Each playlist card's **Score** is computed deterministically from real signals (not the AI's guess), so the number reflects actual quality and every deduction maps to a concrete "why" + a concrete "raise it" tip rendered right inside the card:

- **Signals** (joined from `result.videoInsights` by `videoId`):
  - `size` -- how many videos the playlist holds
  - `age` -- average video age (penalized harder when time-decay weighting is ON; softened by a narrow Data range)
  - `niche` -- share of videos whose title matches the playlist theme (title + keywords + topic)
  - `views` -- average views relative to the channel's best performer (log-normalized)
- **Score** = `100 - sum(deductions)`, clamped to 0-100. A solid, well-sized, on-theme playlist naturally lands 80-95.
- **Floor guarantee**: when all advanced settings are at defaults (data range `all`, time-decay off, no excluded keywords, no playlist limits, no target strategy), the strongest playlist is guaranteed to score **>= 80** -- if it computes below that it is lifted to exactly 80 and marked internally (`isTopUplifted`); this is deliberately **not surfaced in the UI**. Under non-default settings no floor is applied; the honest score stands and the tips point at the setting to change.
- **Tips** are per-deduction: add more on-theme videos (size), narrow the Data range / prefer new uploads (age), move off-theme videos (niche), or prefer better performers (views).

Implemented in `frontend/src/utils/playlistScoring.ts` (`scorePlaylist`, `scoreAllPlaylists`, `isDefaultSettings`) with `PlaylistScorePanel` in `frontend/src/pages/playlist-optimizer/PlaylistScorePanel.tsx`.

**Exports match the cards**: every download (JSON/YAML/CSV/PDF/ZIP and the per-card single exports) carries the same deterministic score the card shows -- the page substitutes `viralityScore` with the computed score in the result handed to the export functions, so what you see is what you get.

## Result Views (5 Tabs)

| Tab             | Content                                                                                                                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Audit**       | Score cards (strategy score, metadata health), analysis summary, 3-column SWOT grid (strengths, weaknesses, opportunities), existing playlists inventory, metadata analysis (hidden if text is empty or indicates incomplete analysis) |
| **Strategy**    | Full playlist cards with title, type badge, score, reach badge, expanded description, SEO keywords and tags, video list                                                                                                                |
| **Action Plan** | Compact playlist cards -- title, score, video count only                                                                                                                                                                               |
| **Video Lists** | Expandable accordion per playlist -- table with video title and ID, sorted by playlist order                                                                                                                                           |
| **Criteria**    | Grid showing each playlist's targeting criteria (topic, criteria, goal, audience, include/exclude themes)                                                                                                                              |

### Results Header: Included Videos & Data + Analysis Details

Above the **Channel Audit** (in the default results section) two panels show exactly what fed the analysis:

- **Included Videos & Data** (`PlaylistVideoTable`) -- A cross-video comparison table mirroring the Thumbnail Optimizer's comparison. Columns adapt to the data present: video title + YouTube link, channel (NEW mode), source playlist (EXISTING mode), publish date + age, all-time views, 7d/30d/90d views when available, and the per-video **time-decay** weight + tier badge **only when time-decay is ON** (rows then sort by `decayWeight`, newest + best performers first). When OFF the rows keep their input order and the Time-Decay column is hidden.
- **Analysis Details** (`PlaylistAnalysisDetails`) -- A "what data was used" panel: channel, mode (NEW/EXISTING), data range, videos analyzed, playlists included (with per-playlist video counts), filters applied (exclude keywords, playlist limits), and target strategy when enabled.

Both panels render from `result.videoInsights` / `result.analysisMeta` so they also appear for loaded saved analyses. When a result predates those fields (older cached/history rows), the table falls back to `computeVideoInsights()` over the input video list.

## Export Formats

| Format        | Content                                                                                                                     |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **JSON**      | Full `AnalysisResult` as downloadable `.json` file                                                                          |
| **CSV**       | 5 view modes matching the tabs above, downloaded as `.csv`                                                                  |
| **PDF**       | Branded report with header, SWOT analysis, playlist cards, video tables via `jspdf` + `jspdf-autotable`                     |
| **ZIP (All)** | `jszip` bundle containing 5 folders (Audit, Strategy, Action Plan, Action List, Criteria Output) each with JSON + CSV + PDF |

## Configuration

| Setting                | Value                                         | Notes                                                                                     |
| ---------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------- |
| DeepSeek model         | `deepseek-chat`                               | Set in `playlistOptimizerService.js` (configurable via `DEEPSEEK_MODEL` env var)          |
| API key                | `DEEPSEEK_API_KEY` env var                    | Same key used by the existing Chat feature                                                |
| API base URL           | `https://api.deepseek.com`                    | Set in `playlistOptimizerService.js`                                                      |
| Cache TTL              | 24 hours                                      | Via `ServerCache`, keyed on `playlist:optimize:v4:{videoHash}:{configHash}:{channelHash}` (v4: ids-only membership protocol; v3 entries came from the old echo-full-rows prompt and could hold truncated membership, so they are never served). The video hash includes each video's `publishDate` and `views` so richer input always yields a fresh analysis |
| Max videos per request | 500                                           | Enforced in route validation                                                              |
| Retry                  | 3 attempts                                    | Exponential backoff: 2s, 4s, 8s on 429/5xx                                                |
| Free tier limit        | 5/month                                       | From `featureConfig.js`                                                                   |
| Pro tier limit         | 100/month                                     | From `featureConfig.js`                                                                   |
| Persistence            | PostgreSQL                                    | `playlist_audits` table via raw SQL migration                                             |
| Migration file         | `backend/db/drizzle/0008_playlist_audits.sql` | Run `pnpm run db:migrate`                                                                 |

## PostgreSQL Persistence

Analysis history is stored in the `playlist_audits` table in PostgreSQL.

### Schema

```sql
CREATE TABLE IF NOT EXISTS playlist_audits (
  id            BIGSERIAL PRIMARY KEY,
  uid           TEXT NOT NULL,            -- Firebase user ID
  name          TEXT NOT NULL DEFAULT '',
  channel_id    TEXT,                     -- optional YouTube channel ID
  channel_title TEXT,                     -- optional YouTube channel name
  total_videos  INTEGER NOT NULL DEFAULT 0,
  audits        JSONB NOT NULL DEFAULT '{}'::jsonb,   -- full AnalysisResult as JSON
  errors        JSONB,                                -- per-video errors
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_playlist_audits_uid
  ON playlist_audits(uid);

CREATE INDEX IF NOT EXISTS idx_playlist_audits_uid_created
  ON playlist_audits(uid, created_at DESC);
```

### Migration

Run via `pnpm run db:migrate` in `backend/`.

### Routes

All persistence endpoints are mounted on the same `playlistOptimizerRouter`:

- `POST /save` -- Insert analysis results, returns `{ id, createdAt }`
- `GET /history` -- Paginated list (`?limit=20&page=1&search=keyword`), returns `{ items, total, page }`
- `GET /history/:id` -- Full analysis with all results (audits normalized on read so pre-repair legacy rows stay safe)
- `DELETE /history/:id` -- Remove analysis, returns `{ success: true }`

All require `resolveUser` + `checkPremiumAccess("playlistOptimizer")` middleware. They do not consume quota.

## Input Modes

### NEW Mode

1. **ChannelVideoPicker** -- Side-by-side layout with two input sources:
   - Browse connected channels → opens `VideoSearchDialog` to search and select individual videos
   - Paste URLs directly → opens `UrlPasteDialog` for pasting YouTube links (regular + Shorts)
2. **Video tag list** -- Visual chips showing added videos with remove button, combined from both sources
3. Hint text: _"Select videos below to analyze for playlist optimization"_

#### Single-Channel Restriction

Playlist optimization requires all videos to be from the same channel -- this ensures channel-specific metadata, audience context, and SEO strategy alignment. The restriction is enforced at the input layer:

- When the **first video** is added (via browse or paste), its channel is automatically resolved via `YouTubeService.getChannelIdFromVideo()` and locked
- All **subsequent videos** are validated against the locked channel in real-time:
  - `ChannelVideoPicker` passes `lockedChannelId` to `VideoSearchDialog` (disables channel dropdown) and `UrlPasteDialog` (validates each pasted URL)
  - `PlaylistOptimizerPage` maintains `lockedChannelId` / `lockedChannelTitle` state and rejects cross-channel adds with an error message
  - When channel is locked, a lock badge with the channel title is shown in the UI
- Video objects include `channelId` and `channelTitle` fields for downstream processing
- The locked channel identifier is automatically passed as `channelIdentifier` in the analysis request for contextual AI prompt construction
- Channel lock resets when the user switches between NEW and EXISTING modes

#### Connected-Channel + Locked-Channel Enforcement

Playlist optimization is restricted to videos from the user's **own connected channels** (personal `youtubeTokens` or org channels), in addition to the single-channel lock:

- The manual-paste UI heading reads **"Add Videos Manually From Your Channel"** (same label as the Thumbnail Optimizer), reinforcing that only owned-channel videos are accepted.
- `UrlPasteDialog` resolves every pasted URL's owning channel (Postgres-first via `getChannelIdFromVideo`) and classifies it as valid / foreign / cross-channel:
  - **Foreign** (video's channel is not in the user's connected `allowedChannelIds`) → rejected with a red _"not from your channel"_ banner.
  - **Cross-channel** (owned but differs from the locked channel) → rejected because it breaks the single-channel lock.
- **Server-side backstop**: Both `POST /api/playlist-optimizer/analyze` and `POST /api/playlist-optimizer/jobs` call `channelOwnership.validateVideos()` before DeepSeek / enqueueing. Non-admins get `403` for any video not owned by a connected channel; **admins bypass** ownership validation. This guarantees the DB-persisted server path never analyzes a foreign channel for regular users, even if the client-side check is bypassed.

### EXISTING Mode

1. **ChannelPlaylistPicker** -- A single "Select Playlists" button (dashed entry box, same style as the NEW mode picker). No inline channel list
2. **Channel + playlist selection inside the dialog** -- `PlaylistPickerDialog` opens with a channel dropdown in the header; switching channels reloads that channel's playlists. Select one or more playlists; the dialog fetches each playlist's videos
3. **Full playlist metadata is passed to the analyzer** -- every fetched video is stamped with its source playlist's current metadata:
   - `originalPlaylistId`
   - `originalPlaylistTitle`
   - `originalPlaylistDescription`
   - `originalPlaylistTags` (from `PlaylistMetadata.keywords`)
   - `originalPlaylistVideoCount` (from `PlaylistMetadata.itemCount`)
4. **Playlist groups** -- Videos displayed grouped by their source playlist with playlist name and video count per group

The backend prompt (`buildPrompt` in EXISTING mode) instructs the AI to group videos by `originalPlaylistId` and optimize each playlist's **actual current title, description, and tags**, documenting the before state via `currentTitle`. Every playlist it emits -- including the "New Opportunity" playlists it creates for leftover videos -- must carry a full `title` (string) and `description` (>=700 chars) plus `keywords`/`tags`. If the model still returns a blank title or description, `parseResponse` fills them so the card is never empty (optimized playlists fall back to their `currentTitle`; New Opportunity playlists get a safe default).

When user toggles between modes, all videos and results are automatically cleared.

### Settings Panel

Advanced options expandable via "Show Settings" button:

- **Exclude keywords** -- Comma-separated keywords to filter out
- **Max/Min playlists** -- Numerical limits on total playlists the AI creates
- **Min videos per playlist** -- Minimum videos per recommended playlist
- **Include based on time decay** -- Checkbox, **off by default**. When ON, newer + better-performing videos are weighted highest (see [Time-Decay Weighting](#time-decay-weighting-opt-in)); when OFF all videos weigh equally
- **Target playlist strategy** -- Name, topic, criteria, goal, audience, include/exclude themes. Each field shows an inline hint (`helperText`) explaining what it controls

### Guide Dialog

A `?` help button in the page header (top-right) opens the Playlist Optimizer guide, mirroring the Thumbnail Optimizer's guide. It explains:

- The AI playlist strategy engine and how recommendations are made (thematic grouping, virality score, SEO metadata, gap analysis)
- The two modes (New Playlist(s) Strategy vs Optimize Existing Playlist(s))
- What each Target Playlist Strategy field means (especially **Criteria**, which drives grouping)

### Admin Variant

The `AdminPlaylistOptimizer` renders at `/admin/playlist-optimizer`:

- Manual URL entry only (no channel integration)
- No save/history functionality
- Simplified result display with audit scores, SWOT, and playlist cards
- All 4 export buttons (JSON, CSV, PDF, ZIP)
- Loading animation with cycling messages
- Metadata Analysis hidden if text is empty or indicates incomplete analysis
- **Single-channel restriction enforced**: the first video URL added resolves its channel via `YouTubeService.getChannelIdFromVideo()` and auto-populates the `channelIdentifier` field. Subsequent URLs are validated against the locked channel -- cross-channel videos are rejected with an error message. This ensures admin-submitted video sets maintain channel coherence for accurate AI analysis.
- **Admins bypass the server-side connected-channel check**: `channelOwnership.validateVideos()` returns `{ ok: true }` for admins (`support@revketer.ai` or `role === "admin"`), so admins can submit videos from **any** channel through the admin tool.

## Auto-Save

With the background job flow, the worker persists the analysis to `playlist_audits` automatically before returning (`return { savedId, kind, result }`), so no separate save call is needed and results appear immediately in the "Saved Analyses" tab. On the sync `/analyze` path the `usePlaylistOptimization` mutation auto-saves via `PlaylistOptimizerService.save()` -- silent, no dialog or button shown to the user.

## Saved Analyses (PlaylistHistoryPanel)

Access via "Saved Analyses" tab on the main page:

- **Paginated list** -- Fetches from `/api/playlist-optimizer/history`
- **Search** -- Filter by analysis name
- **Load** -- Click to restore full analysis results
- **Delete** -- Confirmation dialog, removes from history
- **Empty states** -- "No saved analyses yet" / "No saved analyses match your search"

## Error Handling

| Error                           | HTTP | User Message                                                                                                 |
| ------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------ |
| Job -- `videos` not an array    | 400  | `"videos" must be an array`                                                                                  |
| Job -- too many videos          | 400  | `Maximum of 500 videos per request (got N)`                                                                  |
| Job -- empty videos + no identifier | 400 | "Provide at least one video or a channel identifier."                                                      |
| Job -- not found                | 404  | "Job not found."                                                                                             |
| Invalid YouTube URL             | 400  | "Invalid YouTube URL"                                                                                        |
| Duplicate video                 | 400  | "Video ID is already in the list."                                                                           |
| No videos provided              | 400  | "Add at least one valid video."                                                                              |
| DeepSeek rate limit (429)       | 429  | "DeepSeek API rate limit hit. Wait a moment and try again."                                                  |
| Invalid DeepSeek key / model    | 503  | "Playlist optimization is unavailable (AI config issue). Contact support."                                   |
| JSON parse error                | 502  | "Analysis returned an invalid response. Try again."                                                          |
| Timeout / network               | 502  | "Playlist optimization is temporarily unavailable."                                                          |
| Too many videos                 | 400  | "Maximum 500 videos per request."                                                                            |
| Foreign video (non-admin)       | 403  | "N video(s) are not from your connected channels. Only videos from your connected channels can be analyzed." |
| Audit save -- not authenticated | 401  | "Not authenticated."                                                                                         |
| Audit save -- no DB             | 503  | "Database is not configured. Contact support."                                                               |
| Audit save -- invalid body      | 400  | "audits must be a valid object."                                                                             |
| History -- invalid ID           | 400  | "Invalid analysis ID."                                                                                       |
| History -- not found            | 404  | "Analysis not found."                                                                                        |
| Free user hits 5/month          | 429  | From `requireQuota` middleware                                                                               |

## Known Fixes

### Metadata Analysis "Incomplete" text

The backend fallback for `metadataAnalysis` was changed from `"Analysis was incomplete."` to an empty string `""`. The frontend guards against displaying metadata analysis that is empty, under 20 characters, or contains the word "incomplete".

### Accordion expansion bug

When DeepSeek returned duplicate or missing playlist IDs, all accordions on the frontend opened/closing together because `expandedPlaylist` state keyed on `playlist.id` collapsed to a single entry. Fixed by post-processing in `parseResponse()` to ensure every playlist gets a unique ID:

```js
if (!rawId || idCounts.has(rawId)) {
  pl.id = `pl-${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 6)}`;
}
```

## How to Add a New Feature (following this pattern)

The Playlist Optimizer follows the same integration pattern as the Thumbnail Optimizer with zero coupling. To add a new feature:

1. **Backend service** → Single file in `backend/services/`, exports `create*Service(deps)`
2. **Backend route** → Single file in `backend/routes/`, exports `create*Router(deps)`
3. **Feature config** → Add entry in `backend/config/featureConfig.js`
4. **Backend wiring** → 5 lines in `backend/index.js`: import service, import router, create service, inject into deps, create + mount router
5. **DB migration** → Add SQL file in `backend/db/migrations/`
6. **Types** → Single file in `frontend/src/types/`
7. **Frontend service** → Single file in `frontend/src/services/`, uses `authFetch<T>()` pattern
8. **TanStack hook** → Single file in `frontend/src/hooks/queries/`, `useMutation` wrapper
9. **Export service** → Single file in `frontend/src/services/` (if needed)
10. **Page component** → Single file in `frontend/src/pages/` (user-facing + admin variant)
11. **Frontend wiring** → Lazy import + route in `App.tsx`, admin tab in `AdminPage.tsx`, sidebar nav in `Layout.tsx`
12. **Documentation** → Follow this document's structure

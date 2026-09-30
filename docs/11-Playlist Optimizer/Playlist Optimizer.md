## Playlist Optimizer

Relevant source files

- [backend/services/playlistOptimizerService.js](../../backend/services/playlistOptimizerService.js)
- [backend/routes/playlistOptimizer.js](../../backend/routes/playlistOptimizer.js)
- [backend/queue/optimizerQueue.js](../../backend/queue/optimizerQueue.js) *(shared BullMQ job processor: thumbnail + playlist kinds)*
- [backend/config/featureConfig.js](../../backend/config/featureConfig.js)
- [backend/index.js](../../backend/index.js)
- [backend/db/drizzle/0008_playlist_audits.sql](../../backend/db/drizzle/0008_playlist_audits.sql)
- [frontend/src/types/playlistOptimizer.ts](../../frontend/src/types/playlistOptimizer.ts)
- [frontend/src/services/playlistOptimizerService.ts](../../frontend/src/services/playlistOptimizerService.ts)
- [frontend/src/services/playlistOptimizerExport.ts](../../frontend/src/services/playlistOptimizerExport.ts)
- [frontend/src/hooks/queries/usePlaylistOptimization.ts](../../frontend/src/hooks/queries/usePlaylistOptimization.ts) *(sync-path mutation; the page now uses the job flow)*
- [frontend/src/hooks/useSessionJobId.ts](../../frontend/src/hooks/useSessionJobId.ts)
- [frontend/src/hooks/useOptimizerJobWatcher.ts](../../frontend/src/hooks/useOptimizerJobWatcher.ts)
- [frontend/src/pages/PlaylistOptimizerPage.tsx](../../frontend/src/pages/playlist-optimizer/PlaylistOptimizerPage.tsx)
- [frontend/src/pages/PlaylistOptimizerPage.css](../../frontend/src/pages/playlist-optimizer/PlaylistOptimizerPage.css)
- [frontend/src/pages/playlistOptimizer/AdminPlaylistOptimizer.tsx](../../frontend/src/pages/playlist-optimizer/AdminPlaylistOptimizer.tsx)
- [frontend/src/pages/playlistOptimizer/PlaylistHistoryPanel.tsx](../../frontend/src/pages/playlist-optimizer/PlaylistHistoryPanel.tsx)
- [frontend/src/pages/playlistOptimizer/PlaylistPickerDialog.tsx](../../frontend/src/pages/playlist-optimizer/PlaylistPickerDialog.tsx)
- [frontend/src/pages/playlistOptimizer/ChannelPlaylistPicker.tsx](../../frontend/src/pages/playlist-optimizer/ChannelPlaylistPicker.tsx)
- [frontend/src/pages/thumbnailOptimizer/ChannelVideoPicker.tsx](../../frontend/src/pages/thumbnail-optimizer/ChannelVideoPicker.tsx)
- [frontend/src/pages/thumbnailOptimizer/VideoSearchDialog.tsx](../../frontend/src/pages/thumbnail-optimizer/VideoSearchDialog.tsx)
- [frontend/src/pages/thumbnailOptimizer/UrlPasteDialog.tsx](../../frontend/src/pages/thumbnail-optimizer/UrlPasteDialog.tsx)
- [backend/utils/channelOwnership.js](../../backend/utils/channelOwnership.js)
- [frontend/src/components/Layout.tsx](../../frontend/src/components/Layout.tsx)
- [frontend/src/pages/AdminPage.tsx](../../frontend/src/pages/admin/AdminPage.tsx)
- [Playlist Optimizer Reference](../11-Playlist Optimizer/02-Playlist Optimizer Reference)

The Playlist Optimizer analyzes YouTube video metadata through the **DeepSeek Chat API** and produces structured playlist strategy recommendations with SEO metadata, audit scores, SWOT analysis, and multi-format export. It was ported from the standalone RevTube-Playlist project and integrated as a first-class RevTube feature following the same architecture pattern as the Thumbnail Optimizer but with zero coupling between them.

---

## Architecture Overview

```
Browser                         Backend (Express)                    DeepSeek API
──────                          ────────────────                    ────────────

POST /api/playlist-optimizer/jobs             (default page flow)
  ──► resolveUser ──► checkPremiumAccess ──► requireQuota ──► validateVideos
       │
       ▼
  enqueueOptimizer({ kind: 'playlist', payload, uid, email, orgId }) → BullMQ 'optimizer'
       │
       ▼
  optimizer queue worker (backend/queue/optimizerQueue.js)
       ├─► playlistOptimizerService.analyze()
       ├─► INSERT INTO playlist_audits (worker persists)
       └─► return { savedId, kind, result }
              │
              ▼
     worker 'completed' ──► handleAuditCompleted ──► in-app + email + OS notification

  Browser holds jobId in sessionStorage (useSessionJobId), polls
  GET /jobs/:id; useOptimizerJobWatcher (in Layout) keeps polling after nav/close.

  ── HISTORY FLOW ──
  GET /api/playlist-optimizer/history         → paginated list
  GET /api/playlist-optimizer/history/:id     → full analysis
  DELETE /api/playlist-optimizer/history/:id  → remove
```

## Key Design Decisions

| Decision                        | Rationale                                                                                                                                                                                 |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DeepSeek over Gemini**        | Non-visual analysis only — DeepSeek's large context window (128k+) handles the full video set in one API call, avoiding chunking needed in the original Gemini-based RevTube-Playlist app |
| **Server-side AI calls**        | API key never reaches the browser. All 3rd-party AI requests route through the Express backend, matching the Thumbnail Optimizer security model                                           |
| **Single call, no chunking**    | DeepSeek's context accommodates 500 videos in one prompt with structured JSON response schema                                                                                             |
| **Auto-save**                   | After every successful analysis, results are automatically saved to PostgreSQL — no manual "Save" button or dialog shown to users                                                         |
| **Minimum coupling**            | No shared state, types, or inheritance with the Thumbnail Optimizer. If one changes, the other is unaffected                                                                              |
| **Same middleware chain**       | Reuses existing `resolveUser`, `checkPremiumAccess`, and `requireQuota` — no new middleware needed                                                                                        |
| **Mode-based picker switching** | "New Playlist(s) Strategy" mode shows individual video picker; "Optimize Existing Playlist(s)" mode shows playlist picker — each opens the appropriate dialog for the workflow            |

## Backend Service: `playlistOptimizerService.js`

Single file (~545 lines). Factory function `createPlaylistOptimizerService(deps)` returns `{ analyze }`. Depends only on sharedDeps (`axios`, `serverCache`, `config`). No internal helpers shared with other services.

### Prompt Construction

The `buildPrompt` function accepts videos and a filter config and builds a detailed system message for DeepSeek:

1. **Channel context** — Channel identifier and mode (NEW vs EXISTING)
2. **Mode instructions** — EXISTING mode tells the AI to optimize current playlists, set `currentTitle`/`currentUrl` fields, and identify leftover videos for new opportunities. NEW mode creates fresh recommendations from scratch
3. **Constraints** — Max/min playlists, min videos per playlist, exclude keywords, include types, and playlist-level target config (name, topic, criteria, goal, audience)
4. **Video input** — Full JSON of all videos with IDs, titles, URLs, views, publish dates, and playlist assignments
5. **Critical instructions** — Account for every video, use exact internal IDs, output pure JSON only

### DeepSeek API Call

```js
POST https://api.deepseek.com/chat/completions
Headers: Authorization: Bearer ${DEEPSEEK_API_KEY}
Body: {
  model: "deepseek-chat",
  messages: [
    { role: "system", content: buildSystemInstruction() },
    { role: "user", content: buildPrompt(videos, channelId, filterConfig) }
  ],
  response_format: buildResponseSchema(),  // JSON schema for structured output
  temperature: 0.7,
  max_tokens: 16384
}
```

### Response Parsing

`parseResponse` handles:

- Strips markdown code fences if present
- Falls back to empty playlists and placeholder audit if fields are missing
- **Ensures unique playlist IDs** — detects duplicate/missing IDs from the AI and assigns deterministic unique values to prevent accordion rendering bugs on the frontend
- Returns structured `AnalysisResult`

### Video Membership Repair (post-parse)

DeepSeek's `json_object` mode does not enforce nested schemas, so playlists can
come back with an EMPTY or truncated `videos[]` even though membership was
assigned -- the UI would show "0 videos". After parsing, the service
deterministically repairs membership (no extra LLM call):

1. **Stub resolution** -- every echoed member (`{id?, videoId?, title}` object
   or bare id string) is matched against a lowercased lookup of full input
   rows; duplicates drop per-playlist and unknown ids are discarded.
2. **EXISTING-mode backfill** -- playlists still empty are filled from their
   source grouping: videos carry `originalPlaylistId` (+ original title), so
   `parentPlaylistId` match falls back to current/original-title match.
3. **NEW-mode honesty** -- genuinely unmatched new playlists stay empty rather
   than inventing membership (no ground-truth grouping exists for NEW
   playlists, so fabricating rows would be wrong).

The system prompt uses an **ids-only membership protocol**: the model echoes
only each input row's `'id'` GUID string — never `{id, videoId, title}`
objects — cutting membership output tokens ~10x and making mid-array
truncation at `max_tokens: 16384` far less likely ("Never omit, truncate, or
summarize membership"). Any stubs/strings the model still emits are repaired
by the layers above.

> **Cache version**: results are cached under `playlist:optimize:v4:...`.
> v3 keys were produced by the old echo-full-rows prompt and can hold
> truncated membership; the version bump guarantees stale entries are never
> served for new requests.

### Retry Logic

3 attempts with exponential backoff (2s, 4s, 8s) on network errors, 429, or 5xx responses.

### Caching

24-hour TTL via `ServerCache`. Cache key: `playlist:optimize:v1:{videoHash}:{configHash}:{channelHash}`.

---

## Backend Route: `playlistOptimizer.js`

Express router factory at `backend/routes/playlistOptimizer.js`. Mounts 7 endpoints: `POST /jobs`, `GET /jobs/:id`, `POST /analyze`, `POST /save`, `GET /history`, `GET /history/:id`, `DELETE /history/:id`.

### POST /api/playlist-optimizer/jobs (background job enqueue; default page flow)

**Middleware chain**: `resolveUser` → `checkPremiumAccess("playlistOptimizer")` → `requireQuota("playlistOptimizer")`

**Request body**: same as the sync analyze body (`channelIdentifier`, `videos`, `filterConfig`) plus optional `channelId` / `channelTitle` (stamped onto the persisted `playlist_audits` row). `videos` capped at 500 items. Before enqueueing, the handler runs `channelOwnership.validateVideos(req, cleanVideos)` when `videos` is non-empty — non-admins limited to connected-channel videos (`403` on any foreign video); admins bypass.

**Behavior**: Calls `queueService.enqueueOptimizer({ kind: 'playlist', payload: { videos, channelIdentifier, filterConfig, channelId, channelTitle }, uid, email, orgId }, { removeOnComplete: { age: 3600*24 }, removeOnFail: { age: 3600*24*7 } })` on the shared BullMQ `optimizer` queue. The worker runs `playlistOptimizerService.analyze`, inserts into `playlist_audits`, and returns `{ savedId, kind, result }`. The `completed` event fires `handleAuditCompleted` (in-app notification + email + OS toast).

**Response**: `{ jobId: string }`.

### GET /api/playlist-optimizer/jobs/:id (job polling)

**Middleware**: `resolveUser` only.

**Behavior**: Loads the job by id (id sanitized to `[0-9A-Za-z_-]`), returns `404 "Job not found."` if missing, else the state via `job.getState()`.

**Response**:
```json
{
  "jobId": "bull:optimizer:abc123",
  "state": "waiting | active | completed | failed",
  "progress": 100,
  "result": { "savedId": 42, "kind": "playlist", "result": { /* full AnalysisResult */ } }
}
```
`result` is included only when `state === "completed"`. The worker already persisted the analysis, so no client-side `save()` call is needed.

### POST /api/playlist-optimizer/analyze

**Middleware chain**: `resolveUser` → `checkPremiumAccess("playlistOptimizer")` → `requireQuota("playlistOptimizer")`

**Request body**:

```json
{
  "channelIdentifier": "@channelname",
  "videos": [
    {
      "id": "abc123",
      "videoId": "abc123",
      "title": "...",
      "url": "...",
      "originalPlaylistId": "..."
    }
  ],
  "filterConfig": {
    "analysisMode": "NEW | EXISTING",
    "excludeKeywords": "keyword1, keyword2",
    "maxPlaylists": 5,
    "minPlaylists": 2,
    "minVideosPerPlaylist": 3,
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
- `channelIdentifier` is optional — helps DeepSeek contextualize the channel niche
- `filterConfig` is optional — defaults applied server-side
- Videos include `originalPlaylistId` when sourced from existing playlists (EXISTING mode)

**Server-side channel ownership validation** (added after the 400 validation, before building the DeepSeek call): When `videos` is non-empty, the handler calls `channelOwnership.validateVideos(req, cleanVideos)` (from `backend/utils/channelOwnership.js`). Non-admin callers are limited to videos from their own connected channels (personal `youtubeTokens` or org `organizations/{orgId}/channels`, resolved via the `X-Org-Id` header). Each submitted video's owning channel is resolved Postgres-first via `getVideosByIds()` (reads `analytics_videos` JOIN `analytics_channels`) with a live YouTube `videos` snippet API fallback for missing IDs. If any video maps to a channel outside the caller's connected set, the request is rejected with `403` and the error message `"N video(s) are not from your connected channels. Only videos from your connected channels can be analyzed."`. **Admins bypass this check entirely** (`req.authUser.email === 'support@revketer.ai'` or `req.currentUser.role === 'admin'`) and may submit videos from any channel.

**Response**: `{ results: AnalysisResult, _usage?: { used, limit, pageKey } }`

### POST /api/playlist-optimizer/save

**Middleware**: `resolveUser` → `checkPremiumAccess("playlistOptimizer")` (no quota consumed)

Persists analysis results to PostgreSQL. On the background job path the worker persists before returning, so `/save` is used only by direct/sync callers (the old `usePlaylistOptimization` auto-save on the sync `/analyze` path).

**Request body**: `{ name?: string, audits: AnalysisResult, errors?: array, channelId?: string, channelTitle?: string }`

**Response**: `{ id: number, createdAt: string }`

### GET /api/playlist-optimizer/history

Paginated list of saved analyses. Query params: `?limit=20&page=1&search=keyword`.

**Response**: `{ items: HistoryItem[], total: number, page: number }`

### GET /api/playlist-optimizer/history/by-video/:videoId

Newest saved analysis whose recommendation cards contain this item reference id
(`"id": "<ref>"` match inside the stored `audits` JSONB). Returns
`{ id: number | null }`. Used by the Optimized Content page to deep-link
`/playlist-optimizer?audit=<id>&scroll=<ref>` which loads the entry via
`handleLoadAnalysis` and scrolls to the matching card with no AI re-run.

### GET /api/playlist-optimizer/history/:id

Full analysis with all results.

**Response**: `SavedAnalysis` (includes full `audits: AnalysisResult`)

The stored `audits` payload is **normalized on read**: `playlists[]`,
each playlist's `videos[]`, and `unassignedVideos[]` are guaranteed arrays,
object-map `playlists` are unwrapped, non-object entries are dropped, and a
missing `audit` object defaults to `{}`. This keeps rows saved before the
video-membership repair (which could hold malformed nested arrays from
`json_object` parsing) safe to open — no client-side `.map` crash, and no
at-rest data migration required.

### DELETE /api/playlist-optimizer/history/:id

Remove a saved analysis.

**Response**: `{ success: true }`

---

## Feature Configuration

Added in `backend/config/featureConfig.js` alongside `thumbnailOptimizer`:

```js
playlistOptimizer: {
  label: "Playlist Optimizer",
  premiumOnly: false,
  freeLimit: 5,
  proLimit: 100,
}
```

## Backend Wiring

In `backend/index.js`:

```js
const {
  createPlaylistOptimizerService,
} = require("./services/playlistOptimizerService");
const playlistOptimizerService = createPlaylistOptimizerService(sharedDeps);
serviceDeps.playlistOptimizerService = playlistOptimizerService;

const { createPlaylistOptimizerRouter } = require("./routes/playlistOptimizer");
const playlistOptimizerRouter = createPlaylistOptimizerRouter(routeDeps);
apiRouter.use("/playlist-optimizer", playlistOptimizerRouter);
```

---

## PostgreSQL Persistence

Analysis history is stored in the `playlist_audits` table.

### Schema (`backend/db/drizzle/0008_playlist_audits.sql`)

```sql
CREATE TABLE IF NOT EXISTS playlist_audits (
  id            BIGSERIAL PRIMARY KEY,
  uid           TEXT NOT NULL,            -- Firebase user ID
  name          TEXT NOT NULL DEFAULT '',
  channel_id    TEXT,                     -- optional YouTube channel ID
  channel_title TEXT,                     -- optional YouTube channel name
  total_videos  INTEGER NOT NULL DEFAULT 0,
  audits        JSONB NOT NULL DEFAULT '{}'::jsonb,   -- full AnalysisResult
  errors        JSONB,                                -- per-video errors
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_playlist_audits_uid ON playlist_audits(uid);
CREATE INDEX IF NOT EXISTS idx_playlist_audits_uid_created ON playlist_audits(uid, created_at DESC);
```

### Migration

Run via `pnpm run db:migrate` in `backend/`. The migration system is at `backend/db/migrate.js` which reads `.sql` files from `backend/db/drizzle/` and tracks applied migrations by content hash in the `__drizzle_migrations` table.

For Docker environments, copy the migration file into the container and run:

```bash
docker cp backend/db/drizzle/0008_playlist_audits.sql revtube-backend-1:/app/db/drizzle/
docker exec revtube-backend-1 sh -c "node /app/db/migrate.js"
```

---

## Frontend Types

File: `frontend/src/types/playlistOptimizer.ts` (~191 lines).

| Type                                                | Purpose                                                                                                                                                           |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Video`                                             | Input video with ID, URL, `originalPlaylistId` (links to parent playlist), title, views, publish date, custom metadata                                            |
| `PlaylistVideo`                                     | Video reference within a playlist recommendation (id, videoId, title)                                                                                             |
| `ExistingPlaylist`                                  | Existing playlist metadata from the channel (ID, title, video list)                                                                                               |
| `AuditData`                                         | Strategy score, metadata health, audience persona, niche, SWOT, metadata analysis, existing playlists inventory                                                   |
| `PlaylistRecommendation`                            | Full playlist card — title, description, keywords, tags, reasoning, why, virality score, predicted reach, current/before state, video list, engagement prediction |
| `AnalysisResult`                                    | Top-level response — channel name, audit, playlist array, summary, unassigned videos                                                                              |
| `AnalysisMode`                                      | `'NEW'` or `'EXISTING'`                                                                                                                                           |
| `FilterConfig`                                      | All configuration options — analysis mode, exclude keywords, playlist limits, target playlist strategy                                                            |
| `AnalyzeRequest` / `AnalyzeResponse`                | API request/response types                                                                                                                                        |
| `SaveRequest` / `SaveResponse`                      | Persistence types                                                                                                                                                 |
| `HistoryItem` / `HistoryResponse` / `SavedAnalysis` | History listing types                                                                                                                                             |

---

## Frontend Service Layer

### API Client: `playlistOptimizerService.ts`

Generic `authFetch<T>()` helper wraps `fetch()` with Firebase auth headers, JSON parsing, usage limit extraction, and error handling. Static class `PlaylistOptimizerService` provides:

| Method              | HTTP                                   | Description                           |
| ------------------- | -------------------------------------- | ------------------------------------- |
| `enqueueJob(params, orgId?)` | POST /playlist-optimizer/jobs    | Enqueue background analysis, returns `{ jobId }` |
| `getJobStatus(jobId)` | GET /playlist-optimizer/jobs/:id   | Poll job state + result               |
| `analyze(params)`   | POST /playlist-optimizer/analyze       | Run analysis (sync; direct callers)   |
| `save(params)`      | POST /playlist-optimizer/save          | Persist results (sync path only)      |
| `history(params?)`  | GET /playlist-optimizer/history        | Paginated list with search            |
| `getHistory(id)`    | GET /playlist-optimizer/history/:id    | Full saved analysis                   |
| `deleteHistory(id)` | DELETE /playlist-optimizer/history/:id | Remove analysis                       |

### Background Job Hook

The page no longer uses the sync mutation. It calls `enqueueJob()` and holds the returned `jobId` via `useSessionJobId("playlist-optimizer", orgId)` (persisted in `sessionStorage`), polling `getJobStatus(jobId)` every 4s. On `completed` it renders `result.result` and clears the jobId; the worker already persisted the analysis, so no save call runs.

### TanStack Hook: `usePlaylistOptimization.ts`

```ts
usePlaylistOptimization({ onSuccess, onError });
// Returns: { mutate, isPending, data, error }
```

`useMutation` wrapping `PlaylistOptimizerService.analyze()`. No retries, suppresses global error toast via `meta.suppressGlobalErrorToast: true`. Retained for the sync `/analyze` path (direct callers / admin), no longer wired into the main page.

### Export Service: `playlistOptimizerExport.ts`

| Function                                | Format  | Content                                                             |
| --------------------------------------- | ------- | ------------------------------------------------------------------- |
| `downloadJSON(result)`                  | `.json` | Full `AnalysisResult`                                               |
| `downloadCSV(result, viewMode, videos)` | `.csv`  | 5 view modes: audit, detailed, simple, videos_only, criteria_output |
| `downloadPDF(result, viewMode, videos)` | `.pdf`  | Branded report via jspdf + jspdf-autotable                          |
| `downloadMasterZip(result, videos)`     | `.zip`  | Bundle of all formats with 5 subfolders                             |

---

## Frontend Page Components

### Main Page: `PlaylistOptimizerPage.tsx`

A single React component (~755 lines after auto-save removal) that handles the full workflow.

#### State Management

| State               | Type                                | Purpose                             |
| ------------------- | ----------------------------------- | ----------------------------------- | --------------------------- |
| `videos`            | `Video[]`                           | Videos added for analysis           |
| `selectedPlaylists` | `{playlistId, title, videoCount}[]` | Playlists selected in EXISTING mode |
| `result`            | `AnalysisResult                     | null`                               | Latest analysis result      |
| `analysisMode`      | `'NEW'                              | 'EXISTING'`                         | Current mode                |
| `pageView`          | `'new'                              | 'saved'`                            | View toggle                 |
| `activeResultTab`   | `ResultTab`                         | Which result tab is active          |
| `expandedPlaylist`  | `string                             | null`                               | Current accordion expansion |

#### Input Section (NEW mode)

1. **ChannelVideoPicker** — Shows connected YouTube channels. Clicking a channel opens `VideoSearchDialog` where users search and select individual videos. Passes `enforceSingleChannel` + `lockedChannelId`/`lockedChannelTitle` so the chooser is locked to the single channel of the 1st selected video: children dialogs present that locked channel, and the confirm surface rejects any video from another channel
2. **Video tag list** — Visual chips showing added videos with remove button
3. **Manual paste** — The right column opens a `UrlPasteDialog` titled **"Add Videos Manually From Your Channel"**. `allowedChannelIds` (the user's loaded connected channels) is always passed, so pasted URLs are resolved to their owning channel (Postgres-first) and validated: any video from a non-connected channel is rejected in real time with the red error _"N video(s) are not from your channel. Only videos from your connected channels can be added."_. Because `enforceSingleChannel` is set, pastes are also locked to the `lockedChannelId`

#### Input Section (EXISTING mode)

1. **ChannelPlaylistPicker** — Shows connected YouTube channels. Clicking a channel opens `PlaylistPickerDialog`
2. **Playlist groups** — Videos displayed grouped by their source playlist, showing playlist name and video count per group
3. Hint text below channel list: _"Click a channel above to search and select videos for analysis"_ (NEW) / _"Click a channel above to browse and select playlists for optimization"_ (EXISTING)

#### Mode Switching

When user toggles between NEW and EXISTING via the mode buttons, all videos, playlists, and results are automatically cleared to prevent cross-mode data confusion.

#### Settings Panel

Advanced options expandable via "Show Settings" button:

- **Exclude keywords** — Comma-separated keywords to filter out
- **Max/Min playlists** — Numerical limits
- **Min videos per playlist**
- **Target playlist strategy** — Name, topic, criteria, goal, audience

#### Analysis (Background Job Flow)

`runAnalysis` builds the request (with locked channel id/title) and calls `PlaylistOptimizerService.enqueueJob(...)`:

1. `enqueueJob` returns a `jobId`, stored via `useSessionJobId("playlist-optimizer", orgId)` in `sessionStorage` and surfaced as `isRunning`.
2. The page polls `getJobStatus(jobId)` every 4s. On `completed` it stores `result.result` in state, switches to the audit tab, and clears the jobId.
3. The worker already inserted the analysis into `playlist_audits`, so it appears in Saved Analyses with no save call. The backend `completed` handler fires the in-app notification + email (see `docs/NOTIFICATIONS.md`).
4. If the user navigates away mid-run, `useOptimizerJobWatcher` (in `Layout`) keeps polling the jobId every 5s and clears the key on completion/failure.

On the sync `/analyze` path the `usePlaylistOptimization` mutation's `onSuccess` auto-saves silently via `PlaylistOptimizerService.save()` — no dialog or button shown to the user.

#### Result Views

5-tab result display after analysis completes:

| Tab             | Content                                                                                                                                                                                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Audit**       | Score cards (strategy score, metadata health, niche & audience), summary text, 3-column SWOT grid (strengths, weaknesses, opportunities), existing playlists inventory table, metadata analysis (hidden if text is empty or indicates incomplete analysis) |
| **Strategy**    | Full playlist cards with title, type badge, score, reach badge, description, SEO keywords and tags, video list                                                                                                                                             |
| **Action Plan** | Compact playlist cards — title, score, video count only                                                                                                                                                                                                    |
| **Video Lists** | Expandable accordion per playlist — showing video table with title and video ID                                                                                                                                                                            |
| **Criteria**    | Grid showing each playlist's targeting criteria (topic, criteria, goal, audience, include/exclude themes)                                                                                                                                                  |

#### Accordion Behavior

Each `PlaylistCard` uses a single `expandedPlaylist` state keyed by `playlist.id`. Only one accordion can be expanded at a time. The backend guarantees unique playlist IDs to prevent rendering bugs.

#### Empty / Loading States

- **Empty**: "Ready to Optimize Your Playlists" with explanatory text
- **Loading**: Circular spinner with "Analyzing content" message
- **Error**: Error banner with dismiss button

### Admin Variant: `AdminPlaylistOptimizer.tsx`

Rendered at `/admin/playlist-optimizer`:

- Manual URL entry only (textarea for YouTube URLs)
- No channel integration or playlist picker
- No save/history functionality
- All 4 export buttons (JSON, CSV, PDF, ZIP)
- Same result display as user page
- **Admin bypass**: because the caller is an admin, the server-side `channelOwnership.validateVideos` check is skipped — admins can analyze videos from any channel (diagnostic/manual path)

### History Panel: `PlaylistHistoryPanel.tsx`

Side panel accessed via "Saved Analyses" tab:

- Fetches paginated history from `PlaylistOptimizerService.history()`
- Search bar filters by analysis name
- Each item shows name, date, channel title, video count, error badge
- Click to load full analysis; delete with confirmation dialog
- Empty states: "No saved analyses yet" / "No saved analyses match your search"

### Playlist Picker Dialog: `PlaylistPickerDialog.tsx`

Opened by `ChannelPlaylistPicker` when user clicks a channel:

- Fetches all playlists from the channel via `YouTubeService.fetchChannelPlaylists()`
- Lists playlists with checkboxes and select-all
- Shows estimated video count for selected playlists
- On confirm, fetches all videos from selected playlists in parallel via `Promise.allSettled`
- Each video gets `originalPlaylistId` set, plus `customMetadata.originalPlaylistTitle`
- Loading, error, and empty states handled

### Channel Playlist Picker: `ChannelPlaylistPicker.tsx`

Like `ChannelVideoPicker` but for playlists:

- Shows connected YouTube channels in a compact list
- Clicking opens `PlaylistPickerDialog`
- After selection, shows chip with "N playlists · M videos selected"
- Hint text when idle
- Channel list loading from personal tokens or org channels

### Shared Components (from Thumbnail Optimizer)

| Component            | Usage                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ChannelVideoPicker` | NEW mode — browse channels, pick videos; passes `enforceSingleChannel`, `lockedChannelId`, `lockedChannelTitle`, `allowedChannelIds` to child dialogs                                                                                                                                                                                                                                                |
| `VideoSearchDialog`  | Search and select individual videos from a channel. Sort by date / views / title via dropdown plus a direction toggle labeled **Ascending / Descending** (full words, replacing the former ASC/DESC abbreviations). When `lockedChannelId` is set the channel dropdown is disabled; when `enforceSingleChannel` is set, switching channels clears selections so a confirm batch stays single-channel |
| `UrlPasteDialog`     | Paste YouTube URLs manually. Validates each pasted URL's owning channel against `allowedChannelIds`, rejecting foreign (non-connected) videos and, under `enforceSingleChannel`, videos outside the locked channel                                                                                                                                                                                   |

### Connected-Channel + Locked-Channel Enforcement

The Playlist Optimizer's NEW mode enforces both the connected-channel rule (shared with the Thumbnail Optimizer) and a single-channel lock:

- **Connected-channel enforcement**: browse lists only connected channels, and manual paste validates every URL's owning channel against the user's connected `youtubeTokens`/org channels (real time on the frontend, plus a server-side backstop on `POST /analyze`).
- **Single-channel lock** (`enforceSingleChannel`): once the 1st video is added, the channel switcher, search dialogs, and paste dialog are all locked to that one channel (`lockedChannelId`). This guarantees a coherent single-channel analysis.
- **Admin bypass**: Admins (`support@revketer.ai` or `role === 'admin'`) bypass the server-side ownership check and may submit videos from any channel, including via the admin manual-entry tool at `/admin/playlist-optimizer`.

---

## Frontend Routing & Navigation

Three additions to the app shell:

### App Routes (`App.tsx`)

```tsx
const PlaylistOptimizerPage = lazy(() => import('./pages/PlaylistOptimizerPage'));

// Under main routes:
<Route path="playlist-optimizer" element={
  <Suspense><FeatureGuard pageKey="playlistOptimizer"><PlaylistOptimizerPage /></FeatureGuard></Suspense>
} />

// Under admin routes:
<Route path="admin/playlist-optimizer" element={
  <Suspense><AdminRoute><AdminPlaylistOptimizerPage /></AdminRoute></Suspense>
} />
```

### Admin Tab (`AdminPage.tsx`)

- Adds `'playlist-optimizer'` to the `AdminTab` type
- Imports and renders `AdminPlaylistOptimizer` in the tab switch

### Sidebar Nav (`Layout.tsx`)

Nav link under Channel Analytics section (next to Thumbnail Optimizer):

```tsx
<NavLink to="/playlist-optimizer" title="Playlist Optimizer">
  <ListMusic className="nav-icon" />
  {sidebarOpen && <span>Playlist Optimizer</span>}
  {getNavBadge("playlistOptimizer") && <PremiumBadge ... />}
</NavLink>
```

---

## Configuration & Environment

| Setting                | Value                                         | Notes                                                                            |
| ---------------------- | --------------------------------------------- | -------------------------------------------------------------------------------- |
| DeepSeek model         | `deepseek-chat`                               | Set in `playlistOptimizerService.js` (configurable via `DEEPSEEK_MODEL` env var) |
| API key                | `DEEPSEEK_API_KEY` env var                    | Same key used by the existing Chat feature                                       |
| API base URL           | `https://api.deepseek.com`                    | Set in `playlistOptimizerService.js`                                             |
| Cache TTL              | 24 hours                                      | Via `ServerCache`, keyed on `playlist:optimize:v1:{hash}`                        |
| Max videos per request | 500                                           | Enforced in route validation                                                     |
| Retry                  | 3 attempts                                    | Exponential backoff: 2s, 4s, 8s on 429/5xx                                       |
| Free tier limit        | 5/month                                       | From `featureConfig.js`                                                          |
| Pro tier limit         | 100/month                                     | From `featureConfig.js`                                                          |
| Persistence            | PostgreSQL                                    | `playlist_audits` table via raw SQL migration                                    |
| Migration file         | `backend/db/drizzle/0008_playlist_audits.sql` | Run `pnpm run db:migrate`                                                        |

---

## Usage Flow

### NEW Mode (Full Walkthrough)

1. User navigates to `/playlist-optimizer`
2. **New Playlist(s) Strategy** mode is selected by default
3. User sees "Connected Channels" list with hint text
4. User clicks a channel → `VideoSearchDialog` opens showing all videos (up to 200). Sort by date / views / title with an **Ascending / Descending** toggle and live view counts
5. User searches, selects videos, confirms → videos appear as tag chips. The chooser is now **locked to that single channel** (`enforceSingleChannel` + `lockedChannelId`): all later browsing and manual paste is restricted to the same channel
6. (Optional) User expands settings to configure constraints or target playlist
7. User clicks "Analyze N Videos" button — the page enqueues a background BullMQ job (`enqueueJob` → `POST /jobs`); every submitted video is cross-checked server-side against the user's connected channels before enqueueing; foreign videos are rejected with `403`
8. Loading spinner appears while the worker processes via DeepSeek (survives navigation/close via `useSessionJobId` + `useOptimizerJobWatcher`)
9. On completion: audit tab renders with score cards, SWOT, playlists. The worker persisted the analysis, so it auto-appears in Saved Analyses, and the completion notification + email fire
10. User can browse 5 result tabs, export in any format, or switch to Saved Analyses

### EXISTING Mode (Full Walkthrough)

1. User toggles to **Optimize Existing Playlist(s)** mode
2. Videos are cleared, hint text adapts to "Click a channel above to browse and select playlists"
3. User clicks a channel → `PlaylistPickerDialog` opens showing all playlists
4. User selects playlists (with select-all available), confirms
5. Videos from selected playlists appear grouped by playlist name
6. Analysis runs with `analysisMode: "EXISTING"` — DeepSeek optimizes current playlists
7. Results show both before and after metrics (`currentViralityScore` → `viralityScore`)

### Saved Analyses

1. User switches to "Saved Analyses" tab
2. Paginated list of all saved analyses with search
3. Click to load: restores full results, switches to audit tab in "New Analysis" view
4. Delete with confirmation dialog

---

## Error Scenarios

| Error                          | HTTP | User Message                                                                                                 |
| ------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------ |
| Job -- `videos` not an array   | 400  | `"videos" must be an array`                                                                                  |
| Job -- too many videos         | 400  | `Maximum of 500 videos per request (got N)`                                                                  |
| Job -- empty videos + no identifier | 400 | "Provide at least one video or a channel identifier."                                                      |
| Job -- not found               | 404  | "Job not found."                                                                                             |
| Invalid YouTube URL            | 400  | "Invalid YouTube URL"                                                                                        |
| Duplicate video                | 400  | "Video ID is already in the list."                                                                           |
| No videos provided             | 400  | "Add at least one valid video."                                                                              |
| DeepSeek rate limit (429)      | 429  | "DeepSeek API rate limit hit. Wait a moment and try again."                                                  |
| Invalid DeepSeek key / model   | 503  | "Playlist optimization is unavailable (AI config issue). Contact support."                                   |
| JSON parse error               | 502  | "Analysis returned an invalid response. Try again."                                                          |
| Timeout / network              | 502  | "Playlist optimization is temporarily unavailable."                                                          |
| Too many videos                | 400  | "Maximum 500 videos per request."                                                                            |
| Foreign video (non-admin)      | 403  | "N video(s) are not from your connected channels. Only videos from your connected channels can be analyzed." |
| Audit save — not authenticated | 401  | "Not authenticated."                                                                                         |
| Audit save — no DB             | 503  | "Database is not configured. Contact support."                                                               |
| Audit save — invalid body      | 400  | "audits must be a valid object."                                                                             |
| History — invalid ID           | 400  | "Invalid analysis ID."                                                                                       |
| History — not found            | 404  | "Analysis not found."                                                                                        |
| Free user hits 5/month         | 429  | From `requireQuota` middleware                                                                               |

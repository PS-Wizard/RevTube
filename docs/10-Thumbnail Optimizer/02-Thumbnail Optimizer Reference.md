# Thumbnail Optimizer

The Thumbnail Optimizer audits YouTube thumbnails across **12 psychological pillars** using the **Google Gemini API**, scores them, exports PDF reports, and persists audit history to PostgreSQL. It was built in Google AI Studio and integrated as a first-class RevTube feature.

## Scoring Pillars (authoritative)

`backend/config/optimizerCriteria.js` → `DEFAULT_OPTIMIZER_CRITERIA.thumbnail` is the
single source of truth. It is **12** pillars, each with a `key`, `label`, `tier` and
`weight`. Admins can override it via `PUT /api/admin/optimizer-criteria`; the values
below are the **defaults** shipped in code.

| Tier | Count | Pillars (key, weight) |
|---|---|---|
| **Red** | 6 | `promise_lock` (10), `one_idea_rule` (10), `scroll_stop_contrast` (10), `emotional_signal` (10), `thumb_magnet` (10), `open_loop` (10) |
| **Yellow** | 4 | `visual_flow` (7), `glance_readability` (7), `pattern_break` (7), `execution_polish` (7) |
| **Grey** | 2 | `word_economy` (5), `platform_compliance` (5) |

The tier drives how much of the score a pillar can move, and it is also how the UI
groups them:

- **Red** are the make-or-break pillars. Every one is worth 10, so the six of them
  account for 60 of the total and a failure in any single Red pillar dominates the
  result.
- **Yellow** are execution quality, worth 7 each (28 total). Passing them does not
  rescue a bad Red pillar.
- **Grey** are hygiene checks, worth 5 each (10 total). `platform_compliance` in
  particular is a pass/fail style check rather than a quality judgement.

> **Note.** The default weights sum to **98**, not 100. Scoring normalises by the
> weight total it is given, so this is harmless, but do not assume the raw numbers
> are out of 100. The only weight sum the admin API actually enforces is on the Full
> Audit's four sub-audit weights, which must sum to 1.0; optimizer pillar weights are
> normalised, not constrained.

`GET /api/thumbnail-optimizer/criteria` returns these labels and weights to any
authenticated user so the in-app help modal always matches what the engine scores.

## Architecture

```
Browser                         Backend (Express)                    Gemini API
──────                          ────────────────                    ──────────

POST /api/thumbnail-optimizer/analyze
  ──► authenticateRequest ──► checkPremiumAccess ──► requireQuota
       │
       ▼
  thumbnailOptimizerService.analyze()
       │
       ├─► fetch thumbnail images via axios (server-side)
       ├─► POST to Gemini API with structured prompt
       │     (API key from env, never exposed to client)
       └─► cache result in ServerCache (24h TTL)
       │
       ▼
  Return ThumbnailAudit[] + _usage
       │
       ▼
  Browser renders AuditTable + DetailedAnalysis
  Export buttons → PDF via jspdf

  ── BACKGROUND JOB FLOW (default for the page) ──
  POST /api/thumbnail-optimizer/jobs
    ──► resolveUser ──► checkPremiumAccess ──► requireQuota ──► ownership validateVideos
         │
         ▼
    enqueueOptimizer({ kind: 'thumbnail', payload, uid, email, orgId })
      ──► BullMQ 'optimizer' queue worker (backend/queue/optimizerQueue.js)
           ├─► thumbnailOptimizerService.analyze()
           ├─► INSERT INTO thumbnail_audits   (worker persists, no client save call)
           └─► return { savedId, kind, result }
                  │
                  ▼
         worker 'completed' ──► handleAuditCompleted
             └─► in-app notification + email + OS toast

  Browser keeps jobId in sessionStorage (useSessionJobId) and polls
  GET /api/thumbnail-optimizer/jobs/:id every 4s. The Layout-level
  useOptimizerJobWatcher keeps polling even after page nav / tab close.

  ── CHILD AUDIT AUTO-RUN (from Video Audit) ──
  Preferred handoff: /thumbnail-optimizer?audit=<rowId>&scroll=<videoId>
  opens the run's persisted "Video Audit -- <date>" history entry via
  handleLoadAudit and scroll selects + smooth-scrolls the matching deep-dive
  accordion (thumb-audit-<videoId>). Fallback (no saved row yet):
  /thumbnail-optimizer?video=<id>&niche=<niche>&auto=1. On mount,
  ThumbnailOptimizerPage reads those params and auto-enqueues the full
  12-pillar audit for that single watch URL (handleSubmit with the URL +
  niche). This is the classic "child audit" that completes the per-video
  thumbnail series; the resulting deep dive renders in the normal accordion
  view and the job survives navigation via useSessionJobId.

   The Optimized Content list page's "View Audit" resolves its video through
   GET /history/by-video/:videoId and reuses this same
   ?audit=<rowId>&scroll=<videoId> handoff (fresh auto-run = fallback).
   The Video and Playlist tabs use the identical ?audit=&scroll= protocol via
   their own finders: /video-audit/history/by-video and
   /playlist-optimizer/history/by-video.

  ── SYNC ANALYZE FLOW (still supported, used by the admin tool) ──
  POST /api/thumbnail-optimizer/analyze → immediate response, no notification

  ── SAVE / HISTORY FLOW ──
  POST /api/thumbnail-optimizer/save
    ──► resolveUser ──► checkPremiumAccess
         │
         ▼
    INSERT INTO thumbnail_audits (uid, audits JSONB, ...)
         │
         ▼
    Return { id, createdAt }

  GET /api/thumbnail-optimizer/history         → paginated list
  GET /api/thumbnail-optimizer/history/by-video/:videoId
                                               → newest audit id containing video
  GET /api/thumbnail-optimizer/history/:id     → full audit
  DELETE /api/thumbnail-optimizer/history/:id  → remove
```

## Key Files

### Backend
| File | Purpose |
|------|---------|
| `backend/services/thumbnailOptimizerService.js` | Gemini API proxy -- batch analysis, retry logic, server-side thumbnail fetching, prompt construction, response schema enforcement |
| `backend/routes/thumbnailOptimizer.js` | Express router -- `POST /jobs`, `GET /jobs/:id`, `POST /analyze`, `POST /save`, `GET /history`, `GET /history/by-video/:videoId`, `GET /history/:id`, `DELETE /history/:id` with auth, premium access, and quota middleware chain |
| `backend/queue/optimizerQueue.js` | BullMQ job processor shared with the Playlist Optimizer -- dispatches on `job.data.kind`, runs `thumbnailOptimizerService.analyze`, persists to `thumbnail_audits`, returns `{ savedId, kind, result }` |
| `backend/db/drizzle/0007_thumbnail_audits.sql` | Drizzle ORM migration -- `thumbnail_audits` table |
| `backend/db/migrations/004_thumbnail_audits.sql` | Raw SQL migration -- `thumbnail_audits` table + indexes |
| `backend/config/featureConfig.js` | Page config: `freeLimit: 5`, `proLimit: 100`, `premiumOnly: false` |
| `backend/index.js` | Wiring -- service + router creation, DI injection (`query`, `isPostgresConfigured`), route mount |

### Frontend
| File | Purpose |
|------|---------|
| `frontend/src/types/thumbnailOptimizer.ts` | TypeScript interfaces (`ThumbnailAudit`, `OptimizationArea`, `Tier`, `AnalysisState`) |
| `frontend/src/services/thumbnailOptimizerService.ts` | API client with generic `authFetch<T>()` helper -- `enqueueJob()`, `getJobStatus()`, `analyze()`, `save()`, `history()`, `findByVideo()`, `getHistory()`, `deleteHistory()` |
| `frontend/src/services/thumbnailOptimizerExport.ts` | PDF + Excel export -- `downloadPDF()`, `downloadIndividualPDF()`, `downloadExcel()` (3-sheet workbook: Summary, Detailed Areas, Tally), branded `drawAuditPage()`. Per-video CSV export via `downloadCSV()` |
| `frontend/src/hooks/useSessionJobId.ts` | Persists the in-flight jobId in `sessionStorage` (`rt:jobId:thumbnail-optimizer[:org:{orgId}]`) so a running analysis survives navigation/tab close |
| `frontend/src/hooks/useOptimizerJobWatcher.ts` | App-level poller mounted in `Layout` -- reads leftover optimizer jobIds from sessionStorage, polls every 5s, clears the key once completed/failed |
| `frontend/src/pages/thumbnail-optimizer/ThumbnailOptimizerPage.tsx` | Orchestrator -- form, loading animation (5-state cycle), score circles, results, save dialog, view toggle (audit vs history). Deep dives wrapped in the shared `Accordion` (Radix, via the `sx`/Mui* compat shim in `ui/accordion.tsx`) with collapsed summary (video ID, title, score pill, per-video export dropdown) and expanded detail (score circle, context map, verdict, DetailedAnalysis) |
| `frontend/src/pages/thumbnail-optimizer/AuditInputForm.tsx` | Form -- renders ChannelVideoPicker (browse channels + paste URLs side-by-side) plus 3 context fields: Channel Niche, Target Audience, Brand Voice. `videoSource` prop controls labels shown |
| `frontend/src/pages/thumbnail-optimizer/ChannelVideoPicker.tsx` | Side-by-side component: left column lists connected channels and opens a VideoSearchDialog on "Browse Channels"; right column opens a UrlPasteDialog on "Add URLs Directly". Combines URLs from both sources and notifies parent. Supports Shorts URLs (youtube.com/shorts/<ID>). Passes its loaded connected `channels` as `allowedChannelIds` to the paste dialog so manual entry is restricted to the user's own channels |
| `frontend/src/pages/thumbnail-optimizer/VideoSearchDialog.tsx` | Search dialog for video selection -- text search by title, sort by date/views/title with a dedicated direction toggle labeled **Ascending / Descending** (full words, replaces the former ASC/DESC abbreviations), view count displayed per video, paginated results with progressive server-side loading ("Load more" beyond the initial 200-video batch), checkbox selection, confirm bar with count. Accepts `initialSelectedIds` to pre-check videos already added via URL paste |
| `frontend/src/pages/thumbnail-optimizer/UrlPasteDialog.tsx` | Multi-line textarea dialog for pasting YouTube URLs (regular + Shorts). Shows added URLs as chips with delete, then confirms all at once. Supports batch paste, dedup, and removal before submit. When `allowedChannelIds` is provided, each pasted URL's owning channel is resolved and validated: videos outside the user's connected channels are rejected with a red *"not from your channel"* banner. Accepts cross-channel pastes across the user's connected channels (no single-channel lock) unless `enforceSingleChannel` is set |
| `frontend/src/pages/thumbnail-optimizer/AverageScoringSummary.tsx` | Aggregate scoring summary -- averages each of the 12 psychological pillar scores across all audited videos. Shown when 2+ videos are analyzed, sorted by highest average, color-coded per existing design tokens |
| `frontend/src/pages/thumbnail-optimizer/HistoryPanel.tsx` | Saved audit history browser -- search, pagination, load, and delete saved audits |
| `frontend/src/pages/thumbnail-optimizer/AdminThumbnailOptimizer.tsx` | Admin-only component -- uses AuditInputForm with `videoSource="manual"`, full result rendering (AuditTable, DetailedAnalysis), no save/history |
| `frontend/src/pages/thumbnail-optimizer/AuditTable.tsx` | Table -- color-coded score comparison across videos |
| `frontend/src/pages/thumbnail-optimizer/DetailedAnalysis.tsx` | Tiered analysis cards (Red/Yellow/Grey) with LinearProgress bars |
| `frontend/src/pages/thumbnail-optimizer/AuditReportHeader.tsx` | Summary bar with video count + export buttons (PDF + Excel) |
| `frontend/src/pages/thumbnail-optimizer/OptimizerDialog.tsx` | Shared dialog wrapper -- re-exports `Dialog` from `src/components/ui`. Use for all dialog/modal needs. This used to be `AppDialog`; that component was consolidated into `ui/dialog.tsx` and no longer exists. |
| `frontend/src/components/Layout.tsx` | Nav item under Channel Analytics section, `pageKeyMap` entry |

## API Endpoints

| Method | Path | Auth | Quota | Description |
|--------|------|------|-------|-------------|
| `POST` | `/api/thumbnail-optimizer/jobs` | Required | `thumbnailOptimizer` | Enqueue a background thumbnail audit (survives nav/tab close). Returns `{ jobId }` |
| `GET` | `/api/thumbnail-optimizer/jobs/:id` | Required | -- | Poll a background job: `{ jobId, state, progress, result? }` |
| `POST` | `/api/thumbnail-optimizer/analyze` | Required | `thumbnailOptimizer` | Analyze 1–20 YouTube video thumbnails via Gemini (sync; admin tool) |
| `POST` | `/api/thumbnail-optimizer/save` | Required | -- | Persist a completed audit to `thumbnail_audits` table |
| `GET` | `/api/thumbnail-optimizer/history` | Required | -- | List saved audit summaries (paginated, searchable) |
| `GET` | `/api/thumbnail-optimizer/history/:id` | Required | -- | Retrieve a single saved audit with full results |
| `DELETE` | `/api/thumbnail-optimizer/history/:id` | Required | -- | Delete a saved audit |

### Enqueue Job Request
```json
{
  "urls": ["https://youtube.com/watch?v=..."],
  "niche": "Finance",
  "targetAudience": "Young professionals",
  "brandVoice": "Bold, minimal",
  "channelId": "UC...",
  "channelTitle": "My Channel"
}
```

`urls` required, capped at 20. `channelId`/`channelTitle` are optional and stamped onto the persisted `thumbnail_audits` row. Before enqueueing, the route runs `channelOwnership.validateVideos` so non-admins may only analyze their own connected channels. Returns `{ jobId }`.

### Job Status Response
```json
{
  "jobId": "bull:optimizer:abc123",
  "state": "completed",
  "progress": 100,
  "result": { "savedId": 42, "kind": "thumbnail", "result": { "results": [...], "errors": [...] } }
}
```

`state` is one of `waiting` / `active` / `completed` / `failed`. `result` is present only when `completed`; the worker already persisted the audit to `thumbnail_audits` (`savedId`), so no client-side `save()` call is needed.

### Request Body (sync analyze)
```json
{
  "urls": ["https://youtube.com/watch?v=..."],
  "niche": "Finance",
  "targetAudience": "Young professionals",
  "brandVoice": "Bold, minimal"
}
```

At least one URL or one context field required. `urls` array capped at 20 items.

### Response Shape
```json
{
  "results": [
    {
      "url": "https://youtube.com/watch?v=...",
      "videoTitle": "How to...",
      "currentScore": 6,
      "expectedScore": 8,
      "reviewSummary": "Strong hook but weak contrast",
      "strengths": "...",
      "opportunities": "...",
      "detailedAreas": [
        { "area": "Promise Lock", "status": "...", "opportunity": "...", "score": 7, "tier": "Yellow" }
      ]
    }
  ],
  "errors": ["https://invalid.url -- could not fetch thumbnail"]
}
```

### Background Job Flow

The user-facing page now runs audits as **BullMQ background jobs** instead of a blocking axios POST, so an analysis survives navigating to another page or closing the tab:

1. `ThumbnailOptimizerPage` builds the request and calls `ThumbnailOptimizerService.enqueueJob(...)` (`POST /jobs`), which returns a `jobId`.
2. The `jobId` is stored via `useSessionJobId('thumbnail-optimizer', orgId)` in `sessionStorage` (key `rt:jobId:thumbnail-optimizer[:org:{orgId}]`).
3. The page polls `GET /jobs/:id` every 4s. On `completed` it renders `result.result`, clears the jobId, and switches to the audit view. The worker already persisted the audit, so it also appears in Saved Audits.
4. If the user navigates away, the Layout-level `useOptimizerJobWatcher` keeps polling the same jobId every 5s and only handles cleanup. The backend `completed` event fires the in-app notification + email + OS toast via `handleAuditCompleted`, surfaced by `NotificationBell` (which polls globally every 30s).

The sync `POST /analyze` endpoint remains for the admin tool and any direct callers.

### Save Audit Request

```json
{
  "name": "Weekly review - Dec 2024",      // optional, defaults to "Audit -- Mon DD, YYYY"
  "audits": [ /* ThumbnailAudit[] */ ],
  "errors": [{ "url": "...", "error": "..." }],
  "channelId": "UC...",
  "channelTitle": "My Channel",
  "niche": "Finance",
  "targetAudience": "Young professionals",
  "brandVoice": "Bold, minimal"
}
```

### Save Audit Response

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
      "totalVideos": 5,
      "niche": "Finance",
      "hasErrors": false
    }
  ],
  "total": 1,
  "page": 1
}
```

## Guide Dialog

The page header's **Help** button opens a dialog showing:
1. **AI Multi-Dimensional Visual Audit Engine** overview -- explains how the system works
2. **The 12 Scoring Criteria** -- the actual pillar names and their evaluation questions, displayed in a 3-column grid
3. **Scoring Scale Breakdown** -- the 0–10 scoring tiers with color coding

## 12 Psychological Pillars

Each pillar is scored 0–10 and tiered:
- **Red** (0–4): Critical fix
- **Yellow** (5–7): Improvement area
- **Grey** (8–10): Final polish

1. Promise Lock -- Does the thumbnail clearly state what the video delivers?
2. One-Idea Rule -- Does it communicate a single, focused concept?
3. Scroll-Stop Contrast -- Does it stand out in a crowded feed?
4. Focal Burst -- Is the main subject immediately obvious?
5. Color Psychology -- Do colors match the intended emotion?
6. Visual Magnetism -- Is there an irresistible element?
7. Attention Trinity -- Do face, text, and object work together?
8. Metaphorical Magnet -- Does it use a familiar mental shortcut?
9. Brand Consistency -- Does it align with channel branding?
10. Curiosity Gap -- Does it create open loops the viewer must close?
11. Emotional Resonance -- Does it evoke a specific feeling?
12. Simplicity Brutality -- Is every element earned?

## Accordion UI

Each per-video deep dive is wrapped in the shared `Accordion` for a cleaner result overview:

- **Collapsed state**: Shows video number badge, monospace video ID, truncated title, score pill, and a download button (PDF / CSV / Excel per-video dropdown)
- **Expanded state**: Full detail view with score circle, context map (niche/audience/brand voice), executive verdict, and tiered DetailedAnalysis cards
- Icons: `ChevronRight` (expand indicator), `FileText` (PDF), `FileSpreadsheet` (CSV), `Table2` (Excel)

## Export

### Full report (batch)
- **Full report PDF**: Landscape PDF with summary table + per-video detail pages
- **Excel (.xlsx)**: 3-sheet workbook (Summary, Detailed Areas, Tally)
- Buttons on the `AuditReportHeader` bar

### Per-video export
- **Dropdown** in each collapsed accordion summary row
- **PDF**: Single-page landscape audit via `downloadIndividualPDF()`
- **CSV**: Row-per-area flattened export via `downloadCSV()`
- **Excel (.xlsx)**: Same 3-sheet workbook scoped to one video via `downloadExcel()`
- Dependencies: `jspdf` ^3.0.4, `jspdf-autotable` ^5.0.2 (both already in frontend)

## Configuration

| Setting | Value | Notes |
|---------|-------|-------|
| Gemini model | `gemini-3.1-flash-lite` | Set in `thumbnailOptimizerService.js` |
| API key | `GEMINI_API_KEY` env var | Set in `.env` / `.env.prod` |
| Cache TTL | 24 hours | Via `ServerCache` |
| Max concurrency | 5 URLs | `Promise.allSettled` batch |
| Retry | 3 attempts | Exponential backoff on `429` / `RESOURCE_EXHAUSTED` |
| Free tier limit | 5/month | From `featureConfig.js` |
| Pro tier limit | 100/month | From `featureConfig.js` |
| Persistence | PostgreSQL | `thumbnail_audits` table via Drizzle + raw SQL migrations |
| Migration files | `backend/db/drizzle/0007_thumbnail_audits.sql`, `backend/db/migrations/004_thumbnail_audits.sql` | Run `pnpm run db:migrate` |

## PostgreSQL Persistence

Audit history is stored in the `thumbnail_audits` table in PostgreSQL.

### Schema

```sql
CREATE TABLE IF NOT EXISTS thumbnail_audits (
  id            BIGSERIAL PRIMARY KEY,
  uid           TEXT NOT NULL,           -- Firebase user ID
  name          TEXT NOT NULL DEFAULT '',
  channel_id    TEXT,                    -- optional YouTube channel ID
  channel_title TEXT,                    -- optional YouTube channel name
  niche         TEXT,
  target_audience TEXT,
  brand_voice   TEXT,
  total_videos  INTEGER NOT NULL DEFAULT 0,
  audits        JSONB NOT NULL DEFAULT '[]'::jsonb,   -- full ThumbnailAudit[]
  errors        JSONB,                                -- per-video errors
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_thumbnail_audits_uid
  ON thumbnail_audits(uid);

CREATE INDEX IF NOT EXISTS idx_thumbnail_audits_uid_created
  ON thumbnail_audits(uid, created_at DESC);
```

### Migration

Two migration files (Drizzle ORM + raw SQL):
- `backend/db/drizzle/0007_thumbnail_audits.sql`
- `backend/db/migrations/004_thumbnail_audits.sql`

Run via `pnpm run db:migrate` in `backend/`.

### Routes

All persistence endpoints are mounted on the same `thumbnailOptimizerRouter`:
- `POST /save` -- Insert audit results, returns `{ id, createdAt }`
- `GET /history` -- Paginated list (`?limit=20&page=1&search=keyword`), returns `{ items, total, page }`
- `GET /history/:id` -- Full audit details with all results
- `DELETE /history/:id` -- Remove audit, returns `{ success: true }`

All require `resolveUser` + `checkPremiumAccess("thumbnailOptimizer")` middleware. They do not consume quota.

## Input Sources

The `AuditInputForm` renders a single `ChannelVideoPicker` with two side-by-side input sources, available simultaneously regardless of `videoSource` prop:

### Browse Connected Channels (left column)
- Lists connected YouTube channels from personal tokens or org channels
- Clicking "Browse Channels" opens a `VideoSearchDialog` with:
  - 200 most recent videos fetched via `YouTubeService.fetchChannelVideos()`
  - Text search filtering by title (client-side, case-insensitive)
  - Paginated results (20 per page) with "Load more" button
  - Checkbox selection for choosing videos to audit
  - Confirmation bar showing selected count
- Pre-selected: videos already added via URL paste are checked automatically
- Converts selected video IDs to YouTube watch URLs for submission

### Paste Video URLs (right column)
- The right-column heading reads **"Add Videos Manually From Your Channel"** (the same label is used by the Playlist Optimizer)
- Click "Add URLs Directly" opens a `UrlPasteDialog` with:
  - Multi-line textarea for pasting YouTube URLs (one per line, supports regular + Shorts formats)
  - "Add URLs" button parses, deduplicates, and shows valid URLs as removable chips
  - Resolves each pasted URL's owning channel and validates it against the user's connected channels (`allowedChannelIds` passed from `ChannelVideoPicker`)
  - Videos that are **not from a connected channel** are rejected in real time with a red *"not from your channel"* banner (e.g. `"N video(s) are not from your channel. Only videos from your connected channels can be added."`), mirroring the Playlist Optimizer's manual-entry enforcement
  - Cross-channel paste is allowed across the user's connected channels -- there is **no single-channel lock** in the Thumbnail Optimizer (`enforceSingleChannel` stays false)
- Empty states: no channels connected, no videos found, error loading videos, no search match

### Connected-Channel Enforcement

Both the browse and manual-paste paths are restricted to the user's **own connected channels** (personal `youtubeTokens` or org channels):

- **Browse**: The channel switcher only lists connected channels, so every browsed video is already owned.
- **Manual paste**: `UrlPasteDialog` resolves each pasted URL to its channel (`YouTubeService.getChannelIdFromVideo`, backed by a Postgres-first lookup) and rejects any video not owned by a connected channel with a red error banner.
- **Server-side backstop**: Both `POST /api/thumbnail-optimizer/analyze` and `POST /api/thumbnail-optimizer/jobs` run `channelOwnership.validateVideos()` before calling Gemini / enqueueing. Non-admin callers are rejected with `403` if any submitted video is not from one of their connected channels. **Admins bypass this check** and may submit videos from any channel (the admin tool is a diagnostic/manual analysis path).

The `AdminThumbnailOptimizer` wraps `AuditInputForm` with `videoSource="manual"` on the admin page at `/admin/thumbnail-optimizer`. It renders the full result set (AuditTable, DetailedAnalysis, PDF export) but omits save/history functionality -- it is a diagnostic tool for manual URL analysis. Because admins bypass the server-side ownership check, they can analyze any channel's videos here.

## Saving and Loading Audits

When run through the background job flow, the worker persists the audit to `thumbnail_audits` automatically (no save dialog needed), so completed jobs appear directly in **Saved Audits**. For the sync `/analyze` path, a **Save Audit** banner appears above the results table:
1. Click "Save Audit" to open a dialog with an optional name field
2. The audit (results + context fields) is persisted to PostgreSQL via `POST /save`
3. A green success banner confirms the save
4. Navigate to **Saved Audits** tab to browse, search, load, or delete past audits

The `HistoryPanel` component provides:
- Search bar filtering by audit name or channel title (ILIKE)
- Paginated list (10 per page) with date, channel badge, video count
- Click to load -- restores full results including per-video breakdowns
- Delete with confirmation dialog

## Error Handling

| Error | HTTP | User Message |
|-------|------|-------------|
| Job -- `urls` not an array | 400 | `"urls" must be an array of strings` |
| Job -- too many URLs | 400 | `Maximum of 20 URLs per request (got N)` |
| Job -- empty urls | 400 | "Provide at least one YouTube URL." |
| Job -- not found | 404 | "Job not found." |
| Invalid/malformed URL | 400 | Descriptive validation message |
| Gemini rate limit (429) | 429 | "Gemini API rate limit hit. Wait a moment and try again." |
| Invalid Gemini key / model | 503 | "Thumbnail analysis is unavailable (Gemini config issue). Contact support." |
| JSON parse error | 502 | "Thumbnail analysis returned an invalid response. Try again." |
| Timeout / network | 502 | "Thumbnail analysis is temporarily unavailable." |
| Partial failure | 200 | Results array + `errors` array with failed URLs |
| Foreign video (non-admin) | 403 | "N video(s) are not from your connected channels. Only videos from your connected channels can be analyzed." |
| Audit save -- not authenticated | 401 | "Not authenticated." |
| Audit save -- no DB | 503 | "Database is not configured. Contact support." |
| Audit save -- invalid body | 400 | "audits must be a non-empty array." |
| History -- invalid ID | 400 | "Invalid audit ID." |
| History -- not found | 404 | "Audit not found." |
| Free user hits 5/month | 429 | From `requireQuota` middleware |

## Thumbnail Optimizer

Relevant source files

- [backend/services/thumbnailOptimizerService.js](../../backend/services/thumbnailOptimizerService.js)
- [backend/routes/thumbnailOptimizer.js](../../backend/routes/thumbnailOptimizer.js)
- [backend/queue/optimizerQueue.js](../../backend/queue/optimizerQueue.js) *(shared BullMQ job processor: thumbnail + playlist kinds)*
- [backend/config/featureConfig.js](../../backend/config/featureConfig.js)
- [backend/index.js](../../backend/index.js)
- [backend/db/drizzle/0007_thumbnail_audits.sql](../../backend/db/drizzle/0007_thumbnail_audits.sql)
- [backend/db/migrations/004_thumbnail_audits.sql](../../backend/db/migrations/004_thumbnail_audits.sql)
- [frontend/src/types/thumbnailOptimizer.ts](../../frontend/src/types/thumbnailOptimizer.ts)
- [frontend/src/services/thumbnailOptimizerService.ts](../../frontend/src/services/thumbnailOptimizerService.ts)
- [frontend/src/services/thumbnailOptimizerExport.ts](../../frontend/src/services/thumbnailOptimizerExport.ts)
- [frontend/src/hooks/queries/useThumbnailAudit.ts](../../frontend/src/hooks/queries/useThumbnailAudit.ts) *(sync-path mutation; the page now uses the job flow)*
- [frontend/src/hooks/useSessionJobId.ts](../../frontend/src/hooks/useSessionJobId.ts)
- [frontend/src/hooks/useOptimizerJobWatcher.ts](../../frontend/src/hooks/useOptimizerJobWatcher.ts)
- [frontend/src/pages/ThumbnailOptimizerPage.tsx](../../frontend/src/pages/thumbnail-optimizer/ThumbnailOptimizerPage.tsx)
- [frontend/src/pages/thumbnailOptimizer/AuditInputForm.tsx](../../frontend/src/pages/thumbnail-optimizer/AuditInputForm.tsx)
- [frontend/src/pages/thumbnailOptimizer/ChannelVideoPicker.tsx](../../frontend/src/pages/thumbnail-optimizer/ChannelVideoPicker.tsx)
- [frontend/src/pages/thumbnailOptimizer/VideoSearchDialog.tsx](../../frontend/src/pages/thumbnail-optimizer/VideoSearchDialog.tsx)
- [frontend/src/pages/thumbnailOptimizer/HistoryPanel.tsx](../../frontend/src/pages/thumbnail-optimizer/HistoryPanel.tsx)
- [frontend/src/pages/thumbnailOptimizer/AdminThumbnailOptimizer.tsx](../../frontend/src/pages/thumbnail-optimizer/AdminThumbnailOptimizer.tsx)
- [frontend/src/pages/thumbnailOptimizer/AuditTable.tsx](../../frontend/src/pages/thumbnail-optimizer/AuditTable.tsx)
- [frontend/src/pages/thumbnailOptimizer/DetailedAnalysis.tsx](../../frontend/src/pages/thumbnail-optimizer/DetailedAnalysis.tsx)
- [frontend/src/pages/thumbnailOptimizer/AuditReportHeader.tsx](../../frontend/src/pages/thumbnail-optimizer/AuditReportHeader.tsx)
- [frontend/src/pages/thumbnailOptimizer/OptimizerDialog.tsx](../../frontend/src/pages/thumbnail-optimizer/OptimizerDialog.tsx) *(re-exports `AppDialog`)*
- [frontend/src/components/ui/dialog.tsx](../../frontend/src/components/ui/Modal.tsx) *(shared dialog wrapper for all app modals)*
- [frontend/src/components/Layout.tsx](../../frontend/src/components/Layout.tsx)
- [frontend/src/pages/AdminPage.tsx](../../frontend/src/pages/admin/AdminPage.tsx)
- [Thumbnail Optimizer Reference](../10-Thumbnail Optimizer/02-Thumbnail Optimizer Reference)

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

The Thumbnail Optimizer audits YouTube thumbnails across 12 psychological pillars using the Gemini API. It was built in Google AI Studio and integrated as a first-class feature following RevTube's existing patterns — backend proxy service, route factory, TanStack Query mutation, shared UI primitives, auth/quota middleware, **and PostgreSQL persistence for audit history**.

---

## Architecture Overview

```
Browser                         Backend (Express)                    Gemini API
──────                          ────────────────                    ──────────

POST /api/thumbnail-optimizer/jobs            (default page flow)
  ──► authenticateRequest ──► checkPremiumAccess ──► requireQuota ──► validateVideos
       │
       ▼
  enqueueOptimizer({ kind: 'thumbnail', payload, uid, email, orgId }) → BullMQ 'optimizer'
       │
       ▼
  optimizer queue worker (backend/queue/optimizerQueue.js)
       ├─► thumbnailOptimizerService.analyze()
       ├─► INSERT INTO thumbnail_audits (worker persists)
       └─► return { savedId, kind, result }
              │
              ▼
     worker 'completed' ──► handleAuditCompleted ──► in-app + email + OS notification

  Browser holds jobId in sessionStorage (useSessionJobId), polls
  GET /jobs/:id; useOptimizerJobWatcher (in Layout) keeps polling after nav/close.

POST /api/thumbnail-optimizer/analyze         (sync; admin tool + direct callers)
  ──► authenticateRequest ──► checkPremiumAccess ──► requireQuota
       │
       ▼
  thumbnailOptimizerService.analyze() → Return ThumbnailAudit[] + _usage

  ── PERSISTENCE FLOW ──
  POST /api/thumbnail-optimizer/save        ──► resolveUser ──► INSERT thumbnail_audits
  GET  /api/thumbnail-optimizer/history      ──► resolved paginated list query
  GET  /api/thumbnail-optimizer/history/:id  ──► full audit retrieval
  DELETE /api/thumbnail-optimizer/history/:id ──► remove audit
```

The feature is self-contained — all frontend/backend files are new and plug into the existing DI container, route tree, and layout without modifying shared code beyond four wiring points. Latest additions add PostgreSQL persistence via `query()` from route deps, and move the user-facing page onto a BullMQ **background job** flow (`POST /jobs` + `GET /jobs/:id`) so analyses survive page navigation and tab close. The worker (shared `optimizer` queue, dispatched on `job.data.kind`) persists results to `thumbnail_audits` and fires the completion notification/email via `handleAuditCompleted`. See [Thumbnail Optimizer Reference](../10-Thumbnail Optimizer/02-Thumbnail Optimizer Reference), [Job Queues](06-Job Queues (BullMQ)) and [Notification System](../13-Notification System/02-Notification Reference).

### Child audit (handoff from Video Audit)

The Thumbnail Optimizer is also invoked as a **child audit** by the Video Audit feature. During a
video audit, `scoreVideo` (`backend/services/videoAuditService.js`) calls
`thumbnailOptimizerService.analyze()` in parallel for each video and reuses its
`currentScore`/`expectedScore` and full `ThumbnailAudit` for the thumbnail element (see
[Video Audit](../12-Video%20Audit/Video%20Audit.md)). In the Video Audit detailed breakdown the
thumbnail element shows only a score, a "General Knowledge" summary, and a **"Detailed
Thumbnail Analysis"** button (no text-style concept cards).

Clicking that button prefers the persisted route:
`/thumbnail-optimizer?audit=<rowId>&scroll=<videoId>` opens the "Video Audit --
<date>" history entry created when the video-audit job finished
(`handleLoadAudit` loads it, `scroll` selects which deep-dive accordion to
expand + smooth-scroll to). When no such row exists yet, it falls back to
`/thumbnail-optimizer?video=<id>&niche=<niche>&auto=1`; on mount,
`ThumbnailOptimizerPage` reads those params and auto-enqueues the full 12-pillar
audit for that single watch URL (via `handleSubmit`), rendering the per-pillar
deep dive. This fallback is the classic "child audit" that completes the
per-video thumbnail series; the running job survives navigation via
`useSessionJobId` sessionStorage persistence.

The **Optimized Content** list page (`frontend/src/pages/optimized/OptimizedListPage.tsx`)
reuses the same deep link for its Thumbnail tab's **View Audit** action: it asks
the backend for the newest saved run containing that video
(`GET /history/by-video/:videoId`) and navigates to
`?audit=<rowId>&scroll=<videoId>` (loads the persisted entry and smooth-scrolls
to the video's accordion, zero AI cost); when no saved entry exists or the
lookup fails it falls back to the fresh `?video=<id>&auto=1` auto-run above.
Its Video and Playlist tabs share this exact `?audit=&scroll=` protocol through
their own finders (`/video-audit/history/by-video/:videoId`,
`/playlist-optimizer/history/by-video/:videoId`).

---

## Backend Service: `thumbnailOptimizerService.js`

A factory function `createThumbnailOptimizerService(deps)` that returns `{ analyze(urls, niche, targetAudience, brandVoice) }`.

### Key Design Decisions

1. **No `@google/genai` SDK** — Uses plain `axios` to the Gemini REST API. Avoids an unnecessary dependency and follows the pattern set by other services.

2. **Server-side thumbnail fetching** — Thumbnail images are fetched server-side via `axios({ responseType: 'arraybuffer' })` → base64 before being sent to Gemini. The API key is never exposed to the browser.

3. **Structured output** — The Gemini API is called with `responseMimeType: "application/json"` and a JSON Schema `responseSchema`. The response schema enforces the full `ThumbnailAudit` shape including the 12 pillar analysis, scores, and tier assignments.

4. **Retry logic** — `retryWithBackoff()` handles `429 RESOURCE_EXHAUSTED` with exponential backoff (3 retries: ~1s, ~2s, ~4s). Other HTTP errors bubble immediately.

5. **Parallel batch processing** — Up to 5 URLs processed concurrently via `Promise.allSettled`. Results and errors are separated at the end — partial failures return a 200 with `results` + `errors` arrays.

6. **Cache** — Cache key `thumbnail:audit:v1:${scopeHash}` derived from `shortHash(JSON.stringify({ urls, niche, targetAudience, brandVoice }))`. 24-hour TTL via `ServerCache`. Full cache bust on key mismatch — no stale partial hits.

### Prompt Structure

The Gemini prompt is built from `buildPrompt()` and includes:
- System instruction establishing the expert role (psychological thumbnail auditor)
- The 12-pillar audit framework as structured rubric
- Base64 thumbnail images for each URL
- Context fields (niche, audience, brand voice) as optional modifiers
- Explicit JSON Schema for response structure enforcement

### Gemini Model

Uses `gemini-3.1-flash-lite` — the cheapest, fastest Gemini tier suitable for structured JSON extraction tasks. This is a downgrade from `gemini-2.5-flash-preview-04-17` (used in the initial integration) to reduce cost per audit since the task is primarily rubric-based scoring with structured output, not creative generation.

### Error Handling

The `analyze` route has comprehensive error logging and categorization:

```
[ThumbnailOptimizer:analyze] ===== ERROR =====
[ThumbnailOptimizer:analyze] Message: ...
[ThumbnailOptimizer:analyze] Status: 429
[ThumbnailOptimizer:analyze] Response body: ...
[ThumbnailOptimizer:analyze] Stack: ...
[ThumbnailOptimizer:analyze] ===================
```

Error codes returned to client:

| Code | Condition | HTTP | Notes |
|------|-----------|------|-------|
| `GEMINI_RATE_LIMITED` | 429 from Gemini | 429 | Includes `detail` with raw response |
| `GEMINI_CONFIG_ERROR` | 403 / bad key / unsupported model | 503 | Includes `detail` in dev mode |
| `GEMINI_PARSE_ERROR` | JSON parse failure from Gemini | 502 | Includes `detail` in dev mode |
| — | Timeout / generic | 500 | Includes `error.message` + dev `detail` |

In development mode (`NODE_ENV !== "production"`), error responses include a `detail` field with up to 400 characters of the raw error message for debugging. In production, this is omitted.

### Persistence Error Codes

| Scenario | HTTP | Message |
|----------|------|---------|
| No DB configured | 503 | "Database is not configured. Contact support." |
| Not authenticated | 401 | "Not authenticated." |
| Invalid audit ID | 400 | "Invalid audit ID." |
| Audit not found | 404 | "Audit not found." |
| Missing audits array | 400 | "audits must be a non-empty array." |

---

## Backend Route: `thumbnailOptimizer.js`

Factory `createThumbnailOptimizerRouter(deps)` returning an Express router. Takes `query`, `isPostgresConfigured`, and `queueService` from deps in addition to middleware and services.

### Endpoint: `POST /jobs` (background job enqueue; default page flow)

**Middleware chain**: `express.json()` → `resolveUser` → `checkPremiumAccess("thumbnailOptimizer")` → `requireQuota("thumbnailOptimizer")`

**Request validation**:
- `urls` must be a non-empty array (max 20 items)
- Each URL and context string is trimmed and length-capped at 1000 chars
- Runs `channelOwnership.validateVideos(req, urls.map(u => ({ url: u })))` before enqueueing — non-admins limited to connected-channel videos (`403` on any foreign video)

**Behavior**: Calls `queueService.enqueueOptimizer({ kind: 'thumbnail', payload: { urls, niche, targetAudience, brandVoice, channelId, channelTitle }, uid, email, orgId }, { removeOnComplete: { age: 3600*24 }, removeOnFail: { age: 3600*24*7 } })` on the shared BullMQ `optimizer` queue. The worker runs `thumbnailOptimizerService.analyze`, inserts into `thumbnail_audits`, and returns `{ savedId, kind, result }`. The `completed` event fires `handleAuditCompleted` (in-app notification + email + OS toast).

**Response**: `{ jobId: string }`.

### Endpoint: `GET /jobs/:id` (job polling)

**Middleware**: `resolveUser` only.

**Behavior**: Loads the job by id (id sanitized to `[0-9A-Za-z_-]`), returns `404 "Job not found."` if missing, else the state via `job.getState()`.

**Response**:
```json
{
  "jobId": "bull:optimizer:abc123",
  "state": "waiting | active | completed | failed",
  "progress": 100,
  "result": { "savedId": 42, "kind": "thumbnail", "result": { "results": [...], "errors": [...] } }
}
```
`result` is included only when `state === "completed"`. The worker already persisted the audit, so no client-side `save()` call is needed.

### Endpoint: `POST /analyze`

**Middleware chain**: `express.json()` → `resolveUser` → `checkPremiumAccess("thumbnailOptimizer")` → `requireQuota("thumbnailOptimizer")`

**Request validation**:
- `urls` must be an array (max 20 items)
- Each URL and context string is trimmed and length-capped at 1000 chars
- At least one URL or context field required → 400 otherwise

**Server-side channel ownership validation** (added after the 400 validation): When `urls` is non-empty, the handler calls `channelOwnership.validateVideos(req, urls.map(u => ({ url: u })))` (from `backend/utils/channelOwnership.js`). Non-admin callers are limited to videos from their own connected channels (personal `youtubeTokens` or org channels when `X-Org-Id` is present). Each submitted URL is resolved to its owning channel Postgres-first via `getVideosByIds` (from `analytics_videos`, the 6-hour-ingested table) with a live YouTube `videos` snippet fallback. Any foreign video returns **`403`** with *"N video(s) are not from your connected channels. Only videos from your connected channels can be analyzed."* **Admins bypass** this check entirely (`support@revketer.ai` or `role === "admin"`) and may analyze any channel.

**Response**:
```json
{
  "results": [ /* ThumbnailAudit[] */ ],
  "errors": ["invalid-url — could not fetch thumbnail"]
}
```

**Usage tracking**: `_usage` is auto-attached by `requireQuota` middleware to all JSON responses. No manual increment needed.

### Endpoint: `POST /save`

Persist a completed audit to PostgreSQL. Does not consume quota.

**Body**: `{ name?, audits: ThumbnailAudit[], errors?, channelId?, channelTitle?, niche?, targetAudience?, brandVoice? }`

**Response** `201`: `{ id: number, createdAt: string }`

**Validation**: `audits` must be a non-empty array; `name` capped at 200 chars.

### Endpoint: `GET /history`

Paginated, searchable audit history list.

**Query params**: `?limit=20&page=1&search=keyword` (limit 1–100)

**Response**: `{ items: SavedAuditSummary[], total: number, page: number }`

### Endpoint: `GET /history/by-video/:videoId`

Resolves the newest saved audit whose `audits` JSONB contains the given YouTube
video id (substring match against each stored result's `url`, so watch /
shorts / youtu.be forms and raw ids all hit). Scoped by `uid`; used by the
Optimized Content list to deep-link **View Audit** into an existing run.

**Response**: `{ id: number | null }`

### Endpoint: `GET /history/:id`

Full audit retrieval.

**Response**: Full `SavedAudit` with all results, context fields, timestamps.

### Endpoint: `DELETE /history/:id`

Remove a saved audit. Owner-only (scoped by `uid`).

**Response**: `{ success: true }`

### Guard Pattern

All persistence endpoints use a shared `guardPg(req, res)` helper that checks:
1. PostgreSQL is configured (`isPostgresConfigured()`) → 503 if not
2. User is authenticated (`req.authUser.uid`) → 401 if not
3. Returns `uid` on success, `null` on failure (response sent)

---

## Feature Configuration

In `backend/config/featureConfig.js`, added to `DEFAULT_FEATURE_CONFIG.pages`:

```javascript
thumbnailOptimizer: {
  label: "Thumbnail Optimizer",
  premiumOnly: false,
  freeLimit: 5,
  proLimit: 100,
}
```

- `premiumOnly: false` — available to all users, not just Pro
- Free users: 5 audits/month (matches typical free-tier sanity check)
- Pro users: 100 audits/month (sufficient for regular optimization)

---

## Backend Wiring

In `backend/index.js`, three additions following the existing factory pattern:

1. **Imports** — `createThumbnailOptimizerService` and `createThumbnailOptimizerRouter` are imported at the top of the file (alongside other service/router factories)

2. **Service creation** (in the service DI block):
   ```javascript
   const thumbnailOptimizerService = createThumbnailOptimizerService({
     axios,
     ServerCache,
     shortHash,
   });
   ```
   Then added to `serviceDeps` alongside analytics, dashboard, etc.

3. **Router creation and mount** (in the router DI block):
   ```javascript
   const thumbnailOptimizerRouter = createThumbnailOptimizerRouter(routeDeps);
   apiRouter.use("/thumbnail-optimizer", thumbnailOptimizerRouter);
   ```

---

## PostgreSQL Persistence

Audit history is stored in the `thumbnail_audits` table. Two migration files are provided:

- `backend/db/drizzle/0007_thumbnail_audits.sql` — Drizzle ORM migration
- `backend/db/migrations/004_thumbnail_audits.sql` — Raw SQL migration

Run via `pnpm run db:migrate` in `backend/`.

### Schema

| Column | Type | Notes |
|--------|------|-------|
| `id` | `BIGSERIAL PRIMARY KEY` | Auto-incrementing ID |
| `uid` | `TEXT NOT NULL` | Firebase user ID — owner |
| `name` | `TEXT NOT NULL DEFAULT ''` | User-friendly audit name |
| `channel_id` | `TEXT` | Optional YouTube channel ID |
| `channel_title` | `TEXT` | Optional YouTube channel name |
| `niche` | `TEXT` | Context from the audit request |
| `target_audience` | `TEXT` | Context from the audit request |
| `brand_voice` | `TEXT` | Context from the audit request |
| `total_videos` | `INTEGER NOT NULL DEFAULT 0` | Number of videos in this audit |
| `audits` | `JSONB NOT NULL DEFAULT '[]'` | Full `ThumbnailAudit[]` array |
| `errors` | `JSONB` | Per-video errors, or null |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` | |

Indexed on `uid` and `(uid, created_at DESC)` for efficient per-user history queries.

### Architecture

| Layer | File | Role |
|-------|------|------|
| Route | `backend/routes/thumbnailOptimizer.js` | CRUD endpoints with `guardPg()` + auth |
| DB client | `backend/db/client.js` | `query()` from route deps |
| Migration (Drizzle) | `backend/db/drizzle/0007_thumbnail_audits.sql` | ORM migration |
| Migration (raw) | `backend/db/migrations/004_thumbnail_audits.sql` | Manual migration |

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/save` | Insert audit results, returns `{ id, createdAt }` |
| `GET` | `/history` | Paginated list (`?limit=20&page=1&search=keyword`) |
| `GET` | `/history/:id` | Full audit with all ThumbnailAudit[] results |
| `DELETE` | `/history/:id` | Remove audit (owner-only, scoped by uid) |

All persistence endpoints use `resolveUser` + `checkPremiumAccess` middleware. They do not consume quota.

---

## Frontend Types

`frontend/src/types/thumbnailOptimizer.ts` — TypeScript interfaces shared across the frontend:

```typescript
export type Tier = 'Red' | 'Yellow' | 'Grey';

export interface OptimizationArea {
  area: string;          // Pillar name (e.g. "Promise Lock")
  status: string;        // Assessment summary (e.g. "Strong hook, needs clarity")
  opportunity: string;   // Strategic improvement suggestion
  score: number;         // 0–10
  tier: Tier;            // Red (0–4), Yellow (5–7), Grey (8–10)
}

export interface ThumbnailAudit {
  url: string;
  videoTitle: string;
  reviewSummary: string;
  strengths: string;
  opportunities: string;
  currentScore: number;    // Overall score 0–10
  expectedScore: number;   // Potential after fixes
  detailedAreas: OptimizationArea[];
  niche?: string;
  targetAudience?: string;
  brandVoice?: string;
}

export type AnalysisState = 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';
export interface AuditRequest { urls: string[]; niche?: string; targetAudience?: string; brandVoice?: string; }
export interface AuditResponse { results: ThumbnailAudit[]; errors?: Array<{ url: string; error: string }>; }

// ── Persisted audit types ──

export interface SavedAuditSummary {
  id: number;
  name: string;
  createdAt: string | null;
  channelId: string | null;
  channelTitle: string | null;
  totalVideos: number;
  niche: string | null;
  hasErrors: boolean;
}

export interface SavedAudit extends SavedAuditSummary {
  audits: ThumbnailAudit[];
  errors?: Array<{ url: string; error: string }>;
  targetAudience: string | null;
  brandVoice: string | null;
  updatedAt?: string | null;
}

export interface HistoryResponse {
  items: SavedAuditSummary[];
  total: number;
  page: number;
}

export interface SaveAuditRequest {
  name?: string;
  audits: ThumbnailAudit[];
  errors?: Array<{ url: string; error: string }>;
  channelId?: string;
  channelTitle?: string;
  niche?: string;
  targetAudience?: string;
  brandVoice?: string;
}
```

---

## Frontend Service Layer

### API Client: `thumbnailOptimizerService.ts`

Uses a generic `authFetch<T>()` helper that handles Firebase auth headers, JSON response parsing, usage extraction, and error formatting for all endpoints:

```typescript
async function authFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const authHeaders = await getFirebaseAuthHeader();
  const response = await fetch(apiUrl(path), {
    ...options,
    headers: { 'Content-Type': 'application/json', ...authHeaders, ...options.headers },
  });
  const body = await readJsonResponse(response, `ThumbnailOptimizer.${path}`);
  tryExtractUsage(body);
  if (!response.ok) {
    const errBody = body as { error?: { message?: string; code?: string; detail?: string } };
    let errMsg = errBody?.error?.message || `Request failed with status ${response.status}`;
    if (errBody?.error?.detail) errMsg += ` (${errBody.error.detail})`;
    throw new Error(errMsg);
  }
  return body as T;
}
```

Static methods:

```typescript
// Enqueue a background thumbnail analysis (default page flow)
static async enqueueJob(params: AuditRequest & { channelId?: string; channelTitle?: string }, orgId?: string): Promise<{ jobId: string }>

// Poll a background optimizer job
static async getJobStatus(jobId: string): Promise<{ jobId: string; state: string; progress?: number; result?: { savedId?: number; kind?: string; result: AuditResponse } }>

// Analyze thumbnails (sync; admin tool + direct callers)
static async analyze(params: AuditRequest): Promise<AuditResponse>

// Persist a completed audit
static async save(params: SaveAuditRequest): Promise<{ id: number; createdAt: string }>

// List saved audit summaries
static async history(params?: { limit?: number; page?: number; search?: string }): Promise<HistoryResponse>

// Retrieve a single saved audit
static async getHistory(id: number): Promise<SavedAudit>

// Delete a saved audit
static async deleteHistory(id: number): Promise<{ success: boolean }>
```

Uses existing utilities `getFirebaseAuthHeader()`, `readJsonResponse()`, `apiUrl()`, and `tryExtractUsage()` — all shared from the service layer pattern.

### TanStack Query Hook: `useThumbnailAudit.ts`

```typescript
export interface AuditResponseData {
  results: ThumbnailAudit[];
  errors?: Array<{ url: string; error: string }>;
}

interface UseThumbnailAuditOptions {
  onSuccess?: (data: AuditResponseData) => void;
  onError?: (error: Error) => void;
}

export function useThumbnailAudit({ onSuccess, onError }: UseThumbnailAuditOptions = {}) {
  return useMutation({
    mutationFn: (params: AuditRequest) => ThumbnailOptimizerService.analyze(params),
    onSuccess: (data) => onSuccess?.({ results: data.results, errors: data.errors }),
    onError,
    retry: 0,                           // No retries — Gemini calls are expensive
    meta: { suppressGlobalErrorToast: true },  // Custom error display
  });
}
```

Key changes in the latest iteration:
- `onSuccess` now passes an `AuditResponseData` object with both `results` and `errors` instead of just `ThumbnailAudit[]`
- Per-video errors from partial batch failures are surfaced to the user
- Custom error handling instead of global toast — Gemini errors (rate limits, config issues) are displayed inline in the audit form rather than as a global notification

---

## Frontend Page Components

### `ThumbnailOptimizerPage.tsx` (orchestrator)

The page now runs audits as **BullMQ background jobs** (not the sync mutation). It holds a `jobId` via `useSessionJobId("thumbnail-optimizer", orgId)` (persisted in `sessionStorage` so the job survives navigation/close), sets `isRunning` while a job is in flight, and polls `ThumbnailOptimizerService.getJobStatus(jobId)` every 4s:

- On `state === "completed"` it renders `result.result` (results + per-video errors), clears the jobId, and switches to the audit view. The worker already persisted the audit, so it appears in Saved Audits with no save call.
- On `state === "failed"` it clears the jobId and shows the error.
- On mount, a leftover sessionStorage jobId restores `isRunning` so polling resumes.

If the user navigates away before completion, the Layout-level `useOptimizerJobWatcher` keeps polling the jobId every 5s and clears the key on completion. The backend `completed` handler (`handleAuditCompleted`) fires the in-app notification + email + OS toast, surfaced by `NotificationBell`.

View toggle: `<Tabs>` switches between **New Audit** (Sparkles icon) and **Saved Audits** (History icon) views. The history view renders `HistoryPanel` instead of the audit form.

**Save dialog**: Only on the sync `/analyze` path does the "Save Audit" banner appear, persisted via `ThumbnailOptimizerService.save()`.

**Loading saved audits**: `handleLoadAudit(id)` calls `ThumbnailOptimizerService.getHistory()`, restores full audit results onto the page, and switches to audit view.

**Score visualization**: Each audit card shows a circular SVG score ring (animated stroke-dashoffset transition) with the numeric score centered. The ring color uses `#36659b` (RevKeter brand blue).

**Loading animation**: Cycles through 5 messages at 2.5s intervals:
1. "Fetching your video thumbnails..."
2. "Analyzing psychological triggers..."
3. "Evaluating color, contrast, and composition..."
4. "Cross-referencing best practices..."
5. "Calculating success potential..."

### `AuditInputForm.tsx`

`Paper` container with a `videoSource` prop controlling the submit labels shown. It renders a `ChannelVideoPicker` (browse channels + paste URLs side-by-side) in both modes — no tabs, no mode switching in this component:

**Client usage** (`videoSource="channel"`, default for client users):
- Renders `ChannelVideoPicker` with `enforceSingleChannel=false` — cross-channel selection allowed across the user's connected channels, but manual paste is still restricted to connected channels via `allowedChannelIds`
- Clicking a channel opens a `VideoSearchDialog` for search and selection
- Shows selected count badge ("N video(s) selected for audit")

**Admin usage** (`videoSource="manual"`):
- Same `ChannelVideoPicker` (browse + paste) rendered as a diagnostic tool
- Supports YouTube watch URLs and short links (youtu.be)
- Because the caller is an admin, the server-side ownership check is bypassed — admins can analyze any channel's videos

Shared features:
- 3 context `TextField`s (Grid layout): Channel Niche, Target Audience, Brand Voice
- Submit button with `CircularProgress` loading state
- Error display (`validationError` or server `error`)

The component is reused in two places:
- `ThumbnailOptimizerPage.tsx` — default `videoSource="channel"` for client-side users
- `AdminThumbnailOptimizer.tsx` — `videoSource="manual"` for the admin diagnostic tool

### `ChannelVideoPicker.tsx`

Side-by-side component for selecting videos, shared by the Thumbnail Optimizer (`enforceSingleChannel=false`) and the Playlist Optimizer (`enforceSingleChannel=true`). Reused in both client and admin contexts:

**Left column — Browse connected channels**:
1. **Channel list** — Builds from personal YouTube tokens (`allTokens`) or org channels (`getOrganizationChannels`) depending on organization context
2. **Browse Channels** — Opens a `VideoSearchDialog` for the selected channel (or the locked channel, when `lockedChannelId` is set)
3. **URL conversion** — Selected video IDs from the dialog are converted to `https://www.youtube.com/watch?v=` URLs and passed to the parent via `onUrlsChange`
4. **Edge states**: No channels connected (empty message), selection count chip with clear button

**Right column — Paste URLs**:
1. **Heading** — "Add Videos Manually From Your Channel" (both optimizers)
2. **Add URLs Directly** — Opens a `UrlPasteDialog`
3. Passes to `UrlPasteDialog`: `lockedChannelId`, `lockedChannelTitle`, `enforceSingleChannel`, and `allowedChannelIds={channels.map(c => c.id)}` so manual paste is restricted to the user's own connected channels

**Connected-channel enforcement**: The loaded connected channels are always passed as `allowedChannelIds` to the paste dialog, so manual entry is validated against the user's own channels in both optimizers. The Thumbnail Optimizer allows cross-channel paste across connected channels (no single-channel lock); the Playlist Optimizer also enforces `enforceSingleChannel`.

### `VideoSearchDialog.tsx`

shared `Dialog` for searching, filtering, and selecting videos from a connected YouTube channel:

1. **Video loading** — Fetches 200 most recent videos via `YouTubeService.fetchChannelVideos(channelId, 200)` when the dialog opens
2. **Search bar** — `<TextField>` with search icon, client-side title filtering (case-insensitive `includes` match)
3. **Sort bar** — Sort by date / views / title via dropdown, plus a dedicated direction toggle labeled **Ascending / Descending** (full words; replaced the former ASC/DESC abbreviations)
4. **Video list** — `<List>` of videos with checkbox, thumbnail (60×34 rounded), title (2-line clamp), publish date, and formatted view count
5. **Pagination** — 20 videos per page, "Load more" button showing remaining count, with progressive server-side loading beyond the initial 200-video batch
6. **Selection** — `Set<string>` state tracking selected video IDs, highlighted background on selected items. When `lockedChannelId` is set (single-channel mode) the channel dropdown is disabled; when `enforceSingleChannel` is set, switching channels clears selections so a confirm batch stays single-channel
7. **Confirm** — Returns YouTube watch URLs (`https://www.youtube.com/watch?v=...`) to the parent via `onConfirm(urls)`. Accepts `initialSelectedIds` to pre-check videos already added via URL paste
8. **Edge states**: Loading spinner, error message, empty (no videos found / no search match), zero selection disables confirm button

**Dialog states:**
| State | UI |
|-------|-----|
| Loading | Centered `CircularProgress` |
| Error | Error message in danger color |
| Empty (no videos) | "No videos found for this channel." |
| Empty (search match) | `No videos match "query".` |
| Loaded | Video list with "N videos · showing M · X selected" footer |
| Loaded + more available | "Load more (N left)" button |

### `UrlPasteDialog.tsx`

Multi-line textarea dialog for pasting YouTube URLs (regular + Shorts), shown as removable chips:

1. **URL textarea** — Multiline `<TextField>` accepting YouTube URLs (one per line)
2. **Add URLs** — Parses, deduplicates, and shows valid URLs as removable chips
3. **Connected-channel validation** — When `allowedChannelIds` is provided, every pasted URL's owning channel is resolved via `YouTubeService.getChannelIdFromVideo` (Postgres-first) and validated:
   - **Foreign** video (channel not in the user's connected channels) → rejected with a red error banner: *"N video(s) are not from your channel. Only videos from your connected channels can be added."*
   - Cross-channel pastes across connected channels are accepted unless `enforceSingleChannel` is set, in which case the locked-channel rule applies (Playlist Optimizer)
4. **Confirm** — Returns the validated URL list to the parent via `onConfirm(urls)`

### `HistoryPanel.tsx`

Browse, load, and manage saved thumbnail audits:

1. **Search bar** — Filters saved audits by name or channel title (ILIKE query)
2. **Pagination** — 10 items per page, shared `Pagination` component
3. **Audit list** — Shows name, date, channel badge, video count, error indicator
4. **Load** — Clicking an item calls `onLoadAudit(id)` which fetches full results
5. **Delete** — Trash icon opens confirmation `<Dialog>`, then calls `ThumbnailOptimizerService.deleteHistory()`
6. **Edge states**: Loading spinner, error banner, empty state ("No saved audits yet" / "No audits match your search")

### `AdminThumbnailOptimizer.tsx`

Admin-only diagnostic wrapper for manually auditing thumbnail URLs. Mounted at `/admin/thumbnail-optimizer` in the AdminPage tabs:

1. **Input** — Uses `AuditInputForm` with `videoSource="manual"` (URL textarea only, no channel selection)
2. **Mutation** — Uses the same `useThumbnailAudit` TanStack Query hook as the main page
3. **Results** — Renders `AuditReportHeader` (export button), `AuditTable` (comparison), and `DetailedAnalysis` (per-video deep dives with animated score circles)
4. **PDF export** — Full report and per-video PDF downloads via `thumbnailOptimizerExport`
5. **No persistence** — No save or history functionality (purely diagnostic)
6. **States**: IDLE (empty state hint with icon), LOADING (cycling 5-message animation), SUCCESS (results), ERROR (inline error)

Key differences from the main `ThumbnailOptimizerPage`:
- Uses `Container` without gutters for full-width layout
- No view toggle (no "Saved Audits" tab)
- Admin badge header with scan icon
- Simpler lifecycle — no save dialog, no history loading

**Wiring:**
- `App.tsx`: Route `<Route path="admin/thumbnail-optimizer" ...>` under the admin layout
- `Layout.tsx`: Nav link in the Admin section (`/admin/thumbnail-optimizer`)
- `AdminPage.tsx`: Tab type, URL path routing, imported and rendered in a new tab section with page title/description

### `AuditTable.tsx`

`Table` comparing all audited videos:
- Columns: Video Title (clickable link), Base Score, Potential, Executive Verdict
- Score cells use color-coded `Chip` components (green ≥8, amber 5–7, red ≤4)
- Empty state when no audits exist

### `DetailedAnalysis.tsx`

Tiered analysis cards grouped by priority:
- **Priority 1: Critical Fixes** (Red tier) — red border / background
- **Priority 2: Improvement Areas** (Yellow tier) — amber border / background
- **Priority 3: Final Polish** (Grey tier) — grey border / background

Each card shows:
- Pillar name with score `Chip` badge
- Status quote (in italics)
- Action step / opportunity text
- `LinearProgress` bar color-coded by score range

### `AuditReportHeader.tsx`

Summary bar showing:
- Total video count
- Download buttons for full PDF report (`downloadPDF()`) and per-video PDFs (`downloadIndividualPDF()`)
- Hidden when no audits loaded

---

## PDF Export: `thumbnailOptimizerExport.ts`

Two export functions:

### `downloadPDF(audits: ThumbnailAudit[])`

Generates a **landscape** PDF with:
1. **Summary page** — Title ("RevKeter" branded), subtitle, priority strategy note, summary table with clickable video links
2. **Per-audit detail pages** — Branded header, video title, clickable URL, context table (niche/audience/voice), tiered analysis table, strengths section, opportunities section
3. **Footer** — "RevTube Analytics — Powered by RevKeter" centered at page bottom

### `downloadIndividualPDF(audit: ThumbnailAudit)`

Single-page PDF for one audit. Filename sanitized from video title.

### Visual Design

| Element | Color |
|---------|-------|
| Brand blue (headings, accents) | `#36659b` |
| Accent teal (summary title) | `#4dabc6` |
| Link blue | `#2563eb` |
| Red tier text | `#b40000` |
| Yellow tier text | `#b46400` |

---

## Frontend Routing & Navigation

### Route Registration (`App.tsx`)

Two routes:

**Client-side route** — under the `ProtectedRoute` group with feature guard:
```typescript
const ThumbnailOptimizerPage = lazy(() => import("./pages/ThumbnailOptimizerPage"));

// Inside the ProtectedRoute route group:
<Route path="thumbnail-optimizer" element={
  <Suspense fallback={<PageSkeleton />}>
    <FeatureGuard pageKey="thumbnailOptimizer">
      <ThumbnailOptimizerPage />
    </FeatureGuard>
  </Suspense>
} />
```

**Admin route** — under the admin layout, no feature guard:
```typescript
const AdminThumbnailOptimizer = lazy(() => import("./pages/thumbnailOptimizer/AdminThumbnailOptimizer"));

// Inside the admin route group:
<Route path="admin/thumbnail-optimizer" element={
  <Suspense fallback={<PageSkeleton />}>
    <AdminThumbnailOptimizer />
  </Suspense>
} />
```

### Sidebar Navigation (`Layout.tsx`)

The Thumbnail Optimizer nav item sits inside the **Channel Analytics** collapsible section (after "AI Chat"), under Analytics and AI Chat.

A `pageKeyMap` entry maps `"thumbnail-optimizer"` → `"thumbnailOptimizer"` so the sidebar UsageBar shows the correct monthly usage counter for the page:

```typescript
const pageKeyMap: Record<string, string> = {
  // ...
  "thumbnail-optimizer": "thumbnailOptimizer",
};
```

### Icon

Uses `MdAutoFixHigh` from `react-icons/md` in the sidebar nav item.

---

## Configuration & Environment

### Environment Variables

| Variable | File | Required | Default |
|----------|------|----------|---------|
| `GEMINI_API_KEY` | `.env` / `.env.prod` | Yes (prod) | Commented out |

`.env.prod` includes a commented placeholder. `.env` has an empty key that must be set for the feature to work.

### Feature Config

In `backend/config/featureConfig.js`:
```javascript
thumbnailOptimizer: {
  label: "Thumbnail Optimizer",
  premiumOnly: false,
  freeLimit: 5,
  proLimit: 100,
}
```

---

## Usage Flow

1. User navigates to `/thumbnail-optimizer` in the sidebar (client-side) or `/admin/thumbnail-optimizer` (admin)
2. Chooses input mode (component context determines which):
   - **Client-side** (`VideoSource="channel"`): Clicks a connected channel → opens search dialog → searches/filters by title → paginates → selects videos via checkbox → confirms
   - **Admin** (`videoSource="manual"`): Pastes 1–20 YouTube URLs into the text area
3. Optionally fills in niche / target audience / brand voice context
4. Clicks "Initialize Batch Audit" — the page calls `enqueueJob()` → `POST /jobs` → gets `{ jobId }`, stored in `sessionStorage`
5. Client page polls `GET /jobs/:id` every 4s while the BullMQ `optimizer` worker:
   a. Fetches each video's thumbnail image server-side
   b. Sends thumbnails + prompt to Gemini API
   c. Parses structured JSON response
   d. Caches result for 24 hours and inserts into `thumbnail_audits`
6. On completion the page renders the comparison table + per-video detailed analysis, and the backend fires the in-app notification + email (see `docs/NOTIFICATIONS.md`)
7. The audit is already persisted by the worker, so it appears in the **Saved Audits** tab automatically
8. User can export full PDF report or individual audit PDFs
9. Monthly usage counter updates in the sidebar footer (quota consumed at enqueue time)

---

## The 12 Psychological Pillars

| # | Pillar | What It Measures | Score Impact |
|---|--------|-----------------|--------------|
| 1 | **Promise Lock** | Clear value proposition in thumbnail | If missing → Red |
| 2 | **One-Idea Rule** | Single focused concept vs cluttered | Clutter → Red |
| 3 | **Scroll-Stop Contrast** | Visual pop in a feed | Low contrast → Red |
| 4 | **Focal Burst** | Immediate main subject visibility | Unclear → Yellow |
| 5 | **Color Psychology** | Emotional match via colors | Mismatch → Yellow |
| 6 | **Visual Magnetism** | Irresistible visual element | Missing → Yellow |
| 7 | **Attention Trinity** | Face + text + object harmony | Imbalance → Yellow |
| 8 | **Metaphorical Magnet** | Mental shortcut / familiar icon | Present → Grey |
| 9 | **Brand Consistency** | Alignment with channel brand | Weak → Yellow |
| 10 | **Curiosity Gap** | Open loops that drive clicks | Weak → Yellow |
| 11 | **Emotional Resonance** | Specific feeling evoked | Flat → Yellow |
| 12 | **Simplicity Brutality** | Every element earned its place | Excess → Yellow |

---

## Error Scenarios

| Scenario | User Sees | Backend Response |
|----------|-----------|-----------------|
| No URLs or context | Validation error in form | N/A (client-side) |
| Invalid YouTube URL | "Invalid URL" in errors array | `{ results: [...], errors: ["..."] }` |
| Gemini rate limited | "Gemini API rate limit hit. Wait a moment and try again." | 429 with `GEMINI_RATE_LIMITED` |
| Invalid API key / model | "Thumbnail analysis is unavailable (Gemini config issue). Contact support." | 503 with `GEMINI_CONFIG_ERROR` |
| Gemini returns bad JSON | "Thumbnail analysis returned an invalid response. Try again." | 502 with `GEMINI_PARSE_ERROR` |
| Network timeout | "Thumbnail analysis is temporarily unavailable." | 500 |
| Free user hits 5/month | Quota error from middleware | 429 (from `requireQuota`) |
| Partial batch failure | Results + per-URL error messages | 200 with `errors` array |
| Foreign video (non-admin) | "N video(s) are not from your connected channels. Only videos from your connected channels can be analyzed." | 403 (from `channelOwnership.validateVideos`) |
| Save — no database | "Database is not configured. Contact support." | 503 |
| Save — no auth | "Not authenticated." | 401 |
| History — not found | "Audit not found." | 404 |

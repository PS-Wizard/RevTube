# Public Audit

Public Audit runs a **Full Audit against any public YouTube channel**, without that
channel being connected to the account running it. It is an **admin-only** tool.

## What makes it different

| | Full Audit | Public Audit |
|---|---|---|
| Route | `/audit-orchestrator` | `/admin/public-audit` |
| Access | any connected channel, quota-gated | `checkAdmin` on every endpoint |
| Auth to YouTube | caller's OAuth token (or org token) | server `YOUTUBE_API_KEY` only |
| Ownership | channel must belong to the caller | none required |
| Storage | `audits` / `audit_runs` | `public_audits` (JSONB) |

Because it uses only public Data API endpoints with the server API key, a public audit
consumes **no user OAuth quota and touches no user tokens**. That is what makes it
safe to run against channels the admin has never connected.

## Source of truth

| Concern | File |
|---|---|
| Route (all endpoints are `checkAdmin`) | `backend/routes/publicAudit.js` |
| Fetch layer (public YouTube Data calls) | `backend/services/publicAuditService.js` |
| Runner (shared by sync + queued paths) | `backend/services/publicAuditRunner.js` |
| Queue processor | `backend/queue/publicAuditQueue.js` |
| Engine reuse | `channelAuditScoringService` + the same criteria store the Full Audit scores against |
| UI | `frontend/src/components/admin/public-audit/`, admin tab in `frontend/src/pages/admin/AdminPage.tsx` |
| Storage | `public_audits` (migration `011_public_audits.sql`) |

## Endpoints

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/admin/public-audits` | Synchronous, bounded. Returns the full report. |
| `POST` | `/api/admin/public-audits/jobs` | Enqueue a background job, returns `{ jobId }` |
| `GET` | `/api/admin/public-audits/jobs/:id` | Poll: `{ jobId, state, progress, result? }` |
| `GET` | `/api/admin/public-audits` | History list |
| `GET` | `/api/admin/public-audits/:id` | One saved report |
| `DELETE` | `/api/admin/public-audits/:id` | Delete a saved report |
| `PATCH` | `/api/admin/public-audits/:id` | Update saved report metadata |

`POST /jobs` falls back to a synchronous run when the queue service is disabled
(no Redis), so the feature degrades rather than breaks.

Every route calls `guardPg` first and returns **503** when Postgres is unconfigured.
The audit cannot run without somewhere to read cached data and write the report.

## Request options

| Field | Meaning |
|---|---|
| `channelInput` | Channel id, `@handle`, or URL. Parsed by `parseChannelInput` + `resolvePublicChannel`. |
| `maxVideos` | Cap on videos analysed. Bounded by `HARD_MAX_VIDEOS`, defaulting to `DEFAULT_MAX_VIDEOS`. |
| `includeAllPlaylists` | Fetch the complete playlist catalog rather than a bounded sample. |
| `includeThumbnail` | Run the thumbnail pass. |
| `includeCaptions` | Pull captions for transcript analysis. The toggle is disabled in the UI when captions are unavailable, and caption files are excluded from the bundle when off. |

## Caching

`publicAuditService` keeps its own `cacheGet` / `cacheSet` layer over `serverCache`,
separate from the per-user ingestion caches. A public channel's data does not belong
to any user, so it must not be written into a user-scoped cache key. Re-running an
audit of the same channel is therefore substantially cheaper than the first run.

## Scoring

`publicAuditRunner` calls `scoreFullAudit` with the same criteria store the Full Audit
uses, so scores are directly comparable between a connected channel and a public one.
`engine rateHealth` is persisted on the report so the UI can surface how much of the
score was algorithmic versus AI-derived, and the size-score is clamped so it cannot
overflow its range.

## Report shape

The report is stored as a single JSONB row in `public_audits`. The admin UI renders
it as stacked tabs, and exports it to Excel via
`frontend/src/services/publicAuditExport.ts`. Playlist results are presented per
playlist with a score and top-fix table, and a Channel Health card summarises the
overall engine health.

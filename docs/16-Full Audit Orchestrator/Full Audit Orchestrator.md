# Full Audit Orchestrator

The **Full Audit** is the unified channel-level audit at `/audit-orchestrator`. It
replaced the older separate `/audit` and `/channelaudit` pages and runs every
sub-audit in one job, one transaction, one report.

## Why it exists

Before the orchestrator, channel scoring lived in pieces that disagreed: the channel
metadata audit, the video audit, the playlist optimizer and the general trend audit
each had their own criteria, their own score scale and their own persistence. The
orchestrator gives them one input bundle, one criteria store, one score contract and
one history table.

## Source of truth

| Concern | File |
|---|---|
| Route (enqueue, poll, history, rerun) | `backend/routes/auditOrchestrator.js` |
| Pipeline service (the actual work) | `backend/services/auditOrchestratorService.js` |
| Queue processor + progress mapping | `backend/queue/auditOrchestratorQueue.js` |
| Input gathering (parallel fetch stages) | `backend/services/auditInputService.js` |
| Scoring config + profiles | `backend/config/channelAuditScoring.js`, `channelAuditScoringProfiles.js` |
| Scoring service | `backend/services/channelAuditScoringService.js` |
| Admin criteria CRUD | `backend/routes/admin.js` (`/admin/audit-criteria`, `/admin/audit-scoring-profiles`) |
| UI | `frontend/src/pages/audit-orchestrator/` |
| Storage | `audits` / `audit_runs` (migration `006_audits.sql`, `0011_centralized_audit.sql`, `0014_audit_runs_name.sql`) |

## The four sub-audits

`CATEGORY_DEFS` in the route file is the authoritative list. Each category maps to
one section of the criteria store and is scored independently:

| Category | Title | Criteria section | Extra sections |
|---|---|---|---|
| `channel` | Channel Identity | `channelIdentity` | `channelBrand` |
| `video` | Video SEO | `videoElements` | (non-thumbnail-only) |
| `playlist` | Playlist Flow | `playlist` | |
| `general` | Cadence & Trends | `general` | `generalOutlook` |

`GET /api/audit-orchestrator/criteria` returns labels and max points only, sourced
from the same store the orchestrator scores against. It is intentionally safe for
any authenticated user so the in-app help dialog can never drift from what the engine
actually does.

## Job lifecycle

1. `POST /api/audit-orchestrator` (behind `resolveUser` → `orgTokenMiddleware` →
   `checkPremiumAccess('audit')` → `requireQuota('audit')`) enqueues one
   `audit-orchestrator` BullMQ job and returns a job id.
2. `GET /api/audit-orchestrator/jobs/:id` is polled by the page for status and a
   determinate progress percentage.
3. The worker gathers input (fanned out across fetch stages), runs the four
   sub-audits, and persists the parent run plus child sub-runs in a single
   transaction.
4. `GET /api/audit-orchestrator/:id` returns the full report.

### Progress model

`createProgressMapper` in `queue/auditOrchestratorQueue.js` maps pipeline phases onto
a monotonic 10-100 scale. Input fetching occupies 10-35, the parallel sub-audits
share 40-75 (they run concurrently so the peak only moves forward), history 90 and
persist 96-100. The mapping is monotonic on purpose: the UI bar must never go
backwards.

## Scoring

Scoring is **deterministic**, not LLM-driven. Each category is scored by
`channelAuditScoringService` against admin-configured criteria, and the four category
scores blend into the overall score. Two different profiles can be configured
(`channelAuditScoringProfiles.js`) so scores can be compared across configurations.

The one exception is the **video** sub-audit, which delegates to the real
`videoAuditService` engine so a video's score inside a Full Audit is identical to its
score on the standalone `/video-audit` page. The playlist sub-audit likewise reuses
`playlistOptimizerService`.

`includeThumbnailAI` optionally adds a Gemini thumbnail pass on top of the
deterministic scoring.

## Reruns and history

| Endpoint | Behaviour |
|---|---|
| `GET /api/audit-orchestrator/history` | Paged run history for the caller |
| `GET /api/audit-orchestrator/:id` | One run with all sub-runs |
| `POST /api/audit-orchestrator/:id/rerun` | Re-enqueue the whole audit (quota-gated) |
| `POST /api/audit-orchestrator/:id/rerun/:type` | Re-run one sub-audit type only |
| `PATCH /api/audit-orchestrator/history/:id` | Rename a saved run |
| `DELETE /api/audit-orchestrator/history/:id` | Delete a saved run |

Sub-run `results.meta.engineScores` is stripped before the report leaves the server
(`sanitizeSubRunsMeta`). The per-sub-run score travels in its own column; the
algorithmic/AI breakdown is an internal detail the frontend never renders.

## Videos per audit

The number of videos analysed is capped per plan and controlled by admins through the
`auditVideos` feature-config page. `resolveAuditVideoCap` reads that config and falls
back to code defaults (free 15 / pro 30) when the config is missing or unlimited.
This is deliberately separate from the `audit` page quota, which counts runs, not
videos.

## Channel Focus integration

If an owner has defined [Channel Focus](../19-Channel%20Focus/Channel%20Focus.md) for
the channel, it is injected into every sub-audit's prompt context so niche and
audience are grounded in the owner's own words. When absent, the pipeline falls back
to keyword inference and behaves exactly as it did before Focus existed.

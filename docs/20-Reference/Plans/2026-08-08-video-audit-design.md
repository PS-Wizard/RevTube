# RevTube Video Audit — Design

**Date:** 2026-08-08
**Status:** Approved (design). Implementation plan follows.

## Problem

The Phase1 audit/scoring system (`/audit` + `auditScoringService.js`) is deterministic and
scores a fixed set of text/rule heuristics. It cannot judge qualitative qualities like a
title being "funny" or "questioning", and it does not weight differently per channel niche.
The user wants a richer **video audit**: pick one video or a batch from your own channel,
have each video's title, description, tags, keywords, thumbnail, and captions scored against
**admin-defined criteria** that admins can freely create, weigh, and tune — with channel-niche
awareness — and have it run as an asynchronous queued job because LLM scoring is slow/costly.

## Decisions (user-confirmed)

1. **New admin-configurable LLM-scored engine**, separate from the Phase1 deterministic engine
   (which stays for the existing `/audit` channel/playlist audit). Built so channel/playlist
   can adopt it in Phase2.
2. **Gemini for all image analysis** (thumbnail, and in future banner/logo); **DeepSeek for all
   text scoring** (titles, descriptions, tags, keywords, captions).
3. **Admin defines freeform criteria**: each criterion has a key, label, weight, the element it
   applies to, an LLM scoring instruction, and optional niche tags. Admin can add/remove freely;
   weights can sum to anything and are normalized per element to a 0-100 total.
4. **Niche-tagged criteria + boost**: a criterion tagged with a niche matching the channel's niche
   gets a weight boost (default x1.5) before normalization.
5. **BullMQ async queue + polling**: `POST /video-audit` enqueues a job and returns `{ jobId }`;
   the page polls for progress and renders per-video results as they complete.
6. New `videoAudit` page key in feature config, gated by `requireQuota` at enqueue + frontend
   `FeatureGuard pageKey="videoAudit"` + `UsageBar`.

## Architecture

```
Firestore: config/auditCriteria (new doc, admin-writable)
  video: [ { key, label, weight, element, instruction, niches[] } ]   // admin freeform

Backend
- backend/config/auditCriteria.js  -- DEFAULT_AUDIT_CRITERIA, getAuditCriteria(db), cache,
                                       invalidateAuditCriteriaCache() (mirrors auditScoring.js)
- backend/services/videoAuditService.js -- createVideoAuditService(deps): fetch per-video data
   (title/desc/tags/keywords/thumbnail url/captions), score each criterion by element:
   thumbnail -> Gemini vision; else -> DeepSeek text. Returns per-video { total, breakdown,
   overall } + batch aggregate.
- backend/queue/videoAuditQueue.js -- createVideoAuditProcessor(deps) + an enqueue fn; new BullMQ
   queue reusing the existing queueService factory (create*Queue pattern). When REDIS_URL unset,
   the queue is a no-op (matches existing queues).
- backend/routes/videoAudit.js -- POST /video-audit (enqueue, requireQuota("videoAudit"), channel
   ownership + org token), GET /video-audit/jobs/:id (status/progress), history CRUD (PG table).

Frontend
- frontend/src/pages/VideoAuditPage.tsx -- channel picker, video multi-select (one or a batch),
   Run -> jobId -> poll -> per-video cards + weighted batch average + save/history.
- Admin: a "Video Audit Criteria" tab (or reuse the Scoring tab) to edit the auditCriteria config,
   with the live weight/normalization display. AdminThumbnailOptimizer/ScoringConfigEditor pattern.
- quota: add `videoAudit` page key to backend DEFAULT_FEATURE_CONFIG + frontend DEFAULT_CONFIG.
```

## Scoring engine

```
scoreVideo(input, cfg) -> { total (0-100), breakdown: [{ key, label, score, weight, max }], overall }
```

Per criterion in `cfg.video`:

| Element | Scorer | Input read | LLM instruction drives |
|---------|--------|------------|------------------------|
| thumbnail | Gemini vision | thumbnail image (base64) | judge per instruction |
| title | DeepSeek | title text | judge per instruction |
| description | DeepSeek | description text | judge per instruction |
| tags | DeepSeek | tags[] joined | judge per instruction |
| keywords | DeepSeek | keywords[] joined | judge per instruction |
| caption | DeepSeek | captions/transcript text | judge per instruction |

- Each criterion returns `score` (0-10) from the LLM.
- `max` = normalized weight. Normalization is a **weighted mean of scores as a percent**:
  `total = round( (sum over criteria of (score/10 * weight)) / (sum over criteria of weight) * 100 )`.
  This is inherently 0-100, is niche-boosted automatically (the boost multiplies `weight` first),
  and does not require per-element budget spreading. Each criterion reports `{ key, label, score,
  weight, max }` where `max` is its share of the percent contribution (see plan for exact display
  value; the score math above is authoritative).
- Niche boost: if `criterion.niches` includes the channel's niche, `weight *= 1.5` before the
  weighted-mean aggregation above.
- Batch: `overall = round(weighted mean of per-video totals)` (each video weighted equally).

Design points:
- Criterion scorers are thin wrappers around an injected `llm` client (Gemini for images, DeepSeek
  for text) so tests use fakes and never call a real model.
- No LLM prompt contains admin weight math; the engine does all weighting/normalization itself so
  admins only edit weights and instructions, not prompt glue.
- If an element's data is missing (e.g. no caption track), that element's criteria score 0 with a
  note; the audit still completes. Caption is fetched best-effort; failure is non-fatal.

## Queue flow

```
POST /video-audit  body { channelId, videoIds[] }
  -> resolveUser + checkPremiumAccess("videoAudit") + requireQuota("videoAudit")
  -> ownership check (getConnectedChannelIds) on channelId
  -> queueService.enqueueVideoAudit({ channelId, videoIds, authHeader, criteriaVersion })
  -> res { jobId }

GET /video-audit/jobs/:id
  -> BullMQ job status + progress + per-video partial results
  -> page polls until complete
```

- Job data carries the `criteriaVersion` (configVersion) captured at enqueue so a config change
  mid-batch doesn't cause inconsistent scoring; the processor re-reads criteria via getAuditCriteria.
- When REDIS_URL is unset (no queue), the queue service returns a no-op (mirrors the existing
  queues). `POST /video-audit` returns a 503 with a clear "queue unavailable" message so the UI can
  surface that the batch could not start. Local dev tests the route logic via the route's unit
  tests (DI fakes) and can run a single-job synchronous fallback only behind a test flag.

## Error handling / safety

- Channel ownership + org-token resolution enforced on `POST /video-audit` (same as `/audit`).
- Quota: `videoAudit` key in `DEFAULT_FEATURE_CONFIG`; `requireQuota` at enqueue; frontend
  `FeatureGuard` + `UsageBar`. Admin bypass.
- Config errors: invalid criteria (missing key/element/weight, weight <= 0) fall back to
  `DEFAULT_AUDIT_CRITERIA` for the affected item; the admin UI flags it. No silent partial scores.
- LLM failure for one criterion: that criterion scores 0 with a note; the audit still completes.
- Caption fetch failure: element data absent -> criteria score 0 with a note.

## Testing (Vitest, per revtube-testing)

- `config/auditCriteria.test.mjs` — defaults, merge, invalid-item fallback, cache invalidation.
- `services/videoAuditService.test.mjs` — per-criterion scoring with fake Gemini/DeepSeek, weight
  normalization to 0-100, niche boost, missing-element -> 0, batch aggregate.
- `queue/videoAuditQueue.test.mjs` — processor calls the service, progress updates, error rethrow.
- `routes/videoAudit.test.mjs` — quota 429, admin bypass, ownership, enqueue returns jobId,
  job-status endpoint, history CRUD (DI fakes).
- Frontend — `auditCriteriaSchema` validation; security-core suite stays green.

## Out of scope (this pass)

- Migrating channel/playlist audit onto this engine (Phase2).
- Migrating the Thumbnail/Playlist Optimizer score fields onto it (Phase2).
- Migrating Phase1's `/audit` page to use the new engine (Phase2).

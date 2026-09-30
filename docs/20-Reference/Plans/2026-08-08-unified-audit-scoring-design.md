# RevTube Unified Audit & Scoring System — Design

**Date:** 2026-08-08
**Status:** Superseded by the implemented centralized Channel Audit. The shipped
system is deterministic (no LLM, no thumbnail/logo/banner image scoring), uses
**four** categories (video, channel, playlist, general), and is documented in
[Full Audit Orchestrator](../../16-Full Audit Orchestrator/Full Audit Orchestrator). This spec describes the earlier three-category
design and is retained for history only.


## Problem

RevTube has two LLM-driven optimizers (Thumbnail, Playlist) whose "scores" are
free-form model guesses driven by hardcoded prompt prose. There is no numeric
scoring model, no admin control over it, and no way to respond when YouTube's
algorithm changes. The user wants a centralized, admin-configurable scoring system
with a combined channel/videos/playlist audit, a help UI showing every criterion
and its max score, all connected to the existing quota system.

## Decisions (user-confirmed)

1. **One unified scoring engine** shared by the two optimizers and the new combined
   audit, with three categories: video, channel, playlist.
2. **Scoring system first**, chat graphs later (separate follow-up).
3. **Unified 0-100** with configurable per-criterion max points. Each criterion
   reports `earned/max`; the category total is the sum and is 0-100.
4. **Deterministic weighted engine** for all scores. The LLM keeps the qualitative
   work (descriptions, keyword suggestions, recommendations); scores are computed,
   not guessed.
5. **New `/audit` page**, quota-gated, available to all signed-in users.

## Architecture

```
Firestore: config/auditScoring (new doc, admin-writable)
  video   { title, description, tags, keywords, thumbnail }
  channel { niche, keywords, name, description, logo, banner }
  playlist{ title, size, description, keywords }
  // each criterion = { max } and the maxes sum to 100 per category
```

### Backend
- `backend/config/auditScoring.js` — `DEFAULT_AUDIT_SCORING`, `getAuditScoring(db)`,
  `mergeAuditScoring()`, `invalidateAuditScoringCache()`. Mirrors
  `featureConfig.js`: Firestore doc + 10-min in-memory cache + configVersion
  invalidation + admin `PUT`.
- `backend/services/auditScoringService.js` — deterministic engine:
  `scoreVideo(input, cfg)`, `scoreChannel(input, cfg)`, `scorePlaylist(input, cfg)`.
  Each maps concrete fields to per-criterion scores, caps at `max`, sums to 0-100.
  Takes an injected `imageAnalyzer` dep (default a Gemini vision call, fake in tests)
  so image-heavy criteria stay deterministic given analysis output.
- `backend/routes/audit.js` — `POST /audit` (pick channel, run all 3 audits),
  `GET/POST/DELETE /audit/history[:id]`. Gated by `requireQuota("audit")` +
  channel ownership + org-token resolution (same as the optimizers).
- `backend/routes/admin.js` — add `PUT/GET audit-scoring` endpoints, reusing the
  config save + configVersion bump flow.

### Frontend
- `frontend/src/pages/AuditPage.tsx` + components — the new `/audit` page:
  channel picker, combined result (Video/Channel/Playlist cards), per-criterion
  breakdown table, overall average, save/history, `UsageBar`.
- `frontend/src/components/ScoringHelpPanel.tsx` — reusable help listing every
  criterion + its max, mounted on `/audit` and (Phase2) the two optimizers.
- Admin: new "Scoring" tab in `AdminPage.tsx` to edit the `auditScoring` config,
  with a live "sum must equal 100" check.
- `featureConfigSchema.ts` + `FeatureConfigContext` — extend to carry `auditScoring`.
- Quota: add `audit` page key to backend `DEFAULT_FEATURE_CONFIG` and frontend
  `DEFAULT_CONFIG`; wrap the page in `FeatureGuard pageKey="audit"`.

## Scoring engine

```
scoreVideo(input, cfg) -> { criterionScores, total (0-100), breakdown[] }
```

| Criterion (default max) | Input it reads | Default heuristic (earn up to max) |
|-------------------------|----------------|------------------------------------|
| video.title (20) | title | length band + keyword presence + CTR signals |
| video.description (15) | description | length/richness bands + keyword coverage |
| video.tags (10) | tags[] | count/quality (>=10 good tags) |
| video.keywords (5) | keywords[] | presence in title/description |
| video.thumbnail (50) | thumbnail image analysis | contrast, focal point, face/emotion, text ratio, color pop |
| channel.niche (20) | channel niche + keyword focus | alignment + focus |
| channel.keywords (10) | keywords[] | quality/count |
| channel.name (5) | channel name | brandable + keyword |
| channel.description (15) | description | length/richness + keyword coverage |
| channel.logo (20) | logo image analysis | image quality + brand clarity |
| channel.banner (30) | banner image analysis | image quality + branding |
| playlist.title (20) | playlist title | length band + keyword presence |
| playlist.size (30) | video count | count vs ideal band |
| playlist.description (25) | description | length/richness + keyword coverage |
| playlist.keywords (20) | keywords[] | quality/count |

Design points:
- Criterion scorers are small pure functions (`scoreTitle`, `scoreThumbnail`, ...)
  returning `0..max`, individually unit-testable and swappable on algorithm change.
- Config stores only `max` per criterion; maxes sum to 100, so `max` *is* the weight.
- Image criteria consume `{ contrast, focalPoints, faceDetected, textRatio, colorPop }`
  produced by the injected `imageAnalyzer`.

## Phasing

- **Phase1 (this plan):** config + engine + admin Scoring tab + ScoringHelpPanel +
  `/audit` page + quota + tests. `ScoringHelpPanel` mounts on `/audit` only; the
  Thumbnail Optimizer and Playlist Optimizer are otherwise untouched.
- **Phase2 (follow-up):** migrate the Thumbnail Optimizer and Playlist Optimizer
  score fields onto the deterministic engine; mount `ScoringHelpPanel` on both.
- **Follow-up:** LLM graphs in chat (separate spec).

## Error handling / safety
- Channel ownership + org-token resolution enforced on `/audit`.
- Quota: `audit` key in `DEFAULT_FEATURE_CONFIG`; `requireQuota` + `consumeQuota`;
  admin bypass; frontend `FeatureGuard` + `UsageBar`.
- Config errors: if a category's maxes don't sum to 100 or a criterion is missing,
  the engine falls back to `DEFAULT_AUDIT_SCORING` for that category; the admin UI
  flags it. No silent partial scores.
- Image analysis failure: that criterion scores 0 with a note; audit still completes.

## Testing (Vitest, per revtube-testing)
- `auditScoringService.test.mjs` — deterministic per-criterion scoring, sum-to-100,
  max capping, config-merge fallback (fake `imageAnalyzer`).
- `auditScoring config` merge tests — defaults vs Firestore, missing criterion fallback.
- `routes/audit.test.mjs` — quota 429, admin bypass, ownership, history CRUD (DI fakes).
- `featureConfig` — `audit` page key present + quota resolution.
- Frontend — `auditScoringSchema` validation; ensure security-core suite stays green.

## Out of scope (this pass)
- LLM graphs in chat.
- Migrating optimizer scores onto the engine (Phase2).
- Image-analysis feature extraction details (the engine consumes `imageAnalyzer` output).

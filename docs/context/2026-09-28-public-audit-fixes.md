# 2026-09-28 — Public audit: real fix copy + pipelined runner

Sources: `frontend/src/components/admin/public-audit/components/VideoInspectorDialog.tsx`, `frontend/src/components/admin/public-audit/components/PlaylistInspectorDialog.tsx`, `frontend/src/components/admin/public-audit/components/RunControls.tsx`, `frontend/src/components/admin/public-audit/components/PlaylistsTab.tsx`, `frontend/src/components/admin/public-audit/components/ChannelTab.tsx`, `frontend/src/components/admin/public-audit/usePublicAuditPanel.ts`, `frontend/src/components/admin/public-audit/publicAuditUtils.ts` (+`.test.ts`), `frontend/src/components/audit/AuditDataTable.tsx`, `frontend/src/services/publicAuditService.ts`, `frontend/src/services/publicAuditExport.ts` (+`.test.ts`), `backend/services/channelAuditScoringService.js` (+`.test.mjs`), `backend/services/publicAuditRunner.js` (+`.test.js`), `backend/routes/publicAudit.js` (+`.test.mjs`, `publicAuditJobs.test.mjs`), `backend/queue/publicAuditQueue.js` (+`.test.mjs`) · verification: backend `vitest` 551/551 (57 files), frontend `vitest` 256/256 (37 files), `tsc -b` clean, `eslint` clean on touched files

## Fix 1 — Recommended Fixes showed numbers with no actions

**Root cause**: the backend always generated the actionable copy (`suggestions`:
alt titles, description rewrite, suggested tags/keywords, thumbnail concepts +
`why`) and shipped it inside every result row — but `VideoInspectorDialog`
only rendered the numeric `recommendations` (`+X pts`, target benchmark) and
never read `suggestions`. Bare uplift numbers with nothing to do.

**Change**:

- New shared `components/audit/VideoSuggestionBody.tsx` — `SuggestionBody`,
  `hasSuggestionContent`, `MIN_ALT_SCORE`, `CopyButton`, `AltScorePill`
  extracted verbatim from `VideoAuditDetailedAnalysis.tsx` (which now imports
  them; behavior there identical).
- `VideoInspectorDialog` fix cards now render, in order: the uplift header
  (unchanged) → the AI suggestion copy + `why` when generated → otherwise a
  deterministic fallback (the exact failing criteria `earned/max` + notes, plus
  per-element fix guidance). A fix card can never again be numbers-only.
- Zero new Tailwind tokens (token-diffed HEAD vs work: only `p-2`/`gap-0.5`
  appeared and both were swapped for tokens the file already used).

## Fix 2 — public audit uses the pipeline patterns

- `fetchPublicVideos` + `fetchPublicPlaylists` run **concurrently** after
  channel resolve (were serial); playlists keep their own non-fatal fallback.
- `auditBatch` percent threads into runner progress on the **70–85 band**
  (was a flat 70 stall through the longest phase).
- Persist was already a single atomic INSERT — verified, no change needed.
  Queue processor already mapped progress; both paths share the runner so sync
  and queued runs stay identical.

## Update — data-driven fix specifics (no more generic guidance)

**Asked**: fixes like "Fix Keywords +90" must say *what to do* — "add 5–10
keywords", "description doesn't have these tags" — not generic lines.

**Root cause of vagueness**: `scoreVideo` results never echoed the raw
metadata, so the dialog only had scores to work with. Fixed at the source:

- Backend `scoreVideo` now returns capped `description` (2000 chars) +
  `tags` (50) alongside scores — flows through `auditBatch` → runner spread →
  persist → API untouched (additive, old rows simply lack the fields).
- New pure `buildFixDetails(element, video)` (`publicAuditUtils.ts`, +6
  tests): counts and content checks computed from the video itself —
  tag counts with exact add-ranges ("Only 2 tags — add 3–8 more"),
  title words missing from tags ("Not covered by tags: programming"),
  description word count, missing links/hashtags/chapters, title words
  missing from the description, overlong titles. Unknown (absent) fields
  yield silence, never false "missing" claims — old reports degrade to the
  generic guidance instead of wrong specifics.
- Dialog fallback renders these as bulleted specifics under the generic
  guidance; AI suggestion copy still takes precedence when generated.
- `VideoAuditVideoResult` gains optional `description`/`tags`.

## Update — concise Recommendation lines in the video inspector (2026-09-28)

**Asked**: per-video fix cards dumped the full AI copy (rewritten description,
alt-title list, tag chips) — wanted concise cards instead:

- `Fix Keywords — Uplift: +90 pts` → `Recommendation: Choose 1 primary keyword…`
- `Fix Description — Uplift: +58 pts` → `Recommendation: Include the primary keyword within the first 2–3 sentences…`
- `Fix Title — Uplift: +3 pts` → `Recommendation: Include the primary keyword near the beginning…`

**Change**:

- New `ELEMENT_RECOMMENDATIONS` + `recommendationForElement()` in
  `publicAuditUtils.ts` (pure, unit-tested): one concise 1–2 sentence line per
  element, all framed around a single primary keyword.
- `VideoInspectorDialog` no longer renders `SuggestionBody` (full rewrites stay
  on the Video Audit detailed-analysis page, which is unchanged). Each card is
  now exactly `Fix {Label} — Uplift: +{delta} pts` + `Recommendation: <line>`.
  The `(raises score to …)` / `Target benchmark` / `What to fix` criterion dump
  and data-driven `buildFixDetails` bullets are gone from this dialog
  (`buildFixDetails` itself is untouched and still tested).
- Per-video PDF/Excel exports never contained the full copy (scores + fix
  labels only) — no export change needed.

## Verify (post-update)

- `publicAuditUtils.test.ts` **8/8** (6 existing `buildFixDetails` + 2 new
  `recommendationForElement`) · `tsc -b` clean · `eslint` clean on the three
  touched files.

## Update — captions toggle (disabled) + caption criteria excluded (2026-09-28)

**Asked**: launcher needs an include-captions option, disabled since caption
fetching isn't implemented yet — and the audit must account for that.

**Change**:

- Launcher shows a disabled `Captions (soon)` switch next to Thumbnail AI
  (`RunControls.tsx`): tooltip explains caption scoring is excluded until
  caption support ships. State (`includeCaptions`, default false) flows through
  `usePublicAuditPanel` → `run/enqueuePublicAudit` → `POST /` + `POST /jobs` →
  queue payload → `runPublicAuditReport`, and is persisted on the report
  snapshot (`includeThumbnail` precedent).
- The runner filters caption-element criteria (`caption`/`captions`) out of the
  engine input unless `includeCaptions` is explicitly true
  (`filterCaptionCriteria`, exported + unit-tested): no `caption` element card,
  no category weight, no fix recommendations — instead of 0/100 no-data rows.
- Full AI copy still lives only on the Video Audit page; per-video PDF/Excel
  exports are scores + fix labels only (unchanged).

## Verify (post-update, captions)

- `backend` **546/546 (57 files)** · `frontend` **249/249 (37 files)** ·
  `tsc -b` clean · `eslint` clean on touched files.

## Update — per-playlist + channel audits (2026-09-28)

**Asked**: the Playlists and Channel tabs should audit like the Videos tab —
every playlist row with its own audit, and a real channel audit — so a public
audit is a *full* public audit.

**Change** (same deterministic engine, zero extra quota — pure math over
already-fetched data):

- `channelAuditScoringService.rateHealth` playlist items now pass
  `playlistId` through (additive; existing tests untouched) so report rows can
  join the audit by id.
- `publicAuditRunner.scoreFullAudit` persists `fullAudit.health`
  (`{ channel, playlists, general }`, via new `pickAuditHealth` helper; null
  when the scorer predates `rateHealth`). Per-video health is NOT duplicated —
  result rows already carry the richer LLM sub-audit.
- Playlists tab table gains `Score` (0-100 badge) + `Top fix` (weakest
  dimension's hint) columns — the analogue of the Videos tab's score +
  fix-first columns. Old reports (no health) render `—`.
- Channel tab gains a `Channel Health` card: name/handle/description/keywords
  each with score badge, progress bar, and fix hint. Hidden on old reports.
- Excel `Playlists` sheet gains `Score` + `Top fix` columns; full-PDF
  playlists table gains a `Score` column.

## Verify (post-update, per-item audits)

- `backend` **549/549 (57 files)** · `frontend` **250/250 (37 files)** ·
  `tsc -b` clean · `eslint` clean on touched files.

## Update — per-playlist Recommended Fixes dialog (2026-09-28)

**Asked**: each playlist should get recommendations like videos do —
Recommended Fixes with uplift in the public audit.

**Change** (same deterministic engine, zero extra quota):

- `rateHealth` playlist items now carry `dimensions` (title/description/size,
  each 0-100) plus `recommendations` (one fix per dimension below the 100
  target: `{ dimension, label, current, projected: 100, delta }`, biggest
  uplift first; empty when the playlist scores 100). Flows through the
  runner's `pickAuditHealth` untouched.
- New `PlaylistInspectorDialog` (mirrors `VideoInspectorDialog`'s concise
  format): preview header (thumbnail, score badge, total fix uplift),
  dimension score bars, then `Fix {Title|Description|Coverage} — Uplift: +X
  pts` cards each with a one-line `Recommendation:` from the new
  `PLAYLIST_RECOMMENDATIONS` map (`publicAuditUtils.ts`, unit-tested).
- Playlist table `Score` badge is now a button opening the inspector
  (keyboard-accessible, full title in tooltip). Old reports show the dialog
  with the aggregate score but no fix cards ("re-run the audit" note when no
  health exists at all).

## Update — playlist score overflow + video-style table + thumbnail links (2026-09-28)

**Asked**: (1) playlist scores above 100 (e.g. 124 on a 27-video playlist),
(2) playlist table should use the Videos tab table (resizable, sortable
headings), (3) clicking should not show the thumbnail image — just a link
button to view it.

**Root cause of the overflow**: `scoreSize`/`healthFromSize` only capped the
10–100 band, so sizes above 100 fell into the `n/10` ramp — a 27-video
playlist scored size health 270 and averaged ~123 overall.

**Change**:

- Backend clamps both size scorers at ≥10 → max/100 (a previous-version
  comment records why). Oversized playlists can no longer exceed 100, lose
  their size fix, and keep the "Well-sized" hint.
- Playlists tab rebuilt on the shared `AuditDataTable` (same component as
  Videos): drag-to-resize columns + clickable tri-state headers for Score,
  Videos, Published, and Playlist title (new pure `sortPlaylists` in
  `publicAuditUtils.ts`, unit-tested; unscored/missing rows sort last both
  ways). Rows render `ScorePill`, Top-fix, View link, and an Inspect action —
  row click opens the fixes dialog, like videos.
- Playlist row links always navigate to the playlist URL (previously rows
  with a thumbnail navigated to the raw image URL). The inspector dialog no
  longer renders the thumbnail image — it offers `Open Playlist` +
  `View Thumbnail` link buttons instead.

## Verify (post-update, playlist table + overflow)

- `backend` **551/551 (57 files)** · `frontend` **256/256 (37 files)** ·
  `tsc -b` clean · `eslint` clean on touched files.

## Follow-ups (not done)

- Backfill `fullAudit.health` for old persisted reports (aggregate-only until
  re-run — by design, no fake scores invented).

## Verify

- `backend` **541/541 (57 files)**: new `publicAuditRunner.test.js` (4:
  concurrent fetch timing, 70–85 progress band, empty-catalog 400 without
  persist, playlists-failure degradation); 2 route assertions updated for the
  `auditBatch` progress arg.
- `frontend` **241/241** · `tsc`/`eslint`/`design:lint` clean ·
  `ui:boundary`: no new tokens from this change (public-audit folder was
  already fully non-baselined from earlier in-flight work — untouched by this
  change; baseline update left for the team).

## Follow-ups (not done)

- Backfill suggestion copy for old persisted reports (rows saved before this
  change render the deterministic fallback until re-run — by design, no fake
  copy is ever invented).
- Excel/PDF per-video export could include the suggestion copy next.

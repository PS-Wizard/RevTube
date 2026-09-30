# 2026-09-26 — Admin-only Public Audit (any public channel, shared video-audit engine)

Sources: `backend/db/migrations/011_public_audits.sql`, `backend/services/publicAuditService.js` (+`.test.js`), `backend/services/publicAuditRunner.js`, `backend/queue/publicAuditQueue.js` (+`.test.mjs`), `backend/routes/publicAudit.js` (+`.test.mjs`), `backend/queue/index.js`, `backend/index.js` (wiring), `frontend/src/services/publicAuditService.ts`, `frontend/src/components/admin/public-audit/` (panel folder: orchestrator + hook + utils + `components/*`), `frontend/src/components/SearchableHistoryList.tsx`, `frontend/src/pages/admin/AdminPage.tsx`, `frontend/src/components/Layout.tsx`, `frontend/src/App.tsx`.
Related: single unified criteria store (`backend/config/channelAuditCriteria.js`, admin editor `AuditCriteriaEditor.tsx`); video-audit engine (`backend/services/videoAuditService.js`, `backend/routes/videoAudit.js`).

## What changed

Admins can now audit **any public YouTube channel** — no OAuth, no connected account — from Admin → Public Audit (`/admin/public-audit`). The feature reuses the existing systems instead of duplicating them:

- **Data**: new `publicAuditService` fetches inputs via YouTube Data API v3 **public endpoints only** (server `YOUTUBE_API_KEY`, ~3 quota units per run: `channels.list` + `playlistItems.list` + `videos.list`; deliberately avoids 100-unit `search.list`). Accepts raw channel IDs, `@handles`, and `youtube.com/channel|@|c|user` URLs.
- **Criteria**: same admin-managed store the Audit Criteria editor writes (`getAuditCriteria(db).video`) — zero duplicate configuration; the panel surfaces them through a `?` help dialog instead of a second editor link.
- **Scoring**: same `videoAuditService.auditBatch` engine as `/video-audit` (lite mode by default; optional "Thumbnail AI" toggle runs full vision mode).
- **History**: every run persists to new `public_audits` table (Postgres, migration `011`); list/get/delete endpoints are all `checkAdmin`-guarded and mounted at `/api/admin/public-audits` **ahead of** the `/admin` router so they never depend on admin-router fallthrough.

## Contract

- `POST /api/admin/public-audits { channelInput, maxVideos (1–1,000, default 50), includeAllPlaylists, includeThumbnail }` → `{ id, channelInput, channelId, channelTitle, videoCount, overall, auditedAt, snapshot, channelLifetime, playlists, playlistCount, results, createdByEmail, createdAt }`
- `GET /api/admin/public-audits?limit&page&search` → `{ items, total, page }` (search matches title or input)
- `GET /:id` → full saved report; `DELETE /:id` → `{ success: true }`
- 503 when Postgres is unconfigured; 400 on missing input / empty channel / bad id.

## Frontend

`PublicAuditPanel` (shared primitives + `SearchableHistoryList`): runner card (channel input + video count + thumbnail-AI toggle), report view (overall score, channel stats, per-video rows with YouTube links), admin-only shared history list with open/delete. Wired into `AdminPage` (`public-audit` tab), `Layout` admin nav (`MdPublic`), and `App.tsx` route — all behind `AdminRoute`. (Report + styling were expanded in the Update section below.)

## Verify

- `backend`: `routes/publicAudit.test.mjs` (6) + `services/publicAuditService.test.js` (5) pass (11/11); video-audit suites still green. Full `pnpm test`: 467 passed / 1 failed — the failure is **pre-existing and unrelated** (`services/orgAnalyticsService.test.mjs` leaderboard ordering fixture, also fails on a clean tree).
- Migration `011_public_audits.sql` picked up by the alphabetical hand-authored runner (`db/migrate.test.js` 10/10).
- `frontend`: `pnpm test -- --run` → 29 files / 190 tests pass. `tsc -b` shows only 5 pre-existing errors in untouched files (`VideoDetailDialog.tsx`, `GoalDetailPage.tsx`); eslint errors in `Layout.tsx`/`AdminPage.tsx` are pre-existing; `ui:boundary` flags only pre-existing files (`PublicAuditPanel.tsx` itself is clean). No new CSS file, no raw hex.

## Follow-ups (not done)

- Paginate beyond the latest 50 playlist items for large channels (currently latest-N only).
- Optional: org-token scoping, quota accounting on public-audit runs, CSV/PDF export like Video Audit.

## Update (2026-09-24) — detailed report (thumbnails, lifetime stats, playlists) + criteria help dialog

Second pass on the same system: no new endpoints, richer payloads + a report-only UI rewrite.

### Backend

- **`publicAuditService.computeChannelLifetime(inputs)`** — new exported **pure** helper and the single source of truth for channel aggregates: `auditedVideoCount`, `totalViewsAudited`, `totalLikesAudited`, `totalCommentsAudited`, `avgViewsPerVideo`, `engagementRatePct`, `oldestAuditedAt`/`newestAuditedAt`, `uploadCadenceDays`, `shortsCount`/`longformCount`. Unknown duration falls back to `61s` (counted as long-form) so the counters never emit `NaN`. The route calls it **once** — the two inline copies it replaced had produced a fatal `SyntaxError: Identifier 'num' has already been declared` (the route module could not even load).
- **`publicAuditService.fetchPublicPlaylists(channelId, max=10)`** — one cheap `playlists.list` page (~1 quota unit, clamped 1–25) → `{ playlistId, title, description, publishedAt, itemCount, thumbnailUrl }`. A failure is **non-fatal**: the run still persists with `playlists: []` + a `console.warn`.
- `fetchPublicVideos` already carries `thumbnail.url`, `statistics`, `durationLabel`, `definition`, so the report renders without a second YouTube call.
- Route persists the extras inside the `results` JSONB (`channelLifetime`, `playlists`, `playlistCount`) and echoes them on POST; `GET /:id` replays them straight from storage.
- Quota per run: ~4 units (`channels.list` + `playlistItems.list` + `videos.list` + `playlists.list`).

### Frontend

- `PublicAuditPanel` report rebuilt: channel hero (banner, avatar, handle/country, description, score + "Open channel"), an 11-tile `StatCard` grid (subscribers, channel views, uploads, avg views/video, engagement, likes audited, comments audited, cadence, shorts/long-form, playlists, overall), playlist cards with thumbnails, and per-video cards with a 16:9 thumbnail (duration + HD chips), engagement badges, element score badges, category meters, and the fix-first tip.
- "Manage criteria" link replaced by a `?` `IconButton` → `Dialog` listing the live criteria (label + points) from the same unified store.
- New token-based CSS block in `frontend/src/styles/page-chrome.css` (`rt-channel-hero*`, `rt-video-card*`, `rt-playlist-card*`, `rt-meter*`, `rt-cat-*`, `rt-stat-badge`, `rt-help-btn`) with `min-width: 0` truncate chains and no `:hover`-only affordances. Tailwind stays inside `components/ui/**`; no raw hex.
- `SearchableHistoryList`: the pre-existing `react-hooks/set-state-in-effect` error on `load()` in the effect is now silenced with an explanatory `eslint-disable-next-line` (verified pre-existing at HEAD, identical pattern).

### Contract (updated)

- `POST /api/admin/public-audits` → `{ id, channelInput, channelId, channelTitle, videoCount, overall, auditedAt, snapshot, channelLifetime, playlists, playlistCount, results, createdByEmail, createdAt }`
- `GET /api/admin/public-audits/:id` → same enriched shape, read back from `public_audits` (`channelLifetime`/`playlists` live inside `results`).
- `PublicAuditReport` (TS) now types `channelLifetime` (incl. `totalLikesAudited`, `totalCommentsAudited`), `playlists`, `playlistCount`.

### Verify (this pass)

- `backend`: `pnpm exec vitest run routes/publicAudit.test.mjs services/publicAuditService.test.js` → **16/16 pass** (route: lifetime math, playlist mapping, JSONB persistence, GET replay, non-fatal playlist failure; service: `fetchPublicPlaylists` mapping/clamping + `computeChannelLifetime` incl. empty/partial input). `node --check` on both changed backend files → clean.
- `frontend`: `tsc -b --force` → only the 5 known pre-existing errors in untouched files (`VideoDetailDialog.tsx`, `GoalDetailPage.tsx`); `eslint` on the 3 touched files → clean; `stylelint "src/**/*.css"` → clean; `vite build` → OK, and `rt-video-card*` / `rt-playlist-card` / `rt-channel-hero*` / `rt-stat-badge` confirmed present in `dist/assets/index-*.css`; `ui:boundary` → no violations in touched files (still fails on pre-existing `FeatureGuard.tsx`, `ChannelChooserDialog.tsx`, `ChannelPage.tsx`, `ChatPage.tsx`, `GoalDetailPage.tsx`, `OptimizedListPage.tsx`).

## Update 2026-09-24 (pass 3) — shared help dialog, responsive history, FULL-audit Excel export

- **Help dialog on shared primitives**: the criteria help now renders through the app-standard `Dialog`/`DialogTitle`/`DialogBody`/`DialogActions` + `Button` components — same dialog model as the rest of the app, no bespoke markup.
- **Responsive history list**: `SearchableHistoryList` rows use `ListItemButton` + `ListItemText` with `min-w-0` + `truncate` chains (long titles never overflow small viewports), MUI `Pagination` pager, and the delete confirm on shared `Dialog`. All actions are visible without `:hover` (touch-safe).
- **FULL audit, public data only**: the run scores every public-data category of the shared engine (channel identity + all video categories from the unified criteria store) using public YouTube endpoints — no OAuth, no private stats.
- **Excel export**: new `frontend/src/services/publicAuditExport.ts` → `downloadPublicAuditExcel(report)` builds one 7-sheet workbook: `Overview` (channel identity + full stats + lifetime aggregates), `Categories`, `Criteria` (per-category breakdown), `Videos` (public stats + element + category scores per video), `Elements` (sub-audit roll-up), `Issues` (flattened affected items), `Playlists`. `xlsx` is lazy-loaded via the shared `loadXlsx()` helper; the builder is pure and unit-tested (`publicAuditExport.test.ts`, 8 tests). The panel toolbar gained an `Export` `Button` with busy state + toast feedback.

### Verify (final pass)

- `backend`: `vitest run services/publicAuditService.test.js routes/publicAudit.test.mjs` → **21/21 pass**. Full backend suite: 484/485 — the single failure remains the pre-existing, unrelated `orgAnalyticsService.test.mjs` leaderboard fixture (files untouched by this work).
- `frontend`: `vitest run` → **30 files / 198 tests pass** (incl. the 8 new export tests); `tsc -b` → **clean** (the 5 pre-existing `VideoDetailDialog`/`GoalDetailPage` errors were fixed in passing: dead `last3Avg`/`prevSubframeBaseline`/`yoyPct`/`curActual` code removed, `user?.package` → `userPackage`); `stylelint` on `page-chrome.css` → clean; `ui:boundary` → no violations in touched files (remaining violations are pre-existing in files this work did not modify).


## Update 2026-09-24 (pass 4) — shared cache, branding hydration, complete public playlist catalog

- Public Audit now reuses the tools' shared `ServerCache` L1 instead of re-fetching stable metadata on every run. `publicAuditService` receives `serverCache` and the standard channel YouTube-data TTL from `backend/index.js`; cache failures degrade to direct API calls.
- Channel resolution requests `brandingSettings` and maps both avatar and banner URLs. `brandingSettings.image.bannerExternalUrl` is preferred, with `bannerTvImageUrl` as the fallback, so the public hero and avatar match the existing channel tools' branding data.
- Channel lookup now mirrors the existing handle ladder: `forHandle` first, then a single `forUsername` retry for legacy names. The fallback removes `forHandle` so the request is valid.
- Public playlist enrichment now requests up to 25 playlists, requests 50 rows per page, follows YouTube's `nextPageToken` for up to two pages, slices strictly at the cap, and caches the normalized catalog. This fixes short pages that previously prevented all-playlist counting/scoring.
- Unresolvable/removed upload entries are skipped rather than producing blank video cards. Existing Full Audit scoring and persistence consume the complete normalized video and playlist inputs.

### Verify (this pass)

- Focused: `pnpm exec vitest run services/publicAuditService.test.js routes/publicAudit.test.mjs` → **25/25 pass**. Coverage includes branding-bearing channel mapping, handle/username fallback, 50-item pages with continuation, the 25-playlist cap, L1 cache hits, deleted-upload skipping, and route behavior.
- `node --check services/publicAuditService.js` and `node --check index.js` → pass; `git diff --check` → clean.
- Full backend suite: **488/489 pass**. The only failure remains the pre-existing, unrelated `services/orgAnalyticsService.test.mjs` leaderboard ordering fixture (`UC1` vs `UC2`); both public-audit suites pass in the full run.

## Update 2026-09-24 (pass 5) — UI Redesign following app layout system, design tokens & shadcn/tailwind

- **Control Center / Audit Launcher**: Rebuilt with modern card container, search input with clear button & Enter-trigger, one-click preset test channel pills (`@veritasium`, `@mkbhd`, `@mrbeast`, etc.), video count selector (10–1000), accessible `Switch` toggles for All Playlists & Thumbnail AI vision, and quota cost indicators.
- **Executive Channel Hero & Score Medallion**: Overlaid banner vignette, large avatar, channel verified title, `@handle`, country badge, expandable description, topic/keyword tags, and a prominent Overall Score medallion with status badge (`High Performance`, `Moderate Alignment`, `Needs Attention`), potential uplift projection, and quick actions ("Open YouTube", "Export Full Excel").
- **Full Audit Pillars & Issues**: Surfaced the 4 category health pillars (Channel Identity, Video Optimization, Playlist Architecture, General Strategy) with `Progress` bars, earned/max points, and channel-wide opportunity/issue severity badges.
- **Grouped Vital Metrics**: 3 organized clusters replacing the noisy 11-tile grid:
  1. *Audience & Reach*: Subscribers, Total Views, Uploads, Avg Views / Video
  2. *Engagement & Reactions*: Engagement Rate %, Audited Likes, Audited Comments, Video Sub-Audit Score
  3. *Content Strategy & Mix*: Upload Cadence, Shorts vs Long-form split, Public Playlists count, Sample Size
- **Tabbed Results Workspace**:
  - *Audited Videos Tab*: Filter toolbar with title/ID search, score tier filters (`All`, `<50`, `50-79`, `80+`), sorting dropdown, and dual view mode switcher:
    - **Table View**: Directly integrated the app's shared `AuditDataTable` with `ScorePill` (resizable columns: rank `#`, video details with thumbnail/HD/duration, views, engagement rate, 6 element scores, total score with uplift badge `+X`, and inspect button).
    - **Grid Cards View**: Responsive card grid with 16:9 thumbnail previews, stat badges, element score chips, and "Fix first" suggestion banners.
  - *Video Deep-Dive Inspection Dialog*: Self-contained `Dialog` inspecting individual video breakdowns, criteria notes, and actionable recommendations with projected points.
  - *Playlists Tab*: Responsive catalog grid of public playlists with thumbnails, item count badges, and direct links.
  - *Channel SEO Tab*: Full description, keywords, topics, and audit metadata.
- **Saved History Archive**: Polished `SearchableHistoryList` with score badges, formatted dates, and admin email attribution.
- **Verify**: `tsc --noEmit` → clean (0 errors), `pnpm design:lint` → clean (0 errors).


## Update 2026-09-24 (pass 6) — Paginated complete-data result tables

- Audited video results now paginate the filtered/sorted table and card views, with selectable page sizes of 10, 25, 50, or 100 and global row numbers across pages.
- Public playlists now render as a scroll-safe table with thumbnail/title/description, video count, publication date, and direct YouTube links, plus independent 10/25/50/100 pagination.
- Client-side pagination changes only the visible report; `downloadPublicAuditExcel` still consumes the complete `report.results` and `report.playlists` arrays, so the Videos and Playlists workbook sheets contain every fetched row regardless of the currently visible page.
- Verify: frontend `tsc -b` passes. Repository-wide lint still reports unrelated pre-existing errors; the changed component introduced no TypeScript error. Export tests continue to verify complete Videos and Playlists sheet generation.

## Update 2026-09-25 — stacked report tabs and results

- `PublicAuditPanel` now uses the native `ShadcnTabs` root for its explicit `TabsList`/`TabsContent` composition. The compatibility `Tabs` shim had wrapped the wrapped tab rail and active results panel in a synthetic horizontal tab list, which made the tab rail appear beside the results table after a report loaded.
- The results workspace keeps `w-full min-w-0` at the tabs root, so the rail and active table/card panel remain vertically stacked and the shared audit table continues to own horizontal scrolling.

### Verify (layout fix)

- `pnpm test -- --run` → 30 files / 198 tests pass.
- `pnpm design:lint` → pass.
- `pnpm build` → pass, including `tsc -b` and the Vite production build; existing Rollup chunk warnings remain.
- `pnpm exec eslint src/components/admin/PublicAuditPanel.tsx` → pass. Repository-wide `pnpm lint` still reports the existing unrelated violations in other files.

## Update 2026-09-25 — channel avatar/logo hydration

- Public Audit already resolves the channel avatar from `channels.list` → `snippet.thumbnails`, using the same public lookup path as the Extra Tools. The route now persists `avatarUrl` beside the channel banner so the report hero and Excel export receive the image URL.
- Saved reports created before this fix are hydrated on `GET /:id` through the cached `resolvePublicChannel(channel_id)` lookup. Hydration is non-fatal and requires no migration; the shared `Avatar` component still provides the letter fallback if an image cannot load.

### Verify (avatar fix)

- Focused backend: `pnpm exec vitest run services/publicAuditService.test.js routes/publicAudit.test.mjs` → **27/27 pass**.
- Full backend: **490/491 pass**; the single failure is the pre-existing unrelated `services/orgAnalyticsService.test.mjs` leaderboard ordering fixture.
- Frontend: `pnpm test -- --run` → **30 files / 198 tests pass**; `pnpm build` and `pnpm design:lint` pass.
- `node --check routes/publicAudit.js` and `node --check services/publicAuditService.js` → pass; `git diff --check` → clean.

## Update 2026-09-25 (pass 7) — Tailwind + shadcn migration with proper spacing

All public-audit pages/components now render on Tailwind + shadcn primitives with a consistent spacing scale — no custom audit CSS, no raw `<table>`/`<button>`, no inline score colors, no `sx` props:

- **`components/audit/AuditDataTable.tsx`** — `ScorePill` is now a shadcn `Badge` with token tones; the table composes shadcn `TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell` inside a Tailwind wrapper (`rounded-lg border shadow-xs overflow-x-auto`, cells `px-4 py-3`, empty state `p-8`). Resizable columns kept via `ColGroup` + `ResizeHandle`. Same props API, so all 4 audit tools inherit the new chrome.
- **`components/audit/AuditedVideosTable.tsx`** — dropped `adt-*`/`aop-*` classes + `audit-data-table.css` import; toolbar uses shadcn `Input` (search, clearable, `h-9 text-xs`) + `NativeSelect` (`h-9`), table uses shadcn table primitives, video-ID copy chip is a `Badge role=button`, Watch link is a shadcn `Button xs`, pagination bar is a Tailwind `flex-col sm:flex-row gap-3 p-3` card.
- **`components/audit/AuditToolShell.tsx`** — dropped `page-container`/`analytics-tabs`/`audit-tool-*` CSS; Tailwind column (`gap-5`), header (`gap-3`), underline tab rail rebuilt with shadcn `Button bare` + active accent underline + count pill (`h-[1.125rem] min-w-[1.125rem]`).
- **`components/audit/ResizableColumns.tsx`** — drag handle now Tailwind (`absolute top-0 right-0 h-full cursor-col-resize touch-none select-none`); only the 8px hit width stays inline.
- **`components/SearchableHistoryList.tsx`** — dropped `Box`/`Flex`/`Stack`/`TextField`/`List*` + `rt-history-*` classes; Tailwind root (`flex-col gap-4`), toolbar (`flex-col sm:flex-row gap-2 sm:gap-3`, search `h-9 text-sm` + refresh `Button sm`), rows are Tailwind `<li>` (`px-3 py-2.5 gap-2`, `divide-y`, `truncate` chains, touch-safe always-visible rename/delete `IconButton`s), pager centered (`pt-1`), delete confirm on shared `Dialog`.
- **`pages/videoAudit/VideoAuditCriteriaList.tsx`** — dropped all `sx` `Box`/`Typography`; Tailwind (`flex-col gap-4`, category `gap-2`, rows `py-2.5 gap-3`) + shadcn `Badge` for `{weight} pts` + `divide-y` criteria list with `truncate` titles.
- **`components/admin/PublicAuditPanel.tsx`** — score colors moved from `style={{ color }}` to `scoreTextClass`/`scoreBadgeClasses` Tailwind helpers (`cn`); sample-channel pills → shadcn `Button xs`; error dismiss → `IconButton`; score-tier + format filter chips → shadcn `Button xs` groups (`h-7 px-2.5`, `role=group`, danger/warning/success text tones preserved); playlists raw `<table>` → shadcn `TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell`; stat/element chips → shadcn `Badge secondary/outline`; cards grid + toolbar spacing normalized (`gap-4`, `p-3 sm:p-4`, `space-y-2`); `min-w-0` + `truncate` chains kept on every text row.

### Verify (this pass)

- `pnpm build` → pass (tsc -b + Vite, PWA generated; only existing chunk-size warnings).
- `pnpm design:lint` → pass (no raw hex; tokens only).
- `pnpm exec eslint` on the 7 touched files → 1 pre-existing-pattern error (`react-refresh/only-export-components` on `AuditDataTable.tsx`'s `getScorePillVariant` export, same pattern as before); repo-wide `pnpm lint` still reports the same pre-existing violations in untouched files.
- `pnpm test -- --run src/services/publicAuditExport.test.ts src/services/auditOrchestratorService.test.ts` → **17/17 pass**.

## Update 2026-09-25 (pass 8) — customer-facing page, dialog + downloads, Playlist/Channel audit sections, `public-audit` queue, state persistence

Customer framing first: the sample-channel pills, the `YouTube Data API v3` badge, the quota-cost note (`~4 units…`), and OAuth/API help copy are gone. The launcher is now `Run Channel Audit` with plain copy ("paste a channel link, handle, or ID"), the report badge reads `Channel Audit`, history reads `Saved Channel Audit Reports`, and the scoring-rubric modal no longer references internal criteria tabs.

### Dialog + downloads

- The video inspect dialog was rebuilt on the shadcn `Dialog` shell with real padding (`px-4 sm:px-6`, `p-3 sm:p-4` sections), `maxWidth="lg"`, a full-width thumbnail on mobile (`w-full sm:w-44`), `min-w-0` + `truncate` chains, and a responsive footer (`flex-col-reverse sm:flex-row`).
- Footer gains **per-video downloads (this video only)**: `Download PDF (this video)` (selectable text, same element/criteria/recommendation shape as the video-audit PDF) and `Download Excel (this video)` (one-row workbook via the new pure `buildPublicAuditVideoWorkbook`, unit-tested).
- The hero `Export Full Excel` button is now an `Export Report` menu (shadcn `Menu` + `MenuItemBase`): **Excel workbook**, **PDF — selectable text** (new `downloadPublicAuditPdf`: overview, category scores, top opportunities, full per-video detail incl. all 6 element scores, playlists), and **PDF — image** (`exportPublicAuditImagePdf` via `exportElementToPdf` on a `reportRef` wrapper — exact pixels, non-selectable).

### Playlist + Channel audit sections (were missing)

There was no standalone playlist/channel audit — only folded-in fragments. Both now render from the real `fullAudit` engine output via a shared `CategoryAuditCard` (score badge + `Progress` + criterion breakdown + area-filtered `What to fix here` issues; nothing invented):
- **Playlists tab**: `Playlist Audit` card (Playlist Flow category + playlist-type issues + factual badges: playlist count, missing-description count, empty count) above the inventory table.
- **Channel tab** (renamed from `Channel SEO & Diagnostics` to `Channel Audit`): `Channel Audit` card (Channel Identity category + channel-type issues + factual identity checklist: avatar/banner/description/keywords/handle/topics set-vs-missing) above the diagnostics grid.

### `public-audit` queue category + page-change state loss

- **Backend**: new `public-audit` BullMQ queue (`backend/queue/publicAuditQueue.js` processor + `queue/index.js` wiring: queue, worker ×2 with the audit lock, `enqueuePublicAudit`/`publicAuditJobsGet`, Bull Board adapter, metrics, graceful close, null-service entries, and a `public-audit` completion notification/email config pointing at `/admin/public-audit`). The run pipeline was extracted verbatim into `backend/services/publicAuditRunner.js` (`runPublicAuditReport` + `scoreFullAudit`, same exports) so the sync route and the worker share one implementation. Routes: `POST /jobs` (enqueue → `{ jobId }`; falls back to a synchronous run with `direct: true` when the queue is disabled) and `GET /jobs/:id` (poll `{ jobId, state, progress, result?, error? }`, registered before `GET /:id`); sync `POST /` behavior is unchanged.
- **Frontend**: runs enqueue via `enqueuePublicAudit` and poll via `getPublicAuditJobStatus` with `useSessionJobId('public-audit')` (3s polling while waiting/active/delayed, resume on remount), a queued-progress card with `Progress` %, and a sync fallback for servers without `/jobs`. Report + channel input + toggles + filters + pagination persist to `sessionStorage` (`rt:public-audit:state`, best-effort) and restore on mount — leaving the page or refreshing no longer loses anything.

### Verify (this pass)

- Backend: `queue/publicAuditQueue.test.mjs` (2) + `routes/publicAuditJobs.test.mjs` (7) + `routes/publicAudit.test.mjs` (12) → **21/21 pass**; full suite **499/500** — the single failure is the pre-existing unrelated `orgAnalyticsService.test.mjs` leaderboard fixture. `node --check` on runner/processor/queue-index/route → clean.
- Frontend: `pnpm test -- --run` → **30 files / 199 tests pass** (incl. the new single-video workbook test, 9/9 in `publicAuditExport.test.ts`); `pnpm build` → pass; `pnpm design:lint` → pass; `pnpm exec eslint` on touched files → clean.

## Update 2026-09-25 (pass 9) — video dialog at 70% desktop width, full-bleed mobile

- The click-to-inspect video dialog now uses `maxWidth={false}` + `className="w-[calc(100%-2rem)] sm:w-[70%] sm:max-w-[75rem]"` — 70% viewport width capped at 1200px on desktop (mirrors the established `ace-dialog` 70% pattern), near-full-bleed with 1rem margins on mobile. The win is deterministic: `cn` is `tailwind-merge`, so the trailing className beats the shell defaults.
- Element-score grid inside the dialog steps up to 3 columns on `xl` (`grid-cols-1 sm:grid-cols-2 xl:grid-cols-3`) since the wider dialog has room; title/body/footer responsive behavior from pass 8 is unchanged.

### Verify (this pass)

- `pnpm exec eslint src/components/admin/PublicAuditPanel.tsx` → clean; `pnpm build` → pass (tsc + Vite + PWA).

## Update 2026-09-25 (pass 10) — missing video stats/dates restored + clickable table sorting

**Missing data (root cause):** the video table showed `—` for published date, views, likes, comments, and duration. `fetchPublicVideos` already fetches all of it (same `videos.list` snippet+statistics+contentDetails connector the Extra Tools Videos page uses via `channelVideosService`), but `videoAuditService.scoreVideo` returns scoring fields only — so `auditBatch` results silently dropped the metadata before persisting. Fixed in the shared `publicAuditRunner.js` (covers sync + queued runs): after scoring, each result is merged with its input by `videoId`, re-attaching `statistics` (view/like/comment/favorite), `publishedAt`, `durationLabel`, `durationSeconds`, `definition`, `categoryId`, `liveBroadcastContent` (null-safe: missing stats degrade to `null`/`""`, never throw). Note: reports saved before this fix still show `—` until re-run — the data was never persisted for them.

**Clickable sorting:** `AuditDataTable` columns now accept `sortable` (+ optional `sortKey`); sortable headers render a shadcn-style button with `ArrowDown`/`ArrowUp`/`ChevronsUpDown` states, `aria-sort`, and a tooltip. Click cycles biggest → lowest → normal. The panel wires Views, Eng. Rate, and Total Score to its existing `sortBy` state (dropdown and headers stay in sync, cards view sorts too); engagement sorting is new (`engagement-desc/asc`, unviewed videos sort last), plus a `views-asc` option. Other audit tools inherit the capability with zero changes (their columns stay non-sortable until opted in).

### Verify (this pass)

- Backend: the 3 public-audit suites → **23/23 pass** (updated fixtures now carry stats through the fakes; new assertions cover the merge, the null-safe path, and the graceful-degradation path); full suite **500/501** — the single failure is the pre-existing unrelated `orgAnalyticsService.test.mjs` fixture.
- Frontend: `pnpm build` → pass; `pnpm test -- --run` → **30 files / 199 pass**; `pnpm design:lint` → pass; `pnpm exec eslint` on the panel → clean (the `AuditDataTable` react-refresh note is the pre-existing shared-exports pattern).

## Update 2026-09-25 (pass 11) — per-element column sorting

- The six audit-score columns (Title, Description, Tags, Keywords, Thumbnail, Captions) are now clickable like Views/Eng. Rate/Total Score: each cycles biggest → lowest → normal with the same arrow/`aria-sort`/tooltip treatment. Unscored cells (`max: 0`/missing) sort last in both directions.
- Sort state unified into a module-level `VideoSort` type (template-literal element sorts derived from `ELEMENT_ORDER`, so new elements are covered automatically); `SORT_CYCLE` extended per element, header clicks and the dropdown share it, and the sort dropdown lists every order explicitly. Session persistence restores element sorts too.

### Verify (this pass)

- `pnpm exec eslint src/components/admin/PublicAuditPanel.tsx` → clean; `pnpm build` → pass (tsc + Vite + PWA).

## Update 2026-09-25 (pass 12) — rename saved audits + New Audit clear

- **Rename:** new `PATCH /admin/public-audits/:id { name }` (admin only, trims + 200-char cap, 400 on missing/invalid, 404 on unknown, bumps `updated_at`) + `renamePublicAudit(id, name)` service. The history list now passes `getName`/`onRename`, so each saved row has an inline rename pencil; renaming the open report also retitles the hero immediately.
- **New Audit:** a `New Audit` button in the launcher header (visible while a report is open) clears the report, dialog, error, and all result filters/pages back to defaults but keeps the launcher config (input, video count, toggles) for one-click reruns. An in-flight queued job keeps tracking and repopulates on completion. Persisted session state follows automatically via the existing effect.

### Verify (this pass)

- Backend: public-audit suites → **24/24 pass** (new PATCH assertions: rename SQL/params, 400, 404); `node --check routes/publicAudit.js` → clean.
- Frontend: `pnpm exec eslint` on panel + service → clean; `pnpm build` → pass.

## Update 2026-09-26 (pass 14) — panel split into `components/admin/public-audit/`

- The 2,075-line `PublicAuditPanel.tsx` is now a feature folder (new repo-wide decomposition rule, see `AGENTS.md`/`CLAUDE.md`): thin `PublicAuditPanel.tsx` orchestrator (~200 lines, composes only) + `usePublicAuditPanel.ts` (all state, queue, persistence, handlers, derived) + `publicAuditUtils.ts` (constants, formatters, tone classes, sort types) + `components/` (`RunControls`, `ChannelHero`, `PillarOverview`, `MetricsGrid`, `VideosTab` incl. the table columns, `PlaylistsTab`, `ChannelTab`, `VideoInspectorDialog`, `HistoryArchive`, `CategoryAuditCard`, `ScoringRubricModal`) + `index.ts` barrel. Zero visual/logic changes — pure moves; `AdminPage` imports the new path (old file removed via `git mv`).
- One lint lesson: `react-hooks/refs` false-positives on every `hookResult.*` access, so the orchestrator destructures the hook return instead of namespacing it.

### Verify (this pass)

- `pnpm exec tsc -b` → clean; `pnpm build` → pass; `pnpm test -- --run` → 30 files / 199 pass; `pnpm design:lint` → pass; `pnpm exec eslint src/components/admin/public-audit/` → clean.

## Update 2026-09-26 (pass 15) — double focus outline on search inputs

- Clicking a search input (magnifier icon, left) painted two outlines: the shadcn `Input`/`TextField` wrapper draws its own `focus-within` ring, but the global unlayered `:focus-visible` rule in `index.css` also hit the inner `<input>` (text fields match `:focus-visible` even on mouse click) — and unlayered CSS beats the layered `outline-none` utility, so both rings showed.
- Fixed at the shared-primitive level (one place, app-wide): inner inputs of `Input`/`TextField` now carry `data-rt-input`, and `index.css` adds a higher-specificity opt-out (`input[data-rt-input]:focus-visible, textarea[data-rt-input]:focus-visible, select.rt-select-native:focus-visible { outline: none }`). Raw inputs/textareas/selects elsewhere keep the global ring as their only indicator; keyboard focus stays fully visible everywhere.

### Verify (this pass)

- `pnpm build` → pass; `pnpm test -- --run` → 30 files / 199 pass; `pnpm design:lint` → pass; `pnpm exec eslint` on the two primitives → only the 9 pre-existing `any`/unused-var notes, nothing new.

## Update 2026-09-26 (pass 16) — input icon hidden + clear button flush right

- **Left icon not showing (launcher input):** it used a hand-rolled absolute-positioned magnifier over the `Input`, but the primitive's own wrapper is `relative` with a solid background and paints later in DOM order — so it covered the icon. Replaced with the primitive's `startAdornment` slot (the reason the slot exists); dropped the `relative` wrapper and `pl-9`.
- **X button flush against the right edge:** the shared `Input` gave its right-side controls no margin. The clear button and the password-toggle `IconButton` now carry `mr-1.5`, matching the left side's `pl-2/pl-3` rhythm. App-wide fix, not panel-local.

### Verify (this pass)

- `pnpm exec tsc -b` → clean; `pnpm exec eslint` on both touched files → clean; `pnpm build` → pass; `pnpm test -- --run` → 30 files / 199 pass.

## Update 2026-09-26 (pass 18) — shared export dropdown + oklab image-PDF fix

- **One dropdown, not two:** new shared `components/audit/AuditExportMenu.tsx` (shadcn `Menu` + items-as-data, Tailwind only, optional hint lines) adopted by both the public-audit hero and the video-audit report header — which also drops its bespoke `sx`-styled menu. Same options, one implementation: Excel / selectable-text PDF / image PDF (public) and PDF / Excel / CSV (video audit).
- **"Unsupported color function oklab":** Tailwind v4 + shadcn tokens emit oklch/color-mix, which html2canvas cannot parse — the image export (the one that keeps emojis pixel-perfect) aborted. `exportElementToPdf` now sanitizes first: computed modern color fns are inline-resolved to sRGB via canvas (`hasModernColorSyntax` + balanced-paren `replaceModernColorFns`, pure and unit-tested), walked live-subtree then always restored in a `finally`, so the UI never changes.

### Verify (this pass)

- New `services/pdf/brandedPdf.test.ts` → 6/6 pass; full frontend `pnpm test -- --run` → 31 files / 205 pass; `pnpm build` → pass; `pnpm design:lint` → pass; `pnpm exec eslint` on all touched files → clean.

## Update 2026-09-26 (pass 19) — Export Report on the Full Audit detail page

- The Full Audit run page (`/audit-orchestrator/:id`) had no export at all. It now has an `Export Report` button in the `AuditToolShell` header actions (visible once the run loads) backed by the same shared `AuditExportMenu`: **Excel workbook** (Overview / Categories / Criteria / Recommendations / Videos sheets), **selectable-text PDF** (overview, criteria breakdown, top 40 recommendations, audited videos), and **image PDF** (exact pixels, emoji-safe via the pass-18 sanitizer) snapshotting a new `reportRef` wrapper around the report body.
- New `services/auditOrchestratorExport.ts` (pure builders + downloads, same pattern as the video/public export services) with `auditOrchestratorExport.test.ts` (6 tests: sheets, overview fields, criteria/recommendation flattening, videos, empty-run safety, filename).

### Verify (this pass)

- New export tests → 6/6; full frontend `pnpm test -- --run` → 32 files / 211 pass; `pnpm build` → pass; `pnpm design:lint` → pass; `pnpm exec eslint` on touched files → clean.

## Update 2026-09-26 (pass 20) — top padding for all audit-tool pages

- Every audit-section page (`video-audit`, `audit-orchestrator`, `thumbnail-optimizer`, `playlist-optimizer`, `optimized`) renders its content in the shared `.audit-tool-body`, which had `padding-top: 0` — first cards sat flush against the header/tab rail edge. One-line shared fix in `components/audit/audit-tools.css`: body padding is now `space-5 / space-5 / space-8` desktop and `space-4 / space-3 / space-6` mobile. The admin tab container (`.admin-content`, home of the public-audit panel) already had top padding — untouched.

### Verify (this pass)

- `pnpm design:lint` → pass; `pnpm build` → pass.

## Update 2026-09-26 (pass 21) — shell-level top padding (content-area follow-up)

- The body fix wasn't enough: the audit title band (`.page-header`, rendered by `AuditToolShell` *above* `.audit-tool-body`) still sat flush against `.content-area`, which is intentionally `padding: 0` so every page owns its own rhythm. Scoped fix in the same shared file: `.audit-tool-page` now has `padding-top: space-5` desktop / `space-4` mobile. No global `.content-area` change (that would double-space dashboard/admin pages that already pad themselves).

### Verify (this pass)

- `pnpm design:lint` → pass; `pnpm build` → pass.

## Update 2026-09-26 (pass 17) — export menu never visible (shared Menu off-screen bug)

- Clicking Export Report showed nothing: the shared shadcn `Menu` renders `position: fixed` (viewport coordinates) but computed its position with `window.scrollY/scrollX` added (document coordinates) — on any scrolled page the menu landed off-screen. Fixed in `components/ui/Menu.tsx`: pure viewport coords from `getBoundingClientRect`, clamped into view, flips above the anchor when there is no room below, and closes on scroll/resize like a native menu. This also fixes the same invisible-menu bug in the playlist-optimizer and video-audit export menus, which share the primitive.

### Verify (this pass)

- `pnpm exec tsc -b` → clean; `pnpm exec eslint src/components/ui/Menu.tsx` → same 10 pre-existing notes as before the change (verified via stash), nothing new; `pnpm build` → pass; `pnpm test -- --run` → 30 files / 199 pass.

## Update 2026-09-25 (pass 13) — legacy video stats backfilled via `videos.list`

- The fetch already uses exactly that endpoint: `fetchPublicVideos` hydrates ids through `GET /youtube/v3/videos?part=snippet,statistics,contentDetails` (titles/dates from `snippet`, views/likes/comments from `statistics`, duration/definition from `contentDetails` — same connector as the Extra Tools video pages), and since pass 10 the runner re-attaches it to every scored row. Only reports saved *before* pass 10 render `—`, because the data was never persisted for them.
- Those legacy reports now heal on open: new `hydrateVideoMetadata(videoIds)` (direct `videos.list` by id, 50/chunk = 1 quota unit per 50 videos, deduped) + `GET /:id` backfill that fills only rows missing both stats and date, writes the filled rows back one-time (`UPDATE … results`), and serves stored rows untouched when hydration fails or rows are already complete. No re-run needed.

### Verify (this pass)

- Backend: service suite gains hydrate tests (by-id lookup shape, 50-chunk batching, empty→no call); route suite gains backfill tests (merge + one-time UPDATE, skip-when-complete, non-fatal failure). Full suite **505/506** — the single failure is the pre-existing unrelated `orgAnalyticsService.test.mjs` fixture; `node --check` clean on both touched files.

## Update 2026-09-26 (pass 22) — shell root was the real edge (Tailwind shell emits no audit-tool-page class)

- Passes 20–21 didn't move the Channel Audit title because both targeted CSS classes that no longer render it: the Tailwind rewrite of `AuditToolShell` dropped the `audit-tool-page` class entirely (verified: zero TSX references), so neither the body padding nor the shell padding ever reached these pages. Fixed where the shell actually lives: its Tailwind root is now `pt-[var(--rt-space-5)]` desktop / `max-md:pt-[var(--rt-space-4)]` mobile. The dead `.audit-tool-page` padding from pass 21 was reverted and annotated so nobody re-adds styles there.

### Verify (this pass)

- `pnpm exec tsc -b` → clean; `pnpm exec eslint` on the shell → clean; `pnpm build` → pass; `pnpm design:lint` → pass.

## Update 2026-09-26 (pass 23) — reverted body/shell CSS, padding on the content header

- Reverted all three earlier attempts (`.audit-tool-body` top padding, `.audit-tool-page` padding + note — `audit-tools.css` is byte-identical to before again). Since every audit page renders through `AuditToolShell`, the single live fix is top padding on the shell's own `<header>` (`pt-[var(--rt-space-5)]` desktop / `max-md:pt-[var(--rt-space-4)]` mobile).

### Verify (this pass)

- `pnpm build` → pass; `pnpm design:lint` → pass.

## Update 2026-09-26 (pass 24) — audit custom CSS fully stripped (Tailwind + shared components)

- `components/audit/audit-tools.css` and `audit-data-table.css` are deleted — no page or component references them anymore. Every live class got a Tailwind/shadcn home following DRY+KISS: new shared `components/audit/AuditToolBody.tsx` (centered content column, used by all 6 audit pages) and `components/audit/AuditLoadingState.tsx` (running-job card with spinner, used by video/playlist/thumbnail audits); the one stray `adt-cell--rank` in `VideoAuditTable.tsx` became a token-colored Tailwind span. Already-dead classes (shell tabs/actions/alerts, score pills, resizable-table chrome — all Tailwind since earlier passes) went with the files. One self-inflicted JSX mismatch in `ThumbnailOptimizerPage` during the swap was caught by `tsc` and fixed.
- `AGENTS.md` gains the boy-scout clause: touching a file that uses legacy custom CSS means migrating it in the same change and deleting orphaned CSS files.

### Verify (this pass)

- `pnpm exec tsc -b` → clean; `pnpm build` → pass; `pnpm test -- --run` → 32 files / 211 pass; `pnpm design:lint` → pass; `pnpm exec eslint` on new/edited files → clean.

## Update 2026-09-26 (pass 25) — shared PageHeader band for all audit pages (Goals pattern)

- New `components/PageHeader.tsx`: accent icon + truncated title + subtitle left, `(?)` help tooltip + action buttons right — the Goals `page-header--split` band rebuilt in Tailwind + tokens, no custom CSS. `AuditToolShell` now renders it (new optional `icon`/`helpText` props), so all six audit pages (video, thumbnail, playlist, optimized, channel audit run + detail) share one title band with per-tool icons; the shell's hand-rolled header is gone. Other pages keep their bespoke headers (dashboard sticky header, channel switchers) — follow-up candidates, not regressions.

### Verify (this pass)

- `pnpm exec tsc -b` → clean; `pnpm exec eslint` on shell + header → clean; `pnpm build` → pass; `pnpm test -- --run` → 32 files / 211 pass; `pnpm design:lint` → pass.

## Update 2026-09-26 (pass 27) — below-header spacing for Extra Tools pages

- The band's bottom border sat flush against alerts/toolbars/content (those blocks carry side/bottom margins but no top margin). `DataExplorerShell` and `Compare` now pass `mb-4 sm:mb-5` to the shared `PageHeader` — margin on the band itself, so no wrapper divs (which would have broken the `.page-container > .form-section` child selectors) and no double-spacing with existing bottom margins.

### Verify (this pass)

- `pnpm exec tsc -b` → clean; `pnpm build` → pass.

## Update 2026-09-26 (pass 26) — PageHeader in Extra Tools + Admin

- `DataExplorerShell` now renders the shared `PageHeader` internally (new optional `icon`/`helpText`), so Channel, Videos, Playlist, and Specific Videos get the icon + title + subtitle band with zero per-page markup — each page only passes its icon (`Users`, `Video`, `MdPlaylistPlay`, `Search`).
- `Compare` and `AdminPage` hand-rolled bands replaced with `PageHeader` (their Refresh/Export-PDF actions pass straight through). Remaining bespoke headers (dashboard sticky header, GoalDetail, Profile already banded, OrgAnalytics already banded) untouched.

### Verify (this pass)

- `pnpm exec tsc -b` → clean; `pnpm exec eslint` on touched files → only the 9 pre-existing notes (verified via stash); `pnpm build` → pass; `pnpm test -- --run` → 32 files / 211 pass; `pnpm design:lint` → pass.

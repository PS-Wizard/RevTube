# 2026-09-28 — Anomaly Detection page (frontend feature complete)

Sources: `frontend/src/pages/anomalies/**`, `frontend/src/hooks/queries/useAnomaliesQuery.ts`, `frontend/src/services/anomalyService.ts`, `frontend/src/types/anomaly.ts`, `frontend/src/App.tsx`, `frontend/src/components/Layout.tsx`, `frontend/src/components/dashboard/VideoAnalyticsChart.tsx`, `backend/routes/anomalies.js`, `backend/index.js:762/903/1177`, `backend/services/anomalyService.js`, `backend/config/anomalyConfig.js`, `backend/db/migrations/012_anomalies.sql` · verification: `tsc -b`, `eslint`, `vitest` (backend 506/506, frontend 211/211)

## Change

Shipped the user-facing **Anomaly Detection** tool that consumes the existing backend anomaly engine (weekday-aware 28-day median baseline, robust z-scoring, driver attribution, on-demand AI explain):

- **Route + nav**: `/anomalies` lazy route in `frontend/src/App.tsx` (next to `/goals`); sidebar NavLink under the Dashboard section in `Layout.tsx` gated by `isNavItemVisible("anomalies")` (feature key `anomalies`, added to `featureConfig.js` + `FeatureConfigContext.tsx` defaults).
- **Page composition** (`pages/anomalies/`, one folder per route convention): thin `AnomaliesPage.tsx` → `AuditToolShell` + `AuditToolBody` + `KpiRow` + `AnomalyFiltersBar` + `AnomalyList` (left) / `DetailColumn` (right) + pagination. Shared `ui` primitives + Tailwind tokens only, `min-w-0`/`truncate` chains on every text row, no custom CSS.
- **State**: `useAnomalies.ts` — URL-synced detail selection (`?id=`), localStorage channel + `channelChanged` listener, TanStack Query hooks in `hooks/queries/useAnomaliesQuery.ts` (list/metrics/detail/series + scan/status/explain mutations with invalidation). Filter setters rewind pagination via `applyFilter` (no set-state-in-effect).
- **Video tab link**: `VideoAnalyticsChart` header gains an **Anomalies** button → `navigate('/anomalies')`, making the page discoverable from the chart that still renders local spike/dip tooltip insights (`resolveVideoAnomalyInsights` — kept as-is; deep integration deferred).
- **Backend**: `GET /api/anomalies`, `GET /metrics`, `GET /:id`, `GET /:id/series`, `POST /scan`, `POST /:id/explain`, `PATCH /:id/status` — service wired at `index.js:762`, router at `:903`, mounted at `:1177`.
- **Route-folder refactor side-effects closed**: `toggleList` moved to `anomaliesUtils.ts` (was exported from a component), dead `severityBadge`/`kindBadge` helpers deleted, duplicate `AnomaliesPage` lazy import removed from `App.tsx`.

## Also fixed (pre-existing, unrelated)

- `backend/services/orgAnalyticsService.test.mjs` — fixture dates were absolute (`2026-08-20/21`) and aged out of the service's trailing 30d window (`new Date()`-derived `start`), so the leaderboard-order assertion failed deterministically after 2026-08-27. Dates now computed with a `daysAgo(n)` helper.

## Verify

- `frontend`: `tsc -b` clean · `eslint` on anomalies files, `App.tsx`, `VideoAnalyticsChart.tsx` clean · `vitest run` **211/211** · `check-ui-boundary.mjs` reports **zero** new violations in `pages/anomalies` (note: the script still fails overall because `scripts/ui-boundary-baseline.json` is committed as `{}` while 32 pre-existing files hold 1,591 utility hits — pre-existing, untouched).
- `backend`: `vitest run` **506/506 (52 files)**.
- Router mount confirmed (`index.js:1177`), nav + route confirmed in `Layout.tsx`/`App.tsx`.

## Update — 2026-09-26: wire-shape normalization (runtime crash fix)

**Reported**: `Cannot read properties of undefined (reading 'toLocaleString')` on `/anomalies`.

**Root cause**: the frontend `Anomaly` type claimed to "mirror" the backend payload but did not — `backend/services/anomalyService.js` `mapRow` (line 669) serializes `baselineValue`/`actualValue`/`unit`/`ai`, while `AnomalyList.tsx:55` read `anomaly.baseline`/`anomaly.actual` directly → `undefined.toLocaleString()` threw on the first list row. The same contract gap silently broke the rest of the page:

| UI expects | backend sends | symptom |
| --- | --- | --- |
| `baseline` / `actual` | `baselineValue` / `actualValue` | **crash** on list render |
| `metricUnit` | `unit` | no units anywhere (labels/tooltips) |
| `explanation` (`AnomalyExplanation`) | `ai: { explanation, model, generatedAt }` | AI panel always "No AI explanation yet"; "AI explained" badge never shown; confidence rendered as raw 0–1 number; `recommendedActions` objects would render `[object Object]` |
| evidence `signals[].signal`, `drivers[].thumbnail` | `signals[].label/key`, `drivers[].thumbnailUrl` | blank signal labels; missing avatars |
| `drivers[].sharePct` 0–100 number | 0–1 **fraction, nullable** | detail showed "0%"; `.toFixed` would crash on null for non-view metrics |
| `series.points[].isAnomaly` | `points[].anomaly` marker | chart anomaly markers never rendered |
| `explainAnomaly()` → explanation | envelope `{ anomaly, explanation, cached, model }` | response shape wrong (type-only impact) |
| `scanAnomalies().total` | `stored`/`detected` | toast read "Scan complete — undefined anomalies" |

**Fix (KISS — normalize once at the sanctioned API boundary, no component changes needed for mapping):**

- `frontend/src/services/anomalyService.ts` — added raw DTO types (`RawAnomaly`, `RawEvidence`, `RawExplanation`, `RawSeries`) + normalizers (`normalizeAnomaly`, `normalizeEvidence`, `normalizeExplanation`, `normalizeSeries`) applied in `getAnomalies`/`getAnomaly`/`getAnomalySeries`/`explainAnomaly` (unwraps envelope; fresh responses get `generatedAt: now`) /`scanAnomalies` (maps `total`). Confidence 0–1 → `'low' < 0.45 ≤ 'medium' < 0.7 ≤ 'high'` band; `{ action }` objects → strings; `source: 'rules'` → `fallback`.
- `frontend/src/types/anomaly.ts` — contract now honest: header documents normalization, `AnomalyDriver.sharePct: number | null` (0–1 fraction), `AnomalyEvidence` trimmed to `{summary, drivers, signals}` (dead `driversTotalDeltaViews`/`driversCoveragePct`/`isTrend`/`runDays` removed — no consumers), unused `method` removed, `anomalies` on the series result retyped to the new `AnomalySeriesMarker`.
- `frontend/src/pages/anomalies/components/AnomalyDetail.tsx` — driver caption guards `sharePct !== null` and renders `Math.round(sharePct * 100)%`.
- `AnomalyList.tsx` crash line **unchanged** — correct once `baseline`/`actual` are numbers (`Number#toLocaleString` caps fraction digits at 3 by default).

**Regression coverage**: new `frontend/src/services/anomalyService.test.ts` (8 tests, mocked fetch/apiBase/authHeaders/analyticsService per `channelFocusService.test.ts` conventions): baseline/actual/metricUnit mapping incl. the exact `toLocaleString()` call, evidence mapping, ai→explanation band/actions/cached, null-explanation case, explain envelope + rules fallback, series marker→`isAnomaly`, scan `total` + skip reason.

**Verify (post-fix)**: `tsc -b` clean · `eslint` on all touched files clean · `vitest run` **219/219 (33 files)** · `pnpm build` OK. Backend untouched — still 506/506.

## Update — 2026-09-27: Clear-all filter reset (reset to default)

**Asked**: `/anomalies` filter bar had no way to clear filters back to defaults.

**Change (defaults = metrics [], kinds [], severities [], statuses [open, acknowledged]):**

- `frontend/src/pages/anomalies/useAnomalies.ts` — exported `DEFAULT_ANOMALY_STATUSES`, added `hasActiveFilters` (any metric/kind/severity selected OR statuses differ from default) + `resetFilters()` (restores defaults, rewinds pagination via `setOffset(0)`).
- `frontend/src/pages/anomalies/components/AnomalyFiltersBar.tsx` — new optional `hasActiveFilters`/`onClearFilters` props; ghost **Clear all** button (with `MdClear`) in the header row shown only when filters are active; footer `N active` count now also counts a modified status selection and renders an inline `reset to default` action.
- `frontend/src/pages/anomalies/AnomaliesPage.tsx` — wires `hasActiveFilters`/`resetFilters` into the bar.

**Verify**: `tsc --noEmit -p tsconfig.app.json` clean · `eslint` on the three touched files clean · `vitest run src/services/anomalyService.test.ts` 8/8.

## Update — 2026-09-28: AI explanation panel + table/grid views + numbered pagination

**Asked**: `/anomalies` needed (1) a visible AI-explain with clear AI usage,
(2) real pagination (page sizes, numbered pages) instead of bare prev/next at
50/page, (3) table + grid views, all on shared ui primitives + Tailwind.

**Gap found**: the `explain` mutation existed in `useAnomalies` but was never
rendered anywhere — the detail column had no AI section at all.

**Change** (`frontend/src/pages/anomalies/`, shared `ui` primitives only):

- `components/AnomalyExplanation.tsx` (new) — rendered at the bottom of
  `DetailColumn`: empty state CTA ("Explain with AI", cached-per-anomaly note)
  when `detail.explanation` is null; otherwise a usage-disclosure header
  (confidence + model + Cached/Fresh + rules-fallback badges, generated-at
  with cached-vs-fresh wording, regenerate IconButton) plus headline/summary,
  likely category, root causes with weight Progress bars, impact, numbered
  recommended actions, caveats, and a verify-against-analytics footnote.
- `components/AnomalyTable.tsx` (new) — dense table view on the shared
  resizable `AuditDataTable`: Date, Anomaly, Kind, Severity, Change, Status,
  AI (Explained badge) columns; row click selects the detail. Headers resize
  but intentionally don't sort (server order is newest-first; aria-label says
  so — client-sorting one page would mislead across pages).
- `components/AnomalyPagination.tsx` (new) — windowed numbered pages
  (first · prev-current-next · last + ellipses, shared Pagination primitives)
  + `x–y of total` caption + 10/25/50 per-page `NativeSelect`. Pure
  `pageWindow` helper lives in `anomaliesUtils.ts` (fast-refresh safe).
- `components/AnomalyList.tsx` — new `layout="grid"` (responsive 2-up cards
  + matching skeletons) reusing `AnomalyRow`; list layout unchanged.
- `useAnomalies.ts` — `pageSize` state (default **10**, resets offset on
  change), 1-based `page`/`totalPages`, `setPage`, `viewMode`
  (`'table' | 'grid'`, default table).
- `AnomaliesPage.tsx` — toolbar (count caption + `SegmentedControl`
  Table/Grid toggle), table/grid/loading-error-empty switching, shared
  pagination under the list. Old prev/next block removed.

**Verify**: `tsc -b` clean · `eslint` clean on all touched/new files ·
`vitest run` **259/259 (38 files)** incl. new `anomaliesUtils.test.ts`
(`pageWindow` windowing + page sizes). Backend untouched.

## Update — 2026-09-28: one-call batch explain, compact panel, 70% detail dialog

**Asked**: hide model/cached internals, shorten the AI panel, explain all new
anomalies in one API call up front, set status after viewing, full-width
table with detail in a 70% dialog.

**Change**:

- Backend (`services/anomalyPrompts.js`, `services/anomalyService.js`,
  `index.js` wiring): new pure `buildBatchExplainPrompt` (compact per-anomaly
  blocks, SHORT-copy instruction, keyed `{"explanations": {"<id>": …}}`
  contract) + `explainAnomaliesBatch(ids)` (skips already-explained rows,
  stores each usable explanation, never throws). `autoExplain` now costs
  exactly one LLM call per scan instead of one per anomaly; per-id
  `POST /:id/explain` stays for regenerate. New
  `services/anomalyExplainBatch.test.js` (6 tests: contract, one call,
  skip-explained, garbled entry, LLM failure, id hygiene).
- Frontend `AnomalyExplanation.tsx`: compact only — headline, clamped
  summary, top-3 causes + top-3 actions, confidence badge, regenerate, rules
  fallback alert. Model name, Cached/Fresh badges, category, impact,
  caveats, and footnotes removed.
- `AnomalyDetailDialog.tsx` (new): 70%-viewport dialog (audit-inspector
  shell pattern) holding the status `SegmentedControl`
  (Open/Acknowledged/Dismissed via existing `setStatus`), chart, drivers,
  signals, and the compact AI panel. `AnomaliesPage` is now a full-width
  table/grid + pagination with the dialog on row click; the side
  `DetailColumn` is gone (`AnomalySections.tsx` keeps `KpiRow` only).

**Verify**: backend **557/557 (58 files)** · frontend **259/259 (38 files)** ·
`tsc -b` clean · `eslint` clean on all touched/new files.

## Update — 2026-09-28: standard dialog header, AI text wrap + spacing

**Asked**: every dialog must share one shadcn header (icon + title + subtitle
+ close button), then content, then a footer only for action dialogs;
informational dialogs need no footer. Also the AI analysis text overflowed
instead of wrapping, and the summary was too cramped.

**Change** (frontend only):

- New shared `components/ui/DialogTitleBlock.tsx` (exported from the ui
  index): icon medallion + truncating title + subtitle + X close button in
  one header block — the single sanctioned dialog header.
- `AnomalyDetailDialog`: standard header (metric + date-range subtitle), no
  footer (informational; status control lives in the content).
- `PlaylistInspectorDialog`: standard header (video-count/published
  subtitle), footer removed (was Close-only).
- `VideoInspectorDialog`: standard header (score/published subtitle), footer
  kept (Excel/PDF download actions).
- `AnomalyExplanationCard`: causes/actions/summary now wrap
  (`overflow-wrap`, `min-w-0`, wrapping flex header) instead of truncating
  into overflow; airier type (`line-height` 1.6–1.7, panel padding 12→16,
  section gaps) for the summary and item lists.

**Verify**: `tsc -b` clean · `eslint` clean on all touched/new files ·
`vitest run` **259/259 (38 files)**. Backend untouched.

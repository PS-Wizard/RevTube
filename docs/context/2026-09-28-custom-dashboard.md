# 2026-09-28 — Custom user dashboard (`/my-dashboard`)

Sources: `frontend/src/pages/my-dashboard/**`, `frontend/src/config/statCardRegistry.ts`, `frontend/src/stores/cardLayoutStore.ts`, `frontend/src/utils/cardLayout.ts` (+`.test.ts`), `frontend/src/App.tsx`, `frontend/src/components/Layout.tsx`, `frontend/src/contexts/FeatureConfigContext.tsx`, `backend/config/featureConfig.js` · verification: `tsc --noEmit`, `eslint`, `vitest` (frontend 230/230, backend 506/506), `design:lint` clean, `vite build` OK

## What changed

New **My Dashboard** page: users pick widgets, drag cards to rearrange on a
responsive 2D grid, and the layout persists per user across devices.

- **Route + nav**: `/my-dashboard` lazy route in `App.tsx` behind
  `FeatureGuard pageKey="customDashboard"`; sidebar NavLink under the Dashboard
  section in `Layout.tsx` (pageKeyMap entry included); `customDashboard`
  defaults added to frontend `FeatureConfigContext` + backend
  `config/featureConfig.js` (schema is an open record, unknown keys default to
  enabled — no migration needed).
- **Page composition** (`pages/my-dashboard/`, feature-folder convention, every
  file small): thin `MyDashboardPage.tsx` (`PageShell` + channel
  `NativeSelect` + `DateRangeSelector` toolbar + `WidgetPicker` action) →
  `CustomDashboardGrid` (dnd-kit sortable 12-col grid, halves pair on lg+) →
  `WidgetCard` (drag handle + title) → `WidgetHost` (id → adapter) → five
  adapters in `components/widgets/` reusing the existing dashboard components
  (`ChannelAnalyticsInsights`, `AudienceBreakdownPanel`, `InsightsPanel`,
  `GoalsOverviewBanner`) plus a compact `AnomaliesWidget` (counts + link to
  `/anomalies`). Shared `ui` primitives + `sx` only, `min-w-0`/`truncate` on
  text rows, no custom CSS, no raw hex.
- **State** (`useCustomDashboard.ts`): reuses the shared dashboard store for
  channel/date context (same selection as `/dashboard`) and the shared
  card-layout store for widget order/visibility. Channel + audience tab queries
  are gated on **visible widgets** instead of `activeTab`, so hiding a widget
  also skips its quota cost. `InsightsPanel`/`GoalsOverviewBanner`/anomalies
  query self-manage as before.
- **Persistence (no backend change)**: widgets live on a new
  `dashboard:custom` surface inside the existing `cardLayout` map
  (`users/{uid}.uiPreferences.cardLayout`) — the backend sanitizer is
  surface-agnostic and the id/surface patterns already match. Same two-tier
  localStorage + debounced-PUT path, last-widget-can't-hide rule, and
  normalize-on-read (new widgets append at defaults, stale ids drop).
- **Drag-and-drop**: new deps `@dnd-kit/core` + `@dnd-kit/sortable` +
  `@dnd-kit/utilities` (~54 KB raw). Pointer (6px), touch long-press
  (250ms, scroll-safe), and keyboard sensors; arrow buttons in the picker stay
  as the no-drag/a11y path. New `setSurfaceOrder` helper
  (`utils/cardLayout.ts` + `cardLayoutStore` action) persists drop results.

## Verify

- `frontend`: `tsc --noEmit` clean · `eslint` clean on all touched/new files
  (`Layout.tsx` has 3 pre-existing ref-rule errors, confirmed via stash — untouched
  lines) · `vitest` **230/230 (34 files)** incl. new
  `customDashboardUtils.test.ts` (9) + `setSurfaceOrder` tests (2) ·
  `design:lint` exit 0 · `ui:boundary`: no new violations from `my-dashboard`
  (script still fails on pre-existing playlist/video-audit files) · `vite build` OK.
- `backend`: `vitest` **506/506 (52 files)**.
- `perf:budget` fails identically **with and without** this change (stashed
  baseline: JS 4.89 MB vs 2.66 MB budget; with change: 4.95 MB, +63 KB ≈
  dnd-kit; largest chunk unchanged) — pre-existing blowout, not a regression.

## Follow-ups (not done)

- Video/playlist chart + table widgets (need `DashboardPage` derivation
  extraction); per-widget size presets (needs sanitizer extension both sides);
  per-org layout scoping; retention section in the audience widget only appears
  once insights data has loaded (insights widget visible at least once).

## Update — 2026-09-27: Postgres matrix storage + org scopes

**Asked**: per-org layouts, Postgres instead of Firestore (quota + flexibility),
matrix positions per widget.

**Backend** (no Firestore reads/writes for layouts anymore):

- `db/migrations/013_custom_dashboard_layouts.sql` (+ drizzle counterpart
  `db/drizzle/0017_custom_dashboard_layouts.sql`, + `db/schema.js` entry):
  `custom_dashboard_layouts(owner_uid, org_id, name, layout JSONB)` with
  `UNIQUE(owner_uid, org_id, name)` — `org_id ''` = personal scope, `name`
  defaults to `'default'` (multi-dashboard ready). Matrix shape:
  `{cells: [{id, x, y, w, h}], hidden: []}` on a 12-column grid.
- `utils/customDashboardPrefs.js` (+ 9 tests): pure sanitizer — cell geometry
  bounds (`x + w <= 12`, caps 24 cells / 100 rows), id/name patterns, cells-win
  over hidden, row-major sort.
- `services/customDashboardService.js` (+ 7 tests, DI fakes): `getLayout` /
  `saveLayout` over parameterized SQL via `db/client` `query()` (upsert with
  `ON CONFLICT`), 1h `ServerCache` reads with write-invalidation, org writes
  gated on `getCachedOrgMembership` (403 otherwise), `{ supported: false }`
  when Postgres is unconfigured so the client degrades instead of erroring.
- `routes/customDashboards.js` mounted at `/api/custom-dashboards`
  (`GET ?orgId=&name=`, `PUT { orgId, name, layout }`), `authenticateRequest`
  guarded, user.js-style error envelopes. No quota gate (user config, not
  YouTube data) — same as the ui-prefs endpoints.

**Frontend**:

- `types/customDashboard.ts` + `utils/dashboardLayoutMatrix.ts` (+ 11 tests):
  `packOrderToCells` (deterministic row-pack from order + spans — drag
  round-trips losslessly), `cellsToOrder`, `normalizeDbLayout` (drops unknown
  ids, appends new catalogue ids, never blanks), hide/show/reorder/isCustomized.
- `services/customDashboardService.ts` (+ 5 tests, mocked fetch): typed
  fetch boundary, normalizes on read, `supported: false` on 503.
- `stores/customDashboardStore.ts`: scoped two-tier store — localStorage
  mirror per `(uid, org)` + debounced Postgres PUT, local-only mode when
  unsupported, one-time v1 migration (Firestore `dashboard:custom` → packed
  matrix on first personal sync, then the legacy surface is retired).
- `useCustomDashboard.ts` exposes `scope`/`scopeLabel` (`Personal` vs org
  name) + matrix `cells`; grid renders cell order/widths from the matrix;
  picker manages the active scope; toolbar shows a `{scope} layout` badge.
  PNG-download refs moved into the widget adapters that own them.

**Verify**: backend **521/521 (54 files)** · frontend **241/241 (36 files)** ·
`tsc` clean · `eslint` clean (all touched files) · `design:lint` clean ·
`vite build` OK. `perf:budget` / `ui:boundary` unchanged pre-existing failures.

**Leftovers**: named-dashboard switcher UI (API already supports `name`);
per-widget resize presets (matrix `h`/`w` ready, needs UI + sanitizer bump);
org-*shared* layouts (today each member has their own org-scoped layout).

## Update — 2026-09-28: pin-to-dashboard affordance on source sections

**Asked**: every page section / card gets a pin icon; one click adds it to the
custom dashboard.

**What changed** (no backend change, no registry change — 1:1 widget mapping):

- New feature folder `components/dashboard/pin-to-dashboard/` (entry +
  `components/`-style split per repo convention): `PinToDashboardButton.tsx`
  (shared `IconButton` + lucide `Pin`/`PinOff`, always visible, `aria-pressed`,
  `View` link to `/my-dashboard` when pinned, success toast with scope label)
  + `usePinToDashboard.ts` (active `(uid, org)` scope via `useAuth` +
  `useOrganization`, `loadScope` on mount, `showWidget`/`hideWidget` toggle —
  same scope the My Dashboard page persists) + `pinToDashboardUtils.ts`
  (single home for pinnable ids, labels, route, pin copy) + `index.ts` barrel
  + `pinToDashboardUtils.test.ts` (2 tests).
- Pinned from five source sections, each mapping to its existing
  `dashboard:custom` widget id: `ChannelAnalyticsInsights` header →
  `channel-kpis`; `AudienceBreakdownPanel` → `DimensionsPanel headerActions` →
  `audience`; `InsightsPanel` header → `insights`; `GoalsPage` header actions →
  `goals`; `AnomaliesPage` via `AuditToolShell actions` → `anomalies`.
- `WidgetCard` header gains an always-visible unpin (`PinOff`) action that
  hides the widget from the active scope, complementing the `WidgetPicker`.
- Tailwind + shared `ui` primitives only, `min-w-0`/`truncate` on the pin row,
  `--rt-color-accent` token for the pinned state (no raw hex, no custom CSS).

**Verify**: `vitest` pin catalogue (2) + custom-dashboard catalogue (4) pass ·
`tsc -b` clean · `eslint` clean on all touched/new files (2
`react-refresh/only-export-components` errors in `DimensionsPanel.tsx` are
pre-existing on untouched lines) · no backend change.

## Update — 2026-09-28: more KPI cards (video/playlist graphs, top lists, custom builder)

**Asked**: more KPI cards + custom cards, including channel-analytics,
playlist and video graphs.

**What changed** (no backend change — the sanitizer is registry-agnostic):

- **4 new built-in widgets** (`config/statCardRegistry.ts`, visible by
  default via the existing append-missing normalize): `video-performance`
  (full-width: views / minutes-watched / avg-retention pills with deltas +
  daily views area chart), `playlist-performance` (half: period playlist-views
  KPI + top-5 playlists bar list), `top-videos` (half: top 5 by lifetime
  views, thumbnails), `top-playlists` (half: biggest 5 by video count).
- **Self-managed data** (Insights/anomalies precedent — mount = visible =
  fetch, nothing written to the shared dashboard store, so no cross-widget
  clobbering): `VideoPerformanceWidget` fires one channel-wide
  `getDashboardBundle` (1 quota unit, rows via shared `buildVideoChartRows`,
  deltas via shared `calcMetricDeltaPct`); `PlaylistPerformanceWidget` fires
  one `playlistViews` report (1 unit, same parse as
  `useDashboardPlaylistViews`) + the shared `usePlaylistsQuery` catalog;
  `TopVideosWidget` / `TopPlaylistsWidget` read the shared DB-backed
  `useVideosQuery` / `usePlaylistsQuery` caches (same keys as `/dashboard`,
  drained for full-catalog ranking). `WidgetHost` maps the four ids;
  `useCustomDashboard` is untouched for data.
- **Pins on the graphs**: `VideoAnalyticsChart` header (shared by both tabs)
  pins `video-performance` on the Videos tab and `playlist-performance` on
  the Playlists tab; tables intentionally got no pins (shared `VideoTable` /
  `PlaylistTable` stay concern-free — the ranking widgets are visible by
  default and picker-managed). `PINNABLE_WIDGET_IDS` extended accordingly.
- **Custom KPI builder**: `stores/customCardsStore.ts` (Zustand + immer,
  localStorage `revtube_custom_cards_v1`, per-scope defs
  `{ id: custom:<slug>-<suffix>, label, metric, period }`, metric allowlist =
  the channel-analytics registry, 20 cards/scope cap) +
  `CustomCardDialog.tsx` (shared `Modal` + `TextField` + `NativeSelect` +
  `SegmentedControl`, validation in `customKpiUtils.ts`) opened from
  `WidgetPicker` ("Custom card" button, trash-icon delete per custom row) +
  `CustomKpiWidget.tsx` (shared `StatCard`, value from the flattened channel
  multi-period stats, fires `useChannelTabQuery` with identical args so the
  cache is shared — zero extra quota beside channel-kpis, one unit alone).
- **Scope plumbing for `custom:*` ids**: `customDashboardStore.knownIds`
  merges the scope's custom ids (registry-only when scopeless);
  `customDashboardService` merges all locally-known custom ids on the
  scope-less read path; `useCustomDashboard` cells filter drops `custom:*`
  ids with no local definition (synced layouts never paint empty shells);
  `custom:*` spans `half`; labels resolve via `findCustomCardDef`.
- Tailwind + shared `ui` primitives only, `min-w-0`/`truncate` chains,
  `--rt-*` tokens, no custom CSS, no raw hex. New files all <250 lines.

**Verify**: frontend **271/271 (41 files)** incl. new `customKpiUtils.test`
(5) + `customCardsStore.test` (4), extended pin catalogue (3) + dashboard
catalogue (4) · `tsc -b` clean · `eslint` clean on all touched/new files ·
no backend change.

**Leftovers**: custom-card definitions are local-only v1 (ids sync via the
layout, defs don't — other devices skip the card); needs a backend table if
cross-device customs matter. `videosUploaded` custom cards read `0` until the
video catalog loads (same flatten source as channel-kpis). Table-section pins
were deliberately skipped (shared tables stay dashboard-agnostic).

## Update — 2026-09-28: reference docs refresh

**Asked**: update all documents for the dashboard work.

Reference set (living docs, edited in place — not the `context/` log):

- `docs/18-Custom Dashboards/Custom Dashboards.md`: source-of-truth table
  gains the pin folder, `customCardsStore`, builder dialog + utils; Widgets
  table rewritten to all nine built-in ids plus `custom:*` with data sources
  and quota notes; new Pin-to-dashboard mapping table and Custom KPI cards
  section (scope plumbing, local-only v1, `videosUploaded` caveat).
- `docs/04-Analytics Dashboard/05-Dashboard UI Components.md`:
  `VideoAnalyticsChart` gains a pin bullet (Videos → `video-performance`,
  Playlists → `playlist-performance` via `activeTab`).
- `docs/04-Analytics Dashboard/Analytics Dashboard.md`: composition list
  notes the chart header pin into My Dashboard.
- Install popup has no reference page, so the mobile CSS fix is logged only
  in `docs/context/2026-09-28-install-prompt-mobile.md`.

No other reference page enumerates the widget catalogue (verified by search),
so nothing else went stale.

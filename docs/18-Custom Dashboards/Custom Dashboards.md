# Custom Dashboards

`/my-dashboard` is a user-arranged dashboard: a drag-and-drop grid of reusable
widgets whose layout the user controls and the server persists.

## Source of truth

| Concern | File |
|---|---|
| Route | `backend/routes/customDashboards.js` |
| Service (read cache + upsert) | `backend/services/customDashboardService.js` |
| Layout sanitizer (server side) | `backend/utils/customDashboardPrefs.js` |
| Grid matrix math | `frontend/src/utils/dashboardLayoutMatrix.ts` |
| Client state hook | `frontend/src/pages/my-dashboard/useCustomDashboard.ts` |
| Client helpers | `frontend/src/pages/my-dashboard/customDashboardUtils.ts` |
| Custom-card definitions | `frontend/src/stores/customCardsStore.ts` |
| Custom-card builder + helpers | `frontend/src/pages/my-dashboard/components/CustomCardDialog.tsx`, `frontend/src/pages/my-dashboard/customKpiUtils.ts` |
| Pin-to-dashboard affordance | `frontend/src/components/dashboard/pin-to-dashboard/` |
| Grid + widgets | `frontend/src/pages/my-dashboard/components/` |
| Types | `frontend/src/types/customDashboard.ts` |
| Storage | `custom_dashboard_layouts` (migration `013_custom_dashboard_layouts.sql`) |

## Storage model

One row per `(owner_uid, org_id, name)`, enforced by a unique constraint.

- `org_id = ''` is the **personal** scope and is always allowed.
- A non-empty `org_id` is an **org** scope and requires membership, checked in the
  service layer (`assertScopeAccess`), not in the database.

`layout` is a JSONB 12-column grid matrix:

```json
{
  "cells": [{ "id": "channel-kpis", "x": 0, "y": 0, "w": 12, "h": 1 }],
  "hidden": ["goals"]
}
```

Cells outside that contract are rejected by the server-side sanitizer, so the table
never accumulates junk from a malformed client.

## Why Postgres and not Firestore

Layout saves are high-churn UI traffic. A drag causes a write. Firestore would mean a
read plus a write per drag, and the data is not really document-shaped. Postgres gives
an atomic upsert and a queryable matrix that can later back templates or sharing,
which the Firestore layout could not do without a collection redesign.

## Caching

Reads are cached under `customDash:{uid}:{scope}:{name}` with a 1-hour TTL
(`DASHBOARD_CACHE_TTL_MS`, deliberately shorter than the default since layouts change
far more often than most cached data). The write path is the only invalidator.

## Graceful degradation

If Postgres is not configured the service returns `{ supported: false }` rather than
erroring. The frontend reads that flag and falls back to a **local mirror** of the
layout so the page still works, it just does not persist across devices. A cache
failure is caught and the read falls through to Postgres rather than surfacing an
error.

## Endpoints

Both are behind `authenticateRequest` only. There is no quota or premium gate: this is
a pure preference store.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/custom-dashboards` | Returns `{ supported, layout }` |
| `PUT` | `/api/custom-dashboards` | Upserts the layout, returns the sanitized result |

## Widgets

Widgets live in `frontend/src/pages/my-dashboard/components/widgets/` and are reused
from existing surfaces rather than reimplemented. New catalogue entries appear
visible by default: `normalizeDbLayout` appends missing catalogue ids (unless
the user hid them), so shipping a widget is a registry + adapter change with no
backend work (the server sanitizer is id-agnostic).

| Widget | Id | Source of its data |
|---|---|---|
| `ChannelKpisWidget` | `channel-kpis` | Channel tab query (shared store) |
| `AudienceWidget` | `audience` | Audience tab query (shared store) |
| `GoalsWidget` | `goals` | Goals summary |
| `InsightsWidget` | `insights` | Insights tab query (self-managed) |
| `AnomaliesWidget` | `anomalies` | [Anomaly Detection](../15-Anomaly%20Detection/Anomaly%20Detection.md) (self-managed) |
| `VideoPerformanceWidget` | `video-performance` | Channel-wide `getDashboardBundle` (self-managed, 1 quota unit) |
| `PlaylistPerformanceWidget` | `playlist-performance` | `playlistViews` report + playlists catalog (self-managed, 1 quota unit) |
| `TopVideosWidget` | `top-videos` | Shared DB-backed videos catalog (no analytics quota) |
| `TopPlaylistsWidget` | `top-playlists` | Shared DB-backed playlists catalog (no analytics quota) |
| `CustomKpiWidget` | `custom:<slug>-<suffix>` | Channel multi-period stats (cache-shared with `channel-kpis`) |

Self-managed widgets mount only while visible, so hiding a widget also skips
its quota cost. The catalog widgets reuse the same React Query keys as
`/dashboard`, so a prior visit costs nothing extra. Widget spans live in
`CUSTOM_DASHBOARD_WIDGET_SPANS` (`full` = whole row, `half` = side-by-side).

Dragging is handled with `@dnd-kit` (core + sortable) for a true 2D grid, with
`@dnd-kit/utilities` for transform maths. `WidgetPicker` shows/hides/reorders
widgets, builds custom cards (`CustomCardDialog`) and deletes them;
`WidgetCard` is the chrome (drag handle + title + unpin), and `WidgetHost` is
the single mount point that resolves which widget a cell id refers to.

## Pin-to-dashboard

Source sections carry a pin icon that adds their widget to the active scope
(Personal or current organization) with one click — a second click removes it:

| Source section | Pinned widget |
|---|---|
| Channel tab header (`ChannelAnalyticsInsights`) | `channel-kpis` |
| Audience tab (`DimensionsPanel` via `headerActions`) | `audience` |
| Insights tab header (`InsightsPanel`) | `insights` |
| Goals page header | `goals` |
| Anomaly Detection shell actions | `anomalies` |
| Videos tab chart (`VideoAnalyticsChart`) | `video-performance` |
| Playlists tab chart (`VideoAnalyticsChart`) | `playlist-performance` |

The affordance lives in `frontend/src/components/dashboard/pin-to-dashboard/`
(`PinToDashboardButton` + `usePinToDashboard` + catalogue helpers). Table
sections deliberately have no pins: the shared `VideoTable`/`PlaylistTable`
stay dashboard-agnostic, and the ranking widgets are visible by default.

## Custom KPI cards

Users build their own tiles from any `dashboard:channelAnalytics` metric
(metric allowlist = that registry surface): `WidgetPicker` → **Custom card**
opens `CustomCardDialog` (name + metric + 7/30/90-day window, validated in
`customKpiUtils.ts`). Definitions (`{ id, label, metric, period }`) live in
`customCardsStore` (Zustand + immer, localStorage `revtube_custom_cards_v1`,
20 cards per scope); `CustomKpiWidget` renders them as shared `StatCard`
tiles with period deltas.

Scope plumbing: `customDashboardStore.knownIds` merges the scope's custom ids
(registry-only when scopeless), the API client merges all locally-known
custom ids on reads, and the grid drops `custom:*` cells with no local
definition — so a layout synced from another device never paints empty
shells. Definitions are **local-only in v1** (ids sync, defs don't); a
backend table is the follow-up if cross-device custom cards matter. The
`videosUploaded` metric reads `0` until the video catalog loads (same
flatten source as `channel-kpis`).

## Feature flag

The page is gated by the `customDashboard` feature-config key, which defaults to
enabled with unlimited limits (`-1`) in
[`config/featureConfig.js`](../../backend/config/featureConfig.js).

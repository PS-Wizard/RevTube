# 2026-09-28 — Channel analytics Tailwind migration + mobile graph sizing

Sources: `frontend/src/components/dashboard/ChannelAnalyticsInsights.tsx`, `frontend/src/components/dashboard/ChannelSeriesToggle.tsx` (new), `frontend/src/components/dashboard/ChannelInsightCard.tsx` (new), `frontend/src/components/dashboard/ChannelSparkline.tsx` (new) · verification: `tsc -b`, `eslint`, `design:lint`, `vitest` 271/271

## What changed

The Channel tab (`ChannelAnalyticsInsights`, ~1200 lines) styled its
channel-specific layer with page-scoped classes from `DashboardPage.css`
(series chips, insight cards, delta pills, sparklines, chart pane) while the
chart squeezed narrow on phones (dp-body 24px + pane 24px gutters on each
side left ~230px of plot on a 360px viewport).

- **Extracted parts** (dedup + decomposition): `ChannelSeriesToggle`
  (selection chip with series-color dot + check, replaced 3 copies),
  `ChannelInsightCard` (title + period badge + KPI value + deltas + media),
  `ChannelSparkline` (framed SVG + crosshair hover rects + pinned tooltip,
  line and bar modes). All Tailwind + shared `Button` (bare) only.
- **Inline Tailwind in the page**: delta pills/groups (success/danger
  surfaces preserved), toggles row, toolbar, trend section, summary grid
  (`grid-cols-1 sm:2 xl:4`, same breakpoints as the old CSS), chart empty
  state, skeleton, main-chart skeleton wrapper.
- **Kept shared shells untouched**: `content-section`, `dp-panel*`,
  `dp-body`, `seo-header-controls`, `seo-control-group` stay — they are the
  cross-panel ledger pattern shared with Audience/Insights/Video charts, and
  migrating one panel alone would break parity. Per-metric `*-card` /
  `*-line` data fields had no CSS behind them (line/bar colors already ride
  on SVG attributes, bars now take `fill` directly).
- **Mobile graphs**: the chart pane goes edge-to-edge under `sm:`
  (`-mx-6`, square edges, tighter padding), reclaiming ~48px of plot width;
  series chips get `40px` minimum touch targets; chart height stays 380 so
  nothing shrinks. No ECharts builder changes (axis fonts stay shared).

## Verify

- `tsc -b` clean · `eslint` clean on all touched/new files ·
  `design:lint` exit 0 · `vitest` **271/271 (41 files)**.
- Reference doc touched: `06-Frontend Architecture/05-Design Language.md`
  (`.channel-insight-*` no longer a styling location).

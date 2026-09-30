---
name: data-visualization
description: Recharts (and ECharts) charts for RevTube — time-series, tooltips, comparisons, retention, responsive charts. Use for any chart work in frontend/src/components/charts or pages.
---

# Data Visualization (RevTube)

Primary: **ECharts 6 via `src/components/evilcharts/` wrappers** (`EChartsLine/Area/Bar/Pie/ComposedChart`, `createCartesianChart`, `evilTokens`, `tooltipShellStyle`). No Recharts dependency — do not add it; extend the evilcharts wrapper instead.

## Standards

- Time-series: single date axis, tz-labeled; prior-period as dashed overlay, not a second chart. Comparison charts (Compare page) share y-domain or state the break explicitly.
- Tooltips: show exact value + date + delta; shared formatter with KPI/table (`utils/format*`). No raw floats.
- Retention graphs: percentage curves (0–100%), per-video; scalar fallback (avg%) when curve data missing.
- Responsive: fixed-height parent + ECharts `resize` handling in the wrapper (see `RtECharts.tsx`); charts never measure the window directly. Disable animation on large datasets / tables-adjacent charts.

## Performance

- Cap rendered points (~300): downsample server-side (PG aggregation) or bucket by day/week. Memoize chart data transforms; don't rebuild series per render.
- Lazy-load heavy chart types through the existing wrapper (`React.lazy` on the page, not inside evilcharts) — ECharts sits in the `vendor-utils` manualChunk (see `vite` skill). Never import `echarts/core` directly in pages; go through `evilcharts/` so chunking + tokens stay consistent.

## Data contract

- Charts consume Query-hook output shaped as `{ date, value, prior? }[]`. Null = gap in line, not zero. Backend zero-fill trap applies — preserve nulls end to end.

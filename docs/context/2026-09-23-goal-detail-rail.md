# 2026-09-23 — Goal detail: default series + progress rail layout

Sources: `frontend/src/pages/GoalDetailPage.tsx`

## Change
1. **Default series**: the trajectory chart now shows only Actual + Projected
   on load (`new Set(['actual', 'forecast'])`); Linear Pace, Adaptive
   Forecast, and Previous period stay one toggle-chip tap away.
2. **Layout**: the Performance Chart section is now a 12-col `Grid` — a 4/12
   progress rail on the left, the trajectory/checkpoint chart in 8/12 on the
   right (stacked rail-first on mobile). No new CSS; shared `Grid`/`Card`/
   `Stack`/`Flex`/`Typography`/`Progress` only.
3. **Progress rail** (friendly, different graph): an `EChartsPieChart` donut
   (Reached vs Remaining, center `% reached` overlay) plus Pace
   (Ahead/Behind · current/day), Projected vs target, Time used + elapsed
   bar, and required/day hint — all from existing computed values
   (`growthStats`, `velocityDelta`, `projectedOutcome`, `expectedPct`).
   Donut data is clamped + NaN-safe.

## Verify
- `tsc`: no new errors (unused-var count dropped 5→4 — `projectedOutcome`
  is now consumed by the rail). ESLint: 8 pre-existing unused-var errors
  (9 on HEAD).

## Update — rail padding + card design
`Card` only supplies vertical padding; content placed directly inside touches
the side edges. Rail rebuilt as a proper card: `CardHeader` (title + status
`Badge`: success/info/warning/error by goal status) + `CardDescription`
(day X of Y) + `CardContent` wrapping the donut and rows. Same `CardContent`
wrap applied to the Channel details/trailer/loading cards and the Optimized
toolbar/loading cards built earlier.

# 2026-09-23 — Audience insights: badges removed, app-palette colors

Sources: `frontend/src/components/dashboard/InsightsPanel.tsx`
(recommendation text itself comes from `backend/services/insightsService.js`)

## Change
1. **Recommendation badges removed**: all 5 `insight-pill--recommendation`
   pills deleted (Best Time to Post sentence badge, Best hour/time, Best day
   ×2, Peak). Every fact they carried already lives in the adjacent stat rows
   ("Best hour", "Peak hour", "Best day", "Peak views") and section
   descriptions — zero information loss. Unused `recommendation`
   destructure removed too.
2. **App-palette recolor** (was all blue-family): watch-time/peak energy
   indigo `#4f46e5` → amber `#d97706` (`--rt-color-warning`); retention +
   engagement cyan `#0891b2` → green `#059669` (`--rt-color-success`);
   medium-confidence indigo `#6366f1` → sky `#0ea5e9`; estimated-activity
   legend → orange `#f97316` (matches its heat ramp). Peak-hour red,
   gold reference, and green high-confidence untouched. Sections sharing the
   constants (dashboard Insights tab included) recolor consistently since
   they are the same components.

## Verify
- `tsc` + ESLint clean for `InsightsPanel`. No remaining
  `recommendation`/`insight-pill--recommendation` references in the tsx
  (CSS class left in place, now unused).

## Update — traffic-light verdict colors
Pros/cons rule applied page-wide (series keep identity colors; verdicts go
traffic-light):
- Confidence tiers: High green / Medium yellow / Exploratory red (constants
  + the Estimated section's inline badge; low-confidence notice stays
  amber-tinted as caution).
- Peak-hour bar + Best values (`insight-stat__value--highlight` → success
  token): green = best.
- Estimated-activity heat ramp: high green / medium yellow / lower neutral
  blue / zero gray; legend swatch green.
- Neutral series stay blue-family (views, counts) per the neutral rule.

## Update — design tokens instead of color hex
No hardcoded hex remains in `InsightsPanel.tsx` or `GoalDetailPage.tsx`
(outside documented fallbacks). ECharts paints on canvas and cannot read CSS
vars, so colors resolve live at render:
- New `useInsightPalette()` hook (`cssVar()` + `useEvilThemeKey`): all
  section components consume token-resolved colors and re-render on
  light/dark flips; config memos carry `palette` in deps.
- `GoalDetailPage` `SERIES_HEX` is now a reactive component memo (accent,
  warning, info, success, text-secondary, danger, border-strong, bg-muted
  tokens) feeding trajectory, subframe, donut, anomaly, and markLine paint;
  `CHANNEL_CHART_COLORS` import removed.

## Update — Weekly Audience Activity redesign
- Views bars now app-accent blue (neutral per scheme).
- New series: Subscribers gained bars (violet, right axis).
- Best-day bar highlighted green (best = good), dashed Avg markLine on
  views, clickable legend; tooltip formatter handles the new series with
  its own color/name (engagement breakdown sub-text preserved).
- Right Y axis is `["dataMin", "dataMax"]` so negative subscriber days
  render below zero; lost-subs bars paint red, gained violet.

## Update — Weekly legend isolated from shared sync group
Toggling Views in the Weekly legend also toggled series in the graphs above:
all charts share one ECharts hover-sync group, which relays legend selection
too. `EvilCartesianRootProps` gained an opt-in `syncGroup?: string | false`
(passthrough to `RtECharts`; default unchanged), and the Weekly chart uses a
unique `syncGroup="weekly-audience-activity"` so its legend stays local.

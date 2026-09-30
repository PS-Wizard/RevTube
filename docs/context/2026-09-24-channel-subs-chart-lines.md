# 2026-09-24 — Channel Analytics subscriber lines (daily net + cumulative)

Sources: `frontend/src/components/dashboard/ChannelAnalyticsInsights.tsx`,
`frontend/src/utils/chartTheme.ts`, `frontend/src/styles/design-tokens.css`

## Change
Channel Analytics main chart gains two plottable subscriber lines (chips only,
no new cards — headline cards unchanged):
- `Net subs/day` (`netSubscribers`): daily net = gained − lost per day.
  Goes negative on high-churn days.
- `Subs total` (`cumulativeSubscribers`): running total of daily net across
  the selected period (starts at 0 on day one of the range).
- Both derived client-side from the existing daily rows (no query/backend
  change); tooltips show raw (non-normalized) values via the existing
  `${key}_raw` path.
- Chips hidden when there is no subscriber activity at all (same gate as the
  existing Total Subscribers card).

## Negative-value handling
- Normalize mode previously scaled by series max, which would flip negative
  days positive. Now scales by largest absolute value (sign-preserving), and
  the Y domain widens from `[0, 100]` to `[-100, 100]` when any selected
  series dips below zero so dips stay visible.
- Raw (non-normalized) mode already auto-scales via ECharts; a `y: 0`
  markLine is drawn on the subs lines when negatives are present so the
  zero crossing is visible in both modes.
- New series colors: `--rt-chart-subs-net: #0f766e` (teal-dark),
  `--rt-chart-subs-total: #1d4ed8` (blue-dark), mirrored in
  `CHANNEL_CHART_COLORS` / `CHANNEL_CHART_SERIES`.

## Update — subs toggles grouped
- `Net subs/day` + `Subs total` chips now render immediately after the
  `Subs lost` chip (via `subsDerivedChips` injected in the `SERIES_METRICS`
  toggle map), so the toggle row reads Views, Subs gained, Subs lost,
  Net subs/day, Subs total, then the rest — no more derived subs lines
  dangling at the end.
- Fallback: when `subscribersLost` itself is hidden (e.g. gained-only
  activity) but derived lines are visible, the family renders right after
  the metric chips instead of vanishing.

## Update — toggles grouped by family
- `SERIES_METRICS` reordered so related toggles sit together: Views family
  (Views, Engaged views, Avg view dur, Viewer %, Watch time, Avg/Peak
  concurrent), then Subs family (Subs gained, Subs lost, Net subs/day,
  Subs total), then Likes, Comments, Card metrics, Uploads.
- Same order flows into the chart legend (via `cardConfigsForChart`).
  Card-grid visuals are unaffected (driven by the persisted/customizable
  layout order, not this array).

## Verify
- `tsc -b` clean; ESLint clean on both touched files (repo-wide `pnpm lint`
  still shows pre-existing set-state-in-effect errors elsewhere);
  `pnpm design:lint` clean; `vitest run`: 30 files / 198 tests pass;
  `pnpm build` succeeds.

# Goals & Forecasting (Velocity Tracking)

Real-time goal tracking for channels: views, subscribers, CTR, engagement rate, retention — with linear pacing, adaptive forecasting, baseline anchoring, and checkpoint milestones.

## Feature areas

| Area | Detail |
|---|---|
| Goal metrics | `views`, `subscribers`, `ctr`, `engagement_rate`, `retention` |
| Baselines | Views/Subs = **lifetime channel total**; % metrics = rate over a selectable lookback (7/14/30/90 days) |
| Graphs | Cumulative trajectory (Start → Target band), Checkpoints & Incremental Gain |
| Permissions | Personal: owner; Org: `owner`/`admin`/`write` only (`canManageGoals`) |

## Key rules baked into the implementation

1. **Baseline anchoring** — every trajectory line (linear pace, adaptive, forecast, actual) is anchored at the goal's initial current value, never absolute zero. The Y-axis domain is auto-fit to the plotted band (~5–8% padding), so a 3000→5000 goal fills the chart.
2. **YT metric groups** — Analytics rejects mixed metric groups in one `day` report. Baselines fetch only the group each metric needs (`baselineMetrics()` in `fetchGoalBaseline.ts`).
3. **Org tokens** — frontend falls back from personal OAuth tokens to Firebase `accessToken` + `X-Org-Id`; backend `resolveOrgToken` swaps in the org's YouTube token on `/dashboard/report`.
4. **Compounding** — backend `actualCumulative`/`projectedValue` are *window gains* for int metrics; the detail page offsets them by the lifetime baseline so KPIs and graphs read on the current→target scale.

Full architecture + data flow: [docs/14-Goals & Forecasting System/](./01-Goals & Forecasting)

4. **Compounding** — backend `actualCumulative`/`projectedValue` are *window gains* for int metrics; the detail page offsets them by the lifetime baseline so KPIs and graphs read on the current→target scale.

## Forecasting models (Goal Detail "Projected" curve)

The forecast is produced by a **hybrid** pipeline in `frontend/src/utils/forecasting/` (`forecastEngine.ts`, `forecastModels.ts`, `forecastBacktest.ts`). Three candidate models are always evaluated and the single best is drawn as one "Projected" line (never multiple curves):

| Model | What it does |
|---|---|
| **SMA (7-day moving average)** | Flat line = mean of last 7 points; the safe default when history is too short to backtest. |
| **Holt's linear (double exponential smoothing, α=0.3, β=0.1)** | Level + trend; captures sustained growth/decline. |
| **Linear regression (OLS)** | Best-fit straight line through the window. |

- **Selection** — `selectBestModel` holds out the last `min(7, 20%)` points, fits each candidate on the rest, and picks the lowest **MAE**; if the training set drops below 5 points it falls back to SMA with `low` confidence.
- **Confidence** — `MAE / seriesMean`: < 0.1 high, < 0.25 medium, else low; a series under 14 days is always low.
- **Preprocessing** — last 2 days stripped (`YT_ANALYTICS_LAG_DAYS`); outliers winsorized at ±3σ.
- **Metric-specific inputs** — views/subscribers are forecast in **daily-gain space** then re-cumulated; engagement/retention are forecast as levels; **CTR is not modeled** (`MetricNotAvailableError`) and always uses the velocity fallback.
- **Velocity fallback** — when no model runs, `dailyStep = (projectedValue − actualValue) / daysRemaining`, stepped per UTC day from the last actual. `projectedValue` comes from the backend's trailing-window anomaly-free daily-velocity baseline (`calculateAdaptiveBaseline` in `goalsService.js`).

Source: `frontend/src/utils/forecasting/{forecastEngine,forecastModels,forecastBacktest}.ts`, `frontend/src/pages/goals/GoalDetailPage.tsx` (`forecastInput`/`forecastByDate`).

## Files

- Backend: `backend/routes/goals.js`, `backend/services/goalsService.js`
- Frontend: `frontend/src/pages/goals/GoalDetailPage.tsx`, `frontend/src/pages/goals/GoalsPage.tsx`, `frontend/src/components/goals/*`
- Core logic: `frontend/src/utils/forecasting/{fetchGoalBaseline,forecastEngine,goalForecast}.ts`, `frontend/src/components/goals/milestones.ts`

## Tests

`pnpm vitest run src/utils/forecasting` — 20 tests covering metric-group selection, lifetime fallback for org channels, and range-aware % baselines.

# Goals & Forecasting System

Comprehensive reference for the goal tracking ("velocity") feature — baselines, forecasting, trajectory graphs, milestones, permissions, and known trade-offs.

Sources: [frontend/src/pages/GoalDetailPage.tsx](../../frontend/src/pages/goals/GoalDetailPage.tsx) [frontend/src/utils/forecasting/fetchGoalBaseline.ts](../../frontend/src/utils/forecasting/fetchGoalBaseline.ts) [backend/services/goalsService.js](../../backend/services/goalsService.js)

---

## 1. Overview

The Goals system lets a creator define targets (quarterly / yearly / weekly / 90-day) for five metrics and tracks real-time pacing against them:

| Metric | Type | Baseline definition |
|---|---|---|
| `views` | int, cumulative | **Channel lifetime views** (`statistics.viewCount`) |
| `subscribers` | int, cumulative | **Channel lifetime subs** (`statistics.subscriberCount`) |
| `ctr` | level % | Card click-through over selectable lookback (default 30d) |
| `engagement_rate` | level % | (likes+comments+shares)/views × 100 over lookback |
| `retention` | level % | View-weighted `averageViewPercentage` over lookback |

Two distinct metric kinds drive most behavior:

- **Cumulative/int metrics** (`views`, `subscribers`) — goals are *lifetime current → lifetime target* (e.g. 3000 → 5000). Gains are additive.
- **Level metrics** (`ctr`, `engagement_rate`, `retention`) — goals are *rate → rate*; actuals are levels, not sums.

## 2. Data model & backend

- Table `channel_goals` (Drizzle). Fields: `channelId`, `organizationId` (nullable), `metric`, `periodType`, `periodKey`, `startDate`, `endDate`, `targetValue`, `notes`, `createdBy`.
- **Routes** (`backend/routes/goals.js`): `GET /api/goals`, `GET /api/goals/summary`, `GET /api/goals/:id`, `POST`, `PUT /:id`, `DELETE /:id`. All mutations pass through `goalsService.canManageGoals(req.authUser, organizationId)`:
  - System admin (DB role `admin`) → allowed.
  - Personal context (no orgId) → allowed.
  - Org context → member role must be `owner`, `admin`, or `write`. Otherwise **403**.
- **Computed response** (`computeLinearPacing`): per-day `{ day, targetLinearExpected, actualCumulative }` where `actualCumulative` is the running gain **within the goal window starting from 0** (int metrics). Also: `progressPercentage`, `timeElapsedPercentage`, `pacingRatio`, `projectedValue`, velocities, status (`ahead/on_track/behind/met/missed/upcoming`), and `attachAdaptiveData()` (anomaly exclusion + adaptive projection).
- The backend works in *window-gain space* by design (matches YouTube Analytics daily rows). **Compounding to lifetime scale happens on the frontend** so historical window semantics remain untouched.

## 3. Baseline fetching — `fetchGoalBaseline.ts`

Single source for the goal's "current" value and history, used by both `CreateGoalModal` and `GoalDetailPage`.

### 3.1 Metric groups (YT Analytics constraint)

YouTube Analytics rejects *mixed* metric groups in a single `day` report with HTTP 400 ("The query is not supported") — e.g. `averageViewPercentage` (session group) combined with card metrics or the subscribers group. A failing combined report used to collapse the whole baseline to **0** (production bug: "Start from current (0)" / all-zero graphs). Fix: request only the group the selected metric needs via `baselineMetrics()`:

| Goal metric | Report metrics |
|---|---|
| `views` | `views` |
| `subscribers` | `subscribersGained,subscribersLost` |
| `engagement_rate` | `views,likes,comments,shares` |
| `retention` | `views,averageViewPercentage` |
| `ctr` | `cardImpressions,cardClicks` |

(Backend counterpart: `dashboardTabs.js` splits the same groups per report.)

### 3.2 Baseline definitions

- **Views / Subscribers** = channel's **lifetime total** from public YouTube statistics (`GET /api/channel/id/:id` → `statistics.viewCount` / `subscriberCount`). Falls back to the in-window daily sum when statistics are unavailable (e.g. hidden sub count). Snapshot carries `lifetime`.
- **CTR / Engagement / Retention** = rate over a **selectable lookback** (`rangeDays`, default 30; modal offers 7/14/30/90). Retention is view-weighted AVP; engagement is (likes+comments+shares)/views×100.

### 3.3 Org tokens

Callers resolve a token as `getValidToken(channelId) ?? accessToken`. For org channels the member has no personal OAuth token, so the Firebase access token + `X-Org-Id` header are used; backend `resolveOrgToken((req) => req.body?.channelId)` on `POST /dashboard/report` swaps in the org's stored YouTube token. Without this fallback org users saw `Start from current (0)`.

## 3.4 Forecasting models — `forecastEngine.ts` / `forecastModels.ts` / `forecastBacktest.ts`

The Goal Detail page's "Projected / Forecast" curve is produced by a **hybrid** pipeline: a statistical model when enough clean history exists, otherwise a velocity-based straight-line projection. The models live in `frontend/src/utils/forecasting/`.

### Model candidates

Three algorithms are always evaluated. **Only the winner is ever drawn** — the chart shows a single forecast line, not three.

| Model | Function | Behavior | Typical shape |
|---|---|---|---|
| **SMA (Simple Moving Average)** | `smaForecast` | Flat line equal to the mean of the last `n` points (`n = min(7, series.length)`). Used as the safe default when the series is too short to backtest. | Flat / horizontal |
| **Holt's linear (double exponential smoothing)** | `holtForecast` | Level + trend components (α = 0.3, β = 0.1). Captures sustained growth or decline. | Steady upward/downward slope |
| **Linear regression (OLS)** | `linearRegressionForecast` | Best-fit straight line (`y = a + b·x`) through the window. | Straight line through the trend |

### Selection — `selectBestModel` (backtest)

1. **Holdout**: the last `min(7, floor(20% of series))` points are set aside as the validation set.
2. If the remaining training set has `< 5` points, the model can't be evaluated → **SMA flat line, `low` confidence**.
3. Otherwise each candidate is fit on the training set and forecast over the holdout; the one with the **lowest Mean Absolute Error (MAE)** is chosen.
4. **Confidence** (`high`/`medium`/`low`) is derived from `MAE / seriesMean` (ratios < 0.1 → high, < 0.25 → medium, else low). A series shorter than 14 days is always `low`.

### Preprocessing (`seriesForMetric` + `winsorize`)

- The **last 2 days are stripped** (`YT_ANALYTICS_LAG_DAYS`) to account for YouTube Analytics ingest lag.
- Outliers are **winsorized** (capped at mean ± 3σ) so a single viral day can't skew the fit.
- **Cumulative metrics** (views, subscribers) are forecast in **daily-gain space** (stationary-ish differences), then re-cumulated onto the last actual point.
- **Level metrics** (engagement_rate, retention) are forecast directly as levels.
- **CTR is not modeled** by the statistical engine (`seriesForMetric('ctr')` throws `MetricNotAvailableError`), so it always falls through to the velocity projection below.

### Velocity fallback (always available)

When no statistical model runs (CTR, a goal with < 5 clean days, or 0 days remaining), `forecastByDate` builds a **straight-line probable forecast** from the backend's adaptive pacing:

```
dailyStep = (projectedValue − actualValue) / daysRemaining
projected[t] = lastActual + t · dailyStep
```

stepped forward UTC-day-by-day from the last observed actual. This guarantees the dashed "Projected" line renders in every active-goal scenario. (The computed `projectedValue` itself comes from the backend's **trailing-window daily-velocity** baseline, `calculateAdaptiveBaseline` in `goalsService.js` — the mean of anomaly-free daily gains over a trailing window, excluding detected anomalies ±1 day.)

### Curve behavior (does each model draw a different line?)

**No.** Only the single best model (by backtest MAE, or the velocity fallback) is plotted. You never see three overlapping forecast curves. Across *different* goals the winner may differ (one goal can drive Holt's rising slope, another a flat SMA), so the forecast shape varies between goals — but on any one chart there is exactly one "Projected" line, alongside the distinct linear-pace and adaptive-baseline lines.

## 4. Trajectory chart semantics — `GoalDetailPage.tsx`

### 4.1 Anchoring (`originBaseline` memo)

All projection lines are computed as `originBaseline + (target − originBaseline) × t`:

- Level metrics: anchor at first actual value / fetched baseline (`isLevelGoalMetric`).
- Views/Subs (`startFromCurrent` on): anchor at `goal.actualValue || baseline || 0` — i.e. the lifetime current (3000), never 0.
- Chart data seeded with a day-0 "Start" point at the initial value; vertical reference line labeled `Start: N` alongside the `Target: M` line.

### 4.2 Compounding window gains to lifetime scale

Backend returns **window gains** starting at 0 (`actualCumulative`, `projectedValue`). The detail page offsets them by `originBaseline` so everything reads on the current→target scale:

- `Actual Performance` = actualCumulative + baseline
- `Adaptive Forecast` / predicted values = + baseline
- Projected Outcome KPI = baseline + projected gain
- Milestones (`milestones.ts`): `cumulativeActual = rawGain + baseline`; per-frame period adds stay true gains (difference of consecutive compounded values). Level metrics get no offset (actuals are levels).

### 4.3 Axis & colors

- Cumulative chart Y domain auto-fits the plotted band (min of series _ 8% of range, max of target/actual + ~5%) no forced 0, so 3000->5000 fills the chart.
- Incremental-gain bar view still starts at 0 by design (bars encode period gains).
- Each series now has a **distinct design-token color** (previously `actual` and `forecast` both used `--rt-color-accent`, so the two curves were indistinguishable). The mapping lives in `SERIES_META` in `GoalDetailPage.tsx`:

| Series | Color | Style |
|---|---|---|
| Actual Performance | `--rt-color-accent` (blue) | solid Area, w2.5 |
| Projected (forecast) | `--rt-color-warning` (amber) | `6 3` dash, w2 |
| Linear Pace | `--rt-color-info` (purple) | `3 3` dash, w1.5 |
| Adaptive Forecast | `--rt-color-success` (green) | `5 5` dash, w2 |
| Same period last year | `--rt-color-text-secondary` (grey) | `2 6` dash, w1.5 |
| Baseline x factor | `--rt-color-info-emphasis` (violet) | `4 4` dash, w1 |

### 4.4 Chart controls (series toggles + frequency)

- A **custom hover tooltip** (`SeriesTooltip`) lists EVERY series present at the hovered point, each on its own row with a color swatch + label + value (the default chart tooltip only showed the nearest series). Nulls render as a dash.
- **Per-series toggles**: colored legend chips above the chart show/hide each series (`visibleSeries` state). At least one series stays visible; disabled chips are dimmed + struck-through.
- **Frequency selector**: Daily / Monthly / Quarterly buttons resample the rendered trajectory client-side. Long goals (> 180 days) default to **Monthly** automatically (auto-dropping density to keep the chart readable and cut rendered points). Monthly keeps the last row of each calendar month; quarterly keeps the last row of each calendar quarter; the day-0 Start anchor is always preserved.

### 4.5 Previous-calendar-year comparison

Same period last year now always begins at the **previous year Jan 1** (not just one year before the goal start) and accumulates through that year. The 730-day history window (`fetchGoalBaseline`) covers the full prior calendar year, so the prior-year Jan 1 starting value is the initial point and the line tracks through the comparable day in the comparable month a true full-year YoY overlay rather than a goal-window-shifted comparison.


## 5. Milestones & sub-frames — `milestones.ts`

Sub-frame granularity (days/weeks/months/quarters) over the main timeframe. Targets re-cumulate per frame via `deriveInitialTargets`/`recumulate` including the baseline when `startFromCurrent` is set. Used by GoalCard (default config, unaffected) and the detail-page checkpoint view.

## 6. Permissions

## 7. Files

| Layer | File | Role |
|---|---|---|
| Backend routes | `backend/routes/goals.js` | CRUD + permission guard wiring |
| Backend service | `backend/services/goalsService.js` | pacing computation, adaptive data, permissions |
| Frontend page | `frontend/src/pages/goals/GoalDetailPage.tsx` | trajectory charts, KPI compounding, axis domain |
| Frontend page | `frontend/src/pages/goals/GoalsPage.tsx` | list/filters/create entry |
| Components | `frontend/src/components/goals/{CreateGoalModal,GoalCard,milestones}.tsx` | form (baseline timeframe select, locked start-from-current for int metrics), cards, checkpoints |
| Core logic | `frontend/src/utils/forecasting/fetchGoalBaseline.ts` | baseline snapshot (metric groups, lifetime, range) |
| Core logic | `frontend/src/utils/forecasting/{forecastEngine,goalForecast}.ts` | adaptive forecast engine |

## 8. Tests

`frontend/src/utils/forecasting/*.test.ts` — 20 tests: metric-group selection per goal metric, lifetime totals for views/subs (incl. org-channel fallback), range-aware % baselines, forecast engine behavior. Run: `pnpm vitest run src/utils/forecasting`.

## 9. Known trade-offs

1. **CTR proxy** — CTR uses card impressions/clicks; channels without cards show 0.00%. Impression-based CTR isn't ingested yet (`forecastEngine` throws `MetricNotAvailableError('ctr')`).
2. **Zero-fill ambiguity** — DB zeros are indistinguishable from missing data (`Number(r.views || 0)`).
3. **Window-gain vs lifetime split** — backend intentionally stays in gain space; every consumer that displays lifetime scale must add the baseline. Forgetting this shows values from 0 (the original graph bug).
4. **Hidden subscriber counts** — statistics fallback keeps goals functional but "current" may be approximate for those channels.

| Context | Who can create/update/delete goals |
|---|---|
| Personal | Channel owner |
| Organization | Org role `owner` / `admin` / `write` |

Enforced twice: backend `goalsService.canManageGoals()` (403 otherwise, applied in `routes/goals.js` mutations) and frontend UI gating via `useOrganization().canEdit` (GoalsPage buttons, GoalCard edit/delete actions, GoalDetailPage actions). Read-only members see goals/graphs but never mutation controls.
- **Computed response** (`computeLinearPacing`): per-day `{ day, targetLinearExpected, actualCumulative }` where `actualCumulative` is the running gain **within the goal window starting from 0** (int metrics). Also: `progressPercentage`, `timeElapsedPercentage`, `pacingRatio`, `projectedValue`, velocities, status (`ahead/on_track/behind/met/missed/upcoming`), and `attachAdaptiveData()` (anomaly exclusion + adaptive projection).
- The backend works in *window-gain space* by design (matches YouTube Analytics daily rows). **Compounding to lifetime scale happens on the frontend** so historical window semantics remain untouched.

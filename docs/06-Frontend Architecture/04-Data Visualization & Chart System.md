## Data Visualization & Chart System

Relevant source files

-   [frontend/src/components/charts/RtECharts.tsx](../../frontend/src/components/charts/RtECharts.tsx)
-   [frontend/src/components/evilcharts/](../../frontend/src/components/evilcharts/)
-   [frontend/src/utils/chartRenderer.tsx](../../frontend/src/utils/chartRenderer.tsx)
-   [frontend/src/utils/chartTheme.ts](../../frontend/src/utils/chartTheme.ts)
-   [frontend/src/styles/design-tokens.css](../../frontend/src/styles/design-tokens.css)

> **Naming.** Two names appear in this area and they mean different things.
> **Apache ECharts 6** (`echarts` in `package.json`) is the rendering engine.
> **EvilCharts** is the in-repo provider layer in `components/evilcharts/` that
> wraps it. Pages use EvilCharts; only `RtECharts` and the provider itself import
> `echarts` directly.
>
> Some comments in `chartTheme.ts` and `RtECharts.tsx` still use the older
> charting vocabulary (e.g. the hover sync group is noted as replacing a former
> `syncId`). Those are comments only -- no second charting library is a
> dependency.

## Architecture

Three layers, and the boundary between them matters:

1. **`RtECharts` (`components/charts/RtECharts.tsx`)** is the only component that
   touches an ECharts instance. It owns init, dispose, resize and hover sync, and
   renders the shared toolbar. Feature code never calls `echarts.init` directly.
2. **EvilCharts (`components/evilcharts/`)** is a thin provider layer over
   `echarts/core` that registers renderers, supplies themed option defaults, and
   exposes the token bridge (`evilTokens`).
3. **`chartRenderer.tsx` / `chartTheme.ts`** build the option objects and shared
   layout constants. These are pure: data in, `EChartsCoreOption` out. That is
   what makes them unit-testable without a DOM.

Data flow: analytics hook -> `chartRenderer` builds an option -> `RtECharts`
receives `option` and applies it to the live instance.

## `RtECharts` props that matter

| Prop | Default | Notes |
|---|---|---|
| `option` | required | An `EChartsCoreOption` |
| `height` | `320` | Fixed pixel height; the host is a flex child |
| `renderer` | `canvas` | `svg` is opt-in. Canvas is the default for performance |
| `loading` / `empty` | `false` | Render loading and empty states in place of the chart |
| `emptyMessage` | `No data for this period.` | |
| `showToolbar` | `true` | PNG export via the chart dataURL, plus zoom reset |
| `syncGroup` | `EVIL_CHART_SYNC_GROUP` | Pass `false` to opt out of hover sync |
| `onEvents` / `onInit` | | Escape hatches for direct instance access |

### Lifecycle

- `echarts.init(host, null, { renderer })` on mount, `chart.dispose()` on unmount.
- A `ResizeObserver` on the host calls `chart.resize()`, so the chart follows its
  grid cell without a window resize listener.
- The **initial** option is captured in a ref, so a parent re-render does not
  re-apply the whole option and reset the user's zoom or pan.

## Hover sync

`EVIL_CHART_SYNC_GROUP = 'revtube-analytics'`. Charts passing a truthy
`syncGroup` set `chart.group` and call `echarts.connect(group)`, so hovering one
chart drives the crosshair on every other chart in the group. On unmount the
chart calls `echarts.disconnect(group)`.

A chart opts out with `syncGroup={false}`. This matters when a chart shows a
different time window than its neighbours, where syncing would mislead rather
than help.

## Theme tokens

Chart colors live in `design-tokens.css` as `--rt-chart-*` and reach ECharts
through `evilTokens`. `chartTheme.ts` keeps resolved hex values in sync with
those tokens **specifically because CSS variables fail inside SVG `<stop>`
elements** (gradient definitions). Use the resolved value where a color lands
in a gradient stop; prefer the token everywhere else.

### Shared layout constants (`chartTheme.ts`)

| Constant | Value |
|---|---|
| `CHART_MARGIN_DESKTOP` | `{ top: 14, right: 48, bottom: 28, left: 48 }` |
| `CHART_MARGIN_MOBILE` | `{ top: 16, right: 16, bottom: 24, left: 12 }` |
| `CHART_MARGIN_CLEAN` | `{ top: 18, right: 12, bottom: 24, left: 4 }` |
| `CHART_AXIS_PROPS` | Ledger style: no spine, no tick marks |
| `CHART_GRID_PROPS` | `4 4` dash, horizontal lines only |
| `TOOLTIP_CURSOR_AREA` | Dashed crosshair with a light fill band |
| `AREA_GRADIENT_OPACITY` | `{ top: 0.18, bottom: 0.02 }` |
| `CHART_AREA_CURVE` | `monotone` |
| `CHART_SYNC_ID` | `revtube-analytics` (kept for parity with the ECharts group name) |
| `getYAxisWidth()` | 34 on mobile, 44 otherwise |

`CHART_MARGIN_CLEAN` is tighter than `CHART_MARGIN_DESKTOP` because the ledger
axes have no spine, so the space a spine would occupy is reclaimed.
`getChartMargin()` picks between the clean and mobile variants with a 768px
`matchMedia` check.

`monotone` is chosen over `natural` for a concrete reason: `natural` overshoots
between points, which invents values that never existed. On a time series that
is a correctness problem, not only an aesthetic one.

## Sparklines

Sparklines in the video table and channel insight grids reuse the same color
tokens and the same `chartTheme` constants but drop the axes and grid to stay
dense. They render through the same `RtECharts` host with a minimal option
rather than a separate implementation, so a token change applies everywhere at
once.


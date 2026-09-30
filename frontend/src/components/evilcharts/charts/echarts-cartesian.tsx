/**
 * EvilCharts cartesian factory -- one declarative contract for Area / Line / Bar /
 * Composed charts, powered by Apache ECharts.
 *
 * Usage (mirrors https://evilcharts.com/docs/echarts/area-chart):
 *
 *   import { EChartsAreaChart } from '@/components/evilcharts/charts/echarts-area-chart';
 *   <EChartsAreaChart data={rows} config={chartConfig} xDataKey="date" height={340}>
 *     <EChartsAreaChart.Grid />
 *     <EChartsAreaChart.XAxis dataKey="date" tickFormatter={fmtDateShort} />
 *     <EChartsAreaChart.YAxis tickFormatter={(v) => v.toLocaleString()} />
 *     <EChartsAreaChart.Brush />
 *     <EChartsAreaChart.Legend isClickable />
 *     <EChartsAreaChart.Tooltip />
 *     <EChartsAreaChart.Area dataKey="views" markLine={[{ y: avg, label: 'Avg' }]} />
 *   </EChartsAreaChart>
 *
 * Interactions: axis tooltip, clickable legend, markLine/markPoint
 * annotations, per-datum bar colors, click-to-act points, PNG export + zoom reset
 * in the shadcn toolbar, and cross-chart hover sync via the shared group.
 * Zoom via mouse wheel / pinch directly on the plot (`<Brush/>`); no slider
 * footer is rendered.
 */
/* eslint-disable react-refresh/only-export-components -- factory module exporting chart namespaces */
import {
  Children,
  Fragment,
  isValidElement,
  useMemo,
  type FC,
  type ReactNode,
} from 'react';
import * as echarts from 'echarts/core';
import { LineChart, BarChart, type BarSeriesOption, type LineSeriesOption } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomInsideComponent,
  MarkLineComponent,
  MarkPointComponent,
} from 'echarts/components';
import type { EChartsCoreOption } from 'echarts/core';
import { RtECharts } from '@/components/charts/RtECharts';
import {
  evilTokens,
  fmtDateShort,
  fmtFull,
  seriesColor,
  seriesLabel,
  useEvilThemeKey,
  type ChartConfig,
  type EChartsRenderer,
  type EvilTokens,
} from '@/components/evilcharts/ui/echarts-chart';

echarts.use([
  LineChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomInsideComponent,
  MarkLineComponent,
  MarkPointComponent,
]);

export type CurveType = 'linear' | 'smooth' | 'monotone' | 'step';
export type StackType = 'default' | 'stacked' | 'expanded';

export interface EvilMarkLine {
  y?: number | string;
  x?: string | number;
  label?: string;
  color?: string;
  dashed?: boolean;
}

export interface EvilMarkPoint {
  x: string | number;
  y: number;
  label?: string;
  color?: string;
}

export type BarColorFn = (value: number, index: number, row: Record<string, unknown>) => string;

export interface EvilSeriesProps {
  dataKey: string;
  name?: string;
  color?: string;
  strokeWidth?: number;
  connectNulls?: boolean;
  showSymbol?: boolean;
  symbolSize?: number;
  dashed?: boolean | string;
  stack?: string;
  yAxisIndex?: number;
  markLine?: EvilMarkLine[];
  markPoint?: EvilMarkPoint[];
  /** Per-datum bar paint (tier colors, best-day highlight). String[] cycles; fn computes. */
  itemColors?: string[] | BarColorFn;
  barRadius?: number;
  opacity?: number;
  smooth?: boolean;
  /** Show data label above point/bar with white bg for readability on colored lines/bars */
  showLabel?: boolean;
  labelBackground?: string;
  children?: ReactNode;
}

export interface EvilXAxisProps {
  dataKey?: string;
  tickFormatter?: (value: string, index: number) => string;
  label?: string;
  hide?: boolean;
}

export interface EvilYAxisProps {
  tickFormatter?: (value: number, index: number) => string;
  label?: string;
  hide?: boolean;
  domain?: [number | string, number | string];
  yAxisId?: 'left' | 'right';
}

export interface EvilTooltipProps {
  formatter?: (
    rows: Array<{
      seriesKey: string;
      seriesName: string;
      color: string;
      value: unknown;
      row: Record<string, unknown>;
    }>,
    axisValue: string,
  ) => string;
}

export interface EvilLegendProps {
  align?: 'left' | 'center' | 'right';
  hide?: boolean;
  isClickable?: boolean;
}

export interface EvilBrushProps {
  height?: number;
}

export interface EvilCartesianRootProps<TData extends Record<string, unknown>> {
  data: TData[];
  config: ChartConfig;
  xDataKey?: keyof TData & string;
  height?: number;
  loading?: boolean;
  emptyMessage?: string;
  renderer?: EChartsRenderer;
  curveType?: CurveType;
  stackType?: StackType;
  showDataZoom?: boolean;
  showToolbar?: boolean;
  toolbarExtras?: ReactNode;
  title?: string;
  yTickFormatter?: (value: number, index: number) => string;
  xTickFormatter?: (value: string, index: number) => string;
  tooltipFormatter?: EvilTooltipProps['formatter'];
  onPointClick?: (info: {
    dataKey: string;
    dataIndex: number;
    row: Record<string, unknown>;
    event: unknown;
  }) => void;
  /** External series filter (shadcn chips): only listed keys render. Null = all. */
  selectedKeys?: string[] | null;
  /**
   * Hover/legend sync group. Defaults to the shared app group; pass a unique
   * id (or `false`) to keep a chart's legend toggles + hover sync local so
   * they can't leak into other charts on the page.
   */
  syncGroup?: string | false;
  animation?: boolean;
  className?: string;
  children?: ReactNode;
}

// ── Declarative parts (render nothing; the root reads their props) ──────────

function makeSeriesPart(): FC<EvilSeriesProps> {
  const Part: FC<EvilSeriesProps> = () => null;
  return Part;
}
function makeSlotPart<P extends object>(): FC<P> {
  const Part: FC<P> = () => null;
  return Part;
}

const AreaPart = makeSeriesPart();
const LinePart = makeSeriesPart();
const BarPart = makeSeriesPart();
const XAxisPart = makeSlotPart<EvilXAxisProps>();
const YAxisPart = makeSlotPart<EvilYAxisProps>();
const GridPart: FC = () => null;
const TooltipPart = makeSlotPart<EvilTooltipProps>();
const LegendPart = makeSlotPart<EvilLegendProps>();
const BrushPart = makeSlotPart<EvilBrushProps>();

type SeriesKind = 'area' | 'line' | 'bar';

interface CollectedSeries extends EvilSeriesProps {
  kind: SeriesKind;
}

interface Collected {
  series: CollectedSeries[];
  xAxis: (EvilXAxisProps & { present: boolean }) | null;
  yAxes: Array<EvilYAxisProps & { present: boolean }>;
  grid: boolean;
  tooltip: (EvilTooltipProps & { present: boolean }) | null;
  legend: (EvilLegendProps & { present: boolean }) | null;
  brush: (EvilBrushProps & { present: boolean }) | null;
}

function collect(children: ReactNode): Collected {
  const out: Collected = {
    series: [],
    xAxis: null,
    yAxes: [],
    grid: false,
    tooltip: null,
    legend: null,
    brush: null,
  };
  // Recurses into fragments: callers group series parts in <>...</> (e.g. the
  // compare line + main area), and a shallow pass would see only the fragment
  // element, find zero series, and force the "No data for this period." empty
  // state even with rows present. (Nested arrays are already flattened by
  // Children.forEach.)
  const visit = (node: ReactNode): void => {
    Children.forEach(node, (child) => {
      if (!isValidElement(child)) return;
      const { type, props } = child;
      if (type === Fragment) {
        visit((props as { children?: ReactNode }).children);
        return;
      }
      if (type === AreaPart) out.series.push({ ...(props as EvilSeriesProps), kind: 'area' });
      else if (type === LinePart) out.series.push({ ...(props as EvilSeriesProps), kind: 'line' });
      else if (type === BarPart) out.series.push({ ...(props as EvilSeriesProps), kind: 'bar' });
      else if (type === XAxisPart) out.xAxis = { ...(props as EvilXAxisProps), present: true };
      else if (type === YAxisPart) out.yAxes.push({ ...(props as EvilYAxisProps), present: true });
      else if (type === GridPart) out.grid = true;
      else if (type === TooltipPart) out.tooltip = { ...(props as EvilTooltipProps), present: true };
      else if (type === LegendPart) out.legend = { ...(props as EvilLegendProps), present: true };
      else if (type === BrushPart) out.brush = { ...(props as EvilBrushProps), present: true };
    });
  };
  visit(children);
  return out;
}

// ── Option builder ──────────────────────────────────────────────────────────

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function defaultTooltipHtml(
  rows: Array<{ seriesKey: string; seriesName: string; color: string; value: unknown }>,
  axisValue: string,
  tokens: EvilTokens,
): string {
  const label = axisValue;
  const body = rows
    .map(
      (r) => `<div style="display:flex;align-items:center;gap:8px;padding:1px 0;">` +
        `<span style="width:8px;height:8px;border-radius:2px;background:${r.color};flex-shrink:0;"></span>` +
        `<span style="color:${tokens.secondary};">${escapeHtml(r.seriesName)}</span>` +
        `<span style="margin-left:auto;padding-left:16px;font-weight:600;color:${tokens.text};font-variant-numeric:tabular-nums;">${escapeHtml(typeof r.value === 'number' ? fmtFull(r.value) : String(r.value ?? '—'))}</span>` +
        `</div>`,
    )
    .join('');
  return (
    `<div style="min-width:min(150px, calc(100vw - 48px));max-width:min(320px, calc(100vw - 32px));box-sizing:border-box;white-space:normal;overflow-wrap:break-word;border-radius:8px;border:1px solid ${tokens.border};` +
    `background:${tokens.card};box-shadow:0 4px 12px rgba(0,0,0,0.12);padding:8px 12px;` +
    `font-family:${tokens.fontFamily};font-size:12px;line-height:1.45;">` +
    `<div style="margin-bottom:6px;font-weight:600;color:${tokens.text};">${escapeHtml(label)}</div>${body}</div>`
  );
}

interface BuildArgs<TData extends Record<string, unknown>> {
  data: TData[];
  config: ChartConfig;
  collected: Collected;
  xKey: string;
  curveType: CurveType;
  stackType: StackType;
  selectedKeys: string[] | null;
  yTickFormatter?: (value: number, index: number) => string;
  xTickFormatter?: (value: string, index: number) => string;
  tooltipFormatter?: EvilTooltipProps['formatter'];
  showDataZoom: boolean;
  animation: boolean;
  tokens: EvilTokens;
}

/**
 * Pill label chrome shared by data labels and mark annotations: card
 * background, padding, and a hairline border so text stays readable where it
 * floats over gridlines or filled areas. Single source of truth — every label
 * in the cartesian factory spreads this.
 */
function pillLabel(tokens: EvilTokens) {
  return {
    backgroundColor: tokens.card,
    borderRadius: 4,
    padding: [2, 4] as [number, number],
    borderWidth: 0.5,
    borderColor: tokens.border,
    fontFamily: tokens.fontFamily,
  };
}

export function buildOption<TData extends Record<string, unknown>>(args: BuildArgs<TData>): EChartsCoreOption {
  const { data, config, collected, xKey, curveType, stackType, selectedKeys, tokens } = args;
  const dark = tokens.dark;
  const visible = collected.series.filter(
    (s) => !selectedKeys || selectedKeys.includes(s.dataKey),
  );
  const categories = data.map((row) => String(row[xKey] ?? ''));
  const isStacked = stackType === 'stacked' || stackType === 'expanded';
  const isExpanded = stackType === 'expanded';
  const hasBar = visible.some((s) => s.kind === 'bar');
  const smooth = curveType !== 'linear';
  const step = curveType === 'step' ? ('middle' as const) : false;

  // Expanded (100%) normalization per row.
  const rowTotals = isExpanded
    ? data.map((row) => visible.reduce((sum, s) => sum + (Number(row[s.dataKey]) || 0), 0))
    : [];

  const stackName = isStacked ? '__evil-total' : undefined;

  const series: Array<LineSeriesOption | BarSeriesOption> = visible.flatMap(
    (s, si): Array<LineSeriesOption | BarSeriesOption> => {
    const color = s.color ?? seriesColor(s.dataKey, config, dark, si);
    const name = s.name ?? seriesLabel(s.dataKey, config);
    const rawValues: Array<number | null> = data.map((row, i) => {
      const raw = row[s.dataKey];
      const isMissing = raw === null || raw === undefined || raw === '';
      let v: number | null = null;
      if (!isMissing) {
        const num = Number(raw);
        v = Number.isFinite(num) ? num : null;
      }
      if (isExpanded) {
        const total = rowTotals[i];
        const safe = v ?? 0;
        return total ? safe / total : 0;
      }
      return v;
    });
    const yAxisIndex = s.yAxisIndex ?? 0;

    const markLineData = (s.markLine ?? []).map((m) => ({
      ...(m.y !== undefined ? { yAxis: m.y } : { xAxis: m.x }),
      label: {
        show: !!m.label,
        formatter: m.label ?? '',
        color: m.color ?? tokens.tertiary,
        fontSize: 11,
        fontWeight: 600,
        ...pillLabel(tokens),
      },
      lineStyle: {
        color: m.color ?? tokens.borderStrong,
        type: (m.dashed === false ? 'solid' : 'dashed') as 'solid' | 'dashed',
        width: 1.5,
      },
    }));
    const markPointData = (s.markPoint ?? []).map((m) => ({
      name: m.label ?? '',
      coord: [String(m.x), m.y] as [string, number],
      value: m.label ?? '',
      itemStyle: { color: m.color ?? color, borderColor: tokens.card, borderWidth: 2 },
      label: { show: !!m.label, color: tokens.text, fontSize: 10, fontWeight: 700, offset: [0, -12], ...pillLabel(tokens) },
      symbolSize: 28,
    }));

    if (s.kind === 'bar') {
      // Precompute per-datum paint (tier colors, best-day highlight) instead of a
      // callback so the option stays serializable and strictly typed.
      const paintAt = (value: number, index: number): string => {
        if (typeof s.itemColors === 'function') {
          return s.itemColors(value, index, data[index] as Record<string, unknown>);
        }
        if (Array.isArray(s.itemColors)) return s.itemColors[index % s.itemColors.length];
        return color;
      };
      const radius = s.barRadius ?? 3;
      const whiteLabel: NonNullable<BarSeriesOption['label']> = s.showLabel
        ? {
            show: true,
            position: 'top' as const,
            distance: 6,
            color: tokens.text,
            fontSize: 11,
            fontWeight: 600,
            ...pillLabel(tokens),
            backgroundColor: s.labelBackground ?? tokens.card,
          }
        : { show: false };
      return [
        {
          id: s.dataKey,
          name,
          type: 'bar',
          data: rawValues.map((value, index) => ({
            value: value ?? 0,
            itemStyle: { color: paintAt(value ?? 0, index) },
          })),
          stack: s.stack ?? stackName,
          yAxisIndex,
          label: whiteLabel,
          itemStyle: {
            color,
            borderRadius: [radius, radius, 0, 0],
            opacity: s.opacity ?? 1,
          },
          emphasis: { focus: 'series' },
          markLine: markLineData.length ? { symbol: 'none', data: markLineData } : undefined,
          markPoint: markPointData.length ? { data: markPointData } : undefined,
        } satisfies BarSeriesOption,
      ];
    }

    // Line / area.
    const whiteLabelLine: NonNullable<LineSeriesOption['label']> = s.showLabel
      ? {
          show: true,
          position: 'top' as const,
          distance: 6,
          color: tokens.text,
          fontSize: 11,
          fontWeight: 600,
          ...pillLabel(tokens),
          backgroundColor: s.labelBackground ?? tokens.card,
        }
      : { show: false };
    return [
      {
          id: s.dataKey,
          name,
          type: 'line',
          data: rawValues as unknown as number[],
        stack: s.stack ?? stackName,
        yAxisIndex,
        smooth,
        step,
        connectNulls: s.connectNulls ?? false,
        showSymbol: s.showSymbol ?? false,
        symbolSize: s.symbolSize ?? 6,
        label: whiteLabelLine,
        lineStyle: {
          color,
          width: s.strokeWidth ?? 2,
          ...(s.dashed ? { type: 'dashed' as const } : {}),
          opacity: s.opacity ?? 1,
        },
        itemStyle: { color, borderColor: tokens.card, borderWidth: 2 },
        areaStyle:
          s.kind === 'area'
            ? {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                  { offset: 0, color },
                  { offset: 1, color },
                ]),
                opacity: 0.16,
              }
            : undefined,
        emphasis: { focus: 'series' },
        markLine: markLineData.length ? { symbol: 'none', data: markLineData } : undefined,
        markPoint: markPointData.length ? { data: markPointData } : undefined,
      } satisfies LineSeriesOption,
    ];
  });

  // Y axes (dual-axis when callers declare two <YAxis/> children).
  const ySlots: Array<EvilYAxisProps & { present: boolean }> = collected.yAxes.length
    ? collected.yAxes
    : [{ present: false }];
  const yAxis = ySlots.slice(0, 2).map((slot, i) => {
    const fmt =
      slot.tickFormatter ??
      args.yTickFormatter ??
      (isExpanded ? (v: number) => `${Math.round(v * 100)}%` : undefined);
    return {
      type: 'value' as const,
      show: !(slot.hide ?? false),
      position: (i === 1 ? 'right' : 'left') as 'left' | 'right',
      ...(slot.domain ? { min: slot.domain[0], max: slot.domain[1] } : {}),
      ...(isExpanded && !slot.domain ? { min: 0, max: 1 } : {}),
      name: slot.label,
      nameLocation: 'middle' as const,
      nameGap: 38,
      nameTextStyle: { color: tokens.tertiary, fontSize: 10 },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: tokens.border, type: [4, 4] as [number, number] } },
      axisLabel: {
        color: tokens.tertiary,
        fontSize: 11,
        fontFamily: tokens.fontFamily,
        ...(fmt ? { formatter: (v: number, idx: number) => fmt(v, idx) } : {}),
      },
    };
  });

  const xTick = collected.xAxis?.tickFormatter ?? args.xTickFormatter;
  const showXLabels = !(collected.xAxis?.hide ?? false);
  // No slider footer: zoom via mouse wheel / pinch directly on the plot
  // (`inside` dataZoom). <Brush/> / showDataZoom toggle it.
  const zoomOn = args.showDataZoom || !!collected.brush;

  return {
    animation: args.animation,
    animationDuration: 700,
    textStyle: { fontFamily: tokens.fontFamily },
    grid: {
      left: 8,
      right: 12,
      top: collected.legend && !collected.legend.hide ? 40 : 14,
      bottom: 8,
      // ECharts 6 removed `containLabel` (warns without the legacy compat
      // import). Documented equivalent of `containLabel: true`.
      outerBoundsMode: 'same',
      outerBoundsContain: 'axisLabel',
    },
    legend: {
      show: !!collected.legend && !collected.legend.hide,
      type: 'scroll',
      ...(collected.legend?.align === 'left'
        ? { left: 0, right: 'auto' }
        : collected.legend?.align === 'center'
          ? { left: 'center', right: 'auto' }
          : { left: 'auto', right: 0 }),
      top: 0,
      textStyle: { color: tokens.secondary, fontSize: 11, fontFamily: tokens.fontFamily },
      inactiveColor: tokens.tertiary,
      selectedMode: collected.legend?.isClickable === false ? false : true,
      ...(selectedKeys
        ? {
            selected: Object.fromEntries(
              visible.map((s) => [s.name ?? seriesLabel(s.dataKey, config), true]),
            ),
          }
        : {}),
    },
    tooltip: {
      show: !collected.tooltip || collected.tooltip.present,
      trigger: 'axis',
      backgroundColor: 'transparent',
      borderWidth: 0,
      padding: 0,
      // Keep the popup inside the chart card so spike/dip tooltips with long
      // driver-video titles never overflow the card, and paint above the
      // sticky dashboard tab rail when hovering points near the top of the graph.
      confine: true,
      extraCssText: 'z-index:var(--rt-chart-tooltip-z-index, 60);box-sizing:border-box;max-width:100%;',
      axisPointer: {
        type: 'line',
        lineStyle: { color: tokens.borderStrong, type: [4, 4] as [number, number], width: 1 },
      },
      formatter: (params: unknown) => {
        const list = (Array.isArray(params) ? params : [params]) as Array<{
          seriesId?: string;
          seriesName?: string;
          value?: number | string | null;
          color?: string;
          dataIndex?: number;
        }>;
        if (!list.length) return '';
        const axisValue = String(
          (list[0] as { axisValue?: unknown }).axisValue ?? categories[list[0]?.dataIndex ?? 0] ?? '',
        );
        const rows = list
          .filter((p) => p.value !== null && p.value !== undefined)
          .map((p) => {
            const key = String(p.seriesId ?? p.seriesName ?? '');
            const idx = typeof p.dataIndex === 'number' ? p.dataIndex : -1;
            return {
              seriesKey: key,
              seriesName: String(p.seriesName ?? key),
              color: String(p.color ?? tokens.accent),
              value: p.value,
              row: (idx >= 0 ? (data[idx] as Record<string, unknown>) : {}) ?? {},
            };
          });
        if (args.tooltipFormatter) return args.tooltipFormatter(rows, axisValue);
        return defaultTooltipHtml(rows, axisValue, tokens);
      },
    },
    xAxis: {
      type: 'category',
      data: categories,
      boundaryGap: hasBar,
      show: true,
      name: collected.xAxis?.label,
      nameLocation: 'middle',
      nameGap: 28,
      nameTextStyle: { color: tokens.tertiary, fontSize: 10 },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        show: showXLabels,
        color: tokens.tertiary,
        fontSize: 11,
        fontFamily: tokens.fontFamily,
        hideOverlap: true,
        formatter: xTick
          ? (v: string, i: number) => xTick(v, i)
          : (v: string) => (xKey === 'date' ? fmtDateShort(v) : v),
      },
    },
    yAxis,
    series,
    ...(zoomOn ? { dataZoom: [{ type: 'inside' as const }] } : {}),
  };
}

// ── Factory ─────────────────────────────────────────────────────────────────

export interface CartesianNamespace<TData extends Record<string, unknown>> {
  Root: FC<EvilCartesianRootProps<TData>>;
  Area: FC<EvilSeriesProps>;
  Line: FC<EvilSeriesProps>;
  Bar: FC<EvilSeriesProps>;
  XAxis: FC<EvilXAxisProps>;
  YAxis: FC<EvilYAxisProps>;
  Grid: FC;
  Tooltip: FC<EvilTooltipProps>;
  Legend: FC<EvilLegendProps>;
  Brush: FC<EvilBrushProps>;
}

export function createCartesianChart(displayName: string): CartesianNamespace<Record<string, unknown>> {
  function Root(props: EvilCartesianRootProps<Record<string, unknown>>) {
    const {
      data,
      config,
      xDataKey,
      height = 320,
      loading = false,
      emptyMessage = 'No data for this period.',
      renderer = 'canvas',
      curveType = 'smooth',
      stackType = 'default',
      showDataZoom = false,
      showToolbar = true,
      toolbarExtras,
      title,
      yTickFormatter,
      xTickFormatter,
      tooltipFormatter,
      onPointClick,
      selectedKeys = null,
      syncGroup,
      animation = true,
      className,
      children,
    } = props;

    const themeKey = useEvilThemeKey();
    const collected = useMemo(() => collect(children), [children]);
    const tokens = useMemo(() => evilTokens(), [themeKey]); // eslint-disable-line react-hooks/exhaustive-deps

    const xKey = useMemo(() => {
      if (xDataKey) return String(xDataKey);
      if (collected.xAxis?.dataKey) return collected.xAxis.dataKey;
      if (data.length) {
        const first = data[0];
        if (first && 'date' in first) return 'date';
        const keys = Object.keys(first ?? {});
        if (keys.length) return keys[0];
      }
      return 'date';
    }, [xDataKey, collected.xAxis, data]);

    const option = useMemo<EChartsCoreOption>(
      () =>
        buildOption({
          data,
          config,
          collected,
          xKey,
          curveType,
          stackType,
          selectedKeys,
          yTickFormatter,
          xTickFormatter,
          tooltipFormatter,
          showDataZoom,
          animation,
          tokens,
        }),
      // tokens identity changes on theme flip via themeKey memo above
      [data, config, collected, xKey, curveType, stackType, selectedKeys, yTickFormatter, xTickFormatter, tooltipFormatter, showDataZoom, animation, tokens],
    );

    const onEvents = useMemo(
      () =>
        onPointClick
          ? {
              click: (p: unknown) => {
                const params = p as { seriesId?: string; dataIndex?: number };
                const dataKey = String(params.seriesId ?? '');
                if (!dataKey || typeof params.dataIndex !== 'number') return;
                onPointClick({
                  dataKey,
                  dataIndex: params.dataIndex,
                  row: (data[params.dataIndex] ?? {}) as Record<string, unknown>,
                  event: p,
                });
              },
            }
          : undefined,
      [onPointClick, data],
    );

    const isEmpty = !loading && (!data || data.length === 0 || collected.series.length === 0);

    return (
      <RtECharts
        option={option}
        height={height}
        loading={loading}
        empty={isEmpty}
        emptyMessage={emptyMessage}
        renderer={renderer}
        title={title}
        showToolbar={showToolbar}
        toolbarExtras={toolbarExtras}
        onEvents={onEvents}
        className={className}
        syncGroup={syncGroup}
      />
    );
  }
  Root.displayName = displayName;

  return {
    Root,
    Area: AreaPart,
    Line: LinePart,
    Bar: BarPart,
    XAxis: XAxisPart,
    YAxis: YAxisPart,
    Grid: GridPart,
    Tooltip: TooltipPart,
    Legend: LegendPart,
    Brush: BrushPart,
  };
}

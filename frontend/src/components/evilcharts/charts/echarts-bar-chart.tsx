/**
 * EvilCharts ECharts Bar chart -- same declarative contract as the Area twin,
 * plus per-datum `itemColors` and dual-axis (`yAxisId="left" | "right"`).
 * @see ./echarts-cartesian.tsx for the full API.
 */
import { createCartesianChart } from './echarts-cartesian';

const ns = createCartesianChart('EChartsBarChart');

/** Bar chart root: `data` rows + `config` series colors. Canvas default, `renderer="svg"` opt-in. */
export const EChartsBarChart = Object.assign(ns.Root, {
  Area: ns.Area,
  Line: ns.Line,
  Bar: ns.Bar,
  XAxis: ns.XAxis,
  YAxis: ns.YAxis,
  Grid: ns.Grid,
  Tooltip: ns.Tooltip,
  Legend: ns.Legend,
  Brush: ns.Brush,
});

export type { ChartConfig, EChartsRenderer } from '../ui/echarts-chart';
export type { CurveType, StackType, EvilMarkLine, EvilMarkPoint, BarColorFn } from './echarts-cartesian';

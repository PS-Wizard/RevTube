/**
 * EvilCharts ECharts Composed chart -- mixed Area/Line/Bar series in one plot
 * (goal trajectories, dual-axis panels). Same contract as the Area twin.
 * @see ./echarts-cartesian.tsx for the full API.
 */
import { createCartesianChart } from './echarts-cartesian';

const ns = createCartesianChart('EChartsComposedChart');

/** Mixed-series root: combine `<Area/>`, `<Line/>`, `<Bar/>` children freely. */
export const EChartsComposedChart = Object.assign(ns.Root, {
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

/**
 * EvilCharts ECharts Line chart -- same declarative contract as the Area twin.
 * @see ./echarts-cartesian.tsx for the full API.
 */
import { createCartesianChart } from './echarts-cartesian';

const ns = createCartesianChart('EChartsLineChart');

/** Line chart root: `data` rows + `config` series colors. Canvas default, `renderer="svg"` opt-in. */
export const EChartsLineChart = Object.assign(ns.Root, {
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
export type { CurveType, StackType, EvilMarkLine, EvilMarkPoint } from './echarts-cartesian';

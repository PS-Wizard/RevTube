/**
 * EvilCharts ECharts Area chart -- `pnpm dlx shadcn@latest add @evilcharts/echarts-area-chart`
 * contract, RevTube-flavoured (design tokens + shadcn toolbar + cross-chart sync).
 * @see ./echarts-cartesian.tsx for the full declarative API.
 */
import { createCartesianChart } from './echarts-cartesian';

const ns = createCartesianChart('EChartsAreaChart');

/** Area chart root: `data` rows + `config` series colors. Canvas default, `renderer="svg"` opt-in. */
export const EChartsAreaChart = Object.assign(ns.Root, {
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

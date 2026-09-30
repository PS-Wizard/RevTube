/**
 * EvilCharts ECharts Pie/Donut chart -- `data` rows + `config` slice colors,
 * clickable scroll legend, rich token-styled tooltip, PNG export toolbar.
 */
import { useMemo, type ReactNode } from 'react';
import * as echarts from 'echarts/core';
import { PieChart } from 'echarts/charts';
import { TooltipComponent, LegendComponent } from 'echarts/components';
import type { EChartsCoreOption } from 'echarts/core';
import { RtECharts } from '@/components/charts/RtECharts';
import {
  evilTokens,
  fmtFull,
  seriesColor,
  useEvilThemeKey,
  type ChartConfig,
  type EChartsRenderer,
} from '@/components/evilcharts/ui/echarts-chart';

echarts.use([PieChart, TooltipComponent, LegendComponent]);

export interface EChartsPieChartProps<TData extends Record<string, unknown>> {
  data: TData[];
  config: ChartConfig;
  nameKey?: keyof TData & string;
  valueKey?: string;
  /** Donut hole ratio, e.g. "45%". Omit for a solid pie. */
  donut?: string;
  height?: number;
  loading?: boolean;
  emptyMessage?: string;
  renderer?: EChartsRenderer;
  title?: string;
  showToolbar?: boolean;
  toolbarExtras?: ReactNode;
  showLegend?: boolean;
  animation?: boolean;
  className?: string;
  onSliceClick?: (info: { name: string; value: number; dataIndex: number }) => void;
}

export function EChartsPieChart<TData extends Record<string, unknown>>({
  data,
  config,
  nameKey = 'name' as keyof TData & string,
  valueKey = 'value',
  donut = '45%',
  height = 280,
  loading = false,
  emptyMessage = 'No data for this period.',
  renderer = 'canvas',
  title,
  showToolbar = true,
  toolbarExtras,
  showLegend = true,
  animation = true,
  className,
  onSliceClick,
}: EChartsPieChartProps<TData>) {
  const themeKey = useEvilThemeKey();
  const tokens = useMemo(() => evilTokens(), [themeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const option = useMemo<EChartsCoreOption>(() => {
    const slices = data.map((row, i) => {
      const name = String(row[nameKey as string] ?? `Slice ${i + 1}`);
      // Slice color: config entry keyed by slice name, else rotation.
      const color = seriesColor(name, config, tokens.dark, i);
      return {
        name,
        value: Number(row[valueKey]) || 0,
        itemStyle: { color, borderColor: tokens.card, borderWidth: 2 },
      };
    });
    const total = slices.reduce((s, sl) => s + sl.value, 0);
    return {
      animation,
      animationDuration: 700,
      textStyle: { fontFamily: tokens.fontFamily },
      tooltip: {
        trigger: 'item',
        backgroundColor: 'transparent',
        borderWidth: 0,
        padding: 0,
        formatter: (p: unknown) => {
          const s = p as { name?: string; value?: number; color?: string };
          const pct = total ? ((Number(s.value) / total) * 100).toFixed(1) : '0.0';
          return (
            `<div style="min-width:140px;border-radius:8px;border:1px solid ${tokens.border};` +
            `background:${tokens.card};box-shadow:0 4px 12px rgba(0,0,0,0.12);padding:8px 12px;` +
            `font-family:${tokens.fontFamily};font-size:12px;">` +
            `<div style="display:flex;align-items:center;gap:8px;">` +
            `<span style="width:8px;height:8px;border-radius:2px;background:${s.color ?? tokens.accent};"></span>` +
            `<span style="color:${tokens.secondary};">${String(s.name ?? '')}</span>` +
            `<span style="margin-left:auto;padding-left:16px;font-weight:600;color:${tokens.text};">${fmtFull(Number(s.value))} · ${pct}%</span>` +
            `</div></div>`
          );
        },
      },
      legend: {
        show: showLegend,
        type: 'scroll',
        bottom: 0,
        textStyle: { color: tokens.secondary, fontSize: 11, fontFamily: tokens.fontFamily },
        inactiveColor: tokens.tertiary,
      },
      series: [
        {
          type: 'pie',
          radius: donut ? [donut, '75%'] : '75%',
          center: ['50%', showLegend ? '44%' : '50%'],
          data: slices,
          padAngle: 2,
          label: {
            color: tokens.tertiary,
            fontSize: 11,
            fontFamily: tokens.fontFamily,
            formatter: (p: { percent?: number }) => `${(p.percent ?? 0).toFixed(0)}%`,
          },
          labelLine: { lineStyle: { color: tokens.borderStrong } },
          emphasis: { scale: true, scaleSize: 6, focus: 'series' },
        },
      ],
    };
  }, [data, config, nameKey, valueKey, donut, showLegend, animation, tokens]);

  const onEvents = useMemo(
    () =>
      onSliceClick
        ? {
            click: (p: unknown) => {
              const s = p as { name?: string; value?: number; dataIndex?: number };
              onSliceClick({
                name: String(s.name ?? ''),
                value: Number(s.value ?? 0),
                dataIndex: s.dataIndex ?? -1,
              });
            },
          }
        : undefined,
    [onSliceClick],
  );

  return (
    <RtECharts
      option={option}
      height={height}
      loading={loading}
      empty={!loading && data.length === 0}
      emptyMessage={emptyMessage}
      renderer={renderer}
      title={title ?? 'Pie chart'}
      showToolbar={showToolbar}
      toolbarExtras={toolbarExtras}
      onEvents={onEvents}
      className={className}
    />
  );
}

export type { ChartConfig, EChartsRenderer } from '../ui/echarts-chart';

/**
 * RtECharts -- generic Apache ECharts host for RevTube (EvilCharts ECharts provider).
 *
 * Canvas by default, `renderer="svg"` opt-in. Handles init/dispose, resize,
 * cross-chart hover sync (group, like the old Recharts `syncId`), a shadcn
 * toolbar (PNG export via chart dataURL, zoom reset), loading + empty states.
 */
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import * as echarts from 'echarts/core';
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers';
import { Download, RotateCcw } from 'lucide-react';
import type { EChartsCoreOption } from 'echarts/core';
import { Button } from '@/components/ui/button';
import { VisuallyHidden } from '@/components/ui';
import { cn } from '@/lib/utils';
import { evilTokens, type EChartsRenderer } from '@/components/evilcharts/ui/echarts-chart';
import '../evilcharts/evilcharts.css';

echarts.use([CanvasRenderer, SVGRenderer]);

export type EChartsInstance = ReturnType<typeof echarts.init>;
export type { EChartsCoreOption };

/** Shared hover-sync group (replaces the old Recharts `syncId="revtube-analytics"`). */
export const EVIL_CHART_SYNC_GROUP = 'revtube-analytics';

export interface RtEChartsProps {
  option: EChartsCoreOption;
  height?: number;
  loading?: boolean;
  empty?: boolean;
  emptyMessage?: string;
  renderer?: EChartsRenderer;
  className?: string;
  style?: CSSProperties;
  title?: string;
  showToolbar?: boolean;
  toolbarExtras?: ReactNode;
  syncGroup?: string | false;
  animation?: boolean;
  onEvents?: Record<string, (params: unknown, chart: EChartsInstance) => void>;
  onInit?: (chart: EChartsInstance) => void;
}

export function RtECharts({
  option,
  height = 320,
  loading = false,
  empty = false,
  emptyMessage = 'No data for this period.',
  renderer = 'canvas',
  className,
  style,
  title,
  showToolbar = true,
  toolbarExtras,
  syncGroup = EVIL_CHART_SYNC_GROUP,
  onEvents,
  onInit,
}: RtEChartsProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsInstance | null>(null);
  const initialOptionRef = useRef<EChartsCoreOption>(option);
  const initRef = useRef(onInit);
  useEffect(() => {
    initRef.current = onInit;
  }, [onInit]);

  // Init / dispose / renderer switch.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const chart = echarts.init(host, null, { renderer });
    chartRef.current = chart;
    initialOptionRef.current = option;
    if (syncGroup) {
      chart.group = syncGroup;
      echarts.connect(syncGroup);
    }
    initRef.current?.(chart);

    const ro = new ResizeObserver(() => {
      chart.resize();
    });
    ro.observe(host);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
      if (syncGroup) echarts.disconnect(syncGroup);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderer]);

  // Push new options (theme flips rebuild `option` upstream via useEvilThemeKey).
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || chart.isDisposed()) return;
    chart.setOption(option, { notMerge: true });
  }, [option]);

  // Event bindings. Rebound whenever the chart is recreated (renderer switch),
  // and guarded so unmount/dispose ordering never touches a dead instance.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !onEvents || chart.isDisposed()) return;
    const bound = Object.entries(onEvents).map(([name, handler]) => {
      const fn = (p: unknown) => handler(p, chart);
      chart.on(name, fn as (params: unknown) => void);
      return [name, fn] as const;
    });
    return () => {
      if (chart.isDisposed()) return;
      bound.forEach(([name, fn]) => {
        chart.off(name, fn as (params: unknown) => void);
      });
    };
  }, [onEvents, renderer]);

  const handleDownloadPng = () => {
    const chart = chartRef.current;
    if (!chart || chart.isDisposed()) return;
    try {
      const tokens = evilTokens();
      const url = chart.getDataURL({
        type: 'png',
        pixelRatio: 2,
        backgroundColor: tokens.card,
      });
      const link = document.createElement('a');
      const safe = (title ?? 'chart').replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').slice(0, 60) || 'chart';
      link.download = `${safe}.png`;
      link.href = url;
      link.click();
    } catch (err) {
      console.error('[RtECharts] PNG export failed:', err);
    }
  };

  const handleResetZoom = () => {
    const chart = chartRef.current;
    if (!chart || chart.isDisposed()) return;
    chart.setOption(initialOptionRef.current, { notMerge: true });
  };

  const showToolbarRow = showToolbar && (toolbarExtras !== undefined && toolbarExtras !== null);

  return (
    <div className={cn('evil-chart', className)} style={style}>
      <div className="evil-chart__toolbar">
        {toolbarExtras}
        {showToolbarRow && (
          <>
            <Button variant="ghost" size="icon-xs" onClick={handleResetZoom} title="Reset zoom">
              <RotateCcw size={13} aria-hidden />
              <VisuallyHidden>Reset zoom</VisuallyHidden>
            </Button>
            <Button variant="ghost" size="icon-xs" onClick={handleDownloadPng} title="Download chart as PNG">
              <Download size={13} aria-hidden />
              <VisuallyHidden>Download PNG</VisuallyHidden>
            </Button>
          </>
        )}
      </div>
      <div className="evil-chart__body" style={{ height }}>
        <div ref={hostRef} style={{ width: '100%', height: '100%' }} role="img" aria-label={title ?? 'chart'} />
        {loading && <div className="evil-chart__overlay evil-chart__overlay--loading" aria-busy="true" aria-label="Loading chart" />}
        {!loading && empty && (
          <div className="evil-chart__overlay">
            <div className="evil-chart__empty">
              <span>{emptyMessage}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

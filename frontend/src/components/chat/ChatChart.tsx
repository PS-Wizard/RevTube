import { useCallback, useMemo, useRef, useState } from 'react';
import { Image as ImageIcon, Table } from 'lucide-react';
import { Button, Card, CardHeader, CardTitle, CardContent } from '../ui';
import { Box, Flex } from '../ui';
import { EChartsLineChart } from '../evilcharts/charts/echarts-line-chart';
import { EChartsAreaChart } from '../evilcharts/charts/echarts-area-chart';
import { EChartsBarChart } from '../evilcharts/charts/echarts-bar-chart';
import { EChartsPieChart } from '../evilcharts/charts/echarts-pie-chart';
import type { ChartConfig } from '../evilcharts/ui/echarts-chart';
import { tooltipShellStyle } from '../evilcharts/ui/echarts-chart';
import { MULTI_SERIES_FALLBACK_COLORS } from '../../utils/chartTheme';
import type { ChatChartSpec } from '../../hooks/useChat';

interface ChatChartProps {
  spec: ChatChartSpec;
}

/** Format a value for axis ticks -- compact for large numbers. */
const fmtTick = (val: unknown) => {
  const n = Number(val);
  if (!Number.isFinite(n)) return String(val ?? '');
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
};

/** Format a value for tooltips -- full locale string. */
const fmtValue = (val: unknown) => {
  const n = Number(val);
  if (!Number.isFinite(n)) return String(val ?? '');
  return n.toLocaleString();
};

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

type TooltipRow = {
  seriesKey: string;
  seriesName: string;
  color: string;
  value: unknown;
  row: Record<string, unknown>;
};

/** Axis tooltip content: label + one full-number row per series. */
const cartesianTooltip = (rows: TooltipRow[], axisValue: string): string => {
  const body = rows
    .map(
      (r) =>
        `<div style="display:flex;align-items:center;gap:8px;padding:1px 0;">` +
        `<span style="width:8px;height:8px;border-radius:2px;background:${r.color};flex-shrink:0;"></span>` +
        `<span>${escapeHtml(r.seriesName)}</span>` +
        `<span style="margin-left:auto;padding-left:16px;font-weight:600;font-variant-numeric:tabular-nums;">${escapeHtml(fmtValue(r.value))}</span>` +
        `</div>`,
    )
    .join('');
  return (
    `<div style="${tooltipShellStyle}">` +
    `<div style="margin-bottom:6px;font-weight:600;">${escapeHtml(axisValue)}</div>${body}</div>`
  );
};

export function ChatChart({ spec }: ChatChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);

  const { type, title, data, xKey, series, xAxisLabel, yAxisLabel } = spec;

  const labelKey = xKey || (type === 'pie' ? 'name' : undefined);

  /** ECharts config for cartesian charts: one entry per series. */
  const cartesianConfig = useMemo<ChartConfig>(() => {
    const cfg: ChartConfig = {};
    series.forEach((s, i) => {
      cfg[s.dataKey] = {
        label: s.name || s.dataKey,
        color: s.color || MULTI_SERIES_FALLBACK_COLORS[i % MULTI_SERIES_FALLBACK_COLORS.length],
      };
    });
    return cfg;
  }, [series]);

  /** ECharts config for pie: one entry per slice name. A series entry whose
   *  name matches the slice wins; otherwise the single series color applies
   *  to every slice (previous behavior), else the fallback rotation. */
  const pieConfig = useMemo<ChartConfig>(() => {
    const cfg: ChartConfig = {};
    data.forEach((row, i) => {
      const name = String(row.name ?? `Slice ${i + 1}`);
      if (!cfg[name]) {
        cfg[name] = {
          label: name,
          color:
            series.find((s) => s.name === name)?.color ??
            series[0]?.color ??
            MULTI_SERIES_FALLBACK_COLORS[i % MULTI_SERIES_FALLBACK_COLORS.length],
        };
      }
    });
    return cfg;
  }, [data, series]);

  /** Download the chart as a PNG image. */
  const handleDownloadPng = useCallback(async () => {
    const node = chartRef.current;
    if (!node) return;
    setDownloading(true);
    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(node, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
      });
      const link = document.createElement('a');
      const safeTitle = title.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').slice(0, 60) || 'chart';
      link.download = `${safeTitle}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('[ChatChart] PNG download failed:', err);
    } finally {
      setDownloading(false);
    }
  }, [title]);

  /** Detect a video ID key in the data rows (videoId or video_id). */
  const videoIdKey = (() => {
    if (!data.length) return null;
    const first = data[0];
    if (first && 'videoId' in first) return 'videoId';
    if (first && 'video_id' in first) return 'video_id';
    return null;
  })();

  /** Download the chart data as a CSV file. */
  const handleDownloadCsv = useCallback(() => {
    if (!data.length) return;
    const headers = Array.from(
      new Set(data.flatMap((row) => Object.keys(row))),
    );
    // Append a YouTube URL column when the data carries a video ID.
    const withUrl = videoIdKey !== null;
    const allHeaders = withUrl ? [...headers, 'YouTube URL'] : headers;
    const escape = (val: unknown) => {
      const s = String(val ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = [
      allHeaders.join(','),
      ...data.map((row) => {
        const cells = headers.map((h) => escape(row[h]));
        if (withUrl) {
          const id = row[videoIdKey];
          cells.push(escape(id ? `https://www.youtube.com/watch?v=${id}` : ''));
        }
        return cells.join(',');
      }),
    ];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeTitle = title.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').slice(0, 60) || 'chart';
    link.download = `${safeTitle}.csv`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  }, [data, title, videoIdKey]);

  const renderChart = () => {
    switch (type) {
      case 'line':
        return (
          <EChartsLineChart
            data={data}
            config={cartesianConfig}
            xDataKey={labelKey}
            height={260}
            title={title || xAxisLabel || yAxisLabel}
            showToolbar
            tooltipFormatter={cartesianTooltip}
          >
            <EChartsLineChart.Grid />
            {labelKey ? <EChartsLineChart.XAxis dataKey={labelKey} /> : null}
            <EChartsLineChart.YAxis tickFormatter={(v) => fmtTick(v)} />
            <EChartsLineChart.Legend isClickable />
            <EChartsLineChart.Tooltip />
            {series.map((s) => (
              <EChartsLineChart.Line key={s.dataKey} dataKey={s.dataKey} showSymbol={false} showLabel />
            ))}
          </EChartsLineChart>
        );

      case 'area':
        return (
          <EChartsAreaChart
            data={data}
            config={cartesianConfig}
            xDataKey={labelKey}
            height={260}
            title={title || xAxisLabel || yAxisLabel}
            showToolbar
            tooltipFormatter={cartesianTooltip}
          >
            <EChartsAreaChart.Grid />
            {labelKey ? <EChartsAreaChart.XAxis dataKey={labelKey} /> : null}
            <EChartsAreaChart.YAxis tickFormatter={(v) => fmtTick(v)} />
            <EChartsAreaChart.Legend isClickable />
            <EChartsAreaChart.Tooltip />
            {series.map((s) => (
              <EChartsAreaChart.Area key={s.dataKey} dataKey={s.dataKey} showSymbol={false} showLabel />
            ))}
          </EChartsAreaChart>
        );

      case 'bar':
        return (
          <EChartsBarChart
            data={data}
            config={cartesianConfig}
            xDataKey={labelKey}
            height={260}
            title={title || xAxisLabel || yAxisLabel}
            showToolbar
            tooltipFormatter={cartesianTooltip}
          >
            <EChartsBarChart.Grid />
            {labelKey ? <EChartsBarChart.XAxis dataKey={labelKey} /> : null}
            <EChartsBarChart.YAxis tickFormatter={(v) => fmtTick(v)} />
            <EChartsBarChart.Legend isClickable />
            <EChartsBarChart.Tooltip />
            {series.map((s) => (
              <EChartsBarChart.Bar key={s.dataKey} dataKey={s.dataKey} showLabel />
            ))}
          </EChartsBarChart>
        );

      case 'pie':
        return (
          <EChartsPieChart
            data={data}
            config={pieConfig}
            nameKey="name"
            valueKey="value"
            donut="50%"
            height={260}
            title={title}
            showToolbar
          />
        );

      default:
        return null;
    }
  };

  return (
    <Card size="sm" sx={{ my: 1.5, overflow: "hidden", minWidth: 0, width: "100%", background: "var(--card)" }}>
      <CardHeader
        sx={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1.5,
          borderBottom: "1px solid var(--border)",
          background: "var(--card)",
          py: 1.5,
        }}
      >
        <CardTitle sx={{ fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 }}>
          {title}
        </CardTitle>
        <Flex gap={1} sx={{ flexShrink: 0 }}>
          <Button variant="secondary" size="sm" onClick={handleDownloadPng} disabled={downloading} title="Download chart as PNG">
            <ImageIcon size={13} />
            {downloading ? "..." : "PNG"}
          </Button>
          <Button variant="secondary" size="sm" onClick={handleDownloadCsv} title="Download data as CSV">
            <Table size={13} />
            CSV
          </Button>
        </Flex>
      </CardHeader>
      <CardContent sx={{ px: 1, pt: 1.5, pb: 1, background: "var(--card)" }}>
        <Box ref={chartRef as any} sx={{ minHeight: 260, width: "100%", background: "var(--card)", borderRadius: 8 }}>
          {renderChart()}
        </Box>
      </CardContent>
    </Card>
  );
}

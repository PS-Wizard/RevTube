import { EChartsAreaChart } from '../components/evilcharts/charts/echarts-area-chart';
import { EChartsBarChart } from '../components/evilcharts/charts/echarts-bar-chart';
import type {
  EvilMarkLine,
  EvilMarkPoint,
} from '../components/evilcharts/charts/echarts-cartesian';
import type { ChartConfig as EvilChartConfig } from '../components/evilcharts/charts/echarts-area-chart';
import {
  CHANNEL_CHART_COLORS,
  TREND_COLOR_POSITIVE,
  VIDEO_CHART_COLORS,
} from './chartTheme';

export type ChartType = 'views' | 'subscribers' | 'subscribersGained' | 'subscribersLost' | 'watchTime' | 'retention' | 'ctr' | 'likes' | 'comments' | 'shares';

interface ChartConfig {
  title: string;
  dataKey: string;
  prevDataKey?: string;
  color: string;
  type: 'area' | 'bar';
  gradientId?: string;
}

export const chartConfigs: Record<ChartType, ChartConfig> = {
  views: {
    title: 'Views Over Time',
    dataKey: 'views',
    prevDataKey: 'prevViews',
    color: VIDEO_CHART_COLORS.views,
    type: 'area',
    gradientId: 'colorViews',
  },
  subscribers: {
    title: 'Net Subscribers',
    dataKey: 'subscribers',
    prevDataKey: 'prevSubscribers',
    color: VIDEO_CHART_COLORS.subscribers,
    type: 'area',
    gradientId: 'colorSubs',
  },
  subscribersGained: {
    title: 'Subscribers Gained',
    dataKey: 'subscribersGained',
    prevDataKey: 'prevSubscribersGained',
    color: VIDEO_CHART_COLORS.subscribersGained,
    type: 'area',
    gradientId: 'colorSubsGained',
  },
  subscribersLost: {
    title: 'Subscribers Lost',
    dataKey: 'subscribersLost',
    prevDataKey: 'prevSubscribersLost',
    color: VIDEO_CHART_COLORS.subscribersLost,
    type: 'area',
    gradientId: 'colorSubsLost',
  },
  likes: {
    title: 'Likes',
    dataKey: 'likes',
    prevDataKey: 'prevLikes',
    color: VIDEO_CHART_COLORS.likes,
    type: 'area',
    gradientId: 'colorLikes',
  },
  comments: {
    title: 'Comments',
    dataKey: 'comments',
    prevDataKey: 'prevComments',
    color: VIDEO_CHART_COLORS.comments,
    type: 'area',
    gradientId: 'colorComments',
  },
  shares: {
    title: 'Shares',
    dataKey: 'shares',
    prevDataKey: 'prevShares',
    color: VIDEO_CHART_COLORS.shares,
    type: 'area',
    gradientId: 'colorShares',
  },
  watchTime: {
    title: 'Watch Time (Minutes)',
    dataKey: 'minutesWatched',
    prevDataKey: 'prevMinutesWatched',
    color: VIDEO_CHART_COLORS.watchTime,
    type: 'area',
    gradientId: 'colorWatch',
  },
  retention: {
    title: 'Retention (Avg View %)',
    dataKey: 'retention',
    prevDataKey: 'prevRetention',
    color: VIDEO_CHART_COLORS.retention,
    type: 'area',
    gradientId: 'colorRetention',
  },
  ctr: {
    title: 'CTR (%)',
    dataKey: 'ctr',
    color: VIDEO_CHART_COLORS.ctr,
    type: 'area',
    gradientId: 'colorCTR',
  },
};

interface RenderChartProps {
  chartType: ChartType;
  data: Record<string, unknown>[];
  compareEnabled: boolean;
  height?: number;
  annotations?: { date: string; title: string; color: string }[];
  overrideColor?: string;
  multiSeriesData?: { name: string; dataKey: string; color: string; data?: Record<string, unknown>[] }[];
  onDismissAnomaly?: (date: string) => void;
}

/** De-emphasized neutral for the previous-period compare series (not a series color). */
const PREV_SERIES_COLOR = 'rgba(0,0,0,0.2)';

/** Anomaly dot colors — resolved from the shared theme, never hardcoded. */
const ANOMALY_SPIKE_COLOR = TREND_COLOR_POSITIVE;
const ANOMALY_DIP_COLOR = CHANNEL_CHART_COLORS.peakConcurrentViewers;

// ── Formatting helpers ──────────────────────────────────────
const fmtTick = (val: string) =>
  new Date(val).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

const fmtFull = (val: unknown): string => {
  if (typeof val !== 'string' || !val) return '—';
  const d = new Date(val.includes('T') ? val : `${val}T00:00:00`);
  if (Number.isNaN(d.getTime())) return val;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

const fmtNum = (val: unknown): string =>
  typeof val === 'number' ? val.toLocaleString() : '—';

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

interface TooltipRow {
  seriesKey: string;
  seriesName: string;
  color: string;
  value: unknown;
  row: Record<string, unknown>;
}

const TOOLTIP_SHELL =
  'min-width:min(180px, calc(100vw - 48px));max-width:min(300px, calc(100vw - 32px));box-sizing:border-box;white-space:normal;overflow-wrap:break-word;' +
  'border-radius:8px;border:1px solid var(--rt-color-border);' +
  'background:var(--rt-card-bg, var(--rt-color-bg-elevated));box-shadow:0 4px 12px rgba(0,0,0,0.12);' +
  'padding:8px 12px;font-family:var(--rt-font-sans);font-size:12px;line-height:1.45;color:var(--rt-color-text);';

const tooltipTitle = (title: string, date: string): string =>
  `<div style="margin-bottom:6px;font-weight:600;white-space:normal;overflow-wrap:anywhere;">${escapeHtml(title)}</div>` +
  `<div style="margin-bottom:6px;color:var(--rt-color-text-secondary);">${escapeHtml(date)}</div>`;

const tooltipRow = (dotColor: string, name: string, value: string, valueColor?: string): string =>
  `<div style="display:flex;align-items:center;gap:8px;padding:1px 0;">` +
  `<span style="width:8px;height:8px;border-radius:2px;background:${dotColor};flex-shrink:0;"></span>` +
  `<span style="color:var(--rt-color-text-secondary);">${escapeHtml(name)}</span>` +
  `<span style="margin-left:auto;padding-left:16px;font-weight:600;${valueColor ? `color:${valueColor};` : ''}font-variant-numeric:tabular-nums;">${escapeHtml(value)}</span>` +
  `</div>`;

/** Single-series tooltip: current + previous period + anomaly driver (was AnomalyChartTooltip). */
const makeAnomalyTooltip =
  (config: ChartConfig, compareEnabled: boolean) =>
  (rows: TooltipRow[], axisValue: string): string => {
    const row = rows[0]?.row ?? {};
    const current = rows.find(r => r.seriesKey === config.dataKey);
    const prev = config.prevDataKey ? rows.find(r => r.seriesKey === config.prevDataKey) : undefined;
    const prevDate = typeof row.prevDate === 'string' ? row.prevDate : undefined;

    let html =
      `<div style="${TOOLTIP_SHELL}">` +
      tooltipTitle(config.title, fmtFull(axisValue));

    if (current) {
      html += tooltipRow(config.color, 'Current', fmtNum(current.value), config.color);
    }
    if (compareEnabled && prev && prevDate) {
      html += tooltipRow(PREV_SERIES_COLOR, fmtFull(prevDate), fmtNum(prev.value));
    }

    const isViewsAnomaly = config.dataKey === 'views' &&
      (row.anomalyKind === 'spike' || row.anomalyKind === 'dip');
    if (isViewsAnomaly) {
      const isSpike = row.anomalyKind === 'spike';
      const pillColor = isSpike ? ANOMALY_SPIKE_COLOR : ANOMALY_DIP_COLOR;
      const delta = typeof row.anomalyDeltaViews === 'number'
        ? `${row.anomalyDeltaViews > 0 ? '+' : ''}${row.anomalyDeltaViews.toLocaleString()}`
        : 'N/A';
      html +=
        `<div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--rt-color-border);">` +
        `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">` +
        `<span style="color:var(--rt-color-text-tertiary);">Anomaly insight</span>` +
        `<span style="margin-left:auto;font-weight:700;color:${pillColor};">${isSpike ? 'Spike' : 'Dip'} ${escapeHtml(delta)}</span>` +
        `</div>`;

      const title = typeof row.anomalyTopVideoTitle === 'string' && row.anomalyTopVideoTitle
        ? row.anomalyTopVideoTitle
        : typeof row.anomalyTopVideoId === 'string' && row.anomalyTopVideoId
          ? row.anomalyTopVideoId
          : null;
      const driverDelta = typeof row.anomalyTopVideoDeltaViews === 'number'
        ? row.anomalyTopVideoDeltaViews
        : null;
      if (title || driverDelta !== null) {
        const pct = driverDelta !== null &&
          typeof row.anomalyDeltaViews === 'number' &&
          Math.abs(row.anomalyDeltaViews) > 0
          ? Math.round(Math.min(999, (Math.abs(driverDelta) / Math.abs(row.anomalyDeltaViews as number)) * 100))
          : null;
        html +=
          `<div style="color:var(--rt-color-text-tertiary);margin-bottom:2px;">Driver video</div>` +
          (typeof row.anomalyTopVideoThumbnailUrl === 'string' && row.anomalyTopVideoThumbnailUrl
            ? `<img src="${escapeHtml(row.anomalyTopVideoThumbnailUrl)}" alt="" style="display:block;width:100%;height:auto;border-radius:4px;margin-bottom:4px;" />`
            : '') +
          (title ? `<div style="font-weight:600;white-space:normal;overflow-wrap:anywhere;">${escapeHtml(title)}</div>` : '') +
          (driverDelta !== null
            ? `<div style="color:var(--rt-color-text-secondary);">Contribution ${driverDelta > 0 ? '+' : ''}${driverDelta.toLocaleString()}${pct !== null ? ` · ${pct}% of move` : ''}</div>`
            : `<div style="color:var(--rt-color-text-secondary);">Contribution N/A</div>`);
      } else {
        html += `<div style="color:var(--rt-color-text-tertiary);">No dominant driver video on this day.</div>`;
      }

     
      html += `</div>`;
    }

    return `${html}</div>`;
  };

/** Multi-series tooltip: one row per list, skipping zero values (was MultiSeriesChartTooltip). */
const makeMultiSeriesTooltip =
  (config: ChartConfig, series: { name: string; dataKey: string; color: string }[]) =>
  (rows: TooltipRow[], axisValue: string): string => {
    let html =
      `<div style="${TOOLTIP_SHELL}">` +
      tooltipTitle(config.title, fmtFull(axisValue));
    for (const s of series) {
      const entry = rows.find(r => r.seriesKey === s.dataKey);
      if (!entry || entry.value === 0) continue;
      html += tooltipRow(s.color, s.name, fmtNum(entry.value), s.color);
    }
    return `${html}</div>`;
  };

const toMarkLines = (
  annotations?: { date: string; title: string; color: string }[],
): EvilMarkLine[] | undefined =>
  annotations?.length
    ? annotations.map(a => ({ x: a.date, label: a.title, color: a.color }))
    : undefined;

/** Anomaly dots on the views chart → ECharts markPoints (spike ▲ / dip ▼). */
const buildAnomalyMarks = (data: Record<string, unknown>[], dataKey: string): EvilMarkPoint[] | undefined => {
  if (dataKey !== 'views') return undefined;
  const points: EvilMarkPoint[] = [];
  for (const row of data) {
    if (!row || (row.anomalyKind !== 'spike' && row.anomalyKind !== 'dip')) continue;
    if (typeof row.date !== 'string') continue;
    const y = Number(row[dataKey]);
    if (!Number.isFinite(y)) continue;
    const isSpike = row.anomalyKind === 'spike';
    points.push({
      x: row.date,
      y,
      label: isSpike ? '▲' : '▼',
      color: isSpike ? ANOMALY_SPIKE_COLOR : ANOMALY_DIP_COLOR,
    });
  }
  return points.length ? points : undefined;
};

interface PointClickInfo {
  dataKey: string;
  dataIndex: number;
  row: Record<string, unknown>;
  event: unknown;
}

/** Ctrl/Cmd-click an anomaly point to dismiss it (views chart only). */
const makePointClickHandler =
  (config: ChartConfig, onDismissAnomaly?: (date: string) => void) =>
  (info: PointClickInfo): void => {
    if (!onDismissAnomaly || config.dataKey !== 'views') return;
    const domEvent = (info.event as { event?: { ctrlKey?: boolean; metaKey?: boolean } } | null)?.event;
    if (!domEvent?.ctrlKey && !domEvent?.metaKey) return;
    const { row } = info;
    if ((row.anomalyKind === 'spike' || row.anomalyKind === 'dip') && typeof row.date === 'string') {
      onDismissAnomaly(row.date);
    }
  };

// ── Main render function ────────────────────────────────────
export const renderChart = ({ chartType, data, compareEnabled, height = 300, annotations, overrideColor, multiSeriesData, onDismissAnomaly }: RenderChartProps) => {
  const config = chartConfigs[chartType];
  const activeColor = overrideColor || config.color;

  const evilConfig: EvilChartConfig = multiSeriesData
    ? Object.fromEntries(
        multiSeriesData.map(s => [s.dataKey, { label: s.name, color: s.color }])
      )
    : {
        [config.dataKey]: { label: config.title, color: activeColor },
        ...(config.prevDataKey
          ? { [config.prevDataKey]: { label: `Previous ${config.title}`, color: PREV_SERIES_COLOR } }
          : {}),
      };

  const showPrev = compareEnabled && !!config.prevDataKey && !multiSeriesData;
  const markLine = toMarkLines(annotations);
  const markPoint = multiSeriesData ? undefined : buildAnomalyMarks(data, config.dataKey);
  const tooltipFormatter = multiSeriesData
    ? makeMultiSeriesTooltip(config, multiSeriesData)
    : makeAnomalyTooltip({ ...config, color: activeColor }, compareEnabled);
  const onPointClick = makePointClickHandler(config, onDismissAnomaly);

  if (config.type === 'area') {
    return (
      <EChartsAreaChart
        data={data}
        config={evilConfig}
        xDataKey="date"
        height={height}
        title={config.title}
        curveType="smooth"
        tooltipFormatter={tooltipFormatter}
        onPointClick={onPointClick}
        selectedKeys={null}
      >
        <EChartsAreaChart.Grid />
        <EChartsAreaChart.XAxis dataKey="date" tickFormatter={(v) => fmtTick(v)} />
        <EChartsAreaChart.YAxis tickFormatter={(v) => v.toLocaleString()} />
        <EChartsAreaChart.Brush />
        <EChartsAreaChart.Tooltip />
        {multiSeriesData ? (
          multiSeriesData.map((series) => (
            <EChartsAreaChart.Area key={series.dataKey} dataKey={series.dataKey} color={series.color} />
          ))
        ) : (
          <>
            {showPrev && config.prevDataKey && (
              <EChartsAreaChart.Line
                dataKey={config.prevDataKey}
                dashed
                color={PREV_SERIES_COLOR}
                showSymbol={false}
                connectNulls
              />
            )}
            <EChartsAreaChart.Area dataKey={config.dataKey} markLine={markLine} markPoint={markPoint} />
          </>
        )}
      </EChartsAreaChart>
    );
  }

  return (
    <EChartsBarChart
      data={data}
      config={evilConfig}
      xDataKey="date"
      height={height}
      title={config.title}
      tooltipFormatter={tooltipFormatter}
      onPointClick={onPointClick}
      selectedKeys={null}
    >
      <EChartsBarChart.Grid />
      <EChartsBarChart.XAxis dataKey="date" tickFormatter={(v) => fmtTick(v)} />
      <EChartsBarChart.YAxis tickFormatter={(v) => v.toLocaleString()} />
      <EChartsBarChart.Brush />
      <EChartsBarChart.Tooltip />
      {multiSeriesData ? (
        multiSeriesData.map((series) => (
          <EChartsBarChart.Bar key={series.dataKey} dataKey={series.dataKey} color={series.color} />
        ))
      ) : (
        <>
          {showPrev && config.prevDataKey && (
            <EChartsBarChart.Bar dataKey={config.prevDataKey} color={PREV_SERIES_COLOR} />
          )}
          <EChartsBarChart.Bar dataKey={config.dataKey} markLine={markLine} />
        </>
      )}
    </EChartsBarChart>
  );
};

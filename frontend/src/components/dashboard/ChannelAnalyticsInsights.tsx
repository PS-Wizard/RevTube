import React, { useMemo, useState } from 'react';
import type { Dayjs } from 'dayjs';
import { Skeleton } from '../Skeleton';
import { Button, Toggle } from '../ui';
import { TrueDeltaHelpButton } from './TrueDeltaHelpButton';
import { PinToDashboardButton } from './pin-to-dashboard';
import { SeriesToggleChip } from './ChannelSeriesToggle';
import { ChannelInsightCard } from './ChannelInsightCard';
import { ChannelSparkline } from './ChannelSparkline';
import { EChartsAreaChart } from '../evilcharts/charts/echarts-area-chart';
import {
  channelChartColor,
  CHANNEL_CHART_SERIES,
  type ChannelChartSeriesKey,
} from '../../utils/chartTheme';
import '../DimensionsPanel.css';
import { formatSeconds } from '../../utils/timeUtils';
import { normalizeLayout, orderedCardIds } from '../../utils/cardLayout';
import { useCardLayoutStore } from '../../stores/cardLayoutStore';
import { CHANNEL_ANALYTICS_CARD_SURFACE as CHANNEL_CARD_SURFACE } from '../../config/statCardRegistry';

export interface ChannelAnalyticsData {
  views: number;
  subscribersGained: number;
  subscribersLost: number;
  watchTime: number;
  likes: number;
  comments: number;
  videosUploaded: number;
  averageViewDuration: number;
  engagedViews: number;
  viewerPercentage: number;
  cardImpressions: number;
  cardClicks: number;
  cardClickRate: number;
  cardTeaserImpressions: number;
  cardTeaserClicks: number;
  cardTeaserClickRate: number;
  averageConcurrentViewers: number;
  peakConcurrentViewers: number;
}

interface MultiPeriodStat {
  current: Record<string, number>;
  previous: Record<string, number>;
}

interface ChannelAnalyticsInsightsProps {
  channelAnalyticsData: ChannelAnalyticsData;
  channelAnalyticsChartData: Array<{ [key: string]: string | number | undefined; date: string }>;
  channelMultiPeriodStats?: {
    d7?: MultiPeriodStat;
    d30?: MultiPeriodStat;
    d90?: MultiPeriodStat;
  } | null;
  channelAnalyticsPeriod: number | null;
  customStartDate: Dayjs | null;
  customEndDate: Dayjs | null;
  /** True while the main dashboard bundle / shared analytics gate is still loading. */
  bundleLoading: boolean;
  /** True while channel analytics report is loading (includes refetch when video catalog size changes). */
  loadingChannelAnalytics: boolean;
  /** True while the uploads playlist / video catalog request is in flight (counts may not match the new limit yet). */
  videosCatalogFetching?: boolean;
  trueDeltaEnabled: boolean;
  setTrueDeltaEnabled: (enabled: boolean) => void;
  channelTitle: string;
  formattedLatestDate: string | null;
  onDownloadChannelAnalytics: () => void;
  channelAnalyticsWidgetRef: React.RefObject<HTMLDivElement | null>;
}

type SeriesKey = ChannelChartSeriesKey;

const SERIES_METRICS: Array<{
  title: string;
  chipLabel: string;
  seriesKey: SeriesKey;
  sparkKey: string;
  metric: keyof ChannelAnalyticsData;
  prefix: string;
  cardClass: string;
  lineClass: string;
  seriesColor: string;
  format?: 'seconds' | 'percent';
  deltaInvert?: boolean;
}> = [
  {
    title: 'Total Views',
    chipLabel: 'Views',
    seriesKey: 'views',
    sparkKey: 'views',
    metric: 'views',
    prefix: '',
    cardClass: 'views-card',
    lineClass: 'views-line',
    seriesColor: CHANNEL_CHART_SERIES.views,
  },
  {
    title: 'Engaged Views',
    chipLabel: 'Engaged views',
    seriesKey: 'engagedViews',
    sparkKey: 'engagedViews',
    metric: 'engagedViews',
    prefix: '',
    cardClass: 'engagedviews-card',
    lineClass: 'engagedviews-line',
    seriesColor: CHANNEL_CHART_SERIES.engagedViews,
  },
  {
    title: 'Avg View Duration',
    chipLabel: 'Avg view dur',
    seriesKey: 'averageViewDuration',
    sparkKey: 'averageViewDuration',
    metric: 'averageViewDuration',
    prefix: '',
    cardClass: 'avgviewduration-card',
    lineClass: 'avgviewduration-line',
    seriesColor: CHANNEL_CHART_SERIES.averageViewDuration,
    format: 'seconds',
  },
  {
    title: 'Viewer %',
    chipLabel: 'Viewer %',
    seriesKey: 'viewerPercentage',
    sparkKey: 'viewerPercentage',
    metric: 'viewerPercentage',
    prefix: '',
    cardClass: 'viewerpct-card',
    lineClass: 'viewerpct-line',
    seriesColor: CHANNEL_CHART_SERIES.viewerPercentage,
    format: 'percent',
  },
  {
    title: 'Minutes Watched',
    chipLabel: 'Watch time',
    seriesKey: 'watchTime',
    sparkKey: 'watchTime',
    metric: 'watchTime',
    prefix: '',
    cardClass: 'watchtime-card',
    lineClass: 'watchtime-line',
    seriesColor: CHANNEL_CHART_SERIES.watchTime,
  },
  {
    title: 'Avg Concurrent',
    chipLabel: 'Avg concurrent',
    seriesKey: 'averageConcurrentViewers',
    sparkKey: 'averageConcurrentViewers',
    metric: 'averageConcurrentViewers',
    prefix: '',
    cardClass: 'avgconc-card',
    lineClass: 'avgconc-line',
    seriesColor: CHANNEL_CHART_SERIES.averageConcurrentViewers,
  },
  {
    title: 'Peak Concurrent',
    chipLabel: 'Peak concurrent',
    seriesKey: 'peakConcurrentViewers',
    sparkKey: 'peakConcurrentViewers',
    metric: 'peakConcurrentViewers',
    prefix: '',
    cardClass: 'peakconc-card',
    lineClass: 'peakconc-line',
    seriesColor: CHANNEL_CHART_SERIES.peakConcurrentViewers,
  },
  {
    title: 'Subscribers Gained',
    chipLabel: 'Subs gained',
    seriesKey: 'subscribersGained',
    sparkKey: 'subscribersGained',
    metric: 'subscribersGained',
    prefix: '+',
    cardClass: 'subscribers-gained-card',
    lineClass: 'subscribers-gained-line',
    seriesColor: CHANNEL_CHART_SERIES.subscribersGained,
  },
  {
    title: 'Subscribers Lost',
    chipLabel: 'Subs lost',
    seriesKey: 'subscribersLost',
    sparkKey: 'subscribersLost',
    metric: 'subscribersLost',
    prefix: '-',
    cardClass: 'subscribers-lost-card',
    lineClass: 'subscribers-lost-line',
    seriesColor: CHANNEL_CHART_SERIES.subscribersLost,
    deltaInvert: true,
  },
  {
    title: 'Likes',
    chipLabel: 'Likes',
    seriesKey: 'likes',
    sparkKey: 'likes',
    metric: 'likes',
    prefix: '',
    cardClass: 'likes-card',
    lineClass: 'likes-line',
    seriesColor: CHANNEL_CHART_SERIES.likes,
  },
  {
    title: 'Comments',
    chipLabel: 'Comments',
    seriesKey: 'comments',
    sparkKey: 'comments',
    metric: 'comments',
    prefix: '',
    cardClass: 'comments-card',
    lineClass: 'comments-line',
    seriesColor: CHANNEL_CHART_SERIES.comments,
  },
  {
    title: 'Card Impressions',
    chipLabel: 'Card impr',
    seriesKey: 'cardImpressions',
    sparkKey: 'cardImpressions',
    metric: 'cardImpressions',
    prefix: '',
    cardClass: 'cardimpr-card',
    lineClass: 'cardimpr-line',
    seriesColor: CHANNEL_CHART_SERIES.cardImpressions,
  },
  {
    title: 'Card Clicks',
    chipLabel: 'Card clicks',
    seriesKey: 'cardClicks',
    sparkKey: 'cardClicks',
    metric: 'cardClicks',
    prefix: '',
    cardClass: 'cardclicks-card',
    lineClass: 'cardclicks-line',
    seriesColor: CHANNEL_CHART_SERIES.cardClicks,
  },
  {
    title: 'Card Click Rate',
    chipLabel: 'Card CTR',
    seriesKey: 'cardClickRate',
    sparkKey: 'cardClickRate',
    metric: 'cardClickRate',
    prefix: '',
    cardClass: 'cardctr-card',
    lineClass: 'cardctr-line',
    seriesColor: CHANNEL_CHART_SERIES.cardClickRate,
    format: 'percent',
  },
  {
    title: 'Card Teaser Impr',
    chipLabel: 'Teaser impr',
    seriesKey: 'cardTeaserImpressions',
    sparkKey: 'cardTeaserImpressions',
    metric: 'cardTeaserImpressions',
    prefix: '',
    cardClass: 'cardteaserimpr-card',
    lineClass: 'cardteaserimpr-line',
    seriesColor: CHANNEL_CHART_SERIES.cardTeaserImpressions,
  },
  {
    title: 'Card Teaser Clicks',
    chipLabel: 'Teaser clicks',
    seriesKey: 'cardTeaserClicks',
    sparkKey: 'cardTeaserClicks',
    metric: 'cardTeaserClicks',
    prefix: '',
    cardClass: 'cardteaserclicks-card',
    lineClass: 'cardteaserclicks-line',
    seriesColor: CHANNEL_CHART_SERIES.cardTeaserClicks,
  },
  {
    title: 'Card Teaser CTR',
    chipLabel: 'Teaser CTR',
    seriesKey: 'cardTeaserClickRate',
    sparkKey: 'cardTeaserClickRate',
    metric: 'cardTeaserClickRate',
    prefix: '',
    cardClass: 'cardteaserctr-card',
    lineClass: 'cardteaserctr-line',
    seriesColor: CHANNEL_CHART_SERIES.cardTeaserClickRate,
    format: 'percent',
  },
];

const UPLOADS_METRIC = {
  title: 'Videos Uploaded',
  chipLabel: 'Uploads',
  seriesKey: 'videosUploaded' as const,
  metric: 'videosUploaded' as const,
  prefix: '',
  cardClass: 'uploads-card',
  seriesColor: CHANNEL_CHART_SERIES.videosUploaded,
};

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const calcDeltaPct = (curr: number, prev: number) => {  if (isNaN(curr) || isNaN(prev)) return null;
  if (prev === 0) {
    // No change when both periods are empty; growth from zero is not a real percentage.
    return curr === 0 ? 0 : null;
  }
  const pct = ((curr - prev) / prev) * 100;
  return isFinite(pct) ? pct : null;
};

const renderDelta = (pct: number | null, loading = false, invert = false) => {
  if (loading) {
    return <span className="inline-block h-4 w-12 animate-pulse rounded bg-[var(--rt-color-bg-muted)]" />;
  }
  if (pct === null || isNaN(pct)) return null;
  const isPositive = pct > 0;
  const isNegative = pct < 0;

  const toneClass = invert
    ? isPositive
      ? 'text-[var(--rt-color-danger)] bg-[var(--rt-color-danger-surface)]'
      : isNegative
        ? 'text-[var(--rt-color-success)] bg-[var(--rt-color-success-surface)]'
        : 'text-[var(--rt-color-text-tertiary)] bg-[var(--rt-color-bg-muted)]'
    : isPositive
      ? 'text-[var(--rt-color-success)] bg-[var(--rt-color-success-surface)]'
      : isNegative
        ? 'text-[var(--rt-color-danger)] bg-[var(--rt-color-danger-surface)]'
        : 'text-[var(--rt-color-text-tertiary)] bg-[var(--rt-color-bg-muted)]';
  return (
    <span className={`inline-flex w-fit items-center gap-[2px] rounded px-1.5 py-[2px] text-xs font-semibold tabular-nums ${toneClass}`}>
      {isPositive && <span aria-hidden>↑</span>}
      {isNegative && <span aria-hidden>↓</span>}
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
};

/** Catmull–Rom → cubic Bézier; handle scale < 1/6 tightens handles vs classic CR (less overshoot than /6, smoother than a polyline). */
const SPARKLINE_SPLINE_HANDLE = 1 / 10;

const pointsToSmoothPath = (pts: Array<{ x: number; y: number }>): string => {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  if (pts.length === 2) {
    return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
  }
  let d = '';
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) * SPARKLINE_SPLINE_HANDLE;
    const c1y = p1.y + (p2.y - p0.y) * SPARKLINE_SPLINE_HANDLE;
    const c2x = p2.x - (p3.x - p1.x) * SPARKLINE_SPLINE_HANDLE;
    const c2y = p2.y - (p3.y - p1.y) * SPARKLINE_SPLINE_HANDLE;
    if (i === 0) {
      d = `M ${p1.x} ${p1.y}`;
    }
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
};

const buildSparklineData = (
  data: Array<{ [key: string]: string | number | undefined; date: string }>,
  key: string
) => {
  if (!data.length)
    return {
      points: '',
      pathD: '',
      pointsData: [] as Array<{ x: number; y: number; date: string; value: number }>,
    };
  const values = data.map(d => Number(d[key] || 0));
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const denom = Math.max(values.length - 1, 1);

  const pointsData = data.map((d, i) => {
    const v = Number(d[key] || 0);
    const x = 2 + (i / denom) * 96;
    const y = 98 - ((v - min) / range) * 96;
    return { x, y, date: d.date, value: v };
  });

  return {
    points: pointsData.map(p => `${p.x},${p.y}`).join(' '),
    pathD: pointsToSmoothPath(pointsData),
    pointsData,
  };
};

const buildBarSeries = (data: Array<{ date: string; uploads?: number }>) => {
  if (!data.length) return [] as Array<{ x: number; y: number; w: number; h: number; date: string; value: number }>;
  const values = data.map(d => Number(d.uploads || 0));
  const max = Math.max(...values, 1);
  const count = values.length;
  const barW = Math.max(96 / Math.max(count * 2, 1), 0.8);
  return data.map((d, i) => {
    const v = Number(d.uploads || 0);
    const step = 96 / count;
    const x = 2 + i * step + (step - barW) / 2;
    const h = (v / max) * 96;
    const y = 98 - h;
    return { x, y, w: barW, h, date: d.date, value: v };
  });
};

interface HoveredPoint {
  x: number;
  y: number;
  date: string;
  value: string;
  cardId: string;
}

export function ChannelInsightGridSkeleton({ count = 7 }: { count?: number } = {}) {
  return (
    <>
      {Array.from({ length: Math.max(1, count) }).map((_, i) => (
        <article
          key={i}
          className="pointer-events-none rounded-[var(--rt-radius-lg)] border border-[var(--rt-color-border)] px-6 py-5"
          aria-busy="true"
          aria-label="Loading metric"
        >
          <div className="mb-2 flex min-w-0 flex-wrap items-center gap-1.5">
            <Skeleton type="text" width="48%" height="0.75rem" />
            <Skeleton type="text" width="3.5rem" height="0.65rem" style={{ borderRadius: 4 }} />
          </div>
          <Skeleton
            type="title"
            width="55%"
            height="1.65rem"
            style={{ marginTop: 4, marginBottom: '0.5rem' }}
          />
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Skeleton type="text" width="30%" height="0.6rem" />
            <Skeleton type="text" width="30%" height="0.6rem" />
            <Skeleton type="text" width="30%" height="0.6rem" />
          </div>
          <div className="h-32 w-full animate-pulse rounded-[var(--rt-radius-md)] bg-[var(--rt-color-bg-muted)]" aria-hidden />
        </article>
      ))}
    </>
  );
}

export const ChannelAnalyticsInsights: React.FC<ChannelAnalyticsInsightsProps> = ({
  channelAnalyticsData,
  channelAnalyticsChartData,
  channelMultiPeriodStats,
  channelAnalyticsPeriod,
  customStartDate,
  customEndDate,
  bundleLoading,
  loadingChannelAnalytics,
  videosCatalogFetching = false,
  trueDeltaEnabled,
  setTrueDeltaEnabled,
  channelTitle,
  formattedLatestDate,
  onDownloadChannelAnalytics,
  channelAnalyticsWidgetRef,
}) => {
  const [hoveredPoint, setHoveredPoint] = useState<HoveredPoint | null>(null);
  const [chartSeriesKeys, setChartSeriesKeys] = useState<Set<SeriesKey>>(() => new Set(['views']));
  const [normalizeChart, setNormalizeChart] = useState(true);
  const metricsLoadingCombined = bundleLoading || loadingChannelAnalytics;

  /** Catalog fetch touches upload counts; badge only keeps the grid visible like the video analytics overlay. */
  const showRefreshingBadge = metricsLoadingCombined || videosCatalogFetching;

  const periodBadgeLabel = useMemo(() => {
    if (customStartDate && customEndDate) {
      return `${customStartDate.format('MMM D')} – ${customEndDate.format('MMM D')}`;
    }
    if (channelAnalyticsPeriod !== null) {
      return `Last ${channelAnalyticsPeriod}d`;
    }
    return 'Last 30d';
  }, [customStartDate, customEndDate, channelAnalyticsPeriod]);

  /**
   * Net subscribers (gained − lost) over the selected range. Derived metric —
   * the headline comes from the overview totals, the sparkline from daily rows.
   */
  const netSubscribersTotal = useMemo(
    () =>
      Number(channelAnalyticsData?.subscribersGained || 0) -
      Number(channelAnalyticsData?.subscribersLost || 0),
    [channelAnalyticsData],
  );

  const netSubsChartData = useMemo(() => {
    const rows = channelAnalyticsChartData || [];
    return rows.reduce<Array<{ [key: string]: string | number | undefined; date: string }>>(
      (acc, row) => {
        const net = Number(row.subscribersGained || 0) - Number(row.subscribersLost || 0);
        const prevTotal = acc.length ? Number(acc[acc.length - 1].cumulativeSubscribers || 0) : 0;
        return [
          ...acc,
          {
            ...row,
            netSubscribers: net,
            cumulativeSubscribers: prevTotal + net,
          },
        ];
      },
      [],
    );
  }, [channelAnalyticsChartData]);

  const netSubsSpark = useMemo(
    () => buildSparklineData(netSubsChartData, 'netSubscribers'),
    [netSubsChartData],
  );

  /**
   * Derived subscriber lines available on the main chart (chips only, no cards):
   * - `netSubscribers`: daily net (gained − lost), can go negative on high-churn days.
   * - `cumulativeSubscribers`: running total of daily net across the period.
   */  const SUBS_DERIVED_SERIES: Array<{
    title: string;
    chipLabel: string;
    seriesKey: SeriesKey;
    seriesColor: string;
  }> = useMemo(
    () => [
      {
        title: 'Net subs / day',
        chipLabel: 'Net subs/day',
        seriesKey: 'netSubscribers',
        seriesColor: CHANNEL_CHART_SERIES.netSubscribers,
      },
      {
        title: 'Subs total (cumulative)',
        chipLabel: 'Subs total',
        seriesKey: 'cumulativeSubscribers',
        seriesColor: CHANNEL_CHART_SERIES.cumulativeSubscribers,
      },
    ],
    []
  );

  const cardConfigsForChart = useMemo(
    () => [
      ...SERIES_METRICS.map(m => ({
        title: m.chipLabel,
        key: m.seriesKey,
        color: channelChartColor(m.seriesKey),
      })),
      ...SUBS_DERIVED_SERIES.map(s => ({
        title: s.chipLabel,
        key: s.seriesKey,
        color: channelChartColor(s.seriesKey),
      })),
      {
        title: UPLOADS_METRIC.chipLabel,
        key: 'videosUploaded' as const,
        color: channelChartColor('videosUploaded'),
      },
    ],
    [SUBS_DERIVED_SERIES]
  );

  /**
   * Series whose data is entirely zero for the current period (headline value 0
   * AND no non-zero day in the chart rows). These are hidden from the insight
   * grid and their chips are removed from the main chart so the dashboard never
   * shows flat-line graphs for metrics YouTube has no data for.
   */
  const emptySeriesKeys = useMemo(() => {
    const empty = new Set<string>();
    if (metricsLoadingCombined) return empty;
    const rows = channelAnalyticsChartData || [];
    for (const m of SERIES_METRICS) {
      const headline = Number(channelAnalyticsData?.[m.metric] || 0);
      const hasDaily = rows.some(row => Number(row[m.sparkKey] || 0) > 0);
      if (headline === 0 && !hasDaily) empty.add(m.seriesKey);
    }
    const uploadsHeadline = Number(channelAnalyticsData?.videosUploaded || 0);
    const hasUploadDays = rows.some(row => Number(row.uploads || 0) > 0);
    if (uploadsHeadline === 0 && !hasUploadDays) empty.add('videosUploaded');
    // Net subscribers: hide only when there is no subscriber activity at all
    // (gained and lost both zero) — a net of 0 with real activity is meaningful.
    // Covers both the daily-net and the cumulative-total lines.
    const gainedHeadline = Number(channelAnalyticsData?.subscribersGained || 0);
    const lostHeadline = Number(channelAnalyticsData?.subscribersLost || 0);
    const hasSubsDaily = rows.some(
      row => Number(row.subscribersGained || 0) > 0 || Number(row.subscribersLost || 0) > 0,
    );
    if (gainedHeadline === 0 && lostHeadline === 0 && !hasSubsDaily) {
      empty.add('netSubscribers');
      empty.add('cumulativeSubscribers');
    }
    return empty;
  }, [metricsLoadingCombined, channelAnalyticsData, channelAnalyticsChartData]);

  /** Chips/cards actually rendered: everything except fully-empty series. */
  const visibleCardConfigs = useMemo(
    () => cardConfigsForChart.filter(c => !emptySeriesKeys.has(c.key)),
    [cardConfigsForChart, emptySeriesKeys]
  );

  /**
   * Card customization for this tab: user order/visibility layered on top of the
   * data-driven empty-series filter. `order` is applied via CSS `order` on the
   * grid items so the markup below stays readable and stable.
   */
  const cardLayout = useCardLayoutStore(state => state.layouts[CHANNEL_CARD_SURFACE]);
  const gridCardIds = useMemo(
    () => orderedCardIds(CHANNEL_CARD_SURFACE, cardLayout, emptySeriesKeys),
    [cardLayout, emptySeriesKeys]
  );
  const cardOrderIndex = useMemo(() => {
    const map = new Map<string, number>();
    gridCardIds.forEach((id, index) => map.set(id, index));
    return map;
  }, [gridCardIds]);
  /** Cards whose detail rows (90/30/7d deltas) the user turned off. */
  const compactCardIds = useMemo(
    () => new Set(normalizeLayout(CHANNEL_CARD_SURFACE, cardLayout).compact),
    [cardLayout]
  );

  /** Selected series minus any that turned empty (prevents orphaned flat lines). */
  const activeSeriesKeys = useMemo(
    () => new Set(Array.from(chartSeriesKeys).filter(key => !emptySeriesKeys.has(key))),
    [chartSeriesKeys, emptySeriesKeys]
  );

  const channelChartConfig = useMemo(() => {
    const cfg: Record<string, { label: string; color: string }> = {};
    for (const c of visibleCardConfigs) {
      if (activeSeriesKeys.has(c.key as SeriesKey)) {
        cfg[c.key] = { label: c.title, color: c.color };
      }
    }
    return cfg;
  }, [visibleCardConfigs, activeSeriesKeys]);

  const renderChannelThreeDeltas = (metric: keyof ChannelAnalyticsData, deltaInvert?: boolean) => (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      {([90, 30, 7] as const).map(d => {
        const key = `d${d}` as 'd7' | 'd30' | 'd90';
        const stat = channelMultiPeriodStats?.[key];
        const metricKey = metric as string;
        const pct = stat ? calcDeltaPct(stat.current?.[metricKey], stat.previous?.[metricKey]) : null;
        return (
          <span key={d} className="inline-flex items-center gap-[3px]">
            <span className={`text-[0.625rem] font-semibold tracking-[0.02em] ${channelAnalyticsPeriod === d ? 'font-bold text-[var(--rt-color-accent-hover)]' : 'text-[var(--rt-color-text-disabled)]'}`}>{`${d}d`}</span>
            {renderDelta(pct, metricsLoadingCombined, deltaInvert)}
          </span>
        );
      })}
    </span>
  );

  /** 90/30/7d deltas for the derived net-subscribers metric (gained − lost). */
  const renderNetSubsDeltas = () => (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      {([90, 30, 7] as const).map(d => {
        const key = `d${d}` as 'd7' | 'd30' | 'd90';
        const stat = channelMultiPeriodStats?.[key];
        const pct = stat
          ? calcDeltaPct(
              (stat.current?.subscribersGained ?? 0) - (stat.current?.subscribersLost ?? 0),
              (stat.previous?.subscribersGained ?? 0) - (stat.previous?.subscribersLost ?? 0),
            )
          : null;
        return (
          <span key={d} className="inline-flex items-center gap-[3px]">
            <span className={`text-[0.625rem] font-semibold tracking-[0.02em] ${channelAnalyticsPeriod === d ? 'font-bold text-[var(--rt-color-accent-hover)]' : 'text-[var(--rt-color-text-disabled)]'}`}>{`${d}d`}</span>
            {renderDelta(pct, metricsLoadingCombined)}
          </span>
        );
      })}
    </span>
  );

  const toggleSeries = (key: SeriesKey) => {
    setChartSeriesKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /**
   * Subscriber-family chips (net/day + cumulative). Rendered immediately after
   * the Subs-lost chip so all four subs toggles stay adjacent instead of the
   * derived lines dangling at the end of the toggle row.
   */
  const subsDerivedChips = SUBS_DERIVED_SERIES.filter(s => !emptySeriesKeys.has(s.seriesKey)).map(s => (
    <SeriesToggleChip
      key={s.seriesKey}
      active={chartSeriesKeys.has(s.seriesKey)}
      color={s.seriesColor}
      label={s.chipLabel}
      onToggle={() => toggleSeries(s.seriesKey)}
    />
  ));
  /** False when Subs-lost is hidden but derived subs lines are visible (e.g.
   * gained-only activity) — the family then renders after the metric chips. */
  const showSubsLostChip = !emptySeriesKeys.has('subscribersLost');

  return (
    <div className="content-section">
      <div className="dp-panel" ref={channelAnalyticsWidgetRef}>
        <div className="dp-panel-header">
          <div className="dp-panel-header-left">
            <span className="dp-panel-title">Channel Analytics</span>
            <span className="dp-panel-sub">
              {channelTitle || 'Overview'}
              {formattedLatestDate ? ` · As of ${formattedLatestDate}` : ''}
            </span>
          </div>

          <div className="dp-panel-header-right seo-header-controls">
            <PinToDashboardButton widgetId="channel-kpis" />
            {showRefreshingBadge && (
              <span className="seo-refreshing-badge">
                <span className="seo-refreshing-dot" />
                {videosCatalogFetching ? 'Loading videos' : bundleLoading ? 'Loading' : 'Updating'}
              </span>
            )}
            {channelAnalyticsPeriod === null && (
              <div className="seo-control-group">
                <div className="true-delta-label-area">
                  <span className="control-label">True Delta</span>
                  <TrueDeltaHelpButton />
                </div>
                <Toggle
                  checked={trueDeltaEnabled}
                  onChange={setTrueDeltaEnabled}
                  ariaLabel="Toggle true delta mode"
                />
              </div>
            )}

            <Button
              type="button"
              variant="secondary"
              size="sm"
             
              onClick={onDownloadChannelAnalytics}
              title="Download channel analytics as PNG"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" aria-hidden>
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
              PNG
            </Button>
          </div>
        </div>

        <div className="dp-body">
          <section className="min-w-0" aria-label="Channel metrics chart">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
              {!metricsLoadingCombined && (
                <div
                  className="mb-0 flex min-w-0 flex-1 basis-48 flex-wrap gap-2"
                  role="group"
                  aria-label="Metrics on chart"
                >
                  {SERIES_METRICS.filter(m => !emptySeriesKeys.has(m.seriesKey)).map(m => (
                    <React.Fragment key={m.seriesKey}>
                    <SeriesToggleChip
                      active={chartSeriesKeys.has(m.seriesKey)}
                      color={m.seriesColor}
                      label={m.chipLabel}
                      onToggle={() => toggleSeries(m.seriesKey)}
                    />
                    {m.seriesKey === 'subscribersLost' && subsDerivedChips}
                    </React.Fragment>
                  ))}
                  {!showSubsLostChip && subsDerivedChips}
                  {!emptySeriesKeys.has('videosUploaded') && (
                    <SeriesToggleChip
                      active={chartSeriesKeys.has('videosUploaded')}
                      color={UPLOADS_METRIC.seriesColor}
                      label={UPLOADS_METRIC.chipLabel}
                      onToggle={() => toggleSeries('videosUploaded')}
                    />
                  )}
                  {chartSeriesKeys.size > 0 && (
                    <Button
                      variant="ghost"
                      size="xs"
                      pill
                      onClick={() => setChartSeriesKeys(new Set())}
                      title="Deselect every metric"
                    >
                      Unselect all
                    </Button>
                  )}
                </div>
              )}
              <div className="mb-0 flex shrink-0 flex-wrap items-center justify-end gap-3">
                <div className="seo-control-group">
                  <span className="control-label">Normalize</span>
                  <Toggle
                    checked={normalizeChart}
                    onChange={setNormalizeChart}
                    disabled={metricsLoadingCombined}
                    ariaLabel="Scale each series to its own range as a percentage (negative values stay below zero)"
                  />
                </div>
              </div>
            </div>
            {metricsLoadingCombined ? (
              <Skeleton
                type="card"
                className="box-border w-full"
                height={360}
                style={{ width: '100%', borderRadius: 'var(--rt-radius-lg)' }}
              />
            ) : (
              <>
                {activeSeriesKeys.size === 0 ? (
                  <div className="rounded-[var(--rt-radius-lg)] border border-dashed border-[var(--rt-color-border-strong)] bg-[var(--rt-color-bg-subtle)] p-6 text-center">
                    <p className="m-0 text-sm text-[var(--rt-color-text-secondary)]">Select at least one metric to plot the chart.</p>
                  </div>
                ) : (
                  <div className="rounded-[var(--rt-radius-lg)] border border-[var(--rt-color-border)] bg-[var(--rt-color-bg-elevated)] p-2 sm:p-6 max-sm:-mx-6 max-sm:rounded-none max-sm:border-x-0">
                    <div className="relative min-w-0 w-full [-webkit-tap-highlight-color:transparent]">
                      {(() => {
                        // netSubsChartData = daily rows + derived net/cumulative subs fields,
                        // so subscriber lines resolve here without touching the query layer.
                        const base = netSubsChartData;
                        if (!base?.length) return null;

                        const readRaw = (row: { [key: string]: string | number | undefined }, key: string): number => {
                          if (key === 'videosUploaded' && row[key] === undefined) {
                            return Number(row.uploads || 0);
                          }
                          return Number(row[key] || 0);
                        };

                        const processedData = base.map(d => ({ ...d }));
                        const selectedKeys = Array.from(activeSeriesKeys);
                        let hasNegative = false;

                        if (normalizeChart) {
                          // Sign-preserving scale: divide by the largest absolute
                          // value so negative days stay below the zero line
                          // (plain max-scaling would flip negatives positive).
                          const scales: Record<string, number> = {};
                          for (const key of selectedKeys) {
                            let min = Infinity;
                            let max = -Infinity;
                            for (const row of base) {
                              const v = readRaw(row, key);
                              if (v < min) min = v;
                              if (v > max) max = v;
                            }
                            if (!Number.isFinite(min)) {
                              min = 0;
                              max = 0;
                            }
                            if (min < 0) hasNegative = true;
                            scales[key] = Math.max(Math.abs(min), Math.abs(max), 1);
                          }
                          for (const row of processedData) {
                            for (const key of selectedKeys) {
                              const rawVal = readRaw(row, key);
                              row[`${key}_raw`] = rawVal;
                              row[key] = (rawVal / scales[key]) * 100;
                            }
                          }
                        } else {
                          for (const row of processedData) {
                            for (const key of selectedKeys) {
                              const rawVal = readRaw(row, key);
                              if (rawVal < 0) hasNegative = true;
                              row[`${key}_raw`] = rawVal;
                            }
                          }
                        }
                        // Raw mode: ECharts auto-scales to include negatives.
                        // Normalized mode: widen to [-100, 100] when any selected
                        // series dips below zero so the dip stays visible.
                        const yDomain = normalizeChart
                          ? ((hasNegative ? [-100, 100] : [0, 100]) as [number, number])
                          : undefined;
                        const showZeroLine =
                          hasNegative &&
                          selectedKeys.some(k => k === 'netSubscribers' || k === 'cumulativeSubscribers');

                        return (
                          <EChartsAreaChart
                            data={processedData}
                            config={channelChartConfig}
                            xDataKey="date"
                            height={380}
                            title="Channel Analytics"
                            curveType="smooth"
                            selectedKeys={selectedKeys}
                            tooltipFormatter={(rows, axisValue) => {
                              const fullDate = new Date(
                                axisValue.includes('T') ? axisValue : `${axisValue}T00:00:00`,
                              ).toLocaleDateString(undefined, {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                              });
                              const body = rows
                                .map(r => {
                                  const raw = r.row[`${r.seriesKey}_raw`];
                                  const display =
                                    typeof raw === 'number'
                                      ? raw.toLocaleString()
                                      : typeof r.value === 'number'
                                        ? r.value.toLocaleString()
                                        : String(r.value ?? '—');
                                  return (
                                    `<div style="display:flex;align-items:center;gap:8px;padding:1px 0;">` +
                                    `<span style="width:8px;height:8px;border-radius:2px;background:${r.color};flex-shrink:0;"></span>` +
                                    `<span style="color:var(--rt-color-text-secondary);">${escapeHtml(r.seriesName)}</span>` +
                                    `<span style="margin-left:auto;padding-left:16px;font-weight:600;font-variant-numeric:tabular-nums;">${escapeHtml(display)}</span>` +
                                    `</div>`
                                  );
                                })
                                .join('');
                              return (
                                `<div style="min-width:150px;max-width:320px;border-radius:8px;border:1px solid var(--rt-color-border);` +
                                `background:var(--rt-card-bg, var(--rt-color-bg-elevated));box-shadow:0 4px 12px rgba(0,0,0,0.12);padding:8px 12px;` +
                                `font-family:var(--rt-font-sans);font-size:12px;line-height:1.45;color:var(--rt-color-text);">` +
                                `<div style="margin-bottom:6px;font-weight:600;">${escapeHtml(fullDate)}</div>${body}</div>`
                              );
                            }}
                          >
                            <EChartsAreaChart.Grid />
                            <EChartsAreaChart.XAxis
                              dataKey="date"
                              tickFormatter={val =>
                                new Date(val).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                              }
                            />
                            <EChartsAreaChart.YAxis
                              domain={yDomain}
                              tickFormatter={val => (normalizeChart ? `${Math.round(val)}%` : val.toLocaleString())}
                            />
                            <EChartsAreaChart.Brush />
                            <EChartsAreaChart.Legend isClickable />
                            <EChartsAreaChart.Tooltip />
                            {selectedKeys.map(key => (
                              <EChartsAreaChart.Area
                                key={key}
                                dataKey={key}
                                markLine={
                                  showZeroLine &&
                                  (key === 'netSubscribers' || key === 'cumulativeSubscribers')
                                    ? [{ y: 0 }]
                                    : undefined
                                }
                              />
                            ))}
                          </EChartsAreaChart>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </>
            )}
          </section>

          <section className="mt-6 border-t border-[var(--rt-color-border)] pt-5" aria-label="Channel metric rollups">
            <div className="grid grid-cols-1 gap-3 pb-6 sm:grid-cols-2 xl:grid-cols-4">
              {metricsLoadingCombined ? (
                <ChannelInsightGridSkeleton count={gridCardIds.length} />
              ) : (
                <>
                  {SERIES_METRICS.filter(({ seriesKey }) => cardOrderIndex.has(seriesKey)).map(({ title, sparkKey, metric, prefix, seriesColor, format, deltaInvert }) => {
                    const value = channelAnalyticsData[metric] || 0;
                    const displayValue =
                      format === 'seconds'
                        ? formatSeconds(value)
                        : format === 'percent'
                          ? `${value.toFixed(1)}%`
                          : metric === 'watchTime'
                            ? Math.round(value).toLocaleString()
                            : value.toLocaleString();
                    const { pathD, pointsData } = buildSparklineData(channelAnalyticsChartData, sparkKey);

                    return (
                      <ChannelInsightCard
                        key={sparkKey}
                        order={cardOrderIndex.get(sparkKey) ?? 0}
                        title={title}
                        periodLabel={periodBadgeLabel}
                        value={`${prefix}${displayValue}`}
                        deltas={!compactCardIds.has(sparkKey) && renderChannelThreeDeltas(metric, deltaInvert)}
                        media={
                          <ChannelSparkline
                            cardId={sparkKey}
                            title={`${title} over time`}
                            hoverTargets={pointsData.map(p => ({
                              x: p.x,
                              y: p.y,
                              date: p.date,
                              value: `${prefix}${p.value.toLocaleString()}`,
                            }))}
                            hovered={hoveredPoint}
                            onHover={setHoveredPoint}
                          >
                            {pathD ? (
                              <path
                                d={pathD}
                                fill="none"
                                stroke={seriesColor}
                                strokeWidth={2}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                style={{ vectorEffect: 'non-scaling-stroke' }}
                              />
                            ) : null}
                          </ChannelSparkline>
                        }
                      />
                    );
                  })}

                  {cardOrderIndex.has('netSubscribers') && (
                    <ChannelInsightCard
                      order={cardOrderIndex.get('netSubscribers') ?? 0}
                      title="Total Subscribers"
                      periodLabel={periodBadgeLabel}
                      value={`${netSubscribersTotal >= 0 ? '+' : ''}${netSubscribersTotal.toLocaleString()}`}
                      deltas={!compactCardIds.has('netSubscribers') && renderNetSubsDeltas()}
                      media={
                        <ChannelSparkline
                          cardId="netSubscribers"
                          title="Net subscribers over time"
                          hoverTargets={netSubsSpark.pointsData.map(p => ({
                            x: p.x,
                            y: p.y,
                            date: p.date,
                            value: `${p.value.toLocaleString()} net subs`,
                          }))}
                          hovered={hoveredPoint}
                          onHover={setHoveredPoint}
                        >
                          {netSubsSpark.pathD ? (
                            <path
                              d={netSubsSpark.pathD}
                              fill="none"
                              stroke={CHANNEL_CHART_SERIES.subscribersGained}
                              strokeWidth={2}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              style={{ vectorEffect: 'non-scaling-stroke' }}
                            />
                          ) : null}
                        </ChannelSparkline>
                      }
                    />
                  )}

                  {cardOrderIndex.has('videosUploaded') && (
                    <ChannelInsightCard
                      order={cardOrderIndex.get('videosUploaded') ?? 0}
                      title={UPLOADS_METRIC.title}
                      periodLabel={periodBadgeLabel}
                      value={(channelAnalyticsData?.videosUploaded || 0).toLocaleString()}
                      deltas={!compactCardIds.has('videosUploaded') && renderChannelThreeDeltas('videosUploaded')}
                      media={
                        <ChannelSparkline
                          cardId="uploads"
                          title="Uploads per day"
                          hoverTargets={buildBarSeries(channelAnalyticsChartData).map(bar => ({
                            x: bar.x + bar.w / 2,
                            y: bar.y,
                            date: bar.date,
                            value: `${bar.value} uploads`,
                          }))}
                          hovered={hoveredPoint}
                          onHover={setHoveredPoint}
                        >
                          {buildBarSeries(channelAnalyticsChartData).map((bar, i) => (
                            <rect
                              key={i}
                              x={bar.x}
                              y={bar.y}
                              width={bar.w}
                              height={bar.h}
                              rx="1.5"
                              ry="1.5"
                              fill={CHANNEL_CHART_SERIES.videosUploaded}
                            />
                          ))}
                        </ChannelSparkline>
                      }
                    />
                  )}
                 </>
               )}
             </div>
           </section>
        </div>
      </div>
    </div>
  );
};

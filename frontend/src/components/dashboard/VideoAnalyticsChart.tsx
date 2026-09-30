import type { Dayjs } from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { MdAddChart } from 'react-icons/md';
import { SkeletonSeoMetricPills, SkeletonSeoChart } from '../SkeletonLoaders';
import { renderChart } from '../../utils/chartRenderer';
import { TREND_COLOR_NEGATIVE, TREND_COLOR_NEUTRAL, TREND_COLOR_POSITIVE } from '../../utils/chartTheme';
import { Button, Toggle } from '../ui';
import { TrueDeltaHelpButton } from './TrueDeltaHelpButton';
import { PinToDashboardButton } from './pin-to-dashboard';
import { calcMetricDeltaPct, getMetricDeltaPct } from '../../utils/metricDeltaPct';
import type {
  ChannelInfo,
  ChartType,
  DashboardTab,
  MultiPeriodStats,
  PeriodData,
  VideoAnomalyInsight,
} from '../../types/dashboard';
import type { SavedList } from '../../services/savedListService';
import type { VideoMetadata } from '../../types/youtube';
import type { VideoChartPoint } from '../../utils/videoChartData';
import { selectVideoChartSeries } from '../../utils/videoChartData';

/** Daily subscriber-flow row powering the subscribersGained/Lost charts. */
interface ChannelSubscriberPoint {
  date: string;
  subscribersGained: number;
  subscribersLost: number;
  prevSubscribersGained: number;
  prevSubscribersLost: number;
  [key: string]: string | number;
}

/** Per-list series config for the multi-series overlay chart. */
export interface MultiSeriesConfig {
  name: string;
  color: string;
  viewsKey: string;
  watchTimeKey: string;
  retentionKey: string;
}

/** Multi-series dataset row: a date plus one metric column per active list. */
type MultiSeriesPoint = Record<string, string | number>;

/** Metric keys whose trend color can be derived from multi-period stats. */
type TrendMetricKey = 'views' | 'watchTime' | 'retention' | 'subscribersGained' | 'subscribersLost';

const TREND_METRIC_KEYS: Partial<Record<ChartType, TrendMetricKey>> = {
  views: 'views',
  watchTime: 'watchTime',
  retention: 'retention',
  subscribersGained: 'subscribersGained',
  subscribersLost: 'subscribersLost',
};

/**
 * Reads a metric off a PeriodData side without assuming the key exists
 * (subscribersGained/subscribersLost are absent from the shared PeriodData).
 */
const readPeriodMetric = (side: PeriodData | undefined, key: TrendMetricKey): number | undefined => {
  if (!side) return undefined;
  const raw = (side as Partial<Record<TrendMetricKey, unknown>>)[key];
  return typeof raw === 'number' ? raw : undefined;
};

interface VideoAnalyticsChartProps {
  // Header props
  selectedVideo: VideoMetadata | null;
  activeLists: SavedList[];
  channels: ChannelInfo[];
  selectedChannel: string | null;
  formattedLatestDate: string | null;
  loading: boolean;
  hasLoadedOnce: boolean;
  isRefreshing?: boolean;
  
  // Control props
  handleDownloadChart: () => void;
  showAnnotations: boolean;
  setShowAnnotations: (show: boolean) => void;
  trueDeltaEnabled: boolean;
  setTrueDeltaEnabled: (enabled: boolean) => void;
  compareEnabled: boolean;
  setCompareEnabled: (enabled: boolean) => void;
  
  // Chart state props
  activeChart: ChartType;
  setActiveChart: (chart: ChartType) => void;
  period: 7 | 30 | 90 | null;
  customStartDate: Dayjs | null;
  customEndDate: Dayjs | null;
  
  // Data props
  chartData: VideoChartPoint[];
  multiPeriodStats?: MultiPeriodStats | null;
  videoStats: {
    views: number;
    watchTime: number;
    retention: number;
    prevViews?: number;
    prevWatchTime?: number;
    prevRetention?: number;
  };
  videoAnomalyInsights?: VideoAnomalyInsight[];
  
  // Loading props
  loadingMultiPeriod: boolean;
  
  // Channel chart props
  channelChartData: ChannelSubscriberPoint[];
  multiSeriesChartData: MultiSeriesPoint[] | null;
  activeListIds: Set<string>;
  multiSeriesConfig?: MultiSeriesConfig[] | null;
  activeTab?: DashboardTab;
  onDismissAnomaly?: (date: string) => void;
}

const calcDeltaPct = calcMetricDeltaPct;

const renderDelta = (pct: number | null, invert = false, loading = false) => {
  if (loading) {
    return <span className="seo-pill-delta-skeleton" />;
  }
  if (pct === null || isNaN(pct)) return <span className="seo-pill-delta neutral">--</span>;
  const isPositive = pct > 0;
  const isNegative = pct < 0;
  
  const colorClass = invert 
    ? (isPositive ? 'negative' : isNegative ? 'positive' : 'neutral')
    : (isPositive ? 'positive' : isNegative ? 'negative' : 'neutral');
    
  return (
    <span className={`seo-pill-delta ${colorClass}`}>
      {isPositive && <span className="delta-arrow">↑</span>}
      {isNegative && <span className="delta-arrow">↓</span>}
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
};

export const VideoAnalyticsChart: React.FC<VideoAnalyticsChartProps> = ({
  selectedVideo,
  activeLists,
  channels,
  selectedChannel,
  formattedLatestDate,
  loading,
  hasLoadedOnce,
  isRefreshing = false,
  handleDownloadChart,
  showAnnotations,
  setShowAnnotations,
  trueDeltaEnabled,
  setTrueDeltaEnabled,
  compareEnabled,
  setCompareEnabled,
  activeChart,
  setActiveChart,
  period,
  customStartDate,
  customEndDate,
  chartData,
  multiPeriodStats,
  videoStats,
  loadingMultiPeriod,
  channelChartData,
  multiSeriesChartData,
  activeListIds,
  multiSeriesConfig,
  activeTab,
  onDismissAnomaly,
}) => {
  const navigate = useNavigate();
  const headerContext = selectedVideo
    ? selectedVideo.title
    : activeLists.length > 0
      ? (activeLists.length === 1 ? `List: ${activeLists[0].name}` : `${activeLists.length} Lists`)
      : (channels.find(ch => ch.id === selectedChannel)?.snippet.title || 'Overview');

  return (
    <div className="seo-widget">
      <div className="seo-widget-header">
        <div className="dp-panel-header-left seo-widget-title-area">
          <span className="dp-panel-title">
            {activeTab === 'playlistAnalytics' ? 'Playlist Analytics' : 'Video Analytics'}
          </span>
          <span className="dp-panel-sub">
            {headerContext}
            {formattedLatestDate ? ` · As of ${formattedLatestDate}` : ''}
          </span>
        </div>
        
        <div className="seo-header-controls">
          <PinToDashboardButton
            widgetId={activeTab === 'playlistAnalytics' ? 'playlist-performance' : 'video-performance'}
          />

          {activeListIds.size > 0 && (
            <div className="seo-control-group">
              <span className="control-label">Annotations</span>
              <Toggle
                checked={showAnnotations}
                onChange={setShowAnnotations}
                ariaLabel="Toggle chart annotations"
              />
            </div>
          )}
          <div className="seo-control-group">
            <span className="control-label">Compare period</span>
            <Toggle
              checked={compareEnabled}
              onChange={setCompareEnabled}
              ariaLabel="Toggle compare with previous period"
            />
          </div>
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

          <Button
            variant="secondary"
            size="sm"
            onClick={handleDownloadChart}
            title="Download chart as PNG"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            PNG
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate('/anomalies')}
            title="Open anomaly detection for this channel"
          >
            <MdAddChart size={14} aria-hidden />
            <span>Anomalies</span>
          </Button>

        </div>
      </div>

      {loading || loadingMultiPeriod ? (
        <SkeletonSeoMetricPills count={selectedVideo ? 4 : 3} />
      ) : (
        <div className="seo-widget-pills">
          {/* Views */}
          <button
             type="button"
             className={`seo-metric-pill pill-views ${activeChart === 'views' ? 'selected' : ''} ${loadingMultiPeriod ? 'loading' : ''}`}
             onClick={() => setActiveChart('views')}
             title="Total number of times your videos were viewed. Higher views indicate better reach and content discovery."
           >
             <span className="seo-pill-title">
               {activeTab === 'playlistAnalytics' ? 'Playlist Views' : 'Total Views'}
               <span className="seo-pill-period-label">
                 {customStartDate && customEndDate 
                   ? `${customStartDate.format('MMM D')} - ${customEndDate.format('MMM D')}` 
                   : period !== null ? `Last ${period}d` : 'Last 30d'}
               </span>
             </span>
             <div className="seo-pill-body">
               <span className="seo-pill-value">{(videoStats?.views || 0).toLocaleString()}</span>
               <span className={`seo-pill-deltas ${loadingMultiPeriod ? 'loading' : ''}`}>
                  {customStartDate && customEndDate ? (
                    <span className="seo-pill-delta-group">
                      <span className="seo-period-inline-label">Range</span>
                      {renderDelta(calcDeltaPct(videoStats?.views || 0, videoStats?.prevViews || 0), false, loadingMultiPeriod)}
                    </span>
                  ) : (
                    ([90, 30, 7] as const).map((d) => {
                      const pct = getMetricDeltaPct(d, 'views', multiPeriodStats, chartData, trueDeltaEnabled);
                      return (
                        <span key={d} className={`seo-pill-delta-group${period === d ? ' active-period' : ''}`}>
                          <span className="seo-period-inline-label">{`${d}d`}</span>
                          {renderDelta(pct, false, loadingMultiPeriod)}
                        </span>
                      );
                    })
                  )}
               </span>
             </div>
           </button>

          {/* Watch Time */}
          <button
             type="button"
             className={`seo-metric-pill pill-watchTime ${activeChart === 'watchTime' ? 'selected' : ''} ${loadingMultiPeriod ? 'loading' : ''}`}
             onClick={() => setActiveChart('watchTime')}
             title="Cumulative time viewers spent watching your videos. High watch time is a primary signal for the YouTube algorithm."
           >
             <span className="seo-pill-title">
               Minutes Watched
               <span className="seo-pill-period-label">
                 {customStartDate && customEndDate 
                   ? `${customStartDate.format('MMM D')} - ${customEndDate.format('MMM D')}` 
                   : period !== null ? `Last ${period}d` : 'Last 30d'}
               </span>
             </span>
             <span className="seo-pill-value">{Math.round(videoStats?.watchTime || 0).toLocaleString()}</span>
             <span className={`seo-pill-deltas ${loadingMultiPeriod ? 'loading' : ''}`}>
                {customStartDate && customEndDate ? (
                  <span className="seo-pill-delta-group">
                    <span className="seo-period-inline-label">Range</span>
                    {renderDelta(calcDeltaPct(videoStats?.watchTime || 0, videoStats?.prevWatchTime || 0), false, loadingMultiPeriod)}
                  </span>
                ) : (
                  ([90, 30, 7] as const).map((d) => {
                    const pct = getMetricDeltaPct(d, 'watchTime', multiPeriodStats, chartData, trueDeltaEnabled);
                    return (
                      <span key={d} className={`seo-pill-delta-group${period === d ? ' active-period' : ''}`}>
                        <span className="seo-period-inline-label">{`${d}d`}</span>
                        {renderDelta(pct, false, loadingMultiPeriod)}
                      </span>
                    );
                  })
                )}
             </span>
           </button>

          {/* Avg Retention */}
          <button
             type="button"
             className={`seo-metric-pill pill-retention ${activeChart === 'retention' ? 'selected' : ''} ${loadingMultiPeriod ? 'loading' : ''}`}
             onClick={() => setActiveChart('retention')}
             title="Average percentage of video watched. High retention means your content is engaging and keeps viewers watching."
           >
             <span className="seo-pill-title">
               Avg Retention
               <span className="seo-pill-period-label">
                 {customStartDate && customEndDate 
                   ? `${customStartDate.format('MMM D')} - ${customEndDate.format('MMM D')}` 
                   : period !== null ? `Last ${period}d` : 'Last 30d'}
               </span>
             </span>
             <span className="seo-pill-value">{(videoStats?.retention || 0).toFixed(1)}%</span>
             <span className={`seo-pill-deltas ${loadingMultiPeriod ? 'loading' : ''}`}>
                {customStartDate && customEndDate ? (
                  <span className="seo-pill-delta-group">
                    <span className="seo-period-inline-label">Range</span>
                    {renderDelta(calcDeltaPct(videoStats?.retention || 0, videoStats?.prevRetention || 0), false, loadingMultiPeriod)}
                  </span>
                ) : (
                  ([90, 30, 7] as const).map((d) => {
                    const pct = getMetricDeltaPct(d, 'retention', multiPeriodStats, chartData, trueDeltaEnabled);
                    return (
                      <span key={d} className={`seo-pill-delta-group${period === d ? ' active-period' : ''}`}>
                        <span className="seo-period-inline-label">{`${d}d`}</span>
                        {renderDelta(pct, false, loadingMultiPeriod)}
                      </span>
                    );
                  })
                )}
             </span>
           </button>

          {/* CTR (video-only) */}
          {selectedVideo && (
            <button
               type="button"
               className={`seo-metric-pill pill-ctr ${activeChart === 'ctr' ? 'selected' : ''}`}
               onClick={() => setActiveChart('ctr')}
               title="Click-Through Rate: Percentage of people who clicked after seeing your video thumbnail. (Data limited/simulated in this view)"
             >
               <span className="seo-pill-title">CTR</span>
               <span className="seo-pill-value">--</span>
               <span className="seo-pill-delta neutral">–</span>
             </button>
          )}
        </div>
      )}

      {/* Chart */}
      <div className="seo-widget-chart">
        <div className={`chart-wrapper ${isRefreshing && !loading && !loadingMultiPeriod ? 'chart-wrapper--refreshing' : ''}`}>
          {/* Top-edge progress bar for background refresh */}
          {(isRefreshing || ((loading || loadingMultiPeriod) && hasLoadedOnce)) && (
            <div className="chart-refresh-bar" role="status" aria-live="polite" aria-label="Updating chart data" />
          )}
          {(() => {
            const activePeriodKey = `d${period || 30}` as keyof MultiPeriodStats;
            const stats = multiPeriodStats?.[activePeriodKey];
            let trendColor: string | undefined;

            if (stats) {
              const metricKey = TREND_METRIC_KEYS[activeChart];
              if (metricKey) {
                const pct = calcDeltaPct(
                  readPeriodMetric(stats.current, metricKey),
                  readPeriodMetric(stats.previous, metricKey),
                );
                if (pct !== null) {
                  trendColor = pct > 0 ? TREND_COLOR_POSITIVE : pct < 0 ? TREND_COLOR_NEGATIVE : TREND_COLOR_NEUTRAL;
                }
              }
            }

            if (loading || loadingMultiPeriod) {
              return <SkeletonSeoChart height={400} />;
            }

            // The multi-list overlay wins only when it has rows; otherwise fall
            // back to the aggregate series (the pills/table source) so the chart
            // never shows "No data for this period." while stats exist.
            const selection = selectVideoChartSeries({
              activeChart,
              chartData,
              channelChartData,
              multiSeriesChartData,
              multiSeriesConfig,
              activeListCount: activeListIds.size,
            });

            return renderChart({ 
              chartType: activeChart, 
              data: selection.data,
              compareEnabled: (activeChart !== 'subscribersGained' && activeChart !== 'subscribersLost') ? compareEnabled : false,
              height: 400,
              overrideColor: trendColor,
              multiSeriesData: selection.multiSeriesData,
              annotations: showAnnotations ? activeLists.flatMap(list => {
                const anns = [...(list.annotations || [])].map(ann => ({
                  ...ann,
                  color: list.color
                }));
                // Add trackDate as fallback annotation if not in list
                if (list.trackDate && !list.annotations?.some((a) => a.date === list.trackDate)) {
                  anns.push({ date: list.trackDate, title: list.name, color: list.color });
                }
                return anns;
              }) : [],
              onDismissAnomaly,
            });
          })()}
        </div>

        {/* Multi-series legend */}
        {multiSeriesConfig && activeListIds.size > 1 && (
          <div className="chart-series-legend">
            {multiSeriesConfig.map((cfg) => (
              <span key={cfg.name} className="chart-series-legend__item">
                <span
                  className="chart-series-legend__dot"
                  style={{ background: cfg.color }}
                />
                <span className="chart-series-legend__label" title={cfg.name}>
                  {cfg.name}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

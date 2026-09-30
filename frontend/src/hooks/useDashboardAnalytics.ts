import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import dayjs from 'dayjs';
import { useOrganization } from './useOrganization';
import { useDashboardStore } from '../stores/dashboardStore';
import { AnalyticsService, type AnalyticsReport, UsageLimitError } from '../services/analyticsService';
import {
  buildAudienceFilterContext,
  chunkArray,
  DIMENSION_VIDEO_IDS_PER_ANALYTICS_FILTER,
  getVideoIdsForDimensionsFilter,
  getVideosByActiveFilters,
  mergeDimensionsBundles,
  mergeReportsByDay,
  type DimensionsBundleData,
  type DimensionsMultiPeriodData,
  type FilterableVideo,
} from '../utils/dashboardUtils';
import type { VideoMetadata } from '../types/youtube';
import type { VisibilityFilter } from '../types/dashboard';

const EMPTY_STRING_SET = new Set<string>();

type PeriodData = {
  views: number;
  watchTime: number;
  subscribers: number;
  subscribersGained: number;
  subscribersLost: number;
  retention: number;
  likes: number;
  comments: number;
  shares: number;
};

const ZERO_PERIOD_DATA: PeriodData = {
  views: 0,
  watchTime: 0,
  subscribers: 0,
  subscribersGained: 0,
  subscribersLost: 0,
  retention: 0,
  likes: 0,
  comments: 0,
  shares: 0,
};

const EMPTY_PLAYLIST_ANALYTICS_REPORT: AnalyticsReport = {
  kind: 'youtubeAnalytics#resultTable',
  columnHeaders: [
    { name: 'day', dataType: 'string', columnType: 'DIMENSION' },
    { name: 'views', dataType: 'integer', columnType: 'METRIC' },
    { name: 'estimatedMinutesWatched', dataType: 'float', columnType: 'METRIC' },
    { name: 'averageViewPercentage', dataType: 'float', columnType: 'METRIC' },
    { name: 'subscribersGained', dataType: 'integer', columnType: 'METRIC' },
    { name: 'subscribersLost', dataType: 'integer', columnType: 'METRIC' },
    { name: 'likes', dataType: 'integer', columnType: 'METRIC' },
    { name: 'shares', dataType: 'integer', columnType: 'METRIC' },
    { name: 'comments', dataType: 'integer', columnType: 'METRIC' },
  ],
  rows: [],
};

type ChannelPeriodData = {
  views: number;
  subscribersGained: number;
  subscribersLost: number;
  watchTime: number;
  videosUploaded: number;
  likes: number;
  comments: number;
  shares: number;
};

type PeriodBundleCacheEntry = {
  reportData: AnalyticsReport | null;
  prevReportData: AnalyticsReport | null;
  channelMetrics: AnalyticsReport | null;
  prevChannelMetrics: AnalyticsReport | null;
};

type VideoAnomalyInsight = {
  kind: 'spike' | 'dip';
  date: string;
  deltaViews: number;
  topVideoId?: string;
  topVideoTitle?: string;
  topVideoViews?: number;
  topVideoDeltaViews?: number;
  topVideoThumbnailUrl?: string;
};

interface UseDashboardAnalyticsProps {
  selectedChannel: string | null;
  selectedVideo: VideoMetadata | null;
  selectedVideoIds: Set<string>;
  activeTab: string;
  period: number | null;
  customStartDate: dayjs.Dayjs | null;
  customEndDate: dayjs.Dayjs | null;
  compareEnabled: boolean;
  trueDeltaEnabled: boolean;
  loadingChannels: boolean;
  getEffectiveToken: () => Promise<string | null>;
  user: { email?: string | null; uid?: string } | null;
  currentOrganization: { id: string } | null;
  perfLog: (label: string, startedAt: number, meta?: Record<string, unknown>) => void;
  latestDataDate: string;
  setLatestDataDate: (date: string) => void;
  videos: VideoMetadata[];
  videoTypeFilter: 'all' | 'shorts' | 'long';
  videoSearchQuery: string;
  /** Visibility filter (public by default; opt-in private/unlisted). */
  visibilityFilter?: VisibilityFilter;
  filterByPlaylists: boolean;
  selectedPlaylists: Set<string>;
  filterByVideos: boolean;
  selectedVideos: Set<string>;
  tableCheckedOverride: Set<string> | null;
  hasChangedVideoLimit: boolean;
  activeListIds: Set<string>;
  isTemporaryList: boolean;
  savedLists: Array<{ id: string; videoIds: string[] }>;
  /** Playlist tab: IDs currently shown in the playlist table (loaded for this channel). */
  playlistAnalyticsScopeIds: string[];
  isLoadingPlaylists: boolean;
}

export const useDashboardAnalytics = ({
  selectedChannel,
  selectedVideo,
  selectedVideoIds,
  activeTab,
  period,
  customStartDate,
  customEndDate,
  compareEnabled,
  trueDeltaEnabled,
  loadingChannels,
  getEffectiveToken,
  user,
  currentOrganization,
  perfLog,
  latestDataDate,
  setLatestDataDate,
  videos,
  videoTypeFilter,
  videoSearchQuery,
  visibilityFilter = 'public',
  filterByPlaylists,
  selectedPlaylists,
  filterByVideos,
  selectedVideos,
  tableCheckedOverride,
  hasChangedVideoLimit,
  activeListIds,
  isTemporaryList,
  savedLists,
  playlistAnalyticsScopeIds,
  isLoadingPlaylists,
}: UseDashboardAnalyticsProps) => {
  const { isPersonalContext } = useOrganization();
  const channels = useDashboardStore((state) => state.channel.channels);
  const personalEmpty = isPersonalContext && channels.length === 0;
  const selectedChannelRef = useRef<string | null>(selectedChannel);
  const latestDataDateRef = useRef(latestDataDate);

  useEffect(() => {
    selectedChannelRef.current = selectedChannel;
  }, [selectedChannel]);

  useEffect(() => {
    latestDataDateRef.current = latestDataDate;
  }, [latestDataDate]);

  /** Bumps on each loadAllData run so stale async completions cannot overwrite newer results (same channel). */
  const dashboardBundleGenRef = useRef(0);
  const periodBundleCacheRef = useRef<Map<string, PeriodBundleCacheEntry>>(new Map());

  const analyticsService = useMemo(() => {
    if (!user?.email) return null;
    return true;
  }, [user?.email]);

  const activeLists = useMemo(
    () => savedLists.filter(l => activeListIds.has(l.id)),
    [savedLists, activeListIds]
  );

  const [reportData, setReportData] = useState<AnalyticsReport | null>(null);
  const [prevReportData, setPrevReportData] = useState<AnalyticsReport | null>(null);
  const [channelMetrics, setChannelMetrics] = useState<AnalyticsReport | null>(null);
  const [prevChannelMetrics, setPrevChannelMetrics] = useState<AnalyticsReport | null>(null);

  const [multiPeriodStats, setMultiPeriodStats] = useState<{
    d7: { current: PeriodData; previous: PeriodData };
    d30: { current: PeriodData; previous: PeriodData };
    d90: { current: PeriodData; previous: PeriodData };
  } | null>(null);

  const [dimensionsMultiPeriod, setDimensionsMultiPeriod] = useState<DimensionsMultiPeriodData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMultiPeriod, setLoadingMultiPeriod] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadingDimensions, setLoadingDimensions] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usageError, setUsageError] = useState<{ limit: number; used: number; message: string } | null>(null);

  // Refs to break cascading render cycle: loadAllData reads these instead of state vars,
  // so state changes don't cause loadAllData to get a new reference and re-trigger the effect.
  const hasLoadedOnceRef = useRef(false);
  const reportDataRef = useRef<AnalyticsReport | null>(null);
  const channelMetricsRef = useRef<AnalyticsReport | null>(null);

  useEffect(() => {
    hasLoadedOnceRef.current = hasLoadedOnce;
  }, [hasLoadedOnce]);

  useEffect(() => {
    reportDataRef.current = reportData;
  }, [reportData]);

  useEffect(() => {
    channelMetricsRef.current = channelMetrics;
  }, [channelMetrics]);

  const [fullListsData, setFullListsData] = useState<AnalyticsReport | null>(null);
  const [channelMultiPeriodStats, setChannelMultiPeriodStats] = useState<{
    d7: { current: ChannelPeriodData; previous: ChannelPeriodData };
    d30: { current: ChannelPeriodData; previous: ChannelPeriodData };
    d90: { current: ChannelPeriodData; previous: ChannelPeriodData };
  } | null>(null);
  const [channelAnalyticsData, setChannelAnalyticsData] = useState<ChannelPeriodData>({
    views: 0,
    subscribersGained: 0,
    subscribersLost: 0,
    watchTime: 0,
    videosUploaded: 0,
    likes: 0,
    comments: 0,
    shares: 0,
  });
  const [channelAnalyticsChartData, setChannelAnalyticsChartData] = useState<Array<Record<string, unknown>>>([]);
  const [loadingChannelAnalytics, setLoadingChannelAnalytics] = useState(false);
  const [videoAnomalyInsights, setVideoAnomalyInsights] = useState<VideoAnomalyInsight[]>([]);

  function rowsreduce(rows: unknown[][], col: number): number {
    return rows.reduce((s: number, r: unknown[]) => s + (Number(r[col]) || 0), 0);
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useLayoutEffect(() => {
    setReportData(null);
    setPrevReportData(null);
  /* eslint-enable react-hooks/set-state-in-effect */
    setChannelMetrics(null);
    setPrevChannelMetrics(null);
    setMultiPeriodStats(null);
    setFullListsData(null);
    setDimensionsMultiPeriod(null);
    setError(null);
    setUsageError(null);
    setChannelMultiPeriodStats(null);
    setChannelAnalyticsData({
      views: 0,
      subscribersGained: 0,
      subscribersLost: 0,
      watchTime: 0,
      videosUploaded: 0,
      likes: 0,
      comments: 0,
      shares: 0,
    });
    setChannelAnalyticsChartData([]);
    setVideoAnomalyInsights([]);
    if (!selectedChannel) {
      setLoading(false);
      setLoadingMultiPeriod(false);
      setIsRefreshing(false);
      setLoadingChannelAnalytics(false);
      setLoadingDimensions(false);
      setHasLoadedOnce(false);
      return;
    }
    setHasLoadedOnce(false);
    setLoading(true);
    setLoadingMultiPeriod(true);
    setIsRefreshing(false);
    setLoadingChannelAnalytics(true);
  }, [selectedChannel]);

  const loadAllData = useCallback(async () => {
    const dashboardLoadStart = performance.now();
    if (!analyticsService || loadingChannels || !selectedChannel) return;
    if (personalEmpty) return;
    if (activeTab === 'audience') {
      setLoading(false);
      setLoadingMultiPeriod(false);
      return;
    }
    if (activeTab !== 'videoAnalytics' && activeTab !== 'channelAnalytics' && activeTab !== 'playlistAnalytics') return;

    const requestChannel = selectedChannel;
    const gen = ++dashboardBundleGenRef.current;
    const apply = () =>
      gen === dashboardBundleGenRef.current && selectedChannelRef.current === requestChannel;

    const shouldShowHardLoading = !hasLoadedOnceRef.current && !reportDataRef.current && !channelMetricsRef.current;
    setLoading(shouldShowHardLoading);
    setLoadingMultiPeriod(shouldShowHardLoading);
    setIsRefreshing(!shouldShowHardLoading);
    setError(null);
    setUsageError(null);

    try {
      const tokenToUse = await getEffectiveToken();
      perfLog('dashboard.load.token', performance.now(), { hasToken: !!tokenToUse });
      if (!tokenToUse || !user?.email) {
        if (apply()) {
          setLoading(false);
          setLoadingMultiPeriod(false);
        }
        return;
      }

      const svc = new AnalyticsService(tokenToUse, user.email, currentOrganization?.id);
      const channelIds = `channel==${selectedChannel}`;

      let videoFilters: string | undefined;
      let videoFilterIds: string[] | null = null;

      if (activeTab === 'playlistAnalytics') {
        const scopeIds = playlistAnalyticsScopeIds;
        if (scopeIds.length === 0) {
          if (apply()) {
            if (isLoadingPlaylists) {
              setReportData(null);
              setPrevReportData(null);
              setChannelMetrics(null);
              setPrevChannelMetrics(null);
              setMultiPeriodStats(null);
              setVideoAnomalyInsights([]);
              setLoading(true);
              setLoadingMultiPeriod(true);
            } else {
              setReportData(EMPTY_PLAYLIST_ANALYTICS_REPORT);
              setPrevReportData(compareEnabled ? EMPTY_PLAYLIST_ANALYTICS_REPORT : null);
              setChannelMetrics(null);
              setPrevChannelMetrics(null);
              setMultiPeriodStats({
                d7: { current: ZERO_PERIOD_DATA, previous: ZERO_PERIOD_DATA },
                d30: { current: ZERO_PERIOD_DATA, previous: ZERO_PERIOD_DATA },
                d90: { current: ZERO_PERIOD_DATA, previous: ZERO_PERIOD_DATA },
              });
              setVideoAnomalyInsights([]);
              setLoading(false);
              setLoadingMultiPeriod(false);
              setHasLoadedOnce(true);
            }
          }
          setIsRefreshing(false);
          return;
        }

        const selectedInScope = Array.from(selectedPlaylists)
          .filter(id => scopeIds.includes(id))
          .sort();
        if (selectedInScope.length === 0) {
          if (apply()) {
            setReportData(EMPTY_PLAYLIST_ANALYTICS_REPORT);
            setPrevReportData(compareEnabled ? EMPTY_PLAYLIST_ANALYTICS_REPORT : null);
            setChannelMetrics(null);
            setPrevChannelMetrics(null);
            setMultiPeriodStats({
              d7: { current: ZERO_PERIOD_DATA, previous: ZERO_PERIOD_DATA },
              d30: { current: ZERO_PERIOD_DATA, previous: ZERO_PERIOD_DATA },
              d90: { current: ZERO_PERIOD_DATA, previous: ZERO_PERIOD_DATA },
            });
            setVideoAnomalyInsights([]);
            setLoading(false);
            setLoadingMultiPeriod(false);
            setHasLoadedOnce(true);
          }
          setIsRefreshing(false);
          return;
        }
        videoFilters = `playlist==${selectedInScope.join(',')}`;
      } else if (activeTab === 'videoAnalytics') {
        const namedScope = selectedVideo
          ? [selectedVideo.videoId]
          : selectedVideoIds.size > 0 && !selectedVideoIds.has('XX_NONE_XX_')
            ? Array.from(selectedVideoIds).sort()
            : null;

        if (namedScope) {
          videoFilterIds = namedScope;
          videoFilters = `video==${namedScope.join(',')}`;
        } else {
          // Narrowing client filters (visibility / type / search / playlist / video
          // selection) must drive the stats + graph too. Scope the analytics request to
          // the exact videos matching the active filters so insights follow the table.
          const hasNarrowingFilter =
            visibilityFilter !== 'all' ||
            videoTypeFilter !== 'all' ||
            videoSearchQuery !== '' ||
            selectedPlaylists.size > 0 ||
            selectedVideos.size > 0;
          if (hasNarrowingFilter) {
            const scoped = getVideosByActiveFilters({
              videos: videos as FilterableVideo[],
              videoTypeFilter,
              videoSearchQuery,
              visibilityFilter,
              filterByPlaylists,
              selectedPlaylists,
              filterByVideos,
              selectedVideos,
            });
            const ids = scoped.map(v => v.videoId).filter(Boolean);
            if (ids.length > 0) {
              videoFilterIds = [...new Set(ids)];
              videoFilters = `video==${videoFilterIds.join(',')}`;
            }
          }
        }
      } else {
        videoFilters = undefined;
      }

      const resolveVideoAnomalyInsights = async (currentReport: AnalyticsReport | null) => {
        if (activeTab !== 'videoAnalytics' || selectedVideo) {
          if (apply()) setVideoAnomalyInsights([]);
          return;
        }

        const rows = (currentReport?.rows || [])
          .map((row: unknown[]) => ({
            date: String(row[0] || ''),
            views: Number(row[1]) || 0,
          }))
          .filter(r => !!r.date)
          .sort((a, b) => a.date.localeCompare(b.date));

        if (rows.length < 2) {
          if (apply()) setVideoAnomalyInsights([]);
          return;
        }

        const deltas = rows.slice(1).map((r, idx) => ({
          date: r.date,
          prevDate: rows[idx].date,
          delta: r.views - rows[idx].views,
        }));

        const mean = deltas.reduce((sum, d) => sum + d.delta, 0) / Math.max(1, deltas.length);
        const variance = deltas.reduce((sum, d) => {
          const diff = d.delta - mean;
          return sum + diff * diff;
        }, 0) / Math.max(1, deltas.length);
        const stdDev = Math.sqrt(variance);
        const anomalyThreshold = Math.max(100, stdDev * 1.2);

        const candidates = deltas
          .filter(d => Math.abs(d.delta) >= anomalyThreshold)
          .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
          .slice(0, 6)
          .map(d => ({
            kind: d.delta >= 0 ? 'spike' : 'dip',
            date: d.date,
            prevDate: d.prevDate,
            deltaViews: d.delta,
          })) as Array<{ kind: 'spike' | 'dip'; date: string; prevDate: string; deltaViews: number }>;

        if (candidates.length === 0) {
          if (apply()) setVideoAnomalyInsights([]);
          return;
        }

        const titleById = new Map(videos.map(v => [v.videoId, v.title]));
        const thumbnailById = new Map(videos.map(v => [v.videoId, v.thumbnailUrl]));

        const insights = await Promise.all(
          candidates.map(async c => {
            try {
              // YouTube Analytics API does not support dimensions: 'day,video'.
              // Query each video individually to find the driver.
              let driverVideoId: string | undefined;
              let driverDelta = c.kind === 'spike' ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;

              if (videoFilters) {
                // If we have a video filter, get aggregate daily views
                const twoDayReport = await svc.getReport({
                  ids: channelIds,
                  startDate: c.prevDate,
                  endDate: c.date,
                  metrics: 'views',
                  dimensions: 'day',
                  sort: 'day',
                  filters: videoFilters,
                });

                const prevViews = (twoDayReport.rows || []).find(r => String(r[0]) === c.prevDate)?.[1] || 0;
                const currViews = (twoDayReport.rows || []).find(r => String(r[0]) === c.date)?.[1] || 0;
                driverDelta = Number(currViews) - Number(prevViews);
              } else {
                // Check all matching videos individually to find the one driving the anomaly.
                const topVideos = videos;
                for (const video of topVideos) {
                  try {
                    const videoReport = await svc.getReport({
                      ids: channelIds,
                      startDate: c.prevDate,
                      endDate: c.date,
                      metrics: 'views',
                      dimensions: 'day',
                      sort: 'day',
                      filters: `video==${video.videoId}`,
                    });

                    const prevViews = Number((videoReport.rows || []).find(r => String(r[0]) === c.prevDate)?.[1] || 0);
                    const currViews = Number((videoReport.rows || []).find(r => String(r[0]) === c.date)?.[1] || 0);
                    const delta = currViews - prevViews;

                    if (c.kind === 'spike' && delta > driverDelta) {
                      driverDelta = delta;
                      driverVideoId = video.videoId;
                    } else if (c.kind === 'dip' && delta < driverDelta) {
                      driverDelta = delta;
                      driverVideoId = video.videoId;
                    }
                  } catch {
                    // skip this video
                  }
                }
              }

              if ((c.kind === 'spike' && driverDelta <= 0) || (c.kind === 'dip' && driverDelta >= 0)) {
                driverVideoId = undefined;
              }

              return {
                ...c,
                topVideoId: driverVideoId,
                topVideoTitle: driverVideoId ? titleById.get(driverVideoId) || driverVideoId : undefined,
                topVideoViews: undefined,
                topVideoDeltaViews: driverVideoId ? driverDelta : undefined,
                topVideoThumbnailUrl: driverVideoId ? thumbnailById.get(driverVideoId) : undefined,
              } as VideoAnomalyInsight;
            } catch {
              return c as VideoAnomalyInsight;
            }
          })
        );

        if (apply()) {
          setVideoAnomalyInsights(insights);
        }
      };

      const cachedLatestHint = latestDataDateRef.current || undefined;
      const effectivePeriod = period ?? 30;
      const hasCustomRange = !!(customStartDate && customEndDate);

      const cacheBaseKey = [
        requestChannel,
        currentOrganization?.id || 'personal',
        activeTab,
        compareEnabled ? 'cmp1' : 'cmp0',
        trueDeltaEnabled ? 'td1' : 'td0',
        videoFilters || 'nofilter',
        hasCustomRange ? 'custom' : 'preset',
      ].join('|');

      if (!hasCustomRange) {
        const cached = periodBundleCacheRef.current.get(`${cacheBaseKey}|p${effectivePeriod}`);
        if (cached && apply()) {
          setReportData(cached.reportData);
          setPrevReportData(cached.prevReportData);
          setChannelMetrics(cached.channelMetrics);
          setPrevChannelMetrics(cached.prevChannelMetrics);
          setLoading(false);
          setLoadingMultiPeriod(false);
          setHasLoadedOnce(true);
        }
      }

      if (!videoFilters) {
        const summaryParams = {
          channelId: selectedChannel!,
          period: customStartDate && customEndDate ? undefined : (period ?? 30),
          startDate: customStartDate?.format('YYYY-MM-DD'),
          endDate: customEndDate?.format('YYYY-MM-DD'),
          compare: compareEnabled,
          trueDelta: trueDeltaEnabled,
          latestDate: cachedLatestHint,
        };

        const dashboardLoadStart = performance.now();

        try {
          const bundle = await svc.getDashboardBundle({
            ...summaryParams,
            filters: undefined,
          });

          perfLog('dashboard.load.bundle', dashboardLoadStart, {
            filtered: false,
            period: period ?? 30,
            hasLatestHint: !!cachedLatestHint,
          });

          if (!apply()) return;

          if (bundle.latestDate) {
            setLatestDataDate(bundle.latestDate);
            latestDataDateRef.current = bundle.latestDate;
          }

          setReportData(bundle.current);
          setPrevReportData(bundle.previous);
          setChannelMetrics(bundle.channelCurrent);
          setPrevChannelMetrics(bundle.channelPrevious);
          if (!hasCustomRange) {
            periodBundleCacheRef.current.set(`${cacheBaseKey}|p${effectivePeriod}`, {
              reportData: bundle.current,
              prevReportData: bundle.previous,
              channelMetrics: bundle.channelCurrent,
              prevChannelMetrics: bundle.channelPrevious,
            });
          }

          setMultiPeriodStats({
            d7: { current: bundle.d7.current as PeriodData, previous: bundle.d7.previous as PeriodData },
            d30: { current: bundle.d30.current as PeriodData, previous: bundle.d30.previous as PeriodData },
            d90: { current: bundle.d90.current as PeriodData, previous: bundle.d90.previous as PeriodData },
          });

          void resolveVideoAnomalyInsights(bundle.current);

          setLoading(false);
          setHasLoadedOnce(true);
          setLoadingMultiPeriod(false);
          perfLog('dashboard.load.total', dashboardLoadStart, { filtered: false, bundled: true });
          if (!hasCustomRange && effectivePeriod === 30) {
            const prefetchPeriods: Array<7 | 90> = [7, 90];
            void Promise.all(
              prefetchPeriods.map(async (prefetchPeriod) => {
                const cacheKey = `${cacheBaseKey}|p${prefetchPeriod}`;
                if (periodBundleCacheRef.current.has(cacheKey)) return;
                try {
                  const prefetched = await svc.getDashboardBundle({
                    channelId: selectedChannel!,
                    period: prefetchPeriod,
                    compare: compareEnabled,
                    trueDelta: trueDeltaEnabled,
                    latestDate: latestDataDateRef.current || undefined,
                    filters: undefined,
                  });
                  if (!apply()) return;
                  periodBundleCacheRef.current.set(cacheKey, {
                    reportData: prefetched.current,
                    prevReportData: prefetched.previous,
                    channelMetrics: prefetched.channelCurrent,
                    prevChannelMetrics: prefetched.channelPrevious,
                  });
                } catch {
                  /* background prefetch is best-effort */
                }
              })
            );
          }
          return;
        } catch (bundleErr) {
          console.warn('[Dashboard] Bundle fetch failed:', bundleErr);
          setLoading(false);
          setLoadingMultiPeriod(false);
          throw bundleErr;
        }
      }

      // For filtered video scopes, try server-side bundle first to minimize API fan-out.
      const filteredBundleParams = {
        channelId: selectedChannel!,
        period: customStartDate && customEndDate ? undefined : (period ?? 30),
        startDate: customStartDate?.format('YYYY-MM-DD'),
        endDate: customEndDate?.format('YYYY-MM-DD'),
        compare: compareEnabled,
        trueDelta: trueDeltaEnabled,
        latestDate: cachedLatestHint,
      };
      const filteredBundleStart = performance.now();
      try {
        const filteredBundle = await svc.getDashboardBundle({
          ...filteredBundleParams,
          filters: videoFilters,
        });

        perfLog('dashboard.load.bundle', filteredBundleStart, {
          filtered: true,
          period: period ?? 30,
          hasLatestHint: !!cachedLatestHint,
        });

        if (!apply()) return;

        if (filteredBundle.latestDate) {
          setLatestDataDate(filteredBundle.latestDate);
          latestDataDateRef.current = filteredBundle.latestDate;
        }

        setReportData(filteredBundle.current);
        setPrevReportData(filteredBundle.previous);
        setChannelMetrics(filteredBundle.channelCurrent);
        setPrevChannelMetrics(filteredBundle.channelPrevious);
        if (!hasCustomRange) {
          periodBundleCacheRef.current.set(`${cacheBaseKey}|p${effectivePeriod}`, {
            reportData: filteredBundle.current,
            prevReportData: filteredBundle.previous,
            channelMetrics: filteredBundle.channelCurrent,
            prevChannelMetrics: filteredBundle.channelPrevious,
          });
        }

        setMultiPeriodStats({
          d7: { current: filteredBundle.d7.current as PeriodData, previous: filteredBundle.d7.previous as PeriodData },
          d30: { current: filteredBundle.d30.current as PeriodData, previous: filteredBundle.d30.previous as PeriodData },
          d90: { current: filteredBundle.d90.current as PeriodData, previous: filteredBundle.d90.previous as PeriodData },
        });

        void resolveVideoAnomalyInsights(filteredBundle.current);

        setLoading(false);
        setHasLoadedOnce(true);
        setLoadingMultiPeriod(false);
        perfLog('dashboard.load.total', filteredBundleStart, { filtered: true, bundled: true });
        if (!hasCustomRange && effectivePeriod === 30) {
          const prefetchPeriods: Array<7 | 90> = [7, 90];
          void Promise.all(
            prefetchPeriods.map(async (prefetchPeriod) => {
              const cacheKey = `${cacheBaseKey}|p${prefetchPeriod}`;
              if (periodBundleCacheRef.current.has(cacheKey)) return;
              try {
                const prefetched = await svc.getDashboardBundle({
                  channelId: selectedChannel!,
                  period: prefetchPeriod,
                  compare: compareEnabled,
                  trueDelta: trueDeltaEnabled,
                  latestDate: latestDataDateRef.current || undefined,
                  filters: videoFilters,
                });
                if (!apply()) return;
                periodBundleCacheRef.current.set(cacheKey, {
                  reportData: prefetched.current,
                  prevReportData: prefetched.previous,
                  channelMetrics: prefetched.channelCurrent,
                  prevChannelMetrics: prefetched.channelPrevious,
                });
              } catch {
                /* background prefetch is best-effort */
              }
            })
          );
        }
        return;
      } catch (bundleErr) {
        console.warn('[Dashboard] Filtered bundle fallback to granular report calls:', bundleErr);
      }

      let latestDate = latestDataDateRef.current;
      if (!latestDate) {
        latestDate = await svc.getLatestAvailableDate(selectedChannel!);
        if (!apply()) return;
        setLatestDataDate(latestDate);
        latestDataDateRef.current = latestDate;
      }

      const endRef = new Date(latestDate);

      const dateRange = (offsetDays: number, windowDays: number) => {
        const end = new Date(endRef.getTime() - offsetDays * 86400000);
        const start = new Date(end.getTime() - (windowDays - 1) * 86400000);
        return { endDate: end.toISOString().split('T')[0], startDate: start.toISOString().split('T')[0] };
      };

      const periodWindow = (windowDays: number, offsetDays = 0) => {
        const endC = new Date(endRef.getTime() - offsetDays * 86400000).toISOString().split('T')[0];
        const startC = new Date(new Date(endC).getTime() - (windowDays - 1) * 86400000).toISOString().split('T')[0];
        const endP = new Date(new Date(startC).getTime() - 86400000).toISOString().split('T')[0];
        const startP = new Date(new Date(endP).getTime() - (windowDays - 1) * 86400000).toISOString().split('T')[0];
        return { curr: { startDate: startC, endDate: endC }, prev: { startDate: startP, endDate: endP } };
      };

      const p7 = periodWindow(trueDeltaEnabled ? 8 : 7);
      const p30 = periodWindow(30, trueDeltaEnabled ? 8 : 0);
      const p90 = periodWindow(90, trueDeltaEnabled ? 38 : 0);

      const hasPlaylistFilter = typeof videoFilters === 'string' && videoFilters.includes('playlist==');

      const vidMetrics = hasPlaylistFilter
        ? 'views,estimatedMinutesWatched,averageViewPercentage'
        : 'views,estimatedMinutesWatched,averageViewPercentage,subscribersGained,subscribersLost,likes,shares,comments';
      const chMetrics = 'subscribersGained,subscribersLost,likes,shares,comments';
      const pilMetrics = hasPlaylistFilter ? 'views,estimatedMinutesWatched,averageViewPercentage' : 'views,estimatedMinutesWatched,averageViewPercentage,likes,shares,comments';
      const filterStrings: string[] =
        videoFilterIds && videoFilterIds.length > 0
          ? videoFilterIds.length > DIMENSION_VIDEO_IDS_PER_ANALYTICS_FILTER
            ? chunkArray(videoFilterIds, DIMENSION_VIDEO_IDS_PER_ANALYTICS_FILTER).map(c => `video==${c.join(',')}`)
            : [`video==${videoFilterIds.join(',')}`]
          : videoFilters
            ? [videoFilters]
            : [];

      /** Fetch a day report scoped to the filtered videos, chunking + merging when the set exceeds YouTube's id-filter cap. Channel-wide when there's no filter. */
      const fetchVidReport = async (
        params: { startDate: string; endDate: string; metrics: string },
        forceFiltered?: boolean
      ): Promise<AnalyticsReport | null> => {
        const useFilter = forceFiltered ?? Boolean(videoFilters);
        if (!useFilter || filterStrings.length === 0) {
          return svc.getReport({ ids: channelIds, ...params, dimensions: 'day', sort: 'day' });
        }
        if (filterStrings.length === 1) {
          return svc.getReport({ ids: channelIds, ...params, dimensions: 'day', sort: 'day', filters: filterStrings[0] });
        }
        const scoped = await Promise.all(
          filterStrings.map(f => svc.getReport({ ids: channelIds, ...params, dimensions: 'day', sort: 'day', filters: f }))
        );
        return mergeReportsByDay(scoped);
      };

      const fetchStatWindow = async (w: { startDate: string; endDate: string }): Promise<PeriodData> => {
        const [vr, sr] = await Promise.all([
          fetchVidReport({ ...w, metrics: pilMetrics }),
          svc.getReport({ ids: channelIds, ...w, metrics: 'subscribersGained,subscribersLost', dimensions: 'day', sort: 'day' }),
        ]);
        const rows = vr?.rows || [];
        const chRows = sr.rows || [];
        const validRet = rows.filter((r: unknown[]) => r[3] !== null && !isNaN(Number(r[3])));
        const g = chRows.reduce((acc: number, r: unknown[]) => acc + Number(r[1]), 0);
        const l = chRows.reduce((acc: number, r: unknown[]) => acc + Number(r[2]), 0);
        return {
          views: rowsreduce(rows, 1),
          watchTime: rowsreduce(rows, 2),
          subscribers: (Number(g) || 0) - (Number(l) || 0),
          subscribersGained: Number(g) || 0,
          subscribersLost: Number(l) || 0,
          likes: rowsreduce(rows, 4),
          shares: rowsreduce(rows, 5),
          comments: rowsreduce(rows, 6),
          retention:
            validRet.length > 0
              ? validRet.reduce((s: number, r: unknown[]) => s + (Number(r[3]) || 0), 0) / validRet.length
              : 0,
        };
      };

      const [
        current,
        previous,
        channelCurr,
        channelPrev,
        d7c,
        d7p,
        d30c,
        d30p,
        d90c,
        d90p,
      ] = await Promise.all([
        fetchVidReport({
          startDate: customStartDate ? customStartDate.format('YYYY-MM-DD') : dateRange(0, period ?? 30).startDate,
          endDate: customEndDate ? customEndDate.format('YYYY-MM-DD') : dateRange(0, period ?? 30).endDate,
          metrics: vidMetrics,
        }),
        compareEnabled
          ? fetchVidReport({
              startDate: customStartDate
                ? dayjs(customStartDate)
                    .subtract(Math.max(1, customEndDate!.diff(customStartDate, 'day') + 1), 'day')
                    .format('YYYY-MM-DD')
                : dateRange(period ?? 30, period ?? 30).startDate,
              endDate: customStartDate
                ? dayjs(customStartDate).subtract(1, 'day').format('YYYY-MM-DD')
                : dateRange(period ?? 30, period ?? 30).endDate,
              metrics: vidMetrics,
            })
          : Promise.resolve(null),
        svc.getReport({
          ids: channelIds,
          startDate: customStartDate ? customStartDate.format('YYYY-MM-DD') : dateRange(0, period ?? 30).startDate,
          endDate: customEndDate ? customEndDate.format('YYYY-MM-DD') : dateRange(0, period ?? 30).endDate,
          metrics: chMetrics,
          dimensions: 'day',
          sort: 'day',
        }),
        compareEnabled
          ? svc.getReport({
              ids: channelIds,
              startDate: customStartDate
                ? dayjs(customStartDate)
                    .subtract(Math.max(1, customEndDate!.diff(customStartDate, 'day') + 1), 'day')
                    .format('YYYY-MM-DD')
                : dateRange(period ?? 30, period ?? 30).startDate,
              endDate: customStartDate
                ? dayjs(customStartDate).subtract(1, 'day').format('YYYY-MM-DD')
                : dateRange(period ?? 30, period ?? 30).endDate,
              metrics: chMetrics,
              dimensions: 'day',
              sort: 'day',
            })
          : Promise.resolve(null),
        fetchStatWindow(p7.curr),
        fetchStatWindow(p7.prev),
        fetchStatWindow(p30.curr),
        fetchStatWindow(p30.prev),
        fetchStatWindow(p90.curr),
        fetchStatWindow(p90.prev),
      ]);

      if (!apply()) return;

      setReportData(current);
      setPrevReportData(previous);
      setChannelMetrics(channelCurr);
      setPrevChannelMetrics(channelPrev);

      setLoading(false);
      setHasLoadedOnce(true);

      setMultiPeriodStats({
        d7: { current: d7c, previous: d7p },
        d30: { current: d30c, previous: d30p },
        d90: { current: d90c, previous: d90p },
      });
      void resolveVideoAnomalyInsights(current);
      setLoadingMultiPeriod(false);
      perfLog('dashboard.load.total', dashboardLoadStart, { filtered: true });
    } catch (err: unknown) {
      console.error('Analytics Error:', err);
      if (!apply()) return;
      if (err instanceof UsageLimitError) {
        setUsageError({ limit: err.limit, used: err.used, message: err.message });
      } else {
        setError("We've hit a snag. Please try again in a moment or refresh the page.");
      }
      setLoading(false);
      setLoadingMultiPeriod(false);
      setHasLoadedOnce(true);
      perfLog('dashboard.load.total', dashboardLoadStart, { error: true });
    } finally {
      if (apply()) setIsRefreshing(false);
    }
  }, [analyticsService, loadingChannels, selectedChannel, personalEmpty, activeTab, getEffectiveToken, perfLog, user?.email, currentOrganization?.id, period, customStartDate, customEndDate, compareEnabled, trueDeltaEnabled, playlistAnalyticsScopeIds, selectedPlaylists, isLoadingPlaylists, selectedVideo, selectedVideoIds, visibilityFilter, videoTypeFilter, videoSearchQuery, selectedVideos, videos, filterByPlaylists, filterByVideos, setLatestDataDate]);

  useEffect(() => {
    // Defer to a microtask to avoid synchronously calling setState from the
    // effect body, which triggers the cascading-renders lint rule.
    Promise.resolve().then(() => loadAllData());
  }, [loadAllData]);

  useEffect(() => {
    const loadDimensions = async () => {
      if (!analyticsService || loadingChannels || !selectedChannel || personalEmpty) return;
      const requestChannel = selectedChannel;
      const stillCurrent = () => selectedChannelRef.current === requestChannel;

      const tokenToUse = await getEffectiveToken();
      if (!tokenToUse) return;

      const videoTabScopesDimensions = activeTab === 'videoAnalytics' || activeTab === 'audience';

      const filteredVideos = videoTabScopesDimensions
        ? getVideosByActiveFilters({
            videos: videos as FilterableVideo[],
            videoTypeFilter,
            videoSearchQuery,
            visibilityFilter,
            filterByPlaylists,
            selectedPlaylists,
            filterByVideos,
            selectedVideos,
          })
        : (videos as FilterableVideo[]);

      const audienceScope = buildAudienceFilterContext({
        selectedVideo,
        tableCheckedOverride: videoTabScopesDimensions ? tableCheckedOverride : null,
        selectedVideoIds: videoTabScopesDimensions ? selectedVideoIds : EMPTY_STRING_SET,
        hasVideoCountScope: videoTabScopesDimensions && hasChangedVideoLimit,
        activeListIds: videoTabScopesDimensions ? activeListIds : EMPTY_STRING_SET,
        isTemporaryList: videoTabScopesDimensions && isTemporaryList,
        videoTypeFilter: videoTabScopesDimensions ? videoTypeFilter : 'all',
        filterByPlaylists: videoTabScopesDimensions && filterByPlaylists,
        selectedPlaylists: videoTabScopesDimensions ? selectedPlaylists : EMPTY_STRING_SET,
        filterByVideos: videoTabScopesDimensions && filterByVideos,
        selectedVideos: videoTabScopesDimensions ? selectedVideos : EMPTY_STRING_SET,
        videoSearchQuery: videoTabScopesDimensions ? videoSearchQuery : '',
        filteredVideos,
      });

      if (!selectedVideo && audienceScope.hasExplicitScope && audienceScope.scopedCount === 0) {
        if (stillCurrent()) {
          setDimensionsMultiPeriod(null);
          setLoadingDimensions(false);
        }
        return;
      }

      if (activeTab !== 'audience') return;

      setLoadingDimensions(true);
      try {
        const svc = new AnalyticsService(tokenToUse, user!.email!, currentOrganization?.id);

        let resolvedLatest = latestDataDate;
        if (!resolvedLatest) {
          resolvedLatest = await svc.getLatestAvailableDate(requestChannel);
          if (!stillCurrent()) return;
          setLatestDataDate(resolvedLatest);
          latestDataDateRef.current = resolvedLatest;
        }

        const endRef = new Date(resolvedLatest);
        const anchorEnd = customEndDate ? customEndDate.toDate() : endRef;

        const allowImplicitVideoScope = videoTabScopesDimensions;
        const scopedVideoIdsForFilter = getVideoIdsForDimensionsFilter(
          audienceScope,
          selectedVideo,
          allowImplicitVideoScope
        );

        const rollingCurrent = (end: Date, days: number) => {
          const endDate = end.toISOString().split('T')[0];
          const startDate = new Date(end.getTime() - (days - 1) * 86400000).toISOString().split('T')[0];
          return { startDate, endDate };
        };
        const rollingPrevious = (end: Date, days: number) => {
          const prevEnd = new Date(end.getTime() - days * 86400000);
          const prevStart = new Date(end.getTime() - (2 * days - 1) * 86400000);
          return {
            startDate: prevStart.toISOString().split('T')[0],
            endDate: prevEnd.toISOString().split('T')[0],
          };
        };

        const fetchMergedBundle = async (startDate: string, endDate: string): Promise<DimensionsBundleData> => {
          if (scopedVideoIdsForFilter && scopedVideoIdsForFilter.length > DIMENSION_VIDEO_IDS_PER_ANALYTICS_FILTER) {
            const chunks = chunkArray(scopedVideoIdsForFilter, DIMENSION_VIDEO_IDS_PER_ANALYTICS_FILTER);
            const bundles = await Promise.all(
              chunks.map(ids =>
                svc.getDimensionsBundle({
                  channelId: requestChannel,
                  startDate,
                  endDate,
                  filters: `video==${ids.join(',')}`,
                })
              )
            );
            return mergeDimensionsBundles(bundles);
          }
          if (scopedVideoIdsForFilter?.length) {
            return svc.getDimensionsBundle({
              channelId: requestChannel,
              startDate,
              endDate,
              filters: `video==${scopedVideoIdsForFilter.join(',')}`,
            });
          }
          return svc.getDimensionsBundle({
            channelId: requestChannel,
            startDate,
            endDate,
          });
        };

        const w7c = rollingCurrent(anchorEnd, 7);
        const w7p = rollingPrevious(anchorEnd, 7);
        const w30c = rollingCurrent(anchorEnd, 30);
        const w30p = rollingPrevious(anchorEnd, 30);
        const w90c = rollingCurrent(anchorEnd, 90);
        const w90p = rollingPrevious(anchorEnd, 90);

        const emptyBundle: DimensionsBundleData = {
          trafficSource: null,
          gender: null,
          ageGroup: null,
          subscribedStatus: null,
          country: null,
          deviceType: null,
        };

        // Phase 1: fetch current windows first so audience cards paint quickly.
        const [b7c, b30c, b90c] = await Promise.all([
          fetchMergedBundle(w7c.startDate, w7c.endDate),
          fetchMergedBundle(w30c.startDate, w30c.endDate),
          fetchMergedBundle(w90c.startDate, w90c.endDate),
        ]);

        if (!stillCurrent()) return;
        setDimensionsMultiPeriod({
          d7: { current: b7c, previous: emptyBundle },
          d30: { current: b30c, previous: emptyBundle },
          d90: { current: b90c, previous: emptyBundle },
        });
        setLoadingDimensions(false);

        // Phase 2: fetch previous windows in background for optional deltas.
        void (async () => {
          try {
            const [b7p, b30p, b90p] = await Promise.all([
              fetchMergedBundle(w7p.startDate, w7p.endDate),
              fetchMergedBundle(w30p.startDate, w30p.endDate),
              fetchMergedBundle(w90p.startDate, w90p.endDate),
            ]);

            if (!stillCurrent()) return;
            setDimensionsMultiPeriod({
              d7: { current: b7c, previous: b7p },
              d30: { current: b30c, previous: b30p },
              d90: { current: b90c, previous: b90p },
            });
          } catch (err) {
            console.warn('[Dimensions] Previous-window load skipped:', err);
          }
        })();
      } catch (err) {
        console.warn('[Dimensions] Failed to load:', err);
        if (stillCurrent()) setDimensionsMultiPeriod(null);
      } finally {
        if (stillCurrent()) setLoadingDimensions(false);
      }
    };

    void loadDimensions();
  }, [activeTab, analyticsService, loadingChannels, latestDataDate, selectedChannel, selectedVideo, videos, videoTypeFilter, videoSearchQuery, visibilityFilter, filterByPlaylists, selectedPlaylists, period, filterByVideos, selectedVideos, tableCheckedOverride, selectedVideoIds, hasChangedVideoLimit, activeListIds, isTemporaryList, getEffectiveToken, currentOrganization?.id, user, setLatestDataDate, customStartDate, customEndDate, personalEmpty]);

  useEffect(() => {
    const fetchAllListsData = async () => {
      if (activeListIds.size === 0 || !latestDataDate || !user?.email || !selectedChannel || personalEmpty) return;

      const requestChannel = selectedChannel;
      const stillCurrent = () => selectedChannelRef.current === requestChannel;

      const tokenToUse = await getEffectiveToken();
      if (!tokenToUse) return;

      try {
        const svc = new AnalyticsService(tokenToUse, user.email, currentOrganization?.id);
        const channelIds = `channel==${requestChannel}`;

        let startDate: string;
        let endDate: string;

        if (customStartDate && customEndDate) {
          startDate = customStartDate.format('YYYY-MM-DD');
          endDate = customEndDate.format('YYYY-MM-DD');
        } else {
          const days = period ?? 30;
          const endRef = new Date(latestDataDate);
          endDate = endRef.toISOString().split('T')[0];
          startDate = new Date(endRef.getTime() - (days - 1) * 86400000).toISOString().split('T')[0];
        }

        const allVideoIds = new Set<string>();
        activeLists.forEach(list => {
          list.videoIds.forEach(id => allVideoIds.add(id));
        });

        if (allVideoIds.size === 0) {
          if (stillCurrent()) setFullListsData(null);
          return;
        }

        // YouTube Analytics API does not support dimensions: 'day,video'.
        const videoFilter = `video==${Array.from(allVideoIds).join(',')}`;
        const fullReport = await svc.getReport({
          ids: channelIds,
          startDate,
          endDate,
          metrics: 'views,estimatedMinutesWatched',
          dimensions: 'video',
          filters: videoFilter,
        });

        if (!stillCurrent()) return;
        setFullListsData(fullReport);
      } catch {
        if (stillCurrent()) setFullListsData(null);
      }
    };

    void fetchAllListsData();
  }, [getEffectiveToken, user?.email, activeListIds, activeLists, latestDataDate, period, selectedChannel, currentOrganization?.id, customStartDate, customEndDate, personalEmpty]);

  useEffect(() => {
    let cancelled = false;

    const performLoad = async () => {
      if (activeTab !== 'channelAnalytics') {
        if (!cancelled) setLoadingChannelAnalytics(false);
        return;
      }
      if (!analyticsService || loadingChannels || !selectedChannel) {
        if (!cancelled) setLoadingChannelAnalytics(false);
        return;
      }
      if (!latestDataDate) {
        if (!cancelled) setLoadingChannelAnalytics(true);
        return;
      }

      const requestChannel = selectedChannel;
      const stillCurrent = () => !cancelled && selectedChannelRef.current === requestChannel;

      if (!cancelled) setLoadingChannelAnalytics(true);
      try {
        const tokenToUse = await getEffectiveToken();
        if (!tokenToUse) return;

        const svc = new AnalyticsService(tokenToUse, user!.email!, currentOrganization?.id);
        const channelIds = `channel==${requestChannel}`;

        const endRef = new Date(latestDataDate);

        const dateRange = (offsetDays: number, windowDays: number) => {
          const end = new Date(endRef.getTime() - offsetDays * 86400000);
          const start = new Date(end.getTime() - (windowDays - 1) * 86400000);
          return { endDate: end.toISOString().split('T')[0], startDate: start.toISOString().split('T')[0] };
        };

        const curr =
          customStartDate && customEndDate
            ? { startDate: customStartDate.format('YYYY-MM-DD'), endDate: customEndDate.format('YYYY-MM-DD') }
            : dateRange(0, period ?? 30);

        const periodWindow = (windowDays: number, offsetDays = 0) => {
          const endC = new Date(endRef.getTime() - offsetDays * 86400000).toISOString().split('T')[0];
          const startC = new Date(new Date(endC).getTime() - (windowDays - 1) * 86400000).toISOString().split('T')[0];
          const endP = new Date(new Date(startC).getTime() - 86400000).toISOString().split('T')[0];
          const startP = new Date(new Date(endP).getTime() - (windowDays - 1) * 86400000).toISOString().split('T')[0];
          return { curr: { startDate: startC, endDate: endC }, prev: { startDate: startP, endDate: endP } };
        };

        const p7 = periodWindow(trueDeltaEnabled ? 8 : 7);
        const p30 = periodWindow(30, trueDeltaEnabled ? 8 : 0);
        const p90 = periodWindow(90, trueDeltaEnabled ? 38 : 0);

        const chMetrics =
          'views,subscribersGained,subscribersLost,estimatedMinutesWatched,likes,shares,comments';

        const fetchStatWindow = async (w: { startDate: string; endDate: string }): Promise<ChannelPeriodData> => {
          const report = await svc.getReport({
            ids: channelIds,
            ...w,
            metrics: chMetrics,
            dimensions: 'day',
            sort: 'day',
          });

          const rows = report.rows || [];
          const videosFromAPI = videos.filter(v => {
            const pubDate = new Date(v.publishedAt);
            const windowStart = new Date(w.startDate);
            const windowEnd = new Date(w.endDate);
            return pubDate >= windowStart && pubDate <= windowEnd;
          }).length;

          return {
            views: rows.reduce((s: number, r: unknown[]) => s + Number(r[1] || 0), 0),
            subscribersGained: rows.reduce((s: number, r: unknown[]) => s + Number(r[2] || 0), 0),
            subscribersLost: rows.reduce((s: number, r: unknown[]) => s + Number(r[3] || 0), 0),
            watchTime: rows.reduce((s: number, r: unknown[]) => s + Number(r[4] || 0), 0),
            likes: rows.reduce((s: number, r: unknown[]) => s + Number(r[5] || 0), 0),
            shares: rows.reduce((s: number, r: unknown[]) => s + Number(r[6] || 0), 0),
            comments: rows.reduce((s: number, r: unknown[]) => s + Number(r[7] || 0), 0),
            videosUploaded: videosFromAPI,
          };
        };

        const [current, d7c, d7p, d30c, d30p, d90c, d90p] = await Promise.all([
          svc.getReport({ ids: channelIds, ...curr, metrics: chMetrics, dimensions: 'day', sort: 'day' }),
          fetchStatWindow(p7.curr),
          fetchStatWindow(p7.prev),
          fetchStatWindow(p30.curr),
          fetchStatWindow(p30.prev),
          fetchStatWindow(p90.curr),
          fetchStatWindow(p90.prev),
        ]);

        if (!stillCurrent()) return;

        const currRows = current.rows || [];
        const videosInCurrent = videos.filter(v => {
          const pubDate = new Date(v.publishedAt);
          const windowStart = new Date(curr.startDate);
          const windowEnd = new Date(curr.endDate);
          return pubDate >= windowStart && pubDate <= windowEnd;
        }).length;

        setChannelAnalyticsData({
          views: currRows.reduce((s: number, r: unknown[]) => s + Number(r[1] || 0), 0),
          subscribersGained: currRows.reduce((s: number, r: unknown[]) => s + Number(r[2] || 0), 0),
          subscribersLost: currRows.reduce((s: number, r: unknown[]) => s + Number(r[3] || 0), 0),
          watchTime: currRows.reduce((s: number, r: unknown[]) => s + Number(r[4] || 0), 0),
          likes: currRows.reduce((s: number, r: unknown[]) => s + Number(r[5] || 0), 0),
          shares: currRows.reduce((s: number, r: unknown[]) => s + Number(r[6] || 0), 0),
          comments: currRows.reduce((s: number, r: unknown[]) => s + Number(r[7] || 0), 0),
          videosUploaded: videosInCurrent,
        });

        setChannelMultiPeriodStats({
          d7: { current: d7c, previous: d7p },
          d30: { current: d30c, previous: d30p },
          d90: { current: d90c, previous: d90p },
        });

        const uploadsByDate = videos.reduce((acc, v) => {
          const dateKey = new Date(v.publishedAt).toISOString().split('T')[0];
          if (dateKey >= curr.startDate && dateKey <= curr.endDate) {
            acc.set(dateKey, (acc.get(dateKey) || 0) + 1);
          }
          return acc;
        }, new Map<string, number>());

        const chartData = currRows.map((row: unknown[]) => {
          const date = row[0];
          return {
            date,
            views: Number(row[1] || 0),
            subscribersGained: Number(row[2] || 0),
            subscribersLost: Number(row[3] || 0),
            watchTime: Number(row[4] || 0),
            likes: Number(row[5] || 0),
            shares: Number(row[6] || 0),
            comments: Number(row[7] || 0),
            uploads: uploadsByDate.get(String(date)) || 0,
          };
        });
        setChannelAnalyticsChartData(chartData);
      } catch (err) {
        console.error('Channel Analytics Error:', err);
        if (!stillCurrent()) return;
        setChannelAnalyticsData({
          views: 0,
          subscribersGained: 0,
          subscribersLost: 0,
          watchTime: 0,
          videosUploaded: 0,
          likes: 0,
          comments: 0,
          shares: 0,
        });
        setChannelMultiPeriodStats(null);
        setChannelAnalyticsChartData([]);
      } finally {
        if (stillCurrent()) setLoadingChannelAnalytics(false);
      }
    };

    void performLoad();

    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    analyticsService,
    loadingChannels,
    latestDataDate,
    selectedChannel,
    period,
    trueDeltaEnabled,
    videos,
    getEffectiveToken,
    currentOrganization?.id,
    user,
    customStartDate,
    customEndDate,
  ]);

  return {
    reportData,
    prevReportData,
    channelMetrics,
    prevChannelMetrics,
    multiPeriodStats: multiPeriodStats ?? {
      d7: { current: {} as PeriodData, previous: {} as PeriodData },
      d30: { current: {} as PeriodData, previous: {} as PeriodData },
      d90: { current: {} as PeriodData, previous: {} as PeriodData },
    },
    channelMultiPeriodStats,
    channelAnalyticsData,
    channelAnalyticsChartData,
    videoAnomalyInsights,
    fullListsData,
    dimensionsMultiPeriod,
    loading,
    loadingMultiPeriod,
    isRefreshing,
    loadingChannelAnalytics,
    loadingDimensions,
    hasLoadedOnce,
    error,
    usageError,
  };
};

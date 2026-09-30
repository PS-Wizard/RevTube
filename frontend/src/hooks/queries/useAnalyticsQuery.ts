/**
 * useAnalyticsQuery - Video / playlist analytics via dashboard bundle (parity with v1 useDashboardAnalytics).
 * Updates Zustand analytics slice: reports, channel subscriber series, multi-period pills, anomaly insights.
 */

import { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useDashboardStore } from '../../stores/dashboardStore';
import { useUsageStore } from '../../stores/usageStore';
import { AnalyticsService, UsageLimitError } from '../../services/analyticsService';
import { useAuth } from '../useAuth';
import { useOrganization } from '../useOrganization';
import {
  DASHBOARD_WS_KEY_PENDING,
  REVTUBE_DASHBOARD_WS_ROOT,
  getDashboardWorkspaceKey,
} from '../../utils/dashboardWorkspaceScope';
import { resolveVideoAnomalyInsights } from '../../utils/resolveVideoAnomalyInsights';
import type { VideoMetadata } from '../../types/youtube';

type CustomDateInput = string | dayjs.Dayjs | null;

interface UseAnalyticsQueryOptions {
  channelId: string | null;
  selectedVideo: VideoMetadata | null;
  /** Video graph scope from DashboardPage (opened video handled separately):
   *  explicit row checks → narrowing toolbar filters expanded to IDs →
   *  null (channel-wide). */
  scopedVideoIds: string[] | null;
  /** Playlist graph scope from DashboardPage: checked rows ∩ visible rows
   *  (list scope + status/activity filters), sorted. Empty = empty graph. */
  scopedPlaylistIds: string[];
  activeTab: string;
  period: number | null;
  customStartDate: CustomDateInput;
  customEndDate: CustomDateInput;
  compareEnabled: boolean;
  trueDeltaEnabled: boolean;
  latestDataDate: string | null;
  videos: VideoMetadata[];
  getEffectiveToken: (channelId: string) => Promise<string | null>;
  onPersistLatestDate?: (channelId: string, date: string) => void;
  enabled?: boolean;
}

/** Marker filter meaning "playlist scope is empty" -- the query short-circuits
 *  to an empty bundle without fetching (legacy EMPTY_PLAYLIST_ANALYTICS_REPORT
 *  parity). Never sent to the backend. */
export const EMPTY_PLAYLIST_SCOPE = '__EMPTY_PLAYLIST_SCOPE__';

/** Empty bundle shape shared by the personal-empty and empty-scope paths. */
const EMPTY_BUNDLE = {
  current: null,
  previous: null,
  channelCurrent: null,
  channelPrevious: null,
  channelTotals: null,
  prevChannelTotals: null,
  d7: { current: null, previous: null },
  d30: { current: null, previous: null },
  d90: { current: null, previous: null },
  latestDate: '',
} as never;

const day = (d: CustomDateInput) => (d ? dayjs(d) : null);

export const useAnalyticsQuery = ({
  channelId,
  selectedVideo,
  scopedVideoIds,
  scopedPlaylistIds,
  activeTab,
  period,
  customStartDate,
  customEndDate,
  compareEnabled,
  trueDeltaEnabled,
  latestDataDate,
  videos,
  getEffectiveToken,
  onPersistLatestDate,
  enabled = true,
}: UseAnalyticsQueryOptions) => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { currentOrganization, isPersonalContext } = useOrganization();
  const channels = useDashboardStore((state) => state.channel.channels);
  const workspaceKey =
    getDashboardWorkspaceKey({
      userId: user?.uid,
      isPersonalContext,
      organizationId: currentOrganization?.id,
    }) ?? DASHBOARD_WS_KEY_PENDING;
  const setAnalyticsData = useDashboardStore(state => state.setAnalyticsData);
  const setAnalyticsLoading = useDashboardStore(state => state.setAnalyticsLoading);
  const setAnalyticsError = useDashboardStore(state => state.setAnalyticsError);
  const insightEnrichmentGenRef = useRef(0);
  const [enrichingVideoInsights, setEnrichingVideoInsights] = useState(false);
  // Tracks the last bundle.current reference we ran enrichment for. trueDelta changes
  // produce a new query.data object but with the SAME bundle.current rows (trueDelta
  // only affects d7/d30/d90 pills, not the main chart series). Skipping re-enrichment
  // in that case prevents the chart from showing "Updating" after a trueDelta toggle.
  const lastEnrichedCurrentRef = useRef<unknown>(null);

  const startD = day(customStartDate);
  const endD = day(customEndDate);
  const hasCustomRange = !!(startD?.isValid() && endD?.isValid());

  const buildVideoFilters = (): string | undefined => {
    if (activeTab === 'playlistAnalytics') {
      // Empty scope = empty graph (no fetch); unchecking everything must not
      // fall back to channel-wide the way an absent filter does.
      if (scopedPlaylistIds.length === 0) return EMPTY_PLAYLIST_SCOPE;
      return `playlist==${scopedPlaylistIds.join(',')}`;
    }
    if (activeTab === 'videoAnalytics') {
      if (selectedVideo) {
        return `video==${selectedVideo.videoId}`;
      }
      if (scopedVideoIds && scopedVideoIds.length > 0) {
        return `video==${scopedVideoIds.join(',')}`;
      }
    }
    return undefined;
  };

  const videoFiltersKey = buildVideoFilters() ?? 'nofilter';

  const query = useQuery({
    queryKey: [
      REVTUBE_DASHBOARD_WS_ROOT,
      workspaceKey,
      'analytics',
      channelId,
      activeTab,
      selectedVideo?.videoId ?? '',
      scopedVideoIds?.join(',') ?? '',
      scopedPlaylistIds.join(','),
      period,
      startD?.format('YYYY-MM-DD') ?? '',
      endD?.format('YYYY-MM-DD') ?? '',
      compareEnabled,
      trueDeltaEnabled,
      latestDataDate ?? '',
      videoFiltersKey,
    ],
    queryFn: async () => {
      const stableChannelId = channelId;
      const userEmail = user?.email;
      if (!stableChannelId || !userEmail) {
        throw new Error('Missing channel or user');
      }

      const personalEmpty = isPersonalContext && channels.length === 0;
      if (personalEmpty) {
        return {
          bundle: EMPTY_BUNDLE,
          videoFilters: buildVideoFilters(),
        };
      }

      const token = await getEffectiveToken(stableChannelId);
      if (!token) {
        throw new Error('No access token available');
      }
      const service = new AnalyticsService(token, userEmail, currentOrganization?.id);
      const videoFilters = buildVideoFilters();

      // Nothing in scope (all playlist rows unchecked, or selection hidden by
      // the status/activity filter): serve the empty graph without burning quota.
      if (videoFilters === EMPTY_PLAYLIST_SCOPE) {
        return { bundle: EMPTY_BUNDLE, videoFilters };
      }

      const bundle = await service.getDashboardBundle({
        channelId: stableChannelId,
        period: hasCustomRange ? undefined : (period ?? 30),
        startDate: hasCustomRange ? startD!.format('YYYY-MM-DD') : undefined,
        endDate: hasCustomRange ? endD!.format('YYYY-MM-DD') : undefined,
        compare: compareEnabled,
        trueDelta: trueDeltaEnabled,
        filters: videoFilters,
        latestDate: latestDataDate || undefined,
        fields: ['channelTotals', 'chartData', 'comparison'],
      });

      if (bundle._usage) {
        useUsageStore.getState().updateUsage(bundle._usage.pageKey, bundle._usage.used, bundle._usage.limit);
      }

      return { bundle, videoFilters };
    },
    enabled: enabled && !!channelId && !!user?.email && (activeTab === 'videoAnalytics' || activeTab === 'playlistAnalytics') && !(isPersonalContext && channels.length === 0),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    placeholderData: keepPreviousData,
    retry: 2,
    meta: { suppressGlobalErrorToast: true },
  });

  useEffect(() => {
    const stableChannelId = channelId;
    const userEmail = user?.email;
    if (!enabled || !stableChannelId || !userEmail) return;
    if (activeTab !== 'videoAnalytics') return;
    if (selectedVideo) return;
    // Prefetch the likely next graphs (one fewer video) so unchecking a row
    // paints instantly. Keys mirror the main query (scoped IDs), so prefetches
    // land in the entries the chart will actually read.
    if (!scopedVideoIds || scopedVideoIds.length < 2) return;
    if (hasCustomRange) return;

    const tokenPromise = getEffectiveToken(stableChannelId);
    const sortedIds = [...scopedVideoIds].sort();
    const candidateSets = sortedIds.slice(0, 3).map((idToRemove) =>
      sortedIds.filter((id) => id !== idToRemove)
    );

    candidateSets.forEach((candidateIds) => {
      const candidateFilter = candidateIds.length ? `video==${candidateIds.join(',')}` : undefined;
      const key = [
        REVTUBE_DASHBOARD_WS_ROOT,
        workspaceKey,
        'analytics',
        stableChannelId,
        activeTab,
        '',
        candidateIds.join(','),
        scopedPlaylistIds.join(','),
        period,
        '',
        '',
        compareEnabled,
        trueDeltaEnabled,
        latestDataDate ?? '',
        candidateFilter ?? 'nofilter',
      ] as const;

      void queryClient.prefetchQuery({
        queryKey: key,
        queryFn: async ({ signal }) => {
          const token = await tokenPromise;
          if (!token) throw new Error('No access token available');
          const service = new AnalyticsService(token, userEmail, currentOrganization?.id);
          const bundle = await service.getDashboardBundle({
            channelId: stableChannelId,
            period: period ?? 30,
            compare: compareEnabled,
            trueDelta: trueDeltaEnabled,
            filters: candidateFilter,
            latestDate: latestDataDate || undefined,
            fields: ['channelTotals', 'chartData', 'comparison'],
          });

          const channelIds = `channel==${stableChannelId}`;
          const videoAnomalyInsights = signal.aborted
            ? []
            : await resolveVideoAnomalyInsights({
                activeTab,
                selectedVideo: null,
                currentReport: bundle.current,
                videoFilters: candidateFilter,
                videos,
                svc: service,
                channelIds,
                signal,
              });

          return { bundle, videoAnomalyInsights };
        },
        staleTime: 5 * 60 * 1000,
      });
    });
  }, [
    enabled,
    channelId,
    user?.email,
    activeTab,
    selectedVideo,
    scopedVideoIds,
    hasCustomRange,
    getEffectiveToken,
    workspaceKey,
    scopedPlaylistIds,
    period,
    compareEnabled,
    trueDeltaEnabled,
    latestDataDate,
    queryClient,
    currentOrganization?.id,
    videos,
  ]);

  useEffect(() => {
    setAnalyticsLoading(query.isLoading);
  }, [query.isLoading, setAnalyticsLoading]);

  useEffect(() => {
    const next = query.isFetching && !query.isLoading;
    if (useDashboardStore.getState().analytics.isRefreshing !== next) {
      setAnalyticsData({ isRefreshing: next });
    }
  }, [query.isFetching, query.isLoading, setAnalyticsData]);

  useEffect(() => {
    if (!query.data) return;

    const { bundle } = query.data;

    setAnalyticsData({
      reportData: bundle.current,
      prevReportData: bundle.previous,
      channelMetrics: bundle.channelCurrent,
      prevChannelMetrics: bundle.channelPrevious,
      bundleChannelTotals: bundle.channelTotals,
      bundlePrevChannelTotals: bundle.prevChannelTotals,
      multiPeriodStats: {
        d7: { current: bundle.d7?.current, previous: bundle.d7?.previous },
        d30: { current: bundle.d30?.current, previous: bundle.d30?.previous },
        d90: { current: bundle.d90?.current, previous: bundle.d90?.previous },
      },
      hasLoadedOnce: true,
      loadingMultiPeriod: false,
      error: null,
      usageError: null,
    } as never);

    if (bundle._usage) {
      useUsageStore.getState().updateUsage(
        bundle._usage.pageKey,
        bundle._usage.used,
        bundle._usage.limit,
      );
    }

    if (bundle.latestDate && channelId && onPersistLatestDate) {
      const currentLatest = useDashboardStore.getState().dateRange.latestDataDate;
      if (bundle.latestDate !== currentLatest) {
        onPersistLatestDate(channelId, bundle.latestDate);
      }
    }

    queryClient.invalidateQueries({ queryKey: ['usage:me', user?.email] });
  }, [query.data, setAnalyticsData, channelId, onPersistLatestDate, queryClient, user?.email]);

  useEffect(() => {
    const stableChannelId = channelId;
    const userEmail = user?.email;

    if (!query.data || !stableChannelId || !userEmail) {
      insightEnrichmentGenRef.current += 1;
      requestAnimationFrame(() => setEnrichingVideoInsights(false));
      return;
    }

    const { bundle, videoFilters } = query.data;

    // trueDelta only changes d7/d30/d90 pills -- bundle.current (the chart series) is
    // identical across trueDelta=false and trueDelta=true for the same period/filters.
    // Avoid re-running the expensive anomaly enrichment when only the pills changed.
    if (bundle.current === lastEnrichedCurrentRef.current) {
      return;
    }
    lastEnrichedCurrentRef.current = bundle.current;

    const myGen = (insightEnrichmentGenRef.current += 1);
    setEnrichingVideoInsights(true);
    const controller = new AbortController();

    const run = async () => {
      try {
        const token = await getEffectiveToken(stableChannelId);
        if (!token || controller.signal.aborted) return;
        const service = new AnalyticsService(token, userEmail, currentOrganization?.id);
        const channelIds = `channel==${stableChannelId}`;
        const videoAnomalyInsights = await resolveVideoAnomalyInsights({
          activeTab,
          selectedVideo,
          currentReport: bundle.current,
          videoFilters: videoFilters,
          videos,
          svc: service,
          channelIds,
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setAnalyticsData({ videoAnomalyInsights } as never);
        }
      } catch {
        // Best-effort background enrichment; keep chart paint path fast.
      } finally {
        if (insightEnrichmentGenRef.current === myGen) {
          setEnrichingVideoInsights(false);
        }
      }
    };

    void run();
    return () => controller.abort();
  }, [
    query.data,
    channelId,
    user?.email,
    getEffectiveToken,
    currentOrganization?.id,
    activeTab,
    selectedVideo,
    videos,
    setAnalyticsData,
  ]);

  useEffect(() => {
    if (!query.error) {
      setAnalyticsError(null);
      return;
    }

    const err = query.error;
    if (err instanceof UsageLimitError) {
      setAnalyticsData({
        usageError: {
          limit: err.limit,
          used: err.used,
          message: err.message,
        },
      });
      setAnalyticsError(null);
      return;
    }

    setAnalyticsError(err instanceof Error ? err.message : 'Failed to load analytics');
  }, [query.error, setAnalyticsError, setAnalyticsData]);

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    enrichingVideoInsights,
  };
};

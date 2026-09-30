/**
 * Channel analytics tab: daily metrics chart, multi-period stats, uploads overlay.
 * Parity with useDashboardAnalytics loadChannelAnalytics.
 */

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useDashboardStore } from '../../stores/dashboardStore';
import { AnalyticsService, UsageLimitError } from '../../services/analyticsService';
import { useAuth } from '../useAuth';
import { useOrganization } from '../useOrganization';
import {
  DASHBOARD_WS_KEY_PENDING,
  REVTUBE_DASHBOARD_WS_ROOT,
  getDashboardWorkspaceKey,
} from '../../utils/dashboardWorkspaceScope';

type CustomDateInput = string | dayjs.Dayjs | null;

type ChannelPeriodData = {
  views: number;
  subscribersGained: number;
  subscribersLost: number;
  watchTime: number;
  videosUploaded: number;
  likes: number;
  comments: number;
  shares: number;
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
};

interface UseChannelAnalyticsQueryOptions {
  channelId: string | null;
  period: number | null;
  customStartDate: CustomDateInput;
  customEndDate: CustomDateInput;
  getEffectiveToken: (channelId: string) => Promise<string | null>;
  enabled?: boolean;
}

const d = (x: CustomDateInput) => (x ? dayjs(x) : null);

export const useChannelAnalyticsQuery = ({
  channelId,
  period,
  customStartDate,
  customEndDate,
  getEffectiveToken,
  enabled = true,
}: UseChannelAnalyticsQueryOptions) => {
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
  const videos = useDashboardStore(state => state.videos.videos);
  const trueDeltaEnabled = useDashboardStore(state => state.ui.trueDeltaEnabled);
  const latestDataDate = useDashboardStore(state => state.dateRange.latestDataDate);
  const setAnalyticsData = useDashboardStore(state => state.setAnalyticsData);
  const setChannelAnalyticsLoading = useDashboardStore(state => state.setChannelAnalyticsLoading);
  const setAnalyticsError = useDashboardStore(state => state.setAnalyticsError);

  const startD = d(customStartDate);
  const endD = d(customEndDate);
  const hasCustom = !!(startD?.isValid() && endD?.isValid());

  const query = useQuery({
    queryKey: [
      REVTUBE_DASHBOARD_WS_ROOT,
      workspaceKey,
      'channelAnalytics',
      channelId,
      period,
      startD?.format('YYYY-MM-DD') ?? '',
      endD?.format('YYYY-MM-DD') ?? '',
      trueDeltaEnabled,
      latestDataDate ?? '',
      videos.length,
    ],
    queryFn: async () => {
      if (!channelId || !user?.email) {
        throw new Error('Missing channel or user');
      }

      const token = await getEffectiveToken(channelId);
      if (!token) {
        throw new Error('No access token available');
      }
      console.log('[Token][useChannelAnalyticsQuery] Successfully resolved token for channel:', channelId);

      const svc = new AnalyticsService(token, user.email, currentOrganization?.id);
      const channelIds = `channel==${channelId}`;
      // YouTube Analytics lags ~1–3 days; when we have no persisted "latest" yet (channel tab first visit),
      // anchor ranges on UTC two days ago so the query can run without opening Video Analytics first.
      const endRef = latestDataDate
        ? new Date(latestDataDate)
        : (() => {
            const d = new Date();
            d.setUTCDate(d.getUTCDate() - 2);
            d.setUTCHours(23, 59, 59, 999);
            return d;
          })();

      const dateRange = (offsetDays: number, windowDays: number) => {
        const end = new Date(endRef.getTime() - offsetDays * 86400000);
        const start = new Date(end.getTime() - (windowDays - 1) * 86400000);
        return { endDate: end.toISOString().split('T')[0], startDate: start.toISOString().split('T')[0] };
      };

      const curr = hasCustom
        ? { startDate: startD!.format('YYYY-MM-DD'), endDate: endD!.format('YYYY-MM-DD') }
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
        'views,subscribersGained,subscribersLost,estimatedMinutesWatched,likes,shares,comments,' +
        'averageViewDuration,engagedViews,viewerPercentage,' +
        'cardImpressions,cardClicks,cardClickRate,cardTeaserImpressions,cardTeaserClicks,cardTeaserClickRate,' +
        'averageConcurrentViewers,peakConcurrentViewers';

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
          averageViewDuration: rows.reduce((s: number, r: unknown[]) => s + Number(r[8] || 0), 0),
          engagedViews: rows.reduce((s: number, r: unknown[]) => s + Number(r[9] || 0), 0),
          viewerPercentage: rows.reduce((s: number, r: unknown[]) => s + Number(r[10] || 0), 0),
          cardImpressions: rows.reduce((s: number, r: unknown[]) => s + Number(r[11] || 0), 0),
          cardClicks: rows.reduce((s: number, r: unknown[]) => s + Number(r[12] || 0), 0),
          cardClickRate: rows.reduce((s: number, r: unknown[]) => s + Number(r[13] || 0), 0),
          cardTeaserImpressions: rows.reduce((s: number, r: unknown[]) => s + Number(r[14] || 0), 0),
          cardTeaserClicks: rows.reduce((s: number, r: unknown[]) => s + Number(r[15] || 0), 0),
          cardTeaserClickRate: rows.reduce((s: number, r: unknown[]) => s + Number(r[16] || 0), 0),
          averageConcurrentViewers: rows.reduce((s: number, r: unknown[]) => s + Number(r[17] || 0), 0),
          peakConcurrentViewers: rows.reduce((s: number, r: unknown[]) => s + Number(r[18] || 0), 0),
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

      const currRows = current.rows || [];
      const videosInCurrent = videos.filter(v => {
        const pubDate = new Date(v.publishedAt);
        const windowStart = new Date(curr.startDate);
        const windowEnd = new Date(curr.endDate);
        return pubDate >= windowStart && pubDate <= windowEnd;
      }).length;

      const channelAnalyticsData = {
        views: currRows.reduce((s: number, r: unknown[]) => s + Number(r[1] || 0), 0),
        subscribersGained: currRows.reduce((s: number, r: unknown[]) => s + Number(r[2] || 0), 0),
        subscribersLost: currRows.reduce((s: number, r: unknown[]) => s + Number(r[3] || 0), 0),
        watchTime: currRows.reduce((s: number, r: unknown[]) => s + Number(r[4] || 0), 0),
        likes: currRows.reduce((s: number, r: unknown[]) => s + Number(r[5] || 0), 0),
        shares: currRows.reduce((s: number, r: unknown[]) => s + Number(r[6] || 0), 0),
        comments: currRows.reduce((s: number, r: unknown[]) => s + Number(r[7] || 0), 0),
        averageViewDuration: currRows.reduce((s: number, r: unknown[]) => s + Number(r[8] || 0), 0),
        engagedViews: currRows.reduce((s: number, r: unknown[]) => s + Number(r[9] || 0), 0),
        viewerPercentage: currRows.reduce((s: number, r: unknown[]) => s + Number(r[10] || 0), 0),
        cardImpressions: currRows.reduce((s: number, r: unknown[]) => s + Number(r[11] || 0), 0),
        cardClicks: currRows.reduce((s: number, r: unknown[]) => s + Number(r[12] || 0), 0),
        cardClickRate: currRows.reduce((s: number, r: unknown[]) => s + Number(r[13] || 0), 0),
        cardTeaserImpressions: currRows.reduce((s: number, r: unknown[]) => s + Number(r[14] || 0), 0),
        cardTeaserClicks: currRows.reduce((s: number, r: unknown[]) => s + Number(r[15] || 0), 0),
        cardTeaserClickRate: currRows.reduce((s: number, r: unknown[]) => s + Number(r[16] || 0), 0),
        averageConcurrentViewers: currRows.reduce((s: number, r: unknown[]) => s + Number(r[17] || 0), 0),
        peakConcurrentViewers: currRows.reduce((s: number, r: unknown[]) => s + Number(r[18] || 0), 0),
        videosUploaded: videosInCurrent,
      };

      const channelMultiPeriodStats = {
        d7: { current: d7c, previous: d7p },
        d30: { current: d30c, previous: d30p },
        d90: { current: d90c, previous: d90p },
      };

      const uploadsByDate = videos.reduce((acc, v) => {
        const dateKey = new Date(v.publishedAt).toISOString().split('T')[0];
        if (dateKey >= curr.startDate && dateKey <= curr.endDate) {
          acc.set(dateKey, (acc.get(dateKey) || 0) + 1);
        }
        return acc;
      }, new Map<string, number>());

      const channelAnalyticsChartData = currRows.map((row: unknown[]) => {
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
          averageViewDuration: Number(row[8] || 0),
          engagedViews: Number(row[9] || 0),
          viewerPercentage: Number(row[10] || 0),
          cardImpressions: Number(row[11] || 0),
          cardClicks: Number(row[12] || 0),
          cardClickRate: Number(row[13] || 0),
          cardTeaserImpressions: Number(row[14] || 0),
          cardTeaserClicks: Number(row[15] || 0),
          cardTeaserClickRate: Number(row[16] || 0),
          averageConcurrentViewers: Number(row[17] || 0),
          peakConcurrentViewers: Number(row[18] || 0),
          uploads: uploadsByDate.get(String(date)) || 0,
        };
      });

      return {
        channelAnalyticsData,
        channelAnalyticsChartData,
        channelMultiPeriodStats,
      };
    },
    enabled: enabled && !!channelId && !!user?.email && !(isPersonalContext && channels.length === 0),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 2,
    meta: { suppressGlobalErrorToast: true },
  });

  useEffect(() => {
    setChannelAnalyticsLoading(query.isLoading);
  }, [query.isLoading, setChannelAnalyticsLoading]);

  useEffect(() => {
    if (!query.data) return;
    setAnalyticsData({
      channelAnalyticsData: query.data.channelAnalyticsData,
      channelAnalyticsChartData: query.data.channelAnalyticsChartData,
      channelMultiPeriodStats: query.data.channelMultiPeriodStats,
    } as never);
    // Invalidate the sidebar usage bar so it picks up the latest count.
    // The channel tab's getReport calls often hit the frontend analytics
    // cache (mem + sessionStorage) which does not carry _usage, so the
    // Zustand usage store may not receive an update.  Kicking a background
    // refetch of /usage/me ensures the sidebar shows the correct count.
    queryClient.invalidateQueries({ queryKey: ['usage:me', user?.email] });
  }, [query.data, setAnalyticsData, queryClient, user?.email]);

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

    setAnalyticsError(err instanceof Error ? err.message : 'Failed to load channel analytics');
  }, [query.error, setAnalyticsError, setAnalyticsData]);

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
};

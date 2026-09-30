/**
 * Channel Analytics tab -- single combined endpoint.
 * Replaces useChannelAnalyticsQuery which made 7 separate report calls.
 * 1 endpoint = 1 quota unit.
 */

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useDashboardStore } from '../../stores/dashboardStore';
import { useUsageStore } from '../../stores/usageStore';
import { useAuth } from '../useAuth';
import { useOrganization } from '../useOrganization';
import {
  DASHBOARD_WS_KEY_PENDING,
  REVTUBE_DASHBOARD_WS_ROOT,
  getDashboardWorkspaceKey,
} from '../../utils/dashboardWorkspaceScope';
import { getFirebaseAuthHeader } from '../../services/authHeaders';
import { getResolvedApiBaseUrl } from '../../utils/apiBase';
import { UsageLimitError } from '../../services/analyticsService';
import type { AnalyticsReport } from '../../services/analyticsService';

type CustomDateInput = string | dayjs.Dayjs | null;

/**
 * The backend /dashboard/tab/channel returns each 7d/30d/90d window as a raw
 * YouTube report ({ rows, columnHeaders }). The dashboard pills read flat
 * numeric keys (current.views, previous.views...), so flatten each window's
 * rows into that shape. Window boundaries use the same computePeriodWindow
 * math as the backend so the per-window upload count aligns with the rows.
 */
interface ChannelPeriodData {
  views: number;
  subscribersGained: number;
  subscribersLost: number;
  watchTime: number;
  likes: number;
  shares: number;
  comments: number;
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
  videosUploaded: number;
}

function flattenChannelMultiPeriod(
  raw: { d7: { current: AnalyticsReport; previous: AnalyticsReport }; d30: { current: AnalyticsReport; previous: AnalyticsReport }; d90: { current: AnalyticsReport; previous: AnalyticsReport } },
  endRef: Date,
  trueDeltaEnabled: boolean,
  videos: Array<{ publishedAt: string }>,
): { d7: { current: ChannelPeriodData; previous: ChannelPeriodData }; d30: { current: ChannelPeriodData; previous: ChannelPeriodData }; d90: { current: ChannelPeriodData; previous: ChannelPeriodData } } {
  const toISO = (d: Date) => d.toISOString().split('T')[0];

  const windowBounds = (windowDays: number, offsetDays = 0) => {
    const endC = new Date(endRef.getTime() - offsetDays * 86400000);
    const endCurr = toISO(endC);
    const startCurr = toISO(new Date(endC.getTime() - (windowDays - 1) * 86400000));
    const endPrev = toISO(new Date(new Date(startCurr).getTime() - 86400000));
    const startPrev = toISO(new Date(new Date(endPrev).getTime() - (windowDays - 1) * 86400000));
    return { curr: { startDate: startCurr, endDate: endCurr }, prev: { startDate: startPrev, endDate: endPrev } };
  };

  const td = trueDeltaEnabled;
  const p7 = windowBounds(td ? 8 : 7);
  const p30 = windowBounds(td ? 38 : 30);
  const p90 = windowBounds(td ? 38 : 90);

  const countUploads = (w: { startDate: string; endDate: string }) =>
    videos.filter((v) => {
      // Compare UTC calendar dates (inclusive on both ends). A Date-object
      // comparison drops videos published later in the day than the window's
      // end date (e.g. publishedAt 15:00 vs endDate midnight).
      const d = v.publishedAt.slice(0, 10);
      return !!d && d >= w.startDate && d <= w.endDate;
    }).length;

  const flattenReport = (report: AnalyticsReport, w: { startDate: string; endDate: string }): ChannelPeriodData => {
    const rows = report?.rows || [];
    return {
      views: rows.reduce((s, r) => s + Number(r[1] || 0), 0),
      subscribersGained: rows.reduce((s, r) => s + Number(r[2] || 0), 0),
      subscribersLost: rows.reduce((s, r) => s + Number(r[3] || 0), 0),
      watchTime: rows.reduce((s, r) => s + Number(r[4] || 0), 0),
      likes: rows.reduce((s, r) => s + Number(r[5] || 0), 0),
      shares: rows.reduce((s, r) => s + Number(r[6] || 0), 0),
      comments: rows.reduce((s, r) => s + Number(r[7] || 0), 0),
      averageViewDuration: rows.reduce((s, r) => s + Number(r[8] || 0), 0),
      engagedViews: rows.reduce((s, r) => s + Number(r[9] || 0), 0),
      viewerPercentage: rows.reduce((s, r) => s + Number(r[10] || 0), 0),
      cardImpressions: rows.reduce((s, r) => s + Number(r[11] || 0), 0),
      cardClicks: rows.reduce((s, r) => s + Number(r[12] || 0), 0),
      cardClickRate: rows.reduce((s, r) => s + Number(r[13] || 0), 0),
      cardTeaserImpressions: rows.reduce((s, r) => s + Number(r[14] || 0), 0),
      cardTeaserClicks: rows.reduce((s, r) => s + Number(r[15] || 0), 0),
      cardTeaserClickRate: rows.reduce((s, r) => s + Number(r[16] || 0), 0),
      averageConcurrentViewers: rows.reduce((s, r) => s + Number(r[17] || 0), 0),
      peakConcurrentViewers: rows.reduce((s, r) => s + Number(r[18] || 0), 0),
      videosUploaded: countUploads(w),
    };
  };

  return {
    d7: { current: flattenReport(raw.d7.current, p7.curr), previous: flattenReport(raw.d7.previous, p7.prev) },
    d30: { current: flattenReport(raw.d30.current, p30.curr), previous: flattenReport(raw.d30.previous, p30.prev) },
    d90: { current: flattenReport(raw.d90.current, p90.curr), previous: flattenReport(raw.d90.previous, p90.prev) },
  };
}

interface ChannelTabResponse {
  channelAnalyticsData: {
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
  channelAnalyticsChartData: Array<{
    date: string;
    views: number;
    subscribersGained: number;
    subscribersLost: number;
    watchTime: number;
    likes: number;
    shares: number;
    comments: number;
    uploads: number;
  }>;
  channelMultiPeriodStats: {
    d7: { current: AnalyticsReport; previous: AnalyticsReport };
    d30: { current: AnalyticsReport; previous: AnalyticsReport };
    d90: { current: AnalyticsReport; previous: AnalyticsReport };
  };
  latestDate?: string;
  _usage?: { used: number; limit: number; pageKey: string };
}

interface UseChannelTabQueryOptions {
  channelId: string | null;
  period: number | null;
  customStartDate: CustomDateInput;
  customEndDate: CustomDateInput;
  getEffectiveToken: (channelId: string) => Promise<string | null>;
  onPersistLatestDate?: (channelId: string, date: string) => void;
  enabled?: boolean;
}

export const useChannelTabQuery = ({
  channelId,
  period,
  customStartDate,
  customEndDate,
  getEffectiveToken,
  onPersistLatestDate,
  enabled = true,
}: UseChannelTabQueryOptions) => {
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
  const trueDeltaEnabled = useDashboardStore(state => state.ui.trueDeltaEnabled);
  const latestDataDate = useDashboardStore(state => state.dateRange.latestDataDate);
  const videos = useDashboardStore(state => state.videos.videos);
  const setAnalyticsData = useDashboardStore(state => state.setAnalyticsData);
  const setChannelAnalyticsLoading = useDashboardStore(state => state.setChannelAnalyticsLoading);
  const setAnalyticsError = useDashboardStore(state => state.setAnalyticsError);

  const startD = customStartDate ? dayjs(customStartDate) : null;
  const endD = customEndDate ? dayjs(customEndDate) : null;
  const hasCustom = !!(startD?.isValid() && endD?.isValid());

  const query = useQuery({
    queryKey: [
      REVTUBE_DASHBOARD_WS_ROOT,
      workspaceKey,
      'channelTab',
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

      const baseUrl = getResolvedApiBaseUrl();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...(await getFirebaseAuthHeader()),
      };
      if (currentOrganization?.id) headers['X-Org-Id'] = currentOrganization.id;

      const body: Record<string, unknown> = {
        channelId,
        period: period ?? 30,
        trueDelta: trueDeltaEnabled,
        latestDate: latestDataDate || undefined,
        videosLength: channels.length > 0 ? videos.length : undefined,
      };
      if (hasCustom) {
        body.startDate = startD!.format('YYYY-MM-DD');
        body.endDate = endD!.format('YYYY-MM-DD');
      }

      const response = await fetch(`${baseUrl}/dashboard/tab/channel`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as {
          error?: { message?: string; code?: string; limit?: number; used?: number; pageKey?: string };
        };
        if (response.status === 429 && errorData.error?.code === 'LIMIT_EXCEEDED') {
          const e = errorData.error;
          throw new UsageLimitError(
            e.message || 'Usage limit exceeded',
            e.limit ?? 0,
            e.used ?? 0,
            e.pageKey || 'dashboard',
          );
        }
        throw new Error(errorData.error?.message || `Channel tab request failed: ${response.status}`);
      }

      const data = (await response.json()) as ChannelTabResponse;
      if (data._usage) {
        useUsageStore.getState().updateUsage(data._usage.pageKey, data._usage.used, data._usage.limit);
      }

      // Flatten raw per-window reports into the flat metric shape the dashboard
      // pills expect (backend returns { rows, columnHeaders }). Anchor windows on
      // the resolved latestDate so upload counts line up with the fetched rows.
      if (data.channelMultiPeriodStats) {
        const endAnchor = data.latestDate
          ? new Date(data.latestDate)
          : new Date(latestDataDate ?? Date.now() - 2 * 86400000);
        data.channelMultiPeriodStats = flattenChannelMultiPeriod(
          data.channelMultiPeriodStats as never,
          endAnchor,
          trueDeltaEnabled,
          videos as Array<{ publishedAt: string }>,
        ) as never;
      }

      // Backend chart rows carry only the 7 report metrics. Merge per-day upload
      // counts from the video catalog (same store used for videosUploaded) so the
      // Uploads series / mini bar graph has data instead of flat zeros.
      if (data.channelAnalyticsChartData?.length) {
        const uploadsByDate = new Map<string, number>();
        for (const v of videos as Array<{ publishedAt?: string }>) {
          const d = v.publishedAt?.slice(0, 10);
          if (d) uploadsByDate.set(d, (uploadsByDate.get(d) || 0) + 1);
        }
        data.channelAnalyticsChartData = data.channelAnalyticsChartData.map(row => ({
          ...row,
          uploads: uploadsByDate.get(row.date) || 0,
        }));
      }

      // The backend can only echo back the catalog length (`videosLength`), which
      // is a lifetime count -- not uploads within the selected period. Derive the
      // true period-scoped upload count here from publish dates, mirroring the
      // backend's `curr` window (custom range, else `period` days ending at the
      // resolved latestDate). Same source as the multi-period deltas and the
      // per-day Uploads series, so pill / delta / bar graph can never disagree.
      const uploadsEndIso = (
        data.latestDate || latestDataDate || new Date().toISOString()
      ).slice(0, 10);
      const uploadsEndRefMs = new Date(`${uploadsEndIso}T00:00:00Z`).getTime();
      const uploadsStartDate = hasCustom
        ? startD!.format('YYYY-MM-DD')
        : new Date(uploadsEndRefMs - ((period ?? 30) - 1) * 86400000).toISOString().split('T')[0];
      const uploadsEndDate = hasCustom ? endD!.format('YYYY-MM-DD') : uploadsEndIso;
      data.channelAnalyticsData.videosUploaded = videos.filter((v) => {
        const d = v.publishedAt.slice(0, 10);
        return !!d && d >= uploadsStartDate && d <= uploadsEndDate;
      }).length;

      return data;
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
      loadingChannelAnalytics: false,
    } as never);

    // Persist latestDate from the channel tab response so subsequent queries
    // use the most recent date anchor -- same pattern as useAnalyticsQuery.
    if (query.data.latestDate && channelId && onPersistLatestDate) {
      const currentLatest = useDashboardStore.getState().dateRange.latestDataDate;
      if (query.data.latestDate !== currentLatest) {
        onPersistLatestDate(channelId, query.data.latestDate);
      }
    }

    // Invalidate usage bar
    queryClient.invalidateQueries({ queryKey: ['usage:me', user?.email] });
  }, [query.data, setAnalyticsData, channelId, onPersistLatestDate, queryClient, user?.email]);

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

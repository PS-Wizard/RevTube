/**
 * Playlists tab -- single combined endpoint.
 * Replaces usePlaylistsQuery + useAnalyticsQuery.
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
import type { PlaylistMetadata } from '../../types/youtube';

type CustomDateInput = string | dayjs.Dayjs | null;

interface UsePlaylistsTabQueryOptions {
  channelId: string | null;
  period: number | null;
  customStartDate: CustomDateInput;
  customEndDate: CustomDateInput;
  compareEnabled: boolean;
  trueDeltaEnabled: boolean;
  latestDataDate: string | null;
  maxPlaylists?: number;
  getEffectiveToken: (channelId: string) => Promise<string | null>;
  enabled?: boolean;
}

export const usePlaylistsTabQuery = ({
  channelId,
  period,
  customStartDate,
  customEndDate,
  compareEnabled,
  trueDeltaEnabled,
  latestDataDate,
  maxPlaylists,
  getEffectiveToken,
  enabled = true,
}: UsePlaylistsTabQueryOptions) => {
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
  const setPlaylists = useDashboardStore(state => state.setPlaylists);
  const includePrivate = useDashboardStore(state => state.filters.playlistVisibility) !== 'public';

  const startD = customStartDate ? dayjs(customStartDate) : null;
  const endD = customEndDate ? dayjs(customEndDate) : null;
  const hasCustomRange = !!(startD?.isValid() && endD?.isValid());
  const resolvedEmail = user?.email || '';
  const limitKey = maxPlaylists ?? 'all';

  const query = useQuery({
    queryKey: [
      REVTUBE_DASHBOARD_WS_ROOT,
      workspaceKey,
      'playlistsTab',
      channelId,
      resolvedEmail,
      limitKey,
      period,
      startD?.format('YYYY-MM-DD') ?? '',
      endD?.format('YYYY-MM-DD') ?? '',
      compareEnabled,
      trueDeltaEnabled,
      latestDataDate ?? '',
      includePrivate,
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
        period: hasCustomRange ? undefined : (period ?? 30),
        compare: compareEnabled,
        trueDelta: trueDeltaEnabled,
        latestDate: latestDataDate || undefined,
        maxResults: maxPlaylists ?? 50,
        includePrivate,
      };
      if (hasCustomRange) {
        body.startDate = startD!.format('YYYY-MM-DD');
        body.endDate = endD!.format('YYYY-MM-DD');
      }

      const response = await fetch(`${baseUrl}/dashboard/tab/playlists`, {
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
        throw new Error(errorData.error?.message || `Playlists tab request failed: ${response.status}`);
      }

      const data = (await response.json()) as {
        playlists: { items: PlaylistMetadata[] };
        bundle: {
          current: any;
          previous: any;
          channelCurrent: any;
          channelPrevious: any;
          channelTotals: any;
          prevChannelTotals: any;
          d7: any;
          d30: any;
          d90: any;
          latestDate: string;
        };
        _usage?: { used: number; limit: number; pageKey: string };
      };

      if (data._usage) {
        useUsageStore.getState().updateUsage(data._usage.pageKey, data._usage.used, data._usage.limit);
      }

      return data;
    },
    enabled: enabled && !!channelId && !!user?.email && !(isPersonalContext && channels.length === 0),
    staleTime: 24 * 60 * 60 * 1000, // 24 hours for playlist catalog
    gcTime: 24 * 60 * 60 * 1000,
    retry: 2,
    meta: { suppressGlobalErrorToast: true },
  });

  useEffect(() => {
    setAnalyticsLoading(query.isLoading);
  }, [query.isLoading, setAnalyticsLoading]);

  useEffect(() => {
    if (!query.data) return;

    const { playlists, bundle } = query.data;
    const playlistItems = playlists?.items ?? [];

    // Set playlists in the store
    setPlaylists(playlistItems);

    // Set analytics bundle data
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

    queryClient.invalidateQueries({ queryKey: ['usage:me', user?.email] });
  }, [query.data, setPlaylists, setAnalyticsData, queryClient, user?.email]);

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
  };
};

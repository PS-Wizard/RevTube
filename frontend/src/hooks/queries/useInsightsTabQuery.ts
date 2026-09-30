/**
 * Insights tab -- Best Time to Post + Audience Retention by hour.
 * Single combined endpoint = 1 quota unit per tab switch.
 *
 * Supports timezone (IANA, e.g. 'Asia/Tokyo') and segment ('all'|'shorts'|'long')
 * for timezone-aware analysis and content-type filtering.
 */

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import type { InsightsData } from '../../types/dashboard';

interface InsightsTabResponse {
  bestTimeToPost: InsightsData['bestTimeToPost'];
  bestTimeToPostV2: InsightsData['bestTimeToPostV2'];
  retention: InsightsData['retention'];
  retentionByPublishHour: InsightsData['retentionByPublishHour'];
  audienceActiveTime: InsightsData['audienceActiveTime'];
  estimatedAudienceActiveTime: InsightsData['estimatedAudienceActiveTime'];
  _usage?: { used: number; limit: number; pageKey: string };
}

interface UseInsightsTabQueryOptions {
  channelId: string | null;
  period: number | null;
  getEffectiveToken: (channelId: string) => Promise<string | null>;
  latestDataDate?: string | null;
  timezone?: string;
  segment?: 'all' | 'shorts' | 'long';
  enabled?: boolean;
}

export const useInsightsTabQuery = ({
  channelId,
  period,
  getEffectiveToken,
  latestDataDate,
  timezone = 'UTC',
  segment = 'all',
  enabled = true,
}: UseInsightsTabQueryOptions) => {
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
  const customStartDate = useDashboardStore((state) => state.dateRange.customStartDate);
  const customEndDate = useDashboardStore((state) => state.dateRange.customEndDate);
  const setAnalyticsData = useDashboardStore((state) => state.setAnalyticsData);
  const setAnalyticsError = useDashboardStore((state) => state.setAnalyticsError);

  const query = useQuery({
    queryKey: [
      REVTUBE_DASHBOARD_WS_ROOT,
      workspaceKey,
      'insights',
      channelId,
      period,
      timezone,
      segment,
      customStartDate ?? '',
      customEndDate ?? '',
      latestDataDate ?? '',
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
        timezone,
        segment,
        ...(latestDataDate ? { latestDate: latestDataDate } : {}),
        ...(customStartDate && customEndDate ? {
          startDate: customStartDate,
          endDate: customEndDate,
        } : {}),
      };

      const response = await fetch(`${baseUrl}/dashboard/tab/insights`, {
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
        throw new Error(errorData.error?.message || `Insights tab request failed: ${response.status}`);
      }

      const data = (await response.json()) as InsightsTabResponse;
      if (data._usage) {
        useUsageStore.getState().updateUsage(data._usage.pageKey, data._usage.used, data._usage.limit);
      }

      return data;
    },
    enabled: enabled && !!channelId && !!user?.email && !(isPersonalContext && channels.length === 0),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 2,
    meta: { suppressGlobalErrorToast: true },
  });

  useEffect(() => {
    setAnalyticsData({ loadingInsights: query.isLoading });
  }, [query.isLoading, setAnalyticsData]);

  useEffect(() => {
    if (!query.data) return;
    setAnalyticsData({
      insightsData: {
        bestTimeToPost: query.data.bestTimeToPost,
        bestTimeToPostV2: query.data.bestTimeToPostV2,
        retention: query.data.retention,
        retentionByPublishHour: query.data.retentionByPublishHour,
        audienceActiveTime: query.data.audienceActiveTime,
        estimatedAudienceActiveTime: query.data.estimatedAudienceActiveTime,
      } as InsightsData,
      loadingInsights: false,
    });
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

    setAnalyticsError(err instanceof Error ? err.message : 'Failed to load insights');
  }, [query.error, setAnalyticsError, setAnalyticsData]);

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
};

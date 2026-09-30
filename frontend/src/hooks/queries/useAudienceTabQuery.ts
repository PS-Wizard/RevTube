/**
 * Audience tab -- single combined endpoint.
 * Replaces useDimensionsQuery which made 3–6 separate dimension calls.
 * 1 endpoint = 1 quota unit.
 */

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useDashboardStore } from '../../stores/dashboardStore';
import { useAuth } from '../useAuth';
import { useOrganization } from '../useOrganization';
import {
  DASHBOARD_WS_KEY_PENDING,
  REVTUBE_DASHBOARD_WS_ROOT,
  getDashboardWorkspaceKey,
} from '../../utils/dashboardWorkspaceScope';
import { getFirebaseAuthHeader } from '../../services/authHeaders';
import { getResolvedApiBaseUrl } from '../../utils/apiBase';
import type { DimensionsMultiPeriodData } from '../../utils/dashboardUtils';
import type { InsightsData, RetentionByHourData } from '../../types/dashboard';

type CustomDateInput = string | dayjs.Dayjs | null;

interface UseAudienceTabQueryOptions {
  channelId: string | null;
  selectedVideoIds: Set<string>;
  latestDataDate: string | null;
  customStartDate: CustomDateInput;
  customEndDate: CustomDateInput;
  getEffectiveToken: (channelId: string) => Promise<string | null>;
  enabled?: boolean;
}

export const useAudienceTabQuery = ({
  channelId,
  selectedVideoIds,
  latestDataDate,
  customStartDate,
  customEndDate,
  getEffectiveToken,
  enabled = true,
}: UseAudienceTabQueryOptions) => {
  const { user } = useAuth();
  const { currentOrganization, isPersonalContext } = useOrganization();
  const channels = useDashboardStore((state) => state.channel.channels);
  const workspaceKey =
    getDashboardWorkspaceKey({
      userId: user?.uid,
      isPersonalContext,
      organizationId: currentOrganization?.id,
    }) ?? DASHBOARD_WS_KEY_PENDING;
  const setDimensionsData = useDashboardStore(state => state.setDimensionsData);
  const setDimensionsLoading = useDashboardStore(state => state.setDimensionsLoading);

  const startD = customStartDate ? dayjs(customStartDate) : null;
  const endD = customEndDate ? dayjs(customEndDate) : null;
  const hasCustom = !!(startD?.isValid() && endD?.isValid());

  const query = useQuery({
    queryKey: [
      REVTUBE_DASHBOARD_WS_ROOT,
      workspaceKey,
      'audienceTab',
      channelId,
      Array.from(selectedVideoIds).sort().join(','),
      latestDataDate ?? '',
      hasCustom ? `${startD?.format('YYYY-MM-DD')}-${endD?.format('YYYY-MM-DD')}` : '',
    ],
    queryFn: async (): Promise<DimensionsMultiPeriodData & { retention?: RetentionByHourData }> => {
      if (!channelId || !user?.email || !latestDataDate) {
        throw new Error('Missing channel, user, or latest data date');
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

      const videoFilterStr =
        selectedVideoIds.size > 0 && !selectedVideoIds.has('XX_NONE_XX_')
          ? `video==${Array.from(selectedVideoIds).sort().join(',')}`
          : undefined;

      const body: Record<string, unknown> = {
        channelId,
        latestDate: latestDataDate,
        ...(videoFilterStr ? { filters: videoFilterStr } : {}),
      };
      if (hasCustom) {
        body.customStartDate = startD!.format('YYYY-MM-DD');
        body.customEndDate = endD!.format('YYYY-MM-DD');
      }

      const response = await fetch(`${baseUrl}/dashboard/tab/audience`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const err = (await response.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(err.error?.message || `Audience tab request failed: ${response.status}`);
      }

      return response.json() as Promise<DimensionsMultiPeriodData & { retention?: RetentionByHourData }>;
    },
    enabled: enabled && !!channelId && !!user?.email && !!latestDataDate && !(isPersonalContext && channels.length === 0),
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 2,
    meta: { suppressGlobalErrorToast: true },
  });

  useEffect(() => {
    setDimensionsLoading(query.isLoading);
  }, [query.isLoading, setDimensionsLoading]);

  useEffect(() => {
    if (query.data) {
      const { retention, ...dimensionsData } = query.data;
      setDimensionsData(dimensionsData);

      if (retention) {
        const current = useDashboardStore.getState().analytics.insightsData;
        useDashboardStore.getState().setAnalyticsData({
          insightsData: {
            ...(current || {}),
            retention,
          } as InsightsData,
        });
      }
    }
  }, [query.data, setDimensionsData]);

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
};

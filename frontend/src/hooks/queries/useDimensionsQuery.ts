/**
 * Audience dimensions: 7d / 30d / 90d windows with comparison periods (getDimensionsBundle).
 */

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useDashboardStore } from '../../stores/dashboardStore';
import { AnalyticsService } from '../../services/analyticsService';
import { useAuth } from '../useAuth';
import { useOrganization } from '../useOrganization';
import {
  DASHBOARD_WS_KEY_PENDING,
  REVTUBE_DASHBOARD_WS_ROOT,
  getDashboardWorkspaceKey,
} from '../../utils/dashboardWorkspaceScope';
import type { DimensionsBundleData, DimensionsMultiPeriodData } from '../../utils/dashboardUtils';

type CustomDateInput = string | dayjs.Dayjs | null;

interface UseDimensionsQueryOptions {
  channelId: string | null;
  selectedVideoIds: Set<string>;
  latestDataDate: string | null;
  customStartDate: CustomDateInput;
  customEndDate: CustomDateInput;
  getEffectiveToken: (channelId: string) => Promise<string | null>;
  enabled?: boolean;
}

const emptyBundle: DimensionsBundleData = {
  trafficSource: null,
  gender: null,
  ageGroup: null,
  subscribedStatus: null,
  country: null,
  deviceType: null,
};

export const useDimensionsQuery = ({
  channelId,
  selectedVideoIds,
  latestDataDate,
  customStartDate,
  customEndDate,
  getEffectiveToken,
  enabled = true,
}: UseDimensionsQueryOptions) => {
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
      'dimensions',
      channelId,
      Array.from(selectedVideoIds).sort().join(','),
      latestDataDate ?? '',
      hasCustom ? `${startD?.format('YYYY-MM-DD')}-${endD?.format('YYYY-MM-DD')}` : '',
    ],
    queryFn: async (): Promise<DimensionsMultiPeriodData> => {
      if (!channelId || !user?.email || !latestDataDate) {
        throw new Error('Missing channel, user, or latest data date');
      }

      const token = await getEffectiveToken(channelId);
      if (!token) {
        throw new Error('No access token available');
      }

      const service = new AnalyticsService(token, user.email, currentOrganization?.id);

      const videoFilterStr =
        selectedVideoIds.size > 0 && !selectedVideoIds.has('XX_NONE_XX_')
          ? `video==${Array.from(selectedVideoIds).sort().join(',')}`
          : undefined;

      const fetchBundle = (startDate: string, endDate: string) =>
        service.getDimensionsBundle({
          channelId,
          startDate,
          endDate,
          ...(videoFilterStr ? { filters: videoFilterStr } : {}),
        });

      const endRef = new Date(latestDataDate);
      const anchorEnd = hasCustom && endD?.isValid() ? endD.toDate() : endRef;

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

      const w7c = rollingCurrent(anchorEnd, 7);
      const w7p = rollingPrevious(anchorEnd, 7);
      const w30c = rollingCurrent(anchorEnd, 30);
      const w30p = rollingPrevious(anchorEnd, 30);
      const w90c = rollingCurrent(anchorEnd, 90);
      const w90p = rollingPrevious(anchorEnd, 90);

      const [b7c, b30c, b90c] = await Promise.all([
        fetchBundle(w7c.startDate, w7c.endDate),
        fetchBundle(w30c.startDate, w30c.endDate),
        fetchBundle(w90c.startDate, w90c.endDate),
      ]);

      let b7p: DimensionsBundleData = emptyBundle;
      let b30p: DimensionsBundleData = emptyBundle;
      let b90p: DimensionsBundleData = emptyBundle;
      try {
        [b7p, b30p, b90p] = await Promise.all([
          fetchBundle(w7p.startDate, w7p.endDate),
          fetchBundle(w30p.startDate, w30p.endDate),
          fetchBundle(w90p.startDate, w90p.endDate),
        ]);
      } catch {
        /* previous-window deltas optional */
      }

      return {
        d7: { current: b7c, previous: b7p },
        d30: { current: b30c, previous: b30p },
        d90: { current: b90c, previous: b90p },
      };
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
      setDimensionsData(query.data);
    }
  }, [query.data, setDimensionsData]);

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
};

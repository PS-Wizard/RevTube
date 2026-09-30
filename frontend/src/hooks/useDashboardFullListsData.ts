/**
 * Combined day×video metrics for active saved lists (multi-list chart overlay).
 * Workspace-scoped React Query cache; Zustand sync for existing chart consumers.
 */

import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useAuth } from './useAuth';
import { useOrganization } from './useOrganization';
import { useDashboardStore } from '../stores/dashboardStore';
import { AnalyticsService } from '../services/analyticsService';
import {
  DASHBOARD_WS_KEY_PENDING,
  REVTUBE_DASHBOARD_WS_ROOT,
  getDashboardWorkspaceKey,
} from '../utils/dashboardWorkspaceScope';

export const useDashboardFullListsData = (getEffectiveToken: () => Promise<string | null>) => {
  const { user } = useAuth();
  const { currentOrganization, isPersonalContext } = useOrganization();
  const workspaceKey =
    getDashboardWorkspaceKey({
      userId: user?.uid,
      isPersonalContext,
      organizationId: currentOrganization?.id,
    }) ?? DASHBOARD_WS_KEY_PENDING;

  const setAnalyticsData = useDashboardStore(state => state.setAnalyticsData);
  const selectedChannel = useDashboardStore(state => state.channel.selectedChannel);
  const channels = useDashboardStore((state) => state.channel.channels);
  const activeListIds = useDashboardStore(state => state.listSelection.activeListIds);
  const activeLists = useDashboardStore(state => state.lists.activeLists);
  const latestDataDate = useDashboardStore(state => state.dateRange.latestDataDate);
  const period = useDashboardStore(state => state.dateRange.period);
  const customStartDate = useDashboardStore(state => state.dateRange.customStartDate);
  const customEndDate = useDashboardStore(state => state.dateRange.customEndDate);

  const { listsKey, videoCount } = useMemo(() => {
    const ids = [...activeListIds].sort().join(',');
    const videoSet = new Set<string>();
    activeLists.forEach(list => {
      if (activeListIds.has(list.id)) {
        list.videoIds.forEach(id => videoSet.add(id));
      }
    });
    const vids = [...videoSet].sort().join(',');
    return { listsKey: `${ids}|${vids}`, videoCount: videoSet.size };
  }, [activeListIds, activeLists]);

  const rangeKey = useMemo(() => {
    if (customStartDate && customEndDate) {
      return `custom:${dayjs(customStartDate).format('YYYY-MM-DD')}:${dayjs(customEndDate).format('YYYY-MM-DD')}`;
    }
    return `rolling:${period ?? 30}:${latestDataDate ?? ''}`;
  }, [customStartDate, customEndDate, period, latestDataDate]);

  const enabled =
    activeListIds.size > 0 &&
    videoCount > 0 &&
    !!latestDataDate &&
    !!user?.email &&
    !!selectedChannel &&
    !(isPersonalContext && channels.length === 0);

  const query = useQuery({
    queryKey: [REVTUBE_DASHBOARD_WS_ROOT, workspaceKey, 'fullLists', selectedChannel, listsKey, rangeKey],
    queryFn: async () => {
      if (!latestDataDate || !user?.email || !selectedChannel) {
        throw new Error('Missing full-lists context');
      }

      const tokenToUse = await getEffectiveToken();
      if (!tokenToUse) throw new Error('No access token for full lists');

      const svc = new AnalyticsService(tokenToUse, user.email, currentOrganization?.id);
      const channelIds = `channel==${selectedChannel}`;

      let startDate: string;
      let endDate: string;

      if (customStartDate && customEndDate) {
        startDate = dayjs(customStartDate).format('YYYY-MM-DD');
        endDate = dayjs(customEndDate).format('YYYY-MM-DD');
      } else {
        const days = period ?? 30;
        const endRef = new Date(latestDataDate);
        endDate = endRef.toISOString().split('T')[0];
        startDate = new Date(endRef.getTime() - (days - 1) * 86400000).toISOString().split('T')[0];
      }

      const allVideoIds = new Set<string>();
      activeLists.forEach(list => {
        if (activeListIds.has(list.id)) {
          list.videoIds.forEach(id => allVideoIds.add(id));
        }
      });

      if (allVideoIds.size === 0) return null;

      // YouTube Analytics API does not support dimensions: 'day,video'.
      // Fetch per-video aggregated totals with dimensions: 'video' and daily totals per video separately.
      // First, get total metrics per video for the full date range.
      const videoFilter = `video==${Array.from(allVideoIds).join(',')}`;
      return svc.getReport({
        ids: channelIds,
        startDate,
        endDate,
        metrics: 'views,estimatedMinutesWatched',
        dimensions: 'video',
        filters: videoFilter,
      });
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });

  useEffect(() => {
    if (!enabled) {
      setAnalyticsData({ fullListsData: null });
      return;
    }
    if (query.data == null) {
      setAnalyticsData({ fullListsData: null });
      return;
    }
    setAnalyticsData({ fullListsData: query.data } as never);
  }, [enabled, query.data, setAnalyticsData]);

  // Exposed so callers can distinguish "overlay still loading" (wait for it)
  // from "overlay unavailable" (error/disabled — fall back to aggregate data).
  // Gating paint on `!fullListsData` instead would stick the chart on its
  // skeleton forever whenever the overlay query errors or is disabled.
  return { isFetching: query.isFetching };
};

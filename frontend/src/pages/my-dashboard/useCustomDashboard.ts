/**
 * Custom user dashboard (`/my-dashboard`) — state + server data.
 *
 * Reuses the shared dashboard store for channel/date context (same selection
 * as `/dashboard`). Widget geometry lives in the scoped Postgres-backed
 * `customDashboardStore`: one 12-column matrix per (user, org scope), so
 * switching between Personal and an organization loads that scope's layout.
 * Server queries are gated on *visible widgets* instead of the dashboard tab,
 * so hiding a widget also skips its quota cost.
 */

import { useCallback, useEffect, useMemo } from 'react';
import dayjs from 'dayjs';
import { useAuth } from '../../hooks/useAuth';
import { useDashboardChannel } from '../../hooks/useDashboardChannel';
import { useDashboardChannelSync } from '../../hooks/useDashboardChannelSync';
import { useDashboardSelection } from '../../hooks/useDashboardSelection';
import { useDashboardUI } from '../../hooks/useDashboardUI';
import { useOrganization } from '../../hooks/useOrganization';
import { useStatCardLayout } from '../../hooks/useStatCardLayout';
import { useAudienceTabQuery } from '../../hooks/queries/useAudienceTabQuery';
import { useChannelTabQuery } from '../../hooks/queries/useChannelTabQuery';
import { useDashboardStore } from '../../stores/dashboardStore';
import {
  scopeKey,
  selectHiddenIds,
  selectVisibleIds,
  useCustomDashboardStore,
  type DashboardScope,
} from '../../stores/customDashboardStore';
import { defaultDbLayout } from '../../utils/dashboardLayoutMatrix';
import { selectCustomCardIds, useCustomCardsStore, isCustomWidgetId } from '../../stores/customCardsStore';
import { defaultWidgetIds } from './customDashboardUtils';
import {
  useAudiencePrimaryPeriod,
  useCurrentChannelName,
  useFormattedLatestDate,
} from '../../stores/dashboardSelectors';

/** Current persistence scope: personal or the active organization. */
export function useDashboardScope(): DashboardScope {
  const { user } = useAuth();
  const { currentOrganization, isPersonalContext } = useOrganization();
  return useMemo(
    () => ({
      uid: user?.uid ?? '',
      orgId: isPersonalContext ? '' : (currentOrganization?.id ?? ''),
    }),
    [user?.uid, isPersonalContext, currentOrganization?.id],
  );
}

export function useCustomDashboard() {
  // Shared channel/date context (same selection as /dashboard).
  const {
    channels,
    selectedChannel,
    channelSelectionHydrated,
    loadingChannels,
    getEffectiveToken,
    saveLatestDataDate,
  } = useDashboardChannel();
  useDashboardChannelSync();
  useStatCardLayout();

  const { selectedVideoIds } = useDashboardSelection();
  const {
    period,
    customStartDate,
    customEndDate,
    latestDataDate,
    trueDeltaEnabled,
    setTrueDeltaEnabled,
    setCustomDateRange,
  } = useDashboardUI();
  const { currentOrganization, isPersonalContext, canEdit } = useOrganization();
  const setSelectedChannel = useDashboardStore((s) => s.setSelectedChannel);
  const analytics = useDashboardStore((s) => s.analytics);

  const currentChannelName = useCurrentChannelName();
  const formattedLatestDate = useFormattedLatestDate();
  const audiencePrimaryPeriod = useAudiencePrimaryPeriod();

  // Scoped widget layout (Postgres matrix, per user + org context).
  const scope = useDashboardScope();
  const key = scopeKey(scope);
  const scopes = useCustomDashboardStore((s) => s.scopes);
  const loadScope = useCustomDashboardStore((s) => s.loadScope);
  const syncScope = useCustomDashboardStore((s) => s.syncScopeFromBackend);
  const hideWidget = useCustomDashboardStore((s) => s.hideWidget);
  const showWidget = useCustomDashboardStore((s) => s.showWidget);
  const reorderVisible = useCustomDashboardStore((s) => s.reorderVisible);
  const resetScope = useCustomDashboardStore((s) => s.resetScope);
  const flushScopeSave = useCustomDashboardStore((s) => s.flushScopeSave);

  useEffect(() => {
    loadScope(scope);
  }, [key, loadScope, scope]);
  useEffect(() => {
    void syncScope(scope);
  }, [key, syncScope, scope]);
  useEffect(() => () => flushScopeSave(scope), [flushScopeSave, scope]);

  const visibleIds = useMemo(() => selectVisibleIds(scopes, scope), [scopes, scope]);
  const hiddenIds = useMemo(() => selectHiddenIds(scopes, scope), [scopes, scope]);
  // Custom-card definitions are local to this device: drop `custom:*` cells
  // with no local definition so a synced layout never paints empty shells.
  const cardsByScope = useCustomCardsStore((s) => s.cardsByScope);
  const customIdSet = useMemo(
    () => new Set(selectCustomCardIds(cardsByScope, scope)),
    [cardsByScope, scope],
  );
  const cells = useMemo(() => {
    const stored = scopes[key]?.layout;
    const fallback = defaultDbLayout(defaultWidgetIds());
    const source = !stored || stored.cells.length === 0 ? fallback.cells : stored.cells;
    return source.filter((c) => !isCustomWidgetId(c.id) || customIdSet.has(c.id));
  }, [scopes, key, customIdSet]);
  const scopeLabel = isPersonalContext
    ? 'Personal'
    : (currentOrganization?.name ?? 'Organization');
  const showChannelKpis = visibleIds.includes('channel-kpis');
  const showAudience = visibleIds.includes('audience');

  // Server data — one combined endpoint per widget family, skipped when hidden.
  const channelReady =
    !!selectedChannel && channelSelectionHydrated && !loadingChannels;
  useChannelTabQuery({
    channelId: selectedChannel,
    period,
    customStartDate,
    customEndDate,
    getEffectiveToken,
    onPersistLatestDate: saveLatestDataDate,
    enabled: channelReady && showChannelKpis,
  });
  useAudienceTabQuery({
    channelId: selectedChannel,
    selectedVideoIds,
    latestDataDate,
    customStartDate,
    customEndDate,
    getEffectiveToken,
    enabled: channelReady && showAudience,
  });

  const reorderWidgets = useCallback(
    (nextVisibleOrder: string[]) => {
      reorderVisible(scope, nextVisibleOrder);
    },
    [reorderVisible, scope],
  );

  const moveWidgetBy = useCallback(
    (id: string, delta: number) => {
      const index = visibleIds.indexOf(id);
      const target = index + delta;
      if (index === -1 || target < 0 || target >= visibleIds.length) return;
      const next = [...visibleIds];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      reorderVisible(scope, next);
    },
    [reorderVisible, scope, visibleIds],
  );

  const toggleWidget = useCallback(
    (id: string, visible: boolean) => {
      if (visible) showWidget(scope, id);
      else hideWidget(scope, id);
    },
    [hideWidget, showWidget, scope],
  );

  const resetLayout = useCallback(() => {
    resetScope(scope);
  }, [resetScope, scope]);

  const selectChannel = useCallback(
    (channelId: string | null) => {
      setSelectedChannel(channelId);
    },
    [setSelectedChannel],
  );

  const applyDateRange = useCallback(
    (start: string | null, end: string | null) => {
      setCustomDateRange(start, end);
    },
    [setCustomDateRange],
  );

  return {
    // Scope
    scope,
    scopeLabel,
    // Channel context
    channels,
    selectedChannel,
    channelReady,
    loadingChannels,
    selectChannel,
    currentChannelName,
    formattedLatestDate,
    // Date context
    period,
    customStartDate: customStartDate ? dayjs(customStartDate) : null,
    customEndDate: customEndDate ? dayjs(customEndDate) : null,
    latestDataDate: latestDataDate ? dayjs(latestDataDate) : null,
    latestDataDateRaw: latestDataDate ?? null,
    applyDateRange,
    // Layout
    visibleIds,
    hiddenIds,
    cells,
    reorderWidgets,
    moveWidgetBy,
    toggleWidget,
    resetLayout,
    // Channel KPIs widget props
    channelKpis: {
      data: analytics.channelAnalyticsData,
      chartData: analytics.channelAnalyticsChartData,
      multiPeriodStats: analytics.channelMultiPeriodStats,
      bundleLoading: analytics.loading,
      loadingChannelAnalytics: analytics.loadingChannelAnalytics,
      trueDeltaEnabled,
      setTrueDeltaEnabled,
    },
    // Audience widget props
    audience: {
      dimensionsMultiPeriod: analytics.dimensionsMultiPeriod,
      primaryPeriod: audiencePrimaryPeriod,
      loading: analytics.loadingDimensions,
      retention: analytics.insightsData?.retention ?? null,
    },
    // Insights widget props (the panel self-fires its query)
    insights: {
      data: analytics.insightsData,
      loading: analytics.loadingInsights,
      getEffectiveToken,
    },
    // Goals widget props
    goals: {
      organizationId: isPersonalContext ? null : (currentOrganization?.id ?? null),
      canEdit: isPersonalContext || canEdit,
    },
  };
}

export type UseCustomDashboard = ReturnType<typeof useCustomDashboard>;

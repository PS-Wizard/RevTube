import React from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useOrganization } from '@/hooks/useOrganization';
import {
  selectVisibleIds,
  useCustomDashboardStore,
  type DashboardScope,
} from '@/stores/customDashboardStore';
import { isPinnableWidgetId } from './pinToDashboardUtils';

export interface PinToDashboard {
  scope: DashboardScope;
  isPinned: boolean;
  togglePin: () => void;
  scopeLabel: string;
}

/**
 * Pin state for one custom-dashboard widget, scoped to the active
 * workspace (personal or current organization) — the same scope
 * `pages/my-dashboard` persists. Unknown ids never pin.
 */
export function usePinToDashboard(widgetId: string): PinToDashboard {
  const { user } = useAuth();
  const { currentOrganization, isPersonalContext } = useOrganization();

  const scope = React.useMemo<DashboardScope>(
    () => ({
      uid: user?.uid ?? '',
      orgId: isPersonalContext ? '' : (currentOrganization?.id ?? ''),
    }),
    [user?.uid, isPersonalContext, currentOrganization?.id],
  );

  const scopes = useCustomDashboardStore((s) => s.scopes);
  const loadScope = useCustomDashboardStore((s) => s.loadScope);
  const showWidget = useCustomDashboardStore((s) => s.showWidget);
  const hideWidget = useCustomDashboardStore((s) => s.hideWidget);
  const visibleIds = React.useMemo(() => selectVisibleIds(scopes, scope), [scopes, scope]);

  React.useEffect(() => {
    loadScope(scope);
  }, [loadScope, scope]);

  const isPinned = isPinnableWidgetId(widgetId) && visibleIds.includes(widgetId);

  const togglePin = React.useCallback(() => {
    if (!isPinnableWidgetId(widgetId)) return;
    if (visibleIds.includes(widgetId)) hideWidget(scope, widgetId);
    else showWidget(scope, widgetId);
  }, [widgetId, visibleIds, hideWidget, showWidget, scope]);

  const scopeLabel = isPersonalContext
    ? 'Personal'
    : (currentOrganization?.name ?? 'Organization');

  return { scope, isPinned, togglePin, scopeLabel };
}

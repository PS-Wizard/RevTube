import React from 'react';
import { ChevronDown, ChevronUp, Plus, RotateCcw, SlidersHorizontal, Trash2 } from 'lucide-react';
import {
  Button,
  Flex,
  IconButton,
  PopoverContent,
  PopoverTrigger,
  ShadcnPopover,
  Stack,
  Toggle,
  Typography,
} from '@/components/ui';
import { getStatCardDefinitions, CUSTOM_DASHBOARD_SURFACE } from '@/config/statCardRegistry';
import { defaultDbLayout, isLayoutCustomized } from '@/utils/dashboardLayoutMatrix';
import {
  scopeKey,
  selectHiddenIds,
  selectVisibleIds,
  useCustomDashboardStore,
} from '@/stores/customDashboardStore';
import {
  isCustomWidgetId,
  selectCustomCardIds,
  useCustomCardsStore,
} from '@/stores/customCardsStore';
import { useDashboardScope } from '../useCustomDashboard';
import { widgetLabel } from '../customDashboardUtils';
import { CustomCardDialog } from './CustomCardDialog';

/**
 * Widget picker for My Dashboard — show/hide + arrow-reorder + reset,
 * for the active scope (Personal or the current organization).
 * Same management pattern as `StatCardsCustomizer`; drag-reorder happens
 * directly on the grid cards.
 */
export function WidgetPicker(): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [builderOpen, setBuilderOpen] = React.useState(false);
  const scope = useDashboardScope();
  const key = scopeKey(scope);
  const scopes = useCustomDashboardStore((s) => s.scopes);
  const hideWidget = useCustomDashboardStore((s) => s.hideWidget);
  const showWidget = useCustomDashboardStore((s) => s.showWidget);
  const reorderVisible = useCustomDashboardStore((s) => s.reorderVisible);
  const resetScope = useCustomDashboardStore((s) => s.resetScope);
  const cardsByScope = useCustomCardsStore((s) => s.cardsByScope);
  const removeCard = useCustomCardsStore((s) => s.removeCard);

  const knownIds = React.useMemo(() => {
    const registry = getStatCardDefinitions(CUSTOM_DASHBOARD_SURFACE).map((d) => d.id);
    const customs = selectCustomCardIds(cardsByScope, scope);
    const merged = [...registry];
    for (const id of customs) {
      if (!merged.includes(id)) merged.push(id);
    }
    return merged;
  }, [cardsByScope, scope]);
  const visibleIds = React.useMemo(() => selectVisibleIds(scopes, scope), [scopes, scope]);
  const hiddenIds = React.useMemo(() => selectHiddenIds(scopes, scope), [scopes, scope]);
  const layout = scopes[key]?.layout ?? defaultDbLayout(knownIds);
  const customized = isLayoutCustomized(layout, knownIds);
  const ordered = React.useMemo(() => [...visibleIds, ...hiddenIds], [visibleIds, hiddenIds]);
  const lastIndex = visibleIds.length - 1;

  const moveBy = React.useCallback(
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

  const deleteCustomCard = React.useCallback(
    (id: string) => {
      removeCard(scope, id);
      // Re-normalize the layout against the scope (now without the
      // definition) so the id drops from cells and hidden alike.
      const store = useCustomDashboardStore.getState();
      const current = store.scopes[scopeKey(scope)]?.layout;
      if (current) store.setLayout(scope, current);
    },
    [removeCard, scope],
  );

  return (
    <>
      <ShadcnPopover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          title="Choose which widgets to show on your dashboard"
          aria-label="Customize dashboard widgets"
        >
          <SlidersHorizontal size={14} />
          <span>Widgets</span>
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" style={{ width: 'min(22rem, calc(100vw - 2rem))' }}>
        <Stack gap={1}>
          <Flex gap={1} alignItems="center" justifyContent="space-between">
            <Typography variant="subtitle2" component="span">
              Dashboard widgets
            </Typography>
            <Button
              variant="ghost"
              size="sm"
              disabled={!customized}
              onClick={() => resetScope(scope)}
              title="Reset widgets to defaults"
              aria-label="Reset dashboard widgets to defaults"
            >
              <RotateCcw size={12} />
              <span>Reset</span>
            </Button>
          </Flex>

          <Typography variant="caption" component="span">
            {`${visibleIds.length} of ${knownIds.length} shown · drag cards or use arrows to reorder`}
          </Typography>

          <Stack gap={0} sx={{ maxHeight: 'min(55vh, 22rem)', overflowY: 'auto' }}>
            {ordered.map((id, index) => {
              const label = widgetLabel(id);
              const visible = visibleIds.includes(id);
              const visibleIndex = visibleIds.indexOf(id);
              const isLastVisible = visible && visibleIds.length <= 1;

              return (
                <Flex
                  key={id}
                  gap={0.5}
                  alignItems="center"
                  role="group"
                  aria-label={label}
                  sx={{ minWidth: 0, padding: '4px 0' }}
                >
                  <Typography
                    variant="caption"
                    component="span"
                    sx={{ width: 18, textAlign: 'right', opacity: visible ? 1 : 0.45 }}
                  >
                    {index + 1}
                  </Typography>

                  <Typography
                    variant="body2"
                    component="span"
                    noWrap
                    title={label}
                    sx={{ flex: 1, minWidth: 0, opacity: visible ? 1 : 0.45 }}
                  >
                    {label}
                  </Typography>

                  {visible && (
                    <>
                      <IconButton
                        size="xs"
                        variant="ghost"
                        disabled={visibleIndex === 0}
                        onClick={() => moveBy(id, -1)}
                        aria-label={`Move ${label} up`}
                        title={`Move ${label} up`}
                      >
                        <ChevronUp size={12} />
                      </IconButton>

                      <IconButton
                        size="xs"
                        variant="ghost"
                        disabled={visibleIndex === lastIndex}
                        onClick={() => moveBy(id, 1)}
                        aria-label={`Move ${label} down`}
                        title={`Move ${label} down`}
                      >
                        <ChevronDown size={12} />
                      </IconButton>
                    </>
                  )}

                  <Toggle
                    checked={visible}
                    disabled={isLastVisible}
                    onChange={(checked) => {
                      if (checked) showWidget(scope, id);
                      else hideWidget(scope, id);
                    }}
                    ariaLabel={`Show ${label} widget`}
                  />

                  {isCustomWidgetId(id) && (
                    <IconButton
                      size="xs"
                      variant="ghost"
                      onClick={() => deleteCustomCard(id)}
                      aria-label={`Delete ${label} custom card`}
                      title={`Delete ${label} custom card`}
                    >
                      <Trash2 size={12} />
                    </IconButton>
                  )}
                </Flex>
              );
            })}
          </Stack>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setBuilderOpen(true)}
            title="Build a custom KPI card from any channel metric"
            aria-label="Add a custom KPI card"
          >
            <Plus size={14} />
            <span>Custom card</span>
          </Button>

          <Typography variant="caption" component="span">
            {'At least one widget always stays visible. Your layout follows you to other devices.'}
          </Typography>
        </Stack>
      </PopoverContent>
    </ShadcnPopover>
      <CustomCardDialog open={builderOpen} onClose={() => setBuilderOpen(false)} />
    </>
  );
}

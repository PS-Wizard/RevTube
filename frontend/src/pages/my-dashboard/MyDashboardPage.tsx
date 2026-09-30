import React from 'react';
import { MdDashboardCustomize } from 'react-icons/md';
import { Flex, NativeSelect, Typography } from '@/components/ui';
import { PageShell } from '@/components/layout/PageShell';
import { EmptyState } from '@/components/EmptyState';
import { DateRangeSelector } from '@/components/dashboard/DateRangeSelector';
import { useCustomDashboard } from './useCustomDashboard';
import { CustomDashboardGrid } from './components/CustomDashboardGrid';
import { WidgetHost } from './components/WidgetHost';
import { WidgetPicker } from './components/WidgetPicker';

export function MyDashboardPage(): React.ReactElement {
  const dashboard = useCustomDashboard();
  const {
    channels,
    selectedChannel,
    selectChannel,
    customStartDate,
    customEndDate,
    latestDataDate,
    applyDateRange,
    cells,
    reorderWidgets,
    scopeLabel,
  } = dashboard;

  const renderWidget = React.useCallback(
    (id: string) => <WidgetHost id={id} dashboard={dashboard} />,
    [dashboard],
  );

  return (
    <PageShell
      title="My Dashboard"
      description="Your personal command center — pick widgets, drag cards to rearrange, and your layout follows you to every device."
      actions={
        <Flex gap={1} alignItems="center">
          <WidgetPicker />
        </Flex>
      }
      toolbar={
        <Flex gap={1} alignItems="center" sx={{ flexWrap: 'wrap', minWidth: 0 }}>
          <MdDashboardCustomize size={16} aria-hidden />
          <NativeSelect
            compact
            aria-label="Dashboard channel"
            value={selectedChannel ?? ''}
            onChange={(e) => selectChannel(e.target.value || null)}
          >
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.snippet?.title ?? c.channelTitle ?? c.id}
              </option>
            ))}
          </NativeSelect>
          <DateRangeSelector
            startDate={customStartDate}
            endDate={customEndDate}
            latestDataDate={latestDataDate}
            onRangeChange={(start, end) =>
              applyDateRange(start ? start.toISOString() : null, end ? end.toISOString() : null)
            }
            onClear={() => applyDateRange(null, null)}
          />
          <Typography
            variant="caption"
            noWrap
            title="Each workspace keeps its own dashboard layout"
            sx={{ marginLeft: 'auto' }}
          >
            {scopeLabel} layout
          </Typography>
        </Flex>
      }
    >
      {!selectedChannel ? (
        <EmptyState
          variant="zero"
          title="No channel selected"
          description="Select a channel above — or connect one on the Channel Analytics page — to build your dashboard."
        />
      ) : (
        <CustomDashboardGrid
          cells={cells}
          onReorder={reorderWidgets}
          renderWidget={renderWidget}
        />
      )}
    </PageShell>
  );
}

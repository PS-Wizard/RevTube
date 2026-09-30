import React from 'react';
import { MdAddChart } from 'react-icons/md';
import { Card, CardContent, Flex, SegmentedControl, Stack, Typography } from '@/components/ui';
import { AuditToolBody } from '@/components/audit/AuditToolBody';
import { AuditToolShell } from '@/components/audit/AuditToolShell';
import { EmptyState } from '@/components/EmptyState';
import { PinToDashboardButton } from '@/components/dashboard/pin-to-dashboard';
import { useAnomalies } from './useAnomalies';
import { ANOMALY_HELP_TEXT, toggleList } from './anomaliesUtils';
import { AnomalyFiltersBar } from './components/AnomalyFiltersBar';
import { AnomalyDetailDialog } from './components/AnomalyDetailDialog';
import { AnomalyList } from './components/AnomalyList';
import { AnomalyPagination } from './components/AnomalyPagination';
import { AnomalyTable } from './components/AnomalyTable';
import { KpiRow } from './AnomalySections';

export function AnomaliesPage(): React.ReactElement {
  const state = useAnomalies();
  const { channelId, metrics, setMetrics, kinds, setKinds } = state;
  const { severities, setSeverities, statuses, setStatuses } = state;
  const { hasActiveFilters, resetFilters } = state;
  const { page, totalPages, setPage, pageSize, setPageSize, total, items, listQuery } = state;
  const { viewMode, setViewMode } = state;
  const { metricsQuery, selectedId, selectAnomaly, scan, scanPending } = state;

  return (
    <AuditToolShell
      title="Anomaly Detection"
      description="Weekday-aware spike, dip and trend detection across views, watch time, subscribers and engagement — with driver videos, evidence and AI root-cause analysis."
      icon={<MdAddChart size={20} aria-hidden />}
      helpText={ANOMALY_HELP_TEXT}
      actions={<PinToDashboardButton widgetId="anomalies" />}
    >
      <AuditToolBody>
        <Stack gap={2}>
          <KpiRow state={state} />
          <AnomalyFiltersBar
            metrics={metricsQuery.data?.metrics ?? []}
            metricsLoading={metricsQuery.isLoading}
            selectedMetrics={metrics}
            onToggleMetric={(k) => setMetrics(toggleList(metrics, k))}
            kinds={kinds}
            onToggleKind={(k) => setKinds(toggleList(kinds, k))}
            severities={severities}
            onToggleSeverity={(s) => setSeverities(toggleList(severities, s))}
            statuses={statuses}
            onToggleStatus={(s) => setStatuses(toggleList(statuses, s))}
            onScan={scan}
            scanPending={scanPending}
            hasChannel={!!channelId}
            total={total}
            hasActiveFilters={hasActiveFilters}
            onClearFilters={resetFilters}
          />
          {!channelId ? (
            <EmptyState
              variant="zero"
              title="No channel selected"
              description="Select a channel from the header to view its anomalies."
            />
          ) : (
            <Stack gap={1}>
              <Flex gap={1} alignItems="center" sx={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <Typography variant="caption">
                  {total} {total === 1 ? 'anomaly' : 'anomalies'} · newest first
                </Typography>
                <SegmentedControl
                  value={viewMode}
                  onChange={(v) => setViewMode(v as 'table' | 'grid')}
                  ariaLabel="Anomaly list layout"
                  options={[
                    { value: 'table', label: 'Table' },
                    { value: 'grid', label: 'Grid' },
                  ]}
                />
              </Flex>
              {viewMode === 'grid' ? (
                <AnomalyList
                  items={items}
                  loading={listQuery.isLoading}
                  error={listQuery.error}
                  selectedId={selectedId}
                  onSelect={selectAnomaly}
                  onRetry={() => listQuery.refetch()}
                  layout="grid"
                />
              ) : listQuery.isLoading || listQuery.error || items.length === 0 ? (
                <AnomalyList
                  items={items}
                  loading={listQuery.isLoading}
                  error={listQuery.error}
                  selectedId={selectedId}
                  onSelect={selectAnomaly}
                  onRetry={() => listQuery.refetch()}
                />
              ) : (
                <AnomalyTable items={items} selectedId={selectedId} onSelect={selectAnomaly} />
              )}
              <AnomalyPagination
                page={page}
                totalPages={totalPages}
                total={total}
                pageSize={pageSize}
                onPage={setPage}
                onPageSize={setPageSize}
              />
              <AnomalyDetailDialog state={state} onClose={() => selectAnomaly(null)} />
            </Stack>
          )}
          <Card size="sm">
            <CardContent>
              <Typography variant="caption">
                Detection runs automatically after each data sync. Baselines use the trailing 28-day
                weekday-aware median with robust z-scoring.
              </Typography>
            </CardContent>
          </Card>
        </Stack>
      </AuditToolBody>
    </AuditToolShell>
  );
}

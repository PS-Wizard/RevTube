import React from 'react';
import { MdAddChart } from 'react-icons/md';
import {
  Box,
  Dialog,
  DialogBody,
  DialogTitleBlock,
  SegmentedControl,
  Spinner,
  Stack,
  Typography,
} from '@/components/ui';
import { EmptyState } from '@/components/EmptyState';
import {
  AnomalyDetailChart,
  AnomalyDrivers,
  AnomalySignals,
} from './AnomalyDetail';
import { AnomalyExplanationCard } from './AnomalyExplanation';
import { STATUS_LABELS, anomalyHeadline, formatDayLabel } from '../anomaliesUtils';
import type { AnomalyStatus } from '../../../types/anomaly';
import type { UseAnomalies } from '../useAnomalies';

/**
 * Full-width table companion: the anomaly detail (chart, drivers, evidence,
 * compact AI analysis, status control) in a 70%-viewport dialog — the same
 * shell pattern as the audit inspector dialogs.
 */
export function AnomalyDetailDialog({
  state,
  onClose,
}: {
  state: UseAnomalies;
  onClose: () => void;
}): React.ReactElement {
  const {
    selectedId,
    detail,
    detailQuery,
    seriesQuery,
    explain,
    explainPending,
    setStatus,
    statusPending,
  } = state;

  return (
    <Dialog
      open={selectedId !== null}
      onClose={onClose}
      maxWidth={false}
      fullWidth
      className="w-[calc(100%-2rem)] sm:w-[70%] sm:max-w-[75rem]"
      closeOnBackdrop
      closeOnEscape
    >
      <DialogTitleBlock
        icon={<MdAddChart size={18} aria-hidden />}
        title={detail ? anomalyHeadline(detail) : 'Anomaly detail'}
        subtitle={
          detail
            ? `${detail.metricLabel} · ${formatDayLabel(detail.anomalyDate)}${detail.endDate && detail.endDate !== detail.anomalyDate ? ` → ${formatDayLabel(detail.endDate)}` : ''}`
            : undefined
        }
      />
      <DialogBody className="flex max-h-[75vh] flex-col gap-4 overflow-y-auto px-4 py-4 sm:px-6">
        {detailQuery.isLoading ? (
          <Box sx={{ paddingBlock: 48 }}>
            <Stack alignItems="center" justifyContent="center" gap={1.5}>
              <Spinner size={32} />
              <Typography variant="subtitle2">Loading anomaly details…</Typography>
            </Stack>
          </Box>
        ) : !detail ? (
          <EmptyState
            variant="zero"
            title="Anomaly not found"
            description="It may have been pruned. Pick another anomaly from the table."
          />
        ) : (
          <>
            <Box>
              <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase' }}>
                Status
              </Typography>
              <Box sx={{ marginTop: 8 }}>
                <SegmentedControl
                  value={detail.status}
                  onChange={(v) => void setStatus(detail.id, v as AnomalyStatus)}
                  ariaLabel="Anomaly status"
                  options={(['open', 'acknowledged', 'dismissed'] as AnomalyStatus[]).map((s) => ({
                    value: s,
                    label: STATUS_LABELS[s],
                    disabled: statusPending,
                  }))}
                />
              </Box>
              <Typography variant="caption" sx={{ color: 'var(--rt-color-text-tertiary)' }}>
                Mark what you have already seen — acknowledged stays visible, dismissed hides it from the default filters.
              </Typography>
            </Box>
            <AnomalyDetailChart
              anomaly={detail}
              series={seriesQuery.data}
              loading={seriesQuery.isLoading}
            />
            <AnomalyDrivers anomaly={detail} />
            <AnomalySignals anomaly={detail} />
            <AnomalyExplanationCard
              anomaly={detail}
              pending={explainPending}
              onExplain={(refresh) => void explain(detail.id, refresh)}
            />
          </>
        )}
      </DialogBody>
    </Dialog>
  );
}

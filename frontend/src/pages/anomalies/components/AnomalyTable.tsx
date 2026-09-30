import React, { useMemo } from 'react';
import { MdAutoAwesome, MdShowChart, MdTrendingDown, MdTrendingUp } from 'react-icons/md';
import { Badge } from '@/components/ui';
import {
  AuditDataTable,
  type AuditColumnDef,
} from '@/components/audit/AuditDataTable';
import type { Anomaly, AnomalySeverity, AnomalyStatus } from '../../../types/anomaly';
import {
  KIND_LABELS,
  SEVERITY_LABELS,
  STATUS_LABELS,
  anomalyHeadline,
  formatDayLabel,
  formatDeltaPct,
  formatSigned,
} from '../anomaliesUtils';

function KindCell({ kind }: { kind: Anomaly['kind'] }): React.ReactElement {
  const Icon = kind === 'spike' ? MdTrendingUp : kind === 'dip' ? MdTrendingDown : MdShowChart;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-[var(--rt-color-text-secondary)]">
      <Icon size={14} aria-hidden />
      {KIND_LABELS[kind]}
    </span>
  );
}

function severityColor(severity: AnomalySeverity): string {
  if (severity === 'critical') return 'error';
  if (severity === 'high') return 'warning';
  if (severity === 'medium') return 'info';
  if (severity === 'low') return 'secondary';
  return 'default';
}

function statusColor(status: AnomalyStatus): string {
  if (status === 'open') return 'warning';
  if (status === 'acknowledged') return 'info';
  return 'secondary';
}

/**
 * Dense table view of one anomaly page — the same shared resizable
 * AuditDataTable the audit tools use. Order is server-side (newest first),
 * so headers resize but don't sort; row click selects the detail panel.
 */
export function AnomalyTable({
  items,
  selectedId,
  onSelect,
}: {
  items: Anomaly[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}): React.ReactElement {
  const columns: AuditColumnDef<Anomaly>[] = useMemo(() => {
    return [
      {
        key: 'date',
        label: 'Date',
        width: 120,
        render: (row) => (
          <span className="whitespace-nowrap text-xs text-[var(--rt-color-text-secondary)]">
            {formatDayLabel(row.anomalyDate)}
            {row.endDate && row.endDate !== row.anomalyDate ? ` → ${formatDayLabel(row.endDate)}` : ''}
          </span>
        ),
      },
      {
        key: 'anomaly',
        label: 'Anomaly',
        width: 280,
        render: (row) => (
          <span className="block min-w-0">
            <span className="block truncate text-xs font-medium text-[var(--rt-color-text)]" title={anomalyHeadline(row)}>
              {anomalyHeadline(row)}
            </span>
            {row.evidence?.summary && (
              <span className="block truncate text-[11px] text-[var(--rt-color-text-tertiary)]" title={row.evidence.summary}>
                {row.evidence.summary}
              </span>
            )}
          </span>
        ),
      },
      {
        key: 'kind',
        label: 'Kind',
        width: 90,
        render: (row) => <KindCell kind={row.kind} />,
      },
      {
        key: 'severity',
        label: 'Severity',
        width: 100,
        align: 'center',
        render: (row) => <Badge color={severityColor(row.severity)}>{SEVERITY_LABELS[row.severity]}</Badge>,
      },
      {
        key: 'delta',
        label: 'Change',
        width: 130,
        align: 'right',
        render: (row) => (
          <span
            className="text-xs font-bold tabular-nums"
            style={{ color: row.delta > 0 ? 'var(--rt-color-success)' : 'var(--rt-color-danger)' }}
          >
            {formatSigned(row.delta, row.metricUnit)} ({formatDeltaPct(row.deltaPct)})
          </span>
        ),
      },
      {
        key: 'status',
        label: 'Status',
        width: 120,
        align: 'center',
        render: (row) => <Badge color={statusColor(row.status)}>{STATUS_LABELS[row.status]}</Badge>,
      },
      {
        key: 'ai',
        label: 'AI',
        width: 80,
        align: 'center',
        render: (row) => (
          row.explanation
            ? <Badge color="info" className="inline-flex items-center gap-1"><MdAutoAwesome size={11} aria-hidden /> Explained</Badge>
            : <span className="text-xs text-[var(--rt-color-text-tertiary)]">—</span>
        ),
      },
    ];
  }, []);

  return (
    <AuditDataTable<Anomaly>
      columns={columns}
      rows={items}
      getRowKey={(r) => r.id}
      onRowClick={(r) => onSelect(r.id)}
      emptyMessage="No anomalies found."
      ariaLabel={`Anomalies table, newest first${selectedId ? `, anomaly ${selectedId} selected` : ''}. Columns resize by dragging.`}
    />
  );
}

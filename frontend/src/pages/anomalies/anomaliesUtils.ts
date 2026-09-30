import type {
  Anomaly,
  AnomalyKind,
  AnomalySeverity,
  AnomalyStatus,
} from '../../types/anomaly';

export const KIND_LABELS: Record<AnomalyKind, string> = {
  spike: 'Spike',
  dip: 'Dip',
  trend: 'Trend',
};

export const SEVERITY_LABELS: Record<AnomalySeverity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
};

export const STATUS_LABELS: Record<AnomalyStatus, string> = {
  open: 'Open',
  acknowledged: 'Acknowledged',
  dismissed: 'Dismissed',
};

export function formatCompact(value: number | null | undefined, unit?: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  let core: string;
  if (abs >= 1_000_000) core = `${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  else if (abs >= 1_000) core = `${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  else if (Number.isInteger(value)) core = `${abs}`;
  else core = value.toFixed(1);
  return unit === '%' ? `${sign}${core}%` : `${sign}${core}${unit ? ` ${unit}` : ''}`;
}

export function formatSigned(value: number | null | undefined, unit?: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${formatCompact(value, unit)}`;
}

export function formatDeltaPct(deltaPct: number | null | undefined): string {
  if (deltaPct === null || deltaPct === undefined || !Number.isFinite(deltaPct)) return '—';
  const pct = deltaPct * 100;
  const prefix = pct > 0 ? '+' : '';
  return `${prefix}${pct.toFixed(pct >= 100 || pct <= -100 ? 0 : 1)}%`;
}

export function formatDayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function anomalyHeadline(a: Anomaly): string {
  const kindWord = a.kind === 'trend' ? 'multi-day trend' : a.kind;
  return `${a.metricLabel} ${kindWord} on ${formatDayLabel(a.anomalyDate)}`;
}

export function statusRank(status: AnomalyStatus): number {
  return status === 'open' ? 0 : status === 'acknowledged' ? 1 : 2;
}

export function toggleList<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export const ANOMALY_PAGE_SIZES = [10, 25, 50] as const;

/** Windowed page numbers: first · prev-current-next · last, with ellipses. */
export function pageWindow(page: number, totalPages: number): Array<number | '…'> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const keep = new Set([1, totalPages, page - 1, page, page + 1]);
  const nums = [...keep].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);
  const out: Array<number | '…'> = [];
  for (let i = 0; i < nums.length; i++) {
    if (i > 0 && nums[i] - nums[i - 1] > 1) out.push('…');
    out.push(nums[i]);
  }
  return out;
}

export const ANOMALY_HELP_TEXT = [
  'Anomaly Detection Overview:',
  '',
  '• Weekday-aware baseline (trailing 28-day median) with robust z-scoring',
  '• Latest anomalies first — filter by metric, kind, severity or status',
  '• Each anomaly names the videos that drove it, plus uploads and correlated metrics',
  '• AI explains the likely cause on demand (cached per anomaly)',
].join('\n');

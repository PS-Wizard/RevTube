// ─────────────────────────────────────────────────────────────────────────────
// AuditDataTable — shared generic table for all audit tools (public audit,
// thumbnail / playlist / video / channel audit).
//
// Tailwind CSS + shadcn Table primitives. Spacing scale:
// wrapper `rounded-lg border shadow-xs`, header `px-4 py-3 gap-2`,
// cells `px-4 py-3`, empty state `p-8`. No custom CSS, no raw hex —
// all color comes from `--rt-*` design tokens via arbitrary values.
// ─────────────────────────────────────────────────────────────────────────────
import type { ReactNode, MouseEvent as ReactMouseEvent } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
  ShadcnTableCell,
} from '../ui';
import { Badge } from '../ui';
import { ColGroup, ResizeHandle } from './ResizableColumns';
import { useColumnWidths } from './useColumnWidths';

// ── ScorePill ─────────────────────────────────────────────────────────────────

type ScorePillVariant = 'good' | 'moderate' | 'poor' | 'none';

/**
 * Returns which pill variant to use for a given score (0-100 or custom max).
 * Pass `null` / `undefined` to get 'none' (renders a dash).
 */
export function getScorePillVariant(
  score: number | null | undefined,
  /** Upper bound for percentage calculation. Default 100. */
  max = 100,
): ScorePillVariant {
  if (score == null) return 'none';
  const pct = max > 0 ? (score / max) * 100 : 0;
  if (pct >= 80) return 'good';
  if (pct >= 50) return 'moderate';
  return 'poor';
}

interface ScorePillProps {
  /** Numeric score to display. Pass null/undefined to show a dash. */
  score: number | null | undefined;
  /** Upper bound used to compute the percentage tier. Default 100. */
  max?: number;
  /** Label suffix, e.g. "/100". If omitted, just the raw number is shown. */
  suffix?: string;
  /** Explicit variant override — skips the automatic tier calculation. */
  variant?: ScorePillVariant;
}

const SCORE_PILL_TONES: Record<Exclude<ScorePillVariant, 'none'>, string> = {
  good: 'bg-[var(--rt-color-success-surface)] text-[var(--rt-color-success)] border-[var(--rt-color-success)]',
  moderate:
    'bg-[var(--rt-color-warning-surface)] text-[var(--rt-color-warning)] border-[var(--rt-color-border)]',
  poor: 'bg-[var(--rt-color-danger-surface)] text-[var(--rt-color-danger)] border-[var(--rt-color-danger)]',
};

/** Consistent score pill used across all audit tables (shadcn Badge + tokens). */
export function ScorePill({ score, max = 100, suffix, variant }: ScorePillProps) {
  const v = variant ?? getScorePillVariant(score, max);
  if (v === 'none') {
    return (
      <span
        className="inline-flex min-w-8 items-center justify-center px-2 py-0.5 text-xs text-[var(--rt-color-text-tertiary)]"
        aria-label="Not measured"
      >
        —
      </span>
    );
  }
  return (
    <Badge
      variant="outline"
      className={cn(
        'min-w-8 justify-center px-2 py-0.5 text-xs font-bold tabular-nums',
        SCORE_PILL_TONES[v],
      )}
    >
      {typeof score === 'number' ? score.toFixed(0) : '—'}
      {suffix && <span className="ml-0.5 text-[0.85em] font-normal opacity-65">{suffix}</span>}
    </Badge>
  );
}

// ── Column definition ─────────────────────────────────────────────────────────

export interface AuditColumnDef<TRow> {
  /** Unique key (used as React key). */
  key: string;
  /** Header label text. */
  label: string;
  /** Initial column width in px. User can drag to resize. */
  width: number;
  /** Text alignment of both header and cell content. Default 'left'. */
  align?: 'left' | 'center' | 'right';
  /** Inline style added to the <th>. E.g. borderLeft for section separators. */
  headerStyle?: React.CSSProperties;
  /** Inline style added to each <td>. */
  cellStyle?: React.CSSProperties;
  /** Cell renderer. Return any ReactNode. */
  render: (row: TRow, index: number) => ReactNode;
  /** Clickable header that cycles biggest → lowest → normal. Default false. */
  sortable?: boolean;
  /** Sort identity reported to `onSort` (defaults to `key`). */
  sortKey?: string;
}

// ── AuditDataTable ────────────────────────────────────────────────────────────

export interface AuditDataTableProps<TRow> {
  columns: AuditColumnDef<TRow>[];
  rows: TRow[];
  getRowKey: (row: TRow, index: number) => string | number;
  /** Row click handler. When provided the row gets a pointer cursor. */
  onRowClick?: (row: TRow, index: number) => void;
  /** Message rendered inside an empty-state row when `rows` is empty. */
  emptyMessage?: string;
  /** Extra class names on the outer wrapper element. */
  className?: string;
  /** Aria label for the <table> element. */
  ariaLabel?: string;
  /** Active sort column identity (matches the column's `sortKey ?? key`). */
  sortKey?: string | null;
  /** Active sort direction. `null`/undefined = normal (unsorted) order. */
  sortDir?: 'asc' | 'desc' | null;
  /** Header-click handler for `sortable` columns. Cycles biggest → lowest → normal. */
  onSort?: (key: string) => void;
}

/**
 * Generic audit data table built on shadcn Table primitives + Tailwind spacing.
 * Resizable columns, consistent header styling, hover rows, score pills,
 * and a shared empty-state. Each consumer passes typed `columns` + `rows`.
 */
export function AuditDataTable<TRow>({
  columns,
  rows,
  getRowKey,
  onRowClick,
  emptyMessage = 'No data',
  className,
  ariaLabel = 'audit data table',
  sortKey,
  sortDir,
  onSort,
}: AuditDataTableProps<TRow>) {
  const { widths, total, startResize } = useColumnWidths(columns.map((c) => c.width));

  const alignClass = (align?: 'left' | 'center' | 'right') => {
    if (align === 'center') return 'text-center';
    if (align === 'right') return 'text-right';
    return 'text-left';
  };

  const sortIcon = (col: AuditColumnDef<TRow>) => {
    const active = (col.sortKey ?? col.key) === sortKey && sortDir != null;
    const Icon = active ? (sortDir === 'desc' ? ArrowDown : ArrowUp) : ChevronsUpDown;
    return (
      <Icon
        size={12}
        aria-hidden
        className={cn('shrink-0', active ? 'text-[var(--rt-color-accent)]' : 'text-[var(--rt-color-text-tertiary)] opacity-70')}
      />
    );
  };

  return (
    <div
      className={cn(
        'w-full min-w-0 overflow-x-auto rounded-[var(--rt-radius-lg)] border border-[var(--rt-color-border)] bg-[var(--rt-color-bg-elevated)] shadow-xs',
        className,
      )}
    >
      <table
        aria-label={ariaLabel}
        style={{ tableLayout: 'fixed', minWidth: total, width: '100%', borderCollapse: 'collapse' }}
        className="w-full caption-bottom text-sm"
      >
        <ColGroup widths={widths} />
        <TableHeader className="bg-[var(--rt-color-bg-subtle)]">
          <TableRow className="border-b border-[var(--rt-color-border)] bg-[var(--rt-color-bg-subtle)] hover:bg-[var(--rt-color-bg-subtle)]">
            {columns.map((col, i) => {
              const colSortKey = col.sortKey ?? col.key;
              const isActive = col.sortable && colSortKey === sortKey && sortDir != null;
              return (
                <TableHead
                  key={col.key}
                  style={{ ...col.headerStyle, width: widths[i], minWidth: widths[i] }}
                  aria-sort={col.sortable ? (isActive ? (sortDir === 'desc' ? 'descending' : 'ascending') : 'none') : undefined}
                  className={cn(
                    'relative px-4 py-3 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap text-[var(--rt-color-text-secondary)] select-none',
                    alignClass(col.align),
                  )}
                >
                  {col.sortable && onSort ? (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onSort(colSortKey); }}
                      title={`Sort by ${col.label} (biggest → lowest → normal)`}
                      aria-label={`Sort by ${col.label}`}
                      className={cn(
                        'inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--rt-radius-sm)] px-1 py-0.5 uppercase tracking-wider transition-colors hover:text-[var(--rt-color-accent)] focus-visible:outline-2 focus-visible:outline-[var(--rt-color-accent)]',
                        isActive && 'text-[var(--rt-color-accent)]',
                        col.align === 'center' && 'mx-auto',
                        col.align === 'right' && 'ml-auto',
                      )}
                    >
                      <span>{col.label}</span>
                      {sortIcon(col)}
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-2">{col.label}</span>
                  )}
                  <ResizeHandle onResizeStart={(e: ReactMouseEvent) => startResize(i, e)} />
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <ShadcnTableCell
                colSpan={columns.length}
                className="px-4 py-8 text-center text-xs text-[var(--rt-color-text-tertiary)] italic"
              >
                {emptyMessage}
              </ShadcnTableCell>
            </TableRow>
          ) : (
            rows.map((row, idx) => {
              const rowKey = getRowKey(row, idx);
              const clickable = Boolean(onRowClick);
              return (
                <TableRow
                  key={rowKey}
                  onClick={clickable ? () => onRowClick!(row, idx) : undefined}
                  className={cn(
                    'border-b border-[var(--rt-color-border)] transition-colors last:border-0 hover:bg-[var(--rt-color-bg-subtle)]',
                    clickable && 'cursor-pointer',
                  )}
                >
                  {columns.map((col) => (
                    <ShadcnTableCell
                      key={col.key}
                      style={col.cellStyle}
                      className={cn(
                        'px-4 py-3 align-middle text-xs text-[var(--rt-color-text)]',
                        alignClass(col.align),
                      )}
                    >
                      {col.render(row, idx)}
                    </ShadcnTableCell>
                  ))}
                </TableRow>
              );
            })
          )}
        </TableBody>
      </table>
      {/* Screen-reader table width floor for resizable fixed layout */}
      <span aria-hidden className="hidden" style={{ minWidth: total }} />
    </div>
  );
}

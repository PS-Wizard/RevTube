/**
 * Custom-dashboard matrix helpers (pure, tested).
 *
 * The grid is row-packed on a 12-column matrix: `packOrderToCells` turns a
 * visible id order (+ per-widget spans) into canonical `{x, y, w, h}` cells,
 * and `cellsToOrder` restores the order by sorting row-major. Because packing
 * is deterministic, drag-reorder (a 1-D operation) round-trips through the
 * matrix losslessly — and the stored cells stay human-visualizable.
 *
 * `normalizeDbLayout` is the single choke point for anything read from
 * Postgres/localStorage: it enforces the backend contract (bounds, caps),
 * drops unknown widget ids, and appends missing catalogue ids so newly
 * shipped widgets appear instead of vanishing.
 */

import {
  getCustomDashboardWidgetSpan,
  type CustomDashboardWidgetSpan,
} from '../config/statCardRegistry';
import {
  DASHBOARD_GRID_COLS,
  EMPTY_DASHBOARD_LAYOUT,
  type DashboardCell,
  type DashboardLayout,
} from '../types/customDashboard';

const MAX_CELLS = 24;
const MAX_ROWS = 100;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$/;

function spanWidth(span: CustomDashboardWidgetSpan): number {
  return span === 'half' ? 6 : DASHBOARD_GRID_COLS;
}

/**
 * Row-pack a visible id order into canonical matrix cells.
 * `hidden` is carried on the layout by the caller (pack only places visible).
 */
export function packOrderToCells(
  order: string[],
  spanOf: (id: string) => CustomDashboardWidgetSpan = getCustomDashboardWidgetSpan,
): DashboardCell[] {
  const cells: DashboardCell[] = [];
  let x = 0;
  let y = 0;
  for (const raw of order) {
    if (typeof raw !== 'string') continue;
    const id = raw.trim();
    if (!ID_PATTERN.test(id)) continue;
    if (cells.some((c) => c.id === id)) continue;
    if (cells.length >= MAX_CELLS) break;
    const w = Math.min(spanWidth(spanOf(id)), DASHBOARD_GRID_COLS);
    if (x + w > DASHBOARD_GRID_COLS) {
      y += 1;
      x = 0;
    }
    if (y >= MAX_ROWS) break;
    cells.push({ id, x, y, w, h: 1 });
    x += w;
    if (x >= DASHBOARD_GRID_COLS) {
      y += 1;
      x = 0;
    }
  }
  return cells;
}

/** Visible ids in display order (row-major sort). */
export function cellsToOrder(cells: DashboardCell[]): string[] {
  return [...cells]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((c) => c.id);
}

/**
 * Normalize anything read from Postgres/localStorage against the catalogue.
 * Unknown ids drop, missing catalogue ids append (packed at the end), hidden
 * is narrowed to known non-visible ids. Always returns canonical packed cells.
 */
export function normalizeDbLayout(
  input: unknown,
  knownIds: string[],
  spanOf: (id: string) => CustomDashboardWidgetSpan = getCustomDashboardWidgetSpan,
): DashboardLayout {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { cells: packOrderToCells(knownIds, spanOf), hidden: [] };
  }
  const raw = input as Partial<DashboardLayout>;
  const known = new Set(knownIds.filter((id) => ID_PATTERN.test(id)));

  // Hidden first (cells win over hidden, mirroring the backend contract).
  const rawHidden = new Set<string>();
  if (Array.isArray(raw.hidden)) {
    for (const id of raw.hidden) {
      if (typeof id !== 'string') continue;
      const trimmed = id.trim();
      if (known.has(trimmed)) rawHidden.add(trimmed);
      if (rawHidden.size >= MAX_CELLS) break;
    }
  }

  const cellIds: string[] = [];
  if (Array.isArray(raw.cells)) {
    const sorted = [...raw.cells].sort((a, b) => (a?.y ?? 0) - (b?.y ?? 0) || (a?.x ?? 0) - (b?.x ?? 0));
    for (const cell of sorted) {
      const id = typeof cell?.id === 'string' ? cell.id.trim() : '';
      if (!known.has(id) || cellIds.includes(id)) continue;
      cellIds.push(id);
      if (cellIds.length >= MAX_CELLS) break;
    }
  }
  // Missing catalogue ids append at the end — unless the user hid them.
  const ordered = [...cellIds];
  for (const id of knownIds) {
    if (known.has(id) && !ordered.includes(id) && !rawHidden.has(id)) {
      ordered.push(id);
    }
  }

  const hidden = [...rawHidden].filter((id) => !cellIds.includes(id));
  const visible = ordered.filter((id) => !hidden.includes(id));
  if (visible.length === 0) {
    // A "hide everything" payload can never blank the dashboard.
    return { cells: packOrderToCells(knownIds.slice(0, 1), spanOf), hidden: [] };
  }
  return { cells: packOrderToCells(visible, spanOf), hidden };
}

/** Default layout for a catalogue (all widgets visible, packed). */
export function defaultDbLayout(
  knownIds: string[],
  spanOf: (id: string) => CustomDashboardWidgetSpan = getCustomDashboardWidgetSpan,
): DashboardLayout {
  return { cells: packOrderToCells(knownIds, spanOf), hidden: [] };
}

/** Hide one widget: out of the cells, into `hidden`. */
export function hideWidgetInLayout(layout: DashboardLayout, id: string): DashboardLayout {
  if (!layout.cells.some((c) => c.id === id)) return layout;
  const visible = cellsToOrder(layout.cells).filter((c) => c !== id);
  if (visible.length === 0) return layout; // last widget stays
  return {
    cells: packOrderToCells(visible),
    hidden: [...layout.hidden.filter((h) => h !== id), id],
  };
}

/** Show one widget: out of `hidden`, appended at the end of the grid. */
export function showWidgetInLayout(layout: DashboardLayout, id: string): DashboardLayout {
  if (!layout.hidden.includes(id)) return layout;
  return {
    cells: packOrderToCells([...cellsToOrder(layout.cells), id]),
    hidden: layout.hidden.filter((h) => h !== id),
  };
}

/** Re-pack after a drag-reorder of the visible ids. */
export function reorderVisibleInLayout(
  layout: DashboardLayout,
  visibleOrder: string[],
): DashboardLayout {
  const known = new Set(cellsToOrder(layout.cells));
  const next = visibleOrder.filter((id) => known.has(id));
  for (const id of known) {
    if (!next.includes(id)) next.push(id);
  }
  return { cells: packOrderToCells(next), hidden: layout.hidden };
}

/** True when the layout differs from the catalogue defaults. */
export function isLayoutCustomized(layout: DashboardLayout, knownIds: string[]): boolean {
  if (layout.hidden.length > 0) return true;
  const defaults = defaultDbLayout(knownIds);
  return cellsToOrder(layout.cells).join('|') !== cellsToOrder(defaults.cells).join('|');
}

export { EMPTY_DASHBOARD_LAYOUT };

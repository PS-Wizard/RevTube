/**
 * Custom-dashboard grid matrix types.
 *
 * A layout is one 12-column grid per (user, scope):
 *   { cells: [{ id, x, y, w, h }], hidden: [ids] }
 * `cells` holds visible widgets in row-major order; `hidden` holds
 * user-hidden widget ids. Persisted in Postgres (`custom_dashboard_layouts`).
 */

export interface DashboardCell {
  /** Stable widget id (registry contract, never renamed once shipped). */
  id: string;
  /** Column of the cell origin (0-based, x + w <= GRID_COLS). */
  x: number;
  /** Row of the cell origin (0-based). */
  y: number;
  /** Width in grid units (1..GRID_COLS). */
  w: number;
  /** Height in grid units (reserved for future resize; 1 today). */
  h: number;
}

export interface DashboardLayout {
  cells: DashboardCell[];
  hidden: string[];
}

/** Width of the dashboard grid. Mirrors the backend (`GRID_COLS`). */
export const DASHBOARD_GRID_COLS = 12;

export const EMPTY_DASHBOARD_LAYOUT: DashboardLayout = { cells: [], hidden: [] };

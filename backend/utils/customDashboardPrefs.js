/**
 * Custom-dashboard layout preferences -- pure sanitizer.
 *
 * A layout is a 12-column grid matrix owned by one user in one scope:
 *   {
 *     cells:  [{ id: "channel-kpis", x: 0, y: 0, w: 12, h: 1 }],
 *     hidden: ["goals"]
 *   }
 *   - cells  : visible widgets with grid positions (x/y origin top-left,
 *              w/h in grid units, x + w must fit the 12-column row)
 *   - hidden : widget ids the user hid (kept out of `cells`)
 *
 * Like `cardLayoutPrefs.js`, the backend stays registry-agnostic: widget ids
 * only need to be well-formed (the frontend drops ids it no longer knows),
 * and everything is bounded so a hand-crafted request can never write junk
 * into the table.
 */

const GRID_COLS = 12;
const MAX_CELLS = 24;
const MAX_ROWS = 100;
/** Widget ids: `channel-kpis`, `hero:topCountry`, ... (same contract as cards). */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$/;
/** Dashboard names: `default`, `morning-review`, ... */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function toInt(value, fallback = 0) {
  const n = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isInteger(n) ? n : fallback;
}

/** Validate one matrix cell; returns a canonical cell or null. */
function sanitizeCell(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (typeof raw.id !== "string" || !ID_PATTERN.test(raw.id.trim())) return null;
  const x = toInt(raw.x, -1);
  const y = toInt(raw.y, -1);
  const w = toInt(raw.w, 0);
  const h = toInt(raw.h, 0);
  if (x < 0 || y < 0 || y >= MAX_ROWS) return null;
  if (w < 1 || w > GRID_COLS || h < 1 || h > GRID_COLS) return null;
  if (x + w > GRID_COLS) return null;
  return { id: raw.id.trim(), x, y, w, h };
}

function sanitizeIdList(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const id = raw.trim();
    if (!ID_PATTERN.test(id)) continue;
    if (out.includes(id)) continue;
    if (out.length >= MAX_CELLS) break;
    out.push(id);
  }
  return out;
}

/**
 * Sanitize a whole dashboard layout. Always returns a plain object safe to
 * store as JSONB: `{ cells: [...], hidden: [...] }` (`{ cells: [], hidden: [] }`
 * for junk input). Hidden ids that also appear in `cells` are dropped from
 * `hidden` (cells win).
 */
function sanitizeDashboardLayout(input) {
  const empty = { cells: [], hidden: [] };
  if (!input || typeof input !== "object" || Array.isArray(input)) return empty;

  const cells = [];
  const seen = new Set();
  if (Array.isArray(input.cells)) {
    for (const raw of input.cells) {
      if (cells.length >= MAX_CELLS) break;
      const cell = sanitizeCell(raw);
      if (!cell || seen.has(cell.id)) continue;
      seen.add(cell.id);
      cells.push(cell);
    }
  }
  cells.sort((a, b) => a.y - b.y || a.x - b.x);

  const hidden = sanitizeIdList(input.hidden).filter((id) => !seen.has(id));
  return { cells, hidden };
}

/** Sanitize a dashboard name (`default` for junk). */
function sanitizeDashboardName(value) {
  if (typeof value === "string" && NAME_PATTERN.test(value.trim())) {
    return value.trim();
  }
  return "default";
}

/** True when a sanitized layout carries nothing worth persisting. */
function isEmptyDashboardLayout(layout) {
  return (
    !layout ||
    (!Array.isArray(layout.cells) || layout.cells.length === 0) &&
    (!Array.isArray(layout.hidden) || layout.hidden.length === 0)
  );
}

module.exports = {
  GRID_COLS,
  MAX_CELLS,
  sanitizeCell,
  sanitizeDashboardLayout,
  sanitizeDashboardName,
  isEmptyDashboardLayout,
};

import { describe, it, expect } from 'vitest';
const {
  GRID_COLS,
  sanitizeCell,
  sanitizeDashboardLayout,
  sanitizeDashboardName,
  isEmptyDashboardLayout,
} = require('./customDashboardPrefs');

describe('sanitizeCell', () => {
  it('accepts a well-formed cell', () => {
    expect(
      sanitizeCell({ id: 'channel-kpis', x: 0, y: 1, w: 12, h: 1 }),
    ).toEqual({ id: 'channel-kpis', x: 0, y: 1, w: 12, h: 1 });
  });

  it('rejects out-of-grid geometry', () => {
    expect(sanitizeCell({ id: 'a', x: 7, y: 0, w: 6, h: 1 })).toBeNull(); // 7+6 > 12
    expect(sanitizeCell({ id: 'a', x: -1, y: 0, w: 6, h: 1 })).toBeNull();
    expect(sanitizeCell({ id: 'a', x: 0, y: 0, w: 0, h: 1 })).toBeNull();
    expect(sanitizeCell({ id: 'a', x: 0, y: 0, w: 13, h: 1 })).toBeNull();
    expect(sanitizeCell({ id: ' bad id!', x: 0, y: 0, w: 6, h: 1 })).toBeNull();
    expect(sanitizeCell(null)).toBeNull();
    expect(GRID_COLS).toBe(12);
  });
});

describe('sanitizeDashboardLayout', () => {
  it('returns empty for junk input', () => {
    expect(sanitizeDashboardLayout(null)).toEqual({ cells: [], hidden: [] });
    expect(sanitizeDashboardLayout('nope')).toEqual({ cells: [], hidden: [] });
    expect(sanitizeDashboardLayout([])).toEqual({ cells: [], hidden: [] });
  });

  it('keeps cells in row-major order and dedupes by id', () => {
    const layout = sanitizeDashboardLayout({
      cells: [
        { id: 'b', x: 6, y: 0, w: 6, h: 1 },
        { id: 'a', x: 0, y: 0, w: 6, h: 1 },
        { id: 'a', x: 0, y: 1, w: 12, h: 1 },
        { id: 'ghost!', x: 0, y: 2, w: 6, h: 1 },
      ],
      hidden: [],
    });
    expect(layout.cells.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('lets cells win over hidden and sanitizes the hidden list', () => {
    const layout = sanitizeDashboardLayout({
      cells: [{ id: 'a', x: 0, y: 0, w: 12, h: 1 }],
      hidden: ['a', 'goals', 'bad id!', 42],
    });
    expect(layout.hidden).toEqual(['goals']);
  });

  it('caps the cell count', () => {
    const cells = Array.from({ length: 40 }, (_, i) => ({
      id: `w${i}`, x: 0, y: i, w: 12, h: 1,
    }));
    expect(sanitizeDashboardLayout({ cells, hidden: [] }).cells).toHaveLength(24);
  });
});

describe('sanitizeDashboardName / isEmptyDashboardLayout', () => {
  it('defaults junk names to default', () => {
    expect(sanitizeDashboardName('morning-review')).toBe('morning-review');
    expect(sanitizeDashboardName('')).toBe('default');
    expect(sanitizeDashboardName('../etc')).toBe('default');
    expect(sanitizeDashboardName(null)).toBe('default');
  });

  it('detects empty layouts', () => {
    expect(isEmptyDashboardLayout({ cells: [], hidden: [] })).toBe(true);
    expect(isEmptyDashboardLayout(null)).toBe(true);
    expect(
      isEmptyDashboardLayout({ cells: [{ id: 'a', x: 0, y: 0, w: 6, h: 1 }], hidden: [] }),
    ).toBe(false);
  });
});

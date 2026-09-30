import { describe, it, expect } from 'vitest';
import type { CustomDashboardWidgetSpan } from '../config/statCardRegistry';
import {
  cellsToOrder,
  defaultDbLayout,
  hideWidgetInLayout,
  isLayoutCustomized,
  normalizeDbLayout,
  packOrderToCells,
  reorderVisibleInLayout,
  showWidgetInLayout,
} from './dashboardLayoutMatrix';

const KNOWN = ['channel-kpis', 'audience', 'insights', 'goals', 'anomalies'];
const spanOf = (id: string): CustomDashboardWidgetSpan =>
  id === 'channel-kpis' || id === 'goals' ? 'full' : 'half';

describe('packOrderToCells', () => {
  it('packs full-width then pairs halves row-major', () => {
    expect(packOrderToCells(KNOWN, spanOf)).toEqual([
      { id: 'channel-kpis', x: 0, y: 0, w: 12, h: 1 },
      { id: 'audience', x: 0, y: 1, w: 6, h: 1 },
      { id: 'insights', x: 6, y: 1, w: 6, h: 1 },
      { id: 'goals', x: 0, y: 2, w: 12, h: 1 },
      { id: 'anomalies', x: 0, y: 3, w: 6, h: 1 },
    ]);
  });

  it('wraps a half that does not fit the current row', () => {
    const cells = packOrderToCells(['audience', 'channel-kpis'], spanOf);
    expect(cells[1]).toMatchObject({ x: 0, y: 1, w: 12 });
  });

  it('dedupes and skips malformed ids', () => {
    expect(packOrderToCells(['audience', 'audience', 'bad id!', 42 as never], spanOf)).toEqual([
      { id: 'audience', x: 0, y: 0, w: 6, h: 1 },
    ]);
  });
});

describe('cellsToOrder', () => {
  it('sorts row-major regardless of array order', () => {
    const cells = packOrderToCells(KNOWN, spanOf);
    expect(cellsToOrder([...cells].reverse())).toEqual(KNOWN);
  });
});

describe('normalizeDbLayout', () => {
  it('returns packed defaults for junk input', () => {
    expect(normalizeDbLayout(null, KNOWN, spanOf)).toEqual(defaultDbLayout(KNOWN, spanOf));
    expect(normalizeDbLayout('nope', KNOWN, spanOf).hidden).toEqual([]);
  });

  it('restores saved geometry, drops unknown ids, appends new catalogue ids', () => {
    const normalized = normalizeDbLayout(
      {
        cells: [
          { id: 'goals', x: 0, y: 0, w: 12, h: 1 },
          { id: 'removed', x: 0, y: 1, w: 6, h: 1 },
        ],
        hidden: ['channel-kpis'],
      },
      KNOWN,
      spanOf,
    );
    expect(cellsToOrder(normalized.cells)[0]).toBe('goals');
    expect(cellsToOrder(normalized.cells)).not.toContain('removed');
    expect(cellsToOrder(normalized.cells)).toHaveLength(KNOWN.length - 1);
    expect(normalized.hidden).toEqual(['channel-kpis']);
  });

  it('never blanks the dashboard on hide-everything payloads', () => {
    const emptied = normalizeDbLayout({ cells: [], hidden: [...KNOWN] }, KNOWN, spanOf);
    expect(emptied.cells).toHaveLength(1);
    expect(emptied.hidden).toEqual([]);
    // Contradictory payloads resolve cells-win (mirrors the backend).
    const conflicted = normalizeDbLayout(
      { cells: KNOWN.map((id, y) => ({ id, x: 0, y, w: 12, h: 1 })), hidden: [...KNOWN] },
      KNOWN,
      spanOf,
    );
    expect(conflicted.cells).toHaveLength(KNOWN.length);
    expect(conflicted.hidden).toEqual([]);
  });
});

describe('hide/show/reorder', () => {
  it('hides into hidden and refuses to hide the last widget', () => {
    const base = defaultDbLayout(KNOWN, spanOf);
    const hidden = hideWidgetInLayout(base, 'goals');
    expect(cellsToOrder(hidden.cells)).not.toContain('goals');
    expect(hidden.hidden).toEqual(['goals']);
    const single = normalizeDbLayout({ cells: [{ id: 'a', x: 0, y: 0, w: 12, h: 1 }], hidden: [] }, ['a']);
    expect(hideWidgetInLayout(single, 'a')).toBe(single);
  });

  it('shows a widget appended at the end', () => {
    const base = hideWidgetInLayout(defaultDbLayout(KNOWN, spanOf), 'goals');
    const shown = showWidgetInLayout(base, 'goals');
    expect(shown.hidden).toEqual([]);
    expect(cellsToOrder(shown.cells).at(-1)).toBe('goals');
  });

  it('repacks after drag-reorder and keeps hidden', () => {
    const base = hideWidgetInLayout(defaultDbLayout(KNOWN, spanOf), 'anomalies');
    const reordered = reorderVisibleInLayout(base, ['goals', 'channel-kpis', 'audience', 'insights']);
    expect(cellsToOrder(reordered.cells)[0]).toBe('goals');
    expect(reordered.hidden).toEqual(['anomalies']);
  });
});

describe('isLayoutCustomized', () => {
  it('is false for defaults, true after reorder or hide', () => {
    expect(isLayoutCustomized(defaultDbLayout(KNOWN, spanOf), KNOWN)).toBe(false);
    expect(
      isLayoutCustomized(hideWidgetInLayout(defaultDbLayout(KNOWN, spanOf), 'goals'), KNOWN),
    ).toBe(true);
  });
});

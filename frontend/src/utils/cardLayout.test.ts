import { describe, it, expect } from 'vitest';
import { getStatCardDefinitions } from '../config/statCardRegistry';
import {
  hasDetails,
  isSurfaceCustomized,
  moveCard,
  normalizeLayout,
  orderedCardIds,
  resetSurfaceLayout,
  sanitizeLayouts,
  setCardCompact,
  setCardHidden,
  setSurfaceOrder,
} from './cardLayout';

const SURFACE = 'dashboard:channelAnalytics' as const;
const DEFAULTS = getStatCardDefinitions(SURFACE).map((d) => d.id);

describe('normalizeLayout', () => {
  it('returns the registry order when there is no saved layout', () => {
    expect(normalizeLayout(SURFACE, null).order).toEqual(DEFAULTS);
    expect(normalizeLayout(SURFACE, undefined)).toEqual({ order: DEFAULTS, hidden: [], compact: [] });
  });

  it('applies a saved order, drops unknown ids and appends new cards', () => {
    const layout = normalizeLayout(SURFACE, {
      order: ['watchTime', 'views', 'removedCard'],
      hidden: ['views', 'ghost'],
      compact: ['likes', 'ghost'],
    });
    expect(layout.order.slice(0, 2)).toEqual(['watchTime', 'views']);
    expect(layout.order).toHaveLength(DEFAULTS.length);
    expect(layout.order).not.toContain('removedCard');
    expect(layout.hidden).toEqual(['views']);
    expect(layout.compact).toEqual(['likes']);
  });

  it('dedupes repeated ids', () => {
    const layout = normalizeLayout(SURFACE, { order: ['likes', 'likes', 'likes'] });
    expect(layout.order.filter((id) => id === 'likes')).toHaveLength(1);
  });
});

describe('orderedCardIds', () => {
  it('follows the saved order and skips hidden cards', () => {
    const ids = orderedCardIds(SURFACE, { order: ['watchTime', 'views'], hidden: ['views'] });
    expect(ids[0]).toBe('watchTime');
    expect(ids).not.toContain('views');
    expect(ids).toHaveLength(DEFAULTS.length - 1);
  });

  it('never blanks the surface when every card is hidden', () => {
    expect(orderedCardIds(SURFACE, { order: DEFAULTS, hidden: DEFAULTS })).toEqual([DEFAULTS[0]]);
  });

  it('always drops cards the data layer reports as empty', () => {
    const ids = orderedCardIds(SURFACE, null, [DEFAULTS[0]]);
    expect(ids).not.toContain(DEFAULTS[0]);
    expect(ids).toHaveLength(DEFAULTS.length - 1);
  });

  it('lets data-hiding empty a fully-data-hidden surface (caller shows its empty state)', () => {
    expect(orderedCardIds(SURFACE, null, DEFAULTS)).toEqual([]);
  });
});

describe('moveCard', () => {
  it('swaps a card with its neighbour', () => {
    const moved = moveCard(SURFACE, null, DEFAULTS[1], -1);
    expect(moved.order[0]).toBe(DEFAULTS[1]);
    expect(moved.order[1]).toBe(DEFAULTS[0]);
  });

  it('ignores out-of-range moves and unknown ids', () => {
    expect(moveCard(SURFACE, null, DEFAULTS[0], -1).order).toEqual(DEFAULTS);
    expect(moveCard(SURFACE, null, DEFAULTS[DEFAULTS.length - 1], 1).order).toEqual(DEFAULTS);
    expect(moveCard(SURFACE, null, 'ghost', 1).order).toEqual(DEFAULTS);
    expect(moveCard(SURFACE, null, DEFAULTS[0], 0).order).toEqual(DEFAULTS);
  });

  it('keeps hidden/compact state while reordering', () => {
    const withPrefs = setCardCompact(SURFACE, setCardHidden(SURFACE, null, 'views', true), 'likes', true);
    const after = moveCard(SURFACE, withPrefs, 'likes', -1);
    expect(after.hidden).toEqual(['views']);
    expect(after.compact).toEqual(['likes']);
  });
});

describe('setCardHidden', () => {
  it('hides and restores a card', () => {
    const hidden = setCardHidden(SURFACE, null, 'views', true);
    expect(hidden.hidden).toEqual(['views']);
    expect(setCardHidden(SURFACE, hidden, 'views', false).hidden).toEqual([]);
  });

  it('refuses to hide the last visible card', () => {
    const allButOne = { order: DEFAULTS, hidden: DEFAULTS.slice(1), compact: [] };
    expect(setCardHidden(SURFACE, allButOne, DEFAULTS[0], true).hidden).toEqual(DEFAULTS.slice(1));
  });

  it('ignores ids that are not in the registry', () => {
    expect(setCardHidden(SURFACE, null, 'ghost', true).hidden).toEqual([]);
  });
});

describe('setCardCompact / hasDetails', () => {
  it('toggles detail rows per card', () => {
    const compact = setCardCompact(SURFACE, null, 'likes', true);
    expect(hasDetails(SURFACE, compact, 'likes')).toBe(false);
    expect(hasDetails(SURFACE, compact, 'views')).toBe(true);
    expect(hasDetails(SURFACE, null, 'views')).toBe(true);
  });

  it('ignores unknown ids', () => {
    expect(setCardCompact(SURFACE, null, 'ghost', true).compact).toEqual([]);
  });
});

describe('sanitizeLayouts', () => {
  it('keeps well-formed surfaces and drops junk', () => {
    const out = sanitizeLayouts({
      'dashboard:audience': { order: ['countries'], hidden: [], compact: [] },
      'bad surface': { order: ['countries'] },
      'dashboard:empty': { order: [], hidden: [], compact: [] },
      'dashboard:notobject': 'nope',
    });
    expect(Object.keys(out)).toEqual(['dashboard:audience']);
    expect(out['dashboard:audience']?.order).toEqual(['countries']);
  });

  it('returns {} for non-object payloads', () => {
    expect(sanitizeLayouts(null)).toEqual({});
    expect(sanitizeLayouts('x')).toEqual({});
    expect(sanitizeLayouts([1, 2])).toEqual({});
  });
});

describe('resetSurfaceLayout / isSurfaceCustomized', () => {
  it('drops only the target surface', () => {
    const layouts = sanitizeLayouts({
      'dashboard:audience': { order: ['countries'], hidden: [], compact: [] },
      'dashboard:channelAnalytics': { order: ['views'], hidden: [], compact: [] },
    });
    const after = resetSurfaceLayout(layouts, 'dashboard:audience');
    expect(after['dashboard:audience']).toBeUndefined();
    expect(after['dashboard:channelAnalytics']).toBeDefined();
  });

  it('detects customization', () => {
    expect(isSurfaceCustomized(SURFACE, null)).toBe(false);
    expect(isSurfaceCustomized(SURFACE, { order: DEFAULTS, hidden: [], compact: [] })).toBe(false);
    expect(isSurfaceCustomized(SURFACE, { order: [], hidden: ['views'], compact: [] })).toBe(true);
    expect(isSurfaceCustomized(SURFACE, { order: [], hidden: [], compact: ['likes'] })).toBe(true);
    expect(isSurfaceCustomized(SURFACE, { order: ['watchTime'], hidden: [], compact: [] })).toBe(true);
  });
});

describe('setSurfaceOrder', () => {
  it('replaces the order wholesale (drag-and-drop result)', () => {
    const layout = setSurfaceOrder(SURFACE, null, ['likes', 'views']);
    expect(layout.order.slice(0, 2)).toEqual(['likes', 'views']);
    expect(layout.order).toHaveLength(DEFAULTS.length);
  });

  it('drops unknown ids and keeps unmentioned cards at the end', () => {
    const layout = setSurfaceOrder(
      SURFACE,
      { order: DEFAULTS, hidden: ['views'], compact: [] },
      ['likes', 'ghost'],
    );
    expect(layout.order[0]).toBe('likes');
    expect(layout.order).not.toContain('ghost');
    expect(layout.order).toContain('views');
    expect(layout.hidden).toEqual(['views']);
  });
});

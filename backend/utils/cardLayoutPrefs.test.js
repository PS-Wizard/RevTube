import { describe, it, expect } from 'vitest';
const {
  sanitizeCardLayoutPrefs,
  isEmptyCardLayoutPrefs,
  MAX_IDS_PER_LIST,
} = require('./cardLayoutPrefs');

describe('sanitizeCardLayoutPrefs', () => {
  it('keeps a valid layout round-trip intact', () => {
    const input = {
      'dashboard:channelAnalytics': {
        order: ['views', 'watchTime'],
        hidden: ['cardClicks'],
        compact: ['likes'],
      },
    };
    expect(sanitizeCardLayoutPrefs(input)).toEqual(input);
  });

  it('returns {} for junk input', () => {
    expect(sanitizeCardLayoutPrefs(null)).toEqual({});
    expect(sanitizeCardLayoutPrefs(undefined)).toEqual({});
    expect(sanitizeCardLayoutPrefs('order')).toEqual({});
    expect(sanitizeCardLayoutPrefs([1, 2, 3])).toEqual({});
    expect(sanitizeCardLayoutPrefs(42)).toEqual({});
  });

  it('drops surfaces with malformed keys or non-object values', () => {
    const out = sanitizeCardLayoutPrefs({
      'dashboard channel': { order: ['views'] },
      'Dashboard:Channel': { order: ['views'] },
      'dashboard::channel': { order: ['views'] },
      'dashboard:audience': 'nope',
      'dashboard:insights': ['views'],
    });
    expect(out).toEqual({});
  });

  it('drops surfaces whose lists all end up empty', () => {
    const out = sanitizeCardLayoutPrefs({
      'dashboard:audience': { order: [], hidden: [], compact: [] },
      'dashboard:channelAnalytics': { order: null, hidden: 'x', compact: [3, {}] },
    });
    expect(out).toEqual({});
    expect(isEmptyCardLayoutPrefs(out)).toBe(true);
  });

  it('validates, trims and dedupes ids while preserving order', () => {
    const out = sanitizeCardLayoutPrefs({
      'dashboard:channelAnalytics': {
        order: [' views', 'views', 'hero:topCountry', 'bad id', '', 'x'.repeat(65), 12, null],
      },
    });
    expect(out['dashboard:channelAnalytics'].order).toEqual(['views', 'hero:topCountry']);
  });

  it('ignores non-array list values and unknown list keys', () => {
    const out = sanitizeCardLayoutPrefs({
      'dashboard:channelAnalytics': { order: ['views'], mystery: ['x'], hidden: {} },
    });
    expect(out).toEqual({ 'dashboard:channelAnalytics': { order: ['views'], hidden: [], compact: [] } });
  });

  it('caps each id list at MAX_IDS_PER_LIST', () => {
    const ids = Array.from({ length: MAX_IDS_PER_LIST + 25 }, (_, i) => `card${i}`);
    const out = sanitizeCardLayoutPrefs({ 'dashboard:audience': { order: ids } });
    expect(out['dashboard:audience'].order).toHaveLength(MAX_IDS_PER_LIST);
    expect(out['dashboard:audience'].order[MAX_IDS_PER_LIST - 1]).toBe(`card${MAX_IDS_PER_LIST - 1}`);
  });

  it('ignores inherited/prototype keys in the input map', () => {
    const proto = { 'dashboard:audience': { order: ['hero:topCountry'] } };
    const input = Object.create(proto);
    input['dashboard:channelAnalytics'] = { order: ['views'] };
    const out = sanitizeCardLayoutPrefs(input);
    expect(Object.keys(out)).toEqual(['dashboard:channelAnalytics']);
  });

  it('never mutates the input payload', () => {
    const input = {
      'dashboard:channelAnalytics': { order: ['views', ' views', 'cardClicks'], hidden: [], compact: [] },
    };
    const snapshot = JSON.stringify(input);
    sanitizeCardLayoutPrefs(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('isEmptyCardLayoutPrefs', () => {
  it('detects empty maps', () => {
    expect(isEmptyCardLayoutPrefs({})).toBe(true);
    expect(isEmptyCardLayoutPrefs(null)).toBe(true);
    expect(isEmptyCardLayoutPrefs(undefined)).toBe(true);
    expect(isEmptyCardLayoutPrefs({ 'dashboard:audience': { order: ['x'], hidden: [], compact: [] } })).toBe(false);
  });
});

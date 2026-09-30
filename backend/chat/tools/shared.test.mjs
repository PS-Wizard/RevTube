import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { applySort, safeErrorMessage, toCsv, truncateCsv } = require('./shared');

describe('applySort', () => {
  const rows = [
    { title: 'Banana', itemCount: 5 },
    { title: 'apple', itemCount: 20 },
    { title: 'Cherry', itemCount: null },
  ];

  it('sorts numbers numerically', () => {
    const sorted = applySort(rows, 'itemCount', 'desc', ['title', 'itemCount']);
    expect(sorted.map((r) => r.title)).toEqual(['apple', 'Banana', 'Cherry']);
  });

  it('sorts strings case-insensitively in ascending order', () => {
    const sorted = applySort(rows, 'title', 'asc', ['title', 'itemCount']);
    expect(sorted.map((r) => r.title)).toEqual(['apple', 'Banana', 'Cherry']);
  });

  it('puts missing values last in both directions', () => {
    const asc = applySort(rows, 'itemCount', 'asc', ['itemCount']);
    const desc = applySort(rows, 'itemCount', 'desc', ['itemCount']);
    expect(asc[asc.length - 1].title).toBe('Cherry');
    expect(desc[desc.length - 1].title).toBe('Cherry');
  });

  it('preserves input order for non-whitelisted fields and does not mutate', () => {
    const sorted = applySort(rows, 'description; DROP TABLE x', 'desc', ['title']);
    expect(sorted.map((r) => r.title)).toEqual(['Banana', 'apple', 'Cherry']);
    expect(rows[0].title).toBe('Banana');
  });
});

describe('safeErrorMessage', () => {
  it('redacts query-string secrets', () => {
    const msg = safeErrorMessage(new Error('GET /playlists?key=AIzaSECRET&part=snippet failed'));
    expect(msg).toContain('key=[redacted]');
    expect(msg).not.toContain('AIzaSECRET');
  });

  it('caps very long messages', () => {
    const msg = safeErrorMessage(new Error('x'.repeat(1000)));
    expect(msg.length).toBeLessThan(400);
  });

  it('handles missing errors', () => {
    expect(safeErrorMessage(null)).toBe('Unknown error');
  });
});

describe('toCsv', () => {
  it('renders header plus one line per row', () => {
    expect(toCsv(['a', 'b'], [[1, 2], [3, 4]])).toBe('a,b\n1,2\n3,4');
  });

  it('quotes cells with commas, quotes, or newlines', () => {
    expect(toCsv(['t'], [['a,b'], ['c"d'], ['e\nf']])).toBe('t\n"a,b"\n"c""d"\n"e\nf"');
  });

  it('renders null/undefined as empty cells', () => {
    expect(toCsv(['a', 'b'], [[null, undefined]])).toBe('a,b\n,');
  });
});

describe('truncateCsv', () => {
  it('passes short payloads through untouched', () => {
    expect(truncateCsv('a,b\n1,2', 12000)).toEqual({ csv: 'a,b\n1,2', truncated: false });
  });

  it('cuts on a row boundary with an omission marker', () => {
    const csv = ['h', ...Array.from({ length: 40 }, () => 'xxxxxxxxxx')].join('\n');
    const { csv: out, truncated } = truncateCsv(csv, 300);
    expect(truncated).toBe(true);
    const lines = out.split('\n');
    expect(lines[0]).toBe('h');
    // 'h\n' (2) + 27 rows x 11 chars = 299 <= 300; row 28 would exceed.
    expect(lines).toHaveLength(1 + 27 + 1);
    expect(lines[lines.length - 1]).toBe('... (truncated, 13 more rows omitted)');
  });
});

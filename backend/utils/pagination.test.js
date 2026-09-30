import { describe, it, expect } from 'vitest';
const { paginateCatalog } = require('./pagination');

const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: `ID${i}` }));

describe('paginateCatalog', () => {
  it('slices the requested window with a full-page hasMore', () => {
    const { sliced, pagination } = paginateCatalog(rows(76), { offset: 0, limit: 20, total: 76 });
    expect(sliced).toHaveLength(20);
    expect(sliced[0].id).toBe('ID0');
    expect(pagination).toMatchObject({
      totaldata: 76, currentpage: 1, perpageitem: 20, totalpages: 4, hasMore: true,
    });
  });

  it('reports hasMore=false on the final partial page', () => {
    const { sliced, pagination } = paginateCatalog(rows(34), { offset: 20, limit: 20, total: 34 });
    expect(sliced).toHaveLength(14);
    expect(pagination.hasMore).toBe(false);
    expect(pagination.currentpage).toBe(2);
  });

  it('never reports hasMore past the rows in hand (stale-high total)', () => {
    // Backend total claims 76 but only 34 rows exist (deleted/privatized
    // playlists still counted upstream). The phantom zone must not read
    // hasMore=true, or clients loop empty pages forever.
    const empty = paginateCatalog(rows(34), { offset: 34, limit: 20, total: 76 });
    expect(empty.sliced).toHaveLength(0);
    expect(empty.pagination.hasMore).toBe(false);

    const short = paginateCatalog(rows(34), { offset: 20, limit: 20, total: 76 });
    expect(short.sliced).toHaveLength(14);
    expect(short.pagination.hasMore).toBe(false);
  });

  it('defaults sensibly for missing/invalid inputs', () => {
    expect(paginateCatalog(null, {}).sliced).toEqual([]);
    expect(paginateCatalog(rows(5), {}).pagination).toMatchObject({ totaldata: 5, hasMore: false });
    expect(paginateCatalog(rows(60), { offset: -3, limit: 0 }).pagination.perpageitem).toBe(50);
  });
});

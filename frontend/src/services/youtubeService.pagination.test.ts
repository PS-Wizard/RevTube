/**
 * resolveNextOffsetParam: infinite-query termination for video/playlist catalogs.
 */
import { describe, expect, it } from 'vitest';
import { resolveNextOffsetParam } from './youtubeService';

describe('resolveNextOffsetParam', () => {
  it('advances by the loaded page size while more remains', () => {
    expect(resolveNextOffsetParam({ offset: 0, items: [1, 2], hasMore: true })).toBe(2);
    expect(resolveNextOffsetParam({ offset: 20, items: new Array(20).fill(0), hasMore: true })).toBe(40);
  });

  it('stops when the backend reports no more pages', () => {
    expect(resolveNextOffsetParam({ offset: 0, items: [1], hasMore: false })).toBeUndefined();
  });

  it('stops on an empty page even when hasMore is (stale-)true', () => {
    // Stale-high backend total outruns the rows that exist: the slice is
    // empty but hasMore claims otherwise. Returning the same offset would
    // refetch the phantom page forever -- terminate instead.
    expect(resolveNextOffsetParam({ offset: 34, items: [], hasMore: true })).toBeUndefined();
  });
});

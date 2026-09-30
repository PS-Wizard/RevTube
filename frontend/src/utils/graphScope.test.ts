/**
 * Scope resolution driving the dashboard charts (must follow the tables).
 */
import { describe, expect, it } from 'vitest';
import { resolveGraphPlaylistIds, resolveGraphVideoIds } from './graphScope';
import type { FilterableVideo } from './dashboardUtils';

function video(
  videoId: string,
  overrides: Partial<FilterableVideo> = {},
): FilterableVideo {
  return {
    videoId,
    title: `Video ${videoId}`,
    privacyStatus: 'public',
    ...overrides,
  } as FilterableVideo;
}

describe('resolveGraphPlaylistIds', () => {
  it('intersects checked rows with visible rows, sorted', () => {
    expect(
      resolveGraphPlaylistIds(new Set(['PL2', 'PL1', 'PL9']), ['PL1', 'PL2', 'PL3']),
    ).toEqual(['PL1', 'PL2']);
  });

  it('returns [] when nothing checked is visible (empty graph scope)', () => {
    expect(resolveGraphPlaylistIds(new Set(['PL9']), ['PL1'])).toEqual([]);
    expect(resolveGraphPlaylistIds(new Set<string>(), ['PL1'])).toEqual([]);
  });

  it('accepts arrays as well as sets', () => {
    expect(resolveGraphPlaylistIds(['PL1'], ['PL1', 'PL2'])).toEqual(['PL1']);
  });
});

describe('resolveGraphVideoIds', () => {
  const base = {
    checkedVideoIds: [] as string[],
    visibilityFilter: 'all' as const,
    videoTypeFilter: 'all' as const,
    videoSearchQuery: '',
    filterByPlaylists: false,
    selectedPlaylists: new Set<string>(),
    filterByVideos: false,
    selectedVideos: new Set<string>(),
    videos: [video('V1'), video('V2')],
  };

  it('prefers the opened video over everything', () => {
    expect(
      resolveGraphVideoIds({ ...base, selectedVideoId: 'V9', checkedVideoIds: ['V1'] }),
    ).toEqual(['V9']);
  });

  it('uses explicit row checks verbatim (deduped, sorted)', () => {
    expect(
      resolveGraphVideoIds({ ...base, selectedVideoId: null, checkedVideoIds: ['V2', 'V1', 'V2'] }),
    ).toEqual(['V1', 'V2']);
  });

  it('returns null (channel-wide) with no checks and no narrowing filters', () => {
    expect(resolveGraphVideoIds({ ...base, selectedVideoId: null })).toBeNull();
  });

  it('expands narrowing toolbar filters to matching video IDs', () => {
    const videos = [
      video('V1', { privacyStatus: 'public' }),
      video('V2', { privacyStatus: 'private' }),
    ];
    expect(
      resolveGraphVideoIds({
        ...base,
        selectedVideoId: null,
        videos,
        visibilityFilter: 'private',
      }),
    ).toEqual(['V2']);
  });

  it('falls back to channel-wide when the expansion matches nothing', () => {
    expect(
      resolveGraphVideoIds({
        ...base,
        selectedVideoId: null,
        videos: [video('V1')],
        videoSearchQuery: 'zzz-no-match',
      }),
    ).toBeNull();
  });

  it('applies the playlist/video selection filters when enabled', () => {
    const videos = [
      video('V1', { sourcePlaylistIds: ['PL1'] }),
      video('V2', { sourcePlaylistIds: ['PL2'] }),
    ];
    expect(
      resolveGraphVideoIds({
        ...base,
        selectedVideoId: null,
        videos,
        filterByPlaylists: true,
        selectedPlaylists: new Set(['PL2']),
      }),
    ).toEqual(['V2']);
  });
});

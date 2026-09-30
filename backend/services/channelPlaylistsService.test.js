/**
 * Tests for generateChannelPlaylists (channelPlaylistsService):
 * L1 serverCache -> L2 Postgres read-model -> L3 live YouTube loop,
 * with stale-degrade and owner-only merge semantics.
 */
import { describe, it, expect, vi } from 'vitest';
const { createChannelPlaylistsService } = require('./channelPlaylistsService');

function pgRow(id, overrides = {}) {
  return {
    playlistId: id,
    channelId: 'UC123',
    title: `Playlist ${id}`,
    description: '',
    channelTitle: 'Test Channel',
    publishedAt: '2026-01-01T00:00:00.000Z',
    thumbnailUrl: 'http://img',
    itemCount: 3,
    privacyStatus: 'public',
    lastSyncedAt: '2026-01-02T00:00:00.000Z',
    itemsSyncedAt: null,
    ...overrides,
  };
}

function ytApiItem(id, overrides = {}) {
  return {
    id,
    snippet: {
      title: `Playlist ${id}`,
      description: '',
      channelId: 'UC123',
      channelTitle: 'Test Channel',
      publishedAt: '2026-01-01T00:00:00.000Z',
      thumbnails: { medium: { url: 'http://img' }, default: { url: 'http://img' } },
    },
    contentDetails: { itemCount: 3 },
    status: { privacyStatus: 'public' },
    ...overrides,
  };
}

function makeDeps(overrides = {}) {
  const serverCache = { get: vi.fn(async () => null), set: vi.fn(async () => true) };
  const axios = { get: vi.fn() };
  const markQuotaBillable = vi.fn();
  const mergeOwnedHiddenPlaylists = vi.fn(async (data) => data);
  const deps = {
    serverCache,
    shortHash: (s) => `h${String(s ?? '').length}`,
    isPostgresConfigured: () => true,
    loadPlaylistsFromPostgres: vi.fn(async () => null),
    getPlaylistsSyncedAt: vi.fn(async () => null),
    isPlaylistDataStale: (syncedAt) => !syncedAt,
    PLAYLIST_READ_MODEL_MAX_AGE_HOURS: 6,
    YT_DATA_CACHE_TTL_MS: { PLAYLISTS: 1000 },
    axios,
    ANALYTICS_SOURCE: 'postgres',
    YOUTUBE_API_BASE: 'https://yt.example',
    API_KEY: 'key',
    markQuotaBillable,
    mergeOwnedHiddenPlaylists,
    ...overrides,
  };
  return { deps, fakes: { serverCache, axios, markQuotaBillable, mergeOwnedHiddenPlaylists } };
}

describe('generateChannelPlaylists', () => {
  it('serves L1 cache hits without touching Postgres or YouTube', async () => {
    const { deps, fakes } = makeDeps();
    const cached = { items: [ytApiItem('PL1')], catalogTotal: 1 };
    fakes.serverCache.get.mockResolvedValueOnce(cached);
    const { generateChannelPlaylists } = createChannelPlaylistsService(deps);

    const result = await generateChannelPlaylists({ channelId: 'UC123', accessToken: 'Bearer t' });

    expect(result).toBe(cached);
    expect(deps.loadPlaylistsFromPostgres).not.toHaveBeenCalled();
    expect(fakes.axios.get).not.toHaveBeenCalled();
    expect(fakes.markQuotaBillable).not.toHaveBeenCalled();
  });

  it('serves fresh Postgres rows as YouTube-shaped items (L2)', async () => {
    const { deps, fakes } = makeDeps();
    deps.getPlaylistsSyncedAt.mockResolvedValueOnce('2026-09-21T00:00:00.000Z');
    deps.isPlaylistDataStale = () => false;
    deps.loadPlaylistsFromPostgres.mockResolvedValueOnce([pgRow('PL1'), pgRow('PL2')]);
    const { generateChannelPlaylists } = createChannelPlaylistsService(deps);

    const result = await generateChannelPlaylists({ channelId: 'UC123', accessToken: 'Bearer t' });

    expect(result.catalogTotal).toBe(2);
    expect(result.items.map((i) => i.id)).toEqual(['PL1', 'PL2']);
    expect(result.items[0].snippet.title).toBe('Playlist PL1');
    expect(result.items[0].contentDetails.itemCount).toBe(3);
    expect(fakes.axios.get).not.toHaveBeenCalled();
    expect(fakes.serverCache.set).toHaveBeenCalledTimes(1);
    expect(deps.loadPlaylistsFromPostgres).toHaveBeenCalledWith('UC123', { includePrivate: false });
  });

  it('scopes the cache key by privacy flag', async () => {
    const { deps, fakes } = makeDeps();
    deps.getPlaylistsSyncedAt.mockResolvedValue('2026-09-21T00:00:00.000Z');
    deps.isPlaylistDataStale = () => false;
    deps.loadPlaylistsFromPostgres.mockResolvedValue([pgRow('PL1')]);
    const { generateChannelPlaylists } = createChannelPlaylistsService(deps);

    await generateChannelPlaylists({ channelId: 'UC123', accessToken: 'Bearer t' });
    await generateChannelPlaylists({ channelId: 'UC123', accessToken: 'Bearer t', includePrivate: true });

    const keys = fakes.serverCache.get.mock.calls.map((c) => c[0]);
    expect(keys[0]).toContain(':p0');
    expect(keys[1]).toContain(':p1');
    // includePrivate=true reads through its own key and queries Postgres unfiltered
    expect(deps.loadPlaylistsFromPostgres).toHaveBeenLastCalledWith('UC123', { includePrivate: true });
  });

  it('pages the live API when Postgres is empty, then caches (L3)', async () => {
    const { deps, fakes } = makeDeps();
    fakes.axios.get
      .mockResolvedValueOnce({ data: { items: [ytApiItem('PL1')], pageInfo: { totalResults: 3 }, nextPageToken: 'T2' } })
      .mockResolvedValueOnce({ data: { items: [ytApiItem('PL2'), ytApiItem('PL3')], pageInfo: { totalResults: 3 } } });
    const { generateChannelPlaylists } = createChannelPlaylistsService(deps);

    const result = await generateChannelPlaylists({ channelId: 'UC123', accessToken: 'Bearer t', cacheScope: 'u:a@b.c', req: {} });

    expect(result.items.map((i) => i.id)).toEqual(['PL1', 'PL2', 'PL3']);
    expect(result.catalogTotal).toBe(3);
    expect(fakes.axios.get).toHaveBeenCalledTimes(2);
    expect(fakes.markQuotaBillable).toHaveBeenCalledTimes(1);
    const [cacheKey, cached] = fakes.serverCache.set.mock.calls[0];
    expect(String(cacheKey)).toContain('u:a@b.c');
    expect(cached.catalogTotal).toBe(3);
  });

  it('merges owner-only rows once and reports catalogTotal above the page total', async () => {
    const { deps, fakes } = makeDeps();
    fakes.axios.get.mockResolvedValueOnce({
      data: { items: [ytApiItem('PL1')], pageInfo: { totalResults: 1 } },
    });
    const hidden = ytApiItem('PL-H1', { status: { privacyStatus: 'private' } });
    fakes.mergeOwnedHiddenPlaylists.mockImplementationOnce(async (data) => ({
      items: [...data.items, hidden],
    }));
    const { generateChannelPlaylists } = createChannelPlaylistsService(deps);

    const result = await generateChannelPlaylists({ channelId: 'UC123', accessToken: 'Bearer t', includePrivate: true });

    expect(fakes.mergeOwnedHiddenPlaylists).toHaveBeenCalledTimes(1);
    expect(result.items.map((i) => i.id).sort()).toEqual(['PL-H1', 'PL1']);
    expect(result.catalogTotal).toBe(2);
  });

  it('degrades to stale Postgres rows when the live refresh fails', async () => {
    const { deps, fakes } = makeDeps();
    deps.getPlaylistsSyncedAt.mockResolvedValueOnce('2026-01-01T00:00:00.000Z');
    deps.isPlaylistDataStale = () => true;
    deps.loadPlaylistsFromPostgres.mockResolvedValueOnce([pgRow('PL9')]);
    fakes.axios.get.mockRejectedValueOnce(new Error('socket hang up'));
    const { generateChannelPlaylists } = createChannelPlaylistsService(deps);

    const result = await generateChannelPlaylists({ channelId: 'UC123', accessToken: 'Bearer t' });

    expect(result.items.map((i) => i.id)).toEqual(['PL9']);
    expect(result.catalogTotal).toBe(1);
  });

  it('throws when live fails with no tier to fall back to', async () => {
    const { deps, fakes } = makeDeps();
    fakes.axios.get.mockRejectedValueOnce(new Error('socket hang up'));
    const { generateChannelPlaylists } = createChannelPlaylistsService(deps);

    await expect(generateChannelPlaylists({ channelId: 'UC123', accessToken: 'Bearer t' }))
      .rejects.toThrow('socket hang up');
  });

  it('returns an empty list on a 404 without throwing', async () => {
    const { deps, fakes } = makeDeps();
    const err = new Error('not found');
    err.response = { status: 404 };
    fakes.axios.get.mockRejectedValueOnce(err);
    const { generateChannelPlaylists } = createChannelPlaylistsService(deps);

    const result = await generateChannelPlaylists({ channelId: 'UC123', accessToken: 'Bearer t' });

    expect(result).toEqual({ items: [], catalogTotal: 0 });
  });

  it('skips Postgres entirely in youtube-only mode', async () => {
    const { deps, fakes } = makeDeps({ ANALYTICS_SOURCE: 'youtube-only' });
    fakes.axios.get.mockResolvedValueOnce({
      data: { items: [ytApiItem('PL1')], pageInfo: { totalResults: 1 } },
    });
    const { generateChannelPlaylists } = createChannelPlaylistsService(deps);

    await generateChannelPlaylists({ channelId: 'UC123', accessToken: 'Bearer t' });

    expect(deps.loadPlaylistsFromPostgres).not.toHaveBeenCalled();
    expect(fakes.axios.get).toHaveBeenCalledTimes(1);
  });

  it('clamps a stale-high pageInfo total down to the enumerated rows', async () => {
    // YouTube reports totalResults: 4 (e.g. a deleted/privatized playlist is
    // still counted) but only 3 rows exist and no further pages do.
    const { deps, fakes } = makeDeps();
    fakes.axios.get.mockResolvedValueOnce({
      data: { items: [ytApiItem('PL1'), ytApiItem('PL2'), ytApiItem('PL3')], pageInfo: { totalResults: 4 } },
    });
    const { generateChannelPlaylists } = createChannelPlaylistsService(deps);

    const result = await generateChannelPlaylists({ channelId: 'UC123', accessToken: 'Bearer t' });

    expect(result.items).toHaveLength(3);
    expect(result.catalogTotal).toBe(3);
  });

  it('keeps the pageInfo estimate when the page cap truncates the catalog', async () => {
    process.env.MAX_LIVE_PLAYLIST_PAGES = '1';
    try {
      const { deps, fakes } = makeDeps();
      fakes.axios.get.mockResolvedValueOnce({
        data: { items: [ytApiItem('PL1')], pageInfo: { totalResults: 4 }, nextPageToken: 'T2' },
      });
      const { generateChannelPlaylists } = createChannelPlaylistsService(deps);

      const result = await generateChannelPlaylists({ channelId: 'UC123', accessToken: 'Bearer t' });

      expect(fakes.axios.get).toHaveBeenCalledTimes(1);
      expect(result.items).toHaveLength(1);
      expect(result.catalogTotal).toBe(4);
    } finally {
      delete process.env.MAX_LIVE_PLAYLIST_PAGES;
    }
  });
});

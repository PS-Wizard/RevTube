import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const listPlaylists = require('./listPlaylists');

const CHANNEL = { channelId: 'UC123', channelTitle: 'Test Channel' };

function makeDeps(overrides = {}) {
  const axios = { get: vi.fn(async () => ({ data: { items: [] } })) };
  const serverCache = { get: vi.fn(async () => null), set: vi.fn(async () => true) };
  return {
    deps: {
      axios,
      API_KEY: 'test-key',
      YOUTUBE_API_BASE: 'https://www.googleapis.com/youtube/v3',
      serverCache,
      YT_DATA_CACHE_TTL_MS: { PLAYLISTS: 1000 },
      ...overrides,
    },
    axios,
    serverCache,
  };
}

describe('listPlaylists tool', () => {
  it('returns playlists for an owned channel and caches the result', async () => {
    const { deps, axios, serverCache } = makeDeps();
    axios.get.mockResolvedValueOnce({
      data: {
        items: [
          {
            id: 'PL1',
            snippet: { title: 'Series A', description: 'Desc', channelTitle: 'Test Channel' },
            contentDetails: { itemCount: 12 },
          },
        ],
      },
    });

    const result = await listPlaylists.execute(
      { channelId: 'UC123' },
      { deps, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );

    expect(result.error).toBeUndefined();
    expect(result.playlists).toHaveLength(1);
    expect(result.playlists[0].playlistId).toBe('PL1');
    expect(result.playlists[0].itemCount).toBe(12);
    expect(serverCache.set).toHaveBeenCalledOnce();
  });

  it('returns the cached result without calling the API', async () => {
    const cached = [{ playlistId: 'PL9', title: 'Cached' }];
    const { deps, axios } = makeDeps({ serverCache: { get: vi.fn(async () => cached), set: vi.fn() } });

    const result = await listPlaylists.execute(
      { channelId: 'UC123' },
      { deps, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );

    expect(result.playlists).toEqual(cached);
    expect(result.total).toBe(1);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('serves a legacy cached payload (pre-refactor object shape)', async () => {
    // Before the sort refactor the whole response object was cached under this
    // key -- { channelId, total, playlists, note }. Reading it as the new
    // array-only shape produced an empty list, so chat answered
    // "no playlists for this channel" until the TTL expired.
    const legacy = {
      channelId: 'UC123',
      total: 1,
      playlists: [{ playlistId: 'PL-legacy', title: 'Legacy' }],
      note: 'Only public playlists are visible.',
    };
    const { deps, axios } = makeDeps({ serverCache: { get: vi.fn(async () => legacy), set: vi.fn() } });

    const result = await listPlaylists.execute(
      { channelId: 'UC123' },
      { deps, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );

    expect(result.playlists).toEqual(legacy.playlists);
    expect(result.total).toBe(1);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('refetches when the cached payload is unusable', async () => {
    const { deps, axios } = makeDeps({ serverCache: { get: vi.fn(async () => ({})), set: vi.fn() } });
    axios.get.mockResolvedValueOnce({
      data: { items: [{ id: 'PL-fresh', snippet: { title: 'Fresh' } }] },
    });

    const result = await listPlaylists.execute(
      { channelId: 'UC123' },
      { deps, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );

    expect(axios.get).toHaveBeenCalledOnce();
    expect(result.playlists.map((p) => p.playlistId)).toEqual(['PL-fresh']);
  });

  it('denies access for a channel the user does not own', async () => {
    const { deps, axios } = makeDeps();

    const result = await listPlaylists.execute(
      { channelId: 'UC999' },
      { deps, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );

    expect(result.error).toMatch(/not one of your connected channels/);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('allows admins to list any channel', async () => {
    const { deps, axios } = makeDeps();
    axios.get.mockResolvedValueOnce({ data: { items: [] } });

    const result = await listPlaylists.execute(
      { channelId: 'UC999' },
      { deps, userChannels: [], userContext: { uid: 'a1', isAdmin: true } },
    );

    expect(result.error).toBeUndefined();
    expect(axios.get).toHaveBeenCalledOnce();
  });

  it('errors when playlist lookup is not configured', async () => {
    const result = await listPlaylists.execute(
      { channelId: 'UC123' },
      { deps: {}, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );

    expect(result.error).toMatch(/not configured/);
  });

  it('sorts by any whitelisted field', async () => {
    const { deps } = makeDeps();
    deps.axios.get.mockResolvedValueOnce({
      data: {
        items: [
          { id: 'PL-small', snippet: { title: 'Small' }, contentDetails: { itemCount: 2 } },
          { id: 'PL-big', snippet: { title: 'Big' }, contentDetails: { itemCount: 40 } },
        ],
      },
    });

    const result = await listPlaylists.execute(
      { channelId: 'UC123', sortBy: 'itemCount', sortOrder: 'desc' },
      { deps, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );

    expect(result.playlists.map((p) => p.playlistId)).toEqual(['PL-big', 'PL-small']);
  });

  it('preserves API order for an unknown sort field', async () => {
    const { deps } = makeDeps();
    deps.axios.get.mockResolvedValueOnce({
      data: {
        items: [
          { id: 'PL-first', snippet: { title: 'First' }, contentDetails: { itemCount: 2 } },
          { id: 'PL-second', snippet: { title: 'Second' }, contentDetails: { itemCount: 40 } },
        ],
      },
    });

    const result = await listPlaylists.execute(
      { channelId: 'UC123', sortBy: 'DROP TABLE playlists', sortOrder: 'desc' },
      { deps, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );

    expect(result.playlists.map((p) => p.playlistId)).toEqual(['PL-first', 'PL-second']);
  });

  it('redacts query-string secrets from upstream errors', async () => {
    const { deps } = makeDeps();
    deps.axios.get.mockRejectedValueOnce(
      new Error('Request failed: https://www.googleapis.com/youtube/v3/playlists?key=AIzaSECRET123&part=snippet'),
    );

    const result = await listPlaylists.execute(
      { channelId: 'UC123' },
      { deps, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );

    expect(result.error).toMatch(/key=\[redacted\]/);
    expect(result.error).not.toContain('AIzaSECRET123');
  });

  // ── Postgres read-model tier ────────────────────────────────────────────────

  function makePgDeps({ syncedAt, rows, stale, upsert } = {}) {
    return makeDeps({
      isPostgresConfigured: () => true,
      getPlaylistsSyncedAt: vi.fn(async () => syncedAt),
      loadPlaylistsFromPostgres: vi.fn(async () => rows),
      isPlaylistDataStale: vi.fn(() => stale),
      PLAYLIST_READ_MODEL_MAX_AGE_HOURS: 6,
      ...(upsert ? { upsertPlaylists: upsert } : {}),
    });
  }

  const PG_ROWS = [
    {
      playlistId: 'PL-pg',
      channelId: 'UC123',
      title: 'From Postgres',
      description: 'Desc',
      channelTitle: 'Test Channel',
      publishedAt: '2026-01-01T00:00:00.000Z',
      thumbnailUrl: null,
      itemCount: 7,
      lastSyncedAt: '2026-01-01T00:00:00.000Z',
      itemsSyncedAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  it('serves the ingested catalog from Postgres while it is fresh', async () => {
    const { deps, axios, serverCache } = makePgDeps({
      syncedAt: new Date().toISOString(),
      rows: PG_ROWS,
      stale: false,
    });

    const result = await listPlaylists.execute(
      { channelId: 'UC123' },
      { deps, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );

    expect(result.error).toBeUndefined();
    expect(result.playlists).toHaveLength(1);
    expect(result.playlists[0].playlistId).toBe('PL-pg');
    expect(result.playlists[0].itemCount).toBe(7);
    // Read-model bookkeeping fields must not leak into the tool output.
    expect(result.playlists[0].lastSyncedAt).toBeUndefined();
    expect(axios.get).not.toHaveBeenCalled();
    expect(serverCache.set).not.toHaveBeenCalled();
  });

  it('refreshes from YouTube and writes through when the read-model is stale', async () => {
    const upsertPlaylists = vi.fn(async () => 1);
    const { deps, axios } = makePgDeps({
      syncedAt: '2020-01-01T00:00:00.000Z',
      rows: PG_ROWS,
      stale: true,
      upsert: upsertPlaylists,
    });
    axios.get.mockResolvedValueOnce({
      data: { items: [{ id: 'PL-live', snippet: { title: 'Live' }, contentDetails: { itemCount: 3 } }] },
    });

    const result = await listPlaylists.execute(
      { channelId: 'UC123' },
      { deps, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );

    expect(axios.get).toHaveBeenCalledOnce();
    expect(result.playlists.map((p) => p.playlistId)).toEqual(['PL-live']);
    expect(upsertPlaylists).toHaveBeenCalledOnce();
    expect(upsertPlaylists.mock.calls[0][0]).toBe('UC123');
  });

  it('degrades to stale Postgres rows when the live refresh fails', async () => {
    const { deps, axios } = makePgDeps({
      syncedAt: '2020-01-01T00:00:00.000Z',
      rows: PG_ROWS,
      stale: true,
    });
    axios.get.mockRejectedValueOnce(new Error('quotaExceeded'));

    const result = await listPlaylists.execute(
      { channelId: 'UC123' },
      { deps, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );

    // A slightly old catalog beats reporting an empty channel.
    expect(result.error).toBeUndefined();
    expect(result.playlists.map((p) => p.playlistId)).toEqual(['PL-pg']);
  });

  it('follows catalog pages until maxResults is filled', async () => {
    const { deps, axios } = makeDeps();
    const page = (ids, nextPageToken) => ({
      data: {
        items: ids.map((id) => ({
          id,
          snippet: { title: id, channelTitle: 'Test Channel' },
          contentDetails: { itemCount: 1 },
        })),
        ...(nextPageToken ? { nextPageToken } : {}),
      },
    });
    axios.get
      .mockResolvedValueOnce(page(['PL1', 'PL2'], 'TOKEN2'))
      .mockResolvedValueOnce(page(['PL3'], undefined));

    const result = await listPlaylists.execute(
      { channelId: 'UC123', maxResults: 10 },
      { deps, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );

    expect(result.error).toBeUndefined();
    expect(result.playlists.map((p) => p.playlistId)).toEqual(['PL1', 'PL2', 'PL3']);
    expect(result.hasMore).toBe(false);
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  it('reports hasMore and skips pruning on a partial catalog fetch', async () => {
    const upsertPlaylists = vi.fn(async () => 1);
    const { deps, axios } = makeDeps();
    deps.upsertPlaylists = upsertPlaylists;
    axios.get.mockResolvedValue({
      data: {
        items: [{ id: 'PL1', snippet: { title: 'A' }, contentDetails: { itemCount: 1 } }],
        nextPageToken: 'MORE',
      },
    });

    const result = await listPlaylists.execute(
      { channelId: 'UC123', maxResults: 1 },
      { deps, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );

    expect(result.playlists).toHaveLength(1);
    expect(result.hasMore).toBe(true);
    expect(result.note).toContain('MORE playlists');
    // A partial page must never delete the channel's other catalog rows.
    expect(upsertPlaylists).toHaveBeenCalledOnce();
    expect(upsertPlaylists.mock.calls[0][2]).toEqual({ prune: false });
  });
});

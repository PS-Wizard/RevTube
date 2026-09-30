import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const getPlaylistDetails = require('./getPlaylistDetails');

const CHANNEL = { channelId: 'UC123', channelTitle: 'Test Channel' };
const META = {
  id: 'PL1',
  snippet: { title: 'Series A', description: 'Desc', channelId: 'UC123', channelTitle: 'Test Channel' },
  contentDetails: { itemCount: 2 },
};
const ITEMS = {
  items: [
    { snippet: { resourceId: { videoId: 'v1' }, title: 'Video One', position: 0 } },
    { snippet: { resourceId: { videoId: 'v2' }, title: 'Video Two', position: 1 } },
  ],
};

function makeDeps() {
  const axios = { get: vi.fn() };
  axios.get.mockImplementation(async (url) => {
    if (String(url).includes('/playlists')) return { data: { items: [META] } };
    return { data: ITEMS };
  });
  const serverCache = { get: vi.fn(async () => null), set: vi.fn(async () => true) };
  const query = vi.fn(async () => ({
    rows: [
      { video_id: 'v1', title: 'Video One', view_count: 100, like_count: 10, comment_count: 2 },
    ],
  }));
  const deps = {
    axios,
    API_KEY: 'test-key',
    YOUTUBE_API_BASE: 'https://www.googleapis.com/youtube/v3',
    serverCache,
    query,
    isPostgresConfigured: () => true,
  };
  return { deps, axios, query };
}

describe('getPlaylistDetails tool', () => {
  it('returns playlist metadata with PG-enriched video stats and totals', async () => {
    const { deps, query } = makeDeps();

    const result = await getPlaylistDetails.execute(
      { playlistId: 'PL1' },
      { deps, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );

    expect(result.error).toBeUndefined();
    expect(result.playlistId).toBe('PL1');
    expect(result.title).toBe('Series A');
    expect(result.videos).toHaveLength(2);
    expect(result.videos[0].views).toBe(100);
    expect(result.videos[1].views).toBeNull();
    expect(result.totals.totalViews).toBe(100);
    expect(result.totals.videosWithStats).toBe(1);
    expect(result.statsAvailable).toBe(true);
    expect(query).toHaveBeenCalledOnce();
  });

  it('denies access when the owning channel is not connected', async () => {
    const { deps, axios } = makeDeps();

    const result = await getPlaylistDetails.execute(
      { playlistId: 'PL1' },
      { deps, userChannels: [{ channelId: 'UC999', channelTitle: 'Other' }], userContext: { uid: 'u1' } },
    );

    expect(result.error).toMatch(/don't have access/);
    // Items endpoint must not be hit when access is denied.
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it('returns not-found for an unknown playlist', async () => {
    const { deps } = makeDeps();
    deps.axios.get.mockReset();
    deps.axios.get.mockResolvedValueOnce({ data: { items: [] } });

    const result = await getPlaylistDetails.execute(
      { playlistId: 'PL-missing' },
      { deps, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );

    expect(result.error).toMatch(/not found/);
  });

  it('works without Postgres (metadata only, views null)', async () => {
    const { deps } = makeDeps();
    delete deps.query;
    deps.isPostgresConfigured = () => false;

    const result = await getPlaylistDetails.execute(
      { playlistId: 'PL1' },
      { deps, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );

    expect(result.error).toBeUndefined();
    expect(result.statsAvailable).toBe(false);
    expect(result.videos.every((v) => v.views === null)).toBe(true);
    expect(result.note).toMatch(/unavailable/);
  });

  it('sorts videos by views desc with missing stats last', async () => {
    const { deps } = makeDeps();
    deps.axios.get.mockReset();
    deps.axios.get.mockImplementation(async (url) => {
      if (String(url).includes('/playlists')) {
        return {
          data: {
            items: [{
              id: 'PL1',
              snippet: { title: 'Series A', channelId: 'UC123', channelTitle: 'Test Channel' },
              contentDetails: { itemCount: 3 },
            }],
          },
        };
      }
      return {
        data: {
          items: [
            { snippet: { resourceId: { videoId: 'v-nostats' }, title: 'No Stats', position: 0 } },
            { snippet: { resourceId: { videoId: 'v-low' }, title: 'Low', position: 1 } },
            { snippet: { resourceId: { videoId: 'v-high' }, title: 'High', position: 2 } },
          ],
        },
      };
    });
    deps.query.mockResolvedValueOnce({
      rows: [
        { video_id: 'v-low', view_count: 10, like_count: 1, comment_count: 0 },
        { video_id: 'v-high', view_count: 500, like_count: 50, comment_count: 5 },
      ],
    });

    const result = await getPlaylistDetails.execute(
      { playlistId: 'PL1', sortBy: 'views', sortOrder: 'desc' },
      { deps, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );

    expect(result.videos.map((v) => v.videoId)).toEqual(['v-high', 'v-low', 'v-nostats']);
  });

  it('defaults to playlist (position) order', async () => {
    const { deps } = makeDeps();

    const result = await getPlaylistDetails.execute(
      { playlistId: 'PL1' },
      { deps, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );

    expect(result.videos.map((v) => v.videoId)).toEqual(['v1', 'v2']);
  });

  // ── Postgres read-model tier ────────────────────────────────────────────────

  const PG_META = {
    playlistId: 'PL1',
    channelId: 'UC123',
    title: 'From Postgres',
    description: 'Desc',
    channelTitle: 'Test Channel',
    publishedAt: '2026-01-01T00:00:00.000Z',
    thumbnailUrl: null,
    itemCount: 2,
    lastSyncedAt: new Date().toISOString(),
    itemsSyncedAt: new Date().toISOString(),
  };

  const PG_ITEMS = [
    { playlistId: 'PL1', videoId: 'v1', position: 0, title: 'Video One', publishedAt: null, thumbnailUrl: null },
    { playlistId: 'PL1', videoId: 'v2', position: 1, title: 'Video Two', publishedAt: null, thumbnailUrl: null },
  ];

  it('serves metadata and members from the read-model while fresh', async () => {
    const { deps, axios, query } = makeDeps();
    deps.loadPlaylistMetaFromPostgres = vi.fn(async () => PG_META);
    deps.loadPlaylistItemsFromPostgres = vi.fn(async () => PG_ITEMS);
    deps.isPlaylistDataStale = vi.fn(() => false);
    deps.PLAYLIST_READ_MODEL_MAX_AGE_HOURS = 6;

    const result = await getPlaylistDetails.execute(
      { playlistId: 'PL1' },
      { deps, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );

    expect(result.error).toBeUndefined();
    expect(result.title).toBe('From Postgres');
    expect(result.channelId).toBe('UC123');
    expect(result.videos.map((v) => v.videoId)).toEqual(['v1', 'v2']);
    // Stats still come from analytics_videos, joined by video_id.
    expect(result.videos[0].views).toBe(100);
    expect(axios.get).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledOnce();
  });

  it('refreshes from YouTube and writes through when the read-model is stale', async () => {
    const { deps, axios } = makeDeps();
    deps.loadPlaylistMetaFromPostgres = vi.fn(async () => ({
      ...PG_META,
      lastSyncedAt: '2020-01-01T00:00:00.000Z',
      itemsSyncedAt: '2020-01-01T00:00:00.000Z',
    }));
    deps.loadPlaylistItemsFromPostgres = vi.fn(async () => PG_ITEMS);
    deps.isPlaylistDataStale = vi.fn(() => true);
    deps.PLAYLIST_READ_MODEL_MAX_AGE_HOURS = 6;
    const upsertPlaylists = vi.fn(async () => 1);
    const upsertPlaylistItems = vi.fn(async () => 2);
    deps.upsertPlaylists = upsertPlaylists;
    deps.upsertPlaylistItems = upsertPlaylistItems;

    const result = await getPlaylistDetails.execute(
      { playlistId: 'PL1' },
      { deps, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );

    expect(result.error).toBeUndefined();
    expect(result.title).toBe('Series A');
    expect(axios.get).toHaveBeenCalledTimes(2); // metadata + members
    // A single-row metadata write-through must never prune the channel catalog.
    expect(upsertPlaylists).toHaveBeenCalledOnce();
    expect(upsertPlaylists.mock.calls[0][2]).toEqual({ prune: false });
    expect(upsertPlaylistItems).toHaveBeenCalledOnce();
  });
});

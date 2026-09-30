import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const getBulkPlaylistDetails = require('./getBulkPlaylistDetails');

const CHANNEL = { channelId: 'UC123', channelTitle: 'Test Channel' };
const NOW = new Date().toISOString();

const META_ROWS = [
  {
    playlist_id: 'PL1', channel_id: 'UC123', title: 'Series A', description: 'd',
    channel_title: 'Test Channel', published_at: '2026-01-01T00:00:00.000Z',
    thumbnail_url: null, item_count: 2, privacy_status: 'public',
    last_synced_at: NOW, items_synced_at: NOW,
  },
  {
    playlist_id: 'PL2', channel_id: 'UC123', title: 'Series B', description: '',
    channel_title: 'Test Channel', published_at: null,
    thumbnail_url: null, item_count: 1, privacy_status: 'public',
    last_synced_at: NOW, items_synced_at: NOW,
  },
];

const ITEM_ROWS = [
  { playlist_id: 'PL1', video_id: 'v1', position: 0, title: 'Video One', published_at: null, thumbnail_url: null },
  { playlist_id: 'PL1', video_id: 'v2', position: 1, title: 'Video Two', published_at: null, thumbnail_url: null },
  { playlist_id: 'PL2', video_id: 'v3', position: 0, title: 'Video Three', published_at: null, thumbnail_url: null },
];

const STATS_ROWS = [
  { video_id: 'v1', view_count: 100, like_count: 10, comment_count: 2 },
  { video_id: 'v3', view_count: 30, like_count: 3, comment_count: 0 },
];

/** Fake pg query routing on the SQL text: metas, items, stats. */
function makePgQuery() {
  return vi.fn(async (text) => {
    if (String(text).includes('analytics_playlist_items')) return { rows: ITEM_ROWS };
    if (String(text).includes('analytics_playlists')) return { rows: META_ROWS };
    if (String(text).includes('analytics_videos')) return { rows: STATS_ROWS };
    return { rows: [] };
  });
}

function makeDeps({ pg = true, liveMetas = [], liveItems = {} } = {}) {
  const query = makePgQuery();
  const axios = {
    get: vi.fn(async (url, { params } = {}) => {
      if (String(url).includes('/playlists')) {
        return {
          data: {
            items: liveMetas.map((m) => ({
              id: m.playlistId,
              snippet: {
                channelId: m.channelId, title: m.title, description: '',
                channelTitle: 'Test Channel', publishedAt: null,
              },
              contentDetails: { itemCount: 1 },
            })),
          },
        };
      }
      return {
        data: {
          items: (liveItems[params?.playlistId] || []).map((v, i) => ({
            snippet: {
              resourceId: { videoId: v }, title: `Live ${v}`, position: i,
              publishedAt: null, thumbnails: {},
            },
          })),
        },
      };
    }),
  };
  const serverCache = { get: vi.fn(async () => null), set: vi.fn(async () => true) };
  const deps = {
    axios,
    API_KEY: 'test-key',
    YOUTUBE_API_BASE: 'https://www.googleapis.com/youtube/v3',
    serverCache,
    query,
    isPostgresConfigured: () => pg,
    upsertPlaylists: vi.fn(async () => 1),
    upsertPlaylistItems: vi.fn(async () => 1),
    isPlaylistDataStale: () => false,
    PLAYLIST_READ_MODEL_MAX_AGE_HOURS: 6,
  };
  return { deps, axios, query, serverCache };
}

describe('getBulkPlaylistDetails tool', () => {
  it('serves two playlists from three batched PG queries as CSV', async () => {
    const { deps, query } = makeDeps();
    const result = await getBulkPlaylistDetails.execute(
      { playlistIds: ['PL1', 'PL2'] },
      { deps, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );

    expect(result.error).toBeUndefined();
    expect(result.format).toBe('csv');
    expect(result.requested).toBe(2);
    expect(result.found).toBe(2);
    // Metas + items + stats = exactly 3 round-trips for N playlists.
    expect(query).toHaveBeenCalledTimes(3);

    const lines = result.csv.split('\n');
    expect(lines[0]).toBe(
      'playlist_id,playlist_title,channel_id,channel_title,item_count,published_at,' +
      'video_position,video_id,video_title,views,likes,comments,data_source',
    );
    // 2 videos in PL1 + 1 in PL2.
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain('PL1,Series A');
    expect(lines[1]).toContain('100,10,2,postgres');
    // v2 has no stats row -> empty stat cells, never zero-filled.
    expect(lines[2]).toMatch(/,v2,Video Two,,,,postgres$/);
  });

  it('falls back to a single batched YouTube metas call on PG miss', async () => {
    const { deps, axios, query } = makeDeps({
      liveMetas: [{ playlistId: 'PL9', channelId: 'UC123', title: 'Live List' }],
      liveItems: { PL9: ['lv1'] },
    });
    query.mockImplementation(async (text) => {
      if (String(text).includes('analytics_videos')) {
        return { rows: [{ video_id: 'lv1', view_count: 5, like_count: 0, comment_count: 0 }] };
      }
      return { rows: [] };
    });

    const result = await getBulkPlaylistDetails.execute(
      { playlistIds: ['PL9'] },
      { deps, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );

    expect(result.error).toBeUndefined();
    expect(result.found).toBe(1);
    // One /playlists call carrying all missing IDs, not one call per playlist.
    const metaCalls = axios.get.mock.calls.filter((c) => String(c[0]).includes('/playlists'));
    expect(metaCalls).toHaveLength(1);
    expect(String(metaCalls[0][1].params.id)).toBe('PL9');
    expect(deps.upsertPlaylists).toHaveBeenCalledOnce();
    // prune:false -- a bulk lookup must never delete catalog rows.
    expect(deps.upsertPlaylists.mock.calls[0][2]).toEqual({ prune: false });
    expect(result.csv).toContain('PL9,Live List');
    expect(result.csv).toContain('youtube');
  });

  it('denies playlists from unconnected channels without failing the batch', async () => {
    const { deps } = makeDeps();
    deps.query = vi.fn(async (text) => {
      if (String(text).includes('analytics_playlists')) {
        return {
          rows: [
            ...META_ROWS,
            {
              playlist_id: 'PLX', channel_id: 'UC999', title: 'Foreign', description: '',
              channel_title: 'Other', published_at: null, thumbnail_url: null,
              item_count: 0, privacy_status: 'public',
              last_synced_at: NOW, items_synced_at: NOW,
            },
          ],
        };
      }
      if (String(text).includes('analytics_playlist_items')) return { rows: ITEM_ROWS };
      return { rows: STATS_ROWS };
    });

    const result = await getBulkPlaylistDetails.execute(
      { playlistIds: ['PL1', 'PLX'] },
      { deps, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );

    expect(result.found).toBe(1);
    expect(result.accessDenied).toEqual(['PLX']);
    expect(result.csv).not.toContain('PLX');
  });

  it('supports json format and reports unresolved IDs', async () => {
    const { deps } = makeDeps();
    const result = await getBulkPlaylistDetails.execute(
      { playlistIds: ['PL1', 'PLMISSING'], format: 'json' },
      { deps, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );

    expect(result.format).toBe('json');
    expect(result.playlists).toHaveLength(1);
    expect(result.playlists[0]).toMatchObject({
      playlistId: 'PL1',
      title: 'Series A',
      videoCount: 2,
      totalViews: 100,
      videosWithStats: 1,
    });
  });

  it('rejects empty and oversized requests', async () => {
    const { deps } = makeDeps();
    expect((await getBulkPlaylistDetails.execute(
      { playlistIds: [] }, { deps, userChannels: [CHANNEL], userContext: {} },
    )).error).toBeDefined();
    expect((await getBulkPlaylistDetails.execute(
      { playlistIds: Array.from({ length: 21 }, (_, i) => `PL${i}`) },
      { deps, userChannels: [CHANNEL], userContext: {} },
    )).error).toContain('Maximum is 20');
  });

  it('filters by total views and title, sorting by totalViews desc', async () => {
    const { deps } = makeDeps();
    const result = await getBulkPlaylistDetails.execute(
      {
        playlistIds: ['PL1', 'PL2'],
        minTotalViews: 50,
        titleContains: 'series',
        sortBy: 'totalViews',
        sortOrder: 'desc',
        format: 'json',
      },
      { deps, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );

    expect(result.error).toBeUndefined();
    // PL1 totals 100 views, PL2 totals 30 -> minTotalViews drops PL2.
    expect(result.found).toBe(2);
    expect(result.returned).toBe(1);
    expect(result.filteredOut).toBe(1);
    expect(result.playlists.map((p) => p.playlistId)).toEqual(['PL1']);
  });

  it('filters by item count and playlist publish date', async () => {
    const { deps } = makeDeps();
    const byCount = await getBulkPlaylistDetails.execute(
      { playlistIds: ['PL1', 'PL2'], minItemCount: 2, format: 'json' },
      { deps, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );
    expect(byCount.playlists.map((p) => p.playlistId)).toEqual(['PL1']);

    const byDate = await getBulkPlaylistDetails.execute(
      { playlistIds: ['PL1', 'PL2'], publishedAfter: '2026-06-01', format: 'json' },
      { deps, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );
    // PL1 published 2026-01-01 (dropped), PL2 has no date (dropped: unverifiable).
    expect(byDate.returned).toBe(0);
    expect(byDate.filteredOut).toBe(2);
  });

  it('summaryOnly returns one row per playlist with no videos or stats queries', async () => {
    const { deps, query } = makeDeps();
    const result = await getBulkPlaylistDetails.execute(
      { playlistIds: ['PL1', 'PL2'], summaryOnly: true },
      { deps, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );

    expect(result.error).toBeUndefined();
    expect(result.summaryOnly).toBe(true);
    expect(result.found).toBe(2);
    // Metas only -- no items window query, no video stats query.
    expect(query).toHaveBeenCalledTimes(1);
    expect(String(query.mock.calls[0][0])).toContain('analytics_playlists');

    const lines = result.csv.split('\n');
    expect(lines).toHaveLength(3); // header + 2 catalog rows
    expect(lines[1]).toContain('PL1,Series A');
    expect(result.maxVideosPerPlaylist).toBe(0);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const getTopPlaylistsByViews = require('./getTopPlaylistsByViews');

const CHANNEL = { channelId: 'UC123', channelTitle: 'Test Channel' };

const RANK_ROWS = [
  {
    playlist_id: 'PL1', title: 'Series A', channel_title: 'Test Channel',
    published_at: '2026-01-01T00:00:00.000Z', item_count: 5,
    video_count: 5, videos_with_stats: 4,
    total_views: 1000, total_likes: 100, total_comments: 10,
    latest_video_date: '2026-02-01T00:00:00.000Z',
  },
  {
    playlist_id: 'PL2', title: 'Series B', channel_title: 'Test Channel',
    published_at: null, item_count: 2,
    video_count: 2, videos_with_stats: 2,
    total_views: 300, total_likes: 30, total_comments: 3,
    latest_video_date: null,
  },
];

function makeDeps({ rows = RANK_ROWS, liveItems = [] } = {}) {
  const query = vi.fn(async () => ({ rows }));
  const axios = {
    get: vi.fn(async () => ({
      data: {
        items: liveItems.map((m) => ({
          id: m.playlistId,
          snippet: { title: m.title, channelTitle: 'Test Channel', publishedAt: null },
          contentDetails: { itemCount: 3 },
        })),
      },
    })),
  };
  return {
    deps: {
      query,
      axios,
      API_KEY: 'test-key',
      YOUTUBE_API_BASE: 'https://www.googleapis.com/youtube/v3',
      serverCache: { get: vi.fn(async () => null), set: vi.fn(async () => true) },
      isPostgresConfigured: () => true,
      upsertPlaylists: vi.fn(async () => 1),
    },
    query,
    axios,
  };
}

describe('getTopPlaylistsByViews tool', () => {
  it('ranks playlists with a single aggregate query as CSV', async () => {
    const { deps, query } = makeDeps();
    const result = await getTopPlaylistsByViews.execute(
      { channelId: 'UC123', limit: 7 },
      { deps, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );

    expect(result.error).toBeUndefined();
    expect(result.format).toBe('csv');
    expect(result.returned).toBe(2);
    expect(result.statsAvailable).toBe(true);
    // Exactly one round-trip for the whole ranking.
    expect(query).toHaveBeenCalledOnce();
    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toContain('GROUP BY');
    expect(String(sql)).toContain('ORDER BY total_views DESC');
    expect(params[0]).toBe('UC123');
    expect(params[params.length - 1]).toBe(7);

    const lines = result.csv.split('\n');
    expect(lines[0]).toBe(
      'rank,playlist_id,title,channel_title,item_count,videos_counted,' +
      'videos_with_stats,total_views,avg_views,total_likes,total_comments,' +
      'latest_video_date,published_at,data_source',
    );
    expect(lines).toHaveLength(3);
    expect(lines[1].startsWith('1,PL1,Series A')).toBe(true);
    expect(lines[1]).toContain('1000,250,100,10');
  });

  it('applies minTotalViews server-side via HAVING', async () => {
    const { deps, query } = makeDeps();
    const result = await getTopPlaylistsByViews.execute(
      { channelId: 'UC123', minTotalViews: 500, format: 'json' },
      { deps, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );

    expect(String(query.mock.calls[0][0])).toContain('HAVING');
    expect(result.format).toBe('json');
    expect(result.playlists).toHaveLength(2);
    expect(result.playlists[0]).toMatchObject({ rank: 1, playlistId: 'PL1', avgViews: 250 });
  });

  it('rejects invalid sort keys and denies unconnected channels', async () => {
    const { deps, query } = makeDeps();
    await getTopPlaylistsByViews.execute(
      { channelId: 'UC123', sortBy: 'DROP TABLE x' },
      { deps, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );
    // Injection attempt falls back to the whitelisted default.
    expect(String(query.mock.calls[0][0])).toContain('ORDER BY total_views DESC');

    const denied = await getTopPlaylistsByViews.execute(
      { channelId: 'UC999' },
      { deps, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );
    expect(denied.error).toBeDefined();
  });

  it('falls back to the live catalog with stats unavailable when PG is empty', async () => {
    const { deps } = makeDeps({
      rows: [],
      liveItems: [{ playlistId: 'PL9', title: 'Live List' }],
    });
    const result = await getTopPlaylistsByViews.execute(
      { channelId: 'UC123' },
      { deps, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );

    expect(result.error).toBeUndefined();
    expect(result.statsAvailable).toBe(false);
    expect(result.csv).toContain('PL9,Live List');
    expect(result.note).toContain('getBulkPlaylistDetails');
  });
});

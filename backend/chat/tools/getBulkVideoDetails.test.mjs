import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const getBulkVideoDetails = require('./getBulkVideoDetails');

const CHANNEL = { channelId: 'UC123', channelTitle: 'Test Channel' };

const VIDEO_ROWS = [
  {
    video_id: 'v1', channel_id: 'UC123', title: 'Video, One', published_at: '2026-01-01T00:00:00.000Z',
    duration: 'PT5M', view_count: 100, like_count: 10, comment_count: 2,
    privacy_status: 'public', channel_title: 'Test Channel',
  },
  {
    video_id: 'v2', channel_id: 'UC123', title: 'Video Two', published_at: null,
    duration: null, view_count: 50, like_count: 5, comment_count: 1,
    privacy_status: 'unlisted', channel_title: 'Test Channel',
  },
  {
    video_id: 'v9', channel_id: 'UC999', title: 'Other Channel Video', published_at: null,
    duration: null, view_count: 7, like_count: 0, comment_count: 0,
    privacy_status: 'public', channel_title: 'Other',
  },
];

function makeDeps() {
  const query = vi.fn(async () => ({ rows: VIDEO_ROWS }));
  return {
    deps: {
      query,
      isPostgresConfigured: () => true,
    },
    query,
  };
}

describe('getBulkVideoDetails tool', () => {
  it('returns one CSV row per video with a single batched query', async () => {
    const { deps, query } = makeDeps();
    const result = await getBulkVideoDetails.execute(
      { videoIds: ['v1', 'v2'] },
      { deps, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );

    expect(result.error).toBeUndefined();
    expect(result.format).toBe('csv');
    expect(result.requested).toBe(2);
    expect(result.found).toBe(2);
    expect(query).toHaveBeenCalledOnce();
    expect(String(query.mock.calls[0][0])).toContain('ANY');

    const lines = result.csv.split('\n');
    expect(lines[0]).toBe(
      'video_id,title,channel_id,channel_title,published_at,duration,views,likes,comments,privacy_status',
    );
    expect(lines).toHaveLength(3);
    // Comma in title is quoted.
    expect(lines[1]).toContain('"Video, One"');
    expect(lines[1]).toContain('100,10,2,public');
  });

  it('denies videos from unconnected channels and reports missing IDs', async () => {
    const { deps } = makeDeps();
    const result = await getBulkVideoDetails.execute(
      { videoIds: ['v1', 'v9', 'nope'] },
      { deps, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );

    expect(result.found).toBe(1);
    expect(result.accessDenied).toEqual(['v9']);
    expect(result.missing).toEqual(['nope']);
    expect(result.csv).not.toContain('v9');
  });

  it('supports json format', async () => {
    const { deps } = makeDeps();
    const result = await getBulkVideoDetails.execute(
      { videoIds: ['v1'], format: 'json' },
      { deps, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );

    expect(result.format).toBe('json');
    expect(result.videos).toHaveLength(1);
    expect(result.videos[0]).toMatchObject({ videoId: 'v1', views: 100, privacyStatus: 'public' });
  });

  it('rejects empty and oversized requests', async () => {
    const { deps } = makeDeps();
    expect((await getBulkVideoDetails.execute(
      { videoIds: [] }, { deps, userChannels: [CHANNEL], userContext: {} },
    )).error).toBeDefined();
    expect((await getBulkVideoDetails.execute(
      { videoIds: Array.from({ length: 51 }, (_, i) => `v${i}`) },
      { deps, userChannels: [CHANNEL], userContext: {} },
    )).error).toContain('Maximum is 50');
  });

  it('errors when the database is not configured', async () => {
    const result = await getBulkVideoDetails.execute(
      { videoIds: ['v1'] },
      { deps: { isPostgresConfigured: () => false }, userChannels: [CHANNEL], userContext: {} },
    );
    expect(result.error).toBeDefined();
  });

  it('filters by views/title/status and sorts by views desc', async () => {
    const { deps } = makeDeps();
    const result = await getBulkVideoDetails.execute(
      {
        videoIds: ['v1', 'v2'],
        minViews: 60,
        titleContains: 'video',
        privacyStatus: 'public',
        sortBy: 'views',
        sortOrder: 'desc',
        format: 'json',
      },
      { deps, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );

    expect(result.error).toBeUndefined();
    // v1 (100 views, public) kept; v2 (50 views, unlisted) dropped twice over.
    expect(result.found).toBe(2);
    expect(result.returned).toBe(1);
    expect(result.filteredOut).toBe(1);
    expect(result.videos.map((v) => v.videoId)).toEqual(['v1']);
  });

  it('filters by publish date, dropping undated videos', async () => {
    const { deps } = makeDeps();
    const result = await getBulkVideoDetails.execute(
      { videoIds: ['v1', 'v2'], publishedAfter: '2026-06-01', format: 'json' },
      { deps, userChannels: [CHANNEL], userContext: { uid: 'u1' } },
    );
    // v1 published 2026-01-01 (dropped), v2 undated (dropped: unverifiable).
    expect(result.returned).toBe(0);
    expect(result.filteredOut).toBe(2);
  });
});

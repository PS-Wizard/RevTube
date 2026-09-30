import { describe, it, expect, vi } from 'vitest';
const { createAuditInputService, mapPool } = require('./auditInputService');

const CHANNEL_ITEM = {
  snippet: { title: 'Chan', customUrl: '@chan', description: 'd', categoryId: '27', thumbnails: { default: { url: 'a' } } },
  brandingSettings: { channel: { keywords: 'a,b' }, image: {} },
  status: {},
};

function makeAxios(routes = {}) {
  return {
    get: vi.fn(async (url, config) => {
      const params = config?.params || {};
      if (url.endsWith('/channels')) return { data: { items: [CHANNEL_ITEM] } };
      if (url.endsWith('/channelSections')) {
        return { data: { items: [{ snippet: { title: 'S', type: 'singlePlaylist' } }] } };
      }
      if (url.endsWith('/playlists')) return { data: { items: routes.playlists || [] } };
      if (url.endsWith('/playlistItems')) {
        const handler = routes.playlistItems;
        if (typeof handler === 'function') return handler(params.playlistId, params.pageToken);
        return { data: { items: [] } };
      }
      throw new Error(`unexpected url ${url}`);
    }),
  };
}

function makeService(overrides = {}) {
  const axios = makeAxios(overrides.routes);
  const generateChannelVideos = vi.fn(async () => overrides.videos || []);
  const service = createAuditInputService({
    axios,
    generateChannelVideos,
    API_KEY: 'key',
    YOUTUBE_API_BASE: 'https://yt.test',
    ...overrides.deps,
  });
  return { service, axios, generateChannelVideos };
}

const VID = (videoId) => ({ videoId, title: 't', description: 'd', tags: [], publishedAt: '2026-01-01' });

describe('mapPool', () => {
  it('runs with bounded concurrency and returns per-index results', async () => {
    let live = 0;
    let peak = 0;
    const out = await mapPool([1, 2, 3, 4, 5], 2, async (n) => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      live -= 1;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe('gatherAuditInput', () => {
  it('fetches channel, videos and playlists with mapped shapes', async () => {
    const { service } = makeService({
      videos: [VID('v1')],
      routes: { playlists: [{ id: 'pl1', snippet: { title: 'P' }, contentDetails: { itemCount: 1 } }] },
    });
    const input = await service.gatherAuditInput({ channelId: 'UC1', authHeader: 'Bearer x' });
    expect(input.channel.name).toBe('Chan');
    expect(input.channel.branding.sections).toEqual([{ title: 'S', type: 'singlePlaylist' }]);
    expect(input.videos[0]).toMatchObject({ videoId: 'v1', originalPlaylistId: '', customMetadata: {} });
    expect(input.playlists).toEqual([{ playlistId: 'pl1', title: 'P', description: undefined, size: 1 }]);
  });

  it('passes maxVideos through to the catalog read', async () => {
    const { service, generateChannelVideos } = makeService({ videos: [] });
    await service.gatherAuditInput({ channelId: 'UC1', maxVideos: 25 });
    expect(generateChannelVideos).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'UC1', maxVideos: 25 }),
    );
  });

  it('scope=channel skips playlists and membership', async () => {
    const { service, axios } = makeService({ videos: [VID('v1')] });
    const input = await service.gatherAuditInput({ channelId: 'UC1', scope: 'channel' });
    expect(input.playlists).toEqual([]);
    const urls = axios.get.mock.calls.map((c) => c[0]);
    expect(urls.some((u) => u.endsWith('/playlists'))).toBe(false);
    expect(urls.some((u) => u.endsWith('/playlistItems'))).toBe(false);
    expect(input.videos).toHaveLength(1);
  });

  it('merges membership deterministically (first playlist wins) across pooled fetches', async () => {
    const { service } = makeService({
      videos: [VID('v1'), VID('v2')],
      routes: {
        playlists: [
          { id: 'plA', snippet: { title: 'A' }, contentDetails: {} },
          { id: 'plB', snippet: { title: 'B' }, contentDetails: {} },
        ],
        playlistItems: (playlistId) => ({
          data: {
            items: playlistId === 'plA'
              ? [{ snippet: { resourceId: { videoId: 'v1' } } }]
              : [{ snippet: { resourceId: { videoId: 'v1' } } }, { snippet: { resourceId: { videoId: 'v2' } } }],
          },
        }),
      },
    });
    const input = await service.gatherAuditInput({ channelId: 'UC1' });
    const byId = new Map(input.videos.map((v) => [v.videoId, v]));
    expect(byId.get('v1').originalPlaylistId).toBe('plA');
    expect(byId.get('v1').customMetadata.originalPlaylistTitle).toBe('A');
    expect(byId.get('v2').originalPlaylistId).toBe('plB');
  });

  it('emits progress per stage and degrades failed stages to empty', async () => {
    const axios = makeAxios({ playlists: [] });
    axios.get.mockRejectedValueOnce(new Error('channels down'));
    const generateChannelVideos = vi.fn(async () => { throw new Error('videos down'); });
    const service = createAuditInputService({
      axios, generateChannelVideos, API_KEY: 'k', YOUTUBE_API_BASE: 'https://yt.test',
    });
    const stages = [];
    const input = await service.gatherAuditInput({
      channelId: 'UC1',
      onProgress: (stage, fraction) => stages.push([stage, fraction]),
    });
    expect(input).toEqual({ channel: {}, videos: [], playlists: [] });
    expect(stages).toContainEqual(['videos', 1]);
    expect(stages).toContainEqual(['playlists', 1]);
    expect(stages.at(-1)).toEqual(['done', 1]);
  });
});

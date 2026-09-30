/**
 * Contract tests for the paged playlist catalog (mirrors the dashboard video
 * catalog): one server-paginated page per call, true total up front.
 *
 * POST /dashboard/playlists answers { playlists/items, pagination:
 * { totaldata, currentpage, perpageitem, totalpages, hasMore }, catalogTotal }.
 * Pre-paged backends still get the YouTube-shaped { items, pageInfo,
 * nextPageToken, catalogTotal } fallback. GET /playlists/:channelId serves
 * the same envelope for the Playlist explorer.
 */
// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { YouTubeService } from './youtubeService';
import { clearAnalyticsCache } from './analyticsCache';

vi.mock('./authHeaders', () => ({
  getFirebaseAuthHeader: async () => ({}),
}));

beforeEach(() => {
  clearAnalyticsCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function ytItem(id: string, title: string, privacyStatus = 'public') {
  return {
    id,
    snippet: {
      title,
      description: '',
      channelId: 'UC123',
      channelTitle: 'Test Channel',
      publishedAt: '2026-01-01T00:00:00.000Z',
      thumbnails: { medium: { url: 'http://img' }, default: { url: 'http://img' } },
    },
    contentDetails: { itemCount: 3 },
    status: { privacyStatus },
  };
}

function pagedEnvelope(items: unknown[], opts: { totaldata: number; currentpage: number; perpageitem: number; hasMore: boolean }) {
  return {
    ok: true,
    json: async () => ({
      status: 200,
      message: 'Playlists fetched successfully',
      playlists: items,
      items,
      catalogTotal: opts.totaldata,
      pagination: {
        totaldata: opts.totaldata,
        currentpage: opts.currentpage,
        perpageitem: opts.perpageitem,
        totalpages: Math.max(1, Math.ceil(opts.totaldata / opts.perpageitem)),
        hasMore: opts.hasMore,
      },
    }),
  };
}

describe('fetchDashboardChannelPlaylists paged contract', () => {
  it('sends page/perPage and parses the pagination envelope', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      pagedEnvelope([ytItem('PL1', 'One'), ytItem('PL2', 'Two')], {
        totaldata: 76, currentpage: 1, perpageitem: 20, hasMore: true,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const svc = new YouTubeService('a@b.c', 'token', null);
    const page = await svc.fetchDashboardChannelPlaylists('UC123', 20, false, 0);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.page).toBe(1);
    expect(body.perPage).toBe(20);

    expect(page.items.map((p) => p.id)).toEqual(['PL1', 'PL2']);
    expect(page.total).toBe(76);
    expect(page.hasMore).toBe(true);
    expect(page.offset).toBe(0);
    expect(page.limit).toBe(20);
    expect(page.currentPage).toBe(1);
  });

  it('advances the offset on later pages', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      pagedEnvelope([ytItem('PL21', 'Twenty-One')], {
        totaldata: 76, currentpage: 2, perpageitem: 20, hasMore: true,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const svc = new YouTubeService('a@b.c', 'token', null);
    const page = await svc.fetchDashboardChannelPlaylists('UC123', 20, false, 20);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).page).toBe(2);
    expect(page.offset).toBe(20);
    expect(page.items.map((p) => p.id)).toEqual(['PL21']);
  });

  it('serves repeat pages from the client cache without refetching', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      pagedEnvelope([ytItem('PL1', 'One')], {
        totaldata: 1, currentpage: 1, perpageitem: 20, hasMore: false,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const svc = new YouTubeService('a@b.c', 'token', null);
    await svc.fetchDashboardChannelPlaylists('UC123', 20, false, 0);
    const cached = await svc.fetchDashboardChannelPlaylists('UC123', 20, false, 0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cached.items.map((p) => p.id)).toEqual(['PL1']);
  });

  it('falls back to the legacy YouTube-shaped single-page response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [ytItem('PL1', 'One')],
        pageInfo: { totalResults: 67, resultsPerPage: 50 },
      }),
    }));
    const svc = new YouTubeService('a@b.c', 'token', null);
    const page = await svc.fetchDashboardChannelPlaylists('UC123');

    expect(page.items.map((p) => p.id)).toEqual(['PL1']);
    expect(page.total).toBe(67);
    expect(page.hasMore).toBe(false);
  });

  it('prefers catalogTotal on legacy responses, then the row count', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [ytItem('PL1', 'One'), ytItem('PL-H1', 'Hidden', 'private')],
        catalogTotal: 69,
      }),
    }));
    const svc = new YouTubeService('a@b.c', 'token', null);
    const page = await svc.fetchDashboardChannelPlaylists('UC123', 50, true, 0);

    expect(page.items.map((p) => p.id).sort()).toEqual(['PL-H1', 'PL1']);
    expect(page.total).toBe(69);
  });

  it('surfaces quota exhaustion instead of wrapping it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: { code: 'LIMIT_EXCEEDED', message: 'Monthly limit hit', limit: 5, used: 5 } }),
    }));
    const svc = new YouTubeService('a@b.c', 'token', null);
    await expect(svc.fetchDashboardChannelPlaylists('UC123')).rejects.toMatchObject({ name: 'UsageLimitError' });
  });
});

describe('fetchChannelPlaylistPage (explorer)', () => {
  it('GETs page/perPage and parses the shared envelope', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      pagedEnvelope([ytItem('PL1', 'One')], {
        totaldata: 76, currentpage: 1, perpageitem: 20, hasMore: true,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const svc = new YouTubeService('a@b.c', 'token', null);
    const page = await svc.fetchChannelPlaylistPage('UC123', 1, 20);

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('/playlists/UC123');
    expect(url).toContain('page=1');
    expect(url).toContain('perPage=20');
    expect(page.total).toBe(76);
    expect(page.hasMore).toBe(true);
    expect(page.offset).toBe(0);
  });
});

describe('fetchDashboardChannelPlaylists private-inclusive fallback', () => {
  const fail = (message = 'boom') => ({
    ok: false,
    status: 500,
    json: async () => ({ error: { message } }),
  });

  const bodies = (fetchMock: ReturnType<typeof vi.fn>) =>
    fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));

  it('serves the public page as partial when the inclusive leg fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(fail('youtube blew up'))
      .mockResolvedValueOnce(
        pagedEnvelope([ytItem('PL1', 'One'), ytItem('PL2', 'Two')], {
          totaldata: 2, currentpage: 1, perpageitem: 20, hasMore: false,
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const svc = new YouTubeService('a@b.c', 'token', null);
    const page = await svc.fetchDashboardChannelPlaylists('UC123', 20, true, 0);

    const [first, second] = bodies(fetchMock);
    expect(first.includePrivate).toBe(true);
    expect(second.includePrivate).toBeUndefined();
    expect(page.items.map((p) => p.id)).toEqual(['PL1', 'PL2']);
    expect(page.partial).toBe(true);
    expect(page.partialError).toContain('youtube blew up');
  });

  it('falls back when the inclusive first page is empty but public has rows', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(pagedEnvelope([], {
        totaldata: 0, currentpage: 1, perpageitem: 20, hasMore: false,
      }))
      .mockResolvedValueOnce(
        pagedEnvelope([ytItem('PL1', 'One')], {
          totaldata: 1, currentpage: 1, perpageitem: 20, hasMore: false,
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const svc = new YouTubeService('a@b.c', 'token', null);
    const page = await svc.fetchDashboardChannelPlaylists('UC123', 20, true, 0);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(page.items.map((p) => p.id)).toEqual(['PL1']);
    expect(page.partial).toBe(true);
    // Empty-answer substitution stays badge-free (no failure reason surfaced).
    expect(page.partialError).toBeUndefined();
  });

  it('returns empty (not partial) when both legs are empty', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(pagedEnvelope([], {
        totaldata: 0, currentpage: 1, perpageitem: 20, hasMore: false,
      }))
      .mockResolvedValueOnce(pagedEnvelope([], {
        totaldata: 0, currentpage: 1, perpageitem: 20, hasMore: false,
      }));
    vi.stubGlobal('fetch', fetchMock);

    const svc = new YouTubeService('a@b.c', 'token', null);
    const page = await svc.fetchDashboardChannelPlaylists('UC123', 20, true, 0);

    expect(page.items).toEqual([]);
    expect(page.partial).toBeFalsy();
  });

  it('throws the original error when both legs fail', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(fail('inclusive dead'))
      .mockResolvedValueOnce(fail('public dead'));
    vi.stubGlobal('fetch', fetchMock);

    const svc = new YouTubeService('a@b.c', 'token', null);
    await expect(svc.fetchDashboardChannelPlaylists('UC123', 20, true, 0))
      .rejects.toThrow('inclusive dead');
  });

  it('does not retry the public leg on quota exhaustion', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: { code: 'LIMIT_EXCEEDED', message: 'Monthly limit hit', limit: 5, used: 5 } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const svc = new YouTubeService('a@b.c', 'token', null);
    await expect(svc.fetchDashboardChannelPlaylists('UC123', 20, true, 0))
      .rejects.toMatchObject({ name: 'UsageLimitError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

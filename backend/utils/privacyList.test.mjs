import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { mergeOwnedHiddenPlaylists } = require('./privacyList');

const pub = (id) => ({ id, snippet: { channelId: 'UC123' }, status: { privacyStatus: 'public' } });
const hidden = (id) => ({ id, snippet: { channelId: 'UC123' }, status: { privacyStatus: 'private' } });

function makeAxios(hiddenItems) {
  return {
    get: vi.fn(async () => ({ data: { items: hiddenItems } })),
  };
}

const ctx = (axios, extra = {}) => ({
  channelId: 'UC123',
  accessToken: 'token',
  axios,
  YOUTUBE_API_BASE: 'https://www.googleapis.com/youtube/v3',
  ...extra,
});

describe('mergeOwnedHiddenPlaylists', () => {
  it('merges hidden rows into the first page and dedupes by id', async () => {
    const axios = makeAxios([hidden('H1'), pub('P1')]);
    const data = { items: [pub('P1'), pub('P2')], pageInfo: { totalResults: 2 } };
    const out = await mergeOwnedHiddenPlaylists(data, ctx(axios));
    expect(out.items.map((i) => i.id)).toEqual(['P1', 'P2', 'H1']);
    expect(axios.get).toHaveBeenCalledOnce();
  });

  it('skips the merge (and its quota cost) on follow-up pages', async () => {
    const axios = makeAxios([hidden('H1')]);
    const data = { items: [pub('P3')], pageInfo: { totalResults: 3 } };
    const out = await mergeOwnedHiddenPlaylists(data, ctx(axios, { isFirstPage: false }));
    expect(out.items.map((i) => i.id)).toEqual(['P3']);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('returns the response untouched when enrichment fails', async () => {
    const axios = { get: vi.fn(async () => { throw new Error('quotaExceeded'); }) };
    const data = { items: [pub('P1')] };
    const out = await mergeOwnedHiddenPlaylists(data, ctx(axios));
    expect(out.items.map((i) => i.id)).toEqual(['P1']);
  });
});

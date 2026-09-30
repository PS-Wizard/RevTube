import { describe, it, expect } from 'vitest';
import { normalizeStoredAudits } from './playlistOptimizer.js';

describe('normalizeStoredAudits', () => {
  it('returns safe defaults for null/undefined/non-object payloads', () => {
    for (const input of [null, undefined, 'x', 42]) {
      const out = normalizeStoredAudits(input);
      expect(out.playlists).toEqual([]);
      expect(out.unassignedVideos).toEqual([]);
      expect(out.audit).toEqual({});
    }
  });

  it('fills missing videos arrays on playlists (legacy rows)', () => {
    const out = normalizeStoredAudits({
      playlists: [{ id: 'p1', title: 'A' }, { id: 'p2', title: 'B', videos: [{ id: 'v1' }] }],
    });
    expect(out.playlists[0].videos).toEqual([]);
    expect(out.playlists[1].videos).toEqual([{ id: 'v1' }]);
  });

  it('converts an object-map playlists field into an array', () => {
    const out = normalizeStoredAudits({ playlists: { p1: { id: 'p1' } } });
    expect(Array.isArray(out.playlists)).toBe(true);
    expect(out.playlists).toHaveLength(1);
    expect(out.playlists[0].videos).toEqual([]);
  });

  it('drops non-object playlist entries and preserves unrelated fields', () => {
    const out = normalizeStoredAudits({
      strategy: 'topic',
      playlists: ['oops', { id: 'p1', videos: [] }],
      unassignedVideos: [{ id: 'v9', reason: 'low views' }],
      audit: { metadataAnalysis: 'ok' },
    });
    expect(out.strategy).toBe('topic');
    expect(out.playlists).toHaveLength(1);
    expect(out.playlists[0].id).toBe('p1');
    expect(out.unassignedVideos).toEqual([{ id: 'v9', reason: 'low views' }]);
    expect(out.strategy).toBe('topic');
    expect(out.playlists).toHaveLength(1);
    expect(out.playlists[0].id).toBe('p1');
    expect(out.unassignedVideos).toEqual([{ id: 'v9', reason: 'low views' }]);
    expect(out.audit.metadataAnalysis).toBe('ok');
  });

  it('unwraps legacy {results:{playlists}} shape so old rows render real membership', () => {
    const out = normalizeStoredAudits({
      results: {
        channelName: 'Chan',
        playlists: [
          { id: 'p1', title: 'A', videos: [{ id: 'v1' }, { id: 'v2' }] },
          { id: 'p2', title: 'B' },
        ],
        unassignedVideos: [{ id: 'v9' }],
      },
    });
    expect(out.playlists).toHaveLength(2);
    expect(out.playlists[0].videos).toHaveLength(2);
    expect(out.playlists[1].videos).toEqual([]);
    expect(out.channelName).toBe('Chan');
    expect(out.unassignedVideos).toEqual([{ id: 'v9' }]);
  });
});

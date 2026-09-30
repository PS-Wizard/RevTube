import { describe, it, expect } from 'vitest';
import { buildFixDetails, recommendationForElement, recommendationForPlaylistDimension, sortPlaylists } from './publicAuditUtils';

describe('buildFixDetails', () => {
  it('tells a zero-tag video to add 5-10 keywords', () => {
    const lines = buildFixDetails('keywords', { videoTitle: 'Rust Programming Tutorial', tags: [] });
    expect(lines[0]).toMatch(/No tags set — add 5–10/);
    expect(lines.join(' ')).toMatch(/rust/);
  });

  it('counts existing tags and names title words missing from them', () => {
    const lines = buildFixDetails('tags', { videoTitle: 'Rust Programming Tutorial for Beginners', tags: ['rust', 'code'] });
    expect(lines.join(' ')).toMatch(/Only 2 tags — add 3–8 more/);
    expect(lines.join(' ')).toMatch(/2 of 2 tags are single words/);
    expect(lines.join(' ')).toMatch(/Not covered by tags:.*programming/);
  });

  it('audits short descriptions for words, links, hashtags, chapters, keywords', () => {
    const lines = buildFixDetails('description', {
      videoTitle: 'Rust Programming Tutorial',
      description: 'Learn rust fast.',
    });
    expect(lines.join('\n')).toMatch(/only 3 words — expand to 150–250/);
    expect(lines.join('\n')).toMatch(/No links/);
    expect(lines.join('\n')).toMatch(/No hashtags/);
    expect(lines.join('\n')).toMatch(/No chapters/);
    expect(lines.join('\n')).toMatch(/never mentions:.*programming/);
  });

  it('stays quiet on healthy metadata', () => {
    const tags = ['rust programming', 'rust tutorial', 'learn rust', 'programming basics', 'coding guide', 'software development'];
    const description = [
      'Learn rust programming basics step by step with links https://x.io/y and #rust #tutorial chapters below.',
      '0:00 Intro 5:00 Setup 10:00 Build. '.repeat(20),
    ].join(' ');
    expect(buildFixDetails('keywords', { videoTitle: 'Rust Programming Basics', tags })).toEqual([]);
    expect(buildFixDetails('description', { videoTitle: 'Rust Programming Basics', description, tags })).toEqual([]);
  });

  it('flags overlong titles', () => {
    expect(buildFixDetails('title', { videoTitle: 'x'.repeat(80) })[0]).toMatch(/80 characters — front-load/);
    expect(buildFixDetails('title', { videoTitle: 'A decent length title here' })).toEqual([]);
  });

  it('never throws on missing fields and stays silent on unknown (old reports)', () => {
    expect(buildFixDetails('keywords', {})).toEqual([]);
    expect(buildFixDetails('description', {})).toEqual([]);
    expect(buildFixDetails('keywords', { videoTitle: 'T', tags: [] })[0]).toMatch(/No tags set/);
    expect(buildFixDetails('description', { videoTitle: 'T', description: '' })[0]).toMatch(/only 0 words/);
    expect(buildFixDetails('thumbnail', { videoTitle: 'T' })).toEqual([]);
    expect(buildFixDetails('nope', {})).toEqual([]);
  });
});

describe('recommendationForElement', () => {
  it('returns concise 1-2 sentence guidance mentioning the primary keyword', () => {
    for (const el of ['title', 'description', 'tags', 'keywords', 'thumbnail', 'captions']) {
      const line = recommendationForElement(el);
      expect(line.length).toBeGreaterThan(20);
      expect(line.length).toBeLessThan(400);
    }
    expect(recommendationForElement('keywords')).toMatch(/primary keyword/);
    expect(recommendationForElement('description')).toMatch(/first 2–3 sentences/);
    expect(recommendationForElement('title')).toMatch(/first 60 characters/);
  });

  it('falls back gracefully on unknown elements', () => {
    expect(recommendationForElement('nope')).toMatch(/nope|Improve/i);
  });
});

describe('recommendationForPlaylistDimension', () => {
  it('returns a concise line per playlist dimension', () => {
    expect(recommendationForPlaylistDimension('title')).toMatch(/20–70/);
    expect(recommendationForPlaylistDimension('description')).toMatch(/200\+/);
    expect(recommendationForPlaylistDimension('size')).toMatch(/10–100/);
    for (const line of ['title', 'description', 'size'].map(recommendationForPlaylistDimension)) {
      expect(line.length).toBeLessThan(400);
    }
  });

  it('falls back gracefully on unknown dimensions', () => {
    expect(recommendationForPlaylistDimension('nope')).toMatch(/playlist/i);
  });
});

describe('sortPlaylists', () => {
  const rows = [
    { playlistId: 'PL1', title: 'Zebra Series', publishedAt: '2025-01-01T00:00:00.000Z', itemCount: 5 },
    { playlistId: 'PL2', title: 'Alpha Basics', publishedAt: '2026-06-01T00:00:00.000Z', itemCount: 423 },
    { playlistId: 'PL3', title: 'Mid Course', publishedAt: null, itemCount: null },
  ];
  const health = new Map([
    ['PL1', { health: 40 }],
    ['PL2', { health: 95 }],
  ]);

  it('keeps catalog order on default and never mutates the input', () => {
    const copy = [...rows];
    expect(sortPlaylists(rows, 'default', health).map((r) => r.playlistId)).toEqual(['PL1', 'PL2', 'PL3']);
    expect(rows).toEqual(copy);
  });

  it('sorts by audit score with unscored rows last in both directions', () => {
    expect(sortPlaylists(rows, 'score-desc', health).map((r) => r.playlistId)).toEqual(['PL2', 'PL1', 'PL3']);
    expect(sortPlaylists(rows, 'score-asc', health).map((r) => r.playlistId)).toEqual(['PL1', 'PL2', 'PL3']);
  });

  it('sorts by size and published date with missing values last', () => {
    expect(sortPlaylists(rows, 'size-desc', health).map((r) => r.playlistId)).toEqual(['PL2', 'PL1', 'PL3']);
    expect(sortPlaylists(rows, 'published-desc', health).map((r) => r.playlistId)).toEqual(['PL2', 'PL1', 'PL3']);
    expect(sortPlaylists(rows, 'published-asc', health).map((r) => r.playlistId)).toEqual(['PL1', 'PL2', 'PL3']);
  });

  it('sorts by title A-Z and Z-A', () => {
    expect(sortPlaylists(rows, 'title-asc', health).map((r) => r.playlistId)).toEqual(['PL2', 'PL3', 'PL1']);
    expect(sortPlaylists(rows, 'title-desc', health).map((r) => r.playlistId)).toEqual(['PL1', 'PL3', 'PL2']);
  });
});

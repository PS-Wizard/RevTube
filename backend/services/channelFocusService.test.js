import { describe, it, expect, vi } from 'vitest';
const {
  createChannelFocusService,
  normalizeOrgId,
  focusCacheKey,
  sanitizeFocusInput,
  buildHeuristicFocus,
  summarizeAuditInput,
  buildFocusContextBlock,
} = require('./channelFocusService');

// Minimal drizzle-chain fake: 1st select() resolves channel rows, 2nd video rows.
function makeDbFake(channelRows, videoRows) {
  let calls = 0;
  const mkChain = (rows) => {
    const c = {};
    c.from = () => c;
    c.where = () => c;
    c.orderBy = () => c;
    c.limit = async () => rows;
    return c;
  };
  return { select: () => { calls += 1; return mkChain(calls === 1 ? channelRows : videoRows); } };
}

const DB_VIDEOS = [
  { title: 'Sourdough for beginners', description: '', tags: ['baking', 'sourdough'], viewCount: 5000, likeCount: 400, publishedAt: '2026-01-01' },
  { title: 'Vegan weeknight dinners', description: '', tags: ['vegan', 'dinner'], viewCount: 9000, likeCount: 800, publishedAt: '2026-02-01' },
];

function makeService(overrides = {}) {
  const getCachedOrgMembership = vi.fn(async () => null);
  const getCachedUser = vi.fn(async () => null);
  const service = createChannelFocusService({
    getDb: () => null,
    getCachedOrgMembership,
    getCachedUser,
    ...overrides,
  });
  return { service, getCachedOrgMembership, getCachedUser };
}

describe('channelFocusService helpers', () => {
  it('normalizeOrgId maps empty/whitespace to null', () => {
    expect(normalizeOrgId(null)).toBe(null);
    expect(normalizeOrgId(undefined)).toBe(null);
    expect(normalizeOrgId('')).toBe(null);
    expect(normalizeOrgId('   ')).toBe(null);
    expect(normalizeOrgId('org1')).toBe('org1');
  });

  it('focusCacheKey isolates personal vs org scopes', () => {
    const personal = focusCacheKey('ch1', null);
    const orgA = focusCacheKey('ch1', 'orgA');
    const orgB = focusCacheKey('ch1', 'orgB');
    expect(personal).toContain('personal');
    expect(orgA).toContain('orgA');
    expect(new Set([personal, orgA, orgB]).size).toBe(3);
  });

  it('sanitizeFocusInput caps pillars and trims strings', () => {
    const out = sanitizeFocusInput({
      niche: '  tech reviews  ',
      contentPillars: ['a', ' ', 'b', 'c', 'd', 'e', 'f', 'g'],
      goalsNotes: '',
    });
    expect(out.niche).toBe('tech reviews');
    expect(out.contentPillars).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(out.goalsNotes).toBe(null);
  });

  it('buildHeuristicFocus derives topics from videos', () => {
    const out = buildHeuristicFocus({
      title: 'My Channel',
      description: 'guitar lessons for beginners',
      topVideos: [
        { title: 'Easy guitar chords for beginners', viewCount: 100 },
        { title: 'Guitar finger exercises daily practice', viewCount: 50 },
      ],
    });
    expect(out.niche.toLowerCase()).toContain('guitar');
    expect(out.contentPillars.length).toBeGreaterThan(0);
  });
});

describe('channelFocusService permissions', () => {
  it('canRead allows personal context for any authed user', async () => {
    const { service } = makeService();
    expect(await service.canRead({ uid: 'u1' }, null)).toBe(true);
    expect(await service.canRead(null, null)).toBe(false);
  });

  it('canRead requires org membership in org context', async () => {
    const { service, getCachedOrgMembership } = makeService();
    getCachedOrgMembership.mockResolvedValueOnce({ role: 'read' });
    expect(await service.canRead({ uid: 'u1' }, 'org1')).toBe(true);
    expect(await service.canRead({ uid: 'u1' }, 'org1')).toBe(false);
  });

  it('canManage allows personal, gates org to owner/admin/write', async () => {
    const { service, getCachedOrgMembership } = makeService();
    expect(await service.canManage({ uid: 'u1' }, null)).toBe(true);
    getCachedOrgMembership.mockResolvedValueOnce({ role: 'read' });
    expect(await service.canManage({ uid: 'u1' }, 'org1')).toBe(false);
    getCachedOrgMembership.mockResolvedValueOnce({ role: 'write' });
    expect(await service.canManage({ uid: 'u1' }, 'org1')).toBe(true);
  });

  it('sys admin bypasses org manage gate', async () => {
    const { service, getCachedUser } = makeService();
    getCachedUser.mockResolvedValue({ role: 'admin' });
    expect(await service.canManage({ uid: 'u1', email: 'a@x.com' }, 'org1')).toBe(true);
  });
});

describe('channelFocusService data paths', () => {
  it('getFocus returns null without a DB', async () => {
    const { service } = makeService();
    expect(await service.getFocus('ch1', null)).toBe(null);
  });

  it('upsertFocus throws without a DB', async () => {
    const { service } = makeService();
    await expect(service.upsertFocus({ channelId: 'ch1' })).rejects.toThrow('Database not configured');
  });

  it('generateFocus falls back to heuristic without LLM', async () => {
    const { service } = makeService();
    const out = await service.generateFocus({ title: 'Cooking with Ana', description: 'vegan recipes' });
    expect(out.source).toBe('heuristic');
    expect(out.niche.toLowerCase()).toContain('vegan');
  });

  it('generateFocus uses LLM output when available', async () => {
    const deepSeekJson = vi.fn(async () => ({
      niche: 'Vegan cooking',
      audience: 'Home cooks',
      contentPillars: ['recipes', 'meal prep'],
      tone: 'Warm',
      goalsNotes: 'Post weekly',
    }));
    const { service } = makeService({ deepSeekJson });
    const out = await service.generateFocus({ title: 'x' });
    expect(out.source).toBe('ai');
    expect(out.niche).toBe('Vegan cooking');
    expect(out.contentPillars).toEqual(['recipes', 'meal prep']);
  });

  it('generateFocus falls back to heuristic on LLM failure', async () => {
    const deepSeekJson = vi.fn(async () => { throw new Error('boom'); });
    const { service } = makeService({ deepSeekJson });
    const out = await service.generateFocus({ title: 'Guitar Lab' });
    expect(out.source).toBe('heuristic');
  });

  it('generateFocus accepts a bare snapshot (backward compatible)', async () => {
    const { service } = makeService();
    const out = await service.generateFocus({ title: 'Solo Snapshot' });
    expect(out.dataSource).toBe('snapshot');
  });
});

describe('summarizeAuditInput', () => {
  it('condenses channel + top videos + playlists to top level', () => {
    const out = summarizeAuditInput({
      channel: { name: 'Chef Ana', description: 'vegan food', keywords: ['vegan', 'recipes'] },
      videos: [
        { title: 'b-video', viewCount: 10, likeCount: 1, tags: [] },
        { title: 'a-video', viewCount: 100, likeCount: 20, tags: ['vegan'] },
      ],
      playlists: [{ title: 'Dinners', size: 12 }, { title: '', size: 3 }],
    });
    expect(out.title).toBe('Chef Ana');
    expect(out.topVideos[0].title).toBe('a-video');
    expect(out.stats.videoCount).toBe(2);
    expect(out.stats.totalViews).toBe(110);
    expect(out.playlists).toEqual([{ title: 'Dinners', size: 12 }]);
  });
});

describe('buildFocusContextBlock', () => {
  it('returns empty string without a focus', () => {
    expect(buildFocusContextBlock(null)).toBe('');
    expect(buildFocusContextBlock({})).toBe('');
    expect(buildFocusContextBlock({ niche: '', audience: '', contentPillars: [] })).toBe('');
  });

  it('renders niche/audience/pillars/tone/goals with owner-defined priority note', () => {
    const block = buildFocusContextBlock({
      niche: 'Vegan cooking',
      audience: 'Busy home cooks',
      contentPillars: ['recipes', 'meal prep'],
      tone: 'Warm',
      goalsNotes: 'Post weekly',
    });
    expect(block).toContain('owner-defined');
    expect(block).toContain('Niche: Vegan cooking');
    expect(block).toContain('Audience: Busy home cooks');
    expect(block).toContain('Content pillars: recipes, meal prep');
    expect(block).toContain('Tone/voice: Warm');
    expect(block).toContain('Goals: Post weekly');
  });

  it('skips empty fields', () => {
    const block = buildFocusContextBlock({ niche: 'Tech', contentPillars: [] });
    expect(block).toContain('Niche: Tech');
    expect(block).not.toContain('Audience:');
  });
});

describe('getFocusForAI', () => {
  it('returns null without a channel and never throws', async () => {
    const { service } = makeService();
    expect(await service.getFocusForAI(null)).toBe(null);
    expect(await service.getFocusForAI('')).toBe(null);
    const failing = createChannelFocusService({ getDb: () => { throw new Error('down'); } });
    expect(await failing.getFocusForAI('ch1')).toBe(null);
  });

  it('returns the cached focus when present', async () => {
    const fake = { channelId: 'ch1', niche: 'Tech' };
    const { service } = makeService({ serverCache: { get: async () => fake } });
    // getDb null + cache hit -> returns cached row
    expect(await service.getFocusForAI('ch1')).toEqual(fake);
  });
});

describe('getChannelContext', () => {
  it('prefers Postgres analytics over live fetch', async () => {
    const getAuditInput = vi.fn(async () => { throw new Error('should not be called'); });
    const { service } = makeService({
      getDb: () => makeDbFake([{ title: 'DB Channel' }], DB_VIDEOS),
      getAuditInput,
    });
    const ctx = await service.getChannelContext('ch1', { snapshot: {} });
    expect(ctx.dataSource).toBe('db');
    expect(ctx.fetchedLive).toBe(false);
    expect(ctx.topVideos[0].title).toBe('Vegan weeknight dinners');
    expect(getAuditInput).not.toHaveBeenCalled();
  });

  it('falls back to the live audit bundle when the DB catalog is empty', async () => {
    const getAuditInput = vi.fn(async () => ({
      channel: { name: 'Live Channel', description: 'live desc', keywords: ['live'] },
      videos: [{ title: 'live hit', viewCount: 42, likeCount: 5, tags: [] }],
      playlists: [{ title: 'Live List', size: 4 }],
    }));
    const { service } = makeService({
      getDb: () => makeDbFake([], []),
      getAuditInput,
    });
    const ctx = await service.getChannelContext('ch1', { authHeader: 'Bearer x', snapshot: {} });
    expect(ctx.dataSource).toBe('live');
    expect(ctx.fetchedLive).toBe(true);
    expect(ctx.title).toBe('Live Channel');
    expect(ctx.playlists).toEqual([{ title: 'Live List', size: 4 }]);
    expect(getAuditInput).toHaveBeenCalledWith({ channelId: 'ch1', authHeader: 'Bearer x' });
  });

  it('uses the snapshot when DB and live both unavailable', async () => {
    const { service } = makeService({ snapshot: undefined });
    const ctx = await service.getChannelContext('ch1', { snapshot: { title: 'Snap' } });
    expect(ctx.dataSource).toBe('snapshot');
    expect(ctx.title).toBe('Snap');
  });

  it('setAuditInputSource wires a late live source', async () => {
    const { service } = makeService({ getDb: () => makeDbFake([], []) });
    service.setAuditInputSource(async () => ({
      channel: { name: 'Late Live' }, videos: [{ title: 'v', viewCount: 7 }], playlists: [],
    }));
    const ctx = await service.getChannelContext('ch9', { snapshot: {} });
    expect(ctx.dataSource).toBe('live');
    expect(ctx.title).toBe('Late Live');
  });
});

describe('generateFocus with channel context', () => {
  it('grounds the LLM prompt in top videos + playlists and reports dataSource', async () => {
    let seenPrompt = '';
    const deepSeekJson = vi.fn(async ({ prompt }) => { seenPrompt = prompt; return null; });
    const { service } = makeService({
      getDb: () => makeDbFake([{ title: 'DB Channel' }], DB_VIDEOS),
      deepSeekJson,
    });
    const out = await service.generateFocus({ channelId: 'ch1', snapshot: {} });
    expect(seenPrompt).toContain('Vegan weeknight dinners');
    expect(seenPrompt).toContain('Catalog:');
    expect(out.dataSource).toBe('db');
    expect(out.source).toBe('heuristic');
    expect(out.niche.toLowerCase()).toContain('vegan');
  });

  it('marks fetchedLive so the route can bill quota', async () => {
    const { service } = makeService({
      getDb: () => makeDbFake([], []),
      getAuditInput: async () => ({
        channel: { name: 'Live' }, videos: [{ title: 'v', viewCount: 7 }], playlists: [],
      }),
    });
    const out = await service.generateFocus({ channelId: 'ch1', snapshot: {} });
    expect(out.fetchedLive).toBe(true);
    expect(out.dataSource).toBe('live');
  });
});

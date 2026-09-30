import { describe, it, expect, vi } from 'vitest';
const { createCustomDashboardService } = require('./customDashboardService');

function makeService(overrides = {}) {
  const query = vi.fn(async () => ({ rows: [] }));
  const serverCache = {
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  };
  const service = createCustomDashboardService({
    query,
    isPostgresConfigured: () => true,
    getCachedOrgMembership: vi.fn(async () => ({ role: 'owner' })),
    serverCache,
    ...overrides,
  });
  return { service, query, serverCache };
}

const LAYOUT = {
  cells: [{ id: 'channel-kpis', x: 0, y: 0, w: 12, h: 1 }],
  hidden: ['goals'],
};

describe('customDashboardService.getLayout', () => {
  it('returns supported:false when Postgres is not configured (no query)', async () => {
    const { service, query } = makeService({ isPostgresConfigured: () => false });
    const result = await service.getLayout('u1', '', 'default');
    expect(result).toEqual({ supported: false, layout: null });
    expect(query).not.toHaveBeenCalled();
  });

  it('serves a cached layout without hitting Postgres', async () => {
    const { service, query, serverCache } = makeService();
    serverCache.get.mockResolvedValueOnce({ layout: LAYOUT });
    const result = await service.getLayout('u1', '', 'default');
    expect(result).toEqual({ supported: true, layout: LAYOUT });
    expect(query).not.toHaveBeenCalled();
  });

  it('reads from Postgres and sanitizes on a cache miss', async () => {
    const { service, query } = makeService();
    query.mockResolvedValueOnce({
      rows: [{ layout: { cells: [{ id: 'a', x: 7, y: 0, w: 6, h: 1 }], hidden: [] } }],
    });
    const result = await service.getLayout('u1', 'org1', 'default');
    expect(result.supported).toBe(true);
    expect(result.layout).toEqual({ cells: [], hidden: [] });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('SELECT layout'), [
      'u1',
      'org1',
      'default',
    ]);
  });

  it('returns null layout when nothing is saved yet', async () => {
    const { service } = makeService();
    const result = await service.getLayout('u1', '', 'default');
    expect(result).toEqual({ supported: true, layout: null });
  });
});

describe('customDashboardService.saveLayout', () => {
  it('upserts sanitized JSON with parameterized SQL and invalidates cache', async () => {
    const { service, query, serverCache } = makeService();
    const saved = await service.saveLayout('u1', '', 'default', {
      cells: [...LAYOUT.cells, { id: 'bad id!', x: 0, y: 5, w: 6, h: 1 }],
      hidden: LAYOUT.hidden,
    });
    expect(saved).toEqual(LAYOUT);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (owner_uid, org_id, name)'),
      ['u1', '', 'default', JSON.stringify(LAYOUT)],
    );
    expect(serverCache.delete).toHaveBeenCalledWith('customDash:u1:personal:default');
  });

  it('rejects org scopes for non-members with 403', async () => {
    const { service, query } = makeService({
      getCachedOrgMembership: vi.fn(async () => null),
    });
    await expect(service.saveLayout('u1', 'org9', 'default', LAYOUT)).rejects.toMatchObject({
      status: 403,
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('reports 503 when Postgres is not configured', async () => {
    const { service } = makeService({ isPostgresConfigured: () => false });
    await expect(service.saveLayout('u1', '', 'default', LAYOUT)).rejects.toMatchObject({
      status: 503,
    });
  });
});

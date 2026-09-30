// Unit tests for the custom-dashboard API client (Postgres-backed layouts).
// `fetch`, `apiBase` and `authHeaders` are mocked — no network/Firebase.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/apiBase', () => ({
  apiUrl: (p: string) => `https://api.test${p}`,
}));
vi.mock('./authHeaders', () => ({
  getFirebaseAuthHeader: vi.fn(async () => ({ 'X-Firebase-Token': 'tok' })),
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const { getCustomDashboardLayout, saveCustomDashboardLayout } = await import(
  './customDashboardService'
);

function mockTextResponse(body: string, status = 200) {
  fetchMock.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as Response);
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('getCustomDashboardLayout', () => {
  it('normalizes a stored matrix and scopes personal reads without orgId', async () => {
    mockTextResponse(
      JSON.stringify({
        layout: {
          cells: [
            { id: 'goals', x: 0, y: 0, w: 12, h: 1 },
            { id: 'ghost!', x: 0, y: 1, w: 6, h: 1 },
          ],
          hidden: [],
        },
        supported: true,
      }),
    );
    const result = await getCustomDashboardLayout(null);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/custom-dashboards?name=default',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result.supported).toBe(true);
    // Unknown ids drop; missing catalogue ids append packed at the end.
    expect(result.layout?.cells.map((c) => c.id)[0]).toBe('goals');
    expect(result.layout?.cells.map((c) => c.id)).not.toContain('ghost!');
    const { getStatCardDefinitions, CUSTOM_DASHBOARD_SURFACE } = await import(
      '../config/statCardRegistry'
    );
    expect(result.layout?.cells).toHaveLength(
      getStatCardDefinitions(CUSTOM_DASHBOARD_SURFACE).length,
    );
  });

  it('passes orgId through for org-scoped reads', async () => {
    mockTextResponse(JSON.stringify({ layout: null, supported: true }));
    await getCustomDashboardLayout('org1');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/custom-dashboards?name=default&orgId=org1',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('reports unsupported on 503 and null layout on other failures', async () => {
    mockTextResponse('unavailable', 503);
    expect(await getCustomDashboardLayout(null)).toEqual({ supported: false, layout: null });

    mockTextResponse('boom', 500);
    expect(await getCustomDashboardLayout(null)).toEqual({ supported: true, layout: null });

    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await getCustomDashboardLayout(null)).toEqual({ supported: true, layout: null });
  });
});

describe('saveCustomDashboardLayout', () => {
  it('PUTs the matrix with personal scope defaulting to empty orgId', async () => {
    mockTextResponse(JSON.stringify({ layout: { cells: [], hidden: [] }, supported: true }));
    const layout = { cells: [{ id: 'goals', x: 0, y: 0, w: 12, h: 1 }], hidden: [] as string[] };
    expect(await saveCustomDashboardLayout(null, layout)).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/custom-dashboards',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ orgId: '', name: 'default', layout }),
      }),
    );
  });

  it('returns false when the save fails', async () => {
    mockTextResponse('nope', 500);
    expect(await saveCustomDashboardLayout('org1', { cells: [], hidden: [] })).toBe(false);
  });
});

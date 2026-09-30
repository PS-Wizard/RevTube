// Unit tests for the Channel Focus frontend API client.
// `fetch`, `apiBase`, and `authHeaders` are mocked — no network/Firebase.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/apiBase', () => ({
  apiUrl: (p: string) => `https://api.test${p}`,
}));

vi.mock('./authHeaders', () => ({
  getFirebaseAuthHeader: vi.fn(async () => ({ 'X-Firebase-Token': 'tok' })),
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const { getChannelFocus, saveChannelFocus, generateChannelFocus } =
  await import('./channelFocusService');

function mockJsonResponse(body: unknown) {
  fetchMock.mockResolvedValue({ ok: true, json: async () => body } as Response);
}

beforeEach(() => {
  fetchMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('channelFocusService (frontend client)', () => {
  it('GETs focus with channelId query', async () => {
    mockJsonResponse({ focus: { channelId: 'UC1', niche: 'tech' } });
    const focus = await getChannelFocus('UC1');
    expect(focus?.niche).toBe('tech');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.test/channel-focus?channelId=UC1');
    expect(init.headers['X-Firebase-Token']).toBe('tok');
    expect(init.headers['X-Org-Id']).toBeUndefined();
  });

  it('attaches X-Org-Id + organizationId query in org context', async () => {
    mockJsonResponse({ focus: null });
    await getChannelFocus('UC1', 'org-7');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('organizationId=org-7');
    expect(init.headers['X-Org-Id']).toBe('org-7');
  });

  it('PUTs focus edits', async () => {
    mockJsonResponse({ focus: { channelId: 'UC1', niche: 'tech' } });
    const focus = await saveChannelFocus({ channelId: 'UC1', niche: 'tech' });
    expect(focus.niche).toBe('tech');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.test/channel-focus');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body).niche).toBe('tech');
  });

  it('POSTs channel snapshot to /generate', async () => {
    mockJsonResponse({ generated: { niche: 'ai-niche', source: 'ai' } });
    const gen = await generateChannelFocus('UC1', { title: 'T' }, 'org-7');
    expect(gen.source).toBe('ai');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.test/channel-focus/generate');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Org-Id']).toBe('org-7');
    expect(JSON.parse(init.body).channelSnapshot.title).toBe('T');
  });

  it('throws a friendly error on failure', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: { message: 'Forbidden' } }),
    } as Response);
    await expect(getChannelFocus('UC1')).rejects.toThrow('Forbidden');
  });
});

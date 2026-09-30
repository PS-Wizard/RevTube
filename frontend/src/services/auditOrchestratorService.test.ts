// Unit tests for the Centralized Audit Orchestrator frontend API client.
// `fetch`, `apiBase`, and `authHeaders` are all mocked so no network/Firebase
// is touched -- we only verify payload shaping + URL construction.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/apiBase', () => ({
  apiUrl: (p: string) => `https://api.test${p}`,
}));

vi.mock('./authHeaders', () => ({
  getFirebaseAuthHeader: vi.fn(async () => ({ 'X-Firebase-Token': 'tok' })),
}));

// Mock global fetch before importing the module under test.
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const { runAuditOrchestrator, getAuditOrchestratorJobStatus, getAuditOrchestratorReport, rerunAuditOrchestrator, getAuditOrchestratorHistory, deleteAuditOrchestratorHistory } =
  await import('./auditOrchestratorService');

function mockJsonResponse(body: unknown) {
  fetchMock.mockResolvedValue({ ok: true, json: async () => body } as Response);
}

beforeEach(() => {
  fetchMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('auditOrchestratorService (frontend client)', () => {
  it('POSTs an enqueue with channelId + includeThumbnailAI and parses jobId', async () => {
    mockJsonResponse({ jobId: 'job-123' });
    const res = await runAuditOrchestrator('UC123', { includeThumbnailAI: true });
    expect(res.jobId).toBe('job-123');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.test/audit-orchestrator');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ channelId: 'UC123', includeThumbnailAI: true, scope: 'full' });
  });

  it('passes scope=channel for channel-only audits', async () => {
    mockJsonResponse({ jobId: 'job-2' });
    await runAuditOrchestrator('UC123', { scope: 'channel' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).scope).toBe('channel');
  });

  it('attaches X-Org-Id when orgId is provided', async () => {
    mockJsonResponse({ jobId: 'job-9' });
    await runAuditOrchestrator('UC123', { orgId: 'org-7' });
    expect(fetchMock.mock.calls[0][1].headers['X-Org-Id']).toBe('org-7');
  });

  it('polls job status at the /jobs/:id endpoint', async () => {
    mockJsonResponse({ jobId: 'j1', state: 'completed', progress: 100 });
    const status = await getAuditOrchestratorJobStatus('j1');
    expect(status.state).toBe('completed');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/audit-orchestrator/jobs/j1');
  });

  it('fetches the persisted report at /:id', async () => {
    mockJsonResponse({ run: { id: 5 }, subRuns: [] });
    const report = await getAuditOrchestratorReport(5);
    expect(report.run.id).toBe(5);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/audit-orchestrator/5');
  });

  it('POSTs a rerun with includeThumbnailAI', async () => {
    mockJsonResponse({ jobId: 'job-rerun' });
    const res = await rerunAuditOrchestrator(42, { includeThumbnailAI: false });
    expect(res.jobId).toBe('job-rerun');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.test/audit-orchestrator/42/rerun');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ includeThumbnailAI: false });
  });

  it('throws a descriptive error on non-ok responses', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 } as Response);
    await expect(runAuditOrchestrator('UC123')).rejects.toThrow(/failed \(503\)/);
  });

  it('fetches history list at /history with pagination + search params', async () => {
    mockJsonResponse({ items: [{ id: 7, channelTitle: 'C', overallScore: 42 }], total: 1, page: 2 });
    const history = await getAuditOrchestratorHistory({ page: 2, search: 'C' });
    expect(history.total).toBe(1);
    expect(history.items[0].id).toBe(7);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('/audit-orchestrator/history?');
    expect(url).toContain('page=2');
    expect(url).toContain('search=C');
  });

  it('DELETEs a history entry at /history/:id', async () => {
    mockJsonResponse({ success: true });
    const res = await deleteAuditOrchestratorHistory(9);
    expect(res.success).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.test/audit-orchestrator/history/9');
    expect(init.method).toBe('DELETE');
  });
});

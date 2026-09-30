import { describe, it, expect, vi } from "vitest";
import { createPublicAuditRouter } from "./publicAudit.js";

// Jobs endpoints for the `public-audit` BullMQ queue: enqueue (POST /jobs)
// with a synchronous fallback when the queue service is disabled, and polling
// (GET /jobs/:id). DI fakes only — no Redis, no Postgres, no network.
function makeRouter(overrides = {}) {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  const deps = {
    checkAdmin: (req, res, next) => next(),
    query,
    isPostgresConfigured: () => true,
    handleApiError: (err, res) => res.status(500).json({ error: { message: err.message } }),
    publicAuditService: {},
    videoAuditService: {},
    getAuditCriteria: vi.fn(),
    createAuditScoringService: vi.fn(),
    getAuditScoring: vi.fn(),
    db: {},
    queueService: {},
    ...overrides,
  };
  return { router: createPublicAuditRouter(deps), deps };
}

function call(router, method, url, body, params) {
  const req = {
    method, url, body, query: {}, params: params || {}, headers: {},
    authUser: { uid: "admin1", email: "admin@x.com" },
  };
  const res = { statusCode: 200, body: null, status(c){ this.statusCode = c; return this; }, json(b){ this.body = b; return this; } };
  return new Promise((resolve) => {
    router.handle(req, res, () => {});
    setTimeout(() => resolve({ req, res }), 20);
  });
}

describe("public-audit jobs endpoints", () => {
  it("POST /jobs enqueues and returns the jobId", async () => {
    const enqueuePublicAudit = vi.fn().mockResolvedValue({ id: "job-1" });
    const { router } = makeRouter({ queueService: { enqueuePublicAudit } });
    const { res } = await call(router, "POST", "/jobs", {
      channelInput: "@demo",
      maxVideos: 500,
      includeAllPlaylists: true,
      includeThumbnail: false,
      includeCaptions: true,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.jobId).toBe("job-1");
    const [payload] = enqueuePublicAudit.mock.calls[0];
    expect(payload.channelInput).toBe("@demo");
    expect(payload.maxVideos).toBe(500);
    expect(payload.includeAllPlaylists).toBe(true);
    expect(payload.includeCaptions).toBe(true);
    expect(payload.uid).toBe("admin1");
    expect(payload.email).toBe("admin@x.com");
  });

  it("POST /jobs defaults includeCaptions to false", async () => {
    const enqueuePublicAudit = vi.fn().mockResolvedValue({ id: "job-2" });
    const { router } = makeRouter({ queueService: { enqueuePublicAudit } });
    await call(router, "POST", "/jobs", { channelInput: "@demo" });
    expect(enqueuePublicAudit.mock.calls[0][0].includeCaptions).toBe(false);
  });

  it("POST /jobs clamps maxVideos to the 1,000 server ceiling", async () => {
    const enqueuePublicAudit = vi.fn().mockResolvedValue({ id: "job-9" });
    const { router } = makeRouter({ queueService: { enqueuePublicAudit } });
    await call(router, "POST", "/jobs", { channelInput: "@demo", maxVideos: 99999 });
    expect(enqueuePublicAudit.mock.calls[0][0].maxVideos).toBe(1000);
  });

  it("POST /jobs rejects a missing channelInput with 400", async () => {
    const enqueuePublicAudit = vi.fn();
    const { router } = makeRouter({ queueService: { enqueuePublicAudit } });
    const { res } = await call(router, "POST", "/jobs", { channelInput: "  " });
    expect(res.statusCode).toBe(400);
    expect(enqueuePublicAudit).not.toHaveBeenCalled();
  });

  it("GET /jobs/:id returns state + progress + result when completed", async () => {
    const result = { id: 3, channelTitle: "Demo", overall: 77, results: [] };
    const publicAuditJobsGet = vi.fn().mockResolvedValue({
      id: "job-3",
      progress: 100,
      getState: async () => "completed",
      returnvalue: result,
    });
    const { router } = makeRouter({ queueService: { publicAuditJobsGet } });
    const { res } = await call(router, "GET", "/jobs/job-3", undefined, { id: "job-3" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ jobId: "job-3", state: "completed", progress: 100, result });
  });

  it("GET /jobs/:id surfaces the failure reason when failed", async () => {
    const publicAuditJobsGet = vi.fn().mockResolvedValue({
      id: "job-4",
      progress: 55,
      getState: async () => "failed",
      failedReason: "boom",
    });
    const { router } = makeRouter({ queueService: { publicAuditJobsGet } });
    const { res } = await call(router, "GET", "/jobs/job-4", undefined, { id: "job-4" });
    expect(res.statusCode).toBe(200);
    expect(res.body.state).toBe("failed");
    expect(res.body.error).toBe("boom");
    expect(res.body.result).toBeUndefined();
  });

  it("GET /jobs/:id returns 404 for an unknown job", async () => {
    const { router } = makeRouter({ queueService: { publicAuditJobsGet: vi.fn().mockResolvedValue(null) } });
    const { res } = await call(router, "GET", "/jobs/nope", undefined, { id: "nope" });
    expect(res.statusCode).toBe(404);
  });

  it("GET /jobs/:id returns 503 when the queue service is disabled", async () => {
    const { router } = makeRouter({ queueService: {} });
    const { res } = await call(router, "GET", "/jobs/job-1", undefined, { id: "job-1" });
    expect(res.statusCode).toBe(503);
  });
});

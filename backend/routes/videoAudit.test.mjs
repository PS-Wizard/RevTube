import { describe, it, expect, vi } from "vitest";
import { createVideoAuditRouter } from "./videoAudit.js";

function makeRouter(overrides = {}) {
  const enqueue = vi.fn().mockResolvedValue({ id: "job1" });
  const jobsGet = vi.fn().mockResolvedValue({ id: "job1", state: "completed", returnvalue: { overall: 80, results: [] }, progress: 100, getState: vi.fn().mockResolvedValue("completed") });
  const query = vi.fn().mockResolvedValue({ rows: [] });
  const isPostgresConfigured = vi.fn().mockReturnValue(true);
  const deps = {
    resolveUser: (req, res, next) => next(),
    checkPremiumAccess: () => (req, res, next) => next(),
    requireQuota: () => (req, res, next) => next(),
    handleApiError: (err, res) => res.status(500).json({ error: { message: err.message } }),
    ownership: { getConnectedChannelIds: vi.fn().mockResolvedValue(new Set(["c1"])) },
    queueService: { enqueueVideoAudit: enqueue, jobsGet },
    query,
    isPostgresConfigured,
    ...overrides,
  };
  return { router: createVideoAuditRouter(deps), enqueue, jobsGet, query };
}

function call(router, method, url, body) {
  const req = { method, url, body, query: {}, params: {}, headers: {} };
  const res = { statusCode: 200, body: null, status(c){ this.statusCode = c; return this; }, json(b){ this.body = b; return this; } };
  return new Promise((resolve) => {
    let done = false;
    router.handle(req, res, () => { done = true; });
    // Wait for async handlers to complete
    setTimeout(() => resolve({ req, res, done }), 10);
  });
}

describe("video-audit route", () => {
  it("POST enqueues a job for an owned channel and returns jobId", async () => {
    const { router, enqueue } = makeRouter();
    const { res } = await call(router, "POST", "/", { channelId: "c1", videoIds: ["a", "b"] });
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ channelId: "c1", videoIds: ["a", "b"] }), expect.any(Object));
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ jobId: "job1" });
  });

  it("POST 403 for a non-owned channel", async () => {
    const { router } = makeRouter({
      ownership: { getConnectedChannelIds: vi.fn().mockResolvedValue(new Set(["c1"])) },
    });
    const { res } = await call(router, "POST", "/", { channelId: "c9", videoIds: ["a"] });
    expect(res.statusCode).toBe(403);
  });

  it("GET /jobs/:id returns job status", async () => {
    const { router, jobsGet } = makeRouter();
    const { res } = await call(router, "GET", "/jobs/job1", null);
    expect(jobsGet).toHaveBeenCalledWith("job1");
    expect(res.statusCode).toBe(200);
    expect(res.body).toBeDefined();
  });
});
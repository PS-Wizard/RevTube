import { describe, it, expect, vi } from "vitest";
import { createAuditOrchestratorRouter } from "./auditOrchestrator.js";

function makeRouter(overrides = {}) {
  const enqueueAuditOrchestrator = vi.fn(async () => ({ id: "job1" }));
  const deps = {
    ownership: { getConnectedChannelIds: async () => ["c1"] },
    queueService: { enqueueAuditOrchestrator },
    resolveUser: (req, res, next) => {
      req.authUser = { uid: "u1", email: "a@b.com" };
      req.currentUser = { uid: "u1", email: "a@b.com", package: "free", role: "user" };
      next();
    },
    checkPremiumAccess: () => (req, res, next) => next(),
    requireQuota: () => (req, res, next) => next(),
    getFeatureConfig: async () => ({
      pages: { auditVideos: { label: "Channel Audit Videos", freeLimit: 15, proLimit: 30 } },
    }),
    handleApiError: (err, res) => res.status(500).json({ error: { message: err.message } }),
    ...overrides,
  };
  return { router: createAuditOrchestratorRouter(deps), enqueueAuditOrchestrator };
}

function call(router, method, url, { body = {}, headers = {} } = {}) {
  const req = { method, url, query: {}, body, params: {}, headers };
  const res = { statusCode: 200, body: null, status(c){ this.statusCode = c; return this; }, json(b){ this.body = b; return this; } };
  return new Promise((resolve) => {
    router.handle(req, res, () => {});
    setTimeout(() => resolve({ req, res }), 15);
  });
}

const postAudit = (router, count) =>
  call(router, "POST", "/", { body: { channelId: "c1", videoSelection: { mode: "recent", count } } });

describe("audit-orchestrator video count plan cap", () => {
  it("clamps a free user to the configured free cap", async () => {
    const { router, enqueueAuditOrchestrator } = makeRouter();
    const { res } = await postAudit(router, 100);
    expect(res.statusCode).toBe(200);
    expect(enqueueAuditOrchestrator).toHaveBeenCalledOnce();
    expect(enqueueAuditOrchestrator.mock.calls[0][0].videoSelection.count).toBe(15);
  });

  it("clamps a pro user to the configured pro cap", async () => {
    const { router, enqueueAuditOrchestrator } = makeRouter({
      resolveUser: (req, res, next) => {
        req.authUser = { uid: "u1", email: "a@b.com" };
        req.currentUser = { uid: "u1", email: "a@b.com", package: "pro", role: "user" };
        next();
      },
    });
    const { res } = await postAudit(router, 100);
    expect(res.statusCode).toBe(200);
    expect(enqueueAuditOrchestrator.mock.calls[0][0].videoSelection.count).toBe(30);
  });

  it("treats admins as pro", async () => {
    const { router, enqueueAuditOrchestrator } = makeRouter({
      resolveUser: (req, res, next) => {
        req.authUser = { uid: "u1", email: "a@b.com" };
        req.currentUser = { uid: "u1", email: "a@b.com", package: "free", role: "admin" };
        next();
      },
    });
    const { res } = await postAudit(router, 100);
    expect(res.statusCode).toBe(200);
    expect(enqueueAuditOrchestrator.mock.calls[0][0].videoSelection.count).toBe(30);
  });

  it("leaves an under-cap count untouched", async () => {
    const { router, enqueueAuditOrchestrator } = makeRouter();
    const { res } = await postAudit(router, 10);
    expect(res.statusCode).toBe(200);
    expect(enqueueAuditOrchestrator.mock.calls[0][0].videoSelection.count).toBe(10);
  });

  it("honours an admin-raised cap", async () => {
    const { router, enqueueAuditOrchestrator } = makeRouter({
      getFeatureConfig: async () => ({
        pages: { auditVideos: { label: "Channel Audit Videos", freeLimit: 25, proLimit: 50 } },
      }),
    });
    const { res } = await postAudit(router, 100);
    expect(res.statusCode).toBe(200);
    expect(enqueueAuditOrchestrator.mock.calls[0][0].videoSelection.count).toBe(25);
  });

  it("falls back to code defaults when the config is unavailable", async () => {
    const { router, enqueueAuditOrchestrator } = makeRouter({ getFeatureConfig: undefined });
    const { res } = await postAudit(router, 100);
    expect(res.statusCode).toBe(200);
    expect(enqueueAuditOrchestrator.mock.calls[0][0].videoSelection.count).toBe(15);
  });
});

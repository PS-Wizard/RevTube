import { describe, it, expect, vi } from "vitest";
import { createChannelFocusRouter } from "./channelFocus.js";

function makeRouter(overrides = {}) {
  const channelFocusService = {
    canRead: vi.fn(async () => true),
    canManage: vi.fn(async () => true),
    getFocus: vi.fn(async () => null),
    upsertFocus: vi.fn(async (d) => ({ id: 1, channelId: d.channelId, organizationId: d.organizationId || null })),
    generateFocus: vi.fn(async () => ({ niche: "n", source: "heuristic" })),
  };
  const consumeQuota = vi.fn(async () => {});
  const deps = {
    channelFocusService,
    analyticsReadLimiter: (req, res, next) => next(),
    resolveUser: (req, res, next) => { req.authUser = { uid: "u1" }; next(); },
    resolveOrgToken: () => (req, res, next) => next(),
    requireQuota: () => (req, res, next) => next(),
    consumeQuota,
    handleApiError: (err, res) => res.status(500).json({ error: { message: err.message } }),
    ...overrides,
  };
  return { router: createChannelFocusRouter(deps), channelFocusService, consumeQuota };
}

function call(router, method, url, { query = {}, body = {}, headers = {} } = {}) {
  const req = { method, url, query, body, params: {}, headers };
  const res = { statusCode: 200, body: null, status(c){ this.statusCode = c; return this; }, json(b){ this.body = b; return this; } };
  return new Promise((resolve) => {
    router.handle(req, res, () => {});
    setTimeout(() => resolve({ req, res }), 15);
  });
}

describe("channel-focus route", () => {
  it("GET 400 without channelId", async () => {
    const { router } = makeRouter();
    const { res } = await call(router, "GET", "/", { query: {} });
    expect(res.statusCode).toBe(400);
  });

  it("GET returns focus for personal context", async () => {
    const { router, channelFocusService } = makeRouter();
    channelFocusService.getFocus.mockResolvedValueOnce({ id: 1, channelId: "c1", niche: "tech" });
    const { res } = await call(router, "GET", "/", { query: { channelId: "c1" } });
    expect(res.statusCode).toBe(200);
    expect(res.body.focus.niche).toBe("tech");
  });

  it("GET 403 when not an org member", async () => {
    const { router } = makeRouter({
      channelFocusService: {
        canRead: vi.fn(async () => false),
        canManage: vi.fn(async () => false),
        getFocus: vi.fn(),
        upsertFocus: vi.fn(),
        generateFocus: vi.fn(),
      },
    });
    const { res } = await call(router, "GET", "/", { query: { channelId: "c1", organizationId: "org1" } });
    expect(res.statusCode).toBe(403);
  });

  it("PUT upserts and returns focus", async () => {
    const { router, channelFocusService } = makeRouter();
    const { res } = await call(router, "PUT", "/", { body: { channelId: "c1", niche: "tech" } });
    expect(res.statusCode).toBe(200);
    expect(channelFocusService.upsertFocus).toHaveBeenCalledWith(expect.objectContaining({ channelId: "c1" }));
    expect(res.body.focus.channelId).toBe("c1");
  });

  it("PUT 403 without manage permission", async () => {
    const { router } = makeRouter({
      channelFocusService: {
        canRead: vi.fn(async () => true),
        canManage: vi.fn(async () => false),
        getFocus: vi.fn(),
        upsertFocus: vi.fn(),
        generateFocus: vi.fn(),
      },
    });
    const { res } = await call(router, "PUT", "/", { body: { channelId: "c1", organizationId: "org1" } });
    expect(res.statusCode).toBe(403);
  });

  it("POST /generate returns a preview without saving", async () => {
    const { router, channelFocusService, consumeQuota } = makeRouter();
    const { res } = await call(router, "POST", "/generate", { body: { channelId: "c1", channelSnapshot: { title: "t" } } });
    expect(res.statusCode).toBe(200);
    expect(res.body.generated).toBeDefined();
    expect(channelFocusService.upsertFocus).not.toHaveBeenCalled();
    expect(channelFocusService.generateFocus).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: "c1" })
    );
    // DB/snapshot path: no YouTube call, no quota consumed
    expect(consumeQuota).not.toHaveBeenCalled();
  });

  it("POST /generate bills quota only when it fetched live", async () => {
    const { router, consumeQuota } = makeRouter({
      channelFocusService: {
        canRead: vi.fn(async () => true),
        canManage: vi.fn(async () => true),
        getFocus: vi.fn(),
        upsertFocus: vi.fn(),
        generateFocus: vi.fn(async () => ({ niche: "n", source: "ai", dataSource: "live", fetchedLive: true })),
      },
    });
    const { res } = await call(router, "POST", "/generate", { body: { channelId: "c1" } });
    expect(res.statusCode).toBe(200);
    expect(res.body.generated.dataSource).toBe("live");
    expect(res.body.generated.fetchedLive).toBeUndefined();
    expect(consumeQuota).toHaveBeenCalledWith(expect.anything(), { billable: true });
  });
});

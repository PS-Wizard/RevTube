import { describe, it, expect, vi } from "vitest";
import quota from "./quota.js";
import quotaServiceMod from "../services/quotaService.js";

const { createQuotaMiddleware } = quota;
const { createQuotaService } = quotaServiceMod;

function makeFakeRedis() {
  const state = {};
  return {
    redisClient: {
      incrBy: vi.fn(async (key, by) => {
        state[key] = (state[key] || 0) + by;
        return state[key];
      }),
      set: vi.fn(async (key, val, opts) => {
        if (opts?.NX && state[key]) return null;
        state[key] = val;
        return "OK";
      }),
      expire: vi.fn(async () => 1),
    },
    state,
  };
}

function makeMiddleware() {
  const { redisClient } = makeFakeRedis();
  const serverCache = { useRedis: true, redisClient };
  const getFeatureConfig = vi.fn(async () => ({
    pages: { search: { freeLimit: 3, proLimit: 99, label: "Search" } },
  }));
  const getCachedOrgMembership = vi.fn(async () => false);
  const getCachedOrg = vi.fn(async () => null);
  const getCachedUser = vi.fn(async (email) => ({ uid: "u1", email, role: "user", package: "free" }));

  const quotaService = createQuotaService({ serverCache, getFeatureConfig, getCachedOrgMembership, getCachedOrg });

  const { requireQuota, consumeQuota } = createQuotaMiddleware({
    quotaService,
    getCachedUser,
    dedupWindowSec: 5,
    pageDedupWindows: {},
  });

  return { requireQuota, consumeQuota, quotaService };
}

function makeReq(overrides = {}) {
  return {
    headers: {},
    authUser: { uid: "u1", email: "a@b.com" },
    currentUser: { uid: "u1", email: "a@b.com", role: "user", package: "free" },
    ...overrides,
  };
}

function makeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

describe("requireQuota", () => {
  it("bypasses quota for admin users", async () => {
    const { requireQuota } = makeMiddleware();
    const req = makeReq({ currentUser: { uid: "u1", role: "admin" } });
    const next = vi.fn();
    await requireQuota("search")(req, {}, next);
    expect(next).toHaveBeenCalled();
    expect(req.usageInfo).toBeUndefined();
  });

  it("allows the request when under the limit and consumes one unit", async () => {
    const { requireQuota } = makeMiddleware();
    const req = makeReq();
    const next = vi.fn();
    await requireQuota("search")(req, {}, next);
    expect(next).toHaveBeenCalled();
    expect(req.usageInfo.used).toBe(1);
    expect(req.usageInfo.limit).toBe(3);
  });

  it("returns 429 when the limit is already reached", async () => {
    const { requireQuota, quotaService } = makeMiddleware();
    const month = quotaService.currentMonth();
    await quotaService.incrementCount("u1", "search", month);
    await quotaService.incrementCount("u1", "search", month);
    await quotaService.incrementCount("u1", "search", month); // used = 3 >= limit 3

    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    await requireQuota("search")(req, res, next);
    expect(res.statusCode).toBe(429);
    expect(res.body.error.code).toBe("LIMIT_EXCEEDED");
    expect(next).not.toHaveBeenCalled();
  });

  it("passes through when the page is not configured", async () => {
    const { requireQuota } = makeMiddleware();
    const req = makeReq();
    const next = vi.fn();
    await requireQuota("unknown-page")(req, {}, next);
    expect(next).toHaveBeenCalled();
  });
});

describe("consumeQuota", () => {
  it("does nothing without a quota context", async () => {
    const { consumeQuota } = makeMiddleware();
    const req = { quotaContext: null };
    await consumeQuota(req, { billable: true });
    expect(req.usageInfo).toBeUndefined();
  });

  it("does not consume when not billable and quotaBillable not set", async () => {
    const { consumeQuota } = makeMiddleware();
    const req = makeReq();
    req.quotaContext = { pageKey: "search", uid: "u1", month: "2026-08", limit: 3, used: 0 };
    await consumeQuota(req);
    expect(req.usageInfo).toBeUndefined();
  });

  it("consumes a unit when explicitly billable", async () => {
    const { consumeQuota, quotaService } = makeMiddleware();
    const req = makeReq();
    req.quotaContext = { pageKey: "search", uid: "u1", month: quotaService.currentMonth(), limit: 3, used: 0 };
    await consumeQuota(req, { billable: true });
    expect(req.usageInfo.used).toBe(1);
  });
});

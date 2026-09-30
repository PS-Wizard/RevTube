import { describe, it, expect, vi } from "vitest";
import quotaService from "./quotaService.js";

const { createQuotaService, currentMonth, usageKey, limitExceededPayload } = quotaService;

function makeFakeRedis() {
  const state = {};
  const redisClient = {
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
  };
  return { redisClient, state };
}

function makeService(deps = {}) {
  const serverCache = deps.serverCache || { useRedis: false };
  const getFeatureConfig = deps.getFeatureConfig || vi.fn(async () => null);
  const getCachedOrgMembership = deps.getCachedOrgMembership || vi.fn(async () => false);
  const getCachedOrg = deps.getCachedOrg || vi.fn(async () => null);
  const service = createQuotaService({ serverCache, getFeatureConfig, getCachedOrgMembership, getCachedOrg });
  return { service, getFeatureConfig, getCachedOrgMembership, getCachedOrg };
}

describe("pure helpers", () => {
  it("currentMonth formats YYYY-MM", () => {
    expect(currentMonth()).toMatch(/^\d{4}-\d{2}$/);
  });

  it("usageKey embeds uid, pageKey, and month", () => {
    expect(usageKey("u1", "search", "2026-08")).toBe("usage:u1:search:2026-08");
  });

  it("limitExceededPayload returns the expected error shape", () => {
    const payload = limitExceededPayload({ label: "Search" }, "search", 5, 5);
    expect(payload.error.code).toBe("LIMIT_EXCEEDED");
    expect(payload.error.limit).toBe(5);
    expect(payload.error.used).toBe(5);
    expect(payload.error.pageKey).toBe("search");
  });
});

describe("org pro access (via resolvePageLimit)", () => {
  const featureCfg = { pages: { search: { freeLimit: 5, proLimit: 999, label: "Search" } } };

  it("grants the pro limit to a member of a pro org", async () => {
    const { service } = makeService({
      getFeatureConfig: vi.fn(async () => featureCfg),
      getCachedOrgMembership: vi.fn(async () => true),
      getCachedOrg: vi.fn(async () => ({ plan: "pro" })),
    });
    const req = { headers: { "x-org-id": "org1" } };
    const resolved = await service.resolvePageLimit("search", { uid: "u1", package: "free" }, req);
    expect(resolved.limit).toBe(999);
    expect(resolved.isPro).toBe(true);
  });

  it("grants the free limit to a member of a non-pro org", async () => {
    const { service } = makeService({
      getFeatureConfig: vi.fn(async () => featureCfg),
      getCachedOrgMembership: vi.fn(async () => true),
      getCachedOrg: vi.fn(async () => ({ plan: "free" })),
    });
    const req = { headers: { "x-org-id": "org1" } };
    const resolved = await service.resolvePageLimit("search", { uid: "u1", package: "free" }, req);
    expect(resolved.limit).toBe(5);
    expect(resolved.isPro).toBe(false);
  });

  it("grants the free limit to a non-member", async () => {
    const { service } = makeService({
      getFeatureConfig: vi.fn(async () => featureCfg),
      getCachedOrgMembership: vi.fn(async () => false),
    });
    const req = { headers: { "x-org-id": "org1" } };
    const resolved = await service.resolvePageLimit("search", { uid: "u1", package: "free" }, req);
    expect(resolved.limit).toBe(5);
    expect(resolved.isPro).toBe(false);
  });
});

describe("resolvePageLimit", () => {
  it("returns null when the page is not configured", async () => {
    const { service } = makeService();
    expect(await service.resolvePageLimit("missing", { uid: "u1" }, { headers: {} })).toBeNull();
  });

  it("returns the free limit for a free user", async () => {
    const { service } = makeService({
      getFeatureConfig: vi.fn(async () => ({ pages: { search: { freeLimit: 5, proLimit: 999, label: "Search" } } })),
    });
    const resolved = await service.resolvePageLimit("search", { uid: "u1", package: "free" }, { headers: {} });
    expect(resolved.limit).toBe(5);
    expect(resolved.isPro).toBe(false);
  });

  it("returns the pro limit for a pro user", async () => {
    const { service } = makeService({
      getFeatureConfig: vi.fn(async () => ({ pages: { search: { freeLimit: 5, proLimit: 999, label: "Search" } } })),
    });
    const resolved = await service.resolvePageLimit("search", { uid: "u1", package: "pro" }, { headers: {} });
    expect(resolved.limit).toBe(999);
    expect(resolved.isPro).toBe(true);
  });

  it("returns null when the limit is -1 (unlimited)", async () => {
    const { service } = makeService({
      getFeatureConfig: vi.fn(async () => ({ pages: { search: { freeLimit: -1, proLimit: -1, label: "Search" } } })),
    });
    expect(await service.resolvePageLimit("search", { uid: "u1", package: "free" }, { headers: {} })).toBeNull();
  });
});

describe("read/increment/dedup over fake Redis", () => {
  it("reads 0 when nothing has been incremented", async () => {
    const { redisClient } = makeFakeRedis();
    const { service } = makeService({ serverCache: { useRedis: true, redisClient } });
    expect(await service.readCount("u1", "search", "2026-08")).toBe(0);
  });

  it("increments and reads the same count", async () => {
    const { redisClient } = makeFakeRedis();
    const { service } = makeService({ serverCache: { useRedis: true, redisClient } });
    await service.incrementCount("u1", "search", "2026-08");
    await service.incrementCount("u1", "search", "2026-08");
    expect(await service.readCount("u1", "search", "2026-08")).toBe(2);
  });

  it("sets an expiry on first increment of a month", async () => {
    const { redisClient } = makeFakeRedis();
    const { service } = makeService({ serverCache: { useRedis: true, redisClient } });
    await service.incrementCount("u1", "search", "2026-08");
    expect(redisClient.expire).toHaveBeenCalled();
  });

  it("isDuplicate returns false on first call, true within the window", async () => {
    const { redisClient } = makeFakeRedis();
    const { service } = makeService({ serverCache: { useRedis: true, redisClient } });
    expect(await service.isDuplicate("u1", "search", 5)).toBe(false);
    expect(await service.isDuplicate("u1", "search", 5)).toBe(true);
  });

  it("isDuplicate is disabled for a zero window", async () => {
    const { redisClient } = makeFakeRedis();
    const { service } = makeService({ serverCache: { useRedis: true, redisClient } });
    expect(await service.isDuplicate("u1", "search", 0)).toBe(false);
    expect(await service.isDuplicate("u1", "search", 0)).toBe(false);
  });
});

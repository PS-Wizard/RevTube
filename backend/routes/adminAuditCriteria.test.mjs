import { describe, it, expect, vi } from "vitest";
import { createAdminRouter } from "./admin.js";
import { DEFAULT_OPTIMIZER_CRITERIA } from "../config/optimizerCriteria.js";

function makeRouter() {
  const docs = { optimizerCriteria: null };
  const db = {
    collection: (name) => ({
      doc: (id) => ({
        set: async (data) => { docs[id] = data; },
        get: async () => ({ exists: !!docs[id], data: () => docs[id] }),
      }),
    }),
  };
  const invalidateAuditCriteriaCache = vi.fn(() => {});
  const invalidateOptimizerCriteriaCache = vi.fn(() => {});
  const invalidateParamCache = vi.fn(() => {});
  const bumpConfigVersion = vi.fn(async () => {});
  const checkAdmin = (req, res, next) => { req.authUser = { email: "support@revketer.ai" }; req.adminUser = req.authUser; next(); };
  const adminLimiter = (req, res, next) => next();
  const router = createAdminRouter({
    db,
    bumpConfigVersion,
    invalidateAuditCriteriaCache,
    invalidateOptimizerCriteriaCache,
    invalidateParamCache,
    checkAdmin,
    adminLimiter,
  });
  const call = (method, url, body) => {
    const req = { method, url, body, query: {}, params: {}, headers: {} };
    const res = { statusCode: 200, body: null, status(c){ this.statusCode = c; return this; }, json(b){ this.body = b; return this; } };
    let done = false;
    const next = () => { done = true; };
    router.handle(req, res, next);
    return new Promise((resolve) => setTimeout(() => resolve({ req, res, done }), 10));
  };
  return { router, db, docs, call, bumpConfigVersion, invalidateAuditCriteriaCache, invalidateOptimizerCriteriaCache, invalidateParamCache };
}

describe("admin audit-criteria endpoints", () => {
  it("GET returns the unified criteria grouped by audit category", async () => {
    const { call } = makeRouter();
    const { res } = await call("GET", "/audit-criteria", null);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      video: DEFAULT_OPTIMIZER_CRITERIA.videoElements,
      thumbnail: DEFAULT_OPTIMIZER_CRITERIA.thumbnail,
      playlist: DEFAULT_OPTIMIZER_CRITERIA.playlist,
    });
  });
  it("PUT persists into the unified optimizerCriteria doc and bumps version", async () => {
    const { call, docs, bumpConfigVersion, invalidateAuditCriteriaCache, invalidateOptimizerCriteriaCache, invalidateParamCache } = makeRouter();
    const { res } = await call("PUT", "/audit-criteria", { video: DEFAULT_OPTIMIZER_CRITERIA.videoElements });
    expect(res.statusCode).toBe(200);
    // Written to the SINGLE source of truth doc, with all sections present.
    expect(docs.optimizerCriteria.videoElements).toEqual(DEFAULT_OPTIMIZER_CRITERIA.videoElements);
    expect(docs.optimizerCriteria.thumbnail).toEqual(DEFAULT_OPTIMIZER_CRITERIA.thumbnail);
    expect(docs.optimizerCriteria.playlist).toEqual(DEFAULT_OPTIMIZER_CRITERIA.playlist);
    expect(docs.optimizerCriteria.channelIdentity.length).toBeGreaterThan(0);
    expect(bumpConfigVersion).toHaveBeenCalled();
    expect(invalidateAuditCriteriaCache).toHaveBeenCalled();
    expect(invalidateOptimizerCriteriaCache).toHaveBeenCalled();
    expect(invalidateParamCache).toHaveBeenCalled();
  });
  it("PUT rejects an empty video criteria list", async () => {
    const { call, docs } = makeRouter();
    const { res } = await call("PUT", "/audit-criteria", { video: [] });
    expect(res.statusCode).toBe(400);
    expect(docs.optimizerCriteria).toBeNull();
  });
  it("PUT /audit-criteria rejects playlist weights that do not sum to 100", async () => {
    const { call, docs } = makeRouter();
    const badPlaylist = DEFAULT_OPTIMIZER_CRITERIA.playlist.map((c) =>
      c.key === "title_ctr" ? { ...c, weight: c.weight + 10 } : { ...c },
    );
    const { res } = await call("PUT", "/audit-criteria", {
      video: DEFAULT_OPTIMIZER_CRITERIA.videoElements,
      playlist: badPlaylist,
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error.message).toMatch(/sum to 100/i);
    expect(docs.optimizerCriteria).toBeNull();
  });
  it("PUT /optimizer-criteria rejects playlist weights that do not sum to 100", async () => {
    const { call, docs } = makeRouter();
    const badPlaylist = DEFAULT_OPTIMIZER_CRITERIA.playlist.map((c) =>
      c.key === "title_ctr" ? { ...c, weight: c.weight + 10 } : { ...c },
    );
    const { res } = await call("PUT", "/optimizer-criteria", { playlist: badPlaylist });
    expect(res.statusCode).toBe(400);
    expect(res.body.error.message).toMatch(/sum to 100/i);
    expect(docs.optimizerCriteria).toBeNull();
  });
  it("GET /optimizer-criteria includes the playlist weight total", async () => {
    const { call } = makeRouter();
    const { res } = await call("GET", "/optimizer-criteria", null);
    expect(res.statusCode).toBe(200);
    expect(res.body.weightTotal).toBe(100);
    expect(res.body.playlistWeightTotal).toBe(100);
  });
});
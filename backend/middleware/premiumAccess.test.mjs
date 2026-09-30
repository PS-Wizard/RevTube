import { describe, it, expect, vi } from "vitest";
import premiumAccess from "./premiumAccess.js";

const { checkPremiumAccess } = premiumAccess;

function makeMiddleware(overrides = {}) {
  const getFeatureConfig =
    overrides.getFeatureConfig ||
    vi.fn(async () => ({ pages: { premium: { premiumOnly: true }, free: { premiumOnly: false } } }));
  const getCachedUser = overrides.getCachedUser || vi.fn(async () => ({ package: "free", role: "user" }));
  const getCachedOrgMembership = overrides.getCachedOrgMembership || vi.fn(async () => false);
  const getCachedOrg = overrides.getCachedOrg || vi.fn(async () => null);
  return {
    mw: checkPremiumAccess(getFeatureConfig, getCachedUser, getCachedOrgMembership, getCachedOrg),
  };
}

function makeReq(overrides = {}) {
  return { headers: {}, authUser: { uid: "u1" }, currentUser: null, ...overrides };
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

describe("checkPremiumAccess", () => {
  it("allows non-premium pages through", async () => {
    const { mw } = makeMiddleware();
    const next = vi.fn();
    await mw("free")(makeReq(), {}, next);
    expect(next).toHaveBeenCalled();
  });

  it("allows the resolve usage-context through", async () => {
    const { mw } = makeMiddleware();
    const next = vi.fn();
    await mw("premium")(makeReq({ headers: { "x-usage-context": "resolve" } }), {}, next);
    expect(next).toHaveBeenCalled();
  });

  it("allows a pro user", async () => {
    const { mw } = makeMiddleware();
    const next = vi.fn();
    await mw("premium")(makeReq({ currentUser: { package: "pro" } }), {}, next);
    expect(next).toHaveBeenCalled();
  });

  it("allows an admin user", async () => {
    const { mw } = makeMiddleware();
    const next = vi.fn();
    await mw("premium")(makeReq({ currentUser: { package: "free", role: "admin" } }), {}, next);
    expect(next).toHaveBeenCalled();
  });

  it("blocks a free user with no org", async () => {
    const { mw } = makeMiddleware();
    const res = makeRes();
    const next = vi.fn();
    await mw("premium")(makeReq({ currentUser: { package: "free" } }), res, next);
    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe("PREMIUM_REQUIRED");
    expect(next).not.toHaveBeenCalled();
  });

  it("allows a member of a pro org", async () => {
    const { mw } = makeMiddleware({
      getCachedOrgMembership: vi.fn(async () => true),
      getCachedOrg: vi.fn(async () => ({ plan: "pro" })),
    });
    const next = vi.fn();
    const req = makeReq({ currentUser: { package: "free" }, headers: { "x-org-id": "org1" } });
    await mw("premium")(req, {}, next);
    expect(next).toHaveBeenCalled();
  });

  it("blocks a member of a non-pro org", async () => {
    const { mw } = makeMiddleware({
      getCachedOrgMembership: vi.fn(async () => true),
      getCachedOrg: vi.fn(async () => ({ plan: "free" })),
    });
    const res = makeRes();
    const next = vi.fn();
    const req = makeReq({ currentUser: { package: "free" }, headers: { "x-org-id": "org1" } });
    await mw("premium")(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("blocks a free user who is not an org member", async () => {
    const { mw } = makeMiddleware({ getCachedOrgMembership: vi.fn(async () => false) });
    const res = makeRes();
    const next = vi.fn();
    const req = makeReq({ currentUser: { package: "free" }, headers: { "x-org-id": "org1" } });
    await mw("premium")(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("swallows errors and allows the request", async () => {
    const { mw } = makeMiddleware({ getFeatureConfig: vi.fn(async () => { throw new Error("boom"); }) });
    const next = vi.fn();
    await mw("premium")(makeReq(), {}, next);
    expect(next).toHaveBeenCalled();
  });
});

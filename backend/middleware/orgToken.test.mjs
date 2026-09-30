import { describe, it, expect, vi } from "vitest";
import orgToken from "./orgToken.js";

const { resolveOrgToken } = orgToken;

function makeDb(orgChannelDoc) {
  // Recursive fake covering collection().doc().collection().doc().get()
  const node = () => ({
    collection: () => node(),
    doc: () => node(),
    where: () => node(),
    limit: () => node(),
    get: async () => orgChannelDoc,
  });
  return node();
}

function makeMw({ orgChannelDoc, refreshResponse, axiosPost } = {}) {
  const getCachedOrgMembership = vi.fn(async () => false);
  const db = makeDb(orgChannelDoc ?? null);
  const post = axiosPost || vi.fn(async () => refreshResponse);
  const axiosInstance = { post };
  const mw = resolveOrgToken(getCachedOrgMembership, { db, axiosInstance })("channelId");
  return { mw, getCachedOrgMembership, axiosInstance };
}

function makeReq({ orgId, authUser, channelId, authorization }) {
  const req = { headers: { authorization }, params: {}, authUser };
  if (orgId !== undefined) req.headers["x-org-id"] = orgId;
  if (channelId !== undefined) req.params.channelId = channelId;
  return req;
}

function freshOrgDoc(token) {
  return {
    exists: true,
    data: () => ({ accessToken: token, refreshToken: "rt", expiresAt: Date.now() + 60 * 60 * 1000 }),
    ref: { set: vi.fn(async () => {}) },
  };
}

describe("resolveOrgToken", () => {
  it("passes through when X-Org-Id is absent", async () => {
    const { mw } = makeMw();
    const req = makeReq({ authUser: { uid: "u1" }, authorization: "Bearer personal" });
    const next = vi.fn();
    await mw(req, {}, next);
    expect(req.headers.authorization).toBe("Bearer personal");
    expect(next).toHaveBeenCalled();
  });

  it("passes through when the requester is not an org member", async () => {
    const { mw, getCachedOrgMembership } = makeMw();
    getCachedOrgMembership.mockResolvedValueOnce(false);
    const req = makeReq({ orgId: "org1", authUser: { uid: "u1" }, channelId: "c1", authorization: "Bearer personal" });
    const next = vi.fn();
    await mw(req, {}, next);
    expect(req.headers.authorization).toBe("Bearer personal");
    expect(next).toHaveBeenCalled();
  });

  it("passes through when no channel id is present", async () => {
    const { mw, getCachedOrgMembership } = makeMw();
    getCachedOrgMembership.mockResolvedValueOnce(true);
    const req = makeReq({ orgId: "org1", authUser: { uid: "u1" }, authorization: "Bearer personal" });
    const next = vi.fn();
    await mw(req, {}, next);
    expect(req.headers.authorization).toBe("Bearer personal");
    expect(next).toHaveBeenCalled();
  });

  it("passes through when the org channel doc does not exist", async () => {
    const { mw, getCachedOrgMembership } = makeMw({ orgChannelDoc: { exists: false } });
    getCachedOrgMembership.mockResolvedValueOnce(true);
    const req = makeReq({ orgId: "org1", authUser: { uid: "u1" }, channelId: "c1", authorization: "Bearer personal" });
    const next = vi.fn();
    await mw(req, {}, next);
    expect(req.headers.authorization).toBe("Bearer personal");
    expect(next).toHaveBeenCalled();
  });

  it("overrides Authorization with the org token for a verified member", async () => {
    const { mw, getCachedOrgMembership } = makeMw({ orgChannelDoc: freshOrgDoc("org-access-token") });
    getCachedOrgMembership.mockResolvedValueOnce(true);
    const req = makeReq({ orgId: "org1", authUser: { uid: "u1" }, channelId: "c1", authorization: "Bearer personal" });
    const next = vi.fn();
    await mw(req, {}, next);
    expect(req.headers.authorization).toBe("Bearer org-access-token");
    expect(req._orgTokenResolved).toBe(true);
    expect(next).toHaveBeenCalled();
  });

  it("refreshes an expiring org token and persists the new one", async () => {
    const expiringDoc = {
      exists: true,
      data: () => ({ accessToken: "stale", refreshToken: "rt", expiresAt: Date.now() + 1000 }),
      ref: { set: vi.fn(async () => {}) },
    };
    const { mw, getCachedOrgMembership, axiosInstance } = makeMw({
      orgChannelDoc: expiringDoc,
      refreshResponse: { data: { access_token: "fresh-token", expires_in: 3600 } },
    });
    getCachedOrgMembership.mockResolvedValueOnce(true);
    const req = makeReq({ orgId: "org1", authUser: { uid: "u1" }, channelId: "c1", authorization: "Bearer personal" });
    const next = vi.fn();
    await mw(req, {}, next);
    expect(axiosInstance.post).toHaveBeenCalled();
    expect(req.headers.authorization).toBe("Bearer fresh-token");
    expect(expiringDoc.ref.set).toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it("keeps the personal token when the refresh fails", async () => {
    const expiringDoc = {
      exists: true,
      data: () => ({ accessToken: "stale", refreshToken: "rt", expiresAt: Date.now() + 1000 }),
      ref: { set: vi.fn(async () => {}) },
    };
    const { mw, getCachedOrgMembership } = makeMw({
      orgChannelDoc: expiringDoc,
      axiosPost: vi.fn(async () => {
        throw new Error("refresh failed");
      }),
    });
    getCachedOrgMembership.mockResolvedValueOnce(true);
    const req = makeReq({ orgId: "org1", authUser: { uid: "u1" }, channelId: "c1", authorization: "Bearer personal" });
    const next = vi.fn();
    await mw(req, {}, next);
    expect(req.headers.authorization).toBe("Bearer personal");
    expect(next).toHaveBeenCalled();
  });
});

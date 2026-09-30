import { describe, it, expect, vi } from "vitest";
import { requireOrgWrite } from "./orgRole.js";

function makeMw(membership) {
  const getCachedOrgMembership = vi.fn().mockResolvedValue(membership);
  const mw = requireOrgWrite(getCachedOrgMembership);
  return { mw, getCachedOrgMembership };
}

async function call(mw, { method, xOrgId, uid = "u1" }) {
  const req = {
    method,
    headers: xOrgId ? { "x-org-id": xOrgId } : {},
    authUser: { uid },
  };
  let nextCalled = false;
  const next = () => {
    nextCalled = true;
  };
  const res = {
    statusCode: 200,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json() {
      return this;
    },
  };
  await mw(req, res, next);
  return { nextCalled, statusCode: res.statusCode };
}

describe("requireOrgWrite", () => {
  it("passes through non-org (personal) requests regardless of method", async () => {
    const { mw } = makeMw({ isMember: true, role: "write" });
    const out = await call(mw, { method: "POST", xOrgId: null });
    expect(out.nextCalled).toBe(true);
  });

  it("allows read-only members to issue safe GET requests", async () => {
    const { mw } = makeMw({ isMember: true, role: "read" });
    const out = await call(mw, { method: "GET", xOrgId: "org1" });
    expect(out.nextCalled).toBe(true);
    expect(out.statusCode).toBe(200);
  });

  it("blocks read-only members from POSTing (running audits)", async () => {
    const { mw, getCachedOrgMembership } = makeMw({ isMember: true, role: "read" });
    const out = await call(mw, { method: "POST", xOrgId: "org1" });
    expect(out.nextCalled).toBe(false);
    expect(out.statusCode).toBe(403);
    expect(getCachedOrgMembership).toHaveBeenCalledWith("org1", "u1");
  });

  it("blocks read-only members from PATCH (rename) and DELETE (delete history)", async () => {
    const { mw } = makeMw({ isMember: true, role: "read" });
    expect((await call(mw, { method: "PATCH", xOrgId: "org1" })).nextCalled).toBe(false);
    expect((await call(mw, { method: "DELETE", xOrgId: "org1" })).nextCalled).toBe(false);
  });

  it("allows writers/owners/admins to mutate in org scope", async () => {
    for (const role of ["write", "admin", "owner"]) {
      const { mw } = makeMw({ isMember: true, role });
      const out = await call(mw, { method: "POST", xOrgId: "org1" });
      expect(out.nextCalled).toBe(true);
    }
  });

  it("passes through non-members untouched", async () => {
    const { mw } = makeMw(null);
    const out = await call(mw, { method: "DELETE", xOrgId: "org1" });
    expect(out.nextCalled).toBe(true);
  });
});
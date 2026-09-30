import { describe, it, expect, vi } from "vitest";
import auth from "./auth.js";

const { authenticateRequest, checkAdmin, resolveUser } = auth;

function makeDb(userDocs) {
  return {
    collection: () => ({
      where: () => ({ limit: () => ({ get: async () => userDocs }) }),
    }),
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

describe("authenticateRequest", () => {
  const verifyIdToken = vi.fn();
  const admin = { auth: () => ({ verifyIdToken }) };

  it("returns 401 when the header is missing", async () => {
    const next = vi.fn();
    const res = makeRes();
    await authenticateRequest(admin)({ headers: {} }, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when the token has no email claim", async () => {
    admin.auth().verifyIdToken.mockResolvedValueOnce({ uid: "u1" });
    const next = vi.fn();
    const res = makeRes();
    await authenticateRequest(admin)({ headers: { "x-firebase-token": "tok" } }, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("sets req.authUser and calls next for a valid token", async () => {
    admin.auth().verifyIdToken.mockResolvedValueOnce({ uid: "u1", email: "a@b.com" });
    const req = { headers: { "x-firebase-token": "tok" } };
    const res = makeRes();
    const next = vi.fn();
    await authenticateRequest(admin)(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.authUser.email).toBe("a@b.com");
    expect(req.authUser.uid).toBe("u1");
  });

  it("returns 401 when token verification fails", async () => {
    admin.auth().verifyIdToken.mockRejectedValueOnce(new Error("bad token"));
    const next = vi.fn();
    const res = makeRes();
    await authenticateRequest(admin)({ headers: { "x-firebase-token": "tok" } }, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("checkAdmin", () => {
  const upsert = vi.fn(async () => {});

  it("returns 401 without an authenticated user email", async () => {
    const next = vi.fn();
    const res = makeRes();
    await checkAdmin(vi.fn(), upsert)({ authUser: {} }, res, next);
    expect(res.statusCode).toBe(401);
  });

  it("allows the support email as admin", async () => {
    const req = { authUser: { email: "support@revketer.ai" } };
    const next = vi.fn();
    await checkAdmin(vi.fn(), upsert)(req, {}, next);
    expect(next).toHaveBeenCalled();
    expect(req.adminUser.role).toBe("admin");
  });

  it("allows a user with the admin role in the pg source", async () => {
    const getUserAccessByEmail = vi.fn(async () => ({ email: "a@b.com", role: "admin" }));
    const req = { authUser: { email: "a@b.com" } };
    const next = vi.fn();
    await checkAdmin(getUserAccessByEmail, upsert)(req, {}, next);
    expect(next).toHaveBeenCalled();
    expect(req.adminUser.role).toBe("admin");
  });

  it("forbids a non-admin user", async () => {
    const getUserAccessByEmail = vi.fn(async () => ({ email: "a@b.com", role: "user" }));
    const res = makeRes();
    const next = vi.fn();
    await checkAdmin(getUserAccessByEmail, upsert, makeDb({ empty: true }))({ authUser: { email: "a@b.com" } }, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows a firestore admin and upserts their access", async () => {
    const getUserAccessByEmail = vi.fn(async () => null);
    const userDocs = {
      empty: false,
      docs: [{ data: () => ({ uid: "u2", email: "a@b.com", role: "admin", package: "pro" }) }],
    };
    const req = { authUser: { email: "a@b.com", uid: "u1" } };
    const res = makeRes();
    const next = vi.fn();
    await checkAdmin(getUserAccessByEmail, upsert, makeDb(userDocs))(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ email: "a@b.com", role: "admin", source: "firestore-fallback" }),
    );
  });
});

describe("resolveUser", () => {
  it("returns 401 without an authenticated user email", async () => {
    const res = makeRes();
    const next = vi.fn();
    await resolveUser(vi.fn())({ authUser: {} }, res, next);
    expect(res.statusCode).toBe(401);
  });

  it("attaches the cached user to req.currentUser", async () => {
    const getCachedUser = vi.fn(async () => ({ email: "a@b.com", package: "pro" }));
    const req = { authUser: { email: "a@b.com" } };
    const next = vi.fn();
    await resolveUser(getCachedUser)(req, {}, next);
    expect(next).toHaveBeenCalled();
    expect(getCachedUser).toHaveBeenCalledWith("a@b.com");
    expect(req.currentUser.package).toBe("pro");
  });
});

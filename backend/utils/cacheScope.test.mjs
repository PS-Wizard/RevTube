import { describe, it, expect } from "vitest";
import cacheScope from "./cacheScope.js";

const {
  shortHash,
  sanitizeCacheSegment,
  youtubeDataScope,
  dashboardScope,
  YT_DATA_CACHE_TTL_MS,
  OAUTH_TOKEN_CACHE_TTL_MS,
} = cacheScope;

describe("sanitizeCacheSegment", () => {
  it("returns 'inv' for null/undefined", () => {
    expect(sanitizeCacheSegment(null)).toBe("inv");
    expect(sanitizeCacheSegment(undefined)).toBe("inv");
  });

  it("strips cache-key injection characters (colons and control chars)", () => {
    expect(sanitizeCacheSegment("a:b")).toBe("ab");
    expect(sanitizeCacheSegment("a\nb\x00c")).toBe("abc");
    expect(sanitizeCacheSegment(":")).toBe("inv");
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeCacheSegment("  user@example.com  ")).toBe("user@example.com");
  });

  it("caps segment length at 120 chars to prevent key-bloat", () => {
    const long = "x".repeat(500);
    expect(sanitizeCacheSegment(long).length).toBe(120);
  });

  it("returns 'inv' when only invalid characters remain", () => {
    expect(sanitizeCacheSegment("\x00\x1f")).toBe("inv");
  });
});

describe("shortHash", () => {
  it("produces a stable 20-char hex digest", () => {
    const a = shortHash("secret-token");
    const b = shortHash("secret-token");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{20}$/);
  });

  it("never stores the raw token in the hash output", () => {
    expect(shortHash("secret-token")).not.toContain("secret-token");
  });
});

describe("youtubeDataScope", () => {
  it("returns pub when there is no bearer auth", () => {
    expect(youtubeDataScope({}, false)).toBe("pub");
  });

  it("scopes to the authenticated user email", () => {
    const req = { authUser: { email: "a@b.com" }, headers: {} };
    expect(youtubeDataScope(req, true)).toBe("u:a@b.com");
  });

  it("scopes to a token hash when no email is present", () => {
    const req = { authUser: {}, headers: { authorization: "Bearer tok" } };
    const scope = youtubeDataScope(req, true);
    expect(scope).toMatch(/^t:[0-9a-f]{20}$/);
  });
});

describe("dashboardScope", () => {
  it("prefers org scope over user email (prevents cross-org leakage)", () => {
    const req = { headers: { "x-org-id": "org1" }, authUser: { email: "a@b.com" } };
    expect(dashboardScope(req, {})).toBe("org:org1");
  });

  it("includes channelId in the org scope when present", () => {
    const req = { headers: { "x-org-id": "org1" } };
    expect(dashboardScope(req, { channelId: "chan1" })).toBe("org:org1:chan1");
  });

  it("sanitizes org id and channel id segments in the key", () => {
    const req = { headers: { "x-org-id": "org:1\n" } };
    expect(dashboardScope(req, { channelId: "ch:an" })).toBe("org:org1:chan");
  });

  it("accepts an explicit orgId argument over the header", () => {
    const req = { headers: {} };
    expect(dashboardScope(req, { orgId: "org2", channelId: "c2" })).toBe("org:org2:c2");
  });

  it("scopes to the user email when no org context exists", () => {
    const req = { headers: {}, authUser: { email: "a@b.com" } };
    expect(dashboardScope(req, {})).toBe("u:a@b.com");
  });

  it("scopes to an anon token hash when authenticated without email", () => {
    const req = { headers: { authorization: "Bearer tok" }, authUser: {} };
    expect(dashboardScope(req, {})).toMatch(/^anon:[0-9a-f]{20}$/);
  });

  it("falls back to pub for fully unauthenticated requests", () => {
    expect(dashboardScope({ headers: {} }, {})).toBe("pub");
  });
});

describe("cache TTL constants", () => {
  it("defines expected YouTube data TTLs", () => {
    expect(YT_DATA_CACHE_TTL_MS.CHANNEL).toBe(4 * 60 * 60 * 1000);
    expect(YT_DATA_CACHE_TTL_MS.PLAYLISTS).toBe(2 * 60 * 60 * 1000);
    expect(YT_DATA_CACHE_TTL_MS.VIDEOS).toBe(25 * 60 * 1000);
    // YouTube Analytics daily reports only advance once/day (~1-2 day lag), so
    // a cached report stays valid for hours -- kept at 6h to avoid needless
    // re-queries of the YouTube Analytics API on every navigation.
    expect(YT_DATA_CACHE_TTL_MS.ANALYTICS_REPORT).toBe(6 * 60 * 60 * 1000);
  });

  it("defines an OAuth token TTL of 55 minutes", () => {
    expect(OAUTH_TOKEN_CACHE_TTL_MS).toBe(55 * 60 * 1000);
  });
});

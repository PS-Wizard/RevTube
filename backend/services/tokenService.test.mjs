import { describe, it, expect, vi } from "vitest";
import ServerCache from "../cache/ServerCache.js";
import cacheScope from "../utils/cacheScope.js";
import tokenService from "./tokenService.js";

const { shortHash, OAUTH_TOKEN_CACHE_TTL_MS } = cacheScope;
const { createTokenService } = tokenService;

function makeService() {
  delete process.env.REDIS_URL; // in-memory cache
  const serverCache = new ServerCache();
  const axiosMock = { post: vi.fn() };
  const service = createTokenService({ serverCache, shortHash, OAUTH_TOKEN_CACHE_TTL_MS, axios: axiosMock });
  return { service, serverCache, axiosMock };
}

describe("refreshGoogleToken", () => {
  it("throws when the refresh token is missing", async () => {
    const { service } = makeService();
    await expect(service.refreshGoogleToken(null)).rejects.toThrow("Missing refresh token");
    await expect(service.refreshGoogleToken("")).rejects.toThrow("Missing refresh token");
  });

  it("returns a cached token without calling the API", async () => {
    const { service, serverCache, axiosMock } = makeService();
    await serverCache.set(`oauth:token:${shortHash("rt")}`, "cached-token", 1000);
    const token = await service.refreshGoogleToken("rt");
    expect(token).toBe("cached-token");
    expect(axiosMock.post).not.toHaveBeenCalled();
  });

  it("refreshes via the token endpoint and caches the result", async () => {
    const { service, serverCache, axiosMock } = makeService();
    axiosMock.post.mockResolvedValueOnce({ data: { access_token: "new-token", expires_in: 3600 } });
    const token = await service.refreshGoogleToken("rt");
    expect(token).toBe("new-token");
    expect(axiosMock.post).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({ refresh_token: "rt", grant_type: "refresh_token" }),
      expect.anything(),
    );
    expect(await serverCache.get(`oauth:token:${shortHash("rt")}`)).toBe("new-token");
  });

  it("throws a specific error when the refresh response carries an invalid_grant body", async () => {
    const { service, axiosMock } = makeService();
    axiosMock.post.mockRejectedValueOnce({
      response: { status: 400, data: { error: "invalid_grant" } },
    });
    await expect(service.refreshGoogleToken("rt")).rejects.toThrow("Token refresh failed");
  });

  it("rethrows the original error when the response has no body", async () => {
    const { service, axiosMock } = makeService();
    axiosMock.post.mockRejectedValueOnce(new Error("network down"));
    await expect(service.refreshGoogleToken("rt")).rejects.toThrow("network down");
  });
});

/**
 * OAuth token service -- refresh Google access tokens with caching.
 */
function createTokenService(deps) {
  const { serverCache, shortHash, OAUTH_TOKEN_CACHE_TTL_MS, axios } = deps;

  async function refreshGoogleToken(refreshToken) {
    if (!refreshToken) {
      throw new Error("Missing refresh token");
    }

    const cacheKey = `oauth:token:${shortHash(refreshToken)}`;
    const cached = await serverCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const clientId = process.env.YOUTUBE_CLIENT_ID;
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      console.error("[refreshGoogleToken] Missing YOUTUBE_CLIENT_ID or YOUTUBE_CLIENT_SECRET");
    }

    let response;
    try {
      response = await axios.post(
        "https://oauth2.googleapis.com/token",
        {
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        },
        { timeout: 10000 },
      );
    } catch (err) {
      const body = err?.response?.data ? JSON.stringify(err.response.data) : '';
      if (body) {
        // invalid_grant means the refresh token is expired or revoked -- the user
        // must re-authorize YouTube to get a fresh one.
        console.error(`[refreshGoogleToken] Failed: ${body}`);
        // Clear the cached token so we don't keep retrying a dead one
        await serverCache.delete(cacheKey).catch(() => {});
        throw new Error(`Token refresh failed (${err.response?.status}): ${body}`);
      }
      throw err;
    }

    const accessToken = response.data.access_token;
    if (accessToken) {
      await serverCache.set(cacheKey, accessToken, OAUTH_TOKEN_CACHE_TTL_MS);
    }
    return accessToken;
  }

  return { refreshGoogleToken };
}

module.exports = { createTokenService };

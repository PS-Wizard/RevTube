const express = require("express");

function createOAuthRouter(deps) {
  const {
    authenticateRequest,
    oauthLimiter,
    serverCache,
    shortHash,
    OAUTH_TOKEN_CACHE_TTL_MS,
    handleApiError,
    axios,
  } = deps;
  const router = express.Router();

  const YOUTUBE_CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
  const YOUTUBE_CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;

  /**
   * Server-side redirect-URI allowlist (defense-in-depth). Google's token
   * endpoint already requires redirect_uri to exactly match the auth request
   * AND to be registered on the OAuth client — but the client should not be
   * part of the trust chain, so the backend only forwards allow-listed values.
   * YOUTUBE_OAUTH_REDIRECT_URIS (comma-separated) adds extra hosts;
   * VITE_FRONTEND_URL is always implied; loopback http stays allowed for dev.
   *
   * No production host is hardcoded here. A new deployment supplies its own
   * origins via env and registers the same URIs in the Google Cloud OAuth
   * client; no code change is involved. Covered by
   * routes/oauth.redirectAllowlist.test.mjs.
   */
  const LOOPBACK_REDIRECT_RE =
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/oauth-callback\.html$/;
  const redirectUriAllowed = (uri) => {
    if (LOOPBACK_REDIRECT_RE.test(uri)) return true;
    const allow = (process.env.YOUTUBE_OAUTH_REDIRECT_URIS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    // Extra hosts come from env only -- no production domain is hardcoded.
    // YOUTUBE_OAUTH_REDIRECT_URIS takes precedence; VITE_FRONTEND_URL is
    // always implied, and is the same var CORS honours in index.js.
    if (process.env.VITE_FRONTEND_URL) {
      allow.push(
        `${process.env.VITE_FRONTEND_URL.replace(/\/+$/, "")}/oauth-callback.html`,
      );
    }
    // A malformed entry (e.g. a doubled scheme such as "https://https://host")
    // would otherwise sit in the list and silently never match, which is how a
    // real deploy ends up rejecting its own callback. Warn loudly instead.
    allow.forEach((entry) => {
      if (/^https?:\/\/https?:\/\//i.test(entry)) {
        console.warn(
          `[OAuth Exchange] Malformed redirect URI (doubled scheme?) in YOUTUBE_OAUTH_REDIRECT_URIS / VITE_FRONTEND_URL: ${entry}`,
        );
      }
    });
    if (allow.length === 0) {
      console.warn(
        "[OAuth Exchange] YOUTUBE_OAUTH_REDIRECT_URIS / VITE_FRONTEND_URL not configured — accepting client-supplied redirectUri. Configure them to lock this down.",
      );
      return true;
    }
    return allow.includes(uri);
  };

  // POST /oauth/exchange
  router.post(
    "/exchange",
    oauthLimiter,
    authenticateRequest,
    async (req, res) => {
      try {
        const { code, redirectUri, codeVerifier } = req.body;
        if (!code || !redirectUri) {
          return res
            .status(400)
            .json({ error: { message: "Missing code or redirectUri" } });
        }
        if (!redirectUriAllowed(redirectUri)) {
          console.warn(
            `[OAuth Exchange] Rejected redirectUri outside allowlist: ${redirectUri}`,
          );
          return res
            .status(400)
            .json({ error: { message: "redirectUri not allowed" } });
        }
        console.log(
          `[OAuth Exchange] Exchanging code for tokens (redirectUri: ${redirectUri})...`,
        );

        const tokenPayload = {
          code,
          client_id: YOUTUBE_CLIENT_ID,
          client_secret: YOUTUBE_CLIENT_SECRET,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        };
        // PKCE (S256): forwarded when the auth request carried a code_challenge
        if (codeVerifier) tokenPayload.code_verifier = codeVerifier;

        const response = await axios.post(
          "https://oauth2.googleapis.com/token",
          tokenPayload,
          { timeout: 10000 },
        );

        console.log(
          "[OAuth Exchange] Success! Token expiry:",
          response.data.expires_in,
          "seconds",
        );

        if (response.data.refresh_token && response.data.access_token) {
          const cacheKey = `oauth:token:${shortHash(response.data.refresh_token)}`;
          serverCache
            .set(cacheKey, response.data.access_token, OAUTH_TOKEN_CACHE_TTL_MS)
            .catch(() => {});
          console.log("[Cache] OAuth token seeded from exchange");
        }

        res.json({
          accessToken: response.data.access_token,
          refreshToken: response.data.refresh_token,
          expiresIn: response.data.expires_in,
          tokenType: response.data.token_type,
        });
      } catch (error) {
        console.error(
          "[OAuth Exchange] Error:",
          error.response?.data || error.message,
        );
        handleApiError(error, res);
      }
    },
  );

  // POST /oauth/refresh
  router.post(
    "/refresh",
    oauthLimiter,
    authenticateRequest,
    async (req, res) => {
      try {
        const { refreshToken } = req.body;
        if (!refreshToken) {
          return res
            .status(400)
            .json({ error: { message: "Missing refreshToken" } });
        }
        console.log("[OAuth Refresh] Refreshing access token...");

        const response = await axios.post(
          "https://oauth2.googleapis.com/token",
          {
            refresh_token: refreshToken,
            client_id: YOUTUBE_CLIENT_ID,
            client_secret: YOUTUBE_CLIENT_SECRET,
            grant_type: "refresh_token",
          },
          { timeout: 10000 },
        );

        console.log(
          "[OAuth Refresh] Success! New token expiry:",
          response.data.expires_in,
          "seconds",
        );

        if (response.data.access_token) {
          const cacheKey = `oauth:token:${shortHash(refreshToken)}`;
          serverCache
            .set(cacheKey, response.data.access_token, OAUTH_TOKEN_CACHE_TTL_MS)
            .catch(() => {});
          console.log("[Cache] OAuth token seeded from refresh");
        }

        res.json({
          accessToken: response.data.access_token,
          expiresIn: response.data.expires_in,
          tokenType: response.data.token_type,
        });
      } catch (error) {
        console.error(
          "[OAuth Refresh] Error:",
          error.response?.data || error.message || "(empty error message)",
        );
        if (error.response?.data?.error === "invalid_grant") {
          return res.status(401).json({
            error: {
              message: "Refresh token expired or revoked. Please re-authorize.",
              code: "REFRESH_TOKEN_EXPIRED",
            },
          });
        }
        const oauthErr = {
          code: error.code,
          message: error.message,
          status: error.response?.status,
          data: error.response?.data,
          errno: error.errno,
          syscall: error.syscall,
        };
        console.error("[OAuth Refresh] Details:", JSON.stringify(oauthErr));
        const status = error.response?.status || 502;
        const msg =
          error.response?.data?.error_description ||
          error.message ||
          "Failed to refresh access token.";
        return res
          .status(status)
          .json({ error: { message: msg, code: "TOKEN_REFRESH_FAILED" } });
      }
    },
  );

  return router;
}

module.exports = { createOAuthRouter };

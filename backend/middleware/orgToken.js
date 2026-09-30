/**
 * Middleware: resolveOrgToken(channelIdSource)
 *
 * Resolves the YouTube OAuth token from the org channel document in Firestore.
 * Overrides req.headers.authorization so all downstream handlers use the org token.
 *
 * Only fires when X-Org-Id is present AND the requester is a verified org member.
 *
 * @param {string|function} channelIdSource
 *   string  -- req.params key (e.g. 'channelId')
 *   function(req) => channelId | null  -- for body/query-based channel IDs
 */
function resolveOrgToken(getCachedOrgMembership, { db, axiosInstance } = {}) {
  return (channelIdSource) =>
    async (req, res, next) => {
      if (req._orgTokenResolved) return next();

      const orgId = req.headers["x-org-id"];
      if (!orgId) return next();

      const requestingUid = req.authUser?.uid;
      if (!requestingUid) return next();

      try {
        const isMember = await getCachedOrgMembership(String(orgId), requestingUid);
        if (!isMember) return next();

        const channelId =
          typeof channelIdSource === "function"
            ? channelIdSource(req)
            : req.params[channelIdSource];
        if (!channelId) return next();

        const firestoreDb = db || require("firebase-admin").firestore();
        const orgChannelDoc = await firestoreDb
          .collection("organizations")
          .doc(String(orgId))
          .collection("channels")
          .doc(channelId)
          .get();

        if (!orgChannelDoc.exists) return next();

        const orgChannel = orgChannelDoc.data();
        let orgAccessToken = orgChannel?.accessToken;
        const orgRefreshToken = orgChannel?.refreshToken;
        const expiresAt = orgChannel?.expiresAt || 0;
        let refreshAttempted = false;

        if (orgRefreshToken && Date.now() >= expiresAt - 5 * 60 * 1000) {
          refreshAttempted = true;
          try {
            const httpClient = axiosInstance || require("axios");
            const refreshRes = await httpClient.post(
              "https://oauth2.googleapis.com/token",
              {
                refresh_token: orgRefreshToken,
                client_id: process.env.YOUTUBE_CLIENT_ID || "",
                client_secret: process.env.YOUTUBE_CLIENT_SECRET || "",
                grant_type: "refresh_token",
              },
              { timeout: 10000 },
            );
            orgAccessToken = refreshRes.data.access_token;
            const newExpiresAt =
              Date.now() + (refreshRes.data.expires_in || 3600) * 1000;
            orgChannelDoc.ref
              .set({ accessToken: orgAccessToken, expiresAt: newExpiresAt }, { merge: true })
              .catch((err) =>
                console.warn("[resolveOrgToken] Failed to persist refreshed token:", err.message),
              );
          } catch (err) {
            console.warn("[resolveOrgToken] Token refresh failed:", err.message);
            // Refresh failed -- don't use the stale token. Let the personal token
            // from the original Authorization header pass through instead.
            orgAccessToken = null;
          }
        }

        if (orgAccessToken) {
          req.headers.authorization = `Bearer ${orgAccessToken}`;
          req._orgTokenResolved = true;
          req._orgRefreshToken = orgRefreshToken || null;
        } else if (refreshAttempted) {
          console.warn(`[resolveOrgToken] Skipping org token override for ${channelId} -- refresh failed, using personal token`);
        }
      } catch (err) {
        console.warn("[resolveOrgToken] Error:", err.message);
      }

      next();
    };
}

module.exports = { resolveOrgToken };

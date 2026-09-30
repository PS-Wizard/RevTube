const express = require("express");

function createChannelVideosRouter(deps) {
  const {
    resolveUser, resolveOrgToken, analyticsReadLimiter,
    checkPremiumAccess, requireQuota, consumeQuota,
    generateChannelVideos, getCachedOrgMembership, serverCache,
    handleApiError, axios, shortHash,
    PERF_LOG_ENABLED, YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET,
  } = deps;
  const router = express.Router();

  router.get(
    "/:channelId",
    analyticsReadLimiter,
    resolveUser,
    resolveOrgToken("channelId"),
    checkPremiumAccess("videos"),
    requireQuota("videos"),
    async (req, res) => {
      try {
        const authHeader = req.headers.authorization;
        let accessToken = authHeader && authHeader.startsWith("Bearer ") ? authHeader : null;

        const { channelId } = req.params;
        const orgId = req.headers["x-org-id"];
        let resolvedOrgRefreshToken = null;

        if (orgId && !req._orgTokenResolved) {
          const requestingUid = req.authUser?.uid;
          const isMember = await getCachedOrgMembership(String(orgId), requestingUid);
          if (!isMember) {
            console.warn(`[channel-videos] Rejected org token use: uid=${requestingUid} is not a member of org=${orgId}`);
            return res.status(403).json({
              error: { message: "You are not a member of this organization." },
            });
          }

          try {
            const admin = require("firebase-admin");
            const db = admin.firestore();
            const orgChannelDoc = await db
              .collection("organizations")
              .doc(String(orgId))
              .collection("channels")
              .doc(channelId)
              .get();

            if (orgChannelDoc.exists) {
              const orgChannel = orgChannelDoc.data();
              let orgAccessToken = orgChannel?.accessToken;
              const orgRefreshToken = orgChannel?.refreshToken;
              resolvedOrgRefreshToken = orgRefreshToken || null;
              const expiresAt = orgChannel?.expiresAt || 0;

              if (PERF_LOG_ENABLED) {
                console.log(
                  `[channel-videos] Org channel doc found: hasAccessToken=${!!orgAccessToken}, hasRefreshToken=${!!orgRefreshToken}, isExpired=${Date.now() >= expiresAt - 5 * 60 * 1000}`,
                );
              }

              if (orgRefreshToken && Date.now() >= expiresAt - 5 * 60 * 1000) {
                try {
                  if (PERF_LOG_ENABLED)
                    console.log(`[channel-videos] Refreshing org channel token for channel=${channelId}`);
                  const refreshRes = await axios.post(
                    "https://oauth2.googleapis.com/token",
                    {
                      refresh_token: orgRefreshToken,
                      client_id: YOUTUBE_CLIENT_ID,
                      client_secret: YOUTUBE_CLIENT_SECRET,
                      grant_type: "refresh_token",
                    },
                    { timeout: 10000 },
                  );
                  orgAccessToken = refreshRes.data.access_token;
                  const newExpiresAt = Date.now() + (refreshRes.data.expires_in || 3600) * 1000;
                  if (PERF_LOG_ENABLED) console.log(`[channel-videos] Org token refreshed successfully`);
                  orgChannelDoc.ref
                    .set({ accessToken: orgAccessToken, expiresAt: newExpiresAt }, { merge: true })
                    .catch((err) =>
                      console.warn("[channel-videos] Failed to persist refreshed org token:", err.message),
                    );
                } catch (err) {
                  console.warn("[channel-videos] Org token refresh failed, falling back to request token:", err.message);
                }
              }

              if (orgAccessToken) {
                if (PERF_LOG_ENABLED) console.log(`[channel-videos] Using org channel token for channel=${channelId}`);
                accessToken = `Bearer ${orgAccessToken}`;
              } else {
                console.warn(`[channel-videos] Org channel doc exists but no usable token for channel=${channelId}, falling back to request token`);
              }
            } else {
              console.warn(`[channel-videos] Org channel doc NOT found: org=${orgId}, channel=${channelId} -- falling back to request token`);
            }
          } catch (err) {
            console.warn("[channel-videos] Failed to resolve org channel token, using request token:", err.message);
          }
        } else if (orgId && req._orgTokenResolved) {
          resolvedOrgRefreshToken = req._orgRefreshToken || null;
        }

        const limitParam = req.query.limit;
        const limit = limitParam === "all" ? undefined : Math.max(1, parseInt(limitParam) || 50);
        // Exact status filter from the frontend (?privacy=public|private|unlisted|all).
        const rawPrivacy = typeof req.query.privacy === "string" ? req.query.privacy.toLowerCase() : null;
        const privacy = ["public", "private", "unlisted", "all"].includes(rawPrivacy)
          ? rawPrivacy
          : (req.query.includePrivate === "1" ? "all" : "public");
        // ?topUp=1 -- picker requests keep serving the server cache (fast, near-
        // free) but the list is topped up with the newest uploads page so
        // brand-new public uploads appear immediately.
        const topUp = req.query.topUp === "1";

        let responseData;
        try {
          const effectiveCacheScope =
            orgId && resolvedOrgRefreshToken
              ? `org:${String(orgId)}:${channelId}`
              : req.authUser?.email || (accessToken ? shortHash(accessToken) : "public");

          responseData = await generateChannelVideos({
            channelId,
            maxResults: limit,
            accessToken,
            cacheScope: effectiveCacheScope,
            orgRefreshToken: resolvedOrgRefreshToken,
            req,
            privacy,
            topUp,
          });
        } catch (err) {
          if (err.response?.status === 429) {
            return res.status(429).json({
              error: { code: "LIMIT_EXCEEDED", message: "YouTube API limit exceeded" },
            });
          }
          throw err;
        }

        await consumeQuota(req);
        const channelVideosData = typeof limit === "number" ? responseData.slice(0, limit) : responseData;
        res.json({ items: channelVideosData });
      } catch (error) {
        console.error("[Channel Videos] Error:", error.response?.data || error.message);
        handleApiError(error, res);
      }
    },
  );

  return router;
}

module.exports = { createChannelVideosRouter };

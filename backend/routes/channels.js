const express = require("express");

function createChannelsRouter(deps) {
  const {
    resolveUser, resolveOrgToken,
    checkPremiumAccess, requireQuota, consumeQuota,
    youtubeDataScope, YT_DATA_CACHE_TTL_MS, serverCache, handleApiError, axios, API_KEY, YOUTUBE_API_BASE,
    query, deleteDashboardSnapshots,
  } = deps;
  const router = express.Router();

  // Cleanup channel data -- called when user removes a channel (personal or org).
  // Deletes PostgreSQL analytics + Redis cache entries for the channel.
  // Firestore doc deletion is handled by the frontend (personal token or org channel doc).
  router.post(
    "/cleanup",
    resolveUser,
    async (req, res) => {
      try {
        const { channelId } = req.body;
        if (!channelId) {
          return res.status(400).json({ error: { message: "Missing channelId" } });
        }

        const cleaned = { postgres: 0, redis: 0, snapshots: 0 };

        // 1. Delete from analytics_channels (CASCADE deletes videos + daily metrics)
        if (typeof query === "function") {
          try {
            const pgResult = await query(
              `DELETE FROM analytics_channels WHERE channel_id = $1`,
              [channelId]
            );
            cleaned.postgres = pgResult?.rowCount || 0;
            if (cleaned.postgres > 0) {
              console.log(`[Channel Cleanup] Deleted ${cleaned.postgres} analytics_channels row(s) for ${channelId}`);
            }
          } catch (pgErr) {
            console.warn(`[Channel Cleanup] Postgres delete failed for ${channelId}:`, pgErr.message);
          }
        }

        // 2. Delete dashboard snapshots
        if (typeof deleteDashboardSnapshots === "function") {
          cleaned.snapshots = await deleteDashboardSnapshots(channelId);
        }

        // 3. Delete Redis / in-memory cache entries containing the channel ID
        const cacheDeleted = await serverCache.deleteKeysContaining(channelId);
        cleaned.redis = cacheDeleted || 0;

        console.log(`[Channel Cleanup] Cleaned channel ${channelId}:`, cleaned);
        res.json({ success: true, cleaned });
      } catch (error) {
        console.error("[Channel Cleanup] Error:", error);
        handleApiError(error, res);
      }
    },
  );

  // Get Channel by Username
  router.get(
    "/username/:username",
    resolveUser, checkPremiumAccess("channel"), requireQuota("channel"),
    async (req, res) => {
      try {
        const { username } = req.params;
        const authHeader = req.headers.authorization;
        const scope = youtubeDataScope(req, !!authHeader);
        const cacheKey = `yt:ch:user:${scope}:${String(username).toLowerCase()}`;
        const cached = await serverCache.get(cacheKey);
        if (cached) return res.json(cached);

        const params = { part: "snippet,contentDetails,statistics,brandingSettings,status", forUsername: username };
        const config = { params };
        if (authHeader) {
          config.headers = { Authorization: authHeader };
        } else {
          params.key = API_KEY;
        }

        const response = await axios.get(`${YOUTUBE_API_BASE}/channels`, config);
        await consumeQuota(req, { billable: true });
        if (response.data?.items?.length > 0) {
          await serverCache.set(cacheKey, response.data, YT_DATA_CACHE_TTL_MS.CHANNEL);
        }
        res.json(response.data);
      } catch (error) {
        handleApiError(error, res);
      }
    },
  );

  // Get Channel by ID
  router.get(
    "/id/:id",
    resolveUser, resolveOrgToken("id"), checkPremiumAccess("channel"), requireQuota("channel"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const authHeader = req.headers.authorization;
        const scope = youtubeDataScope(req, !!authHeader);
        const cacheKey = `yt:ch:id:${scope}:${id}`;
        const cached = await serverCache.get(cacheKey);
        if (cached && req.query.includeTrailer !== "true") return res.json(cached);

        const params = { part: "snippet,contentDetails,statistics,brandingSettings,status", id };
        const config = { params };
        if (authHeader) {
          config.headers = { Authorization: authHeader };
        } else {
          params.key = API_KEY;
        }

        const response = await axios.get(`${YOUTUBE_API_BASE}/channels`, config);
        await consumeQuota(req, { billable: true });

        const channelData = response.data;
        if (channelData?.items?.length > 0) {
          await serverCache.set(cacheKey, channelData, YT_DATA_CACHE_TTL_MS.CHANNEL);
        }

        // If includeTrailer=true, also fetch the trailer/unsubscribe video details
        if (req.query.includeTrailer === "true") {
          const trailerId = channelData?.items?.[0]?.brandingSettings?.channel?.unsubscribedTrailer;
          let trailerVideo = null;
          if (trailerId) {
            try {
              const trailerParams = { part: "snippet,statistics,contentDetails", id: trailerId };
              const trailerConfig = { params: trailerParams };
              if (authHeader) {
                trailerConfig.headers = { Authorization: authHeader };
              } else {
                trailerParams.key = API_KEY;
              }
              const trailerResponse = await axios.get(`${YOUTUBE_API_BASE}/videos`, trailerConfig);
              trailerVideo = trailerResponse.data;
            } catch (trailerErr) {
              console.warn(`[Channel] Failed to fetch trailer video ${trailerId}:`, trailerErr.message);
            }
          }
          return res.json({ channel: channelData, trailerVideo });
        }

        res.json(channelData);
      } catch (error) {
        handleApiError(error, res);
      }
    },
  );

  // Get Channel by Handle
  router.get(
    "/handle/:handle",
    resolveUser, checkPremiumAccess("channel"), requireQuota("channel"),
    async (req, res) => {
      try {
        const { handle } = req.params;
        const cleanHandle = String(handle).replace(/^@+/, "");
        const authHeader = req.headers.authorization;
        const scope = youtubeDataScope(req, !!authHeader);
        const cacheKey = `yt:ch:handle:${scope}:${cleanHandle.toLowerCase()}`;
        const cached = await serverCache.get(cacheKey);
        if (cached && req.query.includeTrailer !== "true") return res.json(cached);

        const params = { part: "snippet,contentDetails,statistics,brandingSettings,status", forHandle: cleanHandle };
        const config = { params };
        if (authHeader) {
          config.headers = { Authorization: authHeader };
        } else {
          params.key = API_KEY;
        }

        const response = await axios.get(`${YOUTUBE_API_BASE}/channels`, config);
        await consumeQuota(req, { billable: true });

        const channelData = response.data;
        if (channelData?.items?.length > 0) {
          await serverCache.set(cacheKey, channelData, YT_DATA_CACHE_TTL_MS.CHANNEL);
        }

        // If includeTrailer=true, also fetch the trailer/unsubscribe video details
        if (req.query.includeTrailer === "true") {
          const trailerId = channelData?.items?.[0]?.brandingSettings?.channel?.unsubscribedTrailer;
          let trailerVideo = null;
          if (trailerId) {
            try {
              const trailerParams = { part: "snippet,statistics,contentDetails", id: trailerId };
              const trailerConfig = { params: trailerParams };
              if (authHeader) {
                trailerConfig.headers = { Authorization: authHeader };
              } else {
                trailerParams.key = API_KEY;
              }
              const trailerResponse = await axios.get(`${YOUTUBE_API_BASE}/videos`, trailerConfig);
              trailerVideo = trailerResponse.data;
            } catch (trailerErr) {
              console.warn(`[Channel] Failed to fetch trailer video ${trailerId}:`, trailerErr.message);
            }
          }
          return res.json({ channel: channelData, trailerVideo });
        }

        res.json(channelData);
      } catch (error) {
        handleApiError(error, res);
      }
    },
  );

  // Get Authorized Channels (mine)
  router.get(
    "/mine",
    resolveUser, checkPremiumAccess("channel"), requireQuota("channel"),
    async (req, res) => {
      try {
        const accessToken = req.headers.authorization;
        if (!accessToken) {
          return res.status(401).json({ error: { message: "Missing Authorization header" } });
        }

        const scope = youtubeDataScope(req, true);
        const cacheKey = `yt:channels:mine:${scope}`;

        // Skip cache when the caller wants a fresh list (e.g. user is in
        // "add channel" flow). Only use cache for read-only data access.
        if (req.query.fresh !== 'true') {
          const cached = await serverCache.get(cacheKey);
          if (cached) {
            console.log(`[channels/mine] Cache HIT (${cached.items?.length || 0} channel(s))`);
            return res.json(cached);
          }
        }

        const response = await axios.get(`${YOUTUBE_API_BASE}/channels`, {
          params: { part: "snippet,contentDetails,statistics", mine: true },
          headers: { Authorization: accessToken },
        });
        await consumeQuota(req, { billable: true });

        // Only cache non-empty results -- caching an empty response means a
        // Google account with no YouTube channel stays stuck until the TTL
        // expires even after the user creates one.
        if (response.data.items?.length > 0) {
          await serverCache.set(cacheKey, response.data, YT_DATA_CACHE_TTL_MS.CHANNELS_MINE);
        }

        console.log(`[channels/mine] Returning ${response.data.items?.length || 0} channel(s)`);
        if (response.data.items) {
          response.data.items.forEach((ch) => {
            console.log(`  - ${ch.snippet.title} (${ch.id})`);
          });
        }

        res.json(response.data);
      } catch (error) {
        handleApiError(error, res);
      }
    },
  );

  return router;
}

module.exports = { createChannelsRouter };

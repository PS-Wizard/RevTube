const express = require("express");

/**
 * Videos router.
 *
 * Mount points (all on the same router to share handler logic):
 *   - Mounted at /video   → matches /:videoId   for video→channel resolution
 *   - Mounted at /videos  → matches /            for bulk video fetch
 *   - Mounted at /specific-videos → matches /specific for specific-video fetch
 */
const { getVideosByIds } = require("../ingestion/readModels");

function createVideosRouter(deps) {
  const {
    resolveUser, resolveLimiter, checkPremiumAccess, requireQuota, consumeQuota,
    youtubeDataScope, shortHash, YT_DATA_CACHE_TTL_MS, serverCache, handleApiError, axios, API_KEY, YOUTUBE_API_BASE,
  } = deps;
  const router = express.Router();

  // Video → Channel ID resolution (no monthly quota -- rate-limited instead)
  router.get("/:videoId", resolveUser, resolveLimiter, async (req, res) => {
    try {
      const { videoId } = req.params;
      const cleanId = String(videoId).replace(/[^0-9A-Za-z_-]/g, "");
      if (!cleanId || cleanId.length > 20) {
        return res.status(400).json({ error: { message: "Invalid video ID" } });
      }

      const scope = youtubeDataScope(req, false);
      const cacheKey = `yt:video:ch:${scope}:${cleanId}`;
      const cached = await serverCache.get(cacheKey);
      if (cached) return res.json(cached);

      // Postgres-first: if the video is already ingested (the user's connected
      // channels), resolve its channel from the database without a YouTube call.
      // Only videos not yet ingested (e.g. foreign-channel pastes) hit the API.
      const dbHits = await getVideosByIds([cleanId]);
      const dbHit = dbHits[cleanId];
      if (dbHit) {
        const result = {
          channelId: dbHit.channelId,
          channelTitle: dbHit.channelTitle,
        };
        await serverCache.set(cacheKey, result, 24 * 60 * 60 * 1000);
        return res.json(result);
      }

      const params = { part: "snippet", id: cleanId, key: API_KEY };
      const response = await axios.get(`${YOUTUBE_API_BASE}/videos`, { params });

      if (!response.data?.items?.length) {
        return res.status(404).json({ error: { message: "Video not found" } });
      }

      const snippet = response.data.items[0].snippet;
      const result = { channelId: snippet.channelId, channelTitle: snippet.channelTitle };
      await serverCache.set(cacheKey, result, 24 * 60 * 60 * 1000);
      res.json(result);
    } catch (error) {
      console.error("[Video→Channel] Error:", error.response?.data || error.message);
      handleApiError(error, res);
    }
  });

  // Bulk video fetch -- mounted at /videos
  router.get("/", checkPremiumAccess("videos"), requireQuota("videos"), async (req, res) => {
    try {
      const { ids } = req.query;
      if (!ids) {
        return res.status(400).json({ error: { message: "Missing ids parameter" } });
      }
      const idList = String(ids).split(",").map((s) => s.trim()).filter(Boolean);
      if (idList.length > 50) {
        return res.status(400).json({
          error: { message: `Maximum of 50 video IDs per request (got ${idList.length})` },
        });
      }
      const authHeader = req.headers.authorization;
      const scope = youtubeDataScope(req, !!authHeader);
      const idKey = idList.sort().join(",");
      const cacheKey = `yt:videos:${scope}:${shortHash(idKey)}`;
      const cached = await serverCache.get(cacheKey);
      if (cached) return res.json(cached);

      const params = { part: "snippet,statistics,contentDetails", id: ids };
      const config = { params };
      if (authHeader) {
        config.headers = { Authorization: authHeader };
      } else {
        params.key = API_KEY;
      }

      const response = await axios.get(`${YOUTUBE_API_BASE}/videos`, config);
      await consumeQuota(req, { billable: true });
      await serverCache.set(cacheKey, response.data, YT_DATA_CACHE_TTL_MS.VIDEOS);
      res.json(response.data);
    } catch (error) {
      handleApiError(error, res);
    }
  });

  // Specific videos
  router.get("/specific", checkPremiumAccess("specificVideos"), requireQuota("specificVideos"), async (req, res) => {
    try {
      const { ids } = req.query;
      if (!ids) {
        return res.status(400).json({ error: { message: "Missing ids parameter" } });
      }
      const idList = String(ids).split(",").map((s) => s.trim()).filter(Boolean);
      if (idList.length > 50) {
        return res.status(400).json({
          error: { message: `Maximum of 50 video IDs per request (got ${idList.length})` },
        });
      }
      const authHeader = req.headers.authorization;
      const scope = youtubeDataScope(req, !!authHeader);
      const idKey = idList.sort().join(",");
      const cacheKey = `yt:videos:${scope}:${shortHash(idKey)}`;
      const cached = await serverCache.get(cacheKey);
      if (cached) return res.json(cached);

      const params = { part: "snippet,statistics,contentDetails", id: ids };
      const config = { params };
      if (authHeader) {
        config.headers = { Authorization: authHeader };
      } else {
        params.key = API_KEY;
      }

      const response = await axios.get(`${YOUTUBE_API_BASE}/videos`, config);
      await consumeQuota(req, { billable: true });
      await serverCache.set(cacheKey, response.data, YT_DATA_CACHE_TTL_MS.VIDEOS);
      res.json(response.data);
    } catch (error) {
      handleApiError(error, res);
    }
  });

  return router;
}

module.exports = { createVideosRouter };

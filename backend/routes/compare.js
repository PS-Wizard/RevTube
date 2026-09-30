const express = require("express");

/**
 * Compare router.
 *
 * Provides a backend endpoint that fetches all videos from a channel's uploads
 * playlist, enriches them with statistics, and caches the result server-side
 * so repeated comparisons don't burn YouTube quota.
 *
 * Mounted at /compare
 */
function createCompareRouter(deps) {
  const {
    resolveUser, checkPremiumAccess,
    serverCache, handleApiError, axios, API_KEY, YOUTUBE_API_BASE,
  } = deps;
  const router = express.Router();

  const COMPARE_CACHE_TTL = 60 * 60 * 1000; // 1 hour
  const BATCH_SIZE = 50;
  const MAX_VIDEOS = 200; // safety limit (matches frontend)

  /**
   * POST /compare/videos
   *
   * Fetch ALL videos from a playlist, enrich with statistics, optionally
   * filter by date range, and cache the full result server-side.
   *
   * Body: { playlistId, startDate?, endDate? }
   *   - playlistId: required -- the uploads playlist ID (e.g. UU...)
   *   - startDate: optional ISO date -- skip videos published before this
   *   - endDate: optional ISO date -- skip videos published after this
   *
   * Returns: { videos: [...], channelTitle }
   *   - videos: array of VideoMetadata with snippet + statistics
   *   - channelTitle: name from the first video's channel
   *
   * Cache keyed by playlistId + date range only (no user scope), so any
   * user comparing the same channel reuses the cached result.
   * TTL = 1 hour (COMPARE_CACHE_TTL).
   */
  router.post(
    "/videos",
    resolveUser,
    checkPremiumAccess("compare"),
    async (req, res) => {
      try {
        const { playlistId, startDate, endDate } = req.body;
        if (!playlistId) {
          return res.status(400).json({ error: { message: "Missing playlistId" } });
        }

        const authHeader = req.headers.authorization;
        const startCutoff = startDate ? new Date(startDate) : new Date("1900-01-01");
        const endCutoff = endDate ? new Date(endDate + "T23:59:59.999Z") : null;

        // Build cache key -- no user scope so the same channel's videos are
        // shared across all users (per-channel, not per-user).
        const datePart = startDate && endDate ? `:${startDate}_${endDate}` : "";
        const cacheKey = `compare:videos:${playlistId}${datePart}`;

        // Check cache
        const cached = await serverCache.get(cacheKey);
        if (cached) {
          console.log(`[Compare] Cache HIT for ${playlistId}`);
          return res.json(cached);
        }

        console.log(`[Compare] Cache MISS for ${playlistId} -- fetching all pages...`);

        // ── Step 1: Paginate through ALL playlist items ────────────────────
        const allVideos = [];
        let pageToken = undefined;
        let channelTitle = null;
        let shouldContinue = true;
        let pagesFetched = 0;

        while (shouldContinue) {
          const params = {
            part: "snippet",
            playlistId,
            maxResults: BATCH_SIZE,
          };
          if (pageToken) params.pageToken = pageToken;

          const config = { params };
          if (authHeader) {
            config.headers = { Authorization: authHeader };
          } else {
            params.key = API_KEY;
          }

          const response = await axios.get(
            `${YOUTUBE_API_BASE}/playlistItems`,
            config
          );
          pagesFetched++;

          const items = response.data?.items || [];
          if (items.length === 0) break;

          // Extract raw video metadata
          const batchVideos = items.map((item) => ({
            position: item.snippet.position,
            title: item.snippet.title,
            videoId: item.snippet.resourceId.videoId,
            publishedAt: item.snippet.publishedAt,
            channelTitle: item.snippet.channelTitle,
            description: item.snippet.description,
            thumbnailUrl:
              item.snippet.thumbnails?.medium?.url ||
              item.snippet.thumbnails?.default?.url ||
              "",
          }));

          // Remember channel name from first batch
          if (!channelTitle && batchVideos.length > 0) {
            channelTitle = batchVideos[0].channelTitle;
          }

          allVideos.push(...batchVideos);

          // Early stop: if last video is older than start cutoff, stop
          const lastVideo = batchVideos[batchVideos.length - 1];
          if (lastVideo && new Date(lastVideo.publishedAt) < startCutoff) {
            shouldContinue = false;
          }

          // Next page or stop
          pageToken = response.data?.nextPageToken;
          if (!pageToken) shouldContinue = false;

          // Safety limit
          if (allVideos.length >= MAX_VIDEOS) {
            console.log(`[Compare] Hit safety limit of ${MAX_VIDEOS} videos for ${playlistId}`);
            shouldContinue = false;
          }
        }

        console.log(
          `[Compare] Fetched ${allVideos.length} videos (${pagesFetched} pages) for ${playlistId}`
        );

        // ── Step 2: Enrich with statistics (batch of 50 per call) ──────────
        const enrichedVideos = [];
        for (let i = 0; i < allVideos.length; i += 50) {
          const chunk = allVideos.slice(i, i + 50);
          const videoIds = chunk.map((v) => v.videoId).join(",");

          const statsParams = {
            part: "snippet,statistics,contentDetails",
            id: videoIds,
          };
          const statsConfig = { params: statsParams };
          if (authHeader) {
            statsConfig.headers = { Authorization: authHeader };
          } else {
            statsParams.key = API_KEY;
          }

          const statsResponse = await axios.get(
            `${YOUTUBE_API_BASE}/videos`,
            statsConfig
          );

          const statsMap = {};
          for (const item of statsResponse.data?.items || []) {
            const s = item.statistics || {};
            statsMap[item.id] = {
              viewCount: parseInt(s.viewCount || "0", 10),
              likeCount: parseInt(s.likeCount || "0", 10),
              commentCount: parseInt(s.commentCount || "0", 10),
            };
          }

          for (const v of chunk) {
            const stats = statsMap[v.videoId] || { viewCount: 0, likeCount: 0, commentCount: 0 };
            enrichedVideos.push({ ...v, ...stats });
          }
        }

        // ── Step 3: Filter by date range ───────────────────────────────────
        const filteredVideos = enrichedVideos.filter((video) => {
          const publishDate = new Date(video.publishedAt);
          if (publishDate < startCutoff) return false;
          if (endCutoff && publishDate > endCutoff) return false;
          return true;
        });

        // ── Step 4: Compute analytics metrics from the filtered videos ───────
        const totalVideos = filteredVideos.length;
        const totalViews = filteredVideos.reduce((sum, v) => sum + (v.viewCount || 0), 0);
        const totalLikes = filteredVideos.reduce((sum, v) => sum + (v.likeCount || 0), 0);
        const totalComments = filteredVideos.reduce((sum, v) => sum + (v.commentCount || 0), 0);

        const metrics = {
          totalVideos,
          totalViews,
          totalLikes,
          totalComments,
          avgViewsPerVideo: totalVideos > 0 ? Math.round(totalViews / totalVideos) : 0,
          avgLikesPerVideo: totalVideos > 0 ? Math.round(totalLikes / totalVideos) : 0,
          avgCommentsPerVideo: totalVideos > 0 ? Math.round(totalComments / totalVideos) : 0,
          avgLikesPerView: totalViews > 0 ? parseFloat(((totalLikes / totalViews) * 100).toFixed(2)) : 0,
        };

        const result = {
          videos: filteredVideos,
          channelTitle,
          metrics,
          totalFetched: allVideos.length,
          totalFiltered: filteredVideos.length,
        };

        // ── Step 5: Cache and return ────────────────────────────────────────
        await serverCache.set(cacheKey, result, COMPARE_CACHE_TTL);
        res.json(result);
      } catch (error) {
        console.error("[Compare Videos] Error:", error.response?.data || error.message);
        handleApiError(error, res);
      }
    },
  );

  return router;
}

module.exports = { createCompareRouter };

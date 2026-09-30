const express = require("express");

function createAnalyticsRouter(deps) {
  const {
    resolveUser, resolveOrgToken, analyticsReadLimiter,
    checkPremiumAccess, requireQuota, consumeQuota,
    youtubeDataScope, shortHash, YT_DATA_CACHE_TTL_MS, serverCache, handleApiError, axios,
    generateDimensions,
  } = deps;
  const router = express.Router();

  // Analytics report endpoint
  router.get(
    "/report",
    analyticsReadLimiter,
    resolveUser,
    resolveOrgToken((req) => {
      const ids = typeof req.query?.ids === "string" ? req.query.ids : "";
      if (ids.startsWith("channel==")) {
        const channelId = ids.slice("channel==".length);
        return channelId === "MINE" ? null : channelId;
      }
      return null;
    }),
    checkPremiumAccess("dashboard"),
    requireQuota("dashboard"),
    async (req, res) => {
      try {
        const accessToken = req.headers.authorization;
        if (!accessToken) {
          return res.status(401).json({ error: { message: "Missing Authorization header" } });
        }

        const { ids, metrics, dimensions, startDate, endDate, sort, maxResults, filters } = req.query;
        const scope = youtubeDataScope(req, true);
        const reportSig = shortHash(
          JSON.stringify({ ids, metrics, dimensions, startDate, endDate, sort, maxResults, filters }),
        );
        const cacheKey = `yt:ytan:report:${scope}:${reportSig}`;
        const cached = await serverCache.get(cacheKey);
        if (cached) return res.json(cached);

        const response = await axios.get(
          "https://youtubeanalytics.googleapis.com/v2/reports",
          {
            params: { ids, metrics, dimensions, startDate, endDate, sort, maxResults, filters },
            headers: { Authorization: accessToken },
          },
        );
        await consumeQuota(req, { billable: true });
        await serverCache.set(cacheKey, response.data, YT_DATA_CACHE_TTL_MS.ANALYTICS_REPORT);
        res.json(response.data);
      } catch (error) {
        handleApiError(error, res);
      }
    },
  );

  // Dimensions breakdown endpoint
  router.post(
    "/dimensions",
    analyticsReadLimiter,
    resolveUser,
    resolveOrgToken((req) => req.body?.channelId),
    checkPremiumAccess("dashboard"),
    requireQuota("dashboard"),
    async (req, res) => {
      try {
        const accessToken = req.headers.authorization;
        if (!accessToken)
          return res.status(401).json({ error: { message: "Missing Authorization header" } });

        const { channelId, startDate, endDate, filters } = req.body;
        if (!channelId || !startDate || !endDate)
          return res.status(400).json({
            error: { message: "Missing channelId, startDate, or endDate" },
          });

        const responseData = await generateDimensions({
          channelId, startDate, endDate, filters, accessToken, req,
        });
        await consumeQuota(req);
        res.json(responseData);
      } catch (error) {
        console.error("[Dimensions] Error:", error.response?.data || error.message);
        handleApiError(error, res);
      }
    },
  );

  return router;
}

module.exports = { createAnalyticsRouter };

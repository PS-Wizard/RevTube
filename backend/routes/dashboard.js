const express = require("express");
const { paginateCatalog } = require("../utils/pagination");

function createDashboardRouter(deps) {
  const {
    resolveUser, resolveOrgToken, analyticsReadLimiter,
    checkPremiumAccess, requireQuota, consumeQuota,
    withInFlightTimeout, DASHBOARD_INFLIGHT,
    generateDashboardSummary, generateDashboardBundle, generateChannelVideos,
    generateChannelPlaylists,
    dashboardSummaryKey, dashboardSnapshotKey,
    serverCache, handleApiError,
    axios, shortHash, youtubeDataScope, YT_DATA_CACHE_TTL_MS, API_KEY, YOUTUBE_API_BASE,
    mergeOwnedHiddenPlaylists,
    generateDimensions,
  } = deps;
  const router = express.Router();

  // POST /dashboard/summary -- 7d/30d/90d pills only, fast first paint (no quota)
  router.post(
    "/summary",
    analyticsReadLimiter,
    resolveUser,
    resolveOrgToken((req) => req.body?.channelId),
    checkPremiumAccess("dashboard"),
    async (req, res) => {
      try {
        const accessToken = req.headers.authorization;
        if (!accessToken)
          return res.status(401).json({ error: { message: "Missing Authorization header" } });

        const { channelId, period, startDate, endDate, compare, trueDelta, filters, latestDate } = req.body;
        if (!channelId)
          return res.status(400).json({ error: { message: "Missing channelId" } });

        const requestKey = dashboardSummaryKey(
          channelId, period, startDate, endDate, compare, trueDelta, filters, latestDate,
        );
        const responseData = await withInFlightTimeout(
          DASHBOARD_INFLIGHT.summary, requestKey,
          () => generateDashboardSummary({
            channelId, period, startDate, endDate, compare, trueDelta, filters,
            clientLatestDate: latestDate, accessToken,
          }),
        );
        res.json(responseData);
      } catch (error) {
        console.error("[Dashboard Summary] Error:", error.response?.data || error.message);
        handleApiError(error, res);
      }
    },
  );

  // POST /dashboard/bundle -- heavy dashboard data
  router.post(
    "/bundle",
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

        const { channelId, period, startDate, endDate, compare, trueDelta, filters, latestDate, fields } = req.body;
        if (!channelId)
          return res.status(400).json({ error: { message: "Missing channelId" } });

        const requestKey = dashboardSnapshotKey("bundle", {
          channelId, period, startDate, endDate, compare, trueDelta, filters,
          clientLatestDate: latestDate, fields,
        }).key;
        const responseData = await withInFlightTimeout(
          DASHBOARD_INFLIGHT.bundle, requestKey,
          () => generateDashboardBundle({
            channelId, period, startDate, endDate, compare, trueDelta, filters,
            clientLatestDate: latestDate, accessToken, fields, req,
          }),
        );
        await consumeQuota(req);
        res.json(responseData);
      } catch (error) {
        console.error("[Dashboard Bundle] Error:", error.response?.data || error.message);
        handleApiError(error, res);
      }
    },
  );

  // POST /dashboard/videos -- Video list for Videos tab
  router.post(
    "/videos",
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

        const { channelId, maxResults, offset = 0, page, perPage } = req.body;
        if (!channelId)
          return res.status(400).json({ error: { message: "Missing channelId" } });
        // Exact status requested by the videos filter: 'public' | 'private' | 'unlisted' | 'all'.
        // includePrivate is kept for backward compatibility with older clients.
        const rawPrivacy = typeof req.body?.privacy === "string" ? req.body.privacy.toLowerCase() : null;
        const privacy = ["public", "private", "unlisted", "all"].includes(rawPrivacy)
          ? rawPrivacy
          : (req.body?.includePrivate === true ? "all" : "public");

        const orgId = req.headers["x-org-id"];
        const scope = orgId && req._orgRefreshToken
          ? `org:${String(orgId)}:${channelId}`
          : req.authUser?.email || shortHash(accessToken);

        // Standard page-based pagination. `page` (1-based) + `perPage` take
        // precedence; legacy `offset` + `maxResults` are mapped onto them so old
        // clients keep working.
        const requestedLimit =
          (typeof perPage === "number" && perPage > 0 ? Math.floor(perPage) : 0) ||
          (typeof maxResults === "number" && maxResults > 0 ? Math.floor(maxResults) : 0) ||
          50;
        const parsedOffset =
          typeof page === "number" && page >= 1
            ? (Math.floor(page) - 1) * requestedLimit
            : (Number(offset) >= 0 ? Number(offset) : 0);

        // Fetch the FULL filtered catalog (single stable cache entry) so the
        // response carries the true total on the very first page. Slicing a
        // cached full list per page is cheaper than re-fetching ever-growing
        // offset windows, each of which also fragmented the cache under its own key.
        const fetched = await generateChannelVideos({
          channelId,
          maxResults: undefined,
          accessToken,
          cacheScope: scope,
          orgRefreshToken: req._orgRefreshToken,
          req,
          privacy,
        });
        await consumeQuota(req);
        // Videos come back pre-filtered to the requested status, so a plain slice is safe.
        const { sliced: videos, pagination } = paginateCatalog(fetched, {
          offset: parsedOffset,
          limit: requestedLimit,
          total: fetched.length,
        });
        res.json({
          status: 200,
          message: "Videos fetched successfully",
          videos,
          pagination,
        });
      } catch (error) {
        console.error("[Dashboard Videos] Error:", error.response?.data || error.message);
        handleApiError(error, res);
      }
    },
  );

  // POST /dashboard/playlists -- Playlist catalog for the Playlists tab.
  // Paged exactly like POST /dashboard/videos: the backend serves the FULL
  // catalog (L1 cache -> L2 Postgres -> L3 live) and slices per page, so the
  // response carries the true total on the very first page and "Next" just
  // advances the offset. Legacy token-window clients (pageToken + maxResults
  // with no page/perPage) still get one live page in the old YouTube shape.
  router.post(
    "/playlists",
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

        const { channelId, pageToken: ptRaw, maxResults: mrRaw, offset = 0, page, perPage } = req.body;
        if (!channelId)
          return res.status(400).json({ error: { message: "Missing channelId" } });
        const includePrivate = req.body?.includePrivate === true && !!accessToken;

        const isPagedRequest = typeof page === "number" || typeof perPage === "number";
        if (isPagedRequest) {
          // Standard page-based pagination. `page` (1-based) + `perPage` take
          // precedence; legacy `offset` + `maxResults` are mapped onto them so old
          // clients keep working.
          const requestedLimit =
            (typeof perPage === "number" && perPage > 0 ? Math.floor(perPage) : 0) ||
            (typeof mrRaw === "number" && mrRaw > 0 ? Math.floor(mrRaw) : 0) ||
            50;
          const parsedOffset =
            typeof page === "number" && page >= 1
              ? (Math.floor(page) - 1) * requestedLimit
              : (Number(offset) >= 0 ? Number(offset) : 0);

          const orgId = req.headers["x-org-id"];
          const scope = orgId && req._orgRefreshToken
            ? `org:${String(orgId)}:${channelId}`
            : req.authUser?.email || shortHash(accessToken);

          const { items, catalogTotal } = await generateChannelPlaylists({
            channelId,
            accessToken,
            cacheScope: scope,
            req,
            includePrivate,
          });
          await consumeQuota(req);
          const { sliced, pagination } = paginateCatalog(items, {
            offset: parsedOffset,
            limit: requestedLimit,
            total: Math.max(catalogTotal, items.length),
          });
          return res.json({
            status: 200,
            message: "Playlists fetched successfully",
            playlists: sliced,
            items: sliced,
            catalogTotal: pagination.totaldata,
            pagination,
          });
        }

        const mr = mrRaw || 50;
        const pt = ptRaw || "";
        const scope = youtubeDataScope(req, !!accessToken);
        const cacheKey = `yt:dsh:pl:list:${scope}:${channelId}:mr${mr}:pt${shortHash(pt)}${includePrivate ? ":p1" : ""}`;

        const cached = await serverCache.get(cacheKey);
        if (cached) return res.json(cached);

        const params = { part: "snippet,contentDetails,status", channelId, maxResults: mr };
        if (ptRaw) params.pageToken = ptRaw;
        const config = { params };
        if (accessToken) {
          config.headers = { Authorization: accessToken };
        } else {
          params.key = API_KEY;
        }

        const apiResponse = await axios.get(`${YOUTUBE_API_BASE}/playlists`, config);
        let responseData = apiResponse.data;
        if (includePrivate) {
          // Catalog truth for the UI: YouTube's pageInfo.totalResults covers
          // the channelId query only, so add the merged hidden rows on top.
          // (The frontend dedupes by id -- the same hidden rows are appended
          // to every page response.)
          const beforeIds = new Set((responseData.items || []).map((i) => i.id));
          const ytTotal = Number(responseData.pageInfo?.totalResults)
            || (responseData.items || []).length;
          responseData = await mergeOwnedHiddenPlaylists(responseData, {
            channelId, accessToken, axios, YOUTUBE_API_BASE, isFirstPage: !ptRaw,
          });
          const added = (responseData.items || []).filter((i) => !beforeIds.has(i.id)).length;
          responseData.catalogTotal = ytTotal + added;
        }
        // No next page: the whole catalog is in hand, so the enumerated rows
        // -- not a possibly stale pageInfo.totalResults -- are ground truth.
        if (!responseData.nextPageToken && typeof responseData.catalogTotal === "number") {
          responseData.catalogTotal = Math.min(responseData.catalogTotal, (responseData.items || []).length);
        }
        await consumeQuota(req, { billable: true });
        await serverCache.set(cacheKey, responseData, YT_DATA_CACHE_TTL_MS.PLAYLISTS);
        res.json(responseData);
      } catch (error) {
        console.error("[Dashboard Playlists] Error:", error.response?.data || error.message);
        handleApiError(error, res);
      }
    },
  );

  // POST /dashboard/report -- YouTube Analytics report proxy
  router.post(
    "/report",
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

        const { ids, metrics, startDate, endDate, dimensions, sort, maxResults, filters } = req.body;
        if (!ids) return res.status(400).json({ error: { message: "Missing ids" } });
        if (!metrics) return res.status(400).json({ error: { message: "Missing metrics" } });
        if (!startDate || !endDate)
          return res.status(400).json({ error: { message: "Missing startDate or endDate" } });

        const scope = youtubeDataScope(req, !!accessToken);
        const reportSig = shortHash(
          JSON.stringify({ ids, metrics, startDate, endDate, dimensions, sort, maxResults, filters }),
        );
        const cacheKey = `yt:ytan:report:${scope}:${reportSig}`;
        const cached = await serverCache.get(cacheKey);
        if (cached) return res.json(cached);

        const apiResponse = await axios.get(
          "https://youtubeanalytics.googleapis.com/v2/reports",
          {
            params: { ids, metrics, startDate, endDate, dimensions, sort, maxResults, filters },
            headers: { Authorization: accessToken },
          },
        );
        await consumeQuota(req, { billable: true });
        await serverCache.set(cacheKey, apiResponse.data, YT_DATA_CACHE_TTL_MS.ANALYTICS_REPORT);
        res.json(apiResponse.data);
      } catch (error) {
        console.error("[Dashboard Report] Error:", error.response?.data || error.message);
        handleApiError(error, res);
      }
    },
  );

  // POST /dashboard/dimensions -- Audience dimensions
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
        console.error("[Dashboard Dimensions] Error:", error.response?.data || error.message);
        handleApiError(error, res);
      }
    },
  );

  // ── Dashboard-scoped YouTube Data API proxies ─────────────────────────────
  // These bill against the shared "dashboard" quota pool (Channel Analytics tabs).

  router.post(
    "/videos/by-ids",
    resolveUser,
    checkPremiumAccess("dashboard"),
    requireQuota("dashboard"),
    async (req, res) => {
      try {
        const { ids } = req.body;
        if (!ids) return res.status(400).json({ error: { message: "Missing ids parameter" } });
        const idList = String(ids).split(",").map((s) => s.trim()).filter(Boolean);
        if (idList.length > 50) {
          return res.status(400).json({
            error: { message: `Maximum of 50 video IDs per request (got ${idList.length})` },
          });
        }
        const authHeader = req.headers.authorization;
        const scope = youtubeDataScope(req, !!authHeader);
        const idKey = idList.sort().join(",");
        const cacheKey = `yt:dsh:vids:ids:${scope}:${shortHash(idKey)}`;
        const cached = await serverCache.get(cacheKey);
        if (cached) return res.json(cached);

        const params = { part: "snippet,statistics,contentDetails", id: ids };
        const config = { params };
        if (authHeader) config.headers = { Authorization: authHeader };
        else params.key = API_KEY;

        const response = await axios.get(`${YOUTUBE_API_BASE}/videos`, config);
        await consumeQuota(req, { billable: true });
        await serverCache.set(cacheKey, response.data, YT_DATA_CACHE_TTL_MS.VIDEOS);
        res.json(response.data);
      } catch (error) {
        handleApiError(error, res);
      }
    },
  );

  router.get(
    "/playlist/:id",
    resolveUser,
    checkPremiumAccess("dashboard"),
    requireQuota("dashboard"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const authHeader = req.headers.authorization;
        const scope = youtubeDataScope(req, !!authHeader);
        const cacheKey = `yt:dsh:pl:one:${scope}:${id}`;
        const cached = await serverCache.get(cacheKey);
        if (cached) return res.json(cached);

        const params = { part: "snippet,contentDetails", id };
        const config = { params };
        if (authHeader) config.headers = { Authorization: authHeader };
        else params.key = API_KEY;

        const response = await axios.get(`${YOUTUBE_API_BASE}/playlists`, config);
        await consumeQuota(req, { billable: true });
        await serverCache.set(cacheKey, response.data, YT_DATA_CACHE_TTL_MS.PLAYLIST);
        res.json(response.data);
      } catch (error) {
        handleApiError(error, res);
      }
    },
  );

  router.get(
    "/playlist-items/:playlistId",
    resolveUser,
    checkPremiumAccess("dashboard"),
    requireQuota("dashboard"),
    async (req, res) => {
      try {
        const { playlistId } = req.params;
        const { pageToken, maxResults } = req.query;
        const authHeader = req.headers.authorization;
        const scope = youtubeDataScope(req, !!authHeader);
        const mr = maxResults || 50;
        const pt = pageToken || "";
        const cacheKey = `yt:dsh:pl:items:${scope}:${playlistId}:mr${mr}:pt${shortHash(pt)}`;
        const cached = await serverCache.get(cacheKey);
        if (cached) return res.json(cached);

        const params = { part: "snippet", playlistId, maxResults: mr };
        if (pageToken) params.pageToken = pageToken;
        const config = { params };
        if (authHeader) config.headers = { Authorization: authHeader };
        else params.key = API_KEY;

        const response = await axios.get(`${YOUTUBE_API_BASE}/playlistItems`, config);
        await consumeQuota(req, { billable: true });
        await serverCache.set(cacheKey, response.data, YT_DATA_CACHE_TTL_MS.PLAYLIST_ITEMS);
        res.json(response.data);
      } catch (error) {
        handleApiError(error, res);
      }
    },
  );

  return router;
}

module.exports = { createDashboardRouter };

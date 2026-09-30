const express = require("express");
const { paginateCatalog } = require("../utils/pagination");
const { createChannelOwnershipValidator } = require("../utils/channelOwnership");

function createPlaylistsRouter(deps) {
  const {
    resolveUser, resolveOrgToken, checkPremiumAccess, requireQuota, consumeQuota,
    youtubeDataScope, shortHash, YT_DATA_CACHE_TTL_MS, serverCache, handleApiError, axios, API_KEY, YOUTUBE_API_BASE,
    mergeOwnedHiddenPlaylists, syncChannelPlaylists, generateChannelPlaylists,
  } = deps;
  const router = express.Router();
  const ownership = createChannelOwnershipValidator(deps);

  // Get Single Playlist by ID
  router.get(
    "/single/:id",
    resolveUser, checkPremiumAccess("playlists"), requireQuota("playlists"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const authHeader = req.headers.authorization;
        const scope = youtubeDataScope(req, !!authHeader);
        const cacheKey = `yt:pl:one:${scope}:${id}`;
        const cached = await serverCache.get(cacheKey);
        if (cached) return res.json(cached);

        const params = { part: "snippet,contentDetails", id };
        const config = { params };
        if (authHeader) {
          config.headers = { Authorization: authHeader };
        } else {
          params.key = API_KEY;
        }

        const response = await axios.get(`${YOUTUBE_API_BASE}/playlists`, config);
        await consumeQuota(req, { billable: true });
        await serverCache.set(cacheKey, response.data, YT_DATA_CACHE_TTL_MS.PLAYLIST);
        res.json(response.data);
      } catch (error) {
        handleApiError(error, res);
      }
    },
  );

  // Get Playlist Items
  router.get(
    "/items/:playlistId",
    resolveUser, checkPremiumAccess("playlists"), requireQuota("playlists"),
    async (req, res) => {
      try {
        const { playlistId } = req.params;
        const { pageToken, maxResults } = req.query;
        const authHeader = req.headers.authorization;
        const scope = youtubeDataScope(req, !!authHeader);
        const mr = maxResults || 50;
        const pt = pageToken || "";
        const cacheKey = `yt:pl:items:${scope}:${playlistId}:mr${mr}:pt${shortHash(pt)}`;
        const cached = await serverCache.get(cacheKey);
        if (cached) return res.json(cached);

        const params = { part: "snippet", playlistId, maxResults: mr };
        if (pageToken) params.pageToken = pageToken;
        const config = { params };
        if (authHeader) {
          config.headers = { Authorization: authHeader };
        } else {
          params.key = API_KEY;
        }

        const response = await axios.get(`${YOUTUBE_API_BASE}/playlistItems`, config);
        await consumeQuota(req, { billable: true });
        await serverCache.set(cacheKey, response.data, YT_DATA_CACHE_TTL_MS.PLAYLIST_ITEMS);
        res.json(response.data);
      } catch (error) {
        handleApiError(error, res);
      }
    },
  );

  // Get Playlists by Channel ID.
  //
  // Paged mode (`?page=1&perPage=20`): serves the FULL catalog (L1 cache ->
  // L2 Postgres -> L3 live, via generateChannelPlaylists) sliced per page,
  // with the true total up front -- "Next" just advances the offset.
  // Legacy token mode (`?pageToken=&maxResults=`, no page params): one live
  // YouTube page in the raw API shape, unchanged.
  router.get(
    "/:channelId",
    resolveUser, resolveOrgToken("channelId"), checkPremiumAccess("playlists"), requireQuota("playlists"),
    async (req, res) => {
      try {
        const { channelId } = req.params;
        const { pageToken, maxResults, page: pageRaw, perPage: perPageRaw } = req.query;
        const authHeader = req.headers.authorization;
        const includePrivate = req.query.includePrivate === "1" && !!authHeader;

        const pageNum = pageRaw !== undefined ? Number(pageRaw) : NaN;
        const perPageNum = perPageRaw !== undefined ? Number(perPageRaw) : NaN;
        if ((Number.isFinite(pageNum) || Number.isFinite(perPageNum)) && typeof generateChannelPlaylists === "function") {
          const requestedLimit = (Number.isFinite(perPageNum) && perPageNum > 0 ? Math.floor(perPageNum) : 0)
            || (Number(maxResults) > 0 ? Math.floor(Number(maxResults)) : 0)
            || 50;
          const parsedOffset = Number.isFinite(pageNum) && pageNum >= 1
            ? (Math.floor(pageNum) - 1) * requestedLimit
            : 0;

          const orgId = req.headers["x-org-id"];
          const scope = orgId && req._orgRefreshToken
            ? `org:${String(orgId)}:${channelId}`
            : req.authUser?.email || shortHash(authHeader);

          const { items, catalogTotal } = await generateChannelPlaylists({
            channelId,
            accessToken: authHeader,
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
          const totaldata = pagination.totaldata;
          const hasMore = pagination.hasMore;
          return res.json({
            items: sliced,
            pageInfo: { totalResults: totaldata, resultsPerPage: requestedLimit },
            ...(hasMore ? { nextPageToken: `p${pagination.currentpage + 1}` } : {}),
            catalogTotal: totaldata,
            pagination,
          });
        }

        const mr = maxResults || 50;
        const pt = pageToken || "";
        const scope = youtubeDataScope(req, !!authHeader);
        const cacheKey = `yt:pl:list:${scope}:${channelId}:mr${mr}:pt${shortHash(pt)}${includePrivate ? ":p1" : ""}`;
        const cached = await serverCache.get(cacheKey);
        if (cached) return res.json(cached);

        const params = { part: "snippet,contentDetails,status", channelId, maxResults: mr };
        if (pageToken) params.pageToken = pageToken;
        const config = { params };
        if (authHeader) {
          config.headers = { Authorization: authHeader };
        } else {
          params.key = API_KEY;
        }

        const response = await axios.get(`${YOUTUBE_API_BASE}/playlists`, config);
        let responseData = response.data;
        if (includePrivate && authHeader) {
          responseData = await mergeOwnedHiddenPlaylists(responseData, {
            channelId, accessToken: authHeader, axios, YOUTUBE_API_BASE, isFirstPage: !pageToken,
          });
        }
        await consumeQuota(req, { billable: true });
        await serverCache.set(cacheKey, responseData, YT_DATA_CACHE_TTL_MS.PLAYLISTS);
        res.json(responseData);
      } catch (error) {
        handleApiError(error, res);
      }
    },
  );

  // Refresh the Postgres playlist read-model for one channel, on demand.
  //
  // The 6-hour ingestion cron keeps this fresh automatically -- this is the
  // escape hatch for "the catalog looks stale and I want it now". Unlike the
  // admin-only POST /admin/ingestion/refresh-channel it reuses the caller's own
  // OAuth Authorization header (no refresh-token handshake) and re-syncs
  // playlists only; video/metric ingestion stays on the cron.
  //
  // This refreshes the read-model, so playlist consumers that read from it
  // (e.g. the chat tools) see the new data immediately. Request-scoped L1
  // entries for this channel keep their own TTL.
  router.post(
    "/:channelId/refresh",
    resolveUser, checkPremiumAccess("playlists"), requireQuota("playlists"),
    async (req, res) => {
      try {
        const { channelId } = req.params;
        const authHeader = req.headers.authorization;
        if (!authHeader) {
          return res.status(400).json({
            error: { message: "A YouTube access token is required to refresh playlists." },
          });
        }
        if (typeof syncChannelPlaylists !== "function") {
          return res.status(503).json({
            error: { message: "Playlist sync is not available." },
          });
        }
        // Non-admins may only refresh a channel they have connected. Admins can
        // refresh any channel (mirrors the optimizer/audit ownership rules).
        if (!ownership.isAdminRequest(req)) {
          const owned = await ownership.getConnectedChannelIds(req);
          if (!owned.includes(channelId)) {
            return res.status(403).json({
              error: { message: "You don't have access to this channel." },
            });
          }
        }

        const result = await syncChannelPlaylists(channelId, authHeader);
        await consumeQuota(req, { billable: true });
        console.log(`[Playlists] On-demand refresh ${channelId}:`, result);
        res.json({ message: "Playlist catalog refreshed", ...result });
      } catch (error) {
        handleApiError(error, res);
      }
    },
  );

  return router;
}

module.exports = { createPlaylistsRouter };

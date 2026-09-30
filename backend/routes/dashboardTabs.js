/**
 * Dashboard tab endpoints -- one combined endpoint per tab so each tab switch
 * consumes exactly 1 quota unit regardless of how many YouTube API calls are
 * needed internally.
 *
 *   POST /dashboard/tab/channel   -- Channel Analytics: daily chart + multi-period stats
 *   POST /dashboard/tab/videos    -- Video catalog + analytics bundle
 *   POST /dashboard/tab/playlists -- Playlist catalog + analytics bundle
 *   POST /dashboard/tab/audience  -- Audience dimensions bundle (7d/30d/90d × current/prev)
 */

const express = require("express");

function createDashboardTabsRouter(deps) {
  const {
    resolveUser, resolveOrgToken, analyticsReadLimiter,
    checkPremiumAccess, requireQuota, consumeQuota,
    generateDashboardBundle, generateChannelVideos, generateDimensions,
    generateBestTimeToPost, generateBestTimeToPostFromDb,
    generateRetentionByHour, generateRetentionByPublishHour,
    generateAudienceActiveTime, generateAudienceActiveTimeFromDb,
    createDashboardYtReport,
    serverCache, handleApiError,
    axios, shortHash, youtubeDataScope, YT_DATA_CACHE_TTL_MS, API_KEY, YOUTUBE_API_BASE,
    mergeOwnedHiddenPlaylists,
    ANALYTICS_SOURCE, isPostgresConfigured,
    loadBundleFromPostgres, getLatestMetricDate,
  } = deps;
  const router = express.Router();

  // ── Helpers ────────────────────────────────────────────────────────────────────

  function computePeriodWindow(endRef, windowDays, offsetDays = 0) {
    const endC = new Date(endRef.getTime() - offsetDays * 86400000);
    const endCurr = endC.toISOString().split("T")[0];
    const startCurr = new Date(endC.getTime() - (windowDays - 1) * 86400000).toISOString().split("T")[0];
    const endPrev = new Date(new Date(startCurr).getTime() - 86400000).toISOString().split("T")[0];
    const startPrev = new Date(new Date(endPrev).getTime() - (windowDays - 1) * 86400000).toISOString().split("T")[0];
    return {
      curr: { startDate: startCurr, endDate: endCurr },
      prev: { startDate: startPrev, endDate: endPrev },
    };
  }

  // ── Channel-tab metric groups ──────────────────────────────────────────────────
  // YouTube rejects some metric combinations with 400 "The query is not
  // supported" -- e.g. viewerPercentage and the concurrent-viewer metrics are
  // not valid in a plain day time series. Each group below is individually
  // supported, is fetched as its own report, and is merged back together; a
  // failed group degrades to zeros instead of failing the whole tab.
  const CHANNEL_CORE_METRICS =
    "views,subscribersGained,subscribersLost,estimatedMinutesWatched,likes,shares,comments";
  // averageViewDuration + engagedViews combine cleanly; viewerPercentage is NOT
  // accepted in a day time series by many channels, so it gets its own call --
  // otherwise one unsupported metric would zero out its whole group.
  const CHANNEL_DURATION_METRICS = "averageViewDuration,engagedViews";
  const CHANNEL_VIEWER_PCT_METRICS = "viewerPercentage";
  const CHANNEL_CARD_METRICS =
    "cardImpressions,cardClicks,cardClickRate,cardTeaserImpressions,cardTeaserClicks,cardTeaserClickRate";
  const CHANNEL_LIVE_METRICS = "averageConcurrentViewers,peakConcurrentViewers";
  // Merged column order (index 0 = day). The frontend flattener reads positions
  // 1-18 positionally, so this order must stay stable.
  const CHANNEL_ALL_METRICS = [
    ...CHANNEL_CORE_METRICS.split(","),
    ...CHANNEL_DURATION_METRICS.split(","),
    ...CHANNEL_VIEWER_PCT_METRICS.split(","),
    ...CHANNEL_CARD_METRICS.split(","),
    ...CHANNEL_LIVE_METRICS.split(","),
  ];
  const EMPTY_CHANNEL_REPORT = { rows: [], columnHeaders: [] };

  /**
   * Fetches one window as independent metric-group reports and merges them into
   * a single synthetic report shaped like a YouTube Analytics response
   * ({ columnHeaders, rows }) whose column order matches CHANNEL_ALL_METRICS.
   */
  async function fetchMergedChannelWindow(ytReport, w) {
    const [core, duration, viewerPct, cards, live] = await Promise.all([
      ytReport({ ...w, metrics: CHANNEL_CORE_METRICS, dimensions: "day", sort: "day" }),
      ytReport({ ...w, metrics: CHANNEL_DURATION_METRICS, dimensions: "day", sort: "day" }).catch(() => EMPTY_CHANNEL_REPORT),
      ytReport({ ...w, metrics: CHANNEL_VIEWER_PCT_METRICS, dimensions: "day", sort: "day" }).catch(() => EMPTY_CHANNEL_REPORT),
      ytReport({ ...w, metrics: CHANNEL_CARD_METRICS, dimensions: "day", sort: "day" }).catch(() => EMPTY_CHANNEL_REPORT),
      ytReport({ ...w, metrics: CHANNEL_LIVE_METRICS, dimensions: "day", sort: "day" }).catch(() => EMPTY_CHANNEL_REPORT),
    ]);

    const byDate = new Map();
    for (const part of [core, duration, viewerPct, cards, live]) {
      const headers = ((part && part.columnHeaders) || []).map((h) => h.name);
      for (const row of (part && part.rows) || []) {
        const date = String(row[0]);
        let rec = byDate.get(date);
        if (!rec) {
          rec = Object.fromEntries(CHANNEL_ALL_METRICS.map((m) => [m, 0]));
          byDate.set(date, rec);
        }
        headers.forEach((name, i) => {
          if (i > 0 && name in rec) rec[name] = Number(row[i] || 0);
        });
      }
    }

    const dates = Array.from(byDate.keys()).sort();
    return {
      columnHeaders: [
        { name: "day", columnType: "DIMENSION", dataType: "STRING" },
        ...CHANNEL_ALL_METRICS.map((m) => ({ name: m, columnType: "METRIC", dataType: "NUMBER" })),
      ],
      rows: dates.map((d) => [d, ...CHANNEL_ALL_METRICS.map((m) => byDate.get(d)[m] || 0)]),
    };
  }

  // ── POST /dashboard/tab/channel ────────────────────────────────────────────────
  // Channel analytics: daily chart + 7d/30d/90d multi-period stats + videosUploaded.
  // Moves the frontend's useChannelAnalyticsQuery logic server-side so 7 YT Analytics
  // report calls become 1 quota unit.
  router.post(
    "/tab/channel",
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

        const { channelId, period, startDate, startDate: sd, endDate, trueDelta, latestDate, videosLength } = req.body;
        if (!channelId)
          return res.status(400).json({ error: { message: "Missing channelId" } });

        const ytReport = createDashboardYtReport(channelId, accessToken);

        // ── Resolve latestDate ──────────────────────────────────────────────────
        // Try server-cached probe first (set by analyticsService with 60-min TTL).
        // If the client sent a stale date and a fresher cached probe exists, use it.
        // If neither is available, probe YouTube for the most recent day with data.
        // Return the resolved date so the frontend can persist it and break the
        // stale-date chain.
        const LATEST_DATE_CACHE_TTL = 60 * 60 * 1000;
        const latestDateCacheKey = `latestDate:${channelId}`;

        let resolvedLatestDate = latestDate;
        const cachedLatest = await serverCache.get(latestDateCacheKey);
        if (cachedLatest) {
          // Server has a cached probe -- prefer it over the client-sent value
          // (it's at most 60 minutes old and represents a real API response).
          resolvedLatestDate = cachedLatest;
        }

        if (!resolvedLatestDate) {
          // No cache hit and no client date -- probe YouTube for the latest day
          try {
            const today = new Date();
            const endProbe = today.toISOString().split("T")[0];
            const startProbe = new Date(today.getTime() - 7 * 86400000).toISOString().split("T")[0];
            const probe = await ytReport({
              startDate: startProbe,
              endDate: endProbe,
              metrics: "views",
              dimensions: "day",
              sort: "-day",
              maxResults: 1,
            });
            resolvedLatestDate =
              probe.rows?.[0]?.[0] ??
              new Date(today.getTime() - 2 * 86400000).toISOString().split("T")[0];
            await serverCache.set(latestDateCacheKey, resolvedLatestDate, LATEST_DATE_CACHE_TTL);
          } catch {
            resolvedLatestDate = new Date(Date.now() - 2 * 86400000).toISOString().split("T")[0];
          }
        }

        // ── Resolve latestDate from PostgreSQL when available ──
        // The client may send a stale latestDate (e.g. Jul 5) cached from a prior
        // session (either in Redis or in the client's own localStorage/Zustand).
        // This check runs on every uncached request -- including when cachedLatest
        // is a stale probe -- so Postgres can always correct the anchor date.
        if (ANALYTICS_SOURCE === "postgres-first" && isPostgresConfigured()) {
          try {
            const pgLatest = await getLatestMetricDate(channelId, '');
            if (pgLatest && pgLatest !== resolvedLatestDate) {
              console.log(`[Dashboard Tab Channel] latestDate override: ${resolvedLatestDate} → ${pgLatest} (from Postgres)`);
              resolvedLatestDate = pgLatest;
            }
          } catch (err) {
            console.warn('[Dashboard Tab Channel] Failed to resolve latestDate from Postgres:', err.message);
          }
        }

        // Warm the cache with the (now-corrected) resolvedLatestDate so
        // subsequent requests for other tabs benefit without re-probing.
        if (!cachedLatest && latestDate) {
          await serverCache.set(latestDateCacheKey, resolvedLatestDate, LATEST_DATE_CACHE_TTL);
        }

        // Anchor end ref
        const endRef = new Date(resolvedLatestDate);

        const hasCustom = !!(startDate && endDate);
        const curr = hasCustom
          ? { startDate, endDate }
          : (() => {
              const end = endRef.toISOString().split("T")[0];
              const start = new Date(endRef.getTime() - ((period || 30) - 1) * 86400000).toISOString().split("T")[0];
              return { startDate: start, endDate: end };
            })();

        const td = !!trueDelta;
        const p7 = computePeriodWindow(endRef, td ? 8 : 7);
        const p30 = computePeriodWindow(endRef, td ? 38 : 30);
        const p90 = computePeriodWindow(endRef, td ? 38 : 90);

        // Fetch channel data and multi-period stats in parallel. Every window is
        // assembled from independent metric-group reports (see
        // fetchMergedChannelWindow) so an unsupported metric combo degrades to
        // zeros for its group instead of failing the whole tab with a 400.
        const [current, d7c, d7p, d30c, d30p, d90c, d90p] = await Promise.all([
          fetchMergedChannelWindow(ytReport, curr),
          fetchMergedChannelWindow(ytReport, p7.curr),
          fetchMergedChannelWindow(ytReport, p7.prev),
          fetchMergedChannelWindow(ytReport, p30.curr),
          fetchMergedChannelWindow(ytReport, p30.prev),
          fetchMergedChannelWindow(ytReport, p90.curr),
          fetchMergedChannelWindow(ytReport, p90.prev),
        ]);

        const currRows = current.rows || [];

        // Compute total aggregates for the current period
        // NOTE: videosLength is the client's loaded catalog size (a lifetime
        // count), NOT uploads within the period. The frontend
        // (useChannelTabQuery) overrides this field with the true
        // uploads-in-window count derived from publish dates; the echoed
        // catalog length is kept only for backward compatibility.
        const videosInWindow = typeof videosLength === "number" && videosLength > 0
          ? videosLength
          : 0;
        const channelAnalyticsData = {
          views: currRows.reduce((s, r) => s + Number(r[1] || 0), 0),
          subscribersGained: currRows.reduce((s, r) => s + Number(r[2] || 0), 0),
          subscribersLost: currRows.reduce((s, r) => s + Number(r[3] || 0), 0),
          watchTime: currRows.reduce((s, r) => s + Number(r[4] || 0), 0),
          likes: currRows.reduce((s, r) => s + Number(r[5] || 0), 0),
          shares: currRows.reduce((s, r) => s + Number(r[6] || 0), 0),
          comments: currRows.reduce((s, r) => s + Number(r[7] || 0), 0),
          averageViewDuration: currRows.reduce((s, r) => s + Number(r[8] || 0), 0),
          engagedViews: currRows.reduce((s, r) => s + Number(r[9] || 0), 0),
          viewerPercentage: currRows.reduce((s, r) => s + Number(r[10] || 0), 0),
          cardImpressions: currRows.reduce((s, r) => s + Number(r[11] || 0), 0),
          cardClicks: currRows.reduce((s, r) => s + Number(r[12] || 0), 0),
          cardClickRate: currRows.reduce((s, r) => s + Number(r[13] || 0), 0),
          cardTeaserImpressions: currRows.reduce((s, r) => s + Number(r[14] || 0), 0),
          cardTeaserClicks: currRows.reduce((s, r) => s + Number(r[15] || 0), 0),
          cardTeaserClickRate: currRows.reduce((s, r) => s + Number(r[16] || 0), 0),
          averageConcurrentViewers: currRows.reduce((s, r) => s + Number(r[17] || 0), 0),
          peakConcurrentViewers: currRows.reduce((s, r) => s + Number(r[18] || 0), 0),
          videosUploaded: videosInWindow,
        };

        // Build chart data (daily rows)
        const channelAnalyticsChartData = currRows.map((row) => ({
          date: row[0],
          views: Number(row[1] || 0),
          subscribersGained: Number(row[2] || 0),
          subscribersLost: Number(row[3] || 0),
          watchTime: Number(row[4] || 0),
          likes: Number(row[5] || 0),
          shares: Number(row[6] || 0),
          comments: Number(row[7] || 0),
          averageViewDuration: Number(row[8] || 0),
          engagedViews: Number(row[9] || 0),
          viewerPercentage: Number(row[10] || 0),
          cardImpressions: Number(row[11] || 0),
          cardClicks: Number(row[12] || 0),
          cardClickRate: Number(row[13] || 0),
          cardTeaserImpressions: Number(row[14] || 0),
          cardTeaserClicks: Number(row[15] || 0),
          cardTeaserClickRate: Number(row[16] || 0),
          averageConcurrentViewers: Number(row[17] || 0),
          peakConcurrentViewers: Number(row[18] || 0),
        }));

        const channelMultiPeriodStats = {
          d7: { current: d7c, previous: d7p },
          d30: { current: d30c, previous: d30p },
          d90: { current: d90c, previous: d90p },
        };

        await consumeQuota(req);
        res.json({
          channelAnalyticsData,
          channelAnalyticsChartData,
          channelMultiPeriodStats,
          latestDate: resolvedLatestDate,
        });
      } catch (error) {
        console.error("[Dashboard Tab Channel] Error:", error.response?.data || error.message);
        handleApiError(error, res);
      }
    },
  );

  // ── POST /dashboard/tab/videos ─────────────────────────────────────────────────
  // Video catalog + analytics bundle in one round-trip.
  router.post(
    "/tab/videos",
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

        const { channelId, period, startDate, endDate, compare, trueDelta, filters, latestDate, maxResults } = req.body;
        if (!channelId)
          return res.status(400).json({ error: { message: "Missing channelId" } });

        const orgId = req.headers["x-org-id"];
        const scope = orgId && req._orgRefreshToken
          ? `org:${String(orgId)}:${channelId}`
          : req.authUser?.email || shortHash(accessToken);

        // Exact status requested by the videos filter (backward-compat with includePrivate).
        const rawPrivacy = typeof req.body?.privacy === "string" ? req.body.privacy.toLowerCase() : null;
        const privacy = ["public", "private", "unlisted", "all"].includes(rawPrivacy)
          ? rawPrivacy
          : (req.body?.includePrivate === true ? "all" : "public");

        // Fire video catalog + dashboard bundle in parallel
        const [videos, bundle] = await Promise.all([
          generateChannelVideos({
            channelId,
            maxResults: maxResults ?? 500,
            accessToken,
            cacheScope: scope,
            orgRefreshToken: req._orgRefreshToken,
            req,
            privacy,
          }),
          generateDashboardBundle({
            channelId, period, startDate, endDate,
            compare: compare !== false,
            trueDelta: !!trueDelta,
            filters,
            clientLatestDate: latestDate,
            accessToken, fields: ["channelTotals", "chartData", "comparison"], req,
          }),
        ]);

        await consumeQuota(req);
        // Videos come back pre-filtered to the requested status, so a plain slice is safe.
        const sliced =
          typeof maxResults !== "number"
            ? videos
            : videos.slice(0, maxResults);
        res.json({ items: sliced, bundle });
      } catch (error) {
        console.error("[Dashboard Tab Videos] Error:", error.response?.data || error.message);
        handleApiError(error, res);
      }
    },
  );

  // ── POST /dashboard/tab/playlists ──────────────────────────────────────────────
  // Playlist catalog + analytics bundle in one round-trip.
  router.post(
    "/tab/playlists",
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

        const { channelId, period, startDate, endDate, compare, trueDelta, filters, latestDate, pageToken: ptRaw, maxResults: mrRaw } = req.body;
        if (!channelId)
          return res.status(400).json({ error: { message: "Missing channelId" } });

        const mr = mrRaw || 50;
        const pt = ptRaw || "";
        const scope = youtubeDataScope(req, !!accessToken);
        const includePrivate = req.body?.includePrivate === true && !!accessToken;
        const playlistCacheKey = `yt:dsh:pl:list:${scope}:${channelId}:mr${mr}:pt${shortHash(pt)}${includePrivate ? ":p1" : ""}`;

        // Try playlist cache first
        let playlistsData = await serverCache.get(playlistCacheKey);
        if (!playlistsData) {
          const params = { part: "snippet,contentDetails,status", channelId, maxResults: mr };
          if (ptRaw) params.pageToken = ptRaw;
          const config = { params };
          if (accessToken) config.headers = { Authorization: accessToken };
          else params.key = API_KEY;

          const apiResponse = await axios.get(`${YOUTUBE_API_BASE}/playlists`, config);
          let responseData = apiResponse.data;
          if (includePrivate) {
            responseData = await mergeOwnedHiddenPlaylists(responseData, {
              channelId, accessToken, axios, YOUTUBE_API_BASE, isFirstPage: !ptRaw,
            });
          }
          await serverCache.set(playlistCacheKey, responseData, YT_DATA_CACHE_TTL_MS.PLAYLISTS);
          playlistsData = responseData;
        }

        // Fetch analytics bundle
        const bundle = await generateDashboardBundle({
          channelId, period, startDate, endDate,
          compare: compare !== false,
          trueDelta: !!trueDelta,
          filters,
          clientLatestDate: latestDate,
          accessToken, fields: ["channelTotals", "chartData", "comparison"], req,
        });

        await consumeQuota(req);
        res.json({ playlists: playlistsData, bundle });
      } catch (error) {
        console.error("[Dashboard Tab Playlists] Error:", error.response?.data || error.message);
        handleApiError(error, res);
      }
    },
  );

  // ── POST /dashboard/tab/audience ───────────────────────────────────────────────
  // Audience dimensions for 7d/30d/90d windows with comparison periods.
  // Moves the frontend's useDimensionsQuery logic server-side so 3–6
  // getDimensionsBundle calls become 1 quota unit.
  router.post(
    "/tab/audience",
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

        const { channelId, filters, latestDate, customStartDate, customEndDate } = req.body;
        if (!channelId || !latestDate)
          return res.status(400).json({ error: { message: "Missing channelId or latestDate" } });

        const endRef = latestDate ? new Date(latestDate) : new Date();
        const hasCustom = !!(customStartDate && customEndDate);
        const anchorEnd = hasCustom ? new Date(customEndDate) : endRef;

        const fetchBundle = (start, end) =>
          generateDimensions({
            channelId, startDate: start, endDate: end, filters, accessToken, req,
          });

        const rollingCurrent = (end, days) => {
          const endDate = end.toISOString().split("T")[0];
          const startDate = new Date(end.getTime() - (days - 1) * 86400000).toISOString().split("T")[0];
          return { startDate, endDate };
        };
        const rollingPrevious = (end, days) => {
          const prevEnd = new Date(end.getTime() - days * 86400000);
          const prevStart = new Date(end.getTime() - (2 * days - 1) * 86400000);
          return {
            startDate: prevStart.toISOString().split("T")[0],
            endDate: prevEnd.toISOString().split("T")[0],
          };
        };

        const w7c = rollingCurrent(anchorEnd, 7);
        const w7p = rollingPrevious(anchorEnd, 7);
        const w30c = rollingCurrent(anchorEnd, 30);
        const w30p = rollingPrevious(anchorEnd, 30);
        const w90c = rollingCurrent(anchorEnd, 90);
        const w90p = rollingPrevious(anchorEnd, 90);

        // Fetch standard rolling windows: 7d, 30d, 90d
        const [b7c, b30c, b90c] = await Promise.all([
          fetchBundle(w7c.startDate, w7c.endDate),
          fetchBundle(w30c.startDate, w30c.endDate),
          fetchBundle(w90c.startDate, w90c.endDate),
        ]);

        let b7p = null, b30p = null, b90p = null;
        try {
          [b7p, b30p, b90p] = await Promise.all([
            fetchBundle(w7p.startDate, w7p.endDate),
            fetchBundle(w30p.startDate, w30p.endDate),
            fetchBundle(w90p.startDate, w90p.endDate),
          ]);
        } catch {
          // comparison windows are optional
        }

        // When a custom date range is active, also fetch a primary window that
        // spans the full user-chosen range (instead of clamping to 30d).
        let bCustomC = null, bCustomP = null;
        if (hasCustom) {
          const cDuration = Math.max(1, Math.round(
            (new Date(customEndDate) - new Date(customStartDate)) / 86400000
          ) + 1);
          const customPrevStart = new Date(
            new Date(customStartDate).getTime() - cDuration * 86400000
          ).toISOString().split("T")[0];
          const customPrevEnd = new Date(
            new Date(customStartDate).getTime() - 86400000
          ).toISOString().split("T")[0];

          bCustomC = await fetchBundle(customStartDate, customEndDate);
          try {
            bCustomP = await fetchBundle(customPrevStart, customPrevEnd);
          } catch {
            // comparison is optional
          }
        }

        // Fetch retention trend -- use custom date range when active, else standard 30d window
        const retentionWindow = hasCustom
          ? { startDate: customStartDate, endDate: customEndDate }
          : rollingCurrent(anchorEnd, 30);
        let retention = null;
        try {
          retention = await generateRetentionByHour({
            channelId, accessToken, req,
            startDate: retentionWindow.startDate,
            endDate: retentionWindow.endDate,
          });
        } catch {
          // retention is optional
        }

        await consumeQuota(req);
        res.json({
          d7: { current: b7c, previous: b7p },
          d30: { current: b30c, previous: b30p },
          d90: { current: b90c, previous: b90p },
          ...(bCustomC ? { dCustom: { current: bCustomC, previous: bCustomP } } : {}),
          retention,
        });
      } catch (error) {
        console.error("[Dashboard Tab Audience] Error:", error.response?.data || error.message);
        handleApiError(error, res);
      }
    },
  );

  // ── POST /dashboard/tab/insights ─────────────────────────────────────────────
  // Best Time to Post + Audience Retention by hour. 1 endpoint = 1 quota unit.
  router.post(
    "/tab/insights",
    analyticsReadLimiter,
    resolveUser,
    resolveOrgToken((req) => req.body?.channelId),
    checkPremiumAccess("dashboard"),
    requireQuota("dashboard"),
    async (req, res) => {
      try {
        console.log("[Insights Tab Hit] channel:", req.body?.channelId, "period:", req.body?.period);
        const accessToken = req.headers.authorization;
        if (!accessToken)
          return res.status(401).json({ error: { message: "Missing Authorization header" } });

        const { channelId, period, latestDate, startDate, endDate, timezone, segment } = req.body;
        if (!channelId)
          return res.status(400).json({ error: { message: "Missing channelId" } });

        const hasCustomRange = !!(startDate && endDate);
        const scope = youtubeDataScope(req, !!accessToken);

        // ── DB-first: Try Postgres-powered best time to post ─────────────
        let bestTimeToPostV2 = null;
        try {
          bestTimeToPostV2 = await generateBestTimeToPostFromDb({
            channelId,
            period: period || 30,
            startDate: hasCustomRange ? startDate : undefined,
            endDate: hasCustomRange ? endDate : undefined,
            scope,
            timezone: timezone || 'UTC',
            segment: segment || 'all',
          });
        } catch (dbErr) {
          console.warn("[Insights] DB-powered analysis failed, falling back to YT API:", dbErr.message);
        }

        // ── YT API: bestTimeToPost (only as fallback), retention, publish hour ──
        const ytCalls = [
          // Best time to post: only call YT API if DB didn't produce results
          bestTimeToPostV2
            ? Promise.resolve(null)
            : generateBestTimeToPost({
                channelId, accessToken,
                period: period || 30,
                startDate: hasCustomRange ? startDate : undefined,
                endDate: hasCustomRange ? endDate : undefined,
                latestDate: latestDate || undefined,
                scope, req,
              }),
          // Retention trend still uses YT Analytics API (daily time series)
          generateRetentionByHour({
            channelId, accessToken,
            period: period || 30,
            startDate: hasCustomRange ? startDate : undefined,
            endDate: hasCustomRange ? endDate : undefined,
            latestDate: latestDate || undefined,
            scope, req,
          }),
          // Publish hour analysis with timezone-aware hour extraction
          generateRetentionByPublishHour({
            channelId, accessToken,
            period: period || 30,
            startDate: hasCustomRange ? startDate : undefined,
            endDate: hasCustomRange ? endDate : undefined,
            latestDate: latestDate || undefined,
            scope, req,
            timezone: timezone || 'UTC',
          }),
          // Audience active time -- day-of-week breakdown by metric
          generateAudienceActiveTime({
            channelId, accessToken,
            period: period || 30,
            startDate: hasCustomRange ? startDate : undefined,
            endDate: hasCustomRange ? endDate : undefined,
            latestDate: latestDate || undefined,
            scope, req,
          }),
        ];

        const [bestTimeToPost, retention, retentionByPublishHour, audienceActiveTime] = await Promise.all(ytCalls);

        // ── Subscriber enrichment for V2 ──────────────────────────────────
        // When V2 data exists (DB-powered), fetch daily subscribersGained
        // from YT Analytics and find the best day of week for subscribers.
        if (bestTimeToPostV2) {
          try {
            const sRefEnd = endDate
              ? new Date(endDate)
              : latestDate
                ? new Date(latestDate)
                : new Date();
            const sRefStart = startDate
              ? new Date(startDate)
              : new Date(sRefEnd.getTime() - (period || 30) * 86400000);
            const sfEnd = sRefEnd.toISOString().split("T")[0];
            const sfStart = sRefStart.toISOString().split("T")[0];

            const subCacheKey = `subs:dow:${channelId}:${sfStart}:${sfEnd}`;
            let subResult = await serverCache.get(subCacheKey);

            if (!subResult) {
              const subResponse = await axios.get(
                "https://youtubeanalytics.googleapis.com/v2/reports",
                {
                  params: {
                    ids: `channel==${channelId}`,
                    startDate: sfStart,
                    endDate: sfEnd,
                    metrics: "subscribersGained",
                    dimensions: "day",
                    sort: "day",
                  },
                  headers: { Authorization: accessToken },
                },
              );
              const subRows = subResponse.data?.rows || [];
              if (subRows.length > 0) {
                const subByDOW = new Array(7).fill(0);
                for (const r of subRows) {
                  const dow = new Date(r[0] + "T00:00:00Z").getUTCDay();
                  subByDOW[dow] += Number(r[1] || 0);
                }
                let bestSubDay = 0;
                let maxSubs = subByDOW[0];
                for (let d = 1; d < 7; d++) {
                  if (subByDOW[d] > maxSubs) {
                    maxSubs = subByDOW[d];
                    bestSubDay = d;
                  }
                }
                const DAY_LABELS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
                subResult = {
                  bestDay: bestSubDay,
                  bestDayLabel: DAY_LABELS[bestSubDay],
                  subscribersByDayOfWeek: subByDOW,
                };
                await serverCache.set(subCacheKey, subResult, 12 * 60 * 60 * 1000);
              }
            }

            if (subResult) {
              bestTimeToPostV2.bestDayForSubscribers = subResult.bestDay;
              bestTimeToPostV2.bestDayForSubscribersLabel = subResult.bestDayLabel;
              bestTimeToPostV2.subscribersByDayOfWeek = subResult.subscribersByDayOfWeek;
            }
          } catch (subErr) {
            console.warn("[Insights] Subscriber enrichment failed:", subErr.message);
          }
        }
        // ── end subscriber enrichment ─────────────────────────────────────

        // ── DB-Powered Audience Active Time (view-velocity estimate) ──────
        let estimatedAudienceActiveTime = null;
        try {
          estimatedAudienceActiveTime = await generateAudienceActiveTimeFromDb({
            channelId,
            period: period || 30,
            timezone: timezone || 'UTC',
            startDate: hasCustomRange ? startDate : undefined,
            endDate: hasCustomRange ? endDate : undefined,
            scope,
            req,
          });
        } catch (dbErr) {
          console.warn('[Insights] AudienceActiveTime(Db) failed:', dbErr.message);
        }

        await consumeQuota(req);
        res.json({ bestTimeToPost, bestTimeToPostV2, retention, retentionByPublishHour, audienceActiveTime, estimatedAudienceActiveTime });
      } catch (error) {
        console.error("[Dashboard Tab Insights] Error:", error.response?.data || error.message);
        handleApiError(error, res);
      }
    },
  );

  return router;
}

module.exports = { createDashboardTabsRouter };

/**
 * Core analytics service functions.
 *
 * Dependencies are passed in at creation time to avoid implicit coupling
 * to module-level globals.
 */
function createAnalyticsService(deps) {
  const {
    serverCache,
    perfLog,
    perfNow,
    shortHash,
    isPostgresConfigured,
    loadBundleFromPostgres,
    loadSummaryFromPostgres,
    getChannelLastSyncedAt,
    getDashboardSnapshot,
    upsertDashboardSnapshot,
    ANALYTICS_SOURCE,
    axios,
  } = deps;

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function dashboardSummaryKey(
    channelId, period, startDate, endDate, compare, trueDelta, filters, clientLatestDate, scope = "pub",
  ) {
    const isPlaylistFiltered =
      typeof filters === "string" && filters.includes("playlist==");
    const mode = isPlaylistFiltered ? "playlistViews-v3" : "views";
    return `dashSummary:v3:${mode}:${scope}:${channelId}:${period || ""}:${startDate || ""}:${endDate || ""}:${compare}:${trueDelta}:${filters || ""}:${clientLatestDate || ""}`;
  }

  function normalizeDashboardFilters(filters) {
    if (typeof filters !== "string") return "";
    const trimmed = filters.trim();
    if (!trimmed) return "";
    const [lhs, rhs] = trimmed.split("==");
    if (!lhs || !rhs) return trimmed;
    const key = lhs.trim();
    if (key !== "video" && key !== "playlist") return trimmed;
    const sorted = rhs
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .sort()
      .join(",");
    return sorted ? `${key}==${sorted}` : "";
  }

  const crypto = require("crypto");
  function dashboardSnapshotKey(kind, params) {
    const normalizedFilters = normalizeDashboardFilters(params.filters);
    const raw = JSON.stringify({
      kind,
      channelId: params.channelId,
      period: params.period || null,
      startDate: params.startDate || null,
      endDate: params.endDate || null,
      compare: !!params.compare,
      trueDelta: !!params.trueDelta,
      filters: normalizedFilters,
      latestDate: params.clientLatestDate || params.latestDate || null,
      scope: params.scope || "pub",
    });
    const digest = crypto.createHash("sha1").update(raw).digest("hex");
    return {
      key: `dashSnap:${kind}:${params.channelId}:${digest}`,
      normalizedFilters,
    };
  }

  async function fetchPlaylistViewsSummed(ytReport, playlistIds, dateParams, extraParams = {}) {
    if (playlistIds.length === 0) return null;
    if (playlistIds.length === 1) {
      return ytReport({ ...dateParams, ...extraParams, filters: `playlist==${playlistIds[0]}` });
    }
    const reports = await Promise.all(
      playlistIds.map((pid) =>
        ytReport({ ...dateParams, ...extraParams, filters: `playlist==${pid}` }).catch(() => null),
      ),
    );
    const valid = reports.filter((r) => r?.rows?.length > 0);
    if (valid.length === 0) return { columnHeaders: [], rows: [] };

    const headers = valid[0].columnHeaders || [];
    const col = (name) => headers.findIndex((h) => h.name === name);
    const plViewsIdx = col("playlistViews");
    const plMinsIdx = col("playlistEstimatedMinutesWatched");
    const plAvgIdx = col("playlistAverageViewDuration");
    const plSavesIdx = col("playlistSaves");
    const plStartsIdx = col("playlistStarts");
    const plViewsPerStartIdx = col("viewsPerPlaylistStart");

    const dailyMap = new Map();
    for (const report of valid) {
      for (const row of report.rows || []) {
        const date = row[0];
        const views = plViewsIdx !== -1 ? Number(row[plViewsIdx]) || 0 : 0;
        const mins = plMinsIdx !== -1 ? Number(row[plMinsIdx]) || 0 : 0;
        const avg = plAvgIdx !== -1 ? Number(row[plAvgIdx]) || 0 : 0;
        const saves = plSavesIdx !== -1 ? Number(row[plSavesIdx]) || 0 : 0;
        const starts = plStartsIdx !== -1 ? Number(row[plStartsIdx]) || 0 : 0;
        const viewsPerStart = plViewsPerStartIdx !== -1 ? Number(row[plViewsPerStartIdx]) || 0 : 0;
        const prev = dailyMap.get(date) || {
          views: 0, mins: 0, avgSum: 0, avgViews: 0, saves: 0, starts: 0, vpsSum: 0, vpsStarts: 0,
        };
        dailyMap.set(date, {
          views: prev.views + views,
          mins: prev.mins + mins,
          avgSum: prev.avgSum + avg * views,
          avgViews: prev.avgViews + views,
          saves: prev.saves + saves,
          starts: prev.starts + starts,
          vpsSum: prev.vpsSum + viewsPerStart * starts,
          vpsStarts: prev.vpsStarts + starts,
        });
      }
    }

    const rows = Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => [
        date,
        d.views,
        d.mins,
        d.avgViews > 0 ? d.avgSum / d.avgViews : 0,
        d.saves,
        d.starts,
        d.vpsStarts > 0 ? d.vpsSum / d.vpsStarts : 0,
      ]);

    return {
      columnHeaders: [
        { name: "day", dataType: "STRING", columnType: "DIMENSION" },
        { name: "playlistViews", dataType: "INTEGER", columnType: "METRIC" },
        { name: "playlistEstimatedMinutesWatched", dataType: "FLOAT", columnType: "METRIC" },
        { name: "playlistAverageViewDuration", dataType: "FLOAT", columnType: "METRIC" },
        { name: "playlistSaves", dataType: "INTEGER", columnType: "METRIC" },
        { name: "playlistStarts", dataType: "INTEGER", columnType: "METRIC" },
        { name: "viewsPerPlaylistStart", dataType: "FLOAT", columnType: "METRIC" },
      ],
      rows,
    };
  }

  function overlayViewsFromPlaylistRows(baseReport, playlistViewsReport) {
    if (!baseReport?.rows || !playlistViewsReport?.rows) return;

    const getIdx = (report, name) =>
      report.columnHeaders?.findIndex((h) => h.name === name) ?? -1;
    const plViewsIdx = getIdx(playlistViewsReport, "playlistViews");
    const plMinsIdx = getIdx(playlistViewsReport, "playlistEstimatedMinutesWatched");
    const plAvgIdx = getIdx(playlistViewsReport, "playlistAverageViewDuration");

    const viewsByDate = new Map(
      (playlistViewsReport.rows || []).map((r) => [
        r[0],
        {
          views: plViewsIdx !== -1 ? Number(r[plViewsIdx]) || 0 : 0,
          mins: plMinsIdx !== -1 ? Number(r[plMinsIdx]) || 0 : 0,
          avg: plAvgIdx !== -1 ? Number(r[plAvgIdx]) || 0 : 0,
        },
      ]),
    );

    const viewsIdx = getIdx(baseReport, "views");
    const minsIdx = getIdx(baseReport, "estimatedMinutesWatched");
    const pctIdx = getIdx(baseReport, "averageViewPercentage");

    baseReport.rows = (baseReport.rows || []).map((row) => {
      const next = [...row];
      const data = viewsByDate.get(row[0]);
      if (data) {
        if (viewsIdx !== -1) next[viewsIdx] = data.views;
        else next[1] = data.views;
        if (minsIdx !== -1) next[minsIdx] = data.mins;
        else next[2] = data.mins;
        if (pctIdx !== -1 && data.avg > 0) next[pctIdx] = data.avg;
        else if (pctIdx === -1 && data.avg > 0 && next.length > 3) next[3] = data.avg;
      } else {
        if (viewsIdx !== -1) next[viewsIdx] = 0;
        else next[1] = 0;
        if (minsIdx !== -1) next[minsIdx] = 0;
        else next[2] = 0;
      }
      return next;
    });
  }

  function createDashboardYtReport(channelId, accessToken) {
    const ids = `channel==${channelId}`;
    const ytHeaders = { Authorization: accessToken };
    return async (params) => {
      const reportStart = perfNow();
      try {
        const response = await axios.get(
          "https://youtubeanalytics.googleapis.com/v2/reports",
          { params: { ids, ...params }, headers: ytHeaders },
        );
        perfLog("dashboard.bundle.ytReport", reportStart, {
          metrics: params.metrics,
          dimensions: params.dimensions || null,
          hasFilters: !!params.filters,
          startDate: params.startDate,
          endDate: params.endDate,
        });
        return response.data;
      } catch (err) {
        console.error("[ytReport] Bundle Error details:", {
          url: "https://youtubeanalytics.googleapis.com/v2/reports",
          params: { ids, ...params },
          error: err.response?.data?.error || err.message,
        });
        throw err;
      }
    };
  }

  // ── Pill computation ─────────────────────────────────────────────────────────

  function avgOrZero(rows, idx) {
    const valid = (rows || []).filter(
      (r) => r[idx] !== undefined && r[idx] !== null && !isNaN(Number(r[idx])) && Number(r[idx]) !== 0,
    );
    if (!valid.length) return 0;
    return valid.reduce((s, r) => s + Number(r[idx]), 0) / valid.length;
  }

  async function computeDashboardPillsOnly({
    channelId, period, startDate, endDate, trueDelta, filters, clientLatestDate, accessToken,
  }) {
    const ytReport = createDashboardYtReport(channelId, accessToken);
    const hasPlaylistFilter =
      typeof filters === "string" && filters.includes("playlist==");

    let latestDate = clientLatestDate;
    if (!latestDate) {
      const latestDateCacheKey = `latestDate:${channelId}`;
      const cachedLatestDate = await serverCache.get(latestDateCacheKey);

      if (cachedLatestDate) {
        latestDate = cachedLatestDate;
        console.log("[Cache] Latest date HIT:", latestDate);
      } else {
        const today = new Date();
        const endProbe = today.toISOString().split("T")[0];
        const startProbe = new Date(today.getTime() - 7 * 86400000).toISOString().split("T")[0];
        try {
          const probe = await ytReport({
            startDate: startProbe,
            endDate: endProbe,
            metrics: "views",
            dimensions: "day",
            sort: "-day",
            maxResults: 1,
          });
          latestDate =
            probe.rows?.[0]?.[0] ??
            new Date(today.getTime() - 2 * 86400000).toISOString().split("T")[0];
        } catch {
          latestDate = new Date(today.getTime() - 2 * 86400000).toISOString().split("T")[0];
        }
        await serverCache.set(latestDateCacheKey, latestDate, 60 * 60 * 1000);
        console.log("[Cache] Latest date WRITE:", latestDate);
      }
    }

    const endRef = new Date(latestDate);

    const periodWindow = (windowDays, offsetDays = 0) => {
      const endCurr = new Date(endRef.getTime() - offsetDays * 86400000).toISOString().split("T")[0];
      const startCurr = new Date(new Date(endCurr).getTime() - (windowDays - 1) * 86400000).toISOString().split("T")[0];
      const endPrev = new Date(new Date(startCurr).getTime() - 86400000).toISOString().split("T")[0];
      const startPrev = new Date(new Date(endPrev).getTime() - (windowDays - 1) * 86400000).toISOString().split("T")[0];
      return {
        curr: { startDate: startCurr, endDate: endCurr },
        prev: { startDate: startPrev, endDate: endPrev },
      };
    };

    const p7 = periodWindow(trueDelta ? 8 : 7, 0);
    const p30 = periodWindow(30, trueDelta ? 8 : 0);
    const p90 = periodWindow(90, trueDelta ? 38 : 0);

    const periodMetrics = "views,estimatedMinutesWatched,averageViewPercentage,averageViewDuration";
    const statsRangeStart = p90.prev.startDate;
    const statsRangeEnd = p7.curr.endDate;

    const computeWindowStats = (videoRows, subRows, window) => {
      const inWindow = (date) => date >= window.startDate && date <= window.endDate;
      const periodVideoRows = (videoRows || []).filter((r) => inWindow(r[0]));
      const periodSubRows = (subRows || []).filter((r) => inWindow(r[0]));
      const validRetention = periodVideoRows.filter((r) => r[3] !== null && !isNaN(Number(r[3])));
      const num = (r, i) => (r[i] !== undefined && r[i] !== null ? Number(r[i]) : 0);

      const gained = periodSubRows.reduce((s, r) => s + num(r, 1), 0);
      const lost = periodSubRows.reduce((s, r) => s + num(r, 2), 0);

      return {
        views: periodVideoRows.reduce((s, r) => s + num(r, 1), 0),
        watchTime: periodVideoRows.reduce((s, r) => s + num(r, 2), 0),
        subscribers: gained - lost,
        subscribersGained: gained,
        subscribersLost: lost,
        likes: periodSubRows.reduce((s, r) => s + num(r, 3), 0),
        shares: periodSubRows.reduce((s, r) => s + num(r, 4), 0),
        comments: periodSubRows.reduce((s, r) => s + num(r, 5), 0),
        retention:
          validRetention.length > 0
            ? validRetention.reduce((s, r) => s + Number(r[3]), 0) / validRetention.length
            : 0,
        averageViewDuration: avgOrZero(periodVideoRows, 4),
        engagedViews: 0,
        viewerPercentage: 0,
        cardImpressions: 0,
        cardClicks: 0,
        cardClickRate: 0,
        cardTeaserImpressions: 0,
        cardTeaserClicks: 0,
        cardTeaserClickRate: 0,
        averageConcurrentViewers: 0,
        peakConcurrentViewers: 0,
        playlistSaves: periodVideoRows.reduce((s, r) => s + num(r, 4), 0),
        playlistStarts: periodVideoRows.reduce((s, r) => s + num(r, 5), 0),
        viewsPerPlaylistStart: avgOrZero(periodVideoRows, 6),
      };
    };

    const [periodVideoStats, periodSubStats] = await Promise.all([
      ytReport({
        startDate: statsRangeStart,
        endDate: statsRangeEnd,
        metrics: periodMetrics,
        dimensions: "day",
        ...(filters ? { filters } : {}),
        sort: "day",
      }).catch((err) => {
        console.warn("[Pills] periodVideoStats report failed:", err.response?.data?.error?.message || err.message);
        return { rows: [] };
      }),
      ytReport({
        startDate: statsRangeStart,
        endDate: statsRangeEnd,
        metrics: "subscribersGained,subscribersLost,likes,shares,comments",
        dimensions: "day",
        sort: "day",
      }).catch((err) => {
        console.warn("[Pills] periodSubStats report failed:", err.response?.data?.error?.message || err.message);
        return { rows: [] };
      }),
    ]);

    let periodVideoRows = periodVideoStats?.rows || [];
    const periodSubRows = periodSubStats?.rows || [];

    if (hasPlaylistFilter) {
      try {
        const playlistIds = filters
          .replace("playlist==", "")
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean);
        const playlistViewsStats = await fetchPlaylistViewsSummed(
          ytReport,
          playlistIds,
          { startDate: statsRangeStart, endDate: statsRangeEnd },
          {
            metrics: "playlistViews,playlistEstimatedMinutesWatched,playlistAverageViewDuration,playlistSaves,playlistStarts,viewsPerPlaylistStart",
            dimensions: "day",
            sort: "day",
          },
        );
        const plViewsIdx =
          playlistViewsStats?.columnHeaders?.findIndex((h) => h.name === "playlistViews") ?? -1;
        const plMinsIdx =
          playlistViewsStats?.columnHeaders?.findIndex((h) => h.name === "playlistEstimatedMinutesWatched") ?? -1;
        const plAvgIdx =
          playlistViewsStats?.columnHeaders?.findIndex((h) => h.name === "playlistAverageViewDuration") ?? -1;
        const plSavesIdx =
          playlistViewsStats?.columnHeaders?.findIndex((h) => h.name === "playlistSaves") ?? -1;
        const plStartsIdx =
          playlistViewsStats?.columnHeaders?.findIndex((h) => h.name === "playlistStarts") ?? -1;
        const plVpsIdx =
          playlistViewsStats?.columnHeaders?.findIndex((h) => h.name === "viewsPerPlaylistStart") ?? -1;
        if (playlistViewsStats?.rows?.length > 0) {
          periodVideoRows = playlistViewsStats.rows.map((r) => [
            r[0],
            plViewsIdx !== -1 ? Number(r[plViewsIdx]) || 0 : 0,
            plMinsIdx !== -1 ? Number(r[plMinsIdx]) || 0 : 0,
            plAvgIdx !== -1 ? Number(r[plAvgIdx]) || 0 : 0,
            plSavesIdx !== -1 ? Number(r[plSavesIdx]) || 0 : 0,
            plStartsIdx !== -1 ? Number(r[plStartsIdx]) || 0 : 0,
            plVpsIdx !== -1 ? Number(r[plVpsIdx]) || 0 : 0,
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
          ]);
        }
      } catch (err) {
        console.warn(
          "[Dashboard pills] Failed to overlay playlistViews; falling back to views:",
          err.response?.data?.error?.message || err.message,
        );
      }
    }

    return {
      latestDate,
      d7: { current: computeWindowStats(periodVideoRows, periodSubRows, p7.curr), previous: computeWindowStats(periodVideoRows, periodSubRows, p7.prev) },
      d30: { current: computeWindowStats(periodVideoRows, periodSubRows, p30.curr), previous: computeWindowStats(periodVideoRows, periodSubRows, p30.prev) },
      d90: { current: computeWindowStats(periodVideoRows, periodSubRows, p90.curr), previous: computeWindowStats(periodVideoRows, periodSubRows, p90.prev) },
    };
  }

  // ── Summary ──────────────────────────────────────────────────────────────────

  async function generateDashboardSummary({
    channelId, period, startDate, endDate, compare = true, trueDelta = false,
    filters, clientLatestDate, accessToken, scope = "pub",
  }) {
    const summaryStart = perfNow();
    const summaryKey = dashboardSummaryKey(
      channelId, period, startDate, endDate, compare, trueDelta, filters, clientLatestDate, scope,
    );
    const hasPlaylistFilter =
      typeof filters === "string" && filters.includes("playlist==");
    const summarySnapshotKind = hasPlaylistFilter ? "summary-plv2" : "summary";
    const summarySnapshot = dashboardSnapshotKey(summarySnapshotKind, {
      channelId, period, startDate, endDate, compare, trueDelta, filters, clientLatestDate,
    });
    const summaryRedisKey = `snapshot:${summarySnapshot.key}`;
    const cached = await serverCache.get(summaryKey);
    if (cached) {
      perfLog("dashboard.summary.cache.read", summaryStart, { hit: true, channelId });
      perfLog("dashboard.summary.total", summaryStart, { source: "cache-hit" });
      return cached;
    }

    const redisSnapshot = await serverCache.get(summaryRedisKey);
    if (redisSnapshot) {
      await serverCache.set(summaryKey, redisSnapshot);
      perfLog("dashboard.summary.total", summaryStart, { source: "snapshot-redis" });
      return redisSnapshot;
    }

    if (ANALYTICS_SOURCE === "postgres-first" && isPostgresConfigured()) {
      try {
        const pgSnapshot = await getDashboardSnapshot(summarySnapshot.key);
        if (pgSnapshot?.payload) {
          await serverCache.set(summaryRedisKey, pgSnapshot.payload);
          await serverCache.set(summaryKey, pgSnapshot.payload);
          perfLog("dashboard.summary.total", summaryStart, { source: "snapshot-postgres" });
          return pgSnapshot.payload;
        }
      } catch (err) {
        console.warn("[Dashboard Summary] Snapshot lookup failed:", err.message);
      }

      try {
        const pgSummary = await loadSummaryFromPostgres({
          channelId, filters, trueDelta, latestDate: clientLatestDate || undefined,
        });
        if (pgSummary) {
          pgSummary.lastSyncedAt = await getChannelLastSyncedAt(channelId);
          await serverCache.set(summaryKey, pgSummary);
          perfLog("dashboard.summary.total", summaryStart, { source: "postgres" });
          return pgSummary;
        }
      } catch (err) {
        console.warn("[Dashboard Summary] Postgres path failed, falling back:", err.message);
      }
    }

    const pills = await computeDashboardPillsOnly({
      channelId, period, startDate, endDate, trueDelta, filters, clientLatestDate, accessToken,
    });
    pills.lastSyncedAt = await getChannelLastSyncedAt(channelId);
    await serverCache.set(summaryKey, pills);
    await serverCache.set(summaryRedisKey, pills);
    if (ANALYTICS_SOURCE === "postgres-first" && isPostgresConfigured()) {
      try {
        await upsertDashboardSnapshot({
          snapshotKey: summarySnapshot.key,
          channelId,
          snapshotType: "summary",
          payload: pills,
          ttlSeconds: 6 * 60 * 60,
        });
      } catch (err) {
        console.warn("[Dashboard Summary] Snapshot write failed:", err.message);
      }
    }
    console.log("[Cache] Dashboard summary WRITE:", summaryKey.slice(0, 72));
    perfLog("dashboard.summary.total", summaryStart, { source: "fresh" });
    return pills;
  }

  // ── Channel totals helper ────────────────────────────────────────────────────

  function computeChannelTotals(videoReport, channelReport) {
    const videoRows = videoReport?.rows || [];
    const channelRows = channelReport?.rows || [];
    const num = (r, i) => (r?.[i] !== undefined && r?.[i] !== null ? Number(r[i]) : 0);
    return {
      views: videoRows.reduce((s, r) => s + num(r, 1), 0),
      watch_time: videoRows.reduce((s, r) => s + num(r, 2), 0),
      average_view_duration: avgOrZero(videoRows, 4),
      engaged_views: videoRows.reduce((s, r) => s + num(r, 5), 0),
      viewer_percentage: avgOrZero(videoRows, 6),
      card_impressions: videoRows.reduce((s, r) => s + num(r, 7), 0),
      card_clicks: videoRows.reduce((s, r) => s + num(r, 8), 0),
      card_click_rate: avgOrZero(videoRows, 9),
      card_teaser_impressions: videoRows.reduce((s, r) => s + num(r, 10), 0),
      card_teaser_clicks: videoRows.reduce((s, r) => s + num(r, 11), 0),
      card_teaser_click_rate: avgOrZero(videoRows, 12),
      average_concurrent_viewers: videoRows.reduce((s, r) => s + num(r, 13), 0),
      peak_concurrent_viewers: videoRows.reduce((s, r) => s + Math.max(0, num(r, 14)), 0),
      subscribers_gained: channelRows.reduce((s, r) => s + num(r, 1), 0),
      subscribers_lost: channelRows.reduce((s, r) => s + num(r, 2), 0),
      likes: channelRows.reduce((s, r) => s + num(r, 3), 0),
      shares: channelRows.reduce((s, r) => s + num(r, 4), 0),
      comments: channelRows.reduce((s, r) => s + num(r, 5), 0),
    };
  }

  return {
    dashboardSummaryKey,
    normalizeDashboardFilters,
    dashboardSnapshotKey,
    fetchPlaylistViewsSummed,
    overlayViewsFromPlaylistRows,
    createDashboardYtReport,
    computeDashboardPillsOnly,
    generateDashboardSummary,
    computeChannelTotals,
  };
}

module.exports = { createAnalyticsService };

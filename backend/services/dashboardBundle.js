/**
 * Dashboard bundle service -- the heavy dashboard data aggregation endpoint.
 */
function createDashboardBundleService(deps) {
  const {
    serverCache,
    perfLog,
    perfNow,
    isPostgresConfigured,
    loadBundleFromPostgres,
    getChannelLastSyncedAt,
    getDashboardSnapshot,
    upsertDashboardSnapshot,
    ANALYTICS_SOURCE,
    computeDashboardPillsOnly,
    dashboardSummaryKey,
    dashboardSnapshotKey,
    createDashboardYtReport,
    fetchPlaylistViewsSummed,
    overlayViewsFromPlaylistRows,
    computeChannelTotals,
    markQuotaBillable,
  } = deps;

  async function generateDashboardBundle({
    channelId, period, startDate, endDate, compare = true, trueDelta = false,
    filters, clientLatestDate, accessToken, fields, req, scope = "pub",
  }) {
    const requestedFields = Array.isArray(fields)
      ? fields
      : ["channelTotals", "chartData", "comparison", "videos"];
    const wantComparison = requestedFields.includes("comparison") && compare !== false;
    const bundleStart = perfNow();
    const hasPlaylistFilter =
      typeof filters === "string" && filters.includes("playlist==");
    const bundleSnapshotKind = hasPlaylistFilter ? "bundle-plv3" : "bundle-v3";
    const bundleSnapshot = dashboardSnapshotKey(bundleSnapshotKind, {
      channelId, period, startDate, endDate, compare, trueDelta, filters, clientLatestDate,
    });
    const bundleRedisKey = `snapshot:${bundleSnapshot.key}`;

    const redisSnapshot = await serverCache.get(bundleRedisKey);
    if (redisSnapshot) {
      perfLog("dashboard.bundle.total", bundleStart, { source: "snapshot-redis" });
      return redisSnapshot;
    }

    if (ANALYTICS_SOURCE === "postgres-first" && isPostgresConfigured()) {
      try {
        const pgSnapshot = await getDashboardSnapshot(bundleSnapshot.key);
        if (pgSnapshot?.payload) {
          await serverCache.set(bundleRedisKey, pgSnapshot.payload);
          perfLog("dashboard.bundle.total", bundleStart, { source: "snapshot-postgres" });
          return pgSnapshot.payload;
        }
      } catch (err) {
        console.warn("[Dashboard Bundle] Snapshot lookup failed:", err.message);
      }

      try {
        const pgBundle = await loadBundleFromPostgres({
          channelId, period, startDate, endDate, compare: wantComparison, trueDelta, filters,
          latestDate: clientLatestDate || undefined,
        });
        if (pgBundle) {
          pgBundle.lastSyncedAt = await getChannelLastSyncedAt(channelId);
          pgBundle.channelTotals = computeChannelTotals(pgBundle.current, pgBundle.channelCurrent);
          pgBundle.prevChannelTotals = wantComparison
            ? computeChannelTotals(pgBundle.previous, pgBundle.channelPrevious)
            : null;
          await serverCache.set(bundleRedisKey, pgBundle);
          perfLog("dashboard.bundle.total", bundleStart, { source: "postgres" });
          return pgBundle;
        }
      } catch (err) {
        console.warn("[Dashboard Bundle] Postgres path failed, falling back:", err.message);
      }
    }

    const videoMetricsKey = `bundle:video:v2:${scope}:${channelId}:${startDate || ""}:${endDate || ""}:${period || ""}:${compare}:${filters || ""}`;
    const channelMetricsKey = `bundle:channel:v2:${scope}:${channelId}:${startDate || ""}:${endDate || ""}:${period || ""}:${compare}:${trueDelta}`;
    const playlistViewsKey = hasPlaylistFilter
      ? `bundle:playlistViews:v2:${scope}:${channelId}:${startDate || ""}:${endDate || ""}:${period || ""}:${compare}:${trueDelta}:${filters || ""}`
      : null;

    const ytReport = createDashboardYtReport(channelId, accessToken);
    const summaryKey = dashboardSummaryKey(
      channelId, period, startDate, endDate, compare, trueDelta, filters, clientLatestDate,
    );

    let pillPayload = await serverCache.get(summaryKey);
    if (!pillPayload) {
      try {
        pillPayload = await computeDashboardPillsOnly({
          channelId, period, startDate, endDate, trueDelta, filters, clientLatestDate, accessToken,
        });
      } catch (err) {
        console.error("[Dashboard Bundle] Pill computation failed:", err.message);
        throw err;
      }
      await serverCache.set(summaryKey, pillPayload);
      console.log("[Cache] Dashboard summary WRITE (via bundle):", summaryKey.slice(0, 72));
    }

    const { latestDate, d7, d30, d90 } = pillPayload;

    let days = Number(period || 90);
    if (startDate && endDate) {
      const s = new Date(startDate);
      const e = new Date(endDate);
      days = Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000) + 1);
    }
    const endRef = new Date(latestDate);

    const dateRange = (offsetDays, windowDays) => {
      const end = new Date(endRef.getTime() - offsetDays * 86400000);
      const start = new Date(end.getTime() - (windowDays - 1) * 86400000);
      return {
        endDate: end.toISOString().split("T")[0],
        startDate: start.toISOString().split("T")[0],
      };
    };

    const curr = startDate && endDate ? { startDate, endDate } : dateRange(0, days);
    const prev = startDate && endDate
      ? {
          endDate: new Date(new Date(startDate).getTime() - 86400000).toISOString().split("T")[0],
          startDate: new Date(new Date(startDate).getTime() - days * 86400000).toISOString().split("T")[0],
        }
      : dateRange(days, days);

    const videoMetrics = hasPlaylistFilter
      ? "views,estimatedMinutesWatched,averageViewPercentage"
      : "views,estimatedMinutesWatched,averageViewPercentage,subscribersGained,subscribersLost,likes,shares,comments";
    const channelMetrics = "subscribersGained,subscribersLost,likes,shares,comments";

    const cacheReadStart = perfNow();
    let cachedVideoMetrics = await serverCache.get(videoMetricsKey);
    perfLog("dashboard.bundle.cache.video.read", cacheReadStart, {
      hit: !!cachedVideoMetrics, channelId, period,
    });

    let current, previous;
    if (cachedVideoMetrics) {
      console.log("[Cache] Dashboard video metrics HIT:", videoMetricsKey.slice(0, 60));
      ({ current, previous } = cachedVideoMetrics);
    } else {
      markQuotaBillable(req);
      [current, previous] = await Promise.all([
        ytReport({ ...curr, metrics: videoMetrics, dimensions: "day", ...(filters ? { filters } : {}), sort: "day" }),
        wantComparison
          ? ytReport({ ...prev, metrics: videoMetrics, dimensions: "day", ...(filters ? { filters } : {}), sort: "day" })
          : Promise.resolve(null),
      ]);
      await serverCache.set(videoMetricsKey, { current, previous });
      console.log("[Cache] Dashboard video metrics WRITE:", videoMetricsKey.slice(0, 60));
    }

    let cachedChannelMetrics = await serverCache.get(channelMetricsKey);
    perfLog("dashboard.bundle.cache.channel.read", cacheReadStart, {
      hit: !!cachedChannelMetrics, channelId, period,
    });

    let channelCurrent, channelPrevious;
    if (cachedChannelMetrics) {
      console.log("[Cache] Dashboard channel metrics HIT:", channelMetricsKey.slice(0, 60));
      ({ channelCurrent, channelPrevious } = cachedChannelMetrics);
    } else {
      markQuotaBillable(req);
      [channelCurrent, channelPrevious] = await Promise.all([
        ytReport({ ...curr, metrics: channelMetrics, dimensions: "day", sort: "day" }),
        wantComparison
          ? ytReport({ ...prev, metrics: channelMetrics, dimensions: "day", sort: "day" })
          : Promise.resolve(null),
      ]);
      await serverCache.set(channelMetricsKey, { channelCurrent, channelPrevious });
      console.log("[Cache] Dashboard channel metrics WRITE:", channelMetricsKey.slice(0, 60));
    }

    if (hasPlaylistFilter) {
      let cachedPlaylistViews = playlistViewsKey ? await serverCache.get(playlistViewsKey) : null;
      let currentPlaylistViews;
      let previousPlaylistViews;

      if (cachedPlaylistViews) {
        ({ currentPlaylistViews, previousPlaylistViews } = cachedPlaylistViews);
      } else {
        markQuotaBillable(req);
        const playlistIds = filters
          .replace("playlist==", "")
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean);
        const plExtraParams = {
          metrics: "playlistViews,playlistEstimatedMinutesWatched,playlistAverageViewDuration",
          dimensions: "day",
          sort: "day",
        };
        [currentPlaylistViews, previousPlaylistViews] = await Promise.all([
          fetchPlaylistViewsSummed(ytReport, playlistIds, curr, plExtraParams),
          wantComparison
            ? fetchPlaylistViewsSummed(ytReport, playlistIds, prev, plExtraParams)
            : Promise.resolve(null),
        ]);
        if (playlistViewsKey) {
          await serverCache.set(playlistViewsKey, { currentPlaylistViews, previousPlaylistViews });
        }
      }

      const ensureDates = (baseReport, plReport) => {
        if (!baseReport?.rows || !plReport?.rows) return;
        const existingDates = new Set(baseReport.rows.map((r) => r[0]));
        const colCount = Math.max((baseReport.columnHeaders || []).length, 9);
        for (const row of plReport.rows) {
          if (!existingDates.has(row[0])) {
            const filler = new Array(colCount).fill(0);
            filler[0] = row[0];
            baseReport.rows.push(filler);
          }
        }
        baseReport.rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      };
      ensureDates(current, currentPlaylistViews);
      ensureDates(previous, previousPlaylistViews);

      overlayViewsFromPlaylistRows(current, currentPlaylistViews);
      overlayViewsFromPlaylistRows(previous, previousPlaylistViews);
    }

    const channelTotals = computeChannelTotals(current, channelCurrent);
    const prevChannelTotals = wantComparison
      ? computeChannelTotals(previous, channelPrevious)
      : null;

    const responseData = {
      latestDate,
      current,
      previous: wantComparison ? previous : null,
      channelCurrent,
      channelPrevious: wantComparison ? channelPrevious : null,
      channelTotals,
      prevChannelTotals,
      d7: d7 || null,
      d30: d30 || null,
      d90: d90 || null,
    };
    responseData.lastSyncedAt = await getChannelLastSyncedAt(channelId);
    await serverCache.set(bundleRedisKey, responseData);
    if (ANALYTICS_SOURCE === "postgres-first" && isPostgresConfigured()) {
      try {
        await upsertDashboardSnapshot({
          snapshotKey: bundleSnapshot.key,
          channelId,
          snapshotType: "bundle",
          payload: responseData,
          ttlSeconds: 6 * 60 * 60,
        });
      } catch (err) {
        console.warn("[Dashboard Bundle] Snapshot write failed:", err.message);
      }
    }

    perfLog("dashboard.bundle.total", bundleStart, {
      source: cachedVideoMetrics || cachedChannelMetrics ? "partial-cache-hit" : "fresh",
      videoMetricsCached: !!cachedVideoMetrics,
      channelMetricsCached: !!cachedChannelMetrics,
    });
    return responseData;
  }

  return { generateDashboardBundle };
}

module.exports = { createDashboardBundleService };

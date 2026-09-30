/**
 * Audience dimensions service -- traffic source, country, gender, age, etc.
 */
function createDimensionsService(deps) {
  const { serverCache, perfLog, perfNow, axios, markQuotaBillable } = deps;

  async function generateDimensions({
    channelId, startDate, endDate, filters, accessToken, req,
  }) {
    const dimsStart = perfNow();
    const videoCacheKey = `dims_v2:${channelId}:${startDate}:${endDate}:${filters || ""}`;
    const channelCacheKey = `dims_ch_v2:${channelId}:${startDate}:${endDate}`;

    const [cachedVideo, cachedChannel] = await Promise.all([
      serverCache.get(videoCacheKey),
      serverCache.get(channelCacheKey),
    ]);
    perfLog("dashboard.dimensions.cache.read", dimsStart, {
      channelId, hasFilters: !!filters, videoHit: !!cachedVideo, channelHit: !!cachedChannel,
    });

    const ids = `channel==${channelId}`;
    const ytHeaders = { Authorization: accessToken };

    const ytReport = async (params) => {
      const reportStart = perfNow();
      try {
        const qsParams = { ids, startDate, endDate, ...params };
        const response = await axios.get(
          "https://youtubeanalytics.googleapis.com/v2/reports",
          { params: qsParams, headers: ytHeaders },
        );
        perfLog("dashboard.dimensions.ytReport", reportStart, {
          dimension: params.dimensions, metrics: params.metrics, hasFilters: !!params.filters,
        });
        return response.data;
      } catch (err) {
        perfLog("dashboard.dimensions.ytReport.error", reportStart, {
          dimension: params.dimensions, hasFilters: !!params.filters,
        });
        console.warn(
          `[Dimensions] Failed for dimension ${params.dimensions} with filters "${params.filters}":`,
          err.response?.data?.error?.message || err.message,
        );
        return null;
      }
    };

    if (filters && typeof filters === "string") {
      filters = filters
        .replace(/(?:video==)?N\/A[,;]?/g, "")
        .replace(/[,;]+$/, "")
        .trim();
      if (filters === "video==" || filters === "") filters = undefined;
    }

    const baseParams = filters ? { filters } : {};

    let trafficSource, subscribedStatus, deviceType, country;
    if (cachedVideo) {
      console.log("[Cache] Dims (video-scoped) HIT:", videoCacheKey.slice(0, 60));
      ({ trafficSource, subscribedStatus, deviceType, country } = cachedVideo);
    } else {
      markQuotaBillable(req);
      [trafficSource, subscribedStatus, deviceType, country] = await Promise.all([
        ytReport({ ...baseParams, metrics: "views,estimatedMinutesWatched", dimensions: "insightTrafficSourceType", sort: "-views" }),
        ytReport({ ...baseParams, metrics: "views,estimatedMinutesWatched", dimensions: "subscribedStatus", sort: "-views" }),
        ytReport({ ...baseParams, metrics: "views,estimatedMinutesWatched", dimensions: "deviceType", sort: "-views" }),
        ytReport({ ...baseParams, metrics: "views,estimatedMinutesWatched", dimensions: "country", sort: "-views", maxResults: 20 }),
      ]);
      await serverCache.set(videoCacheKey, { trafficSource, subscribedStatus, deviceType, country });
      console.log("[Cache] Dims (video-scoped) WRITE:", videoCacheKey.slice(0, 60));
    }

    let gender = null, ageGroup = null;
    if (cachedChannel) {
      console.log("[Cache] Dims (channel-wide) HIT:", channelCacheKey.slice(0, 60));
      ({ gender, ageGroup } = cachedChannel);
    } else {
      markQuotaBillable(req);
      const genderAge = await ytReport({
        metrics: "viewerPercentage",
        dimensions: "gender,ageGroup",
      });
      if (genderAge?.rows?.length) {
        const genderMap = {};
        const ageMap = {};
        genderAge.rows.forEach(([g, age, pct]) => {
          genderMap[g] = (genderMap[g] || 0) + Number(pct);
          ageMap[age] = (ageMap[age] || 0) + Number(pct);
        });
        gender = { rows: Object.entries(genderMap).map(([k, v]) => [k, v]) };
        ageGroup = { rows: Object.entries(ageMap).map(([k, v]) => [k, v]) };
      }
      await serverCache.set(channelCacheKey, { gender, ageGroup });
      console.log("[Cache] Dims (channel-wide) WRITE:", channelCacheKey.slice(0, 60));
    }

    const responseData = { trafficSource, gender, ageGroup, subscribedStatus, country, deviceType };
    perfLog("dashboard.dimensions.total", dimsStart, {
      channelId, hasFilters: !!filters, hasCountryRows: !!country?.rows?.length,
    });
    return responseData;
  }

  return { generateDimensions };
}

module.exports = { createDimensionsService };

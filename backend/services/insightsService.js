/**
 * Insights service -- Best Day to Post & Audience Retention trend.
 *
 * Uses YouTube Analytics API day dimension (the only time-granular dimension
 * available in v2 -- hour and dayOfWeek are NOT supported) to produce:
 *   1. A day-of-week breakdown to find the best publishing day
 *   2. A daily retention trend chart (averageViewPercentage by day)
 *
 * Dependencies are injected at creation time following the same pattern as
 * dimensionsService and analyticsService.
 */

function createInsightsService(deps) {
  const {
    serverCache,
    perfLog,
    perfNow,
    axios,
    shortHash,
    youtubeDataScope,
    YT_DATA_CACHE_TTL_MS,
    API_KEY,
    YOUTUBE_API_BASE,
    markQuotaBillable,
    bestTimeToPostService,
    query,
    isPostgresConfigured,
  } = deps;

  const DAY_LABELS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const HOUR_LABELS = [
    "12AM","1AM","2AM","3AM","4AM","5AM","6AM","7AM","8AM","9AM","10AM","11AM",
    "12PM","1PM","2PM","3PM","4PM","5PM","6PM","7PM","8PM","9PM","10PM","11PM",
  ];

  // ── Cache TTL -- slow-changing data, 12h ──────────────────────────────────────

  const INSIGHTS_CACHE_TTL = 12 * 60 * 60 * 1000;

  // ── Key helpers ──────────────────────────────────────────────────────────────

  function bestTimeCacheKey(scope, channelId, period, startDate, endDate) {
    const suffix = (startDate && endDate) ? `:${startDate}:${endDate}` : '';
    return `insights:bestDay:v3:${scope}:${channelId}:${period || 30}${suffix}`;
  }

  function retentionCacheKey(scope, channelId, period, startDate, endDate) {
    const suffix = (startDate && endDate) ? `:${startDate}:${endDate}` : '';
    return `insights:retention:v3:${scope}:${channelId}:${period || 30}${suffix}`;
  }

  function retentionByHourCacheKey(scope, channelId, period, startDate, endDate, timezone) {
    const suffix = (startDate && endDate) ? `:${startDate}:${endDate}` : '';
    const tz = timezone && timezone !== 'UTC' ? `:${timezone.replace(/[^a-zA-Z0-9_\/-]/g, '_')}` : '';
    return `insights:retentionByHour:v2:${scope}:${channelId}:${period || 30}${suffix}${tz}`;
  }

  function chunkArray(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
    return chunks;
  }

  /**
   * Build an SQL fragment to filter analytics_videos.published_at by a period
   * or a custom date range. `nextIdx` is the next $N parameter index to use.
   * Returns { sql: string, params: (string|number)[] }.
   */
  function buildPublishedAtFilter(period, startDate, endDate, nextIdx) {
    if (startDate && endDate) {
      return {
        sql: `AND v.published_at >= $${nextIdx}::date AND v.published_at < $${nextIdx + 1}::date + 1`,
        params: [startDate, endDate],
      };
    }
    if (period) {
      return {
        sql: `AND v.published_at >= CURRENT_DATE - $${nextIdx}::integer`,
        params: [period],
      };
    }
    return { sql: '', params: [] };
  }

  /**
   * Parse a YYYY-MM-DD string → day of week (0=Sun, 6=Sat).
   */
  function dayOfWeekFromDate(dateStr) {
    return new Date(dateStr + "T00:00:00Z").getUTCDay();
  }

  // ── Best Day to Post ──────────────────────────────────────────────────────────

  /**
   * Queries YouTube Analytics for daily views, then aggregates by day of week.
   *
   * YouTube Analytics API v2 only supports `day` as a time dimension -- no
   * `hour` or `dayOfWeek` are available -- so we aggregate server-side.
   *
   * @param {{ channelId, accessToken, period, startDate, endDate, latestDate, scope, req }} params
   * @returns {Promise<{ bestDay, bestDayLabel, dailyStats, recommendation } | null>}
   */
  async function generateBestTimeToPost({ channelId, accessToken, period, startDate: sd, endDate: ed, latestDate, scope, req }) {
    const start = perfNow();
    const cacheKey = bestTimeCacheKey(scope || "pub", channelId, period, sd, ed);

    // Check cache
    const cached = await serverCache.get(cacheKey);
    if (cached) {
      perfLog("insights.bestDay.cache", start, { hit: true, channelId });
      return cached;
    }

    markQuotaBillable(req);

    // Use provided dates or compute from period
    const refEnd = ed ? new Date(ed) : (latestDate ? new Date(latestDate) : new Date());
    const refStart = sd ? new Date(sd) : new Date(refEnd.getTime() - (period || 30) * 86400000);
    const fmtEnd = refEnd.toISOString().split("T")[0];
    const fmtStart = refStart.toISOString().split("T")[0];

    const ids = `channel==${channelId}`;
    const ytHeaders = { Authorization: accessToken };

    try {
      const response = await axios.get(
        "https://youtubeanalytics.googleapis.com/v2/reports",
        {
          params: {
            ids,
            startDate: fmtStart,
            endDate: fmtEnd,
            metrics: "views,averageViewPercentage,subscribersGained,likes,comments,shares",
            dimensions: "day",
            sort: "day",
          },
          headers: ytHeaders,
        },
      );

      perfLog("insights.bestDay.ytReport", start, {
        channelId,
        rowsReturned: response.data?.rows?.length || 0,
      });

      const rows = response.data?.rows || [];
      if (!rows.length) return null;

      // Rows are [date, views, avgViewPct, subsGained, likes, comments, shares]
      const METRIC_VIEWS = 1;
      const METRIC_AVG_VIEW_PCT = 2;
      const METRIC_SUBS = 3;
      const METRIC_LIKES = 4;
      const METRIC_COMMENTS = 5;
      const METRIC_SHARES = 6;

      // Aggregate each metric by day of week (0-6)
      const dayTotals = {
        views: new Array(7).fill(0),
        avgViewPct: new Array(7).fill(0),
        subsGained: new Array(7).fill(0),
        likes: new Array(7).fill(0),
        comments: new Array(7).fill(0),
        shares: new Array(7).fill(0),
        count: new Array(7).fill(0),
      };

      for (const r of rows) {
        const dow = dayOfWeekFromDate(r[0]);
        dayTotals.count[dow]++;
        dayTotals.views[dow] += Number(r[METRIC_VIEWS] || 0);
        dayTotals.avgViewPct[dow] += Number(r[METRIC_AVG_VIEW_PCT] || 0);
        dayTotals.subsGained[dow] += Number(r[METRIC_SUBS] || 0);
        dayTotals.likes[dow] += Number(r[METRIC_LIKES] || 0);
        dayTotals.comments[dow] += Number(r[METRIC_COMMENTS] || 0);
        dayTotals.shares[dow] += Number(r[METRIC_SHARES] || 0);
      }

      // Average the percentage metric (per-row percentage, not cumulative)
      for (let d = 0; d < 7; d++) {
        if (dayTotals.count[d] > 0) {
          dayTotals.avgViewPct[d] = +(dayTotals.avgViewPct[d] / dayTotals.count[d]).toFixed(2);
        }
      }

      // Find best day per key metric
      let bestDay = 0, maxViews = dayTotals.views[0];
      let bestRetentionDay = 0, maxRetention = dayTotals.avgViewPct[0];
      let bestSubsDay = 0, maxSubs = dayTotals.subsGained[0];
      for (let d = 1; d < 7; d++) {
        if (dayTotals.views[d] > maxViews) { maxViews = dayTotals.views[d]; bestDay = d; }
        if (dayTotals.avgViewPct[d] > maxRetention) { maxRetention = dayTotals.avgViewPct[d]; bestRetentionDay = d; }
        if (dayTotals.subsGained[d] > maxSubs) { maxSubs = dayTotals.subsGained[d]; bestSubsDay = d; }
      }

      if (maxViews === 0) return null;

      const bestDayLabel = DAY_LABELS[bestDay] || "Unknown";

      const dailyStats = dayTotals.views.map((views, day) => ({
        day,
        label: DAY_LABELS[day],
        views,
        averageViewPercentage: dayTotals.avgViewPct[day],
        subscribersGained: dayTotals.subsGained[day],
        likes: dayTotals.likes[day],
        comments: dayTotals.comments[day],
        shares: dayTotals.shares[day],
      }));

      const recommendation = `Your audience is most active on ${bestDayLabel}s`;

      const result = {
        bestDay,
        bestDayLabel,
        dailyStats,
        recommendation,
        bestRetentionDay,
        bestRetentionDayLabel: DAY_LABELS[bestRetentionDay],
        bestSubscriberDay: bestSubsDay,
        bestSubscriberDayLabel: DAY_LABELS[bestSubsDay],
      };
      await serverCache.set(cacheKey, result, INSIGHTS_CACHE_TTL);
      return result;
    } catch (err) {
      console.error(
        "[Insights] BestDay report failed:",
        err.response?.data?.error?.message || err.message,
      );
      return null;
    }
  }

  // ── Retention Trend (Daily) ───────────────────────────────────────────────────

  /**
   * Queries averageViewPercentage by day to show retention trend over time.
   *
   * YouTube Analytics API v2 does NOT support hour-level granularity, so we
   * report the daily averageViewPercentage instead.
   *
   * @param {{ channelId, accessToken, period, startDate, endDate, latestDate, scope, req }} params
   * @returns {Promise<{ dailyRetention: Array<{ date, retention }>, averageRetention } | null>}
   */
  async function generateRetentionByHour({ channelId, accessToken, period, startDate: sd, endDate: ed, latestDate, scope, req }) {
    const start = perfNow();
    const cacheKey = retentionCacheKey(scope || "pub", channelId, period, sd, ed);

    // Check cache
    const cached = await serverCache.get(cacheKey);
    if (cached) {
      perfLog("insights.retention.cache", start, { hit: true, channelId });
      return cached;
    }

    markQuotaBillable(req);

    // Use provided dates or compute from period
    const refEnd = ed ? new Date(ed) : (latestDate ? new Date(latestDate) : new Date());
    const refStart = sd ? new Date(sd) : new Date(refEnd.getTime() - (period || 30) * 86400000);
    const fmtEnd = refEnd.toISOString().split("T")[0];
    const fmtStart = refStart.toISOString().split("T")[0];

    const ids = `channel==${channelId}`;
    const ytHeaders = { Authorization: accessToken };

    try {
      const response = await axios.get(
        "https://youtubeanalytics.googleapis.com/v2/reports",
        {
          params: {
            ids,
            startDate: fmtStart,
            endDate: fmtEnd,
            metrics: "averageViewPercentage",
            dimensions: "day",
            sort: "day",
          },
          headers: ytHeaders,
        },
      );

      perfLog("insights.retention.ytReport", start, {
        channelId,
        rowsReturned: response.data?.rows?.length || 0,
      });

      const rows = response.data?.rows || [];
      if (!rows.length) return null;

      // Build daily retention array
      const dailyRetention = rows
        .map((r) => {
          const retention = Number(r[1]);
          return { date: r[0], retention: isNaN(retention) ? null : retention };
        })
        .filter((d) => d.retention !== null);

      if (!dailyRetention.length) return null;

      const sumRetention = dailyRetention.reduce((s, d) => s + d.retention, 0);
      const averageRetention = +(sumRetention / dailyRetention.length).toFixed(2);

      const result = {
        dailyRetention,
        averageRetention,
      };
      await serverCache.set(cacheKey, result, INSIGHTS_CACHE_TTL);
      return result;
    } catch (err) {
      console.error(
        "[Insights] Retention report failed:",
        err.response?.data?.error?.message || err.message,
      );
      return null;
    }
  }

  // ── Retention by Publish Hour ────────────────────────────────────────────────

  /**
   * Queries per-video averageViewPercentage and groups by publish hour.
   *
   * Because YouTube Analytics API v2 doesn't support `hour` as a time
   * dimension, this function joins two data sources:
   *   1. YouTube Analytics API with `video` dimension → per-video retention
   *   2. YouTube Data API `videos.list` → publishedAt timestamp per video
   *
   * The resulting hour groups show which publish times correlate with higher
   * average audience retention.
   *
   * @param {{ channelId, accessToken, period, startDate, endDate, latestDate, scope, req }} params
   * @returns {Promise<{ retentionByHour: HourRetentionStat[], bestHour, bestHourLabel, bestHourRetention } | null>}
   */
  async function generateRetentionByPublishHour({ channelId, accessToken, period, startDate: sd, endDate: ed, latestDate, scope, req, timezone = 'UTC' }) {
    const start = perfNow();
    const cacheKey = retentionByHourCacheKey(scope || "pub", channelId, period, sd, ed, timezone);

    // Check cache
    const cached = await serverCache.get(cacheKey);
    if (cached) {
      perfLog("insights.retentionByHour.cache", start, { hit: true, channelId });
      return cached;
    }

    markQuotaBillable(req);

    // Use provided dates or compute from period
    const refEnd = ed ? new Date(ed) : (latestDate ? new Date(latestDate) : new Date());
    const refStart = sd ? new Date(sd) : new Date(refEnd.getTime() - (period || 30) * 86400000);
    const fmtEnd = refEnd.toISOString().split("T")[0];
    const fmtStart = refStart.toISOString().split("T")[0];

    const ids = `channel==${channelId}`;
    const ytHeaders = { Authorization: accessToken };

    try {
      // ── Step 1: Get per-video analytics ─────────────────────────────────
      // YouTube Analytics API v2 doesn't support averageViewPercentage with
      // the video dimension, so we use estimatedMinutesWatched + views and
      // compute minutes-per-view as a retention proxy.
      const analyticsResponse = await axios.get(
        "https://youtubeanalytics.googleapis.com/v2/reports",
        {
          params: {
            ids,
            startDate: fmtStart,
            endDate: fmtEnd,
            metrics: "estimatedMinutesWatched,views",
            dimensions: "video",
            sort: "-estimatedMinutesWatched",
            maxResults: 200,
          },
          headers: ytHeaders,
        },
      );

      perfLog("insights.retentionByHour.ytAnalytics", start, {
        channelId,
        rowsReturned: analyticsResponse.data?.rows?.length || 0,
      });

      const rows = analyticsResponse.data?.rows || [];
      if (!rows.length) return null;

      // ── Step 2: Get publish hour for each video ─────────────────────────
      const allVideoIds = rows.map((r) => r[0]).filter(Boolean);
      console.log(`[Insights] RetentionByPublishHour: ${rows.length} video rows from Analytics API, ${allVideoIds.length} IDs`);
      const publishHourMap = new Map();

      // Use Bearer token for Data API (same as Analytics API), fall back to API_KEY
      const useApiKeyFallback = !accessToken || !accessToken.startsWith("Bearer ");
      const dataHeaders = useApiKeyFallback ? {} : { Authorization: accessToken };

      const batches = chunkArray(allVideoIds, 50);
      for (const batch of batches) {
        try {
          const dataParams = { part: "snippet", id: batch.join(",") };
          if (useApiKeyFallback) dataParams.key = API_KEY;
          const videoResponse = await axios.get(`${YOUTUBE_API_BASE}/videos`, {
            params: dataParams,
            ...(useApiKeyFallback ? {} : { headers: dataHeaders }),
          });
          const items = videoResponse.data?.items || [];
          console.log(`[Insights] Data API batch: requested ${batch.length} videos, got ${items.length} items`);
          for (const item of items) {
            const publishedAt = item.snippet?.publishedAt;
            if (publishedAt) {
              // Timezone-aware hour extraction using Intl API (DST-aware)
              const localHour = parseInt(
                new Intl.DateTimeFormat('en-US', {
                  timeZone: timezone,
                  hour: 'numeric',
                  hour12: false,
                }).format(new Date(publishedAt)),
                10,
              );
              publishHourMap.set(item.id, localHour);
            }
          }
        } catch (batchErr) {
          console.error("[Insights] Data API batch failed:", batchErr.response?.data?.error?.message || batchErr.message);
        }
      }
      console.log(`[Insights] RetentionByPublishHour: matched ${publishHourMap.size} videos to publish hours`);

      perfLog("insights.retentionByHour.dataApi", start, {
        videoIdsFetched: allVideoIds.length,
        matched: publishHourMap.size,
      });

      // ── Step 3: Group by publish hour ──────────────────────────────────
      // Compute average minutes-watched-per-view as a retention proxy
      const hourBuckets = Array.from({ length: 24 }, () => ({
        totalMinutes: 0,
        totalViews: 0,
        videoCount: 0,
      }));

      for (const r of rows) {
        const videoId = r[0];
        const minutesWatched = Number(r[1] || 0);
        const views = Number(r[2] || 0);
        const hour = publishHourMap.get(videoId);

        if (hour !== undefined && !isNaN(minutesWatched) && !isNaN(views)) {
          hourBuckets[hour].totalMinutes += minutesWatched;
          hourBuckets[hour].totalViews += views;
          hourBuckets[hour].videoCount++;
        }
      }

      const retentionByHour = hourBuckets.map((bucket, hour) => ({
        hour,
        label: HOUR_LABELS[hour],
        avgRetention: bucket.totalViews > 0
          ? +(bucket.totalMinutes / bucket.totalViews).toFixed(2)
          : 0,
        videoCount: bucket.videoCount,
      }));

      // Find best hour (highest minutes per view = best retention)
      let bestHour = 0;
      let maxRetention = 0;
      for (let h = 0; h < 24; h++) {
        if (retentionByHour[h].avgRetention > maxRetention && retentionByHour[h].videoCount > 0) {
          maxRetention = retentionByHour[h].avgRetention;
          bestHour = h;
        }
      }

      const bestHourLabel = HOUR_LABELS[bestHour];
      const recommendation = maxRetention > 0
        ? `Videos published around ${bestHourLabel} tend to retain viewers best`
        : '';

      const result = {
        retentionByHour,
        bestHour,
        bestHourLabel,
        bestHourRetention: maxRetention,
        recommendation,
      };

      console.log(`[Insights] RetentionByPublishHour SUCCESS: best=${bestHourLabel} (${maxRetention.toFixed(1)}%), ${retentionByHour.filter(h => h.videoCount > 0).length} hours with data`);
      await serverCache.set(cacheKey, result, INSIGHTS_CACHE_TTL);
      return result;
    } catch (err) {
      console.error(
        "[Insights] RetentionByPublishHour report failed:",
        err.response?.data?.error?.message || err.message,
      );
      return null;
    }
  }

  // ── Audience Active Time (YT Analytics) ───────────────────────────────

  /**
   * Queries YouTube Analytics to find which day of week the audience is most active.
   *
   * NOTE: YouTube Analytics API v2 does NOT support `hour` as a dimension,
   * so only day-of-week breakdown is available here. For hourly distribution,
   * see bestTimeToPostService (DB-powered, publish-hour based).
   *
   * Uses the `day` dimension + `views,subscribersGained,likes,comments,shares`
   * to produce a per-metric day-of-week breakdown.
   *
   * @param {{ channelId, accessToken, period, startDate, endDate, latestDate, scope, req }} params
   * @returns {Promise<{ dayOfWeek, peakDay, peakDayLabel, totalViews } | null>}
   */
  async function generateAudienceActiveTime({ channelId, accessToken, period, startDate: sd, endDate: ed, latestDate, scope, req }) {
    const start = perfNow();
    const cacheKey = (() => {
      const ds = sd && ed ? `:${sd}:${ed}` : `:p${period || 30}`;
      return `insights:audienceActive:v4:${scope || 'pub'}:${channelId}${ds}`;
    })();

    const cached = await serverCache.get(cacheKey);
    if (cached) {
      perfLog('insights.audienceActive.cache', start, { hit: true, channelId });
      return cached;
    }

    markQuotaBillable(req);

    const refEnd = ed ? new Date(ed) : (latestDate ? new Date(latestDate) : new Date());
    const refStart = sd ? new Date(sd) : new Date(refEnd.getTime() - (period || 30) * 86400000);
    const fmtEnd = refEnd.toISOString().split('T')[0];
    const fmtStart = refStart.toISOString().split('T')[0];

    const ids = `channel==${channelId}`;
    const ytHeaders = { Authorization: accessToken };
    const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    try {
      // ── Day-of-week breakdown ─────────────────────────────────────────
      // YT Analytics API v2 supports `day` dimension (NOT `hour` nor `day,hour`).
      // Aggregate daily rows by day of week for views, subs, likes, comments, shares.
      const dailyResponse = await axios.get(
        'https://youtubeanalytics.googleapis.com/v2/reports',
        {
          params: {
            ids,
            startDate: fmtStart,
            endDate: fmtEnd,
            metrics: 'views,subscribersGained,likes,comments,shares',
            dimensions: 'day',
            sort: 'day',
          },
          headers: ytHeaders,
        },
      );

      perfLog('insights.audienceActive.daily', start, {
        channelId,
        rowsReturned: dailyResponse.data?.rows?.length || 0,
      });

      const rows = dailyResponse.data?.rows || [];
      if (!rows.length) {
        perfLog('insights.audienceActive.empty', start, { channelId });
        return null;
      }

      const dowBuckets = {
        views: new Array(7).fill(0),
        subscribersGained: new Array(7).fill(0),
        likes: new Array(7).fill(0),
        comments: new Array(7).fill(0),
        shares: new Array(7).fill(0),
      };

      for (const row of rows) {
        const dow = new Date(row[0] + 'T00:00:00Z').getUTCDay();
        dowBuckets.views[dow] += Number(row[1] || 0);
        dowBuckets.subscribersGained[dow] += Number(row[2] || 0);
        dowBuckets.likes[dow] += Number(row[3] || 0);
        dowBuckets.comments[dow] += Number(row[4] || 0);
        dowBuckets.shares[dow] += Number(row[5] || 0);
      }

      const totalViews = dowBuckets.views.reduce((s, v) => s + v, 0);

      // Find peak day
      let peakDay = 0;
      let maxDayViews = dowBuckets.views[0];
      for (let d = 1; d < 7; d++) {
        if (dowBuckets.views[d] > maxDayViews) {
          maxDayViews = dowBuckets.views[d];
          peakDay = d;
        }
      }

      const dayOfWeek = DAY_LABELS.map((label, day) => ({
        day,
        label,
        views: dowBuckets.views[day],
        subscribersGained: dowBuckets.subscribersGained[day],
        likes: dowBuckets.likes[day],
        comments: dowBuckets.comments[day],
        shares: dowBuckets.shares[day],
      }));

      const result = {
        dayOfWeek,
        peakDay,
        peakDayLabel: DAY_LABELS[peakDay],
        totalViews,
      };

      await serverCache.set(cacheKey, result, INSIGHTS_CACHE_TTL);
      return result;
    } catch (err) {
      console.error(
        '[Insights] AudienceActiveTime report failed:',
        err.response?.data?.error?.message || err.message,
      );
      return null;
    }
  }

  // ── DB-Powered Best Time to Post ──────────────────────────────────────────────

  /**
   * Try the DB-powered best-time-to-post algorithm first. Falls back to
   * the YT API path only when there aren't enough videos in Postgres.
   *
   * @param {{ channelId: string, timezone?: string, segment?: string, scope?: string, period?: number, startDate?: string, endDate?: string }} params
   */
  async function generateBestTimeToPostFromDb({ channelId, timezone, segment, scope, period, startDate, endDate }) {
    const tz = timezone || 'UTC';
    const seg = segment || 'all';
    const tzSafe = tz.replace(/[^a-zA-Z0-9_\/-]/g, '_');
    const ds = startDate && endDate ? `:${startDate}:${endDate}` : `:p${period || 30}`;
    const cacheKey = `insights:bestTimeToPost:v7:${scope || 'pub'}:${channelId}:${tzSafe}:${seg}${ds}`;

    const cached = await serverCache.get(cacheKey);
    if (cached) return cached;

    const start = perfNow();
    const result = await bestTimeToPostService.generateBestTimeToPost({ channelId, timezone: tz, segment: seg, period, startDate, endDate });
    perfLog('insights.bestTimeToPost.db', start, {
      channelId,
      timezone: tz,
      segment: seg,
      videosAnalyzed: result?.totalVideosAnalyzed || 0,
    });

    if (result) {
      await serverCache.set(cacheKey, result, INSIGHTS_CACHE_TTL);
    }
    return result;
  }

  // ── DB-Powered Audience Active Time (View-Velocity Model) ──────────────────

  /**
   * Estimates hourly audience activity from Postgres data using a view-velocity
   * model. Since YouTube Analytics API v2 has NO `hour` dimension, this function
   * combines `analytics_videos.published_at` with `analytics_video_metrics_daily`
   * daily views to produce an estimated 24-hour distribution.
   *
   * Algorithm (View-Velocity Model):
   *   1. For each video, get its publish hour (timezone-aware) and daily views.
   *   2. Publish-day views are heavily weighted toward hours after the publish hour,
   *      with exponential decay (τ ≈ 3h).
   *   3. Day-after views have a slight bias toward the publish hour (β ≈ 0.4).
   *   4. Older days distribute uniformly.
   *   5. Aggregate across all videos, normalize to percentages, assign confidence.
   *
   * The result is an ESTIMATE, not ground-truth hourly analytics. Clearly label
   * it as such in the UI.
   *
   * @param {{ channelId, timezone?, period?, startDate?, endDate?, scope?, req? }} params
   * @returns {Promise<{ hourly, peakHour, peakHourLabel, confidence, totalVideosAnalyzed, modelParameters } | null>}
   */
  async function generateAudienceActiveTimeFromDb({ channelId, timezone, period, startDate, endDate, scope, req }) {
    const start = perfNow();
    const tz = timezone || 'UTC';
    const tzSafe = tz.replace(/[^a-zA-Z0-9_\/-]/g, '_');
    // Cache key includes period or custom date range so switching ranges
    // returns correct, range-specific results.
    const cacheKey = (() => {
      const ds = startDate && endDate ? `:${startDate}:${endDate}` : `:p${period || 30}`;
      return `insights:audienceActiveDb:v3:${scope || 'pub'}:${channelId}:${tzSafe}${ds}`;
    })();

    const cached = await serverCache.get(cacheKey);
    if (cached) {
      perfLog('insights.audienceActiveDb.cache', start, { hit: true, channelId });
      return cached;
    }

    if (!isPostgresConfigured()) {
      perfLog('insights.audienceActiveDb.noPg', start, { channelId });
      return null;
    }

    try {
      // ── Step 1: Fetch videos with daily metrics (LEFT JOIN so all videos
      //    with total view_count are included even when daily metrics are sparse) ──
      //
      // analytics_video_metrics_daily only holds the last ~90 days of daily view
      // counts (ingestion sliding window). For videos older than that, daily_views
      // will be NULL/zero. We use view_count (total lifetime views from YT API v3)
      // as the absolute total and the daily metrics only for the distribution shape.
      //
      // Date range: filter by v.published_at so only videos published within the
      // selected period/custom range are included.
      const dateFilterClause = buildPublishedAtFilter(period, startDate, endDate, 3);
      const videoQuery = `
        SELECT
          v.video_id,
          v.view_count,
          v.published_at::date AS publish_date_utc,
          EXTRACT(HOUR FROM v.published_at AT TIME ZONE $2)::int AS publish_hour,
          m.metric_date,
          m.views AS daily_views,
          m.estimated_minutes_watched AS daily_watch_time
        FROM analytics_videos v
        LEFT JOIN analytics_video_metrics_daily m
          ON v.video_id = m.video_id AND (m.filters_key = '' OR m.filters_key IS NULL)
        WHERE v.channel_id = $1
          AND v.published_at IS NOT NULL
          AND v.duration IS NOT NULL AND v.duration != ''
          ${dateFilterClause.sql}
        ORDER BY v.video_id, m.metric_date
      `;

      const dbResult = await query(videoQuery, [channelId, tz, ...dateFilterClause.params]);
      const rows = dbResult?.rows || [];

      // ── Step 2: Group rows by video ──────────────────────────────────────
      const videoMap = new Map();
      for (const row of rows) {
        if (!videoMap.has(row.video_id)) {
          videoMap.set(row.video_id, {
            videoId: row.video_id,
            viewCount: Number(row.view_count) || 0,
            publishHour: row.publish_hour,
            publishDateUtc: row.publish_date_utc,
            dailyMetrics: [],
          });
        }
        // LEFT JOIN rows: skip NULL metric rows (video with no daily metrics)
        if (row.metric_date) {
          videoMap.get(row.video_id).dailyMetrics.push({
            date: row.metric_date,
            views: Number(row.daily_views) || 0,
            watchTime: Number(row.daily_watch_time) || 0,
          });
        }
      }

      const videos = Array.from(videoMap.values()).filter((v) => v.viewCount > 0);
      const totalVideos = videos.length;

      if (totalVideos === 0) {
        perfLog('insights.audienceActiveDb.empty', start, { channelId });
        return null;
      }

      // ── Step 3: Model parameters ─────────────────────────────────────────
      const TAU = 3;              // Decay constant (hours) -- publish-day surge
      const BETA = 0.4;           // Day-after bias strength
      const SIGMA = 4;            // Spread of day-after bias (hours)
      const TAU_FALLBACK = 4;     // Spread for videos with zero daily metrics
      const dayMs = 86400000;

      // ── Step 4: Initialize hourly buckets ────────────────────────────────
      const hourlyActivity = Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        label: HOUR_LABELS[h],
        estimatedViews: 0,
        estimatedWatchTime: 0,
        viewPercentage: 0,
        videoCount: new Set(),
      }));

      // ── Step 5: For each video, determine hourly distribution then apply
      //    total view_count to get absolute estimates ────────────────────────
      for (const video of videos) {
        const H = video.publishHour;
        if (H === undefined || H === null) continue;

        const totalViews = video.viewCount;

        // Check if we have real daily metric data to work with
        const hasDailyMetrics = video.dailyMetrics.length > 0 &&
          video.dailyMetrics.some((dm) => dm.views > 0);

        let hourlyWeights = new Array(24).fill(0);
        let totalWeightSum = 0;

        if (hasDailyMetrics) {
          // ── View-Velocity model ─────────────────────────────────────────
          // Use publish_date_utc (UTC date) for daysSincePublish since metric_date
          // is a Postgres DATE (no timezone -- UTC-relative).
          const pubDate = video.publishDateUtc instanceof Date
            ? new Date(video.publishDateUtc.getTime())
            : new Date(video.publishDateUtc + 'T00:00:00Z');

          for (const dm of video.dailyMetrics) {
            const metricDate = dm.date instanceof Date
              ? new Date(dm.date.getTime())
              : new Date(dm.date + 'T00:00:00Z');
            const daysSincePublish = Math.round((metricDate.getTime() - pubDate.getTime()) / dayMs);

            if (daysSincePublish === 0) {
              // Publish day: views concentrated in remaining hours [H, 23]
              const remainingFraction = (24 - H) / 24;
              const priorFraction = 1 - remainingFraction;

              // Hours [H, 23] -- exponential decay from peak at H
              let tw = 0;
              const ws = [];
              for (let h = H; h < 24; h++) {
                const w = Math.exp(-(h - H) / TAU);
                ws.push(w);
                tw += w;
              }

              if (tw > 0 && remainingFraction > 0) {
                const weightShare = dm.views * remainingFraction;
                for (let i = 0; i < ws.length; i++) {
                  const hour = H + i;
                  hourlyWeights[hour] += weightShare * ws[i] / tw;
                }
              }

              // Hours [0, H-1] -- decay backwards from H-1
              if (H > 0) {
                let tpw = 0;
                const pws = [];
                for (let h = H - 1; h >= 0; h--) {
                  const dist = H - 1 - h;
                  const w = Math.exp(-dist / (2 * TAU));
                  pws.unshift(w);
                  tpw += w;
                }

                if (tpw > 0 && priorFraction > 0) {
                  const weightShare = dm.views * priorFraction;
                  for (let h = 0; h < H; h++) {
                    hourlyWeights[h] += weightShare * pws[h] / tpw;
                  }
                }
              }
            } else if (daysSincePublish === 1) {
              // Day after: slight bias toward publish hour
              let tw = 0;
              const ws = [];
              for (let h = 0; h < 24; h++) {
                const dist = Math.min(Math.abs(h - H), 24 - Math.abs(h - H));
                const w = 1 + BETA * Math.exp(-dist / SIGMA);
                ws.push(w);
                tw += w;
              }

              if (tw > 0) {
                for (let h = 0; h < 24; h++) {
                  hourlyWeights[h] += dm.views * ws[h] / tw;
                }
              }
            } else {
              // Older days: uniform across all hours
              for (let h = 0; h < 24; h++) {
                hourlyWeights[h] += dm.views / 24;
              }
            }
          } // end daily metrics loop

          // Calculate total weight for normalization
          totalWeightSum = hourlyWeights.reduce((s, w) => s + w, 0);

          if (totalWeightSum > 0) {
            // Normalize weights to percentages, apply totalViews
            for (let h = 0; h < 24; h++) {
              const pct = hourlyWeights[h] / totalWeightSum;
              hourlyActivity[h].estimatedViews += totalViews * pct;
              hourlyActivity[h].estimatedWatchTime += totalViews * pct * 0.1; // rough watch-time estimate
              hourlyActivity[h].videoCount.add(video.videoId);
            }
          } else {
            // Daily metrics exist but sum to zero -- fallback to publish-hour distribution
            totalWeightSum = 0;
            for (let h = 0; h < 24; h++) {
              const dist = Math.min(Math.abs(h - H), 24 - Math.abs(h - H));
              const w = Math.exp(-dist / TAU_FALLBACK);
              hourlyWeights[h] = w;
              totalWeightSum += w;
            }
            for (let h = 0; h < 24; h++) {
              hourlyActivity[h].estimatedViews += totalViews * hourlyWeights[h] / totalWeightSum;
              hourlyActivity[h].estimatedWatchTime += totalViews * hourlyWeights[h] / totalWeightSum * 0.1;
              hourlyActivity[h].videoCount.add(video.videoId);
            }
          }
        } else {
          // ── Fallback: no daily metrics -- use smoothed distribution
          //    centered on publish hour (von Mises-like circular normal)
          totalWeightSum = 0;
          for (let h = 0; h < 24; h++) {
            const dist = Math.min(Math.abs(h - H), 24 - Math.abs(h - H));
            const w = Math.exp(-dist / TAU_FALLBACK);
            hourlyWeights[h] = w;
            totalWeightSum += w;
          }
          for (let h = 0; h < 24; h++) {
            hourlyActivity[h].estimatedViews += totalViews * hourlyWeights[h] / totalWeightSum;
            hourlyActivity[h].estimatedWatchTime += totalViews * hourlyWeights[h] / totalWeightSum * 0.1;
            hourlyActivity[h].videoCount.add(video.videoId);
          }
        }
      } // end video loop

      // ── Step 6: Compute percentages and confidence ────────────────────────
      const totalEstimatedViews = hourlyActivity.reduce((s, h) => s + h.estimatedViews, 0);

      for (const h of hourlyActivity) {
        h.viewPercentage = totalEstimatedViews > 0
          ? +(h.estimatedViews / totalEstimatedViews * 100).toFixed(2)
          : 0;
        h.videoCount = h.videoCount.size;
        h.estimatedViews = Math.round(h.estimatedViews);
        h.estimatedWatchTime = Math.round(h.estimatedWatchTime);
      }

      // Peak hour
      let maxViews = hourlyActivity[0].estimatedViews;
      let peakHour = 0;
      for (let h = 1; h < 24; h++) {
        if (hourlyActivity[h].estimatedViews > maxViews) {
          maxViews = hourlyActivity[h].estimatedViews;
          peakHour = h;
        }
      }

      // Overall confidence
      const hoursWithData = hourlyActivity.filter((h) => h.videoCount >= 3).length;
      let confidence = 'low';
      if (totalVideos >= 30 && hoursWithData >= 20) confidence = 'high';
      else if (totalVideos >= 15 && hoursWithData >= 12) confidence = 'medium';

      const peakHourLabel = HOUR_LABELS[peakHour];

      const elapsed = perfNow() - start;
      console.log(
        `[Insights] AudienceActiveTime(Db) ${channelId}: ${totalVideos} videos, ` +
        `${totalEstimatedViews.toLocaleString()} total est. views, ` +
        `${hoursWithData}/24 hours with data, peak=${peakHourLabel}, confidence=${confidence} (${Math.round(elapsed)}ms)`,
      );

      const result = {
        hourly: hourlyActivity,
        peakHour,
        peakHourLabel,
        confidence,
        totalVideosAnalyzed: totalVideos,
        modelParameters: { tau: TAU, beta: BETA, sigma: SIGMA },
      };

      await serverCache.set(cacheKey, result, INSIGHTS_CACHE_TTL);
      return result;
    } catch (err) {
      console.error('[Insights] AudienceActiveTime(Db) failed:', err.message, err.stack?.split('\n').slice(0, 4).join('\n'));
      return null;
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  return {
    generateBestTimeToPost,
    generateBestTimeToPostFromDb,
    generateRetentionByHour,
    generateRetentionByPublishHour,
    generateAudienceActiveTime,
    generateAudienceActiveTimeFromDb,
    bestTimeCacheKey,
    retentionCacheKey,
    retentionByHourCacheKey,
  };
}

module.exports = { createInsightsService };

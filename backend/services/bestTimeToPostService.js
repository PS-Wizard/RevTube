/**
 * Best Time to Post -- DB-powered publish-time performance algorithm.
 *
 * Reads per-video data from `analytics_videos`, applies rolling-median
 * normalization, winsorized z-score composites, empirical-Bayes shrinkage,
 * bootstrap confidence intervals, and Kruskal-Wallis significance testing.
 *
 * No YouTube API calls needed -- all computation is server-side from
 * ingested PostgreSQL data.
 */

const {
  computeMedian,
  computeWinsorizedZScore,
  bootstrapMeanCI,
  kruskalWallis,
} = require('../utils/statistics');

// ── Constants ──────────────────────────────────────────────────────────

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYPART_LABELS_6 = ['Overnight', 'Early Morning', 'Morning', 'Afternoon', 'Evening', 'Night'];
const DAYPART_RANGES_6 = [
  { start: 0, end: 5 },    // Overnight: 12am-5am
  { start: 5, end: 9 },    // Early Morning: 5am-9am
  { start: 9, end: 12 },   // Morning: 9am-12pm
  { start: 12, end: 16 },  // Afternoon: 12pm-4pm
  { start: 16, end: 20 },  // Evening: 4pm-8pm
  { start: 20, end: 24 },  // Night: 8pm-12am
];

// Legacy 4-part dayparts (kept for backward compat with dayDaypartGrid)
const DAYPART_LABELS_4 = ['Night', 'Morning', 'Afternoon', 'Evening'];
const DAYPART_RANGES_4 = [
  { start: 0, end: 6 },    // Night: 12am-6am
  { start: 6, end: 12 },   // Morning: 6am-12pm
  { start: 12, end: 18 },  // Afternoon: 12pm-6pm
  { start: 18, end: 24 },  // Evening: 6pm-12am
];

const INSIGHTS_CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours

// Minimum videos needed for meaningful analysis
const MIN_VIDEOS = 10;

// Rolling median window size
const ROLLING_WINDOW = 10;

// Empirical-Bayes shrinkage strength
const SHRINKAGE_K = 4;

// Minimum videos in a bucket for bootstrap CI
const MIN_BOOTSTRAP = 4;

// Minimum videos for grid heatmap
const GRID_MIN_VIDEOS = 150;

// Valid segments
const SEGMENTS = { ALL: 'all', SHORTS: 'shorts', LONG: 'long' };
const DEFAULT_TIMEZONE = 'UTC';

// Composite weights: views 0.6, engagement (like_rate) 0.4
const W_VIEWS = 0.6;
const W_ENGAGEMENT = 0.4;

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Parse ISO 8601 duration string to seconds.
 * Handles "PT1H2M3S", "PT10M", "PT30S", plain numbers, null.
 */
function parseDurationToSeconds(isoDuration) {
  if (!isoDuration) return 0;
  if (typeof isoDuration === 'number') return Math.round(isoDuration);
  const match = String(isoDuration).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
  if (!match) return 0;
  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Get daypart index (0=Overnight, 1=Early Morning, 2=Morning, 3=Afternoon, 4=Evening, 5=Night) from hour.
 * Uses the spec's 6-part daypart scheme.
 */
function getDaypartIndex(hour) {
  if (hour >= 5 && hour < 9) return 1;   // Early Morning
  if (hour >= 9 && hour < 12) return 2;  // Morning
  if (hour >= 12 && hour < 16) return 3; // Afternoon
  if (hour >= 16 && hour < 20) return 4; // Evening
  if (hour >= 20) return 5;              // Night
  return 0;                               // Overnight
}

/**
 * Get old 4-part daypart index (used for dayDaypartGrid backward compat).
 */
function getOldDaypartIndex(hour) {
  if (hour >= 6 && hour < 12) return 1;  // Morning
  if (hour >= 12 && hour < 18) return 2; // Afternoon
  if (hour >= 18) return 3;              // Evening
  return 0;                               // Night
}

// ── Service factory ─────────────────────────────────────────────────────

function createBestTimeToPostService(deps) {
  const { serverCache, query, perfLog, perfNow } = deps;

  // ── Step 1: Fetch per-video data ──────────────────────────────────────

  /**
   * Fetch per-video analytics from Postgres with timezone-aware bucketing.
   *
   * @param {string} channelId
   * @param {string} [timezone='UTC'] -- IANA timezone (e.g. 'Asia/Tokyo').
   *   Uses Postgres `AT TIME ZONE` which is DST-aware.
   *
   * @param {string} channelId
   * @param {string} [timezone='UTC']
   * @param {number} [period]
   * @param {string} [startDate]
   * @param {string} [endDate]
   */
  async function getVideosFromPostgres(channelId, timezone = DEFAULT_TIMEZONE, period, startDate, endDate) {
    const start = perfNow();

    // Build optional date filter
    let dateClause = '';
    const params = [channelId, timezone];
    if (startDate && endDate) {
      dateClause = `AND published_at >= $3::date AND published_at < $4::date + 1`;
      params.push(startDate, endDate);
    } else if (period) {
      dateClause = `AND published_at >= CURRENT_DATE - $3`;
      params.push(period);
    }

    const result = await query(
      `SELECT video_id, published_at, duration, view_count, like_count, comment_count,
              EXTRACT(HOUR FROM published_at AT TIME ZONE $2)::int AS local_hour,
              EXTRACT(DOW FROM published_at AT TIME ZONE $2)::int AS local_dow
       FROM analytics_videos
       WHERE channel_id = $1
         AND published_at IS NOT NULL
         AND duration IS NOT NULL AND duration != ''
         ${dateClause}
       ORDER BY published_at ASC`,
      params,
    );
    perfLog('bttp.query', start, { channelId, timezone, rows: result?.rows?.length || 0 });
    return result?.rows || [];
  }

  // ── Step 2: Preprocess / enrich videos ────────────────────────────────

  function enrichVideos(rows) {
    return rows.map((row) => {
      const durationSecs = parseDurationToSeconds(row.duration);
      const viewCount = Number(row.view_count) || 0;
      const likeCount = Number(row.like_count) || 0;
      const commentCount = Number(row.comment_count) || 0;

      return {
        videoId: row.video_id,
        publishedAt: row.published_at,
        publishedHour: row.local_hour,      // timezone-aware from SQL AT TIME ZONE
        publishedDayOfWeek: row.local_dow,   // timezone-aware from SQL AT TIME ZONE
        durationSeconds: durationSecs,
        isShort: durationSecs > 0 && durationSecs <= 60,
        viewCount,
        likeCount,
        commentCount,
        likeRate: viewCount > 0 ? likeCount / viewCount : 0,
        commentRate: viewCount > 0 ? commentCount / viewCount : 0,
        daypart: getDaypartIndex(row.local_hour),
      };
    });
  }

  // ── Step 3: Rolling median normalisation ──────────────────────────────

  /**
   * For each video (sorted by publish date ASC), compute the ratio of its
   * view_count to the median of its `windowSize` nearest chronological
   * neighbours (excluding itself).
   *
   * This deconfounds channel growth: a video published when the channel
   * was small is compared against contemporaneous peers, not against a
   * video published years later with a much larger subscriber base.
   */
  function computeRollingMedianNormalization(videos, windowSize = ROLLING_WINDOW) {
    const viewCounts = videos.map((v) => v.viewCount);

    return videos.map((video, i) => {
      const half = Math.floor(windowSize / 2);
      const lo = Math.max(0, i - half);
      const hi = Math.min(videos.length, i + half + 1);
      const window = [];

      for (let j = lo; j < hi; j++) {
        if (j !== i) window.push(viewCounts[j]);
      }

      const median = window.length > 0 ? computeMedian(window) : viewCounts[i];
      const normalizedViews = median > 0 ? video.viewCount / median : 1;

      return { ...video, normalizedViews };
    });
  }

  // ── Step 4: Composite scores ──────────────────────────────────────────

  function computeCompositeScores(videos) {
    const normViews = videos.map((v) => v.normalizedViews);
    const likeRates = videos.map((v) => v.likeRate);
    const commentRates = videos.map((v) => v.commentRate);

    const zViews = computeWinsorizedZScore(normViews);
    const zEngagement = computeWinsorizedZScore(likeRates);
    const zComments = computeWinsorizedZScore(commentRates);

    return videos.map((video, i) => ({
      ...video,
      normalizedViewsZ: zViews[i],
      likeRateZ: zEngagement[i],
      commentRateZ: zComments[i],
      compositeScore: W_VIEWS * zViews[i] + W_ENGAGEMENT * zEngagement[i],
    }));
  }

  // ── Step 5: Bucketing ─────────────────────────────────────────────────

  function bucketByDayOfWeek(scoredVideos) {
    const buckets = Array.from({ length: 7 }, (_, day) => ({
      day,
      label: DAY_LABELS[day],
      scores: [],
      viewsZScores: [],
      engagementZScores: [],
      commentZScores: [],
      videoCount: 0,
    }));

    scoredVideos.forEach((v) => {
      buckets[v.publishedDayOfWeek].scores.push(v.compositeScore);
      buckets[v.publishedDayOfWeek].viewsZScores.push(v.normalizedViewsZ);
      buckets[v.publishedDayOfWeek].engagementZScores.push(v.likeRateZ);
      buckets[v.publishedDayOfWeek].commentZScores.push(v.commentRateZ);
      buckets[v.publishedDayOfWeek].videoCount++;
    });

    return buckets;
  }

  function bucketByDaypart(scoredVideos) {
    const buckets = Array.from({ length: 6 }, (_, dp) => ({
      daypart: dp,
      label: DAYPART_LABELS_6[dp],
      scores: [],
      viewsZScores: [],
      engagementZScores: [],
      commentZScores: [],
      videoCount: 0,
    }));

    scoredVideos.forEach((v) => {
      // Use the old 4-part daypart index for grid compat; keep 6-part for main analysis
      buckets[v.daypart].scores.push(v.compositeScore);
      buckets[v.daypart].viewsZScores.push(v.normalizedViewsZ);
      buckets[v.daypart].engagementZScores.push(v.likeRateZ);
      buckets[v.daypart].commentZScores.push(v.commentRateZ);
      buckets[v.daypart].videoCount++;
    });

    return buckets;
  }

  function bucketByHour(scoredVideos) {
    const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => {
      if (h === 0) return '12AM';
      if (h === 12) return '12PM';
      return h < 12 ? `${h}AM` : `${h - 12}PM`;
    });
    const buckets = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      label: HOUR_LABELS[hour],
      scores: [],
      viewsZScores: [],
      engagementZScores: [],
      commentZScores: [],
      videoCount: 0,
    }));

    scoredVideos.forEach((v) => {
      buckets[v.publishedHour].scores.push(v.compositeScore);
      buckets[v.publishedHour].viewsZScores.push(v.normalizedViewsZ);
      buckets[v.publishedHour].engagementZScores.push(v.likeRateZ);
      buckets[v.publishedHour].commentZScores.push(v.commentRateZ);
      buckets[v.publishedHour].videoCount++;
    });

    return buckets;
  }

  function bucketByDayAndDaypart(scoredVideos) {
    const cells = [];
    for (let day = 0; day < 7; day++) {
      for (let dp = 0; dp < 4; dp++) {
        const videos = scoredVideos.filter(
          (v) => v.publishedDayOfWeek === day && v.daypart === dp,
        );
        if (videos.length > 0) {
          const scores = videos.map((v) => v.compositeScore);
          cells.push({
            day,
            daypart: dp,
            label: `${DAY_LABELS[day]} ${DAYPART_LABELS_4[dp]}`,
            scores,
            videoCount: videos.length,
            medianComposite: computeMedian(scores),
          });
        }
      }
    }
    return cells;
  }

  // ── Step 6: Empirical-Bayes shrinkage ─────────────────────────────────

  function shrinkBuckets(buckets, globalMedian, k = SHRINKAGE_K) {
    return buckets.map((bucket) => {
      const n = bucket.videoCount;
      if (n === 0) {
        return { ...bucket, shrunkScore: globalMedian, shrinkageWeight: 0, medianComposite: globalMedian };
      }
      const med = computeMedian(bucket.scores);
      const weight = n / (n + k);
      const shrunk = weight * med + (1 - weight) * globalMedian;
      return { ...bucket, shrunkScore: shrunk, shrinkageWeight: weight, medianComposite: med };
    });
  }

  // ── Step 7: Bootstrap confidence intervals ────────────────────────────

  function addConfidenceIntervals(buckets) {
    return buckets.map((bucket) => {
      if (bucket.videoCount < MIN_BOOTSTRAP) {
        return { ...bucket, ci: { lower: null, upper: null } };
      }
      const ci = bootstrapMeanCI(bucket.scores);
      return { ...bucket, ci };
    });
  }

  // ── Step 8: Kruskal-Wallis test ───────────────────────────────────────

  function testSignificance(buckets) {
    const groups = buckets
      .filter((b) => b.videoCount > 0)
      .map((b) => ({ label: b.label, scores: b.scores }));

    if (groups.length < 2) {
      return { H: 0, df: 0, p: 1.0 };
    }

    return kruskalWallis(groups);
  }

  // ── Step 9: Confidence tiers ──────────────────────────────────────────

  function assignConfidenceTiers(buckets, kwResult, globalMedian) {
    const significant = kwResult.p < 0.05;

    return buckets.map((bucket) => {
      if (bucket.videoCount < MIN_BOOTSTRAP) {
        return { ...bucket, confidenceTier: 'Exploratory' };
      }

      const ciExcludesMedian =
        bucket.ci.lower !== null &&
        bucket.ci.upper !== null &&
        !(bucket.ci.lower <= globalMedian && bucket.ci.upper >= globalMedian);

      if (bucket.videoCount >= 8 && ciExcludesMedian && significant) {
        return { ...bucket, confidenceTier: 'High' };
      }

      if (bucket.videoCount >= 4) {
        return { ...bucket, confidenceTier: 'Medium' };
      }

      return { ...bucket, confidenceTier: 'Exploratory' };
    });
  }

  // ── Orchestrator ──────────────────────────────────────────────────────

  /**
   * Generate the complete Best Time to Post analysis for a channel.
   *
   * @param {{
   *   channelId: string,
   *   timezone?: string,   // IANA timezone, e.g. 'Asia/Tokyo', defaults to 'UTC'
   *   segment?: string,    // 'all' | 'shorts' | 'long', defaults to 'all'
   *   period?: number,
   *   startDate?: string,
   *   endDate?: string,
   * }} params
   * @returns {Promise<object|null>} Analysis result, or null if insufficient data.
   */
  async function generateBestTimeToPost({ channelId, timezone = DEFAULT_TIMEZONE, segment = SEGMENTS.ALL, period, startDate, endDate }) {
    const start = perfNow();

    // Build a cache key scoped by timezone and segment so users switching
    // timezones or segments get the correct cached results.
    const sanitizedTz = timezone.replace(/[^a-zA-Z0-9_\/-]/g, '_');
    const ds = startDate && endDate ? `:${startDate}:${endDate}` : `:p${period || 90}`;
    const cacheKey = `insights:bestTimeToPost:v7:${channelId}:${sanitizedTz}:${segment}${ds}`;

    // 1. Check cache
    const cached = await serverCache.get(cacheKey);
    if (cached) {
      perfLog('bttp.cacheHit', start, { channelId });
      return cached;
    }

    // 2. Fetch data (timezone-aware via SQL AT TIME ZONE)
    const rows = await getVideosFromPostgres(channelId, timezone, period, startDate, endDate);
    if (!rows || rows.length < MIN_VIDEOS) {
      perfLog('bttp.insufficientData', start, { channelId, timezone, count: rows?.length || 0 });
      return null;
    }

    // 3. Preprocess
    const enriched = enrichVideos(rows);

    // 3b. Filter by segment if requested
    let segmentFiltered = enriched;
    if (segment === SEGMENTS.SHORTS) {
      segmentFiltered = enriched.filter((v) => v.isShort);
    } else if (segment === SEGMENTS.LONG) {
      segmentFiltered = enriched.filter((v) => !v.isShort);
    }

    if (segmentFiltered.length < MIN_VIDEOS) {
      perfLog('bttp.insufficientSegment', start, { channelId, segment, count: segmentFiltered.length });
      return null;
    }

    const shortsCount = segmentFiltered.filter((v) => v.isShort).length;
    const longCount = segmentFiltered.length - shortsCount;

    // 4. Rolling median normalization (on segment-filtered data)
    const normalized = computeRollingMedianNormalization(segmentFiltered);

    // 5. Composite scores
    const scored = computeCompositeScores(normalized);

    // 6. Bucket by day-of-week, daypart, and hour
    const rawDOW = bucketByDayOfWeek(scored);
    const rawDaypart = bucketByDaypart(scored);
    const rawHour = bucketByHour(scored);
    // Day×Daypart grid uses the 4-part daypart for backward compat
    const scoredWithOldDaypart = scored.map((v) => ({
      ...v,
      daypart: getOldDaypartIndex(v.publishedHour),
    }));
    const rawGrid = segmentFiltered.length >= GRID_MIN_VIDEOS
      ? bucketByDayAndDaypart(scoredWithOldDaypart)
      : [];

    // 7. Bootstrap CIs
    const withCIDOW = addConfidenceIntervals(rawDOW);
    const withCIDaypart = addConfidenceIntervals(rawDaypart);
    const withCIHour = addConfidenceIntervals(rawHour);

    // 8. Kruskal-Wallis
    const kwResult = testSignificance(rawDOW);

    // 9. Global median
    const allScores = scored.map((v) => v.compositeScore);
    const globalMedian = computeMedian(allScores);

    // 10. Empirical-Bayes shrinkage
    const shrunkDOW = shrinkBuckets(withCIDOW, globalMedian);
    const shrunkDaypart = shrinkBuckets(withCIDaypart, globalMedian);
    const shrunkHour = shrinkBuckets(withCIHour, globalMedian);

    // 11. Confidence tiers
    const tieredDOW = assignConfidenceTiers(shrunkDOW, kwResult, globalMedian);
    const tieredDaypart = assignConfidenceTiers(shrunkDaypart, kwResult, globalMedian);
    const tieredHour = assignConfidenceTiers(shrunkHour, kwResult, globalMedian);

    // 12. Find best day-of-week
    const bestDOW = tieredDOW.reduce(
      (best, b) => (b.videoCount > 0 && b.shrunkScore > best.shrunkScore ? b : best),
      tieredDOW[0],
    );

    // 12a. Find best daypart
    const bestDaypart = tieredDaypart.reduce(
      (best, b) => (b.videoCount > 0 && b.shrunkScore > best.shrunkScore ? b : best),
      tieredDaypart[0],
    );

    // 12b. Find best hour (composite)
    const bestHour = tieredHour.reduce(
      (best, b) => (b.videoCount > 0 && b.shrunkScore > best.shrunkScore ? b : best),
      tieredHour[0],
    );

    // 12c. Find best hour per metric (median of z-scores)
    const bestHourForViews = tieredHour.reduce(
      (best, b) => {
        const viewsMed = b.viewsZScores?.length > 0 ? computeMedian(b.viewsZScores) : -Infinity;
        const bestViewsMed = best.viewsZScores?.length > 0 ? computeMedian(best.viewsZScores) : -Infinity;
        return viewsMed > bestViewsMed ? b : best;
      },
      tieredHour[0],
    );
    const bestHourForEngagement = tieredHour.reduce(
      (best, b) => {
        const engMed = b.engagementZScores?.length > 0 ? computeMedian(b.engagementZScores) : -Infinity;
        const bestEngMed = best.engagementZScores?.length > 0 ? computeMedian(best.engagementZScores) : -Infinity;
        return engMed > bestEngMed ? b : best;
      },
      tieredHour[0],
    );
    const bestHourForComments = tieredHour.reduce(
      (best, b) => {
        const commMed = b.commentZScores?.length > 0 ? computeMedian(b.commentZScores) : -Infinity;
        const bestCommMed = best.commentZScores?.length > 0 ? computeMedian(best.commentZScores) : -Infinity;
        return commMed > bestCommMed ? b : best;
      },
      tieredHour[0],
    );

    // Format output
    const result = {
      // Hourly breakdown (24 hours) -- primary view
      hourly: tieredHour.map((b) => ({
        hour: b.hour,
        label: b.label,
        medianComposite: b.medianComposite,
        shrunkScore: b.shrunkScore,
        confidenceTier: b.confidenceTier,
        ciLower: b.ci?.lower ?? null,
        ciUpper: b.ci?.upper ?? null,
        videoCount: b.videoCount,
        medianViewsZ: b.viewsZScores?.length > 0 ? computeMedian(b.viewsZScores) : 0,
        medianEngagementZ: b.engagementZScores?.length > 0 ? computeMedian(b.engagementZScores) : 0,
        medianCommentsZ: b.commentZScores?.length > 0 ? computeMedian(b.commentZScores) : 0,
      })),
      // Day-of-week breakdown (kept for backward compat)
      dayOfWeek: tieredDOW.map((b) => ({
        day: b.day,
        label: b.label,
        medianComposite: b.medianComposite,
        shrunkScore: b.shrunkScore,
        confidenceTier: b.confidenceTier,
        ciLower: b.ci?.lower ?? null,
        ciUpper: b.ci?.upper ?? null,
        videoCount: b.videoCount,
        medianViewsZ: b.viewsZScores?.length > 0 ? computeMedian(b.viewsZScores) : 0,
        medianEngagementZ: b.engagementZScores?.length > 0 ? computeMedian(b.engagementZScores) : 0,
        medianCommentsZ: b.commentZScores?.length > 0 ? computeMedian(b.commentZScores) : 0,
      })),
      // Daypart breakdown
      daypart: tieredDaypart.map((b) => ({
        daypart: b.daypart,
        label: b.label,
        medianComposite: b.medianComposite,
        shrunkScore: b.shrunkScore,
        confidenceTier: b.confidenceTier,
        ciLower: b.ci?.lower ?? null,
        ciUpper: b.ci?.upper ?? null,
        videoCount: b.videoCount,
        medianViewsZ: b.viewsZScores?.length > 0 ? computeMedian(b.viewsZScores) : 0,
        medianEngagementZ: b.engagementZScores?.length > 0 ? computeMedian(b.engagementZScores) : 0,
        medianCommentsZ: b.commentZScores?.length > 0 ? computeMedian(b.commentZScores) : 0,
      })),
      // Day × Daypart grid (only when enough videos)
      dayDaypartGrid: rawGrid.map((cell) => ({
        day: cell.day,
        daypart: cell.daypart,
        label: cell.label,
        medianComposite: cell.medianComposite,
        videoCount: cell.videoCount,
        confidenceTier: cell.videoCount >= MIN_BOOTSTRAP
          ? (kwResult.p < 0.05 && cell.videoCount >= 8 ? 'High' : cell.videoCount >= 4 ? 'Medium' : 'Exploratory')
          : 'Exploratory',
      })),
      // Global stats
      globalMedianCompositeScore: globalMedian,
      kruskalWallis: kwResult,
      // Best hour (composite)
      bestHour: bestHour.hour,
      bestHourLabel: bestHour.label,
      bestHourScore: bestHour.shrunkScore,
      // Best hour per metric
      bestHourForViews: bestHourForViews.hour,
      bestHourForViewsLabel: bestHourForViews.label,
      bestHourForEngagement: bestHourForEngagement.hour,
      bestHourForEngagementLabel: bestHourForEngagement.label,
      bestHourForComments: bestHourForComments.hour,
      bestHourForCommentsLabel: bestHourForComments.label,
      // Day-of-week best (kept for backward compat)
      bestDayOfWeek: bestDOW.day,
      bestDayOfWeekLabel: bestDOW.label,
      bestDayOfWeekScore: bestDOW.shrunkScore,
      bestDaypart: bestDaypart.daypart,
      bestDaypartLabel: bestDaypart.label,
      bestDaypartScore: bestDaypart.shrunkScore,
      // Metadata
      timezone,
      segment,
      totalVideosAnalyzed: scored.length,
      shortsCount,
      longCount,
      isSignificant: kwResult.p < 0.05,
    };

    // 14. Cache & return
    await serverCache.set(cacheKey, result, INSIGHTS_CACHE_TTL);
    perfLog('bttp.complete', start, {
      channelId,
      timezone,
      segment,
      videos: scored.length,
      bestHour: bestHour.label,
      kruskalP: kwResult.p.toFixed(4),
    });

    return result;
  }

  return {
    generateBestTimeToPost,
    // Exposed for testing
    parseDurationToSeconds,
    computeRollingMedianNormalization,
    computeCompositeScores,
    bucketByDayOfWeek,
    bucketByDaypart,
    bucketByHour,
    shrinkBuckets,
    assignConfidenceTiers,
    SEGMENTS,
    DEFAULT_TIMEZONE,
  };
}

module.exports = { createBestTimeToPostService };

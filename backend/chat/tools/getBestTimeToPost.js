/**
 * Tool: getBestTimeToPost
 * Get optimal posting time recommendations for a channel using
 * existing insightsService when available, or DB fallback.
 * Returns scores, significance, and confidence tiers per time slot.
 */
const { verifyChannelAccess } = require('./shared');

module.exports = {
  name: 'getBestTimeToPost',
  description: 'Get optimal posting time recommendations for one of your channels. Returns the best days and times to publish based on audience activity patterns, with scoring, significance, and confidence tiers.',
  parameters: {
    type: 'object',
    properties: {
      channelId: {
        type: 'string',
        description: 'The YouTube channel ID to analyze (must be one of your connected channels)',
      },
    },
    required: ['channelId'],
  },

  execute: async (args, { deps, userChannels, userContext }) => {
    const { channelId } = args;

    // Verify the user owns this channel or is admin
    const access = verifyChannelAccess(channelId, userChannels, userContext);
    if (!access.allowed) return { error: access.error };
    const { query: dbQuery, isPostgresConfigured, serverCache } = deps;

    if (!isPostgresConfigured()) {
      return { error: 'Database is not configured.' };
    }

    try {
      // Try the full bestTimeToPostService first (has advanced stats)
      if (deps.generateBestTimeToPost) {
        try {
          const result = await deps.generateBestTimeToPost({ channelId });
          if (result && result.hourly) {
            return formatBestTimeResult(result);
          }
        } catch (svcErr) {
          console.warn('[Tool:getBestTimeToPost] Service failed, falling back:', svcErr.message);
        }
      }

      // Try the legacy insightsService if available
      if (deps.generateInsights) {
        try {
          const insights = await deps.generateInsights(channelId, 90);
          if (insights && insights.bestDayToPost != null) {
            return formatBestTimeResult(insights);
          }
        } catch (svcErr) {
          console.warn('[Tool:getBestTimeToPost] Insights service failed, falling back to DB:', svcErr.message);
        }
      }

      // Fallback: enhanced DB query with scoring and significance
      const dbResult = await dbQuery(
        `SELECT
           EXTRACT(DOW FROM metric_date)::int AS day_of_week,
           COUNT(*)::int AS days_count,
           COALESCE(AVG(views), 0)::numeric(10,1) AS avg_views,
           COALESCE(AVG(estimated_minutes_watched), 0)::numeric(10,1) AS avg_watch_time,
           COALESCE(SUM(views), 0)::bigint AS total_views,
           COALESCE(STDDEV(views), 0)::numeric(10,1) AS stddev_views,
           COALESCE(MAX(views), 0)::bigint AS max_views,
           COALESCE(MIN(views), 0)::bigint AS min_views
         FROM analytics_video_metrics_daily
         WHERE channel_id = $1
           AND metric_date >= CURRENT_DATE - 90
         GROUP BY EXTRACT(DOW FROM metric_date)
         ORDER BY avg_views DESC`,
        [channelId],
      );

      if (!dbResult?.rows?.length) {
        return { error: 'No data available for best time to post analysis.' };
      }

      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

      // Compute total across all days for relative scoring
      const totalViews = dbResult.rows.reduce((s, r) => s + Number(r.total_views || 0), 0);
      const maxAvgViews = Math.max(...dbResult.rows.map((r) => Number(r.avg_views || 0)));

      const dayData = dbResult.rows.map((r) => {
        const avgViews = Number(r.avg_views) || 0;
        const score = maxAvgViews > 0 ? (avgViews / maxAvgViews) * 100 : 0;
        let confidenceTier = 'Exploratory';
        const count = r.days_count || 0;
        const stddev = Number(r.stddev_views) || 0;
        if (count >= 10 && stddev < avgViews * 0.5) confidenceTier = 'High';
        else if (count >= 5) confidenceTier = 'Medium';

        return {
          day: dayNames[r.day_of_week] || `Day ${r.day_of_week}`,
          averageViews: avgViews,
          score: Math.round(score),
          confidenceTier,
          daysWithData: count,
          totalViews: Number(r.total_views) || 0,
          maxViews: Number(r.max_views) || 0,
          minViews: Number(r.min_views) || 0,
          stddevViews: stddev,
        };
      });

      const bestDay = dayData[0];
      const sortedByDay = dayData.sort((a, b) => {
        const dayOrder = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
        return (dayOrder[a.day] || 0) - (dayOrder[b.day] || 0);
      });

      return {
        bestDayToPost: bestDay?.day || null,
        bestDayScore: bestDay?.score || 0,
        bestDayAverageViews: bestDay?.averageViews || 0,
        dayBreakdown: sortedByDay,
        dataSource: 'database (last 90 days)',
        totalViewsAnalyzed: totalViews,
        note: 'Based on historical audience activity. Best times are approximate.',
      };
    } catch (err) {
      console.warn('[Tool:getBestTimeToPost] Failed:', err.message);
      return { error: `Failed to analyze posting times: ${err.message}` };
    }
  },
};

/** Format the insights service output -- pass through rich data with scores and significance. */
function formatBestTimeResult(result) {
  // If the result is from bestTimeToPostService (has hourly/dayOfWeek breakdowns)
  if (result.hourly) {
    let significanceNote = '';
    if (result.isSignificant === true && result.kruskalWallis?.p != null) {
      significanceNote = 'The pattern is statistically significant (p=' + Number(result.kruskalWallis.p).toFixed(4) + ', Kruskal-Wallis test).';
    } else if (result.isSignificant === false && result.kruskalWallis?.p != null) {
      significanceNote = 'Note: the differences between time slots are not statistically significant (p=' + Number(result.kruskalWallis.p).toFixed(4) + '), so consider these as rough guidance.';
    }

    const recommendation = result.bestHourLabel && result.bestDayOfWeekLabel != null
      ? 'Best overall: **' + result.bestDayOfWeekLabel + '** around **' + result.bestHourLabel + '** (score: ' + Number(result.bestDayOfWeekScore || result.bestHourScore).toFixed(2) + ')'
      : null;

    return {
      ...result,
      recommendation,
      significanceNote,
      dataSource: 'analytics service',
    };
  }

  // Legacy format fallback (from insightsService)
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const bestDay = result.bestDayToPost;
  const bestDayName = typeof bestDay === 'number' ? (dayNames[bestDay] || 'Day ' + bestDay) : bestDay;

  return {
    bestDayToPost: bestDayName,
    bestTimeToPost: result.bestTimeToPost || null,
    dayBreakdown: result.dayBreakdown || result.days || null,
    dataSource: 'analytics service',
  };
}

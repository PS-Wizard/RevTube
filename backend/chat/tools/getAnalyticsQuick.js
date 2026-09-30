/**
 * Tool: getAnalyticsQuick
 * Get a quick analytics overview for a channel -- views, watch time, subscribers,
 * likes, comments, and retention for the last 7, 30, and 90 days.
 *
 * Uses the existing generateDashboardSummary service when possible,
 * falls back to direct DB queries.
 */
const { verifyChannelAccess } = require('./shared');

module.exports = {
  name: 'getAnalyticsQuick',
  description: 'Get a quick analytics overview for one of your channels. Returns views, watch time, subscriber changes, likes, shares, comments, and retention for the last 7, 30, and 90 day periods.',
  parameters: {
    type: 'object',
    properties: {
      channelId: {
        type: 'string',
        description: 'The YouTube channel ID to get analytics for (must be one of your connected channels)',
      },
      period: {
        type: 'string',
        enum: ['7', '30', '90'],
        description: 'Primary period in days (7, 30, or 90)',
        default: '30',
      },
    },
    required: ['channelId'],
  },

  execute: async (args, { deps, userContext, userChannels }) => {
    const { channelId, period = '30' } = args;

    // Verify the user owns this channel or is admin
    const access = verifyChannelAccess(channelId, userChannels, userContext);
    if (!access.allowed) return { error: access.error };
    const { query: dbQuery, isPostgresConfigured, serverCache } = deps;

    if (!isPostgresConfigured()) {
      return { error: 'Database is not configured for analytics queries.' };
    }

    try {
      // Try to use the existing summary service if available
      if (deps.generateDashboardSummary) {
        try {
          const summary = await deps.generateDashboardSummary({
            channelId,
            period: String(period),
            compare: true,
            trueDelta: false,
            filters: '',
            scope: `u:${userContext?.email || 'unknown'}`,
          });

          if (summary) {
            return formatSummary(summary, period);
          }
        } catch (svcErr) {
          console.warn('[Tool:getAnalyticsQuick] Service call failed, falling back to DB:', svcErr.message);
        }
      }

      // Fallback: direct DB queries
      const safeDays = Math.min(Math.max(1, Number(period) || 30), 90);

      // Channel verify
      const channelResult = await dbQuery(
        'SELECT title FROM analytics_channels WHERE channel_id = $1',
        [channelId],
      );
      if (!channelResult?.rows?.length) {
        return { error: `Channel "${channelId}" not found in database.` };
      }

      // Recent daily metrics aggregated
      const metricsResult = await dbQuery(
        `SELECT
           COUNT(*)::int AS days_with_data,
           COALESCE(SUM(views), 0)::bigint AS total_views,
           COALESCE(SUM(estimated_minutes_watched), 0)::bigint AS total_watch_time,
           COALESCE(SUM(subscribers_gained), 0)::bigint AS subs_gained,
           COALESCE(SUM(subscribers_lost), 0)::bigint AS subs_lost,
           COALESCE(SUM(likes), 0)::bigint AS total_likes,
           COALESCE(SUM(shares), 0)::bigint AS total_shares,
           COALESCE(SUM(comments), 0)::bigint AS total_comments
         FROM analytics_video_metrics_daily
         WHERE channel_id = $1
           AND metric_date >= CURRENT_DATE - $2::int`,
        [channelId, safeDays],
      );

      const m = metricsResult?.rows?.[0] || {};
      const channel = channelResult.rows[0];

      return {
        channelId,
        channelTitle: channel.title || 'Unknown',
        period: `${safeDays} days`,
        metrics: {
          totalViews: m.total_views || 0,
          totalWatchTimeMinutes: m.total_watch_time || 0,
          netSubscribers: (m.subs_gained || 0) - (m.subs_lost || 0),
          subscribersGained: m.subs_gained || 0,
          subscribersLost: m.subs_lost || 0,
          likes: m.total_likes || 0,
          shares: m.total_shares || 0,
          comments: m.total_comments || 0,
          daysWithData: m.days_with_data || 0,
        },
        note: 'Data from ingested analytics. May not reflect real-time values.',
      };
    } catch (err) {
      console.warn('[Tool:getAnalyticsQuick] Failed:', err.message);
      return { error: `Failed to get analytics: ${err.message}` };
    }
  },
};

/** Format the summary service output into a clean response. */
function formatSummary(summary, period) {
  const periodKey = `d${period}`;
  const data = summary[periodKey] || summary;

  return {
    channelId: summary.channelId,
    latestDate: summary.latestDate,
    period: `${period} days`,
    current: data?.current ? {
      views: data.current.views || 0,
      watchTimeMinutes: data.current.watchTime || 0,
      subscribers: data.current.subscribers || 0,
      subscribersGained: data.current.subscribersGained || 0,
      subscribersLost: data.current.subscribersLost || 0,
      likes: data.current.likes || 0,
      shares: data.current.shares || 0,
      comments: data.current.comments || 0,
      averageRetention: data.current.retention || 0,
    } : null,
    previous: data?.previous ? {
      views: data.previous.views || 0,
      watchTimeMinutes: data.previous.watchTime || 0,
      subscribers: data.previous.subscribers || 0,
      likes: data.previous.likes || 0,
    } : null,
    source: summary.lastSyncedAt ? 'database' : 'live',
  };
}

/**
 * Tool: getChannelInfo
 * Get channel profile and aggregated statistics from the database.
 */
const { verifyChannelAccess } = require('./shared');

module.exports = {
  name: 'getChannelInfo',
  description: 'Get detailed channel information including subscriber counts, total views, and recent activity. Returns channel profile with aggregated metrics. Only works for your own connected channels.',
  parameters: {
    type: 'object',
    properties: {
      channelId: {
        type: 'string',
        description: 'The YouTube channel ID to look up (must be one of your connected channels)',
      },
      daysBack: {
        type: 'number',
        description: 'Number of days of historical data to include (default 30)',
        default: 30,
      },
    },
    required: ['channelId'],
  },

  execute: async (args, { deps, userChannels, userContext }) => {
    const { channelId, daysBack = 30 } = args;

    // Verify the user owns this channel or is admin
    const access = verifyChannelAccess(channelId, userChannels, userContext);
    if (!access.allowed) return { error: access.error };
    const { query: dbQuery, isPostgresConfigured, serverCache } = deps;

    if (!isPostgresConfigured()) {
      return { error: 'Database is not configured.' };
    }

    const safeDays = Math.min(Math.max(1, Number(daysBack) || 30), 365);

    try {
      // Channel profile
      const channelResult = await dbQuery(
        'SELECT channel_id, title, uploads_playlist_id, last_synced_at FROM analytics_channels WHERE channel_id = $1',
        [channelId],
      );

      if (!channelResult?.rows?.length) {
        return { error: `Channel "${channelId}" not found in database.` };
      }

      const channel = channelResult.rows[0];

      // Video count + total stats
      const statsResult = await dbQuery(
        `SELECT COUNT(*)::int AS video_count,
                COALESCE(SUM(view_count), 0)::bigint AS total_views,
                COALESCE(AVG(view_count), 0)::bigint AS avg_views,
                COALESCE(SUM(like_count), 0)::bigint AS total_likes,
                COALESCE(SUM(comment_count), 0)::bigint AS total_comments
         FROM analytics_videos
         WHERE channel_id = $1`,
        [channelId],
      );

      // Recent daily metrics
      const metricsResult = await dbQuery(
        `SELECT metric_date, subscribers_gained, subscribers_lost, likes, shares, comments
         FROM analytics_channel_metrics_daily
         WHERE channel_id = $1 AND metric_date >= CURRENT_DATE - $2::int
         ORDER BY metric_date DESC`,
        [channelId, safeDays],
      );

      // Recent videos
      const recentResult = await dbQuery(
        `SELECT video_id, title, view_count, like_count, comment_count, published_at
         FROM analytics_videos
         WHERE channel_id = $1
         ORDER BY published_at DESC
         LIMIT 10`,
        [channelId],
      );

      const stats = statsResult?.rows?.[0] || {};
      const dailyMetrics = metricsResult?.rows || [];
      const recentVideos = recentResult?.rows || [];

      // Aggregate daily metrics
      const totalSubsGained = dailyMetrics.reduce((s, r) => s + Number(r.subscribers_gained || 0), 0);
      const totalSubsLost = dailyMetrics.reduce((s, r) => s + Number(r.subscribers_lost || 0), 0);
      const totalLikes = dailyMetrics.reduce((s, r) => s + Number(r.likes || 0), 0);
      const totalShares = dailyMetrics.reduce((s, r) => s + Number(r.shares || 0), 0);
      const totalComments = dailyMetrics.reduce((s, r) => s + Number(r.comments || 0), 0);

      return {
        channelId: channel.channel_id,
        title: channel.title || 'Untitled',
        uploadsPlaylistId: channel.uploads_playlist_id,
        lastSyncedAt: channel.last_synced_at,
        totalStats: {
          videoCount: stats.video_count || 0,
          totalViews: stats.total_views || 0,
          averageViews: Math.round(stats.avg_views || 0),
          totalLikes: stats.total_likes || 0,
          totalComments: stats.total_comments || 0,
        },
        recentActivity: {
          daysBack: safeDays,
          subscribersGained: totalSubsGained,
          subscribersLost: totalSubsLost,
          netSubs: totalSubsGained - totalSubsLost,
          likes: totalLikes,
          shares: totalShares,
          comments: totalComments,
        },
        recentVideos: recentVideos.map((v) => ({
          videoId: v.video_id,
          title: v.title || 'Untitled',
          views: v.view_count || 0,
          likes: v.like_count || 0,
          comments: v.comment_count || 0,
          publishedAt: v.published_at,
        })),
      };
    } catch (err) {
      console.warn('[Tool:getChannelInfo] Query failed:', err.message);
      return { error: `Failed to get channel info: ${err.message}` };
    }
  },
};

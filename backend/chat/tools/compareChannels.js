/**
 * Tool: compareChannels
 * Compare your own channels side-by-side on key metrics.
 * Admins can compare any channels.
 */
const { verifyChannelAccess } = require('./shared');

module.exports = {
  name: 'compareChannels',
  description: 'Compare 2 or more channels side-by-side on total views, video count, likes, comments, and recent performance.',
  parameters: {
    type: 'object',
    properties: {
      channelIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of YouTube channel IDs to compare (2-5 channels)',
        minItems: 2,
        maxItems: 5,
      },
      daysBack: {
        type: 'number',
        description: 'Number of days of recent activity to include (default 30)',
        default: 30,
      },
    },
    required: ['channelIds'],
  },

  execute: async (args, { deps, userChannels, userContext }) => {
    const { channelIds, daysBack = 30 } = args;

    // Verify ALL channels belong to the user (or user is admin)
    for (const id of channelIds) {
      const access = verifyChannelAccess(id, userChannels, userContext);
      if (!access.allowed) {
        return { error: `Channel "${id}" is not one of your connected channels. Use listMyChannels to see your channels.` };
      }
    }
    const { query: dbQuery, isPostgresConfigured } = deps;

    if (!isPostgresConfigured()) {
      return { error: 'Database is not configured.' };
    }

    if (!channelIds || channelIds.length < 2) {
      return { error: 'At least 2 channel IDs are required for comparison.' };
    }

    const safeIds = channelIds.slice(0, 5);
    const safeDays = Math.min(Math.max(1, Number(daysBack) || 30), 365);
    const placeholders = safeIds.map((_, i) => `$${i + 1}`).join(', ');

    try {
      // Channel profiles
      const channelResult = await dbQuery(
        `SELECT channel_id, title, last_synced_at
         FROM analytics_channels
         WHERE channel_id IN (${placeholders})`,
        safeIds,
      );

      const channelMap = new Map();
      for (const row of channelResult?.rows || []) {
        channelMap.set(row.channel_id, { title: row.title, lastSyncedAt: row.last_synced_at });
      }

      // Aggregate video stats per channel
      const videoStatsResult = await dbQuery(
        `SELECT channel_id,
                COUNT(*)::int AS video_count,
                COALESCE(SUM(view_count), 0)::bigint AS total_views,
                COALESCE(AVG(view_count), 0)::numeric(10,1) AS avg_views,
                COALESCE(SUM(like_count), 0)::bigint AS total_likes,
                COALESCE(SUM(comment_count), 0)::bigint AS total_comments,
                MAX(published_at) AS latest_video_date
         FROM analytics_videos
         WHERE channel_id IN (${placeholders})
         GROUP BY channel_id`,
        safeIds,
      );

      const videoStatsMap = new Map();
      for (const row of videoStatsResult?.rows || []) {
        videoStatsMap.set(row.channel_id, row);
      }

      // Recent activity (daily metrics)
      const recentResult = await dbQuery(
        `SELECT channel_id,
                COALESCE(SUM(views), 0)::bigint AS recent_views,
                COALESCE(SUM(subscribers_gained), 0)::bigint AS subs_gained,
                COALESCE(SUM(likes), 0)::bigint AS recent_likes,
                COALESCE(SUM(comments), 0)::bigint AS recent_comments
         FROM analytics_video_metrics_daily
         WHERE channel_id IN (${placeholders})
           AND metric_date >= CURRENT_DATE - $${safeIds.length + 1}::int
         GROUP BY channel_id`,
        [...safeIds, safeDays],
      );

      const recentMap = new Map();
      for (const row of recentResult?.rows || []) {
        recentMap.set(row.channel_id, row);
      }

      // Build comparison
      const channels = safeIds.map((id) => {
        const profile = channelMap.get(id) || { title: null, lastSyncedAt: null };
        const vs = videoStatsMap.get(id) || {};
        const recent = recentMap.get(id) || {};

        return {
          channelId: id,
          title: profile.title || 'Unknown',
          lastSyncedAt: profile.lastSyncedAt,
          totalStats: {
            videoCount: vs.video_count || 0,
            totalViews: vs.total_views || 0,
            averageViews: Number(vs.avg_views || 0),
            totalLikes: vs.total_likes || 0,
            totalComments: vs.total_comments || 0,
          },
          recentActivity: {
            daysBack: safeDays,
            views: recent.recent_views || 0,
            subscribersGained: recent.subs_gained || 0,
            likes: recent.recent_likes || 0,
            comments: recent.recent_comments || 0,
          },
        };
      });

      return {
        comparison: channels,
        summary: {
          channelCount: channels.length,
          periodDays: safeDays,
        },
      };
    } catch (err) {
      console.warn('[Tool:compareChannels] Failed:', err.message);
      return { error: `Failed to compare channels: ${err.message}` };
    }
  },
};

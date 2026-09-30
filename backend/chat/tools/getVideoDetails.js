/**
 * Tool: getVideoDetails
 * Get detailed information about a specific video including metrics over time.
 * Only works for videos from your connected channels (or any channel for admins).
 */
const { verifyChannelAccess, normalizePrivacyStatus } = require('./shared');

module.exports = {
  name: 'getVideoDetails',
  description: 'Get detailed statistics and daily performance data for a specific YouTube video from your channels (or any channel for admins). Includes visibility status (public/unlisted/private/unknown). For 2+ videos, use getBulkVideoDetails once instead of calling this repeatedly.',
  parameters: {
    type: 'object',
    properties: {
      videoId: {
        type: 'string',
        description: 'The YouTube video ID to look up',
      },
      includeDailyMetrics: {
        type: 'boolean',
        description: 'Whether to include daily view/watch time breakdown',
        default: false,
      },
      daysBack: {
        type: 'number',
        description: 'Number of days of daily metrics to include (default 30, max 365)',
        default: 30,
      },
    },
    required: ['videoId'],
  },

  execute: async (args, { deps, userChannels, userContext }) => {
    const { videoId, includeDailyMetrics = false, daysBack = 30 } = args;
    const { query: dbQuery, isPostgresConfigured } = deps;

    if (!isPostgresConfigured()) {
      return { error: 'Database is not configured.' };
    }

    const safeDays = Math.min(Math.max(1, Number(daysBack) || 30), 365);

    try {
      // Video metadata
      const videoResult = await dbQuery(
        `SELECT v.video_id, v.channel_id, v.title, v.description,
                v.published_at, v.thumbnail_url, v.duration, v.tags, v.privacy_status,
                v.view_count, v.like_count, v.comment_count, v.position,
                c.title AS channel_title
         FROM analytics_videos v
         LEFT JOIN analytics_channels c ON c.channel_id = v.channel_id
         WHERE v.video_id = $1`,
        [videoId],
      );

      if (!videoResult?.rows?.length) {
        return { error: `Video "${videoId}" not found in database.` };
      }

      const video = videoResult.rows[0];

      // Verify the video belongs to a channel the user owns (or they're admin)
      const channelId = video.channel_id;
      const access = verifyChannelAccess(channelId, userChannels, userContext);
      if (!access.allowed) return { error: `You don't have access to the channel this video belongs to.` };

      // Optional daily breakdown.
      // NOTE: analytics_video_metrics_daily is keyed by (channel_id, metric_date,
      // filters_key) and holds channel-level daily aggregates -- it has no
      // per-video rows. There is no per-video daily metrics table in the schema,
      // so a per-video daily breakdown is not available. Return a clear note
      // instead of querying a non-existent column.
      let dailyMetrics = null;
      if (includeDailyMetrics) {
        dailyMetrics = {
          available: false,
          note: 'Per-video daily metrics are not available. The daily metrics table stores channel-level aggregates only.',
        };
      }

      return {
        videoId: video.video_id,
        title: video.title || 'Untitled',
        channelId: video.channel_id,
        channelTitle: video.channel_title || 'Unknown',
        publishedAt: video.published_at,
        thumbnailUrl: video.thumbnail_url,
        duration: video.duration,
        tags: video.tags || [],
        status: normalizePrivacyStatus(video.privacy_status),
        position: video.position,
        totalStats: {
          views: video.view_count || 0,
          likes: video.like_count || 0,
          comments: video.comment_count || 0,
        },
        dailyMetrics,
      };
    } catch (err) {
      console.warn('[Tool:getVideoDetails] Query failed:', err.message);
      return { error: `Failed to get video details: ${err.message}` };
    }
  },
};

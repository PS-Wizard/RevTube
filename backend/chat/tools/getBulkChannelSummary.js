/**
 * Tool: getBulkChannelSummary
 * Admin-only: get compact summary data for up to 10 channels at once.
 * Returns channel title, total stats (videos, views), and recent activity
 * (subscribers, likes, shares, comments) in a single call.
 *
 * Designed to let the admin AI efficiently summarize many channels
 * without N individual tool calls.
 */
module.exports = {
  name: 'getBulkChannelSummary',
  description: '[ADMIN] Get a compact summary for multiple YouTube channels at once (max 10). Returns title, total videos/views, and recent subscriber/likes/shares/comments activity for each channel. Admin only.',
  parameters: {
    type: 'object',
    properties: {
      channelIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of YouTube channel IDs to summarize (max 10)',
        maxItems: 10,
      },
      period: {
        type: 'string',
        enum: ['7', '30', '90'],
        description: 'Days of recent activity data to include (7, 30, or 90)',
        default: '30',
      },
    },
    required: ['channelIds'],
  },

  execute: async (args, { deps, userContext }) => {
    const rawIds = args?.channelIds;
    const period = String(args?.period || '30');

    // Must be admin
    if (!userContext || (userContext.role !== 'admin' && userContext.isAdmin !== true)) {
      return { error: 'This tool is only available for admin users.' };
    }

    if (!rawIds || !Array.isArray(rawIds) || rawIds.length === 0) {
      return { error: 'Please provide at least one channel ID.' };
    }

    const channelIds = [...new Set(rawIds.map((id) => String(id).trim()).filter(Boolean))];
    if (channelIds.length > 10) {
      return { error: `Too many channels (${channelIds.length}). Maximum is 10.` };
    }

    const { query: dbQuery, isPostgresConfigured } = deps;
    if (!isPostgresConfigured || !isPostgresConfigured()) {
      return { error: 'Database is not configured.' };
    }

    const safeDays = Math.min(Math.max(1, Number(period) || 30), 90);

    try {
      // 1. Channel names + total video stats (one query)
      const channelResult = await dbQuery(
        `SELECT
           c.channel_id,
           c.title,
           c.last_synced_at,
           COUNT(v.video_id)::int AS video_count,
           COALESCE(SUM(v.view_count), 0)::bigint AS total_views,
           COALESCE(AVG(v.view_count), 0)::bigint AS avg_views,
           COALESCE(SUM(v.like_count), 0)::bigint AS total_likes,
           COALESCE(SUM(v.comment_count), 0)::bigint AS total_comments
         FROM analytics_channels c
         LEFT JOIN analytics_videos v ON v.channel_id = c.channel_id
         WHERE c.channel_id = ANY($1::text[])
         GROUP BY c.channel_id, c.title, c.last_synced_at`,
        [channelIds],
      );

      if (!channelResult?.rows?.length) {
        return { error: 'None of the specified channels were found in the database.' };
      }

      const channelMap = new Map(channelResult.rows.map((r) => [r.channel_id, r]));

      // 2. Recent daily metrics for all requested channels (one query)
      const metricsResult = await dbQuery(
        `SELECT
           channel_id,
           COUNT(*)::int AS days_with_data,
           COALESCE(SUM(subscribers_gained), 0)::bigint AS subs_gained,
           COALESCE(SUM(subscribers_lost), 0)::bigint AS subs_lost,
           COALESCE(SUM(likes), 0)::bigint AS recent_likes,
           COALESCE(SUM(shares), 0)::bigint AS recent_shares,
           COALESCE(SUM(comments), 0)::bigint AS recent_comments
         FROM analytics_channel_metrics_daily
         WHERE channel_id = ANY($1::text[])
           AND metric_date >= CURRENT_DATE - $2::int
         GROUP BY channel_id`,
        [channelIds, safeDays],
      );

      const metricsMap = new Map(metricsResult?.rows?.map((r) => [r.channel_id, r]) || []);

      // 3. Assemble results, preserving requested order
      const channels = channelIds
        .filter((id) => channelMap.has(id))
        .map((id) => {
          const ch = channelMap.get(id);
          const m = metricsMap.get(id);
          return {
            channelId: id,
            title: ch.title || 'Untitled',
            lastSyncedAt: ch.last_synced_at || null,
            total: {
              videos: Number(ch.video_count) || 0,
              views: Number(ch.total_views) || 0,
              avgViews: Math.round(Number(ch.avg_views) || 0),
              likes: Number(ch.total_likes) || 0,
              comments: Number(ch.total_comments) || 0,
            },
            recent: {
              days: safeDays,
              subscribersGained: Number(m?.subs_gained) || 0,
              subscribersLost: Number(m?.subs_lost) || 0,
              netSubs: (Number(m?.subs_gained) || 0) - (Number(m?.subs_lost) || 0),
              likes: Number(m?.recent_likes) || 0,
              shares: Number(m?.recent_shares) || 0,
              comments: Number(m?.recent_comments) || 0,
              daysWithData: Number(m?.days_with_data) || 0,
            },
          };
        });

      // 4. Report any requested channels not found
      const found = new Set(channelResult.rows.map((r) => r.channel_id));
      const missing = channelIds.filter((id) => !found.has(id));

      const summary = {
        total: channels.length,
        period: `${safeDays} days`,
        channels,
      };
      if (missing.length > 0) {
        summary.notFound = missing;
      }
      return summary;
    } catch (err) {
      console.warn('[Tool:getBulkChannelSummary] Query failed:', err.message);
      return { error: `Failed to get bulk summary: ${err.message}` };
    }
  },
};

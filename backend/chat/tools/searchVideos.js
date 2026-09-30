/**
 * Tool: searchVideos
 * Search videos by title, tags, or date range -- only within your connected channels.
 */
const { verifyChannelAccess, normalizePrivacyStatus } = require('./shared');

module.exports = {
  name: 'searchVideos',
  description: 'Search your YouTube videos by title, tags, channel, or date range. Returns video metadata including views, likes, comments, and visibility status (public/unlisted/private/unknown). Only searches your own channels.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search term to match against video title or tags',
      },
      channelId: {
        type: 'string',
        description: 'Optional: filter by one of your connected channel IDs. If omitted, searches all your channels.',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (1-50)',
        default: 10,
      },
      sortBy: {
        type: 'string',
        enum: ['view_count', 'published_at', 'title'],
        description: 'Sort field',
        default: 'published_at',
      },
      sortOrder: {
        type: 'string',
        enum: ['asc', 'desc'],
        default: 'desc',
      },
      daysBack: {
        type: 'number',
        description: 'Optional: only include videos published within this many days',
      },
    },
    required: ['query'],
  },

  execute: async (args, { deps, userChannels, userContext }) => {
    const { query: searchQuery, channelId, limit = 10, sortBy = 'published_at', sortOrder = 'desc', daysBack } = args;
    const { query: dbQuery, isPostgresConfigured } = deps;

    if (!isPostgresConfigured()) {
      return { error: 'Database is not configured for search queries.' };
    }

    const isAdmin = userContext?.role === 'admin' || userContext?.isAdmin === true;
    const hasChannels = userChannels && userChannels.length > 0;

    if (!hasChannels && !isAdmin) {
      return { error: 'No connected channels found. Use listMyChannels to see your channels.' };
    }

    const safeLimit = Math.min(Math.max(1, Number(limit) || 10), 50);
    const params = [];
    const conditions = [];

    // Search by title or tags
    if (searchQuery) {
      conditions.push(`(v.title ILIKE $${params.length + 1} OR v.tags::text ILIKE $${params.length + 1})`);
      params.push(`%${searchQuery}%`);
    }

    // Filter by channel (must verify it belongs to user or user is admin)
    if (channelId) {
      // Check if user is admin first
      if (!isAdmin) {
        const access = verifyChannelAccess(channelId, userChannels, userContext);
        if (!access.allowed) return { error: access.error };
      }
      conditions.push(`v.channel_id = $${params.length + 1}`);
      params.push(channelId);
    } else {
      // Scope to all user channels (or all channels if admin)
      if (isAdmin) {
        // Admin can search all channels - don't add channel filter
      } else if (hasChannels) {
        // Regular user - scope to their channels
        const userChannelIds = userChannels.map((c) => c.channelId);
        const placeholders = userChannelIds.map((_, i) => `$${params.length + i + 1}`).join(', ');
        conditions.push(`v.channel_id IN (${placeholders})`);
        params.push(...userChannelIds);
      }
      // else: no channels, no channelId, and not admin -- will return empty results below
    }

    // Date filter
    if (daysBack && Number(daysBack) > 0) {
      conditions.push(`v.published_at >= NOW() - INTERVAL '${Number(daysBack)} days'`);
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    // Validate sort column (SQL injection prevention)
    const allowedSorts = ['view_count', 'published_at', 'title'];
    const safeSort = allowedSorts.includes(sortBy) ? sortBy : 'published_at';
    const safeOrder = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const sql = `
      SELECT v.video_id, v.channel_id, v.title, v.description,
             v.published_at, v.thumbnail_url, v.duration, v.privacy_status,
             v.view_count, v.like_count, v.comment_count,
             c.title AS channel_title
      FROM analytics_videos v
      LEFT JOIN analytics_channels c ON c.channel_id = v.channel_id
      ${whereClause}
      ORDER BY v.${safeSort} ${safeOrder}
      LIMIT $${params.length + 1}
    `;

    params.push(safeLimit);

    try {
      const result = await dbQuery(sql, params);
      const rows = result?.rows || [];

      return {
        total: rows.length,
        videos: rows.map((r) => ({
          videoId: r.video_id,
          title: r.title || 'Untitled',
          channelId: r.channel_id,
          channelTitle: r.channel_title || 'Unknown',
          publishedAt: r.published_at,
          thumbnailUrl: r.thumbnail_url,
          duration: r.duration,
          status: normalizePrivacyStatus(r.privacy_status),
          views: r.view_count || 0,
          likes: r.like_count || 0,
          comments: r.comment_count || 0,
        })),
      };
    } catch (err) {
      console.warn('[Tool:searchVideos] Query failed:', err.message);
      return { error: `Search failed: ${err.message}` };
    }
  },
};

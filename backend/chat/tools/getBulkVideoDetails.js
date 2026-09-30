/**
 * Tool: getBulkVideoDetails
 * Bulk companion to getVideoDetails -- resolves up to 50 videos in ONE tool
 * call with a SINGLE `analytics_videos WHERE video_id = ANY(...)` query,
 * instead of N sequential getVideoDetails calls.
 *
 * Each video is gated on its owning channel (user's connected channels, or
 * any channel for admins); denied videos land in `accessDenied` rather than
 * failing the call. `format: 'csv'` (default) returns one compact row per
 * video. Descriptions/tags/thumbnails are dropped in both formats to keep
 * results token-cheap (use getVideoDetails for the full single view).
 */
const {
  verifyChannelAccess,
  normalizePrivacyStatus,
  applySort,
  toCsv,
  truncateCsv,
} = require('./shared');

const MAX_VIDEOS = 50;
const MAX_CSV_CHARS = 12000;

// Sortable output fields (whitelisted -- anything else keeps request order).
const SORTABLE_FIELDS = ['views', 'likes', 'comments', 'publishedAt', 'title'];

const CSV_HEADERS = [
  'video_id',
  'title',
  'channel_id',
  'channel_title',
  'published_at',
  'duration',
  'views',
  'likes',
  'comments',
  'privacy_status',
];

function isoOrEmpty(v) {
  if (v === null || v === undefined || v === '') return '';
  try {
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
  } catch {
    return String(v);
  }
}

module.exports = {
  name: 'getBulkVideoDetails',
  description:
    'Get details for MULTIPLE YouTube videos in one call (max 50): title, channel, publish date, duration, views/likes/comments, visibility status. Prefer this over calling getVideoDetails repeatedly when the user asks about 2+ videos. Returns compact CSV by default (one row per video). Filter server-side by views/likes/comments, publish date, title, or visibility; sort by any stat.',
  parameters: {
    type: 'object',
    properties: {
      videoIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'YouTube video IDs to look up (max 50)',
        maxItems: 50,
      },
      format: {
        type: 'string',
        enum: ['csv', 'json'],
        description: "Output shape: 'csv' (default, token-cheap, one row per video) or 'json'",
        default: 'csv',
      },
      minViews: {
        type: 'number',
        description: 'Keep only videos with at least this many views',
      },
      minLikes: {
        type: 'number',
        description: 'Keep only videos with at least this many likes',
      },
      minComments: {
        type: 'number',
        description: 'Keep only videos with at least this many comments',
      },
      publishedAfter: {
        type: 'string',
        description: 'Keep only videos published on/after this ISO date (e.g. "2024-01-01")',
      },
      publishedBefore: {
        type: 'string',
        description: 'Keep only videos published on/before this ISO date (e.g. "2024-12-31")',
      },
      titleContains: {
        type: 'string',
        description: 'Keep only videos whose title contains this text (case-insensitive)',
      },
      privacyStatus: {
        type: 'string',
        enum: ['public', 'unlisted', 'private'],
        description: 'Keep only videos with this visibility status',
      },
      sortBy: {
        type: 'string',
        enum: SORTABLE_FIELDS,
        description: 'Sort videos by: views, likes, comments, publishedAt, title. Omit to keep request order.',
      },
      sortOrder: {
        type: 'string',
        enum: ['asc', 'desc'],
        description: 'Sort direction',
        default: 'desc',
      },
    },
    required: ['videoIds'],
  },

  execute: async (args, { deps, userChannels, userContext }) => {
    const rawIds = args?.videoIds;
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      return { error: 'videoIds is required (non-empty array).' };
    }
    const ids = [...new Set(rawIds.map((id) => String(id || '').trim()).filter(Boolean))];
    if (!ids.length) return { error: 'No valid video IDs provided.' };
    if (ids.length > MAX_VIDEOS) {
      return { error: `Too many videos (${ids.length}). Maximum is ${MAX_VIDEOS}.` };
    }

    const format = args?.format === 'json' ? 'json' : 'csv';
    const { query: dbQuery, isPostgresConfigured } = deps || {};
    const pgOn = typeof isPostgresConfigured === 'function' ? isPostgresConfigured() : !!dbQuery;
    if (!pgOn || !dbQuery) {
      return { error: 'Database is not configured.' };
    }

    let rows;
    try {
      const res = await dbQuery(
        `SELECT v.video_id, v.channel_id, v.title, v.published_at, v.duration,
                v.view_count, v.like_count, v.comment_count, v.privacy_status,
                c.title AS channel_title
         FROM analytics_videos v
         LEFT JOIN analytics_channels c ON c.channel_id = v.channel_id
         WHERE v.video_id = ANY($1)`,
        [ids],
      );
      rows = res?.rows || [];
    } catch (err) {
      console.warn('[Tool:getBulkVideoDetails] Query failed:', err.message);
      return { error: 'Failed to look up videos.' };
    }

    const byId = new Map(rows.map((r) => [r.video_id, r]));
    const videos = [];
    const accessDenied = [];
    for (const id of ids) {
      const r = byId.get(id);
      if (!r) continue;
      const access = verifyChannelAccess(r.channel_id, userChannels, userContext);
      if (!access.allowed) {
        accessDenied.push(id);
        continue;
      }
      videos.push({
        videoId: r.video_id,
        title: r.title || 'Untitled',
        channelId: r.channel_id,
        channelTitle: r.channel_title || 'Unknown',
        publishedAt: r.published_at || null,
        duration: r.duration || '',
        views: Number(r.view_count || 0),
        likes: Number(r.like_count || 0),
        comments: Number(r.comment_count || 0),
        privacyStatus: normalizePrivacyStatus(r.privacy_status),
      });
    }

    const summary = {
      requested: ids.length,
      found: videos.length,
      missing: ids.filter((id) => !byId.has(id)),
      accessDenied,
    };

    // ── Server-side filters + sort (applied before shaping output) ──
    const minViews = Number(args?.minViews);
    const minLikes = Number(args?.minLikes);
    const minComments = Number(args?.minComments);
    const afterMs = args?.publishedAfter ? Date.parse(String(args.publishedAfter)) : NaN;
    const beforeMs = args?.publishedBefore
      ? Date.parse(String(args.publishedBefore)) + 86400000 - 1
      : NaN;
    const titleNeedle = typeof args?.titleContains === 'string' && args.titleContains.trim()
      ? args.titleContains.trim().toLowerCase()
      : null;
    const statusNeedle = typeof args?.privacyStatus === 'string'
      ? args.privacyStatus.trim().toLowerCase()
      : null;
    const kept = videos.filter((v) => {
      if (Number.isFinite(minViews) && v.views < minViews) return false;
      if (Number.isFinite(minLikes) && v.likes < minLikes) return false;
      if (Number.isFinite(minComments) && v.comments < minComments) return false;
      if (statusNeedle && v.privacyStatus !== statusNeedle) return false;
      if (titleNeedle && !String(v.title || '').toLowerCase().includes(titleNeedle)) return false;
      if (Number.isFinite(afterMs) || Number.isFinite(beforeMs)) {
        const pub = v.publishedAt ? Date.parse(v.publishedAt) : NaN;
        if (!Number.isFinite(pub)) return false;
        if (Number.isFinite(afterMs) && pub < afterMs) return false;
        if (Number.isFinite(beforeMs) && pub > beforeMs) return false;
      }
      return true;
    });
    const { sortBy, sortOrder = 'desc' } = args || {};
    const ordered = applySort(kept, sortBy, sortOrder, SORTABLE_FIELDS);
    summary.returned = ordered.length;
    summary.filteredOut = videos.length - ordered.length;

    if (format === 'json') {
      return { format: 'json', ...summary, videos: ordered };
    }

    const csvRows = ordered.map((v) => [
      v.videoId, v.title, v.channelId, v.channelTitle,
      isoOrEmpty(v.publishedAt), v.duration, v.views, v.likes, v.comments, v.privacyStatus,
    ]);
    const { csv, truncated } = truncateCsv(toCsv(CSV_HEADERS, csvRows), MAX_CSV_CHARS);
    return { format: 'csv', ...summary, truncated, csv };
  },
};

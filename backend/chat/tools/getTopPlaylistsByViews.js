/**
 * Tool: getTopPlaylistsByViews
 * Answers "top/best N playlists by views" for a channel in ONE tool call with
 * ONE aggregate SQL query -- no listPlaylists + per-playlist fan-out, no
 * re-pulling videos to total views client-side.
 *
 * Joins the relational read-model (analytics_playlists + analytics_playlist_items
 * + analytics_videos), grouping per playlist: total/avg views, likes, comments,
 * videos counted, and latest video date. Sorting + limit happen server-side.
 *
 * Fallback: when Postgres has no catalog rows for the channel, fetches the
 * live catalog (paginated, up to 200) with totals unavailable (statsAvailable:
 * false) instead of failing -- the agent can then narrow to specific playlists
 * via getBulkPlaylistDetails. Only public playlists are visible.
 */
const {
  verifyChannelAccess,
  safeErrorMessage,
  toCsv,
  truncateCsv,
} = require('./shared');

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const MAX_CATALOG_PAGES = 4; // 4 x 50 = 200 playlists max on live fallback
const MAX_CSV_CHARS = 12000;

// Sortable aggregate fields -> SQL ORDER BY (whitelisted; anything else falls
// back to total_views so ORDER BY can never inject).
const SORT_COLUMNS = {
  totalViews: 'total_views',
  totalLikes: 'total_likes',
  videoCount: 'video_count',
  publishedAt: 'p.published_at',
  title: 'p.title',
};

const CSV_HEADERS = [
  'rank',
  'playlist_id',
  'title',
  'channel_title',
  'item_count',
  'videos_counted',
  'videos_with_stats',
  'total_views',
  'avg_views',
  'total_likes',
  'total_comments',
  'latest_video_date',
  'published_at',
  'data_source',
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
  name: 'getTopPlaylistsByViews',
  description:
    'Rank a channel\'s playlists by total views (or likes / video count) in ONE call. Use this for "top N playlists", "best performing playlists", or "which playlist gets most views" -- never fan out listPlaylists + per-playlist calls to compute totals yourself. Returns compact CSV (one row per playlist, rank included). Only public playlists are visible.',
  parameters: {
    type: 'object',
    properties: {
      channelId: {
        type: 'string',
        description: 'The YouTube channel ID (must be one of your connected channels)',
      },
      limit: {
        type: 'number',
        description: 'How many top playlists to return (1-50)',
        default: 10,
      },
      sortBy: {
        type: 'string',
        enum: Object.keys(SORT_COLUMNS),
        description: 'Rank by: totalViews, totalLikes, videoCount, publishedAt, title',
        default: 'totalViews',
      },
      sortOrder: {
        type: 'string',
        enum: ['asc', 'desc'],
        description: 'Sort direction',
        default: 'desc',
      },
      minTotalViews: {
        type: 'number',
        description: 'Keep only playlists with at least this many total views',
      },
      format: {
        type: 'string',
        enum: ['csv', 'json'],
        description: "Output shape: 'csv' (default, token-cheap) or 'json'",
        default: 'csv',
      },
    },
    required: ['channelId'],
  },

  execute: async (args, { deps, userChannels, userContext }) => {
    const { channelId } = args || {};
    if (!channelId) return { error: 'channelId is required.' };

    const access = verifyChannelAccess(channelId, userChannels, userContext);
    if (!access.allowed) return { error: access.error };

    const limit = Math.min(Math.max(1, Number(args?.limit) || DEFAULT_LIMIT), MAX_LIMIT);
    const sortKey = SORT_COLUMNS[args?.sortBy] ? args.sortBy : 'totalViews';
    const dir = args?.sortOrder === 'asc' ? 'ASC' : 'DESC';
    const minTotalViews = Number(args?.minTotalViews);
    const format = args?.format === 'json' ? 'json' : 'csv';

    const {
      axios, API_KEY, YOUTUBE_API_BASE, serverCache,
      isPostgresConfigured, query: dbQuery,
      upsertPlaylists,
    } = deps || {};
    const pgOn = typeof isPostgresConfigured === 'function' ? isPostgresConfigured() : !!dbQuery;
    const canReadPg = pgOn && !!dbQuery;
    const canFetchLive = Boolean(axios && API_KEY && YOUTUBE_API_BASE);

    // ── Postgres: one aggregate query over the relational read-model ──
    if (canReadPg) {
      try {
        const having = Number.isFinite(minTotalViews) ? 'HAVING COALESCE(SUM(v.view_count), 0) >= $2' : '';
        const params = Number.isFinite(minTotalViews) ? [channelId, minTotalViews, limit] : [channelId, limit];
        const limitParam = Number.isFinite(minTotalViews) ? '$3' : '$2';
        const res = await dbQuery(
          `SELECT p.playlist_id, p.title, p.channel_title, p.published_at, p.item_count,
                  COUNT(i.video_id)::int AS video_count,
                  COUNT(v.video_id)::int AS videos_with_stats,
                  COALESCE(SUM(v.view_count), 0)::bigint AS total_views,
                  COALESCE(SUM(v.like_count), 0)::bigint AS total_likes,
                  COALESCE(SUM(v.comment_count), 0)::bigint AS total_comments,
                  MAX(v.published_at) AS latest_video_date
           FROM analytics_playlists p
           LEFT JOIN analytics_playlist_items i ON i.playlist_id = p.playlist_id
           LEFT JOIN analytics_videos v ON v.video_id = i.video_id
           WHERE p.channel_id = $1
             AND COALESCE(p.privacy_status, 'public') = 'public'
           GROUP BY p.playlist_id, p.title, p.channel_title, p.published_at, p.item_count
           ${having}
           ORDER BY ${SORT_COLUMNS[sortKey]} ${dir} NULLS LAST, p.title ASC
           LIMIT ${limitParam}`,
          params,
        );
        const rows = res?.rows || [];
        if (rows.length) {
          console.log(`[Tool:getTopPlaylistsByViews] ${channelId} ranked ${rows.length} playlists from postgres`);
          return shape(rows.map((r, idx) => ({
            rank: idx + 1,
            playlistId: r.playlist_id,
            title: r.title || 'Untitled',
            channelTitle: r.channel_title || null,
            itemCount: r.item_count ?? r.video_count ?? 0,
            videosCounted: Number(r.video_count) || 0,
            videosWithStats: Number(r.videos_with_stats) || 0,
            totalViews: Number(r.total_views) || 0,
            avgViews: (Number(r.videos_with_stats) || 0)
              ? Math.round((Number(r.total_views) || 0) / Number(r.videos_with_stats))
              : 0,
            totalLikes: Number(r.total_likes) || 0,
            totalComments: Number(r.total_comments) || 0,
            latestVideoDate: isoOrEmpty(r.latest_video_date),
            publishedAt: isoOrEmpty(r.published_at),
            source: 'postgres',
          })), { channelId, statsAvailable: true, format });
        }
        // Zero catalog rows: fall through to live catalog below.
      } catch (err) {
        console.warn('[Tool:getTopPlaylistsByViews] Postgres rank query failed:', err.message);
      }
    }

    // ── Live fallback: catalog only (no stats), paginated YouTube fetch ──
    if (!canFetchLive) {
      return { error: 'No playlist ranking data is available for this channel yet.' };
    }
    try {
      const items = [];
      let pageToken;
      do {
        const resp = await axios.get(`${YOUTUBE_API_BASE}/playlists`, {
          params: {
            part: 'snippet,contentDetails',
            channelId,
            maxResults: 50,
            ...(pageToken ? { pageToken } : {}),
            key: API_KEY,
          },
          timeout: 30000,
        });
        for (const it of resp?.data?.items || []) {
          items.push({
            playlistId: it.id,
            title: it.snippet?.title || 'Untitled',
            channelTitle: it.snippet?.channelTitle || null,
            itemCount: it.contentDetails?.itemCount ?? 0,
            publishedAt: isoOrEmpty(it.snippet?.publishedAt),
          });
        }
        pageToken = resp?.data?.nextPageToken;
      } while (pageToken && items.length < MAX_CATALOG_PAGES * 50);

      if (typeof upsertPlaylists === 'function' && items.length) {
        try {
          await upsertPlaylists(channelId, items.map((m) => ({ ...m, privacyStatus: 'public' })));
        } catch (err) {
          console.warn('[Tool:getTopPlaylistsByViews] Catalog write-through failed:', err.message);
        }
      }

      const ranked = items
        .slice(0, limit)
        .map((m, idx) => ({
          rank: idx + 1,
          playlistId: m.playlistId,
          title: m.title,
          channelTitle: m.channelTitle,
          itemCount: m.itemCount,
          videosCounted: 0,
          videosWithStats: 0,
          totalViews: null,
          avgViews: null,
          totalLikes: null,
          totalComments: null,
          latestVideoDate: '',
          publishedAt: m.publishedAt,
          source: 'youtube',
        }));
      console.log(`[Tool:getTopPlaylistsByViews] ${channelId} catalog-only fallback (${items.length} playlists, no stats)`);
      return shape(ranked, {
        channelId,
        statsAvailable: false,
        format,
        note: 'View totals are unavailable -- Postgres catalog is empty for this channel. Narrow to specific playlists with getBulkPlaylistDetails for per-video stats.',
      });
    } catch (err) {
      console.warn('[Tool:getTopPlaylistsByViews] Live catalog fetch failed:', err.message);
      return { error: `Failed to rank playlists: ${safeErrorMessage(err)}` };
    }

    function shape(ranked, extra) {
      const { channelId: cid, statsAvailable, format: fmt, note } = extra;
      const summary = {
        channelId: cid,
        returned: ranked.length,
        statsAvailable,
        sortBy: sortKey,
        sortOrder: dir === 'ASC' ? 'asc' : 'desc',
        ...(note ? { note } : {}),
      };
      if (fmt === 'json') return { format: 'json', ...summary, playlists: ranked };
      const rows = ranked.map((p) => [
        p.rank, p.playlistId, p.title, p.channelTitle, p.itemCount,
        p.videosCounted, p.videosWithStats,
        p.totalViews ?? '', p.avgViews ?? '', p.totalLikes ?? '', p.totalComments ?? '',
        p.latestVideoDate, p.publishedAt, p.source,
      ]);
      const { csv, truncated } = truncateCsv(toCsv(CSV_HEADERS, rows), MAX_CSV_CHARS);
      return { format: 'csv', ...summary, truncated, csv };
    }
  },
};

/**
 * Tool: getPlaylistDetails
 * Get a playlist's metadata plus its videos, enriched with Postgres stats
 * (views/likes/comments from analytics_videos) when available.
 *
 * Flow:
 *   1. Fetch playlist metadata via YouTube Data API (API key -- public only).
 *   2. Resolve the owning channelId and verify user access to that channel.
 *   3. Fetch playlist items (paginated up to maxVideos).
 *   4. Enrich each video with analytics_videos stats (best-effort).
 */
const { verifyChannelAccess, applySort, safeErrorMessage } = require('./shared');

const DEFAULT_PLAYLIST_TTL_MS = 2 * 60 * 60 * 1000;
const DEFAULT_ITEMS_TTL_MS = 45 * 60 * 1000;

// Every sortable video field. Views/likes/comments are null when PG stats are
// unavailable -- applySort pushes those last so "missing" never reads as zero.
const SORTABLE_VIDEO_FIELDS = ['position', 'title', 'publishedAt', 'views', 'likes', 'comments'];

/**
 * Normalize playlist metadata to one flat shape regardless of source: a raw
 * YouTube `/playlists` item ({ id, snippet, contentDetails } -- also the legacy
 * serverCache payload) or an already-normalized Postgres read-model row. Without
 * this, cache / read-model / live results would each need their own accessor.
 */
function normalizeMeta(m, fallbackPlaylistId) {
  if (!m) return null;
  // Read-model rows are already flat (no snippet/contentDetails envelope).
  if (!m.snippet && !m.contentDetails) return m;
  return {
    playlistId: m.id || fallbackPlaylistId,
    channelId: m.snippet?.channelId || null,
    title: m.snippet?.title || 'Untitled',
    description: m.snippet?.description || '',
    channelTitle: m.snippet?.channelTitle || null,
    publishedAt: m.snippet?.publishedAt || null,
    thumbnailUrl:
      m.snippet?.thumbnails?.medium?.url ||
      m.snippet?.thumbnails?.default?.url ||
      null,
    itemCount: m.contentDetails?.itemCount ?? null,
  };
}

module.exports = {
  name: 'getPlaylistDetails',
  description:
    'Get details for a YouTube playlist: title, description, video count, and the videos it contains with views/likes/comments when stats are available. Videos can be sorted by any returned field (position, title, publishedAt, views, likes, comments). Use listPlaylists first to discover the playlist ID. For 2+ playlists, use getBulkPlaylistDetails once instead of calling this repeatedly.',
  parameters: {
    type: 'object',
    properties: {
      playlistId: {
        type: 'string',
        description: 'The YouTube playlist ID to look up',
      },
      maxVideos: {
        type: 'number',
        description: 'Maximum number of playlist videos to return (1-50)',
        default: 25,
      },
      sortBy: {
        type: 'string',
        enum: SORTABLE_VIDEO_FIELDS,
        description: 'Video field to sort by: position, title, publishedAt, views, likes, or comments',
        default: 'position',
      },
      sortOrder: {
        type: 'string',
        enum: ['asc', 'desc'],
        description: 'Sort direction',
        default: 'asc',
      },
    },
    required: ['playlistId'],
  },

  execute: async (args, { deps, userChannels, userContext }) => {
    const { playlistId, maxVideos = 25, sortBy = 'position', sortOrder = 'asc' } = args || {};
    if (!playlistId) return { error: 'playlistId is required.' };

    const {
      axios, API_KEY, YOUTUBE_API_BASE, serverCache, YT_DATA_CACHE_TTL_MS,
      isPostgresConfigured, loadPlaylistMetaFromPostgres, loadPlaylistItemsFromPostgres,
      upsertPlaylists, upsertPlaylistItems, isPlaylistDataStale, PLAYLIST_READ_MODEL_MAX_AGE_HOURS,
    } = deps || {};

    const canFetchLive = Boolean(axios && API_KEY && YOUTUBE_API_BASE);
    const canReadPg = (typeof isPostgresConfigured === 'function' && isPostgresConfigured()) &&
      typeof loadPlaylistMetaFromPostgres === 'function';
    const canWritePg = canReadPg && typeof upsertPlaylists === 'function';
    if (!canFetchLive && !canReadPg) {
      return { error: 'Playlist lookup is not configured.' };
    }

    const safeMax = Math.min(Math.max(1, Number(maxVideos) || 25), 50);
    const playlistTtl = YT_DATA_CACHE_TTL_MS?.PLAYLIST || DEFAULT_PLAYLIST_TTL_MS;
    const itemsTtl = YT_DATA_CACHE_TTL_MS?.PLAYLIST_ITEMS || DEFAULT_ITEMS_TTL_MS;
    const metaKey = `chat:playlist:one:${playlistId}`;

    // Freshness window shared by the metadata and membership read-model rows.
    const isFresh = (stamp) => typeof isPlaylistDataStale === 'function'
      ? !isPlaylistDataStale(stamp, PLAYLIST_READ_MODEL_MAX_AGE_HOURS)
      : Boolean(stamp);

    // 1. Metadata: L1 cache -> L2 Postgres read-model -> L3 live YouTube API.
    let meta = null;
    let metaItemsSyncedAt = null;
    try {
      if (serverCache) meta = normalizeMeta(await serverCache.get(metaKey), playlistId);
    } catch {
      meta = null;
    }
    if (!meta && canReadPg) {
      try {
        const pgMeta = await loadPlaylistMetaFromPostgres(playlistId);
        // Rows outside the freshness window deliberately fall through to a live
        // refresh so a renamed/re-described playlist is not served stale forever.
        if (pgMeta && isFresh(pgMeta.lastSyncedAt)) {
          meta = normalizeMeta(pgMeta, playlistId);
          metaItemsSyncedAt = pgMeta.itemsSyncedAt || null;
        }
      } catch (err) {
        console.warn('[Tool:getPlaylistDetails] Postgres metadata read failed:', err.message);
      }
    }
    if (!meta) {
      if (!canFetchLive) {
        return { error: 'Playlist details are not available offline yet.' };
      }
      try {
        const resp = await axios.get(`${YOUTUBE_API_BASE}/playlists`, {
          params: { part: 'snippet,contentDetails', id: playlistId, key: API_KEY },
          timeout: 30000,
        });
        meta = normalizeMeta(resp?.data?.items?.[0], playlistId);
        if (!meta) return { error: `Playlist "${playlistId}" not found. Only public playlists are visible.` };
        try {
          if (serverCache) await serverCache.set(metaKey, meta, playlistTtl);
        } catch {
          // Non-fatal.
        }
        // Write-through, single row only: prune:false so a one-off lookup can
        // never delete the channel's other catalog rows or mark the channel as
        // fully catalog-synced.
        if (canWritePg && meta.channelId) {
          try {
            await upsertPlaylists(
              meta.channelId,
              [{ ...meta, privacyStatus: meta.privacyStatus || 'public' }],
              { prune: false },
            );
          } catch (err) {
            console.warn('[Tool:getPlaylistDetails] Metadata write-through failed:', err.message);
          }
        }
      } catch (err) {
        console.warn('[Tool:getPlaylistDetails] Metadata fetch failed:', err.message);
        return { error: `Failed to get playlist details: ${safeErrorMessage(err)}` };
      }
    }

    // 2. Verify access to the owning channel.
    const ownerChannelId = meta.channelId || null;
    if (ownerChannelId) {
      const access = verifyChannelAccess(ownerChannelId, userChannels, userContext);
      if (!access.allowed) {
        return { error: 'You don\'t have access to the channel this playlist belongs to.' };
      }
    }

    // 3. Playlist items: L1 cache -> L2 read-model (only while its membership
    //    sync is inside the freshness window) -> L3 live YouTube API.
    const itemsKey = `chat:playlist:items:${playlistId}:mr${safeMax}`;
    let items = null;
    try {
      if (serverCache) items = await serverCache.get(itemsKey);
    } catch {
      items = null;
    }
    if (!Array.isArray(items) || items.length === 0) items = null;

    let stalePgItems = null;
    if (!items && canReadPg && typeof loadPlaylistItemsFromPostgres === 'function') {
      try {
        const pgItems = await loadPlaylistItemsFromPostgres(playlistId, safeMax);
        if (Array.isArray(pgItems) && pgItems.length) {
          if (isFresh(metaItemsSyncedAt)) items = pgItems;
          else stalePgItems = pgItems;
        }
      } catch (err) {
        console.warn('[Tool:getPlaylistDetails] Postgres items read failed:', err.message);
      }
    }

    if (!items) {
      if (!canFetchLive) {
        items = stalePgItems || [];
      } else {
        try {
          items = [];
          let pageToken = undefined;
          do {
            const resp = await axios.get(`${YOUTUBE_API_BASE}/playlistItems`, {
              params: {
                part: 'snippet',
                playlistId,
                maxResults: Math.min(50, safeMax - items.length),
                ...(pageToken ? { pageToken } : {}),
                key: API_KEY,
              },
              timeout: 30000,
            });
            for (const it of resp?.data?.items || []) {
              items.push({
                videoId: it.snippet?.resourceId?.videoId || null,
                title: it.snippet?.title || 'Untitled',
                position: it.snippet?.position ?? null,
                publishedAt: it.snippet?.publishedAt || null,
                thumbnailUrl:
                  it.snippet?.thumbnails?.medium?.url ||
                  it.snippet?.thumbnails?.default?.url ||
                  null,
              });
            }
            pageToken = items.length < safeMax ? resp?.data?.nextPageToken : undefined;
          } while (pageToken && items.length < safeMax);

          // Skip caching empty lists: an empty/failed fetch must not poison
          // the cache and produce 0-byte entries on every repeat lookup.
          try {
            if (serverCache && items.length) await serverCache.set(itemsKey, items, itemsTtl);
          } catch {
            // Non-fatal.
          }

          // Write-through membership. upsertPlaylistItems never prunes, so a
          // capped fetch can't drop members that simply fell outside the cap.
          if (canWritePg && typeof upsertPlaylistItems === 'function') {
            try {
              await upsertPlaylistItems(playlistId, items);
            } catch (err) {
              console.warn('[Tool:getPlaylistDetails] Items write-through failed:', err.message);
            }
          }
        } catch (err) {
          console.warn('[Tool:getPlaylistDetails] Items fetch failed:', err.message);
          if (stalePgItems) {
            // Quota exhausted / YouTube unavailable: a slightly old member list
            // still answers the question.
            items = stalePgItems;
          } else {
            return { error: `Failed to get playlist videos: ${safeErrorMessage(err)}` };
          }
        }
      }
    }

    // 4. Enrich with Postgres stats (best-effort, never fatal).
    let statsMap = new Map();
    let statsAvailable = false;
    try {
      const { query: dbQuery } = deps || {};
      const ids = items.map((v) => v.videoId).filter(Boolean);
      if (typeof isPostgresConfigured === 'function' ? isPostgresConfigured() : !!dbQuery) {
        if (dbQuery && ids.length) {
          const result = await dbQuery(
            `SELECT video_id, title, view_count, like_count, comment_count, published_at
             FROM analytics_videos WHERE video_id = ANY($1)`,
            [ids],
          );
          for (const row of result?.rows || []) {
            statsMap.set(row.video_id, row);
          }
          statsAvailable = true;
        }
      }
    } catch (err) {
      console.warn('[Tool:getPlaylistDetails] Stats enrichment failed:', err.message);
      statsMap = new Map();
    }

    const videos = applySort(
      items.map((v) => {
        const s = v.videoId ? statsMap.get(v.videoId) : null;
        return {
          ...v,
          views: s ? Number(s.view_count || 0) : null,
          likes: s ? Number(s.like_count || 0) : null,
          comments: s ? Number(s.comment_count || 0) : null,
        };
      }),
      sortBy,
      sortOrder,
      SORTABLE_VIDEO_FIELDS,
    );
    const withStats = videos.filter((v) => v.views !== null);
    const totals = {
      videoCount: videos.length,
      totalViews: withStats.reduce((sum, v) => sum + (v.views || 0), 0),
      totalLikes: withStats.reduce((sum, v) => sum + (v.likes || 0), 0),
      totalComments: withStats.reduce((sum, v) => sum + (v.comments || 0), 0),
      videosWithStats: withStats.length,
    };

    return {
      playlistId,
      title: meta.title || 'Untitled',
      description: meta.description || '',
      channelId: ownerChannelId,
      channelTitle: meta.channelTitle || null,
      publishedAt: meta.publishedAt || null,
      thumbnailUrl: meta.thumbnailUrl || null,
      itemCount: meta.itemCount ?? videos.length,
      videos,
      totals,
      statsAvailable,
      note: statsAvailable
        ? undefined
        : 'Per-video stats were unavailable; video list is from YouTube metadata only.',
    };
  },
};

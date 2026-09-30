/**
 * Tool: listPlaylists
 * List a channel's YouTube playlists (public) via the YouTube Data API.
 * Only works for the user's connected channels (or any channel for admins).
 *
 * Chat has no YouTube OAuth token, so this uses the API key -- public
 * playlists only. Private/unlisted playlists are not visible here.
 */
const { verifyChannelAccess, applySort, safeErrorMessage } = require('./shared');

const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000;

// Every sortable output field. Sorting is JS-side (the YouTube playlists
// endpoint has no sort parameter), so the whitelist is the whole surface.
const SORTABLE_FIELDS = ['title', 'publishedAt', 'itemCount'];

/**
 * Normalize a Postgres read-model row to the tool's public playlist shape, so
 * cache / read-model / live-API results are indistinguishable to the caller
 * (and to applySort). Read-model bookkeeping fields are intentionally dropped.
 */
function toToolPlaylist(p) {
  return {
    playlistId: p.playlistId,
    title: p.title || 'Untitled',
    description: p.description || '',
    channelTitle: p.channelTitle || null,
    publishedAt: p.publishedAt || null,
    thumbnailUrl: p.thumbnailUrl || null,
    itemCount: p.itemCount === undefined ? null : p.itemCount,
  };
}

module.exports = {
  name: 'listPlaylists',
  description:
    'List the YouTube playlists of one of your channels. Returns playlist IDs, titles, descriptions, video counts, and thumbnails. Supports sorting by any returned field (title, publishedAt, itemCount). Only public playlists are visible. Catalog pages are followed automatically up to maxResults; hasMore tells you when the channel holds more playlists than returned. Use this to discover playlist IDs before calling getPlaylistDetails.',
  parameters: {
    type: 'object',
    properties: {
      channelId: {
        type: 'string',
        description: 'The YouTube channel ID to list playlists for (must be one of your connected channels)',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of playlists to return (1-50)',
        default: 25,
      },
      sortBy: {
        type: 'string',
        enum: SORTABLE_FIELDS,
        description: 'Field to sort by: title, publishedAt, or itemCount. Omit to keep YouTube order.',
      },
      sortOrder: {
        type: 'string',
        enum: ['asc', 'desc'],
        description: 'Sort direction',
        default: 'asc',
      },
    },
    required: ['channelId'],
  },

  execute: async (args, { deps, userChannels, userContext }) => {
    const { channelId, maxResults = 25, sortBy, sortOrder = 'asc' } = args || {};
    if (!channelId) return { error: 'channelId is required.' };

    const access = verifyChannelAccess(channelId, userChannels, userContext);
    if (!access.allowed) return { error: access.error };

    const {
      axios, API_KEY, YOUTUBE_API_BASE, serverCache, YT_DATA_CACHE_TTL_MS,
      isPostgresConfigured, getPlaylistsSyncedAt, loadPlaylistsFromPostgres,
      upsertPlaylists, isPlaylistDataStale, PLAYLIST_READ_MODEL_MAX_AGE_HOURS,
    } = deps || {};

    const canFetchLive = Boolean(axios && API_KEY && YOUTUBE_API_BASE);
    const canReadPg = (typeof isPostgresConfigured === 'function' && isPostgresConfigured()) &&
      typeof loadPlaylistsFromPostgres === 'function';
    if (!canFetchLive && !canReadPg) {
      return { error: 'Playlist lookup is not configured.' };
    }

    const safeMax = Math.min(Math.max(1, Number(maxResults) || 25), 50);
    const cacheKey = `chat:playlists:${channelId}:mr${safeMax}`;
    // Cache the raw (unsorted) list; sorting is applied per request so one
    // cache entry serves every sort order without key explosion.
    let playlists = null;
    let source = 'youtube';
    // True when YouTube reports further catalog pages beyond what this call
    // returned (channel holds more playlists than maxResults).
    let hasMore = false;
    try {
      if (serverCache) {
        const cached = await serverCache.get(cacheKey);
        // Normalize on read. Entries written before the sort refactor cached the
        // whole response object ({ channelId, total, playlists, note }) under
        // this same key. applySort() is array-only, so a stale object would
        // silently yield an empty list ("no playlists for this channel") until
        // the TTL expired. Accept both shapes instead of flushing the cache.
        if (Array.isArray(cached)) {
          playlists = cached;
          source = 'cache';
        } else if (Array.isArray(cached?.playlists)) {
          playlists = cached.playlists;
          source = 'cache';
        }
      }
    } catch {
      // Cache failures are non-fatal -- fall through to the next tier.
    }

    // L2: Postgres read-model -- the catalog ingested by the 6-hour cron. Served
    // while it is inside the freshness window. When it is stale the rows are
    // kept aside so a failed live refresh can still degrade to them rather than
    // answering "no playlists for this channel".
    let stalePgRows = null;
    if (!playlists && canReadPg) {
      try {
        const syncedAt = typeof getPlaylistsSyncedAt === 'function'
          ? await getPlaylistsSyncedAt(channelId)
          : null;
        const stale = typeof isPlaylistDataStale === 'function'
          ? isPlaylistDataStale(syncedAt, PLAYLIST_READ_MODEL_MAX_AGE_HOURS)
          : !syncedAt;
        const rows = await loadPlaylistsFromPostgres(channelId, { maxResults: safeMax });
        if (Array.isArray(rows) && rows.length) {
          if (stale) {
            stalePgRows = rows;
          } else {
            playlists = rows.map(toToolPlaylist);
            source = 'postgres';
          }
        }
      } catch (err) {
        console.warn('[Tool:listPlaylists] Postgres read-model failed:', err.message);
      }
    }

    // L3: live YouTube API, public-only (chat carries no OAuth token).
    if (!playlists) {
      if (!canFetchLive) {
        if (stalePgRows) {
          playlists = stalePgRows.map(toToolPlaylist);
          source = 'postgres-stale';
        }
      } else {
        try {
          // Paginated catalog fetch: YouTube returns at most 50/page. Follow
          // nextPageToken until safeMax rows are collected so channels with
          // 50+ playlists are not silently truncated to the first page.
          // Bounded at 5 pages (1 quota unit each).
          const collected = [];
          let pageToken;
          for (let page = 0; page < 5; page++) {
            const resp = await axios.get(`${YOUTUBE_API_BASE}/playlists`, {
              params: {
                part: 'snippet,contentDetails',
                channelId,
                maxResults: Math.min(50, safeMax - collected.length),
                ...(pageToken ? { pageToken } : {}),
                key: API_KEY,
              },
              timeout: 30000,
            });
            for (const item of resp?.data?.items || []) {
              collected.push({
                playlistId: item.id,
                title: item.snippet?.title || 'Untitled',
                description: item.snippet?.description || '',
                channelTitle: item.snippet?.channelTitle || null,
                publishedAt: item.snippet?.publishedAt || null,
                thumbnailUrl:
                  item.snippet?.thumbnails?.medium?.url ||
                  item.snippet?.thumbnails?.default?.url ||
                  null,
                itemCount: item.contentDetails?.itemCount ?? null,
                privacyStatus: 'public',
              });
            }
            pageToken = resp?.data?.nextPageToken;
            if (!pageToken || collected.length >= safeMax) break;
          }
          hasMore = Boolean(pageToken);
          playlists = collected.slice(0, safeMax);

          // Write-through: keep the read-model warm so the next reader inside
          // the freshness window never has to touch YouTube. Prune only on a
          // COMPLETE catalog fetch -- pruning a partial page would delete the
          // channel's other catalog rows.
          if (typeof upsertPlaylists === 'function') {
            try {
              await upsertPlaylists(channelId, playlists, { prune: !hasMore });
            } catch (err) {
              console.warn('[Tool:listPlaylists] Write-through failed:', err.message);
            }
          }

          try {
            const ttl = YT_DATA_CACHE_TTL_MS?.PLAYLISTS || DEFAULT_TTL_MS;
            if (serverCache) await serverCache.set(cacheKey, playlists, ttl);
          } catch {
            // Cache write failures are non-fatal.
          }
        } catch (err) {
          console.warn('[Tool:listPlaylists] Fetch failed:', err.message);
          if (stalePgRows) {
            // Quota exhausted / YouTube unavailable: a slightly old catalog
            // beats reporting an empty channel.
            playlists = stalePgRows.map(toToolPlaylist);
            source = 'postgres-stale';
          } else {
            return { error: `Failed to list playlists: ${safeErrorMessage(err)}` };
          }
        }
      }
    }

    console.log(`[Tool:listPlaylists] ${channelId} served from ${source}`);
    const sorted = applySort(playlists || [], sortBy, sortOrder, SORTABLE_FIELDS);
    return {
      channelId,
      total: sorted.length,
      playlists: sorted,
      hasMore,
      note: hasMore
        ? 'Only public playlists are visible. Private/unlisted playlists are not included. The channel has MORE playlists than returned here -- raise maxResults (up to 50) to see more.'
        : 'Only public playlists are visible. Private/unlisted playlists are not included.',
    };
  },
};

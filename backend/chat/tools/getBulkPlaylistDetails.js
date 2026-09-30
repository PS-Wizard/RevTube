/**
 * Tool: getBulkPlaylistDetails
 * Bulk companion to getPlaylistDetails -- resolves up to 20 playlists in ONE
 * tool call instead of N sequential calls (the N+1 pattern that burns the
 * agent's MAX_TOOL_CALLS budget, YouTube quota, and context on repeated
 * per-playlist JSON).
 *
 * Postgres-first, batched end to end:
 *   1. L1 serverCache per playlist (same keys as the single tool, shared).
 *   2. ONE `analytics_playlists WHERE playlist_id = ANY(...)` query for metas.
 *   3. ONE windowed `analytics_playlist_items` query (top-N per playlist).
 *   4. ONE `analytics_videos WHERE video_id = ANY(...)` query for stats.
 *   5. Misses fall back to a SINGLE YouTube `/playlists?id=a,b,c` batch call
 *      (the API accepts up to 50 ids); `/playlistItems` is still per playlist
 *      but only for playlists with no usable read-model rows.
 *
 * Access is verified per owning channel; denied playlists are reported in
 * `accessDenied` rather than failing the whole call. `format: 'csv'`
 * (default) returns one compact row per video -- far cheaper in tokens than
 * the equivalent JSON. Descriptions/thumbnails are dropped in both formats
 * for the same reason (use getPlaylistDetails for the full single view).
 */
const {
  verifyChannelAccess,
  safeErrorMessage,
  applySort,
  toCsv,
  truncateCsv,
} = require('./shared');

const MAX_PLAYLISTS = 20;
const DEFAULT_MAX_VIDEOS = 10;
const MAX_VIDEOS = 25;
const MAX_CSV_CHARS = 12000;

// Sortable output fields (whitelisted -- anything else keeps request order).
const SORTABLE_FIELDS = ['totalViews', 'totalLikes', 'videoCount', 'publishedAt', 'title'];

const CSV_HEADERS = [
  'playlist_id',
  'playlist_title',
  'channel_id',
  'channel_title',
  'item_count',
  'published_at',
  'video_position',
  'video_id',
  'video_title',
  'views',
  'likes',
  'comments',
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

function numOrEmpty(v) {
  return v === null || v === undefined ? '' : Number(v);
}

module.exports = {
  name: 'getBulkPlaylistDetails',
  description:
    'Get details for MULTIPLE YouTube playlists in one call (max 20): title, video count, and top videos with views/likes/comments. Prefer this over calling getPlaylistDetails repeatedly when the user asks about 2+ playlists. Returns compact CSV by default (one row per video). Filter server-side by total views, video count, publish date, or title; sort by any returned total. Only public playlists are visible.',
  parameters: {
    type: 'object',
    properties: {
      playlistIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'YouTube playlist IDs to look up (max 20)',
        maxItems: 20,
      },
      maxVideos: {
        type: 'number',
        description: 'Max videos per playlist to include (1-25)',
        default: 10,
      },
      format: {
        type: 'string',
        enum: ['csv', 'json'],
        description: "Output shape: 'csv' (default, token-cheap, one row per video) or 'json'",
        default: 'csv',
      },
      summaryOnly: {
        type: 'boolean',
        description: 'When true, return one row per playlist with NO videos (catalog overview). Use this for channel-wide questions over many playlists (e.g. 50) to avoid huge output; fetch videos only for the few playlists the user cares about.',
        default: false,
      },
      minTotalViews: {
        type: 'number',
        description: 'Keep only playlists whose summed video views are at least this (missing stats count as 0)',
      },
      minItemCount: {
        type: 'number',
        description: 'Keep only playlists with at least this many videos',
      },
      maxItemCount: {
        type: 'number',
        description: 'Keep only playlists with at most this many videos',
      },
      publishedAfter: {
        type: 'string',
        description: 'Keep only playlists published on/after this ISO date (e.g. "2024-01-01")',
      },
      publishedBefore: {
        type: 'string',
        description: 'Keep only playlists published on/before this ISO date (e.g. "2024-12-31")',
      },
      titleContains: {
        type: 'string',
        description: 'Keep only playlists whose title contains this text (case-insensitive)',
      },
      sortBy: {
        type: 'string',
        enum: SORTABLE_FIELDS,
        description: 'Sort playlists by: totalViews, totalLikes, videoCount, publishedAt, title. Omit to keep request order.',
      },
      sortOrder: {
        type: 'string',
        enum: ['asc', 'desc'],
        description: 'Sort direction',
        default: 'desc',
      },
    },
    required: ['playlistIds'],
  },

  execute: async (args, { deps, userChannels, userContext }) => {
    const rawIds = args?.playlistIds;
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      return { error: 'playlistIds is required (non-empty array).' };
    }
    const ids = [...new Set(rawIds.map((id) => String(id || '').trim()).filter(Boolean))];
    if (!ids.length) return { error: 'No valid playlist IDs provided.' };
    if (ids.length > MAX_PLAYLISTS) {
      return { error: `Too many playlists (${ids.length}). Maximum is ${MAX_PLAYLISTS}.` };
    }

    const safeMax = Math.min(Math.max(1, Number(args?.maxVideos) || DEFAULT_MAX_VIDEOS), MAX_VIDEOS);
    const format = args?.format === 'json' ? 'json' : 'csv';
    // Catalog-overview mode: metas only, no videos/stats. One row per
    // playlist keeps 50-playlist channels inside the context budget.
    const summaryOnly = args?.summaryOnly === true;

    const {
      axios, API_KEY, YOUTUBE_API_BASE, serverCache,
      isPostgresConfigured, query: dbQuery,
      upsertPlaylists, upsertPlaylistItems,
      isPlaylistDataStale, PLAYLIST_READ_MODEL_MAX_AGE_HOURS,
    } = deps || {};

    const canFetchLive = Boolean(axios && API_KEY && YOUTUBE_API_BASE);
    const pgOn = typeof isPostgresConfigured === 'function' ? isPostgresConfigured() : !!dbQuery;
    const canReadPg = pgOn && !!dbQuery;
    if (!canFetchLive && !canReadPg) {
      return { error: 'Playlist lookup is not configured.' };
    }
    const isFresh = (stamp) => typeof isPlaylistDataStale === 'function'
      ? !isPlaylistDataStale(stamp, PLAYLIST_READ_MODEL_MAX_AGE_HOURS)
      : Boolean(stamp);

    // ── L1: shared per-playlist cache (same keys as getPlaylistDetails) ──
    const metas = new Map(); // playlistId -> { meta, items, source }
    if (serverCache) {
      await Promise.all(ids.map(async (id) => {
        try {
          const meta = await serverCache.get(`chat:playlist:one:${id}`);
          if (!meta) return;
          if (summaryOnly) {
            metas.set(id, { meta, items: [], source: 'cache' });
            return;
          }
          const items = await serverCache.get(`chat:playlist:items:${id}:mr${safeMax}`);
          if (Array.isArray(items) && items.length) {
            metas.set(id, { meta, items: items.slice(0, safeMax), source: 'cache' });
          } else {
            metas.set(id, { meta, items: null, source: 'cache' });
          }
        } catch {
          // Non-fatal.
        }
      }));
    }

    // ── L2: Postgres read-model, fully batched ──
    const missing = ids.filter((id) => !metas.has(id) || !metas.get(id).items);
    if (canReadPg && missing.length) {
      try {
        const metaRes = await dbQuery(
          `SELECT playlist_id, channel_id, title, description, channel_title,
                  published_at, thumbnail_url, item_count, privacy_status,
                  last_synced_at, items_synced_at
           FROM analytics_playlists
           WHERE playlist_id = ANY($1)`,
          [missing],
        );
        const freshIds = [];
        for (const r of metaRes?.rows || []) {
          if (!isFresh(r.last_synced_at)) continue; // stale: refresh live below
          freshIds.push(r.playlist_id);
          metas.set(r.playlist_id, {
            meta: {
              playlistId: r.playlist_id,
              channelId: r.channel_id,
              title: r.title || 'Untitled',
              channelTitle: r.channel_title || null,
              publishedAt: r.published_at || null,
              itemCount: r.item_count ?? null,
              itemsSyncedAt: r.items_synced_at || null,
            },
            // summaryOnly: catalog rows only, never membership.
            items: summaryOnly ? [] : null,
            source: 'postgres',
          });
        }
        if (freshIds.length && !summaryOnly) {
          const itemsRes = await dbQuery(
            `SELECT playlist_id, video_id, position, title, published_at, thumbnail_url
             FROM (
               SELECT *, ROW_NUMBER() OVER (
                 PARTITION BY playlist_id
                 ORDER BY COALESCE(position, 999999) ASC, published_at DESC
               ) AS rn
               FROM analytics_playlist_items
               WHERE playlist_id = ANY($1)
             ) t WHERE rn <= $2`,
            [freshIds, safeMax],
          );
          const byPlaylist = new Map();
          for (const r of itemsRes?.rows || []) {
            if (!byPlaylist.has(r.playlist_id)) byPlaylist.set(r.playlist_id, []);
            byPlaylist.get(r.playlist_id).push({
              videoId: r.video_id,
              title: r.title || 'Untitled',
              position: r.position ?? null,
              publishedAt: r.published_at || null,
              thumbnailUrl: r.thumbnail_url || null,
            });
          }
          for (const [pid, items] of byPlaylist) {
            const entry = metas.get(pid);
            if (!entry) continue;
            // Only trust membership inside the freshness window; otherwise the
            // live path below refreshes and these rows stay as fallback.
            if (isFresh(entry.meta.itemsSyncedAt)) {
              entry.items = items;
            } else {
              entry.staleItems = items;
            }
          }
        }
      } catch (err) {
        console.warn('[Tool:getBulkPlaylistDetails] Postgres batch read failed:', err.message);
      }
    }

    // ── Per-channel access gate (before any live fetch) ──
    const accessDenied = [];
    const needLive = [];
    for (const id of ids) {
      const entry = metas.get(id);
      if (!entry) {
        needLive.push(id);
        continue;
      }
      if (!entry.meta.channelId) {
        needLive.push(id);
        continue;
      }
      const access = verifyChannelAccess(entry.meta.channelId, userChannels, userContext);
      if (!access.allowed) {
        accessDenied.push(id);
        metas.delete(id);
      } else if (!entry.items) {
        needLive.push(id);
      }
    }

    // ── L3: live YouTube fallback, metas in ONE batch call ──
    if (needLive.length && canFetchLive) {
      try {
        const resp = await axios.get(`${YOUTUBE_API_BASE}/playlists`, {
          params: {
            part: 'snippet,contentDetails',
            id: needLive.join(','),
            maxResults: Math.min(50, needLive.length),
            key: API_KEY,
          },
          timeout: 30000,
        });
        const found = new Map();
        for (const it of resp?.data?.items || []) {
          const meta = {
            playlistId: it.id,
            channelId: it.snippet?.channelId || null,
            title: it.snippet?.title || 'Untitled',
            channelTitle: it.snippet?.channelTitle || null,
            publishedAt: it.snippet?.publishedAt || null,
            itemCount: it.contentDetails?.itemCount ?? null,
            itemsSyncedAt: null,
          };
          if (!meta.channelId) continue;
          const access = verifyChannelAccess(meta.channelId, userChannels, userContext);
          if (!access.allowed) {
            accessDenied.push(meta.playlistId);
            continue;
          }
          found.set(meta.playlistId, meta);
        }
        // Write-through metas (prune:false -- a bulk lookup must never delete
        // the channel's other catalog rows). Group by channel for one call each.
        if (typeof upsertPlaylists === 'function' && found.size) {
          try {
            const byChannel = new Map();
            for (const m of found.values()) {
              if (!byChannel.has(m.channelId)) byChannel.set(m.channelId, []);
              byChannel.get(m.channelId).push({ ...m, privacyStatus: 'public' });
            }
            await Promise.all(
              [...byChannel].map(([cid, rows]) => upsertPlaylists(cid, rows, { prune: false })),
            );
          } catch (err) {
            console.warn('[Tool:getBulkPlaylistDetails] Meta write-through failed:', err.message);
          }
        }
        // Items per playlist, but only where the read-model had nothing usable
        // (skipped entirely in summaryOnly catalog mode).
        await Promise.all([...found].map(async ([pid, meta]) => {
          const have = metas.get(pid);
          if (have?.items) return;
          if (summaryOnly) {
            metas.set(pid, { meta, items: [], source: 'youtube' });
            if (serverCache) {
              try {
                await serverCache.set(`chat:playlist:one:${pid}`, meta, 2 * 60 * 60 * 1000);
              } catch { /* non-fatal */ }
            }
            return;
          }
          let items = have?.staleItems || [];
          try {
            const fetched = [];
            let pageToken;
            do {
              const r = await axios.get(`${YOUTUBE_API_BASE}/playlistItems`, {
                params: {
                  part: 'snippet',
                  playlistId: pid,
                  maxResults: Math.min(50, safeMax - fetched.length),
                  ...(pageToken ? { pageToken } : {}),
                  key: API_KEY,
                },
                timeout: 30000,
              });
              for (const it of r?.data?.items || []) {
                fetched.push({
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
              pageToken = fetched.length < safeMax ? r?.data?.nextPageToken : undefined;
            } while (pageToken && fetched.length < safeMax);
            if (fetched.length) {
              items = fetched;
              if (serverCache) {
                try {
                  await serverCache.set(`chat:playlist:items:${pid}:mr${safeMax}`, items, 45 * 60 * 1000);
                } catch { /* non-fatal */ }
              }
              if (typeof upsertPlaylistItems === 'function') {
                try {
                  await upsertPlaylistItems(pid, items);
                } catch (err) {
                  console.warn('[Tool:getBulkPlaylistDetails] Items write-through failed:', err.message);
                }
              }
            }
          } catch (err) {
            console.warn('[Tool:getBulkPlaylistDetails] Items fetch failed:', err.message);
          }
          metas.set(pid, { meta, items, source: items.length ? 'youtube' : 'youtube-empty' });
          if (serverCache && meta) {
            try {
              await serverCache.set(`chat:playlist:one:${pid}`, meta, 2 * 60 * 60 * 1000);
            } catch { /* non-fatal */ }
          }
        }));
      } catch (err) {
        console.warn('[Tool:getBulkPlaylistDetails] Live batch fetch failed:', err.message);
      }
    }

    // Playlists with usable stale rows but a failed/absent live refresh still answer.
    const missing2 = ids.filter((id) => !metas.has(id) && !accessDenied.includes(id));
    if (missing2.length) {
      console.log(`[Tool:getBulkPlaylistDetails] ${missing2.length} playlist(s) unresolved: ${missing2.join(',')}`);
    }

    // ── Stats enrichment: ONE query across every collected video ──
    const allItems = [];
    for (const [, e] of metas) {
      if (Array.isArray(e.items)) allItems.push(...e.items);
    }
    const statsMap = new Map();
    let statsAvailable = false;
    const statsIds = [...new Set(allItems.map((v) => v.videoId).filter(Boolean))];
    if (canReadPg && statsIds.length) {
      try {
        const res = await dbQuery(
          `SELECT video_id, view_count, like_count, comment_count
           FROM analytics_videos WHERE video_id = ANY($1)`,
          [statsIds],
        );
        for (const row of res?.rows || []) statsMap.set(row.video_id, row);
        statsAvailable = true;
      } catch (err) {
        console.warn('[Tool:getBulkPlaylistDetails] Stats enrichment failed:', err.message);
      }
    }

    // ── Assemble in requested order ──
    const playlists = [];
    for (const id of ids) {
      if (accessDenied.includes(id)) continue;
      const entry = metas.get(id);
      if (!entry) continue;
      const videos = (Array.isArray(entry.items) ? entry.items : [])
        .slice(0, safeMax)
        .map((v) => {
          const s = v.videoId ? statsMap.get(v.videoId) : null;
          return {
            videoId: v.videoId,
            title: v.title || 'Untitled',
            position: v.position ?? null,
            publishedAt: v.publishedAt || null,
            views: s ? Number(s.view_count || 0) : null,
            likes: s ? Number(s.like_count || 0) : null,
            comments: s ? Number(s.comment_count || 0) : null,
          };
        });
      const withStats = videos.filter((v) => v.views !== null);
      playlists.push({
        playlistId: id,
        title: entry.meta.title || 'Untitled',
        channelId: entry.meta.channelId,
        channelTitle: entry.meta.channelTitle || null,
        itemCount: entry.meta.itemCount ?? videos.length,
        publishedAt: entry.meta.publishedAt || null,
        source: entry.source,
        videoCount: videos.length,
        totalViews: withStats.reduce((n, v) => n + (v.views || 0), 0),
        totalLikes: withStats.reduce((n, v) => n + (v.likes || 0), 0),
        totalComments: withStats.reduce((n, v) => n + (v.comments || 0), 0),
        videosWithStats: withStats.length,
        videos,
      });
    }

    // ── Server-side filters + sort (applied before shaping output) ──
    const minTotalViews = Number(args?.minTotalViews);
    const minItemCount = Number(args?.minItemCount);
    const maxItemCount = Number(args?.maxItemCount);
    const afterMs = args?.publishedAfter ? Date.parse(String(args.publishedAfter)) : NaN;
    const beforeMs = args?.publishedBefore
      ? Date.parse(String(args.publishedBefore)) + 86400000 - 1
      : NaN;
    const titleNeedle = typeof args?.titleContains === 'string' && args.titleContains.trim()
      ? args.titleContains.trim().toLowerCase()
      : null;
    const foundBeforeFilter = playlists.length;
    const kept = playlists.filter((p) => {
      if (Number.isFinite(minTotalViews) && p.totalViews < minTotalViews) return false;
      if (Number.isFinite(minItemCount) && (p.itemCount ?? 0) < minItemCount) return false;
      if (Number.isFinite(maxItemCount) && (p.itemCount ?? 0) > maxItemCount) return false;
      if (titleNeedle && !String(p.title || '').toLowerCase().includes(titleNeedle)) return false;
      if (Number.isFinite(afterMs) || Number.isFinite(beforeMs)) {
        const pub = p.publishedAt ? Date.parse(p.publishedAt) : NaN;
        if (!Number.isFinite(pub)) return false;
        if (Number.isFinite(afterMs) && pub < afterMs) return false;
        if (Number.isFinite(beforeMs) && pub > beforeMs) return false;
      }
      return true;
    });
    const { sortBy, sortOrder = 'desc' } = args || {};
    const ordered = applySort(kept, sortBy, sortOrder, SORTABLE_FIELDS);

    const summary = {
      requested: ids.length,
      found: foundBeforeFilter,
      returned: ordered.length,
      filteredOut: foundBeforeFilter - ordered.length,
      missing: ids.filter((id) => !metas.has(id) && !accessDenied.includes(id)),
      accessDenied,
      statsAvailable,
      summaryOnly,
      maxVideosPerPlaylist: summaryOnly ? 0 : safeMax,
    };

    if (format === 'json') {
      return { format: 'json', ...summary, playlists: ordered };
    }

    const rows = [];
    for (const p of ordered) {
      if (!p.videos.length) {
        rows.push([
          p.playlistId, p.title, p.channelId, p.channelTitle,
          p.itemCount, isoOrEmpty(p.publishedAt), '', '', '', '', '', '', p.source,
        ]);
        continue;
      }
      for (const v of p.videos) {
        rows.push([
          p.playlistId, p.title, p.channelId, p.channelTitle,
          p.itemCount, isoOrEmpty(p.publishedAt),
          v.position ?? '', v.videoId, v.title,
          numOrEmpty(v.views), numOrEmpty(v.likes), numOrEmpty(v.comments),
          p.source,
        ]);
      }
    }
    const { csv, truncated } = truncateCsv(toCsv(CSV_HEADERS, rows), MAX_CSV_CHARS);
    return { format: 'csv', ...summary, truncated, csv };
  },
};

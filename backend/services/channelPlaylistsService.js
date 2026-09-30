/**
 * Channel playlists service -- full playlist catalog for a channel.
 *
 * Mirrors channelVideosService's ladder: L1 serverCache (single full-catalog
 * entry per scope+channel+privacy) -> L2 Postgres read-model (warmed by the
 * 6-hour ingestion cron) -> L3 live YouTube API loop. Routes slice the
 * returned catalog into pages, so the true total is known on page one and
 * "Next" just advances the offset instead of re-fetching ever-growing
 * token windows.
 *
 * Items are returned in the YouTube playlists.list resource shape
 * ({ id, snippet, contentDetails, status }) regardless of tier, so route and
 * frontend mapping code has one shape to handle. DB rows carry no tags, so
 * snippet.tags is [] on the Postgres tier (hashtag extraction from the
 * description still works downstream).
 */
function createChannelPlaylistsService(deps) {
  const {
    serverCache,
    shortHash,
    isPostgresConfigured,
    loadPlaylistsFromPostgres,
    getPlaylistsSyncedAt,
    isPlaylistDataStale,
    PLAYLIST_READ_MODEL_MAX_AGE_HOURS,
    YT_DATA_CACHE_TTL_MS,
    axios,
    ANALYTICS_SOURCE,
    YOUTUBE_API_BASE,
    API_KEY,
    markQuotaBillable,
    mergeOwnedHiddenPlaylists,
  } = deps;

  // Full-catalog cap for the live tier (playlists.list pages of 50).
  // Channels hold far fewer playlists than videos; 500 covers the realistic
  // range without unbounded quota burn.
  const MAX_LIVE_PLAYLIST_PAGES = Math.max(1, parseInt(process.env.MAX_LIVE_PLAYLIST_PAGES || "10", 10) || 10);

  /**
   * Map a Postgres analytics_playlists row (readModels.mapPlaylistRow shape)
   * onto the YouTube playlists.list resource shape.
   */
  function mapRowToApiItem(row) {
    const thumb = row.thumbnailUrl || "";
    return {
      id: row.playlistId,
      snippet: {
        title: row.title,
        description: row.description || "",
        channelId: row.channelId,
        channelTitle: row.channelTitle,
        publishedAt: row.publishedAt,
        thumbnails: {
          medium: { url: thumb },
          default: { url: thumb },
        },
        tags: [],
      },
      contentDetails: {
        // Keep null when the sync never recorded a size so consumers can
        // distinguish "unknown" from "empty" (no zero-fill).
        itemCount: row.itemCount === null || row.itemCount === undefined ? null : Number(row.itemCount),
      },
      status: row.privacyStatus ? { privacyStatus: row.privacyStatus } : {},
    };
  }

  /**
   * Full playlist catalog for a channel.
   *
   * @param {object} args
   * @param {string} args.channelId
   * @param {string} [args.accessToken] - `Bearer <oauth>` (may be undefined for key-only reads)
   * @param {string} [args.cacheScope] - org/user-aware scope segment; falls back to a token hash
   * @param {object} [args.req] - request, for quota billable-marking (marked only on live L3 hits)
   * @param {boolean} [args.includePrivate] - merge owner-only rows (requires an owner OAuth token)
   * @returns {Promise<{ items: Array, catalogTotal: number }>}
   */
  async function generateChannelPlaylists({
    channelId, accessToken, cacheScope, req, includePrivate,
  }) {
    const scopePart = cacheScope != null ? String(cacheScope) : shortHash(accessToken);
    const privacyPart = includePrivate ? "p1" : "p0";
    // v2: pre-fix entries could hold stale-high totals or a cached 404-empty
    // (which masked the channel until TTL expiry), so the version bump forces
    // a one-time refill from Postgres/live on next read.
    const cacheKey = `channel_playlists:v2:${scopePart}:${channelId}:${privacyPart}`;
    const useApiKeyFallback = !accessToken || !accessToken.startsWith("Bearer ");
    const ytHeaders = useApiKeyFallback ? {} : { Authorization: accessToken };

    const cached = await serverCache.get(cacheKey);
    if (cached) {
      console.log("[Cache] Channel playlists HIT:", cacheKey.slice(0, 72));
      return cached;
    }

    // L2: Postgres read-model (cron-ingested). Served while inside the
    // freshness window; stale rows are kept aside so a failed live refresh
    // can still degrade to them instead of erroring the table.
    let stalePgRows = null;
    if (ANALYTICS_SOURCE !== "youtube-only" && isPostgresConfigured()) {
      try {
        const syncedAt = typeof getPlaylistsSyncedAt === "function"
          ? await getPlaylistsSyncedAt(channelId)
          : null;
        const stale = typeof isPlaylistDataStale === "function"
          ? isPlaylistDataStale(syncedAt, PLAYLIST_READ_MODEL_MAX_AGE_HOURS)
          : !syncedAt;
        const rows = await loadPlaylistsFromPostgres(channelId, {
          includePrivate: includePrivate === true,
        });
        if (Array.isArray(rows) && rows.length) {
          const items = rows.map(mapRowToApiItem);
          if (!stale) {
            const result = { items, catalogTotal: items.length };
            await serverCache.set(cacheKey, result, YT_DATA_CACHE_TTL_MS.PLAYLISTS);
            console.log("[Cache] Channel playlists L2 (Postgres) HIT:", cacheKey.slice(0, 72), `(n=${items.length})`);
            return result;
          }
          stalePgRows = items;
        }
      } catch (err) {
        console.warn("[Channel Playlists] Postgres path failed, falling back to live API:", err.message);
      }
    }

    if (typeof markQuotaBillable === "function") markQuotaBillable(req);

    // L3: live YouTube API -- page the full catalog, then merge owner-only
    // rows ONCE over the accumulated set (per-page merging repeats the same
    // hidden rows in every page and burns mine=true units per page).
    try {
      const collected = [];
      const seenIds = new Set();
      let ytTotal = 0;
      let pageToken = undefined;
      for (let page = 0; page < MAX_LIVE_PLAYLIST_PAGES; page++) {
        const params = { part: "snippet,contentDetails,status", channelId, maxResults: 50 };
        if (pageToken) params.pageToken = pageToken;
        const config = { params };
        if (!useApiKeyFallback) config.headers = ytHeaders;
        else params.key = API_KEY;

        let res;
        try {
          res = await axios.get(`${YOUTUBE_API_BASE}/playlists`, config);
        } catch (err) {
          if (err.response?.status === 404) {
            console.warn(
              `[generateChannelPlaylists] Playlist listing 404 for channel=${channelId}. Returning empty list.`,
            );
            // Deliberately NOT cached: a 404 here is usually transient (bad
            // channel id mid-switch, token hiccup). Caching the empty result
            // would mask the channel until TTL expiry with no recovery path.
            return { items: [], catalogTotal: 0 };
          }
          throw err;
        }

        const data = res.data || {};
        if (page === 0) {
          ytTotal = Number(data.pageInfo?.totalResults) || (data.items || []).length;
        }
        for (const item of data.items || []) {
          if (item?.id && !seenIds.has(item.id)) {
            seenIds.add(item.id);
            collected.push(item);
          }
        }
        pageToken = data.nextPageToken;
        if (!pageToken) break;
      }
      // Loop exited with pages still available only when the page cap hit
      // (truncated catalog). Otherwise every catalog page was enumerated, so
      // the deduped set -- not YouTube's pageInfo.totalResults, which goes
      // stale when playlists are deleted or privatized -- is ground truth.
      const truncated = !!pageToken;

      let catalogTotal = Math.max(ytTotal, collected.length);
      if (includePrivate === true && !useApiKeyFallback && typeof mergeOwnedHiddenPlaylists === "function") {
        const before = new Set(collected.map((i) => i.id));
        const merged = await mergeOwnedHiddenPlaylists({ items: collected }, {
          channelId, accessToken, axios, YOUTUBE_API_BASE, isFirstPage: true,
        });
        const mergedItems = Array.isArray(merged?.items) ? merged.items : collected;
        const added = mergedItems.filter((i) => !before.has(i.id)).length;
        collected.length = 0;
        collected.push(...mergedItems);
        catalogTotal = truncated ? ytTotal + added : collected.length;
      } else if (!truncated) {
        catalogTotal = collected.length;
      }

      const result = { items: collected, catalogTotal };
      await serverCache.set(cacheKey, result, YT_DATA_CACHE_TTL_MS.PLAYLISTS);
      console.log("[Cache] Channel playlists WRITE:", cacheKey.slice(0, 72), `(Fetched ${collected.length})`);
      return result;
    } catch (error) {
      if (stalePgRows) {
        console.warn("[generateChannelPlaylists] Live refresh failed, serving stale Postgres rows:", error.response?.data || error.message);
        return { items: stalePgRows, catalogTotal: stalePgRows.length };
      }
      console.error("[generateChannelPlaylists] Error:", error.response?.data || error.message);
      throw error;
    }
  }

  return { generateChannelPlaylists };
}

module.exports = { createChannelPlaylistsService };

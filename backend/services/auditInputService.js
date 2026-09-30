/**
 * Audit input fetching — the "fetch" stage of the audit pipeline.
 *
 * Extracted from the inline `gatherAuditInput` in `backend/index.js` (same
 * requests, same shapes, same fallbacks) with three pipeline upgrades:
 *
 * 1. Parallel stages: channel meta + sections + videos + playlists fetch
 *    concurrently instead of four serial awaits. Each stage reports progress
 *    as it completes so the job UI moves during the slowest phase.
 * 2. Pooled playlist→video membership: the serial per-playlist loop becomes
 *    a worker pool. Claims merge in playlist order afterwards, so "first
 *    playlist wins" stays deterministic.
 * 3. Scope-aware skip: `scope === "channel"` (the /channelaudit run) needs
 *    channel + videos (cadence/niche scoring reads `input.videos`) but never
 *    playlists or membership — those stages are skipped entirely.
 *
 * Every stage keeps its own try/catch fallback (a failed stage degrades to
 * empty input for that part, never fails the audit).
 */

const MEMBERSHIP_POOL_SIZE = 4;
const MAX_PLAYLISTS = 50;
const MAX_PLAYLIST_ITEMS = 500;
const MAX_PLAYLIST_PAGES = 500;

/** Worker-pool map. Order of `items` is irrelevant; `fn` may be async. */
async function mapPool(items, size, fn) {
  const list = Array.isArray(items) ? items : [];
  const workers = Math.max(1, Math.min(size || 4, list.length || 1));
  let next = 0;
  const results = new Array(list.length);
  async function worker() {
    while (next < list.length) {
      const index = next;
      next += 1;
      results[index] = await fn(list[index], index);
    }
  }
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

function createAuditInputService(deps) {
  const {
    axios,
    generateChannelVideos,
    API_KEY,
    YOUTUBE_API_BASE,
    perfLog,
    perfNow,
  } = deps;

  const now = () => (typeof perfNow === "function" ? perfNow() : Date.now());
  const span = (label, startedAt, extra) => {
    try {
      if (typeof perfLog === "function") perfLog(label, startedAt, extra);
    } catch {
      /* timing never fails the fetch */
    }
  };

  const useKey = (authHeader) =>
    !authHeader || !authHeader.startsWith("Bearer ");

  const withAuth = (authHeader, params) => {
    const config = { params };
    if (!useKey(authHeader)) config.headers = { Authorization: authHeader };
    else params.key = API_KEY;
    return config;
  };

  // Channel metadata (name, handle/username, description, branding tags).
  async function fetchChannelMeta(channelId, authHeader) {
    let channel = {};
    try {
      const params = {
        part: "snippet,statistics,brandingSettings,status",
        id: channelId,
      };
      const resp = await axios.get(
        `${YOUTUBE_API_BASE}/channels`,
        withAuth(authHeader, params),
      );
      const item = resp?.data?.items?.[0];
      if (item) {
        const snip = item.snippet || {};
        const brand = item.brandingSettings?.channel || {};
        const brandImage = item.brandingSettings?.image || {};
        channel = {
          name: snip.title,
          username: snip.customUrl,
          description: snip.description,
          categoryId: snip.categoryId,
          keywords:
            typeof brand.keywords === "string"
              ? brand.keywords.split(/[,\s]+/).filter(Boolean)
              : [],
          branding: {
            avatar: snip.thumbnails?.default?.url,
            image:
              brandImage && Object.keys(brandImage).length ? brandImage : null,
            watermark: null,
            trailer: brand.unsubscribedTrailer || null,
            sections: null,
            unsubscribedTrailer: brand.unsubscribedTrailer || null,
            relatedChannels: brand.relatedChannels || null,
            brandingVerifiable: item.brandingSettings != null,
          },
          status: item.status || {},
        };
      }
    } catch (e) {
      console.warn("[Audit] Channel metadata fetch failed:", e.message);
    }
    return channel;
  }

  // Channel sections (home-page shelves), 1 quota unit. Attaches in place.
  async function fetchSections(channelId, authHeader, channel) {
    try {
      const params = {
        part: "snippet,contentDetails",
        channelId,
        maxResults: 50,
      };
      const secRes = await axios.get(
        `${YOUTUBE_API_BASE}/channelSections`,
        withAuth(authHeader, params),
      );
      const items = secRes?.data?.items || [];
      if (items.length && channel.branding) {
        channel.branding.sections = items.map((s) => ({
          title: s.snippet?.title,
          type: s.snippet?.type,
        }));
      }
    } catch (e) {
      console.warn("[Audit] Channel sections fetch failed:", e.message);
    }
    return channel;
  }

  // Channel videos (title, description, tags, engagement, cadence).
  // `maxVideos` caps the catalog read (generateChannelVideos is PG-first).
  async function fetchVideos(channelId, authHeader, maxVideos) {
    let videos = [];
    try {
      const fetched = await generateChannelVideos({
        channelId,
        accessToken: authHeader,
        ...(typeof maxVideos === "number" ? { maxVideos } : {}),
      });
      videos = (Array.isArray(fetched) ? fetched : []).map((v) => ({
        videoId: v.videoId,
        title: v.title,
        description: v.description,
        tags: Array.isArray(v.tags) ? v.tags : [],
        publishedAt: v.publishedAt,
        viewCount: Number(v.viewCount) || 0,
        likeCount: Number(v.likeCount) || 0,
        commentCount: Number(v.commentCount) || 0,
        originalPlaylistId: "",
        customMetadata: {},
      }));
    } catch (e) {
      console.warn("[Audit] Video fetch failed:", e.message);
    }
    return videos;
  }

  // All playlists for the channel (title, description, size).
  async function fetchPlaylists(channelId, authHeader) {
    let playlists = [];
    try {
      let pageToken = undefined;
      do {
        const params = {
          part: "snippet,contentDetails",
          channelId,
          maxResults: 50,
        };
        if (pageToken) params.pageToken = pageToken;
        const resp = await axios.get(
          `${YOUTUBE_API_BASE}/playlists`,
          withAuth(authHeader, params),
        );
        const items = resp?.data?.items || [];
        for (const item of items) {
          playlists.push({
            playlistId: item.id,
            title: item.snippet?.title,
            description: item.snippet?.description,
            size: item.contentDetails?.itemCount,
          });
        }
        pageToken = resp?.data?.nextPageToken;
      } while (pageToken && playlists.length < MAX_PLAYLIST_PAGES);
    } catch (e) {
      console.warn("[Audit] Playlist fetch failed:", e.message);
    }
    return playlists;
  }

  // One playlist's member video ids (serial pagination — pageToken chains).
  // Returns claims in encounter order: [{ videoId, playlist }].
  async function fetchPlaylistClaims(pl, authHeader) {
    const claims = [];
    let pageToken = undefined;
    let itemsFetched = 0;
    try {
      do {
        const params = {
          part: "snippet",
          playlistId: pl.playlistId,
          maxResults: 50,
        };
        if (pageToken) params.pageToken = pageToken;
        const resp = await axios.get(
          `${YOUTUBE_API_BASE}/playlistItems`,
          withAuth(authHeader, params),
        );
        for (const it of resp?.data?.items || []) {
          const vid = it.snippet?.resourceId?.videoId;
          if (vid) claims.push({ videoId: String(vid), playlist: pl });
        }
        itemsFetched += resp?.data?.items?.length || 0;
        pageToken =
          itemsFetched < MAX_PLAYLIST_ITEMS
            ? resp?.data?.nextPageToken
            : undefined;
      } while (pageToken);
    } catch (e) {
      console.warn(
        `[Audit] Playlist-item fetch failed for ${pl.playlistId}:`,
        e.message,
      );
    }
    return claims;
  }

  // Playlist-item membership, pooled across playlists. Claims merge in
  // playlist order afterwards so "first playlist wins" stays deterministic.
  // Each video carries its playlist so the playlist sub-audit can run the
  // Playlist Optimizer engine in EXISTING mode. Failures leave membership
  // empty (engine falls back to NEW mode).
  async function fetchMembership(playlists, videos, authHeader, poolSize) {
    if (!playlists.length || !videos.length) return;
    const byVideoId = new Map(videos.map((v) => [String(v.videoId), v]));
    const targets = playlists.slice(0, MAX_PLAYLISTS);
    let claimLists = [];
    try {
      claimLists = await mapPool(
        targets,
        poolSize || MEMBERSHIP_POOL_SIZE,
        (pl) => fetchPlaylistClaims(pl, authHeader),
      );
    } catch (e) {
      console.warn("[Audit] Playlist-item membership fetch failed:", e.message);
      return;
    }
    for (const claims of claimLists) {
      for (const { videoId, playlist } of claims || []) {
        const target = byVideoId.get(videoId);
        if (!target || target.originalPlaylistId) continue;
        target.originalPlaylistId = playlist.playlistId;
        target.customMetadata = {
          originalPlaylistTitle: playlist.title || "",
          originalPlaylistDescription: playlist.description || "",
          originalPlaylistTags: playlist.title ? [playlist.title] : [],
        };
      }
    }
  }

  /**
   * Gather the full audit input bundle: `{ channel, videos, playlists }`.
   * Stages run in parallel and report via `onProgress(stage, fraction)`;
   * `scope === "channel"` skips playlists + membership (unneeded there).
   */
  async function gatherAuditInput({
    channelId,
    authHeader,
    maxVideos,
    scope,
    onProgress,
  } = {}) {
    const emit = (stage, fraction) => {
      try {
        if (typeof onProgress === "function") onProgress(stage, fraction);
      } catch {
        /* progress is best-effort */
      }
    };

    const tChannel = now();
    const channelPromise = fetchChannelMeta(channelId, authHeader).then(
      (channel) =>
        fetchSections(channelId, authHeader, channel).then((c) => {
          span("audit:input:channel", tChannel, {});
          emit("channel", 1);
          return c;
        }),
    );
    const tVideos = now();
    const videosPromise = fetchVideos(channelId, authHeader, maxVideos).then(
      (videos) => {
        span("audit:input:videos", tVideos, { count: videos.length });
        emit("videos", 1);
        return videos;
      },
    );

    if (scope === "channel") {
      const [channel, videos] = await Promise.all([
        channelPromise,
        videosPromise,
      ]);
      emit("done", 1);
      return { channel, videos, playlists: [] };
    }

    const tPlaylists = now();
    const playlistsPromise = fetchPlaylists(channelId, authHeader).then(
      (playlists) => {
        span("audit:input:playlists", tPlaylists, { count: playlists.length });
        emit("playlists", 1);
        return playlists;
      },
    );
    const [channel, videos, playlists] = await Promise.all([
      channelPromise,
      videosPromise,
      playlistsPromise,
    ]);
    const tMembership = now();
    await fetchMembership(playlists, videos, authHeader);
    span("audit:input:membership", tMembership, {
      playlists: Math.min(playlists.length, MAX_PLAYLISTS),
    });
    emit("membership", 1);
    emit("done", 1);
    return { channel, videos, playlists };
  }

  return {
    gatherAuditInput,
    fetchChannelMeta,
    fetchVideos,
    fetchPlaylists,
    fetchMembership,
    mapPool,
  };
}

module.exports = { createAuditInputService, mapPool, MEMBERSHIP_POOL_SIZE };

/**
 * Public Audit data service -- fetches audit inputs for ANY public channel
 * using only YouTube Data API v3 public endpoints (server API key, no OAuth,
 * no user token). Deliberately avoids `search.list` (100 quota units);
 * total cost per audit: ~3 units (channels.list + playlistItems + videos.list).
 *
 * Caching mirrors the shared tools' ladder (ServerCache L1): the resolved
 * channel and the playlist catalog are cached per channel for the standard
 * YouTube-data TTL, so repeat audits of the same channel are instant and
 * avatar/banner/counts stay stable between runs.
 */
// Admin audit ceiling: 1,000 public videos = 20 playlistItems pages + 20
// videos.list calls. The UI can request this safely; larger channels are bounded.
const MAX_PUBLIC_VIDEOS = 1000;
const VIDEOS_PER_PAGE = 50;
// Public channel metadata + playlist catalogs change slowly; reuse the shared
// channels TTL instead of introducing a new knob (DRY with the tools pages).
const DEFAULT_PUBLIC_AUDIT_TTL_MS = 4 * 60 * 60 * 1000;

function createPublicAuditService(deps = {}) {
  const {
    axios: http,
    API_KEY,
    YOUTUBE_API_BASE,
    serverCache,
    YT_DATA_CACHE_TTL_MS,
  } = deps;

  const base = (YOUTUBE_API_BASE || "https://www.googleapis.com/youtube/v3").replace(/\/+$/, "");
  const cacheTtl = YT_DATA_CACHE_TTL_MS?.CHANNEL || DEFAULT_PUBLIC_AUDIT_TTL_MS;
  // Optional L1: absent in unit tests -- every cache op degrades to a no-op.
  const cache =
    serverCache && typeof serverCache.get === "function" && typeof serverCache.set === "function"
      ? serverCache
      : null;

  async function cacheGet(key) {
    if (!cache) return null;
    try {
      return await cache.get(key);
    } catch {
      return null;
    }
  }

  async function cacheSet(key, value) {
    if (!cache) return;
    try {
      await cache.set(key, value, cacheTtl);
    } catch {
      /* cache write failures never break an audit */
    }
  }

  function requireHttp() {
    if (!http) throw new Error("YouTube HTTP client is not configured.");
    if (!API_KEY) throw new Error("YOUTUBE_API_KEY is not configured on the server.");
  }

  async function ytGet(path, params) {
    requireHttp();
    try {
      const res = await http.get(`${base}/${path}`, { params: { ...params, key: API_KEY }, timeout: 15000 });
      return res?.data || {};
    } catch (err) {
      const reason =
        err?.response?.data?.error?.errors?.[0]?.reason ||
        err?.response?.data?.error?.message ||
        err?.message ||
        "YouTube API request failed";
      const wrapped = new Error(`YouTube API error (${path}): ${reason}`);
      wrapped.status = err?.response?.status;
      throw wrapped;
    }
  }

  /**
   * Extract a channel lookup from free-form admin input: raw channel ID,
   * @handle, or youtube.com URLs (/channel/, /@, /c/, /user/).
   * Returns { kind: 'id'|'handle', value }.
   */
  function parseChannelInput(raw) {
    const input = String(raw || "").trim();
    if (!input) throw new Error('"channelInput" is required.');
    const handleMatch = input.match(/(?:youtube\.com\/@|youtu\.be\/@|@)([^\s/?&#]+)/i);
    if (handleMatch) return { kind: "handle", value: handleMatch[1] };
    const idMatch = input.match(/youtube\.com\/channel\/([^\s/?&#]+)/i);
    if (idMatch) return { kind: "id", value: idMatch[1] };
    const customMatch = input.match(/youtube\.com\/(?:c|user)\/([^\s/?&#]+)/i);
    if (customMatch) return { kind: "handle", value: customMatch[1] };
    if (/^UC[\w-]{20,}$/.test(input)) return { kind: "id", value: input };
    // Bare handle (with or without @) or custom name -- try forHandle lookup.
    return { kind: "handle", value: input.replace(/^@/, "") };
  }

  function pickThumb(thumbnails) {
    if (!thumbnails) return "";
    return (
      thumbnails.maxres?.url ||
      thumbnails.high?.url ||
      thumbnails.medium?.url ||
      thumbnails.default?.url ||
      ""
    );
  }

  /**
   * Resolve admin input to a public channel (snippet + statistics +
   * branding + uploads playlist id). Throws when nothing matches.
   * Result is cached per channel key (same L1 idea as the shared tools).
   */
  async function resolvePublicChannel(rawInput) {
    const parsed = parseChannelInput(rawInput);
    const cacheKey = `public_audit:channel:${parsed.kind}:${parsed.value.toLowerCase()}`;
    const cachedChannel = await cacheGet(cacheKey);
    if (cachedChannel) return cachedChannel;

    const params =
      parsed.kind === "id"
        ? { part: "snippet,statistics,contentDetails,brandingSettings,topicDetails", id: parsed.value }
        : { part: "snippet,statistics,contentDetails,brandingSettings,topicDetails", forHandle: parsed.value };
    let data = await ytGet("channels", params);
    // Same fallback ladder the /channels tools use: forHandle misses for some
    // legacy custom-URL channels, so retry once with forUsername only.
    if (parsed.kind === "handle" && !(data?.items || []).length) {
      const { forHandle: _forHandle, ...usernameParams } = params;
      data = await ytGet("channels", { ...usernameParams, forUsername: parsed.value });
    }
    const item = data?.items?.[0];
    if (!item) {
      throw new Error(
        parsed.kind === "id"
          ? "Channel not found. Check the channel ID."
          : `Channel not found for "${parsed.value}". Try a channel ID or full /channel/ URL (custom /c/ names are not always resolvable).`,
      );
    }
    const channel = {
      channelId: item.id,
      title: item.snippet?.title || "",
      description: item.snippet?.description || "",
      customUrl: item.snippet?.customUrl || "",
      handle: item.snippet?.handle || "",
      country: item.snippet?.country || "",
      publishedAt: item.snippet?.publishedAt || null,
      avatarUrl: pickThumb(item.snippet?.thumbnails),
      thumbnails: item.snippet?.thumbnails || null,
      bannerUrl:
        item.brandingSettings?.image?.bannerExternalUrl ||
        item.brandingSettings?.image?.bannerTvImageUrl ||
        "",
      keywords: item.brandingSettings?.channel?.keywords || "",
      topics: Array.isArray(item.topicDetails?.topicCategories)
        ? item.topicDetails.topicCategories.map((u) => String(u).split("/").pop().replace(/_/g, " "))
        : [],
      statistics: {
        subscriberCount: item.statistics?.subscriberCount ?? null,
        viewCount: item.statistics?.viewCount ?? null,
        videoCount: item.statistics?.videoCount ?? null,
        hiddenSubscriberCount: item.statistics?.hiddenSubscriberCount ?? false,
      },
      uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads || null,
    };
    await cacheSet(cacheKey, channel);
    return channel;
  }

  function parseIsoDuration(iso) {
    if (!iso || typeof iso !== "string") return null;
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return null;
    const h = Number(m[1] || 0);
    const min = Number(m[2] || 0);
    const s = Number(m[3] || 0);
    if (!h && !min && !s) return null;
    return h * 3600 + min * 60 + s;
  }

  function formatDuration(totalSeconds) {
    if (totalSeconds === null || totalSeconds === undefined) return "";
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
    const ss = String(s).padStart(2, "0");
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  /**
   * Public playlists for the channel (id, title, thumbnail, item count).
   * Same catalog shape the playlists tool route returns, mapped to the audit's
   * needs; bounded pages (~1 quota unit/page) and cached per channel so
   * "all playlists" (the stat card + scorer input) is stable across runs.
   */
  async function fetchPublicPlaylists(channelId, maxPlaylists = 10) {
    if (!channelId) return [];
    const max = Math.max(1, Math.min(1000, Number(maxPlaylists) || 10));
    const cacheKey = `public_audit:playlists:${channelId}:n${max}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return cached;

    const items = [];
    let pageToken;
    // YouTube may return fewer than maxResults while still providing a token.
    // Always permit the two-page ceiling, then stop at the item cap or no token.
    const maxPages = Math.max(2, Math.ceil(max / 50));
    for (let page = 0; page < maxPages && items.length < max; page++) {
      const data = await ytGet("playlists", {
        part: "snippet,contentDetails",
        channelId,
        maxResults: 50,
        ...(pageToken ? { pageToken } : {}),
      });
      for (const p of data?.items || []) {
        items.push({
          playlistId: p.id,
          title: p.snippet?.title || "",
          description: p.snippet?.description || "",
          publishedAt: p.snippet?.publishedAt || null,
          itemCount: p.contentDetails?.itemCount ?? null,
          thumbnailUrl: pickThumb(p.snippet?.thumbnails),
        });
        if (items.length >= max) break;
      }
      pageToken = data?.nextPageToken;
      if (!pageToken) break;
    }
    await cacheSet(cacheKey, items);
    return items;
  }

  /**
   * Channel lifetime + engagement aggregates derived purely from public data
   * (no analytics API): avg views/video, engagement rate, upload cadence and
   * short/long-form split. Single source of truth for the persisted report --
   * the route only calls this, it never re-derives the numbers.
   */
  function computeChannelLifetime(inputs = []) {
    const num = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const list = Array.isArray(inputs) ? inputs : [];
    const pubDates = list
      .map((v) => (v.publishedAt ? Date.parse(v.publishedAt) : NaN))
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => a - b);
    const sumViews = list.reduce((s, v) => s + (num(v.statistics?.viewCount) ?? 0), 0);
    const sumLikes = list.reduce((s, v) => s + (num(v.statistics?.likeCount) ?? 0), 0);
    const sumComments = list.reduce((s, v) => s + (num(v.statistics?.commentCount) ?? 0), 0);
    return {
      auditedVideoCount: list.length,
      totalViewsAudited: sumViews,
      totalLikesAudited: sumLikes,
      totalCommentsAudited: sumComments,
      avgViewsPerVideo: list.length ? Math.round(sumViews / list.length) : null,
      engagementRatePct:
        sumViews > 0 ? Number((((sumLikes + sumComments) / sumViews) * 100).toFixed(2)) : null,
      oldestAuditedAt: pubDates.length ? new Date(pubDates[0]).toISOString() : null,
      newestAuditedAt: pubDates.length ? new Date(pubDates[pubDates.length - 1]).toISOString() : null,
      uploadCadenceDays:
        pubDates.length > 1
          ? Number(
              (((pubDates[pubDates.length - 1] - pubDates[0]) / (pubDates.length - 1)) / 86400000).toFixed(1),
            )
          : null,
      shortsCount: list.filter((v) => (v.durationSeconds ?? 61) <= 60).length,
      longformCount: list.filter((v) => (v.durationSeconds ?? 61) > 60).length,
    };
  }

  /** One videos.list item -> audit-engine input (+ public engagement stats). */
  function mapPublicVideo(v) {
    const durationSeconds = parseIsoDuration(v.contentDetails?.duration);
    return {
      videoId: v.id,
      title: v.snippet?.title || "",
      description: v.snippet?.description || "",
      tags: Array.isArray(v.snippet?.tags) ? v.snippet.tags : [],
      keywords: [],
      caption: "",
      publishedAt: v.snippet?.publishedAt || null,
      categoryId: v.snippet?.categoryId || "",
      defaultLanguage: v.snippet?.defaultLanguage || v.snippet?.defaultAudioLanguage || "",
      liveBroadcastContent: v.snippet?.liveBroadcastContent || "none",
      durationIso: v.contentDetails?.duration || "",
      durationSeconds,
      durationLabel: formatDuration(durationSeconds),
      definition: v.contentDetails?.definition || "",
      dimension: v.contentDetails?.dimension || "",
      licensedContent: v.contentDetails?.licensedContent ?? null,
      thumbnail: { url: pickThumb(v.snippet?.thumbnails) },
      statistics: {
        viewCount: v.statistics?.viewCount ?? null,
        likeCount: v.statistics?.likeCount ?? null,
        commentCount: v.statistics?.commentCount ?? null,
        favoriteCount: v.statistics?.favoriteCount ?? null,
      },
    };
  }

  /**
   * Public videos for the audit engine shape
   * ({ videoId, title, description, tags, publishedAt, thumbnail: { url } }).
   * Public-data only: no captions/keywords (engine marks those no-data).
   * Enriched with duration + engagement stats for the detailed report UI.
   *
   * FULL audit: walks the uploads playlist (newest first) across as many
   * `playlistItems` pages as `maxVideos` needs, then hydrates the ids with
   * `videos.list` in chunks of 50. Quota stays linear and tiny — 1 unit per
   * playlistItems page + 1 unit per 50 videos (50 videos = 2 units total).
   */
  async function fetchPublicVideos(channel, maxVideos = MAX_PUBLIC_VIDEOS) {
    const max = Math.max(1, Math.min(MAX_PUBLIC_VIDEOS, Number(maxVideos) || MAX_PUBLIC_VIDEOS));
    if (!channel?.uploadsPlaylistId) return [];
    const ids = [];
    let pageToken;
    const pages = Math.ceil(max / VIDEOS_PER_PAGE);
    for (let page = 0; page < pages && ids.length < max; page++) {
      const pl = await ytGet("playlistItems", {
        part: "snippet,contentDetails",
        playlistId: channel.uploadsPlaylistId,
        maxResults: VIDEOS_PER_PAGE,
        ...(pageToken ? { pageToken } : {}),
      });
      for (const it of pl?.items || []) {
        const id = it?.contentDetails?.videoId || it?.snippet?.resourceId?.videoId;
        // playlistItems rows for deleted/privated uploads can carry only a
        // snippet.resourceId fallback -- skip unresolvable ids instead of
        // yielding a blank card (mirrors the tools' hydration skip).
        if (!id) continue;
        ids.push(id);
        if (ids.length >= max) break;
      }
      pageToken = pl?.nextPageToken;
      if (!pageToken) break;
    }
    if (!ids.length) return [];
    const out = [];
    for (let i = 0; i < ids.length; i += VIDEOS_PER_PAGE) {
      const chunk = ids.slice(i, i + VIDEOS_PER_PAGE);
      const vids = await ytGet("videos", {
        part: "snippet,statistics,contentDetails",
        id: chunk.join(","),
      });
      for (const v of vids?.items || []) out.push(mapPublicVideo(v));
    }
    return out;
  }

  /**
   * Backfill per-video display metadata for legacy saved reports.
   * Direct `videos.list` lookup by id (1 quota unit per 50 ids):
   * title/dates come from `snippet`, views/likes/comments from `statistics`,
   * duration/definition from `contentDetails` — the same connector the Extra
   * Tools video pages use. Reports saved before per-video stats were persisted
   * get their rows filled on open (see GET /:id) instead of needing a re-run.
   */
  async function hydrateVideoMetadata(videoIds = []) {
    const ids = [...new Set((Array.isArray(videoIds) ? videoIds : []).filter((id) => typeof id === "string" && id.trim()))];
    if (!ids.length) return [];
    const out = [];
    for (let i = 0; i < ids.length; i += VIDEOS_PER_PAGE) {
      const chunk = ids.slice(i, i + VIDEOS_PER_PAGE);
      const vids = await ytGet("videos", {
        part: "snippet,statistics,contentDetails",
        id: chunk.join(","),
      });
      for (const v of vids?.items || []) out.push(mapPublicVideo(v));
    }
    return out;
  }

  /** Channel keywords arrive as one quoted/space-separated string -> array (scorer wants a list). */
  function splitKeywords(raw) {
    const out = [];
    const re = /"([^"]+)"|(\S+)/g;
    let match;
    while ((match = re.exec(String(raw || ""))) !== null) {
      const value = (match[1] || match[2] || "").trim();
      if (value) out.push(value);
    }
    return out;
  }

  /**
   * Map public data onto the Full Audit scoring input contract
   * (`{ channel: { name, username, keywords, description }, videos, playlists }`)
   * consumed by channelAuditScoringService.scoreAll / buildAuditIssues. Pure and
   * dependency-free so the Full Audit engine runs on public data unchanged —
   * same categories, same criteria weights, same numbers as an owned channel.
   */
  function buildFullAuditInput(channel = {}, videos = [], playlists = []) {
    const num = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    return {
      channel: {
        name: channel.title || "",
        username: channel.handle || channel.customUrl || "",
        keywords: splitKeywords(channel.keywords),
        description: channel.description || "",
      },
      videos: (Array.isArray(videos) ? videos : []).map((v) => ({
        videoId: v.videoId,
        title: v.title || "",
        description: v.description || "",
        tags: Array.isArray(v.tags) ? v.tags : [],
        publishedAt: v.publishedAt || null,
        viewCount: num(v.statistics?.viewCount),
        likeCount: num(v.statistics?.likeCount),
        commentCount: num(v.statistics?.commentCount),
      })),
      playlists: (Array.isArray(playlists) ? playlists : []).map((p) => ({
        playlistId: p.playlistId,
        title: p.title || "",
        description: p.description || "",
        size: num(p.itemCount),
      })),
    };
  }

  return {
    parseChannelInput,
    resolvePublicChannel,
    fetchPublicVideos,
    fetchPublicPlaylists,
    hydrateVideoMetadata,
    computeChannelLifetime,
    buildFullAuditInput,
    parseIsoDuration,
    formatDuration,
  };
}

module.exports = {
  createPublicAuditService,
  MAX_PUBLIC_VIDEOS,
  VIDEOS_PER_PAGE,
};

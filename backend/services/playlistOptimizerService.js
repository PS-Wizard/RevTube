// ─────────────────────────────────────────────────────────────────────────────
// Playlist Optimizer Service -- DeepSeek API proxy with caching & retry
// ─────────────────────────────────────────────────────────────────────────────

const DEEPSEEK_API_BASE = "https://api.deepseek.com";
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const DEFAULT_MAX_VIDEOS = 500;
const {
  DEFAULT_OPTIMIZER_CRITERIA,
} = require("../config/optimizerCriteria");

/**
 * Retry a function with exponential backoff for transient failures (429, 5xx).
 */
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 2000) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status = error?.response?.status || error?.status || 0;
      const msg = error?.message || "";
      const isRateLimit =
        status === 429 ||
        msg.includes("429") ||
        msg.includes("RATE_LIMIT") ||
        msg.includes("quota") ||
        msg.includes("rate_limit_exceeded");
      const isTransient = isRateLimit || (status >= 500 && status < 600);

      if (isTransient && i < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, i);
        console.warn(
          `[PlaylistOptimizer] DeepSeek call failed (attempt ${i + 1}/${maxRetries}), retrying in ${delay}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

/**
 * Extract a YouTube video ID from various URL formats.
 */
function extractYoutubeId(url) {
  const regExp =
    /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = String(url).match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
}

/** Coerce a score-ish value to a 0-100 integer, falling back when absent. */
function toScore(n, fallback = 0) {
  const v = typeof n === "number" ? n : parseInt(n, 10);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(100, Math.round(v)));
}

// ── Time-decay weighting ─────────────────────────────────────────────────────
// Playlist analysis deliberately weights RECENT + PERFORMING videos highest:
// newer videos are stronger signals of the channel's current direction, and
// older videos accumulate views over time, so raw view counts alone would
// over-weight legacy content. Every video gets a deterministic decayWeight
// (0..1) = recency × performance, plus a tier label for display.

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Compute the time-decay weight for one video.
 * @param {string} publishDate - ISO publish date.
 * @param {number} views       - All-time view count (0 when unknown).
 * @param {number} maxViews    - Max all-time views across the analyzed set.
 * @returns {{ decayWeight: number, decayTier: string, ageDays: number }}
 */
function computeDecay(publishDate, views, maxViews) {
  let ageDays = 0;
  if (publishDate) {
    const t = Date.parse(publishDate);
    if (!Number.isNaN(t)) {
      ageDays = Math.max(0, Math.floor((Date.now() - t) / DAY_MS));
    }
  }
  // Recency halves roughly every 12 months: 1.0 today, ~0.5 at 1yr, ~0.25 at 2yr.
  const recency = Math.pow(0.5, ageDays / 365);
  // Performance scales up with views (log-normalized so a mega-hit can't drown
  // the set) but never zeroes a low-view video (floor 0.3). Unknown views -> 1.
  const performance =
    maxViews > 0 && views > 0
      ? 0.3 + 0.7 * (Math.log1p(views) / Math.log1p(maxViews))
      : 1;
  const decayWeight = Number((recency * performance).toFixed(3));
  const decayTier =
    decayWeight >= 0.75
      ? "High"
      : decayWeight >= 0.5
        ? "Medium"
        : decayWeight >= 0.25
          ? "Low"
          : "Minimal";
  return { decayWeight, decayTier, ageDays };
}

/**
 * Decorate every input video with its decay weight, newest/highest performers
 * first. The sorted array is JSON-serialized into the prompt so the model sees
 * the most important videos first and can weight its ratings accordingly.
 * When `useTimeDecay` is OFF (default) videos are passed in original order
 * without any decay fields, so the model treats every video equally.
 */
function enrichVideosForPrompt(videos = [], useTimeDecay = false) {
  const maxViews = Math.max(0, ...videos.map((v) => Number(v.views) || 0));
  const rows = videos.map((v) => {
    const row = {
      id: v.id,
      videoId: v.videoId,
      originalPlaylistId: v.originalPlaylistId,
      title: v.title,
      description: v.description || "",
      url:
        v.url ||
        (v.videoId ? `https://youtube.com/watch?v=${v.videoId}` : undefined),
      publishDate: v.publishDate,
      views: v.views,
      views7: v.views7,
      views30: v.views30,
      views90: v.views90,
      retention: v.retention,
      ctr: v.ctr,
      performance: v.performance || {},
      channelTitle: v.channelTitle || v.customMetadata?.channelTitle,
      ...v.customMetadata,
    };
    if (useTimeDecay) {
      const { decayWeight, decayTier, ageDays } = computeDecay(
        v.publishDate,
        Number(v.views) || 0,
        maxViews,
      );
      row.decayWeight = decayWeight;
      row.decayTier = decayTier;
      row.ageDays = ageDays;
    }
    return row;
  });
  if (useTimeDecay) {
    rows.sort((a, b) => b.decayWeight - a.decayWeight);
  }
  return rows;
}

/**
 * Per-video insight rows echoed back in the response so the UI can render the
 * "included videos & data" table (works for both live runs and saved history).
 * When time-decay is OFF rows carry no decay fields and the UI hides the
 * Time-Decay column.
 */
function buildVideoInsights(videos = [], useTimeDecay = false) {
  const maxViews = Math.max(0, ...videos.map((v) => Number(v.views) || 0));
  const rows = videos.map((v) => {
    const row = {
      videoId: v.videoId || v.id,
      title: v.title,
      url:
        v.url ||
        (v.videoId ? `https://youtube.com/watch?v=${v.videoId}` : undefined),
      channelTitle: v.channelTitle || v.customMetadata?.channelTitle || "",
      playlistId: v.originalPlaylistId || v.customMetadata?.originalPlaylistId || "",
      playlistTitle:
        typeof v.customMetadata?.originalPlaylistTitle === "string"
          ? v.customMetadata.originalPlaylistTitle
          : "",
      publishDate: v.publishDate || "",
      views: Number(v.views) || 0,
      views7: Number(v.views7) || 0,
      views30: Number(v.views30) || 0,
      views90: Number(v.views90) || 0,
    };
    if (useTimeDecay) {
      const { decayWeight, decayTier, ageDays } = computeDecay(
        v.publishDate,
        Number(v.views) || 0,
        maxViews,
      );
      row.decayWeight = decayWeight;
      row.decayTier = decayTier;
      row.ageDays = ageDays;
    }
    return row;
  });
  if (useTimeDecay) {
    rows.sort((a, b) => b.decayWeight - a.decayWeight);
  }
  return rows;
}

/**
 * What data was used for this analysis (channel, mode, range, playlists,
 * filters) so the UI can show the analysis scope alongside the results.
 */
function buildAnalysisMeta(videos = [], channelIdentifier = "", filterConfig = {}) {
  const playlists = new Map();
  for (const v of videos) {
    const plId = v.originalPlaylistId || v.customMetadata?.originalPlaylistId;
    if (!plId) continue;
    const plTitle =
      typeof v.customMetadata?.originalPlaylistTitle === "string"
        ? v.customMetadata.originalPlaylistTitle
        : plId;
    if (!playlists.has(plId)) {
      playlists.set(plId, { playlistId: plId, title: plTitle || plId, videoCount: 0 });
    }
    playlists.get(plId).videoCount += 1;
  }
  return {
    channelIdentifier: channelIdentifier || "",
    mode: filterConfig?.analysisMode || "NEW",
    dataRange: filterConfig?.dataRange || "all",
    videoCount: videos.length,
    playlistsIncluded: [...playlists.values()],
    filters: {
      excludeKeywords: filterConfig?.excludeKeywords || "",
      maxPlaylists: filterConfig?.maxPlaylists || 0,
      minPlaylists: filterConfig?.minPlaylists || 0,
      minVideosPerPlaylist: filterConfig?.minVideosPerPlaylist || 0,
      maxVideosPerPlaylist: filterConfig?.maxVideosPerPlaylist || 0,
      maxPlaylistsPerVideo: filterConfig?.maxPlaylistsPerVideo || 0,
      onlyOptimized: !!filterConfig?.onlyOptimized,
      useTimeDecay: !!filterConfig?.useTimeDecay,
      enableTargetPlaylist: !!filterConfig?.enableTargetPlaylist,
      targetName: filterConfig?.targetName || "",
      targetCriteria: filterConfig?.targetCriteria || "",
    },
  };
}

/**
 * Lowercased id/videoId -> full input video row. Used to validate and enrich
 * whatever membership the model echoed back.
 */
function buildVideoLookup(videos = []) {
  const lookup = new Map();
  for (const v of videos || []) {
    const byVideoId = String(v.videoId || "").trim().toLowerCase();
    const byId = String(v.id || "").trim().toLowerCase();
    if (byVideoId) lookup.set(byVideoId, v);
    if (byId) lookup.set(byId, v);
  }
  return lookup;
}

/**
 * Group EXISTING-mode input rows by their source playlist (originalPlaylistId
 * + current title) so a returned playlist whose videos[] were omitted or cut
 * off by the model can be backfilled deterministically from the input alone,
 * without a second LLM call.
 */
function buildSourcePlaylistGroups(videos = []) {
  const groups = new Map();
  for (const v of videos || []) {
    const plId = String(
      v.originalPlaylistId || v.customMetadata?.originalPlaylistId || "",
    ).trim();
    if (!plId) continue;
    const key = plId.toLowerCase();
    let g = groups.get(key);
    if (!g) {
      g = { playlistId: plId, videos: [], titleKeys: new Set(), description: "", tags: [] };
      groups.set(key, g);
    }
    g.videos.push(v);
    const t = v.customMetadata?.originalPlaylistTitle;
    if (typeof t === "string" && t.trim()) {
      g.titleKeys.add(t.trim().toLowerCase());
    }
    const d = v.customMetadata?.originalPlaylistDescription;
    if (typeof d === "string" && d.trim()) {
      g.description = d;
    }
    const rawTags = v.customMetadata?.originalPlaylistTags;
    if (Array.isArray(rawTags)) {
      for (const tag of rawTags) {
        const s = String(tag || "").trim();
        if (s && !g.tags.includes(s)) g.tags.push(s);
      }
    } else if (typeof rawTags === "string" && rawTags.trim()) {
      for (const tag of rawTags.split(",")) {
        const s = tag.trim();
        if (s && !g.tags.includes(s)) g.tags.push(s);
      }
    }
  }
  return groups;
}

/**
 * Resolve echoed video stubs ({id?, videoId?, title}) to their FULL input
 * rows, preserving echo order and de-duplicating within one playlist (a
 * video may legitimately belong to several playlists). Unknown ids are
 * dropped rather than rendered as broken entries.
 */
function resolveEchoedVideos(stubs, lookup) {
  const resolved = [];
  const seen = new Set();
  for (const s of Array.isArray(stubs) ? stubs : []) {
    // Accept both object stubs ({id?, videoId?, title}) and bare id strings.
    const key =
      typeof s === "string"
        ? s.trim().toLowerCase()
        : String(s?.videoId || s?.id || "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const hit = lookup.get(key);
    if (hit) resolved.push(hit);
  }
  return { resolved };
}

// Generic filler words ignored when inferring a niche from titles/descriptions.
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "for", "to", "of", "in", "on", "with",
  "from", "how", "why", "what", "when", "your", "you", "our", "this", "that",
  "is", "are", "be", "best", "top", "new", "most", "all", "make", "get", "like",
  "into", "their", "his", "her", "my", "by", "as", "at", "it", "its", "do",
  "does", "not", "no", "one", "two", "vs", "via",
]);

/**
 * Deterministic niche inference from video titles/descriptions. Used only when
 * the model omits primaryNiche, so the audit never shows a blank niche for
 * content that actually exists.
 */
function inferNiche(videos) {
  const counts = new Map();
  for (const v of videos) {
    const text = `${v.title || ""} ${v.description || ""}`.toLowerCase();
    const words = text.match(/[a-z0-9]{3,}/g) || [];
    for (const w of words) {
      if (STOPWORDS.has(w)) continue;
      counts.set(w, (counts.get(w) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([w]) => w)
    .join(", ");
}

/** Deterministic audience persona derived from video mix + niche. */
function inferPersona(videos, niche) {
  const total = Array.isArray(videos) ? videos.length : 0;
  if (!total) return "";
  const shorts = videos.filter((v) => v.Video_Type === "short").length;
  const base =
    shorts === total
      ? "Short-form viewers who prefer quick, scannable content"
      : shorts > 0
        ? "A mixed audience across long and short-form videos"
        : "Viewers who prefer in-depth, long-form content";
  return niche ? `${base}, interested in ${niche}` : base;
}

/**
 * All tags attached to one input video (top-level `tags` or
 * `customMetadata.tags` / `customMetadata.keywords`).
 */
function collectVideoTags(v) {
  const raw = Array.isArray(v?.tags)
    ? v.tags
    : Array.isArray(v?.customMetadata?.tags)
      ? v.customMetadata.tags
      : Array.isArray(v?.customMetadata?.keywords)
        ? v.customMetadata.keywords
        : [];
  return raw.map((t) => String(t || "").trim()).filter(Boolean);
}

/**
 * Playlist tag set, aggregated from member videos (YouTube has no native
 * playlist-tags field, so the union of member tags is the effective set).
 * Frequency-ranked, case-deduped, capped — sorted by relevance (usage across
 * your videos), NOT search volume: no volume source is integrated.
 */
function buildPlaylistTagPool(videos = [], limit = 40) {
  const freq = new Map();
  for (const v of Array.isArray(videos) ? videos : []) {
    for (const t of collectVideoTags(v)) {
      const key = t.toLowerCase();
      const hit = freq.get(key);
      if (hit) hit.count += 1;
      else freq.set(key, { tag: t, count: 1 });
    }
  }
  return [...freq.values()]
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, Math.max(1, limit))
    .map((e) => e.tag);
}

/**
 * Count timestamp markers (00:00 style) and hashtags in a text — deterministic,
 * so the model never has to eyeball them.
 */
function countTimestamps(text) {
  return (String(text || "").match(/(^|\s)\d{1,2}:\d{2}/g) || []).length;
}

function countHashtags(text) {
  return (String(text || "").match(/#[\w-]+/g) || []).length;
}

/**
 * Numbered-list footer check for playlist descriptions ("1. Video …" lines).
 * Returns { count } of numbered entries found.
 */
function countNumberedEntries(text) {
  return (String(text || "").match(/^\s*\d+[.)]\s+\S/gm) || []).length;
}

/**
 * Deterministic measurements over the input videos + (in EXISTING mode) the
 * current playlist metadata, injected into the prompt as MEASURED FACTS.
 * The LLM must treat these as ground truth and base scores/notes on them
 * instead of re-estimating lengths and counts (which caused praise-notes on
 * failing scores, e.g. a "700+ chars" note on a 412-char description).
 */
function buildMeasuredFacts(videos = [], filterConfig = {}) {
  const list = Array.isArray(videos) ? videos : [];
  const lines = [];
  lines.push(`Videos analyzed: ${list.length}`);
  if (list.length > 0) {
    const titleLens = list.map((v) => String(v.title || "").trim().length);
    const shortTitles = titleLens.filter((n) => n < 30).length;
    const descLens = list.map((v) => String(v.description || "").trim().length);
    const thinDescs = descLens.filter((n) => n < 40).length;
    const words = list.map((v) => (String(v.description || "").trim().match(/\S+/g) || []).length);
    const withChapters = list.filter((v) => countTimestamps(v.description) >= 3).length;
    const withHashtags = list.filter((v) => countHashtags(v.description) >= 1).length;
    const tagCounts = list.map((v) => collectVideoTags(v).length);
    const untagged = tagCounts.filter((n) => n === 0).length;
    const avg = (arr) => Math.round(arr.reduce((s, n) => s + n, 0) / (arr.length || 1));
    lines.push(`Video titles: avg length ${avg(titleLens)} chars, ${shortTitles}/${list.length} under 30 chars`);
    lines.push(`Video descriptions: avg length ${avg(descLens)} chars (${avg(words)} words), ${thinDescs}/${list.length} thin (<40 chars)`);
    lines.push(`Chapters (3+ timestamps): ${withChapters}/${list.length} videos; hashtags present: ${withHashtags}/${list.length} videos`);
    lines.push(`Tags: avg ${avg(tagCounts)} per video, ${untagged}/${list.length} videos with zero tags`);
  }
  if (filterConfig?.analysisMode === "EXISTING") {
    const groups = buildSourcePlaylistGroups(list);
    if (groups.size > 0) {
      lines.push(`Existing playlists (current state, measured): ${groups.size}`);
      for (const g of groups.values()) {
        const first = g.videos[0] || {};
        const curTitle = first.customMetadata?.originalPlaylistTitle || "";
        const curDesc = first.customMetadata?.originalPlaylistDescription || "";
        const curTags = first.customMetadata?.originalPlaylistTags;
        const titleLen = String(curTitle).trim().length;
        const descLen = String(curDesc).trim().length;
        const numbered = countNumberedEntries(curDesc);
        const tagCount = Array.isArray(curTags) ? curTags.length : 0;
        lines.push(
          `- "${curTitle || g.playlistId}": ${g.videos.length} videos | title ${titleLen} chars | description ${descLen} chars (needs 700+: ${descLen >= 700 ? "YES" : "NO"}) | numbered video list entries: ${numbered} (matches members: ${numbered === g.videos.length ? "YES" : "NO"}) | current tags: ${tagCount}`,
        );
      }
    }
  }
  return lines.join("\n");
}

/** Deterministic one-paragraph summary when the model returns none. */
function buildSummary(audit, playlists, videos, unassignedVideos) {
  const total = audit.totalVideosAnalyzed || (Array.isArray(videos) ? videos.length : 0);
  const score = audit.channelScore || 0;
  const health = audit.contentHealthScore || 0;
  const plCount = Array.isArray(playlists) ? playlists.length : 0;
  const unassigned = Array.isArray(unassignedVideos) ? unassignedVideos.length : 0;
  let s = `Analyzed ${total} video(s). The channel scores ${score}/100 for overall strategy with metadata health at ${health}/100.`;
  if (plCount > 0) s += ` ${plCount} optimized playlist(s) were recommended.`;
  if (unassigned > 0) s += ` ${unassigned} video(s) could not be grouped.`;
  return s;
}

/**
 * Normalize the audit object returned by the model. DeepSeek's json_object mode
 * does not enforce the nested schema, so scores can come back as strings, be
 * omitted, or collapse to 0. When a score is missing/zero we derive a
 * deterministic estimate from the video metadata so the audit never shows a
 * blank 0 for data that actually exists.
 */
function normalizeAudit(audit = {}, videos = [], focus = null) {
  const list = (v) =>
    Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) : [];

  const total = Array.isArray(videos) ? videos.length : 0;
  const withDescription =
    total > 0
      ? videos.filter((v) => (v.description || "").trim().length > 40).length
      : 0;
  const withMetadata =
    total > 0
      ? videos.filter(
          (v) =>
            v.customMetadata?.originalPlaylistTitle ||
            v.customMetadata?.keywords?.length ||
            v.tags?.length,
        ).length
      : 0;
  const contentHealthFallback =
    total > 0
      ? Math.round(withDescription / total * 60 + withMetadata / total * 40)
      : 0;

  const channelScore = toScore(audit.channelScore, 0);
  const contentHealthScore = toScore(audit.contentHealthScore, 0);

  // Fill niche/audience: owner-defined focus first, then the model output,
  // then video-data inference — so a saved focus always personalizes the audit.
  const focusNiche = String(focus?.niche || "").trim();
  const focusAudience = String(focus?.audience || "").trim();
  const primaryNiche = focusNiche || String(audit.primaryNiche || "").trim() || inferNiche(videos);
  const audiencePersona =
    focusAudience || String(audit.audiencePersona || "").trim() || inferPersona(videos, primaryNiche);

  return {
    ...audit,
    channelScore:
      channelScore > 0
        ? channelScore
        : Math.min(100, contentHealthFallback > 0 ? contentHealthFallback : 0),
    contentHealthScore:
      contentHealthScore > 0 ? contentHealthScore : contentHealthFallback,
    totalVideosAnalyzed: toScore(audit.totalVideosAnalyzed, total) || total,
    audiencePersona,
    primaryNiche,
    contentStrengths: list(audit.contentStrengths),
    contentWeaknesses: list(audit.contentWeaknesses),
    missedOpportunities: list(audit.missedOpportunities),
    metadataAnalysis: audit.metadataAnalysis || "",
    criteriaBreakdown: normalizeCriteriaBreakdown(audit.criteriaBreakdown),
  };
}

/**
 * Sanitize the per-criterion breakdown returned by the model: clamp scores to
 * 0-100 and drop entries without a usable label/score.
 */
function normalizeCriteriaBreakdown(breakdown) {
  if (!Array.isArray(breakdown)) return undefined;
  const cleaned = breakdown
    .map((c) => ({
      criterion: String(c?.criterion || "").trim(),
      score: Math.max(0, Math.min(100, Math.round(Number(c?.score) || 0))),
      note: String(c?.note || "").trim(),
    }))
    .filter((c) => c.criterion);
  return cleaned.length > 0 ? cleaned : undefined;
}

function createPlaylistOptimizerService(deps) {
  const {
    axios,
    serverCache,
    shortHash,
    PERF_LOG_ENABLED,
    perfLog,
    perfNow,
    getOptimizerCriteria,
  } = deps;

  const API_KEY = process.env.DEEPSEEK_API_KEY;

  if (!API_KEY) {
    console.warn(
      "[PlaylistOptimizer] DEEPSEEK_API_KEY not set -- playlist analysis will fail at runtime.",
    );
  }

  /**
   * Load admin-configured playlist scoring criteria (falls back to defaults
   * inside the config module when Firestore is unavailable).
   */
  async function loadPlaylistCriteria() {
    if (typeof getOptimizerCriteria !== "function") return null;
    try {
      const cfg = await getOptimizerCriteria();
      return Array.isArray(cfg?.playlist) && cfg.playlist.length > 0 ? cfg.playlist : null;
    } catch {
      return null;
    }
  }

  /**
   * Build the admin-configurable scoring criteria section for the system
   * instruction. The model scores each criterion 0-100 and reports the
   * breakdown in audit.criteriaBreakdown.
   */
  function buildCriteriaSection(criteria) {
    const lines = criteria
      .map((c) => `- ${c.label} (weight ${c.weight}): ${c.instruction}`)
      .join("\n");
    return `
SCORING CRITERIA (admin-defined):
${lines}

In the audit object, include a 'criteriaBreakdown' array with EXACTLY one entry per criterion above:
- 'criterion': the exact criterion label
- 'score': your evaluation of the channel's playlist strategy on this criterion, 0-100
- 'note': a one-sentence, data-backed evaluation for this criterion`;
  }

  /**
   * Build the structured system instruction sent to DeepSeek.
   */
  function buildSystemInstruction(criteria) {
    const criteriaSection = buildCriteriaSection(criteria);
    return `You are a world-class YouTube Strategist and SEO Expert.
Your goal is to analyze a list of videos and group them into highly engaging, binge-worthy playlists.

OBJECTIVES:
1. Deep Thematic Analysis: Go beyond surface-level keywords. Infer the visual style, spoken language tone, and topic depth. Group videos that share a "vibe" or logical progression.
2. Hybrid Knowledge Application: Combine the provided video metadata with your own knowledge about these topics, creators, or general YouTube trends.
3. Create logical playlists.
4. For each playlist, generate:
   - A CTR-optimized Title (Catchy, Viral, Curious).
   - An SEO-optimized Description that is at least 700 characters long.
   - A list of at least 15 Keywords relevant to the playlist topic, sorted by relevance (most on-topic first). No search-volume source is integrated, so do NOT claim or imply volume ordering.
   - A list of at least 15 Tags sorted by relevance, preferring tags from the CHANNEL TAG POOL below (those are the tags the channel's own videos already use).
   - The COMPLETE "videos" array: EVERY member video as its exact input row 'id' GUID string ONLY. Never omit, truncate, or summarize membership.
   - A Reasoning section with detailed strategy explanation.
   - A "Why" section explaining why this playlist exists.
   - A Virality Score (0-100).
   - A Predicted Reach (High, Medium, Low, Niche).
   - An Engagement Prediction.

5. Best Practices: Follow the YouTube Creator Playbook and Google Search Central best practices.
6. Return result STRICTLY as a JSON object matching the requested schema.
${criteriaSection}`;
  }

  /**
   * Build the user prompt from video data and filter config.
   */
  function buildPrompt(videos, channelIdentifier, filterConfig, focus = null) {
    const isOptimizationMode = filterConfig?.analysisMode === "EXISTING";
    const useTimeDecay = !!filterConfig?.useTimeDecay;
    // Time-decay is opt-in. When ON, decorate each video with its computed
    // weight and sort newest/highest performers first so the model reads the
    // most important videos first. When OFF, videos pass through unchanged.
    const enrichedVideos = enrichVideosForPrompt(videos, useTimeDecay);
    const videoDataStr =
      enrichedVideos.length > 0
        ? JSON.stringify(enrichedVideos)
        : "NO SPECIFIC VIDEOS PROVIDED. Please analyze based on channel context.";

    // Effective tag pool aggregated from the input videos' own tags (YouTube
    // has no native playlist-tags field). Frequency-ranked by usage, NOT by
    // search volume — no volume source is integrated, so volume ordering is
    // never claimed anywhere in this prompt.
    const channelTagPool = buildPlaylistTagPool(videos, 40);
    const channelTagPoolStr =
      channelTagPool.length > 0
        ? channelTagPool.join(", ")
        : "(no tags found on the input videos)";

    // Deterministic measurements (lengths, counts, list presence) computed by
    // code — the model must treat them as ground truth, never re-estimate.
    const measuredFactsStr = buildMeasuredFacts(videos, filterConfig);

    // Build mode-specific instructions
    let modeInstructions = "";
    if (isOptimizationMode) {
      modeInstructions = `
OPTIMIZATION MODE:
- You are optimizing EXISTING playlists found on the channel. Group the input videos by 'originalPlaylistId' to identify each existing playlist.
- Each video carries its source playlist's current metadata via these fields: 'originalPlaylistTitle', 'originalPlaylistDescription', 'originalPlaylistTags', 'originalPlaylistVideoCount'. Treat these as the playlist's CURRENT state.
- For every existing playlist, optimize its actual title, description, and tags based on that current metadata and the videos it contains.
- Provide an improved title, description, keywords, and tags for each playlist.
- Set 'currentTitle' to the playlist's existing title (from 'originalPlaylistTitle') to document the before state.
- Include 'currentDescription' (the existing description from 'originalPlaylistDescription') and 'currentTags' (from 'originalPlaylistTags') so the before-state is fully documented alongside the before title and the after state.
- Identify leftover videos that don't fit existing playlists and create "New Opportunity" playlists for them.
- For NEW opportunity playlists, do NOT set 'currentTitle' or 'currentUrl'.
- EVERY playlist you output -- whether an optimized existing playlist or a New Opportunity playlist -- MUST include a complete 'title' (string) and 'description' (string, >=700 characters), plus 'keywords' (>=15) and 'tags' (>=15). Do NOT leave the title or description empty or placeholder on any playlist.`;
    } else {
      modeInstructions = `
NEW MODE:
- Create fresh playlist recommendations from scratch.
- Do NOT set 'currentTitle' or 'currentUrl' fields.
- Group videos thematically into optimized playlists.`;
    }

    // Constraint instructions
    let constraintInstructions = "";
    if (filterConfig) {
      const parts = [];
      if (filterConfig.maxPlaylists > 0)
        parts.push(
          `Maximum total playlists: ${filterConfig.maxPlaylists}. You MUST NOT create more than this.`,
        );
      if (filterConfig.minPlaylists > 0)
        parts.push(
          `Minimum total playlists: ${filterConfig.minPlaylists}. You MUST create at least this many.`,
        );
      if (filterConfig.minVideosPerPlaylist > 0)
        parts.push(
          `Minimum videos per playlist: ${filterConfig.minVideosPerPlaylist}.`,
        );
      if (filterConfig.maxVideosPerPlaylist > 0)
        parts.push(
          `Maximum videos per playlist: ${filterConfig.maxVideosPerPlaylist}.`,
        );
      if (filterConfig.maxPlaylistsPerVideo > 0)
        parts.push(
          `A single video MUST NOT be in more than ${filterConfig.maxPlaylistsPerVideo} playlist(s).`,
        );
      if (filterConfig.onlyOptimized)
        parts.push(
          'ONLY OPTIMIZED MODE: Do NOT create any "New Opportunity" playlists. Assign ALL videos to existing/target playlists.',
        );
      if (filterConfig.excludeKeywords)
        parts.push(
          `Exclude videos whose title or description contains: ${filterConfig.excludeKeywords}`,
        );
      if (filterConfig.includeTypes?.length > 0) {
        parts.push(
          `Only include these video types: ${filterConfig.includeTypes.join(", ")}`,
        );
      }
      constraintInstructions = parts.join("\n");
    }

    // Target playlist strategy
    let targetInstructions = "";
    if (filterConfig?.enableTargetPlaylist) {
      if (
        filterConfig.bulkTargetPlaylists?.length > 0
      ) {
        targetInstructions = filterConfig.bulkTargetPlaylists
          .map(
            (t, i) => `
TARGET PLAYLIST #${i + 1}: "${t.targetName}"
- Topic: "${t.targetTopic}"
- Criteria: "${t.targetCriteria}"
- Goal: "${t.targetGoal}"
- Audience: "${t.targetAudience}"
- Include: "${t.targetIncludeThemes}"
- Exclude: "${t.targetExcludeThemes}"
${t.maxVideos ? `- Max videos: ${t.maxVideos}` : ""}
${t.minVideos ? `- Min videos: ${t.minVideos}` : ""}`,
          )
          .join("\n");
      } else {
        targetInstructions = `
TARGET PLAYLIST:
- Name: "${filterConfig.targetName}"
- Topic: "${filterConfig.targetTopic}"
- Criteria: "${filterConfig.targetCriteria}"
- Goal: "${filterConfig.targetGoal}"
- Audience: "${filterConfig.targetAudience}"
- Include: "${filterConfig.targetIncludeThemes}"
- Exclude: "${filterConfig.targetExcludeThemes}"`;
      }
    }

    const dataRange = filterConfig?.dataRange || "all";
    const rangeNote =
      dataRange === "all"
        ? "Evaluate each video using ALL-TIME performance (full lifetime views, retention, engagement)."
        : `Evaluate each video using ONLY performance from the last ${
            dataRange === "7d" ? 7 : dataRange === "30d" ? 30 : 90
          } days (views, retention, engagement in that window).`;

    const decayInstruction = useTimeDecay
      ? "7. TIME-DECAY WEIGHTING (enforced): Every video carries a computed 'decayWeight' (0..1) and 'decayTier' (High/Medium/Low/Minimal). Newer videos and videos that perform well get higher weights, and the VIDEO INPUT is already sorted by decayWeight (highest first). Weight each video's influence on engagement ratings, performance predictions, and grouping decisions proportionally to its decayWeight: High-tier videos are the strongest signals of the channel's current direction and should drive recommendations; Low/Minimal-tier videos are legacy content and should contribute less. Never penalize an older video for having a lower all-time view count than a newer one, since views accumulate with age."
      : "7. WEIGHTING: Treat all videos equally regardless of publish date or age. Do NOT weight newer videos higher or older videos lower; consider each video's own data on its merits.";

    const { buildFocusContextBlock } = require("./channelFocusService");
    const focusBlock = buildFocusContextBlock(focus);

    return `
CHANNEL CONTEXT:
Channel Identifier: ${channelIdentifier || "Unknown"}
Mode: ${isOptimizationMode ? "EXISTING (Optimization)" : "NEW"}
Data Range: ${dataRange}
${focusBlock ? `${focusBlock}\nPrefer this owner-defined context over inference when grouping videos and writing titles/descriptions.\n` : ""}
${rangeNote}

${modeInstructions}

${constraintInstructions ? `CONSTRAINTS:\n${constraintInstructions}\n` : ""}

${targetInstructions ? `TARGET PLAYLIST STRATEGY:\n${targetInstructions}\n` : ""}

VIDEO INPUT:
${videoDataStr}

CHANNEL TAG POOL (real tags pooled from the input videos above, most-used first):
${channelTagPoolStr}

MEASURED FACTS (computed by code — ground truth, do NOT recount or re-estimate):
${measuredFactsStr}

CRITICAL INSTRUCTIONS:
1. You MUST account for EVERY video provided. Every video must be in a playlist or in unassignedVideos.
2. Each playlist's 'videos' array contains ONLY the exact internal 'id' (GUID) strings from the input rows -- never objects, never titles, never 'videoId' values.
3. Membership must be complete: EVERY input video id appears in a playlist's 'videos' array or in 'unassignedVideos'. Never drop or truncate an ids array.
4. Do NOT output markdown code blocks. Return pure JSON only.
5. If 'description' field must be >700 chars, end with a numbered list of included videos.
6. Keywords and tags must each have at least 15 entries.
8. MEASURED FACTS above are ground truth: base every criterion score and note on them. Never re-estimate a length, count, or list presence the facts already state (e.g. do not praise a description as 700+ chars when the facts say it is shorter).
${decayInstruction}
`;
  }

  /**
   * Build the JSON schema for DeepSeek's structured output.
   */
  function buildResponseSchema() {
    return {
      type: "json_object",
      schema: {
        type: "object",
        properties: {
          channelName: { type: "string" },
          audit: {
            type: "object",
            properties: {
              channelScore: {
                type: "number",
                description: "Overall Strategy Score (0-100)",
              },
              contentHealthScore: {
                type: "number",
                description: "Metadata Health Score (0-100)",
              },
              audiencePersona: { type: "string" },
              primaryNiche: { type: "string" },
              contentStrengths: {
                type: "array",
                items: { type: "string" },
              },
              contentWeaknesses: {
                type: "array",
                items: { type: "string" },
              },
              missedOpportunities: {
                type: "array",
                items: { type: "string" },
              },
              metadataAnalysis: { type: "string" },
              criteriaBreakdown: {
                type: "array",
                description:
                  "One entry per admin-defined scoring criterion (exact label, 0-100 score, one-sentence note).",
                items: {
                  type: "object",
                  properties: {
                    criterion: { type: "string" },
                    score: { type: "number" },
                    note: { type: "string" },
                  },
                  required: ["criterion", "score"],
                },
              },
              totalVideosAnalyzed: { type: "number" },
              existingPlaylists: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    playlistId: { type: "string" },
                    title: { type: "string" },
                    url: { type: "string" },
                    videoCount: { type: "number" },
                    views: { type: "string" },
                    engagementScore: { type: "number" },
                    videos: {
                      type: "array",
                      description: "Member input-row 'id' GUID strings only",
                      items: { type: "string" },
                    },
                  },
                  required: ["playlistId", "title"],
                },
              },
            },
            required: [
              "channelScore",
              "contentHealthScore",
              "audiencePersona",
              "primaryNiche",
              "contentStrengths",
              "contentWeaknesses",
              "missedOpportunities",
              "metadataAnalysis",
              "totalVideosAnalyzed",
            ],
          },
          unassignedVideos: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                videoId: { type: "string" },
                title: { type: "string" },
                reason: { type: "string" },
              },
              required: ["id", "videoId", "title"],
            },
          },
          summary: { type: "string" },
          playlists: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                title: { type: "string" },
                description: { type: "string" },
                keywords: {
                  type: "array",
                  items: { type: "string" },
                },
                tags: {
                  type: "array",
                  items: { type: "string" },
                },
                reasoning: { type: "string" },
                why: { type: "string" },
                viralityScore: { type: "number" },
                predictedReach: {
                  type: "string",
                  enum: ["High", "Medium", "Low", "Niche"],
                },
                currentViralityScore: { type: "number" },
                currentPredictedReach: {
                  type: "string",
                  enum: ["High", "Medium", "Low", "Niche"],
                },
                currentTitle: { type: "string" },
                currentDescription: { type: "string" },
                currentTags: { type: "array", items: { type: "string" } },
                currentUrl: { type: "string" },
                currentPlaylistViews: { type: "string" },
                isCombined: { type: "boolean" },
                parentPlaylistId: { type: "string" },
                topic: { type: "string" },
                criteria: { type: "string" },
                goal: { type: "string" },
                audience: { type: "string" },
                includeThemes: { type: "string" },
                excludeThemes: { type: "string" },
                engagementPrediction: { type: "string" },
                videos: {
                  type: "array",
                  description:
                    "COMPLETE member list: input-row 'id' GUID strings ONLY. Never omit or truncate.",
                  items: { type: "string" },
                },
              },
              required: [
                "id",
                "title",
                "description",
                "keywords",
                "tags",
                "reasoning",
                "why",
                "videos",
                "viralityScore",
                "predictedReach",
                "engagementPrediction",
              ],
            },
          },
        },
        required: ["playlists", "summary", "audit"],
      },
    };
  }

  /**
   * Call the DeepSeek Chat API with a structured prompt.
   */
  async function callDeepSeek(systemInstruction, prompt) {
    return retryWithBackoff(async () => {
      const response = await axios.post(
        `${DEEPSEEK_API_BASE}/chat/completions`,
        {
          model: DEEPSEEK_MODEL,
          messages: [
            { role: "system", content: systemInstruction },
            { role: "user", content: prompt },
          ],
          response_format: buildResponseSchema(),
          temperature: 0.7,
          max_tokens: 16384,
        },
        {
          headers: {
            Authorization: `Bearer ${API_KEY}`,
            "Content-Type": "application/json",
          },
          timeout: 120000,
        },
      );

      return response.data;
    });
  }

  /**
   * Validate and clean the DeepSeek response.
   */
  function parseResponse(data, videos = [], useTimeDecay = false, focus = null) {
    const text =
      data?.choices?.[0]?.message?.content || "{}";

    // Clean markdown code blocks if present
    let cleanText = text.trim();
    if (cleanText.startsWith("```")) {
      cleanText = cleanText.replace(/^```(json)?\n?/, "").replace(/\n?```$/, "");
    }

    // The LLM occasionally returns truncated/unterminated JSON (hit max_tokens
    // or a network cut). A hard throw here would crash every caller, including
    // the audit orchestrator (which runs playlist analyze as one of 4 parallel
    // sub-audits). Degrade gracefully: try a last-brace repair, then fall back
    // to a safe empty structure so the rest of the pipeline survives.
    let parsed;
    try {
      parsed = JSON.parse(cleanText);
    } catch {
      const lastBrace = cleanText.lastIndexOf("}");
      try {
        parsed = JSON.parse(cleanText.slice(0, lastBrace + 1));
      } catch {
        parsed = { playlists: [], audit: {} };
      }
    }

    // Validate required top-level fields
    if (!parsed.playlists) parsed.playlists = [];
    parsed.audit = normalizeAudit(parsed.audit || {}, videos, focus);
    // Generate a real summary when the model omits or stubs it.
    const rawSummary =
      typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    parsed.summary =
      rawSummary.length >= 10
        ? rawSummary
        : buildSummary(
            parsed.audit,
            parsed.playlists,
            videos,
            parsed.unassignedVideos,
          );

    // Ensure every playlist has a unique ID and normalize per-playlist scores
    if (Array.isArray(parsed.playlists)) {
      const idCounts = new Map();
      for (let i = 0; i < parsed.playlists.length; i++) {
        const pl = parsed.playlists[i];
        const rawId = pl.id || "";
        if (!rawId || idCounts.has(rawId)) {
          // Assign a deterministic unique ID
          pl.id = `pl-${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 6)}`;
        }
        idCounts.set(rawId, true);

        pl.viralityScore = toScore(pl.viralityScore, 0);
        if (pl.currentViralityScore != null)
          pl.currentViralityScore = toScore(pl.currentViralityScore, 0);
        if (!Array.isArray(pl.videos)) pl.videos = [];
        if (!Array.isArray(pl.keywords)) pl.keywords = [];
        if (!Array.isArray(pl.tags)) pl.tags = [];
        // Guard against a blank title/description from the model: a playlist
        // that has no name or body is unusable in the UI. Fall back to the
        // before-state title (EXISTING mode) or a safe default so the card
        // always shows something.
        if (!String(pl.title || "").trim()) {
          pl.title = pl.currentTitle || `Optimized Playlist ${i + 1}`;
        }
        if (!String(pl.description || "").trim()) {
          pl.description = pl.currentTitle
            ? `Optimized playlist based on "${pl.currentTitle}".`
            : `A curated playlist of ${pl.videos.length} video(s).`;
        }
      }
    }

    // ── Deterministic video-membership repair ──────────────────────────────
    // DeepSeek's json_object mode does not enforce nested schemas (see the
    // normalizeAudit note), so playlists can come back with an EMPTY or
    // mid-array-truncated videos[] even though the model assigned them
    // content -- the UI would then show "0 videos". Never trust the echo
    // alone: resolve every echoed member to its full input row, then
    // backfill still-empty playlists from the input's original grouping
    // (EXISTING mode carries originalPlaylistId/current title on every
    // source video, so that mapping is always recoverable locally).
    const lookup = buildVideoLookup(videos);
    if (lookup.size > 0 && Array.isArray(parsed.playlists)) {
      const groups = buildSourcePlaylistGroups(videos);
      const norm = (s) => String(s || "").trim().toLowerCase();
      for (const pl of parsed.playlists) {
        const { resolved } = resolveEchoedVideos(pl.videos, lookup);
        let members = resolved;
        if (members.length === 0 && groups.size > 0) {
          const byParent = groups.get(norm(pl.parentPlaylistId));
          const cur = norm(pl.currentTitle || pl.title);
          const byTitle =
            !byParent && cur
              ? [...groups.values()].find((g) => g.titleKeys.has(cur))
              : null;
          const group = byParent || byTitle;
          if (group) {
            members = group.videos;
            // Deterministic before-state backfill: guarantee the diff UI always
            // has the source playlist's real title/description/tags even when
            // the model omitted them (the originals are carried on every video).
            if (!String(pl.currentTitle || "").trim()) {
              pl.currentTitle = [...(group.titleKeys || [])][0] || group.playlistId;
            }
            if (!String(pl.currentDescription || "").trim()) {
              pl.currentDescription = group.description || "";
            }
            if (!Array.isArray(pl.currentTags) || pl.currentTags.length === 0) {
              if (group.tags.length > 0) pl.currentTags = [...group.tags];
            }
          }
        }
        pl.videos = members;
        // Effective playlist tag set: union of member videos' own tags,
        // frequency-ranked (YouTube has no native playlist-tags field).
        pl.effectiveTags = buildPlaylistTagPool(members, 30);
      }
      if (Array.isArray(parsed.unassignedVideos)) {
        const seenUa = new Set();
        parsed.unassignedVideos = parsed.unassignedVideos.flatMap((u) => {
          const key = norm(u?.videoId || u?.id);
          if (!key || seenUa.has(key)) return [];
          seenUa.add(key);
          const hit = lookup.get(key);
          return [hit ? { ...hit, reason: u.reason } : u];
        });
      }
    }

    // Echo per-video insights (decay weight, views, playlist, channel) so the
    // UI can render the included-videos table from the saved result alone.
    parsed.videoInsights = buildVideoInsights(videos, useTimeDecay);

    return parsed;
  }

  /**
   * Analyze videos and return playlist optimization results.
   *
   * @param {Array}  videos            - Array of video objects.
   * @param {string} [channelIdentifier] - Channel handle or URL.
   * @param {Object} [filterConfig]    - Filter/configuration options.
   * @param {Object} [focus]           - Saved Channel Focus row (owner-defined
   *   niche/audience); grounds the prompt and wins over inference.
   * @returns {Promise<{results: Object, errors?: Array}>}
   */
  async function analyze(videos, channelIdentifier, filterConfig, focus = null) {
    const t0 = PERF_LOG_ENABLED ? perfNow() : 0;

    // Build cache key from all inputs. Publish date + views feed the time-decay
    // weighting, so they are part of the hash too (same video IDs with richer
    // data must produce a fresh analysis, not a stale cached one).
    const videoHash = shortHash(
      JSON.stringify(
        (videos || [])
          .slice(0, DEFAULT_MAX_VIDEOS)
          .map((v) => ({
            id: v.id,
            videoId: v.videoId,
            title: v.title,
            publishDate: v.publishDate,
            views: v.views,
          })),
      ),
    );
    const configHash = shortHash(JSON.stringify(filterConfig || {}));
    // v5: admin-configurable scoring criteria injected into the prompt --
    // results from v4 used the old hardcoded criteria and must not be served.
    // v6: channel tag pool + relevance-based (not volume-based) keyword/tag
    // instructions -- v5 prompts claimed search-volume ordering with no source.
    // v7: deterministic MEASURED FACTS block grounds scores/notes in real
    // lengths and counts so the model stops praising failing criteria.
    // v8: owner-defined Channel Focus grounds the prompt -- focus-bearing
    // results must not be served from pre-focus cache entries (or vice versa).
    const focusHash = shortHash(JSON.stringify({
      niche: focus?.niche || "",
      audience: focus?.audience || "",
      pillars: Array.isArray(focus?.contentPillars) ? focus.contentPillars : [],
    }));
    const cacheKey = `playlist:optimize:v8:${videoHash}:${configHash}:${shortHash(channelIdentifier || "")}:${focusHash}`;

    // Try cache first
    const cached = await serverCache.get(cacheKey);
    if (cached) {
      if (PERF_LOG_ENABLED) {
        perfLog(
          `[PlaylistOptimizer] Cache hit for ${videos.length} video(s)`,
          t0,
        );
      }
      return cached;
    }

    const useTimeDecay = !!filterConfig?.useTimeDecay;
    const playlistCriteria =
      (await loadPlaylistCriteria()) || DEFAULT_OPTIMIZER_CRITERIA.playlist;
    const systemInstruction = buildSystemInstruction(playlistCriteria);
    const prompt = buildPrompt(videos || [], channelIdentifier, filterConfig, focus);

    try {
      const response = await callDeepSeek(systemInstruction, prompt);
      const result = parseResponse(response, videos || [], useTimeDecay, focus);

      // Attach the analysis scope (what data was used) for the UI details panel.
      result.analysisMeta = buildAnalysisMeta(
        videos || [],
        channelIdentifier,
        filterConfig,
      );

      const payload = { results: result };

      // Cache for 24 hours
      await serverCache.set(cacheKey, payload, 24 * 60 * 60 * 1000);

      if (PERF_LOG_ENABLED) {
        perfLog(
          `[PlaylistOptimizer] Analyzed ${videos.length} video(s) via DeepSeek`,
          t0,
        );
      }

      return payload;
    } catch (error) {
      // Wrap and re-throw with context
      const status = error?.response?.status || error?.status || 0;
      const msg = error?.message || "";

      if (status === 401 || msg.includes("API key") || msg.includes("auth") || msg.includes("unauthorized")) {
        throw Object.assign(new Error("DeepSeek API authentication failed. Check DEEPSEEK_API_KEY."), {
          statusCode: 503,
          code: "DEEPSEEK_AUTH_ERROR",
        });
      }

      if (status === 429 || msg.includes("429") || msg.includes("rate_limit")) {
        throw Object.assign(new Error("DeepSeek API rate limit exceeded. Try again later."), {
          statusCode: 429,
          code: "DEEPSEEK_RATE_LIMITED",
        });
      }

      throw error;
    }
  }

  return { analyze };
}

module.exports = {
  createPlaylistOptimizerService,
  buildPlaylistTagPool,
  buildMeasuredFacts,
  countTimestamps,
  countHashtags,
  countNumberedEntries,
};

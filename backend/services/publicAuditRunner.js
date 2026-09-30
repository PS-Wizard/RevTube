// ── Public Audit Runner (shared sync + queue pipeline) ───────────────────────
// FULL audit of ANY public channel using ONLY YouTube Data API public endpoints
// (server API key, no OAuth, no ownership):
//   1. public fetch   -> services/publicAuditService (channel, videos, playlists)
//   2. video sub-audit -> the SAME engine + admin criteria as /video-audit
//   3. FULL audit      -> the SAME 4-category engine as the Full Audit
//      (channelAuditScoringService.scoreAll) fed with public data, plus its
//      ranked channel-wide issue list — so scores stay comparable to an owned
//      channel. Zero extra quota units: every input is already fetched.
// Reports persist to `public_audits` (JSONB) for the admin-only history.
//
// Used by both `routes/publicAudit.js` (synchronous POST /) and
// `queue/publicAuditQueue.js` (async BullMQ `public-audit` jobs) so the two
// paths can never drift apart.
const { getAuditCriteria } = require("../config/channelAuditCriteria");
const { createAuditScoringService } = require("./channelAuditScoringService");

// A FULL audit covers up to 1,000 videos = 20 `playlistItems` pages + 20
// `videos.list` calls, plus channel and playlist catalog requests.
const DEFAULT_MAX_VIDEOS = 50;
const HARD_MAX_VIDEOS = 1000;
const DEFAULT_PLAYLIST_LIMIT = 25;
const MAX_PLAYLIST_LIMIT = 1000;

// Caption-element criteria live under the `caption` element key (see
// optimizerCriteria DEFAULT_AUDIT_CRITERIA.video `caption_value`); the plural
// form is accepted too so a future criteria rename can't silently re-enable
// caption scoring on public data.
/**
 * Drop caption-element criteria unless captions were explicitly opted in.
 * Pure — unit-tested. Never throws on malformed criteria.
 *
 * @param {Array} criteria - video-audit criteria list
 * @param {boolean} includeCaptions - keep caption criteria when true
 * @returns {Array} the criteria the engine should score
 */
function filterCaptionCriteria(criteria = [], includeCaptions = false) {
  if (includeCaptions) return Array.isArray(criteria) ? criteria : [];
  if (!Array.isArray(criteria)) return [];
  return criteria.filter((c) => c?.element !== "caption" && c?.element !== "captions");
}

// Canonical Full Audit categories (labels/order mirror AuditCriteriaHelpButton).
const FULL_AUDIT_CATEGORIES = [
  { key: "channel", label: "Channel Identity" },
  { key: "video", label: "Video SEO" },
  { key: "playlist", label: "Playlist Flow" },
  { key: "general", label: "Publishing Trends & Engagement" },
];

/**
 * Run the Full Audit's four scoring categories over public data. Pure glue:
 * mapping lives in publicAuditService.buildFullAuditInput, scoring in
 * channelAuditScoringService. Never throws — a scoring failure degrades to
 * `null` so the video sub-audit result is still returned and persisted.
 */
async function scoreFullAudit({ publicAuditService, createScoring, getScoringCfg, channel, videos, playlists }) {
  try {
    const scoring = typeof createScoring === "function" ? createScoring() : null;
    if (!scoring || typeof scoring.scoreAll !== "function") return null;
    const cfg = typeof getScoringCfg === "function" ? await getScoringCfg() : undefined;
    const input = publicAuditService.buildFullAuditInput(channel, videos, playlists);
    const results = await scoring.scoreAll(input, cfg);
    const categories = FULL_AUDIT_CATEGORIES.map(({ key, label }) => {
      const breakdown = Array.isArray(results?.[key]?.breakdown) ? results[key].breakdown : [];
      return {
        key,
        label,
        score: Math.round(Number(results?.[key]?.total) || 0),
        max: breakdown.reduce((sum, b) => sum + (Number(b.max) || 0), 0),
        breakdown: breakdown.map((b) => ({ key: b.key, label: b.label, earned: b.earned, max: b.max })),
      };
    });
    return {
      overall: Math.round(categories.reduce((sum, c) => sum + c.score, 0) / categories.length),
      categories,
      issues: typeof scoring.buildAuditIssues === "function" ? scoring.buildAuditIssues(input) : [],
      // Per-item audits (same deterministic engine, zero extra quota — pure
      // math over already-fetched data): per-playlist scores + top fixes for
      // the Playlists tab table, per-field channel health for the Channel tab.
      // Per-video health is skipped here (each result row already carries the
      // richer LLM sub-audit). Null when the scoring service predates
      // rateHealth; old reports simply lack the field and the UI degrades to
      // aggregate-only.
      health: pickAuditHealth(scoring, input),
      scoredVideos: input.videos.length,
      source: "public-data",
    };
  } catch (err) {
    console.warn("[PublicAudit] full-audit scoring failed (non-fatal):", err.message);
    return null;
  }
}

/**
 * Per-item channel + playlist audits for the report, derived from the
 * deterministic engine's rateHealth over the already-built Full Audit input.
 * Returns `{ channel, playlists, general }` or null. Never throws.
 */
function pickAuditHealth(scoring, input) {
  try {
    if (!scoring || typeof scoring.rateHealth !== "function") return null;
    const h = scoring.rateHealth(input) || {};
    return {
      channel: h.channel ?? null,
      playlists: Array.isArray(h.playlists) ? h.playlists : [],
      general: Array.isArray(h.general) ? h.general : [],
    };
  } catch {
    return null;
  }
}

/**
 * Run the full public-audit pipeline and persist the report.
 *
 * @param {object} serviceDeps - { publicAuditService, videoAuditService, query, db, getAuditCriteria?, createAuditScoringService?, getAuditScoring? }
 * @param {object} opts - { channelInput, maxVideos?, includeAllPlaylists?, includeThumbnail?, includeCaptions?, createdBy?: { uid?, email? }, onProgress?: (pct: number) => void }
 * @returns {object} the full report response (same shape as POST /admin/public-audits)
 * @throws {Error} with `.status = 400` when the channel has no public videos
 */
async function runPublicAuditReport(serviceDeps, opts) {
  const {
    publicAuditService,
    videoAuditService,
    query,
    db,
  } = serviceDeps;
  const {
    channelInput,
    maxVideos,
    includeAllPlaylists,
    includeThumbnail,
    includeCaptions,
    createdBy,
    onProgress,
  } = opts || {};
  if (!channelInput || typeof channelInput !== "string" || !channelInput.trim()) {
    const err = new Error('"channelInput" (handle, ID, or URL) is required.');
    err.status = 400;
    throw err;
  }
  const progress = (pct) => {
    try { onProgress?.(pct); } catch { /* progress is best-effort */ }
  };
  const max = Math.max(1, Math.min(HARD_MAX_VIDEOS, Number(maxVideos) || DEFAULT_MAX_VIDEOS));
  const playlistLimit = includeAllPlaylists ? MAX_PLAYLIST_LIMIT : DEFAULT_PLAYLIST_LIMIT;

  // 1. Live YouTube API fetch (public endpoints only, ~4 quota units:
  // channels.list + playlistItems + videos.list + playlists.list).
  progress(10);
  const channel = await publicAuditService.resolvePublicChannel(channelInput.trim());
  progress(25);
  // Videos + playlists are independent once the channel is known -- fetch them
  // concurrently instead of two serial awaits. Each keeps its own fallback
  // (playlists stay [] on failure, videos throw only when entirely absent).
  const videosPromise = publicAuditService.fetchPublicVideos(channel, max).then((inputs) => {
    progress(45);
    return inputs;
  });
  const playlistsPromise = (async () => {
    try {
      const fetcher = publicAuditService.fetchPublicPlaylists;
      const lists = typeof fetcher === "function"
        ? await fetcher.call(publicAuditService, channel.channelId, playlistLimit)
        : [];
      progress(55);
      return lists;
    } catch (playlistErr) {
      console.warn("[PublicAudit] playlists fetch failed (non-fatal):", playlistErr.message);
      progress(55);
      return [];
    }
  })();
  const [inputs, playlists] = await Promise.all([videosPromise, playlistsPromise]);
  if (!inputs.length) {
    const err = new Error("No public videos found for this channel.");
    err.status = 400;
    throw err;
  }

  // 2. Same admin-managed criteria as the user-facing video audit.
  const cfg = (await (serviceDeps.getAuditCriteria || getAuditCriteria)(db)) || { video: [] };
  // Caption tracks are never fetched for public audits (no captions endpoint
  // in the pipeline yet), so caption-element criteria are excluded unless the
  // caller explicitly opts in — the `caption` element, its category weight,
  // and its fix recommendations stay out of results instead of scoring 0.
  const criteria = filterCaptionCriteria(
    Array.isArray(cfg.video) ? cfg.video : [],
    includeCaptions,
  );

  // 3. Shared video-audit engine (lite = no thumbnail vision calls unless asked).
  // The batch reports 0-100 percent; map it onto the 70-85 band so the job UI
  // advances per scored chunk instead of stalling at a flat 70.
  progress(70);
  const report = await videoAuditService.auditBatch(
    inputs,
    criteria,
    "",
    includeThumbnail ? "full" : "lite",
    (percent) => progress(70 + Math.round(((Number(percent) || 0) / 100) * 15)),
  );

  // The scorer returns scoring fields only (videoId/videoTitle/total/elements/
  // categories/...) — re-attach the public metadata `fetchPublicVideos`
  // already fetched (same `videos.list` snippet+statistics+contentDetails
  // connector the Extra Tools video pages use) so every result row carries its
  // published date, view/like/comment counts, and duration/definition for the
  // report UI, PDFs, and Excel export.
  const metaById = new Map((inputs || []).map((v) => [v?.videoId, v]));
  const results = (report?.results || []).map((r) => {
    const m = metaById.get(r?.videoId) || {};
    return {
      ...r,
      statistics: {
        viewCount: m.statistics?.viewCount ?? null,
        likeCount: m.statistics?.likeCount ?? null,
        commentCount: m.statistics?.commentCount ?? null,
        favoriteCount: m.statistics?.favoriteCount ?? null,
      },
      publishedAt: m.publishedAt ?? null,
      durationLabel: m.durationLabel || "",
      durationSeconds: m.durationSeconds ?? null,
      definition: m.definition || "",
      categoryId: m.categoryId || "",
      liveBroadcastContent: m.liveBroadcastContent || "",
    };
  });

  // 4. FULL audit — the same 4-category engine the Full Audit uses, fed with
  // public data (no extra quota units). Non-fatal: null when unavailable.
  progress(85);
  const fullAudit = await scoreFullAudit({
    publicAuditService,
    createScoring: () => (serviceDeps.createAuditScoringService || createAuditScoringService)({}),
    getScoringCfg: serviceDeps.getAuditScoring,
    channel,
    videos: inputs,
    playlists,
  });

  const videoAuditOverall = report?.overall ?? null;
  // Headline score = FULL audit (4 categories) so a public audit is directly
  // comparable to an owned-channel Full Audit; falls back to the video
  // sub-audit score when full-audit scoring was unavailable.
  const overall = fullAudit?.overall ?? videoAuditOverall;
  const channelLifetime = publicAuditService.computeChannelLifetime(inputs);
  const fullReport = {
    ...(report || {}),
    overall,
    videoAuditOverall,
    fullAudit,
    results,
    channelLifetime,
    playlists,
    playlistCount: playlists.length,
  };

  // 5. Persist for admin-only history.
  progress(95);
  const snapshot = {
    title: channel.title,
    description: (channel.description || "").slice(0, 1000),
    customUrl: channel.customUrl || "",
    handle: channel.handle || "",
    country: channel.country || "",
    channelPublishedAt: channel.publishedAt || null,
    avatarUrl: channel.avatarUrl || "",
    bannerUrl: channel.bannerUrl || "",
    channelKeywords: channel.keywords || "",
    topics: channel.topics || [],
    statistics: channel.statistics,
    auditedVideoIds: inputs.map((v) => v.videoId),
    includeThumbnail: !!includeThumbnail,
    includeCaptions: !!includeCaptions,
  };
  const out = await query(
    `INSERT INTO public_audits
       (channel_input, channel_id, channel_title, video_count, overall, snapshot, results, created_by_uid, created_by_email, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
     RETURNING id, created_at`,
    [
      channelInput.trim(),
      channel.channelId,
      channel.title,
      inputs.length,
      overall,
      JSON.stringify(snapshot),
      JSON.stringify(fullReport || {}),
      createdBy?.uid || null,
      createdBy?.email || null,
    ],
  );
  progress(100);
  return {
    id: out.rows[0]?.id,
    channelInput: channelInput.trim(),
    channelId: channel.channelId,
    channelTitle: channel.title,
    videoCount: inputs.length,
    overall,
    videoAuditOverall,
    fullAudit,
    auditedAt: fullReport?.auditedAt ?? null,
    snapshot,
    channelLifetime,
    playlists,
    playlistCount: playlists.length,
    results: fullReport?.results || [],
    createdByEmail: createdBy?.email || null,
    createdAt: out.rows[0]?.created_at,
  };
}

module.exports = {
  runPublicAuditReport,
  scoreFullAudit,
  filterCaptionCriteria,
  FULL_AUDIT_CATEGORIES,
  DEFAULT_MAX_VIDEOS,
  HARD_MAX_VIDEOS,
  DEFAULT_PLAYLIST_LIMIT,
  MAX_PLAYLIST_LIMIT,
};

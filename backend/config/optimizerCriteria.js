// ── Optimizer criteria config -- Firestore-backed, mirrors auditCriteria.js ──
// SINGLE SOURCE OF TRUTH for ALL audit criteria:
//   - thumbnail pillars (Thumbnail Optimizer + channel-audit video sub-audit)
//   - playlist scoring criteria (Playlist Optimizer + channel-audit playlist sub-audit)
//   - channel-identity / video / general scoring params (channel audit + video audit)
// Single Firestore doc = "config/optimizerCriteria", edited from one admin page.
let _cache = null;
let _cachedAt = 0;
const CACHE_TTL_MS = 10 * 60 * 1000;

const THUMBNAIL_TIERS = ["Red", "Yellow", "Grey"];

// Param section key <-> auditType mapping (channel audit + video audit params).
const PARAM_SECTIONS = {
  channelIdentity: "CHANNEL_IDENTITY",
  video: "VIDEO",
  general: "GENERAL",
};
const AUDIT_TYPE_TO_SECTION = Object.fromEntries(
  Object.entries(PARAM_SECTIONS).map(([section, type]) => [type, section]),
);

// The default 12-pillar thumbnail audit framework (mirrors the prompt that
// previously lived inline in thumbnailOptimizerService.js).
const DEFAULT_OPTIMIZER_CRITERIA = {
  thumbnail: [
    { key: "promise_lock", label: "Promise Lock", tier: "Red", weight: 10, instruction: "Truthful communication of core promise." },
    { key: "one_idea_rule", label: "One-Idea Rule", tier: "Red", weight: 10, instruction: "One dominant idea/message." },
    { key: "scroll_stop_contrast", label: "Scroll-Stop Contrast", tier: "Red", weight: 10, instruction: "Strong subject separation from background." },
    { key: "emotional_signal", label: "Emotional Signal", tier: "Red", weight: 10, instruction: "Clear emotional state/transformation." },
    { key: "thumb_magnet", label: "Thumb Magnet", tier: "Red", weight: 10, instruction: "Visual emphasis tools (arrows, framing)." },
    { key: "open_loop", label: "Open Loop", tier: "Red", weight: 10, instruction: "Deliberate withholding of context to compel click." },
    { key: "visual_flow", label: "Visual Flow", tier: "Yellow", weight: 7, instruction: "Cohesive colors, typography, and spacing." },
    { key: "glance_readability", label: "Glance Readability", tier: "Yellow", weight: 7, instruction: "Mobile-ready text size and contrast." },
    { key: "pattern_break", label: "Pattern Break", tier: "Yellow", weight: 7, instruction: "Deviation from generic niche styles." },
    { key: "execution_polish", label: "Execution Polish", tier: "Yellow", weight: 7, instruction: "Craftsmanship and intentional design." },
    { key: "word_economy", label: "Word Economy", tier: "Grey", weight: 5, instruction: "Text reduced to essential form (3-5 words)." },
    { key: "platform_compliance", label: "Platform Compliance", tier: "Grey", weight: 5, instruction: "Resolution, aspect ratio, and technical standards." },
  ],
  // Playlist Optimizer scoring criteria. The model evaluates the channel's
  // playlist strategy against each criterion (0-100) and reports a
  // criteriaBreakdown alongside the channel audit. Mirrors the scoring
  // dimensions of the original Playlist Optimizer prototype
  // (F:\JOBREV\RevTube-Playlist): CTR titles, 700+ char SEO descriptions
  // ending with a numbered "Videos in this Playlist:" list, 15+ volume-sorted
  // keywords, 15+ priority-sorted tags, binge ordering (YouTube Creator
  // Playbook: watch time + session time), thematic "vibe" grouping, metadata
  // health, virality potential (topic demand + clickability + predicted
  // reach), full video coverage (no orphaned/unassigned videos), and audience
  // persona / niche targeting.
  playlist: [
    { key: "title_ctr", label: "Title CTR Power", weight: 12, instruction: "Are playlist titles catchy, viral, and curiosity-driven (CTR-optimized per the YouTube Creator Playbook)?" },
    { key: "seo_description", label: "SEO Description Quality", weight: 20, instruction: "Is the description at least 700 characters, keyword-rich, search-optimized, and ending with a numbered 'Videos in this Playlist:' list?" },
    { key: "keywords", label: "Keyword Coverage", weight: 12, instruction: "At least 15 relevant keywords sorted by relevance to the playlist topic (most on-topic first)? No search-volume source is integrated, so judge relevance only." },
    { key: "tags", label: "Tag Priority", weight: 8, instruction: "At least 15 tags sorted by relevance, preferring tags the playlist's own videos already use (aggregated tag pool)?" },
    { key: "ordering_flow", label: "Binge Ordering & Flow", weight: 12, instruction: "Do videos progress logically to maximize session watch time (Creator Playbook / Google Search Central best practices)?" },
    { key: "theme_coherence", label: "Thematic Coherence", weight: 8, instruction: "Does each playlist share one vibe, visual style, or logical progression beyond surface keywords?" },
    { key: "metadata_health", label: "Metadata Health", weight: 8, instruction: "Are titles, descriptions, and tags consistent and complete across the playlist's videos?" },
    { key: "virality_potential", label: "Virality Potential", weight: 8, instruction: "Do the playlists target high-demand topics with strong clickability? Consider predicted reach (High/Medium/Low/Niche) and the engagement prediction." },
    { key: "video_coverage", label: "Video Coverage", weight: 4, instruction: "Is every video accounted for in at least one logical playlist, with minimal orphaned/unassigned videos?" },
    { key: "audience_targeting", label: "Audience & Niche Targeting", weight: 8, instruction: "Do the playlists serve a clear audience persona and primary niche (target audience/goal alignment)?" },
  ],
  // ── Channel-audit + video-audit scoring params (formerly in
  // config/auditParameterDefinitions.js). Flattened rows carry auditType.
  channelIdentity: [
    { key: "name_clarity", label: "Channel Name Clarity", category: "branding", weight: 8, enabled: true, thresholds: { minChars: 4, maxChars: 30 }, recommendationTemplate: "Name is unclear. Fix: use a short name with your topic word in it." },
    { key: "avatar_present", label: "Custom Profile Image", category: "branding", weight: 6, enabled: true, thresholds: {}, recommendationTemplate: "No profile photo. Fix: upload a clear photo of you or your logo." },
    { key: "banner_spec", label: "Banner Image (spec/safe-area)", category: "branding", weight: 7, enabled: true, thresholds: {}, recommendationTemplate: "Banner words may be cut off on phones. Fix: keep all words inside the middle safe area." },
    { key: "watermark_set", label: "Subscribe Watermark", category: "branding", weight: 5, enabled: true, thresholds: {}, recommendationTemplate: "No subscribe button on videos. Fix: in YouTube Studio, add a watermark under Branding." },
    { key: "trailer_present", label: "Channel Trailer", category: "branding", weight: 5, enabled: true, thresholds: {}, recommendationTemplate: "No channel trailer. Fix: upload a short video under 90 seconds about your channel." },
    { key: "featured_sections", label: "Featured Sections / Layout", category: "branding", weight: 4, enabled: true, thresholds: {}, recommendationTemplate: "Home page is not set up. Fix: in YouTube Studio, put your best videos first on the home page." },
    { key: "description_complete", label: "About / Description Completeness", category: "metadata", weight: 10, enabled: true, thresholds: { minWords: 50 }, recommendationTemplate: "About is too short. Fix: write 50+ words about what viewers get and when you post." },
    { key: "channel_keywords", label: "Channel Keywords", category: "metadata", weight: 9, enabled: true, thresholds: { minCount: 5 }, recommendationTemplate: "Almost no channel keywords. Fix: add 5-10 words about your topic." },
    { key: "links_valid", label: "Website / Social Links", category: "metadata", weight: 5, enabled: true, thresholds: {}, recommendationTemplate: "No website links. Fix: add your website and social links." },
    { key: "category_set", label: "Category Set Correctly", category: "metadata", weight: 5, enabled: true, thresholds: {}, recommendationTemplate: "Wrong or missing category. Fix: pick the topic that fits your videos." },
    { key: "niche_coherence", label: "Niche Coherence (declared vs actual)", category: "niche", weight: 14, enabled: true, thresholds: { minMatchPct: 70 }, recommendationTemplate: "Your videos don't match your About text ({{rate}}% match). Fix: make new videos about your main topic." },
    { key: "publish_cadence_trend", label: "Publishing Cadence & Velocity", category: "trend", weight: 14, enabled: true, thresholds: { maxGapDays: 21 }, recommendationTemplate: "You wait too long between videos (over {{maxGapDays}} days). Fix: post every week." },
    { key: "velocity_change_trend", label: "Velocity & Growth Trend", category: "trend", weight: 13, enabled: true, thresholds: {}, recommendationTemplate: "Views are going down. Fix: post every week and make more of your best topic." },
    { key: "verification_status", label: "Verification Badge", category: "trust", weight: 2, enabled: false, thresholds: {}, recommendationTemplate: "Verification is informational only." },
    { key: "copyright_strikes", label: "Copyright / Guideline Strikes", category: "trust", weight: 4, enabled: false, thresholds: {}, recommendationTemplate: "You may have a copyright claim. Fix: check YouTube Studio and fix it, or it can hurt your reach." },
    { key: "niche_consistency", label: "Niche Consistency (cross-video coherence)", category: "niche", weight: 12, enabled: true, thresholds: { minMatchPct: 70 }, recommendationTemplate: "Your videos are about mixed topics ({{rate}}% match). Fix: keep all videos about your main topic." },
    { key: "brand_curiosity", label: "Brand Curiosity Signals", category: "branding", weight: 6, enabled: true, thresholds: {}, recommendationTemplate: "New visitors have no reason to click. Fix: add one interesting line to your name, banner or trailer." },
    { key: "likeability_trust", label: "Likeability & Trust Signals", category: "trust", weight: 6, enabled: true, thresholds: {}, recommendationTemplate: "Your channel looks less trusted. Fix: write in a friendly way, keep promises, and fill in your About." },
  ],
  video: [
    { key: "title_quality", label: "Title Optimization", category: "seo", weight: 16, enabled: true, thresholds: { minChars: 30, maxChars: 70 }, recommendationTemplate: "Titles are weak. Fix: put the main word first. Keep titles 30-70 letters long." },
    { key: "description_quality", label: "Description Quality", category: "seo", weight: 15, enabled: true, thresholds: { minWords: 150 }, recommendationTemplate: "Descriptions are too short. Fix: write 150+ words. Put the main word in the first 2 lines." },
    { key: "tags_quality", label: "Tags Optimization", category: "seo", weight: 10, enabled: true, thresholds: { minCount: 8 }, recommendationTemplate: "Too few tags. Fix: add 8-15 tags about your topic." },
    { key: "captions_present", label: "Captions / Subtitles", category: "accessibility", weight: 9, enabled: true, thresholds: {}, recommendationTemplate: "Most videos have no captions. Fix: add captions by hand to each video." },
    { key: "cards_endscreens", label: "Cards & End Screens", category: "engagement", weight: 8, enabled: true, thresholds: {}, recommendationTemplate: "No links to other videos. Fix: add cards and end screens to your videos." },
    { key: "playlist_membership", label: "Playlist Membership", category: "structure", weight: 8, enabled: true, thresholds: {}, recommendationTemplate: "Videos are not in playlists. Fix: put each video in one playlist." },
    { key: "hashtags", label: "Hashtags", category: "seo", weight: 5, enabled: true, thresholds: { minCount: 2 }, recommendationTemplate: "No hashtags. Fix: add 2-3 hashtags in each description." },
    { key: "chapters", label: "Chapters / Timestamps", category: "seo", weight: 6, enabled: true, thresholds: {}, recommendationTemplate: "No video chapters. Fix: add times like 00:00 Intro in the description." },
    { key: "engagement_signals", label: "Engagement Signals (Like/Comment Rate)", category: "engagement", weight: 12, enabled: true, thresholds: { minLikeRatePct: 3.5 }, recommendationTemplate: "Likes are below the {{minLikeRatePct}}% goal. Fix: ask viewers a question in each video." },
  ],
  general: [
    { key: "upload_consistency", label: "Upload Consistency / Cadence", category: "cadence", weight: 16, enabled: true, thresholds: { maxGapDays: 21 }, recommendationTemplate: "You wait too long between videos (over {{maxGapDays}} days). Fix: post on the same day each week." },
    { key: "activity_trend", label: "Upload Activity Trend", category: "cadence", weight: 12, enabled: true, thresholds: {}, recommendationTemplate: "You post less than before. Fix: post every week." },
    { key: "niche_follow_through", label: "Niche Follow-Through (Trend)", category: "niche", weight: 14, enabled: true, thresholds: { minMatchPct: 70 }, recommendationTemplate: "New videos left your main topic ({{rate}}% match). Fix: go back to your main topic." },
    { key: "views_to_subs", label: "Views-to-Subscriber Ratio", category: "reach", weight: 12, enabled: true, thresholds: {}, recommendationTemplate: "Few viewers subscribe. Fix: post short videos and ask viewers to subscribe." },
    { key: "engagement_trend", label: "Engagement Rate Trend", category: "engagement", weight: 12, enabled: true, thresholds: {}, recommendationTemplate: "Likes and comments are falling. Fix: start videos with something exciting and pin a question." },
    { key: "shorts_balance", label: "Shorts vs Long-form Balance", category: "mix", weight: 10, enabled: true, thresholds: {}, recommendationTemplate: "Wrong mix of short and long videos. Fix: for each long video, post one short video too." },
    { key: "posting_time", label: "Posting Time Consistency", category: "cadence", weight: 8, enabled: true, thresholds: {}, recommendationTemplate: "You post at random times. Fix: always post on the same day and hour." },
    { key: "subscriber_growth", label: "Subscriber Conversion Trend", category: "growth", weight: 10, enabled: true, thresholds: {}, recommendationTemplate: "Few viewers subscribe. Fix: tell viewers in each video why to subscribe." },
    { key: "community_activity", label: "Community Activity", category: "engagement", weight: 6, enabled: true, thresholds: {}, recommendationTemplate: "No posts between videos. Fix: post one poll each week." },
  ],
  // Standalone Video Auditor's per-element criteria (DEFAULT_AUDIT_CRITERIA.video).
  // Single source of truth: the Full Audit's VIDEO sub-audit and the Video Audit
  // page both derive their categories/points from THIS list. The `thumbnail`
  // element is excluded from the Full Audit's video sub-audit because the 12-pillar
  // framework above already covers thumbnails.
  videoBlend: { algorithmic: 50, ai: 50 },
  // Dual-engine blends for the remaining Full Audit sub-audits (same pattern
  // as videoBlend: weighted average of the deterministic engine score and the
  // AI engine score, 50/50 by default, admin-editable).
  channelBlend: { algorithmic: 50, ai: 50 },
  playlistBlend: { algorithmic: 50, ai: 50 },
  generalBlend: { algorithmic: 50, ai: 50 },
  // Channel-identity AI criteria (channelBrand): the cheap text-only LLM
  // assessment in the channel sub-audit scores these 0-10. Weights sum to 100.
  // `instruction` is the LLM rubric (never shown to users).
  // `recommendationTemplate` is the user-facing fix (what's wrong + how to fix),
  // interpolated with {{score}}, {{name}}, {{niche}}, {{coherence}}, {{aboutWords}}.
  channelBrand: [
    { key: "brand_voice", label: "Brand Voice", category: "branding", weight: 25, instruction: "Does the channel name, description, and branding convey a consistent, recognizable voice and tone?", recommendationTemplate: "Your channel style is mixed ({{score}}/10 for '{{name}}'). Fix: pick one friendly style and use it in your name, About, banner and trailer." },
    { key: "niche_clarity", label: "Niche Clarity", category: "niche", weight: 25, instruction: "Is the channel's niche immediately clear from its name and About section?", recommendationTemplate: "Viewers can't tell what your channel is about ({{score}}/10). Your name '{{name}}' does not say '{{niche}}'. Fix: add '{{niche}}' to your name. Start your About with: 'Weekly {{niche}} videos for beginners. New video every week.'" },
    { key: "positioning", label: "Positioning", category: "metadata", weight: 25, instruction: "Does the channel clearly state what value viewers get and why they should subscribe?", recommendationTemplate: "Viewers don't know why to subscribe ({{score}}/10). Fix: add one line to your About: what viewers get and how often you post." },
    { key: "trust_signals", label: "Trust Signals", category: "trust", weight: 25, instruction: "Do the channel's description, links, and presentation convey credibility and trustworthiness?", recommendationTemplate: "Your channel looks less trusted ({{score}}/10). Fix: {{trustFix}}." },
  ],
  // General outlook AI criteria (generalOutlook): the cheap text-only LLM
  // assessment in the general sub-audit scores these 0-10. Weights sum to 100.
  generalOutlook: [
    { key: "growth_trajectory", label: "Growth Trajectory", category: "growth", weight: 40, instruction: "Is the channel's view and subscriber trajectory growing, flat, or declining based on recent stats?", recommendationTemplate: "Views are flat or falling ({{score}}/10, {{videoCount}} videos, likes {{likeRate}}). Fix: post 1 short video and 1 poll each week. Make more videos on your best topic." },
    { key: "cadence_health", label: "Cadence Health", category: "cadence", weight: 30, instruction: "Is the upload cadence sustainable and consistent based on the recent publishing rhythm?", recommendationTemplate: "You post at random times ({{score}}/10 — {{cadence}}). Fix: post on the same day each week. Never wait more than 21 days." },
    { key: "format_mix", label: "Format Mix", category: "mix", weight: 30, instruction: "Does the channel use a healthy mix of Shorts and long-form content for its niche?", recommendationTemplate: "Wrong mix of short and long videos ({{score}}/10 — {{shorts}} shorts out of {{videoCount}}). Fix: for each long video, post one short video too." },
  ],
  // Content-quality additions (STREAM B) reuse only elements that always carry
  // data (title/description) so the generic videoAuditService engine scores them
  // with zero code changes. Weights renormalized by largest-remainder so the
  // section still sums to 100 (engine outputs stay calibrated).
  videoElements: [
    { key: "title_clear", label: "Title Clarity", weight: 15, element: "title", category: "discoverability", instruction: "Score how clear and click-worthy the title is for THIS video's topic.", niches: [], recommendationTemplate: "Titles are hard to understand ({{score}}/10). Fix: put the main word first. Keep titles 30-70 letters long." },
    { key: "title_curiosity", label: "Title Curiosity", weight: 12, element: "title", category: "discoverability", instruction: "Does the title create curiosity or a question about the topic?", niches: [], recommendationTemplate: "Titles are boring ({{score}}/10). Fix: add one interesting question or promise to each title." },
    { key: "description_rich", label: "Description Richness", weight: 11, element: "description", category: "contentQuality", instruction: "How complete and helpful is the description for a viewer of this topic?", niches: [], recommendationTemplate: "Descriptions are too short ({{score}}/10). Fix: write 150+ words. Put the main word in the first 2 lines." },
    { key: "tags_quality", label: "Tag Quality", weight: 8, element: "tags", category: "discoverability", instruction: "Are the tags relevant and well-chosen for this video's topic?", niches: [], recommendationTemplate: "Tags are weak ({{score}}/10). Fix: add 8-15 tags about your topic. Put the main word first." },
    { key: "keywords_match", label: "Keyword Relevance", weight: 8, element: "keywords", category: "discoverability", instruction: "Do the keywords match the title and description topic?", niches: [], recommendationTemplate: "Keywords don't match your titles ({{score}}/10). Fix: use the same main word in the title, description and tags." },
    { key: "caption_value", label: "Caption Value", weight: 11, element: "caption", category: "contentQuality", instruction: "Does the caption/transcript add value for this topic?", niches: [], recommendationTemplate: "Videos have no captions ({{score}}/10). Fix: add captions by hand to each video." },
    { key: "thumbnail_pop", label: "Thumbnail Pop", weight: 11, element: "thumbnail", category: "visualHook", instruction: "How eye-catching and on-topic is the thumbnail for this video?", niches: [], recommendationTemplate: "Thumbnails are weak ({{score}}/10). Fix: use 3-5 big words and one clear photo." },
    { key: "niche_alignment", label: "Niche Alignment", weight: 8, element: "title", category: "discoverability", instruction: "Do the title and description clearly match the channel's niche and target audience?", niches: [], recommendationTemplate: "Videos are off-topic ({{score}}/10). Fix: keep your next 10 videos about '{{niche}}'." },
    { key: "audience_hook", label: "Audience Hook", weight: 8, element: "title", category: "discoverability", instruction: "Does the title open a clear curiosity hook that grabs the intended viewer in the first seconds of attention (complements curiosity, no clickbait)?", niches: [], recommendationTemplate: "Video starts are weak ({{score}}/10). Fix: say the best part first in the title and in the first 15 seconds." },
    { key: "value_density", label: "Value Density", weight: 8, element: "description", category: "contentQuality", instruction: "Does the description promise concrete value and signal substance over filler for this topic?", niches: [], recommendationTemplate: "Descriptions don't promise enough ({{score}}/10). Fix: say what viewers will learn, and add video chapters." },
  ],
};

function isValidCriterion(c) {
  return !!(
    c &&
    typeof c.key === "string" &&
    c.key &&
    typeof c.label === "string" &&
    typeof c.instruction === "string" &&
    typeof c.weight === "number" &&
    c.weight > 0
  );
}

// The default 12-pillar thumbnail audit framework (mirrors the prompt that
// previously lived inline in thumbnailOptimizerService.js).
function normalizeThumbnailCriterion(c) {
  return { ...c, tier: THUMBNAIL_TIERS.includes(c.tier) ? c.tier : "Grey" };
}

function mergeSection(defaultRows, dbRows, normalizeTier) {
  // Fixed criteria sets: only keys present in the code defaults are merged.
  // Unknown (e.g. legacy custom-added) keys are dropped so the admin UI and
  // scoring engines always operate on the canonical fixed set.
  const knownKeys = new Set(defaultRows.map((r) => r.key));
  const byKey = new Map(defaultRows.map((r) => [r.key, { ...r }]));
  for (const row of dbRows || []) {
    if (!isValidCriterion(row)) continue;
    if (!knownKeys.has(row.key)) continue;
    const base = byKey.get(row.key) || {};
    const merged = { ...base, ...row };
    if (normalizeTier) {
      merged.tier = THUMBNAIL_TIERS.includes(merged.tier) ? merged.tier : "Grey";
    }
    byKey.set(row.key, merged);
  }
  return [...byKey.values()];
}

// Blend keys in DEFAULT_OPTIMIZER_CRITERIA (dual-engine {algorithmic, ai}
// weights shared by the Full Audit sub-audits).
const ENGINE_BLEND_KEYS = ["videoBlend", "channelBlend", "playlistBlend", "generalBlend"];

// Resolve an admin-configured {algorithmic, ai} blend to integer weights that
// sum to 100. Each side is clamped to 0-100 (explicit 0 is preserved, so a
// 0/100 blend runs a single engine); a zero/NaN pair falls back to 50/50 so
// scoring never divides by zero.
function mergeEngineBlend(dbBlend, defaultBlend) {
  const d = defaultBlend || { algorithmic: 50, ai: 50 };
  const clampW = (n, fallback) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return fallback;
    return Math.max(0, Math.min(100, v));
  };
  let algorithmic = clampW(dbBlend?.algorithmic, Number(d.algorithmic));
  let ai = clampW(dbBlend?.ai, Number(d.ai));
  if (!Number.isFinite(algorithmic)) algorithmic = 50;
  if (!Number.isFinite(ai)) ai = 50;
  if (algorithmic + ai <= 0) { algorithmic = 50; ai = 50; }
  // Renormalize so the pair always sums to 100.
  const sum = algorithmic + ai;
  const a = Math.round((algorithmic / sum) * 100);
  return { algorithmic: a, ai: 100 - a };
}

// Backward-compatible alias (video was the first blended sub-audit).
function mergeVideoBlend(dbBlend) {
  return mergeEngineBlend(dbBlend, DEFAULT_OPTIMIZER_CRITERIA.videoBlend);
}

// Sum of the playlist section weights. Playlist weights are points: each
// criterion earns weight * llmScore/100, so the section must total exactly
// 100 for the weighted % to be meaningful.
function playlistWeightTotal(playlistRows) {
  return (Array.isArray(playlistRows) ? playlistRows : []).reduce(
    (s, r) => s + (Number(r?.weight) || 0),
    0,
  );
}

// Returns an error message when the playlist weights do not sum to 100,
// otherwise null. Used by the admin PUT paths (400-pattern, mirroring the
// audit-scoring-profiles sum-to-1 check).
function validatePlaylistWeights(playlistRows) {
  const total = playlistWeightTotal(playlistRows);
  if (Math.abs(total - 100) > 0.001) {
    return `Playlist weights must sum to 100 (got ${total}).`;
  }
  return null;
}

function mergeOptimizerCriteria(dbData = {}) {
  const d = DEFAULT_OPTIMIZER_CRITERIA;
  return {
    thumbnail: mergeSection(d.thumbnail, dbData.thumbnail, true),
    playlist: mergeSection(d.playlist, dbData.playlist),
    channelIdentity: mergeSection(d.channelIdentity, dbData.channelIdentity),
    video: mergeSection(d.video, dbData.video),
    general: mergeSection(d.general, dbData.general),
    videoElements: mergeSection(d.videoElements, dbData.videoElements),
    videoBlend: mergeEngineBlend(dbData.videoBlend, d.videoBlend),
    channelBlend: mergeEngineBlend(dbData.channelBlend, d.channelBlend),
    playlistBlend: mergeEngineBlend(dbData.playlistBlend, d.playlistBlend),
    generalBlend: mergeEngineBlend(dbData.generalBlend, d.generalBlend),
    channelBrand: mergeSection(d.channelBrand, dbData.channelBrand),
    generalOutlook: mergeSection(d.generalOutlook, dbData.generalOutlook),
  };
}

/**
 * Merge an admin-submitted (possibly partial) criteria object on top of the
 * currently stored one, section by section. Sections omitted from the payload
 * keep their stored values, so the optimizer-criteria editor and the
 * audit-parameters editor can both write the same doc without clobbering
 * each other's sections.
 */
function mergeCriteriaWithExisting(existing, incoming = {}) {
  const d = DEFAULT_OPTIMIZER_CRITERIA;
  const out = {};
  for (const section of Object.keys(d)) {
    if (ENGINE_BLEND_KEYS.includes(section)) {
      out[section] = mergeEngineBlend(incoming[section] ?? existing?.[section], d[section]);
      continue;
    }
    const base = Array.isArray(existing?.[section]) && existing[section].length > 0
      ? existing[section]
      : d[section];
    out[section] = mergeSection(base, incoming[section], section === "thumbnail");
  }
  return out;
}

/**
 * Flatten the param sections (channelIdentity/video/general) into the
 * auditType-tagged row list used by the channel/video audit + admin editor.
 */
function flattenParamRows(criteria) {
  return Object.entries(PARAM_SECTIONS).flatMap(([section, auditType]) =>
    (criteria[section] || []).map((p) => ({ ...p, auditType })),
  );
}

function isValidParam(p) {
  // Params (channelIdentity/video/general rows) carry `recommendationTemplate`,
  // NOT the `instruction` field that AI-criteria sections require — so they get
  // their own shape check. Reusing isValidCriterion here silently dropped EVERY
  // admin param edit on save (enabled toggles, weights, thresholds), which then
  // reverted to code defaults on refresh while the API still returned success.
  return !!(
    p &&
    typeof p.key === "string" &&
    p.key &&
    typeof p.label === "string" &&
    typeof p.weight === "number" &&
    p.weight > 0 &&
    typeof p.auditType === "string" &&
    AUDIT_TYPE_TO_SECTION[p.auditType]
  );
}

/**
 * Merge a flat auditType-tagged param list (as edited in the admin panel)
 * back into a full criteria object. Legacy/foreign auditTypes (e.g. PLAYLIST
 * rows from the old config) are dropped -- playlist scoring lives only in
 * the `playlist` section.
 */
function mergeParamListIntoCriteria(criteria, paramList) {
  const out = {};
  for (const section of Object.keys(PARAM_SECTIONS)) {
    out[section] = (criteria[section] || []).map((r) => ({ ...r }));
  }
  for (const p of paramList || []) {
    if (!isValidParam(p)) continue;
    const section = AUDIT_TYPE_TO_SECTION[p.auditType];
    const idx = out[section].findIndex((r) => r.key === p.key);
    if (idx >= 0) out[section][idx] = { ...out[section][idx], ...p };
  }
  return out;
}

async function getOptimizerCriteria(db) {
  if (_cache && Date.now() - _cachedAt < CACHE_TTL_MS) return _cache;
  try {
    const doc = await db.collection("config").doc("optimizerCriteria").get();
    _cache = doc.exists ? mergeOptimizerCriteria(doc.data()) : DEFAULT_OPTIMIZER_CRITERIA;
  } catch {
    _cache = _cache || DEFAULT_OPTIMIZER_CRITERIA;
  }
  _cachedAt = Date.now();
  return _cache;
}

function invalidateOptimizerCriteriaCache() {
  _cache = null;
  _cachedAt = 0;
}

module.exports = {
  DEFAULT_OPTIMIZER_CRITERIA,
  THUMBNAIL_TIERS,
  PARAM_SECTIONS,
  ENGINE_BLEND_KEYS,
  getOptimizerCriteria,
  mergeOptimizerCriteria,
  mergeCriteriaWithExisting,
  mergeEngineBlend,
  mergeVideoBlend,
  flattenParamRows,
  mergeParamListIntoCriteria,
  invalidateOptimizerCriteriaCache,
  isValidCriterion,
  playlistWeightTotal,
  validatePlaylistWeights,
};

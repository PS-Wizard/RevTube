// ── Centralized Audit orchestrator ──
// A focused channel audit. Runs a real 4-part audit reusing the SAME engines as
// the standalone tools so scores are IDENTICAL whether a channel is audited here
// or through the individual Video / Playlist tools:
//   - channelIdentity: auditScoringService.scoreChannel (deterministic)
//   - video:           the real Video Audit engine (algorithmic + AI blend), with
//                      full per-video scores + recommendations + AI suggestions
//   - playlist:        the real Playlist Optimizer LLM engine
//   - general:         auditScoringService (deterministic cadence/trends)
// Completes as fast as the user's chosen video window allows (1-100 videos),
// not because it skips the real engines.

const { DEFAULT_OPTIMIZER_CRITERIA } = require("../config/optimizerCriteria");
const { createAuditHistoryService } = require("./auditHistoryService");
const { buildFocusContextBlock } = require("./channelFocusService");

const clamp = (n, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, Math.round(Number(n) || 0)));
const STOP = new Set([
  "the", "a", "an", "to", "of", "in", "on", "for", "and", "or", "but", "how", "what", "why",
  "your", "you", "my", "me", "we", "our", "is", "are", "was", "were", "with", "from", "by",
  "at", "be", "it", "this", "that", "as", "get", "make", "new", "all", "video", "videos",
  "2026", "2025", "2024", "top", "best", "vs", "ways", "way",
]);

function keywordsOf(text) {
  return (text || "").toLowerCase().split(/\W+/).filter((w) => !STOP.has(w) && w.length > 2);
}

// Human labels for the standalone Video Auditor's focus categories live in the
// admin-configured videoElements rows themselves (c.category); params carry the
// raw category key and the UI maps it to a display label.

// Detect the dominant niche from recent video titles/tags (cheap text pass,
// no AI). Returns the most frequent topic keyword.
function deriveNiche(videos = [], description = "") {
  const freq = {};
  const sample = videos.slice(0, 30);
  for (const v of sample) {
    for (const w of keywordsOf(`${v?.title || ""} ${v?.tags?.join?.(" ") || ""}`)) {
      freq[w] = (freq[w] || 0) + 1;
    }
  }
  for (const w of keywordsOf(description)) freq[w] = (freq[w] || 0) + 1;
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

// Owner-declared focus niche wins over keyword derivation everywhere an audit
// names "your niche" (cleaner, personalized audits when a focus is saved;
// identical behavior otherwise).
function focusNiche(input, videos = [], description = "") {
  const declared = String(input?.channelFocus?.niche || "").trim();
  return declared || deriveNiche(videos, description);
}

// % of recent videos whose top keyword matches the declared niche.
function nicheCoherence(videos = [], niche = "") {
  if (!niche) return null;
  const sample = videos.slice(0, 20);
  if (!sample.length) return null;
  let match = 0;
  for (const v of sample) {
    const toks = keywordsOf(`${v?.title || ""} ${v?.tags?.join?.(" ") || ""}`);
    if (toks.includes(niche)) match += 1;
  }
  return Math.round((match / sample.length) * 100);
}

// ── Audit data availability (spec: gate on verified data) ───────────────────
// Checks the ingested read-model for a channel: when the channel is connected
// and cron has synced it, retention/watch-time rows exist in
// analytics_video_metrics_daily and retention-grounded criteria can score.
// When absent, those criteria are marked gated (pending data), never silently
// zeroed. Never throws — unknown means gated, not failed.
async function getAuditDataAvailability({ query, isPostgresConfigured, channelId }) {
  const none = { hasVideoMetrics: false };
  try {
    if (!channelId) return none;
    const configured = typeof isPostgresConfigured === "function" ? isPostgresConfigured() : !!isPostgresConfigured;
    if (!configured || typeof query !== "function") return none;
    const res = await query(
      "SELECT 1 FROM analytics_video_metrics_daily WHERE channel_id = $1 LIMIT 1",
      [channelId],
    );
    return { hasVideoMetrics: Array.isArray(res?.rows) && res.rows.length > 0 };
  } catch {
    return none;
  }
}

// ── Dual-engine blend helpers (shared by channel/video/playlist/general) ───
// Resolve an admin-configured {algorithmic, ai} blend to integer weights that
// sum to 100. Explicit 0 is preserved (0/100 = single engine); a zero/NaN
// pair falls back to 50/50 so scoring never divides by zero.
function resolveEngineBlend(rawBlend, fallback = { algorithmic: 50, ai: 50 }) {
  const num = (n, fb) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return fb;
    return Math.max(0, Math.min(100, v));
  };
  let wAlgo = num(rawBlend?.algorithmic, Number(fallback?.algorithmic));
  let wAI = num(rawBlend?.ai, Number(fallback?.ai));
  if (!Number.isFinite(wAlgo)) wAlgo = 50;
  if (!Number.isFinite(wAI)) wAI = 50;
  if (wAlgo + wAI <= 0) { wAlgo = 50; wAI = 50; }
  const sum = wAlgo + wAI;
  const algorithmic = Math.round((wAlgo / sum) * 100);
  return { algorithmic, ai: 100 - algorithmic };
}

// Weighted average of two 0-100 engine scores with null-fallbacks: when one
// engine has no data (null) or its weight is 0, the other engine's score is
// used alone (same rule as the video sub-audit).
function blendEngineTotals(algoTotal, aiTotal, blend) {
  const wAlgo = Number(blend?.algorithmic) || 0;
  const wAI = Number(blend?.ai) || 0;
  if (algoTotal == null && aiTotal == null) return 0;
  if (aiTotal == null || wAI === 0) return algoTotal;
  if (algoTotal == null || wAlgo === 0) return aiTotal;
  const sum = wAlgo + wAI;
  if (sum <= 0) return algoTotal;
  return clamp(Math.round((algoTotal * wAlgo + aiTotal * wAI) / sum));
}

// 0-100 weighted % earned across a param list (null when nothing scoreable).
// Gated params (waiting on data) are excluded from the denominator — spec §7:
// pending data must never silently count as zero.
function enginePctOf(list) {
  const rows = (Array.isArray(list) ? list : []).filter((p) => p?.status !== "gated");
  const max = rows.reduce((s, p) => s + (Number(p?.max) || 0), 0);
  const earned = rows.reduce((s, p) => s + (Number(p?.earned) || 0), 0);
  return max > 0 ? clamp(Math.round((earned / max) * 100)) : null;
}

// ── Dimension merge: ONE combined card per scored dimension ─────────────────
// Both engines routinely judge the same dimension (titles, tags, captions,
// niche, cadence...). Emitting the algorithmic check and the AI judgment as
// two separate params double-scores it in the UI, so each dimension collapses
// to a single param: earned = max * blendedPct / 100, where blendedPct is the
// admin-configured weighted average of the engines' own percentages (same
// null-fallback rule as blendEngineTotals: a missing engine or a zero weight
// leaves the other engine's percentage alone). rawValue keeps the
// deterministic baseline percentage (playlist convention); detail lists the
// member contributions for transparency (never rendered as extra cards).
// Members with earned == null are skipped (gated — listed in meta instead).
// Params outside every dimension pass through untouched as their own card.
function mergeDimensionParams(dimensions, params, blend) {
  const byKey = new Map((params || []).filter((p) => p && p.key).map((p) => [p.key, p]));
  const used = new Set();
  const out = [];
  for (const d of dimensions || []) {
    const members = [];
    for (const m of d.members || []) {
      const p = byKey.get(m.key);
      if (!p || p.earned == null) continue;
      used.add(m.key);
      members.push({ ...p, engine: m.engine === "ai" ? "ai" : "algo" });
    }
    if (!members.length) continue;
    const pctOf = (list) => {
      const mx = list.reduce((s, p) => s + (Number(p.max) || 0), 0);
      const er = list.reduce((s, p) => s + (Number(p.earned) || 0), 0);
      return mx > 0 ? (er / mx) * 100 : null;
    };
    const algoPct = pctOf(members.filter((m) => m.engine !== "ai"));
    const aiPct = pctOf(members.filter((m) => m.engine === "ai"));
    const wAlgo = Number(blend?.algorithmic) || 0;
    const wAI = Number(blend?.ai) || 0;
    let blended = null;
    if (algoPct == null && aiPct == null) continue;
    else if (aiPct == null || wAI === 0) blended = algoPct;
    else if (algoPct == null || wAlgo === 0) blended = aiPct;
    else blended = (algoPct * wAlgo + aiPct * wAI) / ((wAlgo + wAI) || 1);
    const max = members.reduce((s, p) => s + (Number(p.max) || 0), 0);
    const earned = Math.round((max * blended) / 100);
    // The worst member lends its fix-it message for the dimension.
    let worst = members[0];
    for (const m of members) {
      const r = (Number(m.earned) || 0) / (Number(m.max) || 1);
      const wr = (Number(worst.earned) || 0) / (Number(worst.max) || 1);
      if (r < wr) worst = m;
    }
    const single = members.length === 1;
    out.push({
      key: single ? members[0].key : d.key,
      label: d.label || members[0].label,
      category: d.category || members[0].category || "other",
      max,
      earned,
      rawValue: algoPct == null ? null : Math.round(algoPct),
      recommendationTemplate: worst.recommendationTemplate || "",
      vars: { ...(worst.vars || {}), score: earned, max },
      detail: members.map((m) => ({ key: m.key, label: m.label, earned: m.earned, max: m.max, engine: m.engine })),
    });
  }
  for (const p of params || []) {
    if (!p || !p.key || used.has(p.key) || p.earned == null) continue;
    out.push(p);
  }
  return out;
}

// Video dimensions: deterministic video checks (va_*) + AI element judgments
// (ve_*) + aggregate checks, blended with videoBlend.
const VIDEO_DIMENSIONS = [
  { key: "title", label: "Title Optimization", category: "discoverability", members: [{ key: "va_title_quality" }, { key: "ve_title_clear", engine: "ai" }, { key: "ve_title_curiosity", engine: "ai" }, { key: "ve_niche_alignment", engine: "ai" }, { key: "ve_audience_hook", engine: "ai" }] },
  { key: "description", label: "Description Quality", category: "contentQuality", members: [{ key: "va_description_quality" }, { key: "ve_description_rich", engine: "ai" }, { key: "ve_value_density", engine: "ai" }] },
  { key: "tags", label: "Tags & Keywords", category: "discoverability", members: [{ key: "va_tags_quality" }, { key: "ve_tags_quality", engine: "ai" }, { key: "ve_keywords_match", engine: "ai" }] },
  { key: "hashtags", label: "Hashtags", category: "seo", members: [{ key: "va_hashtags" }] },
  { key: "chapters", label: "Chapters", category: "seo", members: [{ key: "va_chapters" }] },
  { key: "captions_present", label: "Captions", category: "accessibility", members: [{ key: "captions_present" }, { key: "ve_caption_value", engine: "ai" }] },
  { key: "engagement_signals", label: "Engagement Signals", category: "engagement", members: [{ key: "engagement_signals" }] },
];

// Channel dimensions: text metrics + branding checks + AI brand judgments,
// blended with channelBlend.
const CHANNEL_DIMENSIONS = [
  { key: "identity", label: "Channel Name & Handle", category: "branding", members: [{ key: "name" }, { key: "username" }] },
  { key: "tags", label: "Channel Keywords", category: "metadata", members: [{ key: "tags" }] },
  { key: "niche", label: "Niche & Focus", category: "niche", members: [{ key: "niche" }, { key: "niche_coherence" }, { key: "niche_clarity", engine: "ai" }] },
  { key: "description", label: "About & Description", category: "metadata", members: [{ key: "description" }, { key: "positioning", engine: "ai" }] },
  { key: "brand_voice", label: "Brand Voice", category: "branding", members: [{ key: "brand_voice", engine: "ai" }] },
  { key: "trust_signals", label: "Trust Signals", category: "trust", members: [{ key: "trust_signals", engine: "ai" }] },
  { key: "avatar_present", label: "Custom Profile Image", category: "branding", members: [{ key: "avatar_present" }] },
  { key: "banner_spec", label: "Banner Image", category: "branding", members: [{ key: "banner_spec" }] },
  { key: "watermark_set", label: "Subscribe Watermark", category: "branding", members: [{ key: "watermark_set" }] },
  { key: "trailer_present", label: "Channel Trailer", category: "branding", members: [{ key: "trailer_present" }] },
  { key: "featured_sections", label: "Featured Sections", category: "branding", members: [{ key: "featured_sections" }] },
  { key: "category_set", label: "Category Set", category: "metadata", members: [{ key: "category_set" }] },
  { key: "links_valid", label: "Website / Social Links", category: "metadata", members: [{ key: "links_valid" }] },
  { key: "publish_cadence_trend", label: "Publishing Cadence & Velocity", category: "trend", members: [{ key: "publish_cadence_trend" }] },
  { key: "velocity_change_trend", label: "Velocity & Growth Trend", category: "trend", members: [{ key: "velocity_change_trend" }] },
];

// General dimensions: deterministic cadence/engagement + AI outlook judgments,
// blended with generalBlend.
const GENERAL_DIMENSIONS = [
  { key: "uploadConsistency", label: "Upload Consistency", category: "cadence", members: [{ key: "uploadConsistency" }, { key: "cadence_health", engine: "ai" }] },
  { key: "engagement", label: "Engagement", category: "engagement", members: [{ key: "engagement" }] },
  { key: "contentSwitch", label: "Content Focus", category: "niche", members: [{ key: "contentSwitch" }] },
  { key: "shorts_balance", label: "Shorts vs Long-form Balance", category: "mix", members: [{ key: "shorts_balance" }, { key: "format_mix", engine: "ai" }] },
  { key: "growth_trajectory", label: "Growth Trajectory", category: "growth", members: [{ key: "growth_trajectory", engine: "ai" }] },
];

// ── Lightweight channel/general AI assessments ─────────────────────────────
// One cheap text-only LLM call per sub-audit: the configured AI criteria plus
// a compact text summary, requesting JSON {scores:[{key, score 0-10}]}.
// Any failure (no LLM wired, throw, unparseable) returns null so the caller
// degrades to the algorithmic score alone (same as the video pattern).
async function assessAiCriteria(llmEngine, { subject, criteria }) {
  const deepSeekJson = llmEngine?.deepSeekJson;
  if (typeof deepSeekJson !== "function") return null;
  const list = (Array.isArray(criteria) ? criteria : []).filter((c) => c && c.key);
  if (!list.length) return null;
  try {
    const lines = list.map(
      (c) => `- key="${c.key}" (${c.label || c.key}): ${c.instruction || "Score this criterion 0-10."}`,
    );
    const prompt = [
      "You are a strict YouTube channel analyst. Score EACH criterion below 0-10 for the channel described.",
      "Use the full range, do not anchor at 7. Scoring bands: 0-2 poor/missing, 3-4 weak, 5-6 okay/generic, 7-8 good, 9-10 excellent.",
      "Evaluate these criteria:",
      ...lines,
      "",
      "Channel summary:",
      String(subject || "").slice(0, 3000),
      "",
      'Reply with JSON only: {"scores": [{"key": "<criterion key>", "score": <number 0-10>}, ...]} with exactly one entry per criterion key.',
    ].join("\n");
    const parsed = await deepSeekJson.call(llmEngine, { prompt });
    const arr = Array.isArray(parsed?.scores) ? parsed.scores : null;
    if (!arr) return null;
    const keys = new Set(list.map((c) => c.key));
    const out = [];
    for (const row of arr) {
      const key = row?.key;
      const score = Number(row?.score);
      if (!keys.has(key) || !Number.isFinite(score)) continue;
      out.push({ key, score: Math.min(10, Math.max(0, Math.round(score))) });
    }
    return out;
  } catch {
    return null;
  }
}

// Build scored AI params from criteria + LLM scores. Criteria with no
// matching LLM score are skipped (no-data rule). Labels stay clean (the
// criterion label verbatim, no prefixes) so AI params read like the rest.
// `vars` carries channel/video context so the user-facing
// `recommendationTemplate` can state WHAT is wrong + HOW to fix it (never the
// raw LLM `instruction` question). Templates are pre-interpolated here so the
// simulator shows an actionable message even before buildRecommendations runs.
function aiCriteriaParams(criteria, scores, vars = {}) {
  const byKey = new Map(
    (Array.isArray(scores) ? scores : []).map((s) => [s?.key, Number(s?.score)]),
  );
  const out = [];
  for (const c of criteria || []) {
    if (!c || !byKey.has(c.key)) continue;
    const v = byKey.get(c.key);
    if (!Number.isFinite(v)) continue;
    const points = Math.max(1, Number(c.weight) || 10);
    const score = Math.min(10, Math.max(0, Math.round(v)));
    const earned = Math.round((points * score) / 10);
    const rawTemplate = c.recommendationTemplate ||
      `${c.label || c.key} is weak (${score}/10). Fix: work on this next.`;
    const recommendationTemplate = interpolate(rawTemplate, {
      ...vars,
      label: c.label || c.key,
      score,
      max: 10,
      earned,
      points,
    });
    out.push({
      key: c.key,
      label: c.label || c.key,
      category: c.category || "ai",
      max: points,
      earned,
      rawValue: score * 10,
      recommendationTemplate,
      vars: { ...vars, score, label: c.label || c.key },
    });
  }
  return out;
}

// Channel AI side: text-only summary (name, description, niche, coherence,
// branding presence flags -- no thumbnails) scored against channelBrand.
async function assessChannelAICriteria(llmEngine, { channel, niche, coherencePct, optimizerCriteria, videos, focusBlock }) {
  const criteria =
    Array.isArray(optimizerCriteria?.channelBrand) && optimizerCriteria.channelBrand.length
      ? optimizerCriteria.channelBrand
      : DEFAULT_OPTIMIZER_CRITERIA.channelBrand;
  const ch = channel || {};
  const brand = ch.branding || {};
  const flags = [
    `avatar=${!!(brand.avatar || ch.thumbnails)}`,
    `banner=${!!brand.image?.bannerExternalUrl}`,
    `watermark=${!!brand.watermark}`,
    `trailer=${!!brand.trailer}`,
    `links=${Array.isArray(brand.relatedChannels) || !!brand.googlePlus}`,
    `category=${ch.categoryId || "unset"}`,
  ].join(" ");
  const subject = [
    `Name: ${ch.name || ch.title || "unknown"}`,
    `About: ${String(ch.description || "").slice(0, 800)}`,
    `Declared niche: ${niche || "unknown"} (recent-video match ${coherencePct == null ? "n/a" : `${coherencePct}%`})`,
    `Branding: ${flags}`,
    ...(focusBlock ? [focusBlock] : []),
  ].join("\n");
  const scores = await assessAiCriteria(llmEngine, { subject, criteria });
  const channelName = ch.name || ch.title || "this channel";
  const aboutText = String(ch.description || "");
  const aboutWords = aboutText.trim() ? aboutText.trim().split(/\s+/).length : 0;
  const videoCount = Array.isArray(videos) ? videos.length : 0;
  // Trust fix lists ONLY what is actually missing (measured above) — never
  // demands a profile photo the channel already has.
  const trustMissing = [];
  if (!(brand.avatar || ch.thumbnails)) trustMissing.push("add your own profile photo");
  if (!(Array.isArray(brand.relatedChannels) || !!brand.googlePlus)) trustMissing.push("add your website links");
  if (aboutWords < 50) trustMissing.push("write 50+ words in About");
  const trustFix = trustMissing.length
    ? trustMissing.join(", ").replace(/, ([^,]*)$/, " and $1")
    : "polish your About story and keep every claim honest";
  // The niche keyword is only trustworthy with 3+ analyzed videos. With a tiny
  // sample one stray word (e.g. from a single video title) would otherwise be
  // forced on the user as "your niche" — so use generic wording instead.
  const nicheCertain = !!niche && videoCount >= 3;
  const messageCriteria = nicheCertain ? criteria : (criteria || []).map((c) =>
    c.key === "niche_clarity"
      ? { ...c, recommendationTemplate: "Viewers can't tell what your channel is about ({{score}}/10). Only {{videoCount}} video(s) checked, so the topic is unclear. Fix: add your topic word (the word viewers search for) to your name '{{name}}'. Start your About with that word in the first line." }
      : c,
  );
  const params = scores ? aiCriteriaParams(messageCriteria, scores, {
    name: channelName,
    niche: nicheCertain ? niche : "your topic",
    coherence: coherencePct == null ? "n/a" : `${coherencePct}%`,
    aboutWords,
    videoCount,
    // Trust fix lists ONLY what is actually missing (measured above) — never
    // demands a profile photo the channel already has.
    trustFix,
  }) : [];
  return { params, aiTotal: enginePctOf(params) };
}

// General AI side: compact video-stats summary (counts, cadence numbers,
// shorts share, engagement) scored against generalOutlook.
async function assessGeneralAICriteria(llmEngine, { videos, optimizerCriteria, focusNiche: declaredNiche }) {
  const criteria =
    Array.isArray(optimizerCriteria?.generalOutlook) && optimizerCriteria.generalOutlook.length
      ? optimizerCriteria.generalOutlook
      : DEFAULT_OPTIMIZER_CRITERIA.generalOutlook;
  const list = Array.isArray(videos) ? videos : [];
  const times = list
    .map((v) => Date.parse(v?.publishedAt || ""))
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => b - a);
  let cadenceLine = "insufficient date signal";
  if (times.length >= 2) {
    const gaps = [];
    for (let i = 1; i < times.length; i++) gaps.push((times[i - 1] - times[i]) / 86400000);
    const avgGap = gaps.reduce((s, x) => s + x, 0) / gaps.length;
    const daysSinceLast = (Date.now() - times[0]) / 86400000;
    cadenceLine = `${list.length} videos, avg gap ${avgGap.toFixed(1)} days, last upload ${daysSinceLast.toFixed(1)} days ago`;
  } else if (list.length) {
    cadenceLine = `${list.length} video(s), insufficient date signal`;
  }
  const shorts = list.filter(
    (v) => String(v?.title || "").toLowerCase().includes("#shorts") ||
      (v?.durationSec != null && Number(v.durationSec) <= 60),
  ).length;
  const totalViews = list.reduce((s, v) => s + (Number(v?.viewCount) || 0), 0);
  const totalLikes = list.reduce((s, v) => s + (Number(v?.likeCount) || 0), 0);
  const likeRate = totalViews > 0 ? ((totalLikes / totalViews) * 100).toFixed(2) : "n/a";
  const subject = [
    `Videos analyzed: ${cadenceLine}`,
    `Shorts share: ${shorts}/${list.length} carry a Shorts signal`,
    `Engagement: ${totalViews} views, like rate ${likeRate}%`,
  ].join("\n");
  const scores = await assessAiCriteria(llmEngine, { subject, criteria });
  const niche = String(declaredNiche || "").trim() || deriveNiche(list, "");
  const params = scores ? aiCriteriaParams(criteria, scores, {
    videoCount: list.length,
    shorts,
    likeRate: totalViews > 0 ? `${likeRate}%` : "n/a",
    cadence: cadenceLine,
    niche: niche || "your niche",
  }) : [];
  return { params, aiTotal: enginePctOf(params) };
}

// ── Playlist deterministic baselines (display/comparison only) ───────────────
// Earned points always come from the LLM score (weight * llmScore/100); these
// are kept as rawValue alongside so the report can compare heuristic vs AI.

// ordering_flow heuristic: a playlist has good binge flow when its watch
// order is an intentional sequence. Proxy: within each engine playlist, take
// the list order (by numeric `position` when the source rows carry it, else
// as-listed) and compare it against published-chronological order. A list
// sorted oldest-first OR newest-first counts as intentional; partial credit
// = share of adjacent pairs ordered in the better direction. Single-video
// playlists are trivially ordered (100). No engine membership at all -> 0.
function orderingFlowBaseline(videos = [], enginePlaylists = []) {
  const scoreOne = (members) => {
    const rows = (Array.isArray(members) ? members : []).map((v, i) => ({
      idx: typeof v?.position === "number" ? v.position : i,
      t: Date.parse(v?.publishedAt || ""),
    })).sort((a, b) => a.idx - b.idx);
    const times = rows.map((r) => r.t).filter((t) => !Number.isNaN(t));
    if (times.length < 2) return 50; // no date signal -> neutral, not zero
    let ascBad = 0;
    let descBad = 0;
    for (let i = 1; i < times.length; i++) {
      if (times[i] < times[i - 1]) ascBad += 1;
      if (times[i] > times[i - 1]) descBad += 1;
    }
    const n = times.length - 1;
    return Math.max(
      Math.round(((n - ascBad) / n) * 100),
      Math.round(((n - descBad) / n) * 100),
    );
  };
  const pls = Array.isArray(enginePlaylists) ? enginePlaylists : [];
  const multi = pls.filter((p) => Array.isArray(p?.videos) && p.videos.length >= 2);
  const singles = pls.filter((p) => Array.isArray(p?.videos) && p.videos.length === 1).length;
  if (!multi.length && !singles) return 0;
  const scores = multi.map((p) => scoreOne(p.videos));
  for (let i = 0; i < singles; i++) scores.push(100);
  return Math.round(scores.reduce((s, x) => s + x, 0) / scores.length);
}

// metadata_health heuristic: aggregate completeness of title/description/tags
// across the playlist's (analyzed input) videos. Per video each present field
// is 1/3 of 100; the baseline is the mean across videos.
function metadataHealthBaseline(videos = []) {
  const list = (Array.isArray(videos) ? videos : []).filter(Boolean);
  if (!list.length) return 0;
  const per = list.map((v) => {
    const hasTitle = String(v?.title || "").trim().length > 0 ? 1 : 0;
    const hasDesc = String(v?.description || "").trim().length > 0 ? 1 : 0;
    const hasTags = Array.isArray(v?.tags) && v.tags.length > 0 ? 1 : 0;
    return Math.round(((hasTitle + hasDesc + hasTags) / 3) * 100);
  });
  return Math.round(per.reduce((s, x) => s + x, 0) / per.length);
}

// ── Playlist adequacy vs channel volume ─────────────────────────────────────
// Full-audit playlists are an AUDIT of the channel's existing organization, so
// we compare the number of playlists against the TOTAL channel video count.
// A healthy catalog groups ~5-25 videos per playlist; far fewer playlists than
// that (e.g. 500 videos in 2-3 playlists) means the catalog is under-organized.
// Returns a 0-100 adequacy score plus the recommended playlist count range.
function playlistAdequacy(totalVideos, playlistCount) {
  if (!Number.isFinite(totalVideos) || totalVideos <= 0) {
    return { adequacyPct: null, recommendedMin: 0, recommendedMax: 0 };
  }
  const MIN_VPP = 5; // fewest videos per playlist that is still sensible
  const MAX_VPP = 25; // most videos per playlist before it becomes unwieldy
  const recommendedMin = Math.max(1, Math.ceil(totalVideos / MAX_VPP));
  const recommendedMax = Math.max(1, Math.ceil(totalVideos / MIN_VPP));
  if (!playlistCount || playlistCount <= 0) {
    return { adequacyPct: 0, recommendedMin, recommendedMax };
  }
  const perPlaylist = totalVideos / playlistCount;
  let adequacy = 100;
  if (perPlaylist > MAX_VPP) {
    adequacy = Math.round((100 * (MAX_VPP * 2)) / (perPlaylist + MAX_VPP));
  } else if (perPlaylist < MIN_VPP) {
    adequacy = Math.round(100 - ((MIN_VPP - perPlaylist) / MIN_VPP) * 40);
  }
  return {
    adequacyPct: Math.max(10, Math.min(100, adequacy)),
    recommendedMin,
    recommendedMax,
  };
}

// Replace {{token}} placeholders in a template from a vars object.
function interpolate(template, vars = {}) {
  if (!template || typeof template !== "string") return template || "";
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : `{{${k}}}`));
}

// Worst-first ordering for recommendations.
const SEV_RANK = { high: 3, medium: 2, low: 1 };
const sevRank = (s) => SEV_RANK[s] || 0;

// Look up a single threshold value from the profile-params array (mirrors how
// buildRecommendations keys by auditType+key). Falls back when unset.
function paramThreshold(profileParams, auditType, key, prop, fallback) {
  const def = (profileParams || []).find(
    (p) => p.auditType === auditType && p.key === key,
  );
  const v = def?.thresholds?.[prop];
  return typeof v === "number" ? v : fallback;
}

// ── Video selection (user-configurable sample window) ────────────────────────
// Default audit sample: the latest quarter (rolling 90 days), up to 15 videos.
// Scores should reflect the channel's CURRENT direction, and the LLM video
// engine bills per video. An explicit user window (recent N / since date)
// always wins. A quiet quarter (nothing published in 90 days) falls back to
// the latest videos so the audit still has a sample instead of failing empty.
const VIDEO_AUDIT_CAP = Math.min(100, Math.max(1, Number(process.env.AUDIT_VIDEO_CAP) || 100));
const AUDIT_SAMPLE_WINDOW_DAYS = 90;
const AUDIT_SAMPLE_DEFAULT_COUNT = 15;

function defaultVideoSelection() {
  return {
    mode: "since",
    since: new Date(Date.now() - AUDIT_SAMPLE_WINDOW_DAYS * 86400000).toISOString(),
    count: Math.min(AUDIT_SAMPLE_DEFAULT_COUNT, VIDEO_AUDIT_CAP),
  };
}

function sanitizeVideoSelection(selection) {
  const s = selection && typeof selection === "object" ? selection : {};
  const count = Math.max(1, Math.min(VIDEO_AUDIT_CAP, Number(s.count) || AUDIT_SAMPLE_DEFAULT_COUNT));
  if (s.mode === "since") {
    const t = Date.parse(String(s.since || ""));
    if (!Number.isNaN(t)) {
      return { mode: "since", since: new Date(t).toISOString(), count };
    }
    return { ...defaultVideoSelection(), count };
  }
  if (s.mode === "recent") return { mode: "recent", count };
  return defaultVideoSelection();
}

function selectVideos(videos, selection) {
  const sel = sanitizeVideoSelection(selection);
  let list = (Array.isArray(videos) ? videos : []).filter((v) => v && v.videoId);
  if (sel.mode === "since") {
    const since = Date.parse(sel.since);
    const inWindow = list.filter((v) => {
      const p = Date.parse(v.publishedAt || "");
      return !Number.isNaN(p) && p >= since;
    });
    // Empty quarter -> latest videos instead of an empty audit.
    list = inWindow.length ? inWindow : list;
  }
  list = [...list]
    .sort((a, b) => Date.parse(b.publishedAt || "") - Date.parse(a.publishedAt || ""))
    .slice(0, sel.count);
  return { videos: list, selection: sel };
}

// ── Algorithmic video scoring ────────────────────────────────────────────────
// Everything objectively checkable (lengths, counts, presence, overlap) is
// scored with plain math -- free, instant, deterministic. The LLM is reserved
// for the subjective categories (curiosity, click-worthiness, caption value,
// thumbnail pop). Checks are driven by the admin-configured `video` scoring
// params (optimizerCriteria.video), so thresholds stay editable in one place.

const wordCount = (t) => (String(t || "").trim().match(/\S+/g) || []).length;
const ratioPct = (value, threshold) => (threshold > 0 ? Math.min(100, Math.round((value / threshold) * 100)) : 0);
const TIMESTAMP_RE = /(^|\s)\d{1,2}:\d{2}/g;
const HASHTAG_RE = /#[\w-]+/g;

function videoCheckPct(key, v, videoDefs) {
  const th = (prop, fb) => {
    const def = (videoDefs || []).find((d) => d.key === key);
    const val = def?.thresholds?.[prop];
    return typeof val === "number" ? val : fb;
  };
  const title = String(v?.title || "").trim();
  const description = String(v?.description || "").trim();
  const tags = Array.isArray(v?.tags) ? v.tags : [];
  const keywords = Array.isArray(v?.customMetadata?.keywords)
    ? v.customMetadata.keywords
    : Array.isArray(v?.keywords)
      ? v.keywords
      : tags;
  switch (key) {
    case "title_quality": {
      if (!title) return 0;
      const min = th("minChars", 30);
      const max = th("maxChars", 70);
      const len = title.length;
      if (len < min) return ratioPct(len, min) * 0.9; // short title: partial credit
      if (len > max) return 80; // over-length risks truncation, not fatal
      return 100;
    }
    case "description_quality": {
      const min = th("minWords", 150);
      if (!description) return 0;
      return ratioPct(wordCount(description), min);
    }
    case "tags_quality": {
      const min = th("minCount", 8);
      if (!tags.length) return 0;
      return Math.min(100, ratioPct(tags.length, min) + (tags[0] && title.toLowerCase().includes(String(tags[0]).toLowerCase()) ? 20 : 0));
    }
    case "keywords_match": {
      if (!keywords.length) return 0;
      const hay = ` ${`${title} ${description}`.toLowerCase()} `;
      const hits = keywords.filter((k) => hay.includes(` ${String(k).toLowerCase()} `)).length;
      return ratioPct(hits, keywords.length);
    }
    case "hashtags": {
      const min = th("minCount", 2);
      return ratioPct((description.match(HASHTAG_RE) || []).length, min);
    }
    case "chapters": {
      const stamps = (description.match(TIMESTAMP_RE) || []).length;
      return stamps >= 3 ? 100 : stamps > 0 ? 50 : 0;
    }
    default:
      return null; // not algorithmically checkable (cards, playlist membership...)
  }
}

// Build params from the enabled `video` scoring params. Returns entries for the
// checks we have data for; per-param max is 100 * weight-scaled later by caller.
function scoreVideoAlgorithmic(videos, videoParams) {
  const defs = (Array.isArray(videoParams) && videoParams.length ? videoParams : DEFAULT_OPTIMIZER_CRITERIA.video)
    .filter((p) => p.enabled !== false);
  const out = [];
  for (const def of defs) {
    const pcts = videos
      .map((v) => videoCheckPct(def.key, v, defs))
      .filter((x) => x !== null);
    if (!pcts.length) continue; // no data for this check anywhere -> excluded
    const pct = Math.round(pcts.reduce((s, x) => s + x, 0) / pcts.length);
    out.push({
      key: `va_${def.key}`,
      label: def.displayLabel || def.label || def.key,
      category: def.category || "seo",
      max: Math.max(1, Number(def.weight) || 10),
      earned: Math.round((Math.max(1, Number(def.weight) || 10) * pct) / 100),
      rawValue: pct,
      recommendationTemplate: def.recommendationTemplate || "",
    });
  }
  return out;
}

function createAuditOrchestratorService(deps = {}) {
  const {
    gatherAuditInput,
    createAuditScoringService,
    getScoringProfile,
    getOptimizerCriteria,
    query,
    isPostgresConfigured,
    withClient,
    perfLog,
    perfNow,
  } = deps;

  // Pipeline timing (no-op unless PERF_LOG=1): attributes the next slow run
  // to fetch vs scoring vs persist instead of guessing.
  const timed = (label, startedAt, extra) => {
    try {
      if (typeof perfLog === "function") perfLog(label, startedAt, extra);
    } catch {
      /* timing never fails the audit */
    }
  };
  const now = () => (typeof perfNow === "function" ? perfNow() : Date.now());

  // Lazily-built deterministic scoring service (mirrors how routes consume it).
  let _scoring;
  const scoring = () => (_scoring ||= createAuditScoringService({}));

  // ── Sub-audit 1: Channel Identity & Trends ──
  async function runChannelIdentity(input, profileParams, optimizerCriteria = {}) {
    const base = await scoring().scoreChannel(input.channel, undefined, input.videos);
    const ch = input.channel || {};
    const brand = input.channel?.branding || {};
    const niche = focusNiche(input, input.videos, ch.description);
    const coherencePct = nicheCoherence(input.videos, niche);
    const videos = Array.isArray(input.videos) ? input.videos : [];

    // Publishing cadence and velocity trends — data-driven only. With too few
    // dated videos there is no cadence signal, so the checks are gated
    // (waiting on data), never assumed perfect.
    const gatedCriteria = [];
    const dates = videos.map(v => Date.parse(v?.publishedAt)).filter(d => !Number.isNaN(d)).sort((a, b) => b - a);
    let publishCadenceScore = null;
    if (dates.length >= 2) {
      const now = Date.now();
      const daysSinceLast = (now - dates[0]) / (1000 * 60 * 60 * 24);
      const maxGapDays = paramThreshold(profileParams, "CHANNEL_IDENTITY", "publish_cadence_trend", "maxGapDays", 21);
      publishCadenceScore = daysSinceLast <= maxGapDays ? 100 : Math.max(20, Math.round(100 * (maxGapDays / Math.max(maxGapDays, daysSinceLast))));
    } else {
      gatedCriteria.push("publish_cadence_trend");
    }
    let velocityChangeScore = null;
    if (videos.length >= 6) {
      const recent3 = videos.slice(0, 3);
      const prior3 = videos.slice(3, 6);
      const recentViews = recent3.reduce((s, v) => s + (Number(v?.viewCount) || 0), 0) / 3;
      const priorViews = prior3.reduce((s, v) => s + (Number(v?.viewCount) || 0), 0) / 3;
      if (priorViews > 0) {
        const ratio = recentViews / priorViews;
        velocityChangeScore = Math.min(100, Math.max(30, Math.round(ratio * 75)));
      }
    }
    if (velocityChangeScore == null) gatedCriteria.push("velocity_change_trend");

    const checks = [];
    const add = (key, label, ok, max = 100, raw = null) => checks.push({ key, label, max, earned: ok ? max : 0, rawValue: raw });

    // Branding verdicts are data-driven: a check scores only when its datum is
    // verifiable. Absent-but-unverifiable data gates (waiting on data) instead
    // of false-failing — e.g. brandingSettings stripped from key-only API
    // responses, or fields YouTube never exposes (watermark has no read
    // endpoint; channels have no category).
    // Undefined flag (older inputs/tests) means verifiable — back-compat.
    const brandingVerifiable = input.channel?.branding?.brandingVerifiable !== false;
    add("avatar_present", "Custom Profile Image", !!(brand.avatar || ch.thumbnails));
    if (brandingVerifiable) {
      add("banner_spec", "Banner Image Present", !!brand.image?.bannerExternalUrl);
      add("trailer_present", "Channel Trailer", !!(brand.trailer || brand.unsubscribedTrailer));
    } else {
      gatedCriteria.push("banner_spec", "trailer_present");
    }
    // Watermark/category are never exposed by the API: present = pass,
    // absent = unverifiable = gated (never failed).
    if (brand.watermark) add("watermark_set", "Subscribe Watermark", true);
    else gatedCriteria.push("watermark_set");
    if (Array.isArray(brand.sections)) {
      add("featured_sections", "Featured Sections", !!((brand.sections?.length || 0) > 0 || brand.unsubscribedTrailer));
    } else {
      gatedCriteria.push("featured_sections");
    }
    if (ch.categoryId) add("category_set", "Category Set", true);
    else gatedCriteria.push("category_set");
    // Links can only pass when link data is actually present — never assumed.
    if (Array.isArray(brand.relatedChannels) || !!brand.googlePlus) {
      add("links_valid", "Website / Social Links", true);
    } else {
      gatedCriteria.push("links_valid");
    }
    
    if (coherencePct != null) {
      const minMatchPct = paramThreshold(profileParams, "CHANNEL_IDENTITY", "niche_coherence", "minMatchPct", 70);
      checks.push({ key: "niche_coherence", label: "Niche Coherence", max: 100, earned: coherencePct >= minMatchPct ? coherencePct : 0, rawValue: coherencePct });
    }
    checks.push({ key: "publish_cadence_trend", label: "Publishing Cadence & Velocity", max: 100, earned: publishCadenceScore, rawValue: null });
    checks.push({ key: "velocity_change_trend", label: "Velocity & Growth Trend", max: 100, earned: velocityChangeScore, rawValue: null });

    const params = [
      ...base.breakdown.map((b) => ({ key: b.key, label: b.label, earned: b.earned, max: b.max, rawValue: null })),
      // Gated trend checks stay out of params entirely (waiting on data).
      ...checks.filter((c) => c.earned != null).map((c) => ({ key: c.key, label: c.label, earned: c.earned, max: c.max, rawValue: c.rawValue })),
    ];
    // Score = weighted blend: text metrics (name/desc/tags/niche) 50%, branding checks 30%, trends 20%.
    // This ensures params generating recommendations actually affect the displayed score.
    // A gated trend side is excluded and the blend renormalizes over what was measured.
    const textScore = clamp(base.total);  // 0-100 from scoreChannel (max sum ~100)
    const brandingChecks = checks.filter(c => ["avatar_present","banner_spec","watermark_set","trailer_present","featured_sections","category_set","links_valid","niche_coherence"].includes(c.key));
    const trendChecks = checks.filter(c => ["publish_cadence_trend","velocity_change_trend"].includes(c.key) && c.earned != null);
    const brandingScore = brandingChecks.length
      ? Math.round(brandingChecks.reduce((s, c) => s + (c.earned / (c.max || 1)), 0) / brandingChecks.length * 100)
      : 80;
    const trendScore = trendChecks.length
      ? Math.round(trendChecks.reduce((s, c) => s + (c.earned / (c.max || 1)), 0) / trendChecks.length * 100)
      : null;
    const totalAlgo = trendScore == null
      ? clamp(Math.round((textScore * 0.50 + brandingScore * 0.30) / 0.80))
      : clamp(Math.round(textScore * 0.50 + brandingScore * 0.30 + trendScore * 0.20));
    // ── AI engine (cheap text-only LLM assessment over channelBrand) ──
    // Missing/unreachable LLM degrades gracefully: aiTotal null -> algo-only
    // (same null-fallback rule as the video sub-audit).
    const channelBlend = resolveEngineBlend(
      optimizerCriteria?.channelBlend,
      DEFAULT_OPTIMIZER_CRITERIA.channelBlend,
    );
    const assessed = await assessChannelAICriteria(deps.llmEngine, {
      channel: ch,
      niche,
      coherencePct,
      optimizerCriteria,
      videos,
      focusBlock: input.focusBlock,
    });
    const aiParams = assessed?.params || [];
    const aiTotal = assessed?.aiTotal ?? null;
    const total = blendEngineTotals(totalAlgo, aiTotal, channelBlend);
    // One combined card per dimension (backend weighted blend) — the UI shows
    // these params verbatim, never separate algorithmic/AI scores.
    const finalParams = attachParamImpacts("CHANNEL_IDENTITY", mergeDimensionParams(CHANNEL_DIMENSIONS, [...params, ...aiParams], channelBlend));
    return {
      type: "channelIdentity",
      score: total,
      grade: "n/a",
      params: finalParams,
      recommendations: buildRecommendations("CHANNEL_IDENTITY", finalParams, profileParams),
      reportUrl: null,
      meta: {
        niche,
        coherencePct,
        gatedCriteria,
        scoringEngine: "dual (algorithmic + AI, blended)",
        dataAvailability: input.dataAvailability || null,
      },
    };
  }

  // ── Sub-audit 2: Video Optimization & Retention ──
  // Thumbnail framing comes from the SINGLE source of truth:
  // config/optimizerCriteria.thumbnail (the same 12-pillar framework the
  // Thumbnail Optimizer uses). Each pillar is surfaced as its own scored
  // category for the admin cannot edit it elsewhere.
  async function runVideoSubAudit(input, profileParams, optimizerCriteria = {}, opts = {}) {
  // User-configurable sample window: recent N videos or everything since a
  // date (default: latest quarter, max 15; hard-capped at AUDIT_VIDEO_CAP).
    const { videos, selection } = selectVideos(
      Array.isArray(input?.videos) ? input.videos : [],
      opts?.videoSelection,
    );

    // Elements/checks with no data anywhere are gated (pending data), not
    // scored — spec §7: they stay visible in meta.gatedCriteria.
    const gatedCriteria = [];

    // Caption presence is only scoreable when the input actually carries
    // caption flags (YouTube contentDetails.caption "true"/"false"). The audit
    // input does not fetch captions, so an all-unknown sample must gate
    // (waiting on data) instead of scoring a false 0 with a bogus
    // "no captions" fix. Partial coverage scores over the flagged subset.
    const captionFlagged = videos.filter((v) => v?.caption === "true" || v?.caption === "false" || typeof v?.hasCaptions === "boolean");
    let captionsEarned = null;
    if (!videos.length) {
      captionsEarned = 50;
    } else if (captionFlagged.length > 0) {
      const has = captionFlagged.filter((v) => v?.caption === "true" || v?.hasCaptions === true).length;
      captionsEarned = Math.round((has / captionFlagged.length) * 100);
    } else {
      gatedCriteria.push("captions_present");
    }

    // Engagement is only measurable when the sample has views. Zero views =
    // no signal (gated), never an assumed 70.
    const totalLikes = videos.reduce((s, v) => s + (Number(v?.likeCount) || 0), 0);
    const totalViews = videos.reduce((s, v) => s + (Number(v?.viewCount) || 0), 0);
    let avgEngageEarned = null;
    if (totalViews > 0) {
      const likeRate = (totalLikes / totalViews) * 100;
      const minLikeRate = paramThreshold(profileParams, "VIDEO", "engagement_signals", "minLikeRatePct", 3.5);
      avgEngageEarned = Math.min(100, Math.round((likeRate / minLikeRate) * 80));
    } else {
      gatedCriteria.push("engagement_signals");
    }

    // ── Dual-engine scoring (BOTH always run, no fallback) ──
    // Algorithmic engine (free, deterministic): title/description lengths, tag
    // counts, keyword overlap, hashtags, chapters, captions %, engagement rate
    // — driven by the admin-configured `video` scoring params.
    // AI engine (LLM, same engine as /video-audit): scores EVERY non-thumbnail
    // element at full depth (title clarity/curiosity, description richness, tag
    // quality, keyword relevance, caption value) AND generates the real
    // "Recommended Alternative" copy (alt titles, description rewrite, suggested
    // tags/keywords) per video — the exact work the standalone Video Audit does,
    // so the Full Audit video sub-run scores and details match it.
    // The `thumbnail` element is excluded entirely: gatherAuditInput doesn't
    // fetch thumbnails (per the "disable thumbnail in the full audit" decision;
    // the 12-pillar Thumbnail Optimizer path covers thumbnails). Final score =
    // admin-configurable weighted average of the two engine scores
    // (optimizerCriteria.videoBlend).
    const videoElements =
      (optimizerCriteria?.videoElements && optimizerCriteria.videoElements.length
        ? optimizerCriteria.videoElements
        : DEFAULT_OPTIMIZER_CRITERIA.videoElements)
      .filter((c) => c.element !== "thumbnail");
    // The AI engine scores ALL of these at depth (not just a few subjective
    // keys) so the Full Audit video results match the standalone Video Audit.
    const aiElements = videoElements;
    const videoParams =
      Array.isArray(optimizerCriteria?.video) && optimizerCriteria.video.length
        ? optimizerCriteria.video
        : DEFAULT_OPTIMIZER_CRITERIA.video;
    const algoParams = scoreVideoAlgorithmic(videos, videoParams);

    // Admin-configurable engine blend (0-100 each; falls back to 50/50).
    const rawBlend = optimizerCriteria?.videoBlend || DEFAULT_OPTIMIZER_CRITERIA.videoBlend || {};
    let wAlgo = Math.max(0, Math.min(100, Number(rawBlend.algorithmic) || 0));
    let wAI = Math.max(0, Math.min(100, Number(rawBlend.ai) || 0));
    if (wAlgo + wAI <= 0) { wAlgo = 50; wAI = 50; }

    if (!deps.videoAuditEngine?.auditBatch) {
      throw new Error("Video AI engine is not configured -- cannot run the video sub-audit.");
    }
    // Analyze exactly the user's selected window (videos.length) at full depth.
    // The user chooses the window in the UI (Most recent N / since date, up to
    // 100) — that choice is authoritative; there is no hidden sample cap.
    const sampleLimit = videos.length;
    const niche = focusNiche(input, videos, "");
    const inputs = videos.slice(0, sampleLimit).map((v) => ({
        videoId: v.videoId || "",
        title: v.title || "",
        description: v.description || "",
        tags: Array.isArray(v.tags) ? v.tags : [],
        keywords: Array.isArray(v.tags) ? v.tags : [],
        thumbnail: { url: v.thumbnail?.url || "" },
        captions: [],
      }));
      // "full" mode = the real standalone Video Audit engine pipeline: it scores
      // every element AND generates per-video recommendations + AI suggestion
      // copy. Thumbnail vision still never runs because the thumbnail element is
      // filtered out above (and gatherAuditInput provides no thumbnail URL).
    let elementParams = [];
      console.log(`[AuditOrchestrator] VIDEO sub-audit: FULL pipeline on ${inputs.length} video(s), ${(aiElements||[]).length} AI element(s), mode=full`);
      const batch = await deps.videoAuditEngine.auditBatch(
        inputs,
        aiElements,
        niche,
        "full",
        // auditBatch reports 0-100 percent; the pipeline normalizes to 0-1.
        (percent) => {
          try {
            o.onProgress?.("video", (Number(percent) || 0) / 100);
          } catch {
            /* progress is best-effort */
          }
        },
      );
      if (!batch || !Array.isArray(batch.results) || !batch.results.length) {
        throw new Error("Video AI engine returned no results.");
      }
      // Elements with no data anywhere are gated (pending data), not scored —
      // spec §7: they stay visible in meta.gatedCriteria instead of vanishing.
      for (const c of aiElements) {
        // Mean per-criterion score (0-10) across the sampled videos that had
        // data for this element. Criteria with no data anywhere are skipped
        // entirely so an absent element can't drag the score (same rule the
        // standalone audit applies).
        const scores = [];
        for (const r of batch.results) {
          const b = Array.isArray(r.breakdown) ? r.breakdown.find((x) => x.key === c.key) : null;
          if (b && b.max > 0) scores.push(Number(b.score) || 0);
        }
        if (!scores.length) {
          gatedCriteria.push(c.key);
          continue;
        }
        const points = Math.max(1, Number(c.weight) || 10);
        const avg = scores.reduce((s, x) => s + x, 0) / scores.length;
        const avgRounded = Math.round(avg * 10) / 10;
        elementParams.push({
          key: `ve_${c.key}`,
          // Clean label (criterion label verbatim, no engine/category prefixes):
          // the final score shown is already the backend weighted blend of the
          // deterministic + AI engines, so params read like the rest.
          label: c.label,
          category: c.category,
          max: points,
          earned: Math.round(points * (avg / 10)),
          rawValue: Math.round(avg * 10),
          recommendationTemplate: interpolate(c.recommendationTemplate ||
            `${c.label} is weak (${avgRounded}/10) in ${scores.length} video(s). Fix: improve it using the tips on this page.`, {
            label: c.label,
            score: avgRounded,
            max: 10,
            videoCount: scores.length,
            niche: niche || "your niche",
          }),
          vars: { score: avgRounded, videoCount: scores.length, niche: niche || "your niche", label: c.label },
        });
      }

    // Aggregate checks use the admin-configured criterion weights (not 100pts)
    // so one check can't dwarf the per-video criteria in the engine blend or
    // produce absurd "+25 pts" impacts. Gated checks (earned null) stay out.
    const checkWeight = (key, fb) => {
      const w = Number((videoParams || []).find((d) => d.key === key)?.weight);
      return Number.isFinite(w) && w > 0 ? w : fb;
    };
    const checks = [];
    if (captionsEarned != null) {
      const w = checkWeight("captions_present", 9);
      checks.push({ key: "captions_present", label: "Captions / Subtitles", max: w, earned: Math.round((w * captionsEarned) / 100), rawValue: captionsEarned });
    }
    if (avgEngageEarned != null) {
      const w = checkWeight("engagement_signals", 12);
      checks.push({ key: "engagement_signals", label: "Engagement Signals", max: w, earned: Math.round((w * avgEngageEarned) / 100), rawValue: null });
    }

    // Each engine produces its OWN 0-100 score (weighted % earned of its own
    // criteria). The final score is the admin-configured weighted average of
    // the two engine scores (optimizerCriteria.videoBlend, default 50/50).
    const enginePct = (list) => {
      const max = list.reduce((s, p) => s + (Number(p.max) || 0), 0);
      const earned = list.reduce((s, p) => s + (Number(p.earned) || 0), 0);
      return max > 0 ? clamp(Math.round((earned / max) * 100)) : null;
    };
    const algoTotal = enginePct([...algoParams, ...checks]);
    const aiTotal = enginePct(elementParams);
    const wSum = wAlgo + wAI;
    // If either engine produced no scoreable criteria (all no-data), fall back
    // to whichever engine has data so the sub-audit still returns a score.
    let total;
    if (algoTotal == null && aiTotal == null) total = 0;
    else if (aiTotal == null || wAI === 0) total = algoTotal;
    else if (algoTotal == null || wAlgo === 0) total = aiTotal;
    else total = clamp(Math.round((algoTotal * wAlgo + aiTotal * wAI) / wSum));

    const params = attachParamImpacts("VIDEO", mergeDimensionParams(
      VIDEO_DIMENSIONS,
      [...algoParams, ...elementParams, ...checks],
      { algorithmic: wAlgo, ai: wAI },
    ));
    // Full per-video depth, not just aggregate scores: pull the real engine's
    // per-video score, its recommendations, and the actual AI-generated
    // "Recommended Alternative" copy (alt titles, description rewrite, suggested
    // tags/keywords) so the Full Audit report shows the SAME deep detail the
    // standalone Video Audit page does -- not a lightweight summary.
    const results = Array.isArray(batch?.results) ? batch.results : [];
    const byVideoId = new Map(results.map((r) => [r?.videoId, r]));
    const videoList = videos.map((v) => {
      const r = byVideoId.get(v.videoId || "") || null;
      return {
        videoId: v.videoId || "",
        title: v.title || "Untitled Video",
        description: v.description || "",
        publishedAt: v.publishedAt || null,
        viewCount: Number(v.viewCount) || 0,
        likeCount: Number(v.likeCount) || 0,
        commentCount: Number(v.commentCount) || 0,
        url: v.videoId ? `https://www.youtube.com/watch?v=${v.videoId}` : "",
        // Deep engine output per video -- exactly what the standalone Video Audit
        // page renders for a single video: its 0-100 score, per-element 0-10
        // scores, the full criterion breakdown, recommendations, and the real
        // AI-generated "Recommended Alternative" copy.
        score: typeof r?.total === "number" ? r.total : null,
        projectedTotal: typeof r?.projectedTotal === "number" ? r.projectedTotal : null,
        elements: Array.isArray(r?.elements) ? r.elements : [],
        breakdown: Array.isArray(r?.breakdown) ? r.breakdown : [],
        recommendations: Array.isArray(r?.recommendations) ? r.recommendations : [],
        suggestions: r?.suggestions && Object.keys(r.suggestions).length ? r.suggestions : null,
      };
    });
    // How much actionable depth this run produced (visible in the report).
    const detailedVideoCount = videoList.filter((v) => v.score != null || (v.suggestions && Object.keys(v.suggestions).length)).length;

    return {
      type: "video",
      score: total,
      grade: "n/a",
      params,
      recommendations: buildRecommendations("VIDEO", params, profileParams),
      reportUrl: "/video-audit",
      meta: {
        videoCount: videos.length,
        videos: videoList,
        // Criteria with no data anywhere (e.g. captions never fetched) are
        // gated — excluded from scoring, listed here as waiting on data.
        gatedCriteria,
        dataAvailability: input.dataAvailability || null,
        // Depth of this run: every video in the user's chosen window gets full
        // engine analysis (per-video score + recommendations + AI suggestions).
        // `sampleLimit` equals the window (`videoCount`).
        deepAnalysisCount: detailedVideoCount,
        sampleLimit,
        scoringEngine: "dual (algorithmic + AI, blended) -- full per-video detail",
        videoSelection: selection,
      },
      // Raw engine output (the exact auditBatch result) captured so the
      // orchestrator can record this run in the standalone Video Audit
      // history (video_audits) after persisting the run. Not persisted in
      // the sub-run JSON (too large) -- consumed by persistEngineHistories.
      _history: { kind: "video", results: batch },
    };
  }
  // ── Sub-audit 3: Playlist Strategy & Flow ──
  // Reuses the REAL Playlist Optimizer engine (the same DeepSeek LLM the
  // /playlist-optimizer page uses) so a channel's playlist strategy scores
  // IDENTICALLY whether audited standalone or inside the Full Audit. The LLM
  // returns a criteriaBreakdown (0-100 per criterion); each admin-configured
  // playlist criterion becomes a scored param (earned = weight × score/100),
  // with the deterministic baseline kept as rawValue for comparison.
  async function runPlaylistSubAudit(input, profileParams, optimizerCriteria = {}, opts = {}) {
    const playlists = Array.isArray(input?.playlists) ? input.playlists : [];
    // Catalog adequacy: the sub-audit analyzes the channel's playlist
    // organization, so the verdict (enough playlists for the catalog?) must be
    // judged against the FULL channel video inventory.
    const allInventory = Array.isArray(input?.videos) ? input.videos : [];
    const totalChannelVideos = allInventory.length;
    const adequacy = playlistAdequacy(totalChannelVideos, playlists.length);
    // This is an AUDIT of the channel's EXISTING playlists, so the engine gets
    // EVERY membership-tagged video -- all playlists with their full inventory.
    // The small recent-videos sample exists only for the video/cadence
    // sub-audits. Falls back to the sampled window (NEW mode) only when no
    // membership data was gathered (channel has no playlists, or the
    // playlistItems fetch failed) -- there is nothing to audit then.
    const memberVideos = allInventory.filter(
      (v) => v?.originalPlaylistId || v?.customMetadata?.originalPlaylistId,
    );
    const sel = selectVideos(allInventory, opts?.videoSelection);
    const videos = memberVideos.length ? memberVideos : sel.videos;
    const videoSelection = memberVideos.length
      ? { mode: "existing", count: videos.length }
      : sel.selection;
    const criteria =
      Array.isArray(optimizerCriteria?.playlist) && optimizerCriteria.playlist.length > 0
        ? optimizerCriteria.playlist
        : DEFAULT_OPTIMIZER_CRITERIA.playlist;
    // Deterministic baseline per playlist dimension (kept as rawValue for
    // comparison with the LLM score).
    const base = await scoring().scorePlaylist(playlists);

    const basePct = (key) => {
      const b = (base.breakdown || []).find((x) => x.key === key);
      return b && b.max > 0 ? Math.round((b.earned / b.max) * 100) : 0;
    };
    const titlePct = basePct("title");
    const descPct = basePct("description");
    const tagsPct = basePct("tags");
    const keywordPct = Math.max(basePct("keywords"), tagsPct);

    // Thematic coherence: how consistently videos cluster around one niche.
    let coherencePct = 50;
    if (videos.length) {
      const niche = focusNiche(input, videos, "");
      const c = nicheCoherence(videos, niche);
      coherencePct = c == null ? 50 : c;
    }

    const pctFor = (key) => {
      switch (key) {
        case "title_ctr": return titlePct;
        case "seo_description": return descPct;
        case "keywords": return keywordPct;
        case "tags": return tagsPct;
        case "theme_coherence": return coherencePct;
        // ordering_flow baseline: deterministic watch-order coherence from
        // video positions/published sequence (see orderingFlowBaseline).
        case "ordering_flow": {
          const pls = analysis?.results && Array.isArray(analysis.results.playlists) ? analysis.results.playlists : [];
          return orderingFlowBaseline(videos, pls);
        }
        // metadata_health baseline: aggregate title/desc/tags completeness
        // across the playlist's videos (see metadataHealthBaseline).
        case "metadata_health": return metadataHealthBaseline(videos);
        // Virality baseline: mean of the engine's per-playlist virality scores.
        case "virality_potential": {
          const pls = analysis?.results && Array.isArray(analysis.results.playlists) ? analysis.results.playlists : [];
          const vs = pls.map((p) => Number(p?.viralityScore) || 0).filter((x) => x > 0);
          return vs.length ? Math.round(vs.reduce((s, x) => s + x, 0) / vs.length) : 0;
        }
        // Coverage baseline: share of input videos the engine placed in a playlist.
        case "video_coverage": {
          const pls = analysis?.results && Array.isArray(analysis.results.playlists) ? analysis.results.playlists : [];
          const assigned = new Set();
          for (const p of pls) for (const v of p?.videos || []) assigned.add(v?.videoId || v?.id);
          return videos.length ? Math.min(100, Math.round((assigned.size / videos.length) * 100)) : 0;
        }
        // Audience/niche targeting has no deterministic proxy -- reuse coherence.
        case "audience_targeting": return coherencePct;
        default: return Math.round((titlePct + descPct + tagsPct + coherencePct) / 4);
      }
    };

    // ── Real Playlist Optimizer engine (required, no fallback) ──
    if (!deps.playlistOptimizerEngine?.analyze) {
      throw new Error("Playlist Optimizer engine is not configured -- cannot run the playlist sub-audit.");
    }
    if (!videos.length) {
      throw new Error("No videos found for this channel -- playlist strategy cannot be evaluated.");
    }
    // Pass the channel title so the saved analysis's meta carries a readable
    // channelIdentifier (the Playlist Optimizer "Analysis Details" panel shows
    // a "Connected channel" placeholder when it is empty).
    // Full Audit audits the channel's EXISTING playlists: videos annotated with
    // originalPlaylistId (gatherAuditInput) + EXISTING analysisMode make the
    // engine evaluate the real playlists (measured facts include their current
    // title/description/tags). NEW mode is only the fallback when the channel
    // has no playlists (or membership fetch failed) — there is nothing to audit
    // then, so recommending a structure is the useful output.
    const hasExistingMembership = videos.some((v) => v?.originalPlaylistId);
    const engineFilterConfig = hasExistingMembership ? { analysisMode: "EXISTING" } : {};
    const analysis = await deps.playlistOptimizerEngine.analyze(videos, input.channel?.title || input.channelIdentifier || "", engineFilterConfig, input.channelFocus);
    const breakdown = Array.isArray(analysis?.results?.audit?.criteriaBreakdown)
      ? analysis.results.audit.criteriaBreakdown
      : [];
    if (!breakdown.length) {
      throw new Error("Playlist Optimizer engine returned no criteria breakdown.");
    }
    // Match LLM breakdown entries to admin criteria by key OR label (the
    // prompt asks for one entry per criterion; models sometimes echo labels).
    const norm = (s) => String(s).trim().toLowerCase();
    const llmFor = (c) => {
      const hit =
        breakdown.find((b) => norm(b.criterion) === norm(c.key)) ||
        breakdown.find((b) => norm(b.criterion) === norm(c.label));
      return hit || null;
    };

    // ── Dual-engine per-criterion blend ──
    // earned = weight * (algoBaseline*wAlgo + aiScore*wAI)/100 / 100: each
    // criterion blends its deterministic baseline (pctFor, kept as rawValue)
    // with its LLM score using the admin-configured playlistBlend (default
    // 50/50). Unmatched LLM criteria stay excluded (no-data rule).
    const playlistBlend = resolveEngineBlend(
      optimizerCriteria?.playlistBlend,
      DEFAULT_OPTIMIZER_CRITERIA.playlistBlend,
    );
    const wAlgoPl = playlistBlend.algorithmic;
    const wAIPl = playlistBlend.ai;

    const gatedCriteria = [];
    // Catalog coverage: deterministic param scored purely on whether the channel
    // has enough playlists for its total video count (5-25 videos per playlist
    // is healthy). Excluded when the video inventory is empty (no data to judge).
    const coverageParam = adequacy.adequacyPct === null ? null : {
      key: "pl_catalog_coverage",
      label: "Catalog Coverage (playlists vs videos)",
      category: "playlistStrategy",
      max: 10,
      earned: Math.round((10 * adequacy.adequacyPct) / 100),
      rawValue: adequacy.adequacyPct,
      vars: {
        totalVideos: totalChannelVideos,
        playlistCount: playlists.length,
        recommendedMin: adequacy.recommendedMin,
        recommendedMax: adequacy.recommendedMax,
      },
      recommendationTemplate:
        "Your channel has {{totalVideos}} videos in {{playlistCount}} playlist(s). Healthy catalogs group 5-25 videos per playlist (about {{recommendedMin}}-{{recommendedMax}} playlists here). Fix: group your videos into playlists by topic or series.",
    };
    const params = attachParamImpacts("PLAYLIST", criteria.map((c) => {
      const points = Math.max(1, Number(c.weight) || 10);
      const hit = llmFor(c);
      const score = hit ? Math.max(0, Math.min(100, Number(hit.score) || 0)) : null;
      // Unmatched LLM criteria are gated (pending data), not zeroed — recorded
      // in meta.gatedCriteria below instead of vanishing silently.
      if (score === null) gatedCriteria.push(c.key);
      const algoPct = pctFor(c.key);
      return {
        key: `pl_${c.key}`,
        label: c.label,
        category: "playlistStrategy",
        max: points,
        // Unmatched criteria are excluded (null earned) so an absent LLM entry
        // can't silently zero out a dimension -- same no-data rule as video.
        earned: score === null ? null : Math.round((points * ((algoPct * wAlgoPl + score * wAIPl) / 100)) / 100),
        rawValue: algoPct,
        recommendationTemplate: hit?.note
          ? `Playlist: ${c.label} -- ${hit.note}`
          : `Playlist: ${c.label} -- ${c.instruction || "Improve this playlist criterion."}`,
      };
    }).filter((p) => p.earned !== null).concat(coverageParam ? [coverageParam] : []));

    // Score = weighted % earned across the centralized criteria (points are the weights).
    const pointsSum = params.reduce((s, p) => s + p.max, 0);
    const earnedSum = params.reduce((s, p) => s + p.earned, 0);
    const total = pointsSum ? Math.round((earnedSum / pointsSum) * 100) : 0;
    // Engine diagnostics: each side's own weighted % over the included params.
    // (The blended total above always equals the playlistBlend combination of
    // these two, since every criterion uses the same weights.)
    const algoTotal = enginePctOf(params.map((p) => ({
      max: p.max,
      earned: Math.round((p.max * (Number(p.rawValue) || 0)) / 100),
    })));
    const aiTotal = (() => {
      const rows = [];
      for (const p of params) {
        const c = criteria.find((x) => `pl_${x.key}` === p.key);
        const hit = c ? llmFor(c) : null;
        const score = hit ? Math.max(0, Math.min(100, Number(hit.score) || 0)) : null;
        if (score === null) continue;
        rows.push({ max: p.max, earned: Math.round((p.max * score) / 100) });
      }
      return enginePctOf(rows);
    })();

    // Channel-wide playlist breakdown from the FULL inventory (all playlists +
    // every video's membership), not the 15-video engine sample -- the sample
    // can only ever list the 1-2 playlists its videos happen to belong to.
    const allVideos = Array.isArray(input?.videos) ? input.videos : [];
    const membershipCounts = new Map();
    for (const v of allVideos) {
      const plId = v?.originalPlaylistId || v?.customMetadata?.originalPlaylistId;
      if (!plId) continue;
      const entry = membershipCounts.get(plId) || {
        playlistId: plId,
        title: v.customMetadata?.originalPlaylistTitle || plId,
        videoCount: 0,
      };
      entry.videoCount += 1;
      membershipCounts.set(plId, entry);
    }
    // Include playlists whose sampled membership is unknown (item fetch
    // covered only the first 50 items), labelled with their stored size.
    const playlistsIncluded = playlists.map((pl) => {
      const counted = membershipCounts.get(pl.playlistId);
      return counted || {
        playlistId: pl.playlistId,
        title: pl.title || pl.playlistId,
        videoCount: Number(pl.size) || 0,
        approx: true,
      };
    });

    return {
      type: "playlist",
      score: total,
      grade: "n/a",
      params,
      recommendations: buildRecommendations("PLAYLIST", params, profileParams),
      reportUrl: "/playlist-optimizer",
      meta: {
        playlistCount: playlists.length,
        // Full channel inventory (not the audit sample) so consumers can judge
        // whether the playlist count fits the catalog size.
        totalVideoCount: totalChannelVideos,
        playlistAdequacy: adequacy.adequacyPct === null ? null : adequacy,
        // All of the channel's playlists with channel-wide video counts --
        // replaces the engine's sample-scoped playlistsIncluded.
        playlistsIncluded,
        videoCount: videos.length,
        videoSelection,
        criteriaCount: criteria.length,
        gatedCriteria,
        dataAvailability: input.dataAvailability || null,
        scoringEngine: "playlistOptimizerEngine (LLM) + deterministic baselines, blended",
        summary: analysis?.results?.summary || null,
      },
      // Raw Playlist Optimizer output kept on the sub-run. persistEngineHistories
      // records it in playlist_audits (as "Full Audit -- <date>") so the
      // Playlist Optimizer deep link (?audit=<id>) can open this analysis
      // directly. Not embedded in the sub-run JSON (it lives in the history row).
      // The saved meta gets the channel-wide playlistsIncluded override too, so
      // the deep-linked view lists ALL the channel's playlists, not just the
      // ones the 15-video sample touched.
      _history: {
        kind: "playlist",
        audits:
          analysis?.results && Array.isArray(analysis.results.playlists)
            ? {
                ...analysis.results,
                meta: {
                  ...(analysis.results.meta || {}),
                  playlistsIncluded,
                  totalVideoCount: totalChannelVideos,
                  playlistAdequacy: adequacy.adequacyPct === null ? null : adequacy,
                },
              }
            : null,
        totalVideos: Array.isArray(analysis?.results?.playlists)
          ? analysis.results.playlists.reduce((sum, p) => sum + (p.videos?.length || 0), 0)
          : 0,
      },
    };
  }

  // ── Sub-audit 4: General Cadence & Growth ──
  async function runGeneralSubAudit(input, profileParams, optimizerCriteria = {}) {
    const videos = Array.isArray(input?.videos) ? input.videos : [];
    const base = await scoring().scoreGeneral(videos);

    const shortsCount = videos.filter(v => (v?.title || "").toLowerCase().includes("#shorts") || (Number(v?.durationSec) || 0) <= 60).length;

    // Context for actionable deterministic messages (what's wrong + how to fix).
    const totalViews = videos.reduce((s, v) => s + (Number(v?.viewCount) || 0), 0);
    const totalLikes = videos.reduce((s, v) => s + (Number(v?.likeCount) || 0), 0);
    const likeRateDisplay = totalViews > 0 ? `${((totalLikes / totalViews) * 100).toFixed(1)}%` : "n/a";
    const niche = focusNiche(input, videos, "");
    const freq = {};
    for (const v of videos) {
      for (const w of new Set(String(v?.title || "").toLowerCase().split(/\W+/).filter((x) => x && x.length > 2))) freq[w] = (freq[w] || 0) + 1;
    }
    const topics = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w).join(", ") || "unknown";
    const times = videos.map((v) => Date.parse(v?.publishedAt || "")).filter((t) => !Number.isNaN(t)).sort((a, b) => b - a);
    let cadenceLine = "insufficient date signal";
    let avgGapDays = null;
    let daysSinceLastUpload = null;
    if (times.length >= 2) {
      const gaps = [];
      for (let i = 1; i < times.length; i++) gaps.push((times[i - 1] - times[i]) / 86400000);
      avgGapDays = gaps.reduce((s, x) => s + x, 0) / gaps.length;
      daysSinceLastUpload = (Date.now() - times[0]) / 86400000;
      cadenceLine = `${videos.length} videos, avg gap ${avgGapDays.toFixed(1)} days, last upload ${daysSinceLastUpload.toFixed(1)} days ago`;
    } else if (videos.length) {
      cadenceLine = `${videos.length} video(s), insufficient date signal`;
    }
    // Frequency-aware wording: frequent-but-irregular posting is a different
    // problem (and fix) than rare posting — the message must match the numbers.
    const uploadConsistencyTemplate = videos.length < 3
      ? "You have only {{videoCount}} video(s) ({{score}}/{{max}}). Fix: post one video each week on the same day."
      : avgGapDays != null && avgGapDays <= 7
        ? "You post often (about every {{avgGap}} days) but at random times ({{score}}/{{max}}). Fix: post on the same days each week."
        : "You post rarely ({{cadence}}, {{score}}/{{max}}). Fix: post one video each week on the same day.";
    const generalVars = {
      videoCount: videos.length,
      likeRate: likeRateDisplay,
      niche: niche || "your niche",
      topics,
      cadence: cadenceLine,
      shorts: shortsCount,
      avgGap: avgGapDays != null ? `~${avgGapDays.toFixed(1)}` : "n/a",
      daysSinceLast: daysSinceLastUpload != null ? daysSinceLastUpload.toFixed(0) : "n/a",
    };
    const generalFallback = {
      uploadConsistency: uploadConsistencyTemplate,
      engagement: "Viewers don't like or comment much ({{score}}/{{max}}, likes {{likeRate}}). Fix: start videos with something exciting and ask one question.",
      contentSwitch: videos.length < 2
        ? "Focus can't be measured yet ({{score}}/{{max}}, only {{videoCount}} video checked). Fix: post one video each week about one topic."
        : "Your videos are about mixed topics ({{score}}/{{max}}: {{topics}}). Fix: make your next 10 videos about '{{niche}}'.",
      shorts_balance: "Wrong mix of short and long videos ({{score}}/{{max}}: {{shorts}} shorts out of {{videoCount}}). Fix: for each long video, post one short video too.",
    };

    // Format mix needs enough videos to judge — with fewer than 4 there is no
    // mix signal, so it is gated (waiting on data), never an assumed 70.
    const gatedCriteria = [];
    const checks = [];
    if (videos.length >= 4) {
      const shortsMixScore = shortsCount > 0 && shortsCount < videos.length ? 90 : 75;
      checks.push({ key: "shorts_balance", label: "Shorts vs Long-form Balance", max: 100, earned: shortsMixScore, rawValue: shortsCount, recommendationTemplate: generalFallback.shorts_balance, vars: { ...generalVars } });
    } else {
      gatedCriteria.push("shorts_balance");
    }

    // ── AI engine (cheap text-only LLM assessment over generalOutlook) ──
    // Missing/unreachable LLM degrades gracefully: aiTotal null -> algo-only.
    const generalBlend = resolveEngineBlend(
      optimizerCriteria?.generalBlend,
      DEFAULT_OPTIMIZER_CRITERIA.generalBlend,
    );
    const assessed = await assessGeneralAICriteria(deps.llmEngine, { videos, optimizerCriteria, focusNiche: input.channelFocus?.niche });
    const aiParams = assessed?.params || [];
    const aiTotal = assessed?.aiTotal ?? null;
    const algoTotal = clamp(base.total);
    const total = blendEngineTotals(algoTotal, aiTotal, generalBlend);

    const params = attachParamImpacts("GENERAL", mergeDimensionParams(
      GENERAL_DIMENSIONS,
      [
        ...base.breakdown.map((b) => ({ key: b.key, label: b.label, earned: b.earned, max: b.max, rawValue: null, recommendationTemplate: generalFallback[b.key] || "", vars: { ...generalVars } })),
        ...checks,
        ...aiParams,
      ],
      generalBlend,
    ));
    return {
      type: "general",
      score: total,
      grade: "n/a",
      params,
      recommendations: buildRecommendations("GENERAL", params, profileParams),
      reportUrl: null,
      meta: {
        sampleSize: videos.length,
        gatedCriteria,
        scoringEngine: "dual (algorithmic + AI, blended)",
        dataAvailability: input.dataAvailability || null,
      },
    };
  }

function calculateParamImpact(auditType, key, earned, max) {
  const m = max > 0 ? max : 100;
  const e = Math.min(m, Math.max(0, earned || 0));
  const lostRatio = (m - e) / m;
  if (lostRatio <= 0) return { impactGain: 0, impactPenalty: 0 };

  let baseWeight = 4;
  if (auditType === "CHANNEL_IDENTITY") {
    const brandingKeys = ["avatar_present","banner_spec","watermark_set","trailer_present","featured_sections","category_set","links_valid","niche_coherence"];
    const trendKeys = ["publish_cadence_trend","velocity_change_trend"];
    if (brandingKeys.includes(key)) {
      baseWeight = 4;
    } else if (trendKeys.includes(key)) {
      baseWeight = 10;
    } else {
      baseWeight = Math.max(3, Math.round((m / 100) * 50));
    }
  } else if (auditType === "VIDEO") {
    baseWeight = Math.max(3, Math.round((m / 100) * 25));
  } else if (auditType === "PLAYLIST") {
    baseWeight = Math.max(3, Math.round((m / 100) * 25));
  } else if (auditType === "GENERAL") {
    baseWeight = Math.max(4, Math.round((m / 100) * 33));
  }

  const gain = Math.max(1, Math.round(lostRatio * baseWeight));
  return { impactGain: gain, impactPenalty: -gain };
}

function attachParamImpacts(auditType, params) {
  return (params || []).map((p) => {
    const imp = calculateParamImpact(auditType, p.key, p.earned, p.max);
    return {
      ...p,
      impactGain: imp.impactGain,
      impactPenalty: imp.impactPenalty,
    };
  });
}

// Safety-net fixes for deterministic params that arrive without a template
// (e.g. legacy scoreChannel/scoreGeneral breakdown keys or checks when the
// admin profile row has no recommendationTemplate). Prevents the generic
// "Label: 0/40 (needs improvement)" dead-end in the simulator.
const DETERMINISTIC_FALLBACKS = {
  identity: "Channel name or handle is weak ({{score}}/{{max}}). Fix: use a short name with your topic word in it.",
  uploadConsistency: "Upload rhythm is off ({{score}}/{{max}}). Fix: post one video each week on the same day.",
  engagement: "Viewers don't like or comment much ({{score}}/{{max}}, likes {{likeRate}}). Fix: start videos with something exciting and ask one question.",
  contentSwitch: "Focus can't be measured yet ({{score}}/{{max}}). Fix: post weekly about one topic so focus can be measured.",
  shorts_balance: "Wrong mix of short and long videos ({{score}}/{{max}}: {{shorts}} shorts out of {{videoCount}}). Fix: for each long video, post one short video too.",
  captions_present: "Most videos have no captions ({{score}}/{{max}} have them). Fix: in YouTube Studio, open Subtitles and add captions by hand.",
  engagement_signals: "Likes are below the {{minLikeRatePct}}% goal ({{score}}/{{max}}). Fix: ask viewers a question and pin a comment.",
  avatar_present: "No profile photo. Fix: upload a clear photo of you or your logo.",
  banner_spec: "Your banner text may be cut off on phones. Fix: keep all words inside the middle safe area.",
  watermark_set: "No subscribe button on videos. Fix: in YouTube Studio, add a watermark under Branding.",
  trailer_present: "No channel trailer. Fix: upload a short video under 90 seconds that says what your channel is about.",
  featured_sections: "Home page is not set up. Fix: in YouTube Studio, add your best videos to the home page first.",
  category_set: "Wrong or missing category. Fix: in YouTube Studio settings, pick the topic that fits your videos.",
  links_valid: "No website links. Fix: add your website and social links in channel settings.",
  niche_coherence: "Your videos don't match your About text ({{rate}}% match, need {{minMatchPct}}%). Fix: make new videos about your main topic.",
  publish_cadence_trend: "You wait too long between videos (over {{maxGapDays}} days). Fix: post every week.",
  velocity_change_trend: "Views are going down. Fix: post every week and make more of your best topic.",
  name: "Channel name is weak ({{score}}/{{max}}). Fix: use a short name with your topic word in it.",
  username: "Channel handle is weak ({{score}}/{{max}}). Fix: use a short, easy name.",
  tags: "Tags are weak ({{score}}/{{max}}). Fix: add 8-15 words about your topic.",
  niche: "Topic is unclear ({{score}}/{{max}}). Fix: keep all videos about one topic.",
  description: "Description is too short ({{score}}/{{max}}). Fix: write more words about what your channel is about.",
};

// Build real recommendations from the computed params that actually fell short.
function buildRecommendations(auditType, params = [], profileParams = []) {
  const defs = new Map(
    (profileParams || [])
      .filter((p) => p.auditType === auditType && p.enabled)
      .map((p) => [p.key, p]),
  );
  const recs = [];
  for (const p of params || []) {
    if (p?.status === "gated") continue; // waiting on data — shown as pending, not as a fix
    const max = p.max > 0 ? p.max : 1;
    const ratio = Math.min(1, Math.max(0, (p.earned || 0) / max));
    // Everything below "Optimal" (80%) gets guidance: <50% is failing,
    // 50-80% "Needs Work" still tells the user how to reach Optimal (low
    // severity). Only Optimal+ params are skipped.
    if (ratio >= 0.8) continue; // optimal or better
    const deficit = 1 - ratio;
    const imp = calculateParamImpact(auditType, p.key, p.earned, p.max);
    // Severity is led by score impact (points recoverable), not raw deficit:
    // recs here span deficit 0.2-1.0, so impact-led bands keep highs/mediums
    // meaningful while 50-80% "Needs Work" items land on low.
    const severity = imp.impactGain >= 8 || (imp.impactGain >= 5 && deficit >= 0.9)
      ? "high"
      : imp.impactGain >= 3 || deficit >= 0.7
        ? "medium"
        : "low";
    const def = defs.get(p.key);
    let message;
    // Prefer the param definition's template; fall back to the param's own
    // (e.g. centralized thumbnail pillars carry their own recommendation text),
    // then to the deterministic safety-net map — never a bare "0/40" line.
    const template = (def && def.recommendationTemplate) || p.recommendationTemplate || DETERMINISTIC_FALLBACKS[p.key];
    if (template) {
      message = interpolate(template, {
        ...(p.vars || {}),
        label: p.label,
        score: p.vars?.score ?? p.earned,
        max: p.max,
        value: p.rawValue != null ? p.rawValue : undefined,
        raw: p.rawValue != null ? p.rawValue : undefined,
        rate: p.rawValue != null ? p.rawValue : undefined,
        maxGapDays: def?.thresholds?.maxGapDays || 21,
        minMatchPct: def?.thresholds?.minMatchPct || 70,
        minLikeRatePct: def?.thresholds?.minLikeRatePct || 3.5,
        ctrLowPct: def?.thresholds?.ctrLowPct || 3,
      });
      if (message.includes("{{")) message = `${p.label}: ${p.earned}/${p.max} (needs improvement).`;
    } else {
      message = `${p.label}: ${p.earned}/${p.max} (needs improvement).`;
    }
    recs.push({
      auditType,
      paramKey: p.key,
      severity,
      message,
      score: p.earned,
      max: p.max,
      impactGain: imp.impactGain,
      impactPenalty: imp.impactPenalty,
    });
  }
  recs.sort((a, b) => sevRank(b.severity) - sevRank(a.severity) || (b.impactGain || 0) - (a.impactGain || 0) || (b.max || 0) - (a.max || 0));
  return recs.slice(0, 10);
}

  function safeSub(type, promise) {
    return promise.catch((err) => {
      console.error(`[AuditOrchestrator] ${type} sub-run FAILED:`, err?.stack || err);
      return {
        type,
        score: 0,
        grade: "n/a",
        status: "failed",
        params: [],
        recommendations: [],
        reportUrl: null,
        meta: { error: String(err?.message || err) },
      };
    });
  }

  // ── Orchestrator entrypoint ──
  // Runs the complete 4-category audit (Channel, Video, Playlist, General)
  async function runAudit({ channelId, authHeader, uid, orgId, opts = {}, includeThumbnailAI = false } = {}) {
    const o = { includeThumbnailAI, ...opts };
    // Pipeline progress sink (phases: input → setup → sub-audits → history →
    // persist → done). The queue worker maps these to job percent; direct
    // callers may omit it entirely.
    const emitProgress = (phase, fraction) => {
      try {
        o.onProgress?.(phase, fraction);
      } catch {
        /* progress is best-effort */
      }
    };

    const tInput = now();
    const input = await gatherAuditInput({
      channelId,
      authHeader,
      scope: o.scope,
      onProgress: (stage, fraction) => emitProgress(`input:${stage}`, fraction),
    }).catch((err) => {
      const failed = {
        type: "channelIdentity",
        score: 0,
        grade: "n/a",
        status: "failed",
        params: [],
        recommendations: [],
        reportUrl: null,
        meta: { error: String(err?.message || err) },
      };
      return { __failed: true, failed };
    });
    if (input.__failed) {
      const failed = input.failed;
      const persisted = await persistRun({
        channelId,
        uid,
        orgId,
        status: "failed",
        overall: 0,
        grade: "F",
        profileVersion: null,
        includeThumbnailAI: !!o.includeThumbnailAI,
        subs: { channelIdentity: failed },
      });
      return {
        auditRunId: persisted?.auditRunId ?? null,
        overall: 0,
        grade: "F",
        subRuns: { channelIdentity: { score: 0, meta: failed.meta, status: "failed", params: [], recommendations: [] } },
      };
    }

    // Setup lookups are independent -- fetch them concurrently instead of five
    // serial awaits. Each keeps its own fallback so one failure never blocks
    // the rest (identical fallbacks to the old serial version).
    const defaultProfile = deps.getDefaultProfile ? deps.getDefaultProfile() : { version: 1 };
    const [profile, profileParams, dataAvailability, focusOutcome, optimizerCriteria] = await Promise.all([
      getScoringProfile(deps.db).catch(() => defaultProfile),
      deps.getParamDefinitions?.(deps.db).catch(() => []),
      // Ingested-data availability (retention/watch-time): gates only when the
      // data genuinely isn't there — a connected + synced channel has it in DB.
      // Attached to the input so every sub-audit can annotate its meta.
      getAuditDataAvailability({ query, isPostgresConfigured, channelId }),
      // Owner-defined Channel Focus & Knowledge (personal or org scope) grounds
      // every sub-audit's niche/audience/tone. Best-effort: absent -> all
      // downstream sites fall back to keyword inference (unchanged behavior).
      (async () => {
        try {
          const focusSvc = deps.channelFocusService;
          if (focusSvc?.getFocusForAI) {
            const channelFocus = await focusSvc.getFocusForAI(channelId, orgId || null);
            return { channelFocus, focusBlock: buildFocusContextBlock(channelFocus) };
          }
        } catch (err) {
          console.warn(`[AuditOrchestrator] Channel focus lookup failed for ${channelId}: ${err?.message || err}`);
        }
        return { channelFocus: null, focusBlock: "" };
      })(),
      // Centralized thumbnail criteria (single source of truth for all thumbnail audits).
      getOptimizerCriteria?.().catch(() => null),
    ]);
    input.dataAvailability = dataAvailability;
    input.channelFocus = focusOutcome.channelFocus;
    input.focusBlock = focusOutcome.focusBlock;
    emitProgress("setup", 1);
    timed("audit:input", tInput, {
      videos: input.videos?.length ?? 0,
      playlists: input.playlists?.length ?? 0,
      scope: o.scope || "full",
    });
    const tSubs = now();

    // ── Channel-scope run (/channelaudit): ONLY the channel metadata audit ──
    // Scores name, description, keywords, branding, niche coherence, and
    // upload cadence. Overall score == the channel identity sub-audit score.
    if (o.scope === "channel") {
      const channelIdentity = await safeSub("channelIdentity", runChannelIdentity(input, profileParams, optimizerCriteria));
      const overall = clamp(channelIdentity.score);
      const grade = require("../config/channelAuditScoringProfiles").scoreToGrade(overall, profile);
      const persisted = await persistRun({
        channelId,
        uid,
        orgId,
        status: channelIdentity.status === "failed" ? "failed" : "completed",
        overall,
        grade,
        profileVersion: profile.version,
        includeThumbnailAI: !!o.includeThumbnailAI,
        subs: { channelIdentity },
      });
      return {
        auditRunId: persisted?.auditRunId ?? null,
        overall,
        grade,
        subRuns: {
          channelIdentity: {
            score: channelIdentity.score,
            meta: channelIdentity.meta,
            status: channelIdentity.status,
            params: channelIdentity.params,
            recommendations: channelIdentity.recommendations,
          },
        },
      };
    }

    // Run all 4 sub-audits concurrently, reporting each completion so the
    // job UI advances while the slowest sub-audit still runs.
    const trackSub = (name, promise) =>
      promise.then((sub) => {
        emitProgress(name, 1);
        return sub;
      });
    const [channelIdentity, video, playlist, general] = await Promise.all([
      trackSub("channelIdentity", safeSub("channelIdentity", runChannelIdentity(input, profileParams, optimizerCriteria))),
      trackSub("video", safeSub("video", runVideoSubAudit(input, profileParams, optimizerCriteria, o))),
      trackSub("playlist", safeSub("playlist", runPlaylistSubAudit(input, profileParams, optimizerCriteria, o))),
      trackSub("general", safeSub("general", runGeneralSubAudit(input, profileParams, optimizerCriteria))),
    ]);

    const subs = { channelIdentity, video, playlist, general };
    timed("audit:subaudits", tSubs, {
      failed: [channelIdentity, video, playlist, general].filter((s) => s.status === "failed").length,
    });
    
    // Calculate overall score based on configurable profile subAuditWeights
    const weights = profile.subAuditWeights || { channelIdentity: 0.25, video: 0.35, playlist: 0.15, general: 0.25 };
    const wChannel = Number(weights.channelIdentity) || 0.25;
    const wVideo = Number(weights.video) || 0.35;
    const wPlaylist = Number(weights.playlist) || 0.15;
    const wGeneral = Number(weights.general) || 0.25;

    // Failed sub-audits are excluded from the overall (spec §7: errors never
    // count as zero) — the weights renormalize over the sub-audits that ran.
    const scoredSubs = [
      { score: channelIdentity.score, weight: wChannel, ok: channelIdentity.status !== "failed" },
      { score: video.score, weight: wVideo, ok: video.status !== "failed" },
      { score: playlist.score, weight: wPlaylist, ok: playlist.status !== "failed" },
      { score: general.score, weight: wGeneral, ok: general.status !== "failed" },
    ].filter((s) => s.ok);
    const scoredWeight = scoredSubs.reduce((s, x) => s + x.weight, 0);
    const overall = scoredWeight > 0
      ? clamp(Math.round(scoredSubs.reduce((s, x) => s + x.score * x.weight, 0) / scoredWeight))
      : 0;
    const grade = require("../config/channelAuditScoringProfiles").scoreToGrade(overall, profile);

    // Record the video + playlist engine output in the standalone history lists
    // (best-effort: never fails the audit run). Runs BEFORE persistRun so the
    // saved row ids land in the sub-run meta (deep-linkable later). Video rows
    // carry a videoHistoryId; playlist rows carry a playlistHistoryId.
    const { videoHistoryId, playlistHistoryId } = await persistEngineHistories({ uid, channelId, channelTitle: input.channel?.title || null, subs })
      .catch((err) => { console.warn("[AuditOrchestrator] history persist failed:", err?.message); return {}; });
    emitProgress("history", 1);
    if (videoHistoryId != null && video?.meta) {
      video.meta = { ...video.meta, videoHistoryId };
    }
    if (playlistHistoryId != null && playlist?.meta) {
      playlist.meta = { ...playlist.meta, playlistHistoryId };
    }

    const tPersist = now();
    const persisted = await persistRun({
      channelId,
      uid,
      orgId,
      status: [channelIdentity, video, playlist, general].every(s => s.status === "failed") ? "failed" : "completed",
      overall,
      grade,
      profileVersion: profile.version,
      includeThumbnailAI: !!o.includeThumbnailAI,
      subs,
    });
    timed("audit:persist", tPersist, { status: [channelIdentity, video, playlist, general].every(s => s.status === "failed") ? "failed" : "completed" });
    emitProgress("persist", 1);
    emitProgress("done", 1);

    return {
      auditRunId: persisted?.auditRunId ?? null,
      overall,
      grade,
      videoHistoryId: videoHistoryId ?? null,
      playlistHistoryId: playlistHistoryId ?? null,
      subRuns: {
        channelIdentity: { score: channelIdentity.score, meta: channelIdentity.meta, status: channelIdentity.status, params: channelIdentity.params, recommendations: channelIdentity.recommendations },
        video: { score: video.score, meta: video.meta, status: video.status, params: video.params, recommendations: video.recommendations },
        playlist: { score: playlist.score, meta: playlist.meta, status: playlist.status, params: playlist.params, recommendations: playlist.recommendations },
        general: { score: general.score, meta: general.meta, status: general.status, params: general.params, recommendations: general.recommendations },
      },
    };
  }

  const { saveVideoAuditHistory, savePlaylistAuditHistory } = createAuditHistoryService({
    query,
    isPostgresConfigured,
  });
  // Best-effort: record the Full Audit's video + playlist engine output in the
  // standalone history tables (video_audits / playlist_audits) via the SAME
  // canonical writers the standalone routes use (identical row shapes, one
  // implementation). Each run gets a "Full Audit -- <date>" entry so the
  // Playlist Optimizer / Video Audit deep links (?audit=<id>) can open that
  // exact saved analysis directly. A history-write failure never fails the
  // audit itself. Returns the saved row ids (videoHistoryId/playlistHistoryId).
  async function persistEngineHistories({ uid, channelId, channelTitle, subs }) {
    if (!uid) return {};
    const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const name = `Full Audit -- ${date}`;
    const out = {};
    // The two history writes are independent rows -- persist them concurrently
    // instead of two serial awaits.
    const v = subs?.video?._history;
    const p = subs?.playlist?._history;
    const [videoHistoryId, playlistHistoryId] = await Promise.all([
      v?.kind === "video" && v.results
        ? saveVideoAuditHistory({ uid, name, channelId, channelTitle, results: v.results }).then((row) => {
            console.log(`[AuditOrchestrator] History: wrote video_audits row "${name}" for channel ${channelId || ""}`);
            return row?.id != null ? Number(row.id) : null;
          })
        : null,
      p?.kind === "playlist" && p.audits
        ? savePlaylistAuditHistory({ uid, name, channelId, channelTitle, audits: p.audits }).then((row) => {
            console.log(`[AuditOrchestrator] History: wrote playlist_audits row "${name}" for channel ${channelId || ""}`);
            return row?.id != null ? Number(row.id) : null;
          })
        : null,
    ]);
    if (videoHistoryId != null) out.videoHistoryId = videoHistoryId;
    if (playlistHistoryId != null) out.playlistHistoryId = playlistHistoryId;
    return out;
  }

  async function persistRun({ channelId, uid, orgId, status, overall, grade, profileVersion, includeThumbnailAI, subs }) {
    if (!isPostgresConfigured?.()) return null;
    const runParams = [uid || null, channelId || null, orgId || null, status, overall, grade, profileVersion ?? null, !!includeThumbnailAI];
    const subRows = Object.entries(subs).map(([type, sub]) => {
      const subStatus = sub.status === "failed" ? "failed" : "completed";
      return [
        type,
        subStatus,
        sub.score,
        sub.grade,
        JSON.stringify({ params: sub.params, recommendations: sub.recommendations, meta: sub.meta || {} }),
        sub.reportUrl || null,
      ];
    });
    // ACID final rollup: the run row + all sub-run rows commit atomically, so
    // a crash can never leave a run half-persisted. The transaction wraps
    // DB-only INSERTs (never network calls) and is as short as possible.
    if (typeof withClient === "function") {
      const txResult = await withClient(async (client) => {
        await client.query("BEGIN");
        try {
          const { rows: runRows } = await client.query(
            `INSERT INTO audit_runs (uid, channel_id, org_id, status, overall_score, overall_grade, profile_version, include_thumbnail_ai)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
            runParams,
          );
          const runId = runRows?.[0]?.id;
          if (!runId) throw new Error("audit run insert returned no id");
          for (const [type, subStatus, score, gradeValue, results, reportUrl] of subRows) {
            await client.query(
              `INSERT INTO audit_sub_runs (audit_run_id, type, status, score, grade, results, report_url)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [runId, type, subStatus, score, gradeValue, results, reportUrl],
            );
          }
          await client.query("COMMIT");
          return { auditRunId: runId };
        } catch (err) {
          try {
            await client.query("ROLLBACK");
          } catch {
            /* rollback is best-effort */
          }
          throw err;
        }
      });
      if (txResult) return txResult;
    }
    // Fallback (no dedicated client available): serial pool queries, as before.
    const { rows: runRows } = await query(
      `INSERT INTO audit_runs (uid, channel_id, org_id, status, overall_score, overall_grade, profile_version, include_thumbnail_ai)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      runParams,
    );
    const runId = runRows?.[0]?.id;
    if (!runId) return null;
    for (const [type, subStatus, score, gradeValue, results, reportUrl] of subRows) {
      await query(
        `INSERT INTO audit_sub_runs (audit_run_id, type, status, score, grade, results, report_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [runId, type, subStatus, score, gradeValue, results, reportUrl],
      );
    }
    return { auditRunId: runId };
  }

  async function getRunReport(id) {
    if (!isPostgresConfigured?.()) return null;
    const run = await query(`SELECT * FROM audit_runs WHERE id=$1`, [id]);
    if (!run.rows.length) return null;
    const subs = await query(`SELECT * FROM audit_sub_runs WHERE audit_run_id=$1 ORDER BY type`, [id]);
    return { run: run.rows[0], subRuns: subs.rows };
  }

  return { runAudit, getRunReport, persistRun };
}

module.exports = { createAuditOrchestratorService };

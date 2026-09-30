// ── Deterministic audit scoring engine (pure; no LLM, no image analysis) ──
// Text-based only: thumbnails/captions/logo/banner are intentionally NOT scored
// because they are expensive to analyze. Video and playlist categories average
// per-item scores across the channel's videos/playlists; general scores
// channel-wide behavior.
const auditScoring = require("../config/channelAuditScoring");
const { DEFAULT_AUDIT_SCORING } = auditScoring;

const clamp01 = (n) => Math.min(1, Math.max(0, Number(n) || 0));
const pctScore = (max, pct) => Math.round(max * clamp01(pct));

// Common English stopwords so topic extraction ignores filler.
const STOP = new Set([
  "the","a","an","to","of","in","on","for","and","or","but","how","what","why",
  "your","you","my","me","we","our","is","are","was","were","with","from","by",
  "at","be","it","this","that","as","top","best","vs","video","videos","channel",
  "2026","2025","2024","get","make","way","ways","new","all","howto",
]);

// Text heuristics: strong title 20-70 chars, description 200-2000 chars.
function textBand(len, max, lo, hi) {
  if (!len) return 0;
  if (len >= lo && len <= hi) return max;
  if (len < lo) return Math.round(max * (len / lo));
  if (len <= hi + 200) return Math.round(max * 0.8);
  return Math.round(max * 0.5);
}

function scoreTitle(text, max) { return textBand((text || "").trim().length, max, 20, 70); }
function scoreDescription(text, max) { return textBand((text || "").trim().length, max, 200, 2000); }
function scoreName(text, max) { return textBand((text || "").trim().length, max, 4, 30); }
function scoreNiche(text, max) { return textBand((text || "").trim().length, max, 10, 120); }
function scoreTags(tags, max) {
  const n = Array.isArray(tags) ? tags.length : 0;
  if (n >= 10) return max;
  if (n >= 5) return Math.round(max * 0.7);
  if (n > 0) return Math.round(max * 0.4);
  return 0;
}
function scoreKeywords(keywords, text, max) {
  const kws = Array.isArray(keywords) ? keywords.filter(Boolean) : [];
  if (kws.length === 0) return 0;
  const hay = extractKeywords(text);
  const haySet = new Set(hay);
  const hayStr = (text || "").toLowerCase();
  // A keyword is "relevant" if its meaningful words appear in the
  // title/description (word-level overlap, not verbatim substring —
  // multi-word tags like "cat compilation 2026" never appear literally).
  const hit = kws.filter((k) => {
    if (hayStr.includes(k.toLowerCase())) return true; // exact phrase still counts
    const words = extractKeywords(k);
    if (words.length === 0) return false;
    const inHay = words.filter((w) => haySet.has(w)).length;
    return inHay / words.length >= 0.5; // half its meaningful words present
  }).length;
  return Math.round(max * (hit / kws.length));
}
function scoreSize(size, max) {
  const n = Number(size) || 0;
  // 10-100 is the ideal band; anything at/above 10 caps at max. (A previous
  // version let n > 100 fall into the n/10 ramp, scoring a 423-video playlist
  // at 42x max and pushing playlist health past 100.)
  if (n >= 10) return max;
  if (n >= 1) return Math.round(max * (n / 10));
  return 0;
}

// Extract distinct meaningful keywords from a block of text.
function extractKeywords(text) {
  const words = (text || "").toLowerCase().split(/\W+/).filter((w) => !STOP.has(w) && w.length > 2);
  return [...new Set(words)];
}

// Average a per-item scoring function across an array (0 when empty).
function avgScore(items, fn) {
  if (!Array.isArray(items) || items.length === 0) return 0;
  return Math.round(items.reduce((sum, it) => sum + fn(it), 0) / items.length);
}

// Dominant topic: the top N most frequent meaningful terms across video titles
// (plus the channel description). Used for the channel niche/focus criterion.
function deriveNiche(videos, description) {
  const freq = {};
  for (const v of Array.isArray(videos) ? videos : []) {
    for (const w of extractKeywords(v?.title)) freq[w] = (freq[w] || 0) + 1;
  }
  for (const w of extractKeywords(description)) freq[w] = (freq[w] || 0) + 1;
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([w]) => w)
    .join(" ");
}

// How regular the upload cadence is: 1 - coefficient of variation of the
// day-gaps between consecutive uploads. Regular uploads score high.
function uploadConsistency(list, max) {
  if (list.length < 3) return list.length === 2 ? Math.round(max * 0.3) : 0;
  const times = list
    .map((v) => Date.parse(v?.publishedAt))
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b);
  if (times.length < 3) return 0;
  const gaps = [];
  for (let i = 1; i < times.length; i++) gaps.push((times[i] - times[i - 1]) / 86400000);
  const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  if (mean <= 0) return max;
  const variance = gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length;
  const cv = Math.sqrt(variance) / mean;
  return pctScore(max, 1 - Math.min(1, cv));
}

// Average like/view and comment/view ratios across videos (engagement).
function engagement(list, max) {
  if (list.length === 0) return 0;
  const avg = list.reduce((sum, v) => {
    const views = Number(v?.viewCount) || 0;
    if (views <= 0) return sum;
    const likeRate = (Number(v?.likeCount) || 0) / views;
    const commentRate = (Number(v?.commentCount) || 0) / views;
    return sum + clamp01(likeRate * 12 + commentRate * 100);
  }, 0) / list.length;
  return pctScore(max, avg);
}

// Content-focus stability: what fraction of video titles share the channel's
// dominant topic terms. A channel that stays on-topic scores high (low switch).
function contentSwitch(list, max) {
  if (list.length < 2) return 0;
  const titles = list.map((v) => (v?.title || "").toLowerCase());
  const freq = {};
  for (const t of titles) {
    for (const w of new Set(extractKeywords(t))) freq[w] = (freq[w] || 0) + 1;
  }
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w);
  if (top.length === 0) return 0;
  const aligned = titles.filter((t) => top.some((w) => t.includes(w))).length;
  return Math.round(max * (aligned / titles.length));
}

// Count-based health, mirroring scoreTags bands (normalized to 0-100).
function healthFromCount(n) {
  if (n >= 10) return 100;
  if (n >= 5) return 70;
  if (n > 0) return 40;
  return 0;
}
// Size-based health, mirroring scoreSize bands (normalized to 0-100).
function healthFromSize(n) {
  if (n >= 10) return 100;
  if (n >= 1) return Math.round(100 * (n / 10));
  return 0;
}

// ── Recommendation hints (deterministic, mirror the scoring bands) ──────────
// Each returns { health (0-100), hint (what to do to score higher) } for a
// single measured dimension, so the UI can show a score AND an actionable
// suggestion per item. No LLM: the hints are derived directly from the data.
function titleHint(len) {
  const health = textBand(len, 100, 20, 70);
  const hint = len < 20
    ? `Title too short (${len} chars). Use 20-70 chars with a clear, keyword-rich hook.`
    : len <= 70 ? "Clear, descriptive title." : `Title is long (${len} chars); aim for under 70.`;
  return { health, hint };
}
function descHint(len) {
  const health = textBand(len, 100, 200, 2000);
  const hint = len < 200
    ? `Description thin (${len} chars). Add 200+ chars covering the topic and keywords.`
    : len <= 2000 ? "Good, detailed description." : `Description very long (${len} chars); consider trimming.`;
  return { health, hint };
}
function tagsHint(n) {
  const health = healthFromCount(n);
  const hint = n >= 10 ? "Strong tag set." : n >= 5
    ? `Decent (${n} tags). Add up to 10+ relevant tags.`
    : n > 0 ? `Only ${n} tag(s). Add 10+ relevant tags.` : "No tags set. Add 10+ relevant tags.";
  return { health, hint };
}
function nameHint(len) {
  const health = textBand(len, 100, 4, 30);
  const hint = len < 4
    ? `Channel name too short (${len} chars). Use a distinctive, keyword-rich name.`
    : len <= 30 ? "Clear, distinctive channel name." : `Channel name is long (${len} chars); a shorter, memorable name is better.`;
  return { health, hint };
}
// Per-video engagement health, mirroring the general engagement scoring weight.
function engageHealth(v) {
  const views = Number(v?.viewCount) || 0;
  const likeRate = views > 0 ? (Number(v?.likeCount) || 0) / views : 0;
  const commentRate = views > 0 ? (Number(v?.commentCount) || 0) / views : 0;
  return { health: Math.round(100 * clamp01(likeRate * 12 + commentRate * 100)), likeRate };
}

// Dominant topic terms across video titles (for the content-focus hint).
function topTopics(list, n = 3) {
  const freq = {};
  for (const v of Array.isArray(list) ? list : []) {
    for (const w of new Set(extractKeywords(v?.title))) freq[w] = (freq[w] || 0) + 1;
  }
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);
}

// General (insights-style) recommendations from the video set: upload cadence,
// engagement, and content focus. Hints like "post more regularly".
function generalRecommendations(videos) {
  const list = Array.isArray(videos) ? videos : [];
  const out = [];

  const up = uploadConsistency(list, 100);
  const upHint = list.length < 3
    ? "Not enough uploads to measure cadence. Aim for a consistent schedule (e.g., weekly)."
    : up >= 80 ? "Upload cadence is consistent. Keep it up." : "Uploads are unevenly spaced. Post on a regular schedule (e.g., weekly) to grow steadily.";
  out.push({ key: "uploadConsistency", label: "Upload Consistency", health: up, hint: upHint });

  const en = engagement(list, 100);
  const avgLikeRate = list.reduce((s, v) => {
    const views = Number(v?.viewCount) || 0;
    return views > 0 ? s + (Number(v?.likeCount) || 0) / views : s;
  }, 0) / (list.length || 1);
  const enHint = en >= 80
    ? "Good audience engagement."
    : `Average like rate is ${(avgLikeRate * 100).toFixed(1)}%. Improve hooks, thumbnails, or add calls to action.`;
  out.push({ key: "engagement", label: "Engagement", health: en, hint: enHint });

  const cs = contentSwitch(list, 100);
  const topics = topTopics(list, 3);
  const csHint = cs >= 80
    ? "Content stays on a focused topic."
    : topics.length
      ? `Videos span several topics (${topics.join(", ")}). Stick to a focused niche to build a loyal audience.`
      : "Not enough titles to assess content focus.";
  out.push({ key: "contentSwitch", label: "Content Focus", health: cs, hint: csHint });

  return out;
}

// Normalized 0-100 health per displayed data item, so the UI can color the
// collected data green/yellow/red (good/ok/bad) AND show an actionable hint per
// item. Keeps banding in ONE place (mirrors the scoring thresholds above)
// instead of duplicating it on the client.
function rateHealth(input) {
  const channel = input?.channel || {};
  const nm = nameHint((channel.name || "").trim().length);
  const un = nameHint((channel.username || "").trim().length);
  const ds = descHint((channel.description || "").trim().length);
  const kwN = Array.isArray(channel.keywords) ? channel.keywords.length : 0;
  const kw = tagsHint(kwN);
  const ch = {
    name: { value: channel.name || "", ...nm },
    username: { value: channel.username || "", ...un },
    description: { value: channel.description || "", ...ds },
    keywords: { values: Array.isArray(channel.keywords) ? channel.keywords : [], ...kw },
  };
  const videos = (Array.isArray(input?.videos) ? input.videos : []).map((v) => {
    const t = titleHint((v?.title || "").trim().length);
    const d = descHint((v?.description || "").trim().length);
    const g = tagsHint(Array.isArray(v?.tags) ? v.tags.length : 0);
    const e = engageHealth(v);
    // The item's single score is the average of its dimensions.
    const health = Math.round((t.health + d.health + g.health + e.health) / 4);
    // The hint surfaces the weakest dimension.
    const worst = [t, d, g, { ...e, hint: e.likeRate >= 0.05 ? "Healthy engagement." : `Low like rate (${(e.likeRate * 100).toFixed(1)}%). Try stronger hooks and calls to action.` }]
      .reduce((min, x) => (x.health < min.health ? x : min));
    return {
      title: v?.title || "",
      description: v?.description || "",
      tags: Array.isArray(v?.tags) ? v.tags : [],
      publishedAt: v?.publishedAt,
      viewCount: Number(v?.viewCount) || 0,
      likeCount: Number(v?.likeCount) || 0,
      commentCount: Number(v?.commentCount) || 0,
      health,
      hint: worst.hint,
    };
  });
  const playlists = (Array.isArray(input?.playlists) ? input.playlists : []).map((p) => {
    const t = titleHint((p?.title || "").trim().length);
    const d = descHint((p?.description || "").trim().length);
    const s = healthFromSize(Number(p?.size) || 0);
    const sizeN = Number(p?.size) || 0;
    const sHint = sizeN >= 10
      ? "Well-sized playlist."
      : `Only ${sizeN} item(s). Add more videos (10-100 ideal).`;
    // Per-dimension audits (title/description/size, each 0-100) so consumers
    // can show Recommended Fixes per playlist like the video sub-audit does:
    // every dimension below the 100 fix target yields one recommendation
    // (current/projected/delta), sorted biggest uplift first.
    const dimensions = [
      { key: "title", label: "Title", current: t.health },
      { key: "description", label: "Description", current: d.health },
      { key: "size", label: "Coverage / Size", current: s },
    ];
    const recommendations = dimensions
      .filter((dim) => dim.current < 100)
      .map((dim) => ({ dimension: dim.key, label: dim.label, current: dim.current, projected: 100, delta: 100 - dim.current }))
      .sort((a, b) => b.delta - a.delta);
    const dims = [t, d, { health: s, hint: sHint }];
    const health = Math.round((dims[0].health + dims[1].health + dims[2].health) / 3);
    const worst = dims.reduce((min, x) => (x.health < min.health ? x : min));
    return { playlistId: p?.playlistId ?? null, title: p?.title || "", description: p?.description || "", size: Number(p?.size) || 0, health, hint: worst.hint, dimensions, recommendations };
  });
  return { channel: ch, videos, playlists, general: generalRecommendations(input?.videos) };
}

// Group ALL findings by issue type (not per-item) for a concise remediation
// list. Reuses the existing hint helpers so banding stays in one place.
function buildAuditIssues(input) {
  const channel = input?.channel || {};
  const videos = Array.isArray(input?.videos) ? input.videos : [];
  const playlists = Array.isArray(input?.playlists) ? input.playlists : [];

  const sev = (h) => (h < 50 ? "high" : h < 80 ? "medium" : null);

  const META = {
    "video-title": { label: "Title needs improvement", hint: "Titles should be 20-70 chars with a clear, keyword-rich hook." },
    "video-description": { label: "Description too thin", hint: "Add 200+ chars of description covering the topic and keywords." },
    "video-tags": { label: "Missing or few tags", hint: "Add 10+ relevant tags to every video." },
    "video-engagement": { label: "Low engagement", hint: "Improve hooks and calls to action to lift like and comment rates." },
    "channel-name": { label: "Channel name too short", hint: "Use a distinctive, keyword-rich channel name (4-30 chars)." },
    "channel-username": { label: "Username too short", hint: "Use a clear, memorable handle (4-30 chars)." },
    "channel-description": { label: "Channel description too thin", hint: "Add 200+ chars of channel description covering topics and keywords." },
    "channel-tags": { label: "Missing channel tags", hint: "Add 10+ channel keywords/tags." },
    "playlist-title": { label: "Playlist title too short", hint: "Use a clear, descriptive playlist title (20-70 chars)." },
    "playlist-description": { label: "Playlist description too thin", hint: "Add 200+ chars of playlist description." },
    "playlist-size": { label: "Playlist too small", hint: "Add more videos to the playlist (10-100 ideal)." },
  };

  const buckets = {};
  const add = (key, health, item) => {
    const s = sev(health);
    if (!s) return;
    const b = buckets[key] || (buckets[key] = { severity: s, affected: [] });
    if (s === "high") b.severity = "high";
    b.affected.push(item);
  };

  for (const v of videos) {
    const vid = v?.videoId;
    const item = {
      type: "video",
      id: vid,
      title: v?.title || "",
      url: vid ? `https://www.youtube.com/watch?v=${vid}` : null,
    };
    add("video-title", titleHint((v?.title || "").trim().length).health, item);
    add("video-description", descHint((v?.description || "").trim().length).health, item);
    add("video-tags", tagsHint(Array.isArray(v?.tags) ? v.tags.length : 0).health, item);
    add("video-engagement", engageHealth(v).health, item);
  }

  const cItem = {
    type: "channel",
    id: null,
    title: channel.name || channel.username || "Channel",
    url: null,
  };
  add("channel-name", nameHint((channel.name || "").trim().length).health, cItem);
  add("channel-username", nameHint((channel.username || "").trim().length).health, cItem);
  add("channel-description", descHint((channel.description || "").trim().length).health, cItem);
  add("channel-tags", tagsHint(Array.isArray(channel.keywords) ? channel.keywords.length : 0).health, cItem);

  for (const p of playlists) {
    const pItem = { type: "playlist", id: null, title: p?.title || "", url: null };
    add("playlist-title", titleHint((p?.title || "").trim().length).health, pItem);
    add("playlist-description", descHint((p?.description || "").trim().length).health, pItem);
    add("playlist-size", healthFromSize(Number(p?.size) || 0), pItem);
  }

  const rank = { high: 0, medium: 1 };
  return Object.entries(buckets)
    .map(([key, b]) => ({
      key,
      label: META[key].label,
      hint: META[key].hint,
      severity: b.severity,
      count: b.affected.length,
      affected: b.affected.slice(0, 50),
    }))
    .filter((i) => i.count > 0)
    .sort((a, b) => (rank[a.severity] - rank[b.severity]) || (b.count - a.count));
}

function createAuditScoringService(deps = {}) {
  function criterion(key, label, max, earned) {
    return { key, label, earned: Math.max(0, Math.min(max, earned)), max };
  }

  // Video category: averages per-criterion scores across the channel's videos.
  async function scoreVideo(videos, cfg = DEFAULT_AUDIT_SCORING) {
    const c = cfg.video || DEFAULT_AUDIT_SCORING.video;
    const list = Array.isArray(videos) ? videos : [];
    const breakdown = [
      criterion("title", "Title", c.title.max, avgScore(list, (v) => scoreTitle(v?.title, c.title.max))),
      criterion("description", "Description", c.description.max, avgScore(list, (v) => scoreDescription(v?.description, c.description.max))),
      criterion("tags", "Tags", c.tags.max, avgScore(list, (v) => scoreTags(v?.tags, c.tags.max))),
      criterion("keywords", "Keyword Relevance", c.keywords.max, avgScore(list, (v) => scoreKeywords(v?.tags, `${v?.title || ""} ${v?.description || ""}`, c.keywords.max))),
    ];
    const total = breakdown.reduce((s, b) => s + b.earned, 0);
    return { total, breakdown };
  }

  // Channel category: name, handle, branding tags, derived niche/focus, description.
  async function scoreChannel(input, cfg = DEFAULT_AUDIT_SCORING, videos = []) {
    const c = cfg.channel || DEFAULT_AUDIT_SCORING.channel;
    const breakdown = [
      criterion("name", "Name", c.name.max, scoreName(input?.name, c.name.max)),
      criterion("username", "Username", c.username.max, scoreName(input?.username, c.username.max)),
      criterion("tags", "Tags", c.tags.max, scoreTags(input?.keywords, c.tags.max)),
      criterion("niche", "Niche / Focus", c.niche.max, scoreNiche(deriveNiche(videos, input?.description), c.niche.max)),
      criterion("description", "Description", c.description.max, scoreDescription(input?.description, c.description.max)),
    ];
    const total = breakdown.reduce((s, b) => s + b.earned, 0);
    return { total, breakdown };
  }

  // Playlist category: averages across ALL the channel's playlists.
  async function scorePlaylist(playlists, cfg = DEFAULT_AUDIT_SCORING) {
    const c = cfg.playlist || DEFAULT_AUDIT_SCORING.playlist;
    const list = Array.isArray(playlists) ? playlists : [];
    const breakdown = [
      criterion("title", "Title", c.title.max, avgScore(list, (p) => scoreTitle(p?.title, c.title.max))),
      criterion("description", "Description", c.description.max, avgScore(list, (p) => scoreDescription(p?.description, c.description.max))),
      criterion("tags", "Tags / Keywords", c.tags.max, avgScore(list, (p) => scoreTags(extractKeywords(`${p?.title || ""} ${p?.description || ""}`), c.tags.max))),
      criterion("size", "Coverage / Size", c.size.max, avgScore(list, (p) => scoreSize(p?.size, c.size.max))),
    ];
    const total = breakdown.reduce((s, b) => s + b.earned, 0);
    return { total, breakdown };
  }

  // General category: upload cadence, engagement, content-focus stability.
  async function scoreGeneral(videos, cfg = DEFAULT_AUDIT_SCORING) {
    const c = cfg.general || DEFAULT_AUDIT_SCORING.general;
    const list = Array.isArray(videos) ? videos : [];
    const breakdown = [
      criterion("uploadConsistency", "Upload Consistency", c.uploadConsistency.max, uploadConsistency(list, c.uploadConsistency.max)),
      criterion("engagement", "Engagement", c.engagement.max, engagement(list, c.engagement.max)),
      criterion("contentSwitch", "Content Focus", c.contentSwitch.max, contentSwitch(list, c.contentSwitch.max)),
    ];
    const total = breakdown.reduce((s, b) => s + b.earned, 0);
    return { total, breakdown };
  }

  async function scoreAll(input, cfg = DEFAULT_AUDIT_SCORING) {
    const videos = Array.isArray(input?.videos) ? input.videos : [];
    const playlists = Array.isArray(input?.playlists) ? input.playlists : [];
    const [video, channel, playlist, general] = await Promise.all([
      scoreVideo(videos, cfg),
      scoreChannel(input?.channel, cfg, videos),
      scorePlaylist(playlists, cfg),
      scoreGeneral(videos, cfg),
    ]);
    return { video, channel, playlist, general };
  }

  return { scoreVideo, scoreChannel, scorePlaylist, scoreGeneral, scoreAll, rateHealth, buildAuditIssues };
}

module.exports = { createAuditScoringService, buildAuditIssues };

// ── Audit scoring config -- DERIVED from the admin Audit Criteria engine ──
// SINGLE SOURCE OF TRUTH = Firestore doc "config/auditParameterDefinitions",
// edited by admins at /admin/audit-criteria (backend/config/auditParameterDefinitions.js).
// Each enabled parameter's weight is mapped onto its audit criterion and
// normalized so every category totals exactly 100 points. Because values are
// derived live (the param definitions carry their own cache, invalidated
// immediately when an admin saves), any weight/enable change takes effect on
// the very next audit run -- no redeploy, no separate scoring config.
const { getParamDefinitions } = require("./channelAuditParameterDefinitions");

// Fallback shape used only when a category has no enabled parameters at all,
// and as the default config reference for tooling/tests.
const DEFAULT_AUDIT_SCORING = {
  video: {
    title: { max: 30 },
    description: { max: 25 },
    tags: { max: 25 },
    keywords: { max: 20 },
  },
  channel: {
    name: { max: 20 },
    username: { max: 15 },
    tags: { max: 20 },
    niche: { max: 25 },
    description: { max: 20 },
  },
  playlist: {
    title: { max: 30 },
    description: { max: 30 },
    tags: { max: 20 },
    size: { max: 20 },
  },
  general: {
    uploadConsistency: { max: 40 },
    engagement: { max: 35 },
    contentSwitch: { max: 25 },
  },
};

const TYPE_TO_CATEGORY = {
  CHANNEL_IDENTITY: "channel",
  VIDEO: "video",
  PLAYLIST: "playlist",
  GENERAL: "general",
};

// Scoring criterion -> parameter keys (from the criteria engine) whose weights
// fund it. Grouped per scoring category. Multiple params may fund one criterion
// (their weights are summed before normalization).
const CRITERION_PARAM_KEYS = {
  channel: {
    name: ["name_clarity"],
    username: ["avatar_present", "banner_spec", "watermark_set", "trailer_present", "featured_sections", "brand_curiosity"],
    tags: ["channel_keywords"],
    niche: ["niche_coherence", "niche_consistency"],
    description: ["description_complete", "links_valid", "category_set", "likeability_trust"],
  },
  video: {
    title: ["title_quality", "ctr_health"],
    description: ["description_quality", "cards_endscreens"],
    tags: ["tags_quality", "playlist_membership"],
    keywords: ["hashtags", "chapters", "captions_present"],
  },
  playlist: {
    title: ["title_optimization"],
    description: ["description_present", "keyword_niche_match"],
    tags: ["cover_consistency"],
    size: ["video_count", "uncategorized_rate", "duplicate_playlists", "stale_playlists"],
  },
  general: {
    uploadConsistency: ["upload_consistency", "activity_trend", "posting_time"],
    engagement: ["views_to_subs", "engagement_trend", "shorts_balance", "subscriber_growth", "community_activity"],
    contentSwitch: ["niche_follow_through"],
  },
};

// Build the { category: { criterion: { max } } } scoring config from the
// admin-configured parameter definitions. Every category is normalized to
// exactly 100 points. Disabled params contribute zero weight, so disabling one
// automatically re-distributes its points across the remaining criteria.
function deriveAuditScoring(params) {
  const enabledByCategory = {};
  for (const p of Array.isArray(params) ? params : []) {
    if (!p || p.enabled === false) continue;
    const cat = TYPE_TO_CATEGORY[p.auditType];
    if (!cat) continue;
    const w = Number(p.weight);
    if (!(w > 0)) continue;
    (enabledByCategory[cat] ||= new Map()).set(p.key, w);
  }

  const out = {};
  for (const [cat, crits] of Object.entries(CRITERION_PARAM_KEYS)) {
    const weights = enabledByCategory[cat] || new Map();
    const entries = Object.entries(crits);
    const total = entries.reduce(
      (sum, [, keys]) => sum + keys.reduce((s, k) => s + (weights.get(k) || 0), 0),
      0,
    );

    out[cat] = {};
    let assigned = 0;
    entries.forEach(([crit, keys], i) => {
      let max;
      if (total <= 0) {
        // Nothing enabled in this category -- fall back to defaults.
        max = DEFAULT_AUDIT_SCORING[cat][crit].max;
      } else if (i === entries.length - 1) {
        // Last criterion absorbs rounding drift so the category sums to 100.
        max = Math.max(0, 100 - assigned);
      } else {
        max = Math.round((keys.reduce((s, k) => s + (weights.get(k) || 0), 0) / total) * 100);
      }
      assigned += max;
      out[cat][crit] = { max };
    });
  }
  return out;
}

// Fully dynamic: delegates to the param-definitions cache (10-min TTL,
// invalidated immediately on admin save via invalidateParamCache).
async function getAuditScoring(db) {
  const params = await getParamDefinitions(db);
  return deriveAuditScoring(params);
}

// Kept for backward compatibility with existing deps wiring; derivation is
// live so there is nothing separate to invalidate anymore.
function invalidateAuditScoringCache() {}

module.exports = {
  getAuditScoring,
  deriveAuditScoring,
  invalidateAuditScoringCache,
  DEFAULT_AUDIT_SCORING,
};

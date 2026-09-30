// ── Centralized Audit: named scoring profiles (admin-configurable) ──
// Firestore-backed, mirrors config/auditScoring.js. A profile defines how much
// each of the 4 sub-audits contributes to the overall Channel Audit score
// (subAuditWeights must sum to 1.0) plus the grade bands. The profile version is
// snapshotted into each audit_run so old reports stay reproducible.

let _cache = null;
let _cachedAt = 0;
const CACHE_TTL_MS = 10 * 60 * 1000;

const DEFAULT_PROFILE = {
  id: "default",
  name: "Default",
  isDefault: true,
  version: 1,
  subAuditWeights: {
    channelIdentity: 0.20,
    video: 0.40,
    playlist: 0.15,
    general: 0.25,
  },
  // Overall grade bands (inclusive lower bound of each band). Config-driven so
  // admins can retune without a redeploy.
  gradeBands: [
    { min: 76, grade: "Optimized" },
    { min: 51, grade: "Growing" },
    { min: 26, grade: "Getting Started" },
    { min: 0, grade: "Needs Work" },
  ],
};

function isValidWeights(w) {
  if (!w || typeof w !== "object") return false;
  const keys = ["channelIdentity", "video", "playlist", "general"];
  const sum = keys.reduce((s, k) => s + (Number(w[k]) || 0), 0);
  return Math.abs(sum - 1) < 0.001; // weights must total ~1.0
}

function normalizeProfile(doc) {
  const src = doc && typeof doc === "object" ? doc : {};
  return {
    id: typeof src.id === "string" ? src.id : DEFAULT_PROFILE.id,
    name: typeof src.name === "string" ? src.name : DEFAULT_PROFILE.name,
    isDefault: typeof src.isDefault === "boolean" ? src.isDefault : DEFAULT_PROFILE.isDefault,
    version: typeof src.version === "number" ? src.version : DEFAULT_PROFILE.version,
    subAuditWeights: isValidWeights(src.subAuditWeights) ? src.subAuditWeights : DEFAULT_PROFILE.subAuditWeights,
    gradeBands: Array.isArray(src.gradeBands) && src.gradeBands.length ? src.gradeBands : DEFAULT_PROFILE.gradeBands,
  };
}

async function getScoringProfile(db) {
  if (_cache && Date.now() - _cachedAt < CACHE_TTL_MS) return _cache;
  try {
    const doc = await db.collection("config").doc("auditScoringProfiles").get();
    if (!doc.exists) {
      _cache = DEFAULT_PROFILE;
    } else {
      // Round-trip fix (STREAM C): PUT /admin/audit-scoring-profiles persists a
      // FLAT profile ({...DEFAULT_PROFILE, ...body}), but this reader previously
      // only accepted the NESTED shape (doc.data().default) and silently fell
      // back to defaults after every save. Accept BOTH shapes so existing flat
      // docs (written by the current PUT) keep working: prefer nested when it
      // looks like a profile, otherwise treat the doc itself as the profile.
      // Fixed on the READ side (not the write side) to preserve stored data.
      const data = doc.data() || {};
      const nested = data.default;
      const looksLikeProfile = (v) =>
        !!v && typeof v === "object" && ("subAuditWeights" in v || "id" in v);
      _cache = normalizeProfile(looksLikeProfile(nested) ? nested : data);
    }
  } catch {
    _cache = _cache || DEFAULT_PROFILE;
  }
  _cachedAt = Date.now();
  return _cache;
}

// Map an overall score to its grade using the profile's bands.
function scoreToGrade(score, profile = DEFAULT_PROFILE) {
  const bands = [...(profile.gradeBands || DEFAULT_PROFILE.gradeBands)].sort((a, b) => b.min - a.min);
  const s = Number(score) || 0;
  for (const b of bands) if (s >= b.min) return b.grade;
  return bands.length ? bands[bands.length - 1].grade : "Needs Work";
}

function invalidateProfileCache() {
  _cache = null;
  _cachedAt = 0;
}

module.exports = {
  DEFAULT_PROFILE,
  getScoringProfile,
  normalizeProfile,
  isValidWeights,
  scoreToGrade,
  invalidateProfileCache,
};

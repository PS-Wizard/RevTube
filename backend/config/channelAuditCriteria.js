// ── Audit criteria config ──
// Thin adapter over config/optimizerCriteria (the SINGLE source of truth for ALL
// audit criteria). Video-audit element criteria now live in
// optimizerCriteria.videoElements, so the standalone Video Auditor, its help
// text, and the Full Audit's VIDEO sub-audit all read the SAME admin-configurable
// list. Kept exports for backwards compatibility with videoAuditService / routes.
const {
  DEFAULT_OPTIMIZER_CRITERIA,
  getOptimizerCriteria,
  invalidateOptimizerCriteriaCache,
} = require("./optimizerCriteria");

const CATEGORY_META = {
  discoverability: { label: "Discoverability", elements: ["title", "keywords", "tags"] },
  contentQuality: { label: "Content Quality", elements: ["description", "captions"] },
  visualHook: { label: "Visual Hook", elements: ["thumbnail"] },
};

const DEFAULT_AUDIT_CRITERIA = {
  video: DEFAULT_OPTIMIZER_CRITERIA.videoElements,
};

function isValidCriterion(c) {
  return !!(
    c &&
    typeof c.key === "string" &&
    c.key &&
    typeof c.label === "string" &&
    typeof c.weight === "number" &&
    c.weight > 0 &&
    typeof c.element === "string" &&
    typeof c.instruction === "string"
  );
}

// Overlay valid db entries by key on top of defaults (mirrors the unified store's
// section merge). Kept for the /admin/audit-criteria route compatibility; the
// stored doc is no longer the source of truth (getAuditCriteria reads the store).
function mergeAuditCriteria(dbData) {
  const dbVideo = Array.isArray(dbData?.video) ? dbData.video : [];
  const merged = new Map(DEFAULT_AUDIT_CRITERIA.video.map((c) => [c.key, c]));
  for (const c of dbVideo) {
    if (isValidCriterion(c)) merged.set(c.key, { ...merged.get(c.key), ...c });
  }
  return { video: [...merged.values()] };
}

function normalizeVideoCriteria(criteria) {
  return (Array.isArray(criteria) ? criteria : DEFAULT_AUDIT_CRITERIA.video)
    .filter(isValidCriterion)
    .map((c) => ({ ...c, category: CATEGORY_META[c.category] ? c.category : "discoverability" }));
}

async function getAuditCriteria(db) {
  const cfg = await getOptimizerCriteria(db);
  const els = Array.isArray(cfg?.videoElements) && cfg.videoElements.length > 0
    ? cfg.videoElements
    : DEFAULT_OPTIMIZER_CRITERIA.videoElements;
  return { video: els };
}

function invalidateAuditCriteriaCache() {
  invalidateOptimizerCriteriaCache();
}

module.exports = {
  DEFAULT_AUDIT_CRITERIA,
  CATEGORY_META,
  getAuditCriteria,
  mergeAuditCriteria,
  invalidateAuditCriteriaCache,
  normalizeVideoCriteria,
  isValidCriterion,
};

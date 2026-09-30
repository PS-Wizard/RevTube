// ── Centralized Audit: per-parameter scoring definitions (adapter) ──────────
// The channel/video/general scoring params now live in the SINGLE unified
// criteria store (config/optimizerCriteria.js -> Firestore doc
// "config/optimizerCriteria"), edited from one admin page alongside the
// thumbnail pillars and playlist criteria. This module is a thin adapter that
// keeps the historical API (getParamDefinitions / getParamsForType /
// mergeParamDefinitions / invalidateParamCache) working for auditScoring.js,
// auditOrchestratorService and the admin routes.
const {
  DEFAULT_OPTIMIZER_CRITERIA,
  flattenParamRows,
  mergeParamListIntoCriteria,
  getOptimizerCriteria,
  invalidateOptimizerCriteriaCache,
} = require("./optimizerCriteria");

// Back-compat export: the flattened default param rows.
const DEFAULT_PARAMS = flattenParamRows(DEFAULT_OPTIMIZER_CRITERIA);

/** Flattened auditType-tagged param list from the unified criteria store. */
async function getParamDefinitions(db) {
  const cfg = await getOptimizerCriteria(db);
  return flattenParamRows(cfg);
}

/** Convenience: definitions filtered to one audit type (enabled only). */
async function getParamsForType(db, auditType) {
  const all = await getParamDefinitions(db);
  return all.filter((p) => p.auditType === auditType && p.enabled);
}

/**
 * Merge a flat auditType-tagged param list (as edited in the admin panel)
 * into the current unified criteria. Returns the full criteria object to be
 * persisted to the optimizerCriteria doc by the caller.
 */
async function mergeParamDefinitions(db, paramList) {
  const cfg = await getOptimizerCriteria(db);
  return mergeParamListIntoCriteria(cfg, paramList);
}

function invalidateParamCache() {
  invalidateOptimizerCriteriaCache();
}

module.exports = {
  DEFAULT_PARAMS,
  getParamDefinitions,
  getParamsForType,
  mergeParamDefinitions,
  invalidateParamCache,
};

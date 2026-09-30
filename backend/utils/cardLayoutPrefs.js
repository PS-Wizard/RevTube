/**
 * Card-layout preferences (dashboard stat cards) -- pure sanitizer.
 *
 * Users can hide, reorder and "compact" (hide detail rows on) dashboard stat
 * cards. The layout is stored per user in Firestore under
 * `users/{uid}.uiPreferences.cardLayout` and is deliberately surface-agnostic:
 * the key is `<surface-id>` (e.g. `dashboard:channelAnalytics`) and the values
 * are card ids owned by the frontend registry. The backend never needs to know
 * the registry -- it only guarantees the payload is a bounded, well-formed map
 * so a hand-crafted request can never write junk into the user document.
 *
 * Shape:
 *   {
 *     "dashboard:channelAnalytics": {
 *       order:   ["views", "watchTime"],   // card ids in display order
 *       hidden:  ["cardClicks"],           // card ids hidden by the user
 *       compact: ["likes"]                 // card ids rendered without details
 *     }
 *   }
 *
 * Unknown surfaces/card ids are allowed through (they are dropped by the
 * frontend when a card no longer exists), but everything is length-capped,
 * string-typed, deduped and pattern-checked.
 */

const MAX_SURFACES = 24;
const MAX_IDS_PER_LIST = 100;
/** Card ids: `views`, `hero:topCountry`, `section:weeklyPerformance`, ... */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$/;
/** Surface ids: `dashboard:channelAnalytics`. */
const SURFACE_PATTERN = /^[a-z][A-Za-z0-9]*:[A-Za-z0-9]+$/;

/** Dedupe + validate a list of card ids, preserving the caller's order. */
function sanitizeIdList(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const id = raw.trim();
    if (!ID_PATTERN.test(id)) continue;
    if (out.includes(id)) continue;
    if (out.length >= MAX_IDS_PER_LIST) break;
    out.push(id);
  }
  return out;
}

/**
 * Sanitize the whole `cardLayout` map. Always returns a plain object safe to
 * merge into Firestore: `{}` for junk input, empty per-list arrays for garbage
 * entries, and empty surfaces dropped entirely.
 */
function sanitizeCardLayoutPrefs(input) {
  const out = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;

  let kept = 0;
  for (const surface of Object.keys(input)) {
    if (kept >= MAX_SURFACES) break;
    if (!SURFACE_PATTERN.test(surface)) continue;

    const raw = input[surface];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;

    const order = sanitizeIdList(raw.order);
    const hidden = sanitizeIdList(raw.hidden);
    const compact = sanitizeIdList(raw.compact);
    if (order.length === 0 && hidden.length === 0 && compact.length === 0) continue;

    out[surface] = { order, hidden, compact };
    kept += 1;
  }

  return out;
}

/** True when a sanitized layout map has nothing worth persisting. */
function isEmptyCardLayoutPrefs(layouts) {
  return !layouts || Object.keys(layouts).length === 0;
}

module.exports = {
  sanitizeCardLayoutPrefs,
  isEmptyCardLayoutPrefs,
  MAX_SURFACES,
  MAX_IDS_PER_LIST,
};

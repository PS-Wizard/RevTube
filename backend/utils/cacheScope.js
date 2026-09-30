const crypto = require("crypto");

/** Short stable key segment -- never store raw tokens in cache keys. */
function shortHash(input) {
  return crypto
    .createHash("sha256")
    .update(String(input))
    .digest("hex")
    .slice(0, 20);
}

/**
 * Sanitize a segment value for use in cache keys.
 * Strips characters that could enable cache-key injection (colons, newlines, control chars).
 * Limits segment length to 120 chars to prevent key-bloat attacks.
 * Returns the sanitized string or 'inv' (invalid) if the result is empty.
 */
function sanitizeCacheSegment(val) {
  if (!val) return "inv";
  const clean = String(val)
    .replace(/[:\x00-\x1f\x7f]/g, "") // strip colons, null, control chars
    .trim();
  if (!clean) return "inv";
  return clean.length > 120 ? clean.slice(0, 120) : clean;
}

/** Scope for YouTube Data API cache keys (OAuth can return private/unlisted data). */
function youtubeDataScope(req, hasBearerAuth) {
  if (!hasBearerAuth) return "pub";
  const email = req.authUser?.email;
  if (email) return `u:${sanitizeCacheSegment(email)}`;
  return `t:${shortHash(req.headers.authorization)}`;
}

/**
 * Scope for dashboard / analytics cache keys.
 *
 * Prevents cross-org cache leakage when the same channelId exists in multiple
 * organizations. Scope resolution order:
 *
 *  1. Org context present  → `org:{orgId}`  (shared within org, isolated from others)
 *  2. Authenticated user   → `u:{email}`    (per-user isolation for personal channels)
 *  3. Fallback             → `anon:{shortHash(authHeader)}`
 */
function dashboardScope(req, { orgId, channelId }) {
  const resolvedOrgId =
    orgId || req.headers["x-org-id"] || req._resolvedOrgId || null;
  if (resolvedOrgId) {
    const cleanOrgId = sanitizeCacheSegment(resolvedOrgId);
    const cleanChannelId = channelId ? sanitizeCacheSegment(channelId) : "";
    return cleanChannelId ? `org:${cleanOrgId}:${cleanChannelId}` : `org:${cleanOrgId}`;
  }

  const email = req.authUser?.email;
  if (email) return `u:${sanitizeCacheSegment(email)}`;

  const auth = req.headers.authorization;
  if (auth) return `anon:${shortHash(auth)}`;

  return "pub";
}

/** TTLs for YouTube Data API responses */
const YT_DATA_CACHE_TTL_MS = {
  CHANNEL: 4 * 60 * 60 * 1000,
  PLAYLISTS: 2 * 60 * 60 * 1000,
  PLAYLIST: 2 * 60 * 60 * 1000,
  PLAYLIST_ITEMS: 45 * 60 * 1000,
  VIDEOS: 25 * 60 * 1000,
  CHANNELS_MINE: 12 * 60 * 1000,
  ANALYTICS_REPORT: 6 * 60 * 60 * 1000,
  CHANNEL_VIDEOS: 90 * 60 * 1000,
};

const OAUTH_TOKEN_CACHE_TTL_MS = 55 * 60 * 1000;

module.exports = {
  shortHash,
  sanitizeCacheSegment,
  youtubeDataScope,
  dashboardScope,
  YT_DATA_CACHE_TTL_MS,
  OAUTH_TOKEN_CACHE_TTL_MS,
};

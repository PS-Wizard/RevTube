/**
 * Shared helpers for chat tools.
 *
 * verifyChannelAccess(channelId, userChannels, userContext) -- checks if a channelId
 * belongs to the current user's connected channels or if the user is an admin.
 *
 * normalizePrivacyStatus(value) -- canonical privacy normalizer, mirrors
 * ingestion/sync.js: PRIVACY_PUBLIC|UNLISTED|PRIVATE or lowercase values map to
 * public|unlisted|private; 'unknown' when missing or unrecognized.
 *
 * applySort(rows, sortBy, sortOrder, allowedSorts) -- whitelisted JS-side sort.
 * Unknown sortBy preserves input order (never throws, never injects). Null /
 * undefined values always sort last so "missing" never masquerades as zero.
 *
 * safeErrorMessage(err) -- upstream error text safe for LLM consumption.
 * Strips query-string secrets (?key=, &token=, ...) that HTTP clients may echo,
 * and caps length. Defense in depth alongside Guardrails.sanitizeToolResult.
 *
 * toCsv(headers, rows) -- compact CSV for bulk tool results. One header line +
 * one line per row, RFC-4180 quoted when a cell contains a quote, comma, or
 * newline. Null/undefined render as empty cells. Keeps multi-item tool results
 * token-cheap for the LLM vs. verbose JSON.
 *
 * truncateCsv(csv, maxChars) -- hard cap for CSV payloads so bulk results stay
 * inside the guardrail output budget. Cuts on a row boundary and appends a
 * "... (truncated, N more rows omitted)" marker row. Returns { csv, truncated }.
 */
function verifyChannelAccess(channelId, userChannels, userContext) {
  // Admin users can access any channel
  if (userContext && (userContext.role === 'admin' || userContext.isAdmin === true)) {
    return { allowed: true, channel: { channelId, channelTitle: null, thumbnailUrl: null } };
  }

  if (!userChannels || userChannels.length === 0) {
    return {
      allowed: false,
      error: 'No channels are available on your account. Use listMyChannels to discover your channels first.',
    };
  }
  const channel = userChannels.find((c) => c.channelId === channelId);
  if (!channel) {
    return {
      allowed: false,
      error: `Channel "${channelId}" is not one of your connected channels. Use listMyChannels to see your channels.`,
    };
  }
  return { allowed: true, channel };
}

function normalizePrivacyStatus(value) {
  if (!value) return 'unknown';
  const s = String(value).toLowerCase();
  if (s.includes('unlisted')) return 'unlisted';
  if (s.includes('private')) return 'private';
  if (s.includes('public')) return 'public';
  return 'unknown';
}

/**
 * Whitelisted sort over an array of row objects. Sorting is JS-side (the
 * YouTube API offers no sort for playlists, and PG enrichment happens after
 * fetch), so there is no injection surface -- anything not in allowedSorts
 * preserves input order.
 *
 * @param {Array} rows - rows to sort (not mutated; a copy is returned)
 * @param {string} sortBy - field name, must be in allowedSorts
 * @param {string} sortOrder - 'asc' | 'desc' (anything else behaves as 'asc')
 * @param {string[]} allowedSorts - whitelist of sortable field names
 * @returns {Array} sorted copy (or unsorted copy when sortBy is not allowed)
 */
function applySort(rows, sortBy, sortOrder, allowedSorts) {
  const list = Array.isArray(rows) ? [...rows] : [];
  if (!allowedSorts.includes(sortBy)) return list;
  const dir = sortOrder === 'desc' ? -1 : 1;
  list.sort((a, b) => {
    const av = a[sortBy];
    const bv = b[sortBy];
    const aMissing = av === null || av === undefined;
    const bMissing = bv === null || bv === undefined;
    if (aMissing && bMissing) return 0;
    if (aMissing) return 1; // missing always last, either direction
    if (bMissing) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
  return list;
}

/**
 * Upstream error text safe to return in a tool result (which the LLM reads).
 * Strips query-string secrets that HTTP clients may echo (e.g. ?key=AIza...),
 * and caps length so stack traces / response dumps can't flow into context.
 */
function safeErrorMessage(err) {
  const raw = err && err.message ? String(err.message) : 'Unknown error';
  const stripped = raw.replace(/([?&](?:key|api[_-]?key|token|secret|password)=)[^&\s]*/gi, '$1[redacted]');
  return stripped.length > 300 ? `${stripped.slice(0, 300)}…` : stripped;
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers, rows) {
  const head = (Array.isArray(headers) ? headers : []).map(csvCell).join(',');
  const body = (Array.isArray(rows) ? rows : []).map((row) =>
    (Array.isArray(row) ? row : []).map(csvCell).join(','),
  );
  return [head, ...body].join('\n');
}

function truncateCsv(csv, maxChars) {
  const text = String(csv || '');
  const cap = Math.max(256, Number(maxChars) || 12000);
  if (text.length <= cap) return { csv: text, truncated: false };
  const lines = text.split('\n');
  const kept = [lines[0]];
  let len = lines[0].length + 1;
  let omitted = 0;
  for (let i = 1; i < lines.length; i++) {
    if (len + lines[i].length + 1 > cap) {
      omitted = lines.length - i;
      break;
    }
    kept.push(lines[i]);
    len += lines[i].length + 1;
  }
  kept.push(`... (truncated, ${omitted} more row${omitted === 1 ? '' : 's'} omitted)`);
  return { csv: kept.join('\n'), truncated: true };
}

module.exports = { verifyChannelAccess, normalizePrivacyStatus, applySort, safeErrorMessage, toCsv, truncateCsv };

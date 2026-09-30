/**
 * Tool: queryAnalyticsDb
 * Admin-only + toggle-gated: run a read-only SELECT over the ingested
 * analytics Postgres tables for complex ad-hoc questions the dedicated tools
 * can't answer.
 *
 * Data scope is deliberately the INGESTED analytics tables only
 * (channels/videos/metrics/playlists/snapshots/sync-runs). Planning tables
 * such as channel_goals / channel_focus are NOT queryable here -- answers
 * must be grounded in measured data, not plans or owner notes.
 *
 * The agent supplies raw SQL; this tool enforces, server-side:
 *   - admin user only (mirrors getBulkChannelSummary)
 *   - single SELECT/WITH statement, no stacked queries, no SQL comments
 *   - no write/DDL keywords (INSERT/UPDATE/DELETE/DROP/...)
 *   - FROM/JOIN targets restricted to an analytics allowlist
 *     (user_access_flags, audits*, PII tables are unreachable)
 *   - PII columns (email/password/secret/token/keys) rejected, even when the
 *     table itself is allowed (e.g. channel_goals.created_by stays readable,
 *     raw emails never leave the DB)
 *   - hard row cap (default 50, max 100) applied by wrapping the query,
 *     so a missing LIMIT can't dump a table into LLM context
 *
 * Output rows additionally pass through Guardrails.sanitizeToolResult
 * (email/token redaction) before reaching the LLM.
 */
const { safeErrorMessage } = require('./shared');

const TOOL_NAME = 'queryAnalyticsDb';

const ALLOWED_TABLES = [
  'analytics_channels',
  'analytics_videos',
  'analytics_channel_metrics_daily',
  'analytics_video_metrics_daily',
  'analytics_dashboard_snapshots',
  'analytics_sync_runs',
  'analytics_playlists',
  'analytics_playlist_items',
];

// Tables that exist but are deliberately unreachable: PII / user content,
// plus planning tables (goals/focus are not measured data).
const DENIED_TABLES = [
  'user_access_flags',
  'audits',
  'video_audits',
  'thumbnail_audits',
  'playlist_audits',
  'channel_goals',
  'channel_focus',
];

// PII/secret columns -- rejected even from allowed tables.
const DENIED_COLUMNS = ['email', 'password', 'passwd', 'secret', 'token', 'api_key', 'apikey'];

const FORBIDDEN_KEYWORDS =
  /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|vacuum|copy|call|do|listen|notify|comment|handler|prepare|execute|deallocate|reindex|cluster|checkpoint)\b/i;

const MAX_SQL_CHARS = 4000;
const DEFAULT_MAX_ROWS = 50;
const HARD_ROW_CAP = 100;

/**
 * Static inventory of the queryable tables (mirrors backend/db/migrations).
 * Returned by action 'schema' so the agent learns exact column names in one
 * cheap call instead of guessing them across failed query retries (which
 * burns the agent-loop iteration budget and ends in the max-iterations
 * fallback). Static -- no DB hit, safe to serve whenever the tool is gated on.
 */
const TABLE_SCHEMAS = {
  analytics_channels: {
    grain: 'one row per channel',
    columns: ['channel_id', 'title', 'uploads_playlist_id', 'last_synced_at', 'playlists_synced_at', 'created_at', 'updated_at'],
  },
  analytics_videos: {
    grain: 'one row per video (latest snapshot stats)',
    columns: ['video_id', 'channel_id', 'title', 'description', 'published_at', 'thumbnail_url', 'duration', 'tags', 'view_count', 'like_count', 'comment_count', 'position', 'updated_at'],
  },
  analytics_channel_metrics_daily: {
    grain: 'one row per channel per day (channel-level: subs, likes, shares, comments; NO views)',
    columns: ['channel_id', 'metric_date', 'subscribers_gained', 'subscribers_lost', 'likes', 'shares', 'comments', 'updated_at'],
  },
  analytics_video_metrics_daily: {
    grain: 'one row per channel per day per filters_key (channel-level views + watch time)',
    columns: ['channel_id', 'metric_date', 'views', 'estimated_minutes_watched', 'average_view_percentage', 'subscribers_gained', 'subscribers_lost', 'likes', 'shares', 'comments', 'filters_key', 'updated_at'],
  },
  analytics_dashboard_snapshots: {
    grain: 'cached dashboard payloads keyed by snapshot_key',
    columns: ['snapshot_key', 'channel_id', 'snapshot_type', 'payload', 'updated_at', 'expires_at'],
  },
  analytics_sync_runs: {
    grain: 'ingestion run log (freshness/debugging)',
    columns: ['id', 'channel_id', 'status', 'started_at', 'completed_at', 'error_message', 'stats'],
  },
  analytics_playlists: {
    grain: 'one row per playlist (catalog stats, NOT video stats)',
    columns: ['playlist_id', 'channel_id', 'title', 'description', 'channel_title', 'published_at', 'thumbnail_url', 'item_count', 'privacy_status', 'last_synced_at', 'items_synced_at', 'created_at', 'updated_at'],
  },
  analytics_playlist_items: {
    grain: 'playlist membership (join video stats via analytics_videos on video_id)',
    columns: ['playlist_id', 'video_id', 'position', 'title', 'published_at', 'thumbnail_url', 'privacy_status', 'updated_at'],
  },
  channel_goals: {
    grain: 'UNQUERYABLE here -- planning table, not measured data',
    columns: [],
  },
  channel_focus: {
    grain: 'UNQUERYABLE here -- owner notes, not measured data',
    columns: [],
  },
};

function stripStringLiterals(sql) {
  // Remove single-quoted literals so identifier checks don't false-positive
  // on words inside them (e.g. WHERE title LIKE '%email%').
  return String(sql).replace(/'(?:[^']|'')*'/g, "''");
}

function clampMaxRows(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_MAX_ROWS;
  return Math.min(Math.max(1, Math.floor(n)), HARD_ROW_CAP);
}

/**
 * Names defined by a leading WITH clause (CTEs). These are derived tables,
 * not real tables, so the allowlist check skips them. Pure helper.
 */
function cteNames(sql) {
  // The main SELECT is the first SELECT at paren depth 0; everything before
  // it is the WITH preamble.
  let depth = 0;
  let preambleEnd = sql.length;
  const tokRe = /\(|\)|\bselect\b/gi;
  let m;
  while ((m = tokRe.exec(sql)) !== null) {
    const tok = m[0];
    if (tok === '(') depth++;
    else if (tok === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0) { preambleEnd = m.index; break; }
  }
  const preamble = sql.slice(0, preambleEnd);
  if (!/^\s*with\b/i.test(preamble)) return new Set();
  const names = new Set();
  const nameRe = /([a-z_][a-z0-9_]*)\s+as\s*\(/gi;
  let n;
  while ((n = nameRe.exec(preamble)) !== null) names.add(n[1].toLowerCase());
  return names;
}

/**
 * Validate agent-supplied SQL. Pure function (unit-tested).
 * @returns {{ ok: true, cleaned: string } | { ok: false, error: string }}
 */
function validateSql(rawSql) {
  if (typeof rawSql !== 'string' || !rawSql.trim()) {
    return { ok: false, error: 'SQL must be a non-empty string.' };
  }
  if (rawSql.length > MAX_SQL_CHARS) {
    return { ok: false, error: `SQL exceeds the ${MAX_SQL_CHARS} character limit.` };
  }

  let sql = rawSql.trim();
  // Allow one trailing semicolon; anything else means stacked statements.
  if (sql.endsWith(';')) sql = sql.slice(0, -1).trim();
  if (sql.includes(';')) {
    return { ok: false, error: 'Only a single statement is allowed (no stacked queries).' };
  }

  if (!/^\s*(select|with)\b/i.test(sql)) {
    return { ok: false, error: 'Only read-only SELECT (or WITH ... SELECT) queries are allowed.' };
  }

  if (/--|(\/\*)|(\*\/)/.test(sql)) {
    return { ok: false, error: 'SQL comments are not allowed.' };
  }

  const dequoted = stripStringLiterals(sql);

  if (FORBIDDEN_KEYWORDS.test(dequoted)) {
    return { ok: false, error: 'Only read-only queries are allowed (no writes or schema changes).' };
  }

  if (/\b(pg_catalog|information_schema)\b/i.test(dequoted) || /\bpg_[a-z_]+\b/i.test(dequoted)) {
    return { ok: false, error: 'System catalogs are not queryable.' };
  }

  // Every referenced table must be allowlisted. The scan covers nested
  // subqueries since FROM/JOIN appear literally at every nesting level.
  // An optional schema qualifier (public.analytics_videos) is accepted and
  // ignored -- models routinely write it, and rejecting it with 'Table
  // "public" is not queryable' cost loop iterations before this fix.
  const tableRefs = new Set();
  const tableRe = /\b(?:from|join)\s+(?:"?[a-z_][a-z0-9_]*"?\.)?"?([a-z_][a-z0-9_]*)"?/gi;
  let m;
  while ((m = tableRe.exec(dequoted)) !== null) {
    tableRefs.add(m[1].toLowerCase());
  }
  if (tableRefs.size === 0) {
    return { ok: false, error: 'The query must reference at least one analytics table.' };
  }
  const ctes = cteNames(dequoted);
  for (const table of tableRefs) {
    if (ctes.has(table)) continue; // derived table from the WITH clause
    if (DENIED_TABLES.includes(table)) {
      return { ok: false, error: `Table "${table}" is not queryable (restricted data).` };
    }
    if (!ALLOWED_TABLES.includes(table)) {
      return { ok: false, error: `Table "${table}" is not queryable. Allowed: ${ALLOWED_TABLES.join(', ')}.` };
    }
  }

  for (const col of DENIED_COLUMNS) {
    if (new RegExp(`\\b${col}\\b`, 'i').test(dequoted)) {
      return { ok: false, error: `Selecting column "${col}" is not allowed (sensitive data).` };
    }
  }

  return { ok: true, cleaned: sql };
}

module.exports = {
  name: TOOL_NAME,
  description:
    '[ADMIN] Complex ad-hoc analytics over Postgres ingested data. First call with action "schema" to learn the exact tables/columns (one cheap call, no guessing). Then action "query" with a single read-only SELECT over those tables. Ingested tables only: analytics_channels, analytics_videos, analytics_channel_metrics_daily, analytics_video_metrics_daily, analytics_playlists, analytics_playlist_items, analytics_dashboard_snapshots, analytics_sync_runs. Goals/focus tables are not queryable (planning data, not measured data). Single SELECT/WITH only, no writes, max 100 rows. Admin only.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['schema', 'query'],
        description: 'Use "schema" first to get table/column inventory, then "query" to run SQL.',
        default: 'query',
      },
      sql: {
        type: 'string',
        description: 'A single read-only SELECT (or WITH ... SELECT) over the allowed analytics tables. Required for action "query". No semicolons, comments, or writes.',
      },
      maxRows: {
        type: 'number',
        description: 'Max rows to return (1-100, default 50).',
        default: DEFAULT_MAX_ROWS,
      },
    },
    required: [],
  },

  execute: async (args, { deps, userContext }) => {
    if (!userContext || (userContext.role !== 'admin' && userContext.isAdmin !== true)) {
      return { error: 'This tool is only available for admin users.' };
    }

    const action = args?.action || 'query';
    if (action === 'schema') {
      return { tables: TABLE_SCHEMAS };
    }
    if (action !== 'query') {
      return { error: 'Unknown action. Use "schema" or "query".' };
    }

    const { query: dbQuery, isPostgresConfigured } = deps;
    if (!isPostgresConfigured || !isPostgresConfigured()) {
      return { error: 'Database is not configured.' };
    }
    if (typeof dbQuery !== 'function') {
      return { error: 'Database query interface is unavailable.' };
    }

    const checked = validateSql(args?.sql);
    if (!checked.ok) return { error: checked.error };

    const limit = clampMaxRows(args?.maxRows);

    try {
      // Wrap to enforce the row cap regardless of the inner LIMIT.
      const result = await dbQuery(
        `SELECT * FROM (${checked.cleaned}) AS _sql_query LIMIT ${limit}`,
      );
      const rows = result?.rows || [];
      return {
        columns: rows.length > 0 ? Object.keys(rows[0]) : [],
        rows,
        rowCount: rows.length,
        truncated: rows.length >= limit,
        note: rows.length >= limit
          ? `Capped at ${limit} rows -- narrow the query (filters, aggregates) for the rest.`
          : 'Read-only analytics query.',
      };
    } catch (err) {
      console.warn('[Tool:queryAnalyticsDb] Failed:', err.message);
      return { error: `Query failed: ${safeErrorMessage(err)}` };
    }
  },

  // Pure helpers exported for unit tests.
  validateSql,
  clampMaxRows,
  ALLOWED_TABLES,
  DENIED_TABLES,
  TABLE_SCHEMAS,
};

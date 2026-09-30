/**
 * Custom-dashboard layouts (per-user grid matrix, personal + per-org scopes).
 *
 * Backed by Postgres (`custom_dashboard_layouts`) instead of Firestore user
 * docs: layout saves are high-churn UI traffic, and Postgres avoids a
 * Firestore read+write per drag while giving us a queryable matrix
 * (owner/org/name + JSONB cells) for future sharing/templates.
 *
 * Reads are cached (`customDash:{uid}:{org}:{name}`, 1h TTL); the write path
 * is the only invalidator. When Postgres is not configured the service
 * reports `supported: false` and the frontend falls back to its local
 * mirror instead of breaking the page.
 */

const {
  sanitizeDashboardLayout,
  sanitizeDashboardName,
} = require("../utils/customDashboardPrefs");

/** Per-scope cache TTL (layouts change more often than stat-card prefs). */
const DASHBOARD_CACHE_TTL_MS = 60 * 60 * 1000;

function createCustomDashboardService(deps) {
  const { query, isPostgresConfigured, getCachedOrgMembership, serverCache } = deps;

  const cacheKey = (uid, orgId, name) =>
    `customDash:${uid}:${orgId || "personal"}:${name}`;

  const configured = () =>
    typeof isPostgresConfigured === "function" ? isPostgresConfigured() : !!query;

  /** Org scopes require membership; personal scope (`""`) is always allowed. */
  async function assertScopeAccess(uid, orgId) {
    if (!orgId) return;
    const membership = await getCachedOrgMembership(orgId, uid);
    if (!membership) {
      const error = new Error("Not an organization member");
      error.status = 403;
      throw error;
    }
  }

  /**
   * Load one dashboard layout.
   * Returns `{ supported, layout }` (`layout` null when nothing saved yet).
   */
  async function getLayout(uid, orgId = "", name = "default") {
    const scope = String(orgId || "");
    const dashboard = sanitizeDashboardName(name);
    if (!configured()) return { supported: false, layout: null };

    const key = cacheKey(uid, scope, dashboard);
    try {
      const cached = await serverCache.get(key);
      if (cached) return { supported: true, layout: cached.layout ?? null };
    } catch {
      /* cache hiccup -- fall through to Postgres */
    }

    const result = await query(
      `SELECT layout FROM custom_dashboard_layouts
        WHERE owner_uid = $1 AND org_id = $2 AND name = $3
        LIMIT 1`,
      [uid, scope, dashboard],
    );
    const layout =
      result && result.rows.length > 0
        ? sanitizeDashboardLayout(result.rows[0].layout)
        : null;
    try {
      await serverCache.set(key, { layout }, DASHBOARD_CACHE_TTL_MS);
    } catch {
      /* best-effort cache */
    }
    return { supported: true, layout };
  }

  /** Upsert one dashboard layout (sanitized). Returns the stored layout. */
  async function saveLayout(uid, orgId = "", name = "default", layout) {
    const scope = String(orgId || "");
    const dashboard = sanitizeDashboardName(name);
    if (!configured()) {
      const error = new Error("Dashboard storage is not configured");
      error.status = 503;
      throw error;
    }
    await assertScopeAccess(uid, scope);

    const clean = sanitizeDashboardLayout(layout);
    await query(
      `INSERT INTO custom_dashboard_layouts (owner_uid, org_id, name, layout, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, now())
       ON CONFLICT (owner_uid, org_id, name)
       DO UPDATE SET layout = EXCLUDED.layout, updated_at = now()`,
      [uid, scope, dashboard, JSON.stringify(clean)],
    );
    try {
      await serverCache.delete(cacheKey(uid, scope, dashboard));
    } catch {
      /* best-effort invalidation */
    }
    return clean;
  }

  return { getLayout, saveLayout };
}

module.exports = { createCustomDashboardService, DASHBOARD_CACHE_TTL_MS };

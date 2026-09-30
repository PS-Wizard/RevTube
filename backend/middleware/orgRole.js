/**
 * Middleware: requireOrgWrite(getCachedOrgMembership)
 *
 * Enforces organization role permissions for org-scoped requests, i.e. requests
 * that carry an `X-Org-Id` header.
 *
 * Read-only members (`role === 'read'`) are only allowed to issue safe read
 * requests (GET / HEAD / OPTIONS). Any attempt to run an audit, save or rename
 * history, or delete a saved run (POST / PATCH / PUT / DELETE) is rejected with
 * 403, so "seeing history" is preserved while all mutations are blocked.
 *
 * Personal (non-org) requests and non-member calls pass through untouched --
 * other middleware owns those cases.
 *
 * @param {(orgId: string, uid: string) => Promise<{isMember: boolean, role?: string} | null>} getCachedOrgMembership
 */
function requireOrgWrite(getCachedOrgMembership) {
  return async (req, res, next) => {
    const orgId = req.headers["x-org-id"];
    // Only applies to org-scoped calls; personal calls pass through.
    if (!orgId) return next();

    const uid = req.authUser?.uid;
    if (!uid) return next();

    try {
      const membership = await getCachedOrgMembership(String(orgId), String(uid));
      if (!membership || !membership.isMember) return next();

      if (membership.role === "read") {
        const isWrite =
          req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS";
        if (isWrite) {
          return res.status(403).json({
            error: {
              message:
                "Read-only members can only view history in this organization. Running or modifying audits is not permitted.",
            },
          });
        }
      }
      next();
    } catch (err) {
      console.warn("[requireOrgWrite] Membership check failed:", err.message);
      next();
    }
  };
}

module.exports = { requireOrgWrite };
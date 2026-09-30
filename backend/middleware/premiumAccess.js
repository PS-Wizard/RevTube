/**
 * Middleware: checkPremiumAccess(pageKey)
 * Blocks non-pro users from premium-only endpoints.
 * Org members may inherit pro access from their org's plan.
 */
function checkPremiumAccess(getFeatureConfig, getCachedUser, getCachedOrgMembership, getCachedOrg) {
  return (pageKey) =>
    async (req, res, next) => {
      try {
        const cfg = await getFeatureConfig();
        const pageCfg = cfg?.pages?.[pageKey];

        if (pageCfg?.premiumOnly) {
          if (req.headers["x-usage-context"] === "resolve") return next();

          if (!req.currentUser) {
            req.currentUser = await getCachedUser(req.authUser?.email);
          }
          const isProUser =
            req.currentUser?.package === "pro" || req.currentUser?.role === "admin";

          if (!isProUser) {
            const orgId = req.headers["x-org-id"];
            if (orgId) {
              const requestingUid = req.authUser?.uid;
              const isMember = await getCachedOrgMembership(orgId, requestingUid);
              if (isMember) {
                const org = await getCachedOrg(orgId);
                if (org?.plan === "pro") return next();
              }
            }

            return res.status(403).json({
              error: {
                code: "PREMIUM_REQUIRED",
                message: "This feature requires a Pro subscription.",
              },
            });
          }
        }
      } catch (err) {
        console.warn("[checkPremiumAccess] Error:", err.message);
      }
      next();
    };
}

module.exports = { checkPremiumAccess };

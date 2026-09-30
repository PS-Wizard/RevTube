const express = require("express");

function createUsageRouter(deps) {
  const {
    db, serverCache, getFeatureConfig, DEFAULT_FEATURE_CONFIG,
    requireQuota, consumeQuota, resolveUser,
  } = deps;
  const router = express.Router();

  // Get current user's monthly usage counts
  router.get("/me", async (req, res) => {
    try {
      const userEmail = req.authUser?.email;
      if (!userEmail)
        return res.status(401).json({ error: { message: "Missing authenticated user email" } });

      const snap = await db
        .collection("users")
        .where("email", "==", userEmail)
        .limit(1)
        .get();
      if (snap.empty)
        return res.json({ usage: {}, month: new Date().toISOString().slice(0, 7) });

      const { uid, package: userPackage } = snap.docs[0].data();
      const month = new Date().toISOString().slice(0, 7);

      const usage = {};
      if (serverCache.useRedis && serverCache.redisClient) {
        const pageKeys = Object.keys(DEFAULT_FEATURE_CONFIG.pages);
        for (const pageKey of pageKeys) {
          try {
            const usageKey = `usage:${uid}:${pageKey}:${month}`;
            const val = await serverCache.redisClient.get(usageKey);
            if (val !== null) usage[pageKey] = parseInt(val, 10);
          } catch {
            // fall through to Firestore
          }
        }
      }

      const usageDoc = await db
        .collection("users")
        .doc(uid)
        .collection("usage")
        .doc(month)
        .get();

      if (usageDoc.exists) {
        const fsData = usageDoc.data();
        for (const key of Object.keys(fsData)) {
          if (key === "updatedAt") continue;
          if (usage[key] === undefined) usage[key] = fsData[key];
        }
      }

      const cfg = await getFeatureConfig();
      const limits = {};
      const isPro = userPackage === "pro";
      for (const [pageKey, pageCfg] of Object.entries(cfg?.pages || {})) {
        limits[pageKey] = isPro ? pageCfg.proLimit : pageCfg.freeLimit;
      }

      res.json({ usage, month, limits });
    } catch (err) {
      console.error("[Usage/me] Error:", err.message);
      res.status(500).json({ error: { message: err.message } });
    }
  });

  // Synthetic quota endpoint for the Compare page (no dedicated data route)
  router.post("/track", resolveUser, requireQuota("compare"), async (req, res) => {
    try {
      await consumeQuota(req, { billable: true });
      res.json({ success: true });
    } catch (err) {
      console.error("[Usage Track] Error:", err.message);
      res.status(500).json({ error: { message: err.message } });
    }
  });

  return router;
}

module.exports = { createUsageRouter };

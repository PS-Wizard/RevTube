const express = require("express");
const { getOptimizerCriteria, mergeCriteriaWithExisting, playlistWeightTotal, validatePlaylistWeights } = require("../config/optimizerCriteria");
const { getParamDefinitions, mergeParamDefinitions } = require("../config/channelAuditParameterDefinitions");
const { getScoringProfile, DEFAULT_PROFILE } = require("../config/channelAuditScoringProfiles");

function createAdminRouter(deps) {
  const {
    admin, db, serverCache, checkAdmin,
    getUserAccessByUid, upsertUserAccess, invalidateCachedUser,
    getFeatureConfig, bumpConfigVersion, invalidateFeatureConfigCache, DEFAULT_FEATURE_CONFIG,
    invalidateAuditCriteriaCache,
    invalidateOptimizerCriteriaCache,
    invalidateParamCache,
    invalidateProfileCache,
  } = deps;
  const router = express.Router();

  // Admin: Get all users
  router.get("/users", checkAdmin, async (req, res) => {
    try {
      // 1. Fetch all users from Firebase Auth
      let authUsers = [];
      let pageToken;
      do {
        const result = await admin.auth().listUsers(1000, pageToken);
        authUsers = authUsers.concat(result.users);
        pageToken = result.pageToken;
      } while (pageToken);

      // 2. Fetch all user records from Firestore
      const snapshot = await db.collection("users").get();
      const firestoreUsers = {};
      snapshot.docs.forEach((doc) => {
        firestoreUsers[doc.id] = { uid: doc.id, ...doc.data() };
      });

      // 3. Merge data
      const mergedUsers = authUsers.map((authUser) => {
        const fsData = firestoreUsers[authUser.uid] || {};
        return {
          uid: authUser.uid,
          email: authUser.email,
          displayName: authUser.displayName || fsData.displayName,
          photoURL: authUser.photoURL || fsData.photoURL,
          role: fsData.role || "user",
          package: fsData.package || "free",
          createdAt: fsData.createdAt || {
            _seconds: Math.floor(new Date(authUser.metadata.creationTime).getTime() / 1000),
          },
          lastLogin: fsData.lastLogin || {
            _seconds: Math.floor(new Date(authUser.metadata.lastSignInTime).getTime() / 1000),
          },
        };
      });

      // 4. Sort descending by createdAt
      mergedUsers.sort((a, b) => {
        const aTime = a.createdAt?._seconds || 0;
        const bTime = b.createdAt?._seconds || 0;
        return bTime - aTime;
      });

      res.json(mergedUsers);
    } catch (error) {
      console.error("[Admin Get Users] Error:", error);
      res.status(500).json({ error: { message: error.message } });
    }
  });

  // Admin: Update user package
  router.put("/users/:uid/package", checkAdmin, async (req, res) => {
    try {
      const { uid } = req.params;
      const { package: newPackage } = req.body;

      if (!["free", "pro"].includes(newPackage)) {
        return res.status(400).json({ error: { message: "Invalid package type" } });
      }

      let emailToStore = null;
      try {
        const authUser = await admin.auth().getUser(uid);
        emailToStore = authUser.email || null;
      } catch (authErr) {
        console.warn(`[Admin Update Package] Could not fetch Auth user for uid=${uid}:`, authErr.message);
      }

      const updatePayload = {
        uid,
        package: newPackage,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: req.adminUser.email,
      };
      if (emailToStore) updatePayload.email = emailToStore;

      await db.collection("users").doc(uid).set(updatePayload, { merge: true });
      const existingPgAccess = await getUserAccessByUid(uid);
      await upsertUserAccess({
        uid,
        email: emailToStore,
        role: existingPgAccess?.role || "user",
        packageName: newPackage,
        source: "admin-update",
        updatedBy: req.adminUser.email,
      });
      await invalidateCachedUser(emailToStore);

      console.log(`[Admin Update Package] uid=${uid} email=${emailToStore} → package=${newPackage}`);
      res.json({ success: true, package: newPackage });
    } catch (error) {
      console.error("[Admin Update Package] Error:", error);
      res.status(500).json({ error: { message: error.message } });
    }
  });

  // Admin: Update user role
  router.put("/users/:uid/role", checkAdmin, async (req, res) => {
    try {
      const { uid } = req.params;
      const { role: newRole } = req.body;

      if (!["admin", "user"].includes(newRole)) {
        return res.status(400).json({ error: { message: "Invalid role type" } });
      }

      let emailToStore = null;
      try {
        const authUser = await admin.auth().getUser(uid);
        emailToStore = authUser.email || null;
      } catch (authErr) {
        console.warn(`[Admin Update Role] Could not fetch Auth user for uid=${uid}:`, authErr.message);
      }

      const updatePayload = {
        uid,
        role: newRole,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: req.adminUser.email,
      };
      if (emailToStore) updatePayload.email = emailToStore;

      await db.collection("users").doc(uid).set(updatePayload, { merge: true });
      const existingPgAccess = await getUserAccessByUid(uid);
      await upsertUserAccess({
        uid,
        email: emailToStore,
        role: newRole,
        packageName: existingPgAccess?.package || "free",
        source: "admin-update",
        updatedBy: req.adminUser.email,
      });
      await invalidateCachedUser(emailToStore);

      res.json({ success: true, role: newRole });
    } catch (error) {
      console.error("[Admin Update Role] Error:", error);
      res.status(500).json({ error: { message: error.message } });
    }
  });

  // Admin: Get all connected channels system-wide (org channels + personal tokens).
  // Used by the admin optimizers so the admin can analyze any connected channel.
  router.get("/channels", checkAdmin, async (req, res) => {
    try {
      const channels = new Map(); // channelId -> channel record (deduped)

      // 1. Org channels (organizations/{orgId}/channels/{channelId})
      const orgSnap = await db.collectionGroup("channels").get();
      const orgIds = new Set();
      orgSnap.docs.forEach((doc) => {
        const orgId = doc.ref.parent.parent?.id;
        if (orgId) orgIds.add(orgId);
      });

      // Fetch org names in batches (Firestore "in" supports up to 30 values).
      const orgNameById = new Map();
      const orgIdList = Array.from(orgIds);
      for (let i = 0; i < orgIdList.length; i += 30) {
        const chunk = orgIdList.slice(i, i + 30);
        const orgDocs = await db
          .collection("organizations")
          .where("__name__", "in", chunk)
          .get();
        orgDocs.forEach((doc) => {
          const d = doc.data() || {};
          orgNameById.set(doc.id, d.name || d.title || "");
        });
      }

      orgSnap.docs.forEach((doc) => {
        const data = doc.data() || {};
        const channelId = data.channelId || doc.id;
        if (!channelId) return;
        if (!channels.has(channelId)) {
          channels.set(channelId, {
            channelId,
            channelTitle: data.channelTitle || channelId,
            thumbnailUrl: data.thumbnailUrl || "",
            ownerType: "org",
            ownerName: orgNameById.get(doc.ref.parent.parent?.id) || "",
          });
        }
      });

      // 2. Personal tokens (users/{uid}/youtubeTokens/{channelId})
      const tokenSnap = await db.collectionGroup("youtubeTokens").get();
      const uids = new Set();
      tokenSnap.docs.forEach((doc) => {
        const uid = doc.ref.parent.parent?.id;
        if (uid) uids.add(uid);
      });

      // Fetch user display names / emails for owner context.
      const userNameById = new Map();
      const uidList = Array.from(uids);
      for (let i = 0; i < uidList.length; i += 30) {
        const chunk = uidList.slice(i, i + 30);
        const userDocs = await db
          .collection("users")
          .where("__name__", "in", chunk)
          .get();
        userDocs.forEach((doc) => {
          const d = doc.data() || {};
          userNameById.set(doc.id, d.displayName || d.email || "");
        });
      }

      tokenSnap.docs.forEach((doc) => {
        const data = doc.data() || {};
        const channelId = data.channelId || doc.id;
        if (!channelId) return;
        if (!channels.has(channelId)) {
          channels.set(channelId, {
            channelId,
            channelTitle: data.channelTitle || channelId,
            thumbnailUrl: data.thumbnailUrl || "",
            ownerType: "user",
            ownerName: userNameById.get(doc.ref.parent.parent?.id) || "",
          });
        }
      });

      const list = Array.from(channels.values()).sort((a, b) =>
        String(a.channelTitle).localeCompare(String(b.channelTitle)),
      );

      res.json({ channels: list, count: list.length });
    } catch (error) {
      console.error("[Admin Get Channels] Error:", error);
      res.status(500).json({ error: { message: error.message } });
    }
  });

  // Admin: Update feature config
  router.put("/config", checkAdmin, async (req, res) => {
    try {
      const config = req.body;
      if (!config || !config.pages) {
        return res.status(400).json({ error: { message: "Invalid config payload" } });
      }
      await db.collection("config").doc("features").set(config);
      await bumpConfigVersion();
      invalidateFeatureConfigCache();
      res.json({ success: true });
    } catch (error) {
      console.error("[Admin Config PUT] Error:", error);
      res.status(500).json({ error: { message: error.message } });
    }
  });

  // Admin: Get current audit criteria config -- grouped by the audit category
  // each section drives. Sourced from the SINGLE unified criteria store
  // (config/optimizerCriteria) so everything here is the SAME data the
  // optimizers and the Full Audit score against:
  //   video     -> Video Audit per-element criteria (grouped by element category)
  //   thumbnail -> Thumbnail Optimizer 12-pillar framework (tier + weight);
  //                consumed by the Video Audit's thumbnail element -- thumbnails
  //                are intentionally NOT part of the Full Audit sub-audits
  //   playlist  -> Playlist Optimizer criteria
  router.get("/audit-criteria", checkAdmin, async (req, res) => {
    try {
      const cfg = await getOptimizerCriteria(db);
      res.json({
        video: cfg.videoElements,
        thumbnail: cfg.thumbnail,
        playlist: cfg.playlist,
      });
    } catch (error) {
      console.error("[Admin AuditCriteria GET] Error:", error.message);
      res.status(500).json({ error: { message: error.message } });
    }
  });

  // Admin: Update audit criteria config. Accepts { video, thumbnail, playlist }
  // (`videoElements` also accepted as an alias) and merges the submitted
  // sections into the unified criteria doc (config/optimizerCriteria) so the
  // param sections edited from the audit-parameters tab are never clobbered.
  router.put("/audit-criteria", checkAdmin, async (req, res) => {
    try {
      const body = req.body || {};
      const incomingVideo = body.videoElements || body.video;
      // Reject an explicitly empty submitted list up-front: the merge overlays
      // rows on top of defaults, so an empty array would silently become the
      // default set instead of clearing the criteria.
      if (incomingVideo !== undefined && (!Array.isArray(incomingVideo) || incomingVideo.length === 0)) {
        return res.status(400).json({ error: { message: "At least one valid video criterion is required." } });
      }
      const existing = await getOptimizerCriteria(db);
      const merged = mergeCriteriaWithExisting(existing, {
        videoElements: incomingVideo,
        thumbnail: body.thumbnail,
        playlist: body.playlist,
      });
      if (!Array.isArray(merged.videoElements) || merged.videoElements.length === 0) {
        return res.status(400).json({ error: { message: "At least one valid video criterion is required." } });
      }
      if (body.playlist !== undefined) {
        const playlistErr = validatePlaylistWeights(merged.playlist);
        if (playlistErr) {
          return res.status(400).json({ error: { message: playlistErr } });
        }
      }
      await db.collection("config").doc("optimizerCriteria").set(merged);
      await bumpConfigVersion();
      invalidateAuditCriteriaCache();
      invalidateOptimizerCriteriaCache();
      invalidateParamCache();
      res.json({ success: true });
    } catch (error) {
      console.error("[Admin AuditCriteria PUT] Error:", error.message);
      res.status(500).json({ error: { message: error.message } });
    }
  });

  // Admin: Get optimizer criteria config (thumbnail pillars + playlist criteria)
  router.get("/optimizer-criteria", checkAdmin, async (req, res) => {
    try {
      const cfg = await getOptimizerCriteria(db);
      const playlistWeightTotalValue = playlistWeightTotal(cfg.playlist);
      res.json({ ...cfg, playlistWeightTotal: playlistWeightTotalValue, weightTotal: playlistWeightTotalValue });
    } catch (error) {
      console.error("[Admin OptimizerCriteria GET] Error:", error.message);
      res.status(500).json({ error: { message: error.message } });
    }
  });

  // Admin: Update optimizer criteria config. Merges the submitted sections on
  // top of the stored doc so other sections (e.g. params edited from the
  // audit-parameters tab) are preserved.
  router.put("/optimizer-criteria", checkAdmin, async (req, res) => {
    try {
      const body = req.body || {};
      const existing = await getOptimizerCriteria(db);
      const merged = mergeCriteriaWithExisting(existing, body);
      if (!Array.isArray(merged.thumbnail) || merged.thumbnail.length === 0) {
        return res.status(400).json({ error: { message: "At least one valid thumbnail criterion is required." } });
      }
      if (!Array.isArray(merged.playlist) || merged.playlist.length === 0) {
        return res.status(400).json({ error: { message: "At least one valid playlist criterion is required." } });
      }
      const playlistErr = validatePlaylistWeights(merged.playlist);
      if (playlistErr) {
        return res.status(400).json({ error: { message: playlistErr } });
      }
      await db.collection("config").doc("optimizerCriteria").set(merged);
      await bumpConfigVersion();
      invalidateOptimizerCriteriaCache();
      invalidateParamCache();
      res.json({ success: true });
    } catch (error) {
      console.error("[Admin OptimizerCriteria PUT] Error:", error.message);
      res.status(500).json({ error: { message: error.message } });
    }
  });

  // Admin: Get centralized audit parameter definitions
  router.get("/audit-parameter-definitions", checkAdmin, async (req, res) => {
    try {
      const defs = await getParamDefinitions(db);
      res.json({ params: defs });
    } catch (error) {
      console.error("[Admin AuditParamDefs GET] Error:", error.message);
      res.status(500).json({ error: { message: error.message } });
    }
  });

  // Admin: Update audit parameter definitions. Params live in the SAME unified
  // criteria doc as the thumbnail/playlist criteria (single source of truth),
  // so this merges the flat param list into the current criteria and persists
  // the whole object to config/optimizerCriteria.
  router.put("/audit-parameter-definitions", checkAdmin, async (req, res) => {
    try {
      const body = req.body || {};
      const merged = await mergeParamDefinitions(db, body.params);
      await db.collection("config").doc("optimizerCriteria").set(merged);
      await bumpConfigVersion();
      invalidateParamCache();
      invalidateOptimizerCriteriaCache();
      res.json({ success: true });
    } catch (error) {
      console.error("[Admin AuditParamDefs PUT] Error:", error.message);
      res.status(500).json({ error: { message: error.message } });
    }
  });

  // Admin: Get centralized audit scoring profile
  router.get("/audit-scoring-profiles", checkAdmin, async (req, res) => {
    try {
      const profile = await getScoringProfile(db);
      res.json(profile);
    } catch (error) {
      console.error("[Admin AuditProfiles GET] Error:", error.message);
      res.status(500).json({ error: { message: error.message } });
    }
  });

  // Admin: Update centralized audit scoring profile (weights must sum to 1.0)
  router.put("/audit-scoring-profiles", checkAdmin, async (req, res) => {
    try {
      const body = req.body || {};
      const merged = { ...DEFAULT_PROFILE, ...body };
      const sum = ["channelIdentity", "video", "playlist", "general"].reduce((s, k) => s + (Number(merged.subAuditWeights?.[k]) || 0), 0);
      if (Math.abs(sum - 1) > 0.001) {
        return res.status(400).json({ error: { message: `Sub-audit weights must sum to 1.0 (got ${sum}).` } });
      }
      await db.collection("config").doc("auditScoringProfiles").set(merged);
      await bumpConfigVersion();
      invalidateProfileCache();
      res.json({ success: true });
    } catch (error) {
      console.error("[Admin AuditProfiles PUT] Error:", error.message);
      res.status(500).json({ error: { message: error.message } });
    }
  });

  // Admin: Clear server cache
  router.post("/cache/clear", checkAdmin, async (req, res) => {
    try {
      await serverCache.clear();
      invalidateFeatureConfigCache();
      console.log("[Admin] Cache cleared by:", req.adminUser.email);
      res.json({
        success: true,
        message: "Server cache cleared successfully",
        clearedBy: req.adminUser.email,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[Admin Cache Clear] Error:", error);
      res.status(500).json({ error: { message: error.message } });
    }
  });

  // Admin: Clean stale dashboard snapshot rows from PostgreSQL.
  // `analytics_dashboard_snapshots` rows hold cached dashboard payloads with an
  // `expires_at` column. Over time these accumulate (expired rows are not
  // cleared on read) and orphan rows remain for deleted channels. This endpoint
  // removes them so the snapshot table stays small. Mode "stale" (default) only
  // deletes expired rows; mode "all" truncates the whole table.
  router.post("/cleanup/snapshots", checkAdmin, async (req, res) => {
    try {
      const { query: pgQuery, isPostgresConfigured } = require("../db/client");
      if (!isPostgresConfigured()) {
        return res.status(503).json({ error: { message: "PostgreSQL is not configured." } });
      }

      const mode = req.body?.mode === "all" ? "all" : "stale";

      // Snapshot counts before cleanup.
      let expiredCount = 0;
      let totalCount = 0;
      try {
        const expiredRes = await pgQuery(
          "SELECT COUNT(*) AS n FROM analytics_dashboard_snapshots WHERE expires_at IS NOT NULL AND expires_at < NOW()"
        );
        expiredCount = Number(expiredRes?.rows?.[0]?.n || 0);
        const totalRes = await pgQuery("SELECT COUNT(*) AS n FROM analytics_dashboard_snapshots");
        totalCount = Number(totalRes?.rows?.[0]?.n || 0);
      } catch (countErr) {
        console.warn("[Admin Cleanup Snapshots] Count probe failed:", countErr.message);
      }

      const delRes =
        mode === "all"
          ? await pgQuery("DELETE FROM analytics_dashboard_snapshots")
          : await pgQuery(
            "DELETE FROM analytics_dashboard_snapshots WHERE expires_at IS NOT NULL AND expires_at < NOW()"
          );
      const deleted = delRes?.rowCount || 0;

      // Expired rows without an explicit expires_at clamp get swept anyway based
      // on age (14 days) so genuinely stale-but-unexpired payloads are removed.
      if (mode === "stale" && totalCount > 0) {
        try {
          await pgQuery(
            "DELETE FROM analytics_dashboard_snapshots WHERE updated_at < NOW() - INTERVAL '14 days'"
          );
        } catch {
          /* best-effort age sweep */
        }
      }

      console.log(
        `[Admin] Snapshots cleaned by ${req.adminUser.email}: mode=${mode} deleted=${deleted} ` +
          `(expired=${expiredCount}, totalBefore=${totalCount})`
      );
      res.json({
        success: true,
        mode,
        deleted,
        expired: expiredCount,
        totalBefore: totalCount,
        cleanedBy: req.adminUser.email,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[Admin Cleanup Snapshots] Error:", error.message);
      res.status(500).json({ error: { message: error.message } });
    }
  });

  // Admin: Get cache stats
  router.get("/cache/stats", checkAdmin, async (req, res) => {
    try {
      const metrics = serverCache.getMetrics();
      const userCacheHits = serverCache.metrics.userCacheHits || 0;
      const userCacheMisses = serverCache.metrics.userCacheMisses || 0;
      const orgCacheHits = serverCache.metrics.orgCacheHits || 0;
      const orgCacheMisses = serverCache.metrics.orgCacheMisses || 0;
      const usageRedisHits = serverCache.metrics.usageRedisHits || 0;
      const usageFirestoreHits = serverCache.metrics.usageFirestoreHits || 0;

      const userHitRate =
        userCacheHits + userCacheMisses > 0
          ? ((userCacheHits / (userCacheHits + userCacheMisses)) * 100).toFixed(1)
          : 0;
      const orgHitRate =
        orgCacheHits + orgCacheMisses > 0
          ? ((orgCacheHits / (orgCacheHits + orgCacheMisses)) * 100).toFixed(1)
          : 0;

      const stats = {
        type: serverCache.useRedis ? "redis" : "in-memory",
        size: serverCache.size(),
        maxSize: serverCache.maxSize,
        ttl: `${serverCache.defaultTTL / 1000 / 60 / 60}h`,
        redisConnected: serverCache.useRedis && serverCache.redisClient?.isOpen,
        compressionEnabled: serverCache.compressionEnabled,
        metrics: {
          analytics: {
            totalRequests: metrics.hits + metrics.misses,
            hits: metrics.hits,
            misses: metrics.misses,
            hitRate: metrics.hitRate,
            compressions: metrics.compressions,
            decompressions: metrics.decompressions,
            compressionErrors: metrics.compressionErrors,
            decompressionErrors: metrics.decompressionErrors,
            cacheWrites: metrics.sets,
            totalOriginalSizeBytes: metrics.totalOriginalSize,
            totalCompressedSizeBytes: metrics.totalCompressedSize,
            compressionRatio: metrics.compressionRatio,
            averageCompressedSizeBytes: metrics.averageCompressedSize,
          },
          users: {
            hits: userCacheHits,
            misses: userCacheMisses,
            hitRate: `${userHitRate}%`,
            totalRequests: userCacheHits + userCacheMisses,
            savePerHit: "150-300ms (Firestore query avoided)",
          },
          organizations: {
            hits: orgCacheHits,
            misses: orgCacheMisses,
            hitRate: `${orgHitRate}%`,
            totalRequests: orgCacheHits + orgCacheMisses,
            savePerHit: "100-200ms (Firestore query avoided)",
          },
          usage: {
            redisHits: usageRedisHits,
            firestoreHits: usageFirestoreHits,
            redisPercentage:
              usageRedisHits + usageFirestoreHits > 0
                ? ((usageRedisHits / (usageRedisHits + usageFirestoreHits)) * 100).toFixed(1)
                : 0,
            savePerRedisHit: "200ms (Firestore read + write avoided)",
          },
        },
        storageSavings:
          metrics.totalOriginalSize > 0
            ? `${(metrics.totalOriginalSize - metrics.totalCompressedSize).toLocaleString()} bytes saved`
            : "N/A",
        estimatedTimesSaved: {
          description: "Estimated time saved by caching",
          userCacheHits: `${(userCacheHits * 0.2).toFixed(1)}s (user lookups)`,
          orgCacheHits: `${(orgCacheHits * 0.15).toFixed(1)}s (org lookups)`,
          usageRedisHits: `${(usageRedisHits * 0.2).toFixed(1)}s (usage tracking)`,
          totalEstimated: `${(userCacheHits * 0.2 + orgCacheHits * 0.15 + usageRedisHits * 0.2).toFixed(1)}s total`,
        },
      };
      res.json(stats);
    } catch (error) {
      console.error("[Admin Cache Stats] Error:", error);
      res.status(500).json({ error: { message: error.message } });
    }
  });

  // Admin: Reset cache metrics
  router.post("/cache/metrics/reset", checkAdmin, async (req, res) => {
    try {
      serverCache.resetMetrics();
      res.json({
        success: true,
        message: "Cache metrics reset successfully",
        resetBy: req.adminUser.email,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[Admin Cache Metrics Reset] Error:", error);
      res.status(500).json({ error: { message: error.message } });
    }
  });

  // Debug tokens endpoint (non-production only)
  if (process.env.NODE_ENV !== "production") {
    router.get("/debug/tokens", checkAdmin, (req, res) => {
      const userEmail = req.authUser?.email;
      res.json({
        message: "Check Firebase Console directly",
        userEmail,
        note: "Debug endpoint enabled in non-production only.",
      });
    });
  }

  return router;
}

module.exports = { createAdminRouter };

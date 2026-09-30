const express = require("express");
const { sanitizeCardLayoutPrefs } = require("../utils/cardLayoutPrefs");

/** Per-user cache TTL for the stat-card layout (read once per session, max). */
const UI_PREFS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function createUserRouter(deps) {
  const {
    admin, db, serverCache, authenticateRequest,
    getUserAccessByEmail, getUserAccessByUid, upsertUserAccess,
    invalidateCachedUser, getCachedUser,
    warmOrgMemberCache, ORG_MEMBER_CACHE_TTL_MS,
  } = deps;
  const router = express.Router();

  const uiPrefsCacheKey = (uid) => `uiPrefs:${uid}`;

  // User Sync
  router.post("/sync", authenticateRequest, async (req, res) => {
    try {
      const { uid: bodyUid, email: bodyEmail, displayName, photoURL } = req.body;
      const uid = req.authUser.uid;
      const email = req.authUser.email;
      if (
        (bodyUid && bodyUid !== uid) ||
        (bodyEmail && String(bodyEmail).toLowerCase() !== String(email).toLowerCase())
      ) {
        return res.status(403).json({ error: { message: "User identity mismatch with authenticated token" } });
      }
      console.log(`[User Sync] Syncing user: ${email} (${uid})`);

      let userData = { uid, email, displayName, photoURL, role: "user", package: "free" };

      if (email === "support@revketer.ai") {
        userData.role = "admin";
        userData.package = "pro";
        console.log(`[User Sync] Hardcoded ADMIN fallback for ${email}`);
      }

      try {
        const userRef = db.collection("users").doc(uid);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
          const newUserData = {
            ...userData,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            lastLogin: admin.firestore.FieldValue.serverTimestamp(),
          };

          if (email.endsWith("@revketer.ai") && email !== "support@revketer.ai") {
            const adminQuery = await db
              .collection("users")
              .where("role", "==", "admin")
              .limit(1)
              .get();
            if (adminQuery.empty) {
              newUserData.role = "admin";
              newUserData.package = "pro";
              console.log(`[User Sync] Making first @revketer.ai user an admin: ${email}`);
            }
          }

          await userRef.set(newUserData);
          userData = { ...newUserData, createdAt: new Date() };
          console.log(`[User Sync] Created new user in Firestore: ${email}`);
        } else {
          const existingData = userDoc.data();
          await userRef.update({
            displayName, photoURL,
            lastLogin: admin.firestore.FieldValue.serverTimestamp(),
          });
          userData = { ...userData, ...existingData, displayName, photoURL, uid };
          if (email === "support@revketer.ai") {
            userData.role = "admin";
            userData.package = "pro";
          }
          console.log(`[User Sync] Updated existing user in Firestore: ${email} (role=${userData.role}, package=${userData.package})`);
        }
        await upsertUserAccess({
          uid, email,
          role: userData.role || "user",
          packageName: userData.package || "free",
          source: "user-sync",
        });
        await invalidateCachedUser(email);
      } catch (dbError) {
        console.warn(`[User Sync] Firestore operation failed: ${dbError.message}. Using fallback data for response.`);
        if (email === "support@revketer.ai") {
          userData.role = "admin";
          userData.package = "pro";
        }
      }

      res.json(userData);
    } catch (error) {
      console.error("[User Sync] CRITICAL ERROR:", error.message);
      res.status(500).json({ error: { message: error.message } });
    }
  });

  // User Init
  router.post("/init", authenticateRequest, async (req, res) => {
    const startedAt = Date.now();
    try {
      const { uid: bodyUid, email: bodyEmail, displayName, photoURL } = req.body;
      const uid = req.authUser.uid;
      const email = req.authUser.email;
      if (
        (bodyUid && bodyUid !== uid) ||
        (bodyEmail && String(bodyEmail).toLowerCase() !== String(email).toLowerCase())
      ) {
        return res.status(403).json({ error: { message: "User identity mismatch with authenticated token" } });
      }

      console.log(`[User Init] Initializing user: ${email} (${uid})`);

      let userData = { uid, email, displayName, photoURL, role: "user", package: "free" };
      const userRef = db.collection("users").doc(uid);
      const userDoc = await userRef.get();

      if (!userDoc.exists) {
        const newUserData = {
          ...userData,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          lastLogin: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (email.endsWith("@revketer.ai") && email !== "support@revketer.ai") {
          const adminQuery = await db
            .collection("users")
            .where("role", "==", "admin")
            .limit(1)
            .get();
          if (adminQuery.empty) {
            newUserData.role = "admin";
            newUserData.package = "pro";
          }
        }
        await userRef.set(newUserData);
        userData = { ...newUserData, createdAt: new Date() };
      } else {
        const existingData = userDoc.data();
        await userRef.update({
          displayName, photoURL,
          lastLogin: admin.firestore.FieldValue.serverTimestamp(),
        });
        userData = { ...userData, ...existingData, displayName, photoURL, uid };
      }

      if (email === "support@revketer.ai") {
        userData.role = "admin";
        userData.package = "pro";
      }
      await upsertUserAccess({
        uid, email,
        role: userData.role || "user",
        packageName: userData.package || "free",
        source: "user-init",
      });
      await invalidateCachedUser(email);

      // Fetch organizations & memberships
      const orgIds = userData.organizations || [];
      let organizations = [];
      let memberships = {};

      if (orgIds.length > 0) {
        const chunkedIds = [];
        for (let i = 0; i < orgIds.length; i += 10) {
          chunkedIds.push(orgIds.slice(i, i + 10));
        }

        await Promise.all(
          chunkedIds.map(async (chunk) => {
            const orgsSnap = await db
              .collection("organizations")
              .where(admin.firestore.FieldPath.documentId(), "in", chunk)
              .get();
            orgsSnap.docs.forEach((doc) => {
              organizations.push({ id: doc.id, ...doc.data() });
            });
          }),
        );

        await Promise.all(
          orgIds.map(async (orgId) => {
            const memberDoc = await db
              .collection("organizations")
              .doc(orgId)
              .collection("members")
              .doc(uid)
              .get();
            if (memberDoc.exists) {
              memberships[orgId] = memberDoc.data();
            }
            const value = memberDoc.exists
              ? { isMember: true, role: memberDoc.data()?.role || null }
              : null;
            warmOrgMemberCache(orgId, uid, value, serverCache);
          }),
        );
      }

      // Fetch YouTube tokens
      const tokensSnap = await db
        .collection("users")
        .doc(uid)
        .collection("youtubeTokens")
        .get();
      const tokens = tokensSnap.docs.map((doc) => ({ ...doc.data() }));

      const durationMs = Date.now() - startedAt;
      console.log(`[Perf] user/init total: ${durationMs}ms for ${email}`);

      res.json({ user: userData, organizations, memberships, tokens });
    } catch (error) {
      console.error("[User Init] ERROR:", error.message);
      res.status(500).json({ error: { message: error.message } });
    }
  });

  // ── Stat-card layout customization ─────────────────────────────────────────
  // Persisted per user under `users/{uid}.uiPreferences.cardLayout`. The layout
  // is surface-agnostic (`dashboard:channelAnalytics`, `dashboard:audience`, ...)
  // so new customizable surfaces need no backend change. Reads are cached and
  // the write path is the only invalidator, so a signed-in user costs at most
  // one Firestore read + one write per customization change.

  router.get("/ui-preferences", async (req, res) => {
    const uid = req.authUser?.uid;
    if (!uid) {
      return res.status(401).json({ error: { message: "Missing authenticated user" } });
    }
    const cacheKey = uiPrefsCacheKey(uid);
    try {
      const cached = await serverCache.get(cacheKey);
      if (cached) return res.json(cached);

      let cardLayout = {};
      try {
        const userDoc = await db.collection("users").doc(uid).get();
        cardLayout = sanitizeCardLayoutPrefs(
          userDoc.exists ? userDoc.data()?.uiPreferences?.cardLayout : null,
        );
      } catch (dbError) {
        // Firestore hiccup must never block the dashboard -- fall back to
        // defaults (the client keeps its localStorage mirror either way).
        console.warn(`[User UI Prefs] Read failed for ${uid}: ${dbError.message}`);
      }

      const payload = { cardLayout };
      await serverCache.set(cacheKey, payload, UI_PREFS_CACHE_TTL_MS);
      return res.json(payload);
    } catch (error) {
      console.error("[User UI Prefs GET] ERROR:", error.message);
      return res.status(500).json({ error: { message: error.message } });
    }
  });

  router.put("/ui-preferences", async (req, res) => {
    const uid = req.authUser?.uid;
    if (!uid) {
      return res.status(401).json({ error: { message: "Missing authenticated user" } });
    }
    try {
      const cardLayout = sanitizeCardLayoutPrefs(req.body?.cardLayout);
      const userRef = db.collection("users").doc(uid);
      await userRef.set(
        {
          uiPreferences: {
            cardLayout,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
        { merge: true },
      );
      await serverCache.delete(uiPrefsCacheKey(uid));
      return res.json({ cardLayout });
    } catch (error) {
      console.error("[User UI Prefs PUT] ERROR:", error.message);
      return res.status(503).json({ error: { message: "Could not save layout preferences" } });
    }
  });

  return router;
}

module.exports = { createUserRouter };

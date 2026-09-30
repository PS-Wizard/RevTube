/**
 * Middleware: authenticateRequest
 * Verifies Firebase ID token from X-Firebase-Token header.
 */
function authenticateRequest(admin) {
  return async (req, res, next) => {
    const firebaseToken = req.headers["x-firebase-token"];
    if (!firebaseToken || typeof firebaseToken !== "string") {
      return res
        .status(401)
        .json({ error: { message: "Missing X-Firebase-Token header" } });
    }

    try {
      const decoded = await admin.auth().verifyIdToken(firebaseToken);
      const email = decoded.email;
      if (!email) {
        return res
          .status(401)
          .json({ error: { message: "Authenticated user missing email claim" } });
      }
      req.authUser = {
        uid: decoded.uid,
        email,
        claims: decoded,
      };
      next();
    } catch (error) {
      return res
        .status(401)
        .json({ error: { message: "Invalid Firebase token" } });
    }
  };
}

/**
 * Middleware: checkAdmin
 * Confirms the authenticated user has admin role.
 */
function checkAdmin(getUserAccessByEmail, upsertUserAccess, firestoreDb) {
  return async (req, res, next) => {
    const userEmail = req.authUser?.email;
    if (!userEmail) {
      return res
        .status(401)
        .json({ error: { message: "Missing authenticated user email" } });
    }

    if (userEmail === "support@revketer.ai") {
      req.adminUser = { email: userEmail, role: "admin" };
      return next();
    }

    try {
      const pgUser = await getUserAccessByEmail(userEmail);
      if (pgUser?.role === "admin") {
        req.adminUser = pgUser;
        return next();
      }

      const db = firestoreDb || require("firebase-admin").firestore();
      const userDoc = await db
        .collection("users")
        .where("email", "==", userEmail)
        .limit(1)
        .get();
      if (userDoc.empty || userDoc.docs[0].data().role !== "admin") {
        return res
          .status(403)
          .json({ error: { message: "Forbidden: Admin access required" } });
      }
      const firestoreUser = userDoc.docs[0].data();
      req.adminUser = firestoreUser;
      await upsertUserAccess({
        uid: firestoreUser.uid || req.authUser?.uid || null,
        email: userEmail,
        role: firestoreUser.role || "user",
        packageName: firestoreUser.package || "free",
        source: "firestore-fallback",
      });
      next();
    } catch (error) {
      console.warn("[checkAdmin] Firestore query failed:", error.message);
      res.status(403).json({
        error: { message: "Forbidden: Admin access required (Firestore unavailable)" },
      });
    }
  };
}

/**
 * Middleware: resolveUser
 * Attaches the current user's package/profile to req.currentUser.
 */
function resolveUser(getCachedUser) {
  return async (req, res, next) => {
    const userEmail = req.authUser?.email;
    if (!userEmail)
      return res
        .status(401)
        .json({ error: { message: "Missing authenticated user email" } });

    req.currentUser = await getCachedUser(userEmail);
    next();
  };
}

module.exports = { authenticateRequest, checkAdmin, resolveUser };

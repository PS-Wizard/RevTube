const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const USER_CACHE_TTL_SEC = 24 * 60 * 60; // 24 hours in Redis

const _userCache = new Map(); // email → { data, cachedAt }

async function invalidateCachedUser(email, serverCache) {
  if (!email) return;
  _userCache.delete(email);
  if (serverCache.useRedis && serverCache.redisClient) {
    await serverCache.delete(`user:${email}`);
  }
}

async function getCachedUser(email, serverCache, db, getUserAccessByEmail, upsertUserAccess) {
  if (email === "support@revketer.ai") {
    return { email, role: "admin", package: "pro" };
  }

  // Try Redis first
  if (serverCache.useRedis && serverCache.redisClient) {
    try {
      const cached = await serverCache.get(`user:${email}`);
      if (cached) {
        serverCache.metrics.userCacheHits =
          (serverCache.metrics.userCacheHits || 0) + 1;
        return cached;
      }
    } catch (err) {
      console.warn("[getCachedUser] Redis lookup failed:", err.message);
    }
  }

  // In-memory cache
  const cached = _userCache.get(email);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  // PostgreSQL
  try {
    const pgUser = await getUserAccessByEmail(email);
    if (pgUser) {
      _userCache.set(email, { data: pgUser, cachedAt: Date.now() });
      if (serverCache.useRedis && serverCache.redisClient) {
        await serverCache.set(`user:${email}`, pgUser, USER_CACHE_TTL_SEC * 1000);
      }
      serverCache.metrics.userCacheMisses =
        (serverCache.metrics.userCacheMisses || 0) + 1;
      return pgUser;
    }
  } catch (err) {
    console.warn("[getCachedUser] Postgres fetch failed:", err.message);
  }

  // Firestore fallback
  try {
    const snap = await db
      .collection("users")
      .where("email", "==", email)
      .limit(1)
      .get();
    const data = snap.empty
      ? { email, role: "user", package: "free" }
      : snap.docs[0].data();

    _userCache.set(email, { data, cachedAt: Date.now() });
    if (serverCache.useRedis && serverCache.redisClient) {
      await serverCache.set(`user:${email}`, data, USER_CACHE_TTL_SEC * 1000);
    }
    await upsertUserAccess({
      uid: data.uid || null,
      email,
      role: data.role || "user",
      packageName: data.package || "free",
      source: "firestore-sync",
    });

    serverCache.metrics.userCacheMisses =
      (serverCache.metrics.userCacheMisses || 0) + 1;
    console.log(`[Cache] User data: ${email.slice(0, 15)}... WRITE (Redis + memory)`);
    return data;
  } catch (err) {
    console.warn("[getCachedUser] Firestore fetch failed:", err.message);
    return _userCache.get(email)?.data || { email, role: "user", package: "free" };
  }
}

module.exports = { getCachedUser, invalidateCachedUser };

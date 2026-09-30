const _orgCache = new Map(); // orgId → { data, cachedAt }
const _orgMemberCache = new Map(); // `${orgId}:${uid}` → { value, cachedAt }
const CACHE_TTL_MS = 10 * 60 * 1000;
const USER_CACHE_TTL_SEC = 24 * 60 * 60; // 24 hours
const ORG_MEMBER_CACHE_TTL_MS = 15 * 60 * 1000;

async function getCachedOrg(orgId, serverCache, db) {
  if (serverCache.useRedis && serverCache.redisClient) {
    try {
      const cached = await serverCache.get(`org:${orgId}`);
      if (cached) {
        serverCache.metrics.orgCacheHits =
          (serverCache.metrics.orgCacheHits || 0) + 1;
        return cached;
      }
    } catch (err) {
      console.warn("[getCachedOrg] Redis lookup failed:", err.message);
    }
  }

  const cached = _orgCache.get(orgId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const doc = await db.collection("organizations").doc(orgId).get();
    const data = doc.exists ? doc.data() : null;

    _orgCache.set(orgId, { data, cachedAt: Date.now() });
    if (serverCache.useRedis && serverCache.redisClient && data) {
      await serverCache.set(`org:${orgId}`, data, USER_CACHE_TTL_SEC * 1000);
    }

    serverCache.metrics.orgCacheMisses =
      (serverCache.metrics.orgCacheMisses || 0) + 1;
    return data;
  } catch (err) {
    console.warn("[getCachedOrg] Firestore fetch failed:", err.message);
    return _orgCache.get(orgId)?.data || null;
  }
}

async function getCachedOrgMembership(orgId, uid, serverCache, db) {
  if (!orgId || !uid) return null;
  const key = `${orgId}:${uid}`;
  const redisKey = `org:${orgId}:member:${uid}`;

  if (serverCache.useRedis && serverCache.redisClient) {
    try {
      const cached = await serverCache.get(redisKey);
      if (cached !== null) return cached;
    } catch (err) {
      console.warn("[getCachedOrgMembership] Redis lookup failed:", err.message);
    }
  }

  const memCached = _orgMemberCache.get(key);
  if (memCached && Date.now() - memCached.cachedAt < ORG_MEMBER_CACHE_TTL_MS) {
    return memCached.value;
  }

  try {
    const memberDoc = await db
      .collection("organizations")
      .doc(String(orgId))
      .collection("members")
      .doc(uid)
      .get();

    let value;
    if (memberDoc.exists) {
      const data = memberDoc.data();
      value = { isMember: true, role: data?.role || null };
    } else {
      value = null;
    }

    _orgMemberCache.set(key, { value, cachedAt: Date.now() });
    if (serverCache.useRedis && serverCache.redisClient) {
      await serverCache.set(redisKey, value, ORG_MEMBER_CACHE_TTL_MS).catch(() => {});
    }

    return value;
  } catch (err) {
    console.warn("[getCachedOrgMembership] Firestore read failed:", err.message);
    return _orgMemberCache.get(key)?.value ?? null;
  }
}

async function deleteCachedOrgMembership(orgId, uid, serverCache) {
  if (!orgId || !uid) return;
  const key = `${orgId}:${uid}`;
  const redisKey = `org:${orgId}:member:${uid}`;
  _orgMemberCache.delete(key);
  if (serverCache.useRedis && serverCache.redisClient) {
    await serverCache.delete(redisKey).catch((err) =>
      console.warn("[deleteCachedOrgMembership] Redis delete failed:", err.message),
    );
  }
}

function warmOrgMemberCache(orgId, uid, memberData, serverCache) {
  const key = `${orgId}:${uid}`;
  const redisKey = `org:${orgId}:member:${uid}`;
  const value = memberData || null;
  _orgMemberCache.set(key, { value, cachedAt: Date.now() });
  if (serverCache.useRedis && serverCache.redisClient) {
    serverCache.set(redisKey, value, ORG_MEMBER_CACHE_TTL_MS).catch(() => {});
  }
}

module.exports = {
  getCachedOrg,
  getCachedOrgMembership,
  deleteCachedOrgMembership,
  warmOrgMemberCache,
};

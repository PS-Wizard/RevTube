/**
 * Monthly per-page quota service.
 *
 * Storage: Redis (primary, atomic INCRBY) with Firestore fallback.
 * Keys: usage:{uid}:{pageKey}:{YYYY-MM}
 */

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function usageKey(uid, pageKey, month = currentMonth()) {
  return `usage:${uid}:${pageKey}:${month}`;
}

function dedupKey(uid, pageKey, windowSec) {
  const bucket = Math.floor(Date.now() / (windowSec * 1000));
  return `quota:dedup:${uid}:${pageKey}:${bucket}`;
}

function monthEndTtlSec() {
  const monthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1);
  return Math.max(60, Math.ceil((monthEnd - Date.now()) / 1000));
}

function limitExceededPayload(pageCfg, pageKey, limit, used) {
  return {
    error: {
      code: "LIMIT_EXCEEDED",
      message: `You've reached your monthly ${pageCfg?.label || pageKey} limit of ${limit} searches. Upgrade to Pro for unlimited access.`,
      limit,
      used,
      pageKey,
    },
  };
}

function createQuotaService(deps) {
  const {
    serverCache,
    getFeatureConfig,
    getCachedOrgMembership,
    getCachedOrg,
  } = deps;

  const _dedupCache = new Map();

  async function resolveProAccess(user, req) {
    if (user.package === "pro") return true;
    const orgId = req.headers["x-org-id"];
    if (!orgId) return false;
    const isMember = await getCachedOrgMembership(orgId, user.uid);
    if (!isMember) return false;
    const org = await getCachedOrg(orgId);
    return org?.plan === "pro";
  }

  async function resolvePageLimit(pageKey, user, req) {
    const cfg = await getFeatureConfig();
    const pageCfg = cfg?.pages?.[pageKey];
    if (!pageCfg) return null;

    const isPro = await resolveProAccess(user, req);
    const limit = isPro ? pageCfg.proLimit : pageCfg.freeLimit;
    if (limit === -1 || limit === undefined) return null;

    return { pageCfg, limit, isPro };
  }

  async function readCount(uid, pageKey, month = currentMonth()) {
    const key = usageKey(uid, pageKey, month);

    if (serverCache?.useRedis && serverCache.redisClient) {
      try {
        const val = await serverCache.redisClient.incrBy(key, 0);
        return typeof val === "number" ? val : parseInt(String(val), 10) || 0;
      } catch (err) {
        console.warn("[Quota] Redis read failed, falling back to Firestore:", err.message);
      }
    }

    try {
      const admin = require("firebase-admin");
      const db = admin.firestore();
      const doc = await db.collection("users").doc(uid).collection("usage").doc(month).get();
      return doc.exists ? (doc.data()?.[pageKey] || 0) : 0;
    } catch (err) {
      console.warn("[Quota] Firestore read failed:", err.message);
      return 0;
    }
  }

  async function incrementCount(uid, pageKey, month = currentMonth()) {
    const key = usageKey(uid, pageKey, month);

    if (serverCache?.useRedis && serverCache.redisClient) {
      try {
        const newCount = await serverCache.redisClient.incrBy(key, 1);
        const parsed = typeof newCount === "number" ? newCount : parseInt(String(newCount), 10) || 0;
        if (parsed <= 1) {
          serverCache.redisClient.expire(key, monthEndTtlSec()).catch(() => {});
        }
        return parsed;
      } catch (err) {
        console.warn("[Quota] Redis increment failed, falling back to Firestore:", err.message);
      }
    }

    const admin = require("firebase-admin");
    const db = admin.firestore();
    const usageRef = db.collection("users").doc(uid).collection("usage").doc(month);
    await usageRef.set(
      {
        [pageKey]: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    const doc = await usageRef.get();
    return doc.exists ? (doc.data()?.[pageKey] || 0) : 0;
  }

  async function isDuplicate(uid, pageKey, windowSec) {
    if (windowSec <= 0) return false;
    const key = dedupKey(uid, pageKey, windowSec);

    if (serverCache?.useRedis && serverCache.redisClient) {
      try {
        const result = await serverCache.redisClient.set(key, "1", { NX: true, EX: windowSec });
        return result === null;
      } catch {
        // fall through to memory
      }
    }

    const existing = _dedupCache.get(key);
    if (existing && existing > Date.now()) return true;
    _dedupCache.set(key, Date.now() + windowSec * 1000);
    if (_dedupCache.size > 10000) {
      for (const [k, v] of _dedupCache) {
        if (v < Date.now()) _dedupCache.delete(k);
      }
    }
    return false;
  }

  function markBillable(req) {
    if (req) req.quotaBillable = true;
  }

  return {
    currentMonth,
    usageKey,
    limitExceededPayload,
    resolvePageLimit,
    readCount,
    incrementCount,
    isDuplicate,
    markBillable,
  };
}

module.exports = { createQuotaService, currentMonth, usageKey, limitExceededPayload };

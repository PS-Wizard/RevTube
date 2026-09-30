/**
 * Quota middleware -- consume on every route hit:
 *
 *   1. requireQuota(pageKey)  -- pre-flight read; blocks at limit (429),
 *                               then consumes 1 unit immediately.
 *                              *Every* route hit counts, regardless of
 *                               whether the response comes from cache.
 *
 * Route handlers that still call consumeQuota will be no-ops (the call
 * inside requireQuota sets req._quotaConsumed first).
 */

function createQuotaMiddleware(deps) {
  const {
    quotaService,
    getCachedUser,
    dedupWindowSec = 5,
    pageDedupWindows = {},
  } = deps;

  function dedupWindowFor(pageKey) {
    return pageDedupWindows[pageKey] ?? dedupWindowSec;
  }

  function requireQuota(pageKey) {
    return async (req, res, next) => {
      try {
        if (!req.currentUser) {
          const userEmail = req.authUser?.email;
          if (!userEmail) return next();
          req.currentUser = await getCachedUser(userEmail);
        }

        const user = req.currentUser;
        if (user.role === "admin") return next();

        const resolved = await quotaService.resolvePageLimit(pageKey, user, req);
        if (!resolved) return next();

        const { pageCfg, limit } = resolved;
        const uid = user.uid;
        if (!uid) return next();

        const month = quotaService.currentMonth();
        const used = await quotaService.readCount(uid, pageKey, month);

        if (used >= limit) {
          return res.status(429).json(
            quotaService.limitExceededPayload(pageCfg, pageKey, limit, used),
          );
        }

        req.quotaContext = { pageKey, uid, month, limit, used, pageCfg };
        req.usageInfo = { pageKey, used, limit };

        // Consume 1 unit immediately on every route hit (cache hit or miss -- doesn't matter).
        // The dedup window (default 5s) still prevents rapid double-counting.
        await consumeQuota(req, { billable: true });

        next();
      } catch (err) {
        console.warn("[Quota] requireQuota error, allowing request:", err.message);
        next();
      }
    };
  }

  /**
   * Record one unit of quota usage for this request.
   *
   * @param {import('express').Request} req
   * @param {{ billable?: boolean }} [opts]
   *   billable=true  -- caller confirms this was a live (non-cached) upstream call.
   *   omit           -- consumes only when req.quotaBillable was set by a service.
   */
  async function consumeQuota(req, opts = {}) {
    const ctx = req?.quotaContext;
    if (!ctx || req._quotaConsumed) return;

    const explicitlyBillable = opts.billable === true;
    if (!explicitlyBillable && !req.quotaBillable) return;

    const { pageKey, uid, month, limit } = ctx;
    const windowSec = dedupWindowFor(pageKey);

    if (await quotaService.isDuplicate(uid, pageKey, windowSec)) {
      req._quotaConsumed = true;
      // Even on dedup, report the current Redis count so _usage in
      // the response never carries a stale pre-increment value.
      const currentCount = await quotaService.readCount(uid, pageKey, month);
      req.usageInfo = { pageKey, used: currentCount, limit };
      return;
    }

    req._quotaConsumed = true;
    const newCount = await quotaService.incrementCount(uid, pageKey, month);

    if (newCount > limit) {
      console.warn(`[Quota] Overshoot: ${newCount} > ${limit} for ${uid}:${pageKey}:${month}`);
    }

    req.usageInfo = { pageKey, used: newCount, limit };
  }

  return { requireQuota, consumeQuota };
}

module.exports = { createQuotaMiddleware };

/**
 * Middleware: checkConfigVersion
 *
 * Checks whether the stored config version differs from the one cached in the
 * current request. When a bump is detected, analytics caches are invalidated
 * server-side so stale dashboard data is refreshed.
 */

function createConfigVersionMiddleware(deps) {
  const { getConfigVersion, serverCache, PERF_LOG_ENABLED, invalidateFeatureConfigCache } = deps;

  function getAnalyticsCacheKeys() {
    const keys = [];
    for (const key of serverCache.cache.keys()) {
      if (
        key.startsWith('dashSummary:') ||
        key.startsWith('dashSnap:') ||
        key.startsWith('snapshot:') ||
        key.startsWith('yt:ytan:report:') ||
        key.startsWith('bundle:')
      ) {
        keys.push(key);
      }
    }
    return keys;
  }

  async function invalidateAnalyticsCache() {
    const keys = getAnalyticsCacheKeys();
    for (const key of keys) {
      await serverCache.delete(key);
    }
    if (keys.length > 0 && PERF_LOG_ENABLED) {
      console.log(`[Cache] Invalidated ${keys.length} analytics entries due to config change`);
    }
  }

  async function checkConfigVersion(req, res, next) {
    try {
      const liveVersion = await getConfigVersion();
      const cachedVersion = req.configVersion || 0;
      if (liveVersion !== cachedVersion) {
        await invalidateAnalyticsCache();
        if (typeof invalidateFeatureConfigCache === 'function') {
          invalidateFeatureConfigCache();
        }
      }
      req.configVersion = liveVersion;
    } catch {
      // Swallow errors -- don't block requests on config version read failure
    }
    next();
  }

  return { checkConfigVersion };
}

module.exports = { createConfigVersionMiddleware };

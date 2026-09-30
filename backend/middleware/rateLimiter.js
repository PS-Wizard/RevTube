const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = rateLimit;

const parseLimiterMax = (envValue, fallback) => {
  const parsed = Number.parseInt(envValue ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const ANALYTICS_READ_RATE_LIMIT_PATHS = new Set([
  "/analytics/report",
  "/dashboard/summary",
  "/dashboard/bundle",
  "/analytics/dimensions",
]);

const isAnalyticsReadRoute = (req) =>
  ANALYTICS_READ_RATE_LIMIT_PATHS.has(req.path) ||
  req.path.startsWith("/channel-videos/");

const limiterJsonHandler = (scope) => (req, res) => {
  const rate = req.rateLimit || {};
  const resetTimeMs = rate.resetTime
    ? new Date(rate.resetTime).getTime()
    : null;
  const retryAfterSeconds = resetTimeMs
    ? Math.max(0, Math.ceil((resetTimeMs - Date.now()) / 1000))
    : null;
  const windowMinutes = rate.windowMs ? Math.round(rate.windowMs / 60000) : 15;
  if (retryAfterSeconds !== null) {
    res.set("Retry-After", String(retryAfterSeconds));
  }
  console.warn(
    `[RateLimit:${scope}] Blocked ${req.method} ${req.originalUrl} key=${rate.key ?? "unknown"} remaining=${rate.remaining ?? "n/a"}`,
  );
  return res.status(429).json({
    error: {
      code: "RATE_LIMITED",
      message: `You've sent too many requests. This limit resets in ${retryAfterSeconds !== null ? `${retryAfterSeconds}s` : `${windowMinutes} minutes`}. Please wait and try again.`,
      scope,
      path: req.path,
      method: req.method,
      limit: rate.limit ?? null,
      remaining: rate.remaining ?? null,
      retryAfterSeconds,
      windowMs: rate.windowMs || windowMinutes * 60 * 1000,
    },
  });
};

const oauthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseLimiterMax(process.env.OAUTH_LIMIT_MAX, 30),
  standardHeaders: true,
  legacyHeaders: false,
  handler: limiterJsonHandler("oauth"),
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseLimiterMax(process.env.AUTH_LIMIT_MAX, 240),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => isAnalyticsReadRoute(req),
  keyGenerator: (req) =>
    req.authUser?.uid || req.authUser?.email || ipKeyGenerator(req),
  handler: limiterJsonHandler("api"),
});

const analyticsReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseLimiterMax(process.env.ANALYTICS_READ_LIMIT_MAX, 1200),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.authUser?.uid || req.authUser?.email,
  handler: limiterJsonHandler("analytics"),
});

// Admin routes: 60 requests per 15 minutes per admin user.
// Prevents brute-force admin endpoint abuse even if admin token is compromised.
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseLimiterMax(process.env.ADMIN_LIMIT_MAX, 60),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    req.authUser?.uid || req.authUser?.email || ipKeyGenerator(req),
  handler: limiterJsonHandler("admin"),
});

/**
 * Create a tier-aware resolveLimiter.
 * @param {Function} getFeatureConfig -- async function returning FeatureConfig (with .pages.resolve)
 */
function createResolveLimiter(getFeatureConfig) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: async (req) => {
      if (!req.currentUser) return parseLimiterMax(process.env.RESOLVE_LIMIT_MAX, 60);
      try {
        const cfg = await getFeatureConfig();
        const resolveCfg = cfg.pages?.resolve;
        if (!resolveCfg) return parseLimiterMax(process.env.RESOLVE_LIMIT_MAX, 60);
        const limit = req.currentUser.package === "pro" ? resolveCfg.proLimit : resolveCfg.freeLimit;
        // express-rate-limit v8+: max: 0 = unlimited
        return limit === -1 ? 0 : limit;
      } catch {
        return parseLimiterMax(process.env.RESOLVE_LIMIT_MAX, 60);
      }
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.authUser?.uid || req.authUser?.email || ipKeyGenerator(req),
    handler: limiterJsonHandler("resolve"),
  });
}

module.exports = {
  oauthLimiter,
  authLimiter,
  analyticsReadLimiter,
  adminLimiter,
  createResolveLimiter,
  isAnalyticsReadRoute,
};

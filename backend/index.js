// ─────────────────────────────────────────────────────────────────────────────
// RevTube Backend -- refactored modular architecture
// ─────────────────────────────────────────────────────────────────────────────
const path = require("path");
if (process.env.NODE_ENV !== "production") {
  require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });
}

const fs = require("fs");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const axios = require("axios");
const admin = require("firebase-admin");

// Force outbound sockets over IPv4. In Docker/Coolify the container's IPv6
// route often hangs (no IPv6 egress), so Node's default happy-eyeballs tries
// the IPv6 AAAA record first and every outbound call (OAuth refresh, YouTube
// API, DeepSeek, Gemini) stalls into 502/ETIMEDOUT -- while curl/wget to the
// same host succeed. Pinning family:4 on the shared axios default fixes the
// whole class at once, no per-call-site changes needed.
const https = require("https");
axios.defaults.httpsAgent = new https.Agent({ family: 4, keepAlive: true });

// ── Module-level constants ──────────────────────────────────────────────────
const PERF_LOG_ENABLED = process.env.PERF_LOG === "1";
const ANALYTICS_SOURCE = process.env.ANALYTICS_SOURCE || "postgres-first";
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.YOUTUBE_API_KEY;
const YOUTUBE_CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const YOUTUBE_CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
const OAUTH_TOKEN_CACHE_TTL_MS = 55 * 60 * 1000;
const QUOTA_DEDUP_WINDOW_SEC = Math.max(
  0,
  parseInt(
    process.env.QUOTA_DEDUP_WINDOW_SEC ||
      process.env.USAGE_DEDUP_WINDOW_SEC ||
      "5",
    10,
  ),
);
// Ingestion catalog cap -- single source lives in ingestion/sync.js (env-driven,
// shared with cron + queue workers); reused here for deps consumers.
const {
  DEFAULT_MAX_VIDEOS_PER_CHANNEL: MAX_VIDEOS_PER_CHANNEL,
} = require("./ingestion/sync");

const DASHBOARD_INFLIGHT = {
  summary: new Map(),
  bundle: new Map(),
};

// ── Firebase Admin Initialization ───────────────────────────────────────────
const loadServiceAccount = () => {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed);
    if (parsed.private_key && typeof parsed.private_key === "string") {
      parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
    }
    return parsed;
  }
  if (/^[A-Za-z0-9+/=]+$/.test(trimmed)) {
    try {
      const decoded = Buffer.from(trimmed, "base64").toString("utf8");
      const parsed = JSON.parse(decoded);
      if (parsed.private_key && typeof parsed.private_key === "string") {
        parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
      }
      return parsed;
    } catch (_err) {
      /* fall through */
    }
  }
  if (fs.existsSync(trimmed)) {
    const parsed = JSON.parse(fs.readFileSync(trimmed, "utf8"));
    if (parsed.private_key && typeof parsed.private_key === "string") {
      parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
    }
    return parsed;
  }
  throw new Error(
    "FIREBASE_SERVICE_ACCOUNT is set but not valid JSON, base64 JSON, or a readable file path",
  );
};

if (!admin.apps.length) {
  const firebaseProjectId =
    process.env.VITE_FIREBASE_PROJECT_ID || "revketer-yt-tool";
  const hasAdcHint = Boolean(
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCP_PROJECT,
  );
  try {
    const serviceAccount = loadServiceAccount();
    if (serviceAccount) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id || firebaseProjectId,
      });
      console.log("Firebase initialized via FIREBASE_SERVICE_ACCOUNT");
    } else {
      if (process.env.NODE_ENV === "production" && !hasAdcHint) {
        throw new Error(
          "Missing Firebase credentials in production. Set FIREBASE_SERVICE_ACCOUNT or GOOGLE_APPLICATION_CREDENTIALS.",
        );
      }
      admin.initializeApp({ projectId: firebaseProjectId });
      console.warn(
        "Firebase initialized without explicit service account; relying on application default credentials.",
      );
    }
  } catch (err) {
    console.error("Firebase initialization failed:", err.message);
    throw err;
  }
}
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

// ── Import modules ──────────────────────────────────────────────────────────
const ServerCache = require("./cache/ServerCache");
const { setCacheEventRecorder } = require("./cache/ServerCache");
const { query, withClient } = require("./db/client");
const { getDb } = require("./db/drizzle");
const { getCachedUser, invalidateCachedUser } = require("./cache/userCache");
const {
  getCachedOrg,
  getCachedOrgMembership,
  deleteCachedOrgMembership,
  warmOrgMemberCache,
} = require("./cache/orgCache");
const {
  getFeatureConfig,
  invalidateFeatureConfigCache,
  mergeFeatureConfigPages,
  DEFAULT_FEATURE_CONFIG,
} = require("./config/featureConfig");
const {
  getConfigVersion,
  bumpConfigVersion,
} = require("./config/configVersion");
const {
  getAuditScoring,
  invalidateAuditScoringCache,
} = require("./config/channelAuditScoring");
const {
  getAuditCriteria,
  invalidateAuditCriteriaCache,
} = require("./config/channelAuditCriteria");
const {
  getOptimizerCriteria,
  invalidateOptimizerCriteriaCache,
} = require("./config/optimizerCriteria");
const {
  getParamDefinitions,
  invalidateParamCache,
} = require("./config/channelAuditParameterDefinitions");
const {
  getScoringProfile,
  invalidateProfileCache,
} = require("./config/channelAuditScoringProfiles");
const { perfLog, perfNow } = require("./utils/perfLog");
const { withInFlight, withInFlightTimeout } = require("./utils/inflight");
const {
  shortHash,
  sanitizeCacheSegment,
  youtubeDataScope,
  YT_DATA_CACHE_TTL_MS,
} = require("./utils/cacheScope");
const { handleApiError } = require("./utils/handleApiError");
const {
  authenticateRequest,
  checkAdmin,
  resolveUser,
} = require("./middleware/auth");
const { checkPremiumAccess } = require("./middleware/premiumAccess");
const { createQuotaMiddleware } = require("./middleware/quota");
const { createQuotaService } = require("./services/quotaService");
const {
  oauthLimiter,
  authLimiter,
  analyticsReadLimiter,
  adminLimiter,
  createResolveLimiter,
} = require("./middleware/rateLimiter");
const { resolveOrgToken } = require("./middleware/orgToken");
const { requireOrgWrite } = require("./middleware/orgRole");
const { requestLogger } = require("./middleware/requestLogger");
const { createConfigVersionMiddleware } = require("./middleware/configVersion");
const {
  sendInvitationEmail,
  sendOwnershipTransferEmail,
  sendAuditCompleteEmail,
} = require("./emailService");
const { isPostgresConfigured } = require("./db/client");
const {
  loadBundleFromPostgres,
  loadSummaryFromPostgres,
  loadChannelVideosFromPostgres,
  getChannelLastSyncedAt,
  loadChannelTotalsFromPostgres,
  getLatestMetricDate,
  getVideosByIds,
  isStale: isPlaylistDataStale,
  PLAYLIST_READ_MODEL_MAX_AGE_HOURS,
  getPlaylistsSyncedAt,
  loadPlaylistsFromPostgres,
  loadPlaylistMetaFromPostgres,
  loadPlaylistItemsFromPostgres,
} = require("./ingestion/readModels");
const {
  ingestChannelDaily,
  syncChannelPlaylists,
} = require("./ingestion/sync");
const { upsertPlaylists, upsertPlaylistItems } = require("./ingestion/store");
const {
  getDashboardSnapshot,
  upsertDashboardSnapshot,
  deleteDashboardSnapshots,
} = require("./ingestion/snapshots");
const {
  getUserAccessByEmail,
  getUserAccessByUid,
  upsertUserAccess,
} = require("./db/userAccessStore");

// Service factories
const { createAnalyticsService } = require("./services/analyticsService");
const { createDashboardBundleService } = require("./services/dashboardBundle");
const { createDimensionsService } = require("./services/dimensionsService");
const { createInsightsService } = require("./services/insightsService");
const {
  createBestTimeToPostService,
} = require("./services/bestTimeToPostService");
const {
  createChannelVideosService,
} = require("./services/channelVideosService");
const {
  createChannelPlaylistsService,
} = require("./services/channelPlaylistsService");
const { createTokenService } = require("./services/tokenService");
const { createQueueService } = require("./queue");
const {
  createThumbnailOptimizerService,
} = require("./services/thumbnailOptimizerService");
const {
  createPlaylistOptimizerService,
} = require("./services/playlistOptimizerService");

// Route factories
const { createOAuthRouter } = require("./routes/oauth");
const { createUserRouter } = require("./routes/user");
const { createOrganizationRouter } = require("./routes/organization");
const { createAdminRouter } = require("./routes/admin");
const { createUsageRouter } = require("./routes/usage");
const { createChannelsRouter } = require("./routes/channels");
const { createPlaylistsRouter } = require("./routes/playlists");
const { createVideosRouter } = require("./routes/videos");
const { createCaptionsRouter } = require("./routes/captions");
const { createDashboardRouter } = require("./routes/dashboard");
const { createDashboardTabsRouter } = require("./routes/dashboardTabs");
const { createAnalyticsRouter } = require("./routes/analytics");
const { createChannelVideosRouter } = require("./routes/channelVideos");
const { createCompareRouter } = require("./routes/compare");
const {
  createThumbnailOptimizerRouter,
} = require("./routes/thumbnailOptimizer");
const { createPlaylistOptimizerRouter } = require("./routes/playlistOptimizer");
const { createVideoAuditRouter } = require("./routes/videoAudit");
const { createPublicAuditRouter } = require("./routes/publicAudit");
const { createAuditOrchestratorRouter } = require("./routes/auditOrchestrator");
const { createNotificationRouter } = require("./routes/notification");
const { createVideoAuditService } = require("./services/videoAuditService");
const { createPublicAuditService } = require("./services/publicAuditService");
const {
  createAuditScoringService,
} = require("./services/channelAuditScoringService");
const { createNotificationService } = require("./services/notificationService");
const { createVideoAuditLLM } = require("./services/videoAuditLLM");
const { createAnomalyService } = require("./services/anomalyService");
const { createAnomaliesRouter } = require("./routes/anomalies");
const { buildExplainPrompt, buildBatchExplainPrompt, normalizeExplanation } = require("./services/anomalyPrompts");
const {
  createChatService,
  createUserChatRouter,
  createAdminChatRouter,
} = require("./chat");
const { createGoalsService } = require("./services/goalsService");
const { createAuditInputService } = require("./services/auditInputService");
const { createGoalsRouter } = require("./routes/goals");
const { createCustomDashboardService } = require("./services/customDashboardService");
const { createCustomDashboardsRouter } = require("./routes/customDashboards");
const { createChannelFocusService } = require("./services/channelFocusService");
const { createChannelFocusRouter } = require("./routes/channelFocus");
const { securityHeaders } = require("./config/securityHeaders");

// ── Instantiate ServerCache ──────────────────────────────────────────────────
// Entry cap and fallback TTL are env-tunable. CACHE_MAX_ENTRIES bounds the
// in-process LRU; CACHE_FALLBACK_TTL_HOURS bounds how long an entry may live
// when Redis is unavailable (the conservative default matches the ServerCache
// class default of 12h rather than the previous 24h, so a Redis outage cannot
// serve day-old data).
const CACHE_MAX_ENTRIES = Math.max(1, parseInt(process.env.CACHE_MAX_ENTRIES || '1000', 10) || 1000);
const CACHE_FALLBACK_TTL_HOURS = Math.max(0.1, parseFloat(process.env.CACHE_FALLBACK_TTL_HOURS || '12') || 12);
const serverCache = new ServerCache(CACHE_MAX_ENTRIES, CACHE_FALLBACK_TTL_HOURS * 60 * 60 * 1000);
console.log(
  "[Cache] Server-side cache initialized (compression: " +
    (serverCache.compressionEnabled ? "enabled" : "disabled") +
    ", in-memory with Redis fallback, " +
    CACHE_FALLBACK_TTL_HOURS +
    "h fallback TTL)",
);

// ── Wire up cache event recorder (AsyncLocalStorage) ─────────────────────────
const { requestCacheStore } = require("./middleware/requestLogger");
setCacheEventRecorder((event, key) => {
  const store = requestCacheStore.getStore();
  if (!store) return;
  if (!Array.isArray(store.cacheEvents)) store.cacheEvents = [];
  const prefix = key.replace(/:.*$/, "");
  const already = store.cacheEvents.some(
    (e) => e[0] === event && e[1] === prefix,
  );
  if (already) return;
  if (store.cacheEvents.length >= 8) return;
  store.cacheEvents.push([event, prefix]);
});

// ── Create bound config functions ───────────────────────────────────────────
const boundGetFeatureConfig = () => getFeatureConfig(db);
const boundGetConfigVersion = () => getConfigVersion(db);
const boundBumpConfigVersion = () => bumpConfigVersion(db);
const boundGetAuditScoring = () => getAuditScoring(db);
const boundGetAuditCriteria = () => getAuditCriteria(db);
const boundGetOptimizerCriteria = () => getOptimizerCriteria(db);
const boundGetParamDefinitions = () => getParamDefinitions(db);
const boundGetScoringProfile = () => getScoringProfile(db);

// ── Create config version middleware ────────────────────────────────────────
const { checkConfigVersion } = createConfigVersionMiddleware({
  getConfigVersion: boundGetConfigVersion,
  serverCache,
  invalidateFeatureConfigCache,
  PERF_LOG_ENABLED,
});

// ── Build the shared deps object ────────────────────────────────────────────
const sharedDeps = {
  admin,
  db,
  serverCache,
  axios,
  shortHash,
  sanitizeCacheSegment,
  youtubeDataScope,
  YT_DATA_CACHE_TTL_MS,
  OAUTH_TOKEN_CACHE_TTL_MS,
  PERF_LOG_ENABLED,
  ANALYTICS_SOURCE,
  API_KEY,
  YOUTUBE_CLIENT_ID,
  YOUTUBE_CLIENT_SECRET,
  YOUTUBE_API_BASE,
  DASHBOARD_INFLIGHT,
  MAX_VIDEOS_PER_CHANNEL,
  handleApiError,
  perfLog,
  perfNow,
  withInFlight,
  withInFlightTimeout,
  // Config
  getFeatureConfig: boundGetFeatureConfig,
  getConfigVersion: boundGetConfigVersion,
  bumpConfigVersion: boundBumpConfigVersion,
  invalidateFeatureConfigCache,
  invalidateAuditScoringCache,
  getAuditScoring: boundGetAuditScoring,
  invalidateAuditCriteriaCache,
  getAuditCriteria: boundGetAuditCriteria,
  getOptimizerCriteria: boundGetOptimizerCriteria,
  invalidateOptimizerCriteriaCache,
  mergeFeatureConfigPages,
  DEFAULT_FEATURE_CONFIG,
  // Centralized audit config
  getParamDefinitions: boundGetParamDefinitions,
  invalidateParamCache,
  getScoringProfile: boundGetScoringProfile,
  invalidateProfileCache,
  // Cache helpers
  getCachedUser: (email) =>
    getCachedUser(
      email,
      serverCache,
      db,
      getUserAccessByEmail,
      upsertUserAccess,
    ),
  invalidateCachedUser: (email) => invalidateCachedUser(email, serverCache),
  getCachedOrg: (orgId) => getCachedOrg(orgId, serverCache, db),
  getCachedOrgMembership: (orgId, uid) =>
    getCachedOrgMembership(orgId, uid, serverCache),
  deleteCachedOrgMembership: (orgId, uid) =>
    deleteCachedOrgMembership(orgId, uid, serverCache),
  warmOrgMemberCache: (orgId, uid, memberData) =>
    warmOrgMemberCache(orgId, uid, memberData, serverCache),
  // DB helpers
  getUserAccessByEmail,
  getUserAccessByUid,
  upsertUserAccess,
  // Postgres
  query,
  withClient,
  getDb,
  isPostgresConfigured,
  loadBundleFromPostgres,
  loadSummaryFromPostgres,
  loadChannelVideosFromPostgres,
  getChannelLastSyncedAt,
  loadChannelTotalsFromPostgres,
  getLatestMetricDate,
  // Playlist read-model (L2) -- consumed by the playlist tools/routes so
  // playlists are served from Postgres and only refreshed live when stale.
  getPlaylistsSyncedAt,
  loadPlaylistsFromPostgres,
  loadPlaylistMetaFromPostgres,
  loadPlaylistItemsFromPostgres,
  isPlaylistDataStale,
  PLAYLIST_READ_MODEL_MAX_AGE_HOURS,
  upsertPlaylists,
  upsertPlaylistItems,
  getDashboardSnapshot,
  upsertDashboardSnapshot,
  deleteDashboardSnapshots,
  // Email
  sendInvitationEmail,
  sendOwnershipTransferEmail,
  sendAuditCompleteEmail,
  // Ingestion (for queue workers)
  ingestChannelDaily,
  syncChannelPlaylists,
  DEFAULT_MAX_VIDEOS_PER_CHANNEL: MAX_VIDEOS_PER_CHANNEL,
};

// ── Quota service (needed by data services for billable-work marking) ─────────
const quotaService = createQuotaService({
  serverCache,
  getFeatureConfig: boundGetFeatureConfig,
  getCachedOrgMembership: (orgId, uid) =>
    getCachedOrgMembership(orgId, uid, serverCache),
  getCachedOrg: (orgId) => getCachedOrg(orgId, serverCache, db),
});

// ── Create services ─────────────────────────────────────────────────────────
const analyticsService = createAnalyticsService(sharedDeps);
const dashboardBundleService = createDashboardBundleService({
  ...sharedDeps,
  ...analyticsService,
  markQuotaBillable: quotaService.markBillable,
});
const dimensionsService = createDimensionsService({
  ...sharedDeps,
  markQuotaBillable: quotaService.markBillable,
});
const bestTimeToPostService = createBestTimeToPostService(sharedDeps);
const insightsService = createInsightsService({
  ...sharedDeps,
  markQuotaBillable: quotaService.markBillable,
  bestTimeToPostService,
});
const channelVideosService = createChannelVideosService({
  ...sharedDeps,
  markQuotaBillable: quotaService.markBillable,
});
const channelPlaylistsService = createChannelPlaylistsService({
  ...sharedDeps,
  markQuotaBillable: quotaService.markBillable,
  mergeOwnedHiddenPlaylists: require("./utils/privacyList")
    .mergeOwnedHiddenPlaylists,
});
const tokenService = createTokenService(sharedDeps);
const thumbnailOptimizerService = createThumbnailOptimizerService(sharedDeps);
const playlistOptimizerService = createPlaylistOptimizerService(sharedDeps);
const goalsService = createGoalsService({
  getDb,
  getCachedUser: (email) =>
    getCachedUser(
      email,
      serverCache,
      db,
      getUserAccessByEmail,
      upsertUserAccess,
    ),
  getCachedOrgMembership: (orgId, uid) =>
    getCachedOrgMembership(orgId, uid, serverCache),
});

// ── Video audit service (LLM-scored) ───────────────────────────────────────
// The thumbnail element reuses the Thumbnail Optimizer's 12-pillar Gemini
// analysis (passed in below) instead of a separate vision path.
const videoAuditLLM = createVideoAuditLLM({ axios });
const channelFocusService = createChannelFocusService({
  getDb,
  getCachedUser: (email) =>
    getCachedUser(
      email,
      serverCache,
      db,
      getUserAccessByEmail,
      upsertUserAccess,
    ),
  getCachedOrgMembership: (orgId, uid) =>
    getCachedOrgMembership(orgId, uid, serverCache),
  deepSeekJson: videoAuditLLM.deepSeekJson,
  serverCache,
});
const videoAuditService = createVideoAuditService({
  geminiVision: videoAuditLLM.geminiVision,
  deepSeekText: videoAuditLLM.deepSeekText,
  deepSeekBatchText: videoAuditLLM.deepSeekBatchText,
  deepSeekBatchVideos: videoAuditLLM.deepSeekBatchVideos,
  deepSeekJson: videoAuditLLM.deepSeekJson,
  thumbnailOptimizerService,
});
// Public-audit data fetcher (YouTube Data API public endpoints, API key only).
// Shares the tools' ServerCache L1 (channel + playlists) so repeat audits of
// the same channel skip the API entirely and images/counts stay consistent.
const publicAuditService = createPublicAuditService({
  axios,
  API_KEY,
  YOUTUBE_API_BASE,
  serverCache,
  YT_DATA_CACHE_TTL_MS,
});

// Fetch metadata for a set of owned video IDs (title, description, tags,
// thumbnail) for the video audit engine. Captions are not fetched in this pass.
const fetchVideoInputs = async ({ channelId, videoIds, authHeader }) => {
  const inputs = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const chunk = videoIds.slice(i, i + 50);
    const params = { part: "snippet,contentDetails", id: chunk.join(",") };
    const config = { params, timeout: 30000 };
    if (authHeader) config.headers = { Authorization: authHeader };
    else params.key = API_KEY;
    const res = await axios.get(`${YOUTUBE_API_BASE}/videos`, config);
    for (const item of res.data?.items || []) {
      const sn = item.snippet || {};
      const thumb =
        sn.thumbnails?.high || sn.thumbnails?.medium || sn.thumbnails?.default;
      inputs.push({
        videoId: item.id,
        title: sn.title || "",
        description: sn.description || "",
        tags: sn.tags || [],
        keywords: sn.tags || [],
        thumbnail: { url: thumb?.url || "" },
        captions: [],
      });
    }
  }
  return inputs;
};


// Channel Focus live fallback is wired to the audit input service below
// (after serviceDeps exists).

// ── Create notification service (Redis-backed ServerCache store) ───────────
const notificationService = createNotificationService({ serverCache });

// ── Anomaly detection (deterministic engine + AI explanation layer) ────────
// Runs entirely on Postgres data (no YouTube quota): the daily metric series is
// always there, and per-video deltas come from the dated catalog snapshots the
// ingestion loop already writes. AI is only used to explain, never to detect.
const anomalyService = createAnomalyService({
  ...sharedDeps,
  notificationService,
  deepSeekJson: videoAuditLLM.deepSeekJson,
  buildExplainPrompt,
  buildBatchExplainPrompt,
  normalizeExplanation,
});

// Merge service exports back into deps so routes can consume them
const serviceDeps = {
  ...sharedDeps,
  ...analyticsService,
  ...dashboardBundleService,
  ...dimensionsService,
  ...insightsService,
  ...channelVideosService,
  ...channelPlaylistsService,
  ...tokenService,
  notificationService,
  anomalyService,
  // Channel Focus shared by every audit + AI surface (chat, orchestrator,
  // optimizers). Read-cache backed; consumers fall back to inference when empty.
  channelFocusService,
};

// Chat service needs all service methods (analytics, insights, etc.)
const chatService = createChatService(serviceDeps);

// Extend serviceDeps with the chat service and thumbnail optimizer for route consumption
serviceDeps.chatService = chatService;
serviceDeps.thumbnailOptimizerService = thumbnailOptimizerService;
serviceDeps.playlistOptimizerService = playlistOptimizerService;
// Video audit queue worker deps
serviceDeps.auditBatch = videoAuditService.auditBatch;
serviceDeps.fetchVideoInputs = fetchVideoInputs;
// Audit input fetching lives in services/auditInputService.js (parallel
// stages, pooled membership, scope-aware skip). Channel Focus reuses the
// same bundle as its live fallback when Postgres has no catalog yet.
serviceDeps.gatherAuditInput = createAuditInputService({
  axios,
  generateChannelVideos: (args) => serviceDeps.generateChannelVideos(args),
  API_KEY,
  YOUTUBE_API_BASE,
  perfLog,
  perfNow,
}).gatherAuditInput;
channelFocusService.setAuditInputSource(serviceDeps.gatherAuditInput);
serviceDeps.getAuditCriteria = boundGetAuditCriteria;
serviceDeps.getOptimizerCriteria = boundGetOptimizerCriteria;
serviceDeps.videoAuditService = videoAuditService;
serviceDeps.createAuditScoringService = createAuditScoringService;
serviceDeps.db = db;
// Expose the LLM video audit engine to the audit orchestrator queue so the
// Full Audit's video sub-audit reuses the SAME engine as /video-audit.
serviceDeps.videoAuditService = videoAuditService;
// Expose the raw text-JSON LLM so the orchestrator's channel/general AI
// assessments can run one cheap deepSeekJson call each (absent -> algo-only).
serviceDeps.videoAuditLLM = videoAuditLLM;
// Public-audit fetcher (admin-only public channel audits, no OAuth).
serviceDeps.publicAuditService = publicAuditService;

// ── Create queue service (BullMQ) ──────────────────────────────────────────
const queueService = createQueueService(serviceDeps);

// ── Create middleware instances ─────────────────────────────────────────────
const middlewareAuth = authenticateRequest(admin);
const middlewareCheckAdmin = checkAdmin(getUserAccessByEmail, upsertUserAccess);
const middlewareResolveUser = resolveUser((email) =>
  getCachedUser(email, serverCache, db, getUserAccessByEmail, upsertUserAccess),
);
const middlewareCheckPremiumAccess = checkPremiumAccess(
  boundGetFeatureConfig,
  (email) =>
    getCachedUser(
      email,
      serverCache,
      db,
      getUserAccessByEmail,
      upsertUserAccess,
    ),
  (orgId, uid) => getCachedOrgMembership(orgId, uid, serverCache),
  (orgId) => getCachedOrg(orgId, serverCache, db),
);
const { requireQuota: middlewareRequireQuota, consumeQuota } =
  createQuotaMiddleware({
    quotaService,
    getCachedUser: (email) =>
      getCachedUser(
        email,
        serverCache,
        db,
        getUserAccessByEmail,
        upsertUserAccess,
      ),
    dedupWindowSec: QUOTA_DEDUP_WINDOW_SEC,
  });
const middlewareResolveOrgToken = resolveOrgToken((orgId, uid) =>
  getCachedOrgMembership(orgId, uid, serverCache),
);
const middlewareRequireOrgWrite = requireOrgWrite((orgId, uid) =>
  getCachedOrgMembership(orgId, uid, serverCache),
);
const middlewareResolveLimiter = createResolveLimiter(boundGetFeatureConfig);

// Create route deps with middleware injected
const routeDeps = {
  ...serviceDeps,
  queueService,
  chatService,
  mergeOwnedHiddenPlaylists: require("./utils/privacyList")
    .mergeOwnedHiddenPlaylists,
  authenticateRequest: middlewareAuth,
  checkAdmin: middlewareCheckAdmin,
  resolveUser: middlewareResolveUser,
  resolveLimiter: middlewareResolveLimiter,
  checkPremiumAccess: middlewareCheckPremiumAccess,
  requireQuota: middlewareRequireQuota,
  consumeQuota,
  markQuotaBillable: quotaService.markBillable,
  quotaService,
  resolveOrgToken: middlewareResolveOrgToken,
  requireOrgWrite: middlewareRequireOrgWrite,
  analyticsReadLimiter,
  oauthLimiter,
  adminLimiter,
  checkConfigVersion,
};

// ── Create routers ──────────────────────────────────────────────────────────
const oauthRouter = createOAuthRouter(routeDeps);
const userRouter = createUserRouter(routeDeps);
const organizationRouter = createOrganizationRouter(routeDeps);
const adminRouter = createAdminRouter(routeDeps);
const usageRouter = createUsageRouter(routeDeps);
const channelsRouter = createChannelsRouter(routeDeps);
const playlistsRouter = createPlaylistsRouter(routeDeps);
const videosRouter = createVideosRouter(routeDeps);
const captionsRouter = createCaptionsRouter(routeDeps);
const dashboardRouter = createDashboardRouter(routeDeps);
const dashboardTabsRouter = createDashboardTabsRouter(routeDeps);
const analyticsRouter = createAnalyticsRouter(routeDeps);
const channelVideosRouter = createChannelVideosRouter(routeDeps);
const compareRouter = createCompareRouter(routeDeps);
const userChatRouter = createUserChatRouter(routeDeps);
const adminChatRouter = createAdminChatRouter(routeDeps);
const thumbnailOptimizerRouter = createThumbnailOptimizerRouter(routeDeps);
const playlistOptimizerRouter = createPlaylistOptimizerRouter(routeDeps);
const auditOrchestratorRouter = createAuditOrchestratorRouter(routeDeps);
const videoAuditRouter = createVideoAuditRouter(routeDeps);
const publicAuditRouter = createPublicAuditRouter(routeDeps);
const notificationRouter = createNotificationRouter(routeDeps);
const goalsRouter = createGoalsRouter({ ...routeDeps, goalsService });
const customDashboardService = createCustomDashboardService(routeDeps);
const customDashboardsRouter = createCustomDashboardsRouter({
  ...routeDeps,
  customDashboardService,
});
const anomaliesRouter = createAnomaliesRouter(routeDeps);
const channelFocusRouter = createChannelFocusRouter({
  ...routeDeps,
  channelFocusService,
});

// ── Express app setup ───────────────────────────────────────────────────────
const app = express();

// Trust proxy for Coolify/nginx
app.set("trust proxy", 1);

// Allowed origins
const normalizeOrigin = (value) => String(value).trim().replace(/\/+$/, "");
const parseAllowedOrigins = () => {
  // No production host is baked in here. Deployments supply one of
  // FRONTEND_URL / VITE_FRONTEND_URL / SERVICE_URL_FRONTEND / CORS_ORIGINS.
  const defaults = [
    "http://localhost:8081",
    "http://localhost:5173",
    "http://127.0.0.1:8081",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ];
  const devOnlyDefaults =
    process.env.NODE_ENV !== "production"
      ? ["http://localhost:3000", "http://127.0.0.1:3000"]
      : [];
  const envOrigins = [
    process.env.FRONTEND_URL,
    process.env.VITE_FRONTEND_URL,
    process.env.SERVICE_URL_FRONTEND,
    process.env.CORS_ORIGINS,
  ]
    .filter(Boolean)
    .flatMap((v) => String(v).split(","))
    .map(normalizeOrigin)
    .filter(Boolean);
  return new Set([
    ...defaults.map(normalizeOrigin),
    ...devOnlyDefaults.map(normalizeOrigin),
    ...envOrigins,
  ]);
};
const ALLOWED_ORIGINS = parseAllowedOrigins();

app.use(helmet(securityHeaders()));
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || ALLOWED_ORIGINS.has(normalizeOrigin(origin)))
        return callback(null, true);
      console.warn(
        "[CORS] Blocked origin:",
        origin,
        "| Allowed:",
        Array.from(ALLOWED_ORIGINS).join(", "),
      );
      return callback(new Error("Origin not allowed by CORS policy"));
    },
    credentials: true,
  }),
);
app.use(express.json());

// Request logger
app.use(requestLogger);

// Health check (outside /api)
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
  });
});

// Image proxy (outside /api to match original routing)
app.get("/api/proxy-image", async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl) return res.status(400).send("Missing url parameter");
  try {
    const response = await axios.get(imageUrl, {
      responseType: "arraybuffer",
      timeout: 5000,
    });
    const contentType = response.headers["content-type"];
    if (contentType) res.setHeader("content-type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(response.data);
  } catch (e) {
    console.error("[Image Proxy] Error fetching image:", imageUrl, e.message);
    res.status(500).send("Error fetching image");
  }
});

// ── API Router ────────────────────────────────────────────────────────────────
const apiRouter = express.Router();

// Public endpoints on /api (before auth wall)
apiRouter.get("/admin/config", async (req, res) => {
  try {
    const config = await boundGetFeatureConfig();
    const auditScoring = await boundGetAuditScoring();
    return res.json({ ...config, auditScoring });
  } catch (error) {
    console.error("[Admin Config GET] Error:", error);
    return res.json(DEFAULT_FEATURE_CONFIG);
  }
});

// OAuth endpoints (before auth wall so the token exchange can be rate-limited independently)
apiRouter.use("/oauth", oauthRouter);

// ── Auth wall ──────────────────────────────────────────────────────────────────
apiRouter.use(checkConfigVersion);
apiRouter.use(authLimiter);
apiRouter.use(middlewareAuth);

// Auto-attach _usage info to every JSON object response
apiRouter.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    if (
      req.usageInfo &&
      body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      !body._usage
    ) {
      body._usage = {
        used: req.usageInfo.used,
        limit: req.usageInfo.limit,
        pageKey: req.usageInfo.pageKey,
      };
    }
    return originalJson(body);
  };
  next();
});

// ── Authenticated routes ───────────────────────────────────────────────────────
apiRouter.use("/user", userRouter);
apiRouter.use("/organization", organizationRouter);
// Admin-only subtree mounted ahead of `/admin` so it never depends on the
// admin router falling through (see routes/publicAudit.js).
apiRouter.use("/admin/public-audits", publicAuditRouter);
apiRouter.use("/admin", adminRouter);
apiRouter.use("/usage", usageRouter);

apiRouter.get("/readme", async (req, res) => {
  try {
    const readmePath = path.resolve(__dirname, "..", "README.md");
    const content = fs.readFileSync(readmePath, "utf8");
    return res.json({ content });
  } catch (error) {
    console.error("[Readme GET] Error:", error);
    return res
      .status(500)
      .json({ error: { message: "Failed to load README.md" } });
  }
});

apiRouter.use("/channel", channelsRouter);
apiRouter.use("/channels", channelsRouter);
apiRouter.use("/playlists", playlistsRouter);
apiRouter.use("/playlist", playlistsRouter);
apiRouter.use("/playlist-items", playlistsRouter);

apiRouter.use("/video", videosRouter);
apiRouter.use("/videos", videosRouter);
apiRouter.use("/captions", captionsRouter);

// /specific-videos is a separate path that can't share the videos router cleanly
apiRouter.get(
  "/specific-videos",
  middlewareResolveUser,
  middlewareCheckPremiumAccess("specificVideos"),
  middlewareRequireQuota("specificVideos"),
  async (req, res) => {
    try {
      const { ids } = req.query;
      if (!ids)
        return res
          .status(400)
          .json({ error: { message: "Missing ids parameter" } });
      const idList = String(ids)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (idList.length > 50) {
        return res.status(400).json({
          error: {
            message: `Maximum of 50 video IDs per request (got ${idList.length})`,
          },
        });
      }
      const authHeader = req.headers.authorization;
      const scope = youtubeDataScope(req, !!authHeader);
      const idKey = idList.sort().join(",");
      const cacheKey = `yt:videos:${scope}:${shortHash(idKey)}`;
      const cached = await serverCache.get(cacheKey);
      if (cached) return res.json(cached);

      // Postgres-first: serve already-ingested videos from the database (user's
      // connected channels, refreshed by the 6-hour ingestion cron) with no
      // YouTube call or quota consumption. Only IDs missing from the DB fall
      // through to the live YouTube API (e.g. foreign-channel pastes).
      const dbHits = (await getVideosByIds(idList)) || {};
      const foundIds = Object.keys(dbHits);
      const missIds = idList.filter((id) => !foundIds.includes(id));

      const items = [];
      for (const id of foundIds) {
        const h = dbHits[id];
        items.push({
          id: h.videoId,
          snippet: {
            title: h.title || "",
            description: h.description || "",
            publishedAt: h.publishedAt,
            channelId: h.channelId,
            channelTitle: h.channelTitle || "",
            thumbnails: h.thumbnailUrl
              ? {
                  default: { url: h.thumbnailUrl },
                  medium: { url: h.thumbnailUrl },
                }
              : {},
            tags: h.tags && h.tags.length ? h.tags : undefined,
          },
          statistics: {
            viewCount: String(h.viewCount),
            likeCount: String(h.likeCount),
            commentCount: String(h.commentCount),
          },
          contentDetails: { duration: h.duration },
        });
      }

      if (missIds.length) {
        const params = {
          part: "snippet,statistics,contentDetails",
          id: missIds.join(","),
        };
        const config = { params };
        if (authHeader) config.headers = { Authorization: authHeader };
        else params.key = API_KEY;

        const response = await axios.get(`${YOUTUBE_API_BASE}/videos`, config);
        await consumeQuota(req, { billable: true });
        items.push(...(response.data?.items || []));
      }

      const payload = { items };
      await serverCache.set(cacheKey, payload, YT_DATA_CACHE_TTL_MS.VIDEOS);
      res.json(payload);
    } catch (error) {
      handleApiError(error, res);
    }
  },
);

apiRouter.use("/dashboard", dashboardRouter);
apiRouter.use("/dashboard", dashboardTabsRouter);
apiRouter.use("/analytics", analyticsRouter);
apiRouter.use("/channel-videos", channelVideosRouter);
apiRouter.use("/goals", goalsRouter);
apiRouter.use("/custom-dashboards", customDashboardsRouter);
apiRouter.use("/anomalies", anomaliesRouter);
apiRouter.use("/channel-focus", channelFocusRouter);

apiRouter.use("/compare", compareRouter);

apiRouter.use("/chat", userChatRouter);
apiRouter.use("/chat/admin", adminChatRouter);

apiRouter.use("/thumbnail-optimizer", thumbnailOptimizerRouter);
apiRouter.use("/playlist-optimizer", playlistOptimizerRouter);
apiRouter.use("/audit-orchestrator", auditOrchestratorRouter);
apiRouter.use("/video-audit", videoAuditRouter);
apiRouter.use("/notifications", notificationRouter);

// Mount the full API router
app.use("/api", apiRouter);

// ── Initialize Cron Jobs ─────────────────────────────────────────────────────
// Module exports MUST be set before cron require because cron.js lazily
// requires ./index via circular dependency.
module.exports.generateDashboardBundle = serviceDeps.generateDashboardBundle;
module.exports.generateDashboardSummary = serviceDeps.generateDashboardSummary;
module.exports.generateDimensions = serviceDeps.generateDimensions;
module.exports.generateChannelVideos = serviceDeps.generateChannelVideos;
module.exports.refreshGoogleToken = serviceDeps.refreshGoogleToken;
module.exports.authenticateRequest = middlewareAuth;
module.exports.checkAdmin = middlewareCheckAdmin;
module.exports.withInFlightTimeout = withInFlightTimeout;
module.exports.serverCache = serverCache; // for cron.js to clear before re-warming
module.exports.queueService = queueService;

require("./cron")(db, apiRouter, queueService);

// ── Mount Bull Board queue monitoring UI ─────────────────────────────────────
// Accessible at /admin/queues with the same admin auth guard as other admin endpoints.
// Supports two ways to pass the Firebase auth token (in priority order):
//   1. X-Firebase-Token header (standard API calls)
//   2. bull_board_token cookie (browser navigation from AdminPage, set by admin page button)
if (queueService.bullBoardRouter) {
  app.use("/admin/queues", (req, res, next) => {
    if (!req.headers["x-firebase-token"]) {
      const cookie = req.headers.cookie || "";
      const match = cookie.match(/(?:^|;\s*)bull_board_token=([^;]+)/);
      if (match) {
        req.headers["x-firebase-token"] = decodeURIComponent(match[1]);
      }
    }
    next();
  });
  app.use(
    "/admin/queues",
    middlewareAuth,
    middlewareCheckAdmin,
    queueService.bullBoardRouter,
  );
  console.log("[Queue] Bull Board mounted at /admin/queues");
}

// ── Start server ────────────────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});

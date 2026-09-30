let _featureConfigCache = null;
let _featureConfigCachedAt = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

const DEFAULT_FEATURE_CONFIG = {
  pages: {
    dashboard: {
      label: "Channel Analytics",
      enabled: true,
      premiumOnly: false,
      freeLimit: 10,
      proLimit: 100,
    },
    videos: {
      label: "Videos",
      enabled: true,
      premiumOnly: false,
      freeLimit: 20,
      proLimit: 200,
    },
    channel: {
      label: "Channel",
      enabled: true,
      premiumOnly: false,
      freeLimit: 10,
      proLimit: 200,
    },
    playlists: {
      label: "Playlists",
      enabled: true,
      premiumOnly: false,
      freeLimit: 10,
      proLimit: 200,
    },
    compare: {
      label: "Compare",
      enabled: true,
      premiumOnly: false,
      freeLimit: 5,
      proLimit: 100,
    },
    specificVideos: {
      label: "Specific Videos",
      enabled: true,
      premiumOnly: false,
      freeLimit: 10,
      proLimit: 200,
    },
    chat: {
      label: "AI Chat",
      enabled: true,
      premiumOnly: false,
      freeLimit: 50,
      proLimit: 500,
    },
    thumbnailOptimizer: {
      label: "Thumbnail Optimizer",
      enabled: true,
      premiumOnly: false,
      freeLimit: 5,
      proLimit: 100,
    },
    playlistOptimizer: {
      label: "Playlist Optimizer",
      enabled: true,
      premiumOnly: false,
      freeLimit: 5,
      proLimit: 100,
    },
    audit: {
      label: "Audit",
      enabled: true,
      premiumOnly: false,
      freeLimit: 5,
      proLimit: 100,
    },
    auditVideos: {
      label: "Channel Audit Videos",
      enabled: true,
      premiumOnly: false,
      freeLimit: 15,
      proLimit: 30,
    },
    videoAudit: {
      label: "Video Audit",
      enabled: true,
      premiumOnly: false,
      freeLimit: 5,
      proLimit: 100,
    },
    goals: {
      label: "Goals & Pacing",
      enabled: true,
      premiumOnly: false,
      freeLimit: -1,
      proLimit: -1,
    },
    anomalies: {
      label: "Anomalies",
      enabled: true,
      premiumOnly: false,
      freeLimit: 20,
      proLimit: 500,
    },
    customDashboard: {
      label: "My Dashboard",
      enabled: true,
      premiumOnly: false,
      freeLimit: -1,
      proLimit: -1,
    },
    optimized: {
      label: "Optimized Content",
      enabled: true,
      premiumOnly: false,
      freeLimit: -1,
      proLimit: -1,
    },
    captions: {
      label: "Captions / Transcripts",
      enabled: false,
      premiumOnly: false,
      freeLimit: 20,
      proLimit: 200,
    },
  },
};

function mergeFeatureConfigPages(dbData, defaultData) {
  if (!dbData || !dbData.pages) return defaultData;
  const mergedPages = {};
  for (const key of Object.keys(defaultData.pages)) {
    const dbPage = dbData.pages[key] || {};
    const defaultPage = defaultData.pages[key] || {};

    // Merge limit values: -1 means "unlimited" and takes precedence over any
    // positive number. Otherwise the code default is ratcheted upward so old
    // Firestore configs don't silently cap limits after a code update.
    const mergeLimit = (dbVal, defaultVal) => {
      if (dbVal === -1 || defaultVal === -1) return -1;
      return Math.max(defaultVal ?? 0, dbVal ?? 0);
    };

    mergedPages[key] = {
      ...defaultPage,
      ...dbPage,
      proLimit: mergeLimit(dbPage.proLimit, defaultPage.proLimit),
      freeLimit: mergeLimit(dbPage.freeLimit, defaultPage.freeLimit),
    };
  }
  return { ...defaultData, ...dbData, pages: mergedPages };
}

async function getFeatureConfig(db) {
  if (
    _featureConfigCache &&
    Date.now() - _featureConfigCachedAt < CACHE_TTL_MS
  ) {
    return _featureConfigCache;
  }
  try {
    const doc = await db.collection("config").doc("features").get();
    _featureConfigCache = doc.exists
      ? mergeFeatureConfigPages(doc.data(), DEFAULT_FEATURE_CONFIG)
      : DEFAULT_FEATURE_CONFIG;
  } catch {
    _featureConfigCache = _featureConfigCache || DEFAULT_FEATURE_CONFIG;
  }
  _featureConfigCachedAt = Date.now();
  return _featureConfigCache;
}

function invalidateFeatureConfigCache() {
  _featureConfigCache = null;
  _featureConfigCachedAt = 0;
}

module.exports = {
  getFeatureConfig,
  invalidateFeatureConfigCache,
  mergeFeatureConfigPages,
  DEFAULT_FEATURE_CONFIG,
};

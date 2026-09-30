/**
 * Scheduled jobs + admin endpoints for queue-driven background work.
 *
 * Previously this file ran all work inline (iterating channels, calling
 * YouTube APIs directly). Now it discovers channels and enqueues jobs to
 * BullMQ queues so workers can process them concurrently with retries.
 *
 * The node-cron schedule still fires at 03:00 / 09:00 / 15:00 / 21:00.
 * Admin endpoints are registered directly on the Express app to bypass
 * the /api router auth wall (but still guarded by authenticateRequest + checkAdmin).
 */

const cron = require('node-cron');
const { isPostgresConfigured } = require('./db/client');
const { DEFAULT_MAX_VIDEOS_PER_CHANNEL } = require('./ingestion/sync');

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {Express.Router} app  – the Express app (for admin routes)
 * @param {object} queueService – BullMQ queue service (enqueue* methods)
 */
module.exports = (db, app, queueService) => {
  // Lazy require to avoid circular dependency at load time.
  // We only need the token refresh + middleware helpers; the actual work
  // is done by queue workers now.
  const {
    refreshGoogleToken,
    authenticateRequest,
    checkAdmin,
    serverCache,
  } = require('./index');

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Query Firestore for all YouTube OAuth tokens across all users/orgs.
   * Returns a Map<channelId, refreshToken>, ordered most-recently-active
   * channel first.
   *
   * Ordering matters: both scheduled jobs apply a channel cap, so when the
   * number of connected channels exceeds the cap the least recently active
   * channels would otherwise be the ones starved of fresh data. Each token
   * document carries an `updatedAt` timestamp, which is the best available
   * proxy for how recently the channel was used. Documents without one sort
   * last but are still eligible.
   */
  async function collectTokens() {
    const snapshot = await db.collectionGroup('youtubeTokens').get();
    const entries = [];
    snapshot.docs.forEach((doc) => {
      const token = doc.data();
      if (!token.channelId || !token.refreshToken) return;
      const updatedAt = token.updatedAt;
      // Firestore Timestamp, Date, ISO string or epoch millis -- normalize.
      const lastActive =
        typeof updatedAt?.toMillis === 'function'
          ? updatedAt.toMillis()
          : updatedAt instanceof Date
            ? updatedAt.getTime()
            : updatedAt
              ? new Date(updatedAt).getTime() || 0
              : 0;
      entries.push([token.channelId, token.refreshToken, lastActive]);
    });
    // Dedupe by channelId keeping the most recently active, then sort desc.
    const unique = new Map();
    entries.forEach(([channelId, refreshToken, lastActive]) => {
      const existing = unique.get(channelId);
      if (!existing) return void unique.set(channelId, { refreshToken, lastActive });
      const token = lastActive > existing.lastActive ? { refreshToken, lastActive } : existing;
      unique.set(channelId, token);
    });
    return new Map(
      [...unique.entries()]
        .sort((a, b) => b[1].lastActive - a[1].lastActive)
        .map(([channelId, { refreshToken }]) => [channelId, refreshToken]),
    );
  }

  /**
   * Build a channelId → orgId map from the /channels collectionGroup,
   * so cache-warm jobs can use org:{orgId}:{channelId} scope.
   */
  async function buildChannelOrgMap() {
    try {
      const snap = await db.collectionGroup('channels').get();
      const map = new Map();
      snap.docs.forEach((doc) => {
        const orgId = doc.ref.parent.parent?.id;
        const channelId = doc.id;
        if (orgId && channelId) map.set(channelId, orgId);
      });
      return map;
    } catch (err) {
      console.warn('[Cron] Failed to build channel-org map:', err.message);
      return new Map();
    }
  }

  // ── Cache refresh (enqueue) ────────────────────────────────────────────────

  async function runCacheRefresh(options = {}) {
    const { periods = [7, 30, 90], maxChannels = 100, staggerMs = 500 } = options;
    console.log('[Cron] Starting scheduled cache refresh (enqueueing)...');

    // Wipe stale cache entries so workers generate fresh data.
    for (const prefix of ['snapshot:', 'summary:']) {
      try {
        await serverCache.deleteKeysContaining(prefix);
        console.log(`[Cron] Cleared stale Redis keys matching "${prefix}"`);
      } catch (err) {
        console.warn(`[Cron] Failed to clear "${prefix}" keys:`, err.message);
      }
    }

    const uniqueChannels = await collectTokens();
    const channelsToWarm = take(uniqueChannels, maxChannels);
    const channelOrgMap = await buildChannelOrgMap();

    console.log(`[Cron] Found ${uniqueChannels.size} unique channels, enqueueing ${channelsToWarm.length}.`);

    let enqueued = 0;
    let failed = 0;

    for (const [channelId, refreshToken] of channelsToWarm) {
      try {
        const accessToken = await refreshGoogleToken(refreshToken);
        const orgId = channelOrgMap.get(channelId) || null;
        await queueService.enqueueCacheWarm(
          {
            channelId,
            accessToken: `Bearer ${accessToken}`,
            periods,
            orgId,
          },
          { jobId: `warm:${channelId}:${Date.now()}` },
        );
        enqueued++;
        // Small delay to spread jobs -- the queue handles parallelism.
        if (staggerMs) await new Promise((resolve) => setTimeout(resolve, staggerMs));
      } catch (err) {
        console.error(`[Cron] Failed to enqueue cache warm for ${channelId}:`, err.message);
        failed++;
      }
    }

    console.log(`[Cron] Cache warm enqueue complete. Enqueued: ${enqueued}, Failed: ${failed}`);
    return { enqueued, failed, total: channelsToWarm.length };
  }

  // ── Postgres ingestion (enqueue) ───────────────────────────────────────────

  async function runPostgresIngestion(options = {}) {
    const {
      maxChannels = 100,
      days = 730,
      maxVideos = DEFAULT_MAX_VIDEOS_PER_CHANNEL,
      staggerMs = 500,
    } = options;

    if (!isPostgresConfigured()) {
      console.warn('[Cron] Postgres ingestion skipped: postgres not configured.');
      return { enqueued: 0, failed: 0, total: 0, skipped: true };
    }

    console.log('[Cron] Starting scheduled Postgres ingestion (enqueueing)...');

    const uniqueChannels = await collectTokens();
    const channelsToSync = take(uniqueChannels, maxChannels);

    if (channelsToSync.length === 0) {
      console.warn('[Cron] No channels to sync -- returning');
      return { enqueued: 0, failed: 0, total: 0 };
    }

    console.log(`[Cron] ${channelsToSync.length} channel(s) -- enqueueing ingestion jobs...`);

    let enqueued = 0;
    let failed = 0;

    for (const [channelId, refreshToken] of channelsToSync) {
      try {
        const accessToken = await refreshGoogleToken(refreshToken);
        await queueService.enqueueIngestion(
          {
            channelId,
            authHeader: `Bearer ${accessToken}`,
            maxVideos,
            days,
          },
          { jobId: `ingest:${channelId}:${Date.now()}` },
        );
        enqueued++;
        if (staggerMs) await new Promise((resolve) => setTimeout(resolve, staggerMs));
      } catch (err) {
        console.error(`[Cron] Failed to enqueue ingestion for ${channelId}:`, err.message);
        failed++;
      }
    }

    console.log(`[Cron] Postgres ingestion enqueue complete. Enqueued: ${enqueued}, Failed: ${failed}`);
    return { enqueued, failed, total: channelsToSync.length };
  }

  // ── Schedule ──────────────────────────────────────────────────────────────

  // Channel caps for the scheduled runs. Env-tunable so a larger channel base
  // needs no code change: raise the caps (or set 0 for "no cap") and raise
  // CRON_STAGGER_MS only if the enqueue burst starts to starve workers.
  const CRON_WARM_MAX_CHANNELS = Math.max(
    0,
    parseInt(process.env.CRON_WARM_MAX_CHANNELS || '50', 10) || 0,
  );
  const CRON_INGEST_MAX_CHANNELS = Math.max(
    0,
    parseInt(process.env.CRON_INGEST_MAX_CHANNELS || '100', 10) || 0,
  );
  const CRON_INGEST_DAYS = Math.max(1, parseInt(process.env.CRON_INGEST_DAYS || '730', 10) || 730);
  const CRON_STAGGER_MS = Math.max(0, parseInt(process.env.CRON_STAGGER_MS || '500', 10) || 0);

  // 0 means "no cap".
  const capOf = (n) => (n === 0 ? undefined : n);
  const take = (map, cap) => {
    const all = Array.from(map.entries());
    return capOf(cap) ? all.slice(0, cap) : all;
  };

  cron.schedule('0 3,9,15,21 * * *', () => {
    runCacheRefresh({
      periods: [7, 30, 90],
      maxChannels: CRON_WARM_MAX_CHANNELS,
      staggerMs: CRON_STAGGER_MS,
    }).catch(console.error);
    runPostgresIngestion({
      maxChannels: CRON_INGEST_MAX_CHANNELS,
      days: CRON_INGEST_DAYS,
      maxVideos: DEFAULT_MAX_VIDEOS_PER_CHANNEL,
      staggerMs: CRON_STAGGER_MS,
    }).catch(console.error);
  });

  // ── Admin endpoints (registered on app, outside /api router) ──────────────

  if (app) {
    // POST /admin/cache/refresh-all -- enqueue cache-warm jobs for all channels
    app.post('/admin/cache/refresh-all', authenticateRequest, checkAdmin, async (req, res) => {
      try {
        const result = await runCacheRefresh({ periods: [7, 30, 90], maxChannels: 100 });
        res.json({ message: 'Cache refresh jobs enqueued', result });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // POST /admin/ingestion/refresh-all -- enqueue ingestion jobs for all channels
    app.post('/admin/ingestion/refresh-all', authenticateRequest, checkAdmin, async (req, res) => {
      try {
        const { maxChannels = 100, days = 120, maxVideos = DEFAULT_MAX_VIDEOS_PER_CHANNEL } = req.body || {};
        const result = await runPostgresIngestion({ maxChannels, days, maxVideos });
        res.json({ message: 'Postgres ingestion jobs enqueued', result });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // POST /admin/ingestion/refresh-channel -- enqueue a single-channel ingestion job
    app.post('/admin/ingestion/refresh-channel', authenticateRequest, checkAdmin, async (req, res) => {
      try {
        const { channelId, refreshToken, days = 120, maxVideos = DEFAULT_MAX_VIDEOS_PER_CHANNEL } = req.body || {};
        if (!channelId || !refreshToken) {
          return res.status(400).json({ error: { message: 'Missing channelId or refreshToken' } });
        }
        const accessToken = await refreshGoogleToken(refreshToken);
        const job = await queueService.enqueueIngestion(
          {
            channelId,
            authHeader: `Bearer ${accessToken}`,
            maxVideos,
            days,
          },
          { jobId: `ingest:${channelId}:manual:${Date.now()}` },
        );
        return res.json({ message: 'Channel ingestion job enqueued', jobId: job.id });
      } catch (error) {
        return res.status(500).json({ error: { message: error.message } });
      }
    });

    // GET /admin/queue/metrics -- see queue job counts
    app.get('/admin/queue/metrics', authenticateRequest, checkAdmin, async (req, res) => {
      try {
        const metrics = await queueService.getQueueMetrics();
        res.json(metrics);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
  }
};

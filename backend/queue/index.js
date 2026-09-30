/**
 * Queue service -- BullMQ-backed job queues for async background work.
 *
 * Creates three queues (ingestion, cache-warm, email) with in-process
 * workers. Follows the same create*Service(deps) factory pattern used
 * throughout the backend.
 *
 * When REDIS_URL is not set, returns a null/no-op service so the app
 * still works without Redis.
 */

const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');
const { createBullBoard } = require('@bull-board/api');
const { BullMQAdapter } = require('@bull-board/api/bullMQAdapter');
const { ExpressAdapter } = require('@bull-board/express');
const { createIngestionProcessor } = require('./ingestionQueue');
const { createCacheWarmProcessor } = require('./cacheWarmQueue');
const { createEmailProcessor } = require('./emailQueue');
const { createVideoAuditProcessor } = require('./videoAuditQueue');
const { createOptimizerProcessor } = require('./optimizerQueue');
const { createAuditOrchestratorProcessor } = require('./auditOrchestratorQueue');
const { createPublicAuditProcessor } = require('./publicAuditQueue');

/**
 * Fire the audit-complete notification + email when a video/regular audit job
 * finishes. Called from the worker 'completed' handler. There is no `req` at
 * completion, so the recipient comes from `job.data.email` (attached at enqueue).
 * Returns silently when not an audit job, when no email is present, or when any
 * step fails -- a notification failure must never fail the audit job.
 *
 * @param {{ notificationService: object, emailQueue: object, serverCache: object }} deps
 * @param {{ label: string, job: object }} ctx
 */
async function handleAuditCompleted({ notificationService, emailQueue, serverCache }, { label, job }) {
  if (!['video-audit', 'thumbnail-optimizer', 'playlist-optimizer', 'public-audit'].includes(label)) return;
  // Idempotency: worker.on('completed') is a *global* BullMQ event delivered to
  // every worker connected to the queue, so multiple pods (or a lingering
  // node --watch worker) each receive it. Lock per job id so the notification
  // + email are created exactly once, even if this fires repeatedly. When
  // serverCache is absent (shouldn't happen in prod) we skip the lock rather
  // than fail the notification.
  const jobId = job?.id;
  if (jobId && serverCache) {
    const won = await serverCache.setIfAbsent(`notif:lock:${jobId}`, true, 7 * 24 * 60 * 60 * 1000).catch(() => true);
    if (!won) return;
  }
  try {
    const { email } = job.data || {};
    if (!email || !notificationService) return;
    const rv = job.returnvalue || {};
    const isVideo = label === 'video-audit';
    const isThumb = label === 'thumbnail-optimizer';
    const isPlaylist = label === 'playlist-optimizer';
    const isPublic = label === 'public-audit';
    const score = rv.overall ?? rv.score ?? null;
    // channel.name may be a plain string or a health-wrapped object ({ value, ... });
    // unwrap defensively so the body never serializes as [object Object].
    const rawName = rv.input?.channel?.name ?? rv.channelName ?? rv.channelTitle ?? job.data.channelId ?? job.data.channelInput;
    const channelName = (rawName && typeof rawName === 'object' ? rawName.value : rawName) ?? job.data.channelId;
    const link = isVideo ? '/video-audit' : isThumb ? '/thumbnail-optimizer' : isPlaylist ? '/playlist-optimizer' : isPublic ? '/admin/public-audit' : '/audit-orchestrator';

    const config = isVideo
      ? { type: 'videoAuditComplete', title: 'Video audit complete', auditType: 'video', body: `${channelName} scored ${score ?? 'N/A'}.` }
      : isThumb
        ? { type: 'thumbnailAuditComplete', title: 'Thumbnail analysis complete', auditType: 'thumbnail', body: `Thumbnail audit for ${channelName || 'your videos'} finished.` }
        : isPlaylist
          ? { type: 'playlistAuditComplete', title: 'Playlist analysis complete', auditType: 'playlist', body: `Playlist optimization for ${channelName || 'your videos'} finished.` }
          : isPublic
            ? { type: 'publicAuditComplete', title: 'Channel audit complete', auditType: 'public', body: `Channel audit for ${channelName || 'the channel'} finished${score != null ? ` — score ${score}` : ''}.` }
            : { type: 'auditComplete', title: 'Channel audit complete', auditType: 'channel', body: `${channelName} scored ${score ?? 'N/A'}.` };

    await notificationService.createNotification({
      userId: email,
      type: config.type,
      title: config.title,
      body: config.body,
      link,
    });
    await emailQueue.add('sendAuditCompleteEmail', {
      type: 'sendAuditCompleteEmail',
      toEmail: email,
      channelName,
      score,
      auditType: config.auditType,
    });
  } catch (err) {
    console.error('[Queue] audit complete notification failed:', err.message);
  }
}

/**
 * Factory: createQueueService(deps)
 *
 * Uses QUEUE_REDIS_URL if set, otherwise falls back to REDIS_URL.
 * This allows a separate Redis instance for queue state (noeviction)
 * while the main cache Redis uses allkeys-lru.
 *
 * @param {object} deps - shared dependencies (serverCache, db, etc.)
 * @param {object} deps.ingestChannelDaily  - from ingestion/sync.js
 * @returns {object} { enqueueIngestion, enqueueCacheWarm, enqueueEmail, queues, getQueueMetrics, close }
 */
function createQueueService(deps) {
  const redisUrl = process.env.QUEUE_REDIS_URL || process.env.REDIS_URL;
  if (!redisUrl) {
    console.warn('[Queue] REDIS_URL not set -- queue service disabled. Jobs are no-ops.');
    return createNullQueueService();
  }

  // ── Redis connection (separate from ServerCache's redis connection) ─────────
  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (times) => {
      const delay = Math.min(times * 100, 3000);
      if (times > 10) {
        console.error('[Queue] Redis connection lost after 10 retries -- giving up.');
        return null; // stop retrying
      }
      return delay;
    },
  });

  connection.on('error', (err) => {
    console.error('[Queue] Redis connection error:', err.message);
  });

  connection.on('connect', () => {
    console.log('[Queue] Connected to Redis (BullMQ)');
  });

  // ── Queues ──────────────────────────────────────────────────────────────────
  const ingestionQueue = new Queue('ingestion', {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { age: 3600 * 24 * 7 },  // keep 7 days
      removeOnFail: { age: 3600 * 24 * 14 },      // keep 14 days for debugging
    },
  });

  const cacheWarmQueue = new Queue('cache-warm', {
    connection,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { age: 3600 * 24 * 3 },
      removeOnFail: { age: 3600 * 24 * 7 },
    },
  });

  const emailQueue = new Queue('email', {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: { age: 3600 * 24 },
      removeOnFail: { age: 3600 * 24 * 7 },
    },
  });

  const videoAuditQueue = new Queue('video-audit', {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: { age: 3600 * 24 },
      removeOnFail: { age: 3600 * 24 * 7 },
    },
  });

  const optimizerQueue = new Queue('optimizer', {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: { age: 3600 * 24 },
      removeOnFail: { age: 3600 * 24 * 7 },
    },
  });

  const auditOrchestratorQueue = new Queue('audit-orchestrator', {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: { age: 3600 * 24 },
      removeOnFail: { age: 3600 * 24 * 7 },
    },
  });

  const publicAuditQueue = new Queue('public-audit', {
    connection,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: { age: 3600 * 24 },
      removeOnFail: { age: 3600 * 24 * 7 },
    },
  });

  // ── Workers ─────────────────────────────────────────────────────────────────
  const ingestionWorker = new Worker(
    'ingestion',
    createIngestionProcessor(deps),
    { connection, concurrency: 3 },
  );

  const cacheWarmWorker = new Worker(
    'cache-warm',
    createCacheWarmProcessor(deps),
    { connection, concurrency: 5 },
  );

  const emailWorker = new Worker(
    'email',
    createEmailProcessor(deps),
    { connection, concurrency: 2 },
  );

  // Audits fetch all of a channel's videos/playlists, which can exceed BullMQ's
  // default 30s lock window; raise lockDuration + stall tolerance so long-running
  // audit jobs complete instead of being marked stalled and retried forever.
  const AUDIT_LOCK_MS = 5 * 60 * 1000;

  const videoAuditWorker = new Worker(
    'video-audit',
    createVideoAuditProcessor(deps),
    { connection, concurrency: 2, lockDuration: AUDIT_LOCK_MS, maxStalledCount: 3 },
  );

  const optimizerWorker = new Worker(
    'optimizer',
    createOptimizerProcessor(deps),
    { connection, concurrency: 2, lockDuration: AUDIT_LOCK_MS, maxStalledCount: 3 },
  );

  const auditOrchestratorWorker = new Worker(
    'audit-orchestrator',
    createAuditOrchestratorProcessor(deps),
    { connection, concurrency: 2, lockDuration: AUDIT_LOCK_MS, maxStalledCount: 3 },
  );

  const publicAuditWorker = new Worker(
    'public-audit',
    createPublicAuditProcessor(deps),
    { connection, concurrency: 2, lockDuration: AUDIT_LOCK_MS, maxStalledCount: 3 },
  );

  // ── Worker event logging ────────────────────────────────────────────────────
  function setupWorkerEvents(worker, label) {
    worker.on('completed', (job) => {
      const id = job.data.channelId || job.data.type || job.data.inviteeEmail || 'unknown';
      console.log(`[Queue] ${label}:${id} completed (${job.id})`);
      handleAuditCompleted(
        { notificationService: deps.notificationService, emailQueue, serverCache: deps.serverCache },
        { label, job },
      );
    });
    worker.on('failed', (job, err) => {
      const id = job?.data?.channelId || job?.data?.type || job?.data?.inviteeEmail || 'unknown';
      console.error(`[Queue] ${label}:${id} failed after ${job?.attemptsMade || 0} attempt(s): ${err.message}`);
    });
    worker.on('error', (err) => {
      console.error(`[Queue] ${label} worker error: ${err.message}`);
    });
    worker.on('active', (job) => {
      if (process.env.PERF_LOG === '1') {
        const id = job.data.channelId || job.data.type || job.data.inviteeEmail || 'unknown';
        console.log(`[Queue] ${label}:${id} active (${job.id})`);
      }
    });
  }

  setupWorkerEvents(ingestionWorker, 'ingest');
  setupWorkerEvents(cacheWarmWorker, 'warm');
  setupWorkerEvents(emailWorker, 'email');
  setupWorkerEvents(videoAuditWorker, 'video-audit');
  setupWorkerEvents(auditOrchestratorWorker, 'audit-orchestrator');
  setupWorkerEvents(publicAuditWorker, 'public-audit');
  // Optimizer queue serves both thumbnail and playlist kinds; derive the label
  // per job so the completion notification picks the right type.
  optimizerWorker.on('completed', (job) => {
    const kind = job.data?.kind;
    const label = kind === 'thumbnail' ? 'thumbnail-optimizer' : kind === 'playlist' ? 'playlist-optimizer' : 'optimizer';
    console.log(`[Queue] ${label}:${job.id} completed`);
    handleAuditCompleted(
      { notificationService: deps.notificationService, emailQueue, serverCache: deps.serverCache },
      { label, job },
    );
  });
  optimizerWorker.on('failed', (job, err) => {
    const kind = job?.data?.kind || 'optimizer';
    console.error(`[Queue] ${kind}:${job?.id} failed after ${job?.attemptsMade || 0} attempt(s): ${err.message}`);
  });

  console.log('[Queue] BullMQ queues initialized: ingestion (×3), cache-warm (×5), email (×2), video-audit (×2), optimizer (×2), audit-orchestrator (×2), public-audit (×2)');

  // ── Bull Board (queue monitoring UI) ────────────────────────────────────────
  // Mount this router behind auth + admin guard at /admin/queues.
  const bullBoardAdapter = new ExpressAdapter();
  bullBoardAdapter.setBasePath('/admin/queues');

  // Wrap in try-catch: Bull Board can throw if the UI packages are missing.
  let bullBoardRouter = null;
  try {
    createBullBoard({
      queues: [
        new BullMQAdapter(ingestionQueue),
        new BullMQAdapter(cacheWarmQueue),
        new BullMQAdapter(emailQueue),
        new BullMQAdapter(videoAuditQueue),
        new BullMQAdapter(auditOrchestratorQueue),
        new BullMQAdapter(publicAuditQueue),
      ],
      serverAdapter: bullBoardAdapter,
    });
    bullBoardRouter = bullBoardAdapter.getRouter();
    console.log('[Queue] Bull Board UI available at /admin/queues');
  } catch (err) {
    console.warn('[Queue] Bull Board UI not available:', err.message);
    bullBoardRouter = null;
  }

  // ── Returned service object ─────────────────────────────────────────────────
  return {
    /** Enqueue a channel-ingestion job */
    enqueueIngestion(data, opts = {}) {
      return ingestionQueue.add('ingest', data, opts);
    },

    /** Enqueue a cache-warming job */
    enqueueCacheWarm(data, opts = {}) {
      return cacheWarmQueue.add('warm', data, opts);
    },

    /** Enqueue an email job */
    enqueueEmail(type, data, opts = {}) {
      return emailQueue.add(type, { type, ...data }, opts);
    },

    /** Enqueue a video audit job */
    enqueueVideoAudit(data, opts = {}) {
      return videoAuditQueue.add('video-audit', data, opts);
    },

    /** Get a video audit job by id (for /video-audit/jobs/:id polling) */
    jobsGet: (id) => videoAuditQueue.getJob(id),

    /** Enqueue a thumbnail/playlist optimizer job (for /thumbnail-optimizer/jobs, /playlist-optimizer/jobs) */
    enqueueOptimizer(data, opts = {}) {
      return optimizerQueue.add('optimizer', data, opts);
    },

    /** Get an optimizer job by id (for /:scope/jobs/:id polling) */
    optimizerJobsGet: (id) => optimizerQueue.getJob(id),

    /** Enqueue a centralized audit-orchestrator job (for /audit-orchestrator/jobs) */
    enqueueAuditOrchestrator(data, opts = {}) {
      return auditOrchestratorQueue.add('audit-orchestrator', data, opts);
    },

    /** Get an audit-orchestrator job by id (for /audit-orchestrator/jobs/:id polling) */
    auditOrchestratorJobsGet: (id) => auditOrchestratorQueue.getJob(id),

    /** Enqueue a public channel-audit job (for /admin/public-audits/jobs) */
    enqueuePublicAudit(data, opts = {}) {
      return publicAuditQueue.add('public-audit', data, opts);
    },

    /** Get a public-audit job by id (for /admin/public-audits/jobs/:id polling) */
    publicAuditJobsGet: (id) => publicAuditQueue.getJob(id),

    /** Direct access to queue instances (for admin/metrics) */
    queues: { ingestion: ingestionQueue, cacheWarm: cacheWarmQueue, email: emailQueue, videoAudit: videoAuditQueue, optimizer: optimizerQueue, auditOrchestrator: auditOrchestratorQueue, publicAudit: publicAuditQueue },

    /** Bull Board Express router (mount at /admin/queues behind auth + admin guard) */
    bullBoardRouter,

    /** Get counts per queue: { ingestion: {waiting,active,completed,failed,...}, ... } */
    async getQueueMetrics() {
      const [ing, cw, em, va, op, ao, pa] = await Promise.all([
        ingestionQueue.getJobCounts(),
        cacheWarmQueue.getJobCounts(),
        emailQueue.getJobCounts(),
        videoAuditQueue.getJobCounts(),
        optimizerQueue.getJobCounts(),
        auditOrchestratorQueue.getJobCounts(),
        publicAuditQueue.getJobCounts(),
      ]);
      return { ingestion: ing, cacheWarm: cw, email: em, videoAudit: va, optimizer: op, auditOrchestrator: ao, publicAudit: pa };
    },

    /** Graceful shutdown: close workers → close queues → disconnect Redis */
    async close() {
      console.log('[Queue] Shutting down workers and queues...');
      await Promise.all([
        ingestionWorker.close(true),
        cacheWarmWorker.close(true),
        emailWorker.close(true),
        videoAuditWorker.close(true),
        optimizerWorker.close(true),
        auditOrchestratorWorker.close(true),
        publicAuditWorker.close(true),
      ]);
      await Promise.all([
        ingestionQueue.close(),
        cacheWarmQueue.close(),
        emailQueue.close(),
        videoAuditQueue.close(),
        optimizerQueue.close(),
        auditOrchestratorQueue.close(),
        publicAuditQueue.close(),
      ]);
      await connection.quit();
      console.log('[Queue] All workers and queues closed.');
    },
  };
}

/**
 * Null/no-op queue service for when Redis is not available.
 * All methods are no-ops so the app doesn't crash.
 */
function createNullQueueService() {
  const noop = () => Promise.resolve();
  return {
    enqueueIngestion: noop,
    enqueueCacheWarm: noop,
    enqueueEmail: noop,
    enqueueVideoAudit: noop,
    jobsGet: async () => null,
    enqueueOptimizer: noop,
    optimizerJobsGet: async () => null,
    enqueueAuditOrchestrator: noop,
    auditOrchestratorJobsGet: async () => null,
    enqueuePublicAudit: noop,
    publicAuditJobsGet: async () => null,
    queues: { ingestion: null, cacheWarm: null, email: null, videoAudit: null, optimizer: null, auditOrchestrator: null, publicAudit: null },
    getQueueMetrics: async () => ({ ingestion: {}, cacheWarm: {}, email: {}, videoAudit: {}, optimizer: {}, auditOrchestrator: {}, publicAudit: {} }),
    close: noop,
  };
}

module.exports = { createQueueService, handleAuditCompleted };

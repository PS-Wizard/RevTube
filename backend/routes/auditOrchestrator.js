// ─────────────────────────────────────────────────────────────────────────────
// Centralized Audit orchestrator route -- POST /audit-orchestrator (enqueue),
// GET /audit-orchestrator/jobs/:id (poll), GET /audit-orchestrator/:id (report),
// POST rerun endpoints. Persisted to Postgres audit_runs / audit_sub_runs.
// ─────────────────────────────────────────────────────────────────────────────
const express = require("express");
const { createChannelOwnershipValidator } = require("../utils/channelOwnership");

// Admin-configured Full Audit scoring criteria, exposed read-only to any
// authenticated user. Non-admin safe: labels + max points only, sourced from
// the SAME optimizerCriteria store the orchestrator scores against.
const CATEGORY_DEFS = [
  { cat: "channel", title: "Channel Identity", section: "channelIdentity", extraSections: ["channelBrand"] },
  { cat: "video", title: "Video SEO", section: "videoElements", nonThumbnailOnly: true },
  { cat: "playlist", title: "Playlist Flow", section: "playlist" },
  { cat: "general", title: "Cadence & Trends", section: "general", extraSections: ["generalOutlook"] },
];

/**
 * Strip engine-specific scoring internals (engineScores) from persisted
 * sub-run results before sending them to the client. The final per-sub-run
 * score is carried by the `score` column; the blended algorithmic/AI
 * breakdown is an internal detail the frontend never renders.
 */
function sanitizeSubRunsMeta(subRuns) {
  if (!Array.isArray(subRuns)) return subRuns;
  return subRuns.map((s) => {
    if (!s.results || typeof s.results !== "object" || !s.results.meta) return s;
    const meta = { ...s.results.meta };
    if (Object.prototype.hasOwnProperty.call(meta, "engineScores")) {
      delete meta.engineScores;
      return { ...s, results: { ...s.results, meta } };
    }
    return s;
  });
}

// Videos-per-audit fallback caps (free 15 / pro 30), used only when the
// admin-configured feature config is missing or set to unlimited (-1).
const AUDIT_VIDEO_COUNT_FALLBACK = { free: 15, pro: 30 };

/**
 * Resolve the per-plan videos-per-audit cap from the admin-controlled
 * feature config ("auditVideos" page). Never throws — falls back to code
 * defaults when the config is unavailable.
 */
async function resolveAuditVideoCap(deps, currentUser) {
  const isPro = currentUser?.package === "pro" || currentUser?.role === "admin";
  try {
    const cfg = await deps.getFeatureConfig?.();
    const page = cfg?.pages?.auditVideos;
    const limit = isPro ? page?.proLimit : page?.freeLimit;
    if (Number.isFinite(limit) && limit > 0) return limit;
  } catch {
    // fall through to code defaults
  }
  return isPro ? AUDIT_VIDEO_COUNT_FALLBACK.pro : AUDIT_VIDEO_COUNT_FALLBACK.free;
}

// Legacy runs (created before persistEngineHistories stamped the saved row id
// into sub-run meta) can't deep-link the Playlist Optimizer — the detail page
// would fall back to a bare channel link with no data. Backfill from the
// standalone history: the newest "Full Audit -- <date>" playlist_audits row for
// the same user + channel is the engine output of that channel's full audit.
async function backfillPlaylistHistoryId({ uid, run, subs }) {
  if (!Array.isArray(subs)) return subs;
  const pl = subs.find((s) => s.type === "playlist");
  const meta = pl?.results?.meta;
  if (!pl || !meta || typeof meta !== "object") return subs;
  if (meta.playlistHistoryId != null || !run?.channel_id) return subs;
  try {
    const { rows } = await query(
      `SELECT id FROM playlist_audits WHERE uid=$1 AND channel_id=$2 AND name ILIKE 'Full Audit --%' ORDER BY created_at DESC LIMIT 1`,
      [uid, run.channel_id],
    );
    if (rows.length && rows[0].id != null) {
      return subs.map((s) =>
        s === pl
          ? { ...pl, results: { ...pl.results, meta: { ...meta, playlistHistoryId: Number(rows[0].id) } } }
          : s,
      );
    }
  } catch (err) {
    console.warn("[AuditOrchestrator] playlistHistoryId backfill failed:", err?.message);
  }
  return subs;
}

function buildOptimizerCategories(optimizerCriteria = {}) {
  const categories = {};
  for (const def of CATEGORY_DEFS) {
    let rows = Array.isArray(optimizerCriteria?.[def.section]) ? optimizerCriteria[def.section] : [];
    if (def.nonThumbnailOnly) rows = rows.filter((c) => c.element !== "thumbnail");
    let extra = [];
    for (const section of def.extraSections || []) {
      if (Array.isArray(optimizerCriteria?.[section])) extra = extra.concat(optimizerCriteria[section]);
    }
    categories[def.cat] = [...rows, ...extra].map((c) => ({
      key: c.key,
      label: c.label,
      max: Math.max(1, Number(c.weight) || 0),
    }));
  }
  return categories;
}

function createAuditOrchestratorRouter(deps) {
  const { resolveUser, checkPremiumAccess, requireQuota, handleApiError, query, isPostgresConfigured, queueService, getOptimizerCriteria, getFeatureConfig } = deps;

  const ownership = deps.ownership || createChannelOwnershipValidator(deps);
  const resolveOrgToken = deps.resolveOrgToken || (() => (req, res, next) => next());
  const orgTokenMiddleware = resolveOrgToken((req) => req.body?.channelId);

  const guardPg = (req, res) => {
    if (!isPostgresConfigured()) { res.status(503).json({ error: { message: "Database is not configured." } }); return null; }
    const uid = req.authUser?.uid; if (!uid) { res.status(401).json({ error: { message: "Not authenticated." } }); return null; }
    return uid;
  };

  const router = express.Router();

  // Read-only org members (`role === 'read'`) may only view this audit run's
  // report/history -- not enqueue a new run, rerun, save, rename, or delete.
  const requireOrgWrite = deps.requireOrgWrite || ((req, res, next) => next());
  router.use(requireOrgWrite);

  // GET /audit-orchestrator/criteria -- read-only criteria description (labels +
  // max points) for the Full Audit help dialog. Non-admin safe.
  router.get("/criteria", resolveUser, async (req, res) => {
    try {
      if (!deps.db) return res.status(503).json({ error: { message: "Database is not configured." } });
      const cfg = await getOptimizerCriteria(deps.db);
      res.json({ categories: buildOptimizerCategories(cfg) });
    } catch (error) {
      console.error("[AuditOrchestrator] Criteria GET failed:", error.message);
      handleApiError(error, res);
    }
  });

  // POST /audit-orchestrator -- enqueue a centralized audit for an owned channel
  router.post("/", resolveUser, orgTokenMiddleware, checkPremiumAccess("audit"), requireQuota("audit"), async (req, res) => {
    try {
      const { channelId, includeThumbnailAI, scope, videoSelection } = req.body;
      if (!channelId) return res.status(400).json({ error: { message: '"channelId" is required.' } });
      const owned = new Set(await ownership.getConnectedChannelIds(req));
      if (!owned.has(channelId)) {
        return res.status(403).json({ error: { message: "Channel is not from your connected channels." } });
      }
      // Video sample window: { mode: "recent"|"since", count, since } — count
      // is clamped server-side to the admin-controlled per-plan cap
      // (feature config "auditVideos": free 15 / pro 30 by default), so a
      // hand-crafted request can't audit more videos than the plan allows.
      // The service-level absolute cap applies on top as a backstop.
      const planCap = await resolveAuditVideoCap({ getFeatureConfig }, req.currentUser);
      const vs = videoSelection && typeof videoSelection === "object"
        ? {
            mode: videoSelection.mode,
            count: Math.max(1, Math.min(planCap, Number(videoSelection.count) || 1)),
            since: videoSelection.since,
          }
        : undefined;
      const job = await queueService.enqueueAuditOrchestrator(
        {
          channelId,
          authHeader: req.headers?.authorization || "",
          uid: req.authUser?.uid,
          email: req.authUser?.email,
          orgId: req.headers["x-org-id"] || null,
          includeThumbnailAI: !!includeThumbnailAI,
          scope: scope === "channel" ? "channel" : "full",
          ...(vs ? { videoSelection: vs } : {}),
        },
        { removeOnComplete: { age: 3600 * 24 }, removeOnFail: { age: 3600 * 24 * 7 } },
      );
      res.json({ jobId: job?.id });
    } catch (error) {
      console.error("[AuditOrchestrator] POST failed:", error.message);
      handleApiError(error, res);
    }
  });

  // GET /audit-orchestrator/jobs/:id -- poll job status
  router.get("/jobs/:id", resolveUser, async (req, res) => {
    try {
      const job = await queueService.auditOrchestratorJobsGet(String(req.params.id).replace(/[^0-9A-Za-z_-]/g, ""));
      if (!job) return res.status(404).json({ error: { message: "Job not found." } });
      const state = await job.getState();
      res.json({
        jobId: job.id,
        state,
        progress: job.progress ?? 0,
        ...(state === "completed" ? { result: job.returnvalue } : {}),
      });
    } catch (error) {
      console.error("[AuditOrchestrator] Jobs GET failed:", error.message);
      handleApiError(error, res);
    }
  });

  // GET /audit-orchestrator/history -- list saved audit runs (overview only)
  router.get("/history", resolveUser, async (req, res) => {
    try {
      const uid = guardPg(req, res); if (!uid) return;
      const limit = Math.min(parseInt(req.query?.limit, 10) || 20, 50);
      const page = Math.max(parseInt(req.query?.page, 10) || 1, 1);
      const search = typeof req.query?.search === "string" && req.query.search.trim() ? `%${req.query.search.trim()}%` : null;
      const out = await query(
        search
          ? "SELECT id, name, channel_id, channel_title, overall_score, overall_grade, include_thumbnail_ai, created_at FROM audit_runs WHERE uid=$1 AND (name ILIKE $2 OR channel_title ILIKE $2) ORDER BY created_at DESC LIMIT $3 OFFSET $4"
          : "SELECT id, name, channel_id, channel_title, overall_score, overall_grade, include_thumbnail_ai, created_at FROM audit_runs WHERE uid=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
        search ? [uid, search, limit, (page - 1) * limit] : [uid, limit, (page - 1) * limit],
      );
      const count = await query(
        search ? "SELECT count(*)::int AS total FROM audit_runs WHERE uid=$1 AND (name ILIKE $2 OR channel_title ILIKE $2)" : "SELECT count(*)::int AS total FROM audit_runs WHERE uid=$1",
        search ? [uid, search] : [uid],
      );
      res.json({
        items: out.rows.map((r) => ({
          id: r.id,
          name: r.name || "",
          channelId: r.channel_id,
          channelTitle: r.channel_title,
          overallScore: r.overall_score,
          overallGrade: r.overall_grade,
          includeThumbnailAi: r.include_thumbnail_ai,
          createdAt: r.created_at,
        })),
        total: count.rows[0]?.total ?? 0,
        page,
      });
    } catch (error) {
      console.error("[AuditOrchestrator] History GET failed:", error.message);
      handleApiError(error, res);
    }
  });

  // PATCH /audit-orchestrator/history/:id -- rename a saved run
  router.patch("/history/:id", resolveUser, async (req, res) => {
    try {
      const uid = guardPg(req, res); if (!uid) return;
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: { message: "Invalid audit run ID." } });
      const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 200) : "";
      if (!name) return res.status(400).json({ error: { message: '"name" is required.' } });
      const result = await query("UPDATE audit_runs SET name=$1 WHERE id=$2 AND uid=$3 RETURNING id, name", [name, id, uid]);
      if (result.rows.length === 0) return res.status(404).json({ error: { message: "Audit run not found." } });
      res.json({ id: result.rows[0].id, name: result.rows[0].name });
    } catch (error) {
      console.error("[AuditOrchestrator] History PATCH failed:", error.message);
      handleApiError(error, res);
    }
  });

  // DELETE /audit-orchestrator/history/:id -- remove a saved run (+ cascaded sub-runs)
  router.delete("/history/:id", resolveUser, async (req, res) => {
    try {
      const uid = guardPg(req, res); if (!uid) return;
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: { message: "Invalid audit run ID." } });
      await query("DELETE FROM audit_runs WHERE id=$1 AND uid=$2", [id, uid]);
      res.json({ success: true });
    } catch (error) {
      console.error("[AuditOrchestrator] History DELETE failed:", error.message);
      handleApiError(error, res);
    }
  });

  // GET /audit-orchestrator/:id -- persisted report (overall + 4 sub-runs)
  router.get("/:id", resolveUser, async (req, res) => {
    try {
      const uid = guardPg(req, res); if (!uid) return;
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: { message: "Invalid audit run ID." } });
      const { rows } = await query(`SELECT * FROM audit_runs WHERE id=$1 AND uid=$2`, [id, uid]);
      if (!rows.length) return res.status(404).json({ error: { message: "Audit run not found." } });
      const subs = await query(`SELECT * FROM audit_sub_runs WHERE audit_run_id=$1 ORDER BY type`, [id]);
      const withBackfill = await backfillPlaylistHistoryId({ uid, run: rows[0], subs: subs.rows });
      res.json({ run: rows[0], subRuns: sanitizeSubRunsMeta(withBackfill) });
    } catch (error) {
      console.error("[AuditOrchestrator] GET failed:", error.message);
      handleApiError(error, res);
    }
  });

  // POST /audit-orchestrator/:id/rerun -- re-run the full audit
  router.post("/:id/rerun", resolveUser, orgTokenMiddleware, checkPremiumAccess("audit"), requireQuota("audit"), async (req, res) => {
    try {
      const uid = guardPg(req, res); if (!uid) return;
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: { message: "Invalid audit run ID." } });
      const { rows } = await query(`SELECT channel_id FROM audit_runs WHERE id=$1 AND uid=$2`, [id, uid]);
      if (!rows.length) return res.status(404).json({ error: { message: "Audit run not found." } });
      // Preserve the original run's scope: a channel-only run has exactly one
      // channelIdentity sub-run; anything else re-runs the full 4-part audit.
      const subTypes = await query(`SELECT type FROM audit_sub_runs WHERE audit_run_id=$1`, [id]);
      const isChannelScope = subTypes.rows.length === 1 && subTypes.rows[0].type === "channelIdentity";
      const job = await queueService.enqueueAuditOrchestrator(
        {
          channelId: rows[0].channel_id,
          authHeader: req.headers?.authorization || "",
          uid,
          email: req.authUser?.email,
          orgId: req.headers["x-org-id"] || null,
          includeThumbnailAI: !!req.body?.includeThumbnailAI,
          scope: isChannelScope ? "channel" : "full",
        },
        { removeOnComplete: { age: 3600 * 24 }, removeOnFail: { age: 3600 * 24 * 7 } },
      );
      res.json({ jobId: job?.id });
    } catch (error) {
      console.error("[AuditOrchestrator] Rerun failed:", error.message);
      handleApiError(error, res);
    }
  });

  // POST /audit-orchestrator/:id/rerun/:type -- re-run a single sub-audit (v2; stub for now)
  router.post("/:id/rerun/:type", resolveUser, async (req, res) => {
    res.status(501).json({ error: { message: "Per-sub-audit rerun arrives in a later phase." } });
  });

  return router;
}

module.exports = { createAuditOrchestratorRouter };

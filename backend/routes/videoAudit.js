// ── Video Audit Route -- POST /video-audit (enqueue), GET /jobs/:id (poll), history CRUD ──
const express = require("express");
const { createChannelOwnershipValidator } = require("../utils/channelOwnership");
const { getAuditCriteria } = require("../config/channelAuditCriteria");
const { createAuditHistoryService } = require("../services/auditHistoryService");

function createVideoAuditRouter(deps) {
  const { resolveUser, checkPremiumAccess, requireQuota, handleApiError, queueService, query, isPostgresConfigured } = deps;
  const { saveVideoAuditHistory } = createAuditHistoryService(deps);
  const ownership = deps.ownership || createChannelOwnershipValidator(deps);
  // Org-token resolution: when X-Org-Id is present, swap the org channel's OAuth
  // token into req.headers.authorization so the audit fetches data with it.
  const resolveOrgToken = deps.resolveOrgToken || (() => (req, res, next) => next());
  const orgTokenMiddleware = resolveOrgToken((req) => req.body?.channelId);
  const router = express.Router();
  // Read-only org members (`role === 'read'`) may only view history here.
  const requireOrgWrite = deps.requireOrgWrite || ((req, res, next) => next());
  router.use(requireOrgWrite);

  const guardPg = (req, res) => {
    if (!isPostgresConfigured()) {
      res.status(503).json({ error: { message: "Database not configured." } });
      return false;
    }
    return true;
  };

  // GET /video-audit/criteria -- public (authenticated, read-only) view of the
  // admin-configured Video Audit scoring criteria (config/auditCriteria). Used by
  // the page's help/guide modal so the displayed criteria and points always match
  // what admins control (labels + weight points + element + focus category).
  router.get("/criteria", resolveUser, async (req, res) => {
    try {
      const db = deps.db;
      const cfg = (await (deps.getAuditCriteria || getAuditCriteria)(db)) || { video: [] };
      const criteria = (Array.isArray(cfg.video) ? cfg.video : []).map((c) => ({
        key: c.key,
        label: c.label,
        weight: Number(c.weight) || 0,
        element: c.element,
        category: c.category,
        instruction: c.instruction,
      }));
      res.json({ criteria });
    } catch (error) {
      console.error("[VideoAudit] Criteria GET Error:", error.message);
      handleApiError(error, res);
    }
  });

  // POST /video-audit -- enqueue a batch audit for an owned channel
  router.post("/", resolveUser, orgTokenMiddleware, checkPremiumAccess("videoAudit"), requireQuota("videoAudit"), async (req, res) => {
    try {
      const { channelId, videoIds, includeThumbnail } = req.body;
      if (!channelId || !Array.isArray(videoIds) || videoIds.length === 0) {
        return res.status(400).json({ error: { message: '"channelId" and non-empty "videoIds" are required.' } });
      }
      const owned = new Set(await ownership.getConnectedChannelIds(req));
      if (!owned.has(channelId)) {
        return res.status(403).json({ error: { message: "Channel is not from your connected channels." } });
      }
      const job = await queueService.enqueueVideoAudit(
        {
          channelId,
          videoIds,
          // Optional 12-pillar thumbnail analysis (one Gemini vision call per
          // video via the Thumbnail Optimizer). Off by default -- opt in from
          // the Video Audit page when thumbnail detail is wanted.
          includeThumbnail: !!includeThumbnail,
          authHeader: req.headers?.authorization || "",
          uid: req.authUser?.uid,
          email: req.authUser?.email,
          orgId: req.headers["x-org-id"] || null,
        },
        { removeOnComplete: { age: 3600 * 24 }, removeOnFail: { age: 3600 * 24 * 7 } },
      );
      res.json({ jobId: job?.id });
    } catch (error) {
      console.error("[VideoAudit] POST failed:", error.message);
      handleApiError(error, res);
    }
  });

  // GET /video-audit/jobs/:id -- poll job status
  router.get("/jobs/:id", resolveUser, async (req, res) => {
    try {
      const job = await queueService.jobsGet(String(req.params.id).replace(/[^0-9A-Za-z_-]/g, ""));
      if (!job) return res.status(404).json({ error: { message: "Job not found." } });
      const state = await job.getState();
      res.json({
        jobId: job.id,
        state,
        progress: job.progress ?? 0,
        ...(state === "completed" ? { result: job.returnvalue } : {}),
      });
    } catch (error) {
      console.error("[VideoAudit] Jobs GET failed:", error.message);
      handleApiError(error, res);
    }
  });

  // POST /video-audit/history -- save an audit result (canonical writer)
  router.post("/history", resolveUser, async (req, res) => {
    if (!guardPg(req, res)) return;
    const uid = req.authUser?.uid;
    const { name, channelId, channelTitle, results } = req.body || {};
    try {
      const saved = await saveVideoAuditHistory({ uid, name, channelId, channelTitle, results });
      res.json(saved);
    } catch (error) {
      console.error("[VideoAudit] History POST failed:", error.message);
      handleApiError(error, res);
    }
  });

  // GET /video-audit/history -- list saved audits
  router.get("/history", resolveUser, async (req, res) => {
    if (!guardPg(req, res)) return;
    const uid = req.authUser?.uid;
    const limit = Math.min(parseInt(req.query?.limit, 10) || 20, 50);
    const page = Math.max(parseInt(req.query?.page, 10) || 1, 1);
    const search = typeof req.query?.search === "string" && req.query.search.trim() ? `%${req.query.search.trim()}%` : null;
    try {
      const out = await query(
        search
          ? "SELECT id, name, channel_id, channel_title, created_at FROM video_audits WHERE uid = $1 AND name ILIKE $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4"
          : "SELECT id, name, channel_id, channel_title, created_at FROM video_audits WHERE uid = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
        search ? [uid, search, limit, (page - 1) * limit] : [uid, limit, (page - 1) * limit],
      );
      const count = await query(
        search ? "SELECT count(*)::int AS total FROM video_audits WHERE uid = $1 AND name ILIKE $2" : "SELECT count(*)::int AS total FROM video_audits WHERE uid = $1",
        search ? [uid, search] : [uid],
      );
      res.json({
        items: out.rows.map((r) => ({
          id: r.id,
          name: r.name,
          channelId: r.channel_id,
          channelTitle: r.channel_title,
          createdAt: r.created_at,
        })),
        total: count.rows[0]?.total ?? 0,
        page,
      });
    } catch (error) {
      console.error("[VideoAudit] History GET failed:", error.message);
      handleApiError(error, res);
    }
  });

  // GET /video-audit/history/by-video/:videoId -- newest saved audit that
  // contains this video (results.results[].videoId). Returns { id | null }.
  // Used by the Optimized Content page to deep-link a saved run instead of
  // re-running a fresh audit. Must be registered before /history/:id.
  router.get("/history/by-video/:videoId", resolveUser, async (req, res) => {
    if (!guardPg(req, res)) return;
    const uid = req.authUser?.uid;
    const videoId = String(req.params.videoId || "").trim();
    if (!videoId) return res.json({ id: null });
    try {
      const out = await query(
        `SELECT v.id FROM video_audits v,
           jsonb_array_elements(CASE WHEN jsonb_typeof(v.results->'results') = 'array' THEN v.results->'results' ELSE '[]'::jsonb END) AS r
         WHERE v.uid = $1 AND r->>'videoId' = $2
         ORDER BY v.created_at DESC LIMIT 1`,
        [uid, videoId],
      );
      res.json({ id: out.rows[0]?.id ?? null });
    } catch (error) {
      console.error("[VideoAudit] History by-video failed:", error.message);
      handleApiError(error, res);
    }
  });

  // GET /video-audit/history/:id -- view one saved audit
  router.get("/history/:id", resolveUser, async (req, res) => {
    if (!guardPg(req, res)) return;
    const uid = req.authUser?.uid;
    const id = String(req.params.id).replace(/[^0-9a-f-]/gi, "");
    try {
      const out = await query("SELECT id, name, channel_id, channel_title, results, created_at FROM video_audits WHERE id = $1 AND uid = $2", [id, uid]);
      if (!out.rows[0]) return res.status(404).json({ error: { message: "Audit not found." } });
      const row = out.rows[0];
      let results = row.results;
      if (typeof results === "string") {
        try { results = JSON.parse(results); } catch { results = {}; }
      }
      res.json({
        id: row.id,
        name: row.name,
        channelId: row.channel_id,
        channelTitle: row.channel_title,
        createdAt: row.created_at,
        results,
      });
    } catch (error) {
      console.error("[VideoAudit] History item GET failed:", error.message);
      handleApiError(error, res);
    }
  });

  // DELETE /video-audit/history/:id
  router.delete("/history/:id", resolveUser, async (req, res) => {
    if (!guardPg(req, res)) return;
    const uid = req.authUser?.uid;
    const id = String(req.params.id).replace(/[^0-9a-f-]/gi, "");
    try {
      await query("DELETE FROM video_audits WHERE id = $1 AND uid = $2", [id, uid]);
      res.json({ success: true });
    } catch (error) {
      console.error("[VideoAudit] History DELETE failed:", error.message);
      handleApiError(error, res);
    }
  });

  // PATCH /video-audit/history/:id -- rename a saved audit
  router.patch("/history/:id", resolveUser, async (req, res) => {
    if (!guardPg(req, res)) return;
    const uid = req.authUser?.uid;
    const id = String(req.params.id).replace(/[^0-9a-f-]/gi, "");
    const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 200) : "";
    if (!name) return res.status(400).json({ error: { message: '"name" is required.' } });
    try {
      const out = await query("UPDATE video_audits SET name = $1, updated_at = NOW() WHERE id = $2 AND uid = $3 RETURNING id, name", [name, id, uid]);
      if (!out.rows[0]) return res.status(404).json({ error: { message: "Audit not found." } });
      res.json({ id: out.rows[0].id, name: out.rows[0].name });
    } catch (error) {
      console.error("[VideoAudit] History PATCH failed:", error.message);
      handleApiError(error, res);
    }
  });

  return router;
}

module.exports = { createVideoAuditRouter };
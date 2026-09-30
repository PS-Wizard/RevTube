// ── Public Audit Route (admin-only) ─────────────────────────────────────────
// FULL audit of ANY public channel using ONLY YouTube Data API public endpoints
// (server API key, no OAuth, no ownership). The pipeline lives in
// services/publicAuditRunner.js (shared with the `public-audit` BullMQ queue):
//   POST /      -- run synchronously (bounded), returns the full report
//   POST /jobs  -- enqueue a background job, returns { jobId } (falls back to
//                  a synchronous run when the queue service is disabled)
//   GET /jobs/:id -- poll a queued job ({ jobId, state, progress, result? })
//   GET /         -- admin-only history list
//   GET /:id      -- one saved report (admin only)
//   DELETE /:id   -- delete a saved report (admin only)
// Reports persist to `public_audits` (JSONB) for the admin-only history.
const express = require("express");
const {
  runPublicAuditReport,
  scoreFullAudit,
  HARD_MAX_VIDEOS,
  DEFAULT_MAX_VIDEOS,
} = require("../services/publicAuditRunner");

function createPublicAuditRouter(deps) {
  const {
    checkAdmin,
    query,
    isPostgresConfigured,
    handleApiError,
    queueService,
    publicAuditService,
  } = deps;
  const router = express.Router();

  const guardPg = (req, res) => {
    if (!isPostgresConfigured()) {
      res.status(503).json({ error: { message: "Database not configured." } });
      return false;
    }
    return true;
  };

  const parseId = (raw) => {
    const id = parseInt(String(raw || ""), 10);
    return Number.isFinite(id) && id > 0 ? id : null;
  };

  // POST /admin/public-audits -- run a public audit (synchronous; bounded).
  router.post("/", checkAdmin, async (req, res) => {
    if (!guardPg(req, res)) return;
    try {
      const { channelInput, maxVideos, includeAllPlaylists, includeThumbnail, includeCaptions } = req.body || {};
      const response = await runPublicAuditReport(deps, {
        channelInput,
        maxVideos,
        includeAllPlaylists,
        includeThumbnail,
        includeCaptions,
        createdBy: req.authUser,
      });
      res.json(response);
    } catch (error) {
      console.error("[PublicAudit] run failed:", error.message);
      const status = error?.status === 404 || error?.status === 400 ? error.status : undefined;
      if (status) return res.status(status).json({ error: { message: error.message } });
      handleApiError(error, res);
    }
  });

  // POST /admin/public-audits/jobs -- enqueue a background public-audit job.
  // Large audits (up to 1,000 videos + vision passes) can run for many minutes,
  // so the frontend enqueues here and polls GET /jobs/:id instead of holding
  // an HTTP request open. When the queue service is disabled (no Redis), falls
  // back to the synchronous pipeline and returns the full report directly.
  router.post("/jobs", checkAdmin, async (req, res) => {
    if (!guardPg(req, res)) return;
    try {
      const { channelInput, maxVideos, includeAllPlaylists, includeThumbnail, includeCaptions } = req.body || {};
      if (!channelInput || typeof channelInput !== "string" || !channelInput.trim()) {
        return res.status(400).json({ error: { message: '"channelInput" (handle, ID, or URL) is required.' } });
      }
      const payload = {
        channelInput: channelInput.trim(),
        maxVideos: Math.max(1, Math.min(HARD_MAX_VIDEOS, Number(maxVideos) || DEFAULT_MAX_VIDEOS)),
        includeAllPlaylists: !!includeAllPlaylists,
        includeThumbnail: !!includeThumbnail,
        includeCaptions: !!includeCaptions,
        uid: req.authUser?.uid,
        email: req.authUser?.email,
      };
      const canEnqueue = queueService && typeof queueService.enqueuePublicAudit === "function";
      const job = canEnqueue
        ? await queueService.enqueuePublicAudit(
            payload,
            { removeOnComplete: { age: 3600 * 24 }, removeOnFail: { age: 3600 * 24 * 7 } },
          )
        : null;
      if (job?.id) {
        return res.json({ jobId: job.id });
      }
      // Queue disabled (null service) — run inline so the audit still works.
      const response = await runPublicAuditReport(deps, { ...payload, createdBy: req.authUser });
      res.json({ ...response, direct: true });
    } catch (error) {
      console.error("[PublicAudit] enqueue failed:", error.message);
      handleApiError(error, res);
    }
  });

  // GET /admin/public-audits/jobs/:id -- poll a queued job.
  // Must be registered before GET /:id so "jobs" is never parsed as an id.
  router.get("/jobs/:id", checkAdmin, async (req, res) => {
    try {
      const loader = queueService && typeof queueService.publicAuditJobsGet === "function"
        ? queueService.publicAuditJobsGet
        : null;
      if (!loader) return res.status(503).json({ error: { message: "Audit queue is not available." } });
      const job = await loader(String(req.params.id).replace(/[^0-9A-Za-z_-]/g, ""));
      if (!job) return res.status(404).json({ error: { message: "Job not found." } });
      const state = await job.getState();
      res.json({
        jobId: job.id,
        state,
        progress: job.progress ?? 0,
        ...(state === "completed" ? { result: job.returnvalue } : {}),
        ...(state === "failed" ? { error: job.failedReason || "Public audit job failed." } : {}),
      });
    } catch (error) {
      console.error("[PublicAudit] jobs GET failed:", error.message);
      handleApiError(error, res);
    }
  });

  // GET /admin/public-audits -- admin-only history list.
  router.get("/", checkAdmin, async (req, res) => {
    if (!guardPg(req, res)) return;
    const limit = Math.min(parseInt(req.query?.limit, 10) || 20, 50);
    const page = Math.max(parseInt(req.query?.page, 10) || 1, 1);
    const search = typeof req.query?.search === "string" && req.query.search.trim() ? `%${req.query.search.trim()}%` : null;
    try {
      const out = await query(
        search
          ? `SELECT id, channel_input, channel_id, channel_title, video_count, overall, created_by_email, created_at
             FROM public_audits WHERE channel_title ILIKE $1 OR channel_input ILIKE $1
             ORDER BY created_at DESC LIMIT $2 OFFSET $3`
          : `SELECT id, channel_input, channel_id, channel_title, video_count, overall, created_by_email, created_at
             FROM public_audits ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        search ? [search, limit, (page - 1) * limit] : [limit, (page - 1) * limit],
      );
      const count = await query(
        search
          ? "SELECT count(*)::int AS total FROM public_audits WHERE channel_title ILIKE $1 OR channel_input ILIKE $1"
          : "SELECT count(*)::int AS total FROM public_audits",
        search ? [search] : [],
      );
      res.json({
        items: out.rows.map((r) => ({
          id: r.id,
          channelInput: r.channel_input,
          channelId: r.channel_id,
          channelTitle: r.channel_title,
          videoCount: r.video_count,
          overall: r.overall,
          createdByEmail: r.created_by_email,
          createdAt: r.created_at,
        })),
        total: count.rows[0]?.total ?? 0,
        page,
      });
    } catch (error) {
      console.error("[PublicAudit] list failed:", error.message);
      handleApiError(error, res);
    }
  });

  // GET /admin/public-audits/:id -- one saved report (admin only).
  router.get("/:id", checkAdmin, async (req, res) => {
    if (!guardPg(req, res)) return;
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: { message: "Invalid id." } });
    try {
      const out = await query("SELECT * FROM public_audits WHERE id = $1", [id]);
      if (!out.rows[0]) return res.status(404).json({ error: { message: "Audit not found." } });
      const row = out.rows[0];
      const parseJson = (v) => {
        if (v && typeof v === "object") return v;
        try { return JSON.parse(v || "{}"); } catch { return {}; }
      };
      const stored = parseJson(row.results);
      let storedSnapshot = parseJson(row.snapshot);
      if (!storedSnapshot.avatarUrl && row.channel_id && typeof publicAuditService?.resolvePublicChannel === "function") {
        try {
          const channel = await publicAuditService.resolvePublicChannel(row.channel_id);
          if (channel?.avatarUrl) storedSnapshot = { ...storedSnapshot, avatarUrl: channel.avatarUrl };
        } catch (error) {
          console.warn("[PublicAudit] avatar hydration failed (non-fatal):", error.message);
        }
      }
      // Legacy reports (saved before per-video stats were persisted) carry
      // bare scorer rows — backfill dates/views/durations from videos.list on
      // open so old audits render fully without needing a re-run. One-time:
      // filled rows are written back; failures serve the stored rows as-is.
      let results = stored.results || [];
      const missingIds = results
        .filter((r) => r?.videoId && !r?.statistics?.viewCount && !r?.publishedAt)
        .map((r) => r.videoId);
      if (missingIds.length && typeof publicAuditService?.hydrateVideoMetadata === "function") {
        try {
          const hydrated = await publicAuditService.hydrateVideoMetadata(missingIds);
          const metaById = new Map((hydrated || []).map((m) => [m?.videoId, m]));
          let filled = 0;
          results = results.map((r) => {
            const m = metaById.get(r.videoId);
            if (!m) return r;
            filled += 1;
            return {
              ...r,
              statistics: {
                viewCount: m.statistics?.viewCount ?? r.statistics?.viewCount ?? null,
                likeCount: m.statistics?.likeCount ?? r.statistics?.likeCount ?? null,
                commentCount: m.statistics?.commentCount ?? r.statistics?.commentCount ?? null,
                favoriteCount: m.statistics?.favoriteCount ?? r.statistics?.favoriteCount ?? null,
              },
              publishedAt: r.publishedAt ?? m.publishedAt ?? null,
              durationLabel: r.durationLabel || m.durationLabel || "",
              durationSeconds: r.durationSeconds ?? m.durationSeconds ?? null,
              definition: r.definition || m.definition || "",
              categoryId: r.categoryId || m.categoryId || "",
              liveBroadcastContent: r.liveBroadcastContent || m.liveBroadcastContent || "",
            };
          });
          if (filled > 0) {
            const persisted = { ...stored, results };
            await query("UPDATE public_audits SET results = $1, updated_at = NOW() WHERE id = $2", [
              JSON.stringify(persisted),
              id,
            ]);
          }
        } catch (error) {
          console.warn("[PublicAudit] video metadata backfill failed (non-fatal):", error.message);
        }
      }
      res.json({
        id: row.id,
        channelInput: row.channel_input,
        channelId: row.channel_id,
        channelTitle: row.channel_title,
        videoCount: row.video_count,
        overall: row.overall,
        videoAuditOverall: stored.videoAuditOverall ?? null,
        fullAudit: stored.fullAudit ?? null,
        auditedAt: stored.auditedAt ?? null,
        snapshot: storedSnapshot,
        channelLifetime: stored.channelLifetime ?? storedSnapshot.channelLifetime ?? null,
        playlists: stored.playlists ?? [],
        playlistCount: (stored.playlists ?? []).length,
        results,
        createdByEmail: row.created_by_email,
        createdAt: row.created_at,
      });
    } catch (error) {
      console.error("[PublicAudit] get failed:", error.message);
      handleApiError(error, res);
    }
  });

  // DELETE /admin/public-audits/:id (admin only).
  router.delete("/:id", checkAdmin, async (req, res) => {
    if (!guardPg(req, res)) return;
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: { message: "Invalid id." } });
    try {
      await query("DELETE FROM public_audits WHERE id = $1", [id]);
      res.json({ success: true });
    } catch (error) {
      console.error("[PublicAudit] delete failed:", error.message);
      handleApiError(error, res);
    }
  });

  // PATCH /admin/public-audits/:id -- rename a saved report (admin only).
  router.patch("/:id", checkAdmin, async (req, res) => {
    if (!guardPg(req, res)) return;
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: { message: "Invalid id." } });
    const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 200) : "";
    if (!name) return res.status(400).json({ error: { message: '"name" is required.' } });
    try {
      const out = await query(
        "UPDATE public_audits SET channel_title = $1, updated_at = NOW() WHERE id = $2 RETURNING id, channel_title",
        [name, id],
      );
      if (!out.rows[0]) return res.status(404).json({ error: { message: "Audit not found." } });
      res.json({ id: out.rows[0].id, channelTitle: out.rows[0].channel_title });
    } catch (error) {
      console.error("[PublicAudit] rename failed:", error.message);
      handleApiError(error, res);
    }
  });

  return router;
}

module.exports = { createPublicAuditRouter, scoreFullAudit, HARD_MAX_VIDEOS, DEFAULT_MAX_VIDEOS };

// ─────────────────────────────────────────────────────────────────────────────
// Thumbnail Optimizer Route -- POST /api/thumbnail-optimizer/analyze
// ─────────────────────────────────────────────────────────────────────────────
const express = require("express");
const { createChannelOwnershipValidator } = require("../utils/channelOwnership");

const MAX_URLS = 20;
const MAX_STRING_LENGTH = 1000;

/**
 * Fill blank niche/audience/voice from the saved Channel Focus.
 * Explicit user input always wins; inference stays the last resort.
 * Pure — unit tested.
 */
function applyFocusDefaults({ niche, targetAudience, brandVoice } = {}, focus = null) {
  return {
    niche: niche || String(focus?.niche || ""),
    targetAudience: targetAudience || String(focus?.audience || ""),
    brandVoice: brandVoice || String(focus?.tone || ""),
  };
}

function createThumbnailOptimizerRouter(deps) {
  const {
    resolveUser,
    checkPremiumAccess,
    requireQuota,
    handleApiError,
    thumbnailOptimizerService,
    query,
    isPostgresConfigured,
    queueService,
  } = deps;

  const ownership = createChannelOwnershipValidator(deps);

  // Owner-defined Channel Focus for AI grounding. Best-effort: null when none
  // saved (the service falls back to inference). Never throws.
  async function fetchFocus(channelId, req) {
    if (!channelId) return null;
    try {
      const svc = deps.channelFocusService;
      if (!svc?.getFocusForAI) return null;
      return await svc.getFocusForAI(String(channelId), req.headers["x-org-id"] || null);
    } catch (err) {
      console.warn(`[ThumbnailOptimizer] Focus lookup failed for ${channelId}: ${err?.message || err}`);
      return null;
    }
  }

  const router = express.Router();

  // Public (authenticated, read-only) criteria endpoint used by the frontend
  // help/guide modals. Returns the SINGLE source of truth for thumbnail pillars
  // and playlist scoring criteria (config/optimizerCriteria).
  router.get("/criteria", resolveUser, async (req, res) => {
    try {
      const cfg = (await deps.getOptimizerCriteria?.()) || { thumbnail: [], playlist: [] };
      res.json({ thumbnail: cfg.thumbnail || [], playlist: cfg.playlist || [] });
    } catch (error) {
      console.error("[ThumbnailOptimizer] Criteria GET Error:", error.message);
      res.status(500).json({ error: { message: error.message } });
    }
  });

  // Read-only org members (`role === 'read'`) may only view history here.
  const requireOrgWrite = deps.requireOrgWrite || ((req, res, next) => next());
  router.use(requireOrgWrite);

  // POST /jobs -- enqueue a background thumbnail analysis (survives page nav/close)
  router.post(
    "/jobs",
    resolveUser,
    checkPremiumAccess("thumbnailOptimizer"),
    requireQuota("thumbnailOptimizer"),
    async (req, res) => {
      try {
        const { urls = [], niche, targetAudience, brandVoice, channelId, channelTitle } = req.body;
        if (!Array.isArray(urls)) {
          return res.status(400).json({ error: { message: '"urls" must be an array of strings' } });
        }
        if (urls.length > MAX_URLS) {
          return res.status(400).json({ error: { message: `Maximum of ${MAX_URLS} URLs per request (got ${urls.length})` } });
        }
        const sanitize = (s) => (typeof s === "string" ? s.slice(0, MAX_STRING_LENGTH).trim() : "");
        const cleanUrls = urls.map((u) => (typeof u === "string" ? u.trim() : "")).filter(Boolean);
        if (cleanUrls.length === 0) {
          return res.status(400).json({ error: { message: "Provide at least one YouTube URL." } });
        }
        const check = await ownership.validateVideos(req, cleanUrls.map((url) => ({ url })));
        if (!check.ok) return res.status(403).json({ error: { message: check.message } });

        // Ground blank context in the saved focus so the worker + persisted
        // history carry the owner's niche/audience/voice.
        const withFocus = applyFocusDefaults(
          { niche: sanitize(niche), targetAudience: sanitize(targetAudience), brandVoice: sanitize(brandVoice) },
          await fetchFocus(sanitize(channelId), req),
        );
        const job = await queueService.enqueueOptimizer({
          kind: "thumbnail",
          payload: {
            urls: cleanUrls,
            niche: withFocus.niche,
            targetAudience: withFocus.targetAudience,
            brandVoice: withFocus.brandVoice,
            channelId: sanitize(channelId) || null,
            channelTitle: sanitize(channelTitle) || null,
          },
          uid: req.authUser?.uid,
          email: req.authUser?.email,
          orgId: req.headers["x-org-id"] || null,
        }, { removeOnComplete: { age: 3600 * 24 }, removeOnFail: { age: 3600 * 24 * 7 } });

        res.json({ jobId: job?.id });
      } catch (error) {
        console.error("[ThumbnailOptimizer:jobs] Error:", error.message);
        handleApiError(error, res);
      }
    },
  );

  // GET /jobs/:id -- poll thumbnail job status
  router.get("/jobs/:id", resolveUser, async (req, res) => {
    try {
      const job = await queueService.optimizerJobsGet(String(req.params.id).replace(/[^0-9A-Za-z_-]/g, ""));
      if (!job) return res.status(404).json({ error: { message: "Job not found." } });
      const state = await job.getState();
      res.json({
        jobId: job.id,
        state,
        progress: job.progress ?? 0,
        ...(state === "completed" ? { result: job.returnvalue } : {}),
      });
    } catch (error) {
      console.error("[ThumbnailOptimizer:jobs] GET failed:", error.message);
      handleApiError(error, res);
    }
  });

  /**
   * POST /analyze
   *
   * Accept YouTube video URLs + optional context, returns structured audits.
   *
   * Body:
   *   { urls: string[], niche?: string, targetAudience?: string, brandVoice?: string }
   *
   * Response:
   *   { results: ThumbnailAudit[], errors?: Array<{ url, error }>, _usage }
   */
  router.post(
    "/analyze",
    resolveUser,
    checkPremiumAccess("thumbnailOptimizer"),
    requireQuota("thumbnailOptimizer"),
    async (req, res) => {
      try {
        const { urls = [], niche, targetAudience, brandVoice } = req.body;

        // Validate input
        if (!Array.isArray(urls)) {
          return res.status(400).json({
            error: { message: '"urls" must be an array of strings' },
          });
        }

        if (urls.length > MAX_URLS) {
          return res.status(400).json({
            error: {
              message: `Maximum of ${MAX_URLS} URLs per request (got ${urls.length})`,
            },
          });
        }

        const sanitize = (s) =>
          typeof s === "string" ? s.slice(0, MAX_STRING_LENGTH).trim() : "";

        const cleanNiche = sanitize(niche);
        const cleanAudience = sanitize(targetAudience);
        const cleanVoice = sanitize(brandVoice);

        const cleanUrls = urls
          .map((u) => (typeof u === "string" ? u.trim() : ""))
          .filter(Boolean);

        if (cleanUrls.length === 0 && !cleanNiche && !cleanAudience && !cleanVoice) {
          return res.status(400).json({
            error: {
              message:
                "Provide at least one YouTube URL or context details (niche, audience, brand voice).",
            },
          });
        }

        // Server-side ownership check: non-admins may only analyze videos from
        // their own connected channels. Admins can analyze any channel.
        if (cleanUrls.length > 0) {
          const check = await ownership.validateVideos(
            req,
            cleanUrls.map((url) => ({ url })),
          );
          if (!check.ok) {
            return res.status(403).json({ error: { message: check.message } });
          }
        }

        // Ground blank context in the saved focus: resolve the owning channel
        // from the first video (Postgres-first, YouTube fallback).
        let focusChannelId = null;
        try {
          const firstId = cleanUrls.map((u) => ownership.extractYoutubeId(u)).find(Boolean);
          if (firstId) {
            const resolved = await ownership.resolveVideoChannelIds([firstId]);
            focusChannelId = resolved.get(firstId) || null;
          }
        } catch {
          focusChannelId = null;
        }
        const withFocus = applyFocusDefaults(
          { niche: cleanNiche, targetAudience: cleanAudience, brandVoice: cleanVoice },
          await fetchFocus(focusChannelId, req),
        );
        const payload = await thumbnailOptimizerService.analyze(
          cleanUrls,
          withFocus.niche,
          withFocus.targetAudience,
          withFocus.brandVoice,
        );

        return res.json(payload);
      } catch (error) {
        // ── Log full error details for debugging ──
        console.error("[ThumbnailOptimizer:analyze] ===== ERROR =====");
        console.error("[ThumbnailOptimizer:analyze] Message:", error?.message || "(no message)");
        if (error?.response) {
          console.error("[ThumbnailOptimizer:analyze] Status:", error.response.status);
          console.error("[ThumbnailOptimizer:analyze] Response body:", JSON.stringify(error.response.data).slice(0, 1000));
        } else if (error?.status) {
          console.error("[ThumbnailOptimizer:analyze] Status:", error.status);
        }
        if (error?.stack) {
          console.error("[ThumbnailOptimizer:analyze] Stack:", error.stack.split("\n").slice(0, 4).join("\n"));
        }
        console.error("[ThumbnailOptimizer:analyze] ===================");

        // Gemini rate-limit (429 from axios .response or direct .status)
        const status = error?.response?.status || error?.status || 0;
        const msg = (error?.message || "") + " " + (error?.response?.data?.error?.message || "");

        if (status === 429 || msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("RATE_LIMIT")) {
          return res.status(429).json({
            error: {
              message: "Gemini API rate limit hit. Wait a moment and try again.",
              code: "GEMINI_RATE_LIMITED",
              detail: error?.response?.data || error?.message,
            },
          });
        }

        // Gemini auth/config errors
        if (status === 403 || msg.includes("API_KEY") || msg.includes("not found") || msg.includes("not supported")) {
          console.error("[ThumbnailOptimizer] Gemini config error:", msg.slice(0, 500));
          return res.status(503).json({
            error: {
              message: "Thumbnail analysis is unavailable (Gemini config issue). Contact support.",
              code: "GEMINI_CONFIG_ERROR",
              detail: process.env.NODE_ENV !== "production" ? msg.slice(0, 300) : undefined,
            },
          });
        }

        // JSON parse errors from Gemini response
        if (msg.includes("JSON") || msg.includes("parse") || msg.includes("Unexpected token")) {
          return res.status(502).json({
            error: {
              message: "Thumbnail analysis returned an invalid response. Try again.",
              code: "GEMINI_PARSE_ERROR",
              detail: process.env.NODE_ENV !== "production" ? msg.slice(0, 300) : undefined,
            },
          });
        }

        // Generic fallback -- includes real message in dev
        const devDetail = process.env.NODE_ENV !== "production" ? msg.slice(0, 400) : undefined;
        return res.status(500).json({
          error: {
            message: error?.message || "An internal error occurred during thumbnail analysis.",
            detail: devDetail,
          },
        });
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // PostgreSQL persistence -- Saved Audit History
  // ─────────────────────────────────────────────────────────────────────────────

  /** Helper: check PG is available and return uid */
  function guardPg(req, res) {
    if (!isPostgresConfigured()) {
      res.status(503).json({
        error: { message: "Database is not configured. Contact support." },
      });
      return null;
    }
    const uid = req.authUser?.uid;
    if (!uid) {
      res.status(401).json({ error: { message: "Not authenticated." } });
      return null;
    }
    return uid;
  }

  /**
   * POST /save
   *
   * Persist a completed audit to PostgreSQL for future access.
   *
   * Body:
   *   {
   *     name?: string,
   *     audits: ThumbnailAudit[],
   *     errors?: Array<{url, error}>,
   *     channelId?: string,
   *     channelTitle?: string,
   *     niche?: string,
   *     targetAudience?: string,
   *     brandVoice?: string,
   *   }
   *
   * Response: { id: number, createdAt: string }
   */
  router.post(
    "/save",
    resolveUser,
    checkPremiumAccess("thumbnailOptimizer"),
    async (req, res) => {
      try {
        const uid = guardPg(req, res);
        if (!uid) return;

        const {
          name,
          audits,
          errors,
          channelId,
          channelTitle,
          niche,
          targetAudience,
          brandVoice,
        } = req.body;

        if (!Array.isArray(audits) || audits.length === 0) {
          return res.status(400).json({
            error: { message: '"audits" must be a non-empty array.' },
          });
        }

        const auditName = typeof name === "string" && name.trim()
          ? name.trim().slice(0, 200)
          : `Audit -- ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

        const result = await query(
          `INSERT INTO thumbnail_audits (uid, name, channel_id, channel_title, niche, target_audience, brand_voice, total_videos, audits, errors)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id, created_at`,
          [
            uid,
            auditName,
            channelId || null,
            channelTitle || null,
            niche || null,
            targetAudience || null,
            brandVoice || null,
            audits.length,
            JSON.stringify(audits),
            Array.isArray(errors) ? JSON.stringify(errors) : null,
          ],
        );

        const row = result.rows[0];
        return res.status(201).json({
          id: row.id,
          createdAt: row.created_at.toISOString(),
        });
      } catch (error) {
        console.error("[ThumbnailOptimizer] Save failed:", error.message);
        handleApiError(error, res);
      }
    },
  );

  /**
   * GET /history
   *
   * List saved audit summaries (paginated, newest-first).
   *
   * Query: ?limit=20&page=1&search=keyword
   *
   * Response: { items: SavedAuditSummary[], total: number, page: number }
   */
  router.get(
    "/history",
    resolveUser,
    checkPremiumAccess("thumbnailOptimizer"),
    async (req, res) => {
      try {
        const uid = guardPg(req, res);
        if (!uid) return;

        const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const search = (req.query.search || "").trim();
        const offset = (page - 1) * limit;

        // Count query with optional search
        let countSql = "SELECT COUNT(*) AS total FROM thumbnail_audits WHERE uid = $1";
        const countParams = [uid];
        if (search) {
          countSql += " AND (name ILIKE $2 OR channel_title ILIKE $2)";
          countParams.push(`%${search}%`);
        }
        const countResult = await query(countSql, countParams);
        const total = parseInt(countResult.rows[0].total, 10);

        // Data query
        let dataSql = `SELECT id, name, created_at, channel_id, channel_title, total_videos, niche, errors
                       FROM thumbnail_audits
                       WHERE uid = $1`;
        const dataParams = [uid];

        if (search) {
          dataSql += " AND (name ILIKE $2 OR channel_title ILIKE $2)";
          dataParams.push(`%${search}%`);
        }

        dataSql += " ORDER BY created_at DESC LIMIT $" + (dataParams.length + 1) + " OFFSET $" + (dataParams.length + 2);
        dataParams.push(limit, offset);

        const dataResult = await query(dataSql, dataParams);

        const items = dataResult.rows.map((row) => ({
          id: row.id,
          name: row.name || "Untitled Audit",
          createdAt: row.created_at ? row.created_at.toISOString() : null,
          channelId: row.channel_id || null,
          channelTitle: row.channel_title || null,
          totalVideos: row.total_videos || 0,
          niche: row.niche || null,
          hasErrors: row.errors ? (Array.isArray(row.errors) && row.errors.length > 0) : false,
        }));

        return res.json({ items, total, page });
      } catch (error) {
        console.error("[ThumbnailOptimizer] History list failed:", error.message);
        handleApiError(error, res);
      }
    },
  );

  /**
   * GET /history/by-video/:videoId
   *
   * Resolve the newest saved audit that contains a given YouTube video id
   * (matched inside any stored result url). Used by the Optimized list page's
   * "View Audit" action to deep-link into an existing saved run instead of
   * triggering a fresh paid analysis.
   *
   * Response: { id: number | null }
   */
  router.get(
    "/history/by-video/:videoId",
    resolveUser,
    checkPremiumAccess("thumbnailOptimizer"),
    async (req, res) => {
      try {
        const uid = guardPg(req, res);
        if (!uid) return;

        const videoId = String(req.params.videoId || "").trim().slice(0, 100);
        if (!videoId) {
          return res.status(400).json({ error: { message: "Invalid video ID." } });
        }

        // Each stored element keeps its source link in `url` (full watch /
        // shorts / youtu.be URL or raw video id); substring ILIKE covers all forms.
        const result = await query(
          `SELECT ta.id
             FROM thumbnail_audits ta
            WHERE ta.uid = $1
              AND EXISTS (
                SELECT 1
                  FROM jsonb_array_elements(ta.audits) AS el
                 WHERE el->>'url' ILIKE '%' || $2 || '%'
              )
            ORDER BY ta.created_at DESC
            LIMIT 1`,
          [uid, videoId],
        );

        return res.json({ id: result.rows.length > 0 ? result.rows[0].id : null });
      } catch (error) {
        console.error("[ThumbnailOptimizer] Find-by-video failed:", error.message);
        handleApiError(error, res);
      }
    },
  );

  /**
   * GET /history/:id
   *
   * Retrieve a single saved audit with full results.
   */
  router.get(
    "/history/:id",
    resolveUser,
    checkPremiumAccess("thumbnailOptimizer"),
    async (req, res) => {
      try {
        const uid = guardPg(req, res);
        if (!uid) return;

        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
          return res.status(400).json({ error: { message: "Invalid audit ID." } });
        }

        const result = await query(
          `SELECT * FROM thumbnail_audits WHERE id = $1 AND uid = $2`,
          [id, uid],
        );

        if (result.rows.length === 0) {
          return res.status(404).json({ error: { message: "Audit not found." } });
        }

        const row = result.rows[0];
        return res.json({
          id: row.id,
          name: row.name,
          createdAt: row.created_at ? row.created_at.toISOString() : null,
          updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
          channelId: row.channel_id || null,
          channelTitle: row.channel_title || null,
          niche: row.niche || null,
          targetAudience: row.target_audience || null,
          brandVoice: row.brand_voice || null,
          totalVideos: row.total_videos || 0,
          audits: row.audits || [],
          errors: row.errors || null,
        });
      } catch (error) {
        console.error("[ThumbnailOptimizer] History get failed:", error.message);
        handleApiError(error, res);
      }
    },
  );

  /**
   * DELETE /history/:id
   *
   * Remove a saved audit from PostgreSQL.
   */
  router.delete(
    "/history/:id",
    resolveUser,
    checkPremiumAccess("thumbnailOptimizer"),
    async (req, res) => {
      try {
        const uid = guardPg(req, res);
        if (!uid) return;

        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
          return res.status(400).json({ error: { message: "Invalid audit ID." } });
        }

        const result = await query(
          `DELETE FROM thumbnail_audits WHERE id = $1 AND uid = $2 RETURNING id`,
          [id, uid],
        );

        if (result.rows.length === 0) {
          return res.status(404).json({ error: { message: "Audit not found." } });
        }

        return res.json({ success: true });
      } catch (error) {
        console.error("[ThumbnailOptimizer] Delete failed:", error.message);
        handleApiError(error, res);
      }
    },
  );

  return router;
}

module.exports = { createThumbnailOptimizerRouter, applyFocusDefaults };

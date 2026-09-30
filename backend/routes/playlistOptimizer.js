// ─────────────────────────────────────────────────────────────────────────────
// Playlist Optimizer Route -- POST /api/playlist-optimizer/analyze
// ─────────────────────────────────────────────────────────────────────────────
const express = require("express");
const { createChannelOwnershipValidator } = require("../utils/channelOwnership");

const MAX_VIDEOS = 500;
const MAX_STRING_LENGTH = 5000;

function createPlaylistOptimizerRouter(deps) {
  const {
    resolveUser,
    checkPremiumAccess,
    requireQuota,
    handleApiError,
    playlistOptimizerService,
    query,
    isPostgresConfigured,
    queueService,
  } = deps;

  const ownership = createChannelOwnershipValidator(deps);

  // Owner-defined Channel Focus for AI grounding. Best-effort: null when none
  // saved (callers fall back to inference). Never throws.
  async function fetchFocus(channelId, req) {
    if (!channelId) return null;
    try {
      const svc = deps.channelFocusService;
      if (!svc?.getFocusForAI) return null;
      return await svc.getFocusForAI(String(channelId), req.headers["x-org-id"] || null);
    } catch (err) {
      console.warn(`[PlaylistOptimizer] Focus lookup failed for ${channelId}: ${err?.message || err}`);
      return null;
    }
  }

  // Resolve the owning channel of the first video (Postgres-first, YouTube
  // fallback) so ad-hoc video lists still get focus grounding.
  async function resolveFirstChannelId(videos) {
    try {
      const firstId = videos.map((v) => v?.videoId).find(Boolean);
      if (!firstId) return null;
      const resolved = await ownership.resolveVideoChannelIds([firstId]);
      return resolved.get(firstId) || null;
    } catch {
      return null;
    }
  }

  const router = express.Router();

  // Read-only org members (`role === 'read'`) may only view history here.
  const requireOrgWrite = deps.requireOrgWrite || ((req, res, next) => next());
  router.use(requireOrgWrite);

  // POST /jobs -- enqueue a background playlist analysis (survives page nav/close)
  router.post(
    "/jobs",
    resolveUser,
    checkPremiumAccess("playlistOptimizer"),
    requireQuota("playlistOptimizer"),
    async (req, res) => {
      try {
        const { channelIdentifier, videos = [], filterConfig = {}, channelId, channelTitle } = req.body;
        if (!Array.isArray(videos)) {
          return res.status(400).json({ error: { message: '"videos" must be an array' } });
        }
        if (videos.length > MAX_VIDEOS) {
          return res.status(400).json({ error: { message: `Maximum of ${MAX_VIDEOS} videos per request (got ${videos.length})` } });
        }
        const sanitize = (s) => (typeof s === "string" ? s.slice(0, MAX_STRING_LENGTH).trim() : "");
        const cleanVideos = (videos || [])
          .filter((v) => v && typeof v === "object")
          .map((v) => ({
            id: String(v.id || v.videoId || ""),
            videoId: String(v.videoId || extractYoutubeId(v.url) || ""),
            title: sanitize(v.title) || "Untitled Video",
            description: sanitize(v.description),
            url: sanitize(v.url),
            publishDate: sanitize(v.publishDate),
            views: typeof v.views === "number" ? v.views : parseInt(v.views, 10) || 0,
            originalPlaylistId: sanitize(v.originalPlaylistId),
            customMetadata: v.customMetadata || {},
            Video_Type: v.Video_Type || "video",
            views7: typeof v.views7 === "number" ? v.views7 : parseInt(v.views7, 10) || 0,
            views30: typeof v.views30 === "number" ? v.views30 : parseInt(v.views30, 10) || 0,
            views90: typeof v.views90 === "number" ? v.views90 : parseInt(v.views90, 10) || 0,
            retention: typeof v.retention === "number" ? v.retention : parseFloat(v.retention) || 0,
            ctr: typeof v.ctr === "number" ? v.ctr : parseFloat(v.ctr) || 0,
            performance: v.performance && typeof v.performance === "object" ? v.performance : {},
          }));
        if (cleanVideos.length === 0 && !sanitize(channelIdentifier)) {
          return res.status(400).json({ error: { message: "Provide at least one video or a channel identifier." } });
        }
        if (cleanVideos.length > 0) {
          const check = await ownership.validateVideos(req, cleanVideos);
          if (!check.ok) return res.status(403).json({ error: { message: check.message } });
        }

        // Stash the owning channel so the worker can ground the analysis in
        // the saved Channel Focus (explicit channelId wins, else first video).
        const jobChannelId = sanitize(channelId) || await resolveFirstChannelId(cleanVideos) || null;
        const job = await queueService.enqueueOptimizer({
          kind: "playlist",
          payload: {
            videos: cleanVideos,
            channelIdentifier: sanitize(channelIdentifier),
            filterConfig: filterConfig || {},
            channelId: jobChannelId,
            channelTitle: sanitize(channelTitle) || null,
          },
          uid: req.authUser?.uid,
          email: req.authUser?.email,
          orgId: req.headers["x-org-id"] || null,
        }, { removeOnComplete: { age: 3600 * 24 }, removeOnFail: { age: 3600 * 24 * 7 } });

        res.json({ jobId: job?.id });
      } catch (error) {
        console.error("[PlaylistOptimizer:jobs] Error:", error.message);
        handleApiError(error, res);
      }
    },
  );

  // GET /jobs/:id -- poll playlist job status
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
      console.error("[PlaylistOptimizer:jobs] GET failed:", error.message);
      handleApiError(error, res);
    }
  });

  /**
   * POST /analyze
   *
   * Accept video metadata + channel context, returns structured playlist optimization.
   *
   * Body:
   *   { channelIdentifier?: string, videos?: Video[], filterConfig?: FilterConfig }
   *
   * Response:
   *   { results: AnalysisResult, _usage }
   */
  router.post(
    "/analyze",
    resolveUser,
    checkPremiumAccess("playlistOptimizer"),
    requireQuota("playlistOptimizer"),
    async (req, res) => {
      try {
        const { channelIdentifier, videos = [], filterConfig = {} } = req.body;

        // Validate input
        if (!Array.isArray(videos)) {
          return res.status(400).json({
            error: { message: '"videos" must be an array' },
          });
        }

        if (videos.length > MAX_VIDEOS) {
          return res.status(400).json({
            error: {
              message: `Maximum of ${MAX_VIDEOS} videos per request (got ${videos.length})`,
            },
          });
        }

        // Sanitize strings
        const sanitize = (s) =>
          typeof s === "string" ? s.slice(0, MAX_STRING_LENGTH).trim() : "";

        const cleanChannel = sanitize(channelIdentifier);

        // Sanitize videos -- ensure each has required fields
        const cleanVideos = (videos || [])
          .filter((v) => v && typeof v === "object")
          .map((v) => ({
            id: String(v.id || v.videoId || ""),
            videoId: String(v.videoId || extractYoutubeId(v.url) || ""),
            title: sanitize(v.title) || "Untitled Video",
            description: sanitize(v.description),
            url: sanitize(v.url),
            publishDate: sanitize(v.publishDate),
            views:
              typeof v.views === "number"
                ? v.views
                : parseInt(v.views, 10) || 0,
            originalPlaylistId: sanitize(v.originalPlaylistId),
            customMetadata: v.customMetadata || {},
            Video_Type: v.Video_Type || "video",
            views7:
              typeof v.views7 === "number" ? v.views7 : parseInt(v.views7, 10) || 0,
            views30:
              typeof v.views30 === "number" ? v.views30 : parseInt(v.views30, 10) || 0,
            views90:
              typeof v.views90 === "number" ? v.views90 : parseInt(v.views90, 10) || 0,
            retention:
              typeof v.retention === "number"
                ? v.retention
                : parseFloat(v.retention) || 0,
            ctr:
              typeof v.ctr === "number" ? v.ctr : parseFloat(v.ctr) || 0,
            performance: v.performance && typeof v.performance === "object"
              ? v.performance
              : {},
          }));

        if (cleanVideos.length === 0 && !cleanChannel) {
          return res.status(400).json({
            error: {
              message:
                "Provide at least one video or a channel identifier.",
            },
          });
        }

        // Server-side ownership check: non-admins may only analyze videos from
        // their own connected channels. Admins can analyze any channel.
        if (cleanVideos.length > 0) {
          const check = await ownership.validateVideos(req, cleanVideos);
          if (!check.ok) {
            return res.status(403).json({ error: { message: check.message } });
          }
        }

        const focusChannelId = await resolveFirstChannelId(cleanVideos);
        const payload = await playlistOptimizerService.analyze(
          cleanVideos,
          cleanChannel,
          filterConfig || {},
          await fetchFocus(focusChannelId, req),
        );

        return res.json(payload);
      } catch (error) {
        // ── Log full error details for debugging ──
        console.error("[PlaylistOptimizer:analyze] ===== ERROR =====");
        console.error(
          "[PlaylistOptimizer:analyze] Message:",
          error?.message || "(no message)",
        );
        if (error?.response) {
          console.error(
            "[PlaylistOptimizer:analyze] Status:",
            error.response.status,
          );
          console.error(
            "[PlaylistOptimizer:analyze] Response body:",
            JSON.stringify(error.response.data).slice(0, 1000),
          );
        }
        if (error?.stack) {
          console.error(
            "[PlaylistOptimizer:analyze] Stack:",
            error.stack.split("\n").slice(0, 4).join("\n"),
          );
        }
        console.error("[PlaylistOptimizer:analyze] ===================");

        // DeepSeek errors
        const status =
          error?.response?.status || error?.status || error?.statusCode || 0;
        const msg =
          (error?.message || "") +
          " " +
          (error?.response?.data?.error?.message || "");

        if (status === 429) {
          return res.status(429).json({
            error: {
              message:
                "DeepSeek API rate limit hit. Wait a moment and try again.",
              code: "DEEPSEEK_RATE_LIMITED",
              detail: process.env.NODE_ENV !== "production" ? msg.slice(0, 300) : undefined,
            },
          });
        }

        if (status === 503 || status === 401) {
          return res.status(503).json({
            error: {
              message:
                "Playlist optimization is unavailable (AI config issue). Contact support.",
              code: error.code || "AI_CONFIG_ERROR",
              detail: process.env.NODE_ENV !== "production" ? msg.slice(0, 300) : undefined,
            },
          });
        }

        // JSON parse errors
        if (msg.includes("JSON") || msg.includes("parse") || msg.includes("Unexpected token")) {
          return res.status(502).json({
            error: {
              message:
                "Playlist analysis returned an invalid response. Try again.",
              code: "AI_PARSE_ERROR",
              detail: process.env.NODE_ENV !== "production" ? msg.slice(0, 300) : undefined,
            },
          });
        }

        // Generic fallback
        const devDetail =
          process.env.NODE_ENV !== "production" ? msg.slice(0, 400) : undefined;
        return res.status(500).json({
          error: {
            message:
              error?.message ||
              "An internal error occurred during playlist analysis.",
            detail: devDetail,
          },
        });
      }
    },
  );

  // ── Helper: extract YouTube ID from URL ──
  function extractYoutubeId(url) {
    if (!url || typeof url !== "string") return null;
    const regExp =
      /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = String(url).match(regExp);
    return match && match[2].length === 11 ? match[2] : null;
  }

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
   * Persist a completed analysis to PostgreSQL for future access.
   *
   * Body:
   *   {
   *     name?: string,
   *     audits: Object,
   *     errors?: Array,
   *     channelId?: string,
   *     channelTitle?: string,
   *   }
   *
   * Response: { id: number, createdAt: string }
   */
  router.post(
    "/save",
    resolveUser,
    checkPremiumAccess("playlistOptimizer"),
    async (req, res) => {
      try {
        const uid = guardPg(req, res);
        if (!uid) return;

        const { name, audits, errors, channelId, channelTitle } = req.body;

        if (!audits) {
          return res.status(400).json({
            error: { message: '"audits" is required.' },
          });
        }

        const auditName =
          typeof name === "string" && name.trim()
            ? name.trim().slice(0, 200)
            : `Analysis -- ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

        const totalVideos = audits?.playlists
          ? audits.playlists.reduce(
              (sum, p) => sum + (p.videos?.length || 0),
              0,
            )
          : 0;

        const result = await query(
          `INSERT INTO playlist_audits (uid, name, channel_id, channel_title, total_videos, audits, errors)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, created_at`,
          [
            uid,
            auditName,
            channelId || null,
            channelTitle || null,
            totalVideos,
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
        console.error("[PlaylistOptimizer] Save failed:", error.message);
        handleApiError(error, res);
      }
    },
  );

  /**
   * GET /history
   *
   * List saved analysis summaries (paginated, newest-first).
   *
   * Query: ?limit=20&page=1&search=keyword
   *
   * Response: { items: Array, total: number, page: number }
   */
  router.get(
    "/history",
    resolveUser,
    checkPremiumAccess("playlistOptimizer"),
    async (req, res) => {
      try {
        const uid = guardPg(req, res);
        if (!uid) return;

        const limit = Math.min(
          Math.max(parseInt(req.query.limit) || 20, 1),
          100,
        );
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const search = (req.query.search || "").trim();
        const offset = (page - 1) * limit;

        let countSql =
          "SELECT COUNT(*) AS total FROM playlist_audits WHERE uid = $1";
        const countParams = [uid];
        if (search) {
          countSql +=
            " AND (name ILIKE $2 OR channel_title ILIKE $2)";
          countParams.push(`%${search}%`);
        }
        const countResult = await query(countSql, countParams);
        const total = parseInt(countResult.rows[0].total, 10);

        let dataSql = `SELECT id, name, created_at, channel_id, channel_title, audits, errors
                       FROM playlist_audits
                       WHERE uid = $1`;
        const dataParams = [uid];

        if (search) {
          dataSql += " AND (name ILIKE $2 OR channel_title ILIKE $2)";
          dataParams.push(`%${search}%`);
        }

        dataSql +=
          " ORDER BY created_at DESC LIMIT $" +
          (dataParams.length + 1) +
          " OFFSET $" +
          (dataParams.length + 2);
        dataParams.push(limit, offset);

        const dataResult = await query(dataSql, dataParams);

        const items = dataResult.rows.map((row) => {
          const normalized = normalizeStoredAudits(row.audits);
          const totalVideos = Array.isArray(normalized.playlists)
            ? normalized.playlists.reduce(
                (sum, p) => sum + (p.videos?.length || 0),
                0,
              )
            : 0;
          return {
            id: row.id,
            name: row.name || "Untitled Analysis",
            createdAt: row.created_at
              ? row.created_at.toISOString()
              : null,
            channelId: row.channel_id || null,
            channelTitle: row.channel_title || null,
            totalVideos,
            hasErrors: row.errors
              ? Array.isArray(row.errors) && row.errors.length > 0
              : false,
          };
        });

        return res.json({ items, total, page });
      } catch (error) {
        console.error(
          "[PlaylistOptimizer] History list failed:",
          error.message,
        );
        handleApiError(error, res);
      }
    },
  );

  /**
   * GET /history/by-video/:videoId
   *
   * Newest saved analysis whose recommendation cards contain this item
   * reference id ("id": "<ref>" anywhere inside audits JSONB). Returns
   * { id: number | null }. Powers the Optimized Content deep-link; must be
   * registered before /history/:id so "by-video" is not captured as an id.
   */
  router.get(
    "/history/by-video/:videoId",
    resolveUser,
    checkPremiumAccess("playlistOptimizer"),
    async (req, res) => {
      try {
        const uid = guardPg(req, res);
        if (!uid) return;

        const refId = String(req.params.videoId || "").trim();
        if (!refId) return res.json({ id: null });

        const out = await query(
          `SELECT p.id FROM playlist_audits p
             WHERE p.uid = $1 AND p.audits::text LIKE ('%"id": "' || $2 || '"%')
             ORDER BY p.created_at DESC LIMIT 1`,
          [uid, refId],
        );
        return res.json({ id: out.rows[0]?.id ?? null });
      } catch (error) {
        console.error(
          "[PlaylistOptimizer] History by-video failed:",
          error.message,
        );
        handleApiError(error, res);
      }
    },
  );

  /**
   * GET /history/:id
   *
   * Retrieve a single saved analysis with full results.
   */
  router.get(
    "/history/:id",
    resolveUser,
    checkPremiumAccess("playlistOptimizer"),
    async (req, res) => {
      try {
        const uid = guardPg(req, res);
        if (!uid) return;

        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
          return res
            .status(400)
            .json({ error: { message: "Invalid analysis ID." } });
        }

        const result = await query(
          `SELECT * FROM playlist_audits WHERE id = $1 AND uid = $2`,
          [id, uid],
        );

        if (result.rows.length === 0) {
          return res
            .status(404)
            .json({ error: { message: "Analysis not found." } });
        }

        const row = result.rows[0];
        return res.json({
          id: row.id,
          name: row.name,
          createdAt: row.created_at
            ? row.created_at.toISOString()
            : null,
          updatedAt: row.updated_at
            ? row.updated_at.toISOString()
            : null,
          channelId: row.channel_id || null,
          channelTitle: row.channel_title || null,
          totalVideos: row.total_videos || 0,
          audits: normalizeStoredAudits(row.audits),
          errors: row.errors || null,
        });
      } catch (error) {
        console.error(
          "[PlaylistOptimizer] History get failed:",
          error.message,
        );
        handleApiError(error, res);
      }
    },
  );

  /**
   * DELETE /history/:id
   *
   * Remove a saved analysis from PostgreSQL.
   */
  router.delete(
    "/history/:id",
    resolveUser,
    checkPremiumAccess("playlistOptimizer"),
    async (req, res) => {
      try {
        const uid = guardPg(req, res);
        if (!uid) return;

        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
          return res
            .status(400)
            .json({ error: { message: "Invalid analysis ID." } });
        }

        const result = await query(
          `DELETE FROM playlist_audits WHERE id = $1 AND uid = $2 RETURNING id`,
          [id, uid],
        );

        if (result.rows.length === 0) {
          return res
            .status(404)
            .json({ error: { message: "Analysis not found." } });
        }

        return res.json({ success: true });
      } catch (error) {
        console.error(
          "[PlaylistOptimizer] Delete failed:",
          error.message,
        );
        handleApiError(error, res);
      }
    },
  );

  return router;
}

/**
 * Normalize a stored analysis payload to the shape the frontend expects
 * (AnalysisResponse). Legacy rows saved before the membership repair can
 * hold playlists without a videos array (or playlists as an object map),
 * which crashed client-side `.map` calls (page render + deterministic
 * scoring) when the row was opened. Runs on every history read so at-rest
 * legacy data is safe without a data migration.
 */
function normalizeStoredAudits(audits) {
  const src = audits && typeof audits === "object" ? audits : {};
  // Legacy rows written before the shape fix wrapped playlists under
  // `result.results`. Unwrap so they render identically to new rows.
  const legacy =
    src.results &&
    typeof src.results === "object" &&
    !Array.isArray(src.playlists)
      ? src.results
      : null;
  const root = legacy || src;
  const rawPlaylists = Array.isArray(root.playlists)
    ? root.playlists
    : root.playlists && typeof root.playlists === "object"
      ? Object.values(root.playlists)
      : [];
  const playlists = rawPlaylists
    .filter((p) => p && typeof p === "object")
    .map((p) => ({ ...p, videos: Array.isArray(p.videos) ? p.videos : [] }));
  return {
    ...root,
    playlists,
    unassignedVideos: Array.isArray(root.unassignedVideos)
      ? root.unassignedVideos
      : [],
    audit: root.audit && typeof root.audit === "object" ? root.audit : {},
  };
}

module.exports = { createPlaylistOptimizerRouter, normalizeStoredAudits };

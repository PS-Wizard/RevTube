/**
 * Optimizer queue processor -- runs thumbnail / playlist optimizer analysis as
 * a BullMQ job so it survives the user navigating away or closing the tab.
 *
 * Expected job data:
 *   { kind: 'thumbnail' | 'playlist', payload: {...}, uid: string, email: string, orgId?: string|null }
 *
 * The worker runs the same analyze services the sync routes used, persists the
 * result to Postgres, and returns the saved id + result so the completion
 * handler can notify.
 */

const { createAuditHistoryService } = require("../services/auditHistoryService");

function createOptimizerProcessor(deps) {
  const {
    thumbnailOptimizerService,
    playlistOptimizerService,
    query,
  } = deps;
  const { savePlaylistAuditHistory } = createAuditHistoryService(deps);

  // Owner-defined Channel Focus for AI grounding. Best-effort: null when none
  // saved (services fall back to inference). Never throws.
  async function fetchFocus(channelId, orgId) {
    if (!channelId) return null;
    try {
      const svc = deps.channelFocusService;
      if (!svc?.getFocusForAI) return null;
      return await svc.getFocusForAI(String(channelId), orgId || null);
    } catch (err) {
      console.warn(`[Queue] optimizer focus lookup failed for ${channelId}: ${err?.message || err}`);
      return null;
    }
  }

  async function persistThumbnail(job, payload, results, errors) {
    const uid = job.data.uid;
    const { niche = "", targetAudience = "", brandVoice = "", channelId, channelTitle } = payload;
    const audits = results || [];
    const name = `Audit -- ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
    const { rows } = await query(
      `INSERT INTO thumbnail_audits (uid, name, channel_id, channel_title, niche, target_audience, brand_voice, total_videos, audits, errors)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        uid,
        name,
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
    return rows[0].id;
  }

  async function persistPlaylist(job, payload, result) {
    const uid = job.data.uid;
    const { channelId, channelTitle } = payload;
    // analyze() returns { results: <normalized object> } -- unwrap so the persisted
    // JSON holds `playlists` at the TOP level (the shape the frontend and
    // normalizeStoredAudits expect). Previously the wrapper was stored verbatim,
    // so rows never contained a playlists array and every count read as 0.
    const audits =
      result && result.results && Array.isArray(result.results.playlists)
        ? result.results
        : result && Array.isArray(result.playlists)
          ? result
          : {};
    const name = `Analysis -- ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
    const row = await savePlaylistAuditHistory({ uid, name, channelId, channelTitle, audits });
    return row?.id;
  }

  return async function processOptimizer(job) {
    const { kind, payload } = job.data || {};
    if (kind !== "thumbnail" && kind !== "playlist") {
      throw new Error(`Invalid optimizer job kind: ${kind}`);
    }
    console.log(`[Queue] optimizer:${kind} -> starting (job ${job.id})`);

    if (kind === "thumbnail") {
      const { urls = [], niche, targetAudience, brandVoice, channelId } = payload || {};
      // Backstop: jobs enqueued with blank context pick up the saved focus here
      // (the route already fills these before enqueue).
      const focus = (!niche && !targetAudience && !brandVoice)
        ? await fetchFocus(channelId, job.data?.orgId)
        : null;
      const result = await thumbnailOptimizerService.analyze(
        urls,
        niche || String(focus?.niche || ""),
        targetAudience || String(focus?.audience || ""),
        brandVoice || String(focus?.tone || ""),
      );
      const id = await persistThumbnail(job, payload || {}, result.results, result.errors);
      job.updateProgress(100);
      return { savedId: id, kind, result };
    }

    const { videos = [], channelIdentifier, filterConfig, channelId } = payload || {};
    const result = await playlistOptimizerService.analyze(
      videos,
      channelIdentifier,
      filterConfig,
      await fetchFocus(channelId, job.data?.orgId),
    );
    const id = await persistPlaylist(job, payload || {}, result);
    job.updateProgress(100);
    return { savedId: id, kind, result };
  };
}

module.exports = { createOptimizerProcessor };

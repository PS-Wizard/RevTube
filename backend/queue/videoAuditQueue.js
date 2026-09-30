/**
 * Video audit queue processor -- runs a batch video audit as a BullMQ job.
 *
 * Expected job data:
 *   { channelId: string, videoIds: string[], authHeader?: string }
 *
 * authHeader is optional: when absent, video input fetching falls back to the
 * YouTube API key (see fetchVideoInputs in index.js).
 */

function createVideoAuditProcessor(deps) {
  const { fetchVideoInputs, auditBatch, getAuditCriteria, db, query, isPostgresConfigured } = deps;

  // Persist each video's inline Thumbnail Optimizer child analysis into the
  // shared thumbnail_audits store so a Video Audit batch of N videos lists N
  // thumbnail audits in the Thumbnail Optimizer history -- without re-running
  // Gemini (the 12-pillar analysis was already computed while scoring). The
  // child audits are always triggered by the full-mode video audit and their
  // responses ARE the audit's thumbnail element scores. Best-effort only: a
  // persistence failure never fails the audit job itself.
  async function persistChildThumbnailAudits(job, channelId, results) {
    const { uid } = job.data || {};
    if (!uid || !query || (typeof isPostgresConfigured === "function" && !isPostgresConfigured())) return;
    const thumbAudits = [];
    for (const r of Array.isArray(results) ? results : []) {
      const t = Array.isArray(r?.elements)
        ? r.elements.find((e) => e?.element === "thumbnail")?.thumbnailAnalysis
        : null;
      if (!t) continue;
      thumbAudits.push({
        // Same watch-URL shape a real Thumbnail Optimizer run stores, so the
        // history deep-links back to /thumbnail-optimizer work identically.
        url: r.videoId ? `https://www.youtube.com/watch?v=${r.videoId}` : "",
        videoTitle: r.videoTitle || "",
        currentScore: t.currentScore,
        expectedScore: t.expectedScore,
        reviewSummary: t.reviewSummary,
        strengths: t.strengths,
        opportunities: t.opportunities,
        detailedAreas: t.detailedAreas,
      });
    }
    if (thumbAudits.length === 0) return null;
    try {
      const name = `Video Audit -- ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
      const { rows } = await query(
        `INSERT INTO thumbnail_audits (uid, name, channel_id, channel_title, niche, target_audience, brand_voice, total_videos, audits)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          uid,
          name,
          channelId || null,
          job.data.channelTitle || null,
          null,
          null,
          null,
          thumbAudits.length,
          JSON.stringify(thumbAudits),
        ],
      );
      console.log(`[Queue] video-audit:${channelId} -> persisted ${thumbAudits.length} child thumbnail audit(s)`);
      // Expose the history row id so the Video Audit deep-dive can deep-link
      // straight back into this saved entry without re-running any AI.
      return rows?.[0]?.id ?? null;
    } catch (err) {
      console.warn(`[Queue] video-audit:${channelId} -> child thumbnail persist failed:`, err.message);
      return null;
    }
  }

  return async function processVideoAudit(job) {
    const { channelId, videoIds, authHeader, includeThumbnail, orgId } = job.data || {};
    if (!channelId || !Array.isArray(videoIds) || videoIds.length === 0) {
      throw new Error("Invalid video audit job data: missing channelId or videoIds");
    }
    // Owner-defined focus niche wins over batch-derived inference (cleaner,
    // personalized scoring when a focus is saved; identical otherwise).
    let channelNiche = "";
    try {
      const focus = await deps.channelFocusService?.getFocusForAI?.(channelId, orgId || null);
      channelNiche = String(focus?.niche || "").trim();
    } catch {
      channelNiche = "";
    }

    console.log(`[Queue] video-audit:${channelId} -> starting (job ${job.id}, thumbnails ${includeThumbnail ? "on" : "off"})`);

    const inputs = await fetchVideoInputs({ channelId, videoIds, authHeader });
    // Load the admin-configurable criteria once per job (Firestore-backed,
    // 10-min backend cache); falls back to defaults on failure.
    let criteria;
    try {
      criteria = (await getAuditCriteria(db)).video;
    } catch {
      criteria = undefined;
    }
    // Thumbnail analysis (Thumbnail Optimizer 12-pillar, one Gemini vision call
    // per video) only runs when the user opted in; "lite" mode skips it and the
    // thumbnail element reports no data instead of dragging the score.
    const mode = includeThumbnail ? "full" : "lite";
    // Live progress: each completed video bumps the Bull progress bar (cap 99
    // so 100 only appears once the persist step is done).
    const result = await auditBatch(inputs, criteria, channelNiche || undefined, mode, (pct) => {
      job.updateProgress(Math.min(99, pct)).catch(() => {});
    });
    const savedThumbnailAuditId = includeThumbnail
      ? await persistChildThumbnailAudits(job, channelId, result?.results)
      : null;
    if (savedThumbnailAuditId) {
      // Deep-link handle consumed by the deep-dive "Detailed Thumbnail
      // Analysis" button on the frontend (batchResult.thumbnailAuditSavedId).
      result.thumbnailAuditSavedId = savedThumbnailAuditId;
    }
    job.updateProgress(100);
    return result;
  };
}

module.exports = { createVideoAuditProcessor };
/**
 * Public audit queue processor -- runs a full public-channel audit as a
 * BullMQ job on the `public-audit` queue.
 *
 * Expected job data:
 *   { channelInput: string, maxVideos?: number, includeAllPlaylists?: boolean,
 *     includeThumbnail?: boolean, includeCaptions?: boolean, uid?: string, email?: string }
 *
 * The pipeline itself lives in services/publicAuditRunner.js (shared with the
 * synchronous POST / route) so queued and direct runs can never drift apart.
 * The runner persists the report to `public_audits`, so the job result is the
 * same full-report object the sync endpoint returns.
 */

const { runPublicAuditReport: defaultRunner } = require("../services/publicAuditRunner");

function createPublicAuditProcessor(deps) {
  // DI seam: tests inject a fake `runPublicAuditReport`; prod uses the shared
  // runner (same pipeline as the synchronous POST / route).
  const runReport = deps.runPublicAuditReport || defaultRunner;
  return async function processPublicAudit(job) {
    const { channelInput, maxVideos, includeAllPlaylists, includeThumbnail, includeCaptions, uid, email } = job.data || {};
    if (!channelInput || typeof channelInput !== "string" || !channelInput.trim()) {
      throw new Error("Invalid public audit job data: missing channelInput");
    }
    console.log(`[Queue] public-audit:${channelInput.trim()} -> starting (job ${job.id})`);
    const result = await runReport(deps, {
      channelInput: channelInput.trim(),
      maxVideos,
      includeAllPlaylists,
      includeThumbnail,
      includeCaptions,
      createdBy: { uid, email },
      onProgress: (pct) => {
        job.updateProgress(Math.min(99, pct)).catch(() => {});
      },
    });
    job.updateProgress(100);
    return result;
  };
}

module.exports = { createPublicAuditProcessor };

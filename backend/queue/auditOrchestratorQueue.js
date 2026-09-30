/**
 * Audit orchestrator queue processor -- runs the Centralized Audit as a single
 * BullMQ job. It invokes the orchestrator service which runs the 4 sub-audits
 * (channelIdentity, video, playlist, general) in-process and persists the
 * parent audit_run + child audit_sub_runs.
 *
 * Expected job data:
 *   { channelId: string, authHeader?: string, uid?: string, email?: string,
 *     orgId?: string|null, includeThumbnailAI?: boolean,
 *     scope?: "full"|"channel" }   -- "channel" runs ONLY the channel
 *     metadata sub-audit (/channelaudit); default is the full 4-part audit.
 */

const { createAuditOrchestratorService } = require("../services/auditOrchestratorService");

/**
 * Maps pipeline phases to a monotonic 10-100 job percent. Sub-audits share
 * the 40-75 band (they run in parallel, so the peak only moves forward);
 * the input fetch fans out across 10-35 by stage.
 */
function createProgressMapper(onPercent) {
  let peak = 10;
  const inputMarks = { channel: 14, videos: 24, playlists: 28, membership: 34, done: 35 };
  const marks = {
    setup: 40,
    channelIdentity: 55,
    general: 55,
    video: 75,
    playlist: 75,
    history: 90,
    persist: 96,
    done: 100,
  };
  return (phase, fraction) => {
    let pct = null;
    if (typeof phase === "string" && phase.startsWith("input:")) {
      pct = inputMarks[phase.slice("input:".length)] ?? 30;
    } else if (phase === "video") {
      pct = 40 + 35 * (Number(fraction) || 0);
    } else {
      pct = marks[phase] ?? null;
    }
    if (pct == null) return;
    peak = Math.max(peak, Math.min(100, Math.round(pct)));
    try {
      onPercent(peak);
    } catch {
      /* progress is best-effort */
    }
  };
}

function createAuditOrchestratorProcessor(deps) {
  const { gatherAuditInput, createAuditScoringService, db, query, isPostgresConfigured, getOptimizerCriteria, videoAuditService, playlistOptimizerService } = deps;

  const orchestrator = createAuditOrchestratorService({
    gatherAuditInput,
    createAuditScoringService,
    db,
    query,
    isPostgresConfigured,
    withClient: deps.withClient,
    // Owner-defined Channel Focus grounds every sub-audit's niche/audience.
    // Absent -> keyword inference (unchanged behavior).
    channelFocusService: deps.channelFocusService || null,
    // Real Video Audit engine (LLM-scored) so the Full Audit's video sub-audit
    // produces the SAME per-video scores as the standalone /video-audit page.
    videoAuditEngine: videoAuditService,
    // Real Playlist Optimizer engine (DeepSeek LLM) for the playlist sub-audit.
    playlistOptimizerEngine: playlistOptimizerService,
    // Lightweight text-JSON LLM for the channel/general AI assessments
    // (deepSeekJson from services/videoAuditLLM, exposed on serviceDeps by
    // backend/index.js). Absent -> both sub-audits degrade to algo-only.
    llmEngine: deps.videoAuditLLM || null,
    perfLog: deps.perfLog,
    perfNow: deps.perfNow,
    getScoringProfile: require("../config/channelAuditScoringProfiles").getScoringProfile,
    getParamDefinitions: require("../config/channelAuditParameterDefinitions").getParamDefinitions,
    getOptimizerCriteria,
    getDefaultProfile: () => require("../config/channelAuditScoringProfiles").DEFAULT_PROFILE,
  });

  return async function processAuditOrchestrator(job) {
    const { channelId, authHeader, uid, orgId, includeThumbnailAI, scope, videoSelection } = job.data || {};
    if (!channelId) {
      throw new Error("Invalid orchestrator job data: missing channelId");
    }
    console.log(`[Queue] audit-orchestrator:${channelId} -> starting (job ${job.id}, scope=${scope === "channel" ? "channel" : "full"})`);
    const reportProgress = createProgressMapper((pct) => job.updateProgress(pct));
    job.updateProgress(10);

    const result = await orchestrator.runAudit({
      channelId,
      authHeader,
      opts: { includeThumbnailAI: !!includeThumbnailAI, scope: scope === "channel" ? "channel" : "full", videoSelection, onProgress: reportProgress },
      uid,
      orgId,
    });
    job.updateProgress(100);
    return { auditRunId: result.auditRunId, overall: result.overall, grade: result.grade, subRuns: result.subRuns };
  };
}

module.exports = { createAuditOrchestratorProcessor, createProgressMapper };

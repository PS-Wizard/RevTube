// ─────────────────────────────────────────────────────────────────────────────
// Centralized Audit Orchestrator page -- runs one Channel Audit that spawns 4
// sub-audits (Channel Identity, Video, Playlist, General), aggregates them into
// an overall score + grade, and shows 4 summary cards with deep links into the
// existing Video / Playlist audit tools.
// ─────────────────────────────────────────────────────────────────────────────
/* eslint-disable react-hooks/set-state-in-effect -- data-loading page that syncs UI state to external query results */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "react-hot-toast";
import {
  AlertDescription,
  Box,
  Button,
  ShadcnAlert,
  Typography,
} from "../../components/ui";
import { AlertTriangle, RefreshCw, Tv } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { useFeatureConfig } from "../../hooks/useFeatureConfig";
import { useOrganization } from "../../hooks/useOrganization";
import { useJobContext, useSessionJobId } from "../../hooks/useSessionJobId";
import { getOrganizationChannels } from "../../services/organizationChannelService";
import { AuditToolShell } from "../../components/audit/AuditToolShell";
import { AuditCriteriaHelpButton } from "../../components/AuditCriteriaHelpButton";
import { SearchableHistoryList } from "../../components/SearchableHistoryList";
import {
  useAuditOrchestrator,
  useAuditOrchestratorJobStatus,
  useAuditOrchestratorRerun,
} from "../../hooks/queries/useAuditOrchestrator";
import {
  deleteAuditOrchestratorHistory,
  getAuditOrchestratorHistory,
  renameAuditOrchestratorHistory,
  type AuditOrchestratorHistoryItem,
  type AuditOrchestratorResult,
  type AuditOrchestratorVideoSelection,
} from "../../services/auditOrchestratorService";

import type { ChannelOption, ExecutiveStats, SubRunDef } from "./auditOrchestratorTypes";
import { SUB_RUNS } from "./auditOrchestratorTypes";
import { FullAuditHelpIntro } from "./FullAuditHelpIntro";
import { AuditChannelPickerCard } from "./AuditChannelPickerCard";
import { AuditSamplingSettings } from "./AuditSamplingSettings";
import { FREE_AUDIT_VIDEO_MAX, PRO_AUDIT_VIDEO_MAX } from "./auditOrchestratorTypes";
import { AuditPipelineCard } from "./AuditPipelineCard";
import { AuditExecutiveScorecard } from "./AuditExecutiveScorecard";
import { ScoreUpliftSimulator } from "./ScoreUpliftSimulator";
import { SubRunAccordion } from "./SubRunAccordion";

import { AuditToolBody } from "../../components/audit/AuditToolBody";
import "./AuditOrchestratorPage.css";

export function AuditOrchestratorPage() {
  const navigate = useNavigate();
  const { allTokens, userPackage, role } = useAuth();
  const { getSearchLimit } = useFeatureConfig();
  const { currentOrganization, isPersonalContext, canRunAudits } = useOrganization();

  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState("");
  const [result, setResult] = useState<AuditOrchestratorResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [includeThumbnailAI, setIncludeThumbnailAI] = useState(false);
  const [videoSelectionMode, setVideoSelectionMode] = useState<"recent" | "since">("since");
  const [videoCount, setVideoCount] = useState(15);
  // Videos-per-audit cap by plan, controlled from the admin panel (Feature
  // controls → Channel Audit Videos). Falls back to code defaults when the
  // config is missing or set to unlimited (-1). Anything above the Pro cap
  // is a Contact-us lead, not a select option.
  const isPro = userPackage === "pro" || role === "admin";
  const configuredMax = getSearchLimit("auditVideos", isPro ? "pro" : "free");
  const planMaxVideoCount =
    configuredMax > 0 ? configuredMax : isPro ? PRO_AUDIT_VIDEO_MAX : FREE_AUDIT_VIDEO_MAX;
  // Clamp a stale over-plan selection (e.g. plan changed mid-session).
  useEffect(() => {
    setVideoCount((c) => Math.min(c, planMaxVideoCount));
  }, [planMaxVideoCount]);
  // Default audit sample: latest quarter (rolling 90 days), max 15 videos.
  const [videoSince, setVideoSince] = useState(() => {
    const d = new Date(Date.now() - 90 * 86400000);
    return d.toISOString().slice(0, 10);
  });
  const [pageView, setPageView] = useState<"audit" | "history">("audit");
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  const [searchParams] = useSearchParams();
  const preselectChannel = searchParams.get("channel") ?? "";

  const queryClient = useQueryClient();
  const [jobId, setJobId] = useSessionJobId(
    "audit-orchestrator",
    currentOrganization?.id,
  );
  const [, setJobCtx] = useJobContext<{ id: string; title?: string }>(
    "audit-orchestrator",
    currentOrganization?.id,
  );

  // ── Load connected channels ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const loadChannels = async () => {
      let list: ChannelOption[] = [];
      if (isPersonalContext) {
        list = allTokens
          .filter((t) => t.channelId && t.channelTitle)
          .map((t) => ({
            id: t.channelId!,
            title: t.channelTitle || "Unknown",
            thumbnailUrl: (t as any).thumbnailUrl,
            owner: { type: "user" },
          }));
      } else if (currentOrganization) {
        try {
          const [orgChannels, personalTokens] = await Promise.all([
            getOrganizationChannels(currentOrganization.id),
            Promise.resolve(
              allTokens.filter((t) => t.channelId && t.channelTitle),
            ),
          ]);
          const map = new Map<string, ChannelOption>();
          orgChannels
            .filter((c) => c.id && c.channelTitle)
            .forEach((c) =>
              map.set(c.id, {
                id: c.id,
                title: c.channelTitle || "Unknown",
                thumbnailUrl: (c as any).thumbnailUrl,
                owner: { type: "org", orgId: currentOrganization.id },
              }),
            );
          personalTokens.forEach((t) => {
            const id = t.channelId!;
            if (!map.has(id)) {
              map.set(id, {
                id,
                title: t.channelTitle || "Unknown",
                thumbnailUrl: (t as any).thumbnailUrl,
                owner: { type: "user" },
              });
            } else {
              const ex = map.get(id)!;
              (ex as any)._shared = true;
            }
          });
          list = Array.from(map.values());
        } catch {
          list = [];
        }
      }
      if (cancelled) return;
      setChannels(list);
      setSelectedChannelId((prev) => {
        if (list.some((c) => c.id === prev)) return prev;
        if (preselectChannel && list.some((c) => c.id === preselectChannel)) {
          return preselectChannel;
        }
        return list[0]?.id ?? "";
      });
    };
    loadChannels();
    return () => {
      cancelled = true;
    };
  }, [isPersonalContext, currentOrganization, allTokens, preselectChannel]);

  const mutation = useAuditOrchestrator({
    onSuccess: (data) => {
      if (data?.jobId) {
        setJobId(data.jobId);
        setError(null);
      } else {
        setError("Audit queue is not available. Please try again later.");
      }
    },
    onError: (err) => setError(err.message || "Audit failed"),
  });

  const jobStatusQuery = useAuditOrchestratorJobStatus(jobId, jobId !== null);

  useEffect(() => {
    const status = jobStatusQuery.data;
    if (!status) return;
    if (status.state === "completed" && status.result) {
      setResult(status.result);
      setError(null);
      setJobId(null);
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    } else if (status.state === "failed") {
      setError("Audit failed. Please try again.");
      setJobId(null);
    }
  }, [jobStatusQuery.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const rerunMutation = useAuditOrchestratorRerun({
    onSuccess: (data) => {
      if (data?.jobId) {
        setJobId(data.jobId);
        setResult(null);
        setError(null);
      } else {
        setError("Audit queue is not available. Please try again later.");
      }
    },
    onError: (err) => setError(err.message || "Re-run failed"),
  });

  const running =
    mutation.isPending ||
    (jobId !== null &&
      ["waiting", "active", "delayed"].includes(
        jobStatusQuery.data?.state ?? "",
      ));

  const [runningHidden, setRunningHidden] = useState(false);
  useEffect(() => {
    if (!running) setRunningHidden(false);
  }, [running]);

  const selectedChannel = useMemo(
    () => channels.find((c) => c.id === selectedChannelId) ?? null,
    [channels, selectedChannelId],
  );

  const videoSelection = useMemo<AuditOrchestratorVideoSelection>(
    () => ({
      mode: videoSelectionMode,
      count: Math.max(1, Math.min(planMaxVideoCount, Math.round(videoCount) || 1)),
      ...(videoSelectionMode === "since" && videoSince ? { since: new Date(`${videoSince}T00:00:00`).toISOString() } : {}),
    }),
    [videoSelectionMode, videoCount, videoSince, planMaxVideoCount],
  );

  const handleRun = () => {
    if (!selectedChannelId) return;
    setJobCtx({ id: selectedChannelId, title: selectedChannel?.title });
    setError(null);
    setResult(null);
    setJobId(null);
    mutation.mutate({
      channelId: selectedChannelId,
      includeThumbnailAI,
      orgId: currentOrganization?.id,
      scope: "full",
      videoSelection,
    });
  };

  const handleRerun = () => {
    if (!result) return;
    rerunMutation.mutate({
      runId: result.auditRunId,
      includeThumbnailAI,
      orgId: currentOrganization?.id,
    });
  };

  // Deep links: only video and playlist have dedicated tools.
  // video -> the specific saved Video Audit history row (?audit=),
  // playlist -> the optimizer tool with channel query param.
  const goDeep = (def: SubRunDef) => {
    if (def.key === "video") {
      const hid =
        result?.videoHistoryId ??
        (result?.subRuns.video.meta as { videoHistoryId?: unknown } | undefined)?.videoHistoryId;
      if (typeof hid === "number") {
        navigate(`/video-audit?audit=${hid}`);
        return;
      }
      navigate(
        selectedChannelId
          ? `/video-audit?channel=${encodeURIComponent(selectedChannelId)}`
          : "/video-audit",
      );
      return;
    }
    if (def.key === "playlist") {
      navigate(
        selectedChannelId
          ? `/playlist-optimizer?channel=${encodeURIComponent(selectedChannelId)}`
          : "/playlist-optimizer",
      );
      return;
    }
    // channelIdentity and general have no standalone tool; button should not appear.
  };

  const handleOpenHistoryItem = (item: AuditOrchestratorHistoryItem) => {
    navigate(`/audit-orchestrator/${item.id}`);
  };

  const handleDeleteHistoryItem = async (id: number) => {
    try {
      await deleteAuditOrchestratorHistory(id, currentOrganization?.id);
      toast.success("Audit deleted.");
      setHistoryRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete audit.",
      );
    }
  };

  const handleRenameHistoryItem = async (id: number, name: string) => {
    try {
      await renameAuditOrchestratorHistory(id, name, currentOrganization?.id);
      toast.success("Audit renamed.");
      setHistoryRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Failed to rename audit.",
      );
    }
  };

  // Compute summary stats for executive scorecard
  const executiveStats = useMemo<ExecutiveStats | null>(() => {
    if (!result) return null;
    let recCount = 0;
    let highCount = 0;
    let totalPotentialGain = 0;
    let auditedVideosCount = 0;

    for (const def of SUB_RUNS) {
      const sub = result.subRuns[def.key];
      if (sub?.recommendations) {
        recCount += sub.recommendations.length;
        for (const r of sub.recommendations) {
          if (r.severity === "high") highCount++;
          totalPotentialGain += r.impactGain || 0;
        }
      }
      if (def.key === "video") {
        const vList = (sub?.meta as Record<string, unknown> | undefined)?.videos;
        if (Array.isArray(vList)) auditedVideosCount = vList.length;
      }
    }

    const projectedMax = Math.min(100, Math.round(result.overall + totalPotentialGain));

    return {
      recCount,
      highCount,
      totalPotentialGain,
      projectedMax,
      auditedVideosCount: auditedVideosCount || videoCount,
    };
  }, [result, videoCount]);

  return (
    <AuditToolShell
      title="Channel Audit"
      description="Full channel audit: identity & branding, video SEO, playlist structure, and publishing cadence & trends — with clear scores and next steps."
      icon={<Tv size={20} />}
      actions={
        <AuditCriteriaHelpButton
          intro={<FullAuditHelpIntro />}
          tooltipTitle="What does the Full Audit check & how is it scored?"
        />
      }
      tabs={{
        items: [
          { value: "audit", label: "New Channel Audit" },
          { value: "history", label: "Audit History" },
        ],
        value: pageView,
        onChange: (value) => setPageView(value as "audit" | "history"),
      }}
      alerts={
        error ? (
          <Box sx={{ mb: 2 }}>
            <ShadcnAlert variant="destructive">
              <AlertTriangle size={16} />
              <AlertDescription>{error}</AlertDescription>
            </ShadcnAlert>
          </Box>
        ) : null
      }
    >
      <AuditToolBody>
        {pageView === "audit" ? (
          <>
            {/* ── Channel Picker & Settings Card ────────────────────────── */}
            <div className="aop-card aop-picker">
              <AuditChannelPickerCard
                channels={channels}
                selectedChannelId={selectedChannelId}
                onSelectChannel={setSelectedChannelId}
                running={running}
                organizationId={isPersonalContext ? null : currentOrganization?.id ?? null}
                organizationName={currentOrganization?.name}
              />

              <AuditSamplingSettings
                videoSelectionMode={videoSelectionMode}
                setVideoSelectionMode={setVideoSelectionMode}
                videoCount={videoCount}
                setVideoCount={setVideoCount}
                videoSince={videoSince}
                setVideoSince={setVideoSince}
                includeThumbnailAI={includeThumbnailAI}
                setIncludeThumbnailAI={setIncludeThumbnailAI}
                running={running}
                canRunAudits={canRunAudits}
                selectedChannelId={selectedChannelId}
                onRunAudit={handleRun}
                planMax={planMaxVideoCount}
                isPro={isPro}
              />
            </div>

            {/* ── Active Pipeline Loading Card ───────────────────────────── */}
            <AuditPipelineCard
              running={running}
              runningHidden={runningHidden}
              setRunningHidden={setRunningHidden}
              progress={jobStatusQuery.data?.progress ?? null}
            />

            {/* ── Audit Results ─────────────────────────────────────────── */}
            {result && (
              <Box sx={{ mb: 5 }}>
                {/* Executive Scorecard Banner */}
                <AuditExecutiveScorecard
                  result={result}
                  executiveStats={executiveStats}
                  onRerun={handleRerun}
                  rerunPending={rerunMutation.isPending}
                  canRunAudits={canRunAudits}
                />

                {/* Score Uplift Simulator Card */}
                <ScoreUpliftSimulator
                  currentScore={result.overall}
                  subRuns={result.subRuns}
                />

                <Box sx={{ mt: 5, mb: 2.5, display: "flex", alignItems: "center", gap: 1 }}>
                  <Tv size={18} style={{ color: "var(--rt-color-accent)" }} />
                  <Typography
                    sx={{
                      fontSize: "var(--rt-text-md)",
                      fontWeight: "var(--rt-weight-bold)",
                      color: "var(--rt-color-text)",
                    }}
                  >
                    Sub-Audit Breakdown
                  </Typography>
                </Box>

                {/* Render ALL four sub-audits computed by the backend */}
                {SUB_RUNS.map((def, idx) => {
                  const sub = result.subRuns[def.key];
                  return (
                    <SubRunAccordion
                      key={def.key}
                      def={def}
                      score={sub?.score}
                      meta={sub?.meta as Record<string, unknown> | undefined}
                      status={sub?.status}
                      params={sub?.params}
                      recommendations={sub?.recommendations}
                      onDeepLink={goDeep}
                      defaultExpanded={idx === 0}
                    />
                  );
                })}

                <div className="aop-actions-bar" style={{ marginTop: "var(--rt-space-6)" }}>
                  <Button
                    variant="secondary"
                    size="small"
                    startIcon={<RefreshCw size={13} />}
                    onClick={handleRerun}
                    disabled={rerunMutation.isPending || !canRunAudits}
                  >
                    Re-run Complete Channel Audit
                  </Button>
                </div>
              </Box>
            )}
          </>
        ) : (
          <SearchableHistoryList<AuditOrchestratorHistoryItem>
            fetchItems={({ page, search }: { page: number; search?: string }) =>
              getAuditOrchestratorHistory({
                page,
                search,
                orgId: currentOrganization?.id,
              })
            }
            getKey={(item: AuditOrchestratorHistoryItem) => item.id}
            renderName={(item: AuditOrchestratorHistoryItem) => item.name || `Channel Audit #${item.id}`}
            renderMeta={(item: AuditOrchestratorHistoryItem) => (
              <>
                {item.channelTitle && (
                  <Box
                    component="span"
                    sx={{
                      fontSize: "var(--rt-text-xs)",
                      color: "var(--rt-color-text-tertiary)",
                    }}
                  >
                    {item.channelTitle}
                  </Box>
                )}
                {item.overallScore != null && (
                  <Box
                    component="span"
                    sx={{
                      fontSize: "var(--rt-text-xs)",
                      color: "var(--rt-color-text-tertiary)",
                    }}
                  >
                    · {item.overallScore}/100 {item.overallGrade}
                  </Box>
                )}
                <Box
                  component="span"
                  sx={{
                    fontSize: "var(--rt-text-xs)",
                    color: "var(--rt-color-text-tertiary)",
                  }}
                >
                  · {new Date(item.createdAt).toLocaleString()}
                </Box>
              </>
            )}
            onLoad={(item: AuditOrchestratorHistoryItem) => handleOpenHistoryItem(item)}
            onDelete={(id: string | number) => handleDeleteHistoryItem(Number(id))}
            onRename={(id: string | number, name: string) => handleRenameHistoryItem(Number(id), name)}
            getName={(item: AuditOrchestratorHistoryItem) => item.name || `Channel Audit #${item.id}`}
            refreshKey={historyRefreshKey}
            readOnly={!canRunAudits}
            emptyText="Run a channel audit and it will be saved here for later reference."
            deleteTitle="Delete this saved channel audit?"
          />
        )}
      </AuditToolBody>
    </AuditToolShell>
  );
}

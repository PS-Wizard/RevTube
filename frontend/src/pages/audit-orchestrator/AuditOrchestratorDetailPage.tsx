// -----------------------------------------------------------------------------
// Centralized Audit Orchestrator -- Detail page. Loads one persisted run
// (GET /audit-orchestrator/:id) and shows the overall score plus all 4 category
// sub-runs in detail: each score, its parameters (earned/max), and the
// narrative recommendations with severity.
// -----------------------------------------------------------------------------
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  Download,
  ExternalLink,
  FileImage,
  FileSpreadsheet,
  FileText,
  ListVideo,
  TrendingUp,
  Tv,
  Video,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "react-hot-toast";
import { AuditToolShell } from "../../components/audit/AuditToolShell";
import { AuditExportMenu } from "../../components/audit/AuditExportMenu";
import { AuditToolBody } from "../../components/audit/AuditToolBody";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Spinner,
  Typography,
} from "../../components/ui";
import {
  getAuditOrchestratorReport,
  type AuditedVideoItem,
  type AuditRunRow,
  type AuditSubRunResultRow,
  type AuditSubRunScore,
  type AuditSubRunType,
} from "../../services/auditOrchestratorService";
import {
  downloadFullAuditExcel,
  downloadFullAuditPdf,
  exportFullAuditImagePdf,
} from "../../services/auditOrchestratorExport";
import "./AuditOrchestratorPage.css";
import {
  AuditExecutiveScorecard,
  AuditedVideosTable,
  CategoryDonutOverview,
  CircularScoreRing,
  GatedNote,
  groupParamsByCategory,
  paramPct,
  RecMessage,
  ScoreUpliftSimulator,
} from ".";

interface CategoryDef {
  key: AuditSubRunType;
  label: string;
  icon: LucideIcon;
  deepLink?: string;
  deepLinkLabel?: string;
}

const CATEGORIES: CategoryDef[] = [
  {
    key: "channelIdentity",
    label: "Channel Identity & Branding",
    icon: Tv,
  },
  {
    key: "video",
    label: "Video Optimization & SEO",
    icon: Video,
    deepLink: "/video-audit",
    deepLinkLabel: "Video Audit",
  },
  {
    key: "playlist",
    label: "Playlist Structure & Depth",
    icon: ListVideo,
    deepLink: "/playlist-optimizer",
    deepLinkLabel: "Playlist Optimizer",
  },
  {
    key: "general",
    label: "Cadence & Content Trends",
    icon: TrendingUp,
  },
];

function scoreColor(score: number | null): { bg: string; text: string } {
  const s = score ?? 0;
  if (s >= 80)
    return {
      bg: "var(--rt-color-success-surface)",
      text: "var(--rt-color-success)",
    };
  if (s >= 50)
    return {
      bg: "var(--rt-color-warning-surface)",
      text: "var(--rt-color-warning)",
    };
  return {
    bg: "var(--rt-color-danger-surface)",
    text: "var(--rt-color-danger)",
  };
}

// Deep-link history ids are read from JSONB where Postgres may surface a
// bigserial id as a string ("15"). Normalize to a positive number so the
// ?audit= redirect works whether the stored value is a number or numeric string.
function historyId(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

// Shared grouping (auditOrchestratorUtils.groupParamsByCategory) keeps category
// labels identical between the live report and the saved detail page.

function sevColor(sev: string | undefined): { bg: string; text: string } {
  switch (sev) {
    case "high":
      return {
        bg: "var(--rt-color-danger-surface)",
        text: "var(--rt-color-danger)",
      };
    case "medium":
      return {
        bg: "var(--rt-color-warning-surface)",
        text: "var(--rt-color-warning)",
      };
    default:
      return {
        bg: "var(--rt-color-bg-subtle)",
        text: "var(--rt-color-text-tertiary)",
      };
  }
}

function CategorySection({
  def,
  sub,
  defaultExpanded,
  channelId,
}: {
  def: CategoryDef;
  sub: AuditSubRunResultRow | undefined;
  defaultExpanded: boolean;
  channelId?: string | null;
}) {
  const score = sub?.score ?? null;
  const color = scoreColor(score);
  const Icon = def.icon;
  const params = sub?.results?.params || [];
  const recs = sub?.results?.recommendations || [];
  const failed = sub?.status === "failed";
  const videosList =
    (sub?.results?.meta?.videos as AuditedVideoItem[] | undefined) || [];
  // Only video and playlist have dedicated standalone tools.
  const hasDedicatedTool = def.key === "video" || def.key === "playlist";
  const savedVideoId = historyId(
    (sub?.results?.meta as { videoHistoryId?: unknown } | undefined)
      ?.videoHistoryId,
  );
  const savedPlaylistId = historyId(
    (sub?.results?.meta as { playlistHistoryId?: unknown } | undefined)
      ?.playlistHistoryId,
  );
  const deepUrl =
    def.key === "video"
      ? savedVideoId != null
        ? `/video-audit?audit=${savedVideoId}`
        : channelId
          ? `/video-audit?channel=${encodeURIComponent(channelId)}`
          : "/video-audit"
      : def.key === "playlist"
        ? savedPlaylistId != null
          ? `/playlist-optimizer?audit=${savedPlaylistId}`
          : `${sub?.report_url || "/playlist-optimizer"}${channelId ? `?channel=${encodeURIComponent(channelId)}` : ""}`
        : null;

  return (
    <Accordion
      defaultExpanded={defaultExpanded}
      disableGutters
      className="aop-detail-accordion"
      sx={{
        bgcolor: "var(--rt-color-bg-elevated)",
        border: "1px solid var(--rt-color-border)",
        borderRadius: "var(--rt-radius-lg)",
        mb: 2,
        "&:before": { display: "none" },
      }}
    >
      <AccordionSummary
        expandIcon={
          <ChevronDown
            size={18}
            style={{ color: "var(--rt-color-text-tertiary)" }}
          />
        }
        sx={{ px: 3, py: 1.5, minHeight: 64 }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            flex: 1,
            minWidth: 0,
          }}
        >
          <div className="aop-category-icon-box">
            <Icon size={18} />
          </div>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              sx={{
                fontSize: "var(--rt-text-sm)",
                fontWeight: "var(--rt-weight-bold)",
                color: "var(--rt-color-text)",
              }}
            >
              {def.label}
            </Typography>
            <Typography
              variant="caption"
              sx={{
                color: "var(--rt-color-text-tertiary)",
                fontSize: "var(--rt-text-2xs)",
              }}
            >
              {failed
                ? "Sub-audit failed to complete"
                : `${params.length} parameter(s) - ${recs.length} recommendation(s)`}
            </Typography>
          </Box>
          <Box
            sx={{
              fontSize: "var(--rt-text-md)",
              fontWeight: "var(--rt-weight-bold)",
              color: color.text,
              bgcolor: color.bg,
              px: 1.5,
              py: 0.4,
              borderRadius: "var(--rt-radius-pill)",
              flexShrink: 0,
            }}
          >
            {score != null ? `${Math.round(score)}` : "—"}
            <span
              style={{
                fontSize: "var(--rt-text-2xs)",
                opacity: 0.75,
                fontWeight: "normal",
              }}
            >
              /100
            </span>
          </Box>
        </Box>
      </AccordionSummary>

      <AccordionDetails
        className="aop-accordion-details"
        sx={{
          px: 3,
          pb: 3,
          pt: 1,
          borderTop: "1px solid var(--rt-color-border)",
        }}
      >
        {failed ? (
          <Alert
            severity="warning"
            sx={{ fontSize: "var(--rt-text-xs)", mb: 2 }}
          >
            This sub-audit could not be completed (for example, malformed
            analysis data). The overall score was computed from the sub-audits
            that did complete.
            {sub?.results?.meta?.error
              ? ` Error: ${String(sub.results.meta.error)}`
              : ""}
          </Alert>
        ) : null}

        {params.length > 0 && (
          <Box sx={{ mb: 3 }}>
            <Typography
              sx={{
                fontSize: "var(--rt-text-xs)",
                fontWeight: "var(--rt-weight-bold)",
                color: "var(--rt-color-text-secondary)",
                mb: 1.5,
              }}
            >
              Parameters & Individual Scoring
            </Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
              {groupParamsByCategory(params).map((group) => {
                const groupMax = group.params.reduce(
                  (s, p) =>
                    s + (typeof p.max === "number" && p.max > 0 ? p.max : 0),
                  0,
                );
                const groupEarned = group.params.reduce(
                  (s, p) => s + (typeof p.earned === "number" ? p.earned : 0),
                  0,
                );
                const groupPct =
                  groupMax > 0
                    ? Math.max(
                        0,
                        Math.min(
                          100,
                          Math.round((groupEarned / groupMax) * 100),
                        ),
                      )
                    : 0;
                const gc = scoreColor(groupPct);
                return (
                  <Box key={`${def.key}-cat-${group.category}`}>
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        mb: 1,
                        pb: 0.5,
                        borderBottom: "1px solid var(--rt-color-border)",
                      }}
                    >
                      <Typography
                        sx={{
                          fontSize: "var(--rt-text-2xs)",
                          fontWeight: "var(--rt-weight-bold)",
                          color: "var(--rt-color-text-secondary)",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                        }}
                      >
                        {group.label}
                      </Typography>
                      <Box
                        component="span"
                        sx={{
                          fontSize: "10px",
                          fontWeight: "var(--rt-weight-bold)",
                          color: gc.text,
                          bgcolor: gc.bg,
                          px: 1,
                          py: 0.2,
                          borderRadius: "var(--rt-radius-pill)",
                        }}
                      >
                        {Math.round(groupEarned)} / {Math.round(groupMax)} pts (
                        {groupPct}%)
                      </Box>
                    </Box>
                    <CategoryDonutOverview
                      params={group.params}
                      groupLabel={group.label}
                      groupEarned={groupEarned}
                      groupMax={groupMax}
                    />

                    <div className="aop-param-cards-grid">
                      {group.params.map((p) => {
                        const pct = paramPct(p);
                        const c = scoreColor(pct);
                        const statusLabel =
                          pct >= 80
                            ? "Optimized"
                            : pct >= 50
                              ? "Needs Work"
                              : "Critical Fix";
                        return (
                          <div
                            key={`${def.key}-${p.key}`}
                            className="aop-param-card"
                          >
                            <div className="aop-param-card-header">
                              <span className="aop-param-card-title">
                                {p.label}
                              </span>
                              {p.impactGain ? (
                                <span className="aop-param-impact-badge">
                                  +{p.impactGain} pts potential
                                </span>
                              ) : null}
                            </div>
                            <div className="aop-param-card-body">
                              <CircularScoreRing
                                pct={pct}
                                size={48}
                                strokeWidth={5}
                                color={c.text}
                              />
                              <div className="aop-param-card-stats">
                                <div className="aop-param-card-score-value">
                                  {typeof p.earned === "number"
                                    ? Math.round(p.earned)
                                    : "—"}
                                  <span className="aop-param-card-score-max">
                                    {typeof p.max === "number" && p.max > 0
                                      ? ` / ${Math.round(p.max)} pts`
                                      : " pts"}
                                  </span>
                                </div>
                                <span
                                  className="aop-param-status-pill"
                                  style={{
                                    color: c.text,
                                    backgroundColor: c.bg,
                                  }}
                                >
                                  {statusLabel}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Box>
                );
              })}
            </Box>
          </Box>
        )}

        {recs.length > 0 && (
          <Box sx={{ mb: videosList.length > 0 ? 3 : 0 }}>
            <Typography
              sx={{
                fontSize: "var(--rt-text-xs)",
                fontWeight: "var(--rt-weight-bold)",
                color: "var(--rt-color-text-secondary)",
                mb: 1.5,
              }}
            >
              Recommendations & Score Improvement
            </Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {recs.map((r, i) => {
                const c = sevColor(r.severity);
                return (
                  <Box
                    key={`${def.key}-rec-${i}`}
                    sx={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 1,
                      p: 1.5,
                      borderRadius: "var(--rt-radius-md)",
                      bgcolor: "var(--rt-color-bg-subtle)",
                      border: "1px solid var(--rt-color-border)",
                    }}
                  >
                    <AlertTriangle
                      size={14}
                      style={{ color: c.text, flexShrink: 0, marginTop: 2 }}
                    />
                    <Box sx={{ flex: 1 }}>
                      <Typography
                        sx={{
                          fontSize: "var(--rt-text-xs)",
                          color: "var(--rt-color-text)",
                          lineHeight: 1.45,
                        }}
                      >
                        <RecMessage message={r.message} />
                      </Typography>
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 1,
                          mt: 0.5,
                          flexWrap: "wrap",
                        }}
                      >
                        <Typography
                          variant="caption"
                          sx={{
                            color: c.text,
                            fontWeight: "var(--rt-weight-bold)",
                            fontSize: "var(--rt-text-2xs)",
                            textTransform: "capitalize",
                          }}
                        >
                          {r.severity} severity
                        </Typography>
                        {r.impactGain ? (
                          <Box
                            component="span"
                            sx={{
                              fontSize: "11px",
                              fontWeight: "var(--rt-weight-bold)",
                              color: "var(--rt-color-success)",
                              bgcolor: "var(--rt-color-success-surface)",
                              px: 1,
                              py: 0.25,
                              borderRadius: "var(--rt-radius-pill)",
                            }}
                          >
                            Fixing this gains +{r.impactGain} pts to score
                          </Box>
                        ) : null}
                      </Box>
                    </Box>
                  </Box>
                );
              })}
            </Box>
          </Box>
        )}

        <GatedNote
          gated={
            (sub?.results?.meta as Record<string, unknown> | undefined)
              ?.gatedCriteria
          }
        />

        {/* Audited Videos Table for Video Sub-Run */}
        {def.key === "video" && videosList.length > 0 && (
          <AuditedVideosTable videos={videosList} />
        )}

        {params.length === 0 && recs.length === 0 && !failed && (
          <Typography
            sx={{
              fontSize: "var(--rt-text-xs)",
              color: "var(--rt-color-text-tertiary)",
            }}
          >
            No detailed parameters or recommendations were captured for this
            sub-audit.
          </Typography>
        )}

        {hasDedicatedTool && deepUrl && (
          <Box
            sx={{ mt: 2.5, pt: 2, borderTop: "1px solid var(--rt-color-border)" }}
          >
            <Button
              component={Link}
              to={deepUrl}
              variant="text"
              size="small"
              endIcon={<ExternalLink size={13} />}
              sx={{
                textTransform: "none",
                fontSize: "var(--rt-text-xs)",
                fontWeight: "var(--rt-weight-semibold)",
                px: 0,
              }}
            >
              View full {def.deepLinkLabel || (def.key === "video" ? "Video Audit" : "Playlist Optimizer")}
            </Button>
          </Box>
        )}
      </AccordionDetails>
    </Accordion>
  );
}

export function AuditOrchestratorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [run, setRun] = useState<AuditRunRow | null>(null);
  const [subRuns, setSubRuns] = useState<AuditSubRunResultRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportMenuAnchor, setExportMenuAnchor] = useState<HTMLElement | null>(null);
  const [exporting, setExporting] = useState<'excel' | 'pdf' | 'image' | null>(null);
  // Printable report area for the image-PDF path.
  const reportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const runId = parseInt(id ?? "", 10);
        if (isNaN(runId)) throw new Error("Invalid audit run ID.");
        const data = await getAuditOrchestratorReport(runId);
        if (cancelled) return;
        setRun(data.run);
        setSubRuns(data.subRuns || []);
      } catch (err: unknown) {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : "Failed to load audit report.",
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const overall = run?.overall_score ?? null;

  const subRunsMap = useMemo(() => {
    const map: Record<string, AuditSubRunScore> = {};
    for (const s of subRuns) {
      map[s.type] = {
        score: s.score || 0,
        status: s.status,
        params: s.results?.params || [],
        recommendations: s.results?.recommendations || [],
        meta: s.results?.meta,
      };
    }
    return map;
  }, [subRuns]);

  const executiveStats = useMemo(() => {
    if (overall == null) return null;
    let recCount = 0;
    let highCount = 0;
    let totalPotentialGain = 0;
    let auditedVideosCount = 0;

    for (const def of CATEGORIES) {
      const sub = subRunsMap[def.key];
      if (sub?.recommendations) {
        recCount += sub.recommendations.length;
        for (const r of sub.recommendations) {
          if (r.severity === "high") highCount++;
          totalPotentialGain += r.impactGain || 0;
        }
      }
      if (def.key === "video") {
        const vList = (sub?.meta as Record<string, unknown> | undefined)
          ?.videos;
        if (Array.isArray(vList)) auditedVideosCount = vList.length;
      }
    }

    const projectedMax = Math.min(
      100,
      Math.round(overall + totalPotentialGain),
    );

    return {
      recCount,
      highCount,
      totalPotentialGain,
      projectedMax,
      auditedVideosCount,
    };
  }, [overall, subRunsMap]);

  return (
    <AuditToolShell
      title={
        run ? run.channel_title || `Channel Audit #${run.id}` : "Channel Audit"
      }
      icon={<Tv size={20} />}
      description={
        (run?.created_at
          ? `Audited ${new Date(run.created_at).toLocaleString()}`
          : "") + (run?.include_thumbnail_ai ? " - Thumbnail AI included" : "")
      }
      actions={
        run && !loading && !error ? (
          <>
            <Button
              variant="secondary"
              size="small"
              onClick={(e) => setExportMenuAnchor(e.currentTarget)}
              disabled={exporting !== null}
              startIcon={exporting !== null ? <Spinner size={12} /> : <Download size={14} />}
              aria-haspopup="menu"
            >
              {exporting === 'excel'
                ? 'Exporting Excel…'
                : exporting === 'pdf'
                  ? 'Exporting PDF…'
                  : exporting === 'image'
                    ? 'Exporting image…'
                    : 'Export Report'}
            </Button>
            <AuditExportMenu
              anchorEl={exportMenuAnchor}
              onClose={() => setExportMenuAnchor(null)}
              items={[
                {
                  key: 'excel',
                  label: 'Excel workbook (full details)',
                  icon: <FileSpreadsheet size={14} />,
                  iconClassName: 'text-[var(--rt-color-success)]',
                  onSelect: () => void (async () => {
                    if (!run || exporting) return;
                    setExporting('excel');
                    try {
                      await downloadFullAuditExcel(run, subRuns);
                      toast.success('Full Excel report downloaded successfully.');
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : 'Excel export failed.');
                    } finally {
                      setExporting(null);
                    }
                  })(),
                },
                {
                  key: 'pdf-text',
                  label: 'PDF — selectable text',
                  hint: 'Copyable text, smaller file',
                  icon: <FileText size={14} />,
                  iconClassName: 'text-[var(--rt-color-accent)]',
                  onSelect: () => {
                    if (!run || exporting) return;
                    setExporting('pdf');
                    try {
                      downloadFullAuditPdf(run, subRuns);
                      toast.success('Full PDF report downloaded successfully.');
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : 'PDF export failed.');
                    } finally {
                      setExporting(null);
                    }
                  },
                },
                {
                  key: 'pdf-image',
                  label: 'PDF — image (as shown)',
                  hint: 'Exact pixels incl. emojis, not copyable',
                  icon: <FileImage size={14} />,
                  iconClassName: 'text-[var(--rt-color-text-tertiary)]',
                  onSelect: () => void (async () => {
                    if (!run || exporting) return;
                    const el = reportRef.current;
                    if (!el) {
                      toast.error('Report area is not ready yet.');
                      return;
                    }
                    setExporting('image');
                    try {
                      await exportFullAuditImagePdf(el, run);
                      toast.success('Image PDF downloaded successfully.');
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : 'Image PDF export failed.');
                    } finally {
                      setExporting(null);
                    }
                  })(),
                },
              ]}
            />
          </>
        ) : undefined
      }
    >
      <AuditToolBody>
        <Button
          variant="ghost"
          size="small"
          bare
          startIcon={<ArrowLeft size={15} />}
          onClick={() => navigate("/audit-orchestrator")}
        >
          Back to Channel Audit Studio
        </Button>

        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
            <Spinner size={28} />
          </Box>
        ) : error ? (
          <Alert severity="error" sx={{ fontSize: "var(--rt-text-sm)" }}>
            {error}
          </Alert>
        ) : (
          <div ref={reportRef} className="min-w-0">
            {/* Executive Scorecard */}
            <AuditExecutiveScorecard
              overall={overall}
              grade={run?.overall_grade}
              title="Executive Channel Audit Report"
              description="Comprehensive 4-pillar channel audit evaluating Channel Identity, Video SEO, Playlist Structure, and Cadence & Trends."
              executiveStats={executiveStats}
              lastAuditedAt={run?.created_at}
            />

            {/* Score Uplift Simulator */}
            {overall != null && (
              <ScoreUpliftSimulator
                currentScore={overall}
                subRuns={subRunsMap}
              />
            )}

            <Box sx={{ mb: 2, display: "flex", alignItems: "center", gap: 1 }}>
              <Tv size={16} style={{ color: "var(--rt-color-accent)" }} />
              <Typography
                sx={{
                  fontSize: "var(--rt-text-sm)",
                  fontWeight: "var(--rt-weight-bold)",
                  color: "var(--rt-color-text)",
                }}
              >
                Channel Breakdown & Categories
              </Typography>
            </Box>

            {CATEGORIES.map((def, idx) => (
              <CategorySection
                key={def.key}
                def={def}
                sub={subRuns.find((s) => s.type === def.key)}
                defaultExpanded={idx === 0 || def.key === "video"}
                channelId={run?.channel_id}
              />
            ))}
          </div>
        )}
      </AuditToolBody>
    </AuditToolShell>
  );
}

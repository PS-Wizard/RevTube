// ─────────────────────────────────────────────────────────────────────────────
// Playlist Optimizer -- Main page component
// ─────────────────────────────────────────────────────────────────────────────
import {
  Box,
  Button,
  Spinner,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Modal,
  TextField,
  Tooltip,
} from "../../components/ui";
import {
  AlertTriangle,
  BarChart3,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileArchive,
  FileJson,
  FileSpreadsheet,
  FileText,
  HelpCircle,
  History,
  Layers,
  Lightbulb,
  Play,
  Scan,
  Settings2,
  Wand2,
  ListVideo,
  BookOpen,
  Tag,
  Table2,
  Target,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchOptimizerCriteria, DEFAULT_OPTIMIZER_CRITERIA, type OptimizerCriteriaCfg } from "../../services/optimizerCriteriaService";
import { useSessionJobId } from "../../hooks/useSessionJobId";
import { useAuth } from "../../hooks/useAuth";
import { useOrganization } from "../../hooks/useOrganization";
import {
  downloadCSV,
  downloadJSON,
  downloadMasterZip,
  downloadPDF,
  downloadSingleCSV,
  downloadSingleExcel,
  downloadSinglePDF,
  downloadYaml,
} from "../../services/playlistOptimizerExport";
import { PlaylistOptimizerService } from "../../services/playlistOptimizerService";
import { YouTubeService } from "../../services/youtubeService";
import type {
  AnalysisResult,
  AnalyzeRequest,
  DataRange,
  FilterConfig,
  PlaylistRecommendation,
  SavedAnalysis,
  Video,
} from "../../types/playlistOptimizer";
import type { VideoMetadata } from "../../types/youtube";
import { deltaPct, deltaTone, formatDelta } from "../../utils/format";
import { computeVideoInsights } from "../../utils/playlistDecay";
import { scoreAllPlaylists } from "../../utils/playlistScoring";
import type { PlaylistScore } from "../../utils/playlistScoring";
import { ChannelPlaylistPicker } from "./ChannelPlaylistPicker";
import { PlaylistAnalysisDetails } from "./PlaylistAnalysisDetails";
import { PlaylistHistoryPanel } from "./PlaylistHistoryPanel";
import { PlaylistScorePanel } from "./PlaylistScorePanel";
import { PlaylistVideoTable } from "./PlaylistVideoTable";
import { ShadcnAlert, AlertDescription, AlertAction } from "../../components/ui";
import { AuditToolShell } from "../../components/audit/AuditToolShell";
import { AuditLoadingState } from "../../components/audit/AuditLoadingState";
import { AuditToolBody } from "../../components/audit/AuditToolBody";
import "./PlaylistOptimizerPage.css";
import { ChannelVideoPicker } from "../thumbnail-optimizer/ChannelVideoPicker";
import { useOptimizedFlags } from "../../hooks/useOptimizedFlags";
import { OptimizedToggle } from "../../components/audit/OptimizedToggle";
import { EmptyState } from "../../components/EmptyState";

// ── Result views ──────────────────────────────────────────────────────────
// The combined Action Plan view shows the optimized metadata (description,
// keywords, tags) plus the actionable video table.
type ResultViewMode = "audit" | "simple";

// ── Clipboard helpers (YouTube-supported copy formats) ────────────────────
async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Tags in YouTube's paste format: comma-separated text. */
function youtubeTags(tags: string[]): string {
  return (tags || [])
    .map((t) => t.trim())
    .filter(Boolean)
    .join(", ");
}

// ── Recommendations (heuristic gap analysis) ──────────────────────────────
interface OptimizerSuggestion {
  title: string;
  detail: string;
  impact: string;
  tone: "improve" | "warn";
}

function buildSuggestions(
  filterConfig: Partial<FilterConfig>,
  result: AnalysisResult,
  videoCount: number,
  playlistCount: number,
): OptimizerSuggestion[] {
  const out: OptimizerSuggestion[] = [];
  const n = videoCount || 0;
  const score = result.audit?.channelScore ?? 0;

  if (filterConfig.maxPlaylists === 1 && n >= 30) {
    out.push({
      title: "Too few playlists for your video count",
      detail: `Max Playlists is 1 but you are analyzing ${n} videos. A single playlist cannot capture that much content, so grouping gets forced and the strategy score drops.`,
      impact:
        "Raising Max Playlists to 3 to 5 typically adds +5 to +10 points.",
      tone: "warn",
    });
  }

  if (
    filterConfig.enableTargetPlaylist &&
    !filterConfig.targetCriteria?.trim()
  ) {
    out.push({
      title: "Target strategy is missing a criteria",
      detail:
        "Target Playlist is on but Criteria is empty. Without a grouping rule the AI guesses, which lowers precision.",
      impact: `Filling in Criteria can push the ${score}/100 strategy score higher.`,
      tone: "improve",
    });
  }

  if (filterConfig.excludeKeywords?.trim()) {
    out.push({
      title: "Excluded keywords are in play",
      detail: `You excluded "${filterConfig.excludeKeywords}". If most of your ${n} videos match those keywords, very few are dropped and you lose nothing; if many are dropped, the analysis covers only a fragment of the channel.`,
      impact:
        "Re-check the exclusion list against your videos before rerunning.",
      tone: "improve",
    });
  }

  if (filterConfig.onlyOptimized && result.unassignedVideos?.length) {
    out.push({
      title: "Videos left out by Only Optimized",
      detail: `${result.unassignedVideos.length} video(s) fit no existing playlist and were hidden because Only Optimized is on.`,
      impact:
        "Turning it off surfaces New Opportunity playlists and can raise the score.",
      tone: "improve",
    });
  }

  if (
    filterConfig.minVideosPerPlaylist &&
    filterConfig.minVideosPerPlaylist > 10 &&
    n > 0
  ) {
    out.push({
      title: "High minimum videos per playlist",
      detail: `Min Videos/Playlist is ${filterConfig.minVideosPerPlaylist} for ${n} videos. That forces a few giant playlists instead of tight themed groups.`,
      impact:
        "Lowering it to 3 to 5 videos per playlist usually improves grouping.",
      tone: "warn",
    });
  }

  if (
    filterConfig.analysisMode === "EXISTING" &&
    playlistCount === 1 &&
    n >= 15
  ) {
    out.push({
      title: "Optimizing a single playlist",
      detail: `You are optimizing only 1 playlist containing ${n} videos. The rest of the channel is invisible to the audit.`,
      impact:
        "Adding more playlists to the selection gives a truer channel score.",
      tone: "improve",
    });
  }

  return out;
}

function RecommendationsSection({
  suggestions,
}: {
  suggestions: OptimizerSuggestion[];
}) {
  if (!suggestions.length) return null;
  return (
    <div className="pl-recommendations">
      <div className="pl-recommendations-header">
        <Lightbulb size={16} /> Recommendations
      </div>
      {suggestions.map((s, i) => (
        <div
          key={i}
          className={`pl-recommendation pl-recommendation--${s.tone}`}
        >
          <div className="pl-recommendation-title">
            {s.tone === "warn" ? (
              <AlertTriangle size={14} />
            ) : (
              <Lightbulb size={14} />
            )}
            {s.title}
          </div>
          <div className="pl-recommendation-detail">{s.detail}</div>
          {s.impact && (
            <div className="pl-recommendation-impact">{s.impact}</div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Copy button (YouTube-supported copy format) ───────────────────────────
function CopyButton({
  field,
  copiedField,
  onCopy,
  text,
  title,
  compact = false,
}: {
  field: string;
  copiedField: string | null;
  onCopy: (field: string, text: string) => void;
  text: string;
  title: string;
  compact?: boolean;
}) {
  const isCopied = copiedField === field;
  return (
    <Button bare
      className={`pl-copy-btn${compact ? " pl-copy-btn--compact" : ""}${
        isCopied ? " pl-copy-btn--copied" : ""
      }`}
      onClick={(e) => {
        e.stopPropagation();
        onCopy(field, text);
      }}
      title={isCopied ? "Copied!" : title}
      aria-label={title}
    >
      {isCopied ? <Check size={14} /> : <Copy size={14} />}
      {!compact && (isCopied ? "Copied" : "Copy")}
    </Button>
  );
}

// ── Field badges (Optional / Needed) for Advanced Settings ────────────────
function FieldBadge({ required = false }: { required?: boolean }) {
  return (
    <span
      className={`pl-field-badge${required ? " pl-field-badge--needed" : ""}`}
    >
      {required ? "Needed" : "Optional"}
    </span>
  );
}

// ── Score helpers ─────────────────────────────────────────────────────────
function getScoreColor(score: number): string {
  if (score >= 70) return "var(--rt-color-success)";
  if (score >= 40) return "var(--rt-color-warning)";
  return "var(--rt-color-danger)";
}

function ReachBadge({ reach }: { reach: string }) {
  const colors: Record<string, string> = {
    High: "var(--rt-color-success)",
    Medium: "var(--rt-color-warning)",
    Low: "var(--rt-color-danger)",
    Niche: "var(--rt-color-info)",
  };
  return (
    <span
      className="pl-reach-badge"
      style={{
        backgroundColor: colors[reach] || "var(--rt-color-text-tertiary)",
      }}
    >
      <span className="pl-reach-label">Reach</span>
      {reach}
    </span>
  );
}

// ── Per-playlist download menu (like Thumbnail Optimizer's accordion menu) ──
function PlaylistDownloadMenu({
  result,
  playlist,
  allVideos,
  viewMode,
  score,
}: {
  result: AnalysisResult;
  playlist: PlaylistRecommendation;
  allVideos: Video[];
  viewMode: ResultViewMode;
  /** Deterministic score shown on the card, so exports carry the same number. */
  score?: number;
}) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const closeMenu = () => setAnchorEl(null);
  // Exports read playlist.viralityScore; substitute it with the score the user
  // actually sees so every file matches the card (bulk exports do the same).
  const exportPlaylist =
    score !== undefined ? { ...playlist, viralityScore: score } : playlist;

  return (
    <>
      <IconButton
        size="small"
        onClick={(e) => {
          e.stopPropagation();
          setAnchorEl(e.currentTarget);
        }}
        aria-label={`Download ${playlist.title}`}
        title="Download this playlist"
        sx={{ color: "var(--rt-color-text-tertiary)", p: 0.5 }}
      >
        <Download size={15} />
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={closeMenu}
        onClick={closeMenu}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: {
            sx: {
              mt: 0.5,
              boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
              border: "1px solid var(--rt-color-border)",
            },
          },
        }}
      >
        <MenuItem
          onClick={() =>
            downloadSinglePDF(result, exportPlaylist, viewMode, allVideos)
          }
          sx={{ fontSize: "var(--rt-text-xs)", py: 0.75 }}
        >
          <ListItemIcon sx={{ minWidth: 28 }}>
            <FileText size={15} />
          </ListItemIcon>
          <ListItemText>PDF</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => downloadSingleExcel(exportPlaylist, allVideos)}
          sx={{ fontSize: "var(--rt-text-xs)", py: 0.75 }}
        >
          <ListItemIcon sx={{ minWidth: 28 }}>
            <FileSpreadsheet size={15} />
          </ListItemIcon>
          <ListItemText>Excel</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() =>
            downloadSingleCSV(result, exportPlaylist, viewMode, allVideos)
          }
          sx={{ fontSize: "var(--rt-text-xs)", py: 0.75 }}
        >
          <ListItemIcon sx={{ minWidth: 28 }}>
            <Table2 size={15} />
          </ListItemIcon>
          <ListItemText>CSV</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Page Component
// ═══════════════════════════════════════════════════════════════════════════
export function PlaylistOptimizerPage({
  adminMode = false,
}: { adminMode?: boolean } = {}) {
  // ── Auth & Org ─────────────────────────────────────────────────────────
  const { user, accessToken } = useAuth();
  const { currentOrganization, canRunAudits } = useOrganization();

  // Default "Optimized" list for playlist-audited playlists + video-audited videos
  const { optimizedIds, toggle: toggleOptimized } = useOptimizedFlags("playlist");
  const { optimizedIds: optimizedVideoFlagIds } = useOptimizedFlags("video");

  // ── State ───────────────────────────────────────────────────────────────
  const [videos, setVideos] = useState<Video[]>([]);
  const [selectedPlaylists, setSelectedPlaylists] = useState<
    { playlistId: string; title: string; videoCount: number }[]
  >([]);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasRun, setHasRun] = useState(false);
  const [expandedPlaylist, setExpandedPlaylist] = useState<string | null>(null);

  // Single-channel restriction: once the first video is added, lock to its channel
  const [lockedChannelId, setLockedChannelId] = useState<string | null>(null);
  const [lockedChannelTitle, setLockedChannelTitle] = useState<string | null>(
    null,
  );
  const [resolvingChannel, setResolvingChannel] = useState(false);

  // Bumped to tell ChannelVideoPicker to clear its locally held chips when the
  // parent clears its video list (avoids stale selections being re-added).
  const [pickerReset, setPickerReset] = useState(0);

  // Refs mirror the lock so concurrent async batch resolutions always read the
  // latest value instead of a stale closure (prevents two channels being locked)
  const lockedChannelIdRef = useRef<string | null>(null);
  const lockedChannelTitleRef = useRef<string | null>(null);
  useEffect(() => {
    lockedChannelIdRef.current = lockedChannelId;
  }, [lockedChannelId]);
  useEffect(() => {
    lockedChannelTitleRef.current = lockedChannelTitle;
  }, [lockedChannelTitle]);

  // Derive channelIdentifier from the primary reference channel (first video's
  // channel) as best-effort analysis context. Informational only, not enforced.
  const channelIdentifier = lockedChannelTitle || lockedChannelId || "";

  // Filter config
  const [analysisMode, setAnalysisMode] = useState<"NEW" | "EXISTING">("NEW");
  const [excludeKeywords, setExcludeKeywords] = useState("");
  const [maxPlaylists, setMaxPlaylists] = useState(0);
  const [minPlaylists, setMinPlaylists] = useState(0);
  const [minVideosPerPlaylist, setMinVideosPerPlaylist] = useState(0);
  // Performance data range used when rating videos (defaults to all-time)
  const [dataRange, setDataRange] = useState<DataRange>("all");

  // Target playlist
  const [enableTarget, setEnableTarget] = useState(false);
  const [targetName, setTargetName] = useState("");
  const [targetTopic, setTargetTopic] = useState("");
  const [targetCriteria, setTargetCriteria] = useState("");
  const [targetGoal, setTargetGoal] = useState("");
  const [targetAudience, setTargetAudience] = useState("");

  // Additional limit / output filters (all honored by the backend prompt)
  // Time-decay weighting is opt-in: when OFF the AI treats every video equally
  // (no recency/performance weighting, videos passed in original order).
  const [useTimeDecay, setUseTimeDecay] = useState(false);
  const [onlyOptimized, setOnlyOptimized] = useState(false);
  const [maxVideosPerPlaylist, setMaxVideosPerPlaylist] = useState(0);
  const [maxPlaylistsPerVideo, setMaxPlaylistsPerVideo] = useState(1);
  const [targetIncludeThemes, setTargetIncludeThemes] = useState("");
  const [targetExcludeThemes, setTargetExcludeThemes] = useState("");

  const [showSettings, setShowSettings] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [guideDialogOpen, setGuideDialogOpen] = useState(false);
  // Centralized scoring criteria shown in the guide so displayed points always
  // match the config admins control.
  const [guideCfg, setGuideCfg] = useState<OptimizerCriteriaCfg | null>(null);

  useEffect(() => {
    if (!guideDialogOpen) return;
    let cancelled = false;
    fetchOptimizerCriteria()
      .then((cfg) => {
        if (!cancelled) setGuideCfg(cfg);
      })
      .catch(() => {
        if (!cancelled) setGuideCfg(DEFAULT_OPTIMIZER_CRITERIA);
      });
    return () => {
      cancelled = true;
    };
  }, [guideDialogOpen]);

  // Page view: 'new' | 'saved'
  const [pageView, setPageView] = useState<"new" | "saved">("new");

  // Loading saved
  const [loadingSaved, setLoadingSaved] = useState<number | null>(null);

  // Job id persisted in sessionStorage so a running analysis survives page
  // navigation / tab close; the Layout-level watcher keeps polling meanwhile.
  const [jobId, setJobId] = useSessionJobId("playlist-optimizer", currentOrganization?.id);
  const [isRunning, setIsRunning] = useState(false);

  // Resume polling when returning to the page with an in-flight sessionStorage job.
  useEffect(() => {
    if (jobId) setIsRunning(true);
  }, [jobId]);

  // Poll the background job while it is active. Completion clears the jobId;
  // the worker already persisted the result to history.
  useEffect(() => {
    if (!jobId || !isRunning) return;
    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const applyResult = (status: {
      state: string;
      result?: { savedId?: number; kind?: string; result?: { results: AnalysisResult } };
    }) => {
      if (cancelled) return;
      if (status.state === "completed" && status.result?.result) {
        setResult(status.result.result.results);
        setHasRun(true);
        setIsRunning(false);
        setJobId(null);
      } else if (status.state === "failed") {
        setIsRunning(false);
        setJobId(null);
        setHasRun(false);
        setError("Playlist analysis job failed. Please try again.");
      }
    };

    const poll = async () => {
      try {
        applyResult(await PlaylistOptimizerService.getJobStatus(jobId));
      } catch (err) {
        if (!cancelled) {
          setIsRunning(false);
          setJobId(null);
          setError(err instanceof Error ? err.message : "Failed to check analysis status.");
        }
      }
    };

    pollTimer = setInterval(poll, 4000);
    void poll();
    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, isRunning]);

  // ── Remove video from list ──────────────────────────────────────────────
  const removeVideo = (id: string) => {
    setVideos((prev) => prev.filter((v) => v.id !== id));
  };

  // ── Handle channel-picked URLs ──────────────────────────────────────────
  // In NEW mode, accept videos from ANY channel: the user's connected channels
  // (via browse) or any other channel (via manual URL paste). Each video's
  // owning channel is resolved and titles are enriched for display/analysis.
  // Nothing is locked or dropped, so a mixed-channel set is fully supported.
  const handleChannelUrls = useCallback(
    async (urls: string[]) => {
      if (!urls.length) return;

      const videoIds = urls
        .map((url) => extractYoutubeId(url))
        .filter((id): id is string => id !== null);

      if (videoIds.length === 0) return;

      setResolvingChannel(true);
      setError(null);

      try {
        const ytService = new YouTubeService(
          user?.email || "",
          accessToken,
          currentOrganization?.id || null,
        );

        // Resolve the owning channel of every video in the batch (backend-cached,
        // no per-video quota). Individual failures map to null so one bad video
        // doesn't reject the whole batch.
        const resolved = await Promise.all(
          videoIds.map((id) =>
            ytService.getChannelIdFromVideo(id).then(
              (r) => ({
                id,
                channelId: r.channelId,
                channelTitle: r.channelTitle,
              }),
              () => ({ id, channelId: null, channelTitle: null }),
            ),
          ),
        );

        // Best-effort metadata enrichment (real titles, views, publish dates).
        // Falls back to URL-only titles if the batch fetch fails.
        const detailsById = new Map<string, VideoMetadata>();
        try {
          const details = await ytService.fetchVideosByIds(videoIds);
          for (const d of details) detailsById.set(d.videoId, d);
        } catch {
          /* enrichment is best-effort; ignore failures */
        }

        // Remember the first video's channel as the primary reference channel
        // for analysis context. Informational only; never used to drop or lock.
        // Skipped in admin mode so a mixed-channel set is fully supported.
        const primary = resolved.find((v) => v.channelId);
        if (!adminMode && primary && !lockedChannelIdRef.current) {
          lockedChannelIdRef.current = primary.channelId;
          lockedChannelTitleRef.current = primary.channelTitle || null;
          setLockedChannelId(primary.channelId);
          setLockedChannelTitle(primary.channelTitle || null);
        }

        setVideos((prev) => {
          const existing = new Set(prev.map((v) => v.id));
          const newVideos: Video[] = [];
          for (const v of resolved) {
            if (existing.has(v.id)) continue;
            const detail = detailsById.get(v.id);
            const channelTitle =
              v.channelTitle || detail?.channelTitle || undefined;
            newVideos.push({
              id: v.id,
              videoId: v.id,
              title: detail?.title || `https://youtube.com/watch?v=${v.id}`,
              description: detail?.description ?? undefined,
              url: `https://youtube.com/watch?v=${v.id}`,
              views: detail?.viewCount,
              publishDate: detail?.publishedAt,
              channelId: v.channelId || undefined,
              channelTitle,
              // Surface each video's owning channel in the analysis prompt so
              // the model can reason about mixed-channel sets.
              customMetadata: { channelTitle: channelTitle || "" },
            });
          }
          return [...prev, ...newVideos];
        });
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to resolve video channel. Please try again.",
        );
      } finally {
        setResolvingChannel(false);
      }
    },
    [user?.email, accessToken, currentOrganization?.id, adminMode],
  );

  // ── Handle playlists picked from channel ────────────────────────────────
  const handlePlaylistsConfirm = useCallback((playlistVideos: Video[]) => {
    if (playlistVideos.length === 0) {
      setVideos([]);
      setSelectedPlaylists([]);
      return;
    }
    // Group videos by originalPlaylistId to extract playlist info
    const seen = new Set<string>();
    const playlists: {
      playlistId: string;
      title: string;
      videoCount: number;
    }[] = [];
    for (const v of playlistVideos) {
      if (v.originalPlaylistId && !seen.has(v.originalPlaylistId)) {
        seen.add(v.originalPlaylistId);
        const rawTitle = v.customMetadata?.originalPlaylistTitle;
        const title =
          typeof rawTitle === "string" && rawTitle.trim()
            ? rawTitle
            : v.originalPlaylistId;
        const count = playlistVideos.filter(
          (x) => x.originalPlaylistId === v.originalPlaylistId,
        ).length;
        playlists.push({
          playlistId: v.originalPlaylistId,
          title,
          videoCount: count,
        });
      }
    }
    setSelectedPlaylists(playlists);
    setVideos(playlistVideos);
  }, []);

  // ── Clear videos when mode changes ─────────────────────────────────────
  const handleModeChange = (mode: "NEW" | "EXISTING") => {
    setAnalysisMode(mode);
    setVideos([]);
    setSelectedPlaylists([]);
    setResult(null);
    setHasRun(false);
    setError(null);
    // Reset channel lock when switching modes
    lockedChannelIdRef.current = null;
    lockedChannelTitleRef.current = null;
    setLockedChannelId(null);
    setLockedChannelTitle(null);
    setPickerReset((n) => n + 1);
  };

  // ── Run analysis ────────────────────────────────────────────────────────
  const runAnalysis = () => {
    setError(null);
    setResult(null);
    setHasRun(false);

    const filterConfig: Partial<FilterConfig> = {
      analysisMode,
      channelIdentifier,
      excludeKeywords,
      maxPlaylists,
      minPlaylists,
      minVideosPerPlaylist,
      dataRange,
      useTimeDecay,
      enableTargetPlaylist: enableTarget,
      targetName: enableTarget ? targetName : "",
      targetTopic: enableTarget ? targetTopic : "",
      targetCriteria: enableTarget ? targetCriteria : "",
      targetGoal: enableTarget ? targetGoal : "",
      targetAudience: enableTarget ? targetAudience : "",
      onlyOptimized,
      maxVideosPerPlaylist,
      maxPlaylistsPerVideo,
      targetIncludeThemes,
      targetExcludeThemes,
    };

    const params: AnalyzeRequest = {
      channelIdentifier: channelIdentifier || undefined,
      videos,
      filterConfig,
    };

    const paramsWithChannel: AnalyzeRequest & { channelId?: string; channelTitle?: string } = {
      ...params,
      channelId: lockedChannelId || undefined,
      channelTitle: lockedChannelTitle || undefined,
    };

    PlaylistOptimizerService.enqueueJob(paramsWithChannel, currentOrganization?.id)
      .then(({ jobId: newJobId }) => {
        setJobId(newJobId);
        setIsRunning(true);
      })
      .catch((err: Error) => {
        setError(err.message || "Failed to start playlist analysis.");
        setHasRun(false);
      });
  };

  // ── Heuristic recommendations (item 10): current settings vs. what would
  // score better, surfaced only once a result exists. ──────────────────────
  const suggestions = useMemo(() => {
    if (!result) return [];
    const videoCount = videos.length || result.audit?.totalVideosAnalyzed || 0;
    const playlistCount =
      selectedPlaylists.length || result.playlists?.length || 0;
    return buildSuggestions(
      {
        analysisMode,
        excludeKeywords,
        maxPlaylists,
        minPlaylists,
        minVideosPerPlaylist,
        dataRange,
        onlyOptimized,
        enableTargetPlaylist: enableTarget,
        targetCriteria,
      },
      result,
      videoCount,
      playlistCount,
    );
  }, [
    result,
    videos.length,
    selectedPlaylists.length,
    analysisMode,
    excludeKeywords,
    maxPlaylists,
    minPlaylists,
    minVideosPerPlaylist,
    dataRange,
    onlyOptimized,
    enableTarget,
    targetCriteria,
  ]);

  // ── Included videos & data (time-decay table) ───────────────────────────
  // Prefer the insights the backend echoed (works for saved/history analyses
  // too); fall back to computing them from the input list for older results.
  const videoRows = useMemo(() => {
    if (result?.videoInsights?.length) return result.videoInsights;
    return computeVideoInsights(videos, useTimeDecay);
  }, [result, videos, useTimeDecay]);

  // Deterministic per-playlist quality scores (why this score + how to raise
  // it), with the default-settings 80+ floor for the top playlist.
  const playlistScores = useMemo(() => {
    if (!result?.playlists?.length) return null;
    return scoreAllPlaylists(result.playlists, videoRows, {
      useTimeDecay,
      dataRange,
      excludeKeywords,
      minVideosPerPlaylist,
      maxVideosPerPlaylist,
      maxPlaylistsPerVideo,
      onlyOptimized,
      enableTargetPlaylist: enableTarget,
    });
  }, [
    result,
    videoRows,
    useTimeDecay,
    dataRange,
    excludeKeywords,
    minVideosPerPlaylist,
    maxVideosPerPlaylist,
    maxPlaylistsPerVideo,
    onlyOptimized,
    enableTarget,
  ]);

  // Bulk exports read playlist.viralityScore, so hand them a copy where that
  // field carries the deterministic score the cards show (JSON/YAML/CSV/PDF/ZIP).
  const scoredResultForExport = useMemo(() => {
    if (!result || !playlistScores) return result;
    return {
      ...result,
      playlists: result.playlists.map((p) => {
        const s = playlistScores.get(p.id);
        return s ? { ...p, viralityScore: s.score } : p;
      }),
    };
  }, [result, playlistScores]);

  // ── Load saved analysis ─────────────────────────────────────────────────

  const handleLoadAnalysis = async (id: number): Promise<boolean> => {
    setLoadingSaved(id);
    setError(null);
    try {
      const saved: SavedAnalysis =
        await PlaylistOptimizerService.getHistory(id);
      setResult(saved.audits);
      setHasRun(true);
      setPageView("new");
      return true;
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to load saved analysis.",
      );
      return false;
    } finally {
      setLoadingSaved(null);
    }
  };

  // ── Deep-link handoff from Optimized Content ────────────────────────────
  // ?audit=<analysisId>&scroll=<playlistId> opens that saved analysis via
  // handleLoadAnalysis (no AI re-run), then expands and smooth-scrolls to
  // the matching recommendation card.
  const [searchParams, setSearchParams] = useSearchParams();
  const scrollToRef = useRef<string | null>(null);
  useEffect(() => {
    const auditParam = searchParams.get("audit");
    if (!auditParam) return;
    const auditId = Number(auditParam);
    if (!Number.isFinite(auditId) || auditId <= 0) return;
    scrollToRef.current = searchParams.get("scroll");
    // A still-running earlier session would keep its loading card above the
    // loaded results and could overwrite them when it completes; stop it like
    // the failed-job path does.
    if (isRunning || jobId) {
      setIsRunning(false);
      setJobId(null);
    }
    // A cold page load can fire this before the Firebase token is ready (or
    // while the audit worker is still finishing the history write), making the
    // first fetch fail -- retry once after a short backoff so the user does
    // not have to re-open the link twice.
    void (async () => {
      const ok = await handleLoadAnalysis(auditId);
      if (!ok) {
        setTimeout(() => void handleLoadAnalysis(auditId), 1500);
      }
    })();
    searchParams.delete("audit");
    searchParams.delete("scroll");
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const target = scrollToRef.current;
    if (!target || !result || isRunning) return;
    scrollToRef.current = null;
    setExpandedPlaylist(target);
    const timer = setTimeout(() => {
      document
        .getElementById(`pl-rec-${target}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 400);
    return () => clearTimeout(timer);
  }, [result, isRunning]);

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <AuditToolShell
      title="Playlist Optimizer"
      description="AI-powered YouTube playlist strategy, SEO optimization, and content audit"
      icon={<ListVideo size={20} />}
      actions={
        <>
          {/* Guide */}
          <Tooltip
            title="How Playlist Optimizer works and makes recommendations"
            arrow
            placement="top"
          >
            <IconButton
              size="small"
              onClick={() => setGuideDialogOpen(true)}
              aria-label="Playlist Optimizer guide"
              sx={{ color: "var(--rt-color-text-secondary)" }}
            >
              <HelpCircle size={20} />
            </IconButton>
          </Tooltip>
          {result && (
            <div className="pl-export-menu-wrapper">
              <Button
                variant="secondary"
                size="small"
                startIcon={<Download size={15} />}
                onClick={() => setShowExportMenu(!showExportMenu)}
              >
                Export
              </Button>
              {showExportMenu && (
                <div className="pl-export-dropdown">
                  <Button bare
                    onClick={() => {
                      downloadJSON(scoredResultForExport ?? result);
                      setShowExportMenu(false);
                    }}
                  >
                    <FileJson size={14} /> JSON
                  </Button>
                  <Button bare
                    onClick={() => {
                      downloadYaml(scoredResultForExport ?? result);
                      setShowExportMenu(false);
                    }}
                  >
                    <FileText size={14} /> YAML
                  </Button>
                  <Button bare
                    onClick={() => {
                      downloadCSV(scoredResultForExport ?? result, "simple", videos);
                      setShowExportMenu(false);
                    }}
                  >
                    <FileSpreadsheet size={14} /> CSV
                  </Button>
                  <Button bare
                    onClick={() => {
                      downloadPDF(scoredResultForExport ?? result, "simple", videos);
                      setShowExportMenu(false);
                    }}
                  >
                    <FileText size={14} /> PDF
                  </Button>
                  <Button bare
                    onClick={() => {
                      downloadMasterZip(scoredResultForExport ?? result, videos);
                      setShowExportMenu(false);
                    }}
                  >
                    <FileArchive size={14} /> ZIP (All)
                  </Button>
                </div>
              )}
            </div>
          )}
        </>
      }
      tabs={{
        items: [
          { value: 'new', label: 'New Analysis' },
          { value: 'saved', label: 'Saved Analyses' },
        ],
        value: pageView,
        onChange: (value) => setPageView(value as 'new' | 'saved'),
      }}
      alerts={
        error ? (
          <Box sx={{ mb: 2 }}>
            <ShadcnAlert variant="destructive">
            <AlertTriangle size={16} />
            <AlertDescription>{error}</AlertDescription>
            <AlertAction>
              <Button bare onClick={() => setError(null)} aria-label="Dismiss error">
                <X size={14} />
              </Button>
            </AlertAction>
            </ShadcnAlert>
          </Box>
        ) : null
      }
    >
      <AuditToolBody>

        {/* ── New Analysis ─────────────────────────────────── */}
        {pageView === "new" && (
          <>
            {/* Input & settings (always visible) */}
            <section className="pl-input-section">
              {/* Mode + Settings Toggle */}
              <div className="pl-input-actions">
                <div className="pl-mode-toggle">
                  <Button bare
                    className={`pl-mode-btn ${analysisMode === "NEW" ? "active" : ""}`}
                    onClick={() => handleModeChange("NEW")}
                  >
                    <Zap size={14} /> New Playlist(s) Strategy
                  </Button>
                  <Button bare
                    className={`pl-mode-btn ${analysisMode === "EXISTING" ? "active" : ""}`}
                    onClick={() => handleModeChange("EXISTING")}
                  >
                    <Wand2 size={14} /> Optimize Existing Playlist(s)
                  </Button>
                </div>
              </div>

              {/* Conditional picker based on mode */}
              {analysisMode === "NEW" ? (
                <Box sx={{ mb: 2 }}>
                  <ChannelVideoPicker
                    onUrlsChange={handleChannelUrls}
                    isLoading={isRunning || resolvingChannel}
                    resetSignal={pickerReset}
                    enforceSingleChannel={!adminMode}
                    lockedChannelId={adminMode ? null : lockedChannelId}
                    lockedChannelTitle={adminMode ? null : lockedChannelTitle}
                    allowAnyChannel={adminMode}
                    optimizedVideoIds={optimizedVideoFlagIds}
                  />
                </Box>
              ) : (
                <Box sx={{ mb: 2 }}>
                  <ChannelPlaylistPicker
                    onPlaylistsConfirm={handlePlaylistsConfirm}
                    isLoading={isRunning}
                    selectedPlaylistCount={selectedPlaylists.length}
                    videoCount={videos.length}
                    allowAnyChannel={adminMode}
                    optimizedPlaylistIds={optimizedIds}
                  />
                </Box>
              )}

              {/* Video List (NEW mode) */}
              {videos.length > 0 && analysisMode === "NEW" && (
                <div className="pl-video-list">
                  <div className="pl-video-list-header">
                    <span>
                      {videos.length} video{videos.length !== 1 ? "s" : ""}{" "}
                      added
                    </span>
                    <Button variant="ghost" bare
                      onClick={() => {
                        setVideos([]);
                        setSelectedPlaylists([]);
                        // Fresh start: clear the single-channel lock and picker chips
                        lockedChannelIdRef.current = null;
                        lockedChannelTitleRef.current = null;
                        setLockedChannelId(null);
                        setLockedChannelTitle(null);
                        setPickerReset((n) => n + 1);
                      }}
                     
                    >
                      Clear all
                    </Button>
                  </div>
                  <div className="pl-video-tags">
                    {videos.map((v) => (
                      <span key={v.id} className="pl-video-tag">
                        {v.videoId || v.title.slice(0, 30)}
                        <Button bare onClick={() => removeVideo(v.id)}>
                          <X size={12} />
                        </Button>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Playlist grouping display for EXISTING mode */}
              {videos.length > 0 && analysisMode === "EXISTING" && (
                <div className="pl-video-list">
                  <div className="pl-video-list-header">
                    <span>
                      {videos.length} video{videos.length !== 1 ? "s" : ""}{" "}
                      across {selectedPlaylists.length} playlist
                      {selectedPlaylists.length !== 1 ? "s" : ""}
                    </span>
                    <Button variant="ghost" bare
                      onClick={() => {
                        setVideos([]);
                        setSelectedPlaylists([]);
                        // Fresh start: clear any selected playlists
                        lockedChannelIdRef.current = null;
                        lockedChannelTitleRef.current = null;
                        setLockedChannelId(null);
                        setLockedChannelTitle(null);
                        setPickerReset((n) => n + 1);
                      }}
                     
                    >
                      Clear all
                    </Button>
                  </div>
                  <div className="pl-playlist-group-list">
                    {selectedPlaylists.map((pl) => {
                      const plVideos = videos.filter(
                        (v) => v.originalPlaylistId === pl.playlistId,
                      );
                      const meta = plVideos[0]?.customMetadata as
                        | {
                            originalPlaylistViews7?: number;
                            originalPlaylistViews7Prev?: number;
                            originalPlaylistViews30?: number;
                            originalPlaylistViews30Prev?: number;
                            originalPlaylistViews90?: number;
                            originalPlaylistViews90Prev?: number;
                          }
                        | undefined;
                      const periodWindows = [
                        {
                          label: "7d",
                          current: meta?.originalPlaylistViews7,
                          previous: meta?.originalPlaylistViews7Prev,
                        },
                        {
                          label: "30d",
                          current: meta?.originalPlaylistViews30,
                          previous: meta?.originalPlaylistViews30Prev,
                        },
                        {
                          label: "90d",
                          current: meta?.originalPlaylistViews90,
                          previous: meta?.originalPlaylistViews90Prev,
                        },
                      ];
                      const hasPerf = periodWindows.some(
                        (w) =>
                          w.current !== undefined || w.previous !== undefined,
                      );
                      return (
                        <div key={pl.playlistId} className="pl-playlist-group">
                          <div className="pl-playlist-group-header">
                            <Play size={14} />
                            <span className="pl-playlist-group-title">
                              Playlist: {pl.title}
                            </span>
                            <span className="pl-playlist-group-count">
                              {plVideos.length} video
                              {plVideos.length !== 1 ? "s" : ""}
                            </span>
                            {hasPerf && (
                              <span className="pl-playlist-group-perf">
                                {periodWindows.map((w) => {
                                  const pct = deltaPct(w.current, w.previous);
                                  const tone = deltaTone(pct);
                                  const color =
                                    tone === "up"
                                      ? "var(--rt-color-success)"
                                      : tone === "down"
                                        ? "var(--rt-color-danger)"
                                        : "var(--rt-color-text-tertiary)";
                                  return (
                                    <span
                                      key={w.label}
                                      style={{
                                        color,
                                        fontWeight:
                                          tone === "up" || tone === "down"
                                            ? 600
                                            : 400,
                                      }}
                                    >
                                      {w.label} {formatDelta(pct)}
                                    </span>
                                  );
                                })}
                              </span>
                            )}
                          </div>
                          <div className="pl-video-tags">
                            {plVideos.map((v) => (
                              <span key={v.id} className="pl-video-tag">
                                {v.videoId || v.title.slice(0, 30)}
                                <Button bare onClick={() => removeVideo(v.id)}>
                                  <X size={12} />
                                </Button>
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Advanced Settings -- Thumbnail Optimizer pattern: always-visible
                  bordered wrapper with section header (icon + title) and the
                  "Show/Hide Advanced Settings" toggle on the right; the settings
                  panel collapses inside the same wrapper, at the bottom of the form */}
              <div className="pl-settings-section">
                <div className="pl-settings-section-header">
                  <div className="pl-settings-section-title">
                    <Settings2 size={16} className="pl-settings-section-icon" />
                    Advanced Settings{" "}
                    <span className="pl-settings-section-optional">
                      (Optional but Recommended)
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    bare
                    onClick={() => setShowSettings(!showSettings)}
                  >
                    <Settings2 size={14} /> {showSettings ? "Hide" : "Show"}{" "}
                    Advanced Settings
                  </Button>
                </div>
                {showSettings && (
                  <div className="pl-settings-panel">
                  <Box
                    sx={{
                      fontSize: "var(--rt-text-xs)",
                      color: "var(--rt-color-text-secondary)",
                      mb: 2.5,
                      lineHeight: 1.5,
                    }}
                  >
                    Fine-tune how the AI builds, rates, and groups playlists.
                    Defaults work well for most channels.
                  </Box>
                  <div className="pl-settings-grid">
                    <div className="pl-field">
                      <div className="pl-field-head">
                        <span className="pl-field-name">Exclude Keywords</span>
                        <FieldBadge />
                      </div>
                      <TextField
                        placeholder="keyword1, keyword2"
                        value={excludeKeywords}
                        onChange={(e) => setExcludeKeywords(e.target.value)}
                        size="small"
                        variant="outlined"
                        fullWidth
                      />
                      <div className="pl-field-hint">
                        Skip videos whose title or description contains any
                        keyword.
                      </div>
                    </div>

                    <div className="pl-field">
                      <div className="pl-field-head">
                        <span className="pl-field-name">Data Range</span>
                        <FieldBadge />
                      </div>
                      <select
                        id="pl-data-range"
                        value={dataRange}
                        onChange={(e) =>
                          setDataRange(e.target.value as DataRange)
                        }
                      >
                        <option value="all">All time</option>
                        <option value="7d">Last 7 days</option>
                        <option value="30d">Last 30 days</option>
                        <option value="90d">Last 90 days</option>
                      </select>
                      <div className="pl-field-hint">
                        Count only performance from this window when rating
                        (default all time).
                      </div>
                    </div>

                    <div className="pl-field">
                      <label className="pl-settings-row pl-only-optimized">
                        <input
                          type="checkbox"
                          checked={useTimeDecay}
                          onChange={(e) => setUseTimeDecay(e.target.checked)}
                        />
                        Include based on time decay
                      </label>
                      <div className="pl-field-hint">
                        Weight newer and better-performing videos highest when
                        the AI rates and groups them (off by default).
                      </div>
                    </div>

                    {analysisMode === "EXISTING" && (
                      <div className="pl-field">
                        <label className="pl-settings-row pl-only-optimized">
                          <input
                            type="checkbox"
                            checked={onlyOptimized}
                            onChange={(e) => setOnlyOptimized(e.target.checked)}
                          />
                          Only Optimized Recommendations
                        </label>
                        <div className="pl-field-hint">
                          Rewrite only existing playlists; hide New Opportunity
                          suggestions.
                        </div>
                      </div>
                    )}

                    <div className="pl-field">
                      <div className="pl-field-head">
                        <span className="pl-field-name">Max Playlists</span>
                        <FieldBadge />
                      </div>
                      <TextField
                        type="number"
                        placeholder="0 = unlimited"
                        value={maxPlaylists}
                        onChange={(e) =>
                          setMaxPlaylists(parseInt(e.target.value) || 0)
                        }
                        size="small"
                        variant="outlined"
                        fullWidth
                      />
                      <div className="pl-field-hint">
                        Cap the total playlists created. Leave 0 for no cap.
                      </div>
                    </div>

                    <div className="pl-field">
                      <div className="pl-field-head">
                        <span className="pl-field-name">Min Playlists</span>
                        <FieldBadge />
                      </div>
                      <TextField
                        type="number"
                        placeholder="0"
                        value={minPlaylists}
                        onChange={(e) =>
                          setMinPlaylists(parseInt(e.target.value) || 0)
                        }
                        size="small"
                        variant="outlined"
                        fullWidth
                      />
                      <div className="pl-field-hint">
                        Force at least this many playlists to be created.
                      </div>
                    </div>

                    <div className="pl-field">
                      <div className="pl-field-head">
                        <span className="pl-field-name">
                          Min Videos/Playlist
                        </span>
                        <FieldBadge />
                      </div>
                      <TextField
                        type="number"
                        placeholder="0"
                        value={minVideosPerPlaylist}
                        onChange={(e) =>
                          setMinVideosPerPlaylist(parseInt(e.target.value) || 0)
                        }
                        size="small"
                        variant="outlined"
                        fullWidth
                      />
                      <div className="pl-field-hint">
                        Each playlist must contain at least this many videos.
                      </div>
                    </div>

                    <div className="pl-field">
                      <div className="pl-field-head">
                        <span className="pl-field-name">
                          Max Videos/Playlist
                        </span>
                        <FieldBadge />
                      </div>
                      <TextField
                        type="number"
                        placeholder="0 = unlimited"
                        value={maxVideosPerPlaylist}
                        onChange={(e) =>
                          setMaxVideosPerPlaylist(parseInt(e.target.value) || 0)
                        }
                        size="small"
                        variant="outlined"
                        fullWidth
                      />
                      <div className="pl-field-hint">
                        Limit videos per playlist. Leave 0 for no cap.
                      </div>
                    </div>

                    <div className="pl-field">
                      <div className="pl-field-head">
                        <span className="pl-field-name">
                          Max Playlists per Video
                        </span>
                        <FieldBadge />
                      </div>
                      <select
                        id="pl-max-playlists-per-video"
                        value={String(maxPlaylistsPerVideo)}
                        onChange={(e) =>
                          setMaxPlaylistsPerVideo(Number(e.target.value))
                        }
                      >
                        {[1, 2, 3].map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                      <div className="pl-field-hint">
                        How many playlists a single video may appear in.
                      </div>
                    </div>
                  </div>

                  {/* Target Playlist (always visible alongside settings) */}
                  <div className="pl-target-section">
                    <label className="pl-target-toggle">
                      <input
                        type="checkbox"
                        checked={enableTarget}
                        onChange={(e) => setEnableTarget(e.target.checked)}
                      />
                      <Target size={14} /> Enable Target Playlist Strategy
                    </label>
                    <div
                      className={`pl-target-fields${
                        enableTarget ? "" : " pl-target-fields--disabled"
                      }`}
                    >
                      <div className="pl-field">
                        <div className="pl-field-head">
                          <span className="pl-field-name">Target Name</span>
                          <FieldBadge />
                        </div>
                        <TextField
                          placeholder="e.g. Productivity Hacks"
                          value={targetName}
                          onChange={(e) => setTargetName(e.target.value)}
                          size="small"
                          variant="outlined"
                          fullWidth
                        />
                        <div className="pl-field-hint">
                          A short label for the strategy that guides the AI's
                          focus.
                        </div>
                      </div>
                      <div className="pl-field">
                        <div className="pl-field-head">
                          <span className="pl-field-name">Topic</span>
                          <FieldBadge />
                        </div>
                        <TextField
                          placeholder="e.g. productivity tips"
                          value={targetTopic}
                          onChange={(e) => setTargetTopic(e.target.value)}
                          size="small"
                          variant="outlined"
                          fullWidth
                        />
                        <div className="pl-field-hint">
                          Subject area to cover. Leave empty to use all your
                          videos.
                        </div>
                      </div>
                      <div className="pl-field">
                        <div className="pl-field-head">
                          <span className="pl-field-name">Criteria</span>
                          <span className="pl-field-required">*</span>
                        </div>
                        <TextField
                          placeholder='e.g. "beginners only"'
                          value={targetCriteria}
                          onChange={(e) => setTargetCriteria(e.target.value)}
                          size="small"
                          variant="outlined"
                          fullWidth
                        />
                        <div className="pl-field-hint">
                          Your rule for what belongs in each playlist. The main
                          driver of grouping.
                        </div>
                      </div>
                      <div className="pl-field">
                        <div className="pl-field-head">
                          <span className="pl-field-name">Goal</span>
                          <FieldBadge />
                        </div>
                        <TextField
                          placeholder="e.g. grow watch time"
                          value={targetGoal}
                          onChange={(e) => setTargetGoal(e.target.value)}
                          size="small"
                          variant="outlined"
                          fullWidth
                        />
                        <div className="pl-field-hint">
                          What the strategy should achieve, e.g. rank for a
                          keyword.
                        </div>
                      </div>
                      <div className="pl-field">
                        <div className="pl-field-head">
                          <span className="pl-field-name">Target Audience</span>
                          <FieldBadge />
                        </div>
                        <TextField
                          placeholder="e.g. college students"
                          value={targetAudience}
                          onChange={(e) => setTargetAudience(e.target.value)}
                          size="small"
                          variant="outlined"
                          fullWidth
                        />
                        <div className="pl-field-hint">
                          Who the playlists are for, e.g. small business owners.
                        </div>
                      </div>
                      <div className="pl-field">
                        <div className="pl-field-head">
                          <span className="pl-field-name">
                            Themes to Include
                          </span>
                          <FieldBadge />
                        </div>
                        <TextField
                          placeholder="tutorial, deep dive"
                          value={targetIncludeThemes}
                          onChange={(e) =>
                            setTargetIncludeThemes(e.target.value)
                          }
                          size="small"
                          variant="outlined"
                          fullWidth
                        />
                        <div className="pl-field-hint">
                          Words/themes that should appear in this strategy.
                        </div>
                      </div>
                      <div className="pl-field">
                        <div className="pl-field-head">
                          <span className="pl-field-name">
                            Themes to Exclude
                          </span>
                          <FieldBadge />
                        </div>
                        <TextField
                          placeholder="basics, intro"
                          value={targetExcludeThemes}
                          onChange={(e) =>
                            setTargetExcludeThemes(e.target.value)
                          }
                          size="small"
                          variant="outlined"
                          fullWidth
                        />
                        <div className="pl-field-hint">
                          Words/themes to keep out of the playlists.
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              </div>

              {/* Analyze Button */}
              <Button
                variant="contained"
                size="large"
                fullWidth
                onClick={runAnalysis}
                disabled={
                  isRunning ||
                  !canRunAudits ||
                  (videos.length === 0 && !channelIdentifier)
                }
                startIcon={
                  isRunning ? (
                    <Spinner size={16} color="inherit" />
                  ) : (
                    <Zap size={18} />
                  )
                }
                sx={{ mt: 2, py: 1.2 }}
              >
                {isRunning
                  ? analysisMode === "EXISTING"
                    ? `Analyzing ${selectedPlaylists.length} Playlist${
                        selectedPlaylists.length !== 1 ? "s" : ""
                      } for Optimization...`
                    : `Analyzing ${videos.length} Video${
                        videos.length !== 1 ? "s" : ""
                      } for New Playlist...`
                  : analysisMode === "EXISTING"
                    ? `Analyze ${selectedPlaylists.length} Playlist${
                        selectedPlaylists.length !== 1 ? "s" : ""
                      } for Optimization`
                    : `Analyze ${videos.length} Video${
                        videos.length !== 1 ? "s" : ""
                      } for New Playlist`}
              </Button>
            </section>
          </>
        )}

        {/* ── Saved Analyses View ──────────────────────────── */}
        {pageView === "saved" && (
          <section className="pl-input-section">
            <div
              className="pl-form-label"
              style={{ marginBottom: 8, fontWeight: 600, fontSize: "0.9rem" }}
            >
              Saved Analysis History
            </div>
            <div
              className="pl-form-hint"
              style={{
                marginBottom: 16,
                fontSize: "0.8rem",
                color: "var(--text-secondary, #6b7280)",
              }}
            >
              Browse, load, and manage your past playlist analyses.
            </div>
            <PlaylistHistoryPanel
              onLoadAnalysis={handleLoadAnalysis}
              loadingId={loadingSaved}
            />
          </section>
        )}

        {/* ── Results Section ───────────────────────────────── */}
        {hasRun && result && pageView === "new" && (
          <section className="pl-results-section">
            {/* Included videos & data + analysis scope (what data was used) */}
            <PlaylistVideoTable insights={videoRows} />
            <PlaylistAnalysisDetails
              meta={result.analysisMeta}
              channelName={result.channelName}
            />

            {/* Audit Overview */}
            <h2 className="pl-section-heading">Channel Audit</h2>
            <div className="pl-audit-overview">
              {/* Score Cards Row */}
              <div className="pl-score-cards-row">
                <div className="pl-score-card">
                  <span className="pl-score-card-label">Strategy Score</span>
                  <div
                    className="pl-score-card-number"
                    style={{
                      color: getScoreColor(result.audit.channelScore),
                    }}
                  >
                    {result.audit.channelScore}
                    <span className="pl-score-denom">/100</span>
                  </div>
                  <div className="pl-score-card-bar">
                    <div
                      className="pl-score-card-fill"
                      style={{
                        width: `${Math.min(result.audit.channelScore, 100)}%`,
                        background: getScoreColor(result.audit.channelScore),
                      }}
                    />
                  </div>
                </div>
                <div className="pl-score-card">
                  <span className="pl-score-card-label">Metadata Health</span>
                  <div
                    className="pl-score-card-number"
                    style={{
                      color: getScoreColor(result.audit.contentHealthScore),
                    }}
                  >
                    {result.audit.contentHealthScore}
                    <span className="pl-score-denom">/100</span>
                  </div>
                  <div className="pl-score-card-bar">
                    <div
                      className="pl-score-card-fill"
                      style={{
                        width: `${Math.min(result.audit.contentHealthScore, 100)}%`,
                        background: getScoreColor(
                          result.audit.contentHealthScore,
                        ),
                      }}
                    />
                  </div>
                </div>
                <div className="pl-score-card pl-score-card-wide">
                  <span className="pl-score-card-label">
                    Niche &amp; Audience
                  </span>
                  <div className="pl-score-card-niche">
                    {result.audit.primaryNiche}
                  </div>
                  <div className="pl-score-card-persona">
                    {result.audit.audiencePersona}
                  </div>
                  {result.channelName && (
                    <div className="pl-score-card-meta">
                      Channel: {result.channelName}
                    </div>
                  )}
                  <div className="pl-score-card-meta">
                    Videos Analyzed: {result.audit.totalVideosAnalyzed}
                  </div>
                </div>
              </div>

              <div className="pl-summary">
                <h3>Summary</h3>
                <p>{result.summary}</p>
              </div>

              {/* SWOT Grid */}
              <div className="pl-swo-grid">
                {result.audit.contentStrengths?.length > 0 && (
                  <div className="pl-swo pl-strengths">
                    <h4>✓ Strengths</h4>
                    <ul>
                      {result.audit.contentStrengths.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {result.audit.contentWeaknesses?.length > 0 && (
                  <div className="pl-swo pl-weaknesses">
                    <h4>✗ Weaknesses</h4>
                    <ul>
                      {result.audit.contentWeaknesses.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {result.audit.missedOpportunities?.length > 0 && (
                  <div className="pl-swo pl-opportunities">
                    <h4>○ Opportunities</h4>
                    <ul>
                      {result.audit.missedOpportunities.map((o, i) => (
                        <li key={i}>{o}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Admin-defined scoring criteria breakdown */}
              {result.audit.criteriaBreakdown &&
                result.audit.criteriaBreakdown.length > 0 && (
                <div className="pl-existing-playlists">
                  <h4>Scoring Criteria Breakdown</h4>
                  <div className="pl-existing-table-wrap">
                    <table className="pl-existing-table">
                      <thead>
                        <tr>
                          <th>Criterion</th>
                          <th>Score</th>
                          <th>Note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.audit.criteriaBreakdown.map((c, i) => (
                          <tr key={c.criterion || i}>
                            <td>
                              <strong>{c.criterion}</strong>
                            </td>
                            <td style={{ color: getScoreColor(c.score) }}>
                              {c.score}/100
                            </td>
                            <td>{c.note}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Existing Playlists Inventory */}
              {result.audit.existingPlaylists &&
                result.audit.existingPlaylists.length > 0 && (
                  <div className="pl-existing-playlists">
                    <h4>Existing Playlists Inventory</h4>
                    <div className="pl-existing-table-wrap">
                      <table className="pl-existing-table">
                        <thead>
                          <tr>
                            <th>Playlist</th>
                            <th>Videos</th>
                            <th>Views</th>
                            <th>Score</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.audit.existingPlaylists.map((ep, i) => (
                            <tr key={ep.playlistId || i}>
                              <td>
                                <strong>{ep.title}</strong>
                                {ep.url && (
                                  <a
                                    href={ep.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="pl-external-link"
                                  >
                                    ↗
                                  </a>
                                )}
                              </td>
                              <td>{ep.videoCount ?? ep.videos?.length ?? 0}</td>
                              <td>{ep.views || "-"}</td>
                              <td>{ep.engagementScore ?? "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

              {result.audit.metadataAnalysis &&
                result.audit.metadataAnalysis.length > 20 &&
                !result.audit.metadataAnalysis
                  .toLowerCase()
                  .includes("incomplete") && (
                  <div className="pl-meta-analysis">
                    <h4>Metadata Analysis</h4>
                    <p>{result.audit.metadataAnalysis}</p>
                  </div>
                )}
            </div>

            {/* Recommendations (heuristic gap analysis) */}
            <RecommendationsSection suggestions={suggestions} />

            {/* Playlist cards + unassigned videos (Action Plan) */}
            <h2 className="pl-section-heading">Action Plan</h2>
            <div className="pl-playlists">
              {result.playlists.map((playlist) => (
                <PlaylistCard
                  key={playlist.id}
                  playlist={playlist}
                  score={playlistScores?.get(playlist.id)}
                  viewMode="simple"
                  isExpanded={expandedPlaylist === playlist.id}
                  onToggle={() =>
                    setExpandedPlaylist(
                      expandedPlaylist === playlist.id ? null : playlist.id,
                    )
                  }
                  result={result}
                  allVideos={videos}
                  adminMode={adminMode}
                  optimized={optimizedIds.has(playlist.id)}
                  onToggleOptimized={() =>
                    toggleOptimized(playlist.id, playlist.title)
                  }
                />
              ))}
            </div>

            {/* Unassigned Videos */}
            {result.unassignedVideos && result.unassignedVideos.length > 0 && (
              <div className="pl-unassigned">
                <h3>Unassigned Videos ({result.unassignedVideos.length})</h3>
                <div className="pl-unassigned-list">
                  {result.unassignedVideos.map((uv) => (
                    <div key={uv.id} className="pl-unassigned-item">
                      <span>{uv.title}</span>
                      <span className="pl-unassigned-reason">{uv.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── Empty State ──────────────────────────────────── */}
        {!hasRun && !isRunning && pageView === "new" && (
          <EmptyState
            icon={<BarChart3 size={36} />}
            title="Ready to Optimize Your Playlists"
            description="Add videos or a channel identifier above, then run the analysis to get AI-powered playlist recommendations."
          />
        )}

        {/* ── Loading State ─────────────────────────────────── */}
        {isRunning && (
          <AuditLoadingState
            title={
              analysisMode === "EXISTING"
                ? `Analyzing ${selectedPlaylists.length} playlist${
                    selectedPlaylists.length !== 1 ? "s" : ""
                  } for optimization...`
                : `Analyzing ${videos.length} video${
                    videos.length !== 1 ? "s" : ""
                  } for new playlist...`
            }
            subtitle="AI-powered playlist strategy analysis in progress"
          />
        )}

      {/* ── Guide Dialog ─────────────────────────────────────── */}
      <Modal
        open={guideDialogOpen}
        onClose={() => setGuideDialogOpen(false)}
        title="How Playlist Optimizer Works"
        icon={<HelpCircle size={18} style={{ color: "var(--rt-color-accent)" }} />}
        secondaryAction={{ label: "Close Guide", onClick: () => setGuideDialogOpen(false) }}
        guide
      >
          {/* Intro */}
          <Box
            sx={{
              p: 2.5,
              borderRadius: "var(--rt-radius-md)",
              bgcolor: "var(--rt-color-bg-subtle)",
              border: "1px solid var(--rt-color-border)",
              mb: 2.5,
            }}
          >
            <Box
              sx={{
                fontSize: "var(--rt-text-sm)",
                fontWeight: "var(--rt-weight-bold)",
                color: "var(--rt-color-accent)",
                mb: 0.75,
              }}
            >
              AI Playlist Strategy Engine
            </Box>
            <Box
              sx={{
                fontSize: "var(--rt-text-xs)",
                color: "var(--rt-color-text-secondary)",
                lineHeight: 1.6,
              }}
            >
              The RevTube Playlist Optimizer uses LLM to turn your videos into a
              complete playlist growth plan. It groups videos thematically,
              scores each recommendation for reach and engagement, and rewrites
              titles, descriptions, keywords, and tags so your playlists rank
              and perform better.
            </Box>
          </Box>

          {/* Scoring Criteria & Points (centralized, admin config) */}
          <Box sx={{ mb: 2.5 }}>
            <Box
              sx={{
                fontSize: "var(--rt-text-xs)",
                fontWeight: "var(--rt-weight-bold)",
                color: "var(--rt-color-text-tertiary)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                mb: 1.5,
              }}
            >
              Scoring Criteria & Points
            </Box>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {(guideCfg ? guideCfg.playlist : DEFAULT_OPTIMIZER_CRITERIA.playlist).map((c) => (
                <Box
                  key={c.key}
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 2,
                    p: 1.25,
                    borderRadius: "var(--rt-radius-sm)",
                    bgcolor: "var(--rt-color-bg-subtle)",
                    fontSize: "var(--rt-text-sm)",
                  }}
                >
                  <Box>
                    <strong>{c.label}</strong>
                    <Box
                      component="span"
                      sx={{ color: "var(--rt-color-text-secondary)", fontSize: "var(--rt-text-xs)" }}
                    >
                      {" "}
                      &mdash; {c.instruction}
                    </Box>
                  </Box>
                  <Box
                    sx={{
                      flexShrink: 0,
                      fontWeight: "var(--rt-weight-bold)",
                      color: "var(--rt-color-accent)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {c.weight} pts
                  </Box>
                </Box>
              ))}
            </Box>
            <Box
              sx={{
                display: "flex",
                justifyContent: "flex-end",
                fontSize: "var(--rt-text-sm)",
                fontWeight: "var(--rt-weight-bold)",
                color: "var(--rt-color-text)",
                mt: 1,
              }}
            >
              Total {(guideCfg ? guideCfg.playlist : DEFAULT_OPTIMIZER_CRITERIA.playlist).reduce((s, c) => s + (Number(c.weight) || 0), 0)} pts
            </Box>
            <Box
              sx={{
                fontSize: "var(--rt-text-xs)",
                color: "var(--rt-color-text-tertiary)",
                lineHeight: 1.5,
                mt: 1,
              }}
            >
              How scoring works: criterion weights are points of 100.
            </Box>
          </Box>

          {/* How recommendations are made */}
          <Box sx={{ mb: 2.5 }}>
            <Box
              sx={{
                fontSize: "var(--rt-text-xs)",
                fontWeight: "var(--rt-weight-bold)",
                color: "var(--rt-color-text-tertiary)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                mb: 1.5,
              }}
            >
              How Recommendations Are Made
            </Box>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                gap: 2,
              }}
            >
              {[
                {
                  icon: <Layers size={15} />,
                  name: "Thematic Grouping",
                  desc: "Videos are clustered by topic, format, and audience so every playlist has one focused theme.",
                },
                {
                  icon: <Zap size={15} />,
                  name: "Virality Score",
                  desc: "Each playlist is scored from 0 to 10 for predicted engagement and reach based on your content patterns.",
                },
                {
                  icon: <Tag size={15} />,
                  name: "SEO Metadata",
                  desc: "Playlist titles, descriptions, keywords, and tags are rewritten to match the right search intent.",
                },
                {
                  icon: <History size={15} />,
                  name: "Time-Decay Focus",
                  desc: "Optional (off by default): weight recent and well-performing videos highest so the strategy reflects your current direction rather than legacy content.",
                },
                {
                  icon: <Scan size={15} />,
                  name: "Gap Analysis",
                  desc: "Videos that fit no existing group are surfaced as New Opportunity playlists to grow your channel.",
                },
              ].map((item) => (
                <Box
                  key={item.name}
                  sx={{
                    p: 1.75,
                    borderRadius: "var(--rt-radius-md)",
                    bgcolor: "var(--rt-color-bg-subtle)",
                    border: "1px solid var(--rt-color-border)",
                  }}
                >
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      fontWeight: "var(--rt-weight-bold)",
                      fontSize: "var(--rt-text-sm)",
                      color: "var(--rt-color-text)",
                      mb: 0.5,
                    }}
                  >
                    <Box
                      sx={{
                        color: "var(--rt-color-accent)",
                        display: "flex",
                        flexShrink: 0,
                      }}
                    >
                      {item.icon}
                    </Box>
                    <span>{item.name}</span>
                  </Box>
                  <Box
                    sx={{
                      fontSize: "var(--rt-text-xs)",
                      color: "var(--rt-color-text-secondary)",
                      lineHeight: 1.5,
                    }}
                  >
                    {item.desc}
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>

          {/* Modes */}
          <Box sx={{ mb: 2.5 }}>
            <Box
              sx={{
                fontSize: "var(--rt-text-xs)",
                fontWeight: "var(--rt-weight-bold)",
                color: "var(--rt-color-text-tertiary)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                mb: 1.5,
              }}
            >
              The Two Modes
            </Box>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                gap: 2,
              }}
            >
              {[
                {
                  icon: <Zap size={15} />,
                  name: "New Playlist(s) Strategy",
                  desc: "Creates fresh playlist recommendations from scratch, grouping your picked videos into strong themed playlists.",
                },
                {
                  icon: <Wand2 size={15} />,
                  name: "Optimize Existing Playlist(s)",
                  desc: "Improves your real playlists. It reads each playlist title, description, tags, and its videos, then proposes better metadata.",
                },
              ].map((item) => (
                <Box
                  key={item.name}
                  sx={{
                    p: 1.75,
                    borderRadius: "var(--rt-radius-md)",
                    bgcolor: "var(--rt-color-bg-subtle)",
                    border: "1px solid var(--rt-color-border)",
                  }}
                >
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      fontWeight: "var(--rt-weight-bold)",
                      fontSize: "var(--rt-text-sm)",
                      color: "var(--rt-color-text)",
                      mb: 0.5,
                    }}
                  >
                    <Box
                      sx={{
                        color: "var(--rt-color-accent)",
                        display: "flex",
                        flexShrink: 0,
                      }}
                    >
                      {item.icon}
                    </Box>
                    <span>{item.name}</span>
                  </Box>
                  <Box
                    sx={{
                      fontSize: "var(--rt-text-xs)",
                      color: "var(--rt-color-text-secondary)",
                      lineHeight: 1.5,
                    }}
                  >
                    {item.desc}
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>

          {/* Target Playlist fields */}
          <Box sx={{ mb: 2.5 }}>
            <Box
              sx={{
                fontSize: "var(--rt-text-xs)",
                fontWeight: "var(--rt-weight-bold)",
                color: "var(--rt-color-text-tertiary)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                mb: 1.5,
              }}
            >
              Target Playlist Strategy
            </Box>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                gap: 2,
              }}
            >
              {[
                {
                  icon: <Target size={15} />,
                  name: "Target Name",
                  desc: "A label for the strategy, e.g. Productivity Hacks. It anchors the AI focus.",
                },
                {
                  icon: <BookOpen size={15} />,
                  name: "Topic",
                  desc: "The subject area the playlists should cover. Empty means use all your videos.",
                },
                {
                  icon: <Target size={15} />,
                  name: "Criteria",
                  desc: "The rule for what belongs in each playlist, e.g. beginners only or 10+ minute videos. This mainly drives grouping.",
                },
                {
                  icon: <Zap size={15} />,
                  name: "Goal",
                  desc: "What the strategy should achieve, e.g. grow watch time or rank for a keyword.",
                },
                {
                  icon: <Scan size={15} />,
                  name: "Target Audience",
                  desc: "Who the playlists are for, e.g. college students or small business owners.",
                },
              ].map((item) => (
                <Box
                  key={item.name}
                  sx={{
                    p: 1.75,
                    borderRadius: "var(--rt-radius-md)",
                    bgcolor: "var(--rt-color-bg-subtle)",
                    border: "1px solid var(--rt-color-border)",
                  }}
                >
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      fontWeight: "var(--rt-weight-bold)",
                      fontSize: "var(--rt-text-sm)",
                      color: "var(--rt-color-text)",
                      mb: 0.5,
                    }}
                  >
                    <Box
                      sx={{
                        color: "var(--rt-color-accent)",
                        display: "flex",
                        flexShrink: 0,
                      }}
                    >
                      {item.icon}
                    </Box>
                    <span>{item.name}</span>
                  </Box>
                  <Box
                    sx={{
                      fontSize: "var(--rt-text-xs)",
                      color: "var(--rt-color-text-secondary)",
                      lineHeight: 1.5,
                    }}
                  >
                    {item.desc}
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>

          {/* Note */}
          <Box
            sx={{
              p: 2,
              borderRadius: "var(--rt-radius-md)",
              bgcolor: "var(--rt-color-bg-subtle)",
              border: "1px dashed var(--rt-color-border)",
            }}
          >
            <Box
              sx={{
                fontSize: "var(--rt-text-2xs)",
                color: "var(--rt-color-text-tertiary)",
                lineHeight: 1.6,
              }}
            >
              Note: all videos in one analysis must come from the same channel.
              In Optimize Existing Playlist(s) mode, the playlist title,
              description, tags, and videos are fed to the AI so it can improve
              the playlist's real metadata.
            </Box>
          </Box>
      </Modal>
      </AuditToolBody>
    </AuditToolShell>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Playlist Card Component
// ═══════════════════════════════════════════════════════════════════════════
function PlaylistCard({
  playlist,
  score,
  viewMode,
  isExpanded,
  onToggle,
  result,
  allVideos,
  adminMode = false,
  optimized,
  onToggleOptimized,
}: {
  playlist: PlaylistRecommendation;
  /** Deterministic quality score + reasons; falls back to the AI score when absent. */
  score?: PlaylistScore;
  viewMode: ResultViewMode;
  isExpanded: boolean;
  onToggle: () => void;
  result: AnalysisResult;
  allVideos: Video[];
  adminMode?: boolean;
  optimized: boolean;
  onToggleOptimized: () => void;
}) {
  // The deterministic score (when available) is the number the user sees; it
  // reflects real signals and comes with the why/raise-it breakdown.
  const displayScore = score?.score ?? playlist.viralityScore;
  // Copy feedback state (item 3): shows a transient "Copied" per field.
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  const handleCopy = (field: string, text: string) => {
    copyToClipboard(text).then((ok) => {
      if (!ok) return;
      setCopiedField(field);
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(
        () => setCopiedField(null),
        1800,
      );
    });
  };

  // Toggle expand/collapse, but skip when the user is selecting text to copy.
  // A drag-select ends in a click event; toggling then would collapse the card.
  const handleHeaderClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) {
      const range = sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
      if (
        range &&
        typeof range.intersectsNode === "function" &&
        range.intersectsNode(e.currentTarget)
      ) {
        return;
      }
    }
    onToggle();
  };

  // Combined "Action Plan" card. Shows the optimized metadata (description,
  // keywords, tags) plus the actionable video table (title + video ID) that
  // was previously the separate "Action List" view.
  return (
    <div className="pl-card" id={`pl-rec-${playlist.id}`}>
      <div
        className="pl-card-header"
        onClick={handleHeaderClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <div className="pl-card-title-row">
          <span className="pl-card-type">
            {playlist.currentTitle ? "Optimized Existing" : "New Opportunity"}
          </span>
          <h3>{playlist.title}</h3>
          <CopyButton
            field="title"
            copiedField={copiedField}
            onCopy={handleCopy}
            text={playlist.title}
            title="Copy title"
            compact
          />
          <PlaylistDownloadMenu
            result={result}
            playlist={playlist}
            allVideos={allVideos}
            viewMode={viewMode}
            score={displayScore}
          />
          <OptimizedToggle
            compact
            optimized={optimized}
            kindLabel="Playlist Audit"
            onClick={onToggleOptimized}
          />
          <Button variant="secondary" bare tabIndex={-1} aria-hidden="true">
            {isExpanded ? (
              <ChevronDown size={16} />
            ) : (
              <ChevronRight size={16} />
            )}
          </Button>
        </div>
        <div className="pl-card-metrics">
          <ReachBadge reach={playlist.predictedReach} />
          <span
            className="pl-score-inline"
            style={{ color: getScoreColor(displayScore) }}
          >
            Score: {displayScore}
          </span>
        </div>
      </div>

      <PlaylistScorePanel score={score} />

      {playlist.currentTitle ? (
        <div className="pl-card-diff">
          <div className="pl-card-diff-header">Optimization Diff</div>
          <div className="pl-card-diff-grid">
            <div className="pl-card-diff-col pl-card-diff-col--before">
              <div className="pl-card-diff-col-label">Before</div>
              <div className="pl-card-diff-title">{playlist.currentTitle}</div>
              {playlist.currentDescription && (
                <div className="pl-card-diff-desc">{playlist.currentDescription}</div>
              )}
              {Array.isArray(playlist.currentTags) && playlist.currentTags.length > 0 && (
                <div className="pl-tags pl-card-diff-tags">
                  {playlist.currentTags.map((tag, i) => (
                    <span key={i} className="pl-tag pl-tag-tag">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              {playlist.currentViralityScore !== undefined && (
                <span
                  className="pl-score-inline"
                  style={{
                    color: getScoreColor(playlist.currentViralityScore),
                  }}
                >
                  Score: {playlist.currentViralityScore}
                </span>
              )}
              {playlist.currentUrl && (
                <div style={{ marginTop: "4px" }}>
                  <a
                    href={playlist.currentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pl-external-link"
                  >
                    View on YouTube ↗
                  </a>
                </div>
              )}
            </div>
            <div className="pl-card-diff-col pl-card-diff-col--after">
              <div className="pl-card-diff-col-label">After (AI Optimized)</div>
              <div className="pl-card-diff-title">{playlist.title}</div>
              <div className="pl-card-diff-desc">{playlist.description}</div>
              {Array.isArray(playlist.tags) && playlist.tags.length > 0 && (
                <div className="pl-tags pl-card-diff-tags">
                  {(playlist.tags || []).map((tag, i) => (
                    <span key={i} className="pl-tag pl-tag-tag">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  flexWrap: "wrap",
                }}
              >
                <span
                  className="pl-score-inline"
                  style={{ color: getScoreColor(displayScore) }}
                >
                  Score: {displayScore}
                </span>
                {playlist.currentViralityScore !== undefined &&
                  (() => {
                    const delta =
                      displayScore - playlist.currentViralityScore;
                    return delta !== 0 ? (
                      <span
                        className={`pl-score-delta${delta < 0 ? " pl-score-delta--negative" : ""}`}
                      >
                        {delta > 0 ? "+" : ""}
                        {delta} pts
                      </span>
                    ) : null;
                  })()}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isExpanded && (
        <div className="pl-card-body">
          {/* Admin-only: strategy and reasoning are hidden from regular users */}
          {adminMode && playlist.why && (
            <div className="pl-section">
              <h4>Why this playlist?</h4>
              <p>{playlist.why}</p>
            </div>
          )}
          {adminMode && playlist.reasoning && (
            <div className="pl-section">
              <h4>Strategy &amp; Reasoning</h4>
              <p>{playlist.reasoning}</p>
            </div>
          )}
          {adminMode &&
            (playlist.topic ||
              playlist.criteria ||
              playlist.goal ||
              playlist.audience ||
              playlist.includeThemes ||
              playlist.excludeThemes) && (
              <div className="pl-section">
                <h4>Playlist Reasoning</h4>
                <div className="pl-criteria-grid">
                  <span>
                    <strong>Topic:</strong> {playlist.topic || "-"}
                  </span>
                  <span>
                    <strong>Criteria:</strong> {playlist.criteria || "-"}
                  </span>
                  <span>
                    <strong>Goal:</strong> {playlist.goal || "-"}
                  </span>
                  <span>
                    <strong>Audience:</strong> {playlist.audience || "-"}
                  </span>
                  <span>
                    <strong>Include:</strong> {playlist.includeThemes || "-"}
                  </span>
                  <span>
                    <strong>Exclude:</strong> {playlist.excludeThemes || "-"}
                  </span>
                </div>
              </div>
            )}
          <div className="pl-section">
            <div className="pl-section-header">
              <h4>Description</h4>
              <CopyButton
                field="description"
                copiedField={copiedField}
                onCopy={handleCopy}
                text={playlist.description || ""}
                title="Copy description"
              />
            </div>
            <p className="pl-description-text">{playlist.description}</p>
          </div>
          <div className="pl-section">
            <div className="pl-section-header">
              <h4>Keywords</h4>
              <CopyButton
                field="keywords"
                copiedField={copiedField}
                onCopy={handleCopy}
                text={youtubeTags(playlist.keywords || [])}
                title="Copy keywords (comma-separated)"
              />
            </div>
            <div className="pl-tags">
              {playlist.keywords?.map((kw, i) => (
                <span key={i} className="pl-tag">
                  {kw}
                </span>
              ))}
            </div>
          </div>
          <div className="pl-section">
            <div className="pl-section-header">
              <h4>Tags</h4>
              <CopyButton
                field="tags"
                copiedField={copiedField}
                onCopy={handleCopy}
                text={youtubeTags(playlist.tags || [])}
                title="Copy tags (YouTube comma-separated format)"
              />
            </div>
            <div className="pl-tags">
              {playlist.tags?.map((tag, i) => (
                <span key={i} className="pl-tag pl-tag-tag">
                  {tag}
                </span>
              ))}
            </div>
          </div>
          <div className="pl-section">
            <h4>Videos ({playlist.videos?.length || 0})</h4>
            <table className="pl-video-table">
              <thead>
                <tr>
                  <th className="pl-video-sn">SN</th>
                  <th>Title</th>
                  <th>Video ID</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {playlist.videos?.map((pv, i) => (
                  <tr key={pv.id}>
                    <td className="pl-video-sn">{i + 1}</td>
                    <td>{pv.title}</td>
                    <td className="pl-video-id">{pv.videoId || pv.id}</td>
                    <td>
                      <a
                        href={`https://youtube.com/watch?v=${pv.videoId || pv.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="pl-view-btn"
                        title="View on YouTube"
                      >
                        <ExternalLink size={14} /> View
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="pl-card-footer">
        <span className="pl-card-videos-count">
          {playlist.videos?.length || 0} videos
        </span>
        <span className="pl-card-prediction">
          {playlist.engagementPrediction}
        </span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Utility: Extract YouTube Video ID
// ═══════════════════════════════════════════════════════════════════════════
function extractYoutubeId(url: string): string | null {
  const regExp =
    /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = String(url).match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
}

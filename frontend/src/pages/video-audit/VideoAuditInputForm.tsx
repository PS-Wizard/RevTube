// ─────────────────────────────────────────────────────────────────────────────
// Video Audit -- Input form (connected-channel video picker)
// Reuses the shared ChannelVideoPicker (Thumbnail Optimizer pattern) so users
// pick videos from their own connected channels only, with a manual URL-paste
// mode that is restricted to those same connected channels.
// ─────────────────────────────────────────────────────────────────────────────
import {
  Box,
  Button,
  Spinner,
  FormControlLabel,
  IconButton,
  Modal,
  Switch,
  Tooltip,
  Typography,
} from "../../components/ui";
import { Zap, Settings2, HelpCircle, Compass, FileCheck, Eye } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { UsageLimitBanner } from "../../components/UsageLimitBanner";
import { useAuth } from "../../hooks/useAuth";
import { useOrganization } from "../../hooks/useOrganization";
import { UsageLimitError } from "../../services/analyticsService";
import { YouTubeService } from "../../services/youtubeService";
import { ChannelVideoPicker } from "../thumbnail-optimizer/ChannelVideoPicker";
import { VideoAuditCriteriaList } from "./VideoAuditCriteriaList";
import { getVideoAuditCriteria, type VideoAuditCriterion } from "../../services/videoAuditService";

interface Props {
  onSubmit: (params: {
    channelId: string;
    videoIds: string[];
    channelTitle?: string;
    /** Opt-in Thumbnail Optimizer 12-pillar analysis (Gemini vision per video). */
    includeThumbnail?: boolean;
  }) => void;
  isLoading: boolean;
  error: string | null;
  /** Video IDs already flagged "Optimized" (tagged/filtered in the picker). */
  optimizedVideoIds?: Set<string>;
  /** Disable running a new audit (read-only org members). */
  disabled?: boolean;
}

/** Extract a YouTube video ID from a URL. */
function extractYoutubeId(url: string): string | null {
  const regExp =
    /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = String(url).match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
}

export function VideoAuditInputForm({
  onSubmit,
  isLoading,
  error,
  optimizedVideoIds,
  disabled = false,
}: Props) {
  const { user, accessToken } = useAuth();
  const { currentOrganization } = useOrganization();

  const [videoIds, setVideoIds] = useState<string[]>([]);
  const [channelId, setChannelId] = useState("");
  const [channelTitle, setChannelTitle] = useState("");
  const [resolving, setResolving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [usageError, setUsageError] = useState<{
    limit: number;
    used: number;
    message: string;
    pageKey?: string;
  } | null>(null);
  // Bumped to tell ChannelVideoPicker to clear its chips when the user clears.
  const [pickerReset, setPickerReset] = useState(0);
  // Optional 12-pillar thumbnail analysis (one Gemini vision call per video).
  // Off by default -- the audit's thumbnail_pop element is excluded (not
  // zero-scored) when off.
  const [includeThumbnail, setIncludeThumbnail] = useState(false);
  // Advanced Settings collapsible (Thumbnail/Playlist Optimizer pattern).
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Help dialogue (holds the long explanatory hint that used to sit in the form).
  const [helpOpen, setHelpOpen] = useState(false);
  // Config-driven scoring criteria shown in the help modal (same source the
  // VideoAuditPage GuideDialog renders via VideoAuditCriteriaList).
  const [helpCriteria, setHelpCriteria] = useState<VideoAuditCriterion[]>([]);

  // Fetch admin-configured criteria whenever the help modal opens so the
  // displayed points always match what admins control.
  useEffect(() => {
    if (!helpOpen) return;
    let cancelled = false;
    getVideoAuditCriteria()
      .then((res) => {
        if (!cancelled && Array.isArray(res.criteria)) setHelpCriteria(res.criteria);
      })
      .catch(() => {
        if (!cancelled) setHelpCriteria([]);
      });
    return () => {
      cancelled = true;
    };
  }, [helpOpen]);

  // Refs mirror the lock so concurrent async resolutions read the latest value.
  const channelIdRef = useRef<string | null>(null);
  const channelTitleRef = useRef<string | null>(null);
  useEffect(() => {
    channelIdRef.current = channelId;
  }, [channelId]);
  useEffect(() => {
    channelTitleRef.current = channelTitle;
  }, [channelTitle]);

  // Receive the full selection (browse + manual paste) from the picker, resolve
  // the owning channel of the first video, and lock the picker to that channel
  // (the backend requires a single channelId for a batch).
  // Memoize so the ChannelVideoPicker's onUrlsChange effect does not re-fire on
  // every render (a fresh handler identity + setVideoIds would loop and freeze
  // the app, blocking sidebar navigation). Deps are primitives so the identity
  // stays stable across renders triggered by our own setState.
  const handleChannelUrls = useCallback(
    async (urls: string[]) => {
      const ids = urls
        .map(extractYoutubeId)
        .filter((id): id is string => id !== null);
      setVideoIds(ids);
      if (ids.length === 0) return;

      setFormError(null);
      setUsageError(null);

      if (channelIdRef.current) return; // already locked to a channel

      setResolving(true);
      try {
        const service = new YouTubeService(
          user?.email || "",
          accessToken,
          currentOrganization?.id || null,
        );
        const resolved = await service.getChannelIdFromVideo(ids[0]);
        channelIdRef.current = resolved.channelId;
        channelTitleRef.current = resolved.channelTitle;
        setChannelId(resolved.channelId);
        setChannelTitle(resolved.channelTitle);
      } catch (err) {
        if (err instanceof UsageLimitError) {
          setUsageError({
            limit: err.limit,
            used: err.used,
            message: err.message,
            pageKey: err.pageKey,
          });
        } else {
          setFormError(
            err instanceof Error
              ? err.message
              : "Failed to resolve the video channel.",
          );
        }
      } finally {
        setResolving(false);
      }
    },
    [user?.email, accessToken, currentOrganization?.id],
  );

  const handleSubmit = () => {
    setFormError(null);
    if (!channelId || videoIds.length === 0) {
      setFormError("Please select at least one video to audit.");
      return;
    }
    onSubmit({
      channelId,
      videoIds,
      channelTitle: channelTitle || undefined,
      includeThumbnail,
    });
  };

  const handleClear = () => {
    setVideoIds([]);
    channelIdRef.current = null;
    channelTitleRef.current = null;
    setChannelId("");
    setChannelTitle("");
    setFormError(null);
    setPickerReset((n) => n + 1);
  };

  const pickerBusy = isLoading || resolving;

  return (
    <Box className="va-input-card">
      {usageError && (
        <UsageLimitBanner
          limit={usageError.limit}
          used={usageError.used}
          message={usageError.message}
          pageLabel="Video Audit"
        />
      )}

      <div className="rtis-form-label-row">
        <div className="rtis-form-label">
          Choose Videos from Your Connected Channels
        </div>
        <Tooltip title="How does Video Audit work?">
          <IconButton
            aria-label="Video Audit help"
            size="small"
            onClick={() => setHelpOpen(true)}
            sx={{
              color: "var(--rt-color-text-tertiary)",
              "&:hover": { color: "var(--rt-color-accent)", background: "var(--rt-color-bg-muted)" },
            }}
          >
            <HelpCircle size={16} />
          </IconButton>
        </Tooltip>
      </div>

      <Modal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title="How Video Audit Works"
        description="Multi-dimensional algorithmic evaluation and actionable AI suggestions for your YouTube videos."
        icon={<HelpCircle size={20} style={{ color: "var(--rt-color-accent)" }} />}
        secondaryAction={{ label: "Close", onClick: () => setHelpOpen(false) }}
        guide
      >
        <Box sx={{ display: "flex", flexDirection: "column", gap: 3, py: 1 }}>
          {/* Overview */}
          <Typography sx={{ fontSize: "var(--rt-text-sm)", color: "var(--rt-color-text-secondary)", lineHeight: 1.6 }}>
            Select any of your connected channels to fetch recent videos, then pick which to audit. You can mix videos from multiple of your own channels and also paste YouTube URLs manually (your own connected channels only).
          </Typography>

          {/* Focus Areas - 3 column grid with icons */}
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" }, gap: 2 }}>
            {[
              { icon: Compass, title: "Discoverability", desc: "Analyzes title search keywords, tag clouds, metadata relevance, and description search-index signals." },
              { icon: FileCheck, title: "Content Quality", desc: "Evaluates description formatting, chapter marker timestamps, accessibility, and caption coverage." },
              { icon: Eye, title: "Visual Hook", desc: "Assesses thumbnail contrast, focus subject clarity, curiosity gap triggers, and CTR optimization." },
            ].map((area) => (
              <Box
                key={area.title}
                sx={{
                  p: 2.5,
                  borderRadius: "var(--rt-radius-md)",
                  bgcolor: "var(--rt-color-bg-subtle)",
                  border: "1px solid var(--rt-color-border)",
                  transition: "border-color var(--rt-transition-fast)",
                  "&:hover": { borderColor: "var(--rt-color-accent)" },
                }}
              >
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                  <area.icon size={16} style={{ color: "var(--rt-color-accent)" }} />
                  <Typography sx={{ fontSize: "var(--rt-text-sm)", fontWeight: "var(--rt-weight-bold)", color: "var(--rt-color-text)" }}>
                    {area.title}
                  </Typography>
                </Box>
                <Typography sx={{ fontSize: "var(--rt-text-xs)", color: "var(--rt-color-text-secondary)", lineHeight: 1.5 }}>
                  {area.desc}
                </Typography>
              </Box>
            ))}
          </Box>

          {/* Scoring Criteria (config-driven, shared with the VideoAuditPage GuideDialog) */}
          <VideoAuditCriteriaList criteria={helpCriteria} />

          {/* Bottom note */}
          <Typography sx={{ fontSize: "var(--rt-text-xs)", color: "var(--rt-color-text-tertiary)", lineHeight: 1.5 }}>
            Each audited video is scored by AI and comes with concrete recommendations and optimized alternatives for its title, description, and tags. Every audited video counts against your monthly Video Audit quota.
          </Typography>
        </Box>
      </Modal>

      <ChannelVideoPicker
        onUrlsChange={handleChannelUrls}
        isLoading={pickerBusy}
        resetSignal={pickerReset}
        allowAnyChannel={false}
        optimizedVideoIds={optimizedVideoIds}
      />

      {videoIds.length > 0 && (
        <Box
          sx={{
            mt: 1.5,
            px: 2,
            py: 1,
            bgcolor: "var(--rt-color-bg-subtle)",
            borderRadius: "var(--rt-radius-md)",
            border: "1px solid var(--rt-color-border)",
            fontSize: "var(--rt-text-xs)",
            color: "var(--rt-color-text)",
          }}
        >
          <strong>{videoIds.length}</strong> video
          {videoIds.length === 1 ? "" : "s"} selected for audit from your
          connected channels
          <Button
            size="small"
            onClick={handleClear}
            sx={{
              ml: 1.5,
              textTransform: "none",
              fontSize: "var(--rt-text-xs)",
            }}
          >
            Clear
          </Button>
        </Box>
      )}

      {(formError || error) && (
        <div className="va-error-text">{formError || error}</div>
      )}

      {/* Advanced Settings -- shared Thumbnail/Playlist Optimizer pattern:
          always-visible bordered wrapper with icon + title header and a
          Show/Hide toggle; optional settings collapse inside. */}
      <div className="va-settings-section">
        <div className="va-settings-section-header">
          <div className="va-settings-section-title">
            <Settings2 size={16} className="va-settings-section-icon" />
            Advanced Settings{" "}
            <span className="va-settings-section-optional">
              (Optional)
            </span>
          </div>
          <Button variant="ghost" bare onClick={() => setShowAdvanced(!showAdvanced)}>
            <Settings2 size={14} /> {showAdvanced ? "Hide" : "Show"} Advanced
            Settings
          </Button>
        </div>
        {showAdvanced && (
          <div className="va-settings-panel">
            <Tooltip
              title="Runs the full 12-pillar Thumbnail Optimizer on each video (one AI vision call per video -- slower and uses more quota). When off, the thumbnail element is excluded from scoring."
              placement="top"
            >
              <FormControlLabel
                sx={{ alignSelf: "flex-start" }}
                control={
                  <Switch
                    size="small"
                    checked={includeThumbnail}
                    onChange={(e) => setIncludeThumbnail(e.target.checked)}
                    disabled={isLoading}
                  />
                }
                label="Include thumbnail analysis"
              />
            </Tooltip>
            <div className="va-settings-hint">
              Runs the full 12-pillar thumbnail analysis on each video (one AI
              vision call per video — slower and uses more quota). When off, the
              thumbnail element is excluded from scoring.
            </div>
          </div>
        )}
      </div>

      {/* Full-width run button (Thumbnail Optimizer pattern) */}
      <Button
        variant="contained"
        color="primary"
        fullWidth
        onClick={handleSubmit}
        disabled={disabled || isLoading || videoIds.length === 0}
        startIcon={isLoading ? null : <Zap size={16} />}
        sx={{
          mt: 2,
          py: 1.25,
          fontWeight: "var(--rt-weight-bold)",
          fontSize: "var(--rt-text-md)",
          backgroundColor: "var(--rt-color-btn-primary)",
          color: "var(--rt-color-on-primary)",
          borderRadius: "var(--rt-radius-md)",
          textTransform: "none",
          boxShadow: "none",
          "&:hover": {
            backgroundColor: "var(--rt-color-btn-primary-hover)",
            boxShadow: "none",
          },
          "&.Mui-disabled": {
            backgroundColor: "var(--rt-color-bg-muted)",
            color: "var(--rt-color-text-disabled)",
          },
        }}
      >
        {isLoading ? (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Spinner size={18} color="inherit" />
            <span>Auditing...</span>
          </Box>
        ) : disabled ? (
          "Viewing read-only"
        ) : (
          `Audit ${videoIds.length > 0 ? `${videoIds.length} ` : ""}Video${videoIds.length === 1 ? "" : "s"}`
        )}
      </Button>
    </Box>
  );
}

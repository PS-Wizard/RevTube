// ─────────────────────────────────────────────────────────────────────────────
// VideoSearchDialog -- Browse videos across channels with a channel switcher
// ─────────────────────────────────────────────────────────────────────────────
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  Eye,
  Lock,
  Search,
  Tv,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import {
  Avatar,
  Box,
  Button,
  Checkbox,
  Chip,
  DialogActions,
  DialogBody,
  DialogTitle,
  IconButton,
  InputAdornment,
  List,
  ListItem,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  MenuItem,
  Select,
  Spinner,
  TextField,
  Tooltip,
} from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import { useOrganization } from "../../hooks/useOrganization";
import { YouTubeService } from "../../services/youtubeService";
import type { VideoMetadata } from "../../types/youtube";
import { OptimizerDialog } from "./OptimizerDialog";

const PAGE_SIZE = 20;

/** Map raw error messages to user-friendly strings */
function friendlyError(msg: string): string {
  const lower = msg.toLowerCase();
  if (
    lower.includes("invalid authentication") ||
    lower.includes("invalid credentials") ||
    lower.includes("oauth")
  )
    return "YouTube connection expired. Reconnect your channel and try again.";
  if (
    lower.includes("quota") ||
    lower.includes("limit exceeded") ||
    lower.includes("rate limit")
  )
    return "YouTube API quota reached. Try again later.";
  if (
    lower.includes("network") ||
    lower.includes("fetch") ||
    lower.includes("timeout") ||
    lower.includes("abort")
  )
    return "Network error. Check your connection and try again.";
  if (lower.includes("not found") || lower.includes("404"))
    return "Channel not found. It may have been removed or the ID is invalid.";
  return msg;
}

type SortKind = "date" | "views" | "title";
type PrivacyKind = "public" | "private" | "unlisted" | "all";

const SORT_OPTIONS: { value: SortKind; label: string; ascLabel: string }[] = [
  { value: "date", label: "Newest", ascLabel: "Oldest" },
  { value: "views", label: "Most Views", ascLabel: "Least Views" },
  { value: "title", label: "Title A-Z", ascLabel: "Title Z-A" },
];

const PRIVACY_OPTIONS: { value: PrivacyKind; label: string }[] = [
  { value: "all", label: "All videos" },
  { value: "public", label: "Public" },
  { value: "unlisted", label: "Unlisted" },
  { value: "private", label: "Private" },
];

function formatViews(n?: number): string {
  if (n === undefined || n === null) return "";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function sortVideos(
  videos: VideoMetadata[],
  kind: SortKind,
  asc: boolean,
): VideoMetadata[] {
  return [...videos].sort((a, b) => {
    let cmp = 0;
    if (kind === "date") {
      cmp =
        new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime();
    } else if (kind === "views") {
      cmp = (a.viewCount ?? 0) - (b.viewCount ?? 0);
    } else if (kind === "title") {
      cmp = a.title.localeCompare(b.title);
    }
    return asc ? cmp : -cmp;
  });
}

interface ChannelOption {
  id: string;
  title: string;
  thumbnailUrl?: string;
}

interface VideoSearchDialogProps {
  open: boolean;
  channels: ChannelOption[];
  initialChannelId?: string;
  /** Video IDs that should be pre-checked when the dialog opens (e.g. from manual URL paste) */
  initialSelectedIds?: string[];
  onClose: () => void;
  onConfirm: (urls: string[]) => void;
  isLoading?: boolean;
  /** When set, the channel dropdown is disabled and locked to this channel */
  lockedChannelId?: string | null;
  /** When true, switching channels clears selections so a confirm batch is
   *  single-channel. False keeps the original cross-channel selection behavior. */
  enforceSingleChannel?: boolean;
  /** Video IDs already flagged "Optimized" — shown as a tag + sortable filter. */
  optimizedVideoIds?: Set<string>;
}

export const VideoSearchDialog: React.FC<VideoSearchDialogProps> = ({
  open,
  channels,
  initialChannelId,
  initialSelectedIds,
  onClose,
  onConfirm,
  isLoading,
  lockedChannelId,
  enforceSingleChannel = false,
  optimizedVideoIds,
}) => {
  const { user, allTokens } = useAuth();
  const { currentOrganization, isPersonalContext } = useOrganization();

  const [selectedChannelId, setSelectedChannelId] = useState(
    initialChannelId || channels[0]?.id || "",
  );
  const [allVideos, setAllVideos] = useState<VideoMetadata[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKind, setSortKind] = useState<SortKind>("date");
  const [sortAsc, setSortAsc] = useState(false);
  const [privacy, setPrivacy] = useState<PrivacyKind>("all");
  const [showOptimizedOnly, setShowOptimizedOnly] = useState(false);
  const [excludeOptimized, setExcludeOptimized] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<string>>(
    new Set(),
  );

  // Set initial channel when dialog opens
  useEffect(() => {
    if (open) {
      const initial = initialChannelId || channels[0]?.id || "";
      setSelectedChannelId(initial);
      setSearchQuery("");
      setSortKind("date");
      setSortAsc(false);
      setVisibleCount(PAGE_SIZE);
      setSelectedVideoIds(new Set(initialSelectedIds));
      setAllVideos([]);
      setPrivacy("all");
      setError(null);
    }
  }, [open, initialChannelId, channels]);

  // Fetch videos when selected channel changes (and dialog is open)
  useEffect(() => {
    if (!open || !selectedChannelId) return;

    const fetchAll = async () => {
      setLoading(true);
      setError(null);
      setSearchQuery("");
      setVisibleCount(PAGE_SIZE);
      setAllVideos([]);

      try {
        const accessToken =
          allTokens.find((t) => t.channelId === selectedChannelId)
            ?.accessToken || null;
        const orgId =
          !isPersonalContext && currentOrganization
            ? currentOrganization.id
            : null;
        const service = new YouTubeService(
          user?.email || "",
          accessToken,
          orgId,
        );
        // Fetch the full channel list (limit=all) under the chosen visibility
        // filter in picker mode: reopening within 60s is served from the 60s
        // client cache, otherwise the backend serves its server cache topped up
        // with the newest uploads page -- so uploads made minutes ago and large
        // catalogs are included without a full live fetch. Client-side pagination.
        const videos = await service.fetchChannelVideos(
          selectedChannelId,
          undefined,
          undefined,
          privacy,
          true,
        );
        setAllVideos(videos);
      } catch (err) {
        setError(
          friendlyError(
            err instanceof Error ? err.message : "Failed to load videos",
          ),
        );
      } finally {
        setLoading(false);
      }
    };

    fetchAll();
  }, [
    open,
    selectedChannelId,
    privacy,
    allTokens,
    isPersonalContext,
    currentOrganization,
    user?.email,
  ]);

  // Filter by search query (client-side)
  let filtered = searchQuery.trim()
    ? allVideos.filter((v) =>
        v.title.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : allVideos;

  // Optionally restrict to videos already flagged "Optimized"
  if (showOptimizedOnly && optimizedVideoIds) {
    filtered = filtered.filter((v) => optimizedVideoIds.has(v.videoId));
  }
  // Optionally hide videos already flagged "Optimized"
  if (excludeOptimized && optimizedVideoIds) {
    filtered = filtered.filter((v) => !optimizedVideoIds.has(v.videoId));
  }

  const sorted = sortVideos(filtered, sortKind, sortAsc);
  const visibleVideos = sorted.slice(0, visibleCount);
  // Pure client-side pagination: all videos are already loaded, so there are
  // only more results to reveal if we are not yet showing the full set.
  const hasMoreClient = visibleCount < sorted.length;

  const toggleVideo = (videoId: string) => {
    setSelectedVideoIds((prev) => {
      const next = new Set(prev);
      if (next.has(videoId)) next.delete(videoId);
      else next.add(videoId);
      return next;
    });
  };

  const handleConfirm = () => {
    const urls = Array.from(selectedVideoIds).map(
      (id) => `https://www.youtube.com/watch?v=${id}`,
    );
    onConfirm(urls);
  };

  const handleClose = () => {
    if (!loading) onClose();
  };

  return (
    <OptimizerDialog
      open={open}
      onClose={handleClose}
      maxWidth={false}
      PaperProps={{
        sx: {
          // Full-bleed on phones/PWA (70vw would be a ~250px sliver with every
          // inner row spilling out); capped near the old 70vw width on desktop.
          width: "min(960px, calc(100vw - 2rem))",
          maxWidth: "calc(100vw - 2rem)",
          minHeight: "min(480px, 60vh)",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
        },
      }}
    >
      {/* ── Header ──────────────────────────────────────────────────── */}
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: "var(--rt-space-5)",
          py: "var(--rt-space-4)",
          fontSize: "var(--rt-text-md)",
          fontWeight: "var(--rt-weight-bold)",
          color: "var(--rt-color-text)",
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: "var(--rt-space-3)",
            minWidth: 0,
          }}
        >
          <Tv
            size={18}
            style={{ color: "var(--rt-color-accent)", flexShrink: 0 }}
          />
          <Select
            value={selectedChannelId}
            onChange={(e) => {
              if (enforceSingleChannel || lockedChannelId)
                setSelectedVideoIds(new Set());
              setSelectedChannelId(e.target.value);
            }}
            size="small"
            disabled={loading || !!lockedChannelId}
            contentProps={{ className: "z-[1400]" }}
            sx={{
              fontSize: "var(--rt-text-sm)",
              fontWeight: "var(--rt-weight-bold)",
              color: "var(--rt-color-text)",
              minWidth: 140,
              maxWidth: "100%",
              flexShrink: 1,
              opacity: loading || !!lockedChannelId ? 0.7 : 1,
            }}
          >
            {channels.map((ch) => (
              <MenuItem
                key={ch.id}
                value={ch.id}
                sx={{ fontSize: "var(--rt-text-sm)" }}
              >
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--rt-space-2)",
                  }}
                >
                  <Avatar src={ch.thumbnailUrl} sx={{ width: 20, height: 20 }}>
                    {ch.title[0]}
                  </Avatar>
                  <span
                    style={{ overflow: "hidden", textOverflow: "ellipsis" }}
                  >
                    {ch.title}
                  </span>
                </Box>
              </MenuItem>
            ))}
          </Select>
          {!!lockedChannelId && (
            <Chip
              icon={<Lock size={11} />}
              label="Locked"
              size="small"
              color="primary"
              sx={{ height: 20, fontSize: "var(--rt-text-2xs)" }}
            />
          )}
        </Box>
        <IconButton
          size="small"
          onClick={handleClose}
          aria-label="Close"
          sx={{ color: "var(--rt-color-text-tertiary)" }}
        >
          <X size={18} />
        </IconButton>
      </DialogTitle>

      {/* ── Search ──────────────────────────────────────────────────── */}
      <Box
        sx={{
          px: "var(--rt-space-5)",
          pt: "var(--rt-space-2)",
          pb: "var(--rt-space-1)",
        }}
      >
        <TextField
          fullWidth
          size="small"
          placeholder="Search videos by title..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setVisibleCount(PAGE_SIZE);
          }}
          disabled={loading}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search
                  size={16}
                  style={{ color: "var(--rt-color-text-tertiary)" }}
                />
              </InputAdornment>
            ),
          }}
        />
      </Box>

      {/* ── Sort bar ──────────────────────────────────────────────────── */}
      <Box
        sx={{
          px: "var(--rt-space-5)",
          pb: "var(--rt-space-1)",
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          rowGap: "var(--rt-space-1)",
          columnGap: "var(--rt-space-2)",
        }}
      >
        <ArrowUpDown
          size={13}
          style={{ color: "var(--rt-color-text-tertiary)", flexShrink: 0 }}
        />
        <Select
          value={sortKind}
          onChange={(e) => {
            setSortKind(e.target.value as SortKind);
            setVisibleCount(PAGE_SIZE);
          }}
          size="small"
          contentProps={{ className: "z-[1400]" }}
          sx={{
            fontSize: "var(--rt-text-xs)",
            color: "var(--rt-color-text-secondary)",
            minWidth: 100,
          }}
        >
          {SORT_OPTIONS.map((opt) => (
            <MenuItem
              key={opt.value}
              value={opt.value}
              sx={{ fontSize: "var(--rt-text-xs)" }}
            >
              {sortAsc ? opt.ascLabel : opt.label}
            </MenuItem>
          ))}
        </Select>
        <Box sx={{ width: "var(--rt-space-1)" }} />
        <Eye
          size={13}
          style={{ color: "var(--rt-color-text-tertiary)", flexShrink: 0 }}
        />
        <Select
          value={privacy}
          onChange={(e) => {
            setPrivacy(e.target.value as PrivacyKind);
            setVisibleCount(PAGE_SIZE);
          }}
          size="small"
          disabled={loading}
          contentProps={{ className: "z-[1400]" }}
          sx={{
            fontSize: "var(--rt-text-xs)",
            color: "var(--rt-color-text-secondary)",
            minWidth: 100,
          }}
        >
          {PRIVACY_OPTIONS.map((opt) => (
            <MenuItem
              key={opt.value}
              value={opt.value}
              sx={{ fontSize: "var(--rt-text-xs)" }}
            >
              {opt.label}
            </MenuItem>
          ))}
        </Select>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setSortAsc((p) => !p);
            setVisibleCount(PAGE_SIZE);
          }}
          startIcon={sortAsc ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
        >
          {sortAsc ? "Ascending" : "Descending"}
        </Button>
        {!loading && allVideos.length > 0 && (
          <Box
            sx={{
              ml: "auto",
              fontSize: "var(--rt-text-2xs)",
              color: "var(--rt-color-text-tertiary)",
            }}
          >
            {allVideos.length} video{allVideos.length !== 1 ? "s" : ""}
          </Box>
        )}
      </Box>

      {/* ── Content ─────────────────────────────────────────────────── */}
      <DialogBody sx={{ p: 0, flex: 1, overflow: "auto" }}>
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
            <Spinner size={32} />
          </Box>
        ) : error ? (
          <Box
            sx={{
              py: 6,
              textAlign: "center",
              color: "var(--rt-color-danger)",
              fontSize: "var(--rt-text-sm)",
            }}
          >
            {error}
          </Box>
        ) : filtered.length === 0 ? (
          <EmptyState
            variant={searchQuery ? "no-results" : "zero"}
            title={searchQuery ? "No Matching Videos" : "No Videos Found"}
            description={
              searchQuery
                ? `No videos match "${searchQuery}".`
                : "No videos found for this channel."
            }
          />
        ) : (
          <>
            {/* Select All bar */}
            {filtered.length > 0 && (
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  flexWrap: "wrap",
                  rowGap: "var(--rt-space-1)",
                  columnGap: "var(--rt-space-2)",
                  px: "var(--rt-space-1)",
                  py: "var(--rt-space-1)",
                  mb: "var(--rt-space-1)",
                  borderBottom: "1px solid var(--rt-color-border)",
                }}
              >
                <Checkbox
                  size="small"
                  checked={
                    filtered.length > 0 &&
                    filtered.every((v) => selectedVideoIds.has(v.videoId))
                  }
                  indeterminate={
                    filtered.some((v) => selectedVideoIds.has(v.videoId)) &&
                    !filtered.every((v) => selectedVideoIds.has(v.videoId))
                  }
                  onChange={() => {
                    const allFilteredSelected = filtered.every((v) =>
                      selectedVideoIds.has(v.videoId),
                    );
                    setSelectedVideoIds((prev) => {
                      const next = new Set(prev);
                      if (allFilteredSelected) {
                        filtered.forEach((v) => next.delete(v.videoId));
                      } else {
                        filtered.forEach((v) => next.add(v.videoId));
                      }
                      return next;
                    });
                  }}
                  sx={{ py: 0 }}
                />
                <Box
                  sx={{
                    fontSize: "var(--rt-text-xs)",
                    color: "var(--rt-color-text-secondary)",
                    cursor: "pointer",
                    userSelect: "none",
                    flex: 1,
                    minWidth: 0,
                  }}
                  onClick={() => {
                    const allFilteredSelected = filtered.every((v) =>
                      selectedVideoIds.has(v.videoId),
                    );
                    setSelectedVideoIds((prev) => {
                      const next = new Set(prev);
                      if (allFilteredSelected) {
                        filtered.forEach((v) => next.delete(v.videoId));
                      } else {
                        filtered.forEach((v) => next.add(v.videoId));
                      }
                      return next;
                    });
                  }}
                >
                  {selectedVideoIds.size > 0
                    ? `${selectedVideoIds.size} selected`
                    : `Select all ${filtered.length} video${filtered.length !== 1 ? "s" : ""}`}
                </Box>
                {optimizedVideoIds && optimizedVideoIds.size > 0 && (
                  <>
                    <Chip
                      label="Optimized only"
                      size="small"
                      clickable
                      onClick={() => {
                        setShowOptimizedOnly((v) => !v);
                        if (!showOptimizedOnly) setExcludeOptimized(false);
                      }}
                      icon={<CheckCircle2 size={12} />}
                      sx={{
                        height: 22,
                        fontSize: "var(--rt-text-2xs)",
                        fontFamily: "var(--rt-font-sans)",
                        fontWeight: "var(--rt-weight-medium)",
                        color: showOptimizedOnly
                          ? "var(--rt-color-success)"
                          : "var(--rt-color-text-secondary)",
                        bgcolor: showOptimizedOnly
                          ? "var(--rt-color-success-surface)"
                          : "transparent",
                        border: `1px solid ${
                          showOptimizedOnly
                            ? "var(--rt-color-success)"
                            : "var(--rt-color-border)"
                        }`,
                        "&:hover": {
                          bgcolor: showOptimizedOnly
                            ? "var(--rt-color-success-surface)"
                            : "var(--rt-color-bg-muted)",
                        },
                      }}
                    />
                    <Chip
                      label="Exclude optimized"
                      size="small"
                      clickable
                      onClick={() => {
                        setExcludeOptimized((v) => !v);
                        if (!excludeOptimized) setShowOptimizedOnly(false);
                      }}
                      sx={{
                        height: 22,
                        fontSize: "var(--rt-text-2xs)",
                        fontFamily: "var(--rt-font-sans)",
                        fontWeight: "var(--rt-weight-medium)",
                        color: excludeOptimized
                          ? "var(--rt-color-accent)"
                          : "var(--rt-color-text-secondary)",
                        bgcolor: excludeOptimized
                          ? "var(--rt-color-accent-soft)"
                          : "transparent",
                        border: `1px solid ${
                          excludeOptimized
                            ? "var(--rt-color-accent)"
                            : "var(--rt-color-border)"
                        }`,
                        "&:hover": {
                          bgcolor: excludeOptimized
                            ? "var(--rt-color-accent-soft)"
                            : "var(--rt-color-bg-muted)",
                        },
                      }}
                    />
                  </>
                )}
              </Box>
            )}
            <List dense disablePadding>
              {visibleVideos.map((video) => {
                const isChecked = selectedVideoIds.has(video.videoId);
                return (
                  <ListItem
                    key={video.videoId}
                    disablePadding
                    sx={{
                      borderRadius: "var(--rt-radius-sm)",
                      mb: "var(--rt-space-1)",
                      bgcolor: isChecked
                        ? "var(--rt-color-accent-soft)"
                        : "transparent",
                      "&:hover": { bgcolor: "var(--rt-color-bg-subtle)" },
                    }}
                  >
                    <ListItemButton
                      dense
                      onClick={() => toggleVideo(video.videoId)}
                      sx={{
                        borderRadius: "var(--rt-radius-sm)",
                        py: "var(--rt-space-1)",
                      }}
                    >
                      <Checkbox
                        edge="start"
                        checked={isChecked}
                        size="small"
                        sx={{ py: 0, pr: "var(--rt-space-1)" }}
                      />
                      <ListItemAvatar sx={{ minWidth: 68 }}>
                        <Avatar
                          src={video.thumbnailUrl}
                          sx={{
                            width: 60,
                            height: 34,
                            borderRadius: "var(--rt-radius-sm)",
                          }}
                        />
                      </ListItemAvatar>
                      <ListItemText
                        primary={video.title}
                        primaryTypographyProps={{
                          variant: "body2",
                          sx: {
                            fontSize: "var(--rt-text-xs)",
                            lineHeight: 1.3,
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                            color: "var(--rt-color-text)",
                          },
                        }}
                        secondary={
                          <Box
                            component="span"
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              gap: "var(--rt-space-2)",
                              flexWrap: "wrap",
                            }}
                          >
                            <Box
                              component="span"
                              sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: "var(--rt-space-1)",
                              }}
                            >
                              <Tv
                                size={10}
                                style={{
                                  color: "var(--rt-color-text-tertiary)",
                                }}
                              />
                              <span>{formatViews(video.viewCount)} views</span>
                            </Box>
                            {optimizedVideoIds?.has(video.videoId) && (
                              <Tooltip title="Already optimized — in your Optimized list">
                                <Chip
                                  icon={<CheckCircle2 size={10} />}
                                  label="Optimized"
                                  size="small"
                                  sx={{
                                    height: 16,
                                    fontSize: "var(--rt-text-badge-sm)",
                                    fontFamily: "var(--rt-font-sans)",
                                    fontWeight: "var(--rt-weight-semibold)",
                                    color: "var(--rt-color-success)",
                                    bgcolor: "var(--rt-color-success-surface)",
                                    border: "1px solid var(--rt-color-success)",
                                    "& .MuiChip-icon": {
                                      color: "var(--rt-color-success)",
                                    },
                                  }}
                                />
                              </Tooltip>
                            )}
                            {video.publishedAt && (
                              <span>
                                {new Date(video.publishedAt).toLocaleDateString(
                                  undefined,
                                  {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                  },
                                )}
                              </span>
                            )}
                          </Box>
                        }
                        secondaryTypographyProps={{
                          variant: "caption",
                          sx: {
                            color: "var(--rt-color-text-muted)",
                            mt: "var(--rt-space-1)",
                          },
                        }}
                      />
                    </ListItemButton>
                  </ListItem>
                );
              })}
            </List>
          </>
        )}
      </DialogBody>

      {/* ── Footer bar ──────────────────────────────────────────────── */}
      <Box
        sx={{
          px: "var(--rt-space-5)",
          py: "var(--rt-space-3)",
          borderTop: "1px solid var(--rt-color-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          rowGap: "var(--rt-space-2)",
          columnGap: "var(--rt-space-3)",
        }}
      >
        <Box
          sx={{
            fontSize: "var(--rt-text-xs)",
            color: "var(--rt-color-text-secondary)",
          }}
        >
          {!loading && allVideos.length > 0 && (
            <>
              {searchQuery
                ? `${filtered.length} match${filtered.length !== 1 ? "es" : ""}`
                : `${allVideos.length} video${allVideos.length !== 1 ? "s" : ""}`}
              {visibleVideos.length < filtered.length &&
                ` · showing ${visibleVideos.length}`}
              {selectedVideoIds.size > 0 && (
                <Chip
                  label={`${selectedVideoIds.size} selected`}
                  size="small"
                  color="primary"
                  sx={{ ml: 1, height: 20, fontSize: "var(--rt-text-2xs)" }}
                />
              )}
            </>
          )}
        </Box>

        <Box sx={{ display: "flex", gap: "var(--rt-space-2)" }}>
          {hasMoreClient && (
            <Button
              size="small"
              variant="outlined"
              onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
            >
              Load more ({filtered.length - visibleCount} left)
            </Button>
          )}
        </Box>
      </Box>

      {/* ── Actions ─────────────────────────────────────────────────── */}
      <DialogActions
        sx={{
          px: "var(--rt-space-5)",
          py: "var(--rt-space-4)",
          borderTop: "1px solid var(--rt-color-border)",
        }}
      >
        <Button variant="ghost" onClick={handleClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleConfirm}
          disabled={selectedVideoIds.size === 0 || loading || isLoading}
        >
          Confirm ({selectedVideoIds.size})
        </Button>
      </DialogActions>
    </OptimizerDialog>
  );
};

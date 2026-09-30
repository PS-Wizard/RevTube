import {
  Box,
  Button,
  Card,
  CardContent,
  Flex,
  Grid,
  IconButton,
  Input,
  NativeSelect,
  Progress,
  Spinner,
  Stack,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Toggle,
  Tooltip,
  Typography,
} from "@/components/ui";
import {
  CheckCircle2,
  ExternalLink,
  Layers,
  Pencil,
  PlaySquare,
  Plus,
  Search,
  Trash2,
  Video,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { EmptyState } from "../../components/EmptyState";
import { AuditToolShell } from "../../components/audit/AuditToolShell";
import { AuditToolBody } from "../../components/audit/AuditToolBody";
import { useAuth } from "../../hooks/useAuth";
import { useOrganization } from "../../hooks/useOrganization";
import { useVideoManagement } from "../../hooks/useVideoManagement";
import type {
  OptimizedKind,
  OptimizedScope,
} from "../../services/optimizedFlagService";
import {
  extractVideoId,
  getAllOptimizedLists,
  OPTIMIZED_FIELD_DEFS,
  unmarkOptimized,
} from "../../services/optimizedFlagService";
import { getOrganizationChannels } from "../../services/organizationChannelService";
import { PlaylistOptimizerService } from "../../services/playlistOptimizerService";
import { findVideoAuditByVideo } from "../../services/videoAuditService";
import { YouTubeService } from "../../services/youtubeService";
import { VideoSearchDialog } from "../thumbnail-optimizer/VideoSearchDialog";

/** Kinds shown on this page — thumbnail optimization is tracked as a per-video checkbox (see FIELD_DEFS). */
type PageKind = Exclude<OptimizedKind, "thumbnail">;

const KIND_META: Record<
  PageKind,
  {
    label: string;
    icon: React.ReactElement;
    auditRoute: string;
    auditAction: string;
  }
> = {
  video: {
    label: "Videos",
    icon: <Video size={16} />,
    auditRoute: "/video-audit",
    auditAction: "Go to Video Audit",
  },
  playlist: {
    label: "Playlists",
    icon: <PlaySquare size={16} />,
    auditRoute: "/playlist-optimizer",
    auditAction: "Go to Playlist Optimizer",
  },
};

const FIELD_DEFS = OPTIMIZED_FIELD_DEFS;
const TOTAL_FIELDS = FIELD_DEFS.length;

function useScope(): OptimizedScope | null {
  const { user } = useAuth();
  const { currentOrganization } = useOrganization();
  return useMemo<OptimizedScope | null>(
    () =>
      user
        ? { uid: user.uid, organizationId: currentOrganization?.id ?? null }
        : null,
    [user, currentOrganization?.id],
  );
}

type SortBy = "date-new" | "date-old" | "name-asc" | "name-desc";

export function OptimizedListPage(): React.ReactElement {
  const navigate = useNavigate();
  const scope = useScope();
  const { user, allTokens, accessToken } = useAuth();
  const { currentOrganization, isPersonalContext } = useOrganization();
  const [selectedKind, setSelectedKind] = useState<PageKind>("video");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("date-new");
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browseChannels, setBrowseChannels] = useState<
    { id: string; title: string; thumbnailUrl?: string }[]
  >([]);

  const {
    items: vmItems,
    ready: vmReady,
    addVideos,
    removeVideo,
    setField,
  } = useVideoManagement();

  const [playlistList, setPlaylistList] =
    useState<Awaited<ReturnType<typeof getAllOptimizedLists>>["playlist"]>(
      null,
    );

  const fetchAuxLists = useCallback(async () => {
    if (!scope) {
      setPlaylistList(null);
      return;
    }
    try {
      const all = await getAllOptimizedLists(scope);
      setPlaylistList(all.playlist);
    } catch {
      /* ignore */
    }
  }, [scope]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      await fetchAuxLists();
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchAuxLists]);

  useEffect(() => {
    let cancelled = false;
    const loadChannels = async () => {
      if (isPersonalContext) {
        setBrowseChannels(
          allTokens
            .filter((t) => t.channelId && t.channelTitle)
            .map((t) => ({
              id: t.channelId!,
              title: t.channelTitle || "Unknown",
              thumbnailUrl: t.thumbnailUrl,
            })),
        );
      } else if (currentOrganization) {
        try {
          const orgChannels = await getOrganizationChannels(
            currentOrganization.id,
          );
          if (cancelled) return;
          setBrowseChannels(
            orgChannels
              .filter((c) => c.id && c.channelTitle)
              .map((c) => ({
                id: c.id,
                title: c.channelTitle || "Unknown",
                thumbnailUrl: c.thumbnailUrl,
              })),
          );
        } catch {
          if (!cancelled) setBrowseChannels([]);
        }
      }
    };
    void loadChannels();
    return () => {
      cancelled = true;
    };
  }, [isPersonalContext, currentOrganization, allTokens]);

  const isPlaylist = selectedKind === "playlist";

  const auxRows = useMemo(() => {
    if (!isPlaylist || !playlistList) return [];
    const metaMap = (playlistList.itemsMeta ?? {}) as Record<
      string,
      { title?: string; thumbnailUrl?: string; addedAt: number; fromAudit?: boolean }
    >;
    return (playlistList.playlistIds ?? [])
      .map((id) => ({
        id,
        title: metaMap[id]?.title ?? `Item ${id}`,
        thumb: metaMap[id]?.thumbnailUrl,
        addedAt: metaMap[id]?.addedAt ?? 0,
        fromAudit: metaMap[id]?.fromAudit,
      }))
      .filter(
        (r) =>
          !search.trim() ||
          r.title.toLowerCase().includes(search.trim().toLowerCase()),
      )
      .sort((a, b) => {
        if (sortBy === "name-asc") return a.title.localeCompare(b.title);
        if (sortBy === "name-desc") return b.title.localeCompare(a.title);
        if (sortBy === "date-old") return a.addedAt - b.addedAt;
        return b.addedAt - a.addedAt;
      });
  }, [isPlaylist, playlistList, search, sortBy]);

  const gridRows = useMemo(() => {
    return [...vmItems]
      .filter(
        (r) =>
          !search.trim() ||
          (r.title ?? "").toLowerCase().includes(search.trim().toLowerCase()),
      )
      .sort((a, b) => {
        if (sortBy === "name-asc")
          return (a.title ?? "").localeCompare(b.title ?? "");
        if (sortBy === "name-desc")
          return (b.title ?? "").localeCompare(a.title ?? "");
        if (sortBy === "date-old") return a.addedAt - b.addedAt;
        return b.addedAt - a.addedAt;
      });
  }, [vmItems, search, sortBy]);

  const doneCount = (id: string) => {
    const item = vmItems.find((v) => v.id === id);
    if (!item) return 0;
    return FIELD_DEFS.filter((f) => item.fields[f.value]).length;
  };

  // Compute overall completion stats for the stats strip
  const videoStats = useMemo(() => {
    const total = vmItems.length;
    const complete = vmItems.filter((v) =>
      FIELD_DEFS.every((f) => v.fields[f.value]),
    ).length;
    const fromAudit = vmItems.filter((v) => v.fromAudit).length;
    return { total, complete, fromAudit };
  }, [vmItems]);

  const handleOpen = async (id: string, kind: PageKind) => {
    setResolvingId(id);
    try {
      const findBy: Record<
        PageKind,
        (id: string) => Promise<{ id: number | null }>
      > = {
        video: findVideoAuditByVideo,
        playlist: PlaylistOptimizerService.findByVideo,
      };
      const found = await findBy[kind](id).catch(() => null);
      if (found?.id != null) {
        navigate(
          `${KIND_META[kind].auditRoute}?${new URLSearchParams({ audit: String(found.id), scroll: id }).toString()}`,
        );
        return;
      }
      const url =
        kind === "playlist"
          ? `https://www.youtube.com/playlist?list=${id}`
          : `https://youtu.be/${id}`;
      window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setResolvingId(null);
    }
  };

  const handleRemove = (id: string) => {
    if (selectedKind === "video") {
      void removeVideo(id);
      return;
    }
    if (!scope) return;
    unmarkOptimized(scope, "playlist", [id])
      .then((updated) => setPlaylistList(updated))
      .catch(() => {});
  };

  const handleBrowseConfirm = async (urls: string[]) => {
    setBrowseOpen(false);
    if (!urls.length) return;
    const ids = urls
      .map((url) => extractVideoId(url))
      .filter((id): id is string => id !== null);
    if (!ids.length) return;

    const ytService = new YouTubeService(
      user?.email || "",
      accessToken,
      currentOrganization?.id || null,
    );

    let inputs: { id: string; title?: string; thumbnailUrl?: string }[] =
      ids.map((id) => ({ id }));
    try {
      const details = await ytService.fetchVideosByIds(ids);
      const byId = new Map(details.map((d) => [d.videoId, d]));
      inputs = ids.map((id) => {
        const d = byId.get(id);
        return { id, title: d?.title, thumbnailUrl: d?.thumbnailUrl };
      });
    } catch {
      /* enrichment is best-effort; add with id only */
    }
    void addVideos(inputs);
  };

  const getCount = (kind: PageKind) => {
    if (kind === "video") return vmItems.length;
    return playlistList?.playlistIds?.length ?? 0;
  };

  const tabItems = (["video", "playlist"] as PageKind[]).map((k) => ({
    value: k,
    label: KIND_META[k].label,
    icon: KIND_META[k].icon,
    count: getCount(k),
  }));

  // ── Stats strip (only shown for the video tab) ──────────────
  const completePct =
    videoStats.total > 0
      ? Math.round((videoStats.complete / videoStats.total) * 100)
      : null;
  const statsStrip =
    selectedKind !== "video" || !vmReady ? null : (
      <Grid container spacing={1.5}>
        <Grid size={{ xs: 6, sm: 4 }}>
          <StatCard
            label="Tracked videos"
            value={videoStats.total}
            icon={<Video size={16} />}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 4 }}>
          <StatCard
            tone="success"
            label="Fully optimized"
            value={
              <Box
                component="span"
                display="inline-flex"
                alignItems="baseline"
                gap={0.5}
                className="min-w-0"
              >
                <span className="truncate">{videoStats.complete}</span>
                {completePct !== null && (
                  <span className="truncate text-[length:var(--rt-text-2xs)] font-medium text-[var(--rt-color-text-tertiary)]">
                    {completePct}% complete
                  </span>
                )}
              </Box>
            }
            icon={<CheckCircle2 size={16} />}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 4 }}>
          <StatCard
            tone="info"
            label="From audits"
            value={videoStats.fromAudit}
            icon={<Layers size={16} />}
          />
        </Grid>
      </Grid>
    );

  return (
    <AuditToolShell
      title="Optimized Content"
      description="Track optimization progress for every video and playlist and review items flagged during audits. In the Videos tab, toggle each field as you complete it — progress is saved automatically."
      icon={<CheckCircle2 size={20} />}
      tabs={{
        items: tabItems,
        value: selectedKind,
        onChange: (v) => setSelectedKind(v as PageKind),
        ariaLabel: "Optimized content types",
      }}
      actions={
        selectedKind === "video" ? (
          <Button variant="primary" onClick={() => setBrowseOpen(true)}>
            <Plus size={14} />
            Browse Videos
          </Button>
        ) : undefined
      }
    >
      <AuditToolBody>
        {/* Stats strip — video tab only */}
        {statsStrip}

        {/* Toolbar */}
        <Card size="sm">
          <CardContent>
          <Flex wrap alignItems="center" justifyContent="flex-end" gap={0.75}>
            <Input
            compact
            type="text"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Filter items by title"
            startAdornment={<Search size={14} />}
          />

          <NativeSelect
            compact
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            aria-label="Sort items"
          >
            <option value="date-new">Newest first</option>
            <option value="date-old">Oldest first</option>
            <option value="name-asc">Title: A → Z</option>
            <option value="name-desc">Title: Z → A</option>
          </NativeSelect>
          </Flex>
          </CardContent>
        </Card>

        {/* Content */}
        {selectedKind === "video" ? (
          !vmReady ? (
            <Card size="sm">
              <CardContent>
              <Flex
                alignItems="center"
                justifyContent="center"
                gap={0.75}
                className="py-6 text-center"
              >
                <Spinner />
                <Typography variant="body2">Loading videos…</Typography>
              </Flex>
              </CardContent>
            </Card>
          ) : gridRows.length === 0 ? (
            <EmptyState
              variant={search ? "no-results" : "zero"}
              title={
                search ? "No matching videos found" : "No videos tracked yet"
              }
              description={
                search
                  ? "Try adjusting your search query to find what you're looking for."
                  : 'Add videos from the Browse Videos page, paste a YouTube link/ID above to start tracking each optimization field, or mark items as "Optimized" during a Video Audit run.'
              }
              action={
                !search ? (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setBrowseOpen(true)}
                  >
                    Add First Videos
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <TableContainer className="rounded-[var(--rt-radius-lg)] border border-[var(--rt-color-border)] bg-[var(--rt-color-bg-elevated)] shadow-[var(--rt-shadow-xs)]">
              <Table>
                <TableHeader>
                  <tr>
                    <TableHead className="min-w-[260px]">Video</TableHead>
                    {FIELD_DEFS.map((def) => (
                      <TableHead
                        key={def.value}
                        className="min-w-[72px] text-center"
                        title={def.hint}
                      >
                        {def.label}
                      </TableHead>
                    ))}
                    <TableHead className="min-w-[80px] text-center">
                      Progress
                    </TableHead>
                    <TableHead className="min-w-[72px] text-right">
                      Actions
                    </TableHead>
                  </tr>
                </TableHeader>
                <TableBody>
                  {gridRows.map((r) => {
                    const done = doneCount(r.id);
                    const isComplete = done === TOTAL_FIELDS;
                    return (
                      <TableRow
                        key={r.id}
                        style={
                          isComplete
                            ? {
                                background:
                                  "color-mix(in srgb, var(--rt-color-success) 4%, transparent)",
                              }
                            : undefined
                        }
                      >
                        <TableCell>
                          <Flex gap={1.5} className="min-w-0">
                            {r.thumbnailUrl ? (
                              <img
                                src={r.thumbnailUrl}
                                alt=""
                                className="h-10 w-[72px] shrink-0 rounded-[var(--rt-radius-sm)] border border-[var(--rt-color-border)] bg-[var(--rt-color-bg-muted)] object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <Flex
                                alignItems="center"
                                justifyContent="center"
                                className="h-10 w-[72px] shrink-0 rounded-[var(--rt-radius-sm)] border border-[var(--rt-color-border)] bg-[var(--rt-color-bg-muted)] text-[var(--rt-color-text-tertiary)]"
                              >
                                <Video size={16} />
                              </Flex>
                            )}

                            <div className="min-w-0 flex-1">
                              <div
                                className="truncate font-semibold text-[var(--rt-color-text)]"
                                title={r.title ?? `Video ${r.id}`}
                              >
                                {r.title ?? `Video ${r.id}`}
                              </div>
                              <div className="font-mono text-[length:var(--rt-text-2xs)] text-[var(--rt-color-text-tertiary)]">
                                {r.id}
                              </div>
                            </div>
                            <a
                              href={`https://youtu.be/${r.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="shrink-0 text-[var(--rt-color-text-tertiary)] hover:text-[var(--rt-color-accent)]"
                              title="Open on YouTube"
                              aria-label="Open on YouTube"
                            >
                              <ExternalLink size={12} />
                            </a>
                          </Flex>
                        </TableCell>
                        {FIELD_DEFS.map((def) => (
                          <TableCell key={def.value}>
                            <Flex justifyContent="center">
                              <Toggle
                                checked={!!r.fields[def.value]}
                                onChange={(checked) =>
                                  void setField(r.id, def.value, checked)
                                }
                                ariaLabel={`${def.label} optimized: ${r.title ?? r.id}`}
                              />
                            </Flex>
                          </TableCell>
                        ))}
                        <TableCell>
                          <Tooltip
                            title={
                              isComplete
                                ? "All fields complete!"
                                : `${done} of ${TOTAL_FIELDS} fields done`
                            }
                          >
                            <Stack
                              alignItems="center"
                              gap={0.5}
                              className="mx-auto w-full min-w-[80px] max-w-[140px]"
                            >
                              <Progress
                                value={
                                  TOTAL_FIELDS > 0
                                    ? (done / TOTAL_FIELDS) * 100
                                    : 0
                                }
                                className="h-[5px] w-full"
                              />
                              <span className="whitespace-nowrap text-[length:var(--rt-text-2xs)] font-bold text-[var(--rt-color-text-tertiary)]">
                                {done}/{TOTAL_FIELDS}
                              </span>
                            </Stack>
                          </Tooltip>
                        </TableCell>
                        <TableCell className="text-right">
                          <Flex justifyContent="flex-end" gap={1}>
                            {r.fromAudit ? (
                              <Tooltip title="Go to audit — edit optimization">
                                <IconButton
                                  size="xs"
                                  onClick={() => void handleOpen(r.id, "video")}
                                  disabled={resolvingId === r.id}
                                  aria-label="Go to audit"
                                >
                                  <Pencil size={14} />
                                </IconButton>
                              </Tooltip>
                            ) : null}
                            <Tooltip title="Remove from tracking">
                              <IconButton
                                size="xs"
                                onClick={() => void handleRemove(r.id)}
                                aria-label="Remove video"
                                className="hover:bg-[var(--rt-color-danger-surface)] hover:text-[var(--rt-color-danger)]"
                              >
                                <Trash2 size={13} />
                              </IconButton>
                            </Tooltip>
                          </Flex>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )
        ) : auxRows.length > 0 ? (
          <TableContainer className="rounded-[var(--rt-radius-lg)] border border-[var(--rt-color-border)] bg-[var(--rt-color-bg-elevated)] shadow-[var(--rt-shadow-xs)]">
            <Table>
              <TableHeader>
                <tr>
                  <TableHead className="min-w-[200px]">Title</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {auxRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Flex gap={1.5} className="min-w-0">
                        {r.thumb ? (
                          <img
                            src={r.thumb}
                            alt=""
                            className="h-10 w-[72px] shrink-0 rounded-[var(--rt-radius-sm)] border border-[var(--rt-color-border)] bg-[var(--rt-color-bg-muted)] object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <Flex
                            alignItems="center"
                            justifyContent="center"
                            className="h-10 w-[72px] shrink-0 rounded-[var(--rt-radius-sm)] border border-[var(--rt-color-border)] bg-[var(--rt-color-bg-muted)] text-[var(--rt-color-text-tertiary)]"
                          >
                            {KIND_META[selectedKind].icon}
                          </Flex>
                        )}
                        <div className="min-w-0 max-w-[340px] flex-1">
                          <div
                            className="truncate font-semibold text-[var(--rt-color-text)]"
                            title={r.title}
                          >
                            {r.title}
                          </div>
                          <div className="font-mono text-[length:var(--rt-text-2xs)] text-[var(--rt-color-text-tertiary)]">
                            {r.id}
                          </div>
                        </div>
                      </Flex>
                    </TableCell>
                    <TableCell>
                      <span className="whitespace-nowrap text-[length:var(--rt-text-xs)] text-[var(--rt-color-text-secondary)]">
                        {r.addedAt
                          ? new Date(r.addedAt).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })
                          : "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Flex justifyContent="flex-end" gap={1}>
                        {r.fromAudit ? (
                          <Tooltip title="Go to audit — edit">
                            <IconButton
                              size="xs"
                              onClick={() =>
                                void handleOpen(r.id, selectedKind)
                              }
                              disabled={resolvingId === r.id}
                              aria-label="Go to audit"
                            >
                              <Pencil size={14} />
                            </IconButton>
                          </Tooltip>
                        ) : null}
                        <Tooltip title="Remove from list">
                          <IconButton
                            size="xs"
                            onClick={() => void handleRemove(r.id)}
                            aria-label="Remove item"
                            className="hover:bg-[var(--rt-color-danger-surface)] hover:text-[var(--rt-color-danger)]"
                          >
                            <Trash2 size={13} />
                          </IconButton>
                        </Tooltip>
                      </Flex>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        ) : (
          <EmptyState
            variant={search ? "no-results" : "zero"}
            title={
              search
                ? "No matching items found"
                : "No playlist items tagged yet"
            }
            description={
              search
                ? "Try adjusting your search query to find what you're looking for."
                : 'Playlists you mark as "Optimized" during Playlist Optimizer runs will appear here for easy tracking and review.'
            }
            action={
              !search ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => navigate(KIND_META[selectedKind].auditRoute)}
                >
                  {KIND_META[selectedKind].auditAction}
                </Button>
              ) : undefined
            }
          />
        )}
      </AuditToolBody>

      <VideoSearchDialog
        open={browseOpen}
        channels={browseChannels}
        onClose={() => setBrowseOpen(false)}
        onConfirm={handleBrowseConfirm}
        enforceSingleChannel
      />
    </AuditToolShell>
  );
}

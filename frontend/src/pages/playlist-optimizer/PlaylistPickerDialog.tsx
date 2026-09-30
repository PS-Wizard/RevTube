// ─────────────────────────────────────────────────────────────────────────────
// PlaylistPickerDialog -- Pick a channel (inside the dialog), then select
//                       playlists from it. Fetches their videos together with
//                       the playlist's metadata (title, description, tags).
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  TextField,
  DialogTitle,
  DialogBody,
  DialogActions,
  Button,
  Select,
  MenuItem,
  List,
  ListItem,
  ListItemText,
  ListItemButton,
  Checkbox,
  Spinner,
  Chip,
  Tooltip,
  Typography,
  Dialog,
} from '../../components/ui';
import { Play, X, AlertCircle, CheckCircle2 } from 'lucide-react';
import dayjs from 'dayjs';
import { useAuth } from '../../hooks/useAuth';
import { useOrganization } from '../../hooks/useOrganization';
import { AnalyticsService } from '../../services/analyticsService';
import { YouTubeService } from '../../services/youtubeService';
import { deltaPct, deltaTone, formatDelta } from '../../utils/format';
import type { PlaylistMetadata } from '../../types/youtube';
import type { Video } from '../../types/playlistOptimizer';
import { EmptyState } from '../../components/EmptyState';

interface ChannelOption {
  id: string;
  title: string;
  thumbnailUrl?: string;
}

interface PlaylistPickerDialogProps {
  open: boolean;
  channels: ChannelOption[];
  onClose: () => void;
  onConfirm: (videos: Video[]) => void;
  isLoading?: boolean;
  /** When true (admin mode), a custom channel ID input is shown so any
   *  channel's public playlists can be loaded, not just connected channels. */
  allowAnyChannel?: boolean;
  /** Playlist IDs already added to the Optimized list (green tick + filters). */
  optimizedPlaylistIds?: Set<string>;
}

type ReportLike = {
  columnHeaders: Array<{ name: string }>;
  rows?: Array<Array<string | number>>;
};

type PeriodDelta = { current: number; previous: number };
type PlaylistPerformance = { d7: PeriodDelta; d30: PeriodDelta; d90: PeriodDelta };

/** Parses a playlist-dimension report row array into { playlistId: playlistViews }. */
function parsePlaylistViewsReport(report: ReportLike, map: Record<string, number>) {
  if (!report.rows || report.rows.length === 0) return;
  const playlistIdx = report.columnHeaders.findIndex((h) => h.name === 'playlist');
  const viewsIdx = report.columnHeaders.findIndex((h) => h.name === 'playlistViews');
  report.rows.forEach((row) => {
    const playlistId = String(row[playlistIdx !== -1 ? playlistIdx : 0]);
    const views = viewsIdx !== -1 ? Number(row[viewsIdx]) || 0 : 0;
    if (views > 0) map[playlistId] = views;
  });
}

export const PlaylistPickerDialog: React.FC<PlaylistPickerDialogProps> = ({
  open,
  channels,
  onClose,
  onConfirm,
  isLoading,
  allowAnyChannel = false,
  optimizedPlaylistIds,
}) => {
  const { user, allTokens } = useAuth();
  const { currentOrganization, isPersonalContext } = useOrganization();

  const [channelId, setChannelId] = useState('');
  const [customChannelId, setCustomChannelId] = useState('');
  // Optimized-list filter: show everything / only optimized / exclude optimized.
  const [optimizedFilter, setOptimizedFilter] = useState<'all' | 'only' | 'exclude'>('all');
  const [playlists, setPlaylists] = useState<PlaylistMetadata[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [fetchingVideos, setFetchingVideos] = useState(false);
  // Per-playlist current + previous period views (7d / 30d / 90d), keyed by playlist id.
  const [playlistPerformance, setPlaylistPerformance] = useState<Record<string, PlaylistPerformance>>({});
  const [loadingPerformance, setLoadingPerformance] = useState(false);

  // Reset to the first channel when the dialog opens (keep the current one if
  // the dialog is reopened, since the user may be iterating on a channel).
  useEffect(() => {
    if (!open) return;
    setSelectedIds(new Set());
    setPlaylists([]);
    setError(null);
    setChannelId((prev) =>
      channels.length === 0 ? '' : channels.some((c) => c.id === prev) ? prev : channels[0].id,
    );
  }, [open, channels]);

  // Load playlists when the selected channel changes
  useEffect(() => {
    if (!open || !channelId) return;

    let cancelled = false;
    const fetchPlaylists = async () => {
      setLoading(true);
      setError(null);
      setSelectedIds(new Set());
      setPlaylists([]);
      try {
        const accessToken = allTokens.find((t) => t.channelId === channelId)?.accessToken || null;
        const orgId = !isPersonalContext && currentOrganization ? currentOrganization.id : null;
        const service = new YouTubeService(user?.email || '', accessToken, orgId);
        const result = await service.fetchChannelPlaylists(channelId);
        if (!cancelled) setPlaylists(result);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Failed to load playlists');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchPlaylists();
    return () => {
      cancelled = true;
    };
  }, [open, channelId, allTokens, isPersonalContext, currentOrganization, user?.email]);

  // Fetch last-30d and last-90d playlistViews for the loaded playlists.
  // Mirrors useDashboardPlaylistViews: one playlist-dimension report per window
  // (cached client + server side), so choosing playlists shows real performance.
  useEffect(() => {
    if (!open || !channelId || playlists.length === 0) {
      setPlaylistPerformance({});
      setLoadingPerformance(false);
      return;
    }
    let cancelled = false;
    const ids = playlists.map((p) => p.id);
    setLoadingPerformance(true);

    const run = async () => {
      try {
        const accessToken = allTokens.find((t) => t.channelId === channelId)?.accessToken || null;
        const orgId = !isPersonalContext && currentOrganization ? currentOrganization.id : null;
        const svc = new AnalyticsService(accessToken || '', user?.email || '', orgId);
        const endRef = dayjs().subtract(2, 'day');
        const next: Record<string, PlaylistPerformance> = {};

        const fetchWindowViews = async (start: string, end: string): Promise<Record<string, number>> => {
          const map: Record<string, number> = {};
          const base = {
            channelId,
            startDate: start,
            endDate: end,
            metrics: 'playlistViews',
            dimensions: 'playlist' as const,
            sort: '-playlistViews',
            maxResults: 200,
          };
          try {
            parsePlaylistViewsReport(
              await svc.getReport({ ...base, ids: `channel==${channelId}` }),
              map,
            );
          } catch {
            try {
              parsePlaylistViewsReport(
                await svc.getReport({ ...base, ids: 'channel==MINE' }),
                map,
              );
            } catch {
              /* best-effort */
            }
          }
          // Fetch playlists the top-200 report missed (low/zero views) in one batched call.
          const missing = ids.filter((id) => map[id] === undefined);
          if (missing.length > 0) {
            try {
              const report = await svc.getReport({
                ...base,
                ids: `channel==${channelId}`,
                filters: `playlist==${missing.join(',')}`,
              });
              parsePlaylistViewsReport(report, map);
            } catch {
              // Per-playlist fallback if the batched filter call fails (too many IDs, etc.)
              for (const id of missing) {
                try {
                  const r = await svc.getReport({
                    channelId,
                    ids: `channel==${channelId}`,
                    startDate: start,
                    endDate: end,
                    metrics: 'playlistViews',
                    dimensions: 'day',
                    filters: `playlist==${id}`,
                  });
                  const viewsIdx = r.columnHeaders.findIndex((h) => h.name === 'playlistViews');
                  const total = (r.rows || []).reduce(
                    (s, row) => s + (Number(row[viewsIdx]) || 0),
                    0,
                  );
                  if (total > 0) map[id] = total;
                } catch {
                  /* best-effort */
                }
              }
            }
          }
          return map;
        };

        /** Non-overlapping current + previous bounds for a window (mirrors backend computePeriodWindow). */
        const periodBounds = (days: number) => {
          const startCurr = endRef.subtract(days - 1, 'day');
          const endPrev = startCurr.subtract(1, 'day');
          const startPrev = endPrev.subtract(days - 1, 'day');
          return {
            curr: { startDate: startCurr.format('YYYY-MM-DD'), endDate: endRef.format('YYYY-MM-DD') },
            prev: { startDate: startPrev.format('YYYY-MM-DD'), endDate: endPrev.format('YYYY-MM-DD') },
          };
        };

        const periodKeys = [
          { key: 'd7', days: 7 },
          { key: 'd30', days: 30 },
          { key: 'd90', days: 90 },
        ] as const;
        for (const { key, days } of periodKeys) {
          const b = periodBounds(days);
          const [currentMap, previousMap] = await Promise.all([
            fetchWindowViews(b.curr.startDate, b.curr.endDate),
            fetchWindowViews(b.prev.startDate, b.prev.endDate),
          ]);
          for (const id of ids) {
            const base = next[id] ?? {
              d7: { current: 0, previous: 0 },
              d30: { current: 0, previous: 0 },
              d90: { current: 0, previous: 0 },
            };
            next[id] = { ...base, [key]: { current: currentMap[id] ?? 0, previous: previousMap[id] ?? 0 } };
          }
        }
        if (!cancelled) setPlaylistPerformance(next);
      } finally {
        if (!cancelled) setLoadingPerformance(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [open, channelId, playlists, allTokens, isPersonalContext, currentOrganization, user?.email]);

  // Admin mode: load playlists from an arbitrary channel ID the admin types in.
  const handleLoadCustomChannel = () => {
    const id = customChannelId.trim();
    if (!id) return;
    setChannelId(id);
  };

  const togglePlaylist = (playlistId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(playlistId)) next.delete(playlistId);
      else next.add(playlistId);
      return next;
    });
  };

  const handleConfirm = useCallback(async () => {
    if (selectedIds.size === 0 || !channelId) return;

    setFetchingVideos(true);
    setError(null);

    try {
      const accessToken = allTokens.find((t) => t.channelId === channelId)?.accessToken || null;
      const orgId = !isPersonalContext && currentOrganization ? currentOrganization.id : null;
      const service = new YouTubeService(user?.email || '', accessToken, orgId);

      // Fetch videos from all selected playlists in parallel
      const selectedPlaylists = playlists.filter((p) => selectedIds.has(p.id));
      const results = await Promise.allSettled(
        selectedPlaylists.map((pl) =>
          service.fetchPlaylistItems(pl.id, 50, false).then((videos) => ({
            playlist: pl,
            videos,
          })),
        ),
      );

      // Flatten all videos, attaching their source playlist's metadata
      // (title, description, tags, video count) so the analyzer can optimize
      // the playlist's actual current state, not just the videos.
      const allVideos: Video[] = [];
      for (const result of results) {
        if (result.status === 'fulfilled') {
          const pl = result.value.playlist;
          for (const v of result.value.videos) {
            allVideos.push({
              id: v.videoId,
              videoId: v.videoId,
              originalPlaylistId: pl.id,
              title: v.title,
              url: `https://youtube.com/watch?v=${v.videoId}`,
              // Real per-video publish date + all-time views power the
              // time-decay weighting (newest + best performing first).
              publishDate: v.publishedAt,
              views: v.viewCount,
              channelTitle: v.channelTitle,
              customMetadata: {
                originalPlaylistId: pl.id,
                originalPlaylistTitle: pl.title,
                originalPlaylistDescription: pl.description || '',
                originalPlaylistTags: pl.keywords || [],
                originalPlaylistVideoCount: pl.itemCount,
                originalPlaylistViews7: playlistPerformance[pl.id]?.d7.current,
                originalPlaylistViews7Prev: playlistPerformance[pl.id]?.d7.previous,
                originalPlaylistViews30: playlistPerformance[pl.id]?.d30.current,
                originalPlaylistViews30Prev: playlistPerformance[pl.id]?.d30.previous,
                originalPlaylistViews90: playlistPerformance[pl.id]?.d90.current,
                originalPlaylistViews90Prev: playlistPerformance[pl.id]?.d90.previous,
              },
            });
          }
        }
      }

      onConfirm(allVideos);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch playlist videos');
    } finally {
      setFetchingVideos(false);
    }
  }, [selectedIds, playlists, playlistPerformance, channelId, allTokens, isPersonalContext, currentOrganization, user?.email, onConfirm]);

  const handleClose = () => {
    if (!loading && !fetchingVideos) onClose();
  };

  const totalVideosInSelected = playlists
    .filter((p) => selectedIds.has(p.id))
    .reduce((sum, p) => sum + (p.itemCount || 0), 0);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth={false}
      PaperProps={{
        sx: {
          width: '70vw',
          minWidth: '70vw',
          maxWidth: 'calc(100vw - 2rem)',
          minHeight: 420,
          maxHeight: 640,
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      {/* ── Header: channel selector ───────────────────────────────── */}
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 2.5,
          py: 1.5,
          fontSize: 'var(--rt-text-md)',
          fontWeight: 'var(--rt-weight-bold)',
          color: 'var(--rt-color-text)',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <Play size={18} style={{ color: 'var(--rt-color-accent)', flexShrink: 0 }} />
          {channels.length === 0 ? (
            <Typography variant="body2" sx={{ color: 'var(--rt-color-text-muted)', fontSize: 'var(--rt-text-sm)' }}>
              No channels connected
            </Typography>
          ) : (
                        <Select
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              size="small"
              disabled={loading || fetchingVideos}
              contentProps={{ className: 'z-[1400]' }}
              sx={{
                fontSize: 'var(--rt-text-sm)',
                fontWeight: 600,
                minWidth: 180,
                maxWidth: 300,
                opacity: loading || fetchingVideos ? 0.7 : 1,
              }}
            >
              {allowAnyChannel && channelId && !channels.some((c) => c.id === channelId) && (
                <MenuItem value={channelId}>Custom: {channelId}</MenuItem>
              )}
              {channels.map((ch) => (
                <MenuItem key={ch.id} value={ch.id}>
                  {ch.title}
                </MenuItem>
              ))}
            </Select>
          )}
        </Box>
        <Box
          component="button"
          onClick={handleClose}
          aria-label="Close"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--rt-color-text-tertiary)',
            padding: 4,
            display: 'flex',
          }}
        >
          <X size={18} />
        </Box>
      </DialogTitle>

      {/* ── Content ─────────────────────────────────────────────────── */}
      <DialogBody sx={{ px: 2.5, py: 1, flex: 1, overflow: 'auto' }}>
        {/* Admin mode: load playlists from any channel by entering its ID */}
        {allowAnyChannel && (
          <Box sx={{ display: 'flex', gap: 1, mb: 2, alignItems: 'center' }}>
            <TextField
              fullWidth
              size="small"
              label="Or enter any channel ID (UC...)"
              placeholder="e.g. UCX6OQ3DkcsbYNE6H8uQQuVA"
              value={customChannelId}
              onChange={(e) => setCustomChannelId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleLoadCustomChannel();
              }}
              disabled={loading || fetchingVideos}
            />
            <Button
              variant="outlined"
              size="small"
              onClick={handleLoadCustomChannel}
              disabled={loading || fetchingVideos || !customChannelId.trim()}
              sx={{
                textTransform: 'none',
                whiteSpace: 'nowrap',
                fontSize: 'var(--rt-text-xs)',
                borderColor: 'var(--rt-color-accent)',
                color: 'var(--rt-color-accent)',
                flexShrink: 0,
              }}
            >
              Load
            </Button>
          </Box>
        )}
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <Spinner size={32} />
          </Box>
        ) : error ? (
          <Box
            sx={{
              py: 6,
              textAlign: 'center',
              color: 'var(--rt-color-danger)',
              fontSize: 'var(--rt-text-sm)',
            }}
          >
            <AlertCircle size={20} style={{ margin: '0 auto 8px' }} />
            {error}
          </Box>
        ) : playlists.length === 0 ? (
          <EmptyState
            variant="zero"
            title="No Playlists Found"
            description="No playlists found for this channel."
          />
        ) : (
          (() => {
            const isOpt = (id: string) => optimizedPlaylistIds?.has(id) ?? false;
            const visible =
              optimizedFilter === 'all'
                ? playlists
                : playlists.filter((p) =>
                    optimizedFilter === 'only' ? isOpt(p.id) : !isOpt(p.id),
                  );
            const optimizedCount = playlists.filter((p) => isOpt(p.id)).length;
            if (visible.length === 0 && optimizedFilter !== 'all') {
              return (
                <EmptyState
                  variant="no-results"
                  title="No Matching Playlists"
                  description={optimizedFilter === 'only'
                    ? 'No optimized playlists found for this channel.'
                    : 'All playlists for this channel are already optimized.'}
                />
              );
            }
            return (
          <>
            {/* Select All bar */}
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 0.5,
                py: 0.5,
                mb: 0.5,
                borderBottom: '1px solid var(--rt-color-border)',
              }}
            >
              <Checkbox
                size="small"
                checked={selectedIds.size === visible.length && visible.length > 0}
                indeterminate={selectedIds.size > 0 && selectedIds.size < visible.length}
                onChange={() => {
                  if (selectedIds.size === visible.length) {
                    setSelectedIds(new Set());
                  } else {
                    setSelectedIds(new Set(visible.map((p) => p.id)));
                  }
                }}
                sx={{ py: 0 }}
              />
              <Typography
                variant="caption"
                sx={{
                  color: 'var(--rt-color-text-secondary)',
                  cursor: 'pointer',
                  userSelect: 'none',
                  flex: 1,
                }}
                onClick={() => {
                  if (selectedIds.size === visible.length) {
                    setSelectedIds(new Set());
                  } else {
                    setSelectedIds(new Set(visible.map((p) => p.id)));
                  }
                }}
              >
                {selectedIds.size > 0
                  ? `${selectedIds.size} playlist${selectedIds.size !== 1 ? 's' : ''} selected`
                  : `Select all ${visible.length} playlist${visible.length !== 1 ? 's' : ''}`}
              </Typography>
              {optimizedCount > 0 && (
                <>
                  <Tooltip title="Show only playlists already in the Optimized list">
                    <Chip
                      label={`Optimized only (${optimizedCount})`}
                      size="small"
                      variant={optimizedFilter === 'only' ? 'filled' : 'outlined'}
                      onClick={() => setOptimizedFilter(optimizedFilter === 'only' ? 'all' : 'only')}
                      sx={{ height: 22, fontSize: 'var(--rt-text-2xs)', cursor: 'pointer' }}
                    />
                  </Tooltip>
                  <Tooltip title="Hide playlists already in the Optimized list">
                    <Chip
                      label="Exclude optimized"
                      size="small"
                      variant={optimizedFilter === 'exclude' ? 'filled' : 'outlined'}
                      onClick={() => setOptimizedFilter(optimizedFilter === 'exclude' ? 'all' : 'exclude')}
                      sx={{ height: 22, fontSize: 'var(--rt-text-2xs)', cursor: 'pointer' }}
                    />
                  </Tooltip>
                </>
              )}
            </Box>

            <List dense disablePadding>
              {visible.map((pl) => {
                const isChecked = selectedIds.has(pl.id);
                const isOptimized = optimizedPlaylistIds?.has(pl.id) ?? false;
                return (
                  <ListItem
                    key={pl.id}
                    disablePadding
                    sx={{
                      borderRadius: 'var(--rt-radius-sm)',
                      mb: 0.5,
                      bgcolor: isChecked ? 'var(--rt-color-accent-soft)' : 'transparent',
                      '&:hover': { bgcolor: 'var(--rt-color-bg-subtle)' },
                    }}
                  >
                    <ListItemButton
                      dense
                      onClick={() => togglePlaylist(pl.id)}
                      sx={{ borderRadius: 'var(--rt-radius-sm)', py: 0.75 }}
                    >
                      <Checkbox
                        edge="start"
                        checked={isChecked}
                        size="small"
                        sx={{ py: 0, pr: 1 }}
                      />
                      <ListItemText
                        primary={pl.title}
                        primaryTypographyProps={{
                          variant: 'body2',
                          sx: {
                            fontSize: 'var(--rt-text-xs)',
                            lineHeight: 1.3,
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            color: 'var(--rt-color-text)',
                          },
                        }}
                        secondary={pl.itemCount ? `${pl.itemCount} video${pl.itemCount !== 1 ? 's' : ''}` : 'Unknown'}
                        secondaryTypographyProps={{
                          variant: 'caption',
                          sx: { color: 'var(--rt-color-text-muted)' },
                        }}
                      />
                      {isOptimized && (
                        <Tooltip title="Already in the Optimized list">
                          <CheckCircle2
                            size={16}
                            style={{ color: 'var(--rt-color-success)', flexShrink: 0, marginLeft: 4 }}
                          />
                        </Tooltip>
                      )}
                      <Box
                        component="span"
                        sx={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'flex-end',
                          gap: 0.25,
                          ml: 1,
                          flexShrink: 0,
                          minWidth: 88,
                        }}
                      >
                        {loadingPerformance ? (
                          <Spinner size={14} sx={{ color: 'var(--rt-color-text-tertiary)' }} />
                        ) : (
                          (
                            [
                              ['7d', playlistPerformance[pl.id]?.d7],
                              ['30d', playlistPerformance[pl.id]?.d30],
                              ['90d', playlistPerformance[pl.id]?.d90],
                            ] as Array<[string, PeriodDelta | undefined]>
                          ).map(([label, perf]) => {
                            const pct = perf ? deltaPct(perf.current, perf.previous) : null;
                            const tone = deltaTone(pct);
                            const color =
                              tone === 'up'
                                ? 'var(--rt-color-success)'
                                : tone === 'down'
                                  ? 'var(--rt-color-danger)'
                                  : 'var(--rt-color-text-tertiary)';
                            return (
                              <Box
                                key={label}
                                component="span"
                                sx={{
                                  fontSize: 'var(--rt-text-2xs)',
                                  color,
                                  whiteSpace: 'nowrap',
                                  fontWeight: tone === 'up' || tone === 'down' ? 600 : 400,
                                }}
                              >
                                {label} {formatDelta(pct)}
                              </Box>
                            );
                          })
                        )}
                      </Box>
                    </ListItemButton>
                  </ListItem>
                );
              })}
            </List>
          </>
            );
          })()
        )}
      </DialogBody>

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <Box
        sx={{
          px: 2.5,
          py: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
        }}
      >
        <Box sx={{ fontSize: 'var(--rt-text-xs)', color: 'var(--rt-color-text-secondary)' }}>
          {!loading && playlists.length > 0 && (
            <>
              {playlists.length} playlist{playlists.length !== 1 ? 's' : ''}
              {selectedIds.size > 0 && (
                <Chip
                  label={`~${totalVideosInSelected} video${totalVideosInSelected !== 1 ? 's' : ''} to fetch`}
                  size="small"
                  color="primary"
                  sx={{ ml: 1, height: 20, fontSize: 'var(--rt-text-2xs)' }}
                />
              )}
            </>
          )}
        </Box>
      </Box>

      {/* ── Actions ─────────────────────────────────────────────────── */}
      <DialogActions sx={{ px: 'var(--rt-space-5)', py: 'var(--rt-space-4)' }}>
        <Button
          variant="ghost"
          onClick={handleClose}
          disabled={loading || fetchingVideos}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleConfirm}
          disabled={selectedIds.size === 0 || loading || fetchingVideos || isLoading}
          startIcon={fetchingVideos ? <Spinner size={14} color="inherit" /> : undefined}
        >
          {fetchingVideos ? 'Fetching Videos...' : `Load ${selectedIds.size} Playlist${selectedIds.size !== 1 ? 's' : ''}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

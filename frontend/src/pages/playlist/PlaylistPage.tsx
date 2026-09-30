import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { YouTubeService } from '../../services/youtubeService';
import type { VideoMetadata, PlaylistMetadata } from '../../types/youtube';
import { VideoTable } from '../../components/VideoTable';
import { VideoDetailDialog } from '../../components/VideoDetailDialog';
import { exportToCSV, generateCSVContent } from '../../utils/csvExport';
import { useAuth } from '../../hooks/useAuth';
import { useOrganization } from '../../hooks/useOrganization';
import { useUsage } from '../../hooks/useUsage';
import { saveRecentPlaylist, getRecentPlaylists, getRecentChannels, type RecentPlaylist, type RecentChannel } from '../../services/recentsService';
import { AutocompleteInput } from '../../components/AutocompleteInput';
import { MdPlaylistPlay } from 'react-icons/md';
import { UsageLimitError } from '../../services/analyticsService';
import { UsageLimitBanner } from '../../components/UsageLimitBanner';
import { toast } from 'react-hot-toast';
import './PlaylistPage.css';
import { EmptyState } from '../../components/EmptyState';
import {
  Button, Form, FormField, FormActions, FormHint,
  Input, ShadcnSelect, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '../../components/ui';
import { DataExplorerShell } from '../../components/shells';

const CACHE_KEY = 'playlist_page_cache';
const LAST_SESSION_KEY = 'playlist_page_last_session';
const CACHE_DURATION = 24 * 60 * 60 * 1000;

const LIMIT_PRESETS = [
  { value: '50', label: '50' },
  { value: '100', label: '100' },
  { value: '200', label: '200' },
  { value: '300', label: '300' },
  { value: 'all', label: 'All' },
  { value: 'custom', label: 'Custom' },
] as const;

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'title-asc', label: 'Title A–Z' },
  { value: 'title-desc', label: 'Title Z–A' },
  { value: 'items-desc', label: 'Most videos' },
  { value: 'items-asc', label: 'Fewest videos' },
] as const;

const PLAYLISTS_PER_PAGE = 20;

interface VideoWithSource extends VideoMetadata {
  sourcePlaylistIds: string[];
}

interface CachedData {
  inputValue: string;
  limitPreset: string;
  customLimit: number;
  videos: VideoWithSource[];
  playlistMetadata?: PlaylistMetadata | null;
  resolvedPlaylistId: string;
  timestamp: number;
}

const loadCache = (playlistInput?: string, orgId?: string): CachedData | null => {
  try {
    const orgSuffix = orgId ? `::org:${orgId}` : '';
    const cacheKey = playlistInput ? `${CACHE_KEY}_${playlistInput}${orgSuffix}` : `${LAST_SESSION_KEY}${orgSuffix}`;
    const cached = localStorage.getItem(cacheKey);
    if (!cached) {
      if (playlistInput) return loadCache(undefined, orgId);
      return null;
    }

    const data: CachedData = JSON.parse(cached);
    const now = Date.now();

    if (now - data.timestamp > CACHE_DURATION) {
      localStorage.removeItem(cacheKey);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Failed to load cache:', error);
    return null;
  }
};

const saveCache = (data: Omit<CachedData, 'timestamp'>, orgId?: string) => {
  try {
    const orgSuffix = orgId ? `::org:${orgId}` : '';
    const cacheData: CachedData = {
      ...data,
      timestamp: Date.now()
    };
    if (data.inputValue) {
      localStorage.setItem(`${CACHE_KEY}_${data.inputValue}${orgSuffix}`, JSON.stringify(cacheData));
    }
    localStorage.setItem(`${LAST_SESSION_KEY}${orgSuffix}`, JSON.stringify(cacheData));
  } catch (error) {
    console.error('Failed to save cache:', error);
  }
};

/** Detect if input looks like a playlist URL/ID or a channel handle/URL */
const detectInputType = (input: string): 'playlist' | 'channel' => {
  const t = input.trim();
  if (t.startsWith('PL') || t.startsWith('FL') || t.startsWith('RD') || t.startsWith('OL') || t.startsWith('LL')) return 'playlist';
  if (t.includes('list=')) return 'playlist';
  if (/youtube\.com\/playlist/i.test(t)) return 'playlist';
  return 'channel';
};

export const PlaylistPage = () => {
  const { user, accessToken } = useAuth();
  const { currentOrganization } = useOrganization();
  const { invalidateUsage } = useUsage();
  const [searchParams, setSearchParams] = useSearchParams();
  const isInitialMount = useRef(true);
  const hasFetchedFromUrl = useRef(false);
  const videoTableRef = useRef<HTMLDivElement>(null);

  const urlPlaylist = searchParams.get('playlist') || '';
  const cachedData = loadCache(urlPlaylist, currentOrganization?.id) || loadCache(undefined, currentOrganization?.id);

  // Single unified input
  const [smartInput, setSmartInput]     = useState(cachedData?.inputValue || urlPlaylist || '');
  const [limitPreset, setLimitPreset]   = useState<string>(cachedData?.limitPreset ?? '50');
  const [customLimit, setCustomLimit]   = useState<number>(cachedData?.customLimit ?? 150);

  // Video state
  const [videos, setVideos]           = useState<VideoWithSource[]>(cachedData?.videos || []);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [usageError, setUsageError]   = useState<{limit: number, used: number, message: string, pageKey?: string} | null>(null);
  const [resolvedPlaylistId, setResolvedPlaylistId] = useState(cachedData?.resolvedPlaylistId || '');
  const [playlistMetadata, setPlaylistMetadata]     = useState<PlaylistMetadata | null>(cachedData?.playlistMetadata || null);
  const [filterByVideos, setFilterByVideos]         = useState(false);
  const [selectedVideos, setSelectedVideos]         = useState<Set<string>>(() => {
    if (cachedData?.videos?.length) return new Set(cachedData.videos.map(v => v.videoId));
    return new Set();
  });

  // Channel browse state
  const [channelPlaylists, setChannelPlaylists]           = useState<PlaylistMetadata[]>([]);
  const [loadingChannelPlaylists, setLoadingChannelPlaylists] = useState(false);
  const [channelError, setChannelError]                   = useState<string | null>(null);
  const [selectedPlaylistId, setSelectedPlaylistId]       = useState<string | null>(null);
  const [channelSortBy, setChannelSortBy]                 = useState<string>('newest');
  const [channelPage, setChannelPage]                     = useState(1);
  // Server-paged catalog mirrors (rendered): total known from page one,
  // rows accumulate as Next/numbered pages fetch more.
  const [channelPlaylistsTotal, setChannelPlaylistsTotal] = useState<number | null>(null);
  const [channelPlaylistsHasMore, setChannelPlaylistsHasMore] = useState(false);
  const [loadingMoreChannelPlaylists, setLoadingMoreChannelPlaylists] = useState(false);
  const [channelCatalogCap, setChannelCatalogCap] = useState<number | undefined>(undefined);
  // Imperative browse cursor -- owns next-page/hasMore/loaded/dedupe so
  // load-more loops never act on stale closures.
  const channelBrowseRef = useRef<{
    channelId: string; nextPage: number; hasMore: boolean; loading: boolean;
    total: number; cap?: number; loaded: number; seen: Set<string>;
  }>({ channelId: '', nextPage: 1, hasMore: false, loading: false, total: 0, loaded: 0, seen: new Set() });

  // Recents
  const [recentPlaylists, setRecentPlaylists] = useState<RecentPlaylist[]>([]);
  const [recentChannels, setRecentChannels] = useState<RecentChannel[]>([]);
  const [selectedMetrics, setSelectedMetrics] = useState<Set<string>>(new Set(['viewCount', 'publishedAt', 'description']));
  const [filterByPlaylists, setFilterByPlaylists] = useState(false);
  const [detailVideo, setDetailVideo] = useState<VideoMetadata | null>(null);
  const [selectedPlaylistsFilter, setSelectedPlaylistsFilter] = useState<Set<string>>(new Set());

  const loadRecents = useCallback(async () => {
    if (user) {
      const [pls, chs] = await Promise.all([
        getRecentPlaylists(user.uid),
        getRecentChannels(user.uid)
      ]);
      setRecentPlaylists(pls);
      setRecentChannels(chs);
    }
  }, [user]);

  const updateUrlFromState = useCallback(() => {
    const params: Record<string, string> = {};
    if (smartInput) params.playlist = smartInput;
    setSearchParams(params, { replace: true });
  }, [smartInput, setSearchParams]);

  useEffect(() => {
    if (isInitialMount.current) { isInitialMount.current = false; return; }
    if (videos.length === 0) return;
    updateUrlFromState();
  }, [smartInput, updateUrlFromState, videos.length]);

  // ── Helpers ─────────────────────────────────────────────────
  const extractPlaylistId = (input: string): string => {
    const t = input.trim();
    for (const pat of [/[?&]list=([^&]+)/i, /youtube\.com\/playlist\?list=([^&]+)/i]) {
      const m = t.match(pat);
      if (m?.[1]) return m[1];
    }
    return t;
  };

  const resolveChannelId = async (service: YouTubeService, input: string): Promise<string> => {
    const t = input.trim();
    const chMatch = t.match(/youtube\.com\/channel\/([^/?&]+)/i);
    if (chMatch) return chMatch[1];
    const handleMatch = t.match(/youtube\.com\/@([^/?&]+)/i);
    const handle = handleMatch ? `@${handleMatch[1]}` : t;
    try {
      const pl = await service.getUploadsPlaylistFromHandle(handle);
      return 'UC' + pl.substring(2);
    } catch (handleErr) {
      if (handleErr instanceof UsageLimitError) throw handleErr;
      try {
        const pl = await service.getChannelByUsername(handle.replace('@', ''));
        return 'UC' + pl.substring(2);
      } catch (usernameErr) {
        if (usernameErr instanceof UsageLimitError) throw usernameErr;
        return await service.getChannelById(handle);
      }
    }
  };

  const loadPlaylistVideos = useCallback(
    async (playlistInput: string, preserveChannelBrowse = false) => {
      const isCustom = limitPreset === 'custom';
      const isAll = limitPreset === 'all';
      const actualMaxResults = isAll ? 50 : (isCustom ? customLimit : parseInt(limitPreset, 10));

      if (!isAll && (actualMaxResults <= 0 || isNaN(actualMaxResults))) {
        setError('Please enter a valid limit number');
        return;
      }
      setLoading(true);
      setError(null);
      setUsageError(null);
      setVideos([]);
      setResolvedPlaylistId('');
      if (!preserveChannelBrowse) {
        setChannelPlaylists([]);
        setSelectedPlaylistId(null);
        setSelectedPlaylistsFilter(new Set());
        setFilterByPlaylists(false);
      }

      try {
        const service = new YouTubeService(user?.email || '', accessToken, currentOrganization?.id || null);
        const playlistId = extractPlaylistId(playlistInput);
        setResolvedPlaylistId(playlistId);
        setPlaylistMetadata(null);

        const tagPlaylist = (v: VideoMetadata): VideoWithSource => ({
          ...v,
          sourcePlaylistIds: [playlistId],
        });

        const fetched = await service.fetchPlaylistItems(
          playlistId,
          actualMaxResults,
          isAll,
          (progress) => {
            const vws = progress.map(tagPlaylist);
            setVideos(vws);
            if (isAll) setSelectedVideos(new Set(vws.map(v => v.videoId)));
          }
        );

        const vws = fetched.map(tagPlaylist);
        setVideos(vws);
        setSelectedVideos(new Set(vws.map(v => v.videoId)));
        setSelectedPlaylistsFilter(new Set([playlistId]));
        setFilterByPlaylists(true);

        saveCache({ inputValue: playlistInput, limitPreset, customLimit: isCustom ? customLimit : 150, videos: vws, playlistMetadata: null, resolvedPlaylistId: playlistId }, currentOrganization?.id);

        try {
          const meta = await service.fetchPlaylistMetadata(playlistId);
          if (meta) {
            setPlaylistMetadata(meta);
            saveCache({ inputValue: playlistInput, limitPreset, customLimit: isCustom ? customLimit : 150, videos: vws, playlistMetadata: meta, resolvedPlaylistId: playlistId }, currentOrganization?.id);
          }
        } catch (err) {
          if (err instanceof UsageLimitError) throw err;
        }

        if (user && vws.length > 0) {
          const name = vws[0]?.channelTitle ? `Playlist - ${vws[0].channelTitle}` : playlistId;
          await saveRecentPlaylist(user.uid, playlistId, name);
          await loadRecents();
          window.dispatchEvent(new Event('refreshRecents'));
        }

        // Refresh the sidebar usage bar to reflect the incremented counter
        invalidateUsage();

        updateUrlFromState();

        setTimeout(() => videoTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
      } catch (err) {
        if (err instanceof UsageLimitError) {
          setUsageError({ limit: err.limit, used: err.used, message: err.message, pageKey: err.pageKey });
        } else {
          setError(err instanceof Error ? err.message : 'An unknown error occurred');
        }
      } finally {
        setLoading(false);
      }
    },
    [limitPreset, customLimit, user, accessToken, currentOrganization?.id, invalidateUsage, updateUrlFromState, loadRecents]
  );

  // ── Main "Go" handler -- routes by detected input type ───────
  const handleGo = useCallback(
    async (forcedInput?: string) => {
      const raw = (forcedInput ?? smartInput).trim();
      if (!raw) {
        setError('Please enter a channel handle, playlist URL, or playlist ID');
        return;
      }

      const type = detectInputType(raw);

      if (type === 'channel') {
        setChannelError(null);
        setChannelPlaylists([]);
        setChannelPlaylistsTotal(null);
        setChannelPlaylistsHasMore(false);
        setChannelCatalogCap(undefined);
        setChannelPage(1);
        setSelectedPlaylistId(null);
        setVideos([]);
        setError(null);
        setUsageError(null);
        setSelectedPlaylistsFilter(new Set());
        setFilterByPlaylists(false);
        setLoadingChannelPlaylists(true);
        try {
          const service = new YouTubeService(user?.email || '', accessToken, currentOrganization?.id || null);
          const channelId = await resolveChannelId(service, raw);
          // Catalog cap from the Limit preset ('all' = whole catalog, paged).
          const cap = limitPreset === 'all' ? undefined : (limitPreset === 'custom' ? customLimit : parseInt(limitPreset, 10));
          channelBrowseRef.current = { channelId, nextPage: 1, hasMore: true, loading: false, total: 0, cap, loaded: 0, seen: new Set() };
          setChannelCatalogCap(cap);
          // Page one only -- Next / numbered pages fetch more on demand.
          const result = await service.fetchChannelPlaylistPage(channelId, 1, PLAYLISTS_PER_PAGE);
          const browse = channelBrowseRef.current;
          browse.nextPage = 2;
          const withinCap = cap === undefined ? result.items : result.items.slice(0, cap);
          for (const p of withinCap) browse.seen.add(p.id);
          browse.loaded = withinCap.length;
          const more = result.hasMore && (cap === undefined || withinCap.length < cap);
          browse.hasMore = more;
          browse.total = result.total;
          setChannelPlaylistsTotal(result.total);
          setChannelPlaylistsHasMore(more);
          if (withinCap.length === 0) setChannelError('No public playlists found for this channel.');
          else setChannelPlaylists(withinCap);
        } catch (err) {
          if (err instanceof UsageLimitError) {
            setUsageError({ limit: err.limit, used: err.used, message: err.message, pageKey: err.pageKey });
          } else {
            setChannelError(err instanceof Error ? err.message : 'Could not find channel. Check the handle, URL, or ID.');
          }
        } finally {
          setLoadingChannelPlaylists(false);
        }
      } else {
        await loadPlaylistVideos(raw, false);
      }
    },
    [smartInput, user?.email, accessToken, currentOrganization?.id, loadPlaylistVideos, limitPreset, customLimit]
  );

  const handleSelectPlaylist = (playlist: PlaylistMetadata) => {
    setSelectedPlaylistId(playlist.id);
    setSmartInput(playlist.id);
    void loadPlaylistVideos(playlist.id, true);
  };

  // Auto-fetch from URL param on mount -- fires once
  // All setState calls are deferred via setTimeout to comply with the 
  // "no synchronous setState in effects" rule
  useEffect(() => {
    const param = searchParams.get('playlist');
    if (!param) return;
    if (hasFetchedFromUrl.current) return;
    hasFetchedFromUrl.current = true;
    if (param.startsWith('PL') || param.includes('youtube.com') || param.includes('list=')) {
      const cached = loadCache(param, currentOrganization?.id);
      if (cached?.inputValue === param && cached.videos.length > 0) {
        const pid = cached.resolvedPlaylistId || '';
        const restored = cached.videos.map(v => ({
          ...v,
          sourcePlaylistIds:
            v.sourcePlaylistIds && v.sourcePlaylistIds.length > 0 ? v.sourcePlaylistIds : pid ? [pid] : [],
        }));
        // Defer setState to next microtask to avoid synchronous setState in effect
        setTimeout(() => {
          setVideos(restored);
          setResolvedPlaylistId(pid);
          setLimitPreset(cached.limitPreset ?? '50');
          setCustomLimit(cached.customLimit ?? 150);
          setSelectedVideos(new Set(restored.map(v => v.videoId)));
          setPlaylistMetadata(cached.playlistMetadata || null);
          if (pid) {
            setSelectedPlaylistsFilter(new Set([pid]));
            setFilterByPlaylists(true);
          }
        }, 0);
      } else {
        setTimeout(() => loadPlaylistVideos(param), 0);
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Filtering ────────────────────────────────────────────────
  const filteredVideos = useMemo(() => {
    let list: VideoWithSource[] = videos;
    if (filterByPlaylists && selectedPlaylistsFilter.size > 0) {
      list = list.filter(
        v => v.sourcePlaylistIds?.some(id => selectedPlaylistsFilter.has(id))
      );
    }
    if (!filterByVideos || selectedVideos.size === 0) return list;
    return list.filter(v => selectedVideos.has(v.videoId));
  }, [videos, filterByPlaylists, selectedPlaylistsFilter, filterByVideos, selectedVideos]);

  // ── Export / Share ───────────────────────────────────────────
  const handleExportCSV = () => {
    if (!videos.length) return;
    const fname = resolvedPlaylistId
      ? `TubeKeter_Analytics-youtube-playlist-${resolvedPlaylistId}.csv`
      : 'TubeKeter_Analytics-youtube-playlist.csv';
    exportToCSV(filteredVideos, fname, true, playlistMetadata ? [playlistMetadata] : [], true, selectedMetrics);
  };

  const handleShare = async () => {
    try {
      const shareData: ShareData = {
        title: `Playlist: ${resolvedPlaylistId || smartInput}`,
        text: `See video metrics from playlist – ${filteredVideos.length} videos`,
        url: window.location.href
      };
      const csvContent = generateCSVContent(filteredVideos, true, playlistMetadata ? [playlistMetadata] : [], true, selectedMetrics);
      const file = csvContent ? new File([csvContent], `TubeKeter_Analytics-playlist.csv`, { type: 'text/csv' }) : undefined;
      if (file && navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ ...shareData, files: [file] }); return; } catch { /* fall through */ }
      }
      if (navigator.share) {
        try { await navigator.share(shareData); return; } catch { /* fall through */ }
      }
      await navigator.clipboard.writeText(window.location.href);
      toast.success('Link copied to clipboard!');
    } catch {
      try { await navigator.clipboard.writeText(window.location.href); toast.success('Link copied to clipboard!'); } catch { /* ignore */ }
    }
  };

  // ── Render ───────────────────────────────────────────────────
  const playlistsForTable = useMemo((): PlaylistMetadata[] => {
    if (playlistMetadata) return [playlistMetadata];
    return [];
  }, [playlistMetadata]);

  const isChannelMode = channelPlaylists.length > 0 || loadingChannelPlaylists;

  // ── Channel browse: server-paged catalog (Next fetches the next page) ──
  // Fetch the next catalog page and append it (deduped, cap-aware).
  // Returns whether more pages remain afterwards.
  const loadMoreChannelPlaylists = useCallback(async (): Promise<boolean> => {
    const browse = channelBrowseRef.current;
    if (!browse.channelId || !browse.hasMore || browse.loading) return browse.hasMore;
    browse.loading = true;
    setLoadingMoreChannelPlaylists(true);
    try {
      const service = new YouTubeService(user?.email || '', accessToken, currentOrganization?.id || null);
      const result = await service.fetchChannelPlaylistPage(browse.channelId, browse.nextPage, PLAYLISTS_PER_PAGE);
      browse.nextPage += 1;
      const fresh = result.items.filter((p) => {
        if (browse.seen.has(p.id)) return false;
        browse.seen.add(p.id);
        return true;
      });
      browse.loaded += fresh.length;
      const more = result.hasMore && (browse.cap === undefined || browse.loaded < browse.cap);
      browse.hasMore = more;
      browse.total = result.total;
      setChannelPlaylists((prev) => {
        const merged = [...prev, ...fresh];
        return browse.cap === undefined ? merged : merged.slice(0, browse.cap);
      });
      setChannelPlaylistsTotal(result.total);
      setChannelPlaylistsHasMore(more);
      return more;
    } catch (err) {
      if (err instanceof UsageLimitError) {
        setUsageError({ limit: err.limit, used: err.used, message: err.message, pageKey: err.pageKey });
      } else if (browse.loaded === 0) {
        setChannelError(err instanceof Error ? err.message : 'Could not load more playlists.');
      }
      return browse.hasMore;
    } finally {
      browse.loading = false;
      setLoadingMoreChannelPlaylists(false);
    }
  }, [user, accessToken, currentOrganization]);

  // Drain every remaining catalog page (non-newest sorts need the full set to sort correctly).
  const drainChannelCatalog = useCallback(async () => {
    let guard = 0;
    while (channelBrowseRef.current.hasMore && guard < 50) {
      guard += 1;
      const more = await loadMoreChannelPlaylists();
      if (!more) break;
    }
  }, [loadMoreChannelPlaylists]);

  // Jump to page N, fetching whatever catalog pages it needs first.
  const goToChannelPage = useCallback(async (pageNum: number) => {
    const browse = channelBrowseRef.current;
    const target = Math.max(1, pageNum);
    const effectiveTotal = Math.min(browse.total || 0, browse.cap ?? Number.POSITIVE_INFINITY);
    let guard = 0;
    while (browse.hasMore && browse.loaded < Math.min(target * PLAYLISTS_PER_PAGE, effectiveTotal) && guard < 50) {
      guard += 1;
      const more = await loadMoreChannelPlaylists();
      if (!more) break;
    }
    setChannelPage(target);
  }, [loadMoreChannelPlaylists]);

  // Non-newest sorts reorder the whole catalog, so drain it first -- the
  // default 'newest' order matches the server and stays incremental.
  const handleChannelSortChange = useCallback(async (value: string) => {
    setChannelSortBy(value);
    setChannelPage(1);
    if (value !== 'newest' && channelBrowseRef.current.hasMore) {
      await drainChannelCatalog();
    }
  }, [drainChannelCatalog]);

  // ── Sort + Paginate channel playlists ──────────────────────
  const sortedChannelPlaylists = useMemo(() => {
    const list = [...channelPlaylists];
    switch (channelSortBy) {
      case 'newest':
        return list.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
      case 'oldest':
        return list.sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime());
      case 'title-asc':
        return list.sort((a, b) => a.title.localeCompare(b.title));
      case 'title-desc':
        return list.sort((a, b) => b.title.localeCompare(a.title));
      case 'items-desc':
        return list.sort((a, b) => b.itemCount - a.itemCount);
      case 'items-asc':
        return list.sort((a, b) => a.itemCount - b.itemCount);
      default:
        return list;
    }
  }, [channelPlaylists, channelSortBy]);

  // Effective catalog size: backend total clamped by the Limit-preset cap.
  // Page numbers come from this (not just loaded rows) so "page 4 of 4" is
  // right on the first paint; jumping ahead fetches what it needs.
  // Once fully loaded (no more pages), the enumerated rows are ground truth:
  // clamp a stale-high backend total down so the count can never exceed
  // the playlists that actually exist.
  const channelEffectiveTotal = channelPlaylistsTotal !== null && !channelPlaylistsHasMore
    ? channelPlaylists.length
    : channelPlaylistsTotal !== null
      ? Math.min(channelPlaylistsTotal, channelCatalogCap ?? Number.POSITIVE_INFINITY)
      : channelPlaylists.length;
  const totalPages = Math.max(1, Math.ceil(Math.max(channelEffectiveTotal, channelPlaylists.length) / PLAYLISTS_PER_PAGE));
  const paginatedPlaylists = useMemo(() => {
    const start = (channelPage - 1) * PLAYLISTS_PER_PAGE;
    return sortedChannelPlaylists.slice(start, start + PLAYLISTS_PER_PAGE);
  }, [sortedChannelPlaylists, channelPage]);

  return (
    <DataExplorerShell
      title="Playlist"
      description="Open a playlist by URL or ID, or list playlists from a channel."
      icon={<MdPlaylistPlay size={20} />}
      alerts={
        (error || channelError) ? (
          <div className="alert alert-error">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="15" y1="9" x2="9" y2="15"></line>
              <line x1="9" y1="9" x2="15" y2="15"></line>
            </svg>
            <div className="alert-content">
              <h4>Error</h4>
              <p>{error || channelError}</p>
            </div>
          </div>
        ) : null
      }
      usageLimit={
        usageError ? (
          <UsageLimitBanner
            limit={usageError.limit}
            used={usageError.used}
            message={usageError.message}
            pageLabel={usageError.pageKey || "Playlists"}
          />
        ) : null
      }
      toolbar={
        <>
          <Form layout="toolbar">
            <FormField variant="main">
              <AutocompleteInput
                id="smartInput"
                aria-label="Channel handle, playlist URL, or playlist ID"
                value={smartInput}
                onChange={(val) => {
                  setSmartInput(val);
                  // Reset channel results when input changes
                  if (channelPlaylists.length > 0) setChannelPlaylists([]);
                  if (channelError) setChannelError(null);
                }}
                onSelect={(item) => { setSmartInput(item.value); handleGo(item.value); }}
                placeholder="@channel, youtube.com/..., or PLxxx..."
                suggestions={[
                  ...recentPlaylists.map(pl => ({
                    id: pl.id || pl.playlistId || 'unknown',
                    value: pl.playlistId || '',
                    label: pl.playlistName || pl.playlistId || 'Unknown Playlist',
                    sublabel: 'Recent Playlist'
                  })),
                  ...recentChannels.map(ch => ({
                    id: ch.id || ch.channelInput || 'unknown',
                    value: ch.channelInput || ch.id || '',
                    label: ch.channelName || ch.channelInput || 'Unknown Channel',
                    sublabel: 'Recent Channel'
                  }))
                ]}
                disabled={loading || loadingChannelPlaylists}
              />
            </FormField>

            <FormField variant="limit" label="Limit" htmlFor="limitPreset">
              <ShadcnSelect value={limitPreset} onValueChange={setLimitPreset}>
                <SelectTrigger id="limitPreset" aria-label="Limit" size="sm" className="w-[100px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LIMIT_PRESETS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </ShadcnSelect>
              {limitPreset === 'custom' && (
                <Input
                  id="customLimit"
                  type="number"
                  compact
                  aria-label="Custom limit"
                  min={1}
                  className="w-[90px]"
                  value={customLimit}
                  onChange={(e) => setCustomLimit(parseInt(e.target.value) || 1)}
                />
              )}
            </FormField>

            <FormActions>
              <Button
                variant="primary"
                onClick={() => handleGo()}
                disabled={loading || loadingChannelPlaylists}
              >
                {(loading || loadingChannelPlaylists) ? (
                  <><div className="spinner-small"></div>{loadingChannelPlaylists ? 'Loading...' : 'Fetching...'}</>
                ) : (
                  <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>Fetch Playlists</>
                )}
              </Button>
            </FormActions>
          </Form>

          <FormHint>
            {detectInputType(smartInput) === 'channel' && smartInput
              ? '↳ Channel detected -- will browse playlists'
              : detectInputType(smartInput) === 'playlist' && smartInput
              ? '↳ Playlist detected -- will load videos directly'
              : 'Enter a channel handle (@username) to browse playlists, or a playlist URL/ID to load videos directly'}
          </FormHint>
        </>
      }
    >

      {/* ── Channel Playlist Picker ── */}
      {isChannelMode && (
        <div className="channel-playlists-section">
          {loadingChannelPlaylists ? (
            <div className="loading-container">
              <div className="loading-spinner"></div>
              <p>Loading playlists...</p>
            </div>
          ) : channelPlaylists.length === 0 ? (
            <EmptyState
              variant="no-results"
              title="No Playlists Found"
              description="No public playlists were found for this channel."
            />
          ) : (
            <>
              <div className="channel-playlists-toolbar">
                <p className="channel-playlists-count">
  {channelPlaylistsTotal !== null && channelPlaylistsTotal > channelPlaylists.length
    ? `${channelPlaylists.length} of ${channelEffectiveTotal} playlists loaded`
    : `${channelPlaylists.length} playlist${channelPlaylists.length !== 1 ? 's' : ''} found`}
  {limitPreset !== 'all' && limitPreset !== 'custom' && ` (limit: ${limitPreset})`}
  {limitPreset === 'custom' && ` (limit: ${customLimit})`}
  {` -- page ${channelPage} of ${totalPages}`}
  {channelPlaylistsHasMore && ' · more in catalog — press Next to load'}
  {loadingMoreChannelPlaylists && ' · loading…'}
</p>
                <div className="channel-playlists-sort">
                  <label className="form-label-sort" htmlFor="channelSortBy">Sort</label>
                  <select
                    id="channelSortBy"
                    className="sort-select"
                    value={channelSortBy}
                    onChange={(e) => void handleChannelSortChange(e.target.value)}
                  >
                    {SORT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="channel-playlists-grid">
                {paginatedPlaylists.map((playlist) => (
                  <div
                    key={playlist.id}
                    className={`playlist-card ${selectedPlaylistId === playlist.id ? 'selected' : ''}`}
                    onClick={() => handleSelectPlaylist(playlist)}
                    title={playlist.title}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleSelectPlaylist(playlist);
                      }
                    }}
                  >
                    {selectedPlaylistId === playlist.id && (
                      <span className="playlist-card-check" aria-hidden>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      </span>
                    )}
                    {selectedPlaylistId === playlist.id && loading && (
                      <span className="playlist-card-loading" title="Loading videos…">
                        <div className="spinner-small"></div>
                      </span>
                    )}
                    <div className="playlist-card-thumb">
                      {playlist.thumbnailUrl
                        ? <img src={playlist.thumbnailUrl} alt={playlist.title} referrerPolicy="no-referrer" />
                        : <div className="playlist-card-thumb-placeholder"><MdPlaylistPlay size={32} /></div>
                      }
                      <span className="playlist-card-count">{playlist.itemCount} videos</span>
                    </div>
                    <div className="playlist-card-info">
                      <p className="playlist-card-title">{playlist.title}</p>
                    </div>
                  </div>
                ))}
              </div>

              {totalPages > 1 && (
                <div className="channel-playlists-pagination">
                  <Button variant="ghost" size="sm" bare

                    disabled={channelPage <= 1 || loadingMoreChannelPlaylists}
                    onClick={() => setChannelPage(p => Math.max(1, p - 1))}
                  >
                    ‹ Prev
                  </Button>
                  <span className="pagination-info">
                    {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                      const startPage = Math.max(1, Math.min(channelPage - 3, totalPages - 6));
                      const page = startPage + i;
                      if (page <= totalPages) {
                        return (
                          <Button bare
                            key={page}
                            className={`pagination-page ${page === channelPage ? 'active' : ''}`}
                            disabled={loadingMoreChannelPlaylists}
                            onClick={() => void goToChannelPage(page)}
                          >
                            {page}
                          </Button>
                        );
                      }
                      return null;
                    })}
                    {totalPages > 7 && channelPage < totalPages - 3 && (
                      <span className="pagination-ellipsis">…</span>
                    )}
                  </span>
                  <Button variant="ghost" size="sm" bare

                    disabled={(channelPage >= totalPages && !channelPlaylistsHasMore) || loadingMoreChannelPlaylists}
                    onClick={() => void goToChannelPage(channelPage + 1)}
                    title={channelPage >= totalPages && channelPlaylistsHasMore ? "Load more from catalog and go to next page" : "Next page"}
                  >
                    {loadingMoreChannelPlaylists ? 'Loading…' : 'Next ›'}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Loading indicator for video fetch ── */}
      {loading && (
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Fetching video metadata...</p>
        </div>
      )}

      {/* ── Playlist Metadata Card ── */}
      {playlistMetadata && (
        <div className="playlist-metadata">
          <div className="playlist-thumbnail">
            <img src={playlistMetadata.thumbnailUrl} alt={playlistMetadata.title} referrerPolicy="no-referrer" />
          </div>
          <div className="playlist-info">
            <h2 className="playlist-title">{playlistMetadata.title}</h2>
            <div className="playlist-meta-row">
              <span className="playlist-channel">{playlistMetadata.channelTitle}</span>
              <span>•</span>
              <span>{playlistMetadata.itemCount} videos</span>
              <span>•</span>
              <span>Updated {new Date(playlistMetadata.publishedAt).toLocaleDateString()}</span>
            </div>
            {playlistMetadata.description && (
              <p className="playlist-description">{playlistMetadata.description}</p>
            )}
            <a
              href={`https://www.youtube.com/playlist?list=${resolvedPlaylistId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rt-btn rt-btn--youtube rt-btn--sm playlist-youtube-cta"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
              </svg>
              View on YouTube
            </a>
          </div>
        </div>
      )}

      {/* ── Video Table ── */}
      {videos.length > 0 && !loading && (
        <div className="table-section" ref={videoTableRef}>
          <VideoTable
            videos={filteredVideos}
            showChannelColumn={true}
            onExportCSV={handleExportCSV}
            onShare={handleShare}
            sourceType="playlist"
            sourceName={videos[0]?.channelTitle || smartInput}
            playlists={playlistsForTable}
            showPlaylistColumn={playlistsForTable.length > 0}
            allVideos={videos}
            filterByPlaylists={filterByPlaylists}
            onFilterByPlaylistsChange={setFilterByPlaylists}
            selectedPlaylists={selectedPlaylistsFilter}
            onSelectedPlaylistsChange={setSelectedPlaylistsFilter}
            filterByVideos={filterByVideos}
            onFilterByVideosChange={setFilterByVideos}
            selectedVideos={selectedVideos}
            onSelectedVideosChange={setSelectedVideos}
            onLoadPlaylists={async () => {}}
            isLoadingPlaylists={false}
            showPlaylistFilter={playlistsForTable.length > 0}
            selectedMetrics={selectedMetrics}
            onSelectedMetricsChange={setSelectedMetrics}
            allowPrivateMetrics={false}
            onVideoClick={(v) => setDetailVideo(v)}
          />
        </div>
      )}

      {/* ── Empty State ── */}
      {!loading && !loadingChannelPlaylists && videos.length === 0 && channelPlaylists.length === 0 && !error && !channelError && (
        <EmptyState
          title="No Data Yet"
          description="Enter a channel handle to browse playlists, or paste a playlist URL to load videos directly."
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="9" y1="9" x2="15" y2="9"></line>
              <line x1="9" y1="15" x2="15" y2="15"></line>
            </svg>
          }
        />
      )}

      <VideoDetailDialog
        video={detailVideo}
        open={!!detailVideo}
        onClose={() => setDetailVideo(null)}
        accessToken={accessToken}
      />
    </DataExplorerShell>
  );
};
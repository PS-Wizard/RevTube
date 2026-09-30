import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { YouTubeService } from '../../services/youtubeService';
import type { VideoMetadata, PlaylistMetadata } from '../../types/youtube';
import { VideoTable } from '../../components/VideoTable';
import { VideoDetailDialog } from '../../components/VideoDetailDialog';
import { exportToCSV, generateCSVContent } from '../../utils/csvExport';
import { useAuth } from '../../hooks/useAuth';
import { useOrganization } from '../../hooks/useOrganization';
import { useVideoManagement } from '../../hooks/useVideoManagement';
import { useUsage } from '../../hooks/useUsage';
import { saveRecentChannel, getRecentChannels, type RecentChannel } from '../../services/recentsService';
import { AutocompleteInput } from '../../components/AutocompleteInput';
import { parseDuration } from '../../utils/timeUtils';
import { UsageLimitError } from '../../services/analyticsService';
import { UsageLimitBanner } from '../../components/UsageLimitBanner';
import { toast } from 'react-hot-toast';
import { Skeleton } from '../../components/Skeleton';
import { EmptyState } from '../../components/EmptyState';
import { ArrowDownToLine, ListChecks, Video } from 'lucide-react';
import { Button, Form, FormField, FormActions, FormHint, Alert, AlertTitle, AlertDescription, Box, Spinner, SegmentedControl } from '../../components/ui';
import { DataExplorerShell } from '../../components/shells';

const CACHE_KEY = 'videos_page_cache';
const LAST_SESSION_KEY = 'videos_page_last_session';
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Track which videos came from which playlists
interface VideoWithSource extends VideoMetadata {
  sourcePlaylistIds: string[];
}

interface CachedData {
  inputValue: string;
  maxResults: number | string;
  videos: VideoWithSource[];
  playlists: PlaylistMetadata[];
  channelIdCache: string;
  timestamp: number;
}

const loadCache = (channelInput?: string, orgId?: string): CachedData | null => {
  try {
    const orgSuffix = orgId ? `::org:${orgId}` : '';
    // Try to load specific cache first, then fall back to last session
    const cacheKey = channelInput ? `${CACHE_KEY}_${channelInput}${orgSuffix}` : `${LAST_SESSION_KEY}${orgSuffix}`;
    const cached = localStorage.getItem(cacheKey);
    if (!cached) {
      // If no specific cache, try last session
      if (channelInput) {
        return loadCache(undefined, orgId);
      }
      return null;
    }

    const data: CachedData = JSON.parse(cached);
    const now = Date.now();

    // Check if cache is still valid
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
    // Save to both specific cache and last session
    if (data.inputValue) {
      localStorage.setItem(`${CACHE_KEY}_${data.inputValue}${orgSuffix}`, JSON.stringify(cacheData));
    }
    localStorage.setItem(`${LAST_SESSION_KEY}${orgSuffix}`, JSON.stringify(cacheData));
  } catch (error) {
    console.error('Failed to save cache:', error);
  }
};

export const VideosPage = () => {
  const { user, accessToken } = useAuth();
  const { currentOrganization } = useOrganization();
  const { invalidateUsage } = useUsage();
  const { ready: vmReady, addVideos } = useVideoManagement();
  const [searchParams, setSearchParams] = useSearchParams();
  const hasFetchedFromUrl = useRef(false);
  const isInitialMount = useRef(true);
  // Removed: hasUrlVideoSelection - no longer using URL params for videos
  
  // Try to load from cache first - prioritize last session cache
  const urlChannel = searchParams.get('channel') || '';
  const cachedData = loadCache(urlChannel, currentOrganization?.id) || loadCache(undefined, currentOrganization?.id); // Load specific or last session
  
  // Initialize state from cache only (no URL params except channel)
  const [inputValue, setInputValue] = useState(cachedData?.inputValue || urlChannel || '');
  const [maxResults, setMaxResults] = useState<number | string>(cachedData?.maxResults ?? 50);
  const [fetchAll, setFetchAll] = useState(false);
  const [videos, setVideos] = useState<VideoWithSource[]>(cachedData?.videos || []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usageError, setUsageError] = useState<{limit: number, used: number, message: string, pageKey?: string} | null>(null);
  const [playlists, setPlaylists] = useState<PlaylistMetadata[]>(cachedData?.playlists || []);
  const [selectedPlaylists, setSelectedPlaylists] = useState<Set<string>>(() => {
    // Initialize from cache only
    if (cachedData?.playlists && cachedData.playlists.length > 0) {
      return new Set(cachedData.playlists.map(p => p.id));
    }
    return new Set();
  });
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);
  const [filterByPlaylists, setFilterByPlaylists] = useState(() => {
    // If we have cached playlists, enable filter by default
    return cachedData?.playlists && cachedData.playlists.length > 0 ? true : false;
  });
  const [filterByVideos, setFilterByVideos] = useState(false);
  const [selectedVideos, setSelectedVideos] = useState<Set<string>>(() => {
    // Initialize from cache only
    if (cachedData?.videos && cachedData.videos.length > 0) {
      return new Set(cachedData.videos.map(v => v.videoId));
    }
    return new Set();
  });
  const [channelIdCache, setChannelIdCache] = useState<string>(cachedData?.channelIdCache || '');
  const [recentChannels, setRecentChannels] = useState<RecentChannel[]>([]);
  const [videoTypeFilter] = useState<'all' | 'shorts' | 'long'>('all');
  const [selectedMetrics, setSelectedMetrics] = useState<Set<string>>(new Set(['viewCount', 'publishedAt', 'description']));
  const [selectedPlaylistMetas, setSelectedPlaylistMetas] = useState<Set<string>>(new Set(['title'])); // Default to 'title'
  const [detailVideo, setDetailVideo] = useState<VideoMetadata | null>(null);

  // Load recent channels when user is available
  const loadRecentChannels = useCallback(async () => {
    if (user) {
      const recents = await getRecentChannels(user.uid);
      setRecentChannels(recents);
    }
  }, [user]);

  useEffect(() => {
    loadRecentChannels();
  }, [loadRecentChannels]);

  // Update URL with only the channel parameter (clean URLs)
  const updateUrlFromState = useCallback(() => {
    const params: Record<string, string> = {};
    
    if (inputValue) params.channel = inputValue;
    
    setSearchParams(params, { replace: true });
  }, [inputValue, setSearchParams]);

  // Update URL when channel changes
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    // Only update URL when we have videos loaded
    if (videos.length === 0) return;

    updateUrlFromState();
  }, [inputValue, updateUrlFromState]);

  // Helper function to extract ID from YouTube URL
  const extractIdFromUrl = (input: string): { type: 'channel' | 'handle' | 'video' | 'raw', value: string } => {
    const trimmedInput = input.trim();

    // Check for video URL patterns first -- /watch?v=VIDEO_ID or youtu.be/VIDEO_ID
    const videoPatterns = [
      /youtube\.com\/watch\?v=([^&/?]+)/i,
      /youtu\.be\/([^&/?]+)/i,
      /youtube\.com\/embed\/([^&/?]+)/i,
      /youtube\.com\/v\/([^&/?]+)/i,
    ];
    for (const pattern of videoPatterns) {
      const match = trimmedInput.match(pattern);
      if (match && match[1]) {
        return { type: 'video', value: match[1] };
      }
    }

    // Check for channel URL patterns
    const channelPatterns = [
      /youtube\.com\/channel\/([^/?&]+)/i,
      /youtube\.com\/c\/([^/?&]+)/i,
      /youtube\.com\/@([^/?&]+)/i,
      /youtube\.com\/user\/([^/?&]+)/i,
    ];

    for (const pattern of channelPatterns) {
      const match = trimmedInput.match(pattern);
      if (match && match[1]) {
        const value = match[1];
        // Check if it's a handle (@username)
        if (pattern.source.includes('@') || trimmedInput.includes('/@')) {
          return { type: 'handle', value: value.startsWith('@') ? value : `@${value}` };
        }
        return { type: 'channel', value };
      }
    }

    // Return as-is if no URL pattern matched
    return { type: 'raw', value: trimmedInput };
  };

  const handleFetchVideos = useCallback(async (forcedId?: string) => {
    const channelInput = forcedId || inputValue;
    


    if (!channelInput.trim()) {
      setError('Please enter a valid Username/Handle or Channel ID');
      return;
    }

    // Validate maxResults
    if (maxResults === '' || maxResults === 0) {
      setError('Please enter a valid Max Results number');
      return;
    }

    setLoading(true);
    setError(null);
    setUsageError(null);
    // Clear stale data immediately so user sees loading spinner, not old data
    setVideos([]);
    setChannelIdCache('');
    setPlaylists([]);
    setSelectedPlaylists(new Set());

    try {
      const service = new YouTubeService(user?.email || '', accessToken, currentOrganization?.id || null);

      // Extract ID from URL if it's a URL
      const extracted = extractIdFromUrl(channelInput);
      let playlistId;

      if (extracted.type === 'video') {
        // Video URL → resolve to channel ID via backend (no quota consumed).
        // The video→channel mapping is cached server-side for 24h, rate-limited
        // by resolveLimiter (60 req/15 min per user).
        const videoInfo = await service.getChannelIdFromVideo(extracted.value);
        // Derive uploads playlist ID: YouTube uploads playlist = replace UC with UU
        playlistId = 'UU' + videoInfo.channelId.substring(2);
      } else {
        playlistId = extracted.value;

        // Try to resolve as handle first (@username), then username, then as channel ID
        try {
          playlistId = await service.getUploadsPlaylistFromHandle(playlistId);
        } catch (handleError) {
          if (handleError instanceof UsageLimitError) throw handleError;
          try {
            playlistId = await service.getChannelByUsername(playlistId.replace('@', ''));
          } catch (usernameError) {
            if (usernameError instanceof UsageLimitError) throw usernameError;
            // If both fail, try as channel ID
            try {
              playlistId = await service.getChannelById(playlistId);
            } catch (idError) {
              if (idError instanceof UsageLimitError) throw idError;
              throw new Error(`Could not find channel. Please check the username, handle, channel ID, or URL.`);
            }
          }
        }
      }

      // Derive channel ID from the uploads playlist ID (UUxxx → UCxxx)
      const channelIdFromUploads = 'UC' + playlistId.substring(2);
      const currentMaxResults = typeof maxResults === 'number' ? maxResults : parseInt(maxResults as string) || 50;
      const fetchedVideos = await service.fetchChannelVideos(
        channelIdFromUploads,
        fetchAll ? undefined : currentMaxResults
      );
      
      const videosWithSource = fetchedVideos.map(v => ({ ...v, sourcePlaylistIds: [] }));
      setVideos(videosWithSource);
      
      // Preselect all videos by default
      setSelectedVideos(new Set(videosWithSource.map(v => v.videoId)));
      
      // Cache the channel ID for later playlist loading
      const channelId = 'UC' + playlistId.substring(2); // Convert UU to UC
      setChannelIdCache(channelId);
      
      // Save to cache
      saveCache({
        inputValue: channelInput,
        maxResults,
        videos: videosWithSource,
        playlists,
        channelIdCache: channelId
      }, currentOrganization?.id);

      // Save to Firebase Recents
      if (user && videosWithSource.length > 0) {
        const firstVideo = videosWithSource[0];
        const channelName = firstVideo?.channelTitle || channelInput;
        // In some cases we might have the channel ID or handle, but we don't have the avatar easily here
        // unless we fetch channel details. For now, let's just pass what we have.
        await saveRecentChannel(user.uid, channelInput, channelName);
        await loadRecentChannels();
        // Dispatch custom event to notify Sidebar (Layout) to update
        window.dispatchEvent(new Event('refreshRecents'));
      }

      // Update URL after successful fetch
      updateUrlFromState();
      // Refresh the sidebar usage bar to reflect the incremented counter
      invalidateUsage();
    } catch (err) {
      if (err instanceof UsageLimitError) {
        setUsageError({ limit: err.limit, used: err.used, message: err.message, pageKey: err.pageKey });
      } else {
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
      }
    } finally {
      setLoading(false);
    }
  }, [inputValue, maxResults, playlists, updateUrlFromState, user, loadRecentChannels, fetchAll, invalidateUsage]);

  // Auto-fetch when URL channel parameter changes
  useEffect(() => {
    const channelParam = searchParams.get('channel');
    
    // If no channel param, do nothing
    if (!channelParam) return;
    
    // If we already have this channel loaded (and it matches the input value), don't re-fetch
    // This prevents loops when updateUrlFromState updates the URL
    if (inputValue === channelParam && videos.length > 0 && !hasFetchedFromUrl.current) {
      return;
    }
    
    // If we're already loading this exact channel, skip
    if (loading && inputValue === channelParam) return;

    setInputValue(channelParam);
    hasFetchedFromUrl.current = true;
    
    // Auto-fetch if the input looks complete (handle, channel ID, or URL)
    if (channelParam.includes('@') || channelParam.startsWith('UC') || channelParam.includes('youtube.com')) {
      const cached = loadCache(channelParam, currentOrganization?.id);
      
      // If we have cache and videos match the channel param, load from cache
      // Otherwise fetch fresh data
      if (cached && cached.inputValue === channelParam && cached.videos.length > 0) {
        // Load cached data into state
        setVideos(cached.videos);
        setPlaylists(cached.playlists || []);
        setChannelIdCache(cached.channelIdCache || '');
        setMaxResults(cached.maxResults);
        // Preselect all videos by default
        setSelectedVideos(new Set(cached.videos.map(v => v.videoId)));
        if (cached.playlists && cached.playlists.length > 0) {
          setSelectedPlaylists(new Set(cached.playlists.map(p => p.id)));
        }
      } else {
        // Perform fetch directly with URL value (not relying on state)
        const performFetch = async () => {

          setLoading(true);
          setError(null);
          setUsageError(null);
          setVideos([]);
          setChannelIdCache('');
          setPlaylists([]);
          setSelectedPlaylists(new Set());

          try {
            const service = new YouTubeService(user?.email || '', accessToken, currentOrganization?.id || null);
            const extracted = extractIdFromUrl(channelParam);
            let playlistId;

            if (extracted.type === 'video') {
              const videoInfo = await service.getChannelIdFromVideo(extracted.value);
              playlistId = 'UU' + videoInfo.channelId.substring(2);
            } else {
              playlistId = extracted.value;

              try {
                playlistId = await service.getUploadsPlaylistFromHandle(playlistId);
              } catch (handleError) {
                if (handleError instanceof UsageLimitError) throw handleError;
                try {
                  playlistId = await service.getChannelByUsername(playlistId.replace('@', ''));
                } catch (usernameError) {
                  if (usernameError instanceof UsageLimitError) throw usernameError;
                  try {
                    playlistId = await service.getChannelById(playlistId);
                  } catch (idError) {
                    if (idError instanceof UsageLimitError) throw idError;
                    throw new Error(`Could not find channel. Please check the username, handle, channel ID, or URL.`);
                  }
                }
              }
            }

            const currentMaxResults = typeof maxResults === 'number' ? maxResults : parseInt(maxResults as string) || 50;
            const channelId = 'UC' + playlistId.substring(2);
            const fetchedVideos = await service.fetchChannelVideos(channelId, fetchAll ? undefined : currentMaxResults);

            const videosWithSource = fetchedVideos.map(v => ({ ...v, sourcePlaylistIds: [] }));
            setVideos(videosWithSource);

            // Preselect all videos by default
            setSelectedVideos(new Set(videosWithSource.map(v => v.videoId)));

            setChannelIdCache(channelId);
            
            saveCache({
              inputValue: channelParam,
              maxResults: currentMaxResults,
              videos: videosWithSource,
              playlists: [],
              channelIdCache: channelId
            }, currentOrganization?.id);

            if (user && videosWithSource.length > 0) {
              const firstVideo = videosWithSource[0];
              const channelName = firstVideo?.channelTitle || channelParam;
              await saveRecentChannel(user.uid, channelParam, channelName);
              await loadRecentChannels();
              window.dispatchEvent(new Event('refreshRecents'));
            }

            // We don't need to call updateUrlFromState here because we came FROM the URL
            // But do refresh the usage bar since we just completed a fetch
            invalidateUsage();
          } catch (err) {
            if (err instanceof UsageLimitError) {
              setUsageError({ limit: err.limit, used: err.used, message: err.message, pageKey: err.pageKey });
            } else {
              setError(err instanceof Error ? err.message : 'An unknown error occurred');
            }
          } finally {
            setLoading(false);
          }
        };
        
        performFetch();
      }
    }
  }, [searchParams]); // React to URL changes

  const handleFetchPlaylists = async () => {
    // Return if already loading or already have playlists
    if (loadingPlaylists || playlists.length > 0) {
      return;
    }

    // Must have a cached channel ID from previous video fetch
    if (!channelIdCache) {
      console.warn('No channel ID cached. Fetch videos first.');
      return;
    }

    setLoadingPlaylists(true);
    setError(null);
    setUsageError(null);

    try {
      const service = new YouTubeService(user?.email || '', accessToken, currentOrganization?.id || null);

      // Step 1: Fetch channel videos first -- uses "videos" quota (not "playlists")
      const currentMaxResults = fetchAll ? undefined : (typeof maxResults === 'number' ? maxResults : parseInt(maxResults as string) || 50);
      const allChannelVideos = await service.fetchChannelVideos(channelIdCache, currentMaxResults);
      
      // Update videos and handle selection
      const videosWithSource = allChannelVideos.map(v => ({ ...v, sourcePlaylistIds: [] as string[] }));
      setVideos(videosWithSource);
      
      // Only auto-select all if there was no prior selection and no URL selection
      // Preselect all videos by default if none selected
      if (selectedVideos.size === 0) {
         setSelectedVideos(new Set(videosWithSource.map(v => v.videoId)));
      }
      
      // Step 2: Fetch channel playlists
      const fetchedPlaylists = await service.fetchChannelPlaylists(channelIdCache);
      setPlaylists(fetchedPlaylists);
      setSelectedPlaylists(new Set(fetchedPlaylists.map(p => p.id)));

      // Step 3: Fetch videos from all playlists in parallel (optimized)
      const videoPlaylistMap = new Map<string, string[]>();
      
      // Fetch all playlists in parallel with batching to avoid rate limits
      const batchSize = 10;
      for (let i = 0; i < fetchedPlaylists.length; i += batchSize) {
        const batch = fetchedPlaylists.slice(i, i + batchSize);
        
        await Promise.all(
          batch.map(async (playlist) => {
            try {
              // Fetch all videos from playlist for accurate mapping
              const playlistVideos = await service.fetchPlaylistItems(playlist.id, 500, true, undefined, true);
              
              // Map each video to this playlist
              playlistVideos.forEach((video) => {
                const videoId = video.videoId;
                if (!videoPlaylistMap.has(videoId)) {
                  videoPlaylistMap.set(videoId, []);
                }
                videoPlaylistMap.get(videoId)!.push(playlist.id);
              });
            } catch (playlistError) {
              console.warn(`Failed to fetch videos for playlist ${playlist.title}:`, playlistError);
            }
          })
        );
      }

      // Update videos with their playlist associations
      const updatedVideos = videosWithSource.map(video => ({
        ...video,
        sourcePlaylistIds: videoPlaylistMap.get(video.videoId) || []
      }));
      
      setVideos(updatedVideos);
      
      // Enable playlist filter to show playlist column
      // Enable playlist filter to show playlist column
      // setFilterByPlaylists(true); // Don't auto-enable filtering to keep all videos visible
      
      // Save to cache with playlists
      saveCache({
        inputValue,
        maxResults,
        videos: updatedVideos,
        playlists: fetchedPlaylists,
        channelIdCache
      }, currentOrganization?.id);

      // Update URL after loading playlists
      updateUrlFromState();
    } catch (err) {
      console.error('Failed to load playlists:', err);
      if (err instanceof UsageLimitError) {
        setUsageError({ limit: err.limit, used: err.used, message: err.message, pageKey: err.pageKey });
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load playlists');
      }
    } finally {
      setLoadingPlaylists(false);
    }
  };


  // Get filtered videos based on current filter settings
  const filteredVideos = useMemo(() => {
    let filtered = videos;
    // Filter by playlists if enabled
    if (filterByPlaylists) {
      if (selectedPlaylists.size > 0) {
        filtered = filtered.filter(v => 
          v.sourcePlaylistIds && v.sourcePlaylistIds.some(id => selectedPlaylists.has(id))
        );
      } else {
        filtered = [];
      }
    }
    // Filter by videos if enabled
    if (filterByVideos) {
      if (selectedVideos.size > 0) {
        filtered = filtered.filter(v => selectedVideos.has(v.videoId));
      } else {
        filtered = [];
      }
    }
    // Filter by video type
    if (videoTypeFilter !== 'all') {
      filtered = filtered.filter(v => {
        if (!v.duration) return false;
        const seconds = parseDuration(v.duration);
        if (videoTypeFilter === 'shorts') {
          return seconds <= 60;
        } else {
          return seconds > 60;
        }
      });
    }
    return filtered;
  }, [videos, filterByPlaylists, selectedPlaylists, filterByVideos, selectedVideos, videoTypeFilter]);

  const handleExportCSV = () => {
    if (videos.length === 0) {
      return;
    }
    const filename = `TubeKeter_Analytics-youtube-channel-${inputValue}.csv`;
    const showPlaylistColumn = playlists.length > 0;
    exportToCSV(
      filteredVideos, 
      filename, 
      false, 
      playlists, 
      showPlaylistColumn,
      selectedMetrics,
      selectedPlaylistMetas
    );
  };

  const handleShare = async () => {
    try {
      const channelName = videos[0]?.channelTitle || inputValue;
      
      // Build descriptive share text
      let shareText = `See video metrics of ${channelName}`;
      if (filterByPlaylists && selectedPlaylists.size > 0) {
        const playlistNames = playlists
          .filter(p => selectedPlaylists.has(p.id))
          .map(p => p.title)
          .slice(0, 2)
          .join(', ');
        shareText += ` (filtered by ${selectedPlaylists.size} playlist${selectedPlaylists.size > 1 ? 's' : ''}: ${playlistNames}${selectedPlaylists.size > 2 ? '...' : ''})`;
      } else if (filterByVideos && selectedVideos.size > 0) {
        shareText += ` (${selectedVideos.size} selected video${selectedVideos.size > 1 ? 's' : ''})`;
      }
      shareText += ` - ${filteredVideos.length} video${filteredVideos.length !== 1 ? 's' : ''}`;
      
      const shareData: ShareData = {
        title: `Videos from ${channelName}`,
        text: shareText,
        url: window.location.href
      };

      // Generate CSV file with filtered videos
      const showPlaylistColumn = playlists.length > 0;
      const csvContent = generateCSVContent(
        filteredVideos, 
        false, 
        playlists, 
        showPlaylistColumn,
        selectedMetrics,
        selectedPlaylistMetas
      );
      
      let file: File | undefined;
      if (csvContent) {
        const filename = `TubeKeter_Analytics-youtube-channel-${inputValue}.csv`;
        file = new File([csvContent], filename, { type: 'text/csv' });
      }

      // Strategy 1: Try sharing with file
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            ...shareData,
            files: [file]
          });
          return; // Success
        } catch (shareError) {
          console.warn('Share with file failed, trying without file:', shareError);
        }
      }

      // Strategy 2: Try sharing without file (text + url only)
      if (navigator.share) {
        try {
          await navigator.share(shareData);
          return; // Success
        } catch (shareError) {
          console.warn('Share without file failed, falling back to clipboard:', shareError);
        }
      }

      // Strategy 3: Fallback to clipboard
      await navigator.clipboard.writeText(window.location.href);
      toast.success('Link copied to clipboard!');
    } catch (err) {
      console.error('Error sharing:', err);
      // Final fallback if everything explodes
      try {
        await navigator.clipboard.writeText(window.location.href);
        toast.success('Link copied to clipboard!');
      } catch (clipboardErr) {
        console.error('Clipboard fallback failed:', clipboardErr);
        toast.error('Failed to share or copy link.');
      }
    }
  };

  const handleAddToManagement = async () => {
    if (!videos.length) return;
    const inputs = videos.map((v) => ({ id: v.videoId, title: v.title, thumbnailUrl: v.thumbnailUrl }));
    const updated = await addVideos(inputs);
    if (updated) {
      toast.success(`${inputs.length} video${inputs.length === 1 ? '' : 's'} added to Video Management`);
    }
  };

  return (
    <DataExplorerShell
      title="Videos"
      description="Fetch and browse videos from a channel, then open the dashboard for deeper analytics."
      icon={<Video size={20} />}
      actions={
        videos.length > 0 ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleAddToManagement()}
            disabled={!vmReady}
          >
            <ListChecks size={14} />
            Add to Optimized (Video)
          </Button>
        ) : null
      }
      alerts={
        error ? (
          <Box sx={{ mb: 2 }}>
            <Alert severity="error">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </Box>
        ) : null
      }
      usageLimit={
        usageError ? (
          <UsageLimitBanner
            limit={usageError.limit}
            used={usageError.used}
            message={usageError.message}
            pageLabel={usageError.pageKey || "Videos"}
          />
        ) : null
      }
      toolbar={
        <>
          <Form layout="toolbar">
          <FormField variant="main">
            <AutocompleteInput
              id="inputValue"
              aria-label="Channel handle or URL"
              value={inputValue}
              onChange={(value) => {
                setInputValue(value);
                // Clear cache if input changes significantly
                if (channelIdCache && value !== inputValue) {
                  setChannelIdCache('');
                  setPlaylists([]);
                  setSelectedPlaylists(new Set());
                }
              }}
              onSelect={(item) => handleFetchVideos(item.value)}
              onSubmit={(value) => handleFetchVideos(value)}
              placeholder="@username, Channel ID, or Channel URL"
              suggestions={recentChannels.map(ch => ({
                id: ch.id || ch.channelInput || 'unknown',
                value: ch.channelInput || '',
                label: ch.channelName || ch.channelInput || 'Unknown Channel',
                sublabel: ch.channelInput && ch.channelName !== ch.channelInput ? ch.channelInput : undefined
              }))}
              disabled={loading || loadingPlaylists}
            />
          </FormField>

          <FormField variant="checkbox">
            <SegmentedControl
              ariaLabel="Fetch mode"
              value={fetchAll ? 'all' : 'limit'}
              onChange={(v) => setFetchAll(v === 'all')}
              options={[
                { value: 'limit', label: 'Limit' },
                { value: 'all', label: 'All' },
              ]}
            />
          </FormField>

          {!fetchAll && (
            <FormField variant="small">
              <input
                id="maxResults"
                type="number"
                className="form-input"
                aria-label="Maximum results"
                min="1"
                value={maxResults}
                onChange={(e) => {
                  const value = e.target.value;
                  setMaxResults(value === '' ? '' : parseInt(value) || '');
                }}
              />
            </FormField>
          )}

          <FormActions>
            <Button
              variant="primary"
              onClick={() => handleFetchVideos()}
              disabled={loading || loadingPlaylists}
            >
              {(loading || loadingPlaylists) ? (
                <>
                  <Spinner size="xs" />
                  {loadingPlaylists ? 'Loading Playlists...' : 'Fetching...'}
                </>
              ) : (
                <>
                  <ArrowDownToLine size={14} />
                  Fetch Videos
                </>
              )}
            </Button>
          </FormActions>
        </Form>

        <FormHint>
          {filterByPlaylists 
            ? 'Select playlists to filter videos from specific playlists'
            : 'Paste full YouTube channel URL or enter @username, username, or Channel ID (UCxxx...)'}
        </FormHint>
      </>
    }
  >

      {loading && (
        <div className="table-section">
          <div style={{ display: 'flex', gap: '1rem', padding: '1.5rem', borderBottom: '1px solid var(--border-color, rgba(0,0,0,0.1))' }}>
            <Skeleton type="title" width="20%" />
            <Skeleton type="title" width="10%" style={{ marginLeft: 'auto' }} />
          </div>
          <div style={{ padding: '0 1.5rem' }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} type="table-row" style={{ marginTop: '1rem' }} />
            ))}
          </div>
        </div>
      )}

      {loadingPlaylists && !loading && (
        <div className="table-section">
          <div style={{ padding: '1.5rem' }}>
            <Skeleton type="title" width="30%" />
            <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
               <Skeleton type="card" width="200px" height="60px" />
               <Skeleton type="card" width="200px" height="60px" />
               <Skeleton type="card" width="200px" height="60px" />
            </div>
          </div>
        </div>
      )}

      {videos.length > 0 && !loading && (
        <div className="table-section">
          <VideoTable 
            videos={filteredVideos} 
            showChannelColumn={false} 
            onExportCSV={handleExportCSV}
            onShare={handleShare}
            sourceType="channel"
            sourceName={videos[0]?.channelTitle || inputValue}
            playlists={playlists}
            showPlaylistColumn={playlists.length > 0}
            allVideos={videos}
            filterByPlaylists={filterByPlaylists}
            onFilterByPlaylistsChange={setFilterByPlaylists}
            selectedPlaylists={selectedPlaylists}
            onSelectedPlaylistsChange={setSelectedPlaylists}
            filterByVideos={filterByVideos}
            onFilterByVideosChange={setFilterByVideos}
            selectedVideos={selectedVideos}
            onSelectedVideosChange={setSelectedVideos}
            onLoadPlaylists={handleFetchPlaylists}
            isLoadingPlaylists={loadingPlaylists}
            showPlaylistFilter={!!channelIdCache}
            selectedMetrics={selectedMetrics}
            onSelectedMetricsChange={setSelectedMetrics}
            selectedPlaylistMetas={selectedPlaylistMetas}
            onSelectedPlaylistMetasChange={setSelectedPlaylistMetas}
            allowPrivateMetrics={false}
            onVideoClick={(v) => setDetailVideo(v)}
          />
        </div>
      )}

      {!loading && videos.length === 0 && !error && (
        <EmptyState 
          title="No Data Yet"
          description="Enter the username, handle, or channel ID above and click 'Fetch Videos' to get started."
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

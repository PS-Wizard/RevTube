import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { YouTubeService } from '../services/youtubeService';
import type { VideoMetadata } from '../types/youtube';
import { generateComparisonPDF } from '../utils/pdfExport';
import { useAuth } from '../hooks/useAuth';
import { useOrganization } from '../hooks/useOrganization';
import { useUsage } from '../hooks/useUsage';
import { getFirebaseAuthHeader } from '../services/authHeaders';
import { apiUrl } from '../utils/apiBase';
import { saveRecentComparison, getRecentChannels, saveRecentChannel, type RecentChannel } from '../services/recentsService';
import { AutocompleteInput } from './AutocompleteInput';
import { UsageLimitError } from '../services/analyticsService';
import { useUsageStore } from '../stores/usageStore';
import { UsageLimitBanner } from './UsageLimitBanner';
import { SkeletonCardGrid } from './SkeletonLoaders';
import { Button, Select, Stack } from './ui';
import { PageHeader } from './PageHeader';
import { EmptyState } from './EmptyState';
import { toast } from 'react-hot-toast';
import { MdClose, MdAdd, MdWarning, MdPictureAsPdf, MdCompareArrows } from 'react-icons/md';
import dayjs from 'dayjs';
import { DateRangeSelector } from './dashboard/DateRangeSelector';
import './Compare.css';

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes (frontend-only; backend Redis cache stays at 1h)
const CHANNEL_CACHE_PREFIX = 'compare_cache::channel';

interface ChannelCacheEntry {
  data: ComparisonMetrics;
  timestamp: number;
}

/** Build per-channel cache key from handle + date range + org scope. */
const channelCacheKey = (handle: string, startDate: string | null, endDate: string | null, orgId?: string): string => {
  const h = handle.trim().toLowerCase();
  const datePart = startDate && endDate ? `::${startDate}_${endDate}` : '';
  const suffix = orgId ? `::org:${orgId}` : '';
  return `${CHANNEL_CACHE_PREFIX}::${h}${datePart}${suffix}`;
};

/** Load per-channel cached ComparisonMetrics. Returns null if missing or expired. */
const loadChannelCache = (handle: string, startDate: string | null, endDate: string | null, orgId?: string): ComparisonMetrics | null => {
  try {
    const key = channelCacheKey(handle, startDate, endDate, orgId);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry: ChannelCacheEntry = JSON.parse(raw);
    if (Date.now() - entry.timestamp > CACHE_DURATION) {
      localStorage.removeItem(key);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
};

/** Save per-channel ComparisonMetrics to localStorage cache. */
const saveChannelCache = (handle: string, data: ComparisonMetrics, startDate: string | null, endDate: string | null, orgId?: string): void => {
  try {
    const key = channelCacheKey(handle, startDate, endDate, orgId);
    localStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
  } catch {
    // localStorage full -- silently ignore
  }
};

/**
 * Check compare quota upfront by calling POST /api/usage/track.
 * - 200 → quota available (already incremented), returns true
 * - 429 → quota exceeded, throws UsageLimitError
 * - any other error → fail open, returns true (don't block comparison)
 */
async function checkCompareQuota(): Promise<boolean> {
  try {
    const res = await fetch(apiUrl('/usage/track'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await getFirebaseAuthHeader()) },
    });

    if (res.status === 429) {
      const body = await res.json();
      if (body.error?.code === 'LIMIT_EXCEEDED') {
        throw new UsageLimitError(body.error.message, body.error.limit, body.error.used, 'compare');
      }
    }

    if (!res.ok) {
      console.warn('[checkCompareQuota] Unexpected response', res.status);
    }

    // Extract _usage from the response to update sidebar usage bar in real-time
    try {
      const body = await res.clone().json();
      if (body && typeof body === 'object' && !Array.isArray(body) && body._usage) {
        useUsageStore.getState().updateUsage(body._usage.pageKey, body._usage.used, body._usage.limit);
      }
    } catch { /* not JSON or no _usage -- fine */ }

    return true;
  } catch (err) {
    if (err instanceof UsageLimitError) throw err;
    console.warn('[checkCompareQuota] Failed, allowing comparison:', err);
    return true; // fail open
  }
}

type CompareProps = object

interface ChannelInput {
  id: string;
  value: string;
}

interface ComparisonMetrics {
  channelName: string;
  profilePicture?: string;
  bannerUrl?: string;
  subscriberCount?: number;
  totalVideos: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  avgViewsPerVideo: number;
  avgLikesPerVideo: number;
  avgCommentsPerVideo: number;
  avgLikesPerView: number;
  topVideos: VideoMetadata[];
  lifetimeVideoCount?: number;
  lifetimeViewCount?: number;
  prevPeriod?: {
    totalVideos: number;
    totalViews: number;
    totalLikes: number;
    totalComments: number;
    avgViewsPerVideo: number;
    avgLikesPerVideo: number;
    avgCommentsPerVideo: number;
    avgLikesPerView: number;
  };
}

interface MetricRowDef {
  label: string;
  fmt: (r: ComparisonMetrics) => string;
  key: keyof ComparisonMetrics;
}

interface SectionDef {
  title: string;
  rows: MetricRowDef[];
}

const TABLE_SECTIONS: SectionDef[] = [
  {
    title: 'Overview',
    rows: [
      { label: 'Subscribers', fmt: (r) => r.subscriberCount?.toLocaleString() ?? 'N/A', key: 'subscriberCount' },
      { label: 'Total videos', fmt: (r) => (r.lifetimeVideoCount ?? r.totalVideos).toLocaleString(), key: 'lifetimeVideoCount' },
    ],
  },
  {
    title: 'Performance',
    rows: [
      { label: 'Total views', fmt: (r) => r.totalViews.toLocaleString(), key: 'totalViews' },
      { label: 'Total likes', fmt: (r) => r.totalLikes.toLocaleString(), key: 'totalLikes' },
      { label: 'Total comments', fmt: (r) => r.totalComments.toLocaleString(), key: 'totalComments' },
    ],
  },
  {
    title: 'Averages & Engagement',
    rows: [
      { label: 'Avg views / video', fmt: (r) => Math.round(r.avgViewsPerVideo).toLocaleString(), key: 'avgViewsPerVideo' },
      { label: 'Avg likes / video', fmt: (r) => Math.round(r.avgLikesPerVideo).toLocaleString(), key: 'avgLikesPerVideo' },
      { label: 'Engagement rate', fmt: (r) => `${r.avgLikesPerView.toFixed(2)}%`, key: 'avgLikesPerView' },
    ],
  },
];


export const Compare: React.FC<CompareProps> = () => {
  const { user, accessToken } = useAuth();
  const { currentOrganization } = useOrganization();
  const { invalidateUsage } = useUsage();
  const [searchParams, setSearchParams] = useSearchParams();


  // Initialize from URL params if present, otherwise use empty state
  const urlChannels = searchParams.get('channels');
  const urlStartDate = searchParams.get('startDate');
  const urlEndDate = searchParams.get('endDate');

  const [channels, setChannels] = useState<ChannelInput[]>(() => {
    if (urlChannels) {
      const channelValues = urlChannels.split(',').filter(c => c.trim());
      return channelValues.map((value, index) => ({ id: String(index + 1), value }));
    }
    return [
      { id: '1', value: '' },
      { id: '2', value: '' },
    ];
  });

  const [startDate, setStartDate] = useState<string | null>(() => {
    return urlStartDate || null;
  });

  const [endDate, setEndDate] = useState<string | null>(() => {
    return urlEndDate || null;
  });
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usageError, setUsageError] = useState<{limit: number, used: number, message: string, pageKey?: string} | null>(null);
  const [results, setResults] = useState<ComparisonMetrics[]>([]);
  const [sortBy, setSortBy] = useState<'views' | 'likes' | 'comments'>('views');
  const [recentChannels, setRecentChannels] = useState<RecentChannel[]>([]);

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

  // Save each channel's result to per-channel cache whenever results change
  useEffect(() => {
    if (results.length > 0) {
      const handles = channels.filter(c => c.value.trim()).map(c => c.value.trim());
      if (handles.length === 0) return;
      handles.forEach((handle, idx) => {
        if (idx < results.length) {
          saveChannelCache(handle, results[idx], startDate, endDate, currentOrganization?.id);
        }
      });
    }
    // Intentionally excluding `channels` from deps -- adding it would re-save old
    // results under new channel handles when the user edits a text field, polluting
    // the cache. `channels` is read from the closure at save-time and is always
    // up-to-date when this effect fires (results + dates only change on comparisons).
  }, [results, startDate, endDate, currentOrganization?.id, channels]);

  // Update URL only after successful comparison (not while typing)
  const updateUrlFromState = useCallback(() => {
    const filledChannels = channels.filter(c => c.value.trim());
    if (filledChannels.length > 0) {
      const channelValues = filledChannels.map(c => c.value.trim()).join(',');
      const params: Record<string, string> = { channels: channelValues };
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      setSearchParams(params, { replace: true });
    }
  }, [channels, startDate, endDate, setSearchParams]);

  // Auto-compare when URL has channels
  useEffect(() => {
    const urlChannels = searchParams.get('channels');
    const urlStartDate = searchParams.get('startDate');
    const urlEndDate = searchParams.get('endDate');
    
    if (!urlChannels) return;

    // Check if we are already displaying these results
    const currentChannelValues = channels.map(c => c.value).filter(v => v.trim()).join(',');
    if (currentChannelValues === urlChannels && startDate === urlStartDate && endDate === urlEndDate && results.length > 0) {
      return;
    }

    // If already loading, skip
    if (loading) return;
    
    const channelValues = urlChannels.split(',').filter(c => c.trim());
    const channelsFromUrl = channelValues.map((value, index) => ({ id: String(index + 1), value }));

    // Check per-channel cache for each channel from URL
    const urlHandles = urlChannels.split(',').filter(c => c.trim());
    const cachedMetrics = urlHandles.map(h => loadChannelCache(h, urlStartDate, urlEndDate, currentOrganization?.id));
    const allCached = cachedMetrics.every(m => m !== null);

    if (allCached) {
      // All channels cached -- load from cache without re-fetch
      setResults(cachedMetrics as ComparisonMetrics[]);
      setChannels(urlHandles.map((value, index) => ({ id: String(index + 1), value })));
      setStartDate(urlStartDate);
      setEndDate(urlEndDate);
      invalidateUsage();
    } else {
      // Set state and trigger comparison inline with the actual URL values
      setChannels(channelsFromUrl);
      setStartDate(urlStartDate);
      setEndDate(urlEndDate);
      
      // Perform comparison directly with URL values (not relying on state)
      const performComparison = async () => {
        const filledChannels = channelsFromUrl.filter(ch => ch.value.trim());
        if (filledChannels.length < 2) {
          setError('Please enter at least 2 channels to compare');
          return;
        }

        setLoading(true);
        setError(null);
        setUsageError(null);
        setResults([]);

        try {
          // Check compare quota upfront BEFORE making any API calls
          await checkCompareQuota();

          const service = new YouTubeService(user?.email || '', accessToken, currentOrganization?.id || null);
          const startCutoff = urlStartDate ? new Date(urlStartDate) : new Date('1900-01-01');
          const endCutoff = urlEndDate ? new Date(urlEndDate + 'T23:59:59.999Z') : null;
          
          const channelPromises = filledChannels.map(async (channel) => {
            const channelInput = channel.value.trim();
            
            try {
              const extractedChannel = extractChannelFromUrl(channelInput);
              let fullDetails = null;
              try {
                fullDetails = await service.getFullChannelDetails(extractedChannel);
              } catch (e) {
                if (e instanceof UsageLimitError) throw e;
                console.warn(`Could not fetch full channel details for ${extractedChannel}`, e);
              }

              let playlistId = extractedChannel;
              let channelFound = false;
              
              try {
                playlistId = await service.getUploadsPlaylistFromHandle(playlistId);
                channelFound = true;
              } catch (handleErr) {
                if (handleErr instanceof UsageLimitError) throw handleErr;
                try {
                  playlistId = await service.getChannelByUsername(playlistId.replace('@', ''));
                  channelFound = true;
                } catch (usernameErr) {
                  if (usernameErr instanceof UsageLimitError) throw usernameErr;
                  if (playlistId.startsWith('UC')) {
                    playlistId = 'UU' + playlistId.substring(2);
                    channelFound = true;
                  } else if (playlistId.startsWith('UU')) {
                    channelFound = true;
                  }
                }
              }

              if (!channelFound) {
                throw new Error(`Channel "${channelInput}" doesn't exist. Please check the channel ID, username, or URL.`);
              }

              let allVideos: VideoMetadata[];
              let backendMetrics = null;
              try {
                const result = await service.fetchCompareVideos(playlistId, urlStartDate || startDate, urlEndDate || endDate);
                allVideos = result.videos;
                backendMetrics = result.metrics;
              } catch (_backendErr) {
                // Fallback to client-side pagination if backend endpoint fails
                console.warn('[Compare] Backend endpoint failed, falling back to client-side fetch:', _backendErr);
                const fallback = await fetchVideosOptimized(service, playlistId, startCutoff, endCutoff, channelInput);
                allVideos = fallback.allVideos;
              }
              const filteredVideos = allVideos;
              const hasVideosInRange = allVideos.length > 0;

              return {
                channelName: fullDetails?.snippet.title || channelInput,
                profilePicture: fullDetails?.snippet.thumbnails.high?.url || fullDetails?.snippet.thumbnails.medium?.url || fullDetails?.snippet.thumbnails.default?.url,
                bannerUrl: fullDetails?.brandingSettings?.image?.bannerExternalUrl,
                subscriberCount: fullDetails?.statistics?.subscriberCount ? parseInt(fullDetails.statistics.subscriberCount) : undefined,
                lifetimeVideoCount: fullDetails?.statistics?.videoCount ? parseInt(fullDetails.statistics.videoCount) : undefined,
                lifetimeViewCount: fullDetails?.statistics?.viewCount ? parseInt(fullDetails.statistics.viewCount) : undefined,
                allVideos,
                filteredVideos,
                hasVideosInRange,
                backendMetrics,
              };

            } catch (err) {
              if (err instanceof UsageLimitError) throw err;
              if (err instanceof Error && err.message.includes("doesn't exist")) {
                throw err;
              }
              throw new Error(`Channel "${channelInput}" doesn't exist or couldn't be accessed. Please verify the channel ID or username.`);
            }
          });

          const channelResults = await Promise.all(channelPromises);
          
          const comparisonResults: ComparisonMetrics[] = channelResults.map(({ channelName, profilePicture, bannerUrl, subscriberCount, lifetimeVideoCount, lifetimeViewCount, allVideos, backendMetrics }) => {
            const base = backendMetrics || calculateMetrics(allVideos, channelName, startCutoff, endCutoff);
            return {
              channelName,
              profilePicture,
              bannerUrl,
              subscriberCount,
              lifetimeVideoCount,
              lifetimeViewCount,
              topVideos: allVideos.slice(0, 50),
              ...base,
            };
          });

          setResults(comparisonResults);

          if (user && comparisonResults.length > 0) {
            const channelInputs = filledChannels.map(ch => ch.value.trim());
            const channelNames = comparisonResults.map(r => r.channelName);
            await Promise.all(channelInputs.map((input, idx) =>
              saveRecentChannel(user.uid, input, channelNames[idx], channelResults[idx]?.profilePicture)
            ));
            await saveRecentComparison(user.uid, channelInputs, channelNames, urlStartDate && urlEndDate ? `${urlStartDate}_to_${urlEndDate}` : 'lifetime');
            await loadRecentChannels();
            window.dispatchEvent(new Event('refreshRecents'));
          }

          invalidateUsage();

        } catch (err) {
          if (err instanceof UsageLimitError) {
            setUsageError({ limit: err.limit, used: err.used, message: err.message, pageKey: err.pageKey });
          } else {
            setError(err instanceof Error ? err.message : 'An error occurred during comparison');
          }
        } finally {
          setLoading(false);
        }
      };

      performComparison();
    }
  }, [searchParams, user, accessToken, loadRecentChannels, channels, startDate, endDate, results.length, loading, currentOrganization?.id, invalidateUsage]); // React to URL changes only

  // Reload from correct cache when org context changes
  useEffect(() => {
    setChannels([{ id: '1', value: '' }, { id: '2', value: '' }]);
    setStartDate(null);
    setEndDate(null);
    setResults([]);
    setError(null);
    setUsageError(null);
  }, [currentOrganization?.id]);

  // Extract channel ID or handle from URL
  const extractChannelFromUrl = (input: string): string => {
    const trimmedInput = input.trim();
    
    // If it doesn't look like a URL, return as-is
    if (!trimmedInput.includes('youtube.com') && !trimmedInput.includes('youtu.be')) {
      return trimmedInput;
    }

    // Patterns for channel URLs
    const channelPatterns = [
      /youtube\.com\/channel\/([^/?&]+)/i,
      /youtube\.com\/c\/([^/?&]+)/i,
      /youtube\.com\/@([^/?&]+)/i,
      /youtube\.com\/user\/([^/?&]+)/i
    ];
    
    for (const pattern of channelPatterns) {
      const match = trimmedInput.match(pattern);
      if (match && match[1]) {
        const value = match[1];
        // Preserve @ for handles
        if (pattern.source.includes('@') || trimmedInput.includes('/@')) {
          return value.startsWith('@') ? value : `@${value}`;
        }
        return value;
      }
    }
    
    // If no pattern matched but it's a URL, return error indicator
    return trimmedInput;
  };

  const addChannel = () => {
    if (channels.length < 3) {
      setChannels([...channels, { id: Date.now().toString(), value: '' }]);
    }
  };

  const removeChannel = (id: string) => {
    if (channels.length > 2) {
      setChannels(channels.filter(ch => ch.id !== id));
      if (results.length > 0) setResults([]);
    }
  };

  const updateChannel = (id: string, value: string) => {
    // If the handle changed, evict the old cache entry so stale data doesn't
    // persist when the user types a different channel.
    const oldHandle = channels.find(ch => ch.id === id)?.value?.trim();
    const newHandle = value.trim();
    if (oldHandle && newHandle && oldHandle !== newHandle) {
      const oldKey = channelCacheKey(oldHandle, startDate, endDate, currentOrganization?.id);
      try { localStorage.removeItem(oldKey); } catch { /* ignore */ }
    }

    setChannels(channels.map(ch => ch.id === id ? { ...ch, value } : ch));
    setError(null);
    if (results.length > 0) setResults([]);
  };

  // Check if a channel value is a duplicate
  const isDuplicateChannel = (currentId: string, currentValue: string): boolean => {
    if (!currentValue.trim()) return false;
    
    const normalizedValue = currentValue.trim().toLowerCase();
    return channels.some(
      ch => ch.id !== currentId && 
      ch.value.trim().toLowerCase() === normalizedValue && 
      ch.value.trim() !== ''
    );
  };

  const calculateMetrics = (
    videos: VideoMetadata[],
    channelName: string,
    startCutoff?: Date,
    endCutoff?: Date | null
  ): ComparisonMetrics => {
    const currentVideos = videos.filter(v => {
      const publishDate = new Date(v.publishedAt);
      if (startCutoff && publishDate < startCutoff) return false;
      if (endCutoff && publishDate > endCutoff) return false;
      return true;
    });

    const totalVideos = currentVideos.length;
    const totalViews = currentVideos.reduce((sum, v) => sum + (v.viewCount || 0), 0);
    const totalLikes = currentVideos.reduce((sum, v) => sum + (v.likeCount || 0), 0);
    const totalComments = currentVideos.reduce((sum, v) => sum + (v.commentCount || 0), 0);
    
    const avgViewsPerVideo = totalVideos > 0 ? totalViews / totalVideos : 0;
    const avgLikesPerVideo = totalVideos > 0 ? totalLikes / totalVideos : 0;
    const avgCommentsPerVideo = totalVideos > 0 ? totalComments / totalVideos : 0;
    const avgLikesPerView = totalViews > 0 ? (totalLikes / totalViews) * 100 : 0; // As percentage
    
    // Store all videos for later sorting (we'll sort them in the render based on sortBy state)
    const topVideos = [...currentVideos].slice(0, 50); // Keep top 50 for sorting options
    
    const metrics: ComparisonMetrics = {
      channelName,
      totalVideos,
      totalViews,
      totalLikes,
      totalComments,
      avgViewsPerVideo,
      avgLikesPerVideo,
      avgCommentsPerVideo,
      avgLikesPerView,
      topVideos
    };

    return metrics;
  };

  const getBestPerformer = (metric: keyof ComparisonMetrics): number => {
    if (results.length === 0) return -1;
    
    const values = results.map(r => {
      const value = r[metric];
      return typeof value === 'number' ? value : 0;
    });
    
    const maxValue = Math.max(...values);
    return values.indexOf(maxValue);
  };

  // Get sorted top videos based on current sort option
  const getSortedTopVideos = (videos: VideoMetadata[]) => {
    const sorted = [...videos];
    switch (sortBy) {
      case 'likes':
        sorted.sort((a, b) => (b.likeCount || 0) - (a.likeCount || 0));
        break;
      case 'comments':
        sorted.sort((a, b) => (b.commentCount || 0) - (a.commentCount || 0));
        break;
      case 'views':
      default:
        sorted.sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0));
        break;
    }
    return sorted.slice(0, 5);
  };

  // Optimized video fetching function with early stopping
  const fetchVideosOptimized = async (
    service: YouTubeService,
    playlistId: string,
    startCutoff: Date,
    endCutoff: Date | null,
    channelInput: string
  ) => {
    const batchSize = 20;
    const videos: VideoMetadata[] = [];
    let pageToken: string | undefined = undefined;
    let shouldContinue = true;
    let channelName = channelInput;

    while (shouldContinue) {
      try {
        const { items: batchVideos, nextPageToken } = await service.fetchPlaylistItemsPage(playlistId, pageToken, batchSize);
        
        if (batchVideos.length === 0) {
          // If this is the first batch and there are no items, the playlist/channel might not exist
          if (videos.length === 0) {
            throw new Error(`Channel "${channelInput}" doesn't exist or has no videos.`);
          }
          break;
        }

        // Update channel name from first batch
        if (videos.length === 0 && batchVideos.length > 0) {
          channelName = batchVideos[0].channelTitle || channelInput;
        }

        videos.push(...batchVideos);

        // Check if the last video in this batch is older than cutoff date
        const lastVideo = batchVideos[batchVideos.length - 1];
        const lastVideoDate = new Date(lastVideo.publishedAt);

        // If the last video is older than cutoff, we can stop
        if (lastVideoDate < startCutoff) {
          shouldContinue = false;
        } else if (!nextPageToken) {
          // No more pages available
          shouldContinue = false;
        } else {
          pageToken = nextPageToken;
        }

        // Safety limit: stop after fetching 200 videos
        if (videos.length >= 200) {
          shouldContinue = false;
        }

      } catch (err) {
        if (err instanceof UsageLimitError) throw err;
        // Check if it's a "not found" error from the service
        const errorMessage = err instanceof Error ? err.message.toLowerCase() : '';
        if (errorMessage.includes('not found') || errorMessage.includes('404')) {
             throw new Error(`Channel "${channelInput}" doesn't exist or has been deleted.`);
        }
        throw new Error(`Failed to fetch videos: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    // Enrich all videos with statistics in one batch
    const enrichedVideos = await service.enrichWithStatistics(videos);

    // Filter videos by time period
    const filteredVideos = enrichedVideos.filter(video => {
      const publishDate = new Date(video.publishedAt);
      if (publishDate < startCutoff) return false;
      if (endCutoff && publishDate > endCutoff) return false;
      return true;
    });

    return {
      channelName,
      allVideos: enrichedVideos,
      filteredVideos: filteredVideos,
      hasVideosInRange: filteredVideos.length > 0
    };
  };

  const handleCompare = useCallback(async () => {
    // Validation
    const filledChannels = channels.filter(ch => ch.value.trim());
    if (filledChannels.length < 2) {
      setError('Please enter at least 2 channels to compare');
      return;
    }

    // Check for duplicate channels
    const channelValues = filledChannels.map(ch => ch.value.trim().toLowerCase());
    const uniqueValues = new Set(channelValues);
    if (channelValues.length !== uniqueValues.size) {
      setError('Please enter different channels. Duplicate channels are not allowed.');
      return;
    }

    const orgId = currentOrganization?.id;
    const channelHandles = filledChannels.map(ch => ch.value.trim());

    setLoading(true);
    setError(null);
    setUsageError(null);
    setResults([]);

    try {
      // Phase 1: Check per-channel cache for ALL channels
      const cachedMetrics: (ComparisonMetrics | null)[] = channelHandles.map(h =>
        loadChannelCache(h, startDate, endDate, orgId)
      );
      const allCached = cachedMetrics.every(m => m !== null);

      if (allCached) {
        // Brief loading for UX consistency -- no quota consumed, no API calls
        await new Promise(r => setTimeout(r, 300));
        setResults(cachedMetrics as ComparisonMetrics[]);
        setLoading(false);
        return;
      }

      // Phase 2: Some/All need fresh data -- burn quota once
      await checkCompareQuota();

      const service = new YouTubeService(user?.email || '', accessToken, currentOrganization?.id || null);
      const startCutoff = startDate ? new Date(startDate) : new Date('1900-01-01');
      const endCutoff = endDate ? new Date(endDate + 'T23:59:59.999Z') : null;

      // Phase 3: Fetch per-channel -- cached ones skip, uncached ones fetch fresh
      const channelResults = await Promise.all(channelHandles.map(async (handle, idx) => {
        // Use cached data if available
        if (cachedMetrics[idx]) {
          return cachedMetrics[idx]!;
        }

        // === UNCACHED CHANNEL -- full resolve & fetch ===
        const extractedChannel = extractChannelFromUrl(handle);

        // Fetch full channel details for metadata (PFP, Banner, Subscriber & Video count)
        let fullDetails = null;
        try {
          fullDetails = await service.getFullChannelDetails(extractedChannel);
        } catch (e) {
          if (e instanceof UsageLimitError) throw e;
          console.warn(`Could not fetch full channel details for ${extractedChannel}`, e);
        }

        // Resolve channel to uploads playlist
        let playlistId = extractedChannel;
        let channelFound = false;

        try {
          playlistId = await service.getUploadsPlaylistFromHandle(playlistId);
          channelFound = true;
        } catch (handleErr) {
          if (handleErr instanceof UsageLimitError) throw handleErr;
          try {
            playlistId = await service.getChannelByUsername(playlistId.replace('@', ''));
            channelFound = true;
          } catch (usernameErr) {
            if (usernameErr instanceof UsageLimitError) throw usernameErr;
            if (playlistId.startsWith('UC')) {
              playlistId = 'UU' + playlistId.substring(2);
              channelFound = true;
            } else if (playlistId.startsWith('UU')) {
              channelFound = true;
            }
          }
        }

        if (!channelFound) {
          throw new Error(`Channel "${handle}" doesn't exist. Please check the channel ID, username, or URL.`);
        }

        // Fetch video data (try backend endpoint with Redis cache, fallback to client-side)
        let allVideos: VideoMetadata[];
        let backendMetrics = null;
        try {
          const result = await service.fetchCompareVideos(playlistId, startDate, endDate);
          allVideos = result.videos;
          backendMetrics = result.metrics;
        } catch (_backendErr) {
          console.warn('[Compare] Backend endpoint failed, falling back to client-side fetch:', _backendErr);
          const fallback = await fetchVideosOptimized(service, playlistId, startCutoff, endCutoff, handle);
          allVideos = fallback.allVideos;
        }

        // Calculate metrics -- backendMetrics is a subset (no channelName/topVideos),
        // so construct the full ComparisonMetrics by spreading it over a base object.
        const channelName = fullDetails?.snippet.title || handle;
        const baseMetrics = backendMetrics || calculateMetrics(allVideos, channelName, startCutoff, endCutoff);
        const metrics: ComparisonMetrics = {
          channelName,
          profilePicture: fullDetails?.snippet.thumbnails.high?.url || fullDetails?.snippet.thumbnails.medium?.url || fullDetails?.snippet.thumbnails.default?.url,
          bannerUrl: fullDetails?.brandingSettings?.image?.bannerExternalUrl,
          subscriberCount: fullDetails?.statistics?.subscriberCount ? parseInt(fullDetails.statistics.subscriberCount) : undefined,
          lifetimeVideoCount: fullDetails?.statistics?.videoCount ? parseInt(fullDetails.statistics.videoCount) : undefined,
          lifetimeViewCount: fullDetails?.statistics?.viewCount ? parseInt(fullDetails.statistics.viewCount) : undefined,
          topVideos: allVideos.slice(0, 50),
          ...baseMetrics,
        };

        // Save to per-channel cache
        saveChannelCache(handle, metrics, startDate, endDate, orgId);

        return metrics;
      }));

      setResults(channelResults);

      // Save to recent comparisons in Firebase
      if (user && channelResults.length > 0) {
        const channelInputs = filledChannels.map(ch => ch.value.trim());
        const channelNames = channelResults.map(r => r.channelName);

        await Promise.all(channelInputs.map((input, idx) =>
          saveRecentChannel(user.uid, input, channelNames[idx], channelResults[idx]?.profilePicture)
        ));

        await saveRecentComparison(user.uid, channelInputs, channelNames, startDate && endDate ? `${startDate}_to_${endDate}` : 'lifetime');
        await loadRecentChannels();
        window.dispatchEvent(new Event('refreshRecents'));
      }

      invalidateUsage();
      updateUrlFromState();

    } catch (err) {
      if (err instanceof UsageLimitError) {
        setUsageError({ limit: err.limit, used: err.used, message: err.message });
      } else {
        setError(err instanceof Error ? err.message : 'An error occurred during comparison');
      }
    } finally {
      setLoading(false);
    }
  }, [channels, currentOrganization?.id, user, accessToken, startDate, endDate, invalidateUsage, updateUrlFromState, loadRecentChannels]);

  const handleExportPDF = async () => {
    if (results.length === 0) {
      toast.error('Please compare channels before exporting to PDF');
      return;
    }

    try {
      const periodLabel = startDate && endDate 
        ? `${dayjs(startDate).format('MMM D')} – ${dayjs(endDate).format('MMM D, YYYY')}`
        : 'lifetime';
      await generateComparisonPDF(results, periodLabel);
    } catch (err) {
      console.error('PDF Export failed:', err);
      toast.error('Failed to generate PDF. Please try again.');
    }
  };

  return (
    <>
      <PageHeader
        icon={<MdCompareArrows size={20} />}
        title="Compare channels"
        subtitle="Add up to three channels and compare performance over a selected period."
        className="mb-4 sm:mb-5"
        actions={
          results.length > 0 ? (
            <Button variant="secondary" size="sm" onClick={handleExportPDF}>
              <MdPictureAsPdf size={14} style={{ marginRight: '6px' }} aria-hidden />
              Export PDF
            </Button>
          ) : undefined
        }
      />

      {error && (
        <div className="data-explorer-alerts">
          <div className="alert alert-error">
            <MdWarning className="alert-icon" size={20} />
            <div className="alert-content"><h4>Error</h4><p>{error}</p></div>
          </div>
        </div>
      )}

      {usageError && (
        <div className="data-explorer-usage">
          <UsageLimitBanner limit={usageError.limit} used={usageError.used} message={usageError.message} />
        </div>
      )}

      <div className="form-section">
        <div className="horizontal-form">
          <div className="cmp-inputs-grid">
            {channels.map((channel, index) => (
              <div key={channel.id} className="cmp-channel-input-field">
                <div className="cmp-autocomplete-container">
                  <AutocompleteInput
                    id={`channel-${index}`}
                    value={channel.value}
                    onChange={(value) => updateChannel(channel.id, value)}
                    onSubmit={handleCompare}
                    aria-label={`Channel ${index + 1}`}
                    placeholder={`Channel ${index + 1} \u2014 @handle or ID`}
                    suggestions={recentChannels.map(rc => ({
                      id: rc.id || rc.channelInput || 'unknown',
                      value: rc.channelInput || '',
                      label: rc.channelName || rc.channelInput || 'Unknown Channel',
                      sublabel: rc.channelInput && rc.channelName !== rc.channelInput ? rc.channelInput : undefined
                    }))}
                    disabled={loading}
                    className={`form-input${isDuplicateChannel(channel.id, channel.value) ? ' input-error' : ''}`}
                  />
                  {isDuplicateChannel(channel.id, channel.value) && (
                    <div className="duplicate-warning-icon" title="Duplicate channel">
                      <MdWarning size={14} />
                    </div>
                  )}
                </div>
                {channels.length > 2 && (
                  <Button variant="ghost" size="icon" onClick={() => removeChannel(channel.id)} title="Remove">
                    <MdClose size={14} />
                  </Button>
                )}
              </div>
            ))}
          </div>
          {channels.length < 3 && (
            <div className="form-actions-inline cmp-add-channel-action">
              <Button variant="ghost" size="sm" onClick={addChannel}>
                <MdAdd size={14} style={{ marginRight: '6px' }} />
                Add channel
              </Button>
            </div>
          )}
          
          <div className="cmp-time-controls">
            <DateRangeSelector
              startDate={startDate ? dayjs(startDate) : null}
              endDate={endDate ? dayjs(endDate) : null}
              latestDataDate={dayjs()}
              onRangeChange={(start, end) => {
                setStartDate(start ? start.format('YYYY-MM-DD') : null);
                setEndDate(end ? end.format('YYYY-MM-DD') : null);
              }}
              onClear={() => {
                setStartDate(null);
                setEndDate(null);
              }}
            />
          </div>
          
          <div className="form-actions-inline">
            <Button variant="primary" onClick={handleCompare} disabled={loading}>
              {loading ? <><div className="spinner-small" style={{ marginRight: '6px' }} />Comparing&hellip;</> : 'Compare'}
            </Button>
          </div>
        </div>
        <p className="form-hint-below">
          Paste full YouTube channel URL or enter @username, username, or Channel ID (UCxxx...) for at least 2 channels.
        </p>
      </div>

      <Stack gap={2} style={{ overflowX: 'hidden' }}>
        {loading && results.length === 0 && (
          <div className="cmp-loading">
            <p className="cmp-loading-label">Fetching channel data&hellip;</p>
            <SkeletonCardGrid columns={channels.length} count={channels.length} />
          </div>
        )}

        {!loading && results.length === 0 && !error && (
          <EmptyState
            title="No Comparison Data"
            description="Enter at least two channel identifiers above and click Compare to see performance metrics side by side."
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2" y="3" width="8" height="18" rx="1" />
                <rect x="14" y="7" width="8" height="14" rx="1" />
                <path d="M6 10v4M18 12v4" />
              </svg>
            }
          />
        )}

        {results.length > 0 && (
          <div className="cmp-results">

            {/* Channel identity strip */}
            <div className="dp-panel">
              <div className="dp-panel-header">
                <div className="dp-panel-header-left">
                  <span className="dp-panel-title">Channels</span>
                  <span className="dp-panel-sub">Selected profiles for comparison</span>
                </div>
              </div>
              <div className="dp-body" style={{ padding: 0 }}>
                <div className="cmp-channel-cards">
                  {results.map((result, index) => (
                    <div key={index} className="cmp-channel-card">
                      <div className="cmp-channel-banner">
                        {result.bannerUrl ? (
                          <img src={result.bannerUrl} alt="" className="cmp-banner-img" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="cmp-banner-placeholder" />
                        )}
                      </div>
                      <div className="cmp-channel-body">
                        {result.profilePicture ? (
                          <img src={result.profilePicture} alt="" className="cmp-channel-avatar" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="cmp-channel-avatar cmp-channel-avatar--placeholder">{result.channelName.charAt(0)}</div>
                        )}
                        <div className="cmp-channel-meta">
                          <div className="cmp-channel-name">{result.channelName}</div>
                          {result.subscriberCount !== undefined && (
                            <div className="cmp-channel-subs">{result.subscriberCount.toLocaleString()} subscribers</div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Unified KPI Comparison Table */}
            <div className="dp-panel">
              <div className="dp-panel-header">
                <div className="dp-panel-header-left">
                  <span className="dp-panel-title">Key Performance Indicators</span>
                  <span className="dp-panel-sub">Performance metrics over the selected period</span>
                </div>
              </div>
              <div className="dp-body" style={{ padding: 0 }}>
                <div className="table-wrapper" style={{ margin: 0, border: 'none', borderRadius: 0 }}>
                  <table className="rt-data-table">
                    <thead>
                      <tr>
                        <th style={{ width: '220px' }}>Metric</th>
                        {results.map((result, idx) => (
                          <th key={idx} style={{ minWidth: '180px', textAlign: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--rt-space-2)' }}>
                              {result.profilePicture ? (
                                <img src={result.profilePicture} alt="" style={{ width: '24px', height: '24px', borderRadius: '50%' }} referrerPolicy="no-referrer" />
                              ) : (
                                <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'var(--rt-color-bg-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 'bold' }}>
                                  {result.channelName.charAt(0)}
                                </div>
                              )}
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 'var(--rt-weight-medium)' }}>
                                {result.channelName}
                              </span>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {TABLE_SECTIONS.map(section => (
                        <React.Fragment key={section.title}>
                          <tr className="cmp-table-section-row">
                            <td colSpan={results.length + 1}>{section.title}</td>
                          </tr>
                          {section.rows.map(row => {
                            const bestIdx = getBestPerformer(row.key);
                            return (
                              <tr key={row.label}>
                                <td style={{ fontWeight: 'var(--rt-weight-medium)', color: 'var(--rt-color-text-secondary)' }}>{row.label}</td>
                                {results.map((result, idx) => {
                                  return (
                                    <td key={idx} className={bestIdx === idx ? 'cmp-best' : ''} style={{ textAlign: 'center' }}>
                                      <span className="cmp-kpi-value">{row.fmt(result)}</span>
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Top videos */}
            <div className="dp-panel">
              <div className="dp-panel-header">
                <div className="dp-panel-header-left">
                  <div>
                    <span className="dp-panel-title">Top Videos</span>
                    <p className="dp-panel-sub" style={{ margin: 0 }}>Top performing uploads across selected channels</p>
                  </div>
                </div>
                <div className="dp-panel-header-right">
                  <Select
                    id="top-videos-sort"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as 'views' | 'likes' | 'comments')}
                    className="rt-select-native"
                    aria-label="Sort by metric"
                    style={{ minWidth: '120px' }}
                  >
                    <option value="views">Views</option>
                    <option value="likes">Likes</option>
                    <option value="comments">Comments</option>
                  </Select>
                </div>
              </div>
              <div className="dp-body" style={{ padding: 0 }}>
                <div className="cmp-videos-columns">
                  {results.map((result, idx) => (
                    <div key={idx} className="cmp-videos-col">
                      <div className="cmp-videos-col-header">{result.channelName}</div>
                      {getSortedTopVideos(result.topVideos).map((video, vIdx) => (
                        <a key={vIdx} href={`https://www.youtube.com/watch?v=${video.videoId}`} target="_blank" rel="noopener noreferrer" className="cmp-video-row">
                          <img src={video.thumbnailUrl} alt={video.title} className="cmp-video-thumb" referrerPolicy="no-referrer" />
                          <div className="cmp-video-info">
                            <div className="cmp-video-title">{video.title}</div>
                            <div className="cmp-video-stats">
                              <span className="cmp-video-stat">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                {(video.viewCount || 0).toLocaleString()}
                              </span>
                              <span className="cmp-video-stat">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
                                {(video.likeCount || 0).toLocaleString()}
                              </span>
                              <span className="cmp-video-stat">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                                {(video.commentCount || 0).toLocaleString()}
                              </span>
                            </div>
                          </div>
                        </a>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>

          </div>
        )}
      </Stack>
    </>
  );
};

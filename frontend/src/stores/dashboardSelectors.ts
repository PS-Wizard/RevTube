/**
 * Computed Selectors for Dashboard Store
 * Replaces useMemo chains with proper memoized selectors
 */

import { useMemo } from 'react';
import { useDashboardStore } from './dashboardStore';
import {
  getVideosByActiveFilters,
  matchesVisibilityFilter,
  classifyPlaylistActivity,
  getLastVideoPublishedByPlaylist,
  matchesPlaylistActivityFilter,
  type FilterableVideo,
} from '../utils/dashboardUtils';
import type { PlaylistMetadata } from '../types/youtube';

// ============================================================================
// LIST-SCOPED DATA SELECTORS
// ============================================================================

/**
 * Get video IDs from active lists
 */
export const useListScopedVideoIds = () => {
  const activeListIds = useDashboardStore(state => state.listSelection.activeListIds);
  const activeLists = useDashboardStore(state => state.lists.activeLists);
  
  return useMemo(() => {
    if (activeListIds.size === 0) return null;
    
    const ids = new Set<string>();
    activeLists.forEach(list => {
      list.videoIds.forEach(id => ids.add(id));
    });
    return ids;
  }, [activeListIds, activeLists]);
};

/**
 * Get videos filtered by active lists
 */
export const useListScopedVideos = () => {
  const videos = useDashboardStore(state => state.videos.videos);
  const listScopedVideoIds = useListScopedVideoIds();
  
  return useMemo(() => {
    if (!listScopedVideoIds) return videos;
    return videos.filter(v => listScopedVideoIds.has(v.videoId));
  }, [videos, listScopedVideoIds]);
};

/**
 * Get playlist IDs from active lists
 */
export const useListScopedPlaylistIds = () => {
  const activeListIds = useDashboardStore(state => state.listSelection.activeListIds);
  const activeLists = useDashboardStore(state => state.lists.activeLists);
  
  return useMemo(() => {
    if (activeListIds.size === 0) return null;
    
    const ids = new Set<string>();
    activeLists.forEach(list => {
      if (list.listType === 'playlist' && list.playlistIds) {
        list.playlistIds.forEach(id => ids.add(id));
      }
    });
    return ids;
  }, [activeListIds, activeLists]);
};

/**
 * Get playlists filtered by active lists
 */
export const useListScopedPlaylists = () => {
  const playlists = useDashboardStore(state => state.playlists.playlists);
  const listScopedPlaylistIds = useListScopedPlaylistIds();
  
  return useMemo(() => {
    if (!listScopedPlaylistIds) return playlists;
    return playlists.filter(p => listScopedPlaylistIds.has(p.id));
  }, [playlists, listScopedPlaylistIds]);
};

// ============================================================================
// FILTERED DATA SELECTORS
// ============================================================================

/**
 * Get videos filtered by all active filters
 */
export const useFilteredVideos = () => {
  const listScopedVideos = useListScopedVideos();
  const filters = useDashboardStore(state => state.filters);
  
  return useMemo(() => {
    return getVideosByActiveFilters({
      videos: listScopedVideos as FilterableVideo[],
      videoTypeFilter: filters.type,
      videoSearchQuery: filters.searchQuery,
      visibilityFilter: filters.visibility,
      filterByPlaylists: filters.playlists.enabled,
      selectedPlaylists: filters.playlists.selected,
      filterByVideos: filters.videos.enabled,
      selectedVideos: filters.videos.selected,
    });
  }, [listScopedVideos, filters]);
};

/**
 * Get playlists filtered by active lists + visibility filter + activity filter
 * (default: public only, all playlists; private/unlisted "archived" playlists are
 * opt-in). Also attaches lastVideoPublishedAt + activityLabel derived from the
 * loaded dashboard videos.
 */
export const useFilteredPlaylists = () => {
  const listScopedPlaylists = useListScopedPlaylists();
  const playlistVisibility = useDashboardStore(state => state.filters.playlistVisibility);
  const activity = useDashboardStore(state => state.filters.activity);
  const videos = useDashboardStore(state => state.videos.videos);

  return useMemo(() => {
    const lastAddedMap = getLastVideoPublishedByPlaylist(videos as FilterableVideo[]);
    return listScopedPlaylists
      .map((p: PlaylistMetadata) => {
        const lastVideoPublishedAt = lastAddedMap.get(p.id) ?? null;
        return { ...p, lastVideoPublishedAt, activityLabel: classifyPlaylistActivity(lastVideoPublishedAt) };
      })
      .filter(p =>
        matchesVisibilityFilter(p.privacyStatus, playlistVisibility) &&
        matchesPlaylistActivityFilter(p.lastVideoPublishedAt, activity),
      );
  }, [listScopedPlaylists, playlistVisibility, activity, videos]);
};

/**
 * Get videos for analytics (respects tab context)
 */
export const useAnalyticsVideos = () => {
  const activeTab = useDashboardStore(state => state.ui.activeTab);
  const videos = useDashboardStore(state => state.videos.videos);
  const listScopedVideos = useListScopedVideos();
  
  return useMemo(() => {
    if (activeTab !== 'videoAnalytics' && activeTab !== 'audience') {
      return videos;
    }
    return listScopedVideos;
  }, [activeTab, videos, listScopedVideos]);
};

/**
 * Get video table rows with view count logic
 */
export const useVideoTableRows = () => {
  const filteredVideos = useFilteredVideos();
  const showAllTimeViews = useDashboardStore(state => state.ui.showAllTimeViews);
  
  return useMemo(() => {
    return filteredVideos.map(video => ({
      ...video,
      viewCount: showAllTimeViews 
        ? video.viewCount 
        : (video.periodViewCount ?? video.viewCount ?? 0),
    }));
  }, [filteredVideos, showAllTimeViews]);
};

// ============================================================================
// PLAYLIST SELECTORS
// ============================================================================

/**
 * Get playlist IDs for analytics scope
 */
export const usePlaylistAnalyticsScopeIds = () => {
  const listScopedPlaylists = useListScopedPlaylists();
  
  return useMemo(() => {
    return listScopedPlaylists.map(p => p.id);
  }, [listScopedPlaylists]);
};

// ============================================================================
// UI STATE SELECTORS
// ============================================================================

/**
 * Check if current tab shows video table
 */
export const useIsVideoTableTab = () => {
  const activeTab = useDashboardStore(state => state.ui.activeTab);
  
  return useMemo(() => {
    return activeTab === 'videoAnalytics' || 
           activeTab === 'audience' || 
           activeTab === 'playlistAnalytics';
  }, [activeTab]);
};

/**
 * Get audience primary period (7, 30, or 90)
 */
export const useAudiencePrimaryPeriod = (): 7 | 30 | 90 => {
  const period = useDashboardStore(state => state.dateRange.period);
  
  return useMemo(() => {
    if (period === 7 || period === 30 || period === 90) return period;
    return 30;
  }, [period]);
};

/**
 * Get formatted active range label
 */
export const useActiveRangeLabel = () => {
  const period = useDashboardStore(state => state.dateRange.period);
  const customStartDate = useDashboardStore(state => state.dateRange.customStartDate);
  const customEndDate = useDashboardStore(state => state.dateRange.customEndDate);
  
  return useMemo(() => {
    if (customStartDate && customEndDate) {
      const start = new Date(customStartDate);
      const end = new Date(customEndDate);
      return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }
    if (period) return `Last ${period}d`;
    return 'Current Range';
  }, [customStartDate, customEndDate, period]);
};

/**
 * Get formatted latest date
 */
export const useFormattedLatestDate = () => {
  const latestDataDate = useDashboardStore(state => state.dateRange.latestDataDate);
  
  return useMemo(() => {
    if (!latestDataDate) return '';
    const date = new Date(latestDataDate);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }, [latestDataDate]);
};

/**
 * Check if dashboard should show playlist columns.
 *
 * Display-only gate: columns appear whenever the playlist catalog is loaded,
 * independent of the playlist *filter* (which narrows rows, not columns).
 * Which meta columns render is still controlled by the Metas dropdown.
 */
export const useShowDashboardPlaylistColumns = () => {
  const playlists = useDashboardStore(state => state.playlists.playlists);

  return useMemo(() => {
    return playlists.length > 0;
  }, [playlists.length]);
};

// ============================================================================
// CHANNEL SELECTORS
// ============================================================================

/**
 * Get current channel info
 */
export const useCurrentChannel = () => {
  const channels = useDashboardStore(state => state.channel.channels);
  const selectedChannel = useDashboardStore(state => state.channel.selectedChannel);
  
  return useMemo(() => {
    return channels.find(ch => ch.id === selectedChannel) || null;
  }, [channels, selectedChannel]);
};

/**
 * Get current channel name
 */
export const useCurrentChannelName = () => {
  const currentChannel = useCurrentChannel();
  
  return useMemo(() => {
    return currentChannel?.snippet?.title || 
           currentChannel?.channelTitle || 
           'Channel';
  }, [currentChannel]);
};

/**
 * Refactored Selection Management Hook
 * Consolidates video and playlist selection logic
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useDashboardStore } from '../stores/dashboardStore';
import { useFilteredVideos, useListScopedVideos, useIsVideoTableTab } from '../stores/dashboardSelectors';

export const useDashboardSelection = () => {
  // Store state
  const activeTab = useDashboardStore(state => state.ui.activeTab);
  const videoSelection = useDashboardStore(state => state.videoSelection);
  const playlistSelection = useDashboardStore(state => state.playlistSelection);
  const listSelection = useDashboardStore(state => state.listSelection);
  const filters = useDashboardStore(state => state.filters);
  
  // Store actions
  const setSelectedVideo = useDashboardStore(state => state.setSelectedVideo);
  const setSelectedVideoIds = useDashboardStore(state => state.setSelectedVideoIds);
  const setTableCheckedOverride = useDashboardStore(state => state.setTableCheckedOverride);
  const setSelectedPlaylists = useDashboardStore(state => state.setSelectedPlaylists);
  const resetSelection = useDashboardStore(state => state.resetSelection);
  
  // Computed data
  const filteredVideos = useFilteredVideos();
  const listScopedVideos = useListScopedVideos();
  const isVideoTableTab = useIsVideoTableTab();
  const lastAutoScopeSigRef = useRef<string>('');

  const autoScopeSig = useMemo(() => {
    const idsSig = filteredVideos.map(v => v.videoId).sort().join(',');
    const listSig = Array.from(listSelection.activeListIds).sort().join(',');
    const filterSig = [
      filters.type,
      filters.searchQuery,
      filters.playlists.enabled ? Array.from(filters.playlists.selected).sort().join('|') : '',
      filters.videos.enabled ? Array.from(filters.videos.selected).sort().join('|') : '',
    ].join('::');
    return `${activeTab}::${listSig}::${filterSig}::${idsSig}`;
  }, [activeTab, filteredVideos, listSelection.activeListIds, filters]);
  
  // Auto-select videos based on filters and context
  useEffect(() => {
    if (!isVideoTableTab) return;
    // Playlist analytics uses playlist-scoped metrics, not bulk video IDs. The tab effect clears
    // video selection; repopulating here caused an infinite update loop with that effect (#185).
    if (activeTab === 'playlistAnalytics') return;

    // Respect manual checkbox edits, except when the dataset/filter scope changed.
    // On scope change (e.g. "videos to load" updated), clear override once so
    // auto-selection can run exactly once for the new set.
    if (videoSelection.tableCheckedOverride !== null) {
      if (lastAutoScopeSigRef.current !== autoScopeSig) {
        setTableCheckedOverride(null);
        lastAutoScopeSigRef.current = autoScopeSig;
      }
      return;
    }
    
    const hasTableFilters =
      filters.type !== 'all' ||
      (filters.playlists.enabled && filters.playlists.selected.size > 0) ||
      (filters.videos.enabled && filters.videos.selected.size > 0) ||
      filters.searchQuery !== '';
    
    let targetIds: string[];
    
    if (hasTableFilters) {
      // Use filtered videos
      targetIds = filteredVideos.map(v => v.videoId);
    } else {
      // Use list-scoped or all videos
      if (listSelection.activeListIds.size > 0) {
        targetIds = listScopedVideos.map(v => v.videoId);
      } else if (listSelection.isTemporaryList) {
        // Explicit temporary list (user-picked videos) -- keep as filter source.
        targetIds = listScopedVideos.map(v => v.videoId);
      } else {
        // Default: NO video== filter so headline stats/chart come from channel
        // totals (all videos with that status in the selected range), NOT just
        // the currently loaded page. Checkbox edits still set an explicit filter.
        targetIds = [];
      }
    }
    
    // When a saved list is active, allow up to 200 video IDs (YouTube Analytics API limit).
    // Without a list the 50-cap prevents oversized requests for unbounded channel-wide queries.
    const selectionLimit = listSelection.activeListIds.size > 0 ? 200 : 50;

    // Update selection if needed
    if (targetIds.length > 0 && targetIds.length <= selectionLimit) {
      const currentIdsStr = Array.from(videoSelection.selectedVideoIds).sort().join(',');
      const newIdsStr = [...targetIds].sort().join(',');
      
      if (currentIdsStr !== newIdsStr) {
        setSelectedVideoIds(new Set(targetIds));
      }
    } else if (targetIds.length === 0 && hasTableFilters) {
      // No videos match filters - use sentinel value
      if (!videoSelection.selectedVideoIds.has('XX_NONE_XX_')) {
        setSelectedVideoIds(new Set(['XX_NONE_XX_']));
      }
    } else {
      // Clear selection for large datasets
      if (videoSelection.selectedVideoIds.size !== 0) {
        setSelectedVideoIds(new Set());
      }
    }

    lastAutoScopeSigRef.current = autoScopeSig;
  }, [
    autoScopeSig,
    activeTab,
    isVideoTableTab,
    filteredVideos,
    listScopedVideos,
    filters,
    listSelection,
    videoSelection.selectedVideoIds,
    videoSelection.tableCheckedOverride,
    setSelectedVideoIds,
    setTableCheckedOverride,
  ]);
  
  // Handle video row checkbox changes
  const handleVideoCheck = useCallback((videoId: string, checked: boolean) => {
    const currentOverride = videoSelection.tableCheckedOverride || videoSelection.selectedVideoIds;
    const next = new Set(currentOverride);
    
    if (checked) {
      next.add(videoId);
    } else {
      next.delete(videoId);
    }
    
    setTableCheckedOverride(next);
    
    if (next.size === 0) {
      setSelectedVideoIds(new Set(['XX_NONE_XX_']));
    } else {
      setSelectedVideoIds(new Set(next));
    }
  }, [videoSelection, setTableCheckedOverride, setSelectedVideoIds]);
  
  // Handle select all videos
  const handleSelectAllVideos = useCallback((checked: boolean) => {
    const next = checked ? new Set(filteredVideos.map(v => v.videoId)) : new Set<string>();
    setTableCheckedOverride(next);
    
    if (next.size === 0) {
      setSelectedVideoIds(new Set(['XX_NONE_XX_']));
    } else {
      setSelectedVideoIds(new Set(next));
    }
  }, [filteredVideos, setTableCheckedOverride, setSelectedVideoIds]);
  
  // Get effective checked video IDs for table
  const getCheckedVideoIds = useCallback(() => {
    if (videoSelection.tableCheckedOverride) {
      return videoSelection.tableCheckedOverride;
    }
    
    if (videoSelection.selectedVideoIds.has('XX_NONE_XX_')) {
      return new Set<string>();
    }

    if (videoSelection.selectedVideoIds.size > 0) {
      return videoSelection.selectedVideoIds;
    }
    
    return new Set(filteredVideos.map(v => v.videoId));
  }, [videoSelection, filteredVideos]);
  
  return {
    // State
    selectedVideo: videoSelection.selectedVideo,
    selectedVideoIds: videoSelection.selectedVideoIds,
    tableCheckedOverride: videoSelection.tableCheckedOverride,
    selectedPlaylists: playlistSelection.selectedPlaylists,
    activeListIds: listSelection.activeListIds,
    isTemporaryList: listSelection.isTemporaryList,
    
    // Actions
    setSelectedVideo,
    setSelectedVideoIds,
    setTableCheckedOverride,
    setSelectedPlaylists,
    resetSelection,
    
    // Handlers
    handleVideoCheck,
    handleSelectAllVideos,
    getCheckedVideoIds,
  };
};

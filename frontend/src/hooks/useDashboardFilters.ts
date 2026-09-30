/**
 * Refactored Filter Management Hook
 * Consolidates 8+ filter state variables into single interface
 */

import { useCallback } from 'react';
import { useDashboardStore } from '../stores/dashboardStore';
import type { VideoFilters } from '../types/dashboard';

export const useDashboardFilters = () => {
  // Store state - single filter object instead of 8+ variables
  const filters = useDashboardStore(state => state.filters);
  const videoLimit = useDashboardStore(state => state.videoLimit);
  
  // Store actions
  const setVideoTypeFilter = useDashboardStore(state => state.setVideoTypeFilter);
  const setVideoSearchQuery = useDashboardStore(state => state.setVideoSearchQuery);
  const setVideoVisibilityFilter = useDashboardStore(state => state.setVideoVisibilityFilter);
  const setPlaylistVisibilityFilter = useDashboardStore(state => state.setPlaylistVisibilityFilter);
  const setPlaylistActivityFilter = useDashboardStore(state => state.setPlaylistActivityFilter);
  const setFilterByPlaylists = useDashboardStore(state => state.setFilterByPlaylists);
  const setSelectedPlaylists = useDashboardStore(state => state.setSelectedPlaylists);
  const setFilterByVideos = useDashboardStore(state => state.setFilterByVideos);
  const setSelectedVideos = useDashboardStore(state => state.setSelectedVideos);
  const resetFilters = useDashboardStore(state => state.resetFilters);
  
  // Video limit actions
  const setVideoLimit = useCallback((mode: number | 'all' | 'custom') => {
    const selectedChannel = useDashboardStore.getState().channel.selectedChannel;
    if (selectedChannel) {
      try {
        localStorage.setItem(`videoLimit_${selectedChannel}`, String(mode));
      } catch {
        /* ignore */
      }
    }
    
    useDashboardStore.setState(state => ({
      videoLimit: { ...state.videoLimit, mode }
    }));
    
    // Mark that limit has been changed
    useDashboardStore.setState(state => ({
      videos: { ...state.videos, hasChangedVideoLimit: true }
    }));
  }, []);
  
  const setCustomLimit = useCallback((value: number) => {
    const selectedChannel = useDashboardStore.getState().channel.selectedChannel;
    if (selectedChannel) {
      try {
        localStorage.setItem(`customLimit_${selectedChannel}`, String(value));
      } catch {
        /* ignore */
      }
    }
    
    useDashboardStore.setState(state => ({
      videoLimit: { ...state.videoLimit, customValue: value }
    }));
    
    // Mark that limit has been changed
    useDashboardStore.setState(state => ({
      videos: { ...state.videos, hasChangedVideoLimit: true }
    }));
  }, []);
  
  // Load video limit from localStorage for channel
  const loadVideoLimitForChannel = useCallback((channelId: string) => {
    try {
      const storedLimit = localStorage.getItem(`videoLimit_${channelId}`);
      const storedCustom = localStorage.getItem(`customLimit_${channelId}`);
      
      if (storedLimit) {
        const parsed = storedLimit === 'all' || storedLimit === 'custom' 
          ? storedLimit 
          : parseInt(storedLimit, 10);
        
        useDashboardStore.setState(state => ({
          videoLimit: { 
            ...state.videoLimit, 
            mode: parsed,
            customValue: storedCustom ? parseInt(storedCustom, 10) : 100
          }
        }));
      }
    } catch {
      /* ignore */
    }
  }, []);
  
  // Computed: check if any filters are active
  const hasActiveFilters = useCallback(() => {
    return (
      filters.type !== 'all' ||
      filters.searchQuery !== '' ||
      (filters.playlists.enabled && filters.playlists.selected.size > 0) ||
      (filters.videos.enabled && filters.videos.selected.size > 0)
    );
  }, [filters]);
  
  // Bulk update filters
  const updateFilters = useCallback((updates: Partial<VideoFilters>) => {
    useDashboardStore.setState(state => ({
      filters: { ...state.filters, ...updates }
    }));
  }, []);
  
  return {
    // State
    filters,
    videoLimit,
    
    // Individual setters
    setVideoTypeFilter,
    setVideoSearchQuery,
    setVideoVisibilityFilter,
    setPlaylistVisibilityFilter,
    setPlaylistActivityFilter,
    setFilterByPlaylists,
    setSelectedPlaylists,
    setFilterByVideos,
    setSelectedVideos,
    
    // Video limit
    setVideoLimit,
    setCustomLimit,
    loadVideoLimitForChannel,
    
    // Bulk operations
    updateFilters,
    resetFilters,
    hasActiveFilters,
  };
};

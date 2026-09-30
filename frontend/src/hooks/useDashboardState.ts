import { useState, useRef, useEffect, useCallback } from 'react';
import type { AnalyticsReport } from '../services/analyticsService';
import type { VideoMetadata } from '../types/youtube';
import type { SavedList } from '../services/savedListService';

export const useDashboardState = () => {
  // UI State
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usageError, setUsageError] = useState<{limit: number, used: number, message: string} | null>(null);
  
  // Tab State
  const [activeTab, setActiveTab] = useState<'videoAnalytics' | 'channelAnalytics' | 'audience'>('videoAnalytics');
  
  // Period State
  const [period, setPeriod] = useState<number | null>(null);
  const [channelAnalyticsPeriod, setChannelAnalyticsPeriod] = useState<number | null>(null);
  
  // Channel State
  const [channels, setChannels] = useState<any[]>([]);
  const [orgTokenMap, setOrgTokenMap] = useState<Record<string, any>>({});
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const selectedChannelRef = useRef<string | null>(selectedChannel);
  const [showChannelDropdown, setShowChannelDropdown] = useState(false);
  const channelDropdownRef = useRef<HTMLDivElement>(null);
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [channelSelectionHydrated, setChannelSelectionHydrated] = useState(false);

  // Video State
  const [videos, setVideos] = useState<VideoMetadata[]>([]);
  const [videoPlaylistMap, setVideoPlaylistMap] = useState<Map<string, string[]>>(new Map());
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [videoTypeFilter, setVideoTypeFilter] = useState<'all' | 'shorts' | 'long'>('all');
  const [videoSearchQuery, setVideoSearchQuery] = useState('');

  // Video Limit State
  const [videoLimit, setVideoLimit] = useState<number | 'all' | 'custom'>(10);
  const [customLimit, setCustomLimit] = useState<number>(50);
  const [hasChangedVideoLimit, setHasChangedVideoLimit] = useState(false);

  const getVideoLimitStorageKey = useCallback(() => `videoLimit_${selectedChannel || 'default'}`, [selectedChannel]);
  const getCustomLimitStorageKey = useCallback(() => `customLimit_${selectedChannel || 'default'}`, [selectedChannel]);

  // Analytics State - Video Level
  const [reportData, setReportData] = useState<AnalyticsReport | null>(null);
  const [prevReportData, setPrevReportData] = useState<AnalyticsReport | null>(null);
  const [fullListsData, setFullListsData] = useState<AnalyticsReport | null>(null);
  const [loadingMultiPeriod, setLoadingMultiPeriod] = useState(false);

  type PeriodData = { 
    views: number; 
    watchTime: number; 
    subscribers: number; 
    subscribersGained: number; 
    subscribersLost: number; 
    retention: number;
    likes: number;
    comments: number;
    shares: number;
  };
  const [multiPeriodStats, setMultiPeriodStats] = useState<{
    d7: { current: PeriodData; previous: PeriodData };
    d30: { current: PeriodData; previous: PeriodData };
    d90: { current: PeriodData; previous: PeriodData };
  } | null>(null);

  // Analytics State - Channel Level
  const [channelMetrics, setChannelMetrics] = useState<AnalyticsReport | null>(null);
  const [prevChannelMetrics, setPrevChannelMetrics] = useState<AnalyticsReport | null>(null);

  type ChannelPeriodData = { 
    views: number; 
    subscribersGained: number; 
    subscribersLost: number; 
    watchTime: number; 
    videosUploaded: number;
    likes: number;
    comments: number;
    shares: number;
  };
  const [channelMultiPeriodStats, setChannelMultiPeriodStats] = useState<{
    d7: { current: ChannelPeriodData; previous: ChannelPeriodData };
    d30: { current: ChannelPeriodData; previous: ChannelPeriodData };
    d90: { current: ChannelPeriodData; previous: ChannelPeriodData };
  } | null>(null);
  const [channelAnalyticsData, setChannelAnalyticsData] = useState<ChannelPeriodData>({
    views: 0,
    subscribersGained: 0,
    subscribersLost: 0,
    watchTime: 0,
    videosUploaded: 0,
    likes: 0,
    comments: 0,
    shares: 0,
  });
  const [channelAnalyticsChartData, setChannelAnalyticsChartData] = useState<any[]>([]);
  const [loadingChannelAnalytics, setLoadingChannelAnalytics] = useState(false);

  // Audience State
  const [audienceDays, setAudienceDays] = useState<number>(90);
  const [dimensionsData, setDimensionsData] = useState<{
    trafficSource: any; gender: any; ageGroup: any;
    subscribedStatus: any; country: any; deviceType: any;
  } | null>(null);
  const [loadingDimensions, setLoadingDimensions] = useState(false);

  // Selection State
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<string>>(new Set());
  const [tableCheckedOverride, setTableCheckedOverride] = useState<Set<string> | null>(null);
  const [selectedVideo, setSelectedVideo] = useState<VideoMetadata | null>(null);

  // Saved Lists State
  const [savedLists, setSavedLists] = useState<SavedList[]>([]);
  const [activeListIds, setActiveListIds] = useState<Set<string>>(new Set());
  const [isAddListModalOpen, setIsAddListModalOpen] = useState(false);
  const [isEditListModalOpen, setIsEditListModalOpen] = useState(false);
  const [editingList, setEditingList] = useState<SavedList | null>(null);
  const [isTemporaryList, setIsTemporaryList] = useState(false);
  const [showListDropdown, setShowListDropdown] = useState(false);
  const [listSearchTerm, setListSearchTerm] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Playlist State
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [filterByPlaylists, setFilterByPlaylists] = useState(false);
  const [selectedPlaylists, setSelectedPlaylists] = useState<Set<string>>(new Set());
  const [filterByVideos, setFilterByVideos] = useState(false);
  const [selectedVideos, setSelectedVideos] = useState<Set<string>>(new Set());
  const [selectedPlaylistMetas, setSelectedPlaylistMetas] = useState<Set<string>>(new Set(['title']));
  const [isLoadingPlaylists, setIsLoadingPlaylists] = useState(false);

  // Metrics & Visualization State
  const [selectedMetrics, setSelectedMetrics] = useState<Set<string>>(new Set(['viewCount', 'publishedAt', 'retention']));
  const [selectedDimensions, setSelectedDimensions] = useState<Set<string>>(new Set(['thumbnail', 'title']));
  const [activeChart, setActiveChart] = useState<'views' | 'subscribersGained' | 'subscribersLost' | 'watchTime' | 'retention' | 'ctr' | 'likes' | 'comments' | 'shares'>('views');
  const [compareEnabled] = useState(true);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [trueDeltaEnabled, setTrueDeltaEnabled] = useState(false);

  // Data Date Tracking
  const [latestDataDate, setLatestDataDate] = useState<string>('');

  // Token Map
  const [channelTokenMap, setChannelTokenMap] = useState<Record<string, string>>({});

  // Refs
  const chartWidgetRef = useRef<HTMLDivElement>(null);
  const channelAnalyticsWidgetRef = useRef<HTMLDivElement>(null);
  const dimensionsPanelRef = useRef<HTMLDivElement>(null);

  // Sync selectedChannelRef
  useEffect(() => {
    selectedChannelRef.current = selectedChannel;
  }, [selectedChannel]);

  return {
    // UI State
    loading, setLoading,
    hasLoadedOnce, setHasLoadedOnce,
    error, setError,
    usageError, setUsageError,
    
    // Tab/Period State
    activeTab, setActiveTab,
    period, setPeriod,
    channelAnalyticsPeriod, setChannelAnalyticsPeriod,
    
    // Channel State
    channels, setChannels,
    orgTokenMap, setOrgTokenMap,
    selectedChannel, setSelectedChannel,
    selectedChannelRef,
    showChannelDropdown, setShowChannelDropdown,
    channelDropdownRef,
    loadingChannels, setLoadingChannels,
    channelSelectionHydrated, setChannelSelectionHydrated,
    
    // Video State
    videos, setVideos,
    videoPlaylistMap, setVideoPlaylistMap,
    loadingVideos, setLoadingVideos,
    videoTypeFilter, setVideoTypeFilter,
    videoSearchQuery, setVideoSearchQuery,
    
    // Video Limit State
    videoLimit, setVideoLimit,
    customLimit, setCustomLimit,
    hasChangedVideoLimit, setHasChangedVideoLimit,
    getVideoLimitStorageKey,
    getCustomLimitStorageKey,
    
    // Analytics State - Video Level
    reportData, setReportData,
    prevReportData, setPrevReportData,
    fullListsData, setFullListsData,
    loadingMultiPeriod, setLoadingMultiPeriod,
    multiPeriodStats, setMultiPeriodStats,
    
    // Analytics State - Channel Level
    channelMetrics, setChannelMetrics,
    prevChannelMetrics, setPrevChannelMetrics,
    channelMultiPeriodStats, setChannelMultiPeriodStats,
    channelAnalyticsData, setChannelAnalyticsData,
    channelAnalyticsChartData, setChannelAnalyticsChartData,
    loadingChannelAnalytics, setLoadingChannelAnalytics,
    
    // Audience State
    audienceDays, setAudienceDays,
    dimensionsData, setDimensionsData,
    loadingDimensions, setLoadingDimensions,
    
    // Selection State
    selectedVideoIds, setSelectedVideoIds,
    tableCheckedOverride, setTableCheckedOverride,
    selectedVideo, setSelectedVideo,
    
    // Saved Lists State
    savedLists, setSavedLists,
    activeListIds, setActiveListIds,
    isAddListModalOpen, setIsAddListModalOpen,
    isEditListModalOpen, setIsEditListModalOpen,
    editingList, setEditingList,
    isTemporaryList, setIsTemporaryList,
    showListDropdown, setShowListDropdown,
    listSearchTerm, setListSearchTerm,
    dropdownRef,
    
    // Playlist State
    playlists, setPlaylists,
    filterByPlaylists, setFilterByPlaylists,
    selectedPlaylists, setSelectedPlaylists,
    filterByVideos, setFilterByVideos,
    selectedVideos, setSelectedVideos,
    selectedPlaylistMetas, setSelectedPlaylistMetas,
    isLoadingPlaylists, setIsLoadingPlaylists,
    
    // Metrics & Visualization State
    selectedMetrics, setSelectedMetrics,
    selectedDimensions, setSelectedDimensions,
    activeChart, setActiveChart,
    compareEnabled,
    showAnnotations, setShowAnnotations,
    trueDeltaEnabled, setTrueDeltaEnabled,
    
    // Data Date Tracking
    latestDataDate, setLatestDataDate,
    
    // Token Map
    channelTokenMap, setChannelTokenMap,
    
    // Refs
    chartWidgetRef,
    channelAnalyticsWidgetRef,
    dimensionsPanelRef,
  };
};

/**
 * Centralized Dashboard Store using Zustand
 * Replaces scattered useState calls across DashboardPage and custom hooks
 */

import { enableMapSet } from "immer";
import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type {
  AnalyticsReport,
  ChannelInfo,
  ChartType,
  DashboardActions,
  DashboardState,
  DashboardTab,
  MultiPeriodStats,
  PlaylistMetadata,
  SavedList,
  VideoMetadata,
} from "../types/dashboard";

enableMapSet();

// ============================================================================
// INITIAL STATE
// ============================================================================

const getInitialActiveTab = (): DashboardTab => {
  try {
    const saved = localStorage.getItem("revtube_active_tab");
    if (
      saved === "videoAnalytics" ||
      saved === "channelAnalytics" ||
      saved === "audience" ||
      saved === "playlistAnalytics" ||
      saved === "insights"
    ) {
      return saved as DashboardTab;
    }
  } catch {
    /* ignore */
  }
  return "channelAnalytics";
};

const getInitialActiveChart = (): ChartType => {
  try {
    const saved = localStorage.getItem("revtube_active_chart");
    const validCharts = [
      "views",
      "subscribersGained",
      "subscribersLost",
      "watchTime",
      "retention",
      "ctr",
      "likes",
      "comments",
      "shares",
    ];
    if (saved && validCharts.includes(saved)) {
      return saved as ChartType;
    }
  } catch {
    /* ignore */
  }
  return "views";
};

const initialState: DashboardState = {
  // Core data
  channel: {
    channels: [],
    selectedChannel: null,
    loadingChannels: false,
    channelSelectionHydrated: false,
    orgTokenMap: {},
  },

  videos: {
    videos: [],
    loadingVideos: false,
    videosError: null,
    hasChangedVideoLimit: false,
  },

  playlists: {
    playlists: [],
    isLoadingPlaylists: false,
  },

  analytics: {
    reportData: null,
    prevReportData: null,
    channelMetrics: null,
    prevChannelMetrics: null,
    multiPeriodStats: null,
    channelMultiPeriodStats: null,
    channelAnalyticsData: null,
    channelAnalyticsChartData: null,
    videoAnomalyInsights: [],
    fullListsData: null,
    dimensionsMultiPeriod: null,
    insightsData: null,
    loading: false,
    loadingMultiPeriod: false,
    loadingInsights: false,
    isRefreshing: false,
    loadingChannelAnalytics: false,
    loadingDimensions: false,
    hasLoadedOnce: false,
    error: null,
    usageError: null,
    bundleChannelTotals: null,
    bundlePrevChannelTotals: null,
  },

  lists: {
    savedLists: [],
    activeLists: [],
  },

  // Filters & Selection
  filters: {
    type: "all",
    searchQuery: "",
    visibility: "public",
    playlistVisibility: "public",
    activity: "all",
    playlists: {
      enabled: false,
      selected: new Set(),
    },
    videos: {
      enabled: false,
      selected: new Set(),
    },
  },

  videoLimit: {
    mode: 25,
    customValue: 100,
  },

  videoSelection: {
    selectedVideo: null,
    selectedVideoIds: new Set(),
    tableCheckedOverride: null,
  },

  playlistSelection: {
    selectedPlaylists: new Set(),
  },

  listSelection: {
    activeListIds: new Set(),
    isTemporaryList: false,
  },

  // UI State
  ui: {
    activeTab: getInitialActiveTab(),
    activeChart: getInitialActiveChart(),
    showAnnotations: true,
    trueDeltaEnabled: false,
    compareEnabled: false,
    showAllTimeViews: false,
    selectedMetrics: new Set(["viewCount", "publishedAt", "retention"]),
    selectedDimensions: new Set(["thumbnail", "title", "status"]),
    selectedPlaylistMetas: new Set(["title"]),
  },

  modals: {
    showListDropdown: false,
    isAddListModalOpen: false,
    isEditListModalOpen: false,
    editingList: null,
    listSearchTerm: "",
  },

  dateRange: {
    period: null,
    customStartDate: null,
    customEndDate: null,
    latestDataDate: null,
  },
};

// ============================================================================
// STORE DEFINITION
// ============================================================================

export const useDashboardStore = create<DashboardState & DashboardActions>()(
  devtools(
    immer((set) => ({
      ...initialState,

      // ========================================================================
      // CHANNEL ACTIONS
      // ========================================================================

      setChannels: (channels: ChannelInfo[]) => {
        set((state) => {
          state.channel.channels = channels;
        });
      },

      setSelectedChannel: (channelId: string | null) => {
        set((state) => {
          state.channel.selectedChannel = channelId;

          // Persist to localStorage
          if (channelId) {
            try {
              localStorage.setItem("selectedChannel_last", channelId);
            } catch {
              /* ignore */
            }
          }
        });
      },

      setOrgTokenMap: (map: Record<string, { accessToken: string; refreshToken: string; expiresAt?: number }>) => {
        set((state) => {
          state.channel.orgTokenMap = map;
        });
      },

      // ========================================================================
      // VIDEO ACTIONS
      // ========================================================================

      setVideos: (videos: VideoMetadata[]) => {
        set((state) => {
          state.videos.videos = videos;
        });
      },

      setLoadingVideos: (loading: boolean) => {
        set((state) => {
          state.videos.loadingVideos = loading;
        });
      },

      setVideosError: (error: string | null) => {
        set((state) => {
          state.videos.videosError = error;
        });
      },

      // ========================================================================
      // PLAYLIST ACTIONS
      // ========================================================================

      setPlaylists: (playlists: PlaylistMetadata[]) => {
        set((state) => {
          state.playlists.playlists = playlists;
        });
      },

      setLoadingPlaylists: (loading: boolean) => {
        set((state) => {
          state.playlists.isLoadingPlaylists = loading;
        });
      },

      // ========================================================================
      // FILTER ACTIONS
      // ========================================================================

      setVideoTypeFilter: (type: "all" | "shorts" | "long") => {
        set((state) => {
          state.filters.type = type;
        });
      },

      setVideoSearchQuery: (query: string) => {
        set((state) => {
          state.filters.searchQuery = query;
        });
      },

      setVideoVisibilityFilter: (visibility: "public" | "private" | "unlisted" | "all") => {
        set((state) => {
          state.filters.visibility = visibility;
        });
      },

      setPlaylistVisibilityFilter: (visibility: "public" | "private" | "unlisted" | "all") => {
        set((state) => {
          state.filters.playlistVisibility = visibility;
        });
      },

      setPlaylistActivityFilter: (activity: "all" | "running" | "archive") => {
        set((state) => {
          state.filters.activity = activity;
        });
      },

      setFilterByPlaylists: (enabled: boolean) => {
        set((state) => {
          state.filters.playlists.enabled = enabled;
        });
      },

      setSelectedPlaylists: (playlists: Set<string>) => {
        set((state) => {
          state.playlistSelection.selectedPlaylists = playlists;
          state.filters.playlists.selected = playlists;
        });
      },

      setFilterByVideos: (enabled: boolean) => {
        set((state) => {
          state.filters.videos.enabled = enabled;
        });
      },

      setSelectedVideos: (videos: Set<string>) => {
        set((state) => {
          state.filters.videos.selected = videos;
        });
      },

      // ========================================================================
      // SELECTION ACTIONS
      // ========================================================================

      setSelectedVideo: (video: VideoMetadata | null) => {
        set((state) => {
          state.videoSelection.selectedVideo = video;
        });
      },

      setSelectedVideoIds: (ids: Set<string>) => {
        set((state) => {
          state.videoSelection.selectedVideoIds = ids;
        });
      },

      setTableCheckedOverride: (ids: Set<string> | null) => {
        set((state) => {
          state.videoSelection.tableCheckedOverride = ids;
        });
      },

      // ========================================================================
      // LIST ACTIONS
      // ========================================================================

      setActiveListIds: (ids: Set<string>) => {
        set((state) => {
          state.listSelection.activeListIds = ids;

          // Update activeLists based on savedLists
          const savedLists = state.lists.savedLists;
          state.lists.activeLists = savedLists.filter((list) =>
            ids.has(list.id),
          );
        });
      },

      setSavedLists: (lists: SavedList[]) => {
        set((state) => {
          state.lists.savedLists = lists;

          // Update activeLists
          const activeIds = state.listSelection.activeListIds;
          state.lists.activeLists = lists.filter((list) =>
            activeIds.has(list.id),
          );
        });
      },

      // ========================================================================
      // UI ACTIONS
      // ========================================================================

      setActiveTab: (tab: DashboardTab) => {
        set((state) => {
          state.ui.activeTab = tab;

          // Persist to localStorage
          try {
            localStorage.setItem("revtube_active_tab", tab);
          } catch {
            /* ignore */
          }
        });
      },

      setActiveChart: (chart: ChartType) => {
        set((state) => {
          state.ui.activeChart = chart;

          // Persist to localStorage
          try {
            localStorage.setItem("revtube_active_chart", chart);
          } catch {
            /* ignore */
          }
        });
      },

      setShowAnnotations: (show: boolean) => {
        set((state) => {
          state.ui.showAnnotations = show;
        });
      },

      setTrueDeltaEnabled: (enabled: boolean) => {
        set((state) => {
          state.ui.trueDeltaEnabled = enabled;
        });
      },

      setCompareEnabled: (enabled: boolean) => {
        set((state) => {
          state.ui.compareEnabled = enabled;
        });
      },

      setShowAllTimeViews: (show: boolean) => {
        set((state) => {
          state.ui.showAllTimeViews = show;
        });
      },

      // ========================================================================
      // DATE RANGE ACTIONS
      // ========================================================================

      setPeriod: (period: 7 | 30 | 90 | null) => {
        set((state) => {
          state.dateRange.period = period;
        });
      },

      setCustomDateRange: (start: string | null, end: string | null) => {
        set((state) => {
          state.dateRange.customStartDate = start;
          state.dateRange.customEndDate = end;
        });
      },

      setLatestDataDate: (date: string | null) => {
        set((state) => {
          state.dateRange.latestDataDate = date;

          // Persist to localStorage per channel
          const channelId = state.channel.selectedChannel;
          if (channelId && date) {
            try {
              localStorage.setItem(`latestDataDate_${channelId}`, date);
              localStorage.setItem(
                `latestDataDate_${channelId}_time`,
                Date.now().toString(),
              );
            } catch {
              /* ignore */
            }
          }
        });
      },

      // ========================================================================
      // MODAL ACTIONS
      // ========================================================================

      setShowListDropdown: (show: boolean) => {
        set((state) => {
          state.modals.showListDropdown = show;
        });
      },

      setIsAddListModalOpen: (open: boolean) => {
        set((state) => {
          state.modals.isAddListModalOpen = open;
        });
      },

      setIsEditListModalOpen: (open: boolean) => {
        set((state) => {
          state.modals.isEditListModalOpen = open;
        });
      },

      setEditingList: (list: SavedList | null) => {
        set((state) => {
          state.modals.editingList = list;
        });
      },

      // ========================================================================
      // ANALYTICS ACTIONS
      // ========================================================================

      setAnalyticsData: (data: Partial<typeof initialState.analytics>) => {
        set((state) => {
          Object.assign(state.analytics, data);
        });
      },

      setAnalyticsLoading: (loading: boolean) => {
        set((state) => {
          state.analytics.loading = loading;
        });
      },

      setAnalyticsError: (error: string | null) => {
        set((state) => {
          state.analytics.error = error;
        });
      },

      setChannelAnalyticsData: (data: {
        channelMetrics?: AnalyticsReport | null;
        channelOverview?: {
          views: number;
          subscribersGained: number;
          subscribersLost: number;
          watchTime: number;
          likes: number;
          comments: number;
          shares: number;
          videosUploaded: number;
        } | null;
        channelAnalyticsChartData?: Array<{
          date: string;
          [key: string]: string | number | undefined;
        }> | null;
        channelMultiPeriodStats?: MultiPeriodStats | null;
      }) => {
        set((state) => {
          if (data.channelMetrics)
            state.analytics.channelMetrics = data.channelMetrics;
          if (data.channelOverview)
            state.analytics.channelAnalyticsData = data.channelOverview;
          if (data.channelAnalyticsChartData)
            state.analytics.channelAnalyticsChartData = data.channelAnalyticsChartData;
          if (data.channelMultiPeriodStats !== undefined)
            state.analytics.channelMultiPeriodStats = data.channelMultiPeriodStats;
        });
      },

      setChannelAnalyticsLoading: (loading: boolean) => {
        set((state) => {
          state.analytics.loadingChannelAnalytics = loading;
        });
      },

      setDimensionsData: (data: unknown) => {
        set((state) => {
          state.analytics.dimensionsMultiPeriod = data;
        });
      },

      setDimensionsLoading: (loading: boolean) => {
        set((state) => {
          state.analytics.loadingDimensions = loading;
        });
      },

      // ========================================================================
      // BULK ACTIONS
      // ========================================================================

      resetChannelState: () => {
        set((state) => {
          // Reset video selection
          state.videoSelection.selectedVideo = null;
          state.videoSelection.selectedVideoIds = new Set();
          state.videoSelection.tableCheckedOverride = null;

          // Reset playlist picker selection (kept in sync with filters.playlists via setSelectedPlaylists)
          state.playlistSelection.selectedPlaylists = new Set();

          // Reset list selection
          state.listSelection.activeListIds = new Set();
          state.listSelection.isTemporaryList = false;
          state.lists.activeLists = [];

          // Reset filters
          state.filters.searchQuery = "";
          state.filters.visibility = "public";
          state.filters.playlistVisibility = "public";
          state.filters.activity = "all";
          state.filters.playlists.enabled = false;
          state.filters.playlists.selected = new Set();
          state.filters.videos.enabled = false;
          state.filters.videos.selected = new Set();

          // Custom range + cached latest date belong to the previous channel context
          state.dateRange.customStartDate = null;
          state.dateRange.customEndDate = null;
          state.dateRange.latestDataDate = null;

          // Reset data
          state.videos.videos = [];
          state.playlists.playlists = [];
          state.analytics = { ...initialState.analytics };
        });
      },

      resetFilters: () => {
        set((state) => {
          state.filters = { ...initialState.filters };
        });
      },

      resetSelection: () => {
        set((state) => {
          state.videoSelection = { ...initialState.videoSelection };
          state.playlistSelection = { ...initialState.playlistSelection };
        });
      },
    })),
    { name: "DashboardStore" },
  ),
);

// ============================================================================
// SELECTORS
// ============================================================================

// Channel selectors
export const selectChannels = (state: DashboardState & DashboardActions) =>
  state.channel.channels;
export const selectSelectedChannel = (
  state: DashboardState & DashboardActions,
) => state.channel.selectedChannel;
export const selectLoadingChannels = (
  state: DashboardState & DashboardActions,
) => state.channel.loadingChannels;

// Video selectors
export const selectVideos = (state: DashboardState & DashboardActions) =>
  state.videos.videos;
export const selectLoadingVideos = (state: DashboardState & DashboardActions) =>
  state.videos.loadingVideos;
export const selectVideosError = (state: DashboardState & DashboardActions) =>
  state.videos.videosError;

// Playlist selectors
export const selectPlaylists = (state: DashboardState & DashboardActions) =>
  state.playlists.playlists;
export const selectLoadingPlaylists = (
  state: DashboardState & DashboardActions,
) => state.playlists.isLoadingPlaylists;

// Filter selectors
export const selectFilters = (state: DashboardState & DashboardActions) =>
  state.filters;
export const selectVideoTypeFilter = (
  state: DashboardState & DashboardActions,
) => state.filters.type;
export const selectVideoSearchQuery = (
  state: DashboardState & DashboardActions,
) => state.filters.searchQuery;

// Selection selectors
export const selectSelectedVideo = (state: DashboardState & DashboardActions) =>
  state.videoSelection.selectedVideo;
export const selectSelectedVideoIds = (
  state: DashboardState & DashboardActions,
) => state.videoSelection.selectedVideoIds;
export const selectSelectedPlaylists = (
  state: DashboardState & DashboardActions,
) => state.playlistSelection.selectedPlaylists;

// List selectors
export const selectActiveListIds = (state: DashboardState & DashboardActions) =>
  state.listSelection.activeListIds;
export const selectActiveLists = (state: DashboardState & DashboardActions) =>
  state.lists.activeLists;
export const selectSavedLists = (state: DashboardState & DashboardActions) =>
  state.lists.savedLists;

// UI selectors
export const selectActiveTab = (state: DashboardState & DashboardActions) =>
  state.ui.activeTab;
export const selectActiveChart = (state: DashboardState & DashboardActions) =>
  state.ui.activeChart;
export const selectShowAnnotations = (
  state: DashboardState & DashboardActions,
) => state.ui.showAnnotations;

// Date range selectors
export const selectPeriod = (state: DashboardState & DashboardActions) =>
  state.dateRange.period;
export const selectCustomDateRange = (
  state: DashboardState & DashboardActions,
) => ({
  start: state.dateRange.customStartDate,
  end: state.dateRange.customEndDate,
});
export const selectLatestDataDate = (
  state: DashboardState & DashboardActions,
) => state.dateRange.latestDataDate;

// Analytics selectors
export const selectAnalytics = (state: DashboardState & DashboardActions) =>
  state.analytics;
export const selectAnalyticsLoading = (
  state: DashboardState & DashboardActions,
) => state.analytics.loading;
export const selectAnalyticsError = (
  state: DashboardState & DashboardActions,
) => state.analytics.error;

// Modal selectors
export const selectModals = (state: DashboardState & DashboardActions) =>
  state.modals;

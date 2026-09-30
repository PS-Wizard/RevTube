/**
 * Channel analytics dashboard (Zustand + React Query).
 */

import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useSearchParams } from "react-router-dom";

// Auth & Organization
import { useAuth } from "../../hooks/useAuth";
import { useConfirm } from "../../hooks/useConfirm";
import { useOrganization } from "../../hooks/useOrganization";

// New Refactored Hooks
import { useDashboardChannel } from "../../hooks/useDashboardChannel";
import { useDashboardChannelSync } from "../../hooks/useDashboardChannelSync";
import { useDashboardFilters } from "../../hooks/useDashboardFilters";
import { useDashboardLists } from "../../hooks/useDashboardLists";
import { useDashboardPlaylistViews } from "../../hooks/useDashboardPlaylistViews";
import { useDashboardSelection } from "../../hooks/useDashboardSelection";
import { useDashboardUI } from "../../hooks/useDashboardUI";
import { useStatCardLayout } from "../../hooks/useStatCardLayout";

// React Query Hooks
import { useAnalyticsQuery } from "../../hooks/queries/useAnalyticsQuery";
import { useAudienceTabQuery } from "../../hooks/queries/useAudienceTabQuery";
import { useChannelTabQuery } from "../../hooks/queries/useChannelTabQuery";
import { usePlaylistsQuery } from "../../hooks/queries/usePlaylistsQuery";
import { useVideosQuery } from "../../hooks/queries/useVideosQuery";

// Store & Selectors
import {
  useActiveRangeLabel,
  useAudiencePrimaryPeriod,
  useCurrentChannelName,
  useFilteredVideos,
  useFilteredPlaylists,
  useFormattedLatestDate,
  useIsVideoTableTab,
  useListScopedPlaylists,
  useListScopedVideos,
  useShowDashboardPlaylistColumns,
  useVideoTableRows,
} from "../../stores/dashboardSelectors";
import { useDashboardStore } from "../../stores/dashboardStore";
import type { ChannelInfo } from "../../types/dashboard";

// Services & Utils
import { useDashboardFullListsData } from "../../hooks/useDashboardFullListsData";
import { queryClient } from "../../lib/queryClient";
import {
  AnalyticsService,
  type AnalyticsReport,
} from "../../services/analyticsService";
import { getFirebaseAuthHeader } from "../../services/authHeaders";
import {
  addChannelToOrganization,
  moveChannelToOrganization,
  removeChannelFromOrganization,
} from "../../services/organizationChannelService";
import type { SavedList } from "../../services/savedListService";
import { deleteYouTubeToken } from "../../services/userService";
import { YouTubeService } from "../../services/youtubeService";
import type { PlaylistMetadata, VideoMetadata } from "../../types/youtube";
import { getVideoSubset } from "../../utils/analyticsFilter";
import { apiUrl } from "../../utils/apiBase";
import { buildVideoChartRows } from "../../utils/videoChartData";
import { MULTI_SERIES_FALLBACK_COLORS } from "../../utils/chartTheme";
import { exportPlaylistsToCSV, exportToCSV } from "../../utils/csvExport";
import type { DimensionsMultiPeriodData, FilterableVideo } from "../../utils/dashboardUtils";
import {
  resolveGraphPlaylistIds,
  resolveGraphVideoIds,
} from "../../utils/graphScope";
import {
  REVTUBE_DASHBOARD_WS_ROOT,
  getDashboardWorkspaceKey,
} from "../../utils/dashboardWorkspaceScope";
import { downloadElementAsPNG } from "../../utils/downloadImage";
import { markInteractionEnd, markInteractionStart } from "../../utils/perf";

// Components
import AddListModal from "../../components/AddListModal";
import { AudienceBreakdownPanel } from "../../components/dashboard/AudienceBreakdownPanel";
import { ChannelAnalyticsInsights, type ChannelAnalyticsData } from "../../components/dashboard/ChannelAnalyticsInsights";
import { InsightsPanel } from "../../components/dashboard/InsightsPanel";
import { DashboardConnectState } from "../../components/dashboard/DashboardConnectState";
import { DashboardErrorBanner } from "../../components/dashboard/DashboardErrorBanner";
import { DashboardVideoDetail } from "../../components/dashboard/DashboardVideoDetail";
import { DashboardHeader } from "../../components/dashboard/DashboardHeader";
import { DashboardLoadToolbar } from "../../components/dashboard/DashboardLoadToolbar";
import { EditListModal } from "../../components/dashboard/EditListModal";
import { PlaylistTable } from "../../components/dashboard/PlaylistTable";
import { SavedListsPanel } from "../../components/dashboard/SavedListsPanel";
import { VideoAnalyticsChart } from "../../components/dashboard/VideoAnalyticsChart";
import { GoalsOverviewBanner } from "../../components/goals/GoalsOverviewBanner";
import { ChannelFocusDialog } from "../../components/channel/ChannelFocusDialog";
import { FeatureGuard } from "../../components/FeatureGuard";
import { PageShell } from "../../components/layout/PageShell";
import { SkeletonDashboardShell } from "../../components/SkeletonLoaders";
import { Button, Box } from "../../components/ui";
import { UsageLimitBanner } from "../../components/UsageLimitBanner";
import { VideoTable } from "../../components/VideoTable";
import { VideoDetailDialog } from "../../components/VideoDetailDialog";

import { toast } from "react-hot-toast";
import "./DashboardPage.css";

/** Stable fallbacks so React Query `data === undefined` does not allocate a new [] every render (would re-fire sync effects and loop #185). */
const EMPTY_VIDEO_LIST: VideoMetadata[] = [];
const EMPTY_PLAYLIST_LIST: PlaylistMetadata[] = [];

export const DashboardPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [isConnectingChannel, setIsConnectingChannel] = useState(false);
  /** Per-list analytics reports fetched when multiple playlist-type lists are active. */
  const [playlistListsSeriesData, setPlaylistListsSeriesData] = useState<Map<
    string,
    AnalyticsReport
  > | null>(null);
  const [loadingPlaylistListsSeries, setLoadingPlaylistListsSeries] =
    useState(false);
  const [detailVideo, setDetailVideo] = useState<VideoMetadata | null>(null);

  // ============================================================================
  // AUTH & ORGANIZATION
  // ============================================================================

  const { allTokens, user, loginWithYouTube, isCheckingAuth, isLoadingTokens, isResumingOAuth } =
    useAuth();
  const {
    currentOrganization,
    isPersonalContext,
    isOwner,
    isAdmin,
    canEdit: canEditOrganization,
    loading: organizationLoading,
  } = useOrganization();

  const { confirm, ConfirmationModal } = useConfirm();

  // ============================================================================
  // REFACTORED HOOKS (Replaces 70+ useState calls)
  // ============================================================================

  // Channel management
  const {
    channels,
    selectedChannel,
    channelSelectionHydrated,
    loadingChannels,
    getEffectiveToken,
    saveLatestDataDate,
  } = useDashboardChannel();

  // Sync channel changes (resets dependent state)
  useDashboardChannelSync();

  // Filter management (replaces 8+ filter variables)
  const {
    filters,
    videoLimit,
    setVideoTypeFilter,
    setVideoSearchQuery,
    setVideoVisibilityFilter,
    setPlaylistVisibilityFilter,
    setFilterByPlaylists,
    setSelectedPlaylists,
    setFilterByVideos,
    setSelectedVideos,
    /* setVideoLimit / setCustomLimit intentionally omitted -- the dashboard now
       always loads the full catalog (DB-backed, no load-limit dropdown). */
  } = useDashboardFilters();

  // Derive the YouTube OAuth access token from the first available token for captions fetching
  const youtubeAccessToken = allTokens?.[0]?.accessToken;

  /** No-arg wrapper that captures the current selectedChannel -- safe for click handlers but NOT for RQ queryFns (retries/refetches can use stale closure). Use getEffectiveToken(channelId) directly for those. */
  const getTokenForSelectedChannel = useCallback(async () => {
    if (!selectedChannel) return null;
    return getEffectiveToken(selectedChannel);
  }, [selectedChannel, getEffectiveToken]);

  // Selection management
  const {
    selectedVideo,
    selectedVideoIds,
    tableCheckedOverride,
    activeListIds,
    setSelectedVideo,
    setSelectedVideoIds,
    setTableCheckedOverride,
  } = useDashboardSelection();

  // UI state management (replaces 15+ UI variables)
  const {
    activeTab,
    activeChart,
    showAnnotations,
    trueDeltaEnabled,
    compareEnabled,
    showAllTimeViews,
    selectedMetrics,
    selectedDimensions,
    selectedPlaylistMetas,
    period,
    customStartDate,
    customEndDate,
    latestDataDate,
    showListDropdown,
    isAddListModalOpen,
    isEditListModalOpen,
    editingList,
    listSearchTerm,
    switchTab,
    switchChart,
    setShowAnnotations,
    setTrueDeltaEnabled,
    setCompareEnabled,
    setCustomDateRange,
    setShowListDropdown,
    setIsAddListModalOpen,
    setIsEditListModalOpen,
    setEditingList,
    setListSearchTerm,
  } = useDashboardUI();

  // Stat-card customization: localStorage mirror now, backend reconcile after.
  useStatCardLayout();

  // Channel Focus & Knowledge dialog (per-channel context-menu entry)
  const [focusChannelId, setFocusChannelId] = useState<string | null>(null);
  const focusChannel = focusChannelId ? channels.find((c) => c.id === focusChannelId) : undefined;

  const switchTabMeasured = useCallback(
    (
      tab:
        | "channelAnalytics"
        | "videoAnalytics"
        | "playlistAnalytics"
        | "audience"
        | "insights",
    ) => {
      markInteractionStart(`dashboard:tab:${tab}`);
      switchTab(tab);
      requestAnimationFrame(() => {
        markInteractionEnd(`dashboard:tab:${tab}`);
      });
    },
    [switchTab],
  );

  // List management
  const {
    savedLists,
    activeLists,
    handleCreateList,
    handleUpdateList,
    handleRemoveList,
  } = useDashboardLists();

  const { isFetching: fullListsFetching } =
    useDashboardFullListsData(getTokenForSelectedChannel);

  // ============================================================================
  // COMPUTED SELECTORS (Replaces 15+ useMemo chains)
  // ============================================================================

  const listScopedVideos = useListScopedVideos();
  const listScopedPlaylists = useListScopedPlaylists();
  const filteredPlaylists = useFilteredPlaylists();

  const listScopedPlaylistIdsSig = useMemo(
    () =>
      listScopedPlaylists
        .map((p) => p.id)
        .sort()
        .join("\0"),
    [listScopedPlaylists],
  );
  /** When true, playlist row checkboxes were changed by the user -- do not auto-fill selection. */
  const playlistRowCheckUserEditedRef = useRef(false);
  /** Set when "Load" is clicked to force one-time select-all after playlist data settles. */
  const playlistForceAutoSelectRef = useRef(false);
  const playlistScopeSigPrevRef = useRef("");
  /** Last playlist id set passed to PlaylistTable -- used to detect “all visible rows were selected” when more rows load. */
  const playlistTableScopedIdsRef = useRef<Set<string>>(new Set());
  /** Last video-tab assignment hydration key (channel + playlist set) -- the
   *  hydration writes sourcePlaylistIds back into the store, so without this
   *  guard the effect below would re-run on its own output. */
  const videoPlaylistHydrateKeyRef = useRef<string | null>(null);

  const setPlaylistSelectionProgrammatic = useCallback(
    (ids: Set<string>) => {
      playlistRowCheckUserEditedRef.current = false;
      setSelectedPlaylists(ids);
    },
    [setSelectedPlaylists],
  );

  const filteredVideos = useFilteredVideos();
  const videoTableRows = useVideoTableRows();
  const isVideoTableTab = useIsVideoTableTab();
  const showDashboardFetchToolbar = !selectedVideo && isVideoTableTab;
  const audiencePrimaryPeriod = useAudiencePrimaryPeriod();
  const activeRangeLabel = useActiveRangeLabel();
  const formattedLatestDate = useFormattedLatestDate();
  const showDashboardPlaylistColumns = useShowDashboardPlaylistColumns();
  const currentChannelName = useCurrentChannelName();

  // ============================================================================
  // REACT QUERY DATA FETCHING (Replaces manual fetch logic)
  // ============================================================================

  /** Channel analytics uploads + totals use every video; table tabs use the toolbar limit. */
  // Always load the full channel catalog from the DB-backed endpoint (L1 Redis → L2
  // Postgres → live only as fallback). The load-limit dropdown is no longer needed
  // since the DB holds the complete catalog; the table's client-side pagination
  // handles display of all videos.
  const videosQueryLimit = useMemo(() => "all" as const, []);

  const {
    data: videosData,
    videosTotal,
    isLoading: loadingVideos,
    isFetching: fetchingVideos,
    error: videosError,
    refetch: refetchVideos,
    hasNextPage: hasMoreVideos,
    fetchNextPage: loadMoreVideos,
    isFetchingNextPage: loadingMoreVideos,
  } = useVideosQuery({
    channelId: selectedChannel,
    getEffectiveToken,
    videoLimit: videosQueryLimit,
    customLimit: videoLimit.customValue,
    enabled: !!selectedChannel && channelSelectionHydrated,
  });
  const videos = videosData ?? EMPTY_VIDEO_LIST;

  /**
   * Bridge: when Zustand store hasn't synced yet (resetChannelState on channel
   * switch / initial mount), the store selectors return [] while React Query
   * already has cached data in `videos`.  Using the store-only rows would flash
   * the empty state with no video names or thumbnails visible.  Fall back to
   * the raw RQ data when the store hasn't caught up.
   */
  const tableVideos = useMemo(() => {
    if (videoTableRows.length > 0) return videoTableRows;
    // Empty store + RQ has cached data + not in loading (skeleton would cover) → use RQ data
    if (!loadingVideos && videos.length > 0) return videos;
    return videoTableRows;
  }, [videoTableRows, loadingVideos, videos]);

  // Playlists load incrementally like videos: the first 20-row page arrives
  // fast and the table fetches more on Next / rows-per-page growth /
  // select-all. No fetch cap -- the backend serves the DB-backed catalog.
  const {
    data: playlistsData,
    playlistsTotal,
    partialError: playlistsPartialError,
    isLoading: isLoadingPlaylists,
    isFetching: fetchingPlaylists,
    error: playlistsError,
    refetch: refetchPlaylists,
    hasNextPage: hasMorePlaylists,
    fetchNextPage: loadMorePlaylists,
    isFetchingNextPage: loadingMorePlaylists,
  } = usePlaylistsQuery({
    channelId: selectedChannel,
    getEffectiveToken,
    enabled:
      !!selectedChannel &&
      channelSelectionHydrated &&
      !loadingChannels &&
      // Video tab needs the catalog too: playlist title/meta columns and
      // video->playlist assignment hydration read from the same list.
      (activeTab === "playlistAnalytics" || activeTab === "videoAnalytics"),
  });
  const playlists = playlistsData ?? EMPTY_PLAYLIST_LIST;
  /** Channel-level playlist truth (backend catalog total).
   *  Falls back to the loaded row count when the backend predates the envelope. */
  const playlistCatalogTotal = Math.max(playlistsTotal ?? 0, playlists.length);

  /** Drain every remaining playlist page (select-all, rows-per-page "All").
   *  Reads hasNextPage off each fetch result so the loop never uses a stale
   *  closure; guarded so a misbehaving backend cannot loop forever. */
  const drainAllPlaylistPages = useCallback(async () => {
    if (!loadMorePlaylists) return;
    let guard = 0;
    let result = await loadMorePlaylists();
    while (result?.hasNextPage && guard < 50) {
      guard += 1;
      result = await loadMorePlaylists();
    }
  }, [loadMorePlaylists]);

  // Analytics data fetching
  // Graph scopes -- the charts follow the tables (legacy useDashboardAnalytics
  // semantics). Playlist graph: checked rows ∩ visible rows (list scope +
  // status/activity filters), so status changes and (un)checks refetch. Video
  // graph: opened video → explicit row checks → narrowing toolbar filters
  // expanded to IDs → channel-wide. Both feed useAnalyticsQuery below.
  const graphPlaylistIds = useMemo(
    () =>
      resolveGraphPlaylistIds(
        filters.playlists.selected,
        filteredPlaylists.map((p) => p.id),
      ),
    [filters.playlists.selected, filteredPlaylists],
  );
  const graphVideoIds = useMemo(
    () =>
      resolveGraphVideoIds({
        selectedVideoId: selectedVideo?.videoId ?? null,
        checkedVideoIds: [...(tableCheckedOverride ?? selectedVideoIds)].filter(
          (id) => id !== "XX_NONE_XX_",
        ),
        visibilityFilter: filters.visibility,
        videoTypeFilter: filters.type,
        videoSearchQuery: filters.searchQuery,
        filterByPlaylists: filters.playlists.enabled,
        selectedPlaylists: filters.playlists.selected,
        filterByVideos: filters.videos.enabled,
        selectedVideos: filters.videos.selected,
        videos: videos as FilterableVideo[],
      }),
    [
      selectedVideo,
      tableCheckedOverride,
      selectedVideoIds,
      filters.visibility,
      filters.type,
      filters.searchQuery,
      filters.playlists.enabled,
      filters.playlists.selected,
      filters.videos.enabled,
      filters.videos.selected,
      videos,
    ],
  );
  const { refetch: refetchAnalytics, enrichingVideoInsights } =
    useAnalyticsQuery({
      channelId: selectedChannel,
      selectedVideo,
      scopedVideoIds: graphVideoIds,
      scopedPlaylistIds: graphPlaylistIds,
      activeTab,
      period,
      customStartDate,
      customEndDate,
      compareEnabled,
      trueDeltaEnabled,
      latestDataDate,
      videos,
      getEffectiveToken,
      onPersistLatestDate: saveLatestDataDate,
      enabled:
        !!selectedChannel &&
        channelSelectionHydrated &&
        (activeTab === "videoAnalytics" || activeTab === "playlistAnalytics"),
    });

  useDashboardPlaylistViews({
    getEffectiveToken,
    enabled:
      !!selectedChannel &&
      channelSelectionHydrated &&
      !loadingChannels &&
      activeTab === "playlistAnalytics",
  });

  // Channel analytics -- single combined endpoint (replaces 7 separate report calls)
  useChannelTabQuery({
    channelId: selectedChannel,
    period,
    customStartDate,
    customEndDate,
    getEffectiveToken,
    onPersistLatestDate: saveLatestDataDate,
    enabled:
      !!selectedChannel &&
      channelSelectionHydrated &&
      !loadingChannels &&
      activeTab === "channelAnalytics",
  });

  // Audience dimensions -- single combined endpoint (replaces 3-6 separate dimension calls)
  useAudienceTabQuery({
    channelId: selectedChannel,
    selectedVideoIds,
    latestDataDate,
    customStartDate,
    customEndDate,
    getEffectiveToken,
    enabled:
      !!selectedChannel && channelSelectionHydrated && activeTab === "audience",
  });

  // Insights -- managed internally by <InsightsPanel> with timezone + segment controls

  // ============================================================================
  // REFS
  // ============================================================================

  const chartWidgetRef = useRef<HTMLDivElement>(null);
  const channelAnalyticsWidgetRef = useRef<HTMLDivElement>(null);
  const dimensionsPanelRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const videoTableExportRowsRef = useRef<VideoMetadata[]>([]);
  const [dismissedAnomalyState, setDismissedAnomalyState] = useState<{
    key: string;
    dates: Set<string>;
  }>({
    key: "",
    dates: new Set(),
  });

  // ============================================================================
  // STORE ACCESS (Direct access for complex operations)
  // ============================================================================

  const setActiveListIds = useDashboardStore((state) => state.setActiveListIds);
  const setVideos = useDashboardStore((state) => state.setVideos);
  const setPlaylists = useDashboardStore((state) => state.setPlaylists);
  const setLoadingVideos = useDashboardStore((state) => state.setLoadingVideos);
  const setLoadingPlaylists = useDashboardStore(
    (state) => state.setLoadingPlaylists,
  );

  const analytics = useDashboardStore((state) => state.analytics);
  const videoAnalyticsChartRefreshing =
    analytics.isRefreshing || fetchingVideos || enrichingVideoInsights;
  const anomalyInsightsKey = useMemo(() => {
    const anomalies = Array.isArray(analytics.videoAnomalyInsights)
      ? analytics.videoAnomalyInsights
      : [];
    return anomalies.map((item) => item.date).join("|");
  }, [analytics.videoAnomalyInsights]);
  const visibleAnomalyInsights = useMemo(() => {
    const anomalies = Array.isArray(analytics.videoAnomalyInsights)
      ? analytics.videoAnomalyInsights
      : [];
    const effectiveDismissedDates =
      dismissedAnomalyState.key === anomalyInsightsKey
        ? dismissedAnomalyState.dates
        : new Set<string>();
    if (effectiveDismissedDates.size === 0) return anomalies;
    return anomalies.filter((item) => !effectiveDismissedDates.has(item.date));
  }, [
    analytics.videoAnomalyInsights,
    anomalyInsightsKey,
    dismissedAnomalyState,
  ]);
  const anomalyByDate = useMemo(() => {
    return new Map(visibleAnomalyInsights.map((item) => [item.date, item]));
  }, [visibleAnomalyInsights]);
  const videoMetaById = useMemo(() => {
    const byId = new Map<string, { title?: string; thumbnailUrl?: string }>();
    videos.forEach((video) => {
      if (!video?.videoId) return;
      byId.set(video.videoId, {
        title: video.title,
        thumbnailUrl: video.thumbnailUrl,
      });
    });
    return byId;
  }, [videos]);

  // ============================================================================
  // COMPUTED VALUES
  // ============================================================================

  // Chart data computation - reads from store analytics
  const chartData = useMemo(() => {
    const { reportData, prevReportData } = analytics;
    const start = customStartDate ? dayjs(customStartDate) : null;
    const end = customEndDate ? dayjs(customEndDate) : null;
    const periodDays =
      start?.isValid() && end?.isValid()
        ? Math.max(1, end.diff(start, "day") + 1)
        : (period ?? 30);

    return buildVideoChartRows(reportData, prevReportData, periodDays).map((row) => {
      const anomaly = anomalyByDate.get(row.date);
      const fallbackMeta = anomaly?.topVideoId
        ? videoMetaById.get(anomaly.topVideoId)
        : undefined;
      return {
        ...row,
        anomalyKind: anomaly?.kind,
        anomalyDeltaViews: anomaly?.deltaViews,
        anomalyTopVideoTitle: anomaly?.topVideoTitle || fallbackMeta?.title,
        anomalyTopVideoId: anomaly?.topVideoId,
        anomalyTopVideoViews: anomaly?.topVideoViews,
        anomalyTopVideoDeltaViews: anomaly?.topVideoDeltaViews,
        anomalyTopVideoThumbnailUrl:
          anomaly?.topVideoThumbnailUrl || fallbackMeta?.thumbnailUrl,
      };
    });
  }, [
    analytics,
    anomalyByDate,
    videoMetaById,
    period,
    customStartDate,
    customEndDate,
  ]);

  const videoStats = useMemo(() => {
    if (chartData.length === 0) {
      return {
        views: 0,
        watchTime: 0,
        subscribers: 0,
        retention: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        prevViews: 0,
        prevWatchTime: 0,
        prevRetention: 0,
      };
    }

    const totals = chartData.reduce(
      (acc, curr) => ({
        views: acc.views + (Number(curr.views) || 0),
        watchTime: acc.watchTime + (Number(curr.minutesWatched) || 0),
        subscribers: acc.subscribers + (Number(curr.subscribers) || 0),
        likes: acc.likes + (Number(curr.likes) || 0),
        comments: acc.comments + (Number(curr.comments) || 0),
        shares: acc.shares + (Number(curr.shares) || 0),
        retentionSum: acc.retentionSum + (Number(curr.retention) || 0),
        prevViews: acc.prevViews + (Number(curr.prevViews) || 0),
        prevWatchTime:
          acc.prevWatchTime + (Number(curr.prevMinutesWatched) || 0),
        prevRetentionSum:
          acc.prevRetentionSum + (Number(curr.prevRetention) || 0),
        prevRetentionCount:
          acc.prevRetentionCount + (Number(curr.prevRetention) ? 1 : 0),
      }),
      {
        views: 0,
        watchTime: 0,
        subscribers: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        retentionSum: 0,
        prevViews: 0,
        prevWatchTime: 0,
        prevRetentionSum: 0,
        prevRetentionCount: 0,
      },
    );

    const result = {
      ...totals,
      retention: totals.retentionSum / Math.max(chartData.length, 1),
      prevRetention:
        totals.prevRetentionCount > 0
          ? totals.prevRetentionSum / totals.prevRetentionCount
          : 0,
    };

    // Use channelTotals from the bundle endpoint so headline pills and chart data
    // come from the same data source -- making mismatch structurally impossible.
    const channelTotals = analytics.bundleChannelTotals;
    if (channelTotals) {
      result.views = channelTotals.views ?? result.views;
      result.watchTime = channelTotals.watch_time ?? result.watchTime;
      result.subscribers =
        (channelTotals.subscribers_gained ?? 0) -
        (channelTotals.subscribers_lost ?? 0);
      result.likes = channelTotals.likes ?? result.likes;
      result.comments = channelTotals.comments ?? result.comments;
      result.shares = channelTotals.shares ?? result.shares;

      const prev = analytics.bundlePrevChannelTotals;
      if (prev) {
        result.prevViews = prev.views ?? result.prevViews;
        result.prevWatchTime = prev.watch_time ?? result.prevWatchTime;
      }
    }

    return result;
  }, [
    chartData,
    analytics.bundleChannelTotals,
    analytics.bundlePrevChannelTotals,
  ]);

  const fullListsData = analytics.fullListsData;

  /**
   * Stable string key that changes only when the set of active playlist lists or their
   * contained playlist IDs actually changes. This avoids the infinite-loop that would
   * occur if we put the un-memoized `activeLists` array directly in a useEffect dep array
   * (it produces a new reference on every render, causing the effect to fire endlessly).
   */
  const activeListsSig = useMemo(() => {
    if (activeTab !== "playlistAnalytics") return "";
    return activeLists
      .map((l) => `${l.id}:${(l.playlistIds ?? []).slice().sort().join(",")}`)
      .sort()
      .join("|");
  }, [activeTab, activeLists]);

  // Keep a ref so the async fetch can read the latest activeLists without
  // needing it as a reactive dependency (which would cause the infinite loop).
  const activeListsRef = useRef(activeLists);
  useEffect(() => {
    activeListsRef.current = activeLists;
  }, [activeLists]);

  // Graph playlist scope as a stable string + ref for the overlay fetch below:
  // row (un)checks and status/activity filtering must move the multi-list
  // chart too, not just the aggregate series.
  const graphPlaylistIdsSig = useMemo(() => graphPlaylistIds.join(","), [graphPlaylistIds]);
  const graphPlaylistIdsRef = useRef<string[]>([]);
  useEffect(() => {
    graphPlaylistIdsRef.current = graphPlaylistIds;
  }, [graphPlaylistIds]);

  // Store the token getter in a stable ref so the fetch effect never needs it
  // as a reactive dependency (getTokenForSelectedChannel closes over allTokens
  // and may be a new reference on each render, which would cancel every in-flight
  // fetch before it completes -- permanently keeping playlistListsSeriesData null).
  const getTokenForSelectedChannelRef = useRef(getTokenForSelectedChannel);
  useEffect(() => {
    getTokenForSelectedChannelRef.current = getTokenForSelectedChannel;
  }, [getTokenForSelectedChannel]);

  // True when the active tab is playlist analytics AND 2+ active lists are playlist-type.
  // Single-list mode continues to use chartData (from useAnalyticsQuery → getDashboardBundle)
  // so the chart is always consistent with the playlist table.
  const isPlaylistListMultiSelect = useMemo(() => {
    if (activeTab !== "playlistAnalytics" || activeListIds.size <= 1)
      return false;
    return activeLists.every((l) => l.listType === "playlist");
  }, [activeTab, activeListIds, activeLists]);

  // Fetch per-list analytics when 2+ playlist-type lists are active.
  // Uses getDashboardBundle (same backend endpoint as useAnalyticsQuery) so the
  // per-list chart values are on the same scale as the single-list chart and
  // the playlist table -- getReport uses a different backend endpoint and
  // returns inconsistent values for the playlist== filter.
  // Dependencies use STABLE primitives only – no object/array refs.
  useEffect(() => {
    if (
      !isPlaylistListMultiSelect ||
      !selectedChannel ||
      !latestDataDate ||
      !user?.email
    ) {
      return;
    }

    let cancelled = false;

    const fetch = async () => {
      setLoadingPlaylistListsSeries(true);
      const token = await getTokenForSelectedChannelRef.current();
      if (!token || cancelled) return;

      const lists = activeListsRef.current;
      const svc = new AnalyticsService(
        token,
        user.email!,
        currentOrganization?.id,
      );
      const hasCustomRange = !!(customStartDate && customEndDate);

      try {
        // Scope each list to the checked + visible rows so row (un)checks and
        // status/activity filtering move the overlay, not just the aggregate.
        const allowed = new Set(graphPlaylistIdsRef.current);
        const results = await Promise.all(
          lists.map(async (list) => {
            const playlistIds = (list.playlistIds ?? []).filter((id) => allowed.has(id));
            if (playlistIds.length === 0)
              return { listId: list.id, report: null };
            // Use getDashboardBundle (same path as useAnalyticsQuery) so data
            // matches the playlist table and single-list chart exactly.
            const bundle = await svc.getDashboardBundle({
              channelId: selectedChannel!,
              period: hasCustomRange ? undefined : (period ?? 30),
              startDate: hasCustomRange
                ? dayjs(customStartDate).format("YYYY-MM-DD")
                : undefined,
              endDate: hasCustomRange
                ? dayjs(customEndDate).format("YYYY-MM-DD")
                : undefined,
              compare: false,
              trueDelta: false,
              filters: `playlist==${playlistIds.join(",")}`,
              latestDate: latestDataDate || undefined,
            });
            return { listId: list.id, report: bundle.current };
          }),
        );

        if (cancelled) return;
        const map = new Map<string, AnalyticsReport>();
        results.forEach(({ listId, report }) => {
          if (report) map.set(listId, report as AnalyticsReport);
        });
        setPlaylistListsSeriesData(map);
      } catch {
        if (!cancelled) setPlaylistListsSeriesData(null);
      } finally {
        if (!cancelled) setLoadingPlaylistListsSeries(false);
      }
    };

    void fetch();
    return () => {
      cancelled = true;
    };
  }, [
    isPlaylistListMultiSelect,
    activeListsSig,
    graphPlaylistIdsSig,
    selectedChannel,
    latestDataDate,
    period,
    customStartDate,
    customEndDate,
    user?.email,
    currentOrganization?.id,
  ]);

  const multiSeriesChartData = useMemo(() => {
    if (activeListIds.size <= 1) return null;

    // Playlist-type multi-select: per-list data from getDashboardBundle
    if (isPlaylistListMultiSelect) {
      if (!playlistListsSeriesData || playlistListsSeriesData.size === 0)
        return null;

      const allDates = new Set<string>();
      playlistListsSeriesData.forEach((report) => {
        (report.rows || []).forEach((row: unknown[]) =>
          allDates.add(String(row[0])),
        );
      });

      const dateMap = new Map<string, Record<string, string | number>>();
      Array.from(allDates)
        .sort()
        .forEach((date) => {
          const dataPoint: Record<string, string | number> = { date };
          activeLists.forEach((list) => {
            const report = playlistListsSeriesData.get(list.id);
            const row = report?.rows?.find((r: unknown[]) => r[0] === date);
            // getDashboardBundle current report columns: [day, views, minutesWatched, retention, ...]
            dataPoint[`views_${list.id}`] = row ? Number(row[1]) || 0 : 0;
            dataPoint[`minutesWatched_${list.id}`] = row
              ? parseFloat(String(row[2])) || 0
              : 0;
            dataPoint[`retention_${list.id}`] = row
              ? parseFloat(String(row[3])) || 0
              : 0;
          });
          dateMap.set(date, dataPoint);
        });
      // No dates across all per-list reports: return null (not []) so the
      // chart falls back to the aggregate series instead of rendering empty.
      if (dateMap.size === 0) return null;
      return Array.from(dateMap.values());
    }

    // Video-type lists (>1 selected): existing fullListsData path
    if (!fullListsData) return null;
    const listDatasets = activeLists
      .map((list) => ({
        listId: list.id,
        data: getVideoSubset(fullListsData as AnalyticsReport, list.videoIds),
      }))
      .filter(({ data }) => data && data.rows);
    if (listDatasets.length === 0) return null;

    const allDates = new Set<string>();
    listDatasets.forEach(({ data }) => {
      if (data?.rows) data.rows.forEach((row) => allDates.add(String(row[0])));
    });
    const dateMap = new Map<string, Record<string, string | number>>();
    Array.from(allDates)
      .sort()
      .forEach((date) => {
        const dataPoint: Record<string, string | number> = { date };
        listDatasets.forEach(({ listId, data }) => {
          if (data?.rows) {
            const row = data.rows.find((r) => r[0] === date);
            dataPoint[`views_${listId}`] = row ? Number(row[2]) || 0 : 0;
            dataPoint[`minutesWatched_${listId}`] = row
              ? parseFloat(String(row[3])) || 0
              : 0;
            dataPoint[`retention_${listId}`] = row
              ? parseFloat(String(row[5])) || 0
              : 0;
          }
        });
        dateMap.set(date, dataPoint);
      });
    // Subsets matched no rows: return null (not []) so the chart falls back
    // to the aggregate series instead of rendering empty.
    if (dateMap.size === 0) return null;
    return Array.from(dateMap.values());
  }, [
    activeListIds,
    activeLists,
    fullListsData,
    isPlaylistListMultiSelect,
    playlistListsSeriesData,
  ]);

  const multiSeriesConfig = useMemo(() => {
    if (!multiSeriesChartData || activeListIds.size <= 1) return null;
    const colors = MULTI_SERIES_FALLBACK_COLORS;
    return activeLists.map((list, index) => ({
      name: list.name,
      color: list.color || colors[index % colors.length],
      viewsKey: `views_${list.id}`,
      watchTimeKey: `minutesWatched_${list.id}`,
      retentionKey: `retention_${list.id}`,
    }));
  }, [multiSeriesChartData, activeListIds, activeLists]);

  const channelChartData = useMemo(() => {
    const channelMetrics = analytics.channelMetrics;
    const prevChannelMetrics = analytics.prevChannelMetrics;
    if (!channelMetrics?.rows) return [];
    const dataMap = new Map<
      string,
      {
        date: string;
        subscribersGained: number;
        subscribersLost: number;
        prevSubscribersGained: number;
        prevSubscribersLost: number;
      }
    >();
    channelMetrics.rows.forEach((row: string[]) => {
      const date = row[0];
      dataMap.set(date, {
        date,
        subscribersGained: Number(row[1]) || 0,
        subscribersLost: Number(row[2]) || 0,
        prevSubscribersGained: 0,
        prevSubscribersLost: 0,
      });
    });
    if (prevChannelMetrics?.rows) {
      const dates = Array.from(dataMap.keys()).sort();
      prevChannelMetrics.rows.forEach((row: string[], index: number) => {
        if (index < dates.length) {
          const currentData = dataMap.get(dates[index]);
          if (currentData) {
            currentData.prevSubscribersGained = Number(row[1]) || 0;
            currentData.prevSubscribersLost = Number(row[2]) || 0;
          }
        }
      });
    }
    return Array.from(dataMap.values()).sort(
      (a: { date: string }, b: { date: string }) =>
        a.date.localeCompare(b.date),
    );
  }, [analytics.channelMetrics, analytics.prevChannelMetrics]);

  // ============================================================================
  // EFFECTS (Minimal - only for side effects, not state management)
  // ============================================================================

  const handleDismissAnomaly = useCallback(
    (date: string) => {
      if (!date) return;
      const anomaly = anomalyByDate.get(date);
      const driverVideoId = anomaly?.topVideoId;

      if (driverVideoId) {
        const effectiveChecked = tableCheckedOverride
          ? new Set(tableCheckedOverride)
          : selectedVideoIds.has("XX_NONE_XX_")
            ? new Set<string>()
            : selectedVideoIds.size > 0
              ? new Set(selectedVideoIds)
              : new Set(filteredVideos.map((v) => v.videoId));

        if (effectiveChecked.has(driverVideoId)) {
          effectiveChecked.delete(driverVideoId);
        }

        setTableCheckedOverride(new Set(effectiveChecked));
        setSelectedVideoIds(
          effectiveChecked.size === 0
            ? new Set(["XX_NONE_XX_"])
            : new Set(effectiveChecked),
        );

        if (selectedVideo?.videoId === driverVideoId) {
          setSelectedVideo(null);
        }
      }

      setDismissedAnomalyState((prev) => {
        const baseDates =
          prev.key === anomalyInsightsKey ? prev.dates : new Set<string>();
        if (baseDates.has(date)) return prev;
        const nextDates = new Set(baseDates);
        nextDates.add(date);
        return { key: anomalyInsightsKey, dates: nextDates };
      });
    },
    [
      anomalyInsightsKey,
      anomalyByDate,
      tableCheckedOverride,
      selectedVideoIds,
      filteredVideos,
      selectedVideo,
      setSelectedVideo,
      setSelectedVideoIds,
      setTableCheckedOverride,
    ],
  );

  const hydrateVideoPlaylistAssignments = useCallback(
    async (playlistRows: PlaylistMetadata[]) => {
      const userEmail = user?.email;
      if (!selectedChannel || !userEmail || playlistRows.length === 0) return;

      const token = await getTokenForSelectedChannel();
      if (!token) return;

      // Video -> playlist-ids map plus the set of playlists already resolved.
      // Splitting fetch (expensive, cached) from apply (cheap, always) means
      // later video batches get assignments without re-fetching playlists,
      // and newly appeared playlists are fetched without redoing old ones.
      const cacheKey = `dashboard_playlist_map_v2_${selectedChannel}`;
      const cacheTimeKey = `${cacheKey}_time`;
      const maxCacheAgeMs = 24 * 60 * 60 * 1000;
      let map = new Map<string, string[]>();
      let covered = new Set<string>();

      try {
        const cachedMap = sessionStorage.getItem(cacheKey);
        const cachedAt = sessionStorage.getItem(cacheTimeKey);
        if (
          cachedMap &&
          cachedAt &&
          Date.now() - Number(cachedAt) < maxCacheAgeMs
        ) {
          const parsed = JSON.parse(cachedMap);
          const entries = Array.isArray(parsed) ? parsed : parsed?.map;
          if (Array.isArray(entries)) {
            map = new Map<string, string[]>(entries);
            const cov = Array.isArray(parsed) ? [] : parsed?.playlists;
            covered = new Set<string>(Array.isArray(cov) ? cov : []);
          }
        }
      } catch {
        map = new Map<string, string[]>();
        covered = new Set<string>();
      }

      // The v2 cache key is new, so first runs fetch everything once, then
      // only newly appeared playlists afterwards.
      const missing = playlistRows.filter((p) => !covered.has(p.id));
      if (missing.length > 0) {
        const yt = new YouTubeService(userEmail, token);
        const chunkSize = 8;

        for (let i = 0; i < missing.length; i += chunkSize) {
          const chunk = missing.slice(i, i + chunkSize);
          const succeeded: string[] = [];
          await Promise.all(
            chunk.map(async (playlist) => {
              try {
                const playlistVideos = await yt.fetchDashboardPlaylistItems(
                  playlist.id,
                  500,
                  true,
                  undefined,
                  true,
                );
                playlistVideos.forEach((video) => {
                  const ids = map.get(video.videoId) ?? [];
                  ids.push(playlist.id);
                  map.set(video.videoId, ids);
                });
                succeeded.push(playlist.id);
              } catch (error) {
                console.warn(
                  `[Dashboard] Failed to load playlist items for ${playlist.id}:`,
                  error,
                );
              }
            }),
          );
          succeeded.forEach((id) => covered.add(id));
        }

        try {
          sessionStorage.setItem(
            cacheKey,
            JSON.stringify({ v: 1, playlists: [...covered], map: Array.from(map.entries()) }),
          );
          sessionStorage.setItem(cacheTimeKey, String(Date.now()));
        } catch {
          // Ignore storage failures and continue with in-memory map.
        }
      }

      // Apply to ALL currently loaded videos (cheap) -- this is what covers
      // video batches that arrived after the membership fetch.
      useDashboardStore.setState((state) => ({
        videos: {
          ...state.videos,
          videos: state.videos.videos.map((video) => ({
            ...video,
            sourcePlaylistIds: map.get(video.videoId) ?? [],
          })),
        },
      }));
    },
    [selectedChannel, user, getTokenForSelectedChannel],
  );

  useEffect(() => {
    if (videosData !== undefined) {
      const existingById = new Map(
        useDashboardStore
          .getState()
          .videos.videos.map(
            (video) => [video.videoId, video.sourcePlaylistIds] as const,
          ),
      );

      setVideos(
        videosData.map((video) => ({
          ...video,
          sourcePlaylistIds:
            existingById.get(video.videoId) ?? video.sourcePlaylistIds ?? [],
        })),
      );
    }
  }, [videosData, setVideos]);

  // Auto-hydrate video->playlist assignments on the video tab whenever the
  // loaded video batch or playlist set changes, so playlist title/meta
  // columns resolve for every batch without a manual Load click. Guarded per
  // channel+playlists+videos key (the membership fetch itself is cached, and
  // the apply step only rewrites assignments).
  useEffect(() => {
    if (activeTab !== 'videoAnalytics') return;
    if (!selectedChannel || playlists.length === 0 || !videosData || videosData.length === 0) return;
    const key =
      `${selectedChannel}|${playlists.map((p) => p.id).sort().join(',')}` +
      `|${videosData.map((v) => v.videoId).sort().join(',')}`;
    if (videoPlaylistHydrateKeyRef.current === key) return;
    videoPlaylistHydrateKeyRef.current = key;
    void hydrateVideoPlaylistAssignments(playlists);
  }, [activeTab, selectedChannel, playlists, videosData, hydrateVideoPlaylistAssignments]);

  useEffect(() => {
    if (!selectedChannel || !user?.email || videos.length === 0) return;
    if (showAllTimeViews) return;
    if (activeTab !== "videoAnalytics" && activeTab !== "audience") return;

    let cancelled = false;
    const userEmail = user.email;

    const hydratePeriodViews = async () => {
      const token = await getTokenForSelectedChannel();
      if (!token || cancelled) return;

      const svc = new AnalyticsService(
        token,
        userEmail,
        currentOrganization?.id,
      );
      const ids = `channel==${selectedChannel}`;
      const endRefDate = latestDataDate ? new Date(latestDataDate) : new Date();
      const endDate = customEndDate
        ? dayjs(customEndDate).format("YYYY-MM-DD")
        : endRefDate.toISOString().split("T")[0];
      const startDate =
        customStartDate && customEndDate
          ? dayjs(customStartDate).format("YYYY-MM-DD")
          : (() => {
              const d = new Date(endRefDate);
              d.setDate(d.getDate() - ((period ?? 30) - 1));
              return d.toISOString().split("T")[0];
            })();

      const periodMap = new Map<string, number>();
      const retentionMap = new Map<string, number>();
      const videoIds = videos.map((v) => v.videoId);
      const chunkSize = 25;
      const chunks: string[][] = [];
      for (let i = 0; i < videoIds.length; i += chunkSize) {
        chunks.push(videoIds.slice(i, i + chunkSize));
      }

      await Promise.all(
        chunks.map(async (chunk) => {
          try {
            const report = await svc.getReport({
              ids,
              startDate,
              endDate,
              metrics: "views,averageViewPercentage",
              dimensions: "video",
              filters: `video==${chunk.join(",")}`,
            });
            (report.rows || []).forEach((row) => {
              const videoId = String(row[0]);
              const views = Number(row[1]) || 0;
              const retention = Number(row[2]) || 0;
              periodMap.set(videoId, views);
              if (Number.isFinite(retention)) {
                retentionMap.set(videoId, retention);
              }
            });
          } catch {
            // Best-effort enrichment; leave previous values as-is on per-chunk failure.
          }
        }),
      );

      if (cancelled || (periodMap.size === 0 && retentionMap.size === 0))
        return;

      setVideos(
        useDashboardStore.getState().videos.videos.map((video) => ({
          ...video,
          periodViewCount: periodMap.get(video.videoId) ?? 0,
          retention: retentionMap.get(video.videoId) ?? video.retention,
        })),
      );
    };

    void hydratePeriodViews();
    return () => {
      cancelled = true;
    };
  }, [
    selectedChannel,
    user?.email,
    videos,
    showAllTimeViews,
    activeTab,
    latestDataDate,
    customStartDate,
    customEndDate,
    period,
    getTokenForSelectedChannel,
    currentOrganization?.id,
    setVideos,
  ]);

  useEffect(() => {
    if (!playlistsData) return;
    const prev = useDashboardStore.getState().playlists.playlists;
    const prevById = new Map(prev.map((p: PlaylistMetadata) => [p.id, p]));
    const merged: PlaylistMetadata[] = playlistsData.map((p) => {
      const old = prevById.get(p.id);
      return {
        ...p,
        ...(old
          ? {
              periodViewCount: old.periodViewCount,
              allTimeViewCount: old.allTimeViewCount,
            }
          : {}),
      };
    });
    setPlaylists(merged);
  }, [playlistsData, setPlaylists]);

  useEffect(() => {
    setLoadingVideos(loadingVideos);
  }, [loadingVideos, setLoadingVideos]);

  useEffect(() => {
    setLoadingPlaylists(isLoadingPlaylists);
  }, [isLoadingPlaylists, setLoadingPlaylists]);

  // Pipeline diagnostics: one line per playlist-data change naming the count
  // at every stage (fetch → store → list scope → visible rows). When the table
  // disagrees with the total, the console line shows exactly which stage
  // dropped the rows (and any fetch error).
  useEffect(() => {
    console.info("[Playlists] pipeline", {
      rqRows: playlistsData?.length ?? null,
      rqTotal: playlistsTotal ?? null,
      hasNextPage: hasMorePlaylists ?? null,
      loading: isLoadingPlaylists,
      storeRows: playlists.length,
      scopedRows: listScopedPlaylists.length,
      visibleRows: filteredPlaylists.length,
      visibility: filters.playlistVisibility,
      activity: filters.activity,
      activeLists: activeListIds.size,
      error: playlistsError instanceof Error ? playlistsError.message : null,
    });
  }, [
    playlistsData,
    playlistsTotal,
    hasMorePlaylists,
    isLoadingPlaylists,
    playlists,
    listScopedPlaylists,
    filteredPlaylists,
    filters.playlistVisibility,
    filters.activity,
    activeListIds,
    playlistsError,
  ]);

  // Close dropdowns on outside click (the channel chooser is a dialog now and
  // manages its own backdrop/Escape, so only the list dropdown needs this).
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setShowListDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [setShowListDropdown]);

  // Handle URL query params (?tab=, ?list=)
  useEffect(() => {
    const tabParam = searchParams.get("tab");
    const listId = searchParams.get("list");
    const nextParams = new URLSearchParams(searchParams);
    let shouldReplaceParams = false;

    if (
      tabParam === "videoAnalytics" ||
      tabParam === "channelAnalytics" ||
      tabParam === "audience" ||
      tabParam === "playlistAnalytics"
    ) {
      if (activeTab !== tabParam) {
        switchTab(tabParam);
      }
      nextParams.delete("tab");
      shouldReplaceParams = true;
    }

    if (listId && savedLists.length > 0) {
      const listObj = savedLists.find((l) => l.id === listId);
      if (listObj) {
        const listDrivenTab =
          listObj.listType === "playlist"
            ? "playlistAnalytics"
            : "videoAnalytics";

        if (activeTab !== listDrivenTab) {
          switchTab(listDrivenTab);
        }

        if (listObj.channelId && listObj.channelId !== selectedChannel) {
          useDashboardStore.getState().setSelectedChannel(listObj.channelId);
          window.dispatchEvent(new Event("channelChanged"));
        }

        if (!activeListIds.has(listId)) {
          setActiveListIds(new Set([listId]));
          if (listDrivenTab === "playlistAnalytics" && listObj.playlistIds) {
            setPlaylistSelectionProgrammatic(new Set(listObj.playlistIds));
          }
        }

        nextParams.delete("list");
        shouldReplaceParams = true;
      }
    }

    if (shouldReplaceParams) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [
    searchParams,
    setSearchParams,
    savedLists,
    activeListIds,
    selectedChannel,
    activeTab,
    switchTab,
    setActiveListIds,
    setPlaylistSelectionProgrammatic,
  ]);

  useEffect(() => {
    if (activeTab === "playlistAnalytics") {
      const prev = useDashboardStore.getState().listSelection.activeListIds;
      const next = new Set<string>();
      prev.forEach((id) => {
        const matchedList = savedLists.find((list) => list.id === id);
        if (matchedList?.listType === "playlist") {
          next.add(id);
        }
      });

      if (next.size > 0) {
        const playlistIds = new Set<string>();
        next.forEach((id) => {
          const matchedList = savedLists.find((list) => list.id === id);
          (matchedList?.playlistIds || []).forEach((pid) =>
            playlistIds.add(pid),
          );
        });
        setPlaylistSelectionProgrammatic(playlistIds);
      }

      const sameLists =
        prev.size === next.size && [...prev].every((id) => next.has(id));
      if (!sameLists) {
        setActiveListIds(next);
      }

      setSelectedVideo(null);
      setSelectedVideoIds(new Set());
      setTableCheckedOverride(null);
      setFilterByVideos(false);
      setSelectedVideos(new Set());
      return;
    }

    if (activeTab === "videoAnalytics") {
      const prev = useDashboardStore.getState().listSelection.activeListIds;
      const next = new Set<string>();
      prev.forEach((id) => {
        const matchedList = savedLists.find((list) => list.id === id);
        if (matchedList?.listType !== "playlist") {
          next.add(id);
        }
      });
      const sameLists =
        prev.size === next.size && [...prev].every((id) => next.has(id));
      if (!sameLists) {
        setActiveListIds(next);
      }
    }
  }, [
    activeTab,
    savedLists,
    setActiveListIds,
    setSelectedVideo,
    setSelectedVideoIds,
    setTableCheckedOverride,
    setFilterByVideos,
    setSelectedVideos,
    setPlaylistSelectionProgrammatic,
  ]);

  useEffect(() => {
    if (listScopedPlaylistIdsSig !== playlistScopeSigPrevRef.current) {
      playlistScopeSigPrevRef.current = listScopedPlaylistIdsSig;
      playlistRowCheckUserEditedRef.current = false;
    }
  }, [listScopedPlaylistIdsSig]);

  // Keep playlist checkbox selection aligned with loaded rows (PlaylistTable is always controlled).
  // Skip while rows are still loading so we do not clear selection from the URL/list tab effect.
  // When the user edits row checks, skip until the scoped playlist set changes (see ref reset above).
  useEffect(() => {
    if (activeTab !== "playlistAnalytics") return;
    if (
      playlistRowCheckUserEditedRef.current &&
      !playlistForceAutoSelectRef.current
    )
      return;

    if (listScopedPlaylists.length === 0) {
      playlistTableScopedIdsRef.current = new Set();
      return;
    }

    const prev =
      useDashboardStore.getState().playlistSelection.selectedPlaylists;
    const scopedSet = new Set(listScopedPlaylists.map((p) => p.id));
    const oldScoped = playlistTableScopedIdsRef.current;

    const prevWasAllOfOldScope =
      oldScoped.size > 0 &&
      prev.size === oldScoped.size &&
      [...oldScoped].every((id) => prev.has(id));

    const valid = new Set([...prev].filter((id) => scopedSet.has(id)));
    const next = playlistForceAutoSelectRef.current
      ? scopedSet
      : prevWasAllOfOldScope && scopedSet.size > oldScoped.size
        ? scopedSet
        : valid.size > 0
          ? valid
          : scopedSet;

    const same =
      next.size === prev.size &&
      [...next].every((id) => prev.has(id)) &&
      [...prev].every((id) => next.has(id));
    if (!same) setSelectedPlaylists(next);

    playlistTableScopedIdsRef.current = scopedSet;
    playlistForceAutoSelectRef.current = false;
    if (next.size === scopedSet.size) {
      playlistRowCheckUserEditedRef.current = false;
    }
  }, [
    activeTab,
    listScopedPlaylists,
    listScopedPlaylistIdsSig,
    setSelectedPlaylists,
  ]);

  // ============================================================================
  // HANDLERS
  // ============================================================================

  const handleConnectChannel = async () => {
    // Only owner and admin roles can add YouTube channels to an organization
    if (!isOwner && !isAdmin) {
      toast.error("Only organization owners and admins can add channels");
      return;
    }

    // flushSync forces React to render isConnectingChannel=true synchronously
    // before loginWithYouTube opens the OAuth popup. Without this, the popup
    // opens before the spinner renders, and the focus-steal triggers the
    // click-outside handler which closes the dropdown before the spinner shows.
    flushSync(() => setIsConnectingChannel(true));
    const connectToast = toast.loading("Connecting channel…");
    try {
      const newTokens = await loginWithYouTube();
      if (!newTokens || !currentOrganization || !user?.uid) {
        setIsConnectingChannel(false);
        // loginWithYouTube already sets authError internally; surface it as a
        // toast so the failure is never silent (silent dismissal used to leave
        // users stuck with the old "Connecting channel…" spinner disappearing
        // and no explanation).
        toast.error(
          newTokens
            ? "Channel connected, but it couldn't be added to the organization."
            : "YouTube authorization failed. Check that the backend is running and try again.",
          { id: connectToast },
        );
        return;
      }

      let added = 0;
      for (const token of newTokens) {
        if (!token.channelId) continue;
        try {
          await addChannelToOrganization(
            currentOrganization.id,
            token.channelId,
            token.channelTitle || "",
            token.thumbnailUrl,
            user.uid,
            false,
            token.accessToken && token.refreshToken
              ? {
                  accessToken: token.accessToken,
                  refreshToken: token.refreshToken,
                  expiresAt: token.expiresAt,
                }
              : undefined,
          );
          added++;
        } catch (err) {
          console.error("Failed to register channel in organization:", err);
        }
      }

      if (added > 0) {
        toast.success(
          `${added} channel${added > 1 ? "s" : ""} connected successfully`,
          { id: connectToast },
        );
        // Optimistic Zustand update so the UI picks up the new channel(s)
        // immediately rather than waiting for Firestore → React Query refetch.
        const addedChannels: ChannelInfo[] = newTokens
          .filter((t) => t.channelId)
          .map((t) => ({
            id: t.channelId!,
            snippet: {
              title: t.channelTitle || "",
              thumbnails: t.thumbnailUrl
                ? { default: { url: t.thumbnailUrl } }
                : undefined,
            },
            channelTitle: t.channelTitle,
            isOrganizationChannel: true,
          }));
        const existing = useDashboardStore.getState().channel.channels;
        const merged: ChannelInfo[] = [
          ...existing,
          ...addedChannels.filter(
            (ac) => !existing.some((ec: ChannelInfo) => ec.id === ac.id),
          ),
        ];
        useDashboardStore.getState().setChannels(merged);
        // Also prime the React Query cache so a refetch won't revert
        const wsKey = getDashboardWorkspaceKey({
          userId: user?.uid,
          isPersonalContext,
          organizationId: currentOrganization?.id,
        });
        if (wsKey) {
          queryClient.setQueryData(
            [REVTUBE_DASHBOARD_WS_ROOT, wsKey, "channels"],
            merged,
          );
        }
        queryClient.invalidateQueries({
          queryKey: [REVTUBE_DASHBOARD_WS_ROOT],
        });
      } else {
        toast.error("No channels were connected. Please try again.", {
          id: connectToast,
        });
      }
    } catch (err) {
      console.error("Connect channel error:", err);
      toast.error("Failed to connect channel. Please try again.", {
        id: connectToast,
      });
    } finally {
      setIsConnectingChannel(false);
    }
  };

  const onConnectChannelClick = async () => {
    // A redirect-based (mobile PWA) OAuth completion may already be in flight
    // on load — don't start a second flow, just keep showing the spinner.
    if (isResumingOAuth) return;
    if (isPersonalContext) {
      flushSync(() => setIsConnectingChannel(true));
      try {
        const newTokens = await loginWithYouTube();
        if (newTokens && newTokens.length > 0) {
          // Optimistic Zustand update so the UI leaves the empty-connect state
          // immediately, without waiting for the React Query refetch cycle.
          const addedChannels: ChannelInfo[] = newTokens
            .filter((t) => t.channelId)
            .map((t) => ({
              id: t.channelId!,
              snippet: {
                title: t.channelTitle || "",
                thumbnails: t.thumbnailUrl
                  ? { default: { url: t.thumbnailUrl } }
                  : undefined,
              },
              channelTitle: t.channelTitle,
              isOrganizationChannel: false,
            }));
          const existing = useDashboardStore.getState().channel.channels;
          const merged: ChannelInfo[] = [
            ...existing,
            ...addedChannels.filter(
              (ac) => !existing.some((ec: ChannelInfo) => ec.id === ac.id),
            ),
          ];
          useDashboardStore.getState().setChannels(merged);
        } else {
          toast.error("This Google account has no YouTube channel. Create one first or sign in with a different account.");
        }
        queryClient.invalidateQueries({
          queryKey: [REVTUBE_DASHBOARD_WS_ROOT],
        });
      } finally {
        setIsConnectingChannel(false);
      }
      return;
    }
    await handleConnectChannel();
  };

  const handleMoveChannelToOrganization = async (channelId: string) => {
    if (!user?.uid || !currentOrganization || isPersonalContext) return;

    const channel = channels.find((ch) => ch.id === channelId);
    if (!channel || channel.isOrganizationChannel) return;

    const confirmed = await confirm(
      `Move "${channel.snippet.title}" to ${currentOrganization.name}? This channel will only be accessible within the organization.`,
      { title: "Move channel to organization?", confirmLabel: "Move" },
    );
    if (!confirmed) return;

    try {
      const tokenData = allTokens.find((t) => t.channelId === channelId);
      await moveChannelToOrganization(
        currentOrganization.id,
        channelId,
        channel.snippet.title,
        channel.snippet.thumbnails?.default?.url,
        user.uid,
        tokenData?.accessToken && tokenData?.refreshToken
          ? {
              accessToken: tokenData.accessToken,
              refreshToken: tokenData.refreshToken,
              expiresAt: tokenData.expiresAt,
            }
          : undefined,
      );

      useDashboardStore.setState((state) => ({
        channel: {
          ...state.channel,
          channels: state.channel.channels.map((ch) =>
            ch.id === channelId ? { ...ch, isOrganizationChannel: true } : ch,
          ),
        },
      }));

      toast.success("Channel moved to organization successfully!");
    } catch (error) {
      console.error("Error moving channel to organization:", error);
      toast.error("Failed to move channel to organization. Please try again.");
    }
  };

  const handleDeleteChannel = async (channelId: string) => {
    const channelName =
      channels.find((ch) => ch.id === channelId)?.snippet.title || channelId;
    const context = isPersonalContext
      ? "your account"
      : currentOrganization?.name || "this organization";
    const confirmed = await confirm(
      `Remove "${channelName}" from ${context}? This cannot be undone.`,
      {
        title: "Remove channel?",
        confirmLabel: "Remove",
      },
    );
    if (!confirmed) return;

    try {
      if (isPersonalContext) {
        if (!user?.uid) return;
        await deleteYouTubeToken(user.uid, channelId);
      } else {
        if (!currentOrganization) return;
        await removeChannelFromOrganization(currentOrganization.id, channelId);
      }

      // Notify the backend to clean up PostgreSQL analytics + Redis cache for this channel.
      // Fire-and-forget: failure only logs, never blocks the UI.
      (async () => {
        try {
          await fetch(apiUrl("/channels/cleanup"), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(await getFirebaseAuthHeader()),
            },
            body: JSON.stringify({ channelId }),
          });
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (__error) {
          // cleanup is best-effort

        }
      })();

      const remaining = channels.filter((ch) => ch.id !== channelId);

      // Optimistically update the React Query cache so the useDashboardChannel sync effect
      // picks up the correct (deleted) channel list immediately -- this prevents a race
      // where invalidateQueries triggers a refetch that returns stale data from Firestore
      // (due to eventual consistency) and overwrites the Zustand store with the old list.
      const workspaceKey = getDashboardWorkspaceKey({
        userId: user?.uid,
        isPersonalContext,
        organizationId: currentOrganization?.id,
      });
      if (workspaceKey) {
        queryClient.setQueryData(
          [REVTUBE_DASHBOARD_WS_ROOT, workspaceKey, "channels"],
          remaining,
        );
      }

      // Also update Zustand directly for immediate UI feedback
      useDashboardStore.getState().setChannels(remaining);

      useDashboardStore.setState((state) => ({
        channel: {
          ...state.channel,
          orgTokenMap: Object.fromEntries(
            Object.entries(state.channel.orgTokenMap).filter(
              ([key]) => key !== channelId,
            ),
          ),
        },
      }));

      if (selectedChannel === channelId) {
        const nextChannel = remaining.length > 0 ? remaining[0].id : null;
        useDashboardStore.getState().setSelectedChannel(nextChannel);
        // Reset all channel-dependent state (analytics, videos, playlists, etc.)
        // so stale data from the deleted channel is cleared immediately.
        useDashboardStore.getState().resetChannelState();
      }

      // Invalidate the shared React Query cache so OrganizationPage and any other
      // consumers see the updated channel list -- the refetch result will now merge
      // against the already-correct optimistic data.
      queryClient.invalidateQueries({ queryKey: [REVTUBE_DASHBOARD_WS_ROOT] });

      toast.success("Channel removed successfully");
    } catch (error) {
      console.error("Failed to remove channel:", error);
      toast.error("Failed to remove channel. Please try again.");
    }
  };

  const handleSelectChannel = useCallback(
    (channelId: string) => {
      useDashboardStore.getState().setSelectedChannel(channelId);
      setSelectedVideo(null);
      setActiveListIds(new Set());
      window.dispatchEvent(new Event("channelChanged"));
    },
    [setSelectedVideo, setActiveListIds],
  );

  const handleExportCSV = () => {
    const rows = videoTableExportRowsRef.current;
    if (!rows.length) {
      toast.error("No videos match the current filters.");
      return;
    }

    const filename = `TubeKeter_Analytics-${activeListIds.size > 0 ? "lists-" + Array.from(activeListIds).join("-") : "channel"}.csv`;
    exportToCSV(
      rows as Parameters<typeof exportToCSV>[0],
      filename,
      false,
      playlists,
      showDashboardPlaylistColumns,
      selectedMetrics,
      selectedPlaylistMetas,
      selectedDimensions,
    );
  };

  const handleExportPlaylistCSV = () => {
    if (!filteredPlaylists.length) {
      toast.error("No playlists available.");
      return;
    }
    // Export mirrors the playlist table (visibility + activity filters applied)
    // and includes the computed Privacy / Last Video Added / Activity columns.
    const filename = `TubeKeter_Playlist_Analytics-${currentChannelName}.csv`;
    exportPlaylistsToCSV(filteredPlaylists, filename);
  };

  const handleDownloadChart = async () => {
    if (!chartWidgetRef.current) return;
    try {
      const chartType =
        activeChart.charAt(0).toUpperCase() + activeChart.slice(1);
      const filename = `${currentChannelName}_${chartType}_${new Date().toISOString().split("T")[0]}`;
      await downloadElementAsPNG(chartWidgetRef.current, filename);
      toast.success("Chart downloaded successfully");
    } catch (error) {
      console.error("Failed to download chart:", error);
      toast.error("Failed to download chart");
    }
  };

  const handleDownloadChannelAnalytics = async () => {
    if (!channelAnalyticsWidgetRef.current) return;
    try {
      const filename = `${currentChannelName}_Channel_Analytics_${new Date().toISOString().split("T")[0]}`;
      await downloadElementAsPNG(channelAnalyticsWidgetRef.current, filename);
      toast.success("Channel analytics downloaded successfully");
    } catch (error) {
      console.error("Failed to download channel analytics:", error);
      toast.error("Failed to download channel analytics");
    }
  };

  const handleDownloadDimensions = async () => {
    if (!dimensionsPanelRef.current) return;
    await downloadElementAsPNG(
      dimensionsPanelRef.current,
      `Audience_Breakdown`,
    );
  };

  // ============================================================================
  // RENDER HELPERS
  // ============================================================================

  const displayError = analytics.error || videosError;
  const displayErrorMessage =
    typeof displayError === "string"
      ? displayError
      : displayError instanceof Error
        ? displayError.message
        : displayError
          ? String(displayError)
          : "";

  const handleRetryDashboardData = useCallback(async () => {
    try {
      await Promise.all([refetchVideos(), refetchAnalytics()]);
      toast.success("Data refreshed");
    } catch {
      toast.error(
        "Could not refresh. Try Re-authorize YouTube or check your connection.",
      );
    }
  }, [refetchVideos, refetchAnalytics]);

  const showDashboardSkeleton =
    isCheckingAuth ||
    isLoadingTokens ||
    organizationLoading ||
    !channelSelectionHydrated ||
    loadingChannels;

  // In org mode, only organization owners and admins may connect YouTube
  // channels. In personal mode the user is the implicit owner of their own data.
  const canConnectChannels = isPersonalContext || isOwner || isAdmin;

  // ============================================================================
  // RENDER
  // ============================================================================

  if (showDashboardSkeleton) {
    return <SkeletonDashboardShell />;
  }

  if (channels.length === 0) {
    return (
      <DashboardConnectState
        canConnectChannels={canConnectChannels}
        isConnectingChannel={isConnectingChannel || isResumingOAuth}
        onConnect={() => void onConnectChannelClick()}
      />
    );
  }

  return (
    <PageShell
      className="dashboard-page"
      header={
        <DashboardHeader
          channels={channels}
          selectedChannel={selectedChannel}
          onSelectChannel={handleSelectChannel}
          onMoveChannel={handleMoveChannelToOrganization}
          onDeleteChannel={handleDeleteChannel}
          onOpenFocus={setFocusChannelId}
          onConnectChannel={onConnectChannelClick}
          isPersonalContext={isPersonalContext}
          isOwner={isOwner}
          isAdmin={isAdmin}
          currentOrganizationName={currentOrganization?.name}
          isConnectingChannel={isConnectingChannel || isResumingOAuth}
          customStartDate={customStartDate}
          customEndDate={customEndDate}
          latestDataDate={latestDataDate}
          onRangeChange={(start, end) => setCustomDateRange(start, end)}
          onClearRange={() => setCustomDateRange(null, null)}
          activeTab={activeTab}
          onTabChange={switchTabMeasured}
        />
      }
    >

      {displayError ? (
        <DashboardErrorBanner
          message={displayErrorMessage}
          canReconnect={canConnectChannels}
          onRetry={() => void handleRetryDashboardData()}
          onReauthorize={() => void loginWithYouTube()}
        />
      ) : (
        <>
          <DashboardVideoDetail
            video={selectedVideo}
            onBack={() => setSelectedVideo(null)}
          />

          <GoalsOverviewBanner
            channelId={selectedChannel}
            organizationId={isPersonalContext ? null : currentOrganization?.id}
            canEdit={isPersonalContext || canEditOrganization}
          />

          {analytics.usageError && (
            <Box sx={{ mb: 2.5 }}>
              <UsageLimitBanner
                limit={analytics.usageError.limit}
                used={analytics.usageError.used}
                message={analytics.usageError.message}
                pageLabel="Channel Analytics"
              />
            </Box>
          )}

            {showDashboardFetchToolbar && (
              <div className="mobile-dashboard-filters">
                <Button
                  variant="secondary"
                  size="sm"
                 
                  className="mobile-dashboard-filters-toggle"

                  onClick={() => setMobileFiltersOpen((prev) => !prev)}
                  aria-expanded={mobileFiltersOpen}
                >
                  {mobileFiltersOpen ? "Hide filters" : "Show filters"}
                </Button>
                <div
                  className={`dashboard-toolbar-collapsible ${mobileFiltersOpen ? "open" : ""}`}
                >
                  <div className="dashboard-toolbar">
                    {isVideoTableTab && (
                      <FeatureGuard
                        pageKey="dashboard"
                        fallbackMessage="Creating and saving custom video lists is a Pro feature."
                      >
                        <SavedListsPanel
                          selectedVideo={selectedVideo}
                          dropdownRef={dropdownRef}
                          savedLists={savedLists}
                          selectedChannel={selectedChannel}
                          knownPlaylistIds={new Set(playlists.map((p) => p.id))}
                          activeListIds={activeListIds}
                          showListDropdown={showListDropdown}
                          setShowListDropdown={setShowListDropdown}
                          listSearchTerm={listSearchTerm}
                          setListSearchTerm={setListSearchTerm}
                          onToggleList={(listId) => {
                            const prev =
                              useDashboardStore.getState().listSelection
                                .activeListIds;
                            const next = new Set(prev);
                            if (next.has(listId)) {
                              next.delete(listId);
                            } else {
                              next.add(listId);
                            }

                            if (activeTab === "playlistAnalytics") {
                              const selectedPlaylistLists = savedLists.filter(
                                (list) =>
                                  next.has(list.id) &&
                                  list.listType === "playlist",
                              );

                              if (selectedPlaylistLists.length === 0) {
                                setPlaylistSelectionProgrammatic(
                                  new Set(playlists.map((p) => p.id)),
                                );
                              } else {
                                const playlistIds = new Set<string>();
                                selectedPlaylistLists.forEach((list) => {
                                  (list.playlistIds || []).forEach((id) =>
                                    playlistIds.add(id),
                                  );
                                });
                                setPlaylistSelectionProgrammatic(playlistIds);
                              }
                            }

                            setActiveListIds(next);
                          }}
                          isPersonalContext={isPersonalContext}
                          canEditOrganization={canEditOrganization}
                          onEditList={(list: SavedList) => {
                            setEditingList(list);
                            setIsEditListModalOpen(true);
                            setShowListDropdown(false);
                          }}
                          onRemoveList={handleRemoveList}
                          onClearLists={() => {
                            setActiveListIds(new Set());
                            if (activeTab === "playlistAnalytics") {
                              setPlaylistSelectionProgrammatic(
                                new Set(playlists.map((p) => p.id)),
                              );
                            }
                          }}
                          onAddList={() => setIsAddListModalOpen(true)}
                          activeTab={activeTab}
                        />
                      </FeatureGuard>
                    )}

                    <div className="dashboard-toolbar-row">
                      <DashboardLoadToolbar
                        videoTypeFilter={filters.type}
                        onVideoTypeChange={(type) =>
                          setVideoTypeFilter(type as "all" | "shorts" | "long")
                        }
                        visibilityFilter={
                          activeTab === "playlistAnalytics"
                            ? filters.playlistVisibility
                            : filters.visibility
                        }
                        onVisibilityChange={(visibility) => {
                          if (activeTab === "playlistAnalytics") {
                            setPlaylistVisibilityFilter(
                              visibility as "public" | "private" | "unlisted" | "all",
                            );
                          } else {
                            setVideoVisibilityFilter(
                              visibility as "public" | "private" | "unlisted" | "all",
                            );
                          }

                        }}
                        loading={
                          activeTab === "playlistAnalytics"
                            ? isLoadingPlaylists
                            : loadingVideos || fetchingVideos
                        }
                        activeListCount={activeListIds.size}
                        activeTab={activeTab}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {(activeTab === "videoAnalytics" ||
              activeTab === "playlistAnalytics") && (
              <div ref={chartWidgetRef}>
                <VideoAnalyticsChart
                  selectedVideo={selectedVideo}
                  activeLists={activeLists}
                  channels={channels}
                  selectedChannel={selectedChannel}
                  formattedLatestDate={formattedLatestDate}
                  loading={
                    analytics.loading ||
                    (isPlaylistListMultiSelect &&
                      (!playlistListsSeriesData ||
                        loadingPlaylistListsSeries)) ||
                    (!isPlaylistListMultiSelect &&
                      activeListIds.size > 1 &&
                      activeTab === "videoAnalytics" &&
                      fullListsFetching &&
                      analytics.hasLoadedOnce)
                  }
                  hasLoadedOnce={analytics.hasLoadedOnce}
                  isRefreshing={videoAnalyticsChartRefreshing}
                  handleDownloadChart={handleDownloadChart}
                  showAnnotations={showAnnotations}
                  setShowAnnotations={setShowAnnotations}
                  trueDeltaEnabled={trueDeltaEnabled}
                  setTrueDeltaEnabled={setTrueDeltaEnabled}
                  activeChart={activeChart}
                  setActiveChart={switchChart}
                  period={period}
                  customStartDate={
                    customStartDate ? dayjs(customStartDate) : null
                  }
                  customEndDate={customEndDate ? dayjs(customEndDate) : null}
                  chartData={chartData}
                  multiPeriodStats={analytics.multiPeriodStats}
                  videoStats={videoStats}
                  videoAnomalyInsights={visibleAnomalyInsights}
                  loadingMultiPeriod={analytics.loadingMultiPeriod}
                  compareEnabled={compareEnabled}
                  setCompareEnabled={setCompareEnabled}
                  channelChartData={channelChartData}
                  multiSeriesChartData={multiSeriesChartData}
                  activeListIds={activeListIds}
                  multiSeriesConfig={multiSeriesConfig}
                  activeTab={activeTab}
                  onDismissAnomaly={handleDismissAnomaly}
                />
              </div>
            )}

            {activeTab === "channelAnalytics" && (
              <ChannelAnalyticsInsights
                channelAnalyticsData={(() => {
                  const cad = analytics.channelAnalyticsData;
                  if (
                    cad &&
                    typeof cad === "object" &&
                    !("rows" in cad) &&
                    "videosUploaded" in cad
                  ) {
                    return cad as ChannelAnalyticsData;
                  }
                  return {
                    views: 0,
                    subscribersGained: 0,
                    subscribersLost: 0,
                    watchTime: 0,
                    likes: 0,
                    comments: 0,
                    shares: 0,
                    videosUploaded: 0,
                    averageViewDuration: 0,
                    engagedViews: 0,
                    viewerPercentage: 0,
                    cardImpressions: 0,
                    cardClicks: 0,
                    cardClickRate: 0,
                    cardTeaserImpressions: 0,
                    cardTeaserClicks: 0,
                    cardTeaserClickRate: 0,
                    averageConcurrentViewers: 0,
                    peakConcurrentViewers: 0,
                  };
                })()}
                channelAnalyticsChartData={
                  (analytics.channelAnalyticsChartData as Array<{
                    date: string;
                    [key: string]: string | number | undefined;
                  }>) ?? []
                }
                channelMultiPeriodStats={
                  (analytics.channelMultiPeriodStats ?? null) as never
                }
                channelAnalyticsPeriod={period}
                customStartDate={
                  customStartDate ? dayjs(customStartDate) : null
                }
                customEndDate={customEndDate ? dayjs(customEndDate) : null}
                bundleLoading={analytics.loading}
                loadingChannelAnalytics={analytics.loadingChannelAnalytics}
                videosCatalogFetching={fetchingVideos}
                trueDeltaEnabled={trueDeltaEnabled}
                setTrueDeltaEnabled={setTrueDeltaEnabled}
                channelTitle={currentChannelName}
                formattedLatestDate={formattedLatestDate}
                onDownloadChannelAnalytics={handleDownloadChannelAnalytics}
                channelAnalyticsWidgetRef={channelAnalyticsWidgetRef}
              />
            )}

            {activeTab === "audience" && (
              <AudienceBreakdownPanel
                dimensionsMultiPeriod={
                  (analytics.dimensionsMultiPeriod as DimensionsMultiPeriodData | null) ??
                  null
                }
                primaryPeriod={audiencePrimaryPeriod}
                loading={analytics.loadingDimensions}
                onDownload={handleDownloadDimensions}
                dimensionsPanelRef={dimensionsPanelRef}
                retention={analytics.insightsData?.retention}
              />
            )}

            {activeTab === "insights" && (
              <InsightsPanel
                insightsData={analytics.insightsData}
                loading={analytics.loadingInsights}
                formattedLatestDate={formattedLatestDate}
                channelTitle={currentChannelName}
                channelId={selectedChannel}
                period={period}
                latestDataDate={latestDataDate}
                getEffectiveToken={getEffectiveToken}
              />
            )}

            {activeTab === "videoAnalytics" && !selectedVideo && (
                <VideoTable
                  videos={tableVideos}
                  videoSearchQuery={filters.searchQuery}
                  onVideoSearchQueryChange={setVideoSearchQuery}
                  onExportCSV={handleExportCSV}
                  tableExportRowsRef={videoTableExportRowsRef}
                  onShare={() => {}}
                  sourceName={currentChannelName}
                  playlists={playlists}
                  showChannelColumn={false}
                  showPlaylistColumn={showDashboardPlaylistColumns}
                  allVideos={listScopedVideos}
                  filterByPlaylists={filters.playlists.enabled}
                  onFilterByPlaylistsChange={setFilterByPlaylists}
                  selectedPlaylists={filters.playlists.selected}
                  onSelectedPlaylistsChange={setSelectedPlaylists}
                  filterByVideos={filters.videos.enabled}
                  onFilterByVideosChange={setFilterByVideos}
                  selectedVideos={filters.videos.selected}
                  onSelectedVideosChange={setSelectedVideos}
                  onLoadPlaylists={async () => {
                    const result = await refetchPlaylists();
                    const loadedPlaylists =
                      result.data?.pages.flatMap((p) => p.items) ??
                      useDashboardStore.getState().playlists.playlists;
                    await hydrateVideoPlaylistAssignments(loadedPlaylists);
                  }}
                  isLoadingPlaylists={isLoadingPlaylists}
                  showPlaylistFilter={true}
                  selectedMetrics={selectedMetrics}
                  onSelectedMetricsChange={(metrics) => {
                    useDashboardStore.setState((state) => ({
                      ui: { ...state.ui, selectedMetrics: metrics },
                    }));
                  }}
                  selectedDimensions={selectedDimensions}
                  onSelectedDimensionsChange={(dimensions) => {
                    useDashboardStore.setState((state) => ({
                      ui: { ...state.ui, selectedDimensions: dimensions },
                    }));
                  }}
                  selectedPlaylistMetas={selectedPlaylistMetas}
                  onSelectedPlaylistMetasChange={(metas) => {
                    useDashboardStore.setState((state) => ({
                      ui: { ...state.ui, selectedPlaylistMetas: metas },
                    }));
                  }}
                  viewsColumnLabel={`Views (${activeRangeLabel})`}
                  viewsColumnTooltip={`Views in selected dashboard range: ${activeRangeLabel}`}
                  allowPrivateMetrics={true}
                  checkedVideoIds={
                    tableCheckedOverride ??
                    (selectedVideoIds.has("XX_NONE_XX_")
                      ? new Set<string>()
                      : selectedVideoIds.size > 0
                        ? selectedVideoIds
                        : new Set(tableVideos.map((v) => v.videoId)))
                  }
                  onCheckedVideosChange={(ids: Set<string>) => {
                    setTableCheckedOverride(ids);
                    if (ids.size === 0) {
                      setSelectedVideoIds(new Set(["XX_NONE_XX_"]));
                    } else {
                      setSelectedVideoIds(new Set(ids));
                    }
                  }}
                  isLoading={loadingVideos}
                  onRetryVideos={() => void refetchVideos()}
                  onVideoClick={(v) => setDetailVideo(v)}
                  hasMoreBackend={hasMoreVideos}
                  onLoadMoreBackend={() => void loadMoreVideos?.()}
                  isLoadingMoreBackend={loadingMoreVideos}
                  totalBackendCount={videosTotal}
                />
            )}

            {activeTab === "playlistAnalytics" && (
              <PlaylistTable
                playlists={filteredPlaylists}
                totalCount={playlistCatalogTotal}
                isLoading={isLoadingPlaylists || fetchingPlaylists}
                onRetryLoad={() => void refetchPlaylists()}
                onExportCSV={handleExportPlaylistCSV}
                activeRangeLabel={activeRangeLabel}
                checkedPlaylistIds={filters.playlists.selected}
                onCheckedPlaylistsChange={(ids) => {
                  playlistRowCheckUserEditedRef.current = true;
                  setSelectedPlaylists(ids);
                }}
                hasMoreBackend={hasMorePlaylists}
                onLoadMoreBackend={() => void loadMorePlaylists?.()}
                isLoadingMoreBackend={loadingMorePlaylists}
                totalBackendCount={playlistsTotal}
                onSelectAllCatalog={() => void drainAllPlaylistPages()}
                loadError={playlistsError instanceof Error ? playlistsError.message : null}
                partialNotice={playlistsPartialError}
              />
            )}
        </>
      )}

      <AddListModal
        isOpen={isAddListModalOpen}
        onClose={() => setIsAddListModalOpen(false)}
        onSave={handleCreateList}
        listType={activeTab === "playlistAnalytics" ? "playlist" : "video"}
      />

      <EditListModal
        isOpen={isEditListModalOpen}
        onClose={() => setIsEditListModalOpen(false)}
        list={editingList}
        onSave={handleUpdateList}
        videoTitleMap={Object.fromEntries(
          videos.map((v) => [v.videoId, v.title]),
        )}
        playlistTitleMap={Object.fromEntries(
          playlists.map((p) => [p.id, p.title]),
        )}
      />

      <ConfirmationModal />

      <VideoDetailDialog
        video={detailVideo}
        open={!!detailVideo}
        onClose={() => setDetailVideo(null)}
        accessToken={youtubeAccessToken ?? null}
      />

      <ChannelFocusDialog
        open={!!focusChannelId}
        onClose={() => setFocusChannelId(null)}
        channelId={focusChannelId}
        channelTitle={focusChannel?.snippet?.title}
        organizationId={isPersonalContext ? null : currentOrganization?.id ?? null}
        organizationName={currentOrganization?.name}
      />
    </PageShell>
  );
};

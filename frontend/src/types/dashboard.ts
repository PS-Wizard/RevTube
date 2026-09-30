/**
 * Domain Models for Dashboard State Management
 * Centralized type definitions for the refactored dashboard
 */

import type { VideoMetadata, PlaylistMetadata } from './youtube';
import type { SavedList } from '../services/savedListService';

// Re-export types that are used elsewhere
export type { VideoMetadata, PlaylistMetadata, SavedList };

// ============================================================================
// FILTER MODELS
// ============================================================================

/** Visibility filter for videos / playlists. "public" keeps only known-public items
 *  (unknown/missing status treated as public); "private" and "unlisted" keep only
 *  those specific groups (strict, no longer "on top of" public); "all" keeps
 *  everything. */
export type VisibilityFilter = 'public' | 'private' | 'unlisted' | 'all';

/** Activity filter for playlists. "running" = still receiving new videos;
 *  "archive" = dormant/completed (no recent additions). "all" disables it. */
export type PlaylistActivityFilter = 'all' | 'running' | 'archive';

export interface VideoFilters {
  type: 'all' | 'shorts' | 'long';
  searchQuery: string;
  visibility: VisibilityFilter;
  playlistVisibility: VisibilityFilter;
  activity: PlaylistActivityFilter;
  playlists: {
    enabled: boolean;
    selected: Set<string>;
  };
  videos: {
    enabled: boolean;
    selected: Set<string>;
  };
}

export interface VideoLimitConfig {
  mode: number | 'all' | 'custom';
  customValue: number;
}

// ============================================================================
// SELECTION MODELS
// ============================================================================

export interface VideoSelection {
  selectedVideo: VideoMetadata | null;
  selectedVideoIds: Set<string>;
  tableCheckedOverride: Set<string> | null;
}

export interface PlaylistSelection {
  selectedPlaylists: Set<string>;
}

export interface ListSelection {
  activeListIds: Set<string>;
  isTemporaryList: boolean;
}

// ============================================================================
// CHANNEL MODELS
// ============================================================================

export interface ChannelInfo {
  id: string;
  snippet: {
    title: string;
    thumbnails?: {
      default?: { url: string };
    };
  };
  channelTitle?: string;
  isOrganizationChannel?: boolean;
}

export interface ChannelState {
  channels: ChannelInfo[];
  selectedChannel: string | null;
  loadingChannels: boolean;
  channelSelectionHydrated: boolean;
  orgTokenMap: Record<string, { accessToken: string; refreshToken: string; expiresAt?: number }>;
}

// ============================================================================
// VIDEO & PLAYLIST DATA MODELS
// ============================================================================

export interface VideoState {
  videos: VideoMetadata[];
  loadingVideos: boolean;
  videosError: string | null;
  hasChangedVideoLimit: boolean;
}

export interface PlaylistState {
  playlists: PlaylistMetadata[];
  isLoadingPlaylists: boolean;
}

// ============================================================================
// ANALYTICS MODELS
// ============================================================================

export interface AnalyticsReport {
  rows: string[][];
  columnHeaders?: Array<{ name: string; columnType: string; dataType: string }>;
}

/**
 * NOTE: intentionally a `type` alias (not an `interface`) so it gains an
 * implicit index signature. That lets `PeriodData` flow into helpers typed
 * as `Record<string, unknown>` / `Record<string, number>` (e.g. the delta
 * helpers in utils/metricDeltaPct.ts) without casts.
 */
export type PeriodData = {
  views: number;
  watchTime: number;
  subscribers: number;
  retention: number;
  averageViewDuration?: number;
  engagedViews?: number;
  viewerPercentage?: number;
  cardImpressions?: number;
  cardClicks?: number;
  cardClickRate?: number;
  cardTeaserImpressions?: number;
  cardTeaserClicks?: number;
  cardTeaserClickRate?: number;
  averageConcurrentViewers?: number;
  peakConcurrentViewers?: number;
  playlistSaves?: number;
  playlistStarts?: number;
  viewsPerPlaylistStart?: number;
};

export interface MultiPeriodStats {
  d7: {
    current: PeriodData;
    previous: PeriodData;
  };
  d30: {
    current: PeriodData;
    previous: PeriodData;
  };
  d90: {
    current: PeriodData;
    previous: PeriodData;
  };
}

export interface VideoAnomalyInsight {
  date: string;
  kind: 'spike' | 'dip';
  deltaViews: number;
  topVideoId?: string;
  topVideoTitle?: string;
  topVideoViews?: number;
  topVideoDeltaViews?: number;
  topVideoThumbnailUrl?: string;
}

export interface ChannelTotals {
  views: number;
  watch_time: number;
  average_view_duration?: number;
  engaged_views?: number;
  viewer_percentage?: number;
  card_impressions?: number;
  card_clicks?: number;
  card_click_rate?: number;
  card_teaser_impressions?: number;
  card_teaser_clicks?: number;
  card_teaser_click_rate?: number;
  average_concurrent_viewers?: number;
  peak_concurrent_viewers?: number;
  subscribers_gained: number;
  subscribers_lost: number;
  likes: number;
  comments: number;
  shares: number;
}

export interface AnalyticsState {
  reportData: AnalyticsReport | null;
  prevReportData: AnalyticsReport | null;
  channelMetrics: AnalyticsReport | null;
  prevChannelMetrics: AnalyticsReport | null;
  multiPeriodStats: MultiPeriodStats | null;
  channelMultiPeriodStats: MultiPeriodStats | null;
  bundleChannelTotals: ChannelTotals | null;
  bundlePrevChannelTotals: ChannelTotals | null;
  channelAnalyticsData: {
    views: number;
    subscribersGained: number;
    subscribersLost: number;
    watchTime: number;
    likes: number;
    comments: number;
    shares: number;
    videosUploaded: number;
    averageViewDuration?: number;
    engagedViews?: number;
    viewerPercentage?: number;
    cardImpressions?: number;
    cardClicks?: number;
    cardClickRate?: number;
    cardTeaserImpressions?: number;
    cardTeaserClicks?: number;
    cardTeaserClickRate?: number;
    averageConcurrentViewers?: number;
    peakConcurrentViewers?: number;
  } | null;
  channelAnalyticsChartData: unknown | null;
  videoAnomalyInsights: VideoAnomalyInsight[];
  fullListsData: AnalyticsReport | null;
  dimensionsMultiPeriod: unknown | null;
  insightsData: InsightsData | null;
  loading: boolean;
  loadingMultiPeriod: boolean;
  loadingInsights: boolean;
  isRefreshing: boolean;
  loadingChannelAnalytics: boolean;
  loadingDimensions: boolean;
  hasLoadedOnce: boolean;
  error: string | null;
  usageError: { limit: number; used: number; message: string } | null;
}

// ── Insights models ───────────────────────────────────────────────────────────

export interface DayStat {
  day: number;      // 0=Sun, 6=Sat
  label: string;    // "Sunday"
  views: number;
  averageViewPercentage?: number;
  subscribersGained?: number;
  likes?: number;
  comments?: number;
  shares?: number;
}

export interface BestTimeToPostData {
  bestDay: number;
  bestDayLabel: string;
  dailyStats: DayStat[];
  recommendation: string;
  bestRetentionDay?: number;
  bestRetentionDayLabel?: string;
  bestSubscriberDay?: number;
  bestSubscriberDayLabel?: string;
}

export interface DailyRetentionPoint {
  date: string;
  retention: number | null;
}

export interface DayRetentionStat {
  day: number;
  label: string;
  avgRetention: number;
}

export interface HourRetentionStat {
  hour: number;          // 0-23
  label: string;         // "12AM", "1AM", ..., "11PM"
  avgRetention: number;
  videoCount: number;
}

export interface RetentionByHourData {
  dailyRetention: DailyRetentionPoint[];
  averageRetention: number;
}

export interface RetentionByPublishHourData {
  retentionByHour: HourRetentionStat[];
  bestHour: number;
  bestHourLabel: string;
  bestHourRetention: number;
  recommendation: string;
}

// ── Best Time to Post v2 (DB-powered algorithm) ───────────────────────────

export type ConfidenceTier = 'High' | 'Medium' | 'Exploratory';

export interface HourStatV2 {
  hour: number;              // 0-23
  label: string;             // "12AM", "1AM", ..., "11PM"
  medianComposite: number;
  shrunkScore: number;
  confidenceTier: ConfidenceTier;
  ciLower: number | null;
  ciUpper: number | null;
  videoCount: number;
  medianViewsZ: number;
  medianEngagementZ: number;
  medianCommentsZ: number;
}

export interface DayOfWeekStatV2 {
  day: number;               // 0=Sun, 6=Sat
  label: string;
  medianComposite: number;
  shrunkScore: number;
  confidenceTier: ConfidenceTier;
  ciLower: number | null;
  ciUpper: number | null;
  videoCount: number;
  medianViewsZ: number;
  medianEngagementZ: number;
  medianCommentsZ: number;
}

export interface DaypartStat {
  daypart: number;           // 0=Night, 1=Morning, 2=Afternoon, 3=Evening
  label: string;
  medianComposite: number;
  shrunkScore: number;
  confidenceTier: ConfidenceTier;
  ciLower: number | null;
  ciUpper: number | null;
  videoCount: number;
  medianViewsZ: number;
  medianEngagementZ: number;
  medianCommentsZ: number;
}

export interface DayDaypartCell {
  day: number;
  daypart: number;
  label: string;
  medianComposite: number;
  videoCount: number;
  confidenceTier: ConfidenceTier;
}

export interface BestTimeToPostV2Data {
  dayOfWeek: DayOfWeekStatV2[];
  daypart: DaypartStat[];
  dayDaypartGrid: DayDaypartCell[];
  hourly: HourStatV2[];           // 24-hour breakdown (primary)
  globalMedianCompositeScore: number;
  kruskalWallis: { H: number; df: number; p: number };
  // Best hour (composite)
  bestHour: number;
  bestHourLabel: string;
  bestHourScore: number;
  // Best hour per metric
  bestHourForViews: number;
  bestHourForViewsLabel: string;
  bestHourForEngagement: number;
  bestHourForEngagementLabel: string;
  bestHourForComments: number;
  bestHourForCommentsLabel: string;
  // Day-of-week best (backward compat)
  bestDayOfWeek: number;
  bestDayOfWeekLabel: string;
  bestDayOfWeekScore: number;
  // Subscriber day-of-week (from YT Analytics enrichment)
  bestDayForSubscribers?: number;
  bestDayForSubscribersLabel?: string;
  subscribersByDayOfWeek?: number[];
  bestDaypart: number;
  bestDaypartLabel: string;
  bestDaypartScore: number;
  totalVideosAnalyzed: number;
  shortsCount: number;
  longCount: number;
  isSignificant: boolean;
  /** IANA timezone used for the analysis, e.g. "America/New_York" */
  timezone?: string;
  /** Segment filter: "all" | "shorts" | "long" */
  segment?: string;
}

export interface InsightsData {
  bestTimeToPost: BestTimeToPostData | null;
  bestTimeToPostV2: BestTimeToPostV2Data | null;    // NEW: DB-powered algorithm
  retention: RetentionByHourData | null;
  retentionByPublishHour: RetentionByPublishHourData | null;
  audienceActiveTime: AudienceActiveTimeData | null; // NEW: audience activity by hour
  estimatedAudienceActiveTime?: EstimatedAudienceActiveTimeData | null; // DB-powered view-velocity estimate
}

// ── Audience Active Time (Insights tab) ──────────────────────────────────

export interface AudienceDayOfWeekStat {
  day: number;
  label: string;
  views: number;
  subscribersGained: number;
  likes: number;
  comments: number;
  shares: number;
}

export interface AudienceActiveTimeData {
  dayOfWeek: AudienceDayOfWeekStat[];
  peakDay: number;
  peakDayLabel: string;
  totalViews: number;
}

// ── Estimated Audience Activity (DB-powered view-velocity model) ───────

export interface EstimatedHourlyActivity {
  hour: number;              // 0-23
  label: string;             // "12AM", "1AM", ..., "11PM"
  estimatedViews: number;
  estimatedWatchTime: number;
  viewPercentage: number;    // % of total estimated views
  videoCount: number;
  confidence: 'high' | 'medium' | 'low' | 'insufficient';
}

export interface EstimatedAudienceActiveTimeData {
  hourly: EstimatedHourlyActivity[];
  peakHour: number;
  peakHourLabel: string;
  confidence: 'high' | 'medium' | 'low';
  totalVideosAnalyzed: number;
  modelParameters: {
    tau: number;
    beta: number;
    sigma: number;
  };
}

// ============================================================================
// UI STATE MODELS
// ============================================================================

export type DashboardTab = 'videoAnalytics' | 'channelAnalytics' | 'audience' | 'playlistAnalytics' | 'insights';

export type ChartType = 
  | 'views'
  | 'subscribersGained'
  | 'subscribersLost'
  | 'watchTime'
  | 'retention'
  | 'ctr'
  | 'likes'
  | 'comments'
  | 'shares';

export interface UIState {
  activeTab: DashboardTab;
  activeChart: ChartType;
  showAnnotations: boolean;
  trueDeltaEnabled: boolean;
  compareEnabled: boolean;
  showAllTimeViews: boolean;
  selectedMetrics: Set<string>;
  selectedDimensions: Set<string>;
  selectedPlaylistMetas: Set<string>;
}

export interface ModalState {
  showListDropdown: boolean;
  isAddListModalOpen: boolean;
  isEditListModalOpen: boolean;
  editingList: SavedList | null;
  listSearchTerm: string;
}

// ============================================================================
// DATE RANGE MODELS
// ============================================================================

export interface DateRangeState {
  period: 7 | 30 | 90 | null;
  customStartDate: string | null; // ISO string
  customEndDate: string | null; // ISO string
  latestDataDate: string | null; // ISO string
}

// ============================================================================
// LIST MODELS
// ============================================================================

export interface ListState {
  savedLists: SavedList[];
  activeLists: SavedList[];
}

// ============================================================================
// COMBINED DASHBOARD STATE
// ============================================================================

export interface DashboardState {
  // Core data
  channel: ChannelState;
  videos: VideoState;
  playlists: PlaylistState;
  analytics: AnalyticsState;
  lists: ListState;
  
  // Filters & Selection
  filters: VideoFilters;
  videoLimit: VideoLimitConfig;
  videoSelection: VideoSelection;
  playlistSelection: PlaylistSelection;
  listSelection: ListSelection;
  
  // UI State
  ui: UIState;
  modals: ModalState;
  dateRange: DateRangeState;
}

// ============================================================================
// ACTION TYPES
// ============================================================================

export interface DashboardActions {
  // Channel actions
  setChannels: (channels: ChannelInfo[]) => void;
  setSelectedChannel: (channelId: string | null) => void;
  setOrgTokenMap: (map: Record<string, { accessToken: string; refreshToken: string; expiresAt?: number }>) => void;
  
  // Video actions
  setVideos: (videos: VideoMetadata[]) => void;
  setLoadingVideos: (loading: boolean) => void;
  setVideosError: (error: string | null) => void;
  
  // Playlist actions
  setPlaylists: (playlists: PlaylistMetadata[]) => void;
  setLoadingPlaylists: (loading: boolean) => void;
  
  // Filter actions
  setVideoTypeFilter: (type: 'all' | 'shorts' | 'long') => void;
  setVideoSearchQuery: (query: string) => void;
  setVideoVisibilityFilter: (visibility: VisibilityFilter) => void;
  setPlaylistVisibilityFilter: (visibility: VisibilityFilter) => void;
  setPlaylistActivityFilter: (activity: PlaylistActivityFilter) => void;
  setFilterByPlaylists: (enabled: boolean) => void;
  setSelectedPlaylists: (playlists: Set<string>) => void;
  setFilterByVideos: (enabled: boolean) => void;
  setSelectedVideos: (videos: Set<string>) => void;
  
  // Selection actions
  setSelectedVideo: (video: VideoMetadata | null) => void;
  setSelectedVideoIds: (ids: Set<string>) => void;
  setTableCheckedOverride: (ids: Set<string> | null) => void;
  
  // List actions
  setActiveListIds: (ids: Set<string>) => void;
  setSavedLists: (lists: SavedList[]) => void;
  
  // UI actions
  setActiveTab: (tab: DashboardTab) => void;
  setActiveChart: (chart: ChartType) => void;
  setShowAnnotations: (show: boolean) => void;
  setTrueDeltaEnabled: (enabled: boolean) => void;
  setCompareEnabled: (enabled: boolean) => void;
  setShowAllTimeViews: (show: boolean) => void;
  
  // Date range actions
  setPeriod: (period: 7 | 30 | 90 | null) => void;
  setCustomDateRange: (start: string | null, end: string | null) => void;
  setLatestDataDate: (date: string | null) => void;
  
  // Modal actions
  setShowListDropdown: (show: boolean) => void;
  setIsAddListModalOpen: (open: boolean) => void;
  setIsEditListModalOpen: (open: boolean) => void;
  setEditingList: (list: SavedList | null) => void;
  
  // Analytics actions
  setAnalyticsData: (data: Partial<AnalyticsState>) => void;
  setAnalyticsLoading: (loading: boolean) => void;
  setAnalyticsError: (error: string | null) => void;
  setChannelAnalyticsData: (data: { channelMetrics?: AnalyticsReport | null; channelOverview?: { views: number; subscribersGained: number; subscribersLost: number; watchTime: number; likes: number; comments: number; shares: number; videosUploaded: number; } | null; channelAnalyticsChartData?: Array<{ date: string; [key: string]: string | number | undefined; }> | null; channelMultiPeriodStats?: MultiPeriodStats | null }) => void;
  setChannelAnalyticsLoading: (loading: boolean) => void;
  setDimensionsData: (data: unknown) => void;
  setDimensionsLoading: (loading: boolean) => void;
  
  // Bulk actions
  resetChannelState: () => void;
  resetFilters: () => void;
  resetSelection: () => void;
}

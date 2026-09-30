// ─────────────────────────────────────────────────────────────────────────────
// Playlist Optimizer -- TypeScript types
// ─────────────────────────────────────────────────────────────────────────────

export interface Video {
  id: string;
  videoId?: string;
  originalPlaylistId?: string;
  title: string;
  description?: string;
  url?: string;
  views?: number;
  publishDate?: string;
  customMetadata?: Record<string, unknown>;
  Video_Type?: 'video' | 'short';
  channelId?: string;
  channelTitle?: string;
  views7?: number;
  views30?: number;
  views90?: number;
  retention?: number;
  ctr?: number;
  performance?: Record<string, number | string | undefined>;
}

export type DataRange = '7d' | '30d' | '90d' | 'all';

export interface PlaylistVideo {
  id: string;
  videoId?: string;
  title: string;
}

export interface ExistingPlaylist {
  playlistId: string;
  title: string;
  url?: string;
  videoCount?: number;
  views?: string;
  engagementScore?: number;
  videos: { id: string; videoId?: string; title: string }[];
}

export interface PlaylistCriteriaBreakdown {
  criterion: string;
  score: number;
  note?: string;
}

export interface AuditData {
  channelScore: number;
  contentHealthScore: number;
  audiencePersona: string;
  primaryNiche: string;
  contentStrengths: string[];
  contentWeaknesses: string[];
  missedOpportunities: string[];
  metadataAnalysis: string;
  criteriaBreakdown?: PlaylistCriteriaBreakdown[];
  totalVideosAnalyzed: number;
  existingPlaylists?: ExistingPlaylist[];
}

export interface PlaylistRecommendation {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  tags: string[];
  reasoning: string;
  why: string;
  videos: PlaylistVideo[];
  viralityScore: number;
  predictedReach: 'High' | 'Medium' | 'Low' | 'Niche';
  currentViralityScore?: number;
  currentPredictedReach?: string;
  currentTitle?: string;
  currentDescription?: string;
  currentTags?: string[];
  currentUrl?: string;
  currentPlaylistViews?: string;
  isCombined?: boolean;
  parentPlaylistId?: string;
  topic?: string;
  criteria?: string;
  goal?: string;
  audience?: string;
  includeThemes?: string;
  excludeThemes?: string;
  engagementPrediction: string;
  userRating?: 'positive' | 'negative' | null;
}

export interface AnalysisResult {
  channelName?: string;
  audit: AuditData;
  playlists: PlaylistRecommendation[];
  summary: string;
  groundingMetadata?: unknown;
  unassignedVideos?: {
    id: string;
    videoId?: string;
    title: string;
    reason?: string;
  }[];
  /** Per-video data echoed from the backend: decay weight, views, playlist,
   *  channel. Powers the "Included Videos & Data" table. */
  videoInsights?: VideoInsight[];
  /** What data was used for this analysis: channel, mode, range, playlists,
   *  filters. Powers the "Analysis Details" panel. */
  analysisMeta?: AnalysisMeta;
}

/** One row in the included-videos comparison table. */
export interface VideoInsight {
  videoId: string;
  title: string;
  url?: string;
  channelTitle?: string;
  playlistId?: string;
  playlistTitle?: string;
  publishDate?: string;
  ageDays?: number;
  views?: number;
  views7?: number;
  views30?: number;
  views90?: number;
  decayWeight?: number;
  decayTier?: string;
}

export interface AnalysisMetaPlaylist {
  playlistId: string;
  title: string;
  videoCount: number;
}

export interface AnalysisMeta {
  channelIdentifier?: string;
  mode?: string;
  dataRange?: string;
  videoCount?: number;
  playlistsIncluded?: AnalysisMetaPlaylist[];
  filters?: {
    excludeKeywords?: string;
    maxPlaylists?: number;
    minPlaylists?: number;
    minVideosPerPlaylist?: number;
    maxVideosPerPlaylist?: number;
    maxPlaylistsPerVideo?: number;
    onlyOptimized?: boolean;
    useTimeDecay?: boolean;
    enableTargetPlaylist?: boolean;
    targetName?: string;
    targetCriteria?: string;
  };
}

export type AnalysisMode = 'NEW' | 'EXISTING';
export type ModelPreference = 'BALANCED' | 'BEST_QUALITY' | 'FASTEST_RESPONSE';

export interface TargetPlaylistConfig {
  targetName: string;
  targetTopic: string;
  targetCriteria: string;
  targetGoal: string;
  targetAudience: string;
  targetIncludeThemes: string;
  targetExcludeThemes: string;
  maxVideos?: number;
  minVideos?: number;
  maxPlaylists?: number;
}

export interface ExplicitPlaylistMapping {
  playlistName: string;
  videoIdentifiers: string[];
}

export interface FilterConfig {
  analysisMode: AnalysisMode;
  channelIdentifier: string;
  startDate: string;
  endDate: string;
  excludeKeywords: string;
  excludeUrls: string;
  includeTypes: ('video' | 'short')[];
  maxPlaylists: number;
  minPlaylists: number;
  minVideosPerPlaylist: number;
  maxVideosPerPlaylist: number;
  maxPlaylistsPerVideo: number;
  onlyOptimized: boolean;
  dataRange?: DataRange;
  /** Opt-in time-decay weighting: when ON the AI weights newer + better
   *  performing videos highest; when OFF (default) all videos weigh equally. */
  useTimeDecay?: boolean;
  modelPreference: ModelPreference;
  enableThinkingMode: boolean;
  enableTargetPlaylist: boolean;
  targetName: string;
  targetTopic: string;
  targetCriteria: string;
  targetGoal: string;
  targetAudience: string;
  targetIncludeThemes: string;
  targetExcludeThemes: string;
  bulkTargetPlaylists?: TargetPlaylistConfig[];
  explicitPlaylistMapping?: ExplicitPlaylistMapping[];
}

export type InputMode = 'MANUAL' | 'CSV' | 'JSON' | 'ENRICH';

export interface AnalyzeRequest {
  channelIdentifier?: string;
  videos: Video[];
  filterConfig?: Partial<FilterConfig>;
}

export interface AnalyzeResponse {
  results: AnalysisResult;
  _usage?: { used: number; limit: number; pageKey: string };
}

export interface SaveRequest {
  name?: string;
  audits: AnalysisResult;
  errors?: unknown[];
  channelId?: string;
  channelTitle?: string;
}

export interface SaveResponse {
  id: number;
  createdAt: string;
}

export interface HistoryItem {
  id: number;
  name: string;
  createdAt: string | null;
  channelId: string | null;
  channelTitle: string | null;
  totalVideos: number;
  hasErrors: boolean;
}

export interface HistoryResponse {
  items: HistoryItem[];
  total: number;
  page: number;
}

export interface SavedAnalysis {
  id: number;
  name: string;
  createdAt: string | null;
  updatedAt: string | null;
  channelId: string | null;
  channelTitle: string | null;
  totalVideos: number;
  audits: AnalysisResult;
  errors: unknown[] | null;
}

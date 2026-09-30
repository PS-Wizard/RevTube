export interface YouTubeVideoSnippet {
  publishedAt: string;
  channelId: string;
  title: string;
  description: string;
  thumbnails: {
    default?: { url: string; width: number; height: number };
    medium?: { url: string; width: number; height: number };
    high?: { url: string; width: number; height: number };
    standard?: { url: string; width: number; height: number };
    maxres?: { url: string; width: number; height: number };
  };
  channelTitle: string;
  playlistId: string;
  position: number;
  resourceId: {
    kind: string;
    videoId: string;
  };
}

export interface ChannelBrandingSettings {
  channel: {
    title: string;
    description: string;
    keywords: string;
    unsubscribedTrailer?: string;
    country?: string;
    featuredChannelsTitle?: string;
    featuredChannelsUrls?: string[];
  };
  image?: {
    bannerExternalUrl: string;
  };
}

export interface ChannelStatistics {
  viewCount: string;
  subscriberCount: string;
  hiddenSubscriberCount: boolean;
  videoCount: string;
}

export interface ChannelStatus {
  privacyStatus: string;
  isLinked?: boolean;
  longUploadsStatus?: string;
  madeForKids?: boolean;
  selfDeclaredMadeForKids?: boolean;
}

export interface ChannelMetadata {
  id: string;
  snippet: {
    title: string;
    description: string;
    customUrl: string;
    publishedAt: string;
    country?: string;
    thumbnails: {
      default?: { url: string; width: number; height: number };
      medium?: { url: string; width: number; height: number };
      high?: { url: string; width: number; height: number };
    };
  };
  contentDetails: {
    relatedPlaylists: {
      likes: string;
      uploads: string;
    };
  };
  statistics: ChannelStatistics;
  brandingSettings: ChannelBrandingSettings;
  status?: ChannelStatus;
}

export interface ChannelApiResponse {
  kind: string;
  etag: string;
  pageInfo: {
    totalResults: number;
    resultsPerPage: number;
  };
  items?: ChannelMetadata[];
}

export interface YouTubeVideoContentDetails {
  videoId: string;
  videoPublishedAt: string;
}

export interface YouTubePlaylistItem {
  kind: string;
  etag: string;
  id: string;
  snippet: YouTubeVideoSnippet;
  contentDetails: YouTubeVideoContentDetails;
}

export interface YouTubeApiResponse {
  kind: string;
  etag: string;
  nextPageToken?: string;
  prevPageToken?: string;
  pageInfo: {
    totalResults: number;
    resultsPerPage: number;
  };
  items: YouTubePlaylistItem[];
}

export interface VideoMetadata {
  position?: number;
  title: string;
  videoId: string;
  sourcePlaylistIds?: string[];
  publishedAt: string;
  channelTitle: string;
  description: string | null;
  thumbnailUrl: string;
  viewCount?: number;
  periodViewCount?: number;
  likeCount?: number;
  commentCount?: number;
  ctr?: number; // Impression Click-Through Rate
  impressions?: number;
  retention?: number; // Average view percentage
  averageViewDuration?: number; // Average view duration in seconds (per-video)
  engagedViews?: number; // Engaged views (favorited, liked, commented, shared, subscribed)
  estimatedMinutesWatched?: number; // Watch time in minutes (per-video, range-scoped)
  trends?: number[]; // View trends (last n days)
  duration?: string; // ISO 8601 duration
  tags?: string[];
  /** YouTube visibility of the video: public | unlisted | private. */
  privacyStatus?: string;
  isUnavailable?: boolean;
}

export interface VideoStatistics {
  viewCount: string;
  likeCount: string;
  commentCount: string;
}

export interface VideoDetailsItem {
  id: string;
  snippet: {
    title: string;
    description: string;
    publishedAt: string;
    channelId: string;
    channelTitle: string;
    thumbnails: {
      default?: { url: string };
      medium?: { url: string };
      high?: { url: string };
    };
    tags?: string[];
  };
  statistics: VideoStatistics;
  contentDetails: {
    duration: string;
  };
}

export interface VideoDetailsResponse {
  items: VideoDetailsItem[];
}

export interface PlaylistMetadata {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  itemCount: number;
  channelTitle: string;
  publishedAt: string;
  keywords?: string[];
  /** YouTube visibility of the playlist: public | unlisted | private. */
  privacyStatus?: string;
  /** Publish date of the newest video mapped to this playlist (computed client-side
   *  from dashboard videos' sourcePlaylistIds; null when no mapped videos are loaded). */
  lastVideoPublishedAt?: string | null;
  /** Client-side activity classification: "running" = newest mapped video within
   *  PLAYLIST_RUNNING_WINDOW_DAYS, else "archive". */
  activityLabel?: 'running' | 'archive';
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
  periodViewCount?: number;
  allTimeViewCount?: number;
  /** Sum of periodViewCount for all videos in this playlist (computed client-side). */
  videoPeriodViewCount?: number;
}

/** Response from channel endpoint when includeTrailer=true */
export interface ChannelWithTrailerResponse {
  channel: ChannelApiResponse;
  trailerVideo: VideoDetailsResponse | null;
}

export interface PlaylistItem {
  id: string;
  snippet: {
    title: string;
    description: string;
    channelTitle: string;
    publishedAt: string;
    thumbnails: {
      default?: { url: string };
      medium?: { url: string };
      high?: { url: string };
    };
    tags?: string[];
  };
  contentDetails: {
    itemCount: number;
  };
}

export interface PlaylistsApiResponse {
  items: PlaylistItem[];
  nextPageToken?: string;
  pageInfo?: {
    totalResults?: number;
    resultsPerPage?: number;
  };
  /** Backend-computed catalog truth: pageInfo.totalResults plus merged
   *  owner-only (private/unlisted) rows. Absent on unmerged responses. */
  catalogTotal?: number;
}


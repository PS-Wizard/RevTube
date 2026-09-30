import type { VideoMetadata } from '../types/youtube';
import type { VisibilityFilter, PlaylistActivityFilter } from '../types/dashboard';
import type { AnalyticsReport } from '../services/analyticsService';
import { parseDuration } from './timeUtils';

export type FilterableVideo = VideoMetadata & { sourcePlaylistIds?: string[] };

/**
 * Normalize a raw privacy status (e.g. "PRIVACY_PUBLIC", "PRIVACY_UNLISTED",
 * "PRIVACY_PRIVATE", or lowercase) to canonical "public" | "unlisted" | "private".
 * Returns undefined when the value is missing/unknown.
 */
export const normalizePrivacyStatus = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const s = value.toLowerCase();
  if (s.includes('unlisted')) return 'unlisted';
  if (s.includes('private')) return 'private';
  if (s.includes('public')) return 'public';
  return undefined;
};

/**
 * Visibility predicate — strict filter.
 *  - 'public'   keeps only known-public items (unknown/missing status treated as
 *               public so legacy / API-key rows don't disappear).
 *  - 'private'  keeps only known-private items (public no longer included).
 *  - 'unlisted' keeps only known-unlisted items (public no longer included).
 *  - 'all'      keeps everything.
 */
export const matchesVisibilityFilter = (
  privacyStatus: string | undefined,
  filter: VisibilityFilter,
): boolean => {
  const status = normalizePrivacyStatus(privacyStatus);
  if (filter === 'all') return true;
  if (filter === 'private') return status === 'private';
  if (filter === 'unlisted') return status === 'unlisted';
  return status === undefined || status === 'public';
};

/** A playlist counts as "running" while its newest mapped video was published within
 *  this many days; anything older (or with no loaded videos) is "archive". */
export const PLAYLIST_RUNNING_WINDOW_DAYS = 90;

/**
 * Map each playlist id to the publish date of its newest mapped video.
 * Dashboard videos carry sourcePlaylistIds (playlist->video mapping) and
 * publishedAt, so this is derived client-side without extra YouTube quota.
 */
export const getLastVideoPublishedByPlaylist = (
  videos: FilterableVideo[],
): Map<string, string> => {
  const map = new Map<string, string>();
  for (const video of videos) {
    if (!video.publishedAt || !video.sourcePlaylistIds) continue;
    for (const playlistId of video.sourcePlaylistIds) {
      const prev = map.get(playlistId);
      if (!prev || prev < video.publishedAt) map.set(playlistId, video.publishedAt);
    }
  }
  return map;
};

/**
 * Activity classification: "running" = still receiving new videos (newest mapped
 * video within PLAYLIST_RUNNING_WINDOW_DAYS); "archive" = dormant/completed.
 * Playlists with no mapped videos loaded cannot prove activity and count as archive.
 */
export const classifyPlaylistActivity = (
  lastVideoPublishedAt?: string | null,
): 'running' | 'archive' => {
  if (!lastVideoPublishedAt) return 'archive';
  const cutoff = Date.now() - PLAYLIST_RUNNING_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return new Date(lastVideoPublishedAt).getTime() > cutoff ? 'running' : 'archive';
};

export const matchesPlaylistActivityFilter = (
  lastVideoPublishedAt: string | null | undefined,
  filter: PlaylistActivityFilter,
): boolean => {
  if (filter === 'all') return true;
  return classifyPlaylistActivity(lastVideoPublishedAt) === filter;
};

export type AudienceFilterContext = {
  scopedVideoIds: string[];
  scopedCount: number;
  hasExplicitScope: boolean;
  truncated: boolean;
  usedCheckedRows: boolean;
  usedVideoSelectionScope: boolean;
};

export const getVideosByActiveFilters = ({
  videos,
  videoTypeFilter,
  videoSearchQuery,
  filterByPlaylists,
  selectedPlaylists,
  filterByVideos,
  selectedVideos,
  visibilityFilter = 'public',
}: {
  videos: FilterableVideo[];
  videoTypeFilter: 'all' | 'shorts' | 'long';
  videoSearchQuery: string;
  filterByPlaylists: boolean;
  selectedPlaylists: Set<string>;
  filterByVideos: boolean;
  selectedVideos: Set<string>;
  visibilityFilter?: VisibilityFilter;
}): FilterableVideo[] => {
  let filtered = videos;

  filtered = filtered.filter(v => matchesVisibilityFilter(v.privacyStatus, visibilityFilter));

  if (videoTypeFilter !== 'all') {
    filtered = filtered.filter(v => {
      if (!v.duration) return false;
      const seconds = parseDuration(v.duration);
      return videoTypeFilter === 'shorts' ? seconds <= 60 : seconds > 60;
    });
  }

  if (videoSearchQuery) {
    const query = videoSearchQuery.toLowerCase();
    filtered = filtered.filter(v => v.title.toLowerCase().includes(query));
  }

  if (filterByPlaylists && selectedPlaylists.size > 0) {
    filtered = filtered.filter(v =>
      v.sourcePlaylistIds && v.sourcePlaylistIds.some((id: string) => selectedPlaylists.has(id))
    );
  }

  if (filterByVideos && selectedVideos.size > 0) {
    filtered = filtered.filter(v => selectedVideos.has(v.videoId));
  }

  return filtered;
};

export const buildAudienceFilterContext = ({
  selectedVideo,
  tableCheckedOverride,
  selectedVideoIds,
  hasVideoCountScope,
  activeListIds,
  isTemporaryList,
  videoTypeFilter,
  filterByPlaylists,
  selectedPlaylists,
  filterByVideos,
  selectedVideos,
  videoSearchQuery,
  filteredVideos,
}: {
  selectedVideo: VideoMetadata | null;
  tableCheckedOverride: Set<string> | null;
  selectedVideoIds: Set<string>;
  hasVideoCountScope: boolean;
  activeListIds: Set<string>;
  isTemporaryList: boolean;
  videoTypeFilter: 'all' | 'shorts' | 'long';
  filterByPlaylists: boolean;
  selectedPlaylists: Set<string>;
  filterByVideos: boolean;
  selectedVideos: Set<string>;
  videoSearchQuery: string;
  filteredVideos: FilterableVideo[];
}): AudienceFilterContext => {
  const hasTableFilters = videoTypeFilter !== 'all' ||
    (filterByPlaylists && selectedPlaylists.size > 0) ||
    (filterByVideos && selectedVideos.size > 0) ||
    videoSearchQuery !== '';

  const hasSelectedVideoScope = selectedVideoIds.size > 0 && !selectedVideoIds.has('XX_NONE_XX_');

  const checkedAllVisibleVideos = (() => {
    if (tableCheckedOverride === null) return false;
    if (tableCheckedOverride.size !== filteredVideos.length) return false;
    return filteredVideos.every(v => tableCheckedOverride.has(v.videoId));
  })();

  const ignoreCheckedRowsAsExplicitScope =
    checkedAllVisibleVideos &&
    !hasTableFilters &&
    activeListIds.size === 0 &&
    !isTemporaryList &&
    selectedVideo === null;

  const hasExplicitScope = selectedVideo !== null ||
    (tableCheckedOverride !== null && !ignoreCheckedRowsAsExplicitScope) ||
    hasSelectedVideoScope ||
    hasVideoCountScope ||
    hasTableFilters ||
    activeListIds.size > 0 ||
    isTemporaryList;

  if (selectedVideo) {
    return {
      scopedVideoIds: [selectedVideo.videoId],
      scopedCount: 1,
      hasExplicitScope: true,
      truncated: false,
      usedCheckedRows: false,
      usedVideoSelectionScope: false,
    };
  }

  const usedCheckedRows = tableCheckedOverride !== null && !ignoreCheckedRowsAsExplicitScope;
  const usedVideoSelectionScope = !usedCheckedRows && hasSelectedVideoScope && !hasTableFilters;
  const candidateIds = usedCheckedRows
    ? Array.from(tableCheckedOverride)
    : usedVideoSelectionScope
      ? Array.from(selectedVideoIds)
    : filteredVideos.map(v => v.videoId);

  return {
    scopedVideoIds: candidateIds,
    scopedCount: candidateIds.length,
    hasExplicitScope,
    truncated: false,
    usedCheckedRows,
    usedVideoSelectionScope,
  };
};

export const chunkArray = <T>(array: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
};

export const partition = <T>(array: T[], predicate: (val: T) => boolean): [T[], T[]] => {
  return array.reduce(
    (acc, val) => {
      acc[predicate(val) ? 0 : 1].push(val);
      return acc;
    },
    [[], []] as [T[], T[]]
  );
};

export const getVideoSubset = (
  data: { rows?: Array<unknown[]> } & Record<string, unknown>,
  videoIds: string[] | Set<string>,
): { rows?: Array<Array<unknown>> } & Record<string, unknown> | null => {
  if (!data || !data.rows) return null;
  const idSet = videoIds instanceof Set ? videoIds : new Set(videoIds);
  // Column index for video dimension in day,video reports is typically 1
  return {
    ...data,
    rows: data.rows.filter((row) => idSet.has(row[1] as string))
  };
};

/** Match batching in video trend fetches; long video== lists fail or truncate against YouTube. */
export const DIMENSION_VIDEO_IDS_PER_ANALYTICS_FILTER = 25;

export function getVideoIdsForDimensionsFilter(
  scope: AudienceFilterContext,
  selectedVideo: VideoMetadata | null,
  allowImplicitVideoScope: boolean
): string[] | null {
  if (selectedVideo) return [selectedVideo.videoId];
  const ids = scope.scopedVideoIds.filter(id => id && id !== 'XX_NONE_XX_');
  if (ids.length === 0) return null;
  if (!scope.hasExplicitScope && !allowImplicitVideoScope) return null;
  return ids;
}

export const buildVideoFilterString = (
  scope: AudienceFilterContext,
  selectedVideo: VideoMetadata | null,
  opts?: { allowImplicitVideoScope?: boolean }
): string | undefined => {
  const ids = getVideoIdsForDimensionsFilter(scope, selectedVideo, opts?.allowImplicitVideoScope ?? false);
  if (!ids?.length) return undefined;
  return `video==${ids.join(',')}`;
};

export type DimensionsBundleData = {
  trafficSource: AnalyticsReport | null;
  gender: AnalyticsReport | null;
  ageGroup: AnalyticsReport | null;
  subscribedStatus: AnalyticsReport | null;
  country: AnalyticsReport | null;
  deviceType: AnalyticsReport | null;
};

export type DimensionsPeriodPair = {
  current: DimensionsBundleData;
  previous: DimensionsBundleData;
};

/** 7d / 30d / 90d windows vs immediately prior windows of the same length (end date aligned).
 *  When a custom date range is active, dCustom holds the full user-chosen range. */
export type DimensionsMultiPeriodData = {
  d7: DimensionsPeriodPair;
  d30: DimensionsPeriodPair;
  d90: DimensionsPeriodPair;
  dCustom?: DimensionsPeriodPair;
};

function mergeMetricDimensionReports(reports: (AnalyticsReport | null)[]): AnalyticsReport | null {
  const valid = reports.filter((r): r is AnalyticsReport => Boolean(r?.rows?.length));
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0];
  const mergedMap = new Map<string, unknown[]>();
  for (const rep of valid) {
    for (const row of rep.rows!) {
      const key = String(row[0]);
      const prev = mergedMap.get(key);
      if (!prev) {
        mergedMap.set(key, [...row]);
      } else {
        for (let c = 1; c < row.length; c++) {
          prev[c] = Number(prev[c] ?? 0) + Number(row[c] ?? 0);
        }
      }
    }
  }
  return {
    kind: valid[0].kind,
    columnHeaders: valid[0].columnHeaders,
    rows: Array.from(mergedMap.values()) as AnalyticsReport['rows'],
  };
}

export function mergeDimensionsBundles(bundles: DimensionsBundleData[]): DimensionsBundleData {
  const empty: DimensionsBundleData = {
    trafficSource: null,
    gender: null,
    ageGroup: null,
    subscribedStatus: null,
    country: null,
    deviceType: null,
  };
  if (bundles.length === 0) return empty;
  if (bundles.length === 1) return bundles[0];
  const first = bundles[0];
  return {
    trafficSource: mergeMetricDimensionReports(bundles.map(b => b.trafficSource)),
    gender: bundles.find(b => b.gender?.rows?.length)?.gender ?? first.gender,
    ageGroup: bundles.find(b => b.ageGroup?.rows?.length)?.ageGroup ?? first.ageGroup,
    subscribedStatus: mergeMetricDimensionReports(bundles.map(b => b.subscribedStatus)),
    country: mergeMetricDimensionReports(bundles.map(b => b.country)),
    deviceType: mergeMetricDimensionReports(bundles.map(b => b.deviceType)),
  };
}
/** Merge multiple day-dimension AnalyticsReports (e.g. fetched per 25-video chunk) by summing each metric over the shared date column. */
export function mergeReportsByDay(reports: (AnalyticsReport | null)[]): AnalyticsReport | null {
  const valid = reports.filter((r): r is AnalyticsReport => Boolean(r && r.rows && r.columnHeaders));
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0];

  const mergedMap = new Map<string, unknown[]>();
  for (const rep of valid) {
    for (const row of rep.rows!) {
      const date = String(row[0]);
      if (!mergedMap.has(date)) {
        mergedMap.set(date, [...row]);
      } else {
        const existing = mergedMap.get(date)!;
        for (let c = 1; c < row.length; c++) {
          existing[c] = (Number(existing[c]) || 0) + (Number(row[c]) || 0);
        }
      }
    }
  }

  return {
    kind: valid[0].kind,
    columnHeaders: valid[0].columnHeaders,
    rows: Array.from(mergedMap.values())
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))) as AnalyticsReport['rows'],
  };
}

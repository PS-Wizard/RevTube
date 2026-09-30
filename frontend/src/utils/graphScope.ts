/**
 * Graph scope resolution for the dashboard analytics charts.
 *
 * The charts must follow the tables: playlist row (un)checks + the status
 * filter scope the playlist graph, and video row checks + narrowing toolbar
 * filters (visibility / type / search / playlist / video selection) scope the
 * video graph. This restores the legacy useDashboardAnalytics semantics that
 * the React Query migration dropped (it only forwarded the raw selection
 * sets, so status changes never refetched and toolbar filters never applied).
 */

import {
  getVideosByActiveFilters,
  type FilterableVideo,
} from './dashboardUtils';
import type { VisibilityFilter } from '../types/dashboard';

/**
 * Playlist graph scope: checked rows intersected with the currently visible
 * rows (list scope + status/activity filters, i.e. exactly what the table
 * shows). Sorted for stable filter strings / query keys.
 */
export function resolveGraphPlaylistIds(
  selectedIds: Set<string> | string[],
  visibleIds: string[],
): string[] {
  const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds);
  const visible = new Set(visibleIds);
  return [...selected].filter((id) => visible.has(id)).sort();
}

export interface GraphVideoScopeArgs {
  /** Opened video detail (single-video drilldown wins over everything). */
  selectedVideoId: string | null;
  /** Effective row checks: tableCheckedOverride ?? selectedVideoIds, sentinel stripped. */
  checkedVideoIds: string[];
  visibilityFilter: VisibilityFilter;
  videoTypeFilter: 'all' | 'shorts' | 'long';
  videoSearchQuery: string;
  filterByPlaylists: boolean;
  selectedPlaylists: Set<string> | string[];
  filterByVideos: boolean;
  selectedVideos: Set<string> | string[];
  videos: FilterableVideo[];
}

/**
 * Video graph scope (legacy parity):
 * - opened video → just it;
 * - explicit row checks → exactly those;
 * - else narrowing toolbar filters expand to the matching video IDs;
 * - else null (channel-wide).
 * An expansion that matches nothing also yields null (channel-wide), matching
 * the legacy hook.
 */
export function resolveGraphVideoIds(args: GraphVideoScopeArgs): string[] | null {
  if (args.selectedVideoId) return [args.selectedVideoId];

  if (args.checkedVideoIds.length > 0) {
    return [...new Set(args.checkedVideoIds)].sort();
  }

  const selectedPlaylists =
    args.selectedPlaylists instanceof Set ? args.selectedPlaylists : new Set(args.selectedPlaylists);
  const selectedVideos =
    args.selectedVideos instanceof Set ? args.selectedVideos : new Set(args.selectedVideos);

  const hasNarrowingFilter =
    args.visibilityFilter !== 'all' ||
    args.videoTypeFilter !== 'all' ||
    args.videoSearchQuery !== '' ||
    selectedPlaylists.size > 0 ||
    selectedVideos.size > 0;
  if (!hasNarrowingFilter) return null;

  const scoped = getVideosByActiveFilters({
    videos: args.videos,
    videoTypeFilter: args.videoTypeFilter,
    videoSearchQuery: args.videoSearchQuery,
    visibilityFilter: args.visibilityFilter,
    filterByPlaylists: args.filterByPlaylists,
    selectedPlaylists,
    filterByVideos: args.filterByVideos,
    selectedVideos,
  });
  const ids = [...new Set(scoped.map((v) => v.videoId).filter(Boolean))].sort();
  return ids.length > 0 ? ids : null;
}

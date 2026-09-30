/**
 * React Query hook for playlist data fetching.
 *
 * Mirrors useVideosQuery: a useInfiniteQuery over server-paginated pages
 * (PAGE_SIZE rows per request) so large catalogs load incrementally -- the
 * first screenful arrives fast and "Next" fetches the next page on demand.
 * The backend serves the full DB-backed catalog sliced per page, so the true
 * total is known from page one (`playlistsTotal`).
 */

import { useMemo } from 'react';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { useDashboardStore } from '../../stores/dashboardStore';
import { useAuth } from '../useAuth';
import { useOrganization } from '../useOrganization';
import { YouTubeService, resolveNextOffsetParam, type DashboardPlaylistPage } from '../../services/youtubeService';
import {
  DASHBOARD_WS_KEY_PENDING,
  REVTUBE_DASHBOARD_WS_ROOT,
  getDashboardWorkspaceKey,
} from '../../utils/dashboardWorkspaceScope';
import type { PlaylistMetadata } from '../../types/youtube';

interface UsePlaylistsQueryOptions {
  channelId: string | null;
  getEffectiveToken: (channelId: string) => Promise<string | null>;
  userEmail?: string;
  enabled?: boolean;
}

// Small incremental page size, matching the video catalog: the dashboard only
// needs a first screenful; more pages are fetched on demand (table Next/Last,
// rows-per-page growth, select-all drain).
const PAGE_SIZE = 20;

export const usePlaylistsQuery = ({
  channelId,
  getEffectiveToken,
  userEmail = '',
  enabled = false, // Default off; dashboard enables on playlist analytics (parity with v1 auto-load)
}: UsePlaylistsQueryOptions) => {
  const { user } = useAuth();
  const { isPersonalContext, currentOrganization } = useOrganization();
  const channels = useDashboardStore((state) => state.channel.channels);
  const includePrivate = useDashboardStore((state) => state.filters.playlistVisibility) !== 'public';
  const resolvedEmail = userEmail || user?.email || '';
  const workspaceKey =
    getDashboardWorkspaceKey({
      userId: user?.uid,
      isPersonalContext,
      organizationId: currentOrganization?.id,
    }) ?? DASHBOARD_WS_KEY_PENDING;

  const query = useInfiniteQuery({
    queryKey: [REVTUBE_DASHBOARD_WS_ROOT, workspaceKey, 'playlists', channelId, resolvedEmail, includePrivate ? 'all' : 'public'],
    queryFn: async ({ pageParam }): Promise<DashboardPlaylistPage> => {
      if (!channelId) return { items: [], total: 0, hasMore: false, offset: pageParam, limit: PAGE_SIZE };

      const token = await getEffectiveToken(channelId);
      if (!token) {
        throw new Error('No valid token available');
      }

      // Create YouTube service instance -- pass orgId so the backend can resolve
      // the org channel's stored OAuth token for channels the member doesn't personally own.
      const ytService = new YouTubeService(resolvedEmail, token, !isPersonalContext ? (currentOrganization?.id ?? null) : null);

      // Fetch a single server-paginated page (offset-based).
      return ytService.fetchDashboardChannelPlaylists(channelId, PAGE_SIZE, includePrivate, pageParam);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => resolveNextOffsetParam(lastPage),
    enabled: enabled && !!channelId && !(isPersonalContext && channels.length === 0),
    // Playlists change rarely (new playlist created, privacy flip) -- a longer
    // stale window than videos is safe; the table retry path refetches on demand.
    staleTime: 30 * 60 * 1000, // 30 minutes
    gcTime: 60 * 60 * 1000, // 1 hour
    // Keep showing the previous scope's rows while a filter switch loads, so
    // the table never blanks to "no playlists" mid-switch.
    placeholderData: keepPreviousData,
    retry: 1,
    meta: { suppressGlobalErrorToast: true },
  });

  // Flatten all loaded pages into one array (grows as more pages are fetched).
  // Deduped by id: a stale/mixed backend can repeat rows across pages (e.g.
  // owner-only rows appended per page); duplicates must never inflate the
  // table, counts, or selection.
  const playlists = useMemo<PlaylistMetadata[]>(() => {
    const byId = new Map<string, PlaylistMetadata>();
    for (const page of query.data?.pages ?? []) {
      for (const item of page.items) {
        if (!byId.has(item.id)) byId.set(item.id, item);
      }
    }
    return [...byId.values()];
  }, [query.data]);

  // First partial-page failure reason across loaded pages (private-inclusive
  // leg errored, public rows substituted). Silent empty-answer substitutions
  // carry no message and stay badge-free by design.
  const partialError = useMemo<string | null>(() => {
    for (const page of query.data?.pages ?? []) {
      const p = page as DashboardPlaylistPage | undefined;
      if (p?.partial && p.partialError) return p.partialError;
    }
    return null;
  }, [query.data]);
  // Backend-reported catalog total (from the last page that reported one).
  // Used for "Showing X of <total>" labels so counts don't read as loaded-only.
  // Once the catalog is fully drained (no next page), the enumerated rows are
  // ground truth: clamp a stale-high backend total down so the UI can never
  // claim more playlists than actually exist.
  const playlistsTotal = useMemo<number | undefined>(() => {
    const pages = query.data?.pages ?? [];
    let reported: number | undefined;
    for (let i = pages.length - 1; i >= 0; i--) {
      const total = (pages[i] as DashboardPlaylistPage | undefined)?.total;
      if (typeof total === 'number' && total >= 0) {
        reported = total;
        break;
      }
    }
    if (reported === undefined) return undefined;
    if (pages.length > 0 && query.hasNextPage === false) {
      return Math.min(reported, playlists.length);
    }
    return reported;
  }, [query.data, query.hasNextPage, playlists]);

  return {
    data: playlists,
    playlistsTotal,
    partialError,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    error: query.error,
    refetch: query.refetch,
  };
};

/**
 * React Query hook for video data fetching
 * Replaces scattered video loading logic in useDashboardVideos
 */

import { useEffect, useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useDashboardStore } from '../../stores/dashboardStore';
import { useAuth } from '../useAuth';
import { useOrganization } from '../useOrganization';
import { YouTubeService, resolveNextOffsetParam, type DashboardVideoPage } from '../../services/youtubeService';
import {
  DASHBOARD_WS_KEY_PENDING,
  REVTUBE_DASHBOARD_WS_ROOT,
  getDashboardWorkspaceKey,
} from '../../utils/dashboardWorkspaceScope';
import type { VideoMetadata } from '../../types/youtube';

interface UseVideosQueryOptions {
  channelId: string | null;
  getEffectiveToken: (channelId: string) => Promise<string | null>;
  videoLimit: number | 'all' | 'custom';
  customLimit: number;
  userEmail?: string;
  enabled?: boolean;
}

// Small incremental page size: the dashboard only needs a first screenful;
// more pages are fetched on demand ("Load more") since all metric math is
// done server-side. This avoids wasting bandwidth on a huge initial load.
const PAGE_SIZE = 20;

export const useVideosQuery = ({
  channelId,
  getEffectiveToken,
  videoLimit,
  customLimit,
  userEmail = '',
  enabled = true,
}: UseVideosQueryOptions) => {
  const { user } = useAuth();
  const { isPersonalContext, currentOrganization } = useOrganization();
  const channels = useDashboardStore((state) => state.channel.channels);
  const visibility = useDashboardStore((state) => state.filters.visibility);
  const privacy = visibility === 'public' || visibility === 'private' || visibility === 'unlisted' ? visibility : 'all';
  const resolvedEmail = userEmail || user?.email || '';
  const workspaceKey =
    getDashboardWorkspaceKey({
      userId: user?.uid,
      isPersonalContext,
      organizationId: currentOrganization?.id,
    }) ?? DASHBOARD_WS_KEY_PENDING;

  // Hard cap on how many videos the user asked for ('all' → unlimited).
  // Fetching stops once the cap is reached, regardless of pagination.
  const maxItems = (() => {
    if (videoLimit === 'all') return Number.POSITIVE_INFINITY;
    if (videoLimit === 'custom') return Math.max(1, customLimit);
    if (typeof videoLimit === 'number') return Math.max(1, videoLimit);
    return Number.POSITIVE_INFINITY;
  })();

  const query = useInfiniteQuery({
    queryKey: [REVTUBE_DASHBOARD_WS_ROOT, workspaceKey, 'videos', channelId, resolvedEmail, privacy],
    queryFn: async ({ pageParam }): Promise<DashboardVideoPage> => {
      if (!channelId) return { items: [], total: 0, hasMore: false, offset: pageParam, limit: PAGE_SIZE };

      // Shrink the final page so we never overshoot the user's configured limit.
      const remaining = maxItems - pageParam;
      if (remaining <= 0) return { items: [], total: pageParam, hasMore: false, offset: pageParam, limit: 0 };
      const size = Math.min(PAGE_SIZE, remaining);

      const token = await getEffectiveToken(channelId);
      if (!token) {
        throw new Error('No valid token available');
      }

      // Create YouTube service instance -- pass orgId so the backend can resolve
      // the org channel's stored OAuth token for channels the member doesn't personally own.
      const ytService = new YouTubeService(resolvedEmail, token, isPersonalContext ? null : (currentOrganization?.id ?? null));

      // Fetch a single server-paginated page (offset-based).
      return ytService.fetchDashboardChannelVideos(channelId, size, undefined, privacy, pageParam);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const next = resolveNextOffsetParam(lastPage);
      if (next === undefined || next >= maxItems) return undefined;
      return next;
    },
    enabled: enabled && !!channelId && !(isPersonalContext && channels.length === 0),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    retry: 1,
    meta: { suppressGlobalErrorToast: true },
  });

  // Flatten all loaded pages into one array (grows as more pages are fetched).
  const videos = useMemo<VideoMetadata[]>(
    () => (query.data?.pages ?? []).flatMap((p) => p.items),
    [query.data],
  );

  // Backend-reported catalog total (from the last page that reported one).
  // Used for "Showing X of <total>" labels so counts don't read as loaded-only.
  const videosTotal = useMemo<number | undefined>(() => {
    const pages = query.data?.pages ?? [];
    for (let i = pages.length - 1; i >= 0; i--) {
      const total = (pages[i] as DashboardVideoPage | undefined)?.total;
      if (typeof total === 'number' && total >= 0) return total;
    }
    return undefined;
  }, [query.data]);

  // Keep the Zustand store in sync with the accumulated catalog so selectors,
  // channels/analytics bridging, and the video table render the loaded set.
  useEffect(() => {
    if (videos.length > 0) {
      useDashboardStore.getState().setVideos(videos);
    }
  }, [videos]);

  return {
    data: videos,
    videosTotal,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    error: query.error,
    refetch: query.refetch,
  };
};

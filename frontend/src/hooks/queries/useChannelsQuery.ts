/**
 * React Query hooks for channel data fetching
 * Replaces scattered channel loading logic
 */

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../useAuth';
import { useOrganization } from '../useOrganization';
import { getOrganizationChannels } from '../../services/organizationChannelService';
import { useDashboardStore } from '../../stores/dashboardStore';
import type { ChannelInfo } from '../../types/dashboard';
import {
  DASHBOARD_WS_KEY_PENDING,
  REVTUBE_DASHBOARD_WS_ROOT,
  getDashboardWorkspaceKey,
} from '../../utils/dashboardWorkspaceScope';

export const useChannelsQuery = () => {
  const { allTokens, user, isLoadingTokens } = useAuth();
  const { currentOrganization, isPersonalContext } = useOrganization();

  const personalTokenKey = isPersonalContext
    ? allTokens
        .map(t => t.channelId)
        .filter(Boolean)
        .sort()
        .join('|')
    : '';

  const workspaceKey =
    getDashboardWorkspaceKey({
      userId: user?.uid,
      isPersonalContext,
      organizationId: currentOrganization?.id,
    }) ?? DASHBOARD_WS_KEY_PENDING;

  return useQuery({
    queryKey: [REVTUBE_DASHBOARD_WS_ROOT, workspaceKey, 'channels', personalTokenKey],
    queryFn: async (): Promise<ChannelInfo[]> => {
      if (isPersonalContext) {
        useDashboardStore.getState().setOrgTokenMap({});
        return allTokens
          .filter(token => token.channelId)
          .map(token => ({
            id: token.channelId!,
            snippet: {
              title: token.channelTitle || '',
              thumbnails: token.thumbnailUrl
                ? {
                    default: { url: token.thumbnailUrl },
                  }
                : undefined,
            },
            channelTitle: token.channelTitle,
            isOrganizationChannel: false,
          }));
      }

      if (currentOrganization) {
        const orgChannels = await getOrganizationChannels(currentOrganization.id);
        const tokenMap: Record<string, { accessToken: string; refreshToken: string; expiresAt?: number }> = {};
        orgChannels.forEach(channel => {
          if (channel.id && channel.accessToken && channel.refreshToken) {
            tokenMap[channel.id] = {
              accessToken: channel.accessToken,
              refreshToken: channel.refreshToken,
              expiresAt: channel.expiresAt,
            };
          }
        });
        useDashboardStore.getState().setOrgTokenMap(tokenMap);

        return orgChannels.map(ch => ({
          id: ch.id,
          snippet: {
            title: ch.channelTitle,
            thumbnails: ch.thumbnailUrl
              ? {
                  default: { url: ch.thumbnailUrl },
                }
              : undefined,
          },
          channelTitle: ch.channelTitle,
          isOrganizationChannel: true,
        }));
      }

      return [];
    },
    enabled:
      !!user &&
      (isPersonalContext ? (!isLoadingTokens && allTokens.length > 0) : !!currentOrganization),
    staleTime: 10 * 60 * 1000,
  });
};

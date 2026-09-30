/**
 * React Query hook for per-channel Focus & Knowledge.
 * Org-aware: personal context queries `organizationId=null`,
 * org context queries the active org id — never leaking across scopes.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOrganization } from '../useOrganization';
import {
  getChannelFocus,
  type ChannelFocus,
} from '../../services/channelFocusService';

export const channelFocusKey = (channelId: string | null, organizationId: string | null) =>
  ['channel-focus', channelId, organizationId ?? 'personal'] as const;

export const useChannelFocusQuery = (channelId: string | null) => {
  const { currentOrganization, isPersonalContext } = useOrganization();
  const organizationId = isPersonalContext ? null : (currentOrganization?.id ?? null);

  return useQuery<ChannelFocus | null>({
    queryKey: channelFocusKey(channelId, organizationId),
    queryFn: () => getChannelFocus(channelId!, organizationId),
    enabled: !!channelId,
    staleTime: 5 * 60 * 1000,
  });
};

export const useInvalidateChannelFocus = () => {
  const queryClient = useQueryClient();
  const { currentOrganization, isPersonalContext } = useOrganization();
  const organizationId = isPersonalContext ? null : (currentOrganization?.id ?? null);
  return (channelId: string) =>
    queryClient.invalidateQueries({ queryKey: channelFocusKey(channelId, organizationId) });
};

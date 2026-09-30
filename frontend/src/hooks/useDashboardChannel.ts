/**
 * Refactored Channel Management Hook
 * Replaces useDashboardSync - simplified to use Zustand store
 */

import { useEffect, useCallback, useMemo, useLayoutEffect, useRef } from 'react';
import { useDashboardStore } from '../stores/dashboardStore';
import type { DashboardState, DashboardActions } from '../types/dashboard';
import { useChannelsQuery } from './queries/useChannelsQuery';
import { useAuth } from './useAuth';
import { useOrganization } from './useOrganization';
import { refreshOrgChannelToken } from '../services/organizationChannelService';
import { queryClient } from '../lib/queryClient';
import {
  REVTUBE_DASHBOARD_WS_ROOT,
  getDashboardWorkspaceKey,
} from '../utils/dashboardWorkspaceScope';

const LAST_SELECTED_CHANNEL_KEY = 'selectedChannel_last';

export const useDashboardChannel = () => {
  const { getValidToken, user } = useAuth();
  const { currentOrganization, isPersonalContext } = useOrganization();
  
  // Store state -- read channels from store so optimistic updates (e.g. channel deletion)
  // are reflected immediately without waiting for the React Query refetch.
  const selectedChannel = useDashboardStore((state: DashboardState & DashboardActions) => state.channel.selectedChannel);
  const channelSelectionHydrated = useDashboardStore((state: DashboardState & DashboardActions) => state.channel.channelSelectionHydrated);
  const orgTokenMap = useDashboardStore((state: DashboardState & DashboardActions) => state.channel.orgTokenMap);
  const channels = useDashboardStore((state: DashboardState & DashboardActions) => state.channel.channels);

  // Store actions
  const setChannels = useDashboardStore((state: DashboardState & DashboardActions) => state.setChannels);
  const setSelectedChannel = useDashboardStore((state: DashboardState & DashboardActions) => state.setSelectedChannel);
  const setOrgTokenMap = useDashboardStore((state: DashboardState & DashboardActions) => state.setOrgTokenMap);
  const resetChannelState = useDashboardStore((state: DashboardState & DashboardActions) => state.resetChannelState);
  const setSavedLists = useDashboardStore((state: DashboardState & DashboardActions) => state.setSavedLists);

  const workspaceKey = useMemo(
    () =>
      getDashboardWorkspaceKey({
        userId: user?.uid,
        isPersonalContext,
        organizationId: currentOrganization?.id,
      }),
    [user?.uid, isPersonalContext, currentOrganization?.id],
  );

  const prevWorkspaceKeyRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (!workspaceKey) return;
    if (prevWorkspaceKeyRef.current === null) {
      prevWorkspaceKeyRef.current = workspaceKey;

      // On mount (fresh page load or after navigating from another page), check
      // if the Zustand store has stale channel data from a different workspace
      // context. This happens when the user switches org↔personal on the profile
      // page then navigates to /dashboard -- the DashboardPage remounts, so the
      // workspaceKey change path below is never triggered.
      const cachedChannels = useDashboardStore.getState().channel.channels;
      if (cachedChannels.length > 0) {
        const hasOrgChannels = cachedChannels.some(
          (ch: { isOrganizationChannel?: boolean }) => ch.isOrganizationChannel,
        );
        if (isPersonalContext ? hasOrgChannels : !hasOrgChannels) {
          // Store has channels from the opposite context -- clear them to prevent
          // token errors from mismatched org/personal credentials.
          resetChannelState();
          setSavedLists([]);
          setChannels([]);
          useDashboardStore.setState((state: DashboardState & DashboardActions) => ({
            channel: {
              ...state.channel,
              channels: [],
              selectedChannel: null,
              channelSelectionHydrated: false,
              orgTokenMap: {},
            },
          }));
        }
      }

      return;
    }
    if (prevWorkspaceKeyRef.current === workspaceKey) return;

    const previousScope = prevWorkspaceKeyRef.current;
    prevWorkspaceKeyRef.current = workspaceKey;

    queryClient.removeQueries({
      queryKey: [REVTUBE_DASHBOARD_WS_ROOT, previousScope],
    });

    // Clear scoped channel selections to prevent org channels from bleeding into personal context
    // (and vice versa) when switching modes.
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('selectedChannel_personal_') ||
            key?.startsWith('selectedChannel_org_')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));
    } catch {
      /* ignore */
    }

    resetChannelState();
    setSavedLists([]);
    setChannels([]);
    useDashboardStore.setState((state: DashboardState & DashboardActions) => ({
      channel: {
        ...state.channel,
        selectedChannel: null,
        channelSelectionHydrated: false,
        orgTokenMap: {},
      },
    }));
  }, [workspaceKey, isPersonalContext, resetChannelState, setSavedLists, setChannels]);
  
  // Fetch channels using React Query (source of truth for data, Zustand is the reactive cache)
  const channelsQuery = useChannelsQuery();
  const loadingChannels = channelsQuery.isLoading;
  const isFetched = channelsQuery.isFetched;
  const isFetching = channelsQuery.isFetching;

  // Keep Zustand store in sync when React Query returns fresh data
  useEffect(() => {
    if (channelsQuery.data && channelsQuery.data.length > 0) {
      setChannels(channelsQuery.data);
    }
  }, [channelsQuery.data, setChannels]);

  // Query settled with zero channels: unblock dashboard so empty / connect UI can render.
  // Handles both the settled-with-data case (isFetched && !isFetching) and the
  // disabled-query case (!isFetched && !isFetching && !isLoading) -- the latter
  // occurs when switching from org → personal before token loading completes.
  useEffect(() => {
    if (channels.length > 0) return;
    if (!isFetched && (isFetching || loadingChannels)) return;

    const { channelSelectionHydrated: hydrated, selectedChannel: sel } =
      useDashboardStore.getState().channel;
    if (hydrated && sel === null) return;

    useDashboardStore.setState((state: DashboardState & DashboardActions) => ({
      channel: {
        ...state.channel,
        channelSelectionHydrated: true,
        selectedChannel: null,
      },
    }));
  }, [channels.length, isFetched, isFetching, loadingChannels]);
  
  // Org OAuth tokens are populated in useChannelsQuery (same Firestore read) so they exist
  // before channelSelectionHydrated -- avoids racing videos/analytics queries with an empty orgTokenMap.

  // When channels exist: ensure selection is valid (handles empty → first channel after connect)
  useEffect(() => {
    if (channels.length === 0) return;

    const pickPreferred = (): string => {
      try {
        let scoped: string | null = null;
        if (isPersonalContext && user?.uid) {
          scoped = localStorage.getItem(`selectedChannel_personal_${user.uid}`);
        } else if (currentOrganization) {
          scoped = localStorage.getItem(`selectedChannel_org_${currentOrganization.id}`);
        }
        const lastGlobal = localStorage.getItem(LAST_SELECTED_CHANNEL_KEY);
        const candidates = [scoped, lastGlobal].filter(Boolean) as string[];
      for (const id of candidates) {
          if (channels.some((ch: { id: string }) => ch.id === id)) return id;
      }
      } catch {
        /* ignore */
      }
      return channels[0].id;
    };

    const { selectedChannel: cur, channelSelectionHydrated: hydrated } =
      useDashboardStore.getState().channel;
    if (cur && channels.some((ch: { id: string }) => ch.id === cur)) {
      if (!hydrated) {
        useDashboardStore.setState((state: DashboardState & DashboardActions) => ({
          channel: { ...state.channel, channelSelectionHydrated: true },
        }));
      }
      return;
    }

    // Persisted channel was deleted server-side -- clear stale analytics state first
    if (cur && !channels.some((ch: { id: string }) => ch.id === cur)) {
      resetChannelState();
    }

    setSelectedChannel(pickPreferred());
    useDashboardStore.setState((state: DashboardState & DashboardActions) => ({
      channel: { ...state.channel, channelSelectionHydrated: true },
    }));
  }, [
    channels,
    setSelectedChannel,
    resetChannelState,
    isPersonalContext,
    currentOrganization,
    currentOrganization?.id,
    user?.uid,
  ]);

  useEffect(() => {
    if (!selectedChannel || !user?.uid) return;
    try {
      localStorage.setItem(LAST_SELECTED_CHANNEL_KEY, selectedChannel);
      if (isPersonalContext) {
        localStorage.setItem(`selectedChannel_personal_${user.uid}`, selectedChannel);
      } else if (currentOrganization) {
        localStorage.setItem(`selectedChannel_org_${currentOrganization.id}`, selectedChannel);
      }
    } catch {
      /* ignore */
    }
  }, [selectedChannel, user?.uid, isPersonalContext, currentOrganization, currentOrganization?.id]);
  
  // Resolve OAuth token: personal (Firestore user tokens) then org shared credentials -- mirrors useDashboardSync.
  const getEffectiveToken = useCallback(
    async (channelId: string) => {
      const personalToken = await getValidToken(channelId);
      if (personalToken) return personalToken;

      if (isPersonalContext || !currentOrganization) {
        if (import.meta.env.VITE_APP_ENV === 'development') {
          console.warn('[Token][getEffectiveToken] Skipping token lookup in personal context without org fallback.', {
            channelId,
            isPersonalContext,
            hasCurrentOrganization: !!currentOrganization,
          });
        }
        return null;
      }

      const orgChannel = orgTokenMap[channelId];
      if (!orgChannel?.accessToken || !orgChannel?.refreshToken) return null;

      const isExpired =
        !orgChannel.expiresAt || Date.now() >= orgChannel.expiresAt - 5 * 60 * 1000;
      if (!isExpired) return orgChannel.accessToken;

      const newToken = await refreshOrgChannelToken(
        currentOrganization.id,
        channelId,
        orgChannel.refreshToken
      );
      if (newToken) {
        const prev = useDashboardStore.getState().channel.orgTokenMap;
        setOrgTokenMap({
          ...prev,
          [channelId]: {
            ...orgChannel,
            accessToken: newToken,
            expiresAt: Date.now() + 3600 * 1000,
          },
        });
      }
      return newToken;
    },
    [isPersonalContext, currentOrganization, orgTokenMap, getValidToken, setOrgTokenMap]
  );
  
  // Get/save latest data date
  const getLatestDataDate = useCallback((channelId: string): string | null => {
    try {
      const stored = localStorage.getItem(`latestDataDate_${channelId}`);
      const storedTime = localStorage.getItem(`latestDataDate_${channelId}_time`);
      
      if (stored && storedTime) {
        const age = Date.now() - parseInt(storedTime, 10);
        // Valid for 24 hours
        if (age < 24 * 60 * 60 * 1000) {
          return stored;
        }
      }
    } catch {
      /* ignore */
    }
    return null;
  }, []);
  
  const saveLatestDataDate = useCallback((channelId: string, date: string) => {
    try {
      localStorage.setItem(`latestDataDate_${channelId}`, date);
      localStorage.setItem(`latestDataDate_${channelId}_time`, Date.now().toString());
    } catch {
      /* ignore */
    }
    
    // Also update store
    useDashboardStore.getState().setLatestDataDate(date);
  }, []);
  
  return {
    channels,
    selectedChannel,
    channelSelectionHydrated,
    loadingChannels,
    getEffectiveToken,
    getLatestDataDate,
    saveLatestDataDate,
  };
};

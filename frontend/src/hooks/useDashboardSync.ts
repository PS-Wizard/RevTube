import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from './useAuth';
import { useOrganization } from './useOrganization';
import { getOrganizationChannels, refreshOrgChannelToken, type OrganizationChannel } from '../services/organizationChannelService';
import { AnalyticsService } from '../services/analyticsService';
import { saveYouTubeToken } from '../services/userService';

const LAST_SELECTED_CHANNEL_KEY = 'selectedChannel_last';

const ORG_CHANNELS_CACHE_PREFIX = 'revtube:orgChannels:v1:';
/** Stale-while-revalidate: show last org snapshot quickly, refresh from Firestore in background. */
const ORG_CHANNELS_CACHE_TTL_MS = 8 * 60 * 1000;

type DashboardTokenEntry = {
  channelId?: string;
  channelTitle?: string;
  accessToken: string;
  authorizedAt?: string | number | Date;
  email: string;
  refreshToken?: string;
  expiresAt?: number;
  thumbnailUrl?: string;
};

type AggregatedChannelRow = {
  id: string;
  snippet: {
    title: string;
    thumbnails?: { default?: { url: string } };
  };
  isOrganizationChannel: boolean;
};

function readOrgChannelsSessionCache(
  orgId: string
): { channels: OrganizationChannel[]; fetchedAt: number } | null {
  try {
    const raw = sessionStorage.getItem(ORG_CHANNELS_CACHE_PREFIX + orgId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { channels: OrganizationChannel[]; fetchedAt: number };
    if (!Array.isArray(parsed.channels) || typeof parsed.fetchedAt !== 'number') return null;
    if (Date.now() - parsed.fetchedAt > ORG_CHANNELS_CACHE_TTL_MS) return null;
    if (parsed.channels.length === 0) return null;
    const usable = parsed.channels.some(c => c.accessToken || c.refreshToken);
    if (!usable) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeOrgChannelsSessionCache(orgId: string, channels: OrganizationChannel[]) {
  try {
    sessionStorage.setItem(
      ORG_CHANNELS_CACHE_PREFIX + orgId,
      JSON.stringify({ channels, fetchedAt: Date.now() })
    );
  } catch {
    /* sessionStorage quota / private mode */
  }
}

function buildChannelAggregationState(
  localOrgChannels: OrganizationChannel[],
  tokensToUse: DashboardTokenEntry[],
  isPersonalContext: boolean,
  currentOrganization: { id: string } | null
): {
  aggregatedChannels: AggregatedChannelRow[];
  tokenMap: Record<string, string>;
  orgTokenMap: Record<string, OrganizationChannel>;
  knownChannelIds: Set<string>;
} {
  const aggregatedChannels: AggregatedChannelRow[] = [];
  const tokenMap: Record<string, string> = {};
  const knownChannelIds = new Set<string>();
  const orgTokenMap: Record<string, OrganizationChannel> = {};

  if (!isPersonalContext && currentOrganization) {
    localOrgChannels.forEach(oc => {
      if (oc.accessToken) orgTokenMap[oc.id] = oc;
    });
    localOrgChannels.forEach(orgChannel => {
      if (!knownChannelIds.has(orgChannel.id)) {
        aggregatedChannels.push({
          id: orgChannel.id,
          snippet: {
            title: orgChannel.channelTitle,
            thumbnails: orgChannel.thumbnailUrl ? { default: { url: orgChannel.thumbnailUrl } } : undefined
          },
          isOrganizationChannel: true
        });
        knownChannelIds.add(orgChannel.id);
      }
    });
  }

  const sortedTokens = [...tokensToUse].sort(
    (a, b) => new Date(b.authorizedAt || 0).getTime() - new Date(a.authorizedAt || 0).getTime()
  );

  sortedTokens.forEach(token => {
    if (token.channelId && token.channelTitle) {
      if (!isPersonalContext && currentOrganization) {
        const isOrgChannel = localOrgChannels.some(oc => oc.id === token.channelId);
        if (!isOrgChannel) return;
      }

      if (!knownChannelIds.has(token.channelId)) {
        aggregatedChannels.push({
          id: token.channelId,
          snippet: {
            title: token.channelTitle,
            thumbnails: token.thumbnailUrl ? { default: { url: token.thumbnailUrl } } : undefined
          },
          isOrganizationChannel: !isPersonalContext
        });
        knownChannelIds.add(token.channelId);
        tokenMap[token.channelId] = token.accessToken;
      }
    }
  });

  // Sort channels alphabetically by title
  aggregatedChannels.sort((a, b) => a.snippet.title.localeCompare(b.snippet.title));

  return { aggregatedChannels, tokenMap, orgTokenMap, knownChannelIds };
}

const readBootstrapUserId = (): string | null => {
  try {
    const raw = localStorage.getItem('revtube:auth-hint:v1');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { uid?: string };
    return parsed?.uid || null;
  } catch {
    return null;
  }
};

export const useDashboardSync = (perfLog: (label: string, startedAt: number, meta?: Record<string, unknown>) => void) => {
  const { allTokens, user, getValidToken, isLoadingTokens } = useAuth();
  
  const {
    currentOrganization,
    isPersonalContext,
    loading: organizationLoading
  } = useOrganization();

  const [channels, setChannels] = useState<AggregatedChannelRow[]>([]);
  const [orgTokenMap, setOrgTokenMap] = useState<Record<string, OrganizationChannel>>({});
  const [channelTokenMap, setChannelTokenMap] = useState<Record<string, string>>({});
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [channelSelectionHydrated, setChannelSelectionHydrated] = useState(false);
  const channelsRef = useRef<AggregatedChannelRow[]>([]);
  const lastLoadingContextRef = useRef<string | null>(null);

  useEffect(() => {
    channelsRef.current = channels;
  }, [channels]);

  const currentOrgIdRef = useRef<string | null>(null);
  useEffect(() => {
    currentOrgIdRef.current = currentOrganization?.id ?? null;
  }, [currentOrganization?.id]);
  
  const bootstrapUid = useMemo(() => readBootstrapUserId(), []);
  
  const selectedChannelStorageKey = useMemo(() => {
    if (isPersonalContext) {
      const uid = user?.uid || bootstrapUid;
      return uid ? `selectedChannel_personal_${uid}` : null;
    }
    return currentOrganization?.id ? `selectedChannel_org_${currentOrganization.id}` : null;
  }, [isPersonalContext, user?.uid, bootstrapUid, currentOrganization]);

  const loadingContextKey = useMemo(() => {
    if (isPersonalContext) {
      return `personal:${user?.uid || bootstrapUid || 'none'}`;
    }
    return `org:${currentOrganization?.id || 'none'}`;
  }, [isPersonalContext, user?.uid, bootstrapUid, currentOrganization?.id]);

  const [selectedChannel, setSelectedChannel] = useState<string | null>(() => {
    try {
      const uid = readBootstrapUserId();
      if (!uid) return localStorage.getItem(LAST_SELECTED_CHANNEL_KEY);
      
      const lastOrgId = localStorage.getItem(`lastOrgContext_${uid}`);
      if (lastOrgId) {
        const orgStored = localStorage.getItem(`selectedChannel_org_${lastOrgId}`);
        if (orgStored) return orgStored;
      }
      
      const personalKey = `selectedChannel_personal_${uid}`;
      return localStorage.getItem(personalKey) || localStorage.getItem(LAST_SELECTED_CHANNEL_KEY);
    } catch {
      return null;
    }
  });

  const selectedChannelRef = useRef<string | null>(selectedChannel);
  useEffect(() => {
    selectedChannelRef.current = selectedChannel;
  }, [selectedChannel]);

  const prevSelectedChannelStorageKeyRef = useRef<string | null>(null);

  // Drop selection immediately when switching personal/org (or org), so analytics never show stale workspace data.
  useLayoutEffect(() => {
    const prev = prevSelectedChannelStorageKeyRef.current;
    prevSelectedChannelStorageKeyRef.current = selectedChannelStorageKey;
    if (prev !== null && prev !== selectedChannelStorageKey) {
      setSelectedChannel(null);
    }
  }, [selectedChannelStorageKey]);

  // Persistence
  useEffect(() => {
    if (selectedChannel) {
      try {
        localStorage.setItem(LAST_SELECTED_CHANNEL_KEY, selectedChannel);
        if (selectedChannelStorageKey) {
          localStorage.setItem(selectedChannelStorageKey, selectedChannel);
        }
        if (isPersonalContext && user?.email) {
          localStorage.setItem(`selectedChannel_personal_${user.email}`, selectedChannel);
        }
      } catch (err) {
        console.warn('Failed to save selected channel:', err);
      }
    }
  }, [selectedChannel, selectedChannelStorageKey, isPersonalContext, user?.email]);

  useEffect(() => {
    const prevKey = prevSelectedChannelStorageKeyRef.current;
    prevSelectedChannelStorageKeyRef.current = selectedChannelStorageKey;
    const keyChanged = prevKey !== selectedChannelStorageKey;
    if (!keyChanged) return;

    let cancelled = false;

    (async () => {
      if (!cancelled) {
        setChannelSelectionHydrated(false);
      }
      try {
        if (selectedChannelStorageKey) {
          const stored = localStorage.getItem(selectedChannelStorageKey);
          const legacyPersonalKey = user?.email ? `selectedChannel_personal_${user.email}` : null;
          const legacyStored = !stored && legacyPersonalKey ? localStorage.getItem(legacyPersonalKey) : null;
          if (!stored && legacyStored) {
            localStorage.setItem(selectedChannelStorageKey, legacyStored);
          }

          // Last-selected remains a final fallback in case scoped keys are missing.
          // Invalid cross-context ids are ignored later when channels are validated.
          const fallbackStored =
            !stored && !legacyStored ? localStorage.getItem(LAST_SELECTED_CHANNEL_KEY) : null;

          const resolved = stored || legacyStored || fallbackStored;
          if (!cancelled && resolved && resolved !== selectedChannelRef.current) {
            setSelectedChannel(resolved);
          }
        }
      } catch (err) {
        console.warn('Failed to read selected channel:', err);
      } finally {
        if (!cancelled) {
          setChannelSelectionHydrated(true);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [selectedChannelStorageKey, user?.email, isPersonalContext]);

  // Latest Data Date Persistence & Resolution
  const [latestDataDate, setLatestDataDate] = useState<string>(() => {
    if (!selectedChannel) return '';
    try {
      const stored = localStorage.getItem(`latestDate_${selectedChannel}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        const storedDate = new Date(parsed.date);
        const now = new Date();
        const daysDiff = Math.floor((now.getTime() - storedDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysDiff <= 1) return parsed.date;
      }
    } catch { return ''; }
    return '';
  });

  const saveLatestDataDate = useCallback((date: string) => {
    setLatestDataDate(date);
    if (selectedChannel && date) {
      try {
        localStorage.setItem(`latestDate_${selectedChannel}`, JSON.stringify({ date, timestamp: Date.now() }));
      } catch {
        // Storage write failed, ignore
      }
    }
  }, [selectedChannel]);

  const getEffectiveToken = useCallback(async (channelId: string): Promise<string | null> => {
    const personalToken = await getValidToken(channelId);
    if (personalToken) return personalToken;

    // Personal context: do not fall back to org tokens. Prevents "No access token" noise
    // when a personal account has not connected any channel yet (onboarding / empty state).
    if (isPersonalContext) return null;

    const orgChannel = orgTokenMap[channelId];
    if (!orgChannel?.accessToken || !orgChannel?.refreshToken || !currentOrganization) {
      if (import.meta.env.VITE_APP_ENV === 'development') {
        console.error('[Token][getEffectiveToken] Token resolution failed for channel:', channelId, {
          isPersonalContext,
          orgChannelPresent: !!orgChannel,
          hasAccessToken: !!orgChannel?.accessToken,
          hasRefreshToken: !!orgChannel?.refreshToken,
          currentOrganizationId: currentOrganization?.id,
          orgTokenMapKeys: Object.keys(orgTokenMap),
        });
      }
      return null;
    }

    const isExpired = !orgChannel.expiresAt || Date.now() >= orgChannel.expiresAt - 5 * 60 * 1000;
    if (!isExpired) {
      if (import.meta.env.VITE_APP_ENV === 'development') {
        console.log('[Token][getEffectiveToken] Using cached org access token for channel:', channelId);
      }
      return orgChannel.accessToken;
    }

    if (import.meta.env.VITE_APP_ENV === 'development') {
      console.warn(`[Token][getEffectiveToken] Org access token expired for channel ${channelId}. Attempting refresh...`);
    }
    const newToken = await refreshOrgChannelToken(currentOrganization.id, channelId, orgChannel.refreshToken);
    if (newToken) {
      if (import.meta.env.VITE_APP_ENV === 'development') {
        console.log(`[Token][getEffectiveToken] Successfully refreshed token for channel ${channelId}`);
      }
      setOrgTokenMap(prev => ({
        ...prev,
        [channelId]: { ...prev[channelId], accessToken: newToken, expiresAt: Date.now() + 3600 * 1000 },
      }));
    } else {
      console.error(`[Token][getEffectiveToken] Failed to refresh org token for channel ${channelId}. Returning null.`, {
        organizationId: currentOrganization.id,
        channelId,
        refreshTokenPresent: !!orgChannel.refreshToken,
      });
    }
    return newToken;
  }, [getValidToken, orgTokenMap, currentOrganization, isPersonalContext]);

  const selectedChannelRefForLayout = useRef<string | null>(selectedChannel);
  useEffect(() => {
    selectedChannelRefForLayout.current = selectedChannel;
  }, [selectedChannel]);

  // Flush latest-date bucket for the new channel before dashboard analytics useEffects run,
  // so loadAllData never sees the previous channel's latestDataDate in the same commit.
  useLayoutEffect(() => {
    const currentChannel = selectedChannelRefForLayout.current;
    if (!currentChannel) {
      setLatestDataDate('');
      return;
    }
    try {
      const raw = localStorage.getItem(`latestDate_${currentChannel}`);
      if (raw) {
        const parsed = JSON.parse(raw) as { date: string };
        const storedDate = new Date(parsed.date);
        const now = new Date();
        const daysDiff = Math.floor((now.getTime() - storedDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysDiff <= 1) {
          setLatestDataDate(parsed.date);
          return;
        }
      }
    } catch {
      /* ignore */
    }
    setLatestDataDate('');
  }, [selectedChannel, setLatestDataDate]);

  // Period Persistence
  const [period, setPeriod] = useState<number | null>(() => {
    try {
      const stored = localStorage.getItem('audienceRangeDays');
      return stored ? parseInt(stored, 10) : 30;
    } catch { return 30; }
  });

  useEffect(() => {
    try {
      localStorage.setItem('audienceRangeDays', String(period || 30));
    } catch {
      // Storage write failed, ignore
    }
  }, [period]);

  useEffect(() => {
    const fetchAllChannels = async () => {
      const channelsLoadStart = performance.now();
      const tokensToUse = allTokens || [];
      let deferredByTokenLoad = false;
      const contextChanged = lastLoadingContextRef.current !== loadingContextKey;
      lastLoadingContextRef.current = loadingContextKey;
      const shouldShowFullLoading = contextChanged || channelsRef.current.length === 0;

      // YouTube tokens may still be loading from auth; keep skeleton until we know the token list.
      if (tokensToUse.length === 0 && isPersonalContext && isLoadingTokens) {
        if (shouldShowFullLoading) {
          setLoadingChannels(true);
        }
        deferredByTokenLoad = true;
        return;
      }

      if (shouldShowFullLoading) {
        setLoadingChannels(true);
      }

      try {
        if (tokensToUse.length === 0 && isPersonalContext) {
          setChannels([]);
          setChannelTokenMap({});
          setOrgTokenMap({});
          if (selectedChannelRef.current) {
            setSelectedChannel(null);
          }
          return;
        }

        let localOrgChannels: OrganizationChannel[] = [];
        let usedOrgSessionCache = false;

        if (!isPersonalContext && currentOrganization) {
          const orgId = currentOrganization.id;
          const stale = readOrgChannelsSessionCache(orgId);
          if (stale) {
            localOrgChannels = stale.channels;
            usedOrgSessionCache = true;
            perfLog('channels.bootstrap.orgSessionCache', channelsLoadStart, { orgId, channels: localOrgChannels.length });
          } else {
            localOrgChannels = await getOrganizationChannels(orgId);
            if (localOrgChannels.length > 0) {
              writeOrgChannelsSessionCache(orgId, localOrgChannels);
            }
          }
        }

        const tokensTyped = tokensToUse as DashboardTokenEntry[];
        const merged = buildChannelAggregationState(
          localOrgChannels,
          tokensTyped,
          isPersonalContext,
          currentOrganization
        );
        const { aggregatedChannels, tokenMap, orgTokenMap: nextOrgTokenMap, knownChannelIds } = merged;

        setOrgTokenMap(nextOrgTokenMap);
        setChannels([...aggregatedChannels]);
        setChannelTokenMap({ ...tokenMap });
        perfLog('channels.bootstrap.step1', channelsLoadStart, {
          channels: aggregatedChannels.length,
          orgFromSessionCache: usedOrgSessionCache,
        });

        if (!isPersonalContext && currentOrganization && usedOrgSessionCache) {
          const orgId = currentOrganization.id;
          const orgForMerge = currentOrganization;
          const refreshStart = performance.now();
          void getOrganizationChannels(orgId)
            .then(fresh => {
              if (fresh.length > 0) writeOrgChannelsSessionCache(orgId, fresh);
              const next = buildChannelAggregationState(fresh, tokensTyped, false, orgForMerge);
              
              // Sort alphabetical
              next.aggregatedChannels.sort((a, b) => a.snippet.title.localeCompare(b.snippet.title));
              
              setOrgTokenMap(next.orgTokenMap);
              setChannels([...next.aggregatedChannels]);
              setChannelTokenMap({ ...next.tokenMap });
              const channelIds = new Set(next.aggregatedChannels.map(c => c.id));
              const cur = selectedChannelRef.current;
              
              if (next.aggregatedChannels.length > 0) {
                // If current selection is invalid for this new context, auto-select first alphabetical
                if (!cur || !channelIds.has(cur)) {
                  setSelectedChannel(next.aggregatedChannels[0].id);
                }
              } else if (cur) {
                setSelectedChannel(null);
              }
              perfLog('channels.bootstrap.orgFirestoreRefresh', refreshStart, { orgId, channels: fresh.length });
            })
            .catch(err => console.warn('Organization channel refresh failed:', err));
        }

        const channelIds = new Set(aggregatedChannels.map((c: { id: string }) => c.id));
        const cur = selectedChannelRef.current;
        let storedPreferredChannel: string | null = null;
        try {
          const scopedStored = selectedChannelStorageKey ? localStorage.getItem(selectedChannelStorageKey) : null;
          const legacyPersonalStored = user?.email ? localStorage.getItem(`selectedChannel_personal_${user.email}`) : null;
          const globalStored = localStorage.getItem(LAST_SELECTED_CHANNEL_KEY);
          const candidate = scopedStored || legacyPersonalStored || globalStored;
          if (candidate && channelIds.has(candidate)) {
            storedPreferredChannel = candidate;
          }
        } catch {
          /* ignore localStorage access issues */
        }

        if (aggregatedChannels.length > 0) {
          const missingStoredSelection = !!cur && !channelIds.has(cur);
          const shouldDeferFallbackSelection =
            // In personal context, initial token merge may not contain all channels yet.
            // Defer forcing "first channel" until enrichment resolves token-owned channels.
            isPersonalContext && tokensToUse.length > 0 && missingStoredSelection;

          if (storedPreferredChannel && storedPreferredChannel !== cur) {
            setSelectedChannel(storedPreferredChannel);
          } else if (!cur) {
            setSelectedChannel(aggregatedChannels[0].id);
          } else if (missingStoredSelection && !shouldDeferFallbackSelection) {
            setSelectedChannel(aggregatedChannels[0].id);
          }
        } else if (cur) {
          setSelectedChannel(null);
        }

        if (isPersonalContext && tokensToUse.length > 0) {
          const validationStart = performance.now();
          const runPersonalEnrichment = async () => {
            await Promise.all(tokensToUse.map(async (tokenData) => {
              try {
                const validToken = await getValidToken(tokenData.channelId || '');
                if (!validToken) return;

                const service = new AnalyticsService(validToken, tokenData.email);
                const userChannels = await service.getAuthorizedChannels();

                let hasNewData = false;
                userChannels.forEach(ch => {
                  if (!knownChannelIds.has(ch.id)) {
                    aggregatedChannels.push({ ...ch, isOrganizationChannel: false });
                    tokenMap[ch.id] = validToken;
                    knownChannelIds.add(ch.id);
                    hasNewData = true;
                  } else {
                    tokenMap[ch.id] = validToken;
                  }

                  if (user && !tokenData.channelId && ch.id) {
                    const updatedToken = {
                      ...tokenData,
                      channelId: ch.id,
                      channelTitle: ch.snippet.title,
                      refreshToken: tokenData.refreshToken || '',
                      expiresAt: tokenData.expiresAt || Date.now() + 3600000
                    };
                    saveYouTubeToken(user.uid, updatedToken);
                  }
                });

                if (hasNewData) {
                  // Sort channels alphabetically by title
                  aggregatedChannels.sort((a, b) => a.snippet.title.localeCompare(b.snippet.title));
                  
                  setChannels([...aggregatedChannels]);
                  setChannelTokenMap({ ...tokenMap });
                  const ids = new Set(aggregatedChannels.map((c: { id: string }) => c.id));
                  const sel = selectedChannelRef.current;
                  if (aggregatedChannels.length > 0 && (!sel || !ids.has(sel))) {
                    setSelectedChannel(aggregatedChannels[0].id);
                  }
                }
              } catch (err) {
                console.warn(`Token check failed for ${tokenData.email}:`, err);
              }
            }));
            perfLog('channels.bootstrap.validation', validationStart, { tokens: tokensToUse.length });
          };

          if (aggregatedChannels.length === 0) {
            await runPersonalEnrichment();
          } else {
            void runPersonalEnrichment();
          }
        }
      } catch (err) {
        console.error('Error in channel aggregation:', err);
      } finally {
        if (!deferredByTokenLoad) {
          setLoadingChannels(false);
        }
      }
    };
    
    if (!organizationLoading && channelSelectionHydrated) {
      void fetchAllChannels();
    }
  }, [allTokens, user, isPersonalContext, currentOrganization, organizationLoading, channelSelectionHydrated, isLoadingTokens, getValidToken, perfLog]);

  return {
    channels,
    setChannels,
    orgTokenMap,
    setOrgTokenMap,
    channelTokenMap,
    selectedChannel,
    setSelectedChannel,
    selectedChannelRef,
    channelSelectionHydrated,
    loadingChannels,
    getEffectiveToken,
    latestDataDate,
    saveLatestDataDate,
    period,
    setPeriod
  };
};

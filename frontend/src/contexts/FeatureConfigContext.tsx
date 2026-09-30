import React, { useCallback, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiUrl } from '../utils/apiBase';
import {
  featureConfigSchema,
  featureConfigCachePayloadSchema,
  DEFAULT_AUDIT_SCORING,
} from '../utils/featureConfigSchema';
import type { AuditScoring, FeatureConfig, PageConfig } from '../utils/featureConfigSchema';
import { FeatureConfigContext } from '../hooks/useFeatureConfig';

export type { FeatureConfig, PageConfig };

const FEATURE_CONFIG_CACHE_KEY = 'revtube:feature-config:v1';
const FEATURE_CONFIG_CACHE_TTL_MS = 60 * 1000;

const DEFAULT_CONFIG: FeatureConfig = {
  pages: {
    dashboard: { label: 'Channel Analytics', enabled: true, premiumOnly: false, freeLimit: 10, proLimit: 100 },
    videos: { label: 'Videos', enabled: true, premiumOnly: false, freeLimit: 20, proLimit: 200 },
    channel: { label: 'Channel', enabled: true, premiumOnly: false, freeLimit: 10, proLimit: 200 },
    playlists: { label: 'Playlists', enabled: true, premiumOnly: false, freeLimit: 10, proLimit: 200 },
    compare: { label: 'Compare', enabled: true, premiumOnly: false, freeLimit: 5, proLimit: 100 },
    specificVideos: { label: 'Specific Videos', enabled: true, premiumOnly: false, freeLimit: 10, proLimit: 200 },
    thumbnailOptimizer: { label: 'Thumbnail Optimizer', enabled: true, premiumOnly: false, freeLimit: 5, proLimit: 100 },
    playlistOptimizer: { label: 'Playlist Optimizer', enabled: true, premiumOnly: false, freeLimit: 5, proLimit: 100 },
    audit: { label: 'Audit', enabled: true, premiumOnly: false, freeLimit: 5, proLimit: 100 },
    auditVideos: { label: 'Channel Audit Videos', enabled: true, premiumOnly: false, freeLimit: 15, proLimit: 30 },
    videoAudit: { label: 'Video Audit', enabled: true, premiumOnly: false, freeLimit: 5, proLimit: 100 },
    goals: { label: 'Goals & Pacing', enabled: true, premiumOnly: false, freeLimit: -1, proLimit: -1 },
    anomalies: { label: 'Anomalies', enabled: true, premiumOnly: false, freeLimit: 20, proLimit: 500 },
    customDashboard: { label: 'My Dashboard', enabled: true, premiumOnly: false, freeLimit: -1, proLimit: -1 },
    optimized: { label: 'Optimized Content', enabled: true, premiumOnly: false, freeLimit: -1, proLimit: -1 },
    captions: { label: 'Captions / Transcripts', enabled: false, premiumOnly: false, freeLimit: 20, proLimit: 200 },
  },
};

const readCachedFeatureConfigMeta = (): { config: FeatureConfig; cachedAt: number } | null => {
  try {
    const raw = localStorage.getItem(FEATURE_CONFIG_CACHE_KEY);
    if (!raw) return null;
    const parsed = featureConfigCachePayloadSchema.safeParse(JSON.parse(raw) as unknown);
    if (!parsed.success) return null;
    if (Date.now() - parsed.data.cachedAt > FEATURE_CONFIG_CACHE_TTL_MS) return null;
    return { config: parsed.data.config, cachedAt: parsed.data.cachedAt };
  } catch {
    return null;
  }
};

const writeCachedFeatureConfig = (config: FeatureConfig) => {
  try {
    const payload = { config, cachedAt: Date.now() };
    localStorage.setItem(FEATURE_CONFIG_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage failures
  }
};

async function fetchFeatureConfig(): Promise<FeatureConfig> {
  try {
    const res = await fetch(apiUrl('/admin/config'), { cache: 'no-store' });
    if (!res.ok) {
      return readCachedFeatureConfigMeta()?.config ?? DEFAULT_CONFIG;
    }
    const raw: unknown = await res.json();
    const parsed = featureConfigSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn('[FeatureConfig] API response invalid, using defaults', parsed.error.flatten());
      return DEFAULT_CONFIG;
    }
    writeCachedFeatureConfig(parsed.data);
    return parsed.data;
  } catch {
    return readCachedFeatureConfigMeta()?.config ?? DEFAULT_CONFIG;
  }
}

export const FeatureConfigProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const queryClient = useQueryClient();
  const cachedMeta = readCachedFeatureConfigMeta();

  const query = useQuery({
    queryKey: ['feature-config'],
    queryFn: fetchFeatureConfig,
    staleTime: 60_000,
    gcTime: FEATURE_CONFIG_CACHE_TTL_MS * 2,
    refetchInterval: 60_000,
    // Feature flags are broadcast config: an admin save must reach other
    // sessions promptly. The global client disables focus refetch, so opt back
    // in here (plus always revalidate on mount) — otherwise a background tab
    // can sit on stale flags indefinitely and it looks like the backend never
    // invalidated its cache. The localStorage snapshot stays as instant paint.
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    initialData: cachedMeta?.config,
    initialDataUpdatedAt: cachedMeta?.cachedAt,
    retry: 1,
  });

  const config = query.data ?? DEFAULT_CONFIG;
  const auditScoring: AuditScoring = config.auditScoring ?? DEFAULT_AUDIT_SCORING;
  const loading = query.isLoading;

  const refreshConfig = useCallback(async () => {
    await queryClient.refetchQueries({ queryKey: ['feature-config'] });
  }, [queryClient]);

  const isPagePremiumOnly = useCallback(
    (page: string) => config.pages[page]?.premiumOnly ?? false,
    [config.pages],
  );

  const isPageEnabled = useCallback(
    (page: string) => config.pages[page]?.enabled ?? true,
    [config.pages],
  );

  const getSearchLimit = useCallback(
    (page: string, userPackage: 'free' | 'pro') => {
      const p = config.pages[page];
      if (!p) return -1;
      return userPackage === 'pro' ? p.proLimit : p.freeLimit;
    },
    [config.pages],
  );

  return (
    <FeatureConfigContext.Provider
      value={{ config, auditScoring, loading, isPagePremiumOnly, isPageEnabled, getSearchLimit, refreshConfig }}
    >
      {children}
    </FeatureConfigContext.Provider>
  );
};
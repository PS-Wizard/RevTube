import { useContext, createContext } from 'react';
import type { AuditScoring, FeatureConfig } from '../utils/featureConfigSchema';

export interface FeatureConfigContextValue {
  config: FeatureConfig;
  auditScoring: AuditScoring;
  loading: boolean;
  isPagePremiumOnly: (page: string) => boolean;
  isPageEnabled: (page: string) => boolean;
  getSearchLimit: (page: string, userPackage: 'free' | 'pro') => number;
  refreshConfig: () => Promise<void>;
}

export const FeatureConfigContext = createContext<FeatureConfigContextValue | null>(null);

export const useFeatureConfig = () => {
  const ctx = useContext(FeatureConfigContext);
  if (!ctx) throw new Error('useFeatureConfig must be used inside FeatureConfigProvider');
  return ctx;
};

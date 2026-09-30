import { useQuery } from '@tanstack/react-query';
import {
  getOrgAnalytics,
  type OrgAnalyticsPeriod,
  type OrgAnalyticsCustomRange,
} from '../../services/organizationService';

/**
 * Org-wide analytics (cross-channel comparison) via TanStack Query.
 * Data is read-model based and cached server-side for 30 minutes,
 * so a short client staleTime is fine.
 */
export const useOrgAnalyticsQuery = (
  orgId: string | null,
  period: OrgAnalyticsPeriod,
  customRange?: OrgAnalyticsCustomRange
) =>
  useQuery({
    queryKey: [
      'org-analytics',
      orgId,
      period,
      period === 'custom' ? customRange?.start ?? '' : '',
      period === 'custom' ? customRange?.end ?? '' : '',
    ],
    queryFn: () =>
      getOrgAnalytics(
        orgId as string,
        period,
        period === 'custom' ? customRange : undefined
      ),
    enabled: !!orgId && (period !== 'custom' || (!!customRange?.start && !!customRange?.end)),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

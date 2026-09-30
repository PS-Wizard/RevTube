import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { getFirebaseAuthHeader } from '../services/authHeaders';
import { getResolvedApiBaseUrl } from '../utils/apiBase';

export interface MonthlyUsage {
    [pageKey: string]: number;
}

export interface MonthlyLimits {
    [pageKey: string]: number;
}

export interface UsageData {
    usage: MonthlyUsage;
    month: string;
    limits?: MonthlyLimits;
}

export const USAGE_QUERY_KEY = 'usage:me';

export function useUsage() {
    const { user } = useAuth();
    const baseUrl = getResolvedApiBaseUrl();
    const queryClient = useQueryClient();

    const query = useQuery<UsageData>({
        queryKey: [USAGE_QUERY_KEY, user?.email],
        queryFn: async () => {
            const res = await fetch(`${baseUrl}/usage/me`, {
                headers: await getFirebaseAuthHeader(),
                cache: 'no-store',
            });
            if (!res.ok) throw new Error('Failed to fetch usage');
            return res.json();
        },
        enabled: !!user?.email,
        staleTime: 10 * 1000,      // 10 s -- considered fresh for 10 s after fetch
        gcTime: 5 * 60 * 1000,
        refetchOnWindowFocus: true,
        refetchOnMount: true,
        retry: 1,
    });

    /** Immediately invalidate the usage query so the sidebar bar reflects the
     *  latest counter after a page search completes. Call this after any
     *  successful fetch on Videos, Channel, or Playlist pages. */
    const invalidateUsage = () => {
        void queryClient.invalidateQueries({ queryKey: [USAGE_QUERY_KEY, user?.email] });
    };

    return {
        usageData: query.data ?? { usage: {}, month: '' },
        usageLimits: query.data?.limits,
        loading: query.isLoading,
        refetchUsage: query.refetch,
        invalidateUsage,
    };
}

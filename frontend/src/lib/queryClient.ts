/**
 * React Query Configuration
 * Centralized data fetching and caching setup
 */

import { QueryClient, QueryCache } from '@tanstack/react-query';
import toast from 'react-hot-toast';

function formatQueryError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (query.meta?.suppressGlobalErrorToast) return;
      toast.error(formatQueryError(error));
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      retry: (failureCount, err) => {
        if (failureCount >= 2) return false;
        const msg = err instanceof Error ? err.message : '';
        if (/401|403|404|Usage limit/i.test(msg)) return false;
        return true;
      },
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,
    },
  },
});

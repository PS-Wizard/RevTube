// ─────────────────────────────────────────────────────────────────────────────
// Playlist Optimization -- TanStack Query mutation
// ─────────────────────────────────────────────────────────────────────────────
import { useMutation } from '@tanstack/react-query';
import { PlaylistOptimizerService } from '../../services/playlistOptimizerService';
import type { AnalysisResult, AnalyzeRequest } from '../../types/playlistOptimizer';

export interface AnalyzeResponseData {
  results: AnalysisResult;
}

interface UsePlaylistOptimizationOptions {
  onSuccess?: (data: AnalyzeResponseData) => void;
  onError?: (error: Error) => void;
}

export function usePlaylistOptimization({ onSuccess, onError }: UsePlaylistOptimizationOptions = {}) {
  return useMutation({
    mutationFn: ({ orgId, ...params }: AnalyzeRequest & { orgId?: string }) =>
      PlaylistOptimizerService.analyze(params as AnalyzeRequest, orgId),
    onSuccess: (data) => onSuccess?.({ results: data.results }),
    onError,
    retry: 0,
    meta: { suppressGlobalErrorToast: true },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Thumbnail Audit -- TanStack Query mutation
// ─────────────────────────────────────────────────────────────────────────────
import { useMutation } from '@tanstack/react-query';
import { ThumbnailOptimizerService } from '../../services/thumbnailOptimizerService';
import type { ThumbnailAudit, AuditRequest } from '../../types/thumbnailOptimizer';

export interface AuditResponseData {
  results: ThumbnailAudit[];
  errors?: Array<{ url: string; error: string }>;
}

interface UseThumbnailAuditOptions {
  onSuccess?: (data: AuditResponseData) => void;
  onError?: (error: Error) => void;
}

export function useThumbnailAudit({ onSuccess, onError }: UseThumbnailAuditOptions = {}) {
  return useMutation({
    mutationFn: ({ orgId, ...params }: AuditRequest & { orgId?: string }) =>
      ThumbnailOptimizerService.analyze(params as AuditRequest, orgId),
    onSuccess: (data) => onSuccess?.({ results: data.results, errors: data.errors }),
    onError,
    retry: 0,
    meta: { suppressGlobalErrorToast: true },
  });
}

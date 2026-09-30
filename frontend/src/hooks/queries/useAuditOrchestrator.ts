// ─────────────────────────────────────────────────────────────────────────────
// Centralized Audit Orchestrator hooks -- enqueue + poll job status.
// ─────────────────────────────────────────────────────────────────────────────
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  getAuditOrchestratorJobStatus,
  rerunAuditOrchestrator,
  runAuditOrchestrator,
  type AuditOrchestratorEnqueueResponse,
  type AuditOrchestratorJobStatus,
  type AuditOrchestratorVideoSelection,
} from '../../services/auditOrchestratorService';

interface UseAuditOrchestratorOptions {
  onSuccess?: (data: AuditOrchestratorEnqueueResponse) => void;
  onError?: (error: Error) => void;
}

export function useAuditOrchestrator({ onSuccess, onError }: UseAuditOrchestratorOptions = {}) {
  return useMutation({
    mutationFn: (payload: { channelId: string; includeThumbnailAI?: boolean; orgId?: string; scope?: 'full' | 'channel'; videoSelection?: AuditOrchestratorVideoSelection }) =>
      runAuditOrchestrator(payload.channelId, { includeThumbnailAI: payload.includeThumbnailAI, orgId: payload.orgId, scope: payload.scope, videoSelection: payload.videoSelection }),
    onSuccess,
    onError,
    retry: 0,
    meta: { suppressGlobalErrorToast: true },
  });
}

export function useAuditOrchestratorJobStatus(jobId: string | null, enabled: boolean = true) {
  return useQuery<AuditOrchestratorJobStatus>({
    queryKey: ['audit-orchestrator-job', jobId],
    queryFn: () => getAuditOrchestratorJobStatus(jobId!),
    enabled: enabled && !!jobId,
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      return state === 'waiting' || state === 'active' || state === 'delayed' ? 3000 : false;
    },
    retry: 0,
  });
}

export function useAuditOrchestratorRerun({ onSuccess, onError }: UseAuditOrchestratorOptions = {}) {
  return useMutation({
    mutationFn: (payload: { runId: number; includeThumbnailAI?: boolean; orgId?: string }) =>
      rerunAuditOrchestrator(payload.runId, { includeThumbnailAI: payload.includeThumbnailAI, orgId: payload.orgId }),
    onSuccess,
    onError,
    retry: 0,
    meta: { suppressGlobalErrorToast: true },
  });
}

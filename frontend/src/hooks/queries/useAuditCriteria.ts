// ─────────────────────────────────────────────────────────────────────────────
// useAuditCriteria -- TanStack Query hook for the Full Audit scoring criteria
// (read-only description served by GET /audit-orchestrator/criteria).
// ─────────────────────────────────────────────────────────────────────────────
import { useQuery } from '@tanstack/react-query';
import { getAuditOrchestratorCriteria, type AuditCriteria } from '../../services/auditOrchestratorService';

export function useAuditCriteria(enabled = true) {
  return useQuery<AuditCriteria>({
    queryKey: ['audit-criteria'],
    queryFn: () => getAuditOrchestratorCriteria(),
    enabled,
    // Criteria are admin-editable: always refresh when the help dialog opens
    // so changes made in the admin panel show up immediately.
    staleTime: 0,
    refetchOnMount: 'always',
    retry: 0,
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  explainAnomaly,
  getAnomalies,
  getAnomaly,
  getAnomalyMetrics,
  getAnomalySeries,
  scanAnomalies,
  setAnomalyStatus,
} from '../../services/anomalyService';
import { useOrganization } from '../../hooks/useOrganization';
import type { AnomalyFilters, AnomalyStatus } from '../../types/anomaly';

const ROOT = 'anomalies';

export function useAnomalyMetricsQuery() {
  const { currentOrganization, isPersonalContext } = useOrganization();
  const orgId = isPersonalContext ? null : (currentOrganization?.id ?? null);
  return useQuery({
    queryKey: [ROOT, 'metrics', orgId ?? 'personal'],
    queryFn: () => getAnomalyMetrics(orgId),
    staleTime: 10 * 60 * 1000,
  });
}

export function useAnomaliesQuery(filters: AnomalyFilters, limit: number, offset: number) {
  const { currentOrganization, isPersonalContext } = useOrganization();
  const orgId = isPersonalContext ? null : (currentOrganization?.id ?? null);
  return useQuery({
    queryKey: [ROOT, 'list', orgId ?? 'personal', filters, limit, offset],
    queryFn: () => getAnomalies(filters, limit, offset, orgId),
    staleTime: 60 * 1000,
  });
}

export function useAnomalyDetailQuery(id: number | null) {
  const { currentOrganization, isPersonalContext } = useOrganization();
  const orgId = isPersonalContext ? null : (currentOrganization?.id ?? null);
  return useQuery({
    queryKey: [ROOT, 'detail', orgId ?? 'personal', id],
    queryFn: () => getAnomaly(id as number, orgId),
    enabled: id !== null && Number.isInteger(id) && (id as number) > 0,
    staleTime: 60 * 1000,
  });
}

export function useAnomalySeriesQuery(channelId: string | null, metric: string | null, days = 60) {
  const { currentOrganization, isPersonalContext } = useOrganization();
  const orgId = isPersonalContext ? null : (currentOrganization?.id ?? null);
  return useQuery({
    queryKey: [ROOT, 'series', orgId ?? 'personal', channelId, metric, days],
    queryFn: () => getAnomalySeries(channelId as string, metric as string, days, orgId),
    enabled: !!channelId && !!metric,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSetAnomalyStatus() {
  const queryClient = useQueryClient();
  const { currentOrganization, isPersonalContext } = useOrganization();
  const orgId = isPersonalContext ? null : (currentOrganization?.id ?? null);
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: AnomalyStatus }) =>
      setAnomalyStatus(id, status, orgId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [ROOT] });
    },
  });
}

export function useScanAnomalies() {
  const queryClient = useQueryClient();
  const { currentOrganization, isPersonalContext } = useOrganization();
  const orgId = isPersonalContext ? null : (currentOrganization?.id ?? null);
  return useMutation({
    mutationFn: (channelId: string) => scanAnomalies(channelId, orgId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [ROOT] });
    },
  });
}

export function useExplainAnomaly() {
  const queryClient = useQueryClient();
  const { currentOrganization, isPersonalContext } = useOrganization();
  const orgId = isPersonalContext ? null : (currentOrganization?.id ?? null);
  return useMutation({
    mutationFn: ({ id, refresh }: { id: number; refresh?: boolean }) =>
      explainAnomaly(id, refresh, orgId),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: [ROOT, 'detail', orgId ?? 'personal', vars.id] });
      void queryClient.invalidateQueries({ queryKey: [ROOT, 'list'] });
    },
  });
}

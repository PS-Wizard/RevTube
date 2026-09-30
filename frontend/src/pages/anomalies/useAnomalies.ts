import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  useAnomaliesQuery,
  useAnomalyDetailQuery,
  useAnomalyMetricsQuery,
  useAnomalySeriesQuery,
  useExplainAnomaly,
  useScanAnomalies,
  useSetAnomalyStatus,
} from '../../hooks/queries/useAnomaliesQuery';
import { toast } from 'react-hot-toast';
import type {
  AnomalyFilters,
  AnomalyKind,
  AnomalySeverity,
  AnomalyStatus,
} from '../../types/anomaly';

const DEFAULT_PAGE_SIZE = 10;

export const DEFAULT_ANOMALY_STATUSES: AnomalyStatus[] = ['open', 'acknowledged'];

function isDefaultStatuses(statuses: AnomalyStatus[]): boolean {
  return (
    statuses.length === DEFAULT_ANOMALY_STATUSES.length &&
    DEFAULT_ANOMALY_STATUSES.every((s) => statuses.includes(s))
  );
}

function readStoredChannel(): string | null {
  try {
    return localStorage.getItem('selectedChannel_last');
  } catch {
    return null;
  }
}

export function useAnomalies() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [channelId, setChannelId] = useState<string | null>(readStoredChannel);
  const [metrics, setMetrics] = useState<string[]>([]);
  const [kinds, setKinds] = useState<AnomalyKind[]>([]);
  const [severities, setSeverities] = useState<AnomalySeverity[]>([]);
  const [statuses, setStatuses] = useState<AnomalyStatus[]>([...DEFAULT_ANOMALY_STATUSES]);
  const [offset, setOffset] = useState(0);
  const [pageSize, setPageSizeState] = useState(DEFAULT_PAGE_SIZE);
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const raw = searchParams.get('id');
    const n = raw ? Number(raw) : NaN;
    return Number.isInteger(n) && n > 0 ? n : null;
  });

  useEffect(() => {
    const handleChannelChange = () => {
      setChannelId(readStoredChannel());
      setOffset(0);
    };
    window.addEventListener('channelChanged', handleChannelChange);
    return () => window.removeEventListener('channelChanged', handleChannelChange);
  }, []);

  /** Filter setters also rewind pagination so the first page stays in view. */
  const applyFilter = useCallback(<T,>(setter: (value: T) => void, value: T) => {
    setter(value);
    setOffset(0);
  }, []);

  const setPageSize = useCallback((size: number) => {
    setPageSizeState(size);
    setOffset(0);
  }, []);

  const setPage = useCallback(
    (page: number) => {
      setOffset((page - 1) * pageSize);
    },
    [pageSize],
  );

  const filters: AnomalyFilters = useMemo(
    () => ({
      ...(channelId ? { channelId } : {}),
      ...(metrics.length ? { metrics } : {}),
      ...(kinds.length ? { kinds } : {}),
      ...(severities.length ? { severities } : {}),
      ...(statuses.length ? { statuses } : {}),
    }),
    [channelId, metrics, kinds, severities, statuses],
  );

  const metricsQuery = useAnomalyMetricsQuery();
  const listQuery = useAnomaliesQuery(filters, pageSize, offset);
  const detailQuery = useAnomalyDetailQuery(selectedId);

  const detail = detailQuery.data ?? null;
  const seriesQuery = useAnomalySeriesQuery(
    detail?.channelId ?? channelId,
    detail?.metric ?? null,
    60,
  );

  const statusMutation = useSetAnomalyStatus();
  const scanMutation = useScanAnomalies();
  const explainMutation = useExplainAnomaly();

  const selectAnomaly = useCallback(
    (id: number | null) => {
      setSelectedId(id);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (id) next.set('id', String(id));
        else next.delete('id');
        return next;
      }, { replace: true });
    },
    [setSearchParams],
  );

  const setStatus = useCallback(
    async (id: number, status: AnomalyStatus) => {
      try {
        await statusMutation.mutateAsync({ id, status });
        toast.success(status === 'dismissed' ? 'Anomaly dismissed' : `Marked as ${status}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update status');
      }
    },
    [statusMutation],
  );

  const scan = useCallback(async () => {
    if (!channelId) {
      toast.error('Select a channel first');
      return;
    }
    try {
      const result = await scanMutation.mutateAsync(channelId);
      if (result.scanned) toast.success(`Scan complete — ${result.total} anomalies`);
      else toast(result.reason ?? 'Scan skipped');
      await listQuery.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Scan failed');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, scanMutation]);

  const explain = useCallback(
    async (id: number, refresh = false) => {
      try {
        await explainMutation.mutateAsync({ id, refresh });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'AI explanation failed');
      }
    },
    [explainMutation],
  );

  const items = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;
  const counts = listQuery.data?.counts ?? { total: 0, critical: 0, high: 0, open: 0 };

  const hasActiveFilters =
    metrics.length > 0 ||
    kinds.length > 0 ||
    severities.length > 0 ||
    !isDefaultStatuses(statuses);

  const resetFilters = useCallback(() => {
    setMetrics([]);
    setKinds([]);
    setSeverities([]);
    setStatuses([...DEFAULT_ANOMALY_STATUSES]);
    setOffset(0);
  }, []);

  return {
    channelId,
    metrics,
    setMetrics: (v: string[]) => applyFilter(setMetrics, v),
    kinds,
    setKinds: (v: AnomalyKind[]) => applyFilter(setKinds, v),
    severities,
    setSeverities: (v: AnomalySeverity[]) => applyFilter(setSeverities, v),
    statuses,
    setStatuses: (v: AnomalyStatus[]) => applyFilter(setStatuses, v),
    hasActiveFilters,
    resetFilters,
    offset,
    setOffset,
    page: Math.floor(offset / pageSize) + 1,
    totalPages: Math.max(1, Math.ceil((listQuery.data?.total ?? 0) / pageSize)),
    setPage,
    pageSize,
    setPageSize,
    viewMode,
    setViewMode,
    total,
    counts,
    items,
    listQuery,
    metricsQuery,
    selectedId,
    selectAnomaly,
    detail,
    detailQuery,
    seriesQuery,
    setStatus,
    statusPending: statusMutation.isPending,
    scan,
    scanPending: scanMutation.isPending,
    explain,
    explainPending: explainMutation.isPending,
  };
}

export type UseAnomalies = ReturnType<typeof useAnomalies>;

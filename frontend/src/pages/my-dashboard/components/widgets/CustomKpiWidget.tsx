import React from 'react';
import type { Dayjs } from 'dayjs';
import { Button, Flex, Spinner, StatCard, Typography } from '@/components/ui';
import { useChannelTabQuery } from '@/hooks/queries/useChannelTabQuery';
import { useDashboardStore } from '@/stores/dashboardStore';
import { useCustomCardsStore, selectCustomCards } from '@/stores/customCardsStore';
import { useDashboardScope } from '../../useCustomDashboard';
import {
  calcMetricDeltaPct,
  formatCustomCardValue,
  windowKeyForPeriod,
} from '../../customKpiUtils';

interface CustomKpiWidgetProps {
  cardId: string;
  channelId: string | null;
  period: number | null;
  customStartDate: Dayjs | null;
  customEndDate: Dayjs | null;
  getEffectiveToken: (channelId: string) => Promise<string | null>;
}

/** Metrics where a downward move is good news (delta colors flip). */
const INVERTED_METRICS = new Set(['subscribersLost']);

/**
 * User-built KPI card. Fires the channel tab query with the same arguments
 * the Channel widget uses, so the TanStack cache is shared — no extra quota
 * when both are visible, one unit when this is the only channel-data
 * consumer. Renders nothing when its definition is gone (the grid then
 * drops the id via the cells filter).
 */
export function CustomKpiWidget({
  cardId,
  channelId,
  period,
  customStartDate,
  customEndDate,
  getEffectiveToken,
}: CustomKpiWidgetProps): React.ReactElement | null {
  const scope = useDashboardScope();
  const cardsByScope = useCustomCardsStore((s) => s.cardsByScope);
  const def = selectCustomCards(cardsByScope, scope).find((d) => d.id === cardId) ?? null;

  const channelQuery = useChannelTabQuery({
    channelId,
    period,
    customStartDate,
    customEndDate,
    getEffectiveToken,
    enabled: !!channelId && !!def,
  });
  const multiPeriodStats = useDashboardStore((s) => s.analytics.channelMultiPeriodStats) as unknown as Record<
    string,
    { current?: Record<string, number>; previous?: Record<string, number> }
  > | null;

  const window = def ? windowKeyForPeriod(def.period) : 'd30';
  const current = def ? (multiPeriodStats?.[window]?.current?.[def.metric] ?? null) : null;
  const previous = def ? (multiPeriodStats?.[window]?.previous?.[def.metric] ?? null) : null;
  const delta = current !== null && previous !== null ? calcMetricDeltaPct(current, previous) : null;

  if (!def) return null;

  if (channelQuery.error && current === null) {
    return (
      <Flex gap={1} alignItems="center" sx={{ minWidth: 0 }}>
        <Typography variant="caption" noWrap sx={{ minWidth: 0, flex: 1 }}>
          Couldn&apos;t load this card.
        </Typography>
        <Button size="sm" variant="outline" onClick={() => channelQuery.refetch()}>
          <span>Retry</span>
        </Button>
      </Flex>
    );
  }

  const inverted = INVERTED_METRICS.has(def.metric);
  const good = delta !== null && (inverted ? delta < 0 : delta > 0);
  const bad = delta !== null && (inverted ? delta > 0 : delta < 0);
  const tone = good ? 'success' : bad ? 'destructive' : 'neutral';
  const deltaColor = good
    ? 'text-[var(--rt-color-success)]'
    : bad
      ? 'text-[var(--rt-color-danger)]'
      : 'text-[var(--rt-color-text-secondary)]';

  const loading = current === null && channelQuery.isLoading;

  return (
    <StatCard
      tone={tone}
      label={<span title={`${def.label} · last ${def.period}d vs prior`}>{def.label}</span>}
      value={
        loading ? (
          <Spinner size="xs" />
        ) : (
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <span>{formatCustomCardValue(def.metric, current)}</span>
            <span className={`text-xs font-semibold tabular-nums ${deltaColor}`}>
              {delta === null
                ? '—'
                : `${delta > 0 ? '↑' : delta < 0 ? '↓' : ''} ${Math.abs(delta).toFixed(1)}%`}
            </span>
          </span>
        )
      }
    />
  );
}

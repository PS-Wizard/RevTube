import React from 'react';
import { MdAutoAwesome, MdShowChart, MdTrendingDown, MdTrendingUp } from 'react-icons/md';
import { Avatar, Box, Flex, Stack, Typography } from '@/components/ui';
import { EmptyState } from '@/components/EmptyState';
import type { Anomaly } from '../../../types/anomaly';
import { SEVERITY_LABELS, anomalyHeadline, formatDayLabel, formatDeltaPct, formatSigned } from '../anomaliesUtils';

function KindIcon({ kind }: { kind: Anomaly['kind'] }): React.ReactElement {
  if (kind === 'spike') return <MdTrendingUp size={18} aria-hidden />;
  if (kind === 'dip') return <MdTrendingDown size={18} aria-hidden />;
  return <MdShowChart size={18} aria-hidden />;
}

function deltaColor(delta: number): string {
  return delta > 0 ? 'var(--rt-color-success)' : 'var(--rt-color-danger)';
}

const cardSx = (selected: boolean): Record<string, unknown> => ({
  width: '100%',
  textAlign: 'left',
  cursor: 'pointer',
  border: selected ? '1px solid var(--rt-color-accent)' : '1px solid var(--rt-table-header-border)',
  borderRadius: 12,
  backgroundColor: selected ? 'var(--rt-color-accent-bg)' : 'var(--rt-color-bg-highlight)',
  padding: 12,
});

export function AnomalyRow({
  anomaly,
  selected,
  onSelect,
}: {
  anomaly: Anomaly;
  selected: boolean;
  onSelect: () => void;
}): React.ReactElement {
  const drivers = anomaly.evidence?.drivers ?? [];
  const top = drivers[0];
  const extra = drivers.length > 1 ? drivers.length - 1 : 0;

  return (
    <Box component="button" type="button" onClick={onSelect} aria-current={selected} sx={cardSx(selected)}>
      <Stack gap={1}>
        <Flex gap={1}>
          <Box sx={{ flexShrink: 0, color: 'var(--rt-color-accent)' }}>
            <KindIcon kind={anomaly.kind} />
          </Box>
          <Box sx={{ minWidth: 0, flexGrow: 1 }}>
            <Typography variant="body2" noWrap sx={{ fontWeight: 600 }} title={anomalyHeadline(anomaly)}>
              {anomalyHeadline(anomaly)}
            </Typography>
            <Typography variant="caption" noWrap>
              {formatDayLabel(anomaly.anomalyDate)}
              {anomaly.endDate && anomaly.endDate !== anomaly.anomalyDate ? ` → ${formatDayLabel(anomaly.endDate)}` : ''}
              {' · '}Expected {anomaly.baseline.toLocaleString()} {anomaly.metricUnit} · Actual {anomaly.actual.toLocaleString()}
            </Typography>
          </Box>
          <Flex gap={0.5} sx={{ flexShrink: 0 }}>
            <Box component="span" sx={{ fontSize: 11, fontWeight: 700, color: 'var(--rt-color-text-secondary)' }}>
              {SEVERITY_LABELS[anomaly.severity]}
            </Box>
          </Flex>
        </Flex>

        <Flex gap={1.5} sx={{ flexWrap: 'wrap' }}>
          <Typography variant="body2" sx={{ fontWeight: 700, color: deltaColor(anomaly.delta) }}>
            {formatSigned(anomaly.delta, anomaly.metricUnit)} ({formatDeltaPct(anomaly.deltaPct)})
          </Typography>
          {anomaly.explanation && (
            <Flex gap={0.5}>
              <MdAutoAwesome size={13} aria-hidden />
              <Typography variant="caption">AI explained</Typography>
            </Flex>
          )}
          {anomaly.evidence?.summary && (
            <Typography variant="caption" noWrap sx={{ minWidth: 0, flexGrow: 1, flexBasis: 160 }} title={anomaly.evidence.summary}>
              {anomaly.evidence.summary}
            </Typography>
          )}
        </Flex>

        {top && (
          <Flex gap={1}>
            <Avatar src={top.thumbnail ?? undefined} alt="" size="sm" />
            <Typography variant="caption" noWrap sx={{ minWidth: 0, flexGrow: 1 }} title={top.title}>
              Top driver: {top.title} ({formatSigned(top.deltaViews, 'views')})
            </Typography>
            {extra > 0 && (
              <Typography variant="caption" sx={{ flexShrink: 0 }}>+{extra} more</Typography>
            )}
          </Flex>
        )}
      </Stack>
    </Box>
  );
}

export function AnomalyList({
  items,
  loading,
  error,
  selectedId,
  onSelect,
  onRetry,
  layout = 'list',
}: {
  items: Anomaly[];
  loading: boolean;
  error: unknown;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onRetry: () => void;
  /** 'list' stacks full-width rows; 'grid' renders a responsive 2-up card grid. */
  layout?: 'list' | 'grid';
}): React.ReactElement {
  if (loading) {
    const skeletons = [0, 1, 2, 3];
    if (layout === 'grid') {
      return (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
            gap: 1.5,
          }}
          aria-hidden
        >
          {skeletons.map((i) => (
            <Box key={i} sx={{ height: 120, borderRadius: 12, backgroundColor: 'var(--rt-color-bg-subtle)' }} />
          ))}
        </Box>
      );
    }
    return (
      <Stack gap={1}>
        {[0, 1, 2].map((i) => (
          <Box key={i} sx={{ height: 96, borderRadius: 12, backgroundColor: 'var(--rt-color-bg-subtle)' }} aria-hidden />
        ))}
      </Stack>
    );
  }
  if (error) {
    return (
      <EmptyState
        variant="error"
        title="Couldn't load anomalies"
        description={error instanceof Error ? error.message : 'Something went wrong.'}
        action={<button type="button" onClick={onRetry}>Try again</button>}
      />
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        variant="zero"
        title="No anomalies found"
        description="No spikes, dips or trends match these filters yet. Anomalies are detected automatically after each data sync — or run a scan now."
      />
    );
  }
  if (layout === 'grid') {
    return (
      <Box
        role="list"
        aria-label="Anomalies, newest first"
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' },
          gap: 1.5,
        }}
      >
        {items.map((a) => (
          <Box key={a.id} role="listitem" sx={{ minWidth: 0 }}>
            <AnomalyRow anomaly={a} selected={a.id === selectedId} onSelect={() => onSelect(a.id)} />
          </Box>
        ))}
      </Box>
    );
  }
  return (
    <Stack gap={1} role="list" aria-label="Anomalies, newest first">
      {items.map((a) => (
        <Box key={a.id} role="listitem" sx={{ minWidth: 0 }}>
          <AnomalyRow anomaly={a} selected={a.id === selectedId} onSelect={() => onSelect(a.id)} />
        </Box>
      ))}
    </Stack>
  );
}

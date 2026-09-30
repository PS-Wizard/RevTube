import React, { useMemo } from 'react';
import { Avatar, Box, Flex, Stack, Typography } from '@/components/ui';
import { RtECharts, type EChartsCoreOption } from '@/components/charts/RtECharts';
import type { Anomaly, AnomalySeriesResult } from '../../../types/anomaly';
import { formatCompact, formatDayLabel } from '../anomaliesUtils';

const sectionSx = {
  border: '1px solid var(--rt-table-header-border)',
  borderRadius: 12,
  backgroundColor: 'var(--rt-color-bg-highlight)',
  padding: 12,
};

export function AnomalyDetailChart({
  anomaly,
  series,
  loading,
}: {
  anomaly: Anomaly;
  series: AnomalySeriesResult | undefined;
  loading: boolean;
}): React.ReactElement {
  const option = useMemo<EChartsCoreOption>(() => {
    const points = series?.points ?? [];
    const dates = points.map((pt) => pt.date);
    return {
      tooltip: {
        trigger: 'axis',
        formatter: (params: unknown) => {
          const arr = Array.isArray(params) ? params : [params];
          const idx = (arr[0] as { dataIndex?: number })?.dataIndex ?? 0;
          const pt = points[idx];
          if (!pt) return '';
          const lines = [
            `<strong>${formatDayLabel(pt.date)}</strong>`,
            `Actual: ${formatCompact(pt.value, anomaly.metricUnit)}`,
          ];
          if (pt.expected !== null) lines.push(`Expected: ${formatCompact(pt.expected, anomaly.metricUnit)}`);
          if (pt.isAnomaly) lines.push('Anomaly');
          return lines.join('<br/>');
        },
      },
      grid: { left: 48, right: 16, top: 24, bottom: 28 },
      xAxis: { type: 'category', data: dates, axisLabel: { hideOverlap: true } },
      yAxis: { type: 'value' },
      series: [
        {
          name: 'Expected',
          type: 'line',
          data: points.map((pt) => pt.expected),
          showSymbol: false,
          lineStyle: { type: 'dashed', opacity: 0.7 },
        },
        {
          name: 'Actual',
          type: 'line',
          data: points.map((pt) => pt.value),
          showSymbol: false,
          smooth: true,
          markPoint: {
            symbolSize: 34,
            data: points
              .map((pt, i) => ({ pt, i }))
              .filter(({ pt }) => pt.isAnomaly)
              .map(({ pt, i }) => ({ coord: [i, pt.value], value: '!' })),
          },
        },
      ],
    } as EChartsCoreOption;
  }, [series, anomaly]);

  return (
    <Box sx={sectionSx}>
      <Stack gap={1}>
        <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase' }}>
          {anomaly.metricLabel} · ±30 days around {formatDayLabel(anomaly.anomalyDate)}
        </Typography>
        <RtECharts
          option={option}
          height={260}
          loading={loading}
          empty={!loading && (series?.points.length ?? 0) === 0}
        />
      </Stack>
    </Box>
  );
}

export function AnomalyDrivers({ anomaly }: { anomaly: Anomaly }): React.ReactElement | null {
  const drivers = anomaly.evidence?.drivers ?? [];
  if (!drivers.length) return null;
  return (
    <Box sx={sectionSx}>
      <Stack gap={1}>
        <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase' }}>
          Videos that drove it
        </Typography>
        {drivers.map((drv) => (
          <Flex key={drv.videoId} gap={1}>
            <Avatar src={drv.thumbnail ?? undefined} alt="" size="sm" />
            <Box sx={{ minWidth: 0, flexGrow: 1 }}>
              <Typography variant="body2" noWrap sx={{ fontWeight: 600 }} title={drv.title}>
                {drv.title}
              </Typography>
              <Typography variant="caption">
                {drv.sharePct !== null && `${Math.round(drv.sharePct * 100)}% of the day's move`}
              </Typography>
            </Box>
            <Typography
              variant="body2"
              sx={{ fontWeight: 700, flexShrink: 0, color: drv.deltaViews >= 0 ? 'var(--rt-color-success)' : 'var(--rt-color-danger)' }}
            >
              {drv.deltaViews >= 0 ? '+' : ''}{formatCompact(drv.deltaViews, 'views')}
            </Typography>
          </Flex>
        ))}
      </Stack>
    </Box>
  );
}

export function AnomalySignals({ anomaly }: { anomaly: Anomaly }): React.ReactElement | null {
  const signals = anomaly.evidence?.signals ?? [];
  if (!signals.length) return null;
  return (
    <Box sx={sectionSx}>
      <Stack gap={0.75}>
        <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase' }}>
          Supporting evidence
        </Typography>
        {signals.map((s, i) => (
          <Typography key={i} variant="body2">
            • <strong>{s.signal}:</strong> {s.detail}
          </Typography>
        ))}
      </Stack>
    </Box>
  );
}

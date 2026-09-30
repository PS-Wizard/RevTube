import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Dayjs } from 'dayjs';
import { Clock, Eye, Percent } from 'lucide-react';
import { Button, Card, CardContent, Flex, Grid, Spinner, StatCard, Typography } from '@/components/ui';
import { EChartsAreaChart } from '@/components/evilcharts/charts/echarts-area-chart';
import { cssVar } from '@/components/evilcharts/ui/echarts-chart';
import { useAuth } from '@/hooks/useAuth';
import { useOrganization } from '@/hooks/useOrganization';
import { AnalyticsService, type DashboardBundle } from '@/services/analyticsService';
import {
  DASHBOARD_WS_KEY_PENDING,
  REVTUBE_DASHBOARD_WS_ROOT,
  getDashboardWorkspaceKey,
} from '@/utils/dashboardWorkspaceScope';
import { buildVideoChartRows, type VideoChartPoint } from '@/utils/videoChartData';
import { useDashboardStore } from '@/stores/dashboardStore';
import { calcMetricDeltaPct } from '@/utils/metricDeltaPct';

interface VideoPerformanceWidgetProps {
  channelId: string | null;
  period: number | null;
  customStartDate: Dayjs | null;
  customEndDate: Dayjs | null;
  getEffectiveToken: (channelId: string) => Promise<string | null>;
  formattedLatestDate: string | null;
}

const asChartRows = (rows: VideoChartPoint[]): Array<Record<string, unknown>> =>
  rows as unknown as Array<Record<string, unknown>>;

function Delta({ curr, prev }: { curr: number; prev: number }): React.ReactElement {
  const pct = calcMetricDeltaPct(curr, prev);
  if (pct === null) return <span>—</span>;
  const positive = pct > 0;
  const negative = pct < 0;
  const color = positive
    ? 'text-[var(--rt-color-success)]'
    : negative
      ? 'text-[var(--rt-color-danger)]'
      : '';
  return (
    <span className={`text-xs font-semibold ${color}`}>
      {positive ? '↑' : negative ? '↓' : ''}
      {` ${Math.abs(pct).toFixed(1)}%`}
    </span>
  );
}

/**
 * Channel-wide video performance: KPI pills + daily views trend.
 * Self-managed bundle query (1 quota unit, mounted only while visible) —
 * same cost class as the channel tab, gated by visibility instead of
 * `activeTab`. Cache key is channel-wide so it never collides with the
 * table-scoped queries on `/dashboard`.
 */
export function VideoPerformanceWidget({
  channelId,
  period,
  customStartDate,
  customEndDate,
  getEffectiveToken,
  formattedLatestDate,
}: VideoPerformanceWidgetProps): React.ReactElement {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { currentOrganization, isPersonalContext } = useOrganization();
  const latestDataDate = useDashboardStore((s) => s.dateRange.latestDataDate);

  const startD = customStartDate?.isValid() ? customStartDate : null;
  const endD = customEndDate?.isValid() ? customEndDate : null;
  const hasCustom = !!(startD && endD);
  const periodDays = hasCustom
    ? Math.max(1, endD!.diff(startD, 'day') + 1)
    : (period ?? 30);

  const workspaceKey =
    getDashboardWorkspaceKey({
      userId: user?.uid,
      isPersonalContext,
      organizationId: currentOrganization?.id,
    }) ?? DASHBOARD_WS_KEY_PENDING;

  const query = useQuery({
    queryKey: [
      REVTUBE_DASHBOARD_WS_ROOT,
      workspaceKey,
      'widget-video-performance',
      channelId,
      hasCustom ? `${startD!.format('YYYY-MM-DD')}_${endD!.format('YYYY-MM-DD')}` : `p${periodDays}`,
      latestDataDate ?? '',
    ],
    queryFn: async (): Promise<DashboardBundle> => {
      if (!channelId || !user?.email) throw new Error('Missing channel or user');
      const token = await getEffectiveToken(channelId);
      if (!token) throw new Error('No access token available');
      const svc = new AnalyticsService(token, user.email, currentOrganization?.id);
      return svc.getDashboardBundle({
        channelId,
        period: hasCustom ? undefined : periodDays,
        startDate: hasCustom ? startD!.format('YYYY-MM-DD') : undefined,
        endDate: hasCustom ? endD!.format('YYYY-MM-DD') : undefined,
        compare: true,
        trueDelta: false,
        latestDate: latestDataDate || undefined,
        fields: ['channelTotals', 'chartData', 'comparison'],
      });
    },
    enabled: !!channelId && !!user?.email,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 2,
    meta: { suppressGlobalErrorToast: true },
  });

  const bundle = query.data ?? null;
  const rows = React.useMemo(
    () => buildVideoChartRows(bundle?.current ?? null, bundle?.previous ?? null, periodDays),
    [bundle, periodDays],
  );

  const stats = React.useMemo(() => {
    const totals = rows.reduce(
      (acc, r) => ({
        views: acc.views + r.views,
        watch: acc.watch + r.minutesWatched,
        retentionSum: acc.retentionSum + r.retention,
        prevViews: acc.prevViews + (r.prevViews ?? 0),
        prevWatch: acc.prevWatch + (r.prevMinutesWatched ?? 0),
        prevRetentionSum: acc.prevRetentionSum + (r.prevRetention ?? 0),
        prevRetentionCount: acc.prevRetentionCount + (r.prevRetention ? 1 : 0),
      }),
      { views: 0, watch: 0, retentionSum: 0, prevViews: 0, prevWatch: 0, prevRetentionSum: 0, prevRetentionCount: 0 },
    );
    let { views, watch } = totals;
    let { prevViews, prevWatch } = totals;
    if (bundle?.channelTotals) {
      views = bundle.channelTotals.views ?? views;
      watch = bundle.channelTotals.watch_time ?? watch;
      if (bundle.prevChannelTotals) {
        prevViews = bundle.prevChannelTotals.views ?? prevViews;
        prevWatch = bundle.prevChannelTotals.watch_time ?? prevWatch;
      }
    }
    const retention = rows.length > 0 ? totals.retentionSum / rows.length : 0;
    const prevRetention = totals.prevRetentionCount > 0
      ? totals.prevRetentionSum / totals.prevRetentionCount
      : 0;
    return { views, watch, retention, prevViews, prevWatch, prevRetention };
  }, [rows, bundle]);

  const chartConfig = React.useMemo(
    () => ({ views: { label: 'Views', color: cssVar('--rt-chart-views') } }),
    [],
  );

  return (
    <Card size="sm">
      <CardContent>
        {query.isLoading ? (
          <Flex gap={1} alignItems="center" sx={{ minWidth: 0, padding: '8px 0' }}>
            <Spinner size="sm" />
            <Typography variant="caption" noWrap>Loading video performance…</Typography>
          </Flex>
        ) : query.error || !bundle ? (
          <Flex gap={1} alignItems="center" sx={{ minWidth: 0, padding: '8px 0' }}>
            <Typography variant="caption" noWrap sx={{ minWidth: 0, flex: 1 }}>
              Couldn&apos;t load video performance.
            </Typography>
            <Button size="sm" variant="outline" onClick={() => query.refetch()}>
              <span>Retry</span>
            </Button>
          </Flex>
        ) : rows.length === 0 ? (
          <Typography variant="caption">No video data for this period.</Typography>
        ) : (
          <>
            <Grid container spacing={1.5}>
              <Grid size={{ xs: 12, sm: 4 }}>
                <StatCard
                  label="Views"
                  value={<><span>{stats.views.toLocaleString()}</span> <Delta curr={stats.views} prev={stats.prevViews} /></>}
                  icon={<Eye size={16} />}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <StatCard
                  label="Minutes watched"
                  value={<><span>{Math.round(stats.watch).toLocaleString()}</span> <Delta curr={stats.watch} prev={stats.prevWatch} /></>}
                  icon={<Clock size={16} />}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <StatCard
                  label="Avg retention"
                  value={<><span>{`${stats.retention.toFixed(1)}%`}</span> <Delta curr={stats.retention} prev={stats.prevRetention} /></>}
                  icon={<Percent size={16} />}
                />
              </Grid>
            </Grid>
            <EChartsAreaChart
              data={asChartRows(rows)}
              config={chartConfig}
              xDataKey="date"
              height={240}
              title="Video performance"
              curveType="smooth"
              selectedKeys={['views']}
            >
              <EChartsAreaChart.Grid />
              <EChartsAreaChart.XAxis
                dataKey="date"
                tickFormatter={(val) =>
                  new Date(String(val)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                }
              />
              <EChartsAreaChart.YAxis tickFormatter={(val) => Number(val).toLocaleString()} />
              <EChartsAreaChart.Tooltip />
              <EChartsAreaChart.Area dataKey="views" />
            </EChartsAreaChart>
          </>
        )}
        <Flex gap={1} alignItems="center" sx={{ minWidth: 0, marginTop: 1 }}>
          {formattedLatestDate ? (
            <Typography variant="caption" noWrap sx={{ minWidth: 0, flex: 1 }}>
              {`As of ${formattedLatestDate}`}
            </Typography>
          ) : <span style={{ flex: 1, minWidth: 0 }} />}
          <Button size="sm" variant="ghost" onClick={() => navigate('/dashboard?tab=videoAnalytics')}>
            <span>Open Videos tab</span>
          </Button>
        </Flex>
      </CardContent>
    </Card>
  );
}

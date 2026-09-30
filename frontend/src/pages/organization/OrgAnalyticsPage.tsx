/**
 * OrgAnalyticsPage -- Organization-wide cross-channel analytics and performance matrix.
 * Read-model backed (no YouTube API quota used): aggregates all connected organization channels.
 */
import React, { useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { Button, Tooltip, Input } from '../../components/ui';
import { DateRangeSelector } from '../../components/dashboard/DateRangeSelector';
import {
  BarChart3,
  Database,
  Users,
  Eye,
  UserPlus,
  ThumbsUp,
  MessageSquare,
  Clock,
  TrendingUp,
  TrendingDown,
  Search,
  RefreshCw,
  FileSpreadsheet,
  Layers,
  BarChart2,
} from 'lucide-react';
import { EChartsLineChart } from '../../components/evilcharts/charts/echarts-line-chart';
import type { ChartConfig } from '../../components/evilcharts/ui/echarts-chart';
import { tooltipShellStyle } from '../../components/evilcharts/ui/echarts-chart';
import toast from 'react-hot-toast';
import { EmptyState } from '../../components/EmptyState';
import { useOrganization } from '../../hooks/useOrganization';
import { useOrgAnalyticsQuery } from '../../hooks/queries/useOrgAnalyticsQuery';
import type {
  OrgAnalyticsChannel,
  OrgAnalyticsPeriod,
  OrgAnalyticsCustomRange,
} from '../../services/organizationService';
import { MULTI_SERIES_FALLBACK_COLORS } from '../../utils/chartTheme';
import './OrgAnalyticsPage.css';

const PERIODS: { key: OrgAnalyticsPeriod; label: string }[] = [
  { key: '7d', label: 'Last 7 Days' },
  { key: '30d', label: 'Last 30 Days' },
  { key: '90d', label: 'Last 90 Days' },
  { key: 'custom', label: 'Custom' },
];

type ActiveMetric = 'views' | 'watchMinutes' | 'netSubs' | 'likes' | 'comments';

const METRIC_CONFIGS: Record<
  ActiveMetric,
  { label: string; unit: string; icon: React.ElementType }
> = {
  views: { label: 'Total Views', unit: 'views', icon: Eye },
  watchMinutes: { label: 'Watch Time', unit: 'mins', icon: Clock },
  netSubs: { label: 'Net Subscribers', unit: 'subs', icon: UserPlus },
  likes: { label: 'Total Likes', unit: 'likes', icon: ThumbsUp },
  comments: { label: 'Comments', unit: 'comments', icon: MessageSquare },
};

const compactNumber = (n: number) =>
  new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n);

const formatFullNumber = (n: number) =>
  new Intl.NumberFormat('en-US').format(n);

const formatWatchTime = (minutes: number) => {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMins = Math.round(minutes % 60);
  if (hours >= 1000) return `${compactNumber(hours)}h`;
  return `${hours.toLocaleString()}h ${remainingMins}m`;
};

const formatDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });

const formatDateLong = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

const channelLabel = (ch: OrgAnalyticsChannel) =>
  ch.title || `Channel ${ch.channelId.slice(0, 8)}…`;

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

type TableSortKey =
  | 'title'
  | 'views'
  | 'watchMinutes'
  | 'netSubs'
  | 'likes'
  | 'comments'
  | 'videoCount'
  | 'avgViews';

/**
 * KPI card showing the all-time/till-now aggregate as the headline value plus
 * an explicit "in {period}" sub-value for the selected timeline. The delta
 * badge is the % change vs the previous equivalent period.
 */
const KpiCard: React.FC<{
  label: string;
  icon: React.ReactNode;
  value: React.ReactNode;
  delta: number | null;
  mainCaption?: string;
  periodTitle: string;
  periodValue: React.ReactNode;
  footer?: React.ReactNode;
}> = ({
  label,
  icon,
  value,
  delta,
  mainCaption = 'till now',
  periodTitle,
  periodValue,
  footer,
}) => {
  const deltaClass =
    delta == null
      ? 'org-analytics-kpi-delta--neutral'
      : delta > 0
      ? 'org-analytics-kpi-delta--up'
      : delta < 0
      ? 'org-analytics-kpi-delta--down'
      : 'org-analytics-kpi-delta--neutral';

  const deltaLabel = delta == null ? null : delta > 0 ? `+${delta}%` : `${delta}%`;

  return (
    <div className="org-analytics-kpi-card">
      <div className="org-analytics-kpi-head">
        <span className="org-analytics-kpi-label">{label}</span>
        <div className="org-analytics-kpi-icon">{icon}</div>
      </div>
      <div className="org-analytics-kpi-main">
        <div className="org-analytics-kpi-value-wrap">
          <span className="org-analytics-kpi-caption">{mainCaption}</span>
          <span className="org-analytics-kpi-value">{value}</span>
        </div>
        {delta != null && (
          <span className={`org-analytics-kpi-delta ${deltaClass}`}>
            {delta > 0 ? <TrendingUp size={12} /> : delta < 0 ? <TrendingDown size={12} /> : null}
            {deltaLabel}
          </span>
        )}
      </div>
      <div className="org-analytics-kpi-period">
        <span className="org-analytics-kpi-period-title">in {periodTitle}</span>
        <span className="org-analytics-kpi-period-value">{periodValue}</span>
      </div>
      {footer != null && <div className="org-analytics-kpi-footer">{footer}</div>}
    </div>
  );
};

export const OrgAnalyticsPage: React.FC = () => {
  const navigate = useNavigate();
  const { currentOrganization, isPersonalContext, isOwner, isAdmin } = useOrganization();
  const [period, setPeriod] = useState<OrgAnalyticsPeriod>('30d');
  const [customRange, setCustomRange] = useState<OrgAnalyticsCustomRange>(() => {
    const end = new Date();
    const start = new Date(Date.now() - 29 * 86400000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    return { start: iso(start), end: iso(end) };
  });
  const [metric, setMetric] = useState<ActiveMetric>('views');
  const [leaderboardMetric, setLeaderboardMetric] = useState<ActiveMetric>('views');
  const [hiddenChannels, setHiddenChannels] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<TableSortKey>('views');
  const [sortAsc, setSortAsc] = useState(false);

  const orgId = currentOrganization?.id ?? null;
  const { data, isLoading, isError, error, refetch, isFetching } =
    useOrgAnalyticsQuery(
      orgId,
      period,
      period === 'custom' ? customRange : undefined
    );

  const channels = useMemo(() => data?.channels ?? [], [data?.channels]);
  const totals = data?.totals;
  // All-time aggregate shown as the main card value; the subtitle shows what
  // was added/reduced within the chosen timeline (totals = window sums).
  // Falls back to window totals while cached pre-lifetime payloads age out
  // (server cache TTL is 30 min) so cards never show zeros.
  const lifetime =
    data?.lifetime ??
    data?.totals ?? {
      views: 0,
      watchMinutes: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      subsGained: 0,
      subsLost: 0,
      netSubs: 0,
    };
  const deltas = data?.deltas ?? {};
  // Earliest day of ingested daily metrics. Watch time & subscriber lifetime
  // figures only cover history from this date (views/likes/comments are true
  // cumulative totals from analytics_videos and need no qualifier).
  const historySince = data?.historyStart
    ? new Date(`${data.historyStart}T00:00:00Z`).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

  // Human label of the selected timeline, used in KPI subtitles.
  const rangeLabel = useMemo(() => {
    if (period === 'custom') {
      return `${formatDateLong(customRange.start)} – ${formatDateLong(customRange.end)}`;
    }
    return PERIODS.find((p) => p.key === period)?.label ?? 'selected period';
  }, [period, customRange.start, customRange.end]);

    const hasData = useMemo(
    () => channels.some((c) => c.totals.views > 0 || c.totals.netSubs !== 0),
    [channels]
  );

  // Toggle channel visibility in multi-series chart
  const toggleChannelVisibility = useCallback((channelId: string) => {
    setHiddenChannels((prev) => {
      const next = new Set(prev);
      if (next.has(channelId)) next.delete(channelId);
      else next.add(channelId);
      return next;
    });
  }, []);

  // Merge per-channel series into rows for the chart
  const chartRows = useMemo(() => {
    if (!data) return [];
    const rows = new Map<string, Record<string, number | string>>();
    for (const ch of channels) {
      if (hiddenChannels.has(ch.channelId)) continue;
      for (const point of ch.series) {
        let row = rows.get(point.date);
        if (!row) {
          row = { date: point.date };
          rows.set(point.date, row);
        }
        row[ch.channelId] = (point[metric] as number) ?? 0;
      }
    }
    return [...rows.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [data, channels, hiddenChannels, metric]);

  // ECharts config: one entry per channel, same fallback-color rotation as before
  const channelChartConfig = useMemo<ChartConfig>(() => {
    const cfg: ChartConfig = {};
    channels.forEach((ch, i) => {
      cfg[ch.channelId] = {
        label: channelLabel(ch),
        color: MULTI_SERIES_FALLBACK_COLORS[i % MULTI_SERIES_FALLBACK_COLORS.length],
      };
    });
    return cfg;
  }, [channels]);

  const visibleChannels = useMemo(
    () => channels.filter((ch) => !hiddenChannels.has(ch.channelId)),
    [channels, hiddenChannels],
  );

  // Axis tooltip: date + per-channel value (watch-time formatting for that metric)
  const trendTooltipFormatter = useCallback(
    (
      rows: Array<{ seriesKey: string; seriesName: string; color: string; value: unknown; row: Record<string, unknown> }>,
      axisValue: string,
    ): string => {
      const body = rows
        .map((r) => {
          const n = Number(r.value);
          const val = !Number.isFinite(n)
            ? '—'
            : metric === 'watchMinutes'
              ? formatWatchTime(n)
              : compactNumber(n);
          return (
            `<div style="display:flex;align-items:center;gap:8px;padding:1px 0;">` +
            `<span style="width:8px;height:8px;border-radius:50%;background:${r.color};flex-shrink:0;"></span>` +
            `<span>${escapeHtml(r.seriesName)}:</span>` +
            `<span style="margin-left:auto;padding-left:16px;font-weight:600;font-variant-numeric:tabular-nums;">${escapeHtml(val)}</span>` +
            `</div>`
          );
        })
        .join('');
      return (
        `<div style="${tooltipShellStyle}">` +
        `<div style="margin-bottom:6px;font-weight:600;">${escapeHtml(formatDate(axisValue))}</div>${body}</div>`
      );
    },
    [metric],
  );

  // Export matrix to CSV
  const handleExportCSV = useCallback(() => {
    if (!channels.length) return;
    const headers = [
      'Channel Name',
      'Channel ID',
      'Views',
      'Watch Minutes',
      'Net Subscribers',
      'Likes',
      'Comments',
      'Video Count',
      'Avg Views Per Video',
      'Share of Views (%)',
    ];

    const totalViews = totals?.views || 1;
    const rows = channels.map((ch) => {
      const avgViews =
        ch.videoCount > 0 ? Math.round(ch.totals.views / ch.videoCount) : 0;
      const share = ((ch.totals.views / totalViews) * 100).toFixed(1);
      return [
        `"${(ch.title || ch.channelId).replace(/"/g, '""')}"`,
        `"${ch.channelId}"`,
        ch.totals.views,
        ch.totals.watchMinutes,
        ch.totals.netSubs,
        ch.totals.likes,
        ch.totals.comments,
        ch.videoCount,
        avgViews,
        `${share}%`,
      ].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute(
      'download',
      `${currentOrganization?.name || 'Organization'}_Analytics_${period}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Organization analytics exported to CSV');
  }, [channels, totals, currentOrganization?.name, period]);

  // Sorted and filtered matrix rows
  const sortedChannels = useMemo(() => {
    let list = [...channels];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (c) =>
          (c.title || '').toLowerCase().includes(q) ||
          c.channelId.toLowerCase().includes(q)
      );
    }

    list.sort((a, b) => {
      let valA: string | number = 0;
      let valB: string | number = 0;

      if (sortKey === 'title') {
        valA = a.title || '';
        valB = b.title || '';
      } else if (sortKey === 'avgViews') {
        valA = a.videoCount > 0 ? a.totals.views / a.videoCount : 0;
        valB = b.videoCount > 0 ? b.totals.views / b.videoCount : 0;
      } else if (sortKey === 'videoCount') {
        valA = a.videoCount;
        valB = b.videoCount;
      } else {
        valA = a.totals[sortKey] ?? 0;
        valB = b.totals[sortKey] ?? 0;
      }

      if (typeof valA === 'string' && typeof valB === 'string') {
        return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return sortAsc ? Number(valA) - Number(valB) : Number(valB) - Number(valA);
    });

    return list;
  }, [channels, searchQuery, sortKey, sortAsc]);

  const handleSort = (key: TableSortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  // Guard: Personal context (no org selected)
  if (isPersonalContext || !orgId) {
    return (
      <div className="org-analytics-page">
        <div className="org-analytics-container">
          <EmptyState
            icon={<Users size={44} style={{ color: 'var(--rt-color-accent)' }} />}
            title="Organization Context Required"
            description="Switch to an organization in the header to view unified cross-channel analytics."
          />
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="org-analytics-page">
        <div className="org-analytics-container">
          <div className="org-analytics-loading-card">
            <div className="org-analytics-loading-spinner" />
            <div style={{ fontSize: 'var(--rt-text-md)', fontWeight: 'var(--rt-weight-semibold)', color: 'var(--rt-color-text)', marginBottom: 4 }}>
              Aggregating Organization Analytics…
            </div>
            <div style={{ fontSize: 'var(--rt-text-xs)', color: 'var(--rt-color-text-tertiary)' }}>
              Compiling multi-channel trends and performance models from PostgreSQL ingestion store
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    toast.error(error instanceof Error ? error.message : 'Failed to load organization analytics');
  }

  const totalOrgVideos = channels.reduce((acc, c) => acc + c.videoCount, 0);
  const totalOrgViews = totals?.views || 0;
  const avgViewsPerVideo =
    totalOrgVideos > 0 ? Math.round(totalOrgViews / totalOrgVideos) : 0;

  return (
    <div className="page-container org-analytics-page">
      {/* ── Page Header ─────────────────────────────────────────────────── */}
      <header className="page-header page-header--split">
        <div>
          <div className="org-analytics-title-icon-row">
            <BarChart2 size={22} className="org-analytics-title-icon" />
            <h1>{currentOrganization?.name || 'Organization'} Portfolio</h1>
          </div>
          <p className="page-description">
            Cross-channel intelligence and unified benchmarking across all{' '}
            <strong>{channels.length}</strong> connected YouTube channel
            {channels.length === 1 ? '' : 's'}
          </p>
        </div>

        <div className="org-analytics-actions">
          {/* Period selector */}
            <div className="org-analytics-periods" role="tablist" aria-label="Analytics Period">
              {PERIODS.map((p) => (
                <Button bare
                  key={p.key}
                  type="button"
                  className={`org-analytics-period-btn ${period === p.key ? 'active' : ''}`}
                  onClick={() => setPeriod(p.key)}
                >
                  {p.label}
                </Button>
              ))}
            </div>

            {/* Shared calendar-based custom range picker (dashboard component) */}
            {period === 'custom' && (
              <div className="org-analytics-range-wrap">
                <DateRangeSelector
                  startDate={customRange.start ? dayjs(customRange.start) : null}
                  endDate={customRange.end ? dayjs(customRange.end) : null}
                  latestDataDate={null}
                  onRangeChange={(start, end) =>
                    setCustomRange({
                      start: start ? start.format('YYYY-MM-DD') : customRange.start,
                      end: end ? end.format('YYYY-MM-DD') : customRange.end,
                    })
                  }
                  onClear={() => setPeriod('30d')}
                />
              </div>
            )}

            {/* Manual refresh -- cached server-side; new channels appear after
                the channel-set changes (cache key includes channel-set hash) */}
            <Button
              variant="outlined"
              size="small"
              onClick={() => void refetch()}
              disabled={isFetching}
              startIcon={<RefreshCw size={15} />}
              sx={{
                textTransform: 'none',
                fontSize: 'var(--rt-text-xs)',
                fontWeight: 'var(--rt-weight-semibold)',
                borderRadius: 'var(--rt-radius-pill)',
                borderColor: 'var(--rt-color-border)',
                color: 'var(--rt-color-text)',
                bgcolor: 'var(--rt-color-bg-elevated)',
                '&:hover': {
                  bgcolor: 'var(--rt-color-bg-subtle)',
                },
              }}
            >
              {isFetching ? 'Refreshing…' : 'Refresh'}
            </Button>

            {/* Export CSV button */}
            {hasData && (
              <Button
                variant="outlined"
                size="small"
                onClick={handleExportCSV}
                startIcon={<FileSpreadsheet size={15} />}
                sx={{
                  textTransform: 'none',
                  fontSize: 'var(--rt-text-xs)',
                  fontWeight: 'var(--rt-weight-semibold)',
                  borderRadius: 'var(--rt-radius-pill)',
                  borderColor: 'var(--rt-color-border)',
                  color: 'var(--rt-color-text)',
                  bgcolor: 'var(--rt-color-bg-elevated)',
                  '&:hover': {
                    bgcolor: 'var(--rt-color-bg-subtle)',
                    borderColor: 'var(--rt-color-border-strong)',
                  },
                }}
              >
                Export CSV
              </Button>
            )}
          </div>
        </header>

        <div className="org-analytics-container">
        {/* ── Deployment or Zero-Data States ──────────────────────────────── */}
        {!data?.configured ? (
          <EmptyState
            icon={<Database size={44} style={{ color: 'var(--rt-color-accent)' }} />}
            title="Analytics Store Not Configured"
            description="PostgreSQL analytics ingestion is not enabled on this deployment. Connect with your system administrator to enable read-model indexing."
          />
        ) : !hasData ? (
          <EmptyState
            icon={<BarChart3 size={44} style={{ color: 'var(--rt-color-accent)' }} />}
            title="No Channel Analytics Recorded Yet"
            description={
              isPersonalContext || isOwner || isAdmin
                ? "Connect YouTube channels to this organization. Once background sync completes, comparative analytics and multi-channel charts will automatically populate here."
                : "Only organization owners and admins can add YouTube channels. Please ask your organization owner or admin to connect channels so analytics can populate here."
            }
          />
        ) : (
          <>
            {/* Channels recently connected but not yet ingested into the
                PostgreSQL read models (first sync runs on the 6h cron). */}
            {(() => {
              const pendingCount = channels.filter(
                (c) => !c.lastSyncedAt && c.videoCount === 0,
              ).length;
              if (pendingCount === 0) return null;
              return (
                <div
                  className="org-analytics-sync-banner"
                  role="status"
                >
                  <Clock size={16} style={{ flexShrink: 0 }} />
                  <span>
                    {pendingCount} newly connected channel
                    {pendingCount === 1 ? ' is' : 's are'} awaiting first data
                    sync — metrics will appear automatically after ingestion
                    completes (up to 6 hours).
                  </span>
                </div>
              );
            })()}

            {/* ── KPI Grid ──────────────────────────────────────────────────── */}
            {totals && (
              <section className="org-analytics-kpis">
                        <KpiCard
          label="Total Views"
          icon={<Eye size={16} />}
          value={compactNumber(lifetime.views)}
          delta={deltas.views ?? null}
          periodTitle={rangeLabel}
          periodValue={
            totals.views >= 0
              ? `+${compactNumber(totals.views)}`
              : compactNumber(totals.views)
          }
        />
        <KpiCard
          label="Net Subscribers"
          icon={<UserPlus size={16} />}
          value={
            lifetime.netSubs >= 0
              ? `+${compactNumber(lifetime.netSubs)}`
              : compactNumber(lifetime.netSubs)
          }
          delta={deltas.netSubs ?? null}
          periodTitle={rangeLabel}
          periodValue={
            totals.netSubs >= 0
              ? `+${compactNumber(totals.netSubs)}`
              : compactNumber(totals.netSubs)
          }
          footer={
            <span>
              since {historySince ?? 'first sync'}: +
              {formatFullNumber(lifetime.subsGained)} / -
              {formatFullNumber(lifetime.subsLost)}
            </span>
          }
        />
        <KpiCard
          label="Total Watch Time"
          icon={<Clock size={16} />}
          value={formatWatchTime(lifetime.watchMinutes)}
          delta={deltas.watchMinutes ?? null}
          periodTitle={rangeLabel}
          periodValue={formatWatchTime(totals.watchMinutes)}
          footer={
            <span>
              till-now watch time since {historySince ?? 'first sync'}
            </span>
          }
        />
        <KpiCard
          label="Engagement"
          icon={<ThumbsUp size={16} />}
          value={compactNumber(lifetime.likes + lifetime.comments)}
          delta={deltas.likes ?? null}
          periodTitle={rangeLabel}
          periodValue={compactNumber(totals.likes + totals.comments)}
          footer={
            <>
              <span>
                {compactNumber(totals.likes)} likes · {compactNumber(totals.comments)} comments
              </span>
              <span>{compactNumber(avgViewsPerVideo)} avg views/vid</span>
            </>
          }
        />
      </section>
            )}

            {/* ── Multi-Series Trend Chart ──────────────────────────────────── */}
            <section className="org-analytics-panel">
              <div className="org-analytics-panel-head">
                <h2 className="org-analytics-panel-title">
                  <BarChart3 size={18} style={{ color: 'var(--rt-color-accent)' }} />
                  Multi-Channel Daily Trajectory
                </h2>

                <div className="org-analytics-metric-pills" role="tablist">
                  {(
                    [
                      'views',
                      'watchMinutes',
                      'netSubs',
                      'likes',
                      'comments',
                    ] as const
                  ).map((m) => (
                    <Button bare
                      key={m}
                      type="button"
                      className={`org-analytics-metric-pill ${metric === m ? 'active' : ''}`}
                      onClick={() => setMetric(m)}
                    >
                      {METRIC_CONFIGS[m].label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="org-analytics-chart-container">
                <EChartsLineChart
                  data={chartRows}
                  config={channelChartConfig}
                  xDataKey="date"
                  height={320}
                  title="Multi-channel daily trajectory"
                  showToolbar
                  tooltipFormatter={trendTooltipFormatter}
                >
                  <EChartsLineChart.Grid />
                  <EChartsLineChart.XAxis dataKey="date" tickFormatter={formatDate} />
                  <EChartsLineChart.YAxis tickFormatter={(v) => compactNumber(v)} />
                  <EChartsLineChart.Brush />
                  <EChartsLineChart.Legend isClickable />
                  <EChartsLineChart.Tooltip />
                  {visibleChannels.map((ch) => (
                    <EChartsLineChart.Line
                      key={ch.channelId}
                      dataKey={ch.channelId}
                      strokeWidth={2.5}
                      showSymbol={false}
                    />
                  ))}
                </EChartsLineChart>
              </div>

              {/* Channel filter badges */}
              <div className="org-analytics-channel-chips">
                <span
                  style={{
                    fontSize: 'var(--rt-text-2xs)',
                    fontWeight: 'var(--rt-weight-bold)',
                    color: 'var(--rt-color-text-tertiary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  Filter Channels:
                </span>
                {channels.map((ch, i) => {
                  const isVisible = !hiddenChannels.has(ch.channelId);
                  const color =
                    MULTI_SERIES_FALLBACK_COLORS[
                      i % MULTI_SERIES_FALLBACK_COLORS.length
                    ];
                  return (
                    <div
                      key={ch.channelId}
                      className={`org-analytics-channel-chip ${isVisible ? 'active' : 'inactive'}`}
                      onClick={() => toggleChannelVisibility(ch.channelId)}
                      title={`Click to ${isVisible ? 'hide' : 'show'} ${channelLabel(ch)} on chart`}
                    >
                      <span
                        className="org-analytics-channel-dot"
                        style={{ backgroundColor: isVisible ? color : 'var(--rt-color-text-tertiary)' }}
                      />
                      <span>{channelLabel(ch)}</span>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* ── Channel Leaderboard ───────────────────────────────────────── */}
            <section className="org-analytics-panel">
              <div className="org-analytics-panel-head">
                <h2 className="org-analytics-panel-title">
                  <Layers size={18} style={{ color: 'var(--rt-color-accent)' }} />
                  Channel Performance Leaderboard
                </h2>

                <div className="org-analytics-metric-pills">
                  {(
                    [
                      'views',
                      'watchMinutes',
                      'netSubs',
                      'likes',
                      'comments',
                    ] as const
                  ).map((m) => (
                    <Button bare
                      key={m}
                      type="button"
                      className={`org-analytics-metric-pill ${leaderboardMetric === m ? 'active' : ''}`}
                      onClick={() => setLeaderboardMetric(m)}
                    >
                      {METRIC_CONFIGS[m].label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="org-analytics-leaderboard-list">
                {(() => {
                  const sorted = [...channels].sort(
                    (a, b) =>
                      (b.totals[leaderboardMetric] ?? 0) -
                      (a.totals[leaderboardMetric] ?? 0)
                  );
                  const maxMetricVal = Math.max(
                    ...sorted.map((c) => c.totals[leaderboardMetric] ?? 0),
                    1
                  );
                  const metricTotal = totals?.[leaderboardMetric] || 1;

                  return sorted.map((ch, i) => {
                    const val = ch.totals[leaderboardMetric] ?? 0;
                    const pct = Math.max((val / maxMetricVal) * 100, 2);
                    const shareOfTotal = ((val / metricTotal) * 100).toFixed(1);
                    const color =
                      MULTI_SERIES_FALLBACK_COLORS[
                        i % MULTI_SERIES_FALLBACK_COLORS.length
                      ];
                    const delta = ch.deltas[leaderboardMetric];

                    return (
                      <div
                        key={ch.channelId}
                        className="org-analytics-leaderboard-item"
                        onClick={() =>
                          navigate(`/channel?channel=${encodeURIComponent(ch.channelId)}`)
                        }
                        style={{ cursor: 'pointer' }}
                        title="Click to view detailed Channel Analytics"
                      >
                        <div
                          className={`org-analytics-rank-badge ${
                            i === 0
                              ? 'top-1'
                              : i === 1
                              ? 'top-2'
                              : i === 2
                              ? 'top-3'
                              : ''
                          }`}
                        >
                          {i + 1}
                        </div>

                        <div className="org-analytics-channel-meta">
                          <span className="org-analytics-channel-name">
                            {channelLabel(ch)}
                          </span>
                          <span className="org-analytics-channel-share">
                            {shareOfTotal}% share of organization {METRIC_CONFIGS[leaderboardMetric].unit}
                          </span>
                        </div>

                        <div className="org-analytics-bar-track">
                          <div
                            className="org-analytics-bar-fill"
                            style={{
                              width: `${pct}%`,
                              background: color,
                            }}
                          />
                        </div>

                        <span className="org-analytics-item-val">
                          {leaderboardMetric === 'watchMinutes'
                            ? formatWatchTime(val)
                            : compactNumber(val)}
                        </span>

                        <span
                          className={`org-analytics-kpi-delta ${
                            delta != null && delta > 0
                              ? 'org-analytics-kpi-delta--up'
                              : delta != null && delta < 0
                              ? 'org-analytics-kpi-delta--down'
                              : 'org-analytics-kpi-delta--neutral'
                          }`}
                          style={{ justifySelf: 'end' }}
                        >
                          {delta == null
                            ? '—'
                            : `${delta > 0 ? '+' : ''}${delta}%`}
                        </span>
                      </div>
                    );
                  });
                })()}
              </div>
            </section>

            {/* ── Cross-Channel Deep Matrix Table ───────────────────────────── */}
            <section className="org-analytics-table-card">
              <div className="org-analytics-table-toolbar">
                <h2
                  style={{
                    fontSize: 'var(--rt-text-sm)',
                    fontWeight: 'var(--rt-weight-bold)',
                    color: 'var(--rt-color-text)',
                    margin: 0,
                  }}
                >
                  Cross-Channel Matrix ({sortedChannels.length} Channels)
                </h2>

                <Input
                  compact
                  placeholder="Filter channels by name or ID…"
                  aria-label="Filter channels by name or ID"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  startAdornment={<Search size={14} />}
                />
              </div>

              <div className="org-analytics-table-wrap">
                <table className="org-analytics-table">
                  <thead>
                    <tr>
                      <th
                        className="sortable"
                        onClick={() => handleSort('title')}
                      >
                        Channel {sortKey === 'title' && (sortAsc ? '▲' : '▼')}
                      </th>
                      <th
                        className="sortable"
                        onClick={() => handleSort('views')}
                      >
                        Views {sortKey === 'views' && (sortAsc ? '▲' : '▼')}
                      </th>
                      <th
                        className="sortable"
                        onClick={() => handleSort('watchMinutes')}
                      >
                        Watch Time {sortKey === 'watchMinutes' && (sortAsc ? '▲' : '▼')}
                      </th>
                      <th
                        className="sortable"
                        onClick={() => handleSort('netSubs')}
                      >
                        Net Subs {sortKey === 'netSubs' && (sortAsc ? '▲' : '▼')}
                      </th>
                      <th
                        className="sortable"
                        onClick={() => handleSort('likes')}
                      >
                        Likes {sortKey === 'likes' && (sortAsc ? '▲' : '▼')}
                      </th>
                      <th
                        className="sortable"
                        onClick={() => handleSort('comments')}
                      >
                        Comments {sortKey === 'comments' && (sortAsc ? '▲' : '▼')}
                      </th>
                      <th
                        className="sortable"
                        onClick={() => handleSort('videoCount')}
                      >
                        Videos {sortKey === 'videoCount' && (sortAsc ? '▲' : '▼')}
                      </th>
                      <th
                        className="sortable"
                        onClick={() => handleSort('avgViews')}
                      >
                        Avg Views/Vid {sortKey === 'avgViews' && (sortAsc ? '▲' : '▼')}
                      </th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedChannels.length === 0 ? (
                      <tr>
                        <td
                          colSpan={9}
                          style={{
                            textAlign: 'center',
                            padding: '32px 0',
                            color: 'var(--rt-color-text-tertiary)',
                          }}
                        >
                          No channels match your filter criteria.
                        </td>
                      </tr>
                    ) : (
                      sortedChannels.map((ch, idx) => {
                        const avgViews =
                          ch.videoCount > 0
                            ? Math.round(ch.totals.views / ch.videoCount)
                            : 0;
                        const dotColor =
                          MULTI_SERIES_FALLBACK_COLORS[
                            idx % MULTI_SERIES_FALLBACK_COLORS.length
                          ];

                        return (
                          <tr key={ch.channelId}>
                            <td>
                              <div className="org-analytics-table-channel-col">
                                <span
                                  style={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: '50%',
                                    backgroundColor: dotColor,
                                    flexShrink: 0,
                                  }}
                                />
                                <div>
                                  <div
                                    style={{
                                      fontWeight: 'var(--rt-weight-bold)',
                                      color: 'var(--rt-color-text)',
                                    }}
                                  >
                                    {channelLabel(ch)}
                                  </div>
                                  <div
                                    style={{
                                      fontSize: 'var(--rt-text-2xs)',
                                      color: 'var(--rt-color-text-tertiary)',
                                      fontFamily: 'monospace',
                                    }}
                                  >
                                    {ch.channelId}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td>
                              <div style={{ fontWeight: 'var(--rt-weight-bold)' }}>
                                {compactNumber(ch.totals.views)}
                              </div>
                              <div
                                style={{
                                  fontSize: 'var(--rt-text-2xs)',
                                  color: 'var(--rt-color-text-tertiary)',
                                }}
                              >
                                {totalOrgViews > 0
                                  ? `${((ch.totals.views / totalOrgViews) * 100).toFixed(1)}% org`
                                  : '0%'}
                              </div>
                            </td>
                            <td>{formatWatchTime(ch.totals.watchMinutes)}</td>
                            <td>
                              <span
                                style={{
                                  color:
                                    ch.totals.netSubs > 0
                                      ? 'var(--rt-color-success)'
                                      : ch.totals.netSubs < 0
                                      ? 'var(--rt-color-danger)'
                                      : 'inherit',
                                  fontWeight: 'var(--rt-weight-semibold)',
                                }}
                              >
                                {ch.totals.netSubs >= 0
                                  ? `+${compactNumber(ch.totals.netSubs)}`
                                  : compactNumber(ch.totals.netSubs)}
                              </span>
                            </td>
                            <td>{compactNumber(ch.totals.likes)}</td>
                            <td>{compactNumber(ch.totals.comments)}</td>
                            <td>{ch.videoCount}</td>
                            <td>{compactNumber(avgViews)}</td>
                            <td style={{ textAlign: 'right' }}>
                              <div
                                className="org-analytics-table-actions"
                                style={{ justifyContent: 'flex-end' }}
                              >
                                <Tooltip title="Open Channel Analytics">
                                  <Button
                                    size="small"
                                    variant="outlined"
                                    onClick={() =>
                                      navigate(
                                        `/channel?channel=${encodeURIComponent(ch.channelId)}`
                                      )
                                    }
                                    sx={{
                                      textTransform: 'none',
                                      fontSize: '11px',
                                      px: 1.25,
                                      py: 0.25,
                                      minWidth: 0,
                                      borderRadius: 'var(--rt-radius-pill)',
                                    }}
                                  >
                                    View
                                  </Button>
                                </Tooltip>
                                <Tooltip title="Run Channel Audit">
                                  <Button
                                    size="small"
                                    variant="text"
                                    onClick={() =>
                                      navigate(
                                        `/audit-orchestrator?channel=${encodeURIComponent(ch.channelId)}`
                                      )
                                    }
                                    sx={{
                                      textTransform: 'none',
                                      fontSize: '11px',
                                      px: 1,
                                      py: 0.25,
                                      minWidth: 0,
                                      color: 'var(--rt-color-accent)',
                                    }}
                                  >
                                    Audit
                                  </Button>
                                </Tooltip>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export default OrgAnalyticsPage;

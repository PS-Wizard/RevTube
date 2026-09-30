import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { ListVideo, Play } from 'lucide-react';
import { Button, Card, CardContent, Flex, Grid, Spinner, StatCard, Typography } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import { useOrganization } from '@/hooks/useOrganization';
import { usePlaylistsQuery } from '@/hooks/queries/usePlaylistsQuery';
import { AnalyticsService } from '@/services/analyticsService';
import {
  DASHBOARD_WS_KEY_PENDING,
  REVTUBE_DASHBOARD_WS_ROOT,
  getDashboardWorkspaceKey,
} from '@/utils/dashboardWorkspaceScope';
import { useDashboardStore } from '@/stores/dashboardStore';

interface PlaylistPerformanceWidgetProps {
  channelId: string | null;
  period: number | null;
  customStartDate: Dayjs | null;
  customEndDate: Dayjs | null;
  getEffectiveToken: (channelId: string) => Promise<string | null>;
}

interface PlaylistViews {
  periodViews: Record<string, number>;
}

function parsePlaylistViewsReport(report: {
  columnHeaders: Array<{ name: string }>;
  rows?: Array<Array<string | number>>;
}): Record<string, number> {
  const map: Record<string, number> = {};
  if (!report?.rows?.length) return map;
  const idIdx = report.columnHeaders.findIndex((h) => h.name === 'playlist');
  const viewsIdx = report.columnHeaders.findIndex((h) => h.name === 'playlistViews');
  const startsIdx = report.columnHeaders.findIndex((h) => h.name === 'playlistStarts');
  for (const row of report.rows) {
    const id = String(row[idIdx !== -1 ? idIdx : 0]);
    const views = viewsIdx !== -1 ? Number(row[viewsIdx]) || 0 : 0;
    const starts = startsIdx !== -1 ? Number(row[startsIdx]) || 0 : 0;
    const resolved = views > 0 ? views : starts;
    if (resolved > 0) map[id] = resolved;
  }
  return map;
}

/**
 * Playlist performance: period playlist-views KPI + top playlists by
 * playlist views. Self-managed `playlistViews` report (1 quota unit while
 * visible) + the shared playlists catalog query (same key as `/dashboard`,
 * so a prior visit costs nothing extra). Results stay local — nothing is
 * written to the shared dashboard store.
 */
export function PlaylistPerformanceWidget({
  channelId,
  period,
  customStartDate,
  customEndDate,
  getEffectiveToken,
}: PlaylistPerformanceWidgetProps): React.ReactElement {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { currentOrganization, isPersonalContext } = useOrganization();
  const latestDataDate = useDashboardStore((s) => s.dateRange.latestDataDate);

  const catalog = usePlaylistsQuery({ channelId, getEffectiveToken, enabled: !!channelId });
  const catalogItems = React.useMemo(() => catalog.data ?? [], [catalog.data]);
  const titleById = React.useMemo(
    () => new Map(catalogItems.map((p) => [p.id, p.title])),
    [catalogItems],
  );

  // Drain the (usually small) catalog so the ranking covers every playlist.
  const { hasNextPage, fetchNextPage } = catalog;
  React.useEffect(() => {
    if (!hasNextPage || !fetchNextPage) return;
    let cancelled = false;
    let guard = 0;
    const drain = async () => {
      let next: boolean = hasNextPage;
      while (next && !cancelled && guard < 50) {
        guard += 1;
        const result = await fetchNextPage();
        next = result?.hasNextPage ?? false;
      }
    };
    void drain();
    return () => {
      cancelled = true;
    };
  }, [hasNextPage, fetchNextPage]);

  const startD = customStartDate?.isValid() ? customStartDate : null;
  const endD = customEndDate?.isValid() ? customEndDate : null;
  const hasCustom = !!(startD && endD);
  const endRef = latestDataDate ? dayjs(latestDataDate) : dayjs();
  const endStr = hasCustom ? endD!.format('YYYY-MM-DD') : endRef.format('YYYY-MM-DD');
  const startStr = hasCustom
    ? startD!.format('YYYY-MM-DD')
    : endRef.subtract((period ?? 30) - 1, 'day').format('YYYY-MM-DD');

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
      'widget-playlist-views',
      channelId,
      startStr,
      endStr,
    ],
    queryFn: async (): Promise<PlaylistViews> => {
      if (!channelId || !user?.email) throw new Error('Missing channel or user');
      const token = await getEffectiveToken(channelId);
      if (!token) throw new Error('No access token available');
      const svc = new AnalyticsService(token, user.email, currentOrganization?.id);
      const base = {
        startDate: startStr,
        endDate: endStr,
        metrics: 'views,playlistViews',
        dimensions: 'playlist',
        sort: '-playlistViews',
        maxResults: 200,
      } as const;
      try {
        const report = await svc.getReport({ ...base, ids: `channel==${channelId}` });
        return { periodViews: parsePlaylistViewsReport(report) };
      } catch {
        const report = await svc.getReport({ ...base, ids: 'channel==MINE' });
        return { periodViews: parsePlaylistViewsReport(report) };
      }
    },
    enabled: !!channelId && !!user?.email,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 2,
    meta: { suppressGlobalErrorToast: true },
  });

  const ranked = React.useMemo(() => {
    const views = query.data?.periodViews ?? {};
    return Object.entries(views)
      .map(([id, periodViews]) => ({
        id,
        title: titleById.get(id) ?? id,
        periodViews,
      }))
      .sort((a, b) => b.periodViews - a.periodViews)
      .slice(0, 5);
  }, [query.data, titleById]);

  const totalViews = React.useMemo(
    () => Object.values(query.data?.periodViews ?? {}).reduce((s, v) => s + v, 0),
    [query.data],
  );
  const maxViews = ranked.length > 0 ? ranked[0].periodViews : 1;
  const loading = query.isLoading || catalog.isLoading;

  return (
    <Card size="sm">
      <CardContent>
        {loading ? (
          <Flex gap={1} alignItems="center" sx={{ minWidth: 0, padding: '8px 0' }}>
            <Spinner size="sm" />
            <Typography variant="caption" noWrap>Loading playlist performance…</Typography>
          </Flex>
        ) : query.error ? (
          <Flex gap={1} alignItems="center" sx={{ minWidth: 0, padding: '8px 0' }}>
            <Typography variant="caption" noWrap sx={{ minWidth: 0, flex: 1 }}>
              Couldn&apos;t load playlist performance.
            </Typography>
            <Button size="sm" variant="outline" onClick={() => query.refetch()}>
              <span>Retry</span>
            </Button>
          </Flex>
        ) : (
          <>
            <Grid container spacing={1.5}>
              <Grid size={{ xs: 6 }}>
                <StatCard
                  label="Playlist views"
                  value={totalViews.toLocaleString()}
                  icon={<Play size={16} />}
                />
              </Grid>
              <Grid size={{ xs: 6 }}>
                <StatCard
                  label="Playlists tracked"
                  value={(catalog.playlistsTotal ?? catalogItems.length).toLocaleString()}
                  icon={<ListVideo size={16} />}
                />
              </Grid>
            </Grid>
            {ranked.length === 0 ? (
              <Typography variant="caption">No playlist views in this period.</Typography>
            ) : (
              <ul className="mt-2 flex min-w-0 flex-col gap-2">
                {ranked.map((row, index) => (
                  <li key={row.id} className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="w-4 shrink-0 text-right text-[11px] font-semibold text-[var(--rt-color-text-tertiary)]">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--rt-color-text)]" title={row.title}>
                        {row.title}
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-[var(--rt-color-text-secondary)]">
                        {row.periodViews.toLocaleString()}
                      </span>
                    </div>
                    <div
                      className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--rt-color-bg-muted)]"
                      role="img"
                      aria-label={`${row.title}: ${row.periodViews.toLocaleString()} playlist views`}
                    >
                      <div
                        className="h-full rounded-full bg-[var(--rt-color-accent)]"
                        style={{ width: `${Math.max(4, Math.round((row.periodViews / maxViews) * 100))}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <Flex gap={1} alignItems="center" sx={{ minWidth: 0, marginTop: 1, justifyContent: 'flex-end' }}>
          <Button size="sm" variant="ghost" onClick={() => navigate('/dashboard?tab=playlistAnalytics')}>
            <span>Open Playlists tab</span>
          </Button>
        </Flex>
      </CardContent>
    </Card>
  );
}

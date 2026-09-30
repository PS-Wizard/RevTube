/**
 * Fetches per-playlist view counts from YouTube Analytics and merges into
 * dashboard store playlists.
 *
 * Two metrics are populated per playlist:
 *   periodViewCount       -- playlistViews  (times the playlist itself was viewed / started)
 *   videoPeriodViewCount  -- views          (total video views of content inside the playlist)
 */

import { useEffect } from 'react';
import dayjs from 'dayjs';
import { useAuth } from './useAuth';
import { useOrganization } from './useOrganization';
import { useDashboardStore } from '../stores/dashboardStore';
import { AnalyticsService } from '../services/analyticsService';

type ReportLike = {
  columnHeaders: Array<{ name: string }>;
  rows?: Array<Array<string | number>>;
};

/**
 * Parses a report row array into the two view maps.
 * playlistViews → periodViewsMap, views → videoViewsMap.
 */
function upsertPlaylistViewsFromReport(
  report: ReportLike,
  periodViewsMap: Record<string, number>,
  videoViewsMap: Record<string, number>
) {
  if (!report.rows || report.rows.length === 0) return;
  const playlistIdIdx = report.columnHeaders.findIndex(h => h.name === 'playlist');
  const playlistViewsIdx = report.columnHeaders.findIndex(h => h.name === 'playlistViews');
  const viewsIdx = report.columnHeaders.findIndex(h => h.name === 'views');
  const startsIdx = report.columnHeaders.findIndex(h => h.name === 'playlistStarts');

  report.rows.forEach(row => {
    const playlistId = String(row[playlistIdIdx !== -1 ? playlistIdIdx : 0]);

    // playlistViews (or fallback to playlistStarts) → periodViewCount
    const playlistViews = playlistViewsIdx !== -1 ? Number(row[playlistViewsIdx]) || 0 : 0;
    const starts = startsIdx !== -1 ? Number(row[startsIdx]) || 0 : 0;
    const resolvedPlaylistViews = playlistViews > 0 ? playlistViews : starts;
    if (resolvedPlaylistViews > 0) periodViewsMap[playlistId] = resolvedPlaylistViews;

    // views → videoPeriodViewCount
    const views = viewsIdx !== -1 ? Number(row[viewsIdx]) || 0 : 0;
    if (views > 0) videoViewsMap[playlistId] = views;
  });
}

interface UseDashboardPlaylistViewsOptions {
  getEffectiveToken: (channelId: string) => Promise<string | null>;
  enabled: boolean;
}

export const useDashboardPlaylistViews = ({
  getEffectiveToken,
  enabled,
}: UseDashboardPlaylistViewsOptions) => {
  const { user } = useAuth();
  const { currentOrganization } = useOrganization();
  const selectedChannel = useDashboardStore(s => s.channel.selectedChannel);
  const activeTab = useDashboardStore(s => s.ui.activeTab);
  const playlists = useDashboardStore(s => s.playlists.playlists);
  const showAllTimeViews = useDashboardStore(s => s.ui.showAllTimeViews);
  const latestDataDate = useDashboardStore(s => s.dateRange.latestDataDate);
  const period = useDashboardStore(s => s.dateRange.period);
  const customStartDate = useDashboardStore(s => s.dateRange.customStartDate);
  const customEndDate = useDashboardStore(s => s.dateRange.customEndDate);
  const setPlaylists = useDashboardStore(s => s.setPlaylists);

  const playlistIdsSig = playlists.map(p => p.id).sort().join('\0');

  useEffect(() => {
    if (!enabled || !user?.email || !selectedChannel || activeTab !== 'playlistAnalytics') return;

    let cancelled = false;
    const requestChannel = selectedChannel;

    const run = async () => {
      const stillCurrent = () =>
        !cancelled && useDashboardStore.getState().channel.selectedChannel === requestChannel;

      try {
        if (useDashboardStore.getState().playlists.playlists.length === 0) return;

        const tokenToUse = await getEffectiveToken(requestChannel);
        if (!tokenToUse || !stillCurrent()) return;

        const svc = new AnalyticsService(tokenToUse, user.email!, currentOrganization?.id);
        const endRefDate = latestDataDate ? new Date(latestDataDate) : new Date();
        const periodEnd = customEndDate
          ? dayjs(customEndDate).format('YYYY-MM-DD')
          : endRefDate.toISOString().split('T')[0];
        const periodStart = showAllTimeViews
          ? '2005-01-01'
          : customStartDate && customEndDate
            ? dayjs(customStartDate).format('YYYY-MM-DD')
            : (() => {
                const d = new Date(endRefDate);
                d.setDate(d.getDate() - ((period ?? 30) - 1));
                return d.toISOString().split('T')[0];
              })();

        // playlistViews → periodViewCount, views → videoPeriodViewCount
        const periodViewsMap: Record<string, number> = {};
        const videoViewsMap: Record<string, number> = {};
        const channelIds = `channel==${requestChannel}`;

        try {
          const topPlaylistsReport = await svc.getReport({
            ids: channelIds,
            startDate: periodStart,
            endDate: periodEnd,
            metrics: 'views,playlistViews',
            dimensions: 'playlist',
            sort: '-playlistViews',
            maxResults: 200,
          });
          upsertPlaylistViewsFromReport(topPlaylistsReport, periodViewsMap, videoViewsMap);
        } catch {
          const mineReport = await svc.getReport({
            ids: 'channel==MINE',
            startDate: periodStart,
            endDate: periodEnd,
            metrics: 'views,playlistViews',
            dimensions: 'playlist',
            sort: '-playlistViews',
            maxResults: 200,
          });
          upsertPlaylistViewsFromReport(mineReport, periodViewsMap, videoViewsMap);
        }

        const currentList = useDashboardStore.getState().playlists.playlists;
        const missingPlaylistIds = currentList
          .map(p => p.id)
          .filter(id => periodViewsMap[id] === undefined);

        if (missingPlaylistIds.length > 0) {
          // Single batched call with all missing playlist IDs -- one API call for all,
          // using dimensions: 'playlist' (same as the top report). This keeps quota cost
          // at exactly 1 per tab click regardless of how many playlists are missing.
          try {
            const report = await svc.getReport({
              ids: channelIds,
              startDate: periodStart,
              endDate: periodEnd,
              metrics: 'views,playlistViews',
              dimensions: 'playlist',
              filters: `playlist==${missingPlaylistIds.join(',')}`,
            });
            upsertPlaylistViewsFromReport(report, periodViewsMap, videoViewsMap);
          } catch {
            // Per-playlist fallback if the batch call fails (e.g. too many IDs for the API)
            for (const playlistId of missingPlaylistIds) {
              try {
                const report = await svc.getReport({
                  ids: channelIds,
                  startDate: periodStart,
                  endDate: periodEnd,
                  metrics: 'views,playlistViews',
                  dimensions: 'day',
                  filters: `playlist==${playlistId}`,
                });
                const plViewsIdx = report.columnHeaders.findIndex(h => h.name === 'playlistViews');
                const vIdx = report.columnHeaders.findIndex(h => h.name === 'views');
                if (report.rows && report.rows.length > 0) {
                  if (plViewsIdx !== -1) {
                    const total = report.rows.reduce(
                      (sum, row) => sum + (Number(row[plViewsIdx]) || 0),
                      0
                    );
                    if (total > 0) periodViewsMap[playlistId] = total;
                  }
                  if (vIdx !== -1) {
                    const total = report.rows.reduce(
                      (sum, row) => sum + (Number(row[vIdx]) || 0),
                      0
                    );
                    if (total > 0) videoViewsMap[playlistId] = total;
                  }
                }
              } catch {
                /* per-playlist fallback is best-effort */
              }
            }
          }
        }

        if (!stillCurrent()) return;

        const countKey = showAllTimeViews ? 'allTimeViewCount' : 'periodViewCount';
        setPlaylists(
          useDashboardStore.getState().playlists.playlists.map(p => ({
            ...p,
            [countKey]: periodViewsMap[p.id] ?? 0,
            videoPeriodViewCount: videoViewsMap[p.id],
          }))
        );
      } catch (err) {
        console.error('[PlaylistAnalytics] Failed to fetch playlist views:', err);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [
    enabled,
    user?.email,
    selectedChannel,
    activeTab,
    playlistIdsSig,
    showAllTimeViews,
    latestDataDate,
    period,
    customStartDate,
    customEndDate,
    getEffectiveToken,
    currentOrganization?.id,
    setPlaylists,
  ]);
};

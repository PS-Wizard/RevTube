import React from 'react';
import type { UseCustomDashboard } from '../useCustomDashboard';
import { ChannelKpisWidget } from './widgets/ChannelKpisWidget';
import { AudienceWidget } from './widgets/AudienceWidget';
import { InsightsWidget } from './widgets/InsightsWidget';
import { GoalsWidget } from './widgets/GoalsWidget';
import { AnomaliesWidget } from './widgets/AnomaliesWidget';
import { VideoPerformanceWidget } from './widgets/VideoPerformanceWidget';
import { PlaylistPerformanceWidget } from './widgets/PlaylistPerformanceWidget';
import { TopVideosWidget } from './widgets/TopVideosWidget';
import { TopPlaylistsWidget } from './widgets/TopPlaylistsWidget';
import { CustomKpiWidget } from './widgets/CustomKpiWidget';
import { isCustomWidgetId } from '@/stores/customCardsStore';

interface WidgetHostProps {
  id: string;
  dashboard: UseCustomDashboard;
}

/** Maps a widget id to its adapter. Unknown ids render nothing (registry owns ids). */
export function WidgetHost({ id, dashboard }: WidgetHostProps): React.ReactElement | null {
  switch (id) {
    case 'channel-kpis':
      return (
        <ChannelKpisWidget
          data={dashboard.channelKpis.data}
          chartData={dashboard.channelKpis.chartData}
          multiPeriodStats={dashboard.channelKpis.multiPeriodStats}
          period={dashboard.period}
          customStartDate={dashboard.customStartDate}
          customEndDate={dashboard.customEndDate}
          bundleLoading={dashboard.channelKpis.bundleLoading}
          loadingChannelAnalytics={dashboard.channelKpis.loadingChannelAnalytics}
          trueDeltaEnabled={dashboard.channelKpis.trueDeltaEnabled}
          setTrueDeltaEnabled={dashboard.channelKpis.setTrueDeltaEnabled}
          channelTitle={dashboard.currentChannelName}
          formattedLatestDate={dashboard.formattedLatestDate}
        />
      );
    case 'audience':
      return (
        <AudienceWidget
          dimensionsMultiPeriod={dashboard.audience.dimensionsMultiPeriod}
          primaryPeriod={dashboard.audience.primaryPeriod}
          loading={dashboard.audience.loading}
          retention={dashboard.audience.retention}
        />
      );
    case 'insights':
      return (
        <InsightsWidget
          data={dashboard.insights.data}
          loading={dashboard.insights.loading}
          formattedLatestDate={dashboard.formattedLatestDate}
          channelTitle={dashboard.currentChannelName}
          channelId={dashboard.selectedChannel}
          period={dashboard.period}
          latestDataDate={dashboard.latestDataDateRaw}
          getEffectiveToken={dashboard.insights.getEffectiveToken}
        />
      );
    case 'goals':
      return (
        <GoalsWidget
          channelId={dashboard.selectedChannel}
          organizationId={dashboard.goals.organizationId}
          canEdit={dashboard.goals.canEdit}
        />
      );
    case 'anomalies':
      return <AnomaliesWidget channelId={dashboard.selectedChannel} />;
    case 'video-performance':
      return (
        <VideoPerformanceWidget
          channelId={dashboard.selectedChannel}
          period={dashboard.period}
          customStartDate={dashboard.customStartDate}
          customEndDate={dashboard.customEndDate}
          getEffectiveToken={dashboard.insights.getEffectiveToken}
          formattedLatestDate={dashboard.formattedLatestDate}
        />
      );
    case 'playlist-performance':
      return (
        <PlaylistPerformanceWidget
          channelId={dashboard.selectedChannel}
          period={dashboard.period}
          customStartDate={dashboard.customStartDate}
          customEndDate={dashboard.customEndDate}
          getEffectiveToken={dashboard.insights.getEffectiveToken}
        />
      );
    case 'top-videos':
      return (
        <TopVideosWidget
          channelId={dashboard.selectedChannel}
          getEffectiveToken={dashboard.insights.getEffectiveToken}
        />
      );
    case 'top-playlists':
      return (
        <TopPlaylistsWidget
          channelId={dashboard.selectedChannel}
          getEffectiveToken={dashboard.insights.getEffectiveToken}
        />
      );
    default:
      if (isCustomWidgetId(id)) {
        return (
          <CustomKpiWidget
            cardId={id}
            channelId={dashboard.selectedChannel}
            period={dashboard.period}
            customStartDate={dashboard.customStartDate}
            customEndDate={dashboard.customEndDate}
            getEffectiveToken={dashboard.insights.getEffectiveToken}
          />
        );
      }
      return null;
  }
}

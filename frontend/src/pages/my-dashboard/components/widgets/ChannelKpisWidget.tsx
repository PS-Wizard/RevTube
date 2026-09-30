import React from 'react';
import type { Dayjs } from 'dayjs';
import { toast } from 'react-hot-toast';
import { ChannelAnalyticsInsights, type ChannelAnalyticsData } from '@/components/dashboard/ChannelAnalyticsInsights';
import { downloadElementAsPNG } from '@/utils/downloadImage';

const EMPTY_CHANNEL_DATA: ChannelAnalyticsData = {
  views: 0,
  subscribersGained: 0,
  subscribersLost: 0,
  watchTime: 0,
  likes: 0,
  comments: 0,
  videosUploaded: 0,
  averageViewDuration: 0,
  engagedViews: 0,
  viewerPercentage: 0,
  cardImpressions: 0,
  cardClicks: 0,
  cardClickRate: 0,
  cardTeaserImpressions: 0,
  cardTeaserClicks: 0,
  cardTeaserClickRate: 0,
  averageConcurrentViewers: 0,
  peakConcurrentViewers: 0,
};

interface ChannelKpisWidgetProps {
  data: unknown;
  chartData: unknown;
  multiPeriodStats: unknown;
  period: number | null;
  customStartDate: Dayjs | null;
  customEndDate: Dayjs | null;
  bundleLoading: boolean;
  loadingChannelAnalytics: boolean;
  trueDeltaEnabled: boolean;
  setTrueDeltaEnabled: (enabled: boolean) => void;
  channelTitle: string;
  formattedLatestDate: string | null;
}

export function ChannelKpisWidget(props: ChannelKpisWidgetProps): React.ReactElement {
  const {
    data, chartData, multiPeriodStats, period,
    customStartDate, customEndDate, bundleLoading, loadingChannelAnalytics,
    trueDeltaEnabled, setTrueDeltaEnabled, channelTitle, formattedLatestDate,
  } = props;
  const widgetRef = React.useRef<HTMLDivElement | null>(null);

  const handleDownload = React.useCallback(async () => {
    if (!widgetRef.current) return;
    try {
      await downloadElementAsPNG(
        widgetRef.current,
        `${channelTitle}_Channel_Analytics_${new Date().toISOString().split('T')[0]}`,
      );
      toast.success('Channel analytics downloaded successfully');
    } catch {
      toast.error('Failed to download channel analytics');
    }
  }, [channelTitle]);

  const channelData: ChannelAnalyticsData =
    data && typeof data === 'object' && !('rows' in data) && 'videosUploaded' in data
      ? (data as ChannelAnalyticsData)
      : EMPTY_CHANNEL_DATA;

  return (
    <ChannelAnalyticsInsights
      channelAnalyticsData={channelData}
      channelAnalyticsChartData={
        (chartData as Array<{ date: string; [key: string]: string | number | undefined }>) ?? []
      }
      channelMultiPeriodStats={(multiPeriodStats ?? null) as never}
      channelAnalyticsPeriod={period}
      customStartDate={customStartDate}
      customEndDate={customEndDate}
      bundleLoading={bundleLoading}
      loadingChannelAnalytics={loadingChannelAnalytics}
      videosCatalogFetching={false}
      trueDeltaEnabled={trueDeltaEnabled}
      setTrueDeltaEnabled={setTrueDeltaEnabled}
      channelTitle={channelTitle}
      formattedLatestDate={formattedLatestDate}
      onDownloadChannelAnalytics={handleDownload}
      channelAnalyticsWidgetRef={widgetRef}
    />
  );
}

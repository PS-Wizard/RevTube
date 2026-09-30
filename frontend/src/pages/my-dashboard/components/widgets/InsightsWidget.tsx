import React from 'react';
import { InsightsPanel } from '@/components/dashboard/InsightsPanel';
import type { InsightsData } from '@/types/dashboard';

interface InsightsWidgetProps {
  data: InsightsData | null;
  loading: boolean;
  formattedLatestDate: string | null;
  channelTitle: string;
  channelId: string | null;
  period: number | null;
  latestDataDate: string | null;
  getEffectiveToken: (channelId: string) => Promise<string | null>;
}

export function InsightsWidget(props: InsightsWidgetProps): React.ReactElement {
  const {
    data, loading, formattedLatestDate, channelTitle,
    channelId, period, latestDataDate, getEffectiveToken,
  } = props;
  return (
    <InsightsPanel
      insightsData={data}
      loading={loading}
      formattedLatestDate={formattedLatestDate}
      channelTitle={channelTitle}
      channelId={channelId}
      period={period}
      latestDataDate={latestDataDate}
      getEffectiveToken={getEffectiveToken}
    />
  );
}

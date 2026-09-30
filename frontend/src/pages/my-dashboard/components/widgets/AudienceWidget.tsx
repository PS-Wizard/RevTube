import React from 'react';
import { AudienceBreakdownPanel } from '@/components/dashboard/AudienceBreakdownPanel';
import type { DimensionsMultiPeriodData } from '@/utils/dashboardUtils';
import type { RetentionByHourData } from '@/types/dashboard';
import { downloadElementAsPNG } from '@/utils/downloadImage';

interface AudienceWidgetProps {
  dimensionsMultiPeriod: unknown;
  primaryPeriod: 7 | 30 | 90;
  loading: boolean;
  retention: RetentionByHourData | null;
}

export function AudienceWidget(props: AudienceWidgetProps): React.ReactElement {
  const { dimensionsMultiPeriod, primaryPeriod, loading, retention } = props;
  const panelRef = React.useRef<HTMLDivElement | null>(null);

  const handleDownload = React.useCallback(async () => {
    if (!panelRef.current) return;
    await downloadElementAsPNG(panelRef.current, 'Audience_Breakdown');
  }, []);

  return (
    <AudienceBreakdownPanel
      dimensionsMultiPeriod={(dimensionsMultiPeriod as DimensionsMultiPeriodData | null) ?? null}
      primaryPeriod={primaryPeriod}
      loading={loading}
      onDownload={handleDownload}
      dimensionsPanelRef={panelRef}
      retention={retention}
    />
  );
}

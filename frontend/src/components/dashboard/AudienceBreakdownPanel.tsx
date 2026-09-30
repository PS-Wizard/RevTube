import React, { useState } from 'react';
import { DimensionsPanel } from '../DimensionsPanel';
import { RetentionSection } from './InsightsPanel';
import { PinToDashboardButton } from './pin-to-dashboard';
import type { DimensionsMultiPeriodData } from '../../utils/dashboardUtils';
import type { RetentionByHourData } from '../../types/dashboard';
import './InsightsPanel.css';

interface AudienceBreakdownPanelProps {
  dimensionsMultiPeriod: DimensionsMultiPeriodData | null;
  primaryPeriod: 7 | 30 | 90;
  loading: boolean;
  onDownload: () => void;
  dimensionsPanelRef: React.RefObject<HTMLDivElement | null>;
  retention?: RetentionByHourData | null;
}

export const AudienceBreakdownPanel: React.FC<AudienceBreakdownPanelProps> = ({
  dimensionsMultiPeriod,
  primaryPeriod,
  loading,
  onDownload,
  dimensionsPanelRef,
  retention,
}) => {
  const [retentionNormalized, setRetentionNormalized] = useState(true);

  return (
    <div className="content-section">
      <DimensionsPanel
        ref={dimensionsPanelRef}
        multiPeriod={dimensionsMultiPeriod}
        primaryPeriod={primaryPeriod}
        loading={loading}
        onDownload={onDownload}
        headerActions={<PinToDashboardButton widgetId="audience" />}
      />

      {retention && (
        <div className="content-section" style={{ marginTop: '1.5rem' }}>
          <RetentionSection
            data={retention}
            defaultNormalized={retentionNormalized}
            onNormalizedChange={setRetentionNormalized}
          />
        </div>
      )}
    </div>
  );
};

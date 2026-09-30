import React from 'react';
import { GoalsOverviewBanner } from '@/components/goals/GoalsOverviewBanner';

interface GoalsWidgetProps {
  channelId: string | null;
  organizationId?: string | null;
  canEdit?: boolean;
}

export function GoalsWidget(props: GoalsWidgetProps): React.ReactElement {
  return <GoalsOverviewBanner {...props} />;
}

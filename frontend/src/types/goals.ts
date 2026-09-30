/**
 * Types for Channel Goals & Real-Time Pacing System
 */

export type GoalMetric = 'views' | 'subscribers' | 'ctr' | 'engagement_rate' | 'retention';

export type GoalPeriodType =
  | 'weekly'
  | 'monthly'
  | '90_days'
  | 'quarterly'
  | 'half_yearly'
  | 'yearly'
  | 'custom';

export type GoalStatus =
  | 'met'
  | 'missed'
  | 'ahead'
  | 'on_track'
  | 'behind'
  | 'upcoming';

/** Anomaly event detected in daily metric data */
export interface AnomalyEvent {
  date: string;
  prevDate: string;
  delta: number;
  kind: 'spike' | 'dip';
  driverVideoId?: string;
  driverVideoTitle?: string;
  driverDelta?: number;
  driverThumbnailUrl?: string;
  excludedFromBaseline: boolean;
}

/** Adaptive baseline calculated from trailing 4-week anomaly-free data */
export interface AdaptiveBaseline {
  velocity: number;
  calculatedAt: string; // ISO date of Monday rebaseline
  anomalyFreeDays: number;
  trailingWindowDays: 28;
}

/** Adaptive projection using rebaselined velocity */
export interface AdaptiveProjection {
  projectedValue: number;
  requiredDailyVelocity: number;
  pacingRatio: number;
  trajectory: TrajectoryPoint[];
  baseline: AdaptiveBaseline;
}

export interface TrajectoryPoint {
  date: string;
  day: number;
  targetLinearExpected: number;
  actualCumulative: number | null;
  // Adaptive pacing fields (optional, present when adaptive pacing enabled)
  adaptiveExpected?: number;
  adaptiveCumulative?: number;
}

/** Goal with adaptive pacing data attached */
export interface GoalWithAdaptive extends Goal {
  adaptiveProjection?: AdaptiveProjection;
  anomalies: AnomalyEvent[];
  hasAdaptiveData: boolean;
}

export interface Goal {
  id: number;
  channelId: string;
  organizationId: string | null;
  createdBy: string;
  title: string | null;
  metric: GoalMetric;
  periodType: GoalPeriodType;
  periodKey: string | null;
  startDate: string;
  endDate: string;
  targetValue: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;

  // Calculated pacing fields (from backend)
  actualValue: number;
  progressPercentage: number;
  timeElapsedPercentage: number;
  totalDays: number;
  daysElapsed: number;
  daysRemaining: number;
  expectedValueToDate: number;
  pacingRatio: number;
  projectedValue: number;
  currentDailyVelocity: number;
  requiredDailyVelocity: number;
  status: GoalStatus;
  pacingLabel: string;
  isPast: boolean;
  isUpcoming: boolean;
  isActive: boolean;
  trajectory: TrajectoryPoint[];

  // Adaptive pacing fields (from backend)
  anomalies?: AnomalyEvent[];
  adaptiveProjection?: AdaptiveProjection;
  hasAdaptiveData?: boolean;
}

export interface GoalSummary {
  total: number;
  active: number;
  met: number;
  missed: number;
  ahead: number;
  onTrack: number;
  behind: number;
  upcoming: number;
  topActiveGoals: Goal[];
}

export interface CreateGoalInput {
  channelId: string;
  organizationId?: string | null;
  title?: string;
  metric: GoalMetric;
  periodType: GoalPeriodType;
  periodKey?: string;
  startDate: string;
  endDate: string;
  targetValue: number;
  notes?: string;
}

export interface UpdateGoalInput {
  title?: string;
  metric?: GoalMetric;
  periodType?: GoalPeriodType;
  periodKey?: string;
  startDate?: string;
  endDate?: string;
  targetValue?: number;
  notes?: string;
}

export interface PeriodPreset {
  label: string;
  periodType: GoalPeriodType;
  periodKey: string;
  startDate: string;
  endDate: string;
}

// Labels & helpers
export const METRIC_LABELS: Record<GoalMetric, string> = {
  views: 'Views',
  subscribers: 'Subscribers',
  ctr: 'Click-Through Rate',
  engagement_rate: 'Engagement Rate',
  retention: 'Retention',
};

export const METRIC_UNITS: Record<GoalMetric, string> = {
  views: '',
  subscribers: '',
  ctr: '%',
  engagement_rate: '%',
  retention: '%',
};

export const PERIOD_TYPE_LABELS: Record<GoalPeriodType, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  '90_days': '90 Days',
  quarterly: 'Quarterly',
  half_yearly: 'Half Year',
  yearly: 'Yearly',
  custom: 'Custom',
};

export const STATUS_LABELS: Record<GoalStatus, string> = {
  met: 'Goal Met',
  missed: 'Goal Missed',
  ahead: 'Ahead of Pace',
  on_track: 'On Track',
  behind: 'Behind Pace',
  upcoming: 'Upcoming',
};

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  MdArrowBack,
  MdEdit,
  MdDelete,
  MdTrendingUp,
  MdTrendingDown,
  MdTrendingFlat,
  MdCancel,
  MdSchedule,
  MdEmojiEvents,
  MdBarChart,
  MdPeople,
  MdAdsClick,
  MdThumbUp,
  MdInsights,
  MdFlag,
  MdWarning,
  MdCheckCircle,
  MdTune,
  MdAutoGraph,
  MdDateRange,
} from 'react-icons/md';
import { EChartsComposedChart } from '../../components/evilcharts/charts/echarts-composed-chart';
import { EChartsBarChart } from '../../components/evilcharts/charts/echarts-bar-chart';
import { EChartsPieChart } from '../../components/evilcharts/charts/echarts-pie-chart';
import type { ChartConfig } from '../../components/evilcharts/ui/echarts-chart';
import { cssVar, tooltipShellStyle, useEvilThemeKey } from '../../components/evilcharts/ui/echarts-chart';
import { toast } from 'react-hot-toast';
import { useOrganization } from '../../hooks/useOrganization';
import { useAuth } from '../../hooks/useAuth';
import { getGoal, updateGoal, deleteGoal } from '../../services/goalsService';
import { AnalyticsService } from '../../services/analyticsService';
import { getFirebaseIdToken } from '../../services/authHeaders';
import type { GoalWithAdaptive, GoalMetric, GoalPeriodType, GoalStatus, UpdateGoalInput, AnomalyEvent } from '../../types/goals';
import { METRIC_LABELS, METRIC_UNITS, STATUS_LABELS, PERIOD_TYPE_LABELS } from '../../types/goals';
import type { SubFrame, SubFrameConfig, SubFrameGranularity } from '../../components/goals/milestones';
import {
  supportsSubFrames,
  defaultSubFrameConfig,
  computeSubFrames,
  getGrowthSummary,
} from '../../components/goals/milestones';
import { CreateGoalModal } from '../../components/goals/CreateGoalModal';
import { ConfirmModal } from '../../components/ConfirmModal';
import { useForecast } from '../../hooks/useForecast';
import { fetchGoalBaseline } from '../../utils/forecasting/fetchGoalBaseline';
import {
  goalMetricToForecast,
  isLevelGoalMetric,
} from '../../utils/forecasting/goalForecast';
import { Badge, Box, Button, Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle, Flex, Grid, Progress, Stack, Typography } from '../../components/ui';
import './GoalDetailPage.css';

type ChartViewMode = 'cumulative' | 'subframe' | 'daily';
type ChartFrequency = 'daily' | 'monthly' | 'quarterly';
type SeriesKey = 'actual' | 'forecast' | 'targetLinear' | 'adaptiveExpected' | 'lastYear';

/** All plot-able series on the cumulative chart, each with a distinct color
 *  (previously 'actual' and 'forecast' both used --rt-color-accent, making two
 *  curves indistinguishable) plus a dashed style + the label used in the
 *  custom hover tooltip and the per-series toggle chase. */
const SERIES_META: Record<SeriesKey, { label: string; color: string; dash?: string; width: number }> = {
  actual: { label: 'Actual Performance', color: 'var(--rt-color-accent)', width: 2.5 },
  forecast: { label: 'Projected', color: 'var(--rt-color-warning)', dash: '6 3', width: 2 },
  targetLinear: { label: 'Linear Pace', color: 'var(--rt-color-info)', dash: '3 3', width: 1.5 },
  adaptiveExpected: { label: 'Adaptive Forecast', color: 'var(--rt-color-success)', dash: '5 5', width: 2 },
  lastYear: { label: 'Previous period', color: 'var(--rt-color-text-secondary)', dash: '2 6', width: 1.5 },
};
const ALL_SERIES = Object.keys(SERIES_META) as SeriesKey[];

/** Canvas paint keys resolved from design tokens inside the component
 *  (ECharts cannot read CSS vars; hex literals there are fallbacks only). */

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Human label for the previous-comparison series, derived from the goal's own
 *  period type (so a monthly goal compares to the previous MONTH, a quarterly
 *  goal to the previous QUARTER, not always "last year"). */
function previousPeriodLabel(periodType: GoalPeriodType): string {
  switch (periodType) {
    case 'weekly': return 'Previous week';
    case 'monthly': return 'Previous month';
    case '90_days': return 'Previous 90 days';
    case 'quarterly': return 'Previous quarter';
    case 'half_yearly': return 'Previous 6 months';
    case 'yearly': return 'Previous year';
    default: return 'Previous period';
  }
}

function formatNumber(value: number, metric: GoalMetric): string {
  const unit = METRIC_UNITS[metric];
  if (metric === 'ctr' || metric === 'engagement_rate' || metric === 'retention') {
    return `${value.toFixed(2)}${unit}`;
  }
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

function formatDateShort(iso: string): string {
  if (!iso) return '';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getMetricIcon(metric: GoalMetric) {
  switch (metric) {
    case 'views': return <MdBarChart size={24} />;
    case 'subscribers': return <MdPeople size={24} />;
    case 'ctr': return <MdAdsClick size={24} />;
    case 'engagement_rate': return <MdThumbUp size={24} />;
    case 'retention': return <MdInsights size={24} />;
    default: return <MdBarChart size={24} />;
  }
}

function getStatusIcon(status: GoalStatus) {
  switch (status) {
    case 'met': return <MdEmojiEvents size={14} />;
    case 'missed': return <MdCancel size={14} />;
    case 'ahead': return <MdTrendingUp size={14} />;
    case 'on_track': return <MdTrendingFlat size={14} />;
    case 'behind': return <MdTrendingDown size={14} />;
    case 'upcoming': return <MdSchedule size={14} />;
  }
}

export function GoalDetailPage(): React.ReactElement {
  const { goalId } = useParams<{ goalId: string }>();
  const navigate = useNavigate();
  const { currentOrganization, isPersonalContext, canEdit } = useOrganization();
  const { user, getValidToken, accessToken } = useAuth();

  const [goal, setGoal] = useState<GoalWithAdaptive | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState<boolean>(false);
  const [chartView, setChartView] = useState<ChartViewMode>('cumulative');

  // Chart series toggles + data frequency. Default frequency auto-drops to
  // 'monthly' for long goals so the chart stays readable with far fewer points
  // (the same data is already a single report fetch from the backend; this is
  // client-side aggregation to reduce rendered points / API payload size).
  const [visibleSeries, setVisibleSeries] = useState<Set<SeriesKey>>(
    () => new Set<SeriesKey>(['actual', 'forecast']),
  );
  const [frequencyOverride, setFrequencyOverride] = useState<ChartFrequency | null>(null);
  const effectiveFrequency: ChartFrequency =
    frequencyOverride ?? (goal && goal.totalDays > 180 ? 'monthly' : 'daily');

  const toggleSeries = useCallback((key: SeriesKey) => {
    setVisibleSeries((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key); // never hide every series
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const [selectedAnomaly, setSelectedAnomaly] = useState<AnomalyEvent | null>(null);
  const chartSectionRef = useRef<HTMLElement>(null);

  const handleAnomalyClick = useCallback((anomaly: AnomalyEvent) => {
    const isSame = selectedAnomaly?.date === anomaly.date && selectedAnomaly?.kind === anomaly.kind;
    const next = isSame ? null : anomaly;
    setSelectedAnomaly(next);
    setChartView('cumulative');
    setFrequencyOverride('daily');
    setVisibleSeries((prev) => {
      const n = new Set(prev);
      n.add('actual');
      return n;
    });
    // scroll graph into view
    setTimeout(() => chartSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  }, [selectedAnomaly]);

  // Sub-frame config
  const [subFrameConfig, setSubFrameConfig] = useState<SubFrameConfig | null>(null);
  const [subFrames, setSubFrames] = useState<SubFrame[]>([]);
  const [showSubFrameSettings, setShowSubFrameSettings] = useState<boolean>(false);
  const [startFromCurrent, setStartFromCurrent] = useState<boolean>(false);
  const [baseline, setBaseline] = useState<number>(0);
  const [historyAdds, setHistoryAdds] = useState<number[]>([]);
  const [historyDaily, setHistoryDaily] = useState<Array<{ date: string; value: number }>>([]);

  const loadGoal = useCallback(async () => {
    if (!goalId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getGoal(goalId, isPersonalContext ? null : currentOrganization?.id);
      const goalData = data as GoalWithAdaptive;
      setGoal(goalData);
      // Views / Subscribers start from the channel's lifetime total; % metrics
      // start from the current rate baseline. Either way the trajectory should
      // be anchored at the baseline (current), never from absolute zero.
      setStartFromCurrent(true);
      const initialConfig = {
        ...defaultSubFrameConfig(goalData),
        startFromCurrent: true,
      };
      setSubFrameConfig(initialConfig);
      setSubFrames(computeSubFrames(goalData, initialConfig));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load goal details';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [goalId, isPersonalContext, currentOrganization?.id]);

  useEffect(() => {
    loadGoal();
  }, [loadGoal]);

  useEffect(() => {
    const email = user?.email;
    if (!goal?.channelId || !email) return;
    let cancelled = false;
    (async () => {
      try {
        // Org channels: member has no personal OAuth token for them — fall back
        // to the Firebase token (and, if the member has no personal YouTube
        // token at all, the raw Firebase ID token) and let resolveOrgToken swap
        // in the org token via X-Org-Id on the backend.
        const token =
          (await getValidToken(goal.channelId)) ??
          accessToken ??
          (isPersonalContext ? null : await getFirebaseIdToken().catch(() => null));
        if (!token || cancelled) return;
        const svc = new AnalyticsService(
          token,
          email,
          isPersonalContext ? undefined : currentOrganization?.id,
        );
        const snap = await fetchGoalBaseline(
          svc,
          goal.channelId,
          goal.metric,
          goal.startDate.slice(0, 10),
          subFrameConfig?.granularity ?? 'quarters',
        );
        if (cancelled) return;
        setBaseline(snap.current);
        setHistoryAdds(snap.historyAdds);
        setHistoryDaily(snap.daily);
      } catch {
        if (!cancelled) {
          setBaseline(0);
          setHistoryAdds([]);
          setHistoryDaily([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [goal?.channelId, goal?.metric, goal?.startDate, subFrameConfig?.granularity, user?.email, getValidToken, isPersonalContext, currentOrganization?.id, accessToken]);

  useEffect(() => {
    if (!goal || !subFrameConfig) return;
    const next = {
      ...subFrameConfig,
      startFromCurrent,
      baseline: startFromCurrent ? baseline : 0,
      historyAdds,
      integerAdds: goal.metric === 'views' || goal.metric === 'subscribers',
    };
    setSubFrameConfig(next);
    setSubFrames(computeSubFrames(goal, next));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute on baseline inputs only
  }, [goal, startFromCurrent, baseline, historyAdds]);

  const handleUpdateGoal = async (input: UpdateGoalInput) => {
    if (!goal) return;
    try {
      await updateGoal(goal.id, input, isPersonalContext ? null : currentOrganization?.id);
      toast.success('Goal updated successfully');
      setIsEditModalOpen(false);
      await loadGoal();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update goal';
      toast.error(msg);
      throw err;
    }
  };

  const handleDeleteGoal = async () => {
    if (!goal) return;
    try {
      await deleteGoal(goal.id, isPersonalContext ? null : currentOrganization?.id);
      toast.success('Goal deleted');
      navigate('/goals');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete goal';
      toast.error(msg);
    }
  };

  const handleGranularityChange = (g: SubFrameGranularity) => {
    if (!goal || !subFrameConfig) return;
    const newConfig = {
      ...subFrameConfig,
      granularity: g,
      startFromCurrent,
      baseline: startFromCurrent ? baseline : 0,
      historyAdds,
    };
    setSubFrameConfig(newConfig);
    setSubFrames(computeSubFrames(goal, newConfig));
  };

  const actualSeries = useMemo(() => {
    if (!goal?.trajectory) return { values: [] as number[], lastDate: undefined as string | undefined };
    const pts = goal.trajectory.filter((p) => p.actualCumulative !== null && p.actualCumulative !== undefined);
    return {
      values: pts.map((p) => p.actualCumulative as number),
      lastDate: pts[pts.length - 1]?.date,
    };
  }, [goal]);

  const forecastInput = useMemo(() => {
    const goal_ = goal;
    if (!goal_) return { series: [] as number[], lastDate: undefined as string | undefined, gainSpace: false };
    const gainSpace = !isLevelGoalMetric(goal_.metric);
    if (!gainSpace) {
      // Level metrics: feed realized level values directly to the models.
      return { series: actualSeries.values, lastDate: actualSeries.lastDate, gainSpace };
    }
    // Cumulative metrics: forecast DAILY GAINS (stationary-ish), not the
    // cumulative curve -- much better model fit and seasonality handling.
    const gains: number[] = [];
    let prev = 0;
    for (const v of actualSeries.values) {
      gains.push(v - prev);
      prev = v;
    }
    return { series: gains, lastDate: actualSeries.lastDate, gainSpace };
  }, [goal, actualSeries]);

  const forecast = useForecast(
    forecastInput.series,
    goal ? goalMetricToForecast(goal.metric) : 'views',
    Math.max(0, goal?.daysRemaining ?? 0),
    forecastInput.lastDate,
  );

  // Previous-period comparison, aligned to the GOAL's own duration. The window
  // immediately preceding the goal start (same length as the goal:
  // month goal -> previous month, quarter goal -> previous quarter, etc.) is
  // aggregated as a CUMULATIVE curve over {1..totalDays}, so each trajectory
  // day maps to the comparable day of the prior window. For cumulative metrics
  // this ramps from the previous period's first value up to its full total; for
  // level metrics it emits the prior window's daily level.
  const previousPeriodByDay = useMemo(() => {
    const map = new Map<number, number>();
    if (!goal || historyDaily.length === 0) return map;
    const level = isLevelGoalMetric(goal.metric);
    const totalDays = Math.max(1, goal.totalDays || 1);
    const dayMs = 86_400_000;
    const startIdx = Math.floor(Date.parse(`${goal.startDate.slice(0, 10)}T00:00:00Z`) / dayMs);
    const baseIdx = startIdx - totalDays; // day index one full window before start
    const valByDate = new Map(historyDaily.map((d) => [d.date, d.value]));
    const dayDate = (idx: number) => new Date(idx * dayMs).toISOString().slice(0, 10);
    let running = 0;
    // Only render the comparison curve when the prior window actually has
    // data. Otherwise the running sum stays 0 and every chart point would get
    // `0 + actualBase` — a misleading FLAT line sitting exactly on the
    // lifetime baseline (the "14.2k straight line" bug). With no prior data
    // the series is simply hidden and the delta stat shows "—".
    let sawData = false;
    for (let i = 1; i <= totalDays; i++) {
      const v = valByDate.get(dayDate(baseIdx + (i - 1)));
      if (v === undefined) continue;
      sawData = true;
      if (level) running = v;
      else running += v;
      map.set(i, running);
    }
    return sawData ? map : new Map<number, number>();
  }, [goal, historyDaily]);

  // Probable-forecast rows keyed by date. Preference order:
  //   1. Client-side statistical model (Holt/SMA/linear selected by backtest)
  //   2. Velocity-based straight-line projection from the backend
  //      (projectedValue/currentDailyVelocity) -- guarantees the "Projected"
  //      line renders even for young goals or unsupported metrics like CTR.
  const forecastByDate = useMemo(() => {
    const map = new Map<string, number>();
    if (!goal || forecastInput.lastDate === undefined) return map;

    if (forecast && forecast.points.length > 0) {
      if (forecastInput.gainSpace) {
        let running = actualSeries.values[actualSeries.values.length - 1] ?? 0;
        for (const p of forecast.points) {
          running += p.predicted;
          map.set(p.date, running);
        }
      } else {
        for (const p of forecast.points) map.set(p.date, p.predicted);
      }
      return map;
    }

    // ── Fallback: velocity-based probable forecast (no statistical model ran)
    const daysRemaining = Math.max(0, goal.daysRemaining ?? 0);
    if (daysRemaining <= 0 || actualSeries.values.length === 0) return map;
    const remainingBudget = Math.max(0, (goal.projectedValue ?? 0) - (goal.actualValue ?? 0));
    const dailyStep = remainingBudget / daysRemaining;
    let running = actualSeries.values[actualSeries.values.length - 1] ?? 0;
    // UTC-safe date stepping from the last observed actual
    const cursor = new Date(`${forecastInput.lastDate}T00:00:00.000Z`);
    for (let i = 0; i < daysRemaining; i++) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      running += dailyStep;
      map.set(cursor.toISOString().slice(0, 10), running);
    }
    return map;
  }, [goal, forecast, forecastInput, actualSeries]);

  const originBaseline = useMemo(() => {
    if (!goal) return 0;
    // Level/percentage metrics (CTR, Engagement, Retention) already anchor the
    // trajectory at the realized baseline level via `startFromCurrent`.
    if (isLevelGoalMetric(goal.metric)) {
      if (!startFromCurrent) return 0;
      const firstActual = goal?.trajectory?.find((p) => p.actualCumulative !== null && p.actualCumulative !== undefined)?.actualCumulative;
      return firstActual ?? baseline;
    }
    // Cumulative metrics (Views, Subscribers) track the channel's FULL lifetime
    // total (baseline = statistics.viewCount / subscriberCount), so the pace
    // line anchors at that lifetime value and renders `current → target`
    // (e.g. 3000 → 5000, not 0 → 5000). Never fall back to `actualValue` here:
    // that is the in-window GAIN, and using it as the origin double-counts it
    // in every cumulative card (gain + gain reads like a bogus projection).
    return baseline;
  }, [startFromCurrent, goal, baseline]);

  // Build a map of adaptive expected values by date from the adaptive projection
  // trajectory. The backend stores this separately from the main trajectory.
  const adaptiveByDate = useMemo(() => {
    const map = new Map<string, number>();
    if (goal?.adaptiveProjection?.trajectory) {
      for (const point of goal.adaptiveProjection.trajectory) {
        if (point.adaptiveExpected !== undefined) {
          map.set(point.date, point.adaptiveExpected);
        }
      }
    }
    return map;
  }, [goal?.adaptiveProjection?.trajectory]);

  const trajectoryChartData = useMemo(() => {
    if (!goal || !goal.trajectory) return [];
    const isRateOrPct = isLevelGoalMetric(goal.metric);
    const round = (v: number) => (isRateOrPct ? Number(v.toFixed(2)) : Math.round(v));
    const totalDays = Math.max(1, goal.totalDays);
    const target = goal.targetValue;
    const lastActual = [...goal.trajectory].reverse().find((p) => p.actualCumulative !== null && p.actualCumulative !== undefined);
    // Seed the chart with the goal's starting point (day 0) so the graph
    // begins at the initial current value instead of the first ingested day.
    const actualBase = !isLevelGoalMetric(goal.metric) ? originBaseline : 0;
    // Comparison curve base: the lifetime value at the START of the previous
    // period (originBaseline minus the prior window's gain). The prior curve
    // then aggregates exactly like the current one and lands on the current
    // initial value at its final day — a true "same period before" overlay.
    const priorTotal = previousPeriodByDay.get(totalDays);
    const priorBase = !isLevelGoalMetric(goal.metric) && priorTotal !== undefined
      ? Math.max(0, originBaseline - priorTotal)
      : 0;
    const startPoint = {
      date: goal.startDate.slice(0, 10) ? `${goal.startDate.slice(5, 7)}/${goal.startDate.slice(8, 10)}` : 'Start',
      fullDate: goal.startDate.slice(0, 10),
      day: 0,
      targetLinear: round(originBaseline),
      actual: round(actualBase || baseline),
      adaptiveExpected: null as number | null,
      forecast: round(actualBase || baseline),
      lastYear: priorBase > 0 ? round(priorBase) : null as number | null,
      isStart: true,
    };
    const points = goal.trajectory.map((point) => {
      const t = point.day / totalDays;
      const linearFromOrigin = originBaseline + (target - originBaseline) * t;
      // adaptiveExpected is a GAIN (min(target, rawVelocity x dayIndex)) — the
      // same scale as actualCumulative/forecast. Compound it onto the lifetime
      // baseline like those series (the old fraction-of-target rescale pinned
      // the line onto the baseline, making it invisible).
      // Get adaptive value from the adaptive projection trajectory (by date)
      const adaptiveRaw = point.adaptiveExpected ?? adaptiveByDate.get(point.date);
      // Cap the adaptive value at the target so the line doesn't go above it
      const adaptiveFromOrigin = adaptiveRaw !== undefined && adaptiveRaw !== null
        ? Math.min(target, isLevelGoalMetric(goal.metric) ? adaptiveRaw : actualBase + adaptiveRaw)
        : null;
      const yoy = previousPeriodByDay.get(point.day);
      const fc = forecastByDate.get(point.date);
      const actualVal = point.actualCumulative !== null && point.actualCumulative !== undefined
        ? round(point.actualCumulative + actualBase)
        : null;
      const seedForecast = point.date === lastActual?.date && actualVal !== null;
      return {
        date: point.date ? point.date.slice(5) : `Day ${point.day}`,
        fullDate: point.date,
        day: point.day,
        targetLinear: round(linearFromOrigin),
        actual: actualVal,
        adaptiveExpected: adaptiveFromOrigin !== null ? round(adaptiveFromOrigin) : null,
        // Forecast + YoY are gain-based series like `actualCumulative`; compound
        // them onto the lifetime baseline too so every line shares the
        // current→target scale.
        forecast: fc !== undefined ? round(fc + actualBase) : seedForecast ? actualVal : null,
        lastYear: yoy !== undefined ? round(priorBase + yoy) : null,
      };
    });
    return [startPoint, ...points];
  }, [goal, originBaseline, baseline, previousPeriodByDay, forecastByDate, adaptiveByDate]);

  // Client-side resampling. 'monthly' / 'quarterly' keep only the LAST row of
  // each (month | calendar-quarter) bucket so a multi-month / multi-year goal
  // renders ~12 / ~4 points instead of hundreds of daily dots — the chart stays
  // readable and far fewer points are sent to the renderer. The synthetic
  // day-0 "Start" point is always preserved so the line still anchors at the
  // current value.
  const chartRows = useMemo(() => {
    if (effectiveFrequency === 'daily' || trajectoryChartData.length === 0) return trajectoryChartData;
    const bucketOf = (r: (typeof trajectoryChartData)[number]): string => {
      const [y, m] = (r.fullDate || r.date || '0000-00').split('-');
      if (!y || !m) return '0000';
      return effectiveFrequency === 'monthly'
        ? `${y}-${String(m).padStart(2, '0')}`
        : `${y}-Q${Math.floor((Number(m) - 1) / 3) + 1}`;
    };
    const lastOfBucket = new Map<string, (typeof trajectoryChartData)[number]>();
    for (const row of trajectoryChartData) lastOfBucket.set(bucketOf(row), row);
    // Always preserve the day-0 "Start" anchor row (day 0 never equals a
    // bucket's last row, so it is not present in `lastOfBucket` already).
    return [trajectoryChartData[0], ...Array.from(lastOfBucket.values())];
  }, [effectiveFrequency, trajectoryChartData]);

  // Anchor the Y-axis at the goal's starting value instead of 0 so the graph
  // shows only the current→target band (e.g. 3000→5000), not a mostly-empty
  // 0→target span.
  const yDomain = useMemo<[number | string, number | string]>(() => {
    // Only include series the user has toggled ON. The previous-period overlay
    // (lastYear) can dwarf the current window (e.g. millions vs 10k), so hiding
    // it must rescale the axis to the remaining series instead of leaving the
    // current line flattened against a hidden, far-larger range. `goal.targetValue`
    // and `goal.actualValue` are always included because the target ReferenceLine
    // and current value stay on screen regardless of visibility.
    const values = trajectoryChartData.flatMap((p) => {
      const out: number[] = [];
      if (visibleSeries.has('targetLinear') && p.targetLinear !== null && p.targetLinear !== undefined) out.push(p.targetLinear);
      if (visibleSeries.has('actual') && p.actual !== null && p.actual !== undefined) out.push(p.actual);
      if (visibleSeries.has('adaptiveExpected') && p.adaptiveExpected !== null && p.adaptiveExpected !== undefined) out.push(p.adaptiveExpected);
      if (visibleSeries.has('forecast') && p.forecast !== null && p.forecast !== undefined) out.push(p.forecast);
      if (visibleSeries.has('lastYear') && p.lastYear !== null && p.lastYear !== undefined) out.push(p.lastYear);
      return out;
    });
    if (values.length === 0 || !goal) return [0, 'auto'];
    const lo = Math.min(...values, goal.targetValue);
    const hi = Math.max(goal.targetValue, goal.actualValue || 0, ...values);
    return [lo - (hi - lo) * 0.08, hi + (hi - lo) * 0.05];
  }, [trajectoryChartData, goal, visibleSeries]);

  /** Legend/tooltip label for the comparison series — period-aware (monthly
   *  goal → "Previous month", quarterly → "Previous quarter", …) instead of a
   *  hardcoded "last year". */
  const seriesLabel = useCallback(
    (key: SeriesKey): string =>
      key === 'lastYear' && goal ? previousPeriodLabel(goal.periodType) : SERIES_META[key].label,
    [goal],
  );

  /** Canvas paint per series, resolved live from design tokens (ECharts
   *  cannot read CSS vars). Rebuilt on light/dark flips; hex literals are
   *  fallbacks only. */
  const themeKey = useEvilThemeKey();
  const SERIES_HEX: Record<string, string> = useMemo(
    () => ({
      actual: cssVar("--rt-color-accent") || "#3b82f6",
      forecast: cssVar("--rt-color-warning") || "#d97706",
      targetLinear: cssVar("--rt-color-info") || "#a855f7",
      adaptiveExpected: cssVar("--rt-color-success") || "#059669",
      lastYear: cssVar("--rt-color-text-secondary") || "#4b5563",
      spike: cssVar("--rt-color-danger") || "#ef4444",
      dip: cssVar("--rt-color-accent") || "#3b82f6",
      remaining: cssVar("--rt-color-border-strong") || "#e2e8f0",
      muted: cssVar("--rt-color-bg-muted") || "#f1f5f9",
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [themeKey],
  );

  /** ECharts config for the cumulative trajectory chart (hex paint for canvas). */
  const trajectoryConfig = useMemo<ChartConfig>(() => {
    const cfg: ChartConfig = {};
    for (const key of ALL_SERIES) {
      cfg[key] = { label: key === 'lastYear' ? previousPeriodLabel(goal?.periodType ?? 'yearly') : SERIES_META[key].label, color: SERIES_HEX[key] };
    }
    return cfg;
  }, [goal?.periodType, SERIES_HEX]);

  /** Hover tooltip for the trajectory chart: one row per visible series value. */
  const trajectoryTooltipFormatter = useCallback(
    (
      rows: Array<{ seriesKey: string; seriesName: string; color: string; value: unknown; row: Record<string, unknown> }>,
      axisValue: string,
    ): string => {
      const metric = goal?.metric ?? 'views';
      const body = rows
        .map((r) => {
          const key = r.seriesKey as SeriesKey;
          const name = SERIES_META[key] ? (key === 'lastYear' ? previousPeriodLabel(goal?.periodType ?? 'yearly') : SERIES_META[key].label) : r.seriesName;
          const val = r.value === null || r.value === undefined || r.value === ''
            ? '—'
            : formatNumber(Number(r.value), metric);
          return (
            `<div style="display:flex;align-items:center;gap:8px;padding:1px 0;">` +
            `<span style="width:8px;height:8px;border-radius:2px;background:${r.color};flex-shrink:0;"></span>` +
            `<span>${escapeHtml(name)}</span>` +
            `<span style="margin-left:auto;padding-left:16px;font-weight:600;font-variant-numeric:tabular-nums;">${escapeHtml(val)}</span>` +
            `</div>`
          );
        })
        .join('');
      return (
        `<div style="${tooltipShellStyle}">` +
        `<div style="margin-bottom:6px;font-weight:600;">${escapeHtml(axisValue)}</div>${body}</div>`
      );
    },
    [goal?.metric, goal?.periodType],
  );

  /** ECharts config + tooltip for the sub-frame checkpoint-gains bar chart. */
  const subFrameChartConfig = useMemo<ChartConfig>(
    () => ({
      periodTargetGain: { label: 'Checkpoint Target', color: SERIES_HEX.muted },
      periodActualGain: { label: 'Actual Gained', color: SERIES_HEX.actual },
    }),
    [SERIES_HEX],
  );

  const subFrameTooltipFormatter = useCallback(
    (
      rows: Array<{ seriesKey: string; seriesName: string; color: string; value: unknown; row: Record<string, unknown> }>,
      axisValue: string,
    ): string => {
      const metric = goal?.metric ?? 'views';
      const body = rows
        .map((r) => {
          const name = r.seriesKey === 'periodTargetGain' ? 'Target Allocated' : 'Actual Gain';
          const val = r.value === null || r.value === undefined || r.value === ''
            ? '—'
            : formatNumber(Number(r.value), metric);
          return (
            `<div style="display:flex;align-items:center;gap:8px;padding:1px 0;">` +
            `<span style="width:8px;height:8px;border-radius:2px;background:${r.color};flex-shrink:0;"></span>` +
            `<span>${escapeHtml(name)}</span>` +
            `<span style="margin-left:auto;padding-left:16px;font-weight:600;font-variant-numeric:tabular-nums;">${escapeHtml(val)}</span>` +
            `</div>`
          );
        })
        .join('');
      return (
        `<div style="${tooltipShellStyle}">` +
        `<div style="margin-bottom:6px;font-weight:600;">${escapeHtml(axisValue)}</div>${body}</div>`
      );
    },
    [goal?.metric],
  );

  const subFrameChartData = useMemo(() => {
    if (!subFrames || subFrames.length === 0 || !goal) return [];
    const isRateOrPct = isLevelGoalMetric(goal.metric);
    const origin = startFromCurrent ? originBaseline : 0;
    return subFrames.map((sf, idx) => {
      const prevSf = idx > 0 ? subFrames[idx - 1] : null;
      const prevActual = prevSf && prevSf.cumulativeActual !== null ? prevSf.cumulativeActual : origin;
      const currentActual = sf.cumulativeActual !== null ? sf.cumulativeActual : null;
      const periodActualGain = currentActual !== null ? currentActual - prevActual : null;
      const prevTarget = prevSf ? prevSf.cumulativeTarget : origin;
      const periodTargetGain = sf.cumulativeTarget - prevTarget;
      return {
        label: sf.label,
        periodTargetGain: isRateOrPct ? Number(periodTargetGain.toFixed(2)) : Math.round(periodTargetGain),
        periodActualGain: periodActualGain !== null
          ? (isRateOrPct ? Number(periodActualGain.toFixed(2)) : Math.round(periodActualGain))
          : null,
        cumulativeTarget: isRateOrPct ? Number(sf.cumulativeTarget.toFixed(2)) : Math.round(sf.cumulativeTarget),
        cumulativeActual: sf.cumulativeActual !== null
          ? (isRateOrPct ? Number(sf.cumulativeActual.toFixed(2)) : Math.round(sf.cumulativeActual))
          : null,
        status: sf.status,
      };
    });
  }, [subFrames, goal, startFromCurrent, originBaseline]);

  const growthStats = useMemo(() => {
    if (!goal) return { totalIncrease: 0, growthPct: 0, initialBaseline: 0, cumulativeActual: 0, incrementTarget: 0 };
    const gain = goal.actualValue || 0;
    // Level metrics (CTR/engagement/retention): actualValue IS the current
    // level, not a gain — compounding it onto the baseline double-counted it
    // and made the "Current" card read like an inflated projection.
    const cumulative = isLevelGoalMetric(goal.metric)
      ? gain
      : originBaseline + gain;
    const totalIncrease = isLevelGoalMetric(goal.metric)
      ? gain - originBaseline
      : gain; // in-window gain — same scale as actualValue
    // Progress is measured against the INCREMENTAL goal: how much of the
    // new growth budget (target − baseline) has been captured. Using the full
    // lifetime ratio (cumulative/target) inflated the percentage for goals that
    // start from the current value — e.g. baseline 1.81M, target 1.93M,
    // gain 20k correctly = 40%, but cumulative/target ≈ x94%.
    const incrementTarget = Math.max(0, goal.targetValue - originBaseline);
    const growthPct = incrementTarget > 0.0001
      ? (gain / incrementTarget) * 100
      : goal.targetValue > 0 ? (cumulative / goal.targetValue) * 100 : 0;
    return { totalIncrease, growthPct, initialBaseline: originBaseline, cumulativeActual: cumulative, incrementTarget };
  }, [goal, originBaseline]);

  /** Progress-rail donut: % of the goal reached vs remaining (clamped, NaN-safe). */
  const progressPct = useMemo(() => {
    const raw = growthStats.growthPct;
    if (!Number.isFinite(raw)) return 0;
    return Math.max(0, Math.min(raw, 100));
  }, [growthStats.growthPct]);
  const progressDonutData = useMemo(
    () => [
      { name: 'Reached', value: Number(progressPct.toFixed(1)) },
      { name: 'Remaining', value: Number(Math.max(0, 100 - progressPct).toFixed(1)) },
    ],
    [progressPct],
  );
  const progressDonutConfig = useMemo<ChartConfig>(
    () => ({
      Reached: { label: 'Reached', color: SERIES_HEX.adaptiveExpected },
      Remaining: { label: 'Remaining', color: SERIES_HEX.remaining },
    }),
    [SERIES_HEX],
  );

  if (loading) {
    return (
      <div className="goal-detail-page goal-detail-page--loading">
        <div className="loading-spinner" />
        <p>Loading comprehensive goal analytics & trajectory data...</p>
      </div>
    );
  }

  if (error || !goal) {
    return (
      <div className="goal-detail-page goal-detail-page--error">
        <div className="goal-detail-page__empty-icon">
          <MdWarning size={32} />
        </div>
        <h2>Goal Not Found</h2>
        <p>{error || 'The requested performance goal could not be found or was deleted.'}</p>
        <Link to="/goals" className="goal-detail-page__back-btn">
          <MdArrowBack size={16} /> Back to Performance Goals
        </Link>
      </div>
    );
  }

  // Backend projection is gain-based; compound it onto the lifetime baseline
  // for Views/Subscribers so it reads on the same lifetime scale as target.
  const projectedOutcome = isLevelGoalMetric(goal.metric)
    ? goal.projectedValue || 0
    : originBaseline + (goal.projectedValue || 0);
  const expectedPct = Math.min(100, Math.max(0, goal.timeElapsedPercentage || 0));
  // Required pace computed on the cumulative scale: remaining gap to target
  // over remaining days (backend's requiredDailyVelocity mixes gain vs
  // cumulative scales, so derive it here for consistency).
  const requiredVelocity = Math.max(
    0,
    goal.daysRemaining > 0
      ? (goal.targetValue - growthStats.cumulativeActual) / goal.daysRemaining
      : 0
  );
  const velocityDelta = (goal.currentDailyVelocity || 0) - requiredVelocity;

  return (
    <div className="goal-detail-page">
      {/* Top Breadcrumb Navigation */}
      <nav className="goal-detail-page__nav">
        <Link to="/goals" className="goal-detail-page__back-link">
          <MdArrowBack size={18} />
          <span>Back to Performance Goals</span>
        </Link>
      </nav>

      {/* Header Banner */}
      <header className={`goal-detail-page__header goal-detail-page__header--${goal.status}`}>
        <div className="goal-detail-page__header-left">
          <div className="goal-detail-page__metric-icon" aria-hidden>
            {getMetricIcon(goal.metric)}
          </div>
          <div className="goal-detail-page__title-group">
            <div className="goal-detail-page__tags-row">
              <span className={`goal-detail-page__status-pill goal-detail-page__status-pill--${goal.status}`}>
                {getStatusIcon(goal.status)}
                {STATUS_LABELS[goal.status]}
              </span>
              <span className="goal-detail-page__tag-badge">
                <MdDateRange size={13} />
                {PERIOD_TYPE_LABELS[goal.periodType]}
              </span>
              <span className="goal-detail-page__tag-badge goal-detail-page__tag-badge--dates">
                {formatDateShort(goal.startDate)} → {formatDateShort(goal.endDate)}
              </span>
              {goal.hasAdaptiveData && (
                <span className="goal-detail-page__adaptive-pill">
                  <MdInsights size={13} />
                  Smart Pacing
                </span>
              )}
            </div>
            <h1 className="goal-detail-page__title">
              {goal.title || `${METRIC_LABELS[goal.metric]} Goal`}
            </h1>
            {goal.notes && (
              <p className="goal-detail-page__notes">
                {goal.notes}
              </p>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="goal-detail-page__header-actions">
          {canEdit && (
            <>
              <Button variant="ghost"
                bare
               
                onClick={() => setIsEditModalOpen(true)}
              >
                <MdEdit size={16} /> Edit Goal
              </Button>
              <Button variant="danger"
                bare
               
                onClick={() => setIsDeleteModalOpen(true)}
              >
                <MdDelete size={16} /> Delete
              </Button>
            </>
          )}
        </div>
      </header>

      {/* KPI Metrics Summary Grid - User Friendly */}
      <section className="goal-detail-page__kpis-grid" aria-label="Goal Key Metrics">
        {/* 1. Progress - How am I doing? */}
        <div className="goal-detail-page__kpi-card goal-detail-page__kpi-card--highlight">
          <span className="goal-detail-page__kpi-label">Your Progress</span>
          <div className="goal-detail-page__kpi-value-row">
            <span className="goal-detail-page__kpi-value">
              {formatNumber(growthStats.totalIncrease, goal.metric)}
            </span>
            <span className="goal-detail-page__kpi-target">
              of {formatNumber(growthStats.incrementTarget, goal.metric)} gained
            </span>
          </div>
          <div className="goal-detail-page__kpi-subtext">
            <span className="goal-detail-page__kpi-highlight">{growthStats.growthPct.toFixed(1)}%</span> of your goal reached
          </div>
          <div className="goal-detail-page__progress-bar">
            <div className="goal-detail-page__progress-fill" style={{ width: `${Math.max(0, Math.min(growthStats.growthPct, 100))}%` }} />
          </div>
        </div>

        {/* 2. Pace - Am I on track? */}
        <div className="goal-detail-page__kpi-card">
          <span className="goal-detail-page__kpi-label">Your Pace</span>
          <div className="goal-detail-page__kpi-value-row">
            <span className={`goal-detail-page__kpi-value ${velocityDelta >= 0 ? 'goal-detail-page__kpi-value--success' : 'goal-detail-page__kpi-value--warning'}`}>
              {formatNumber(goal.currentDailyVelocity || 0, goal.metric)}/day
            </span>
          </div>
          <div className="goal-detail-page__kpi-subtext">
            {velocityDelta >= 0 ? (
              <span className="goal-detail-page__kpi-positive"><MdTrendingUp size={14} /> Ahead of pace — great work!</span>
            ) : (
              <span className="goal-detail-page__kpi-negative"><MdTrendingDown size={14} /> Behind pace — let's pick it up!</span>
            )}
          </div>
          <div className="goal-detail-page__kpi-context">Need {formatNumber(requiredVelocity, goal.metric)}/day to hit your target</div>
        </div>

        {/* 4. Growth - How much have I gained? */}
        <div className="goal-detail-page__kpi-card">
          <span className="goal-detail-page__kpi-label">Total Growth</span>
          <div className="goal-detail-page__kpi-value-row">
            <span className="goal-detail-page__kpi-value goal-detail-page__kpi-value--accent">
              {growthStats.totalIncrease >= 0 ? '+' : ''}{formatNumber(growthStats.totalIncrease, goal.metric)}
            </span>
          </div>
          <div className="goal-detail-page__kpi-subtext">Gained since you started</div>
          <div className="goal-detail-page__kpi-context">Started from {formatNumber(growthStats.initialBaseline, goal.metric)} • {goal.daysElapsed} days ago</div>
        </div>

        {/* 5. Time - How much time left? */}
        <div className="goal-detail-page__kpi-card">
          <span className="goal-detail-page__kpi-label">Time Remaining</span>
          <div className="goal-detail-page__kpi-value-row">
            <span className="goal-detail-page__kpi-value">{goal.daysRemaining} days</span>
            <span className="goal-detail-page__kpi-target">of {goal.totalDays} total</span>
          </div>
          <div className="goal-detail-page__kpi-subtext">
            <span className="goal-detail-page__kpi-highlight">{expectedPct.toFixed(0)}%</span> of your timeline passed
          </div>
          <div className="goal-detail-page__progress-bar">
            <div className="goal-detail-page__progress-fill goal-detail-page__progress-fill--time" style={{ width: `${Math.min(expectedPct, 100)}%` }} />
          </div>
        </div>

        {/* 6. Insights - What's the system doing? */}
        <div className="goal-detail-page__kpi-card">
          <span className="goal-detail-page__kpi-label">Smart Insights</span>
          <div className="goal-detail-page__kpi-value-row">
            <span className="goal-detail-page__kpi-value">{goal.anomalies?.length || 0} detected</span>
          </div>
          <div className="goal-detail-page__kpi-subtext">
            {goal.hasAdaptiveData && goal.adaptiveProjection ? (
              <span><MdAutoGraph size={14} /> Adaptive pacing on</span>
            ) : (
              <span><MdTrendingFlat size={14} /> Standard pacing</span>
            )}
          </div>
          <div className="goal-detail-page__kpi-context">
            {goal.hasAdaptiveData && goal.adaptiveProjection ? `Last updated ${new Date(goal.adaptiveProjection.baseline.calculatedAt).toLocaleDateString()}` : "Enable adaptive pacing for smarter forecasts"}
          </div>
        </div>
      </section>

      {/* Performance Chart */}
      <section ref={chartSectionRef} className="goal-detail-page__chart-section">
        <div className="goal-detail-page__section-header">
          <div className="goal-detail-page__section-title-wrap">
            <MdAutoGraph size={20} className="goal-detail-page__section-icon" />
            <h2 className="goal-detail-page__section-title">Your Performance Chart</h2>
          </div>
          <div className="goal-detail-page__chart-tabs" role="tablist">
            <Button bare
              type="button"
              className={`goal-detail-page__chart-tab ${chartView === 'cumulative' ? 'goal-detail-page__chart-tab--active' : ''}`}
              onClick={() => setChartView('cumulative')}
            >
              Overall Progress
            </Button>
            <Button bare
              type="button"
              className={`goal-detail-page__chart-tab ${chartView === 'subframe' ? 'goal-detail-page__chart-tab--active' : ''}`}
              onClick={() => setChartView('subframe')}
            >
              Checkpoint Gains
            </Button>
          </div>
        </div>

        <Grid container spacing={2}>
          {/* Progress rail — 4/12 on desktop, stacked on top for mobile */}
          <Grid size={{ xs: 12, md: 4 }}>
            <Card size="sm">
              <CardHeader>
                <CardTitle>Goal progress</CardTitle>
                <CardAction>
                  <Badge
                    color={
                      goal.status === 'met' || goal.status === 'ahead'
                        ? 'success'
                        : goal.status === 'on_track'
                          ? 'info'
                          : goal.status === 'behind'
                            ? 'warning'
                            : goal.status === 'missed'
                              ? 'error'
                              : 'default'
                    }
                  >
                    {goal.status === 'on_track' ? 'On track' : goal.status.charAt(0).toUpperCase() + goal.status.slice(1)}
                  </Badge>
                </CardAction>
                <CardDescription>
                  Day {goal.daysElapsed} of {goal.totalDays} · {goal.daysRemaining} days left
                </CardDescription>
              </CardHeader>
              <CardContent>
              <Stack gap={2}>
                <Box sx={{ position: 'relative' }}>
                  <EChartsPieChart
                    data={progressDonutData}
                    config={progressDonutConfig}
                    nameKey="name"
                    donut="65%"
                    height={210}
                    showToolbar={false}
                    showLegend={false}
                  />
                  <Stack
                    alignItems="center"
                    justifyContent="center"
                    sx={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
                    style={{ pointerEvents: 'none' }}
                  >
                    <Typography variant="h4" component="div">{progressPct.toFixed(0)}%</Typography>
                    <Typography variant="caption">reached</Typography>
                  </Stack>
                </Box>
                <Stack gap={1.25}>
                  <Flex justifyContent="space-between" alignItems="center" gap={1}>
                    <Typography variant="body2">Pace</Typography>
                    <Typography
                      variant="body2"
                      component="span"
                      style={{
                        fontWeight: 600,
                        color: velocityDelta >= 0 ? 'var(--rt-color-success)' : 'var(--rt-color-warning)',
                      }}
                    >
                      {velocityDelta >= 0 ? 'Ahead' : 'Behind'} · {formatNumber(goal.currentDailyVelocity || 0, goal.metric)}/day
                    </Typography>
                  </Flex>
                  <Flex justifyContent="space-between" alignItems="center" gap={1}>
                    <Typography variant="body2">Projected</Typography>
                    <Typography variant="body2" component="span" style={{ fontWeight: 600 }}>
                      {formatNumber(projectedOutcome, goal.metric)}
                    </Typography>
                  </Flex>
                  <Flex justifyContent="space-between" alignItems="center" gap={1}>
                    <Typography variant="body2">Time used</Typography>
                    <Typography variant="body2" component="span" style={{ fontWeight: 600 }}>
                      {expectedPct.toFixed(0)}% · {goal.daysRemaining}d left
                    </Typography>
                  </Flex>
                  <Progress value={expectedPct} className="h-[6px] w-full" />
                  <Typography variant="caption">
                    Need {formatNumber(requiredVelocity, goal.metric)}/day to hit {formatNumber(goal.targetValue, goal.metric)}
                  </Typography>
                </Stack>
              </Stack>
              </CardContent>
            </Card>
          </Grid>

          {/* Trajectory chart — 8/12 on desktop */}
          <Grid size={{ xs: 12, md: 8 }}>
        {/* Chart View 1: Cumulative Trajectory Line/Area Chart */}
        {chartView === 'cumulative' && (
          <div className="goal-detail-page__chart-container">
            {/* Chart controls: data frequency + per-series visibility toggles */}
            <div className="goal-detail-page__chart-toolbar">
              <div className="goal-detail-page__freq-group" role="group" aria-label="Data frequency">
                {(['daily', 'monthly', 'quarterly'] as ChartFrequency[]).map((f) => (
                  <Button bare
                    key={f}
                    type="button"
                    className={`goal-detail-page__freq-btn ${effectiveFrequency === f ? 'goal-detail-page__freq-btn--active' : ''}`}
                    onClick={() => setFrequencyOverride(f)}
                  >
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </Button>
                ))}
              </div>
              <div className="goal-detail-page__legend-strip" role="group" aria-label="Toggle visible series">
                {ALL_SERIES.map((key) => {
                  const on = visibleSeries.has(key);
                  return (
                    <Button bare
                      key={key}
                      type="button"
                      className={`goal-detail-page__legend-chip ${on ? 'goal-detail-page__legend-chip--on' : 'goal-detail-page__legend-chip--off'}`}
                      onClick={() => toggleSeries(key)}
                      aria-pressed={on}
                    >
                      <span className="goal-detail-page__legend-swatch" style={{ background: on ? SERIES_META[key].color : 'transparent' }} />
                      {seriesLabel(key)}
                    </Button>
                  );
                })}
              </div>
            </div>

            {trajectoryChartData.length > 0 ? (
              <EChartsComposedChart
                data={chartRows}
                config={trajectoryConfig}
                xDataKey="date"
                height={340}
                title="Goal trajectory"
                showToolbar
                tooltipFormatter={trajectoryTooltipFormatter}
              >
                <EChartsComposedChart.Grid />
                <EChartsComposedChart.XAxis dataKey="date" tickFormatter={(v) => v} />
                <EChartsComposedChart.YAxis domain={yDomain} tickFormatter={(v) => formatNumber(v, goal.metric)} />
                <EChartsComposedChart.Brush />
                <EChartsComposedChart.Tooltip />
                {visibleSeries.has('targetLinear') && (
                  <EChartsComposedChart.Line
                    dataKey="targetLinear"
                    dashed={SERIES_META.targetLinear.dash}
                    showSymbol={false}
                    connectNulls
                    markLine={
                      trajectoryChartData[0]
                        ? [{
                            x: trajectoryChartData[0].date,
                            label: `Start: ${formatNumber(trajectoryChartData[0].targetLinear, goal.metric)}`,
                          }]
                        : undefined
                    }
                  />
                )}
                {goal.hasAdaptiveData && visibleSeries.has('adaptiveExpected') && (
                  <EChartsComposedChart.Line
                    dataKey="adaptiveExpected"
                    dashed={SERIES_META.adaptiveExpected.dash}
                    showSymbol={false}
                    connectNulls
                  />
                )}
                {visibleSeries.has('lastYear') && (
                  <EChartsComposedChart.Line
                    dataKey="lastYear"
                    dashed={SERIES_META.lastYear.dash}
                    showSymbol={false}
                    connectNulls
                  />
                )}
                {visibleSeries.has('forecast') && (
                  <EChartsComposedChart.Line
                    dataKey="forecast"
                    dashed={SERIES_META.forecast.dash}
                    showSymbol={false}
                    connectNulls
                  />
                )}
                {visibleSeries.has('actual') && (
                  <EChartsComposedChart.Area
                    dataKey="actual"
                    showSymbol
                    symbolSize={4}
                    connectNulls
                    markLine={[
                      {
                        y: goal.targetValue,
                        label: `Target: ${formatNumber(goal.targetValue, goal.metric)}`,
                        color: SERIES_HEX.adaptiveExpected,
                      },
                      ...(selectedAnomaly ? [{
                        x: selectedAnomaly.date.slice(5),
                        label: `${selectedAnomaly.kind === 'spike' ? '▲' : '▼'} ${selectedAnomaly.date} ${selectedAnomaly.delta >= 0 ? '+' : ''}${formatNumber(selectedAnomaly.delta, goal.metric)}`,
                        color: selectedAnomaly.kind === 'spike' ? SERIES_HEX.spike : SERIES_HEX.dip,
                      } as const] : []),
                    ]}
                    markPoint={(() => {
                      if (!selectedAnomaly) return undefined;
                      const pt = trajectoryChartData.find((p) => p.fullDate === selectedAnomaly.date);
                      const y = pt?.actual ?? pt?.targetLinear;
                      if (y == null) return undefined;
                      return [{
                        x: pt?.date ?? selectedAnomaly.date.slice(5),
                        y,
                        label: selectedAnomaly.kind.toUpperCase(),
                        color: selectedAnomaly.kind === 'spike' ? SERIES_HEX.spike : SERIES_HEX.dip,
                      }];
                    })()}
                  />
                )}
              </EChartsComposedChart>
            ) : (
              <div className="goal-detail-page__no-chart">
                <p>Trajectory data is calculating as daily metrics are ingested...</p>
              </div>
            )}
          </div>
        )}

        {/* Chart View 2: Sub-Frame Checkpoint Gains */}
        {chartView === 'subframe' && (
          <div className="goal-detail-page__chart-container">
            {subFrameChartData.length > 0 ? (
              <EChartsBarChart
                data={subFrameChartData}
                config={subFrameChartConfig}
                xDataKey="label"
                height={340}
                title="Checkpoint gains"
                showToolbar
                tooltipFormatter={subFrameTooltipFormatter}
              >
                <EChartsBarChart.Grid />
                <EChartsBarChart.XAxis dataKey="label" />
                <EChartsBarChart.YAxis tickFormatter={(v) => formatNumber(v, goal.metric)} />
                <EChartsBarChart.Legend isClickable />
                <EChartsBarChart.Tooltip />
                <EChartsBarChart.Bar dataKey="periodTargetGain" name="Checkpoint Target" />
                  <EChartsBarChart.Bar
                    dataKey="periodActualGain"
                    name="Actual Gained"
                    itemColors={(value: number) => (value < 0 ? SERIES_HEX.spike : SERIES_HEX.actual)}
                  />
              </EChartsBarChart>
            ) : (
              <div className="goal-detail-page__no-chart">
                <p>No sub-frame checkpoints defined for this timeframe.</p>
              </div>
            )}
          </div>
        )}
          </Grid>
        </Grid>
      </section>

      {/* Sub-Frames / Checkpoint Milestones Breakdown */}
      {supportsSubFrames(goal) && subFrames.length > 0 && (
        <section className="goal-detail-page__subframes-section">
          <div className="goal-detail-page__section-header">
            <div className="goal-detail-page__section-title-wrap">
              <MdFlag size={20} className="goal-detail-page__section-icon" />
              <h2 className="goal-detail-page__section-title">
                Checkpoint Milestones & Sub-Period Breakdown
              </h2>
              {subFrameConfig && (
                <span className="goal-detail-page__growth-badge">
                  {getGrowthSummary(subFrameConfig)}
                </span>
              )}
            </div>

            <Button variant="ghost" bare
              type="button"
             
              onClick={() => setShowSubFrameSettings(!showSubFrameSettings)}
            >
              <MdTune size={14} />
              <span>{showSubFrameSettings ? 'Hide Adjustments' : 'Adjust Growth Model'}</span>
            </Button>
          </div>

          {/* Inline growth model adjustments */}
          {showSubFrameSettings && subFrameConfig && (
            <div className="goal-detail-page__sf-adjust-panel">
              <div className="goal-detail-page__sf-adjust-group">
                <label className="goal-detail-page__sf-adjust-label">Granularity</label>
                <div className="goal-detail-page__sf-gran-btns">
                  {(['weeks', 'months', 'quarters'] as SubFrameGranularity[]).map((g) => (
                    <Button bare
                      key={g}
                      type="button"
                      className={`goal-detail-page__sf-gran-btn ${subFrameConfig.granularity === g ? 'goal-detail-page__sf-gran-btn--active' : ''}`}
                      onClick={() => handleGranularityChange(g)}
                    >
                      {g.charAt(0).toUpperCase() + g.slice(1)}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="goal-detail-page__sf-adjust-group">
                <label className="goal-detail-page__sf-adjust-label">Growth Model</label>
                <select
                  className="goal-detail-page__sf-select"
                  value={subFrameConfig.growthModel}
                  onChange={(e) => {
                    const newModel = e.target.value as SubFrameConfig['growthModel'];
                    const newConfig = { ...subFrameConfig, growthModel: newModel };
                    setSubFrameConfig(newConfig);
                    setSubFrames(computeSubFrames(goal, newConfig));
                  }}
                >
                  <option value="linear">Linear (Equal Distribution)</option>
                  <option value="compound-monthly">Compound Monthly (5% MoM)</option>
                  <option value="compound-weekly">Compound Weekly (3% WoW)</option>
                </select>
              </div>
            </div>
          )}

          {/* Sub-Frames Grid Cards */}
          <div className="goal-detail-page__subframes-grid">
            {subFrames.map((frame) => {
              // Use per-frame period gain directly — avoids first-card inflating
              // with lifetime baseline (prevActual fallback must be baseline, not 0).
              const periodActualIncrease = frame.actualValue;

              return (
                <div key={frame.index} className={`goal-detail-page__subframe-card goal-detail-page__subframe-card--${frame.status}`}>
                  <div className="goal-detail-page__subframe-header">
                    <span className="goal-detail-page__subframe-title">{frame.label}</span>
                    <span className={`goal-detail-page__subframe-status goal-detail-page__subframe-status--${frame.status}`}>
                      {frame.status === 'met' && <MdCheckCircle size={11} />}
                      {STATUS_LABELS[frame.status]}
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div className="goal-detail-page__subframe-bar">
                    <div
                      className={`goal-detail-page__subframe-fill goal-detail-page__subframe-fill--${frame.status}`}
                      style={{ width: `${Math.min(100, Math.max(0, frame.progressPercentage))}%` }}
                    />
                  </div>

                  {/* Values — simplified language */}
                  <div className="goal-detail-page__subframe-body">
                    <div className="goal-detail-page__subframe-row">
                      <span className="goal-detail-page__subframe-metric-label">Target:</span>
                      <span className="goal-detail-page__subframe-metric-value">
                        +{formatNumber(frame.targetValue, goal.metric)} needed (total {formatNumber(frame.cumulativeTarget, goal.metric)})
                      </span>
                    </div>

                    <div className="goal-detail-page__subframe-row">
                      <span className="goal-detail-page__subframe-metric-label">You have:</span>
                      <span className="goal-detail-page__subframe-metric-value">
                        {frame.cumulativeActual !== null ? formatNumber(frame.cumulativeActual, goal.metric) : '—'} of {formatNumber(frame.cumulativeTarget, goal.metric)}
                      </span>
                    </div>

                    <div className="goal-detail-page__subframe-row">
                      <span className="goal-detail-page__subframe-metric-label">This period:</span>
                      <span className="goal-detail-page__subframe-metric-value">
                        {periodActualIncrease !== null ? `${periodActualIncrease >= 0 ? '+' : ''}${formatNumber(periodActualIncrease, goal.metric)} gained` : '—'}
                      </span>
                    </div>
                  </div>

                  {frame.isCustom && (
                    <div className="goal-detail-page__subframe-custom-badge">
                      Custom Target Override
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Anomalies & Viral Drivers Section (if detected) */}
      {goal.anomalies && goal.anomalies.length > 0 && (
        <section className="goal-detail-page__anomalies-section">
          <div className="goal-detail-page__section-header">
            <div className="goal-detail-page__section-title-wrap">
              <MdWarning size={20} className="goal-detail-page__section-icon" />
              <h2 className="goal-detail-page__section-title">
                Detected Viral Anomalies & Baseline Impact
              </h2>
            </div>
            <span className="goal-detail-page__anomaly-count-pill">
              {goal.anomalies.length} Event{goal.anomalies.length === 1 ? '' : 's'} Excluded
            </span>
          </div>

          <div className="goal-detail-page__anomalies-grid">
            {goal.anomalies.map((anomaly, idx) => {
              const isSelected = selectedAnomaly?.date === anomaly.date && selectedAnomaly?.kind === anomaly.kind;
              return (
              <div
                key={idx}
                className={`goal-detail-page__anomaly-card goal-detail-page__anomaly-card--${anomaly.kind}${isSelected ? ' goal-detail-page__anomaly-card--selected' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => handleAnomalyClick(anomaly)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleAnomalyClick(anomaly); } }}
                title="Click to show on graph"
                style={{ cursor: 'pointer' }}
              >
                <div className="goal-detail-page__anomaly-top">
                  <span className="goal-detail-page__anomaly-date">{anomaly.date}</span>
                  <span className={`goal-detail-page__anomaly-kind goal-detail-page__anomaly-kind--${anomaly.kind}`}>
                    {anomaly.kind === 'spike' ? <MdTrendingUp size={14} /> : <MdTrendingDown size={14} />}
                    {anomaly.kind.toUpperCase()} ({anomaly.delta >= 0 ? '+' : ''}{formatNumber(anomaly.delta, goal.metric)})
                  </span>
                </div>
                {anomaly.driverVideoTitle && (
                  <div className="goal-detail-page__anomaly-driver">
                    <strong>Driver Video:</strong> {anomaly.driverVideoTitle}
                  </div>
                )}
                <div className="goal-detail-page__anomaly-impact">
                  Excluded from adaptive baseline to prevent velocity distortion in pacing projections.
                </div>
                {isSelected && <div className="goal-detail-page__anomaly-hint">● Showing on graph — click again to clear</div>}
              </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Create / Edit Goal Modal */}
      {goal.channelId && (
        <CreateGoalModal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          onSubmit={handleUpdateGoal}
          editingGoal={goal}
          channelId={goal.channelId}
          organizationId={isPersonalContext ? null : currentOrganization?.id}
        />
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={isDeleteModalOpen}
        title="Delete Performance Goal"
        message={`Are you sure you want to delete "${goal.title || METRIC_LABELS[goal.metric]}"? This cannot be undone.`}
        confirmLabel="Delete Goal"
        onConfirm={handleDeleteGoal}
        onCancel={() => setIsDeleteModalOpen(false)}
      />
    </div>
  );
}

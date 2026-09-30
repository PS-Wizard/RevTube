import React, { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  MdAdsClick,
  MdBarChart,
  MdClose,
  MdFlag,
  MdHelpOutline,
  MdInsights,
  MdPeople,
  MdThumbUp,
} from "react-icons/md";
import {
  ShadcnTooltip,
  TooltipContent,
  TooltipTrigger,
  Button,
  Dialog,
} from "../ui";
import type {
  CreateGoalInput,
  Goal,
  GoalMetric,
  GoalPeriodType,
  UpdateGoalInput,
} from "../../types/goals";
import { METRIC_LABELS, METRIC_UNITS } from "../../types/goals";
import "./CreateGoalModal.css";
import type { SubFrameConfig, SubFrameGranularity } from "./milestones";
import {
  computeSubFrames,
  defaultSubFrameConfig,
  getGrowthSummary,
  updateFrameFinal,
  updateFrameTarget,
} from "./milestones";
import { buildPeriodPresets } from "./periodPresets";
import { useAuth } from "../../hooks/useAuth";
import { AnalyticsService } from "../../services/analyticsService";
import { getFirebaseIdToken } from "../../services/authHeaders";
import { fetchGoalBaseline } from "../../utils/forecasting/fetchGoalBaseline";
import { isLevelGoalMetric } from "../../utils/forecasting/goalForecast";

/** Baseline timeframe options for the goal's starting value. */
type BaselineWindowKey =
  | "start-all"
  | "start-30"
  | "start-90"
  | "current-30"
  | "current-90"
  | "current-all";

const parseBaselineWindow = (
  key: BaselineWindowKey,
): { ref: "start" | "today"; days: number | "all" } => {
  if (key === "start-all") return { ref: "start", days: "all" };
  if (key === "current-all") return { ref: "today", days: "all" };
  const [ref, days] = key.split("-") as ["start" | "current", string];
  return { ref: ref === "current" ? "today" : "start", days: Number(days) };
};

/** Clickable "?" help icon — click (or hover) shows the tooltip dialog. */
const HelpHint: React.FC<{
  title: React.ReactNode;
  className?: string;
  size?: number;
}> = ({ title, className = "cgm-help-hint", size = 14 }) => {
  const [open, setOpen] = React.useState(false);
  return (
    <ShadcnTooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={className}
          aria-label="Help"
          tabIndex={-1}
          onClick={() => setOpen((o) => !o)}
        >
          <MdHelpOutline
            size={size}
            style={{ color: "var(--rt-color-text-tertiary)" }}
          />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" style={{ maxWidth: '24rem', whiteSpace: 'pre-line' }}>
        {title}
      </TooltipContent>
    </ShadcnTooltip>
  );
};

interface CreateGoalModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: CreateGoalInput | UpdateGoalInput) => Promise<void>;
  editingGoal?: Goal | null;
  channelId: string;
  organizationId?: string | null;
}

const METRICS: Array<{
  key: GoalMetric;
  label: string;
  desc: string;
  icon: React.ReactElement;
}> = [
  {
    key: "views",
    label: "Views",
    desc: "Total video views",
    icon: <MdBarChart size={18} />,
  },
  {
    key: "subscribers",
    label: "Subscribers",
    desc: "Net new subscribers",
    icon: <MdPeople size={18} />,
  },
  {
    key: "ctr",
    label: "CTR",
    desc: "Click-Through Rate (%)",
    icon: <MdAdsClick size={18} />,
  },
  {
    key: "engagement_rate",
    label: "Engagement Rate",
    desc: "Likes, comments, shares / views (%)",
    icon: <MdThumbUp size={18} />,
  },
  {
    key: "retention",
    label: "Retention",
    desc: "Avg % of video watched (%)",
    icon: <MdInsights size={18} />,
  },
];

// Main timeframe options
const MAIN_TIMEFRAMES: Array<{
  value: GoalPeriodType;
  label: string;
  icon: React.ReactElement;
  description: string;
}> = [
  {
    value: "monthly",
    label: "Month",
    icon: <MdFlag size={18} />,
    description: "~30 days",
  },
  {
    value: "quarterly",
    label: "Quarter",
    icon: <MdFlag size={18} />,
    description: "~90 days",
  },
  {
    value: "half_yearly",
    label: "Half-Year",
    icon: <MdFlag size={18} />,
    description: "~180 days",
  },
  {
    value: "yearly",
    label: "Year",
    icon: <MdFlag size={18} />,
    description: "~365 days",
  },
  {
    value: "custom",
    label: "5 Year",
    icon: <MdFlag size={18} />,
    description: "~1825 days",
  },
];

// Valid sub-divisions per main timeframe
function getValidSubDivisions(
  mainTimeframe: GoalPeriodType,
): Array<{ value: SubFrameGranularity; label: string; description: string }> {
  switch (mainTimeframe) {
    case "monthly":
      return [
        {
          value: "weeks",
          label: "Weeks",
          description: "4–5 weekly checkpoints",
        },
      ];
    case "quarterly":
      return [
        {
          value: "months",
          label: "Months",
          description: "3 monthly checkpoints",
        },
        {
          value: "weeks",
          label: "Weeks",
          description: "~13 weekly checkpoints",
        },
      ];
    case "half_yearly":
      return [
        {
          value: "quarters",
          label: "Quarters",
          description: "2 quarterly checkpoints",
        },
        {
          value: "months",
          label: "Months",
          description: "6 monthly checkpoints",
        },
        {
          value: "weeks",
          label: "Weeks",
          description: "~26 weekly checkpoints",
        },
      ];
    case "yearly":
      return [
        {
          value: "quarters",
          label: "Quarters",
          description: "4 quarterly checkpoints",
        },
        {
          value: "months",
          label: "Months",
          description: "12 monthly checkpoints",
        },
        {
          value: "weeks",
          label: "Weeks",
          description: "~52 weekly checkpoints",
        },
      ];
    case "custom":
      return [
        {
          value: "quarters",
          label: "Quarters",
          description: "20 quarterly checkpoints",
        },
        {
          value: "months",
          label: "Months",
          description: "60 monthly checkpoints",
        },
        {
          value: "weeks",
          label: "Weeks",
          description: "~260 weekly checkpoints",
        },
      ];
    default:
      return [
        { value: "weeks", label: "Weeks", description: "Weekly checkpoints" },
      ];
  }
}

function parseMetricNumber(raw: string, metric: GoalMetric): number {
  if (isLevelGoalMetric(metric)) return parseFloat(raw);
  return parseInt(raw, 10);
}

function isIntMetric(metric: GoalMetric): boolean {
  return metric === "views" || metric === "subscribers";
}

// Format sub-frame value preserving precision for percentage/rate metrics
function formatSubFrameValue(value: number, metric: GoalMetric): string {
  if (isLevelGoalMetric(metric)) {
    return Number(value.toFixed(2)).toString();
  }
  return Number.isInteger(value) ? String(value) : String(Math.round(value));
}

function formatTargetDisplay(value: number, metric: GoalMetric): string {
  if (isLevelGoalMetric(metric)) {
    return value.toFixed(2);
  }
  return Math.round(value).toLocaleString();
}

// Derive a stable, human-meaningful period key from the main timeframe + start date
// (e.g. "2026-Q3", "2026-H1", "2026-06", "2026", "2026-2031") instead of just
// echoing the timeframe type.
function generatePeriodKey(
  periodType: GoalPeriodType,
  start: Date,
  end?: Date,
): string {
  const year = start.getFullYear();
  const pad = (n: number) => String(n).padStart(2, "0");
  switch (periodType) {
    case "monthly": {
      const month = pad(start.getMonth() + 1);
      return `${year}-${month}`;
    }
    case "quarterly": {
      const isQuarterStart =
        start.getDate() === 1 && start.getMonth() % 3 === 0;
      if (isQuarterStart) {
        const quarter = Math.floor(start.getMonth() / 3) + 1;
        return `${year}-Q${quarter}`;
      }
      // Mid-quarter start (e.g. "from now" in September): the frame is not a
      // calendar quarter, so key it by its month range instead of a misleading
      // quarter number ("2026-09~11" for Sep–Nov).
      const endMonth = end ? end.getMonth() : start.getMonth() + 2;
      return `${year}-${pad(start.getMonth() + 1)}~${pad(endMonth + 1)}`;
    }
    case "half_yearly": {
      const half = start.getMonth() < 6 ? 1 : 2;
      return `${year}-H${half}`;
    }
    case "yearly":
      return `${year}`;
    case "custom":
      return `${year}-${year + 5}`;
    default:
      return `${year}`;
  }
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isoFromDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Inclusive day count between two ISO date strings. */
function daysBetweenInclusive(startStr: string, endStr: string): number {
  const start = new Date(`${startStr}T00:00:00`);
  const end = new Date(`${endStr}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;
}

/**
 * Start of the next sub-frame unit after today, on calendar boundaries:
 * weeks → next Monday (ISO), months → 1st of next month, quarters → first day
 * of the next calendar quarter, custom → today + interval.
 */
function nextSubFrameStart(
  granularity: SubFrameGranularity,
  customIntervalDays?: number,
): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  switch (granularity) {
    case "weeks": {
      const day = today.getDay() || 7; // 1..7, Mon..Sun
      const next = new Date(today);
      next.setDate(today.getDate() + (8 - day));
      return next;
    }
    case "months":
      return new Date(today.getFullYear(), today.getMonth() + 1, 1);
    case "quarters":
      return new Date(
        today.getFullYear(),
        (Math.floor(today.getMonth() / 3) + 1) * 3,
        1,
      );
    case "custom": {
      const next = new Date(today);
      next.setDate(today.getDate() + (customIntervalDays ?? 14));
      return next;
    }
  }
}

/** Human label for a mid-period start (e.g. "Sep–Nov 2026"); empty when the default label fits. */
function describeMidPeriodLabel(
  periodType: GoalPeriodType,
  start: Date,
  end: Date,
): string {
  if (
    periodType === "quarterly" &&
    !(start.getDate() === 1 && start.getMonth() % 3 === 0)
  ) {
    const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short" });
    return `${fmt(start)}–${fmt(end)} ${end.getFullYear()}`;
  }
  return "";
}

export function CreateGoalModal({
  isOpen,
  onClose,
  onSubmit,
  editingGoal,
  channelId,
  organizationId,
}: CreateGoalModalProps): React.ReactElement | null {
  const presets = useMemo(() => buildPeriodPresets(), []);
  const { user, getValidToken, accessToken } = useAuth();

  const [metric, setMetric] = useState<GoalMetric>("views");
  const [periodType, setPeriodType] = useState<GoalPeriodType>("quarterly");
  const [periodKey, setPeriodKey] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [targetValue, setTargetValue] = useState<string>("100000");
  const [title, setTitle] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [selectedPresetLabel, setSelectedPresetLabel] = useState<string>("");
  const [adaptivePacing, setAdaptivePacing] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Sub-frame config state
  const [subFrameConfig, setSubFrameConfig] = useState<SubFrameConfig>(() =>
    defaultSubFrameConfig({
      periodType: "yearly",
      totalDays: 365,
    } as Goal),
  );
  const [subFrames, setSubFrames] = useState<
    ReturnType<typeof computeSubFrames>
  >([]);
  // editing index + field ('add' | 'final') for inline sub-frame edits
  const [editingSubIndex, setEditingSubIndex] = useState<number | null>(null);
  const [editingSubField, setEditingSubField] = useState<"add" | "final">(
    "add",
  );
  // inline edit of the overall Final target in the sub-frames summary card
  const [editingFinalTarget, setEditingFinalTarget] = useState<boolean>(false);
  const [finalTargetDraft, setFinalTargetDraft] = useState<string>("");
  const [subTargetDraft, setSubTargetDraft] = useState<string>("");
  const [currentValue, setCurrentValue] = useState<number>(0);
  /** The metric's value as of today (lifetime total / recent average). */
  const [todayValue, setTodayValue] = useState<number | null>(null);
  // True while the channel baseline is being fetched from /analytics/report
  const [isBaselineLoading, setIsBaselineLoading] = useState<boolean>(false);
  const [historyAdds, setHistoryAdds] = useState<number[]>([]);
  const [incrementDraft, setIncrementDraft] = useState<string>("");
  const [finalDraft, setFinalDraft] = useState<string>("");
  // "absolute" = enter absolute delta/final; "percent" = enter % increase over starting value
  const [targetMode, setTargetMode] = useState<'absolute' | 'percent'>('absolute');
  const [percentDraft, setPercentDraft] = useState<string>("");
  // True once the user manually edits Add/Final — stops baseline-driven reseeding.
  const [targetTouched, setTargetTouched] = useState<boolean>(false);
  /**
   * Baseline window: which rows define the "starting" value. Cumulative
   * metrics always start from current; level metrics use this window.
   */
  const [baselineWindow, setBaselineWindow] =
    useState<BaselineWindowKey>("start-30");
  // Goals always start from the channel's current value — no toggle anymore.
  const startFromCurrent = true as const;

  // Sync state when editingGoal changes while modal is open
  const isInitializedRef = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      isInitializedRef.current = false;
      return;
    }
    if (isInitializedRef.current && !editingGoal) return;
    isInitializedRef.current = true;

    if (editingGoal) {
      setMetric(editingGoal.metric);
      setPeriodType(editingGoal.periodType);
      setPeriodKey(editingGoal.periodKey || "");
      setStartDate(editingGoal.startDate.slice(0, 10));
      setEndDate(editingGoal.endDate.slice(0, 10));
      setTargetValue(String(editingGoal.targetValue));
      setTargetTouched(true);
      setTitle(editingGoal.title || "");
      setNotes(editingGoal.notes || "");
      setSelectedPresetLabel("");
    } else {
      const defaultPreset = presets[0];
      if (defaultPreset) {
        setPeriodType(defaultPreset.periodType);
        setPeriodKey(defaultPreset.periodKey);
        setStartDate(defaultPreset.startDate);
        setEndDate(defaultPreset.endDate);
        setSelectedPresetLabel(defaultPreset.label);
      }
      setMetric("views");
      setTargetValue("100000");
      setTargetTouched(false);
      setTitle("");
      setNotes("");
    }
    setError(null);
  }, [editingGoal, isOpen, presets]);

  const handleMainTimeframeSelect = (tf: (typeof MAIN_TIMEFRAMES)[0]) => {
    // Auto-fill dates based on main timeframe
    const today = new Date();
    const start = new Date(today);
    const end = new Date(today);

    switch (tf.value) {
      case "monthly":
        start.setDate(1);
        end.setMonth(start.getMonth() + 1);
        end.setDate(0); // last day of month
        break;
      case "quarterly": {
        const quarterStartMonth = Math.floor(today.getMonth() / 3) * 3;
        start.setMonth(quarterStartMonth);
        start.setDate(1);
        end.setMonth(quarterStartMonth + 3);
        end.setDate(0);
        break;
      }
      case "half_yearly": {
        const halfStartMonth = today.getMonth() < 6 ? 0 : 6;
        start.setMonth(halfStartMonth);
        start.setDate(1);
        end.setMonth(halfStartMonth + 6);
        end.setDate(0);
        break;
      }
      case "yearly":
        start.setMonth(0);
        start.setDate(1);
        end.setMonth(11);
        end.setDate(31);
        break;
      case "custom":
        start.setMonth(0);
        start.setDate(1);
        end.setFullYear(start.getFullYear() + 5);
        end.setMonth(11);
        end.setDate(31);
        break;
    }

    const pad = (n: number) => String(n).padStart(2, "0");
    const iso = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    setPeriodType(tf.value);
    setPeriodKey(generatePeriodKey(tf.value, start));
    setSelectedPresetLabel(tf.label);
    setStartDate(iso(start));
    setEndDate(iso(end));

    // Reset sub-frame config to defaults for the new main timeframe.
    // subFrames themselves are recomputed by the effect below once
    // periodType/startDate/endDate/subFrameConfig settle.
    const mockGoal = {
      periodType: tf.value,
      totalDays: Math.ceil(
        (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
      ),
    } as Goal;
    setSubFrameConfig(defaultSubFrameConfig(mockGoal));
  };

  const handleSubDivisionSelect = (granularity: SubFrameGranularity) => {
    // subFrames are recomputed by the effect below once subFrameConfig settles.
    setSubFrameConfig((prev) => ({ ...prev, granularity }));
  };

  /** Re-anchor the current range to a new start date, preserving its duration. */
  const shiftRangeToStart = (newStart: Date) => {
    const duration = Math.max(1, daysBetweenInclusive(startDate, endDate));
    const end = new Date(newStart);
    end.setDate(end.getDate() + duration - 1);
    setStartDate(isoFromDate(newStart));
    setEndDate(isoFromDate(end));
    setPeriodKey(generatePeriodKey(periodType, newStart, end));
    setSelectedPresetLabel(describeMidPeriodLabel(periodType, newStart, end));
  };

  const handleStartToday = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    shiftRangeToStart(today);
  };

  const handleStartNextSubFrame = () => {
    shiftRangeToStart(
      nextSubFrameStart(
        subFrameConfig.granularity,
        subFrameConfig.customIntervalDays,
      ),
    );
  };

  // Single source of truth for recomputing sub-frames whenever any of their
  // inputs change (target value, dates, config, or main timeframe).
  useEffect(() => {
    if (!isOpen || !channelId || !startDate) return;
    let cancelled = false;
    (async () => {
      try {
        // Org channels: member has no personal OAuth token for them — fall back to
        // the Firebase token (and, if the member has no personal YouTube token
        // at all, the raw Firebase ID token) and let resolveOrgToken swap in the
        // org token server-side (X-Org-Id header).
        const token =
          (await getValidToken(channelId)) ??
          accessToken ??
          (organizationId
            ? await getFirebaseIdToken().catch(() => null)
            : null);
        const email = user?.email;
        if (!token || !email || cancelled) return;
        const svc = new AnalyticsService(
          token,
          email,
          organizationId || undefined,
        );
        if (!cancelled) setIsBaselineLoading(true);
        const snap = await fetchGoalBaseline(
          svc,
          channelId,
          metric,
          startDate,
          subFrameConfig.granularity,
          30,
          parseBaselineWindow(baselineWindow),
        );
        if (cancelled) return;
        setCurrentValue(snap.current);
        setTodayValue(snap.today ?? null);
        setHistoryAdds(snap.historyAdds);
        // Seed the Final target from the selected baseline until the user
        // edits it: integer metrics keep the default "+100,000" add anchored
        // to the starting value; level metrics add a modest 5-point bump.
        if (!targetTouched) {
          const seeded = isIntMetric(metric)
            ? Math.round(snap.current) + 100000
            : snap.current + 5;
          setTargetValue(String(seeded));
        }
      } catch (err) {
        // Never leave the baseline silently at 0 — that reads as "channel has
        // zero views". Surface the real cause so org-token/refresh problems
        // are diagnosable from the console.
        console.warn("[CreateGoalModal] baseline fetch failed:", err);
        if (!cancelled) {
          setCurrentValue(0);
          setTodayValue(null);
          setHistoryAdds([]);
        }
      } finally {
        if (!cancelled) setIsBaselineLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    isOpen,
    channelId,
    metric,
    startDate,
    subFrameConfig.granularity,
    baselineWindow,
    targetTouched,
    getValidToken,
    user?.email,
    organizationId,
    accessToken,
  ]);

  useEffect(() => {
    setSubFrameConfig((prev) => ({
      ...prev,
      startFromCurrent,
      baseline: startFromCurrent ? currentValue : 0,
      historyAdds,
      integerAdds: isIntMetric(metric),
    }));
  }, [startFromCurrent, currentValue, historyAdds, metric]);

  const parsedTarget = isIntMetric(metric)
    ? Math.round(parseFloat(targetValue) || 0)
    : parseFloat(targetValue) || 0;
  const baselineForPercent = startFromCurrent ? currentValue : 0;
  const percentIncrease =
    baselineForPercent > 0
      ? ((parsedTarget - baselineForPercent) / baselineForPercent) * 100
      : 0;
  const isPercentMode = targetMode === 'percent';
  const canUsePercent = baselineForPercent > 0;
  const formatPercent = (p: number) => Number(p.toFixed(2)).toString();
  // Auto-fallback to Number mode if baseline drops to 0 while in % mode
  useEffect(() => {
    if (isPercentMode && !canUsePercent) {
      setTargetMode('absolute');
      setPercentDraft("");
    }
  }, [isPercentMode, canUsePercent]);
  // Start-date context for the baseline sentence: when the goal starts today
  // (the default) the "value at the starting date" IS the current value, so
  // the sentence collapses to a single current-value statement instead of
  // showing the same number twice.
  const todayStr = new Date().toISOString().slice(0, 10);
  const startIsToday = startDate === todayStr;
  const startIsFuture = !!startDate && startDate > todayStr;
  const formatDateShort = (iso: string) =>
    iso
      ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "";
  const incrementValue = Math.max(
    0,
    parsedTarget - (startFromCurrent ? currentValue : 0),
  );

  useEffect(() => {
    if (!startDate || !endDate) return;
    const mockGoal = {
      periodType,
      totalDays: Math.ceil(
        (new Date(endDate).getTime() - new Date(startDate).getTime()) /
          (1000 * 60 * 60 * 24),
      ),
      targetValue: parsedTarget,
      startDate,
      endDate,
    } as Goal;
    setSubFrames(computeSubFrames(mockGoal, subFrameConfig));
  }, [parsedTarget, startDate, endDate, subFrameConfig, periodType]);

  const handleSubmit = async (_e: React.FormEvent) => {
    _e.preventDefault();
    setError(null);

    const isIntMetric = metric === "views" || metric === "subscribers";
    const parsedTarget = isIntMetric
      ? parseInt(targetValue, 10)
      : parseFloat(targetValue);
    if (isNaN(parsedTarget) || parsedTarget <= 0) {
      setError("Please enter a valid positive target value");
      return;
    }

    if (startFromCurrent && parsedTarget <= currentValue) {
      setError(
        `Target must be greater than the current value (${formatTargetDisplay(currentValue, metric)}${METRIC_UNITS[metric]})`,
      );
      return;
    }

    if (
      (metric === "ctr" ||
        metric === "engagement_rate" ||
        metric === "retention") &&
      (parsedTarget < 0 || parsedTarget > 1000)
    ) {
      setError(`${METRIC_LABELS[metric]} must be between 0 and 1000%`);
      return;
    }

    if (!startDate || !endDate) {
      setError("Start and end dates are required");
      return;
    }

    if (startDate > endDate) {
      setError("Start date cannot be after end date");
      return;
    }

    setIsSubmitting(true);
    try {
      const defaultTitle = `${selectedPresetLabel || periodKey || periodType.toUpperCase()} ${METRIC_LABELS[metric]} Goal`;
      const payload = {
        channelId,
        organizationId: organizationId || null,
        title: title.trim() || defaultTitle,
        metric,
        periodType,
        periodKey: periodKey || undefined,
        startDate,
        endDate,
        targetValue: parsedTarget,
        notes: notes.trim() || undefined,
        adaptivePacing,
      } as CreateGoalInput | UpdateGoalInput;
      await onSubmit(payload);
      onClose();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to save goal";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };
  return (
    <Dialog
      open={isOpen}
      onClose={isSubmitting ? undefined : onClose}
      maxWidth={false}
      fullWidth={false}
      aria-labelledby="cgm-title"
      PaperProps={{
        className: "cgm-panel",
        style: { maxWidth: "min(1200px, calc(100vw - 2rem))", width: "100%" },
      }}
    >
      {/* Header */}
      <div className="cgm-header">
        <h2 id="cgm-title" className="cgm-title">
          {editingGoal ? "Edit Goal" : "Set New Performance Goal"}
        </h2>
        <div className="cgm-header-actions">
          <HelpHint
            size={18}
            className="cgm-help-btn"
            title={[
              "Goal Creation Guide:",
              "",
              "1. TARGET METRIC: Choose what to measure:",
              "   • Views: Total video views across the period",
              "   • Subscribers: Net new subscribers gained",
              "   • CTR: Click-Through Rate percentage (impressions → views)",
              "   • Engagement Rate: (Likes + Comments + Shares) / Views as %",
              "   • Retention: Average percentage of video watched",
              "",
              "2. MAIN TIMEFRAME: Set overall goal duration:",
              "   • Monthly (~30 days), Quarterly (~90 days), 90 Days,",
              "     Half-Year (~180 days), Yearly (~365 days), or Custom dates",
              "",
              "3. SUB-FRAMES (optional): Break into checkpoints:",
              "   • Auto-calculated from main goal using compounding growth",
              "   • Weekly, Monthly, Quarterly, or Custom divisions",
              "   • Edit any sub-frame — remaining re-balance automatically",
              '   • "Custom" badge = manually overridden target',
              "",
              "4. TARGET VALUE: The number to reach by end date:",
              "   • Number mode: enter absolute Add / Final (e.g. Add 100,000 → Final 510,000)",
              "   • % mode: enter increase as % of Starting value — Final = Starting × (1 + %/100)",
              "     e.g. Starting 100,000 views + 10% → Final 110,000; 4.5% CTR + 10% → 4.95% CTR",
              "   • Works for all 5 metrics (Views, Subscribers, CTR, Engagement, Retention)",
              "   • Toggle # Number / % Percent above the Add field; ? icon on the toggle explains more",
              "   • For percentage metrics (CTR, Engagement, Retention): Final is also a % (0–1000% allowed)",
              "",
              "5. ADAPTIVE PACING (recommended):",
              "   • Rebaselines weekly (Mondays) using trailing 4-week velocity",
              "   • Excludes viral spikes/dips from baseline",
              "   • Shows adaptive projection alongside linear projection",
              "   • More accurate when anomalies occur",
              "",
              "6. START/END DATES: Define the exact goal period",
            ].join("\n")}
          />
          <Button
            variant="ghost"
            bare
            onClick={onClose}
            aria-label="Close dialog"
          >
            <MdClose size={20} />
          </Button>
        </div>
      </div>

      {/* Body */}
      <form onSubmit={handleSubmit}>
        <div className="cgm-body">
          {error && <div className="cgm-error">{error}</div>}

          {/* Metric Selection */}
          <div className="cgm-field">
            <label className="cgm-label">
              Target Metric
              <HelpHint title="Choose what to measure: Views (total video views), Subscribers (net new), CTR (click-through rate %), Engagement Rate (likes+comments+shares / views %), or Retention (avg % of video watched)" />
            </label>
            <div className="cgm-metric-grid">
              {METRICS.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  className={`cgm-metric-btn ${metric === m.key ? "cgm-metric-btn--active" : ""}`}
                  onClick={() => {
                    setMetric(m.key);
                    setTodayValue(null);
                  }}
                >
                  <div
                    className="cgm-metric-btn__icon-wrap"
                    style={{
                      color:
                        metric === m.key
                          ? "var(--rt-color-accent)"
                          : "var(--rt-color-text-secondary)",
                    }}
                  >
                    {m.icon}
                  </div>
                  <div className="cgm-metric-btn__text">
                    <div className="cgm-metric-btn__label">{m.label}</div>
                    <div className="cgm-metric-btn__desc">{m.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Main Timeframe Selection */}
          <div className="cgm-field">
            <label className="cgm-label">
              Main Timeframe
              <HelpHint title="The overall period for your goal. Monthly (~30 days), Quarterly (~90 days), Half Year (~180 days), Yearly (~365 days), or 5 Year Custom dates. This determines the total duration and available sub-division options." />
            </label>
            <div className="cgm-main-timeframe-grid">
              {MAIN_TIMEFRAMES.map((tf) => (
                <Button
                  bare
                  key={tf.value}
                  type="button"
                  className={`cgm-main-tf-btn ${periodType === tf.value ? "cgm-main-tf-btn--active" : ""}`}
                  onClick={() => handleMainTimeframeSelect(tf)}
                >
                  <span className="cgm-main-tf-btn__icon">{tf.icon}</span>
                  <span className="cgm-main-tf-btn__label">{tf.label}</span>
                  <span className="cgm-main-tf-btn__desc">
                    {tf.description}
                  </span>
                </Button>
              ))}
            </div>
          </div>

          {/* Sub-division Selection (Radio Buttons) */}
          <div className="cgm-field">
            <label className="cgm-label">
              Sub-Division Checkpoints
              <HelpHint title="Break your main timeframe into checkpoints (weeks, months, quarters). Each sub-frame gets its own target derived from the overall goal using a compounding growth model. You can override individual sub-frame targets and the rest re-balance automatically." />
            </label>
            <div className="cgm-subdiv-radio-group">
              {getValidSubDivisions(periodType).map((sd) => (
                <label
                  key={sd.value}
                  className={`cgm-subdiv-radio ${subFrameConfig.granularity === sd.value ? "cgm-subdiv-radio--active" : ""}`}
                >
                  <input
                    type="radio"
                    name="sub-division"
                    value={sd.value}
                    checked={subFrameConfig.granularity === sd.value}
                    onChange={() => handleSubDivisionSelect(sd.value)}
                  />
                  <div className="cgm-subdiv-radio__text">
                    <span className="cgm-subdiv-radio__label">{sd.label}</span>
                    <span className="cgm-subdiv-radio__desc">
                      {sd.description}
                    </span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Target Value & Date Range Row (3 columns on wide screens) */}
          <div className="cgm-target-date-row">
            {/* Target Value */}
            <div className="cgm-field">
              <label className="cgm-label" htmlFor="cgm-target-value">
                Target {METRIC_LABELS[metric]}
                <HelpHint
                  title={[
                    `Target for ${METRIC_LABELS[metric]} — choose Number or % mode (see toggle below).`,
                    "",
                    "Number: enter absolute Add / Final (e.g. Add 100,000 → Final 510,000).",
                    "% Percent: enter increase as % of Starting value. Final = Starting × (1 + %/100).",
                    "  e.g. Starting 100,000 views + 10% → Final 110,000. Starting 4.5% CTR + 10% → Final 4.95% CTR.",
                    "Works for all 5 metrics (Views, Subscribers, CTR, Engagement Rate, Retention).",
                    isLevelGoalMetric(metric) ? "Level metrics (CTR/Engagement/Retention) are percentages — Final is also a %." : "",
                  ].filter(Boolean).join("\n")}
                />
                {METRIC_UNITS[metric] && (
                  <span className="cgm-label-hint">
                    ({METRIC_UNITS[metric]})
                  </span>
                )}
              </label>
              <div className="cgm-start-current">
                {isBaselineLoading ? (
                  <div className="cgm-baseline-loading">
                    <span
                      className="cgm-inline-spinner"
                      role="status"
                      aria-label="Loading baseline"
                    />
                    <span>Loading baseline…</span>
                  </div>
                ) : startIsToday || startIsFuture ? (
                  <div className="cgm-baseline-card">
                    <div className="cgm-baseline-card__row">
                      <span className="cgm-baseline-card__label">
                        Current {METRIC_LABELS[metric].toLowerCase()}
                      </span>
                      <span className="cgm-baseline-card__value">
                        {formatTargetDisplay(
                          todayValue ?? currentValue,
                          metric,
                        )}
                        {METRIC_UNITS[metric] && (
                          <span className="cgm-baseline-card__unit">
                            {METRIC_UNITS[metric]}
                          </span>
                        )}
                      </span>
                    </div>
                    {startIsFuture && (
                      <div className="cgm-baseline-card__hint">
                        Goal starts {formatDateShort(startDate)} — this is the
                        starting value
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="cgm-baseline-card">
                    <div className="cgm-baseline-card__row">
                      <span className="cgm-baseline-card__label">
                        Starting ({formatDateShort(startDate)})
                      </span>
                      <span className="cgm-baseline-card__value">
                        {formatTargetDisplay(currentValue, metric)}
                        {METRIC_UNITS[metric] && (
                          <span className="cgm-baseline-card__unit">
                            {METRIC_UNITS[metric]}
                          </span>
                        )}
                      </span>
                    </div>
                    {todayValue !== null && (
                      <div className="cgm-baseline-card__row cgm-baseline-card__row--secondary">
                        <span className="cgm-baseline-card__label">
                          Current
                        </span>
                        <span className="cgm-baseline-card__value cgm-baseline-card__value--secondary">
                          {formatTargetDisplay(todayValue, metric)}
                          {METRIC_UNITS[metric] && (
                            <span className="cgm-baseline-card__unit">
                              {METRIC_UNITS[metric]}
                            </span>
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <label className="cgm-baseline-range">
                <span className="cgm-baseline-range__label">
                  Baseline timeframe
                </span>
                <select
                  value={baselineWindow}
                  onChange={(e) =>
                    setBaselineWindow(e.target.value as BaselineWindowKey)
                  }
                  className="cgm-input"
                >
                  <option value="start-all">
                    All data until starting date
                  </option>
                  <option value="start-30">30 days before starting date</option>
                  <option value="start-90">90 days before starting date</option>
                  <option value="current-30">30 days before current</option>
                  <option value="current-90">90 days before current</option>
                  <option value="current-all">Current value</option>
                </select>
              </label>
              {/* Number vs % toggle — applies to all 5 metrics */}
              <div className="cgm-target-mode">
                <span className="cgm-target-mode__label">Enter as</span>
                <div className="cgm-target-mode__segment" role="group" aria-label="Target input mode">
                  <button
                    type="button"
                    className={`cgm-target-mode__btn ${!isPercentMode ? 'cgm-target-mode__btn--active' : ''}`}
                    onClick={() => { setPercentDraft(""); setTargetMode('absolute'); }}
                    aria-pressed={!isPercentMode}
                  >
                    # Number
                  </button>
                  <button
                    type="button"
                    className={`cgm-target-mode__btn ${isPercentMode ? 'cgm-target-mode__btn--active' : ''}`}
                    onClick={() => canUsePercent && setTargetMode('percent')}
                    aria-pressed={isPercentMode}
                    disabled={!canUsePercent}
                    title={!canUsePercent ? 'Starting value is 0 — % mode unavailable' : 'Enter increase as % of starting value'}
                  >
                    % Percent
                  </button>
                </div>
                <HelpHint
                  title={[
                    "Target mode — Number vs %:",
                    "",
                    "• Number: enter absolute Add / Final values (e.g. Add 100,000 → Final 510,000).",
                    "• % Percent: enter increase as % of the Starting value shown above. Final is computed as Starting × (1 + % / 100).",
                    "  Example: Starting 100,000 views + 10% → Final 110,000 views. Starting 4.5% CTR + 10% → Final 4.95% CTR.",
                    "  Works for all 5 metrics (Views, Subscribers, CTR, Engagement Rate, Retention).",
                    "• Switching modes keeps the same Final — only the Add field representation changes.",
                    "• Click the segments to switch instantly.",
                    !canUsePercent ? "• Starting value is currently 0 — % mode is disabled until baseline loads." : "",
                  ].filter(Boolean).join("\n")}
                />
                {!canUsePercent && (
                  <span className="cgm-target-mode__hint" style={{ width: '100%' }}>{isPercentMode ? "Starting is 0 — switch to # Number" : "Tip: set a starting value >0 to enable % mode"}</span>
                )}
                {canUsePercent && isPercentMode && (
                  <span className="cgm-target-mode__hint cgm-target-mode__hint--active">% mode: Add is % of Starting ({formatTargetDisplay(baselineForPercent, metric)}{METRIC_UNITS[metric]})</span>
                )}
              </div>
              <div className="cgm-target-split">
                <div className="cgm-target-wrap">
                  <span className="cgm-target-split__label">
                    {isPercentMode ? "Increase" : `Add (${isLevelGoalMetric(metric) ? "%" : metric === "views" ? "views" : "subs"})`}
                  </span>
                  {isPercentMode ? (
                    <input
                      id="cgm-target-value"
                      type="number"
                      step="0.01"
                      min="0"
                      className="cgm-input"
                      placeholder="e.g. 10"
                      value={percentDraft !== "" ? percentDraft : formatPercent(Math.max(0, percentIncrease))}
                      onChange={(e) => {
                        setTargetTouched(true);
                        setPercentDraft(e.target.value);
                        const pct = parseFloat(e.target.value);
                        if (Number.isFinite(pct) && pct >= 0 && baselineForPercent > 0) {
                          const next = baselineForPercent * (1 + pct / 100);
                          setTargetValue(isIntMetric(metric) ? String(Math.round(next)) : String(Number(next.toFixed(2))));
                        }
                      }}
                      onBlur={() => setPercentDraft("")}
                      disabled={!canUsePercent}
                      required
                    />
                  ) : (
                    <input
                      id="cgm-target-value"
                      type="number"
                      step={isLevelGoalMetric(metric) ? "0.01" : "1"}
                      min="0"
                      className="cgm-input"
                      placeholder={isLevelGoalMetric(metric) ? "e.g. 0.45" : "e.g. 100000"}
                      value={incrementDraft !== "" ? incrementDraft : formatSubFrameValue(incrementValue, metric)}
                      onChange={(e) => {
                        setTargetTouched(true);
                        setIncrementDraft(e.target.value);
                        const add = parseMetricNumber(e.target.value, metric);
                        if (Number.isFinite(add) && add >= 0) {
                          const base = startFromCurrent ? currentValue : 0;
                          const next = isIntMetric(metric) ? Math.round(base) + Math.round(add) : base + add;
                          setTargetValue(String(next));
                        }
                      }}
                      onBlur={() => setIncrementDraft("")}
                      required
                    />
                  )}
                  <span className="cgm-target-unit">{isPercentMode ? "%" : METRIC_UNITS[metric]}</span>
                </div>
                <div className="cgm-target-wrap">
                  <span className="cgm-target-split__label">Final</span>
                  <input
                    type="number"
                    step={isLevelGoalMetric(metric) ? "0.01" : "1"}
                    min="0"
                    className="cgm-input"
                    placeholder={isLevelGoalMetric(metric) ? "e.g. 0.45" : "e.g. 200000"}
                    value={finalDraft !== "" ? finalDraft : formatSubFrameValue(parsedTarget, metric)}
                    onChange={(e) => {
                      setTargetTouched(true);
                      setFinalDraft(e.target.value);
                      setPercentDraft("");
                      const num = parseMetricNumber(e.target.value, metric);
                      if (Number.isFinite(num) && num > 0) {
                        setTargetValue(isIntMetric(metric) ? String(Math.round(num)) : String(num));
                      }
                    }}
                    onBlur={() => setFinalDraft("")}
                    required
                  />
                  {METRIC_UNITS[metric] && <span className="cgm-target-unit">{METRIC_UNITS[metric]}</span>}
                </div>
              </div>
              {!isBaselineLoading && canUsePercent && parsedTarget > 0 && (
                <div className="cgm-target-mode__preview">
                  {isPercentMode ? (
                    <>
                      {formatTargetDisplay(baselineForPercent, metric)}
                      {METRIC_UNITS[metric]} +{" "}
                      {formatPercent(Math.max(0, percentIncrease))}% (+
                      {formatTargetDisplay(incrementValue, metric)}
                      {METRIC_UNITS[metric]}) ={" "}
                      {formatTargetDisplay(parsedTarget, metric)}
                      {METRIC_UNITS[metric]} Final
                    </>
                  ) : (
                    <>
                      {formatTargetDisplay(baselineForPercent, metric)}
                      {METRIC_UNITS[metric]} +{" "}
                      {formatTargetDisplay(incrementValue, metric)}
                      {METRIC_UNITS[metric]} ={" "}
                      {formatTargetDisplay(parsedTarget, metric)}
                      {METRIC_UNITS[metric]} Final (+
                      {formatPercent(Math.max(0, percentIncrease))}%)
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Start Date */}
            <div className="cgm-field">
              <label className="cgm-label" htmlFor="cgm-start-date">
                Start Date
              </label>
              <input
                id="cgm-start-date"
                type="date"
                className="cgm-input"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setSelectedPresetLabel("");
                }}
                required
              />
              <div className="cgm-start-quick-row">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="cgm-start-quick-btn"
                  onClick={handleStartToday}
                >
                  Start from today
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="cgm-start-quick-btn"
                  onClick={handleStartNextSubFrame}
                >
                  Next{" "}
                  {subFrameConfig.granularity === "custom"
                    ? "interval"
                    : subFrameConfig.granularity.replace(/s$/, "")}
                </Button>
              </div>
            </div>

            {/* End Date */}
            <div className="cgm-field">
              <label className="cgm-label" htmlFor="cgm-end-date">
                End Date
              </label>
              <input
                id="cgm-end-date"
                type="date"
                className="cgm-input"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setSelectedPresetLabel("");
                }}
                required
              />
            </div>
          </div>

          {/* Sub-Frame Configuration */}
          {subFrames.length > 0 && (
            <div className="cgm-field cgm-subframes-config">
              <label className="cgm-label">
                <MdFlag size={15} style={{ color: "var(--rt-color-accent)" }} />
                Sub-Frame Checkpoint Targets
                <HelpHint title="Each sub-frame's target is auto-calculated from your overall goal using compounding growth (e.g., 5% MoM). You can edit any sub-frame — the remaining frames will re-balance proportionally. 'Custom' badges indicate manually overridden targets." />
                <span className="cgm-label-hint">
                  {getGrowthSummary(subFrameConfig)} — auto-divided from main
                  target
                </span>
              </label>

              <div className="cgm-subframes-list">
                {subFrames.map((frame, idx) => {
                  const isEditingAdd =
                    editingSubIndex === frame.index &&
                    editingSubField === "add";
                  const isEditingFinal =
                    editingSubIndex === frame.index &&
                    editingSubField === "final";
                  const prevFrame = idx > 0 ? subFrames[idx - 1] : null;
                  const year = frame.startDate.slice(0, 4);
                  const showYearDivider =
                    !prevFrame || prevFrame.startDate.slice(0, 4) !== year;
                  const baseline = startFromCurrent ? currentValue : 0;
                  const commitEdit = (raw: string, field: "add" | "final") => {
                    const num = parseMetricNumber(raw, metric);
                    if (!isNaN(num) && num >= 0) {
                      setSubFrames((prev) =>
                        field === "add"
                          ? updateFrameTarget(
                              prev,
                              frame.index,
                              num,
                              parsedTarget,
                              baseline,
                              isIntMetric(metric),
                            )
                          : updateFrameFinal(
                              prev,
                              frame.index,
                              num,
                              parsedTarget,
                              baseline,
                              isIntMetric(metric),
                            ),
                      );
                    }
                    setEditingSubIndex(null);
                  };
                  const sharedInputProps = {
                    type: "number" as const,
                    className: "cgm-input cgm-subframe-input",
                    step: isLevelGoalMetric(metric) ? "0.01" : "1",
                    min: "0",
                    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
                      if (e.key === "Enter")
                        (e.target as HTMLInputElement).blur();
                    },
                  };
                  return (
                    <Fragment key={frame.index}>
                      {showYearDivider && (
                        <div
                          className="cgm-subframe-year-divider"
                          role="separator"
                          aria-label={year}
                        >
                          <span>{year}</span>
                        </div>
                      )}
                      <div className="cgm-subframe-item">
                        <div className="cgm-subframe-item__head">
                          <span className="cgm-subframe-item__label">
                            {frame.label}
                          </span>
                          {frame.isCustom && (
                            <span className="cgm-subframe-item__custom">
                              Custom
                            </span>
                          )}
                        </div>
                        <div className="cgm-subframe-item__input-wrap cgm-subframe-item__input-wrap--split">
                          <label className="cgm-subframe-mini">
                            <span>Add</span>
                            <input
                              {...sharedInputProps}
                              value={
                                isEditingAdd
                                  ? subTargetDraft
                                  : formatSubFrameValue(
                                      frame.targetValue,
                                      metric,
                                    )
                              }
                              onFocus={() => {
                                setEditingSubIndex(frame.index);
                                setEditingSubField("add");
                                setSubTargetDraft(
                                  formatSubFrameValue(
                                    frame.targetValue,
                                    metric,
                                  ),
                                );
                              }}
                              onChange={(e) =>
                                setSubTargetDraft(e.target.value)
                              }
                              onBlur={() => {
                                if (isEditingAdd)
                                  commitEdit(subTargetDraft, "add");
                              }}
                            />
                          </label>
                          <label className="cgm-subframe-mini">
                            <span>Final</span>
                            <input
                              {...sharedInputProps}
                              value={
                                isEditingFinal
                                  ? subTargetDraft
                                  : formatSubFrameValue(
                                      frame.cumulativeTarget,
                                      metric,
                                    )
                              }
                              onFocus={() => {
                                setEditingSubIndex(frame.index);
                                setEditingSubField("final");
                                setSubTargetDraft(
                                  formatSubFrameValue(
                                    frame.cumulativeTarget,
                                    metric,
                                  ),
                                );
                              }}
                              onChange={(e) =>
                                setSubTargetDraft(e.target.value)
                              }
                              onBlur={() => {
                                if (isEditingFinal)
                                  commitEdit(subTargetDraft, "final");
                              }}
                            />
                          </label>
                        </div>
                      </div>
                    </Fragment>
                  );
                })}
              </div>

              <div className="cgm-subframes-summary">
                <div className="cgm-subframes-summary__card">
                  <span className="cgm-subframes-summary__label">Initial</span>
                  <strong className="cgm-subframes-summary__value">
                    {isBaselineLoading
                      ? "…"
                      : formatTargetDisplay(currentValue, metric)}
                  </strong>
                  <span className="cgm-subframes-summary__hint">
                    value at {formatDateShort(startDate)}
                  </span>
                </div>
                <div className="cgm-subframes-summary__divider" aria-hidden />
                <div className="cgm-subframes-summary__card">
                  <span className="cgm-subframes-summary__label">
                    Total Add
                  </span>
                  <strong className="cgm-subframes-summary__value">
                    {formatTargetDisplay(
                      subFrames.reduce((s, f) => s + f.targetValue, 0),
                      metric,
                    )}
                  </strong>
                </div>
                <div className="cgm-subframes-summary__divider" aria-hidden />
                <div className="cgm-subframes-summary__card cgm-subframes-summary__card--final">
                  <span className="cgm-subframes-summary__label">Final</span>
                  <input
                    type="number"
                    className="cgm-input cgm-subframes-summary__final-input"
                    step={isLevelGoalMetric(metric) ? "0.01" : "1"}
                    min="0"
                    value={
                      editingFinalTarget
                        ? finalTargetDraft
                        : formatSubFrameValue(parsedTarget, metric)
                    }
                    onFocus={() => {
                      setEditingFinalTarget(true);
                      setFinalTargetDraft(
                        formatSubFrameValue(parsedTarget, metric),
                      );
                    }}
                    onChange={(e) => setFinalTargetDraft(e.target.value)}
                    onBlur={() => {
                      if (!editingFinalTarget) return;
                      const num = parseMetricNumber(finalTargetDraft, metric);
                      if (!isNaN(num) && num > 0) {
                        setTargetValue(
                          isIntMetric(metric)
                            ? String(Math.round(num))
                            : String(num),
                        );
                      }
                      setEditingFinalTarget(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter")
                        (e.target as HTMLInputElement).blur();
                    }}
                    aria-label="Final target value"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Title & Strategy Notes Row (2 columns) */}
          <div className="cgm-meta-row">
            {/* Goal Title (Optional) */}
            <div className="cgm-field">
              <label className="cgm-label" htmlFor="cgm-title-input">
                Goal Title
                <span className="cgm-label-hint">
                  (Auto-generated if empty)
                </span>
              </label>
              <input
                id="cgm-title-input"
                type="text"
                className="cgm-input"
                placeholder={`e.g. ${selectedPresetLabel || "Q3 2026"} ${METRIC_LABELS[metric]} Sprint`}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            {/* Notes (Optional) */}
            <div className="cgm-field">
              <label className="cgm-label" htmlFor="cgm-notes">
                Strategy Notes
                <span className="cgm-label-hint">(Optional)</span>
              </label>
              <textarea
                id="cgm-notes"
                className="cgm-input cgm-input--large"
                placeholder="e.g. Focus on short-form hooks and community tab posts..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          {/* Adaptive Pacing Highlight Card */}
          <div className="cgm-adaptive-card">
            <div className="cgm-adaptive-card__info">
              <div className="cgm-adaptive-card__title">
                <MdInsights
                  size={18}
                  style={{ color: "var(--rt-color-info)" }}
                />
                Enable Adaptive Pacing
                <HelpHint title="Rebaselines your expected pace every Monday using the trailing 4 weeks of real velocity. Day-over-day spikes/dips (e.g., a viral video) are detected and excluded from the baseline so projections stay accurate. Goal cards then show a second 'adaptive' projection line next to the linear one." />
              </div>
              <div className="cgm-adaptive-card__desc">
                Weekly Monday rebaseline with viral spike/dip anomaly exclusions
                for higher projection accuracy.
              </div>
            </div>
            <label className="cgm-toggle" aria-label="Enable Adaptive Pacing">
              <input
                id="cgm-adaptive-pacing"
                type="checkbox"
                checked={adaptivePacing}
                onChange={(e) => setAdaptivePacing(e.target.checked)}
              />
              <span className="cgm-toggle__slider" />
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="cgm-footer">
          <Button
            variant="ghost"
            bare
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? "Saving..."
              : editingGoal
                ? "Update Goal"
                : "Create Goal"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

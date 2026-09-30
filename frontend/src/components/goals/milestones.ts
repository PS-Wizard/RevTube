/**
 * Milestone / Sub-frame engine with compounding growth.
 *
 * Any goal timeframe → auto-divided into adjustable sub-frames.
 * Initial sub-frame targets derived from overall target using compounding growth rate.
 * User can override individual sub-frame targets; remaining frames re-balance.
 */
import type { Goal, GoalStatus } from '../../types/goals';
import { rollingFrameAdds, snapAdds } from '../../utils/forecasting/goalForecast';
import { getISOWeekNumber } from './periodPresets';

export type SubFrameGranularity = 'weeks' | 'months' | 'quarters' | 'custom';

export interface SubFrame {
  index: number;
  label: string;
  startDate: string;
  endDate: string;
  /** Period add / increment for this sub-frame (editable by user) */
  targetValue: number;
  /** Expected cumulative (or level) at end of this sub-frame */
  cumulativeTarget: number;
  /** Latest known actual within this sub-frame */
  actualValue: number | null;
  /** Cumulative actual up to end of this sub-frame */
  cumulativeActual: number | null;
  progressPercentage: number;
  status: Extract<GoalStatus, 'met' | 'on_track' | 'behind' | 'upcoming'>;
  /** If user has manually overridden this frame's target */
  isCustom: boolean;
}

export interface SubFrameConfig {
  granularity: SubFrameGranularity;
  /** Custom interval in days (for 'custom' granularity) */
  customIntervalDays?: number;
  /** Compounding model: 'linear' | 'compound-monthly' | 'compound-weekly' | 'custom-rate' */
  growthModel: 'linear' | 'compound-monthly' | 'compound-weekly' | 'custom-rate';
  /** Monthly growth rate (e.g., 0.05 = 5% MoM) for compound models */
  monthlyGrowthRate?: number;
  /** Weekly growth rate for compound-weekly */
  weeklyGrowthRate?: number;
  /** Custom rate per sub-frame for 'custom-rate' */
  customRatePerFrame?: number;
  /** When true, cumulative/level targets start at `baseline` instead of 0. */
  startFromCurrent?: boolean;
  /** Current metric value at goal start (retention %, views-to-date, etc.). */
  baseline?: number;
  /** Prior same-granularity period adds; each frame uses the last 3 periods before it. */
  historyAdds?: number[];
  /** Views / subscribers: round period adds to integers. */
  integerAdds?: boolean;
}

/** Default config per goal horizon - uses periodType for smart defaults */
export function defaultSubFrameConfig(goal: Goal): SubFrameConfig {
  const periodType = (goal as { periodType?: string }).periodType;
  const integerAdds = goal.metric === 'views' || goal.metric === 'subscribers';

  if (periodType === 'yearly' || goal.totalDays >= 330) {
    return { granularity: 'quarters', growthModel: 'compound-monthly', monthlyGrowthRate: 0.05, integerAdds };
  }
  if (periodType === 'half_yearly' || goal.totalDays >= 150) {
    return { granularity: 'months', growthModel: 'compound-monthly', monthlyGrowthRate: 0.06, integerAdds };
  }
  if (periodType === 'quarterly' || goal.totalDays >= 60) {
    return { granularity: 'months', growthModel: 'compound-monthly', monthlyGrowthRate: 0.08, integerAdds };
  }
  if (periodType === 'monthly' || periodType === '90_days' || goal.totalDays >= 30) {
    return { granularity: 'weeks', growthModel: 'compound-weekly', weeklyGrowthRate: 0.03, integerAdds };
  }
  return { granularity: 'weeks', growthModel: 'linear', integerAdds };
}

/** Check if goal is long enough for sub-frames */
export function supportsSubFrames(goal: Goal): boolean {
  return goal.totalDays >= 30;
}

function fmt(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function labelFor(start: Date, end: Date, granularity: SubFrameGranularity): string {
  switch (granularity) {
    case 'quarters': {
      // Calendar-aligned frames get classic Q labels; mid-quarter starts get a
      // month-range label so a goal starting in September isn't mislabeled "Q3"
      // when the real calendar quarter it feeds into begins in October.
      if (start.getUTCDate() === 1 && start.getUTCMonth() % 3 === 0) {
        return `Q${Math.floor(start.getUTCMonth() / 3) + 1} ${start.getUTCFullYear()}`;
      }
      const lastDay = addDays(end, -1);
      const fmtMonth = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
      const year = lastDay.getUTCFullYear();
      const startYear = start.getUTCFullYear();
      const range = `${fmtMonth(start)}–${fmtMonth(lastDay)}`;
      return startYear === year ? `${range} ${year}` : `${range} ${startYear}/${String(year).slice(2)}`;
    }
    case 'months':
      return start.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    case 'weeks':
      // ISO-8601 week numbering (international standard), keyed off the frame's Monday.
      return `W${getISOWeekNumber(start)} ${start.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}`;
    case 'custom':
      return start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
}

function startOfNextISOWeekUTC(date: Date): Date {
  // Next Monday strictly after `date` (ISO weeks run Mon–Sun).
  const day = date.getUTCDay() || 7; // 1..7, Mon..Sun
  const next = new Date(date);
  next.setUTCDate(date.getUTCDate() + (8 - day));
  return next;
}

function startOfNextMonthUTC(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

function startOfNextQuarterUTC(date: Date): Date {
  const nextQuarterMonth = (Math.floor(date.getUTCMonth() / 3) + 1) * 3;
  return new Date(Date.UTC(date.getUTCFullYear(), nextQuarterMonth, 1));
}

/** Build sub-frame boundaries, aligned to the calendar where possible. */
function buildBoundaries(startDate: string, endDate: string, config: SubFrameConfig): Array<{ start: Date; end: Date }> {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const segments: Array<{ start: Date; end: Date }> = [];

  let cursor = new Date(start);
  while (cursor < end) {
    let next: Date;
    switch (config.granularity) {
      case 'weeks':
        // First frame runs to the next ISO Monday, then full Mon–Sun weeks.
        next = cursor.getTime() === start.getTime()
          ? startOfNextISOWeekUTC(cursor)
          : addDays(cursor, 7);
        break;
      case 'months':
        // First frame runs to the end of its calendar month, then full months.
        next = cursor.getTime() === start.getTime()
          ? startOfNextMonthUTC(cursor)
          : addMonths(cursor, 1);
        break;
      case 'quarters':
        // First frame runs to the end of its calendar quarter, then full
        // calendar quarters (Q1 = Jan–Mar, Q2 = Apr–Jun, Q3 = Jul–Sep, Q4 = Oct–Dec).
        next = cursor.getTime() === start.getTime()
          ? startOfNextQuarterUTC(cursor)
          : addMonths(cursor, 3);
        break;
      case 'custom': next = addDays(cursor, config.customIntervalDays ?? 14); break;
    }
    const segEnd = next > end ? end : next;
    segments.push({ start: new Date(cursor), end: segEnd });
    cursor = next;
  }
  return segments;
}

/**
 * Distribute the overall target across calendar-aligned boundaries in WEEK
 * granularity first, then aggregate each boundary's share of weeks.
 *
 * Why weeks? Calendar-aligned boundaries (quarters/months) can have wildly
 * different real durations when a goal starts mid-period (e.g. starting today
 * in September makes the first "quarter" only run to October 1st — a few
 * weeks, not three months). Splitting the budget evenly across the goal's full
 * week count and summing weeks per period gives every boundary a target
 * proportional to its ACTUAL time span, so a partial first/last period is not
 * treated like a full one.
 *
 * When history is unavailable we fall back to an equal per-week split, which
 * still yields a proportional per-period distribution by construction.
 */
function distributeByWeeks(
  overallTarget: number,
  boundaries: Array<{ start: Date; end: Date }>,
  config: SubFrameConfig,
): number[] {
  const frameCount = boundaries.length;
  if (frameCount === 0) return [];

  const baseline = config.startFromCurrent ? (config.baseline ?? 0) : 0;
  const remaining = Math.max(0, overallTarget - baseline);

  const periodStart = boundaries[0].start;
  const periodEnd = boundaries[boundaries.length - 1].end;
  const totalDays = Math.max(
    1,
    Math.round((periodEnd.getTime() - periodStart.getTime()) / 86400000),
  );
  const weekCount = Math.max(1, Math.ceil(totalDays / 7));

  // Distribute the budget across the goal's weeks. Without same-granularity
  // history this is an equal per-week split; with history it follows the
  // rolling 3-period trend but still stays proportional to time.
  const weekly = rollingFrameAdds(remaining, weekCount, config.historyAdds ?? []);
  const snappedWeekly = snapAdds(weekly, remaining, !!config.integerAdds);

  // Aggregate each boundary's overlap with the weekly chunks.
  const perBoundary = boundaries.map((b) => {
    const bStart = b.start.getTime();
    const bEnd = b.end.getTime();
    let sum = 0;
    for (let w = 0; w < weekCount; w++) {
      const wStart = periodStart.getTime() + w * 7 * 86400000;
      const wEnd = Math.min(periodEnd.getTime(), wStart + 7 * 86400000);
      const overlapStart = Math.max(wStart, bStart);
      const overlapEnd = Math.min(wEnd, bEnd);
      if (overlapEnd > overlapStart) {
        const overlapDays = (overlapEnd - overlapStart) / 86400000;
        const weekDays = Math.max(1, (wEnd - wStart) / 86400000);
        sum += snappedWeekly[w] * (overlapDays / weekDays);
      }
    }
    return sum;
  });

  return snapAdds(perBoundary, remaining, !!config.integerAdds);
}

function recumulate(frames: SubFrame[], baseline: number): SubFrame[] {
  let cum = baseline;
  return frames.map((f) => {
    cum += f.targetValue;
    return { ...f, cumulativeTarget: cum };
  });
}

/** Re-balance remaining frames after user override */
function rebalanceFrames(
  frames: SubFrame[],
  changedIndex: number,
  overallAdd: number,
  baseline = 0,
): SubFrame[] {
  const result = [...frames];
  const lockedSum = result
    .filter((f, i) => i <= changedIndex && f.isCustom)
    .reduce((sum, f) => sum + f.targetValue, 0);

  const remainingFrames = result.filter((f, i) => i > changedIndex && !f.isCustom);
  const remainingTarget = overallAdd - lockedSum;

  if (remainingFrames.length === 0 || remainingTarget <= 0) {
    return recumulate(result, baseline);
  }

  const originalFactors = remainingFrames.map((f) => f.targetValue);
  const sumOriginal = originalFactors.reduce((a, b) => a + b, 0);

  remainingFrames.forEach((frame, i) => {
    const idx = result.findIndex((f) => f.index === frame.index);
    if (idx >= 0) {
      result[idx] = {
        ...result[idx],
        targetValue: sumOriginal > 0 ? (originalFactors[i] / sumOriginal) * remainingTarget : remainingTarget / remainingFrames.length,
      };
    }
  });

  return recumulate(result, baseline);
}

/** Main entry: compute sub-frames for a goal */
export function computeSubFrames(goal: Goal, config: SubFrameConfig): SubFrame[] {
  const boundaries = buildBoundaries(goal.startDate.slice(0, 10), goal.endDate.slice(0, 10), config);
  const frameCount = boundaries.length;
  if (frameCount === 0) return [];

  const baseline = config.startFromCurrent ? (config.baseline ?? 0) : 0;
  const initialTargets = distributeByWeeks(goal.targetValue, boundaries, config);

  // Actuals from trajectory
  const cumulativeByDate = new Map<string, number>();
  // Views/Subscribers track lifetime totals: compound the raw window gain onto
  // the baseline so actuals share the same current→target scale as targets.
  // Level metrics (CTR/engagement/retention) hold level values — no offset.
  const actualOffset = config.startFromCurrent && config.integerAdds ? (config.baseline ?? 0) : 0;
  let lastKnown = 0;
  for (const point of goal.trajectory ?? []) {
    if (point.actualCumulative !== null && point.actualCumulative !== undefined) {
      lastKnown = point.actualCumulative;
    }
    cumulativeByDate.set(point.date, lastKnown);
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  const todayDate = new Date(`${todayStr}T00:00:00Z`);
  const frames: SubFrame[] = [];
  for (let idx = 0; idx < boundaries.length; idx++) {
    const { start, end } = boundaries[idx];
    const startStr = fmt(start);
    const endStr = fmt(end);
    const targetValue = initialTargets[idx];
    const cumTarget = baseline + initialTargets.slice(0, idx + 1).reduce((a, b) => a + b, 0);
    const prevCumTarget = idx > 0 ? baseline + initialTargets.slice(0, idx).reduce((a, b) => a + b, 0) : baseline;

    const isFuture = startStr > todayStr;
    const isRunning = !isFuture && endStr > todayStr && startStr <= todayStr;
    const isCompleted = !isFuture && !isRunning;

    let rawCumulative: number | null = null;
    if (isCompleted) {
      rawCumulative = cumulativeByDate.get(endStr) ?? (startStr <= todayStr ? lastKnown : null);
    } else if (isRunning) {
      // Use today's actual (lastKnown = window gain to date) so the running
      // month is evaluated to-date instead of waiting for month-end.
      rawCumulative = cumulativeByDate.get(todayStr) ?? lastKnown;
    }
    const cumulativeActual = rawCumulative !== null ? rawCumulative + actualOffset : null;
    const actualValue = cumulativeActual !== null && idx > 0
      ? cumulativeActual - (frames[idx - 1]?.cumulativeActual ?? actualOffset)
      : cumulativeActual !== null
        ? cumulativeActual - actualOffset
        : null;

    // For running frames compare against a prorated expected target so a
    // mid-month 212 vs 192 full-month budget is not falsely "behind".
    // Cumulative metrics prorate linearly; level metrics compare level directly.
    let progressPercentage: number;
    let expectedForStatus = cumTarget;
    if (isRunning && cumulativeActual !== null) {
      const frameDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000));
      const elapsedDays = Math.min(
        frameDays,
        Math.max(0, Math.round((todayDate.getTime() - start.getTime()) / 86400000) + 1),
      );
      if (config.integerAdds) {
        // Cumulative (views/subs): expected grows linearly through the frame
        expectedForStatus = prevCumTarget + targetValue * (elapsedDays / frameDays);
      } else {
        // Level (% metrics): target is a level, not an accrual — compare directly
        expectedForStatus = cumTarget;
      }
      progressPercentage = expectedForStatus > 0
        ? Math.min(100, (cumulativeActual / expectedForStatus) * 100)
        : 0;
      // Also consider period pacing: if period gain already exceeds full period
      // budget mid-month, treat as at least on_track/met even if cumulative
      // carried a prior deficit.
      if (actualValue !== null && targetValue > 0) {
        const periodExpected = config.integerAdds
          ? targetValue * (elapsedDays / frameDays)
          : targetValue;
        const periodRatio = periodExpected > 0 ? actualValue / periodExpected : 0;
        if (periodRatio >= 1) {
          // Cap progress to reflect period outperformance; prevents a prior-month
          // deficit from keeping a clearly ahead current month stuck on "behind".
          progressPercentage = Math.max(progressPercentage, 100);
        } else if (periodRatio >= 0.9) {
          progressPercentage = Math.max(progressPercentage, 92);
        }
      }
    } else {
      progressPercentage = cumTarget > 0 ? Math.min(100, ((cumulativeActual ?? 0) / cumTarget) * 100) : 0;
    }

    let status: SubFrame['status'];
    if (isFuture) {
      status = 'upcoming';
    } else if (progressPercentage >= 99.5 || (cumulativeActual ?? 0) >= expectedForStatus) {
      status = 'met';
    } else if (progressPercentage >= 90) {
      status = 'on_track';
    } else {
      status = 'behind';
    }

    frames.push({
      index: idx,
      label: labelFor(start, end, config.granularity),
      startDate: startStr,
      endDate: endStr,
      targetValue,
      cumulativeTarget: cumTarget,
      actualValue,
      cumulativeActual,
      progressPercentage,
      status,
      isCustom: false,
    });
  }

  return frames;
}

/** Update a single frame's target (user edit) and rebalance */
export function updateFrameTarget(
  frames: SubFrame[],
  frameIndex: number,
  newTarget: number,
  overallTarget: number,
  baseline = 0,
  integerAdds = false,
): SubFrame[] {
  const overallAdd = Math.max(0, overallTarget - baseline);
  const snappedNew = integerAdds ? Math.round(newTarget) : newTarget;
  const updated = frames.map((f, i) =>
    i === frameIndex ? { ...f, targetValue: snappedNew, isCustom: true } : f
  );
  const rebalanced = rebalanceFrames(updated, frameIndex, overallAdd, baseline);
  if (!integerAdds) return rebalanced;
  const snapped = snapAdds(rebalanced.map((f) => f.targetValue), overallAdd, true);
  return recumulate(rebalanced.map((f, i) => ({ ...f, targetValue: snapped[i] })), baseline);
}

/**
 * Update a single frame's FINAL (cumulative) value (user edit) and rebalance.
 * The frame's add is derived as `newFinal − previous frame's cumulative`
 * (or the baseline for the first frame, clamped at 0), then the remaining
 * frames re-balance to still reach the overall target — the mirror of
 * `updateFrameTarget`.
 */
export function updateFrameFinal(
  frames: SubFrame[],
  frameIndex: number,
  newFinal: number,
  overallTarget: number,
  baseline = 0,
  integerAdds = false,
): SubFrame[] {
  const prevCum = frameIndex > 0 ? frames[frameIndex - 1].cumulativeTarget : baseline;
  const newAdd = Math.max(0, (integerAdds ? Math.round(newFinal) : newFinal) - prevCum);
  return updateFrameTarget(frames, frameIndex, newAdd, overallTarget, baseline, integerAdds);
}

/** Get compounding summary for display */
export function getGrowthSummary(config: SubFrameConfig): string {
  switch (config.growthModel) {
    case 'linear':
      return 'Linear (equal per period)';
    case 'compound-monthly':
      return `${((config.monthlyGrowthRate ?? 0.05) * 100).toFixed(1)}% MoM compounding`;
    case 'compound-weekly':
      return `${((config.weeklyGrowthRate ?? 0.03) * 100).toFixed(1)}% WoW compounding`;
    case 'custom-rate':
      return `${((config.customRatePerFrame ?? 0) * 100).toFixed(1)}% per sub-frame`;
  }
}
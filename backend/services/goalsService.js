/**
 * Channel Goals & Real-Time Pacing Service
 *
 * Manages performance goals across multiple time horizons (weekly, monthly, 90-day,
 * quarterly, half-yearly, yearly) and calculates real-time pacing, projections,
 * and historical met/missed statuses.
 *
 * Adaptive Pacing: Weekly rebaselining on Mondays using trailing 4-week velocity,
 * anomaly detection with driver video attribution, and dual projection (linear + adaptive).
 */
const { eq, and, sql, desc, asc } = require('drizzle-orm');
const { channelGoals, analyticsVideoMetricsDaily, analyticsChannelMetricsDaily } = require('../db/schema');

/** Integer metrics — never show decimals */
const INT_METRICS = new Set(['views', 'subscribers']);

/** Anomaly detection threshold multiplier */
const ANOMALY_STDDEV_MULTIPLIER = 1.2;
/** Minimum absolute delta to consider an anomaly */
const ANOMALY_MIN_DELTA = 100;
/** Maximum anomalies to return per goal */
const MAX_ANOMALIES = 6;
/** Trailing window for adaptive baseline (days) */
const ADAPTIVE_TRAILING_DAYS = 28;
/** Minimum clean days required for adaptive baseline */
const MIN_CLEAN_DAYS = 7;

function createGoalsService(deps) {
  const { getDb, getCachedOrgMembership, getCachedUser, firestoreDb } = deps;

  // ── Helper: Date calculations (UTC safe) ───────────────────────────────────

  function parseDateOnly(dStr) {
    if (!dStr) return new Date();
    if (dStr instanceof Date) return new Date(Date.UTC(dStr.getFullYear(), dStr.getMonth(), dStr.getDate()));
    const parts = String(dStr).split('T')[0].split('-');
    return new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)));
  }

  function formatDayStr(d) {
    if (!d) return '';
    if (typeof d === 'string') return d.split('T')[0];
    return d.toISOString().split('T')[0];
  }

  function daysBetweenInclusive(start, end) {
    const s = parseDateOnly(start);
    const e = parseDateOnly(end);
    const diffMs = e.getTime() - s.getTime();
    return Math.max(1, Math.round(diffMs / (24 * 60 * 60 * 1000)) + 1);
  }

  function addDaysStr(dStr, n) {
    const d = parseDateOnly(dStr);
    d.setUTCDate(d.getUTCDate() + n);
    return formatDayStr(d);
  }

  // ── Adaptive Pacing: Anomaly Detection ────────────────────────────────────

  /**
   * Detect day-over-day anomalies in a daily breakdown series.
   * Ported from frontend resolveVideoAnomalyInsights.ts.
   * Returns [{ date, prevDate, delta, kind }] sorted by |delta| desc, capped at MAX_ANOMALIES.
   */
  function detectAnomalies(dailyBreakdown) {
    const rows = (dailyBreakdown || [])
      .map((d) => ({ date: String(d.date || ''), value: Number(d.value) || 0 }))
      .filter((r) => !!r.date)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (rows.length < 2) return [];

    const deltas = rows.slice(1).map((r, idx) => ({
      date: r.date,
      prevDate: rows[idx].date,
      delta: r.value - rows[idx].value,
    }));

    const mean = deltas.reduce((sum, d) => sum + d.delta, 0) / Math.max(1, deltas.length);
    const variance =
      deltas.reduce((sum, d) => {
        const diff = d.delta - mean;
        return sum + diff * diff;
      }, 0) / Math.max(1, deltas.length);
    const stdDev = Math.sqrt(variance);
    const threshold = Math.max(ANOMALY_MIN_DELTA, stdDev * ANOMALY_STDDEV_MULTIPLIER);

    return deltas
      .filter((d) => Math.abs(d.delta) >= threshold)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, MAX_ANOMALIES)
      .map((d) => ({
        date: d.date,
        prevDate: d.prevDate,
        delta: Math.round(d.delta),
        kind: d.delta >= 0 ? 'spike' : 'dip',
      }));
  }

  // ── Adaptive Pacing: Clean Baseline ───────────────────────────────────────

  /**
   * Compute trailing-window daily velocity from anomaly-free days only.
   * Excludes anomaly dates with a +/- 1 day buffer to avoid partial-spike bleed.
   * Returns { velocity, cleanDays, windowStart } or null when insufficient data.
   */
  function calculateAdaptiveBaseline(dailyBreakdown, anomalies, referenceDate) {
    const refStr = formatDayStr(referenceDate);
    const windowStart = addDaysStr(refStr, -(ADAPTIVE_TRAILING_DAYS - 1));

    const anomalyDates = new Set((anomalies || []).flatMap((a) => [a.date, addDaysStr(a.date, -1), addDaysStr(a.date, 1)]));

    const cleanDays = (dailyBreakdown || [])
      .filter((d) => d.date >= windowStart && d.date <= refStr)
      .filter((d) => !anomalyDates.has(d.date));

    if (cleanDays.length < MIN_CLEAN_DAYS) return null;

    const totalValue = cleanDays.reduce((sum, d) => sum + (Number(d.value) || 0), 0);
    const velocity = totalValue / cleanDays.length;

    return {
      rawVelocity: Number(velocity.toFixed(4)),
      cleanDays: cleanDays.length,
      trailingWindowDays: ADAPTIVE_TRAILING_DAYS,
      calculatedAt: refStr,
    };
  }

  // ── Adaptive Pacing: Projection Engine ────────────────────────────────────

  /**
   * Build adaptive projection for an active goal using the clean baseline velocity.
   * Falls back to null when baseline is unavailable (caller keeps linear only).
   */
  function calculateAdaptiveProjection(goal, actualData, baseline, referenceDate) {
    if (!baseline || !Number.isFinite(baseline.rawVelocity) || baseline.rawVelocity <= 0) return null;

    const startStr = formatDayStr(goal.startDate);
    const endStr = formatDayStr(goal.endDate);
    const todayStr = formatDayStr(referenceDate);

    if (todayStr < startStr || todayStr > endStr) return null; // active goals only

    const totalDays = daysBetweenInclusive(startStr, endStr);
    const targetValue = Number(goal.targetValue || 0);
    const actualValue = Number(actualData?.cumulativeValue || 0);

    const daysElapsed = daysBetweenInclusive(startStr, todayStr);
    const daysRemaining = Math.max(0, totalDays - daysElapsed);

    // Remaining projection uses baseline velocity on not-yet-elapsed days
    const projectedRemaining = baseline.rawVelocity * daysRemaining;
    const projectedValue = actualValue + projectedRemaining;
    const requiredDailyVelocity =
      daysRemaining > 0 ? Math.max(0, (targetValue - actualValue) / daysRemaining) : 0;

    const linearExpectedToDate = targetValue > 0 ? targetValue * (daysElapsed / totalDays) : 0;
    const pacingRatio = linearExpectedToDate > 0 ? actualValue / linearExpectedToDate : actualValue > 0 ? 2.0 : 1.0;

    // Trajectory: anchor on REAL cumulative gains through today; from tomorrow
    // onward extend the clean baseline velocity. This makes the adaptive line hug
    // actual performance then branch off with the rebaselined pace — a genuinely
    // distinct curve, not a copy of the straight linear target line..
    const cumByDate = new Map();
    for (const d of (actualData?.dailyBreakdown || [])) {
      if (d && d.date !== undefined && d.cumulative !== undefined) cumByDate.set(d.date, Number(d.cumulative));
    }
    let lastKnownCum = actualValue;
    const trajectory = [];
    for (let i =  0; i < totalDays; i++) {
      const dayIndex = i + 1;
      const dateStr = addDaysStr(startStr, i);
      const actualToDate = cumByDate.get(dateStr)
      if (actualToDate !== undefined && actualToDate !== null) lastKnownCum = actualToDate;

      // Before/on today: use the realized actual gain. After today: project
      // forward from the last known actual using the clean baseline velocity..
      const adaptiveExpected = dayIndex <= daysElapsed
        ? (actualToDate !== undefined && actualToDate !== null ? actualToDate : lastKnownCum)
        : Math.min(targetValue, lastKnownCum + baseline.rawVelocity * (dayIndex - daysElapsed));
      trajectory.push({
        date: dateStr,
        day: dayIndex,
        adaptiveExpected: Number(adaptiveExpected.toFixed(2)),
      });
    }

    return {
      projectedValue,
      requiredDailyVelocity,
      pacingRatio,
      trajectory,
      baseline: {
        velocity: baseline.rawVelocity,
        calculatedAt: baseline.calculatedAt,
        cleanDays: baseline.cleanDays,
        trailingWindowDays: baseline.trailingWindowDays,
      },
    };
  }

  /** Wrap linear pacing result with adaptive projection + anomaly events. */
  function attachAdaptiveData(pacingResult, actualData, referenceDate = new Date()) {
    const anomalies = detectAnomalies(actualData?.dailyBreakdown || []);
    const baseline = calculateAdaptiveBaseline(
      actualData?.dailyBreakdown || [],
      anomalies,
      referenceDate
    );
    const adaptiveProjection = calculateAdaptiveProjection(
      pacingResult,
      actualData,
      baseline,
      referenceDate
    );

    const result = {
      ...pacingResult,
      anomalies: anomalies.map((a) => ({ ...a, excludedFromBaseline: true })),
      adaptiveProjection: adaptiveProjection
        ? {
            ...adaptiveProjection,
            projectedValue: INT_METRICS.has(pacingResult.metric)
              ? Math.round(adaptiveProjection.projectedValue)
              : Number(adaptiveProjection.projectedValue.toFixed(2)),
            requiredDailyVelocity: INT_METRICS.has(pacingResult.metric)
              ? Math.round(adaptiveProjection.requiredDailyVelocity)
              : Number(adaptiveProjection.requiredDailyVelocity.toFixed(2)),
          }
        : undefined,
      hasAdaptiveData: Boolean(adaptiveProjection),
    };

    // Merge the adaptive expected values into the main trajectory (by date) so
    // the frontend receives `adaptiveExpected` directly on each trajectory point
    // instead of relying on the separate adaptiveProjection.trajectory payload.
    if (adaptiveProjection?.trajectory && Array.isArray(result.trajectory)) {
      const adaptiveByDate = new Map(
        adaptiveProjection.trajectory
          .filter((t) => t && t.date !== undefined)
          .map((t) => [t.date, t.adaptiveExpected])
      );
      if (adaptiveByDate.size > 0) {
        result.trajectory = result.trajectory.map((p) => ({
          ...p,
          adaptiveExpected:
            adaptiveByDate.has(p.date) ? adaptiveByDate.get(p.date) : p.adaptiveExpected,
        }));
      }
    }

    return result;
  }

  // ── Metric Aggregation from Postgres ──────────────────────────────────────

  async function getActualMetricsForChannel(channelId, metric, startDate, endDate) {
    const db = getDb ? getDb() : null;
    if (!db) {
      return { cumulativeValue: 0, dailyBreakdown: [] };
    }

    const startStr = formatDayStr(startDate);
    // Cap to yesterday — YT Analytics data is always D-1 at the earliest
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayStr = formatDayStr(yesterday);
    const rawEndStr = formatDayStr(endDate);
    const endStr = rawEndStr < yesterdayStr ? rawEndStr : yesterdayStr;

    // If start is after yesterday, no data can exist yet
    if (startStr > yesterdayStr) {
      return { cumulativeValue: 0, dailyBreakdown: [] };
    }

    try {
      if (metric === 'views' || metric === 'ctr' || metric === 'engagement_rate' || metric === 'retention') {
        const rows = await db
          .select({
            metricDate: analyticsVideoMetricsDaily.metricDate,
            views: sql`COALESCE(SUM(${analyticsVideoMetricsDaily.views}), 0)::bigint`,
            likes: sql`COALESCE(SUM(${analyticsVideoMetricsDaily.likes}), 0)::bigint`,
            comments: sql`COALESCE(SUM(${analyticsVideoMetricsDaily.comments}), 0)::bigint`,
            shares: sql`COALESCE(SUM(${analyticsVideoMetricsDaily.shares}), 0)::bigint`,
            cardImpressions: sql`COALESCE(SUM(${analyticsVideoMetricsDaily.cardImpressions}), 0)::bigint`,
            cardClicks: sql`COALESCE(SUM(${analyticsVideoMetricsDaily.cardClicks}), 0)::bigint`,
            avgViewPercentage: sql`COALESCE(SUM(${analyticsVideoMetricsDaily.averageViewPercentage} * ${analyticsVideoMetricsDaily.views}), 0)::float`,
          })
          .from(analyticsVideoMetricsDaily)
          .where(
            and(
              eq(analyticsVideoMetricsDaily.channelId, channelId),
              sql`${analyticsVideoMetricsDaily.metricDate} >= ${startStr}::date`,
              sql`${analyticsVideoMetricsDaily.metricDate} <= ${endStr}::date`,
              eq(analyticsVideoMetricsDaily.filtersKey, '')
            )
          )
          .groupBy(analyticsVideoMetricsDaily.metricDate)
          .orderBy(asc(analyticsVideoMetricsDaily.metricDate));

        let cumulative = 0;
        const dailyBreakdown = [];

        let totalViews = 0;
        let totalEngagements = 0;
        let totalCardClicks = 0;
        let totalCardImpressions = 0;
        let totalWeightedAvp = 0;

        for (const row of rows) {
          const dateStr = formatDayStr(row.metricDate);
          const v = Number(row.views || 0);
          const l = Number(row.likes || 0);
          const c = Number(row.comments || 0);
          const s = Number(row.shares || 0);
          const cClicks = Number(row.cardClicks || 0);
          const cImpr = Number(row.cardImpressions || 0);
          const weightedAvp = Number(row.avgViewPercentage || 0);

          totalViews += v;
          totalEngagements += (l + c + s);
          totalCardClicks += cClicks;
          totalCardImpressions += cImpr;
          totalWeightedAvp += weightedAvp;

          let dayVal = 0;
          if (metric === 'views') {
            dayVal = v;
            cumulative += dayVal;
          } else if (metric === 'ctr') {
            dayVal = cImpr > 0 ? (cClicks / cImpr) * 100 : 0;
            cumulative = totalCardImpressions > 0 ? (totalCardClicks / totalCardImpressions) * 100 : 0;
          } else if (metric === 'engagement_rate') {
            dayVal = v > 0 ? ((l + c + s) / v) * 100 : 0;
            cumulative = totalViews > 0 ? (totalEngagements / totalViews) * 100 : 0;
          } else if (metric === 'retention') {
            dayVal = v > 0 ? (weightedAvp / v) : 0;
            cumulative = totalViews > 0 ? (totalWeightedAvp / totalViews) : 0;
          }

          dailyBreakdown.push({
            date: dateStr,
            value: Number(dayVal.toFixed(2)),
            cumulative: Number(cumulative.toFixed(2)),
          });
        }

        let finalCumulative = 0;
        if (metric === 'views') finalCumulative = totalViews;
        else if (metric === 'ctr') finalCumulative = totalCardImpressions > 0 ? (totalCardClicks / totalCardImpressions) * 100 : 0;
        else if (metric === 'engagement_rate') finalCumulative = totalViews > 0 ? (totalEngagements / totalViews) * 100 : 0;
        else if (metric === 'retention') finalCumulative = totalViews > 0 ? (totalWeightedAvp / totalViews) : 0;

        return {
          cumulativeValue: metric === 'views' || metric === 'subscribers' ? Math.round(finalCumulative) : Number(finalCumulative.toFixed(2)),
          dailyBreakdown,
        };
      }

      if (metric === 'subscribers') {
        const rows = await db
          .select({
            metricDate: analyticsChannelMetricsDaily.metricDate,
            gained: sql`COALESCE(SUM(${analyticsChannelMetricsDaily.subscribersGained}), 0)::bigint`,
            lost: sql`COALESCE(SUM(${analyticsChannelMetricsDaily.subscribersLost}), 0)::bigint`,
          })
          .from(analyticsChannelMetricsDaily)
          .where(
            and(
              eq(analyticsChannelMetricsDaily.channelId, channelId),
              sql`${analyticsChannelMetricsDaily.metricDate} >= ${startStr}::date`,
              sql`${analyticsChannelMetricsDaily.metricDate} <= ${endStr}::date`
            )
          )
          .groupBy(analyticsChannelMetricsDaily.metricDate)
          .orderBy(asc(analyticsChannelMetricsDaily.metricDate));

        let cumulative = 0;
        const dailyBreakdown = [];

        for (const row of rows) {
          const dateStr = formatDayStr(row.metricDate);
          const netSubs = Number(row.gained || 0) - Number(row.lost || 0);
          cumulative += netSubs;
          dailyBreakdown.push({
            date: dateStr,
            value: netSubs,
            cumulative,
          });
        }

        return {
          cumulativeValue: cumulative,
          dailyBreakdown,
        };
      }

      return { cumulativeValue: 0, dailyBreakdown: [] };
    } catch (err) {
      console.warn(`[goalsService] Failed to query actual metrics: ${err.message}`);
      return { cumulativeValue: 0, dailyBreakdown: [] };
    }
  }

  // ── Pacing & Projection Engine ─────────────────────────────────────────────

  function calculateGoalPacing(goal, actualData, referenceDate = new Date()) {
    const startStr = formatDayStr(goal.startDate);
    const endStr = formatDayStr(goal.endDate);
    const todayStr = formatDayStr(referenceDate);

    const totalDays = daysBetweenInclusive(startStr, endStr);
    const targetValue = Number(goal.targetValue || 0);
    const actualValue = Number(actualData?.cumulativeValue || 0);

    const isPast = todayStr > endStr;
    const isUpcoming = todayStr < startStr;
    const isActive = !isPast && !isUpcoming;

    let daysElapsed = 0;
    let daysRemaining = 0;
    let timeElapsedPercentage = 0;
    let expectedValueToDate = 0;
    let pacingRatio = 1.0;
    let projectedValue = actualValue;
    let requiredDailyVelocity = 0;
    let currentDailyVelocity = 0;
    let status = 'on_track'; // 'met' | 'missed' | 'ahead' | 'on_track' | 'behind' | 'upcoming'
    let pacingLabel = 'On Track';
    let progressPercentage = targetValue > 0 ? (actualValue / targetValue) * 100 : 0;

    if (isPast) {
      daysElapsed = totalDays;
      daysRemaining = 0;
      timeElapsedPercentage = 100;
      expectedValueToDate = targetValue;
      currentDailyVelocity = Number((actualValue / totalDays).toFixed(2));
      projectedValue = actualValue;
      requiredDailyVelocity = 0;
      pacingRatio = targetValue > 0 ? actualValue / targetValue : 1;

      if (actualValue >= targetValue) {
        status = 'met';
        pacingLabel = 'Goal Met';
      } else {
        status = 'missed';
        pacingLabel = 'Goal Missed';
      }
    } else if (isUpcoming) {
      daysElapsed = 0;
      daysRemaining = totalDays;
      timeElapsedPercentage = 0;
      expectedValueToDate = 0;
      currentDailyVelocity = 0;
      projectedValue = targetValue;
      requiredDailyVelocity = Number((targetValue / totalDays).toFixed(2));
      pacingRatio = 1.0;
      status = 'upcoming';
      pacingLabel = 'Upcoming';
    } else {
      // Active period
      // YT Analytics data is always D-1; use yesterday as the data boundary for
      // velocity math so we don't divide actual by a day count that has no data.
      const yesterday = new Date(referenceDate);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const yesterdayStr = formatDayStr(yesterday);
      // dataElapsed: days for which data actually exists (start..yesterday)
      const dataElapsed = startStr <= yesterdayStr
        ? daysBetweenInclusive(startStr, yesterdayStr)
        : 0;

      daysElapsed = daysBetweenInclusive(startStr, todayStr);
      daysRemaining = Math.max(0, totalDays - daysElapsed);
      timeElapsedPercentage = Math.min(100, Math.max(0, (daysElapsed / totalDays) * 100));
      expectedValueToDate = (targetValue * (daysElapsed / totalDays));
      // Velocity based on data-complete days only
      currentDailyVelocity = dataElapsed > 0 ? actualValue / dataElapsed : 0;
      projectedValue = Number((currentDailyVelocity * totalDays).toFixed(2));
      requiredDailyVelocity = daysRemaining > 0 ? Math.max(0, (targetValue - actualValue) / daysRemaining) : 0;

      if (expectedValueToDate > 0) {
        pacingRatio = actualValue / expectedValueToDate;
      } else {
        pacingRatio = actualValue > 0 ? 2.0 : 1.0;
      }

      if (actualValue >= targetValue) {
        status = 'met';
        pacingLabel = 'Goal Met Early';
      } else if (pacingRatio >= 1.05) {
        status = 'ahead';
        pacingLabel = 'Ahead of Pace (Growth)';
      } else if (pacingRatio >= 0.85) {
        status = 'on_track';
        pacingLabel = 'On Track (Neutral)';
      } else {
        status = 'behind';
        pacingLabel = 'Behind Pace (Decline)';
      }
    }

    // Generate Trajectory Chart Points
    const trajectory = [];
    const dailyMap = new Map();
    for (const d of (actualData?.dailyBreakdown || [])) {
      dailyMap.set(d.date, d.cumulative);
    }

    let runningCum = 0;
    const startDateObj = parseDateOnly(startStr);
    for (let i = 0; i < totalDays; i++) {
      const curDate = new Date(startDateObj.getTime() + i * 24 * 60 * 60 * 1000);
      const curStr = formatDayStr(curDate);
      const dayIndex = i + 1;
      const targetLinearExpected = Number(((targetValue / totalDays) * dayIndex).toFixed(2));

      if (dailyMap.has(curStr)) {
        runningCum = dailyMap.get(curStr);
      }

      const hasActual = curStr <= todayStr;
      trajectory.push({
        date: curStr,
        day: dayIndex,
        targetLinearExpected,
        actualCumulative: hasActual ? Number(runningCum.toFixed(2)) : null,
      });
    }

    const linearResult = {
      ...goal,
      actualValue: INT_METRICS.has(goal.metric) ? Math.round(actualValue) : Number(actualValue.toFixed(2)),
      targetValue: INT_METRICS.has(goal.metric) ? Math.round(targetValue) : Number(targetValue.toFixed(2)),
      progressPercentage: Number(progressPercentage.toFixed(1)),
      timeElapsedPercentage: Number(timeElapsedPercentage.toFixed(1)),
      totalDays,
      daysElapsed,
      daysRemaining,
      expectedValueToDate: INT_METRICS.has(goal.metric) ? Math.round(expectedValueToDate) : Number(expectedValueToDate.toFixed(2)),
      pacingRatio: Number(pacingRatio.toFixed(2)),
      projectedValue: INT_METRICS.has(goal.metric) ? Math.round(projectedValue) : Number(projectedValue.toFixed(2)),
      currentDailyVelocity: INT_METRICS.has(goal.metric) ? Math.round(currentDailyVelocity) : Number(currentDailyVelocity.toFixed(2)),
      requiredDailyVelocity: INT_METRICS.has(goal.metric) ? Math.round(requiredDailyVelocity) : Number(requiredDailyVelocity.toFixed(2)),
      status,
      pacingLabel,
      isPast,
      isUpcoming,
      isActive,
      trajectory,
    };

    // Attach adaptive data (anomalies + adaptive projection) for active goals
    return attachAdaptiveData(linearResult, actualData, referenceDate);
  }

  // ── Permission Verification ────────────────────────────────────────────────

  async function canManageGoals(authUser, organizationId) {
    if (!authUser?.uid) return false;
    
    // System admin check
    const userRecord = await getCachedUser(authUser.email);
    if (userRecord?.role === 'admin') return true;

    // Personal context
    if (!organizationId) return true;

    // Org context: require owner, admin, or write (editor)
    try {
      const member = await getCachedOrgMembership(String(organizationId), authUser.uid);
      if (member && (member.role === 'owner' || member.role === 'admin' || member.role === 'write')) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // ── CRUD Operations ────────────────────────────────────────────────────────

  async function listGoals(channelId, organizationId = null) {
    const db = getDb ? getDb() : null;
    if (!db) return [];

    let queryBuilder = db
      .select()
      .from(channelGoals)
      .where(eq(channelGoals.channelId, channelId))
      .orderBy(desc(channelGoals.startDate), desc(channelGoals.createdAt));

    const rows = await queryBuilder;

    // Filter by org context if requested
    const filteredRows = rows.filter((r) => {
      if (!organizationId) {
        return !r.organizationId || r.organizationId === '';
      }
      return r.organizationId === organizationId;
    });

    const populated = await Promise.all(
      filteredRows.map(async (goal) => {
        const actuals = await getActualMetricsForChannel(
          goal.channelId,
          goal.metric,
          goal.startDate,
          goal.endDate
        );
        return calculateGoalPacing(goal, actuals);
      })
    );

    return populated;
  }

  async function getGoalById(goalId) {
    const db = getDb ? getDb() : null;
    if (!db) return null;

    const rows = await db
      .select()
      .from(channelGoals)
      .where(eq(channelGoals.id, parseInt(goalId, 10)))
      .limit(1);

    if (!rows.length) return null;
    const goal = rows[0];

    const actuals = await getActualMetricsForChannel(
      goal.channelId,
      goal.metric,
      goal.startDate,
      goal.endDate
    );
    return calculateGoalPacing(goal, actuals);
  }

  async function createGoal(data) {
    const db = getDb ? getDb() : null;
    if (!db) throw new Error('Database not configured');

    const {
      channelId,
      organizationId,
      createdBy,
      title,
      metric,
      periodType,
      periodKey,
      startDate,
      endDate,
      targetValue,
      notes,
    } = data;

    if (!channelId || !metric || !periodType || !startDate || !endDate || targetValue === undefined) {
      throw new Error('Missing required goal fields');
    }

    const inserted = await db
      .insert(channelGoals)
      .values({
        channelId,
        organizationId: organizationId || null,
        createdBy,
        title: title || `${periodType.toUpperCase()} ${metric.toUpperCase()} Goal`,
        metric,
        periodType,
        periodKey: periodKey || null,
        startDate: formatDayStr(startDate),
        endDate: formatDayStr(endDate),
        targetValue: parseFloat(targetValue),
        notes: notes || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    const created = inserted[0];
    const actuals = await getActualMetricsForChannel(
      created.channelId,
      created.metric,
      created.startDate,
      created.endDate
    );
    return calculateGoalPacing(created, actuals);
  }

  async function updateGoal(goalId, data) {
    const db = getDb ? getDb() : null;
    if (!db) throw new Error('Database not configured');

    const updateFields = {
      updatedAt: new Date(),
    };

    if (data.title !== undefined) updateFields.title = data.title;
    if (data.metric !== undefined) updateFields.metric = data.metric;
    if (data.periodType !== undefined) updateFields.periodType = data.periodType;
    if (data.periodKey !== undefined) updateFields.periodKey = data.periodKey;
    if (data.startDate !== undefined) updateFields.startDate = formatDayStr(data.startDate);
    if (data.endDate !== undefined) updateFields.endDate = formatDayStr(data.endDate);
    if (data.targetValue !== undefined) updateFields.targetValue = parseFloat(data.targetValue);
    if (data.notes !== undefined) updateFields.notes = data.notes;

    const updated = await db
      .update(channelGoals)
      .set(updateFields)
      .where(eq(channelGoals.id, parseInt(goalId, 10)))
      .returning();

    if (!updated.length) return null;
    const res = updated[0];

    const actuals = await getActualMetricsForChannel(
      res.channelId,
      res.metric,
      res.startDate,
      res.endDate
    );
    return calculateGoalPacing(res, actuals);
  }

  async function deleteGoal(goalId) {
    const db = getDb ? getDb() : null;
    if (!db) throw new Error('Database not configured');

    const deleted = await db
      .delete(channelGoals)
      .where(eq(channelGoals.id, parseInt(goalId, 10)))
      .returning();

    return deleted.length > 0;
  }

  async function getGoalsSummary(channelId, organizationId = null) {
    const goals = await listGoals(channelId, organizationId);
    const summary = {
      total: goals.length,
      active: 0,
      met: 0,
      missed: 0,
      ahead: 0,
      onTrack: 0,
      behind: 0,
      upcoming: 0,
      topActiveGoals: [],
    };

    for (const g of goals) {
      if (g.isPast) {
        if (g.status === 'met') summary.met++;
        else summary.missed++;
      } else if (g.isUpcoming) {
        summary.upcoming++;
      } else if (g.isActive) {
        summary.active++;
        if (g.status === 'met') summary.met++;
        else if (g.status === 'ahead') summary.ahead++;
        else if (g.status === 'on_track') summary.onTrack++;
        else if (g.status === 'behind') summary.behind++;
      }
    }

    // Top active goals (active first, sorted by days remaining)
    summary.topActiveGoals = goals
      .filter((g) => g.isActive)
      .sort((a, b) => a.daysRemaining - b.daysRemaining)
      .slice(0, 3);

    return summary;
  }

  return {
    calculateGoalPacing,
    getActualMetricsForChannel,
    canManageGoals,
    listGoals,
    getGoalById,
    createGoal,
    updateGoal,
    deleteGoal,
    getGoalsSummary,
  };
}

module.exports = { createGoalsService };

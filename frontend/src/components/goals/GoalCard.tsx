import React, { useState } from "react";
import {
  MdAdsClick,
  MdArrowForward,
  MdBarChart,
  MdCancel,
  MdDelete,
  MdEdit,
  MdEmojiEvents,
  MdFlag,
  MdInsights,
  MdPeople,
  MdSchedule,
  MdThumbUp,
  MdTrendingDown,
  MdTrendingFlat,
  MdTrendingUp,
  MdWarning,
} from "react-icons/md";
import { useNavigate } from "react-router-dom";
import type {
  AnomalyEvent,
  Goal,
  GoalMetric,
  GoalStatus,
  GoalWithAdaptive,
} from "../../types/goals";
import { METRIC_LABELS, METRIC_UNITS, STATUS_LABELS } from "../../types/goals";
import { ConfirmModal } from "../ConfirmModal";
import { Button, Flex } from "../ui";
import "./GoalCard.css";
import {
  computeSubFrames,
  defaultSubFrameConfig,
  getGrowthSummary,
  supportsSubFrames,
} from "./milestones";

interface GoalCardProps {
  goal: GoalWithAdaptive;
  canEdit?: boolean;
  onEdit?: (goal: GoalWithAdaptive) => void;
  onDelete?: (goal: GoalWithAdaptive) => void;
}

function formatNumber(value: number, metric: GoalMetric): string {
  const unit = METRIC_UNITS[metric];
  if (
    metric === "ctr" ||
    metric === "engagement_rate" ||
    metric === "retention"
  ) {
    return `${value.toFixed(2)}${unit}`;
  }
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

function getMetricIcon(metric: GoalMetric): React.ReactElement {
  switch (metric) {
    case "views":
      return <MdBarChart size={18} />;
    case "subscribers":
      return <MdPeople size={18} />;
    case "ctr":
      return <MdAdsClick size={18} />;
    case "engagement_rate":
      return <MdThumbUp size={18} />;
    case "retention":
      return <MdInsights size={18} />;
    default:
      return <MdBarChart size={18} />;
  }
}

function getStatusIcon(status: GoalStatus): React.ReactElement {
  switch (status) {
    case "met":
      return <MdEmojiEvents size={12} />;
    case "missed":
      return <MdCancel size={12} />;
    case "ahead":
      return <MdTrendingUp size={12} />;
    case "on_track":
      return <MdTrendingFlat size={12} />;
    case "behind":
      return <MdTrendingDown size={12} />;
    case "upcoming":
      return <MdSchedule size={12} />;
  }
}

/**
 * Map a goal's pacing-aware `status` to a semantic color token for the card's
 * left border accent (`::before`). Shown on hover only.
 *
 * Uses `goal.status` (not raw progress) so an on-track goal early in its
 * window isn't mis-colored red by low absolute progress:
 * - met / ahead  -> success (green)
 * - on_track     -> accent (blue)
 * - behind       -> warning (amber)
 * - missed       -> danger (red)
 * - upcoming     -> neutral grey
 */
function getGoalStatusColor(goal: GoalWithAdaptive): string {
  switch (goal.status) {
    case "met":
    case "ahead":
      return "var(--rt-color-success)";
    case "on_track":
      return "var(--rt-color-accent)";
    case "behind":
      return "var(--rt-color-warning)";
    case "missed":
      return "var(--rt-color-danger)";
    case "upcoming":
      return "var(--rt-color-text-tertiary)";
  }
}

function getPeriodDisplay(goal: Goal): string {
  if (goal.periodKey) return goal.periodKey;
  const start = goal.startDate.slice(0, 10);
  const end = goal.endDate.slice(0, 10);
  return `${start} → ${end}`;
}

function getStatusIconForAnomaly(kind: "spike" | "dip"): React.ReactElement {
  switch (kind) {
    case "spike":
      return <MdTrendingUp size={11} />;
    case "dip":
      return <MdTrendingDown size={11} />;
  }
}

function getAnomalyPosition(
  anomaly: AnomalyEvent,
  startDate: string,
  totalDays: number,
): number {
  const anomalyDate = new Date(anomaly.date);
  const start = new Date(startDate);
  const diffDays = Math.floor(
    (anomalyDate.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
  );
  return Math.max(0, Math.min(100, (diffDays / totalDays) * 100));
}

function formatPct(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

/* Anomaly Badge on timeline */
function AnomalyBadge({
  anomaly,
  position,
  metric,
}: {
  anomaly: AnomalyEvent;
  position: number;
  metric: GoalMetric;
}) {
  const isSpike = anomaly.kind === "spike";
  return (
    <div
      className={`goal-card__anomaly-badge goal-card__anomaly-badge--${isSpike ? "spike" : "dip"}`}
      style={{ left: `${position}%` }}
      title={
        anomaly.driverVideoTitle
          ? `${anomaly.kind.toUpperCase()} on ${anomaly.date}: ${anomaly.driverVideoTitle} (${formatPct(Math.abs(anomaly.driverDelta || 0))} ${METRIC_UNITS[metric]})`
          : `${anomaly.kind.toUpperCase()} on ${anomaly.date}: ${formatPct(Math.abs(anomaly.delta))} ${METRIC_UNITS[metric]}`
      }
    >
      {getStatusIconForAnomaly(anomaly.kind)}
    </div>
  );
}

export function GoalCard({
  goal,
  canEdit = false,
  onEdit,
  onDelete,
}: GoalCardProps): React.ReactElement {
  const navigate = useNavigate();
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const subFrameConfig = defaultSubFrameConfig(goal);
  const subFrames = supportsSubFrames(goal)
    ? computeSubFrames(goal, subFrameConfig)
    : [];
  const metSubFramesCount = subFrames.filter((f) => f.status === "met").length;

  const actualPct = Math.min(100, Math.max(0, goal.progressPercentage || 0));
  const expectedPct = Math.min(
    100,
    Math.max(0, goal.timeElapsedPercentage || 0),
  );

  const velocityDiff = goal.isActive
    ? (goal.currentDailyVelocity || 0) - (goal.requiredDailyVelocity || 0)
    : 0;

  const handleCardClick = (e: React.MouseEvent) => {
    // Avoid triggering navigation if clicking action buttons or interactive controls
    const target = e.target as HTMLElement;
    if (
      target.closest("button") ||
      target.closest("a") ||
      target.closest(".goal-card__actions")
    ) {
      return;
    }
    navigate(`/goals/${goal.id}`);
  };

  return (
    <>
      <article
        className={`goal-card goal-card--${goal.status}`}
        onClick={handleCardClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter") navigate(`/goals/${goal.id}`);
        }}
        style={
          {
            "--rt-goal-status-color": getGoalStatusColor(goal),
          } as React.CSSProperties
        }
      >
        {/* Actions top right */}
        {canEdit && (
          <div
            className="goal-card__actions"
            onClick={(e) => e.stopPropagation()}
          >
            {onEdit && (
              <Button
                variant="outline"
                bare
                onClick={() => onEdit(goal)}
                title="Edit goal"
                aria-label={`Edit goal: ${goal.title || METRIC_LABELS[goal.metric]}`}
              >
                <MdEdit size={14} />
              </Button>
            )}
            {onDelete && (
              <Button
                variant="danger"
                bare
                onClick={() => setConfirmDeleteOpen(true)}
                title="Delete goal"
                aria-label={`Delete goal: ${goal.title || METRIC_LABELS[goal.metric]}`}
              >
                <MdDelete size={14} />
              </Button>
            )}
          </div>
        )}

        {/* Card Header */}
        <div className="goal-card__header">
          <div className="goal-card__meta">
            <div className="goal-card__title-row">
              <span className="goal-card__metric-icon" aria-hidden>
                {getMetricIcon(goal.metric)}
              </span>
              <div className="goal-card__title-texts">
                <span className="goal-card__title">
                  {goal.title ?? `${METRIC_LABELS[goal.metric]} Target`}
                </span>
                <span className="goal-card__period-label">
                  {METRIC_LABELS[goal.metric]} · {getPeriodDisplay(goal)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Progress Section */}
        <div className="goal-card__progress-section">
          <div className="goal-card__progress-labels">
            <span
              className="goal-card__actual-value"
              aria-label={`Actual: ${formatNumber(goal.actualValue, goal.metric)}`}
            >
              {formatNumber(goal.actualValue, goal.metric)}
              <span className="goal-card__target-sub">
                {" "}
                / {formatNumber(goal.targetValue, goal.metric)}
              </span>
            </span>
            <span className="goal-card__progress-badge">
              {actualPct.toFixed(1)}% Achieved
            </span>
          </div>

          <div
            className="goal-card__progress-track"
            role="progressbar"
            aria-valuenow={actualPct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            {/* Linear expected pace (ghost bar) */}
            {goal.isActive && (
              <div
                className="goal-card__progress-expected"
                style={{ width: `${Math.min(100, expectedPct)}%` }}
                title={`Linear Expected: ${expectedPct.toFixed(0)}%`}
              />
            )}
            {/* Adaptive projection (dashed) */}
            {goal.isActive &&
              goal.hasAdaptiveData &&
              goal.adaptiveProjection && (
                <div
                  className="goal-card__progress-adaptive"
                  style={{
                    width: `${Math.min(100, ((goal.adaptiveProjection.trajectory[goal.daysElapsed - 1]?.adaptiveExpected ?? 0) / goal.targetValue) * 100)}%`,
                  }}
                  title="Adaptive Pace Trajectory"
                />
              )}
            {/* Anomaly badges on timeline */}
            {goal.isActive && goal.anomalies && goal.anomalies.length > 0 && (
              <div className="goal-card__anomaly-badges">
                {goal.anomalies.map((anomaly, idx) => (
                  <AnomalyBadge
                    key={idx}
                    anomaly={anomaly}
                    position={getAnomalyPosition(
                      anomaly,
                      goal.startDate,
                      goal.totalDays,
                    )}
                    metric={goal.metric}
                  />
                ))}
              </div>
            )}
            {/* Actual progress */}
            <div
              className="goal-card__progress-actual"
              style={{ width: `${Math.min(100, actualPct)}%` }}
            />
          </div>

          <div className="goal-card__progress-pct-row">
            <span className="goal-card__progress-pct-actual">
              {goal.daysElapsed}d elapsed ({expectedPct.toFixed(0)}% of time)
            </span>
            {goal.isActive && (
              <span className="goal-card__progress-expected-text">
                {expectedPct > actualPct
                  ? `${(expectedPct - actualPct).toFixed(1)}% behind schedule`
                  : `${(actualPct - expectedPct).toFixed(1)}% ahead of schedule`}
              </span>
            )}
          </div>
        </div>

        {/* Stats 4-Grid */}
        <div className="goal-card__stats">
          {goal.isActive && (
            <>
              <div className="goal-card__stat">
                <span className="goal-card__stat-label">Projected Finish</span>
                <span className="goal-card__stat-value">
                  {formatNumber(goal.projectedValue || 0, goal.metric)}
                </span>
              </div>
              <div className="goal-card__stat">
                <span className="goal-card__stat-label">Days Left</span>
                <span className="goal-card__stat-value">
                  <span className="goal-card__days-chip">
                    <MdSchedule size={12} />
                    {goal.daysRemaining}d
                  </span>
                </span>
              </div>
              <div className="goal-card__stat">
                <span className="goal-card__stat-label">Velocity / Day</span>
                <span
                  className={`goal-card__stat-value ${
                    velocityDiff >= 0
                      ? "goal-card__stat-value--positive"
                      : "goal-card__stat-value--negative"
                  }`}
                >
                  {formatNumber(goal.currentDailyVelocity || 0, goal.metric)}/d
                </span>
              </div>
              <div className="goal-card__stat">
                <span className="goal-card__stat-label">Required / Day</span>
                <span className="goal-card__stat-value">
                  {formatNumber(goal.requiredDailyVelocity || 0, goal.metric)}/d
                </span>
              </div>
            </>
          )}

          {goal.isPast && (
            <>
              <div className="goal-card__stat">
                <span className="goal-card__stat-label">Final Result</span>
                <span className="goal-card__stat-value">
                  {formatNumber(goal.actualValue, goal.metric)}
                </span>
              </div>
              <div className="goal-card__stat">
                <span className="goal-card__stat-label">Achievement</span>
                <span
                  className={`goal-card__stat-value ${
                    goal.status === "met"
                      ? "goal-card__stat-value--positive"
                      : "goal-card__stat-value--negative"
                  }`}
                >
                  {goal.progressPercentage.toFixed(1)}%
                </span>
              </div>
              <div className="goal-card__stat">
                <span className="goal-card__stat-label">Avg Daily Gain</span>
                <span className="goal-card__stat-value">
                  {formatNumber(goal.currentDailyVelocity || 0, goal.metric)}/d
                </span>
              </div>
              <div className="goal-card__stat">
                <span className="goal-card__stat-label">Total Duration</span>
                <span className="goal-card__stat-value">{goal.totalDays}d</span>
              </div>
            </>
          )}

          {goal.isUpcoming && (
            <>
              <div className="goal-card__stat">
                <span className="goal-card__stat-label">Target Value</span>
                <span className="goal-card__stat-value">
                  {formatNumber(goal.targetValue, goal.metric)}
                </span>
              </div>
              <div className="goal-card__stat">
                <span className="goal-card__stat-label">Starts In</span>
                <span className="goal-card__stat-value">
                  <span className="goal-card__days-chip">
                    <MdSchedule size={12} />
                    {Math.abs(
                      (goal.daysRemaining || 0) - (goal.totalDays || 0),
                    )}
                    d
                  </span>
                </span>
              </div>
              <div className="goal-card__stat">
                <span className="goal-card__stat-label">Goal Duration</span>
                <span className="goal-card__stat-value">{goal.totalDays}d</span>
              </div>
              <div className="goal-card__stat">
                <span className="goal-card__stat-label">Daily Target</span>
                <span className="goal-card__stat-value">
                  {formatNumber(goal.requiredDailyVelocity || 0, goal.metric)}/d
                </span>
              </div>
            </>
          )}
        </div>

        {/* Feature Badges Strip */}
        <div className="goal-card__badges-strip">
          {subFrames.length > 0 && (
            <span
              className="goal-card__sub-badge"
              title="Checkpoint Milestones"
            >
              <MdFlag size={12} />
              {metSubFramesCount}/{subFrames.length} Checkpoints ·{" "}
              {getGrowthSummary(subFrameConfig)}
            </span>
          )}
          {goal.hasAdaptiveData && (
            <span
              className="goal-card__adaptive-pill"
              title="Adaptive pacing enabled"
            >
              <MdInsights size={12} />
              Adaptive Active
            </span>
          )}
          {goal.anomalies && goal.anomalies.length > 0 && (
            <span
              className="goal-card__anomaly-pill"
              title={`${goal.anomalies.length} viral anomalies excluded`}
            >
              <MdWarning size={12} />
              {goal.anomalies.length}{" "}
              {goal.anomalies.length === 1 ? "Anomaly" : "Anomalies"}
            </span>
          )}
        </div>

        {/* Footer Link to Detail Page */}
        <Flex justifyContent="space-between">
          <span
            className={`goal-card__status-badge goal-card__status-badge--${goal.status}`}
            role="status"
          >
            {getStatusIcon(goal.status)}
            {STATUS_LABELS[goal.status]}
          </span>
          <Button
            variant="ghost"
            bare
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/goals/${goal.id}`);
            }}
          >
            <span>View Full Details & Graph</span>
            <MdArrowForward size={14} />
          </Button>
        </Flex>
      </article>

      <ConfirmModal
        isOpen={confirmDeleteOpen}
        title="Delete Goal"
        message={`Are you sure you want to delete "${goal.title || METRIC_LABELS[goal.metric]}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={() => {
          setConfirmDeleteOpen(false);
          onDelete?.(goal);
        }}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </>
  );
}

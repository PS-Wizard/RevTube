import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  MdTrackChanges,
  MdArrowForward,
  MdAdd,
  MdTrendingUp,
  MdTrendingDown,
  MdTrendingFlat,
  MdCheckCircle,
  MdInsights,
  MdExpandMore,
  MdExpandLess,
  MdSchedule,
  MdBarChart,
  MdPeople,
  MdAdsClick,
  MdThumbUp,
} from "react-icons/md";
import type { GoalSummary, Goal, GoalMetric } from "../../types/goals";
import { getGoalsSummary } from "../../services/goalsService";
import { METRIC_LABELS, METRIC_UNITS, STATUS_LABELS } from "../../types/goals";
import { Button } from "../ui";
import "./GoalsOverviewBanner.css";

interface GoalsOverviewBannerProps {
  channelId: string | null;
  organizationId?: string | null;
  canEdit?: boolean;
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

function getMetricIcon(metric: GoalMetric) {
  switch (metric) {
    case "views":
      return <MdBarChart size={16} />;
    case "subscribers":
      return <MdPeople size={16} />;
    case "ctr":
      return <MdAdsClick size={16} />;
    case "engagement_rate":
      return <MdThumbUp size={16} />;
    case "retention":
      return <MdInsights size={16} />;
    default:
      return <MdBarChart size={16} />;
  }
}

export function GoalsOverviewBanner({
  channelId,
  organizationId,
  canEdit = false,
}: GoalsOverviewBannerProps): React.ReactElement | null {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<GoalSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  useEffect(() => {
    if (!channelId) {
      return;
    }

    let isMounted = true;

    getGoalsSummary(channelId, organizationId)
      .then((data) => {
        if (isMounted) {
          setSummary(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.warn("[GoalsOverviewBanner] Failed to load summary:", err);
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [channelId, organizationId]);

  if (!channelId || loading || !summary) return null;

  const hasGoals = summary.total > 0;
  const activeGoals = summary.topActiveGoals || [];
  const hasAdaptiveGoals = activeGoals.some((g) => Boolean(g.hasAdaptiveData));

  return (
    <section
      className={`goals-banner ${isExpanded ? "goals-banner--expanded" : ""}`}
      aria-label="Performance Goals Summary"
    >
      {/* Top Header Row / Collapsed View */}
      <div className="goals-banner__header">
        <div className="goals-banner__left">
          <div className="goals-banner__title-group">
            <span className="goals-banner__icon" aria-hidden>
              <MdTrackChanges size={20} />
            </span>
            <h3 className="goals-banner__heading">
              Performance Goals & Pacing
            </h3>
            {hasAdaptiveGoals && (
              <span
                className="goals-banner__adaptive-badge"
                title="Adaptive pacing active with anomaly filtering"
              >
                <MdInsights size={13} /> Adaptive Pacing Active
              </span>
            )}
          </div>

          {/* Status count summary pills */}
          {hasGoals && (
            <div className="goals-banner__pills">
              {summary.ahead > 0 && (
                <span className="goals-banner__pill goals-banner__pill--ahead">
                  <MdTrendingUp size={12} /> {summary.ahead} Ahead
                </span>
              )}
              {summary.onTrack > 0 && (
                <span className="goals-banner__pill goals-banner__pill--on_track">
                  <MdTrendingFlat size={12} /> {summary.onTrack} On Track
                </span>
              )}
              {summary.behind > 0 && (
                <span className="goals-banner__pill goals-banner__pill--behind">
                  <MdTrendingDown size={12} /> {summary.behind} Behind
                </span>
              )}
              {summary.met > 0 && (
                <span className="goals-banner__pill goals-banner__pill--met">
                  <MdCheckCircle size={12} /> {summary.met} Met
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right Controls */}
        <div className="goals-banner__controls">
          {hasGoals ? (
            <>
              <Button
                variant="ghost"
                bare
                onClick={() => setIsExpanded(!isExpanded)}
                aria-expanded={isExpanded}
              >
                <span>
                  {isExpanded
                    ? "Hide Details"
                    : `Show Goals (${activeGoals.length})`}
                </span>
                {isExpanded ? (
                  <MdExpandLess size={18} />
                ) : (
                  <MdExpandMore size={18} />
                )}
              </Button>

              <Button
                variant="secondary"
                bare
                onClick={() => navigate("/goals")}
              >
                <span>All Goals ({summary.total})</span>
                <MdArrowForward size={14} />
              </Button>
            </>
          ) : (
            canEdit && (
              <Button variant="primary" onClick={() => navigate("/goals")}>
                <MdAdd size={16} /> Set Your First Goal
              </Button>
            )
          )}
        </div>
      </div>

      {/* Accordion Expanded Content */}
      {isExpanded && hasGoals && activeGoals.length > 0 && (
        <div className="goals-banner__expanded-body">
          <div className="goals-banner__cards-grid">
            {activeGoals.map((goal: Goal) => {
              const actualPct = Math.min(
                100,
                Math.max(0, goal.progressPercentage || 0),
              );
              const expectedPct = Math.min(
                100,
                Math.max(0, goal.timeElapsedPercentage || 0),
              );
              const velocityDelta =
                (goal.currentDailyVelocity || 0) -
                (goal.requiredDailyVelocity || 0);

              return (
                <div
                  key={goal.id}
                  className={`goals-banner__card goals-banner__card--${goal.status}`}
                  onClick={() => navigate(`/goals/${goal.id}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") navigate(`/goals/${goal.id}`);
                  }}
                >
                  <div className="goals-banner__card-head">
                    <div className="goals-banner__card-meta">
                      <span className="goals-banner__card-icon" aria-hidden>
                        {getMetricIcon(goal.metric)}
                      </span>
                      <div>
                        <div className="goals-banner__card-title">
                          {goal.title || `${METRIC_LABELS[goal.metric]} Target`}
                        </div>
                        <div className="goals-banner__card-subtitle">
                          {goal.startDate.slice(0, 10)} →{" "}
                          {goal.endDate.slice(0, 10)}
                        </div>
                      </div>
                    </div>

                    <span
                      className={`goals-banner__card-status goals-banner__card-status--${goal.status}`}
                    >
                      {STATUS_LABELS[goal.status]}
                    </span>
                  </div>

                  {/* Dual-track pacing bar */}
                  <div className="goals-banner__card-progress">
                    <div className="goals-banner__card-progress-labels">
                      <span className="goals-banner__card-progress-val">
                        {formatNumber(goal.actualValue, goal.metric)} /{" "}
                        {formatNumber(goal.targetValue, goal.metric)}
                      </span>
                      <span className="goals-banner__card-progress-pct">
                        {actualPct.toFixed(1)}% Achieved
                      </span>
                    </div>

                    <div
                      className="goals-banner__card-track"
                      role="progressbar"
                      aria-valuenow={actualPct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      {goal.isActive && (
                        <div
                          className="goals-banner__card-expected"
                          style={{ width: `${Math.min(100, expectedPct)}%` }}
                        />
                      )}
                      <div
                        className="goals-banner__card-actual"
                        style={{ width: `${Math.min(100, actualPct)}%` }}
                      />
                    </div>
                  </div>

                  {/* Metrics Row */}
                  <div className="goals-banner__card-stats">
                    <div>
                      <span className="goals-banner__card-stat-label">
                        Velocity / Day:
                      </span>
                      <span
                        className={`goals-banner__card-stat-val ${velocityDelta >= 0 ? "goals-banner__card-stat-val--positive" : "goals-banner__card-stat-val--negative"}`}
                      >
                        {formatNumber(
                          goal.currentDailyVelocity || 0,
                          goal.metric,
                        )}
                        /d
                      </span>
                    </div>
                    <div>
                      <span className="goals-banner__card-stat-label">
                        Days Left:
                      </span>
                      <span className="goals-banner__card-stat-val">
                        <MdSchedule size={11} style={{ marginRight: 2 }} />
                        {goal.daysRemaining}d
                      </span>
                    </div>
                  </div>

                  {/* Card link CTA */}
                  <div className="goals-banner__card-footer">
                    <span className="goals-banner__card-link">
                      View Full Details & Graph <MdArrowForward size={12} />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="goals-banner__expanded-footer">
            <Button
              variant="secondary"
              bare
              type="button"
              onClick={() => navigate("/goals")}
            >
              <span>Open Goals Management Hub</span>
              <MdArrowForward size={14} />
            </Button>
          </div>
        </div>
      )}

      {/* Empty State when no goals exist */}
      {!hasGoals && (
        <div className="goals-banner__empty">
          <p>
            Track channel performance with quarterly, yearly, weekly, and custom
            milestone targets with real-time velocity pacing and adaptive
            anomaly filtering.
          </p>
        </div>
      )}
    </section>
  );
}

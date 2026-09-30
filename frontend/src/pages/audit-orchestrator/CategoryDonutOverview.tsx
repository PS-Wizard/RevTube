import { useState } from "react";
import type { AuditSubRunParam } from "../../services/auditOrchestratorService";
import { paramPct, scoreColor } from "./auditOrchestratorUtils";

const DONUT_SLICE_COLORS = [
  "var(--rt-color-accent)",
  "var(--rt-chart-watch-time)",
  "var(--rt-chart-subs-gained)",
  "var(--rt-chart-likes)",
  "var(--rt-chart-comments)",
  "var(--rt-chart-uploads)",
  "var(--rt-chart-shares)",
  "var(--rt-chart-avg-view-duration)",
  "var(--rt-chart-engaged-views)",
  "var(--rt-color-warning)",
  "var(--rt-color-info)",
  "var(--rt-chart-views)",
];

export function CategoryDonutOverview({
  params,
  groupLabel,
  groupEarned,
  groupMax,
}: {
  params: AuditSubRunParam[];
  groupLabel: string;
  groupEarned: number;
  groupMax: number;
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const groupPct = groupMax > 0 ? Math.round((groupEarned / groupMax) * 100) : 0;
  const gc = scoreColor(groupPct);

  const totalPotentialUplift = params.reduce((acc, p) => acc + (p.impactGain || 0), 0);
  const passingCount = params.filter((p) => paramPct(p) >= 80).length;

  // Larger responsive donut dimensions
  const size = 260;
  const center = size / 2;
  const radius = 95;
  const strokeWidth = 26;
  const hoverStrokeWidth = 32;
  const circumference = 2 * Math.PI * radius;

  // Each param's arc is proportional to its MAX points (share of the category),
  // subdivided into an earned segment (param color) and a missed segment
  // (muted danger) so missing points are visible on the donut itself.
  const pointLen = groupMax > 0 ? circumference / groupMax : 0;
  const totalMissedPoints = params.reduce(
    (acc, p) =>
      acc +
      (typeof p.earned === "number" && typeof p.max === "number"
        ? Math.max(0, p.max - Math.max(0, p.earned))
        : 0),
    0,
  );
  interface DonutSlice {
    param: AuditSubRunParam;
    index: number;
    color: string;
    dashLength: number;
    offset: number;
    missedDashLength: number;
    missedOffset: number;
    ratio: number;
  }
  const slices = params.reduce<{ prev: number; list: DonutSlice[] }>(
    (acc, p, i) => {
      const max = typeof p.max === "number" && p.max > 0 ? p.max : 0;
      const earned = typeof p.earned === "number" ? Math.min(Math.max(0, p.earned), max) : 0;
      const earnedLength = earned * pointLen;
      const missedLength = (max - earned) * pointLen;
      const dashLength = earnedLength;
      const offset = -acc.prev;
      const missedOffset = -(acc.prev + earnedLength);
      acc.list.push({
        param: p,
        index: i,
        color: DONUT_SLICE_COLORS[i % DONUT_SLICE_COLORS.length],
        dashLength,
        offset,
        missedDashLength: missedLength,
        missedOffset,
        ratio: max * pointLen / circumference,
      });
      acc.prev += earnedLength + missedLength;
      return acc;
    },
    { prev: 0, list: [] },
  ).list;

  const activeSlice = hoveredIdx !== null ? slices[hoveredIdx] : null;

  return (
    <div className="aop-category-graph-banner">
      {/* Left 60% Width Column: Large Pie / Donut Chart */}
      <div className="aop-donut-chart-col">
        <div className="aop-donut-svg-wrapper">
          <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            style={{ transform: "rotate(-90deg)", display: "block" }}
          >
            {/* Background Track Circle */}
            <circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke="var(--rt-color-bg-subtle)"
              strokeWidth={strokeWidth}
            />
            {/* Slices: missed (muted danger) underneath, earned (param color) on top */}
            {slices.map((s) => {
              const isHovered = hoveredIdx === s.index;
              const sharedStyle = {
                transition: "stroke-width 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease",
                opacity: hoveredIdx === null || isHovered ? 1 : 0.35,
                cursor: "pointer",
              } as const;
              return (
                <g key={s.index}>
                  {s.missedDashLength > 0 && (
                    <circle
                      cx={center}
                      cy={center}
                      r={radius}
                      fill="none"
                      stroke="color-mix(in srgb, var(--rt-color-danger) 28%, var(--rt-color-bg-subtle))"
                      strokeWidth={isHovered ? hoverStrokeWidth : strokeWidth}
                      strokeDasharray={`${s.missedDashLength} ${circumference - s.missedDashLength}`}
                      strokeDashoffset={s.missedOffset}
                      style={sharedStyle}
                      onMouseEnter={() => setHoveredIdx(s.index)}
                      onMouseLeave={() => setHoveredIdx(null)}
                    />
                  )}
                  {s.dashLength > 0 && (
                    <circle
                      cx={center}
                      cy={center}
                      r={radius}
                      fill="none"
                      stroke={s.color}
                      strokeWidth={isHovered ? hoverStrokeWidth : strokeWidth}
                      strokeDasharray={`${s.dashLength} ${circumference - s.dashLength}`}
                      strokeDashoffset={s.offset}
                      style={sharedStyle}
                      onMouseEnter={() => setHoveredIdx(s.index)}
                      onMouseLeave={() => setHoveredIdx(null)}
                    />
                  )}
                </g>
              );
            })}
          </svg>

          {/* Donut Center Display */}
          <div className="aop-donut-center-info">
            {activeSlice ? (
              <>
                <span
                  style={{
                    fontSize: "var(--rt-text-sm)",
                    fontWeight: "var(--rt-weight-bold)",
                    color: "var(--rt-color-text)",
                    textAlign: "center",
                    maxWidth: 150,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {activeSlice.param.label}
                </span>
                <span
                  style={{
                    fontSize: "var(--rt-text-xl)",
                    fontWeight: "var(--rt-weight-bold)",
                    color: activeSlice.color,
                    lineHeight: 1.1,
                    margin: "2px 0",
                  }}
                >
                  {typeof activeSlice.param.earned === "number" ? Math.round(activeSlice.param.earned) : 0}
                  <span style={{ fontSize: "var(--rt-text-xs)", opacity: 0.8, marginLeft: 2 }}>
                    / {typeof activeSlice.param.max === "number" ? Math.round(activeSlice.param.max) : 100} pts
                  </span>
                </span>
                {activeSlice.missedDashLength > 0 && (
                  <span
                    style={{
                      fontSize: "var(--rt-text-2xs)",
                      fontWeight: "var(--rt-weight-bold)",
                      color: "var(--rt-color-danger)",
                      marginTop: 2,
                    }}
                  >
                    −{Math.round(activeSlice.missedDashLength / pointLen)} pts missed
                  </span>
                )}
                <span
                  style={{
                    fontSize: "var(--rt-text-2xs)",
                    color: "var(--rt-color-text-tertiary)",
                    fontWeight: "var(--rt-weight-medium)",
                  }}
                >
                  {Math.round(activeSlice.ratio * 100)}% of category
                </span>
              </>
            ) : (
              <>
                <span
                  style={{
                    fontSize: "2.25rem",
                    fontWeight: "var(--rt-weight-bold)",
                    color: gc.text,
                    lineHeight: 1,
                  }}
                >
                  {groupPct}%
                </span>
                <span
                  style={{
                    fontSize: "var(--rt-text-xs)",
                    fontWeight: "var(--rt-weight-semibold)",
                    color: "var(--rt-color-text-secondary)",
                    marginTop: 4,
                  }}
                >
                  {Math.round(groupEarned)} / {Math.round(groupMax)} pts
                </span>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: "var(--rt-weight-bold)",
                    color: gc.text,
                    backgroundColor: gc.bg,
                    padding: "2px 10px",
                    borderRadius: "var(--rt-radius-pill)",
                    marginTop: 6,
                  }}
                >
                  {groupPct >= 80 ? "Optimal" : groupPct >= 50 ? "Needs Work" : "Critical Fix"}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="aop-donut-chart-caption">
          {groupLabel
            ? `${groupLabel} Score Distribution (earned vs missed)`
            : "Score Distribution (earned vs missed)"}
        </div>
      </div>

      {/* Right 40% Width Column: Clean Legend & Breakdown */}
      <div className="aop-donut-details-col">
        <div className="aop-donut-details-header">
          <div className="aop-donut-details-title">Evaluated Parameters</div>
          <div className="aop-donut-details-badges">
            <span className="aop-donut-badge-metric">
              {passingCount}/{params.length} passing
            </span>
            {totalMissedPoints > 0 && (
              <span
                className="aop-donut-badge-metric"
                style={{ color: "var(--rt-color-danger)" }}
              >
                −{totalMissedPoints} pts missed
              </span>
            )}
            {totalPotentialUplift > 0 && (
              <span className="aop-donut-badge-gain">
                +{totalPotentialUplift} pts gain
              </span>
            )}
          </div>
        </div>

        <div className="aop-donut-legend-scroll">
          {slices.map((s) => {
            const isHovered = hoveredIdx === s.index;
            const earned = typeof s.param.earned === "number" ? Math.round(s.param.earned) : 0;
            const max = typeof s.param.max === "number" && s.param.max > 0 ? Math.round(s.param.max) : 100;
            const missed = Math.max(0, max - earned);
            const pct = paramPct(s.param);

            return (
              <div
                key={s.index}
                className={`aop-donut-legend-row ${isHovered ? "active" : ""}`}
                onMouseEnter={() => setHoveredIdx(s.index)}
                onMouseLeave={() => setHoveredIdx(null)}
              >
                <div className="aop-donut-legend-row-left">
                  <div className="aop-donut-legend-dot" style={{ backgroundColor: s.color }} />
                  <span className="aop-donut-legend-name" title={s.param.label}>
                    {s.param.label}
                  </span>
                </div>

                <div className="aop-donut-legend-row-right">
                  <span className="aop-donut-legend-pts">
                    {earned}/{max}
                  </span>
                  {missed > 0 && (
                    <span
                      className="aop-donut-legend-pts"
                      style={{ color: "var(--rt-color-danger)", opacity: 0.85 }}
                      title={`${missed} point${missed === 1 ? "" : "s"} missed`}
                    >
                      −{missed}
                    </span>
                  )}
                  <span
                    className="aop-donut-legend-pct"
                    style={{
                      color: pct >= 80 ? "var(--rt-color-success)" : pct >= 50 ? "var(--rt-color-warning)" : "var(--rt-color-danger)",
                    }}
                  >
                    {pct}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

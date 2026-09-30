import { Box, Button, Typography } from "../../components/ui";
import {
  CheckCircle2,
  RefreshCw,
  Target,
  TrendingUp,
  Video,
} from "lucide-react";
import type { AuditOrchestratorResult } from "../../services/auditOrchestratorService";
import type { ExecutiveStats } from "./auditOrchestratorTypes";
import { scoreColor, scoreToLabel } from "./auditOrchestratorUtils";

export interface AuditExecutiveScorecardProps {
  result?: AuditOrchestratorResult | null;
  overall?: number | null;
  grade?: string | null;
  title?: string;
  description?: string;
  executiveStats: ExecutiveStats | null;
  onRerun?: () => void;
  rerunPending?: boolean;
  canRunAudits?: boolean;
  lastAuditedAt?: string | null;
}

export function AuditExecutiveScorecard({
  result,
  overall,
  grade,
  title,
  description,
  executiveStats,
  onRerun,
  rerunPending = false,
  canRunAudits = true,
  lastAuditedAt,
}: AuditExecutiveScorecardProps) {
  const scoreVal = result ? result.overall : overall != null ? overall : null;
  const gradeVal = result ? result.grade : grade || null;
  const clampedScore = scoreVal != null ? Math.max(0, Math.min(100, scoreVal)) : 0;
  const overallColor = scoreColor(clampedScore);

  // SVG Radial Gauge geometry: 104px outer size, 7px stroke width
  const size = 104;
  const strokeWidth = 7;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset =
    scoreVal != null
      ? circumference - (clampedScore / 100) * circumference
      : circumference;

  const formattedDate = lastAuditedAt
    ? new Date(lastAuditedAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div className="aop-exec-scorecard">
      <div className="aop-exec-top">
        <div className="aop-exec-hero">
          <div className="aop-score-dial">
            <svg
              width={size}
              height={size}
              className="aop-score-dial-svg"
              viewBox={`0 0 ${size} ${size}`}
              aria-label={`Score: ${scoreVal != null ? Math.round(scoreVal) : 0} out of 100`}
            >
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke="var(--rt-color-bg-muted)"
                strokeWidth={strokeWidth}
              />
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={overallColor.text}
                strokeWidth={strokeWidth}
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                style={{
                  transition: "stroke-dashoffset 0.6s cubic-bezier(0.4, 0, 0.2, 1)",
                }}
              />
            </svg>
            <div className="aop-score-dial-content">
              <span className="aop-score-hero-val" style={{ color: overallColor.text }}>
                {scoreVal != null ? Math.round(scoreVal) : "—"}
              </span>
              <span className="aop-score-hero-max">/100</span>
            </div>
          </div>

          <div className="aop-exec-headline">
            {gradeVal && (
              <div className="aop-status-tag-row">
                <span
                  className="aop-status-tag"
                  style={{
                    color: overallColor.text,
                    borderColor: overallColor.text,
                    backgroundColor: overallColor.bg,
                  }}
                >
                  <span className="aop-status-dot" />
                  Grade {gradeVal} • {scoreToLabel(clampedScore)}
                </span>
              </div>
            )}
            <Typography
              sx={{
                fontSize: "var(--rt-text-xl)",
                fontWeight: "var(--rt-weight-bold)",
                color: "var(--rt-color-text)",
                lineHeight: "var(--rt-leading-tight)",
                mt: 0.5,
              }}
            >
              {title || "Overall Channel Health"}
            </Typography>
            <Typography
              sx={{
                color: "var(--rt-color-text-secondary)",
                fontSize: "var(--rt-text-sm)",
                lineHeight: 1.45,
                maxWidth: 620,
              }}
            >
              {description ||
                "Evaluated across Identity, Video SEO, Playlist Structure, and Publishing Trends."}
            </Typography>
          </div>
        </div>

        <div className="aop-exec-actions">
          {formattedDate && (
            <span className="aop-audit-timestamp">
              Audited {formattedDate}
            </span>
          )}
          {onRerun && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
              <Button
                variant="secondary"
                size="small"
                startIcon={
                  <RefreshCw
                    size={13}
                    style={rerunPending ? { animation: "spin 1s linear infinite" } : undefined}
                  />
                }
                onClick={onRerun}
                disabled={rerunPending || !canRunAudits}
              >
                {rerunPending ? "Auditing..." : "Re-run Audit"}
              </Button>
            </Box>
          )}
        </div>
      </div>

      {executiveStats && (
        <div className="aop-kpi-grid">
          <div className="aop-kpi-tile">
            <div className="aop-kpi-header">
              <TrendingUp size={14} className="aop-kpi-icon aop-kpi-icon--uplift" />
              <span className="aop-kpi-label">Potential Uplift</span>
            </div>
            <span className="aop-kpi-value" style={{ color: "var(--rt-color-success)" }}>
              +{executiveStats.totalPotentialGain}
              <span className="aop-kpi-unit">pts</span>
            </span>
            <span className="aop-kpi-sub">
              Target: {executiveStats.projectedMax} / 100 max
            </span>
          </div>

          <div className="aop-kpi-tile">
            <div className="aop-kpi-header">
              <Target size={14} className="aop-kpi-icon aop-kpi-icon--target" />
              <span className="aop-kpi-label">Projected Target</span>
            </div>
            <span className="aop-kpi-value">
              {executiveStats.projectedMax}
              <span className="aop-kpi-unit">/ 100</span>
            </span>
            <span className="aop-kpi-sub">
              Headroom from identified fixes
            </span>
          </div>

          <div className="aop-kpi-tile">
            <div className="aop-kpi-header">
              <CheckCircle2 size={14} className="aop-kpi-icon aop-kpi-icon--actions" />
              <span className="aop-kpi-label">Action Items</span>
            </div>
            <span className="aop-kpi-value">
              {executiveStats.recCount}
              <span className="aop-kpi-unit">fixes</span>
            </span>
            <span className="aop-kpi-sub">
              {executiveStats.highCount > 0
                ? `${executiveStats.highCount} high priority fixes`
                : "All medium/low priority"}
            </span>
          </div>

          <div className="aop-kpi-tile">
            <div className="aop-kpi-header">
              <Video size={14} className="aop-kpi-icon aop-kpi-icon--sample" />
              <span className="aop-kpi-label">Audited Scope</span>
            </div>
            <span className="aop-kpi-value">
              {executiveStats.auditedVideosCount || "—"}
              <span className="aop-kpi-unit">videos</span>
            </span>
            <span className="aop-kpi-sub">Evaluated across 4 pillars</span>
          </div>
        </div>
      )}
    </div>
  );
}

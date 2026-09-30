import { useMemo, useState } from "react";
import { Box, Button, Typography } from "../../components/ui";
import { TrendingUp } from "lucide-react";
import type {
  AuditSubRunRecommendation,
  AuditSubRunScore,
} from "../../services/auditOrchestratorService";
import { SUB_RUNS } from "./auditOrchestratorTypes";
import {
  RecMessage,
  scoreColor,
  scoreToGrade,
  scoreToLabel,
  sevColor,
} from "./auditOrchestratorUtils";

export function ScoreUpliftSimulator({
  currentScore,
  subRuns,
}: {
  currentScore: number;
  subRuns: Record<string, AuditSubRunScore>;
}) {
  const [resolvedKeys, setResolvedKeys] = useState<Set<string>>(new Set());

  // Aggregate all recommendations across sub-runs
  const allRecommendations = useMemo(() => {
    const list: Array<AuditSubRunRecommendation & { subRunLabel: string; keyId: string }> = [];
    for (const def of SUB_RUNS) {
      const sub = subRuns[def.key];
      if (sub?.recommendations) {
        for (let i = 0; i < sub.recommendations.length; i++) {
          const r = sub.recommendations[i];
          list.push({
            ...r,
            subRunLabel: def.label,
            keyId: `${def.key}-${r.paramKey || i}`,
          });
        }
      }
    }
    return list;
  }, [subRuns]);

  const totalPossibleUplift = useMemo(() => {
    return allRecommendations.reduce((s, r) => s + (r.impactGain || 0), 0);
  }, [allRecommendations]);

  const currentSimulatedGain = useMemo(() => {
    return allRecommendations
      .filter((r) => resolvedKeys.has(r.keyId))
      .reduce((s, r) => s + (r.impactGain || 0), 0);
  }, [allRecommendations, resolvedKeys]);

  const projectedScore = Math.min(100, Math.round(currentScore + currentSimulatedGain));
  const maxProjectedScore = Math.min(100, Math.round(currentScore + totalPossibleUplift));
  const projectedColor = scoreColor(projectedScore);

  const toggleKey = (keyId: string) => {
    setResolvedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(keyId)) next.delete(keyId);
      else next.add(keyId);
      return next;
    });
  };

  const selectAll = () => {
    setResolvedKeys(new Set(allRecommendations.map((r) => r.keyId)));
  };

  const clearAll = () => {
    setResolvedKeys(new Set());
  };

  const [sevFilter, setSevFilter] = useState<"all" | "high" | "medium" | "low">("all");

  const sevCounts = useMemo(() => {
    const counts = { high: 0, medium: 0, low: 0 };
    for (const r of allRecommendations) {
      if (r.severity === "high" || r.severity === "medium") counts[r.severity] += 1;
      else counts.low += 1;
    }
    return counts;
  }, [allRecommendations]);

  const groups = useMemo(() => {
    return SUB_RUNS.map((def) => {
      const items = allRecommendations.filter(
        (r) => r.subRunLabel === def.label && (sevFilter === "all" || (r.severity || "low") === sevFilter),
      );
      return {
        def,
        items,
        gain: items.reduce((s, r) => s + (r.impactGain || 0), 0),
        done: items.filter((r) => resolvedKeys.has(r.keyId)).length,
      };
    }).filter((g) => g.items.length > 0);
  }, [allRecommendations, sevFilter, resolvedKeys]);

  if (allRecommendations.length === 0) return null;

  return (
    <div className="aop-simulator-card">
      <div className="aop-simulator-header">
        <div>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
            <TrendingUp size={18} style={{ color: "var(--rt-color-accent)" }} />
            <Typography
              sx={{
                fontSize: "var(--rt-text-md)",
                fontWeight: "var(--rt-weight-bold)",
                color: "var(--rt-color-text)",
              }}
            >
              Score Uplift Simulator
            </Typography>
          </Box>
          <Typography
            sx={{
              fontSize: "var(--rt-text-xs)",
              color: "var(--rt-color-text-secondary)",
            }}
          >
            Check off proposed fixes below to preview projected channel health rating.
          </Typography>
        </div>

        <div className="aop-simulator-stats">
          <div className="aop-simulator-stat-box">
            <span className="aop-simulator-stat-label">Current</span>
            <span className="aop-simulator-stat-val">{Math.round(currentScore)} pts</span>
          </div>

          <div className="aop-simulator-stat-box" style={{ borderColor: "var(--rt-color-success)" }}>
            <span className="aop-simulator-stat-label" style={{ color: "var(--rt-color-success)" }}>
              Simulated Gain
            </span>
            <span className="aop-simulator-stat-val" style={{ color: "var(--rt-color-success)" }}>
              +{currentSimulatedGain} pts
            </span>
          </div>

          <div className="aop-simulator-stat-box" style={{ borderColor: projectedColor.text }}>
            <span className="aop-simulator-stat-label">Projected</span>
            <span className="aop-simulator-stat-val" style={{ color: projectedColor.text }}>
              {projectedScore} pts
              <span style={{ fontSize: "var(--rt-text-xs)", opacity: 0.8, marginLeft: 4 }}>
                ({scoreToGrade(projectedScore)})
              </span>
            </span>
          </div>
        </div>
      </div>

      <Box sx={{ mb: 2.5 }}>
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", mb: 0.75 }}>
          <Typography sx={{ fontSize: "var(--rt-text-xs)", fontWeight: "var(--rt-weight-semibold)", color: "var(--rt-color-text-secondary)" }}>
            Rating: {scoreToLabel(projectedScore)} • Max Reachable: {maxProjectedScore} pts (+{totalPossibleUplift} max)
          </Typography>
          <Typography sx={{ fontSize: "var(--rt-text-2xs)", color: "var(--rt-color-text-tertiary)" }}>
            {resolvedKeys.size} of {allRecommendations.length} fixes selected
          </Typography>
        </Box>
        <Box className="aop-sim-progress">
          <Box
            className="aop-sim-progress-fill"
            style={{ width: `${projectedScore}%`, backgroundColor: projectedColor.text }}
          />
        </Box>
      </Box>

      <Box sx={{ mb: 2.5, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1.5, flexWrap: "wrap" }}>
        <Box className="aop-sim-filter-row" role="group" aria-label="Filter fixes by severity" sx={{ mb: 0 }}>
          {(["all", "high", "medium", "low"] as const).map((s) => {
            const count = s === "all" ? allRecommendations.length : sevCounts[s];
            return (
              <button
                key={s}
                type="button"
                className={`rt-filter-chip ${sevFilter === s ? "rt-filter-chip--active" : ""}`}
                onClick={() => setSevFilter(s)}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)} ({count})
              </button>
            );
          })}
        </Box>

        <Box sx={{ display: "flex", gap: 1 }}>
          <Button
            size="small"
            variant="secondary"
            onClick={selectAll}
          >
            Select All Fixes
          </Button>
          <Button
            size="small"
            variant="ghost"
            onClick={clearAll}
          >
            Reset
          </Button>
        </Box>
      </Box>

      {/* Checklist Groups */}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {groups.map((g) => (
          <Box key={g.def.key}>
            <div className="aop-sim-group-header">
              <span className="aop-sim-group-title">{g.def.label}</span>
              <span className="aop-sim-group-meta">
                {g.done}/{g.items.length} selected • +{g.gain} pts possible
              </span>
            </div>

            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
              {g.items.map((r) => {
                const isResolved = resolvedKeys.has(r.keyId);
                const c = sevColor(r.severity);

                return (
                  <div
                    key={r.keyId}
                    className={`aop-checklist-item ${isResolved ? "resolved" : ""}`}
                    style={{ borderLeft: `3px solid ${c.text}` }}
                    onClick={() => toggleKey(r.keyId)}
                  >
                    <input
                      type="checkbox"
                      checked={isResolved}
                      onChange={() => toggleKey(r.keyId)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ width: 16, height: 16, marginTop: 2, cursor: "pointer", accentColor: "var(--rt-color-accent)" }}
                    />
                    <Box sx={{ flex: 1 }}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", mb: 0.5 }}>
                        <Typography
                          sx={{
                            fontSize: "11px",
                            fontWeight: "var(--rt-weight-bold)",
                            color: c.text,
                            bgcolor: c.bg,
                            px: 1,
                            py: 0.15,
                            borderRadius: "var(--rt-radius-pill)",
                            textTransform: "capitalize",
                          }}
                        >
                          {r.severity || "low"} priority
                        </Typography>

                        {r.impactGain ? (
                          <Box
                            component="span"
                            sx={{
                              fontSize: "11px",
                              fontWeight: "var(--rt-weight-bold)",
                              color: "var(--rt-color-success)",
                              bgcolor: "var(--rt-color-success-surface)",
                              px: 1,
                              py: 0.15,
                              borderRadius: "var(--rt-radius-pill)",
                            }}
                          >
                            +{r.impactGain} pts
                          </Box>
                        ) : null}
                      </Box>

                      <Typography
                        sx={{
                          fontSize: "var(--rt-text-xs)",
                          color: "var(--rt-color-text)",
                          lineHeight: 1.45,
                          textDecoration: isResolved ? "line-through" : "none",
                          opacity: isResolved ? 0.75 : 1,
                        }}
                      >
                        <RecMessage message={r.message} struck={isResolved} />
                      </Typography>
                    </Box>
                  </div>
                );
              })}
            </Box>
          </Box>
        ))}
      </Box>
    </div>
  );
}

import { AlertTriangle, ChevronDown, ExternalLink } from "lucide-react";
import { useMemo } from "react";
import { AuditedVideosTable } from "../../components/audit/AuditedVideosTable";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Typography,
} from "../../components/ui";
import type {
  AuditedVideoItem,
  AuditSubRunParam,
  AuditSubRunRecommendation,
} from "../../services/auditOrchestratorService";
import type { SubRunDef } from "./auditOrchestratorTypes";
import {
  GatedNote,
  groupParamsByCategory,
  paramPct,
  RecMessage,
  scoreColor,
  sevColor,
} from "./auditOrchestratorUtils";
import { CategoryDonutOverview } from "./CategoryDonutOverview";
import { CircularScoreRing } from "./CircularScoreRing";

export interface SubRunAccordionProps {
  def: SubRunDef;
  score: number | undefined;
  meta?: Record<string, unknown>;
  status?: string;
  params?: AuditSubRunParam[];
  recommendations?: AuditSubRunRecommendation[];
  /** Open the specific saved audit for this sub-run (resolved by the parent). */
  onDeepLink: (def: SubRunDef) => void;
  defaultExpanded: boolean;
}

export function SubRunAccordion({
  def,
  score,
  meta,
  status,
  params = [],
  recommendations = [],
  onDeepLink,
  defaultExpanded,
}: SubRunAccordionProps) {
  const color = scoreColor(score ?? 0);
  const Icon = def.icon;
  const failed = status === "failed";
  const nicheText = meta?.niche
    ? `Dominant niche: ${String(meta.niche)}`
    : null;

  const videosList = (meta?.videos as AuditedVideoItem[] | undefined) || [];
  const paramGroups = useMemo(() => groupParamsByCategory(params), [params]);
  const totalSubMax = useMemo(
    () =>
      params.reduce(
        (s, p) => s + (typeof p.max === "number" && p.max > 0 ? p.max : 0),
        0,
      ),
    [params],
  );
  const totalSubEarned = useMemo(
    () =>
      params.reduce(
        (s, p) => s + (typeof p.earned === "number" ? p.earned : 0),
        0,
      ),
    [params],
  );

  return (
    <Accordion
      defaultExpanded={defaultExpanded}
      disableGutters
      className="aop-detail-accordion"
      sx={{
        bgcolor: "var(--rt-color-bg-elevated)",
        border: "1px solid var(--rt-color-border)",
        borderRadius: "var(--rt-radius-lg)",
        mb: 2,
        "&:before": { display: "none" },
      }}
    >
      <AccordionSummary
        expandIcon={
          <ChevronDown
            size={18}
            style={{ color: "var(--rt-color-text-tertiary)" }}
          />
        }
        sx={{ px: 3, py: 1.5, minHeight: 64 }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            flex: 1,
            minWidth: 0,
          }}
        >
          <div className="aop-category-icon-box">
            <Icon size={18} />
          </div>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              sx={{
                fontSize: "var(--rt-text-sm)",
                fontWeight: "var(--rt-weight-bold)",
                color: "var(--rt-color-text)",
              }}
            >
              {def.label}
            </Typography>
            <Typography
              variant="caption"
              sx={{
                color: "var(--rt-color-text-tertiary)",
                fontSize: "var(--rt-text-2xs)",
              }}
            >
              {failed
                ? "Sub-audit failed to complete"
                : (nicheText ??
                  `${params.length} evaluated parameter(s) • ${recommendations.length} action item(s)`)}
            </Typography>
          </Box>
          <Box
            sx={{
              fontSize: "var(--rt-text-sm)",
              fontWeight: "var(--rt-weight-bold)",
              color: color.text,
              bgcolor: color.bg,
              px: 1.5,
              py: 0.4,
              borderRadius: "var(--rt-radius-pill)",
              flexShrink: 0,
            }}
          >
            {score != null ? `${Math.round(score)}` : "—"}
            <span
              style={{
                fontSize: "var(--rt-text-2xs)",
                opacity: 0.75,
                fontWeight: "normal",
              }}
            >
              /100
            </span>
          </Box>
        </Box>
      </AccordionSummary>

      <AccordionDetails
        className="aop-accordion-details"
        sx={{
          px: { xs: 2.5, sm: 4 },
          pb: 4,
          pt: 2.5,
          borderTop: "1px solid var(--rt-color-border)",
        }}
      >
        {failed && (
          <Box
            sx={{
              mb: 2.5,
              p: 2,
              borderRadius: "var(--rt-radius-md)",
              bgcolor: "var(--rt-color-bg-subtle)",
              border: "1px solid var(--rt-color-border)",
              display: "flex",
              gap: 1.5,
              alignItems: "flex-start",
            }}
          >
            <AlertTriangle
              size={16}
              style={{
                color: "var(--rt-color-danger)",
                flexShrink: 0,
                marginTop: 2,
              }}
            />
            <Typography
              sx={{
                fontSize: "var(--rt-text-xs)",
                color: "var(--rt-color-text)",
                lineHeight: 1.45,
              }}
            >
              This audit could not be completed.{" "}
              {meta?.error ? `Error: ${String(meta.error)}` : ""}
            </Typography>
          </Box>
        )}

        {params.length > 0 && (
          <Box sx={{ mb: 4 }}>
            {/* Grand 60% Width Donut Overview for the Sub-Audit */}
            <CategoryDonutOverview
              params={params}
              groupLabel={def.label}
              groupEarned={totalSubEarned}
              groupMax={totalSubMax}
            />

            {/* Evaluated Parameters Grid & Groups */}
            <Box sx={{ mt: 3.5 }}>
              {paramGroups.map((group) => {
                const groupMax = group.params.reduce(
                  (s, p) =>
                    s + (typeof p.max === "number" && p.max > 0 ? p.max : 0),
                  0,
                );
                const groupEarned = group.params.reduce(
                  (s, p) => s + (typeof p.earned === "number" ? p.earned : 0),
                  0,
                );
                const groupPct =
                  groupMax > 0
                    ? Math.max(
                        0,
                        Math.min(
                          100,
                          Math.round((groupEarned / groupMax) * 100),
                        ),
                      )
                    : 0;
                const gc = scoreColor(groupPct);

                return (
                  <Box
                    key={`${def.key}-cat-${group.category}`}
                    sx={{ mb: 3.5 }}
                  >
                    {paramGroups.length > 1 && (
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          mb: 1.5,
                          pb: 1,
                          borderBottom: "1px solid var(--rt-color-border)",
                        }}
                      >
                        <Typography
                          sx={{
                            fontSize: "var(--rt-text-xs)",
                            fontWeight: "var(--rt-weight-bold)",
                            color: "var(--rt-color-text)",
                          }}
                        >
                          {group.label}
                        </Typography>
                        <Box
                          component="span"
                          sx={{
                            fontSize: "11px",
                            fontWeight: "var(--rt-weight-bold)",
                            color: gc.text,
                            bgcolor: gc.bg,
                            px: 1.25,
                            py: 0.25,
                            borderRadius: "var(--rt-radius-pill)",
                          }}
                        >
                          {Math.round(groupEarned)} / {Math.round(groupMax)} pts
                          ({groupPct}%)
                        </Box>
                      </Box>
                    )}

                    <div className="aop-param-cards-grid">
                      {group.params.map((p) => {
                        const pct = paramPct(p);
                        const c = scoreColor(pct);
                        const statusLabel =
                          pct >= 80
                            ? "Optimal"
                            : pct >= 50
                              ? "Needs Work"
                              : "Critical Fix";
                        return (
                          <div
                            key={`${def.key}-${p.key}`}
                            className="aop-param-card"
                          >
                            <div className="aop-param-card-header">
                              <span className="aop-param-card-title">
                                {p.label}
                              </span>
                              {p.impactGain ? (
                                <span className="aop-param-impact-badge">
                                  +{p.impactGain} pts
                                </span>
                              ) : null}
                            </div>
                            <div className="aop-param-card-body">
                              <CircularScoreRing
                                pct={pct}
                                size={46}
                                strokeWidth={5}
                                color={c.text}
                              />
                              <div className="aop-param-card-stats">
                                <div className="aop-param-card-score-value">
                                  {typeof p.earned === "number"
                                    ? Math.round(p.earned)
                                    : "—"}
                                  <span className="aop-param-card-score-max">
                                    {typeof p.max === "number" && p.max > 0
                                      ? ` / ${Math.round(p.max)} pts`
                                      : " pts"}
                                  </span>
                                </div>
                                <span
                                  className="aop-param-status-pill"
                                  style={{
                                    color: c.text,
                                    backgroundColor: c.bg,
                                  }}
                                >
                                  {statusLabel}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Box>
                );
              })}
            </Box>
          </Box>
        )}

        {recommendations.length > 0 && (
          <Box sx={{ mb: videosList.length > 0 ? 3 : 0 }}>
            <Typography
              sx={{
                fontSize: "var(--rt-text-xs)",
                fontWeight: "var(--rt-weight-bold)",
                color: "var(--rt-color-text-secondary)",
                mb: 1.5,
              }}
            >
              Identified Recommendations & Score Uplift
            </Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {recommendations.map((r, i) => {
                const c = sevColor(r.severity);
                return (
                  <Box
                    key={`${def.key}-rec-${i}`}
                    sx={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 1.25,
                      p: 1.5,
                      borderRadius: "var(--rt-radius-md)",
                      bgcolor: "var(--rt-color-bg-subtle)",
                      border: "1px solid var(--rt-color-border)",
                      borderLeft: `3px solid ${c.text}`,
                    }}
                  >
                    <AlertTriangle
                      size={15}
                      style={{ color: c.text, flexShrink: 0, marginTop: 2 }}
                    />
                    <Box sx={{ flex: 1 }}>
                      <Typography
                        sx={{
                          fontSize: "var(--rt-text-xs)",
                          color: "var(--rt-color-text)",
                          lineHeight: 1.45,
                        }}
                      >
                        <RecMessage message={r.message} />
                      </Typography>
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 1,
                          mt: 0.75,
                          flexWrap: "wrap",
                        }}
                      >
                        <Typography
                          variant="caption"
                          sx={{
                            color: c.text,
                            fontWeight: "var(--rt-weight-bold)",
                            fontSize: "var(--rt-text-2xs)",
                            textTransform: "capitalize",
                          }}
                        >
                          {r.severity} severity
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
                            Fixing this gains +{r.impactGain} pts to score
                          </Box>
                        ) : null}
                      </Box>
                    </Box>
                  </Box>
                );
              })}
            </Box>
          </Box>
        )}

        <GatedNote
          gated={(meta as Record<string, unknown> | undefined)?.gatedCriteria}
        />

        {/* Audited Videos Table (specifically inside Video sub-audit) */}
        {def.key === "video" && videosList.length > 0 && (
          <AuditedVideosTable videos={videosList} />
        )}

        {params.length === 0 && recommendations.length === 0 && !failed && (
          <Typography
            sx={{
              fontSize: "var(--rt-text-xs)",
              color: "var(--rt-color-text-tertiary)",
            }}
          >
            No detailed parameters or recommendations were captured for this
            audit.
          </Typography>
        )}

        {(def.key === "video" || def.key === "playlist") && (
          <Box
            sx={{
              mt: 2,
              pt: 1.5,
              borderTop: "1px solid var(--rt-color-border)",
            }}
          >
            <Button
              variant="text"
              size="small"
              endIcon={<ExternalLink size={13} />}
              onClick={() => onDeepLink(def)}
            >
              Open dedicated {def.deepLinkLabel ?? (def.key === "video" ? "Video Audit" : "Playlist Optimizer")}
            </Button>
          </Box>
        )}
      </AccordionDetails>
    </Accordion>
  );
}

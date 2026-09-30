import { Box, Typography } from "../../components/ui";
import { Lightbulb } from "lucide-react";
import type { AuditedVideoItem } from "../../services/auditOrchestratorService";

export function VideoDeepDetail({ item }: { item: AuditedVideoItem }) {
  const elements = (item.elements || []).filter((e) => e.max > 0);
  const recos = item.recommendations || [];
  const suggestions = item.suggestions || {};

  return (
    <Box className="aop-video-deep">
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
        <Lightbulb size={16} style={{ color: "var(--rt-color-accent)" }} />
        <Typography sx={{ fontSize: "var(--rt-text-sm)", fontWeight: "var(--rt-weight-bold)", color: "var(--rt-color-text)" }}>
          Deep Video SEO & Creative Breakdown
        </Typography>
        {item.score != null && (
          <Typography sx={{ fontSize: "var(--rt-text-xs)", color: "var(--rt-color-text-secondary)", ml: "auto" }}>
            Audit Score: <b>{Math.round((item.score as number) * 10) / 10} / 100</b>
          </Typography>
        )}
      </Box>

      {elements.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography sx={{ fontSize: "var(--rt-text-2xs)", color: "var(--rt-color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em", mb: 1, fontWeight: "var(--rt-weight-bold)" }}>
            Individual Element Scores (0–10)
          </Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
            {elements.map((e) => {
              const pct = e.max > 0 ? Math.min(100, (e.score / e.max) * 100) : 0;
              const color = (e.score as number) >= 8 ? "var(--rt-color-success)" : (e.score as number) >= 5 ? "var(--rt-color-warning)" : "var(--rt-color-danger)";
              return (
                <Box
                  key={e.element}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    px: 1.25,
                    py: 0.5,
                    borderRadius: "var(--rt-radius-pill)",
                    border: "1px solid var(--rt-color-border)",
                    bgcolor: "var(--rt-color-bg-elevated)",
                  }}
                >
                  <span style={{ fontSize: "var(--rt-text-xs)", fontWeight: "var(--rt-weight-medium)", color: "var(--rt-color-text)" }}>
                    {e.element}
                  </span>
                  <Box sx={{ width: 44, height: 5, borderRadius: "var(--rt-radius-pill)", bgcolor: "var(--rt-color-bg-muted)", overflow: "hidden" }}>
                    <Box sx={{ width: `${pct}%`, height: "100%", borderRadius: "var(--rt-radius-pill)", bgcolor: color }} />
                  </Box>
                  <span style={{ fontSize: "var(--rt-text-xs)", fontWeight: "var(--rt-weight-bold)", color }}>
                    {e.score}/{e.max}
                  </span>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}

      {recos.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography sx={{ fontSize: "var(--rt-text-2xs)", color: "var(--rt-color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em", mb: 0.75, fontWeight: "var(--rt-weight-bold)" }}>
            Priority Optimization Opportunities
          </Typography>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
            {recos.slice(0, 4).map((r, i) => (
              <Box
                key={i}
                sx={{
                  p: 1.25,
                  borderRadius: "var(--rt-radius-md)",
                  bgcolor: "var(--rt-color-bg-elevated)",
                  border: "1px solid var(--rt-color-border)",
                  fontSize: "var(--rt-text-xs)",
                  color: "var(--rt-color-text)",
                }}
              >
                <b style={{ color: "var(--rt-color-accent)", textTransform: "capitalize" }}>{r.element}</b>: {r.current} → {r.projected}{" "}
                <span style={{ color: "var(--rt-color-success)", fontWeight: "var(--rt-weight-bold)" }}>(+{r.delta} pts)</span>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {Object.keys(suggestions).length > 0 && (
        <Box>
          <Typography sx={{ fontSize: "var(--rt-text-2xs)", color: "var(--rt-color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em", mb: 0.75, fontWeight: "var(--rt-weight-bold)" }}>
            Recommended Copy & Variations
          </Typography>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {Object.entries(suggestions).map(([element, sg]) => (
              <Box
                key={element}
                sx={{
                  p: 1.5,
                  borderRadius: "var(--rt-radius-md)",
                  bgcolor: "var(--rt-color-bg-elevated)",
                  border: "1px solid var(--rt-color-border)",
                }}
              >
                <Typography sx={{ fontSize: "var(--rt-text-xs)", fontWeight: "var(--rt-weight-bold)", color: "var(--rt-color-text)", textTransform: "capitalize", mb: 0.5 }}>
                  {element} Alternatives
                </Typography>
                {sg?.options?.map((opt, i) => (
                  <Typography key={i} sx={{ fontSize: "var(--rt-text-xs)", color: "var(--rt-color-text-secondary)", pl: 1, py: 0.25 }}>
                    • {opt}
                    {typeof sg.scores?.[i] === "number" && <span style={{ color: "var(--rt-color-accent)", fontWeight: "var(--rt-weight-semibold)" }}> ({sg.scores?.[i]} score)</span>}
                  </Typography>
                ))}
                {sg?.rewrite && (
                  <Typography sx={{ fontSize: "var(--rt-text-xs)", color: "var(--rt-color-text-secondary)", pl: 1, whiteSpace: "pre-wrap" }}>
                    • {sg.rewrite}
                  </Typography>
                )}
                {sg?.suggested?.map((t, i) => (
                  <Typography key={`t${i}`} sx={{ fontSize: "var(--rt-text-xs)", color: "var(--rt-color-text-secondary)", pl: 1, py: 0.25 }}>
                    • {t}
                    {typeof sg.scores?.[i] === "number" && <span style={{ color: "var(--rt-color-accent)", fontWeight: "var(--rt-weight-semibold)" }}> ({sg.scores?.[i]})</span>}
                  </Typography>
                ))}
                {sg?.concepts?.map((c, i) => (
                  <Typography key={`c${i}`} sx={{ fontSize: "var(--rt-text-xs)", color: "var(--rt-color-text-secondary)", pl: 1, py: 0.25 }}>
                    • {c}
                  </Typography>
                ))}
                {sg?.why && (
                  <Typography sx={{ fontSize: "var(--rt-text-2xs)", color: "var(--rt-color-text-tertiary)", pl: 1, mt: 0.5, fontStyle: "italic" }}>
                    Rationale: {sg.why}
                  </Typography>
                )}
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {elements.length === 0 && recos.length === 0 && Object.keys(suggestions).length === 0 && (
        <Typography sx={{ fontSize: "var(--rt-text-xs)", color: "var(--rt-color-text-tertiary)" }}>
          No detailed element analysis was captured for this video (it may not have been in the analyzed sample).
        </Typography>
      )}
    </Box>
  );
}

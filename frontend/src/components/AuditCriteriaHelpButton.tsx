// ─────────────────────────────────────────────────────────────────────────────
// AuditCriteriaHelpButton -- "?" icon button that opens a modal explaining the
// admin-configured Full Audit criteria. Criteria are fetched read-only from
// GET /api/audit/criteria (Firestore config/auditScoring): per-category
// criterion max points; each category sums to 100 and the overall score is the
// average of the four categories.
// ─────────────────────────────────────────────────────────────────────────────
import {
  Box,
  Modal,
  Spinner,
  IconButton,
  Tooltip,
  Typography,
} from "./ui";
import { HelpCircle } from "lucide-react";
import { useState } from "react";
import { useAuditCriteria } from "../hooks/queries/useAuditCriteria";

const CATEGORY_LABELS: Record<string, string> = {
  channel: "Channel Identity",
  video: "Video SEO",
  playlist: "Playlist Flow",
  general: "Publishing Trends & Engagement",
};

const CATEGORY_ORDER = ["channel", "video", "playlist", "general"] as const;

export function AuditCriteriaHelpButton({
  intro,
  tooltipTitle = "How is the audit scored?",
}: {
  /** Optional section rendered above the criteria list (e.g. what the audit evaluates). */
  intro?: React.ReactNode;
  tooltipTitle?: string;
}) {
  const [open, setOpen] = useState(false);
  // Fetch lazily only while the dialog is open.
  const { data, isLoading } = useAuditCriteria(open);

  return (
    <>
      <Tooltip title={tooltipTitle}>
        <IconButton
          aria-label="Audit criteria help"
          size="small"
          onClick={() => setOpen(true)}
          sx={{
            color: "var(--rt-color-text-tertiary)",
            "&:hover": { color: "var(--rt-color-accent)", background: "var(--rt-color-bg-muted)" },
          }}
        >
          <HelpCircle size={18} />
        </IconButton>
      </Tooltip>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="How Full Audit Works"
        description="Channel-wide evaluation across 4 scoring categories"
        icon={<HelpCircle size={20} style={{ color: "var(--rt-color-accent)" }} />}
        secondaryAction={{ label: "Close", onClick: () => setOpen(false) }}
        guide
      >
        <Box sx={{ display: "flex", flexDirection: "column", gap: 3, py: 1 }}>
          {/* Overview */}
          <Typography sx={{ fontSize: "var(--rt-text-sm)", color: "var(--rt-color-text-secondary)", lineHeight: 1.6 }}>
            The Full Audit scores your channel across <strong>4 categories</strong>. Each category is worth 100 points, split across the checks below — the points show how much weight each check carries. Your overall score is the average of the four category scores.
          </Typography>
          <Typography sx={{ fontSize: "var(--rt-text-xs)", color: "var(--rt-color-text-tertiary)", lineHeight: 1.5 }}>
            Tip: work through the highest-point checks first for the biggest score gains.
          </Typography>

          {/* Intro content (e.g. what the audit evaluates) */}
          {intro && (
            <Box sx={{ p: 2.5, borderRadius: "var(--rt-radius-md)", bgcolor: "var(--rt-color-bg-subtle)", border: "1px solid var(--rt-color-border)" }}>
              {intro}
            </Box>
          )}

          {/* Loading / error / criteria */}
          {isLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <Spinner size={26} />
            </Box>
          ) : !data ? (
            <Typography sx={{ fontSize: "var(--rt-text-sm)", color: "var(--rt-color-text-secondary)" }}>
              Criteria are currently unavailable. Please try again later.
            </Typography>
          ) : (
            <>
              {/* Category cards - 2x2 grid on desktop */}
              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 2 }}>
                {CATEGORY_ORDER.map((cat) => {
                  const items = data.categories[cat] || [];
                  const total = items.reduce((s, c) => s + (Number(c.max) || 0), 0);
                  return (
                  <Box
                    key={cat}
                    sx={{
                      p: 2.5,
                      borderRadius: "var(--rt-radius-md)",
                      bgcolor: "var(--rt-color-bg-subtle)",
                      border: "1px solid var(--rt-color-border)",
                    }}
                  >
                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.5 }}>
                      <Typography sx={{ fontSize: "var(--rt-text-sm)", fontWeight: "var(--rt-weight-bold)", color: "var(--rt-color-text)" }}>
                        {CATEGORY_LABELS[cat]}
                      </Typography>
                      <Box
                        sx={{
                          px: 1,
                          py: 0.25,
                          borderRadius: "var(--rt-radius-pill)",
                          bgcolor: "var(--rt-color-bg-muted)",
                          fontSize: "var(--rt-text-xs)",
                          fontWeight: "var(--rt-weight-bold)",
                          color: "var(--rt-color-accent)",
                        }}
                      >
                        /{total} pts
                      </Box>
                    </Box>
                    <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 0.5 }}>
                      {items.map((c) => (
                        <Box
                          key={c.key}
                          component="li"
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 2,
                            py: 0.5,
                            borderBottom: "1px solid var(--rt-color-border)",
                            "&:last-child": { borderBottom: "none" },
                          }}
                        >
                          <Typography sx={{ fontSize: "var(--rt-text-xs)", color: "var(--rt-color-text-secondary)" }}>
                            {c.label}
                          </Typography>
                          <Box
                            sx={{
                              flexShrink: 0,
                              px: 0.75,
                              py: 0.15,
                              borderRadius: "var(--rt-radius-pill)",
                              bgcolor: "var(--rt-color-bg-muted)",
                              fontSize: "var(--rt-text-2xs)",
                              fontWeight: "var(--rt-weight-bold)",
                              color: "var(--rt-color-text-tertiary)",
                            }}
                          >
                            {c.max} pts
                          </Box>
                        </Box>
                      ))}
                    </Box>
                    <Typography sx={{ fontSize: "var(--rt-text-xs)", fontWeight: "var(--rt-weight-bold)", color: "var(--rt-color-text-secondary)", textAlign: "right", mt: 1 }}>
                      Total {total} pts
                    </Typography>
                  </Box>
                  );
                })}
              </Box>
            </>
          )}
        </Box>
      </Modal>
    </>
  );
}

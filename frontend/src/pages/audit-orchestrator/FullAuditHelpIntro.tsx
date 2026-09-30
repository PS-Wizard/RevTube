import { Box, Typography } from "../../components/ui";
import { Palette, Search, TrendingUp, Tv } from "lucide-react";

export function FullAuditHelpIntro() {
  return (
    <Box sx={{ mb: 3 }}>
      <Typography
        sx={{
          fontSize: "var(--rt-text-xs)",
          color: "var(--rt-color-text-tertiary)",
          mb: 2,
        }}
      >
        Channel Audit analyzes your channel's metadata, identity, and structure across 4 core areas:
      </Typography>
      <div className="aop-subgrid" style={{ marginBottom: 0 }}>
        {[
          {
            label: "Channel Identity & Handle",
            desc: "Verifies custom handle availability, channel name memorability, and unique identity signals.",
            icon: Tv,
          },
          {
            label: "Branding Assets & Visuals",
            desc: "Audits banner contrast, avatar resolution, social link placement, and visual coherence.",
            icon: Palette,
          },
          {
            label: "Description & Keyword SEO",
            desc: "Checks about-section keyword density, value proposition clarity, and discovery links.",
            icon: Search,
          },
          {
            label: "Upload Cadence & Consistency",
            desc: "Measures publishing frequency, cadence regularity, and audience expectation stability.",
            icon: TrendingUp,
          },
        ].map((pillar) => {
          const Icon = pillar.icon;
          return (
            <Box
              key={pillar.label}
              sx={{
                p: 2.5,
                borderRadius: "var(--rt-radius-md)",
                bgcolor: "var(--rt-color-bg-subtle)",
                border: "1px solid var(--rt-color-border)",
                display: "flex",
                flexDirection: "column",
                gap: 1,
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Icon size={18} style={{ color: "var(--rt-color-accent)" }} />
                <Typography
                  sx={{
                    fontSize: "var(--rt-text-xs)",
                    fontWeight: "var(--rt-weight-bold)",
                    color: "var(--rt-color-text)",
                  }}
                >
                  {pillar.label}
                </Typography>
              </Box>
              <Typography
                sx={{
                  fontSize: "var(--rt-text-2xs)",
                  color: "var(--rt-color-text-secondary)",
                  lineHeight: 1.45,
                }}
              >
                {pillar.desc}
              </Typography>
            </Box>
          );
        })}
      </div>
      <Typography
        sx={{
          fontSize: "var(--rt-text-xs)",
          color: "var(--rt-color-text-tertiary)",
          mt: 2,
        }}
      >
        Each selected video is fully analyzed by AI (score, recommendations,
        and alternative titles/tags/description). Larger windows take
        proportionally longer and evaluate a broader sample of your audience engagement.
      </Typography>
    </Box>
  );
}

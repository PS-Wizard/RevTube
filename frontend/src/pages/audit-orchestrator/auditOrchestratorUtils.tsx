import { Box, Typography } from "../../components/ui";
import type { AuditSubRunParam } from "../../services/auditOrchestratorService";

export function paramPct(p: AuditSubRunParam): number {
  const max = typeof p.max === "number" && p.max > 0 ? p.max : 100;
  const earned = typeof p.earned === "number" ? p.earned : 0;
  return Math.max(0, Math.min(100, Math.round((earned / max) * 100)));
}

export function sevColor(sev: string | undefined): { bg: string; text: string } {
  switch (sev) {
    case "high":
      return {
        bg: "var(--rt-color-danger-surface)",
        text: "var(--rt-color-danger)",
      };
    case "medium":
      return {
        bg: "var(--rt-color-warning-surface)",
        text: "var(--rt-color-warning)",
      };
    default:
      return {
        bg: "var(--rt-color-bg-subtle)",
        text: "var(--rt-color-text-tertiary)",
      };
  }
}

export function scoreColor(score: number): { bg: string; text: string } {
  if (score >= 80)
    return {
      bg: "var(--rt-color-success-surface)",
      text: "var(--rt-color-success)",
    };
  if (score >= 50)
    return {
      bg: "var(--rt-color-warning-surface)",
      text: "var(--rt-color-warning)",
    };
  return {
    bg: "var(--rt-color-danger-surface)",
    text: "var(--rt-color-danger)",
  };
}

export function scoreToGrade(score: number): string {
  if (score >= 90) return "A+";
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= 60) return "C";
  if (score >= 50) return "D";
  return "F";
}

export function scoreToLabel(score: number): string {
  if (score >= 85) return "Optimized & Healthy";
  if (score >= 70) return "Strong Performance";
  if (score >= 50) return "Needs Optimization";
  return "Critical Attention Required";
}

// ── Group parameters by logical scoring category ───────────────────────────
export function groupParamsByCategory(
  params: AuditSubRunParam[],
): Array<{ category: string; label: string; params: AuditSubRunParam[] }> {
  const CATEGORY_LABELS: Record<string, string> = {
    seo: "SEO Signals",
    discoverability: "Discoverability",
    engagement: "Engagement & Retention",
    accessibility: "Accessibility & Captions",
    structure: "Channel Structure",
    contentQuality: "Content Quality",
    visualHook: "Visual Hooks & Branding",
    branding: "Branding Assets",
    metadata: "Metadata & Descriptions",
    niche: "Niche Relevance",
    trend: "Trends & Timing",
    trust: "Trust & Credibility",
    cadence: "Publishing Cadence",
    reach: "Reach & Distribution",
    mix: "Content Mix & Formats",
    growth: "Growth Signals",
    performance: "Performance Benchmarks",
    playlistStrategy: "Playlist Strategy",
    other: "General Parameters",
  };
  const order = Object.keys(CATEGORY_LABELS);
  const groups = new Map<string, AuditSubRunParam[]>();
  for (const p of params) {
    const raw = p.category && p.category.trim() ? p.category.trim() : "other";
    const arr = groups.get(raw) || [];
    arr.push(p);
    groups.set(raw, arr);
  }
  return [...groups.entries()]
    .sort((a, b) => {
      const ia = order.indexOf(a[0]);
      const ib = order.indexOf(b[0]);
      if (ia === -1 && ib === -1) return a[0].localeCompare(b[0]);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    })
    .map(([category, list]) => ({
      category,
      label: CATEGORY_LABELS[category] || category,
      params: list,
    }));
}

// ── Recommendation message split (problem on line 1, fix always on a new line)
export function splitRecMessage(message: string): { problem: string; fix: string | null } {
  const idx = (message || "").search(/\bFix:/);
  if (idx < 0) return { problem: message || "", fix: null };
  return {
    problem: message.slice(0, idx).trim().replace(/\s+$/, ""),
    fix: message.slice(idx + 4).trim(),
  };
}

export function RecMessage({ message, struck = false }: { message: string; struck?: boolean }) {
  const { problem, fix } = splitRecMessage(message || "");
  return (
    <span style={{ textDecoration: struck ? "line-through" : "none" }}>
      {problem ? <span>{problem}</span> : null}
      {fix ? (
        <span style={{ display: "block", marginTop: 4 }}>
          <span style={{ fontWeight: "var(--rt-weight-bold)", color: "var(--rt-color-success)" }}>Fix: </span>
          <span>{fix}</span>
        </span>
      ) : null}
    </span>
  );
}

// ── Gated checks note ──────────────────────────────────────────────────────
export function GatedNote({ gated }: { gated: unknown }) {
  const list = Array.isArray(gated) ? gated.map((g) => String(g)).filter(Boolean) : [];
  if (!list.length) return null;
  const names = list.map((k) => k.replace(/^(pl|ve|va)_/, "").replace(/_/g, " "));
  return (
    <Box
      sx={{
        mt: 1.5,
        p: 1.5,
        borderRadius: "var(--rt-radius-md)",
        bgcolor: "var(--rt-color-bg-subtle)",
        border: "1px solid var(--rt-color-border)",
      }}
    >
      <Typography
        sx={{
          fontSize: "var(--rt-text-xs)",
          color: "var(--rt-color-text-secondary)",
          lineHeight: 1.45,
        }}
      >
        Not scored yet (waiting on data): {names.join(", ")}. Re-run the audit
        when the data is available to score {list.length === 1 ? "it" : "them"}.
      </Typography>
    </Box>
  );
}

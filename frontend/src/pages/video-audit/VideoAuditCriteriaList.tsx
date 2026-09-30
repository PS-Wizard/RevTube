// ─────────────────────────────────────────────────────────────────────────────
// VideoAuditCriteriaList -- shared config-driven scoring-criteria list used by
// the Video Audit help dialogs (VideoAuditPage GuideDialog + the input-form
// help modal) and the Public Audit scoring rubric modal.
//
// Tailwind CSS + shadcn primitives (Badge, Typography). Spacing scale:
// section `space-y-4`, category block `space-y-2`, row `py-2 gap-3`.
// No `sx` props, no custom CSS, no raw hex — tokens via `--rt-*`.
// ─────────────────────────────────────────────────────────────────────────────
import { Badge, Typography } from "../../components/ui";
import type { VideoAuditCriterion } from "../../services/videoAuditService";

const FOCUS_LABELS: Record<string, string> = {
  discoverability: "Discoverability",
  contentQuality: "Content Quality",
  visualHook: "Visual Hook",
};

export function VideoAuditCriteriaList({ criteria }: { criteria: VideoAuditCriterion[] }) {
  if (criteria.length === 0) return null;

  const byCategory = criteria.reduce<Record<string, VideoAuditCriterion[]>>((acc, c) => {
    const cat = c.category || "discoverability";
    (acc[cat] = acc[cat] || []).push(c);
    return acc;
  }, {});
  const catKeys = Object.keys(byCategory);
  const grandTotal = criteria.reduce((s, c) => s + (Number(c.weight) || 0), 0);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Typography
        variant="caption"
        className="text-[var(--rt-color-text-tertiary)] font-bold uppercase tracking-wider"
      >
        Scoring Criteria &amp; Points
      </Typography>
      {catKeys.map((cat) => {
        const catTotal = byCategory[cat].reduce((s, c) => s + (Number(c.weight) || 0), 0);
        return (
          <section key={cat} aria-label={FOCUS_LABELS[cat] || cat} className="flex min-w-0 flex-col gap-2">
            <Typography variant="caption" className="font-bold text-[var(--rt-color-accent)]">
              {FOCUS_LABELS[cat] || cat}
            </Typography>
            <ul className="flex min-w-0 flex-col divide-y divide-[var(--rt-color-border)] rounded-[var(--rt-radius-md)] border border-[var(--rt-color-border)] bg-[var(--rt-color-bg-elevated)] px-3">
              {byCategory[cat].map((c) => (
                <li
                  key={c.key}
                  className="flex min-w-0 items-start justify-between gap-3 py-2.5"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-semibold text-[var(--rt-color-text)]" title={c.label}>
                      {c.label}
                    </span>
                    <span className="text-xs leading-relaxed text-[var(--rt-color-text-tertiary)]">
                      {c.instruction}
                    </span>
                  </div>
                  <Badge
                    variant="secondary"
                    className="shrink-0 bg-[var(--rt-color-bg-muted)] px-2 py-0.5 text-xs font-bold text-[var(--rt-color-accent)]"
                  >
                    {c.weight} pts
                  </Badge>
                </li>
              ))}
            </ul>
            <Typography variant="caption" className="text-right font-bold text-[var(--rt-color-text-secondary)]">
              Total {catTotal} pts
            </Typography>
          </section>
        );
      })}
      <div className="flex min-w-0 flex-col gap-1 border-t border-[var(--rt-color-border)] pt-3">
        <Typography variant="body2" className="text-right font-bold text-[var(--rt-color-text)]">
          Total {grandTotal} pts
        </Typography>
        <Typography variant="caption" className="leading-relaxed text-[var(--rt-color-text-tertiary)]">
          How scoring works: element scores combine as weighted means, and niche matches count 1.5x.
        </Typography>
      </div>
    </div>
  );
}

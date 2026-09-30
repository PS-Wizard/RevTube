// ─────────────────────────────────────────────────────────────────────────────
// CategoryAuditCard — deep-dive for one Full Audit category (channel/playlist).
//
// Score + progress, per-criterion breakdown, and the engine's ranked issues
// filtered to that area. All numbers come from `report.fullAudit` — the same
// 4-category engine as the owned-channel Full Audit — nothing is invented here.
// Shared shadcn primitives + Tailwind only.
// ─────────────────────────────────────────────────────────────────────────────
import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge, Card, CardContent, Progress } from '../../../ui';
import { scoreBadgeClasses } from '../publicAuditUtils';
import type { PublicAuditCategoryScore, PublicAuditIssue } from '../../../../services/publicAuditService';

export function CategoryAuditCard({
  icon,
  title,
  subtitle,
  category,
  issues,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  category: PublicAuditCategoryScore | null | undefined;
  issues: PublicAuditIssue[];
  children?: React.ReactNode;
}) {
  if (!category) return null;
  const pct = category.max > 0 ? Math.round((category.score / category.max) * 100) : 0;
  return (
    <Card className="border-[var(--rt-color-border)] bg-[var(--rt-color-bg-elevated)]">
      <CardContent className="flex min-w-0 flex-col gap-4 p-4 sm:p-5">
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-[var(--rt-color-accent)]">{icon}</span>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-bold text-[var(--rt-color-text)]">{title}</h3>
              <p className="truncate text-xs text-[var(--rt-color-text-tertiary)]">{subtitle}</p>
            </div>
          </div>
          <Badge variant="outline" className={cn('shrink-0 text-sm font-bold tabular-nums', scoreBadgeClasses(category.score))}>
            {category.score}/{category.max}
          </Badge>
        </div>
        <Progress value={pct} className="h-2 bg-[var(--rt-color-bg-muted)]" />
        {children}
        {(category.breakdown?.length ?? 0) > 0 && (
          <ul className="flex min-w-0 flex-col divide-y divide-[var(--rt-color-border)] rounded-[var(--rt-radius-md)] border border-[var(--rt-color-border)] px-3">
            {(category.breakdown || []).map((b) => (
              <li key={b.key} className="flex min-w-0 items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate text-xs text-[var(--rt-color-text-secondary)]" title={b.label}>
                  {b.label}
                </span>
                <span className="shrink-0 text-xs font-semibold tabular-nums text-[var(--rt-color-text)]">
                  {b.earned}/{b.max}
                </span>
              </li>
            ))}
          </ul>
        )}
        {(issues?.length ?? 0) > 0 && (
          <div className="flex min-w-0 flex-col gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--rt-color-text-secondary)]">
              What to fix here
            </span>
            <ul className="flex min-w-0 flex-col gap-2">
              {(issues || []).slice(0, 3).map((issue) => (
                <li
                  key={issue.key}
                  className="flex items-start gap-2 rounded-[var(--rt-radius-sm)] border border-[var(--rt-color-warning)]/30 bg-[var(--rt-color-warning-surface)] p-2.5 text-xs"
                >
                  <AlertTriangle size={14} className="mt-0.5 shrink-0 text-[var(--rt-color-warning)]" />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-[var(--rt-color-text)]">{issue.label}</span>
                    <span className="block text-[11px] leading-relaxed text-[var(--rt-color-text-secondary)]">{issue.hint}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

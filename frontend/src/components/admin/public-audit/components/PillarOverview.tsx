// ─────────────────────────────────────────────────────────────────────────────
// PillarOverview — Full Audit 4-pillar category cards + channel-wide
// opportunities. Shared shadcn primitives + Tailwind only.
// ─────────────────────────────────────────────────────────────────────────────
import { AlertTriangle, Compass } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge, Card, Progress } from '../../../ui';
import { scoreTextClass } from '../publicAuditUtils';
import type { PublicAuditReport } from '../../../../services/publicAuditService';

export function PillarOverview({ fullAudit }: { fullAudit: NonNullable<PublicAuditReport['fullAudit']> }) {
  if (!fullAudit.categories || fullAudit.categories.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--rt-color-text)] flex items-center gap-1.5">
          <Compass size={16} className="text-[var(--rt-color-accent)]" />
          Full Audit Categories &amp; Health Pillars
        </h3>
        <span className="text-xs text-[var(--rt-color-text-tertiary)]">
          Scored across {fullAudit.scoredVideos} public videos
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {fullAudit.categories.map((cat) => {
          return (
            <Card key={cat.key} className="border-[var(--rt-color-border)] bg-[var(--rt-color-bg-elevated)] p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-xs font-semibold text-[var(--rt-color-text)]">{cat.label}</span>
                <span className={cn('shrink-0 text-xs font-bold tabular-nums', scoreTextClass(cat.score))}>
                  {cat.score}/{cat.max}
                </span>
              </div>
              <Progress
                value={cat.max > 0 ? (cat.score / cat.max) * 100 : 0}
                className="mb-2 h-1.5 bg-[var(--rt-color-bg-muted)]"
              />
              <div className="flex flex-col gap-1 text-[11px] text-[var(--rt-color-text-secondary)]">
                {cat.breakdown?.slice(0, 2).map((b) => (
                  <div key={b.key} className="flex items-center justify-between gap-2 text-[10px]">
                    <span className="min-w-0 truncate pr-1 text-[var(--rt-color-text-tertiary)]">{b.label}</span>
                    <span className="shrink-0 font-medium tabular-nums">{b.earned}/{b.max}</span>
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Identified Issues / Opportunities */}
      {fullAudit.issues && fullAudit.issues.length > 0 && (
        <div className="flex flex-col gap-3 rounded-[var(--rt-radius-lg)] border border-[var(--rt-color-warning)]/30 bg-[var(--rt-color-warning-surface)] p-4">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--rt-color-warning)]">
            <AlertTriangle size={14} className="shrink-0" />
            <span>Top Channel-Wide Opportunities &amp; Weaknesses</span>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {fullAudit.issues.slice(0, 4).map((issue) => (
              <div key={issue.key} className="flex items-start gap-2 rounded-[var(--rt-radius-sm)] border border-[var(--rt-color-border)] bg-[var(--rt-color-bg-elevated)] p-3">
                <Badge
                  variant={issue.severity === 'high' ? 'destructive' : 'outline'}
                  className={cn(
                    'mt-0.5 shrink-0 px-1.5 py-0 text-[9px] uppercase',
                    issue.severity !== 'high' && 'text-[var(--rt-color-warning)] border-[var(--rt-color-warning)]',
                  )}
                >
                  {issue.severity}
                </Badge>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-[var(--rt-color-text)]">{issue.label}</div>
                  <div className="line-clamp-1 text-[11px] text-[var(--rt-color-text-secondary)]">{issue.hint}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

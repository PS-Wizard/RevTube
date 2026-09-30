// ─────────────────────────────────────────────────────────────────────────────
// ChannelTab — Channel Audit deep-dive (identity score + checklist), per-field
// channel health (name/handle/description/keywords with score + fix, the
// channel analogue of the Videos tab's per-item audits), plus the channel
// description / keywords / topics diagnostics grid.
// Shared shadcn primitives + Tailwind only.
// ─────────────────────────────────────────────────────────────────────────────
import { UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge, Card, Progress } from '../../../ui';
import { CategoryAuditCard } from './CategoryAuditCard';
import { scoreBadgeClasses } from '../publicAuditUtils';
import type { PublicAuditCategoryScore, PublicAuditChannelHealth, PublicAuditIssue, PublicAuditReport } from '../../../../services/publicAuditService';

interface ChannelTabProps {
  report: PublicAuditReport;
  channelCategory: PublicAuditCategoryScore | null | undefined;
  channelIssues: PublicAuditIssue[];
  identityChecks: { label: string; present: boolean }[];
  /** Per-field channel health (score + fix); null on old reports. */
  channelHealth: PublicAuditChannelHealth | null;
}

const CHANNEL_FIELDS = [
  { key: 'name', label: 'Channel name' },
  { key: 'username', label: 'Handle' },
  { key: 'description', label: 'Description' },
  { key: 'keywords', label: 'Keywords' },
] as const;

export function ChannelTab({ report, channelCategory, channelIssues, identityChecks, channelHealth }: ChannelTabProps) {
  const snap = report.snapshot;
  return (
    <>
      <CategoryAuditCard
        icon={<UserRound size={18} />}
        title="Channel Audit"
        subtitle={`Channel Identity — ${report.channelTitle || 'channel'} at a glance`}
        category={channelCategory}
        issues={channelIssues}
      >
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Channel identity checklist">
          {identityChecks.map((check) => (
            <Badge
              key={check.label}
              variant={check.present ? 'secondary' : 'outline'}
              className={cn(
                'px-2 py-0.5 text-[11px] font-medium',
                check.present
                  ? 'text-[var(--rt-color-success)]'
                  : 'border-[var(--rt-color-warning)] text-[var(--rt-color-warning)]',
              )}
            >
              {check.label}: {check.present ? 'set' : 'missing'}
            </Badge>
          ))}
        </div>
      </CategoryAuditCard>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {channelHealth && (
          <Card className="border-[var(--rt-color-border)] bg-[var(--rt-color-bg-elevated)] p-4 lg:col-span-2">
            <h4 className="text-xs font-semibold text-[var(--rt-color-text-secondary)] uppercase tracking-wider mb-3">
              Channel Health — Score &amp; Fix Per Field
            </h4>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {CHANNEL_FIELDS.map(({ key, label }) => {
                const field = channelHealth[key];
                if (!field) return null;
                return (
                  <li key={key} className="flex min-w-0 flex-col gap-1.5 rounded-[var(--rt-radius-md)] border border-[var(--rt-color-border)] bg-[var(--rt-color-bg-subtle)] p-3">
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-xs font-semibold text-[var(--rt-color-text)]">{label}</span>
                      <Badge variant="outline" className={cn('shrink-0 text-xs font-bold tabular-nums', scoreBadgeClasses(field.health))}>
                        {field.health}
                      </Badge>
                    </div>
                    <Progress value={Math.max(0, Math.min(100, field.health))} className="h-1.5 bg-[var(--rt-color-bg-muted)]" />
                    <span className="text-[11px] leading-relaxed text-[var(--rt-color-text-secondary)]">{field.hint}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
        <Card className="border-[var(--rt-color-border)] bg-[var(--rt-color-bg-elevated)] p-4">
          <h4 className="text-xs font-semibold text-[var(--rt-color-text-secondary)] uppercase tracking-wider mb-3">
            Channel Description &amp; Positioning
          </h4>
          {snap?.description ? (
            <p className="text-xs text-[var(--rt-color-text)] whitespace-pre-line leading-relaxed">
              {snap.description}
            </p>
          ) : (
            <span className="text-xs text-[var(--rt-color-text-tertiary)]">No description provided.</span>
          )}
        </Card>

        <Card className="border-[var(--rt-color-border)] bg-[var(--rt-color-bg-elevated)] p-4 flex flex-col gap-3">
          <h4 className="text-xs font-semibold text-[var(--rt-color-text-secondary)] uppercase tracking-wider">
            Discovery Metadata &amp; Channel Topics
          </h4>
          <div>
            <span className="text-xs font-medium text-[var(--rt-color-text-secondary)]">Channel Keywords:</span>
            <div className="mt-1 p-2 rounded bg-[var(--rt-color-bg-subtle)] border border-[var(--rt-color-border)] text-xs text-[var(--rt-color-text)] font-mono break-all">
              {snap?.channelKeywords || 'None specified on public channel header.'}
            </div>
          </div>
          <div>
            <span className="text-xs font-medium text-[var(--rt-color-text-secondary)]">Topics:</span>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {snap?.topics && snap.topics.length > 0 ? (
                snap.topics.map((t) => (
                  <Badge key={t} variant="secondary" className="text-xs">
                    {t.replace(/^https?:\/\/en\.wikipedia\.org\/wiki\//, '').replace(/_/g, ' ')}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-[var(--rt-color-text-tertiary)]">No public Wikipedia topic links detected.</span>
              )}
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}

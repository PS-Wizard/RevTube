import React from 'react';

interface ChannelInsightCardProps {
  /** Grid position from the user's card layout. */
  order: number;
  title: string;
  periodLabel: string;
  value: React.ReactNode;
  /** 90/30/7d delta row (hidden in compact mode). */
  deltas?: React.ReactNode;
  /** Sparkline graphic below the value. */
  media: React.ReactNode;
}

/**
 * One channel metric card: title + period badge, KPI value, delta row,
 * sparkline. Tailwind only — replaces the legacy `.channel-insight-card`
 * family (which carried no per-metric styling; series color lives on the
 * sparkline itself).
 */
export function ChannelInsightCard({
  order,
  title,
  periodLabel,
  value,
  deltas,
  media,
}: ChannelInsightCardProps): React.ReactElement {
  return (
    <article
      className="rounded-[var(--rt-radius-lg)] border border-[var(--rt-color-border)] px-6 py-5 transition-colors hover:border-[var(--rt-color-border-strong)] hover:bg-[var(--rt-color-bg-subtle)]"
      style={{ order }}
    >
      <div className="mb-2 flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="min-w-0 truncate text-xs font-semibold text-[var(--rt-color-text-secondary)]">
          {title}
        </span>
        <span className="inline-block shrink-0 rounded-[var(--rt-radius-sm)] bg-[var(--rt-color-bg-muted)] px-[5px] py-px text-[0.625rem] font-semibold text-[var(--rt-color-text-tertiary)]">
          {periodLabel}
        </span>
      </div>
      <div className="mb-1.5 text-[var(--rt-text-kpi)] font-bold tabular-nums leading-[1.2] text-[var(--rt-color-text)]">
        {value}
      </div>
      {deltas}
      {media}
    </article>
  );
}

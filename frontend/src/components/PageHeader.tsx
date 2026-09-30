// ─────────────────────────────────────────────────────────────────────────────
// PageHeader — shared title band for every page (Goals pattern).
//
// Left: accent icon + title + subtitle. Right: help (?) tooltip and/or action
// buttons. Replicates the `.page-header.page-header--split` band look with
// Tailwind + design tokens only — no custom CSS. Pages keep their own actions;
// this owns the band, spacing, truncation, and responsive stacking.
// ─────────────────────────────────────────────────────────────────────────────
import React from 'react';
import { HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  IconButton,
  ShadcnTooltip as Tooltip,
  TooltipContent,
  TooltipTrigger,
} from './ui';

interface PageHeaderProps {
  /** Accent leading icon (sized ~20 by the caller). */
  icon?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Right-side cluster: help is rendered first, then these actions. */
  actions?: React.ReactNode;
  /** When set, a (?) IconButton with this tooltip content leads the actions. */
  helpText?: React.ReactNode;
  helpLabel?: string;
  className?: string;
}

export function PageHeader({
  icon,
  title,
  subtitle,
  actions,
  helpText,
  helpLabel = 'About this page',
  className,
}: PageHeaderProps) {
  const hasRight = Boolean(actions || helpText);
  return (
    <header
      className={cn(
        'flex w-full min-w-0 flex-col justify-center gap-2 border-b border-[var(--rt-table-header-border)] bg-[var(--rt-color-bg-highlight)] px-4 py-4 sm:px-5',
        hasRight && 'sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          {icon && (
            <span className="inline-flex shrink-0 items-center text-[var(--rt-color-accent)]" aria-hidden>
              {icon}
            </span>
          )}
          <h1 className="min-w-0 truncate text-lg font-semibold text-[var(--rt-color-text)]">{title}</h1>
        </div>
        {subtitle && (
          <p className="mt-1 max-w-[52rem] text-sm leading-relaxed text-[var(--rt-color-text-secondary)]">
            {subtitle}
          </p>
        )}
      </div>
      {hasRight && (
        <div className="flex shrink-0 items-center gap-2 self-start sm:self-auto">
          {helpText && (
            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton aria-label={helpLabel}>
                  <HelpCircle size={19} />
                </IconButton>
              </TooltipTrigger>
              <TooltipContent className="max-w-80 whitespace-pre-wrap p-3">{helpText}</TooltipContent>
            </Tooltip>
          )}
          {actions}
        </div>
      )}
    </header>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AuditLoadingState — shared running-job card for every audit-tool page.
//
// Centered spinner + title + subtext while a background audit runs.
// Replaces the legacy `.audit-tool-loading-*` CSS classes: Tailwind + tokens,
// shadcn-free (pure presentational). No custom CSS.
// ─────────────────────────────────────────────────────────────────────────────
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function AuditLoadingState({
  title,
  subtitle,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'mb-6 rounded-[var(--rt-radius-lg)] border border-[var(--rt-color-border)] bg-[var(--rt-color-bg-elevated)] p-8 text-center shadow-xs',
        className,
      )}
    >
      <span
        aria-hidden
        className="mb-3 inline-block h-7 w-7 animate-spin rounded-full border-[3px] border-[var(--rt-color-border)] border-t-[var(--rt-color-accent)]"
      />
      <div className="mb-1 text-[length:var(--rt-text-md)] font-semibold text-[var(--rt-color-text)]">
        {title}
      </div>
      {subtitle && (
        <div className="text-xs text-[var(--rt-color-text-tertiary)]">{subtitle}</div>
      )}
    </div>
  );
}

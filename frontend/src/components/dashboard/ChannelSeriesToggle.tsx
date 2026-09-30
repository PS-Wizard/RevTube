import React from 'react';
import { Button } from '../ui';

interface SeriesToggleChipProps {
  active: boolean;
  /** Series color for the status dot. */
  color: string;
  label: string;
  onToggle: () => void;
}

/**
 * Detached multi-select chip for the channel chart series row. Tailwind +
 * shared `Button` (bare) only — replaces the legacy `.channel-series-toggle`
 * classes. Series identity comes from the dot color, selection from the
 * check + pressed state. `40px` minimum on phones for touch comfort.
 */
export function SeriesToggleChip({ active, color, label, onToggle }: SeriesToggleChipProps): React.ReactElement {
  return (
    <Button
      bare
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      title={label}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-[0.35rem] text-xs font-semibold transition-colors max-sm:min-h-[40px] ${
        active
          ? 'border-[var(--rt-color-border-strong)] bg-[var(--rt-color-bg-subtle)] text-[var(--rt-color-text)] shadow-xs'
          : 'border-[var(--rt-color-border)] bg-[var(--rt-color-bg-elevated)] text-[var(--rt-color-text-secondary)] hover:border-[var(--rt-color-border-strong)] hover:bg-[var(--rt-color-bg-subtle)] hover:text-[var(--rt-color-text)]'
      }`}
    >
      <span
        aria-hidden
        className="size-[7px] shrink-0 rounded-full transition-opacity"
        style={{ backgroundColor: color, opacity: active ? 1 : 0.45 }}
      />
      {label}
      {active && (
        <svg
          className="size-[0.8rem] shrink-0 text-[var(--rt-color-success)]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M20 6L9 17l-5-5" />
        </svg>
      )}
    </Button>
  );
}

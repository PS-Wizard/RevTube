import React from 'react';
import { cn } from '@/lib/utils';

export type ToggleChipSize = 'sm' | 'md' | 'compact';
export type ToggleChipTone = 'success' | 'primary';

export interface ToggleChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Selected state. Controls success vs neutral chrome. */
  pressed?: boolean;
  /** Color story for the pressed state. Defaults to success. */
  tone?: ToggleChipTone;
  /** Visual density. `compact` fits dense result tables. */
  size?: ToggleChipSize;
  /** Leading icon (e.g. check / circle). Sized by the chip, not the caller. */
  icon?: React.ReactNode;
  label: React.ReactNode;
  onPressedChange?: (pressed: boolean, event: React.MouseEvent<HTMLButtonElement>) => void;
}

/**
 * ToggleChip — small pill toggle button (selected / unselected states).
 *
 * The single sanctioned toggle-chip: pages pass `pressed` + `label` (+ optional
 * `icon`), never hand-roll toggle chrome, SVGs, or Tailwind utilities.
 */
export const ToggleChip = React.forwardRef<HTMLButtonElement, ToggleChipProps>(
  function ToggleChip(
    {
      pressed = false,
      tone = 'success',
      size = 'md',
      icon,
      label,
      onPressedChange,
      className = '',
      type = 'button',
      onClick,
      ...props
    },
    ref
  ) {
    return (
      <button
        ref={ref}
        type={type}
        aria-pressed={pressed}
        onClick={(e) => {
          onPressedChange?.(!pressed, e);
          onClick?.(e);
        }}
        className={cn(
          'inline-flex cursor-pointer items-center whitespace-nowrap rounded-[var(--rt-radius-pill)] border font-sans font-semibold transition-colors focus-visible:shadow-[var(--rt-focus-ring)] focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
          size === 'compact'
            ? 'min-h-4 gap-[3px] px-[5px] py-px text-[9px] leading-[1.1]'
            : size === 'sm'
              ? 'min-h-[18px] gap-[3px] px-[7px] py-0.5 text-[length:var(--rt-text-2xs)] leading-[1.1]'
              : 'min-h-[var(--rt-control-height-sm)] gap-[var(--rt-space-2)] px-[var(--rt-space-3)] text-[length:var(--rt-text-sm)] leading-[1.1]',
          pressed
            ? tone === 'primary'
              ? 'border-[var(--rt-color-btn-primary)] bg-[var(--rt-color-btn-primary)] text-[var(--rt-color-on-primary)] hover:border-[var(--rt-color-btn-primary-hover)] hover:bg-[var(--rt-color-btn-primary-hover)] hover:text-[var(--rt-color-on-primary)]'
              : 'border-[var(--rt-color-success)] bg-[var(--rt-color-success-surface)] text-[var(--rt-color-success)] hover:border-[var(--rt-color-border-strong)] hover:bg-[var(--rt-color-bg-elevated)] hover:text-[var(--rt-color-text-secondary)]'
            : 'border-[var(--rt-color-border-strong)] bg-[var(--rt-color-bg-elevated)] text-[var(--rt-color-text-secondary)] hover:border-[var(--rt-color-success)] hover:bg-[var(--rt-color-success-surface)] hover:text-[var(--rt-color-success)]',
          className
        )}
        {...props}
      >
        {icon}
        <span className="tracking-[0.01em]">{label}</span>
      </button>
    );
  }
);

export default ToggleChip;

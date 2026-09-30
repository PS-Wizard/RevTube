import React from 'react';
import { cn } from '@/lib/utils';

export interface SegmentedControlOption {
  value: string;
  label: React.ReactNode;
  /** Optional count badge rendered after the label. */
  count?: number | string;
  disabled?: boolean;
  title?: string;
}

export interface SegmentedControlProps {
  /** Currently selected option value. */
  value: string;
  options: SegmentedControlOption[];
  onChange: (value: string) => void;
  /** Accessible label for the option group. */
  ariaLabel: string;
  /** Allow options to wrap on narrow screens. */
  wrap?: boolean;
  className?: string;
}

/**
 * SegmentedControl — single-select pill group (Limit/All, on/off, …).
 *
 * The single sanctioned segmented toggle: pages pass `options` + `value` +
 * `onChange`, never hand-roll grouped buttons or Tailwind utilities.
 */
export const SegmentedControl: React.FC<SegmentedControlProps> = ({
  value,
  options,
  onChange,
  ariaLabel,
  wrap = false,
  className = '',
}) => {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex rounded-lg border border-border bg-muted/60 p-0.5 text-xs',
        wrap && 'flex-wrap',
        className
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={opt.disabled}
            title={opt.title}
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'inline-flex items-center gap-2 rounded-md px-3 py-1.5 font-medium transition-all disabled:pointer-events-none disabled:opacity-50',
              active
                ? 'bg-background text-foreground shadow-xs border border-border'
                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
            )}
          >
            <span>{opt.label}</span>
            {opt.count !== undefined && (
              <span
                className={cn(
                  'inline-flex items-center justify-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold',
                  active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                )}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

export default SegmentedControl;

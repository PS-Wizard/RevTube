import React from 'react';
import { cn } from '@/lib/utils';

export type IconMedallionTone = 'primary' | 'destructive' | 'success' | 'warning' | 'info' | 'muted';

export interface IconMedallionProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: IconMedallionTone;
  /** `circle` (default) or `rounded` (rounded square with subtle ring + inner shadow). */
  shape?: 'circle' | 'rounded';
  /** Box size in px. Defaults to 48. */
  size?: number;
  children: React.ReactNode;
}

const toneClasses: Record<IconMedallionTone, string> = {
  primary: 'bg-primary/10 text-primary',
  destructive: 'bg-destructive/10 text-destructive',
  success: 'bg-[var(--rt-color-success-surface)] text-[var(--rt-color-success)]',
  warning: 'bg-[var(--rt-color-warning-surface)] text-[var(--rt-color-warning)]',
  info: 'bg-[var(--rt-color-info-surface)] text-[var(--rt-color-info)]',
  muted: 'bg-muted text-muted-foreground',
};

/**
 * IconMedallion — tinted circle behind a status/empty-state icon.
 *
 * The single sanctioned icon medallion: pages pass `tone` + an icon child,
 * never hand-roll tinted circles, emerald palettes, or dark: variants.
 */
export const IconMedallion: React.FC<IconMedallionProps> = ({
  tone = 'primary',
  shape = 'circle',
  size = 48,
  className = '',
  style,
  children,
  ...props
}) => {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center',
        shape === 'circle' ? 'rounded-full' : 'rounded-2xl border border-current/20 shadow-inner',
        toneClasses[tone],
        className
      )}
      style={{ width: size, height: size, ...(style || {}) }}
      {...props}
    >
      {children}
    </div>
  );
};

export default IconMedallion;

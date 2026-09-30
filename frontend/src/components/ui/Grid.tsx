import React from 'react';
import { cn } from '@/lib/utils';
import './grid.css';

export interface GridSizeConfig {
  xs?: number | boolean;
  sm?: number | boolean;
  md?: number | boolean;
  lg?: number | boolean;
  xl?: number | boolean;
}

export interface GridProps extends React.HTMLAttributes<HTMLDivElement> {
  container?: boolean;
  item?: boolean;
  spacing?: number;
  size?: GridSizeConfig;
  xs?: number | boolean;
  sm?: number | boolean;
  md?: number | boolean;
  lg?: number | boolean;
  xl?: number | boolean;
  sx?: Record<string, string | number | boolean | null | undefined>;
  children?: React.ReactNode;
}

/** 12-col value → span number (true/12 → 12, false/undefined → omitted).
 * Stored as --gw-*-span so grid.css can resolve `grid-column: span N`
 * per breakpoint. CSS Grid's gap is computed outside the 12-track track
 * sizing, so percentage-based flex overflow (50%+50%+gap > 100%) is avoided. */
const toSpan = (v: number | boolean | undefined): number | undefined => {
  if (v === undefined || v === false) return undefined;
  if (v === true || v === 12) return 12;
  return Number(v);
};

/**
 * Responsive 12-col CSS grid (MUI-style "and-up" breakpoint semantics).
 * Item spans are injected as --gw-*-span custom properties and resolved by
 * the media queries in grid.css. Using display: grid (not flex) so that
 * `gap` is handled outside the track sizing — percentage + gap never exceeds
 * 100% of the container and items stay on the intended row count.
 */
export const Grid = React.forwardRef<HTMLDivElement, GridProps>(function Grid(
  {
    container = false,
    item = false,
    spacing = 0,
    size,
    xs,
    sm,
    md,
    lg,
    xl,
    className = '',
    style,
    sx,
    children,
    ...props
  },
  ref
) {
  const spans = {
    '--gw-xs-span': toSpan(size?.xs ?? xs),
    '--gw-sm-span': toSpan(size?.sm ?? sm),
    '--gw-md-span': toSpan(size?.md ?? md),
    '--gw-lg-span': toSpan(size?.lg ?? lg),
    '--gw-xl-span': toSpan(size?.xl ?? xl),
  } as React.CSSProperties;

  const isItem =
    item || Object.values(spans).some((v) => v !== undefined);

  return (
    <div
      ref={ref}
      className={cn(container && 'rt-grid12', isItem && 'rt-grid12-item', className)}
      style={{
        ...(container && spacing ? { gap: `${spacing * 0.5}rem` } : null),
        ...(isItem ? spans : null),
        ...(style || {}),
        ...(sx || {}),
      }}
      {...props}
    >
      {children}
    </div>
  );
});

export default Grid;
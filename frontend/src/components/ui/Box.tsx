/**
 * Box — Tailwind-first layout primitive
 *
 * Maps the MUI `sx` prop surface + direct layout props (row, col, flex, gap)
 * to Tailwind utility classes with safe inline style fallbacks.
 * Seamlessly handles responsive breakpoint objects: { xs, sm, md, lg, xl }.
 */
import React from 'react';
import { cn } from '@/lib/utils';

// ── MUI spacing → Tailwind spacing (MUI unit × 8px, Tailwind unit = 4px) ─────
const SPACING_MAP: Record<number, string> = {
  0: '0',
  0.25: '0.5',
  0.5: '1',
  0.75: '1.5',
  1: '2',
  1.25: '2.5',
  1.5: '3',
  1.75: '3.5',
  2: '4',
  2.5: '5',
  3: '6',
  3.5: '7',
  4: '8',
  5: '10',
  6: '12',
  7: '14',
  8: '16',
  9: '18',
  10: '20',
};

function sp(v: number | string): string {
  if (typeof v === 'string') return v;
  const mapped = SPACING_MAP[v];
  if (mapped !== undefined) return mapped;
  return `[${v * 8}px]`;
}

function toPx(v: number | string): string {
  if (typeof v === 'number') return `${v * 8}px`;
  return String(v);
}

const isResponsiveMap = (v: unknown): v is Record<string, any> =>
  v !== null &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).some((k) => ['xs', 'sm', 'md', 'lg', 'xl'].includes(k));

function getBpPrefix(bp: string): string {
  return bp === 'xs' ? '' : `${bp}:`;
}

function mapDisplay(val: string): string {
  switch (val) {
    case 'flex': return 'flex';
    case 'inline-flex': return 'inline-flex';
    case 'grid': return 'grid';
    case 'inline-grid': return 'inline-grid';
    case 'block': return 'block';
    case 'inline': return 'inline';
    case 'none': return 'hidden';
    default: return '';
  }
}

function mapFlexDirection(val: string): string {
  switch (val) {
    case 'column': return 'flex-col';
    case 'row': return 'flex-row';
    case 'column-reverse': return 'flex-col-reverse';
    case 'row-reverse': return 'flex-row-reverse';
    default: return '';
  }
}

function mapWidth(val: string | number): string {
  if (val === '100%') return 'w-full';
  if (val === 'auto') return 'w-auto';
  if (val === '50%') return 'w-1/2';
  if (typeof val === 'string' && val.endsWith('%')) return `w-[${val}]`;
  if (typeof val === 'number') return `w-[${val}px]`;
  return '';
}

function mapGridCols(val: string): string {
  if (val === '1fr') return 'grid-cols-1';
  if (val === '1fr 1fr' || val === 'repeat(2, 1fr)') return 'grid-cols-2';
  if (val === '1fr 1fr 1fr' || val === 'repeat(3, 1fr)') return 'grid-cols-3';
  if (val === '1fr 1fr 1fr 1fr' || val === 'repeat(4, 1fr)') return 'grid-cols-4';
  return '';
}

function mapAlignSelf(val: string): string {
  switch (val) {
    case 'auto': return 'self-auto';
    case 'flex-start':
    case 'start': return 'self-start';
    case 'flex-end':
    case 'end': return 'self-end';
    case 'center': return 'self-center';
    case 'stretch': return 'self-stretch';
    case 'baseline': return 'self-baseline';
    default: return '';
  }
}

// ── sx → Tailwind classes + CSS-var inline styles ─────────────────────────────
/** Shared sx parser — also used by Button, List, TextField, Chip (see imports). */
export function parseSx(sx: Record<string, any>): { classes: string[]; style: React.CSSProperties } {
  const classes: string[] = [];
  const style: React.CSSProperties = {};

  for (const [key, val] of Object.entries(sx)) {
    if (val === undefined || val === null) continue;

    // Handle responsive breakpoint maps ({ xs: ..., md: ..., lg: ... })
    if (isResponsiveMap(val)) {
      for (const [bp, bpVal] of Object.entries(val)) {
        const prefix = getBpPrefix(bp);
        switch (key) {
          case 'flexDirection': {
            const cls = mapFlexDirection(bpVal);
            if (cls) classes.push(`${prefix}${cls}`);
            break;
          }
          case 'display': {
            const cls = mapDisplay(bpVal);
            if (cls) classes.push(`${prefix}${cls}`);
            break;
          }
          case 'width': {
            const cls = mapWidth(bpVal);
            if (cls) classes.push(`${prefix}${cls}`);
            break;
          }
          case 'gridTemplateColumns': {
            const cls = mapGridCols(bpVal);
            if (cls) classes.push(`${prefix}${cls}`);
            break;
          }
          case 'p':   classes.push(`${prefix}p-${sp(bpVal)}`); break;
          case 'px':  classes.push(`${prefix}px-${sp(bpVal)}`); break;
          case 'py':  classes.push(`${prefix}py-${sp(bpVal)}`); break;
          case 'pt':  classes.push(`${prefix}pt-${sp(bpVal)}`); break;
          case 'pb':  classes.push(`${prefix}pb-${sp(bpVal)}`); break;
          case 'pl':  classes.push(`${prefix}pl-${sp(bpVal)}`); break;
          case 'pr':  classes.push(`${prefix}pr-${sp(bpVal)}`); break;
          case 'm':   classes.push(`${prefix}m-${sp(bpVal)}`); break;
          case 'mx':  classes.push(`${prefix}mx-${sp(bpVal)}`); break;
          case 'my':  classes.push(`${prefix}my-${sp(bpVal)}`); break;
          case 'mt':  classes.push(`${prefix}mt-${sp(bpVal)}`); break;
          case 'mb':  classes.push(`${prefix}mb-${sp(bpVal)}`); break;
          case 'ml':  classes.push(`${prefix}ml-${sp(bpVal)}`); break;
          case 'mr':  classes.push(`${prefix}mr-${sp(bpVal)}`); break;
          case 'gap': classes.push(`${prefix}gap-${sp(bpVal)}`); break;
          case 'alignSelf': {
            const cls = mapAlignSelf(bpVal);
            if (cls) classes.push(`${prefix}${cls}`);
            break;
          }
        }
      }
      continue;
    }

    // Ignore any other non-responsive nested objects to prevent [object Object] in style
    if (typeof val === 'object') {
      continue;
    }

    switch (key) {
      // ── Spacing ────────────────────────────────────────────────────────
      case 'p':
        classes.push(`p-${sp(val)}`);
        style.padding = toPx(val);
        break;
      case 'px':
        classes.push(`px-${sp(val)}`);
        style.paddingLeft = toPx(val);
        style.paddingRight = toPx(val);
        break;
      case 'py':
        classes.push(`py-${sp(val)}`);
        style.paddingTop = toPx(val);
        style.paddingBottom = toPx(val);
        break;
      case 'pt':
        classes.push(`pt-${sp(val)}`);
        style.paddingTop = toPx(val);
        break;
      case 'pb':
        classes.push(`pb-${sp(val)}`);
        style.paddingBottom = toPx(val);
        break;
      case 'pl':
        classes.push(`pl-${sp(val)}`);
        style.paddingLeft = toPx(val);
        break;
      case 'pr':
        classes.push(`pr-${sp(val)}`);
        style.paddingRight = toPx(val);
        break;
      case 'm':
        classes.push(`m-${sp(val)}`);
        style.margin = toPx(val);
        break;
      case 'mx':
        classes.push(`mx-${sp(val)}`);
        style.marginLeft = toPx(val);
        style.marginRight = toPx(val);
        break;
      case 'my':
        classes.push(`my-${sp(val)}`);
        style.marginTop = toPx(val);
        style.marginBottom = toPx(val);
        break;
      case 'mt':
        classes.push(`mt-${sp(val)}`);
        style.marginTop = toPx(val);
        break;
      case 'mb':
        classes.push(`mb-${sp(val)}`);
        style.marginBottom = toPx(val);
        break;
      case 'ml':
        classes.push(`ml-${sp(val)}`);
        style.marginLeft = toPx(val);
        break;
      case 'mr':
        classes.push(`mr-${sp(val)}`);
        style.marginRight = toPx(val);
        break;
      case 'gap':
        classes.push(`gap-${sp(val)}`);
        style.gap = toPx(val);
        break;
      case 'rowGap':
        classes.push(`gap-y-${sp(val)}`);
        style.rowGap = toPx(val);
        break;
      case 'columnGap':
        classes.push(`gap-x-${sp(val)}`);
        style.columnGap = toPx(val);
        break;

      // ── Display / Flex ─────────────────────────────────────────────────
      case 'display': {
        const cls = mapDisplay(val);
        if (cls) classes.push(cls);
        style.display = val === 'none' ? 'none' : val;
        break;
      }
      case 'flexDirection': {
        const cls = mapFlexDirection(val);
        if (cls) classes.push(cls);
        style.flexDirection = val;
        break;
      }
      case 'flexWrap':
        if (val === 'wrap') classes.push('flex-wrap');
        else if (val === 'nowrap') classes.push('flex-nowrap');
        style.flexWrap = val;
        break;
      case 'alignItems': {
        const map: Record<string, string> = {
          center: 'items-center',
          'flex-start': 'items-start',
          start: 'items-start',
          'flex-end': 'items-end',
          end: 'items-end',
          stretch: 'items-stretch',
          baseline: 'items-baseline',
        };
        if (map[val]) classes.push(map[val]);
        style.alignItems = val;
        break;
      }
      case 'justifyContent': {
        const map: Record<string, string> = {
          center: 'justify-center',
          'flex-start': 'justify-start',
          start: 'justify-start',
          'flex-end': 'justify-end',
          end: 'justify-end',
          'space-between': 'justify-between',
          'space-around': 'justify-around',
          'space-evenly': 'justify-evenly',
        };
        if (map[val]) classes.push(map[val]);
        style.justifyContent = val;
        break;
      }
      case 'alignSelf': {
        const cls = mapAlignSelf(val);
        if (cls) classes.push(cls);
        style.alignSelf = val as any;
        break;
      }
      case 'flexShrink':
        if (val === 0) classes.push('shrink-0');
        else if (val === 1) classes.push('shrink');
        style.flexShrink = val;
        break;
      case 'flexGrow':
        if (val === 1) classes.push('grow');
        else if (val === 0) classes.push('grow-0');
        style.flexGrow = val;
        break;
      case 'flex':
        if (val === 1) classes.push('flex-1');
        else if (val === 'none') classes.push('flex-none');
        else if (val === 'auto') classes.push('flex-auto');
        style.flex = val;
        break;

      // ── Sizing ─────────────────────────────────────────────────────────
      case 'width': {
        const cls = mapWidth(val);
        if (cls) classes.push(cls);
        style.width = typeof val === 'number' ? `${val}px` : val;
        break;
      }
      case 'height':
        if (val === '100%') classes.push('h-full');
        else if (val === 'auto') classes.push('h-auto');
        style.height = typeof val === 'number' ? `${val}px` : val;
        break;
      case 'minWidth':
        style.minWidth = typeof val === 'number' ? `${val}px` : val;
        break;
      case 'maxWidth':
        style.maxWidth = typeof val === 'number' ? `${val}px` : val;
        break;
      case 'minHeight':
        style.minHeight = typeof val === 'number' ? `${val}px` : val;
        break;
      case 'maxHeight':
        style.maxHeight = typeof val === 'number' ? `${val}px` : val;
        break;

      // ── Position ───────────────────────────────────────────────────────
      case 'position':
        if (['relative', 'absolute', 'fixed', 'sticky', 'static'].includes(val)) {
          classes.push(val);
        }
        style.position = val as any;
        break;
      case 'top':    style.top = typeof val === 'number' ? `${val}px` : val; break;
      case 'bottom': style.bottom = typeof val === 'number' ? `${val}px` : val; break;
      case 'left':   style.left = typeof val === 'number' ? `${val}px` : val; break;
      case 'right':  style.right = typeof val === 'number' ? `${val}px` : val; break;
      case 'zIndex': style.zIndex = val; break;

      // ── Overflow ───────────────────────────────────────────────────────
      case 'overflow':
        if (['hidden', 'auto', 'scroll', 'visible'].includes(val)) {
          classes.push(`overflow-${val}`);
        }
        style.overflow = val;
        break;
      case 'overflowY':
        if (['hidden', 'auto', 'scroll', 'visible'].includes(val)) {
          classes.push(`overflow-y-${val}`);
        }
        style.overflowY = val;
        break;
      case 'overflowX':
        if (['hidden', 'auto', 'scroll', 'visible'].includes(val)) {
          classes.push(`overflow-x-${val}`);
        }
        style.overflowX = val;
        break;

      // ── Grid ───────────────────────────────────────────────────────────
      case 'gridTemplateColumns':
        if (typeof val === 'string') {
          const cls = mapGridCols(val);
          if (cls) classes.push(cls);
          style.gridTemplateColumns = val;
        }
        break;
      case 'gridColumn': style.gridColumn = val; break;
      case 'gridRow':    style.gridRow = val; break;

      // ── Typography ─────────────────────────────────────────────────────
      case 'fontSize':      style.fontSize = val; break;
      case 'fontWeight':    style.fontWeight = val; break;
      case 'lineHeight':    style.lineHeight = val; break;
      case 'letterSpacing': style.letterSpacing = val; break;
      case 'textTransform':
        if (['uppercase', 'lowercase', 'capitalize'].includes(val)) classes.push(val);
        else if (val === 'none') classes.push('normal-case');
        style.textTransform = val;
        break;
      case 'whiteSpace':
        if (val === 'nowrap') classes.push('whitespace-nowrap');
        else if (val === 'pre-wrap') classes.push('whitespace-pre-wrap');
        style.whiteSpace = val as any;
        break;
      case 'textAlign':
        if (['center', 'left', 'right', 'justify'].includes(val)) classes.push(`text-${val}`);
        style.textAlign = val;
        break;

      // ── Color ──────────────────────────────────────────────────────────
      case 'color':            style.color = val; break;
      case 'bgcolor':
      case 'backgroundColor':  style.backgroundColor = val; break;
      case 'background':       style.background = val; break;
      case 'opacity':          style.opacity = val; break;

      // ── Border ─────────────────────────────────────────────────────────
      case 'border':        style.border = val; break;
      case 'borderTop':     style.borderTop = val; break;
      case 'borderBottom':  style.borderBottom = val; break;
      case 'borderLeft':    style.borderLeft = val; break;
      case 'borderRight':   style.borderRight = val; break;
      case 'borderRadius':
        style.borderRadius = typeof val === 'number' ? `${val}px` : val;
        break;
      case 'boxShadow':     style.boxShadow = val; break;

      // ── Interaction ────────────────────────────────────────────────────
      case 'cursor':
        if (val === 'pointer') classes.push('cursor-pointer');
        else if (val === 'not-allowed') classes.push('cursor-not-allowed');
        else if (val === 'default') classes.push('cursor-default');
        style.cursor = val as any;
        break;
      case 'userSelect':
        if (val === 'none') classes.push('select-none');
        style.userSelect = val as any;
        break;
      case 'pointerEvents':
        if (val === 'none') classes.push('pointer-events-none');
        style.pointerEvents = val as any;
        break;

      // ── Misc visual ────────────────────────────────────────────────────
      case 'verticalAlign': style.verticalAlign = val as any; break;
      case 'objectFit':     style.objectFit = val as any; break;

      // ── Fallback ───────────────────────────────────────────────────────
      default:
        if (!key.startsWith('&') && !key.startsWith('@')) {
          (style as any)[key] = val;
        }
        break;
    }
  }

  return { classes, style };
}

// ── Component ─────────────────────────────────────────────────────────────────
export interface BoxProps extends Omit<React.HTMLAttributes<HTMLElement>, 'color'> {
  /** Render as a different HTML element or React component (e.g. "span", "section"). */
  component?: React.ElementType;
  /** MUI-compatible sx prop — mapped to Tailwind classes + inline styles. */
  sx?: Record<string, any>;
  /** Convenience shortcut for display="flex" flexDirection="row" */
  row?: boolean;
  /** Convenience shortcut for display="flex" flexDirection="column" */
  col?: boolean;
  /** Direct layout props */
  display?: string;
  flexDirection?: string;
  alignItems?: string;
  justifyContent?: string;
  alignSelf?: string;
  gap?: number | string;
  children?: React.ReactNode;
  [key: string]: any;
}

export const Box = React.forwardRef<HTMLElement, BoxProps>(function Box(
  {
    component: Component = 'div',
    className,
    style,
    sx,
    row,
    col,
    display,
    flexDirection,
    alignItems,
    justifyContent,
    alignSelf,
    gap,
    children,
    ...rest
  },
  ref
) {
  // Merge direct layout props into sx if provided
  const directSx: Record<string, any> = {};
  if (row) {
    directSx.display = 'flex';
    directSx.flexDirection = 'row';
  } else if (col) {
    directSx.display = 'flex';
    directSx.flexDirection = 'column';
  }
  if (display) directSx.display = display;
  if (flexDirection) directSx.flexDirection = flexDirection;
  if (alignItems) directSx.alignItems = alignItems;
  if (justifyContent) directSx.justifyContent = justifyContent;
  if (alignSelf) directSx.alignSelf = alignSelf;
  if (gap !== undefined) directSx.gap = gap;

  const combinedSx = sx ? { ...directSx, ...sx } : directSx;
  const { classes, style: sxStyle } = Object.keys(combinedSx).length > 0
    ? parseSx(combinedSx)
    : { classes: [], style: {} };

  // Explicit style prop overrides sx-derived styles
  const mergedStyle: React.CSSProperties = {
    ...sxStyle,
    ...(style || {}),
  };

  const hasStyle = Object.keys(mergedStyle).length > 0;
  const Comp = Component as any;

  return (
    <Comp
      ref={ref}
      className={cn(...classes, className)}
      style={hasStyle ? mergedStyle : undefined}
      {...rest}
    >
      {children}
    </Comp>
  );
});

Box.displayName = 'Box';
export default Box;
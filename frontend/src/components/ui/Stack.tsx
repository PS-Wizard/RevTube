import React from 'react';
import { Box } from './Box';

export interface StackProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Gap between children. Number = MUI 8px grid units, string passes through. */
  gap?: number | string;
  alignItems?: string;
  justifyContent?: string;
  component?: React.ElementType;
  sx?: Record<string, unknown>;
  children?: React.ReactNode;
}

/**
 * Stack — vertical flex column with gap.
 *
 * Pages compose layout from Stack / Flex / Container / Grid / PageShell.
 * Pages must NOT use Tailwind layout utilities (`flex`, `grid`, `gap-*`,
 * `items-*`, `justify-*`, …) or per-page flexbox CSS — those live only
 * inside these shared primitives.
 */
export const Stack = React.forwardRef<HTMLElement, StackProps>(function Stack(
  { gap = 2, alignItems, justifyContent, component = 'div', sx, children, ...props },
  ref
) {
  return (
    <Box
      ref={ref}
      component={component}
      display="flex"
      flexDirection="column"
      gap={gap}
      alignItems={alignItems}
      justifyContent={justifyContent}
      sx={sx}
      {...props}
    >
      {children}
    </Box>
  );
});

export interface FlexProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Gap between children. Number = MUI 8px grid units, string passes through. */
  gap?: number | string;
  alignItems?: string;
  justifyContent?: string;
  wrap?: boolean;
  component?: React.ElementType;
  sx?: Record<string, unknown>;
  children?: React.ReactNode;
}

/**
 * Flex — horizontal flex row with gap.
 * Same rule as Stack: the sanctioned row layout, no raw flex utilities in pages.
 */
export const Flex = React.forwardRef<HTMLElement, FlexProps>(function Flex(
  {
    gap = 2,
    alignItems = 'center',
    justifyContent,
    wrap = false,
    component = 'div',
    sx,
    children,
    ...props
  },
  ref
) {
  return (
    <Box
      ref={ref}
      component={component}
      display="flex"
      flexDirection="row"
      gap={gap}
      alignItems={alignItems}
      justifyContent={justifyContent}
      sx={wrap ? { flexWrap: 'wrap', ...(sx || {}) } : sx}
      {...props}
    >
      {children}
    </Box>
  );
});

export default Stack;

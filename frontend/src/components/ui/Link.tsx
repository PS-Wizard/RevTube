import React from 'react';
import { cn } from '@/lib/utils';

export interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  underline?: 'none' | 'hover' | 'always';
  component?: React.ElementType;
  to?: string;
  sx?: Record<string, any>;
  children?: React.ReactNode;
}

export const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  {
    underline = 'hover',
    component: Component = 'a',
    className = '',
    style,
    sx,
    children,
    ...props
  },
  ref
) {
  const Comp = Component as any;
  return (
    <Comp
      ref={ref}
      className={cn(
        'font-medium text-[var(--rt-color-accent)] transition-colors hover:text-[var(--rt-color-accent-hover)]',
        underline === 'hover' && 'hover:underline',
        underline === 'always' && 'underline',
        underline === 'none' && 'no-underline',
        className
      )}
      style={{ ...(style || {}), ...(sx || {}) }}
      {...props}
    >
      {children}
    </Comp>
  );
});

export default Link;
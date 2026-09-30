import React from 'react';
import { cn } from '@/lib/utils';

export interface PaperProps extends React.HTMLAttributes<HTMLDivElement> {
  component?: React.ElementType;
  elevation?: number;
  sx?: Record<string, any>;
  children?: React.ReactNode;
  [key: string]: any;
}

export const Paper = React.forwardRef<HTMLDivElement, PaperProps>(function Paper(
  { component: Component = 'div', className = '', style, sx, children, ...props },
  ref
) {
  const Comp = Component as any;
  return (
    <Comp
      ref={ref}
      className={cn(
        'rounded-lg border border-border bg-card text-card-foreground shadow-xs rt-paper',
        className
      )}
      style={{ ...(style || {}), ...(sx || {}) }}
      {...props}
    >
      {children}
    </Comp>
  );
});

export default Paper;
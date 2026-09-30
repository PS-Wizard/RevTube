import React from 'react';
import { cn } from '@/lib/utils';

export interface DividerProps extends React.HTMLAttributes<HTMLHRElement> {
  strong?: boolean;
  orientation?: 'horizontal' | 'vertical';
  flexItem?: boolean;
  sx?: Record<string, any>;
  children?: React.ReactNode;
}

export const Divider: React.FC<DividerProps> = ({
  strong = false,
  orientation = 'horizontal',
  flexItem = false,
  className = '',
  style,
  sx,
  children,
  ...props
}) => {
  if (children) {
    return (
      <div
        className={cn(
          'flex items-center my-4 text-xs text-muted-foreground font-medium',
          className
        )}
        style={{ ...(style || {}), ...(sx || {}) }}
      >
        <div className={cn('flex-grow border-t', strong ? 'border-input' : 'border-border')} />
        <span className="px-3 shrink-0">{children}</span>
        <div className={cn('flex-grow border-t', strong ? 'border-input' : 'border-border')} />
      </div>
    );
  }

  if (orientation === 'vertical') {
    return (
      <div
        role="separator"
        aria-orientation="vertical"
        className={cn(
          'w-[1px] self-stretch',
          strong ? 'bg-input' : 'bg-border',
          flexItem && 'h-auto',
          className
        )}
        style={{ ...(style || {}), ...(sx || {}) }}
        {...(props as any)}
      />
    );
  }

  return (
    <hr
      className={cn(
        'my-4 border-0 border-t w-full',
        strong ? 'border-input' : 'border-border',
        className
      )}
      style={{ ...(style || {}), ...(sx || {}) }}
      {...props}
    />
  );
};

export default Divider;
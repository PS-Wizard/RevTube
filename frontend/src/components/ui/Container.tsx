import React from 'react';
import { cn } from '@/lib/utils';

export interface ContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  maxWidth?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | false;
  disableGutters?: boolean;
  sx?: Record<string, any>;
  children?: React.ReactNode;
}

const maxWidthMap: Record<string, string> = {
  xs: 'max-w-screen-xs mx-auto',
  sm: 'max-w-screen-sm mx-auto',
  md: 'max-w-screen-md mx-auto',
  lg: 'w-full max-w-full',
  xl: 'w-full max-w-full',
};

export const Container = React.forwardRef<HTMLDivElement, ContainerProps>(function Container(
  {
    maxWidth = false,
    disableGutters = false,
    className = '',
    style,
    sx,
    children,
    ...props
  },
  ref
) {
  const mwClass = maxWidth && maxWidthMap[maxWidth] ? maxWidthMap[maxWidth] : 'w-full max-w-full';
  return (
    <div
      ref={ref}
      className={cn(
        'mx-auto w-full p-2', // Minimum 8px padding for all screen sizes
        !disableGutters && 'sm:px-6',
        mwClass,
        className
      )}
      style={{ boxSizing: 'border-box', ...(style || {}), ...(sx || {}) }}
      {...props}
    >
      {children}
    </div>
  );
});

export default Container;
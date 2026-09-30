import React from 'react';
import { cn } from '@/lib/utils';

export type IconButtonVariant = 'ghost' | 'subtle' | 'primary' | 'secondary';
export type IconButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'small' | 'medium' | 'large';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  edge?: 'start' | 'end' | false | string;
  sx?: Record<string, any>;
}

const sizeClasses: Record<string, string> = {
  xs: 'h-6 w-6 p-1 text-xs',
  sm: 'h-8 w-8 p-1.5 text-xs',
  small: 'h-8 w-8 p-1.5 text-xs',
  md: 'h-9 w-9 p-2 text-sm',
  medium: 'h-9 w-9 p-2 text-sm',
  lg: 'h-11 w-11 p-2.5 text-base',
  large: 'h-11 w-11 p-2.5 text-base',
};

const variantClasses: Record<IconButtonVariant, string> = {
  ghost: 'hover:bg-accent hover:text-accent-foreground text-muted-foreground',
  subtle: 'bg-muted/50 hover:bg-muted text-foreground',
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-secondary text-secondary-foreground border border-border hover:bg-muted',
};

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    variant = 'ghost',
    size = 'md',
    className = '',
    type = 'button',
    disabled,
    sx,
    style,
    children,
    ...props
  },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
        sizeClasses[size] || sizeClasses.md,
        variantClasses[variant] || variantClasses.ghost,
        className
      )}
      style={{ ...(style || {}), ...(sx || {}) }}
      {...props}
    >
      {children}
    </button>
  );
});

IconButton.displayName = 'IconButton';
export default IconButton;
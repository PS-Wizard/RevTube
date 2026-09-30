import React from 'react';
import { cn } from '@/lib/utils';

export interface FormControlProps extends React.HTMLAttributes<HTMLDivElement> {
  fullWidth?: boolean;
  size?: 'small' | 'medium';
  sx?: Record<string, any>;
  children?: React.ReactNode;
}

export const FormControl = React.forwardRef<HTMLDivElement, FormControlProps>(function FormControl(
  { fullWidth = false, size = 'small', className = '', style, sx, children, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn('flex flex-col gap-1.5', fullWidth && 'w-full', className)}
      style={{ ...(style || {}), ...(sx || {}) }}
      {...props}
    >
      {children}
    </div>
  );
});

export interface FormControlLabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  control: React.ReactElement;
  label: React.ReactNode;
  disabled?: boolean;
  componentsProps?: {
    typography?: Record<string, any>;
  };
  sx?: Record<string, any>;
}

export const FormControlLabel = React.forwardRef<HTMLLabelElement, FormControlLabelProps>(function FormControlLabel(
  { control, label, disabled = false, className = '', style, sx, ...props },
  ref
) {
  return (
    <label
      ref={ref}
      className={cn(
        'inline-flex items-center gap-2 cursor-pointer text-sm font-medium text-foreground select-none',
        disabled && 'cursor-not-allowed opacity-50',
        className
      )}
      style={{ ...(style || {}), ...(sx || {}) }}
      {...props}
    >
      {control}
      <span className="text-sm">{label}</span>
    </label>
  );
});

export interface InputAdornmentProps extends React.HTMLAttributes<HTMLDivElement> {
  position?: 'start' | 'end';
  sx?: Record<string, any>;
  children?: React.ReactNode;
}

export const InputAdornment = React.forwardRef<HTMLDivElement, InputAdornmentProps>(function InputAdornment(
  { position = 'start', className = '', style, sx, children, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn(
        'flex items-center text-muted-foreground',
        position === 'start' ? 'mr-2' : 'ml-2',
        className
      )}
      style={{ ...(style || {}), ...(sx || {}) }}
      {...props}
    >
      {children}
    </div>
  );
});

export interface InputLabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  sx?: Record<string, any>;
  children?: React.ReactNode;
}

export const InputLabel = React.forwardRef<HTMLLabelElement, InputLabelProps>(function InputLabel(
  { className = '', style, sx, children, ...props },
  ref
) {
  return (
    <label
      ref={ref}
      className={cn('text-xs font-semibold text-muted-foreground', className)}
      style={{ ...(style || {}), ...(sx || {}) }}
      {...props}
    >
      {children}
    </label>
  );
});

export default FormControl;
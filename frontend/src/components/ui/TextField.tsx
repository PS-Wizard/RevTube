import React from 'react';
import { cn } from '@/lib/utils';
import { parseSx } from './Box';

export interface TextFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement | HTMLTextAreaElement>, 'size'> {
  label?: React.ReactNode;
  helperText?: React.ReactNode;
  error?: boolean;
  fullWidth?: boolean;
  multiline?: boolean;
  rows?: number;
  minRows?: number;
  maxRows?: number;
  size?: 'small' | 'medium';
  variant?: 'outlined' | 'standard' | 'filled';
  InputProps?: {
    startAdornment?: React.ReactNode;
    endAdornment?: React.ReactNode;
    className?: string;
    [key: string]: any;
  };
  inputProps?: Record<string, any>;
  slotProps?: Record<string, any>;
  sx?: Record<string, any>;
}

export const TextField = React.forwardRef<HTMLInputElement | HTMLTextAreaElement, TextFieldProps>(function TextField(
  {
    label,
    helperText,
    error = false,
    fullWidth = false,
    multiline = false,
    rows,
    minRows = 3,
    maxRows,
    size = 'small',
    variant,
    InputProps,
    inputProps,
    slotProps,
    className = '',
    style,
    sx,
    disabled = false,
    id,
    ...props
  },
  ref
) {
  const effectiveRows = rows || minRows;
  const generatedId = React.useId();
  const inputId = id || (label ? generatedId : undefined);
  const isSm = size === 'small';

  const InputComponent = multiline ? 'textarea' : 'input';
  const slotInput = (slotProps as any)?.input ?? {};
  const startAdornment = InputProps?.startAdornment ?? slotInput.startAdornment;
  const endAdornment = InputProps?.endAdornment ?? slotInput.endAdornment;
  const { classes: sxCls, style: sxStyle } = parseSx(sx || {});

  return (
    <div
      className={cn('flex flex-col gap-1.5', fullWidth && 'w-full', ...sxCls, className)}
      style={{ ...(style || {}), ...sxStyle }}
    >
      {label && (
        <label
          htmlFor={inputId}
          className={cn(
            'text-xs font-semibold text-muted-foreground',
            error && 'text-destructive'
          )}
        >
          {label}
        </label>
      )}

      {/* Reuses the tokenized input shell (single border + single focus ring),
          identical to the common `Input` component. */}
      <div
        className={cn(
          'relative inline-flex w-full box-border items-center rounded-[var(--rt-radius-md)] border border-[var(--rt-color-border-strong)] bg-[var(--rt-color-bg-elevated)] transition-colors focus-within:border-[var(--rt-color-accent)] focus-within:shadow-[var(--rt-focus-ring)]',
          multiline
            ? 'h-auto min-h-0 items-stretch'
            : isSm
              ? 'h-[var(--rt-toolbar-height)] min-h-[var(--rt-toolbar-height)]'
              : 'min-h-[var(--rt-control-height-md)]',
          error && 'border-[var(--rt-color-danger)] focus-within:shadow-[0_0_0_2px_var(--rt-color-danger-surface)]',
          disabled && 'cursor-not-allowed bg-[var(--rt-color-bg-subtle)] opacity-55',
          InputProps?.className
        )}
      >
        {startAdornment && (
          <span
            className={cn(
              'inline-flex shrink-0 items-center justify-center text-[var(--rt-color-text-tertiary)]',
              !multiline && isSm ? 'pl-2' : 'pl-3'
            )}
          >
            {startAdornment}
          </span>
        )}

        <InputComponent
          ref={ref as any}
          id={inputId}
          disabled={disabled}
          data-rt-input
          rows={multiline ? effectiveRows : undefined}
          className={cn(
            'h-full min-w-0 w-full flex-1 border-0 bg-transparent font-sans text-[length:var(--rt-text-md)] text-[var(--rt-color-text)] outline-none placeholder:text-[var(--rt-color-text-tertiary)] disabled:cursor-not-allowed disabled:text-[var(--rt-color-text-disabled)]',
            !multiline && isSm && 'px-2 text-[length:var(--rt-text-sm)]',
            (!isSm || multiline) && 'px-3 py-2',
            multiline && 'h-auto min-h-[var(--rt-control-height-md)] resize-y leading-normal'
          )}
          {...inputProps}
          {...(props as any)}
        />

        {endAdornment && (
          <span
            className={cn(
              'inline-flex shrink-0 items-center justify-center text-[var(--rt-color-text-tertiary)]',
              !multiline && isSm ? 'pr-2' : 'pr-3'
            )}
          >
            {endAdornment}
          </span>
        )}
      </div>

      {helperText && (
        <p className={cn('text-xs text-muted-foreground', error && 'text-destructive')}>
          {helperText}
        </p>
      )}
    </div>
  );
});

export default TextField;
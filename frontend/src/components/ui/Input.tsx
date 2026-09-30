import React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IconButton } from './IconButton';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  compact?: boolean;
  error?: boolean;
  startAdornment?: React.ReactNode;
  endAdornment?: React.ReactNode;
  clearable?: boolean;
  onClear?: () => void;
  /**
   * Show the built-in password visibility (eye) toggle.
   * Defaults to true when `type="password"`, false otherwise.
   * Pages must never hand-roll their own eye toggle — enable this instead.
   */
  passwordToggle?: boolean;
}

/**
 * Enterprise tokenized Input component.
 * Supports standard HTML input attributes, compact mode for toolbars,
 * start/end adornment slots, and error states.
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    compact = false,
    error = false,
    startAdornment,
    endAdornment,
    clearable = false,
    onClear,
    passwordToggle,
    type = 'text',
    className = '',
    disabled,
    value,
    ...props
  },
  ref
) {
  const hasValue = value !== undefined && value !== null && value !== '';
  const showClear = clearable && hasValue && !disabled;

  // Password visibility toggle is built in: on for type="password" unless
  // explicitly disabled. The input type flips while the toggle is active.
  const enablePasswordToggle = passwordToggle ?? type === 'password';
  const [showPassword, setShowPassword] = React.useState(false);
  const effectiveType = enablePasswordToggle && showPassword ? 'text' : type;

  return (
    <div
      className={cn(
        'relative inline-flex w-full box-border items-center rounded-[var(--rt-radius-md)] border border-[var(--rt-color-border-strong)] bg-[var(--rt-color-bg-elevated)] transition-colors focus-within:border-[var(--rt-color-accent)] focus-within:shadow-[var(--rt-focus-ring)]',
        compact
          ? 'h-[var(--rt-toolbar-height)] min-h-[var(--rt-toolbar-height)]'
          : 'min-h-[var(--rt-control-height-md)]',
        error && 'border-[var(--rt-color-danger)] focus-within:shadow-[0_0_0_2px_var(--rt-color-danger-surface)]',
        disabled && 'cursor-not-allowed bg-[var(--rt-color-bg-subtle)] opacity-55',
        className
      )}
    >
      {startAdornment && (
        <span
          className={cn(
            'inline-flex shrink-0 items-center justify-center text-[var(--rt-color-text-tertiary)]',
            compact ? 'pl-2' : 'pl-3'
          )}
          aria-hidden="true"
        >
          {startAdornment}
        </span>
      )}
      <input
        ref={ref}
        type={effectiveType}
        data-rt-input
        className={cn(
          'h-full min-w-0 w-full flex-1 border-0 bg-transparent font-sans text-[length:var(--rt-text-md)] text-[var(--rt-color-text)] outline-none placeholder:text-[var(--rt-color-text-tertiary)] disabled:cursor-not-allowed disabled:text-[var(--rt-color-text-disabled)]',
          compact ? 'px-2 text-[length:var(--rt-text-sm)]' : 'px-3 py-2'
        )}
        disabled={disabled}
        value={value}
        {...props}
      />
      {showClear && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Clear input"
          className="mr-1.5 inline-flex shrink-0 items-center justify-center rounded-[var(--rt-radius-sm)] border-0 bg-transparent p-0.5 text-[var(--rt-color-text-tertiary)] transition-colors hover:bg-[var(--rt-color-bg-muted)] hover:text-[var(--rt-color-text)]"
          onClick={onClear}
        >
          ✕
        </button>
      )}
      {enablePasswordToggle ? (
        <IconButton
          variant="ghost"
          size="xs"
          className="mr-1.5 shrink-0"
          onClick={() => setShowPassword((v) => !v)}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
          title={showPassword ? 'Hide password' : 'Show password'}
          tabIndex={-1}
        >
          {showPassword ? <Eye size={16} /> : <EyeOff size={16} />}
        </IconButton>
      ) : (
        endAdornment && (
          <span
            className={cn(
              'inline-flex shrink-0 items-center justify-center text-[var(--rt-color-text-tertiary)]',
              compact ? 'pr-2' : 'pr-3'
            )}
          >
            {endAdornment}
          </span>
        )
      )}
    </div>
  );
});

Input.displayName = 'Input';
export default Input;

import React from 'react';
import { cn } from '@/lib/utils';

/**
 * Common form primitives -- the single sanctioned way to build forms.
 *
 * Two layouts:
 *  - toolbar  : the fetch/input toolbar shape (Videos / Channel / Playlist / Compare)
 *               -> <form className="horizontal-form"> with `main|checkbox|limit|small` fields
 *  - stacked  : label-above-control forms (auth, modals, settings)
 *               -> Tailwind utilities below (no per-page field CSS)
 *
 * All colors/spacing come from `--rt-*` tokens via Tailwind arbitrary values;
 * pages must not re-declare field surfaces locally. Form controls themselves
 * must be `Input` / `TextField` / `NativeSelect`, never raw inputs.
 */

export interface FormProps extends React.FormHTMLAttributes<HTMLFormElement> {
  children: React.ReactNode;
  /** "toolbar" renders the horizontal fetch-toolbar form; default is stacked. */
  layout?: 'toolbar' | 'stacked';
  /** Stop the browser default submit/reload; onSubmit receives the event. */
  preventDefault?: boolean;
}

export const Form: React.FC<FormProps> = ({
  children,
  layout = 'stacked',
  preventDefault = true,
  className = '',
  onSubmit,
  ...props
}) => {
  const classes = cn(
    layout === 'toolbar' ? 'horizontal-form' : 'flex flex-col gap-[var(--rt-space-5)]',
    className
  );

  return (
    <form
      className={classes}
      onSubmit={(e) => {
        if (preventDefault) e.preventDefault();
        onSubmit?.(e);
      }}
      {...props}
    >
      {children}
    </form>
  );
};

export type FormFieldVariant = 'main' | 'checkbox' | 'limit' | 'small' | 'default';

export interface FormFieldProps {
  children: React.ReactNode;
  /** Label text; omitted for toolbar fields that use aria-labels instead. */
  label?: React.ReactNode;
  htmlFor?: string;
  /** Helper text under the control. */
  hint?: React.ReactNode;
  /** Validation message; renders with role="alert" and takes precedence over hint. */
  error?: React.ReactNode;
  required?: boolean;
  /** Toolbar field width variants (`.form-field-*`). */
  variant?: FormFieldVariant;
  className?: string;
}

export const FormField: React.FC<FormFieldProps> = ({
  children,
  label,
  htmlFor,
  hint,
  error,
  required,
  variant = 'default',
  className = '',
}) => {
  const isToolbar = variant !== 'default';

  return (
    <div className={cn(!isToolbar && 'flex flex-col gap-[var(--rt-space-2)]', isToolbar && `form-field-${variant}`, className)}>
      {label != null && (
        <label
          className="text-[length:var(--rt-text-sm)] font-semibold text-[var(--rt-color-text-secondary)]"
          htmlFor={htmlFor}
        >
          {label}
          {required && <span aria-hidden="true"> *</span>}
        </label>
      )}
      {children}
      {error != null ? (
        <p className="mt-[var(--rt-space-1)] text-[length:var(--rt-text-xs)] text-[var(--rt-color-danger)]" role="alert">
          {error}
        </p>
      ) : hint != null ? (
        <p className="mt-[var(--rt-space-1)] text-[length:var(--rt-text-xs)] text-[var(--rt-color-text-tertiary)]">{hint}</p>
      ) : null}
    </div>
  );
};

/** Actions row (submit/cancel buttons). Uses the existing `.form-actions-inline` layout. */
export const FormActions: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => (
  <div className={['form-actions-inline', className].filter(Boolean).join(' ')}>{children}</div>
);

/** Helper text rendered below a form / field. */
export const FormHint: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => <p className={['form-hint-below', className].filter(Boolean).join(' ')}>{children}</p>;

/** Validation message with role="alert" for screen readers. */
export const FormError: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => (
  <p className={cn('mt-[var(--rt-space-1)] text-[length:var(--rt-text-xs)] text-[var(--rt-color-danger)]', className)} role="alert">
    {children}
  </p>
);

export default Form;
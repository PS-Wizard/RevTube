/**
 * Dialog / Modal — centralized dialog component.
 *
 * Exported under two names:
 *   Modal — legacy name kept for all existing call-sites (no changes needed there)
 *   Dialog — canonical new name; prefer for new code
 *
 * Sub-components are also exported individually for composing custom dialogs:
 *   DialogHeader / ModalHeader
 *   DialogBody  / ModalBody
 *   DialogFooter / ModalFooter
 */
import React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dialog as DialogShell } from './dialog';
import { Button } from './button';
import { Spinner } from './Spinner';
import { IconButton } from './IconButton';

// ── Action descriptor ────────────────────────────────────────────────────────

export interface ModalAction {
  label: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'cta';
}

// ── Props ────────────────────────────────────────────────────────────────────

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  primaryAction?: ModalAction;
  secondaryAction?: ModalAction;
  /** Controls max-width of the dialog. Defaults to 'md'. */
  maxWidth?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  fullWidth?: boolean;
  /** Shorthand for maxWidth="lg" */
  large?: boolean;
  /**
   * Wide content editor panel: fluid 70vw with responsive steps at 900px
   * and 640px (same panel as `guide`). Sets maxWidth/fullWidth aside
   * while active.
   */
  wide?: boolean;
  /**
   * Wide guide/help dialog (replaces the legacy `.help-dialog` /
   * `.audit-guide-dialog` CSS classes): fluid 70vw panel with responsive
   * steps at 900px and 640px. Sets maxWidth/fullWidth aside while active.
   * Prefer `wide` for non-guide content; both share the same panel.
   */
  guide?: boolean;
  loading?: boolean;
  className?: string;
}

/** DialogProps is an alias of ModalProps — same shape, preferred name for new code. */
export type DialogProps = ModalProps;

// ── Sub-components ───────────────────────────────────────────────────────────
// Token values come from `--rt-*` via Tailwind arbitrary values (same pattern
// as table.tsx / card.tsx) — no companion CSS file.

/** Wide 70vw panel with responsive steps (shared by `wide` and `guide`). */
const WIDE_PANEL_CLASS =
  'w-[70vw] min-w-[min(70vw,980px)] max-w-[min(90vw,1100px)] ' +
  'max-[900px]:w-[85vw] max-[900px]:min-w-[min(85vw,760px)] max-[900px]:max-w-[95vw] ' +
  'max-[640px]:mx-auto max-[640px]:w-[calc(100vw-1.25rem)] max-[640px]:min-w-[calc(100vw-1.25rem)] max-[640px]:max-w-[calc(100vw-1.25rem)]';

export const DialogHeader: React.FC<{
  title: React.ReactNode;
  description?: string;
  icon?: React.ReactNode;
  onClose?: () => void;
  children?: React.ReactNode;
  className?: string;
}> = ({ title, description, icon, onClose, children, className = '' }) => (
  <div className={cn(
    'flex shrink-0 items-center justify-between border-b border-[var(--rt-color-border)] bg-[var(--rt-color-bg-elevated)] px-5 py-4',
    className
  )}>
    <div className="flex min-w-0 flex-1 items-center gap-3">
      {icon && (
        <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--rt-radius-md)] bg-[var(--rt-color-bg-muted)] text-[var(--rt-color-accent)]">
          {icon}
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <h2 className="m-0 text-[length:var(--rt-text-md)] font-semibold leading-[var(--rt-leading-tight)] text-[var(--rt-color-text)]">
          {title}
        </h2>
        {description && (
          <p className="m-0 mt-[var(--rt-space-1)] text-[length:var(--rt-text-sm)] text-[var(--rt-color-text-secondary)]">
            {description}
          </p>
        )}
      </div>
    </div>
    {children}
    {onClose && (
      <IconButton
        className="shrink-0 rounded-[var(--rt-radius-md)] p-1.5 text-[var(--rt-color-text-tertiary)] hover:bg-[var(--rt-color-bg-muted)] hover:text-[var(--rt-color-text)]"
        onClick={onClose}
        aria-label="Close dialog"
        size="sm"
      >
        <X size={18} />
      </IconButton>
    )}
  </div>
);

/** @alias DialogHeader */
export const ModalHeader = DialogHeader;

// ─────────────────────────────────────────────────────────────────────────────

export const DialogBody: React.FC<{
  children: React.ReactNode;
  className?: string;
  dividers?: boolean;
}> = ({ children, className = '', dividers = false }) => (
  <div className={cn(
    'bg-[var(--rt-color-bg-elevated)] p-5 text-sm text-[var(--rt-color-text)]',
    dividers && 'border-y border-border',
    className
  )}>
    {children}
  </div>
);

/** @alias DialogBody */
export const ModalBody = DialogBody;

// ─────────────────────────────────────────────────────────────────────────────

export const DialogFooter: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className = '' }) => (
  <div className={cn(
    'flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-[var(--rt-color-border)] bg-[var(--rt-color-bg-subtle)] px-5 py-3',
    className
  )}>
    {children}
  </div>
);

/** @alias DialogFooter */
export const ModalFooter = DialogFooter;

// ── Main component ───────────────────────────────────────────────────────────

const _Dialog: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  description,
  icon,
  children,
  footer,
  primaryAction,
  secondaryAction,
  maxWidth,
  fullWidth = true,
  large = false,
  wide = false,
  guide = false,
  loading = false,
  className = '',
}) => {
  const resolvedMaxWidth = maxWidth || (large ? 'lg' : 'md');
  const isWide = wide || guide;

  const footerContent = (() => {
    if (footer) return footer;
    if (!primaryAction && !secondaryAction) return null;

    return (
      <>
        {secondaryAction && (
          <Button
            type="button"
            variant={secondaryAction.variant || 'ghost'}
            size="sm"
            onClick={secondaryAction.onClick}
            disabled={secondaryAction.disabled || loading}
          >
            {secondaryAction.label}
          </Button>
        )}
        {primaryAction && (
          <Button
            type="button"
            variant={primaryAction.variant || 'primary'}
            size="sm"
            onClick={primaryAction.onClick}
            disabled={primaryAction.disabled || primaryAction.loading || loading}
          >
            {primaryAction.loading ? (
              <span className="inline-flex items-center gap-1.5">
                <Spinner size="xs" />
                {primaryAction.label}
              </span>
            ) : primaryAction.label}
          </Button>
        )}
      </>
    );
  })();

  return (
    <DialogShell
      open={open}
      onClose={loading ? undefined : onClose}
      fullWidth={isWide ? false : fullWidth}
      maxWidth={isWide ? false : resolvedMaxWidth}
      aria-labelledby="rt-dialog-title"
      PaperProps={{
        // Width only — the Radix shell already provides border, radius,
        // elevated bg, and shadow. Layout (pinned header/footer) lives on
        // the inner wrapper so it never fights shell utilities.
        className: cn(
          isWide ? WIDE_PANEL_CLASS : 'max-w-[540px]',
          className
        ),
      }}
    >
      <div className="flex max-h-full min-h-0 flex-col overflow-hidden rounded-lg">
        <DialogHeader
          title={title}
          description={description}
          icon={icon}
          onClose={loading ? undefined : onClose}
        />
        <DialogBody className="min-h-0 flex-1 overflow-y-auto">{children}</DialogBody>
        {footerContent && <DialogFooter>{footerContent}</DialogFooter>}
      </div>
    </DialogShell>
  );
};

/**
 * `Dialog` — canonical name.  Prefer for new code.
 * `Modal`  — legacy alias, kept for backward compatibility.
 */
export const Dialog = _Dialog;
export const Modal = _Dialog;

export default Dialog;
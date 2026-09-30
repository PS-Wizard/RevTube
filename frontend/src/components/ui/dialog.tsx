import * as React from "react"
import { cn } from "@/lib/utils"
import { Dialog as DialogPrimitive } from "radix-ui"
import { Button } from "@/components/ui/button"

/**
 * Expand MUI-style `sx` spacing shorthand into real CSS so it works when `sx`
 * is applied as plain inline styles (which don't understand MUI's system
 * props). Numbers use MUI's 8px grid; string values (design tokens like
 * `var(--rt-space-*)`) pass through unchanged.
 */
const toSize = (v: any): string =>
  typeof v === 'number' ? `${v * 8}px` : String(v)

function expandSx(sx?: Record<string, any>): Record<string, any> {
  if (!sx) return {}
  const out: Record<string, any> = {}
  for (const [key, val] of Object.entries(sx)) {
    switch (key) {
      case 'p':   out.padding = toSize(val); break
      case 'px':  out.paddingLeft = out.paddingRight = toSize(val); break
      case 'py':  out.paddingTop = out.paddingBottom = toSize(val); break
      case 'pt':  out.paddingTop = toSize(val); break
      case 'pb':  out.paddingBottom = toSize(val); break
      case 'pl':  out.paddingLeft = toSize(val); break
      case 'pr':  out.paddingRight = toSize(val); break
      case 'm':   out.margin = toSize(val); break
      case 'mx':  out.marginLeft = out.marginRight = toSize(val); break
      case 'my':  out.marginTop = out.marginBottom = toSize(val); break
      case 'mt':  out.marginTop = toSize(val); break
      case 'mb':  out.marginBottom = toSize(val); break
      case 'ml':  out.marginLeft = toSize(val); break
      case 'mr':  out.marginRight = toSize(val); break
      case 'gap':
      case 'rowGap':
      case 'columnGap':
        out[key] = toSize(val)
        break
      default:
        out[key] = val
    }
  }
  return out
}

/**
 * Dialog — the single, centralized dialog primitive.
 *
 * It is a SELF-CONTAINED shell: one component renders the Radix
 * Root + Portal + Overlay + Content. It accepts MUI-style props
 * (`open` / `onClose` / `maxWidth` / `fullWidth` / `PaperProps`) plus the
 * Radix-style `onOpenChange`, so it works as a drop-in for the old
 * `AppDialog` AND for the plain shadcn usage.
 *
 *   <Dialog open={open} onClose={close} maxWidth="sm" fullWidth>
 *     <DialogTitle>Title</DialogTitle>
 *     <DialogBody>…</DialogBody>
 *     <DialogActions>…</DialogActions>
 *   </Dialog>
 *
 * Compose the content sub-parts (`DialogTitle`, `DialogBody`, `DialogActions`,
 * `DialogHeader`, `DialogFooter`, ...) inside it — they render no portal or
 * overlay of their own, so nesting them here is safe.
 *
 * By default backdrop-clicks and Escape are blocked so form input is never
 * lost; pass `closeOnBackdrop` / `closeOnEscape` to allow them.
 */
export function Dialog({
  open,
  defaultOpen,
  onOpenChange,
  onClose,
  maxWidth = 'md',
  fullWidth = false,
  fullScreen = false,
  scroll: _scroll,
  PaperProps,
  sx,
  slotProps,
  closeOnBackdrop = false,
  closeOnEscape = false,
  className = '',
  children,
  ...rest
}: DialogProps) {
  const handleOpenChange = (isOpen: boolean) => {
    onOpenChange?.(isOpen);
    if (!isOpen) onClose?.();
  };

  const paperFromSlot: Record<string, any> = (slotProps as any)?.paper ?? {};
  const paper: Record<string, any> = PaperProps ?? {};
  const paperSx = expandSx(paper.sx ?? paperFromSlot.sx ?? sx ?? {});
  const paperStyle = paper.style ?? paperFromSlot.style ?? {};
  const paperClassName = paper.className ?? paperFromSlot.className ?? '';

  const mwClass = maxWidth
    ? maxWidthMap[String(maxWidth)] || 'sm:max-w-lg'
    : 'sm:max-w-none';

  return (
    <DialogPrimitive.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={handleOpenChange}
    >
      <DialogPrimitive.Portal>
        {!fullScreen && (
          <DialogPrimitive.Overlay
            data-slot="dialog-overlay"
            className="fixed inset-0 z-[1300] bg-black/60 backdrop-blur-xs transition-opacity data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          />
        )}
        <DialogPrimitive.Content
          data-slot="dialog-content"
          onInteractOutside={(e) => {
            if (!closeOnBackdrop) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (!closeOnEscape) e.preventDefault();
          }}
          className={cn(
            "fixed left-1/2 top-1/2 z-[1300] grid w-full max-h-[90vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-card p-0 text-card-foreground shadow-[var(--rt-shadow-md)] duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            fullWidth ? 'w-[calc(100%-2rem)]' : 'w-full',
            mwClass,
            paperClassName,
            className
          )}
          style={{ ...paperStyle, ...paperSx }}
          {...rest}
        >
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

const maxWidthMap: Record<string, string> = {
  xs: 'sm:max-w-xs',
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  xl: 'sm:max-w-xl',
  '2xl': 'sm:max-w-5xl',
}

export interface DialogProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onClose?: (event?: any, reason?: string) => void;
  maxWidth?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | false | string;
  fullWidth?: boolean;
  fullScreen?: boolean;
  scroll?: 'body' | 'paper' | string;
  PaperProps?: {
    className?: string;
    sx?: Record<string, any>;
    style?: React.CSSProperties;
    [key: string]: any;
  };
  sx?: Record<string, any>;
  /** Allow closing by clicking the backdrop (default: blocked). */
  closeOnBackdrop?: boolean;
  /** Allow closing by pressing Escape (default: blocked). */
  closeOnEscape?: boolean;
  className?: string;
  children?: React.ReactNode;
  [key: string]: any;
}

// ── Content sub-parts (render no portal/overlay of their own) ──────────────

export function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

export function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}
export interface DialogTitleProps extends React.ComponentProps<typeof DialogPrimitive.Title> {
  sx?: Record<string, any>;
}

export function DialogTitle({
  className,
  sx,
  style,
  ...props
}: DialogTitleProps) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      style={{ ...(style || {}), ...expandSx(sx) }}
      {...props}
    />
  )
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export interface DialogBodyProps extends React.ComponentProps<"div"> {
  dividers?: boolean;
  sx?: Record<string, any>;
}

export function DialogBody({
  className,
  dividers: _dividers,
  sx,
  style,
  ...props
}: DialogBodyProps) {
  return (
    <div
      data-slot="dialog-body"
      className={cn(className)}
      style={{ ...(style || {}), ...expandSx(sx) }}
      {...props}
    />
  )
}

export function DialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1.5", className)}
      {...props}
    />
  )
}

export interface DialogActionsProps extends React.ComponentProps<"div"> {
  showCloseButton?: boolean;
  sx?: Record<string, any>;
}

export function DialogFooter({
  className,
  showCloseButton = false,
  children,
  sx,
  style,
  ...props
}: DialogActionsProps) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      style={{ ...(style || {}), ...expandSx(sx) }}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

/** Alias of `DialogFooter` for MUI-style call-sites. */
export const DialogActions = DialogFooter

export default Dialog
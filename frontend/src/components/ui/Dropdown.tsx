import React from 'react';
import { Button, type ButtonProps } from './button';
import { cn } from '@/lib/utils';

/**
 * Centralized dropdown primitives. The `.rt-dropdown-*` styles live in
 * design-tokens.css; these components are the single sanctioned way to render
 * that markup so pages never re-declare trigger/panel/item markup.
 */

/* ── Trigger ──────────────────────────────────────────────────────────── */

export interface DropdownTriggerProps extends ButtonProps {
  /** Renders the compact toolbar variant (`.rt-dropdown-trigger--toolbar`). */
  toolbar?: boolean;
  /** Marks the trigger active/open (adds the `active` state class). */
  active?: boolean;
}

export const DropdownTrigger = React.forwardRef<HTMLButtonElement, DropdownTriggerProps>(
  function DropdownTrigger({ toolbar = false, active, className, ...props }, ref) {
    return (
      <Button
        ref={ref}
        bare
        className={cn(
          'rt-dropdown-trigger inline-flex items-center gap-2 cursor-pointer transition-all duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          toolbar && 'rt-dropdown-trigger--toolbar px-2 py-1.5 rounded-[var(--rt-radius-sm,0.375rem)] hover:bg-muted/60',
          active && 'active bg-muted text-foreground',
          className
        )}
        {...props}
      />
    );
  }
);

/* ── Panel ────────────────────────────────────────────────────────────── */

type DropdownPanelAlign = 'right' | 'left' | 'full' | 'menu' | 'action';

export interface DropdownPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  align?: DropdownPanelAlign;
}

export function DropdownPanel({ align, className, ...props }: DropdownPanelProps) {
  return (
    <div
      className={cn(
        'rt-dropdown-panel z-50 min-w-[12rem] overflow-hidden',
        'shadow-[var(--rt-shadow-lg,var(--rt-shadow-md))] border border-border/80 bg-popover text-popover-foreground',
        'rounded-[var(--rt-radius-md,0.5rem)] backdrop-blur-sm',
        'animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
        'max-w-[calc(100vw-1.5rem)]',
        align && `rt-dropdown-panel--${align}`,
        className
      )}
      {...props}
    />
  );
}

/* ── Item ─────────────────────────────────────────────────────────────── */

export interface DropdownItemProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  /** Marks the row selected (adds the `.selected` state class). Accepts any truthy value (e.g. a sorting descriptor). */
  selected?: unknown;
  /** Renders an anchor instead of a row div (e.g. external links). */
  href?: string;
}

export function DropdownItem({ selected = false, href, className, ...props }: DropdownItemProps) {
  const cls = cn(
    'rt-dropdown-item relative flex w-full items-center gap-3 px-3 py-2 cursor-pointer select-none transition-colors outline-none',
    'hover:bg-muted/80 focus:bg-muted/80 focus-visible:bg-muted/80 text-sm text-foreground/90',
    'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
    Boolean(selected) && 'selected bg-muted/60 font-medium text-foreground',
    className
  );

  if (href !== undefined) {
    return <a className={cls} href={href} {...props} />;
  }

  return <div className={cls} {...(props as React.HTMLAttributes<HTMLDivElement>)} />;
}

/* ── Structure helpers ────────────────────────────────________________  */

export function DropdownHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div 
      className={cn('rt-dropdown-header px-3 py-2 border-b border-border/60 bg-muted/20', className)} 
      {...props} 
    />
  );
}

export function DropdownTitle({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'rt-dropdown-title text-[11px] font-semibold text-muted-foreground uppercase tracking-wider', 
        className
      )}
      {...props}
    />
  );
}

export function DropdownList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div 
      className={cn('rt-dropdown-list overflow-y-auto p-1 max-h-[var(--rt-dropdown-max-height,20rem)]', className)} 
      {...props} 
    />
  );
}

export function DropdownFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div 
      className={cn('rt-dropdown-footer px-3 py-2 border-t border-border/60 bg-muted/30', className)} 
      {...props} 
    />
  );
}
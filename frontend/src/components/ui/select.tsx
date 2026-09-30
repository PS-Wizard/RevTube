"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Select as SelectPrimitive } from "radix-ui"
import { ChevronDownIcon, CheckIcon, ChevronUpIcon } from "lucide-react"

function Select({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectGroup({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("scroll-my-1.5 p-1.5", className)}
      {...props}
    />
  )
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "flex w-fit items-center justify-between gap-1.5 rounded-[var(--rt-radius-md)] border border-[var(--rt-color-border-strong)] bg-[var(--rt-color-bg-elevated)] px-3 py-2 text-sm whitespace-nowrap transition-[color,box-shadow,background-color] outline-none focus-visible:border-[var(--rt-color-accent)] focus-visible:ring-2 focus-visible:ring-[var(--rt-color-accent-muted)] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-[var(--rt-control-height-md)] data-[size=sm]:h-[var(--rt-control-height-sm)] *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        className={cn(
          "relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-[var(--rt-shadow-md)] duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          className
        )}
        position={position}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            "p-1",
            position === "popper" &&
              "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1"
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("px-3 py-2.5 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

export interface SelectItemProps extends Omit<React.ComponentProps<typeof SelectPrimitive.Item>, 'value'> {
  value?: string | number;
  dense?: boolean;
  sx?: Record<string, any>;
  onClick?: (e?: any) => void;
}

function SelectItem({
  className,
  children,
  value,
  dense,
  sx,
  style,
  onClick,
  ...props
}: SelectItemProps) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      value={value !== undefined ? String(value) : ''}
      onClick={onClick}
      className={cn(
        "relative flex w-full cursor-default items-center gap-2.5 rounded-[var(--rt-radius-sm)] py-2 pr-8 pl-3 text-sm font-medium outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        dense && "py-1 text-xs",
        className
      )}
      style={{ ...(style || {}), ...(sx || {}) }}
      {...props}
    >
      <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="pointer-events-none" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn(
        "pointer-events-none -mx-1.5 my-1.5 h-px bg-border",
        className
      )}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1 text-muted-foreground",
        className
      )}
      {...props}
    >
      <ChevronUpIcon className="size-4" />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1 text-muted-foreground",
        className
      )}
      {...props}
    >
      <ChevronDownIcon className="size-4" />
    </SelectPrimitive.ScrollDownButton>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}

// ── MUI compat shim ──────────────────────────────────────────────────────────
// MUI Select wraps its own trigger+content together, and uses onChange(SelectChangeEvent).
export interface SelectChangeEvent<T = any> {
  target: { value: T; name?: string };
}

export interface SelectCompatProps<T = any> {
  value?: T;
  onChange?: (event: SelectChangeEvent<T> | any) => void;
  children?: React.ReactNode;
  size?: 'small' | 'medium' | string;
  fullWidth?: boolean;
  disabled?: boolean;
  name?: string;
  displayEmpty?: boolean;
  labelId?: string;
  variant?: string;
  disableUnderline?: boolean;
  className?: string;
  style?: React.CSSProperties;
  sx?: Record<string, any>;
  MenuProps?: Record<string, any>;
  /** Extra props spread onto the underlying SelectContent (portaled dropdown).
   *  Use to override z-index when the select is used inside a modal/dialog. */
  contentProps?: React.ComponentProps<typeof SelectPrimitive.Content>;
  [key: string]: any;
}

export function SelectCompat<T = any>({
  value,
  onChange,
  children,
  size,
  fullWidth,
  disabled,
  name,
  displayEmpty: _displayEmpty,
  labelId: _labelId,
  variant: _variant,
  disableUnderline: _du,
  sx,
  style,
  className,
    MenuProps: _mp,
  contentProps,
  ...rest
}: SelectCompatProps<T>) {
  return (
    <Select
      value={value !== undefined ? String(value) : undefined}
      onValueChange={(v) => onChange?.({ target: { value: v as unknown as T, name } })}
      disabled={disabled}
      {...(rest as any)}
    >
      <SelectTrigger
        size={size === 'small' ? 'sm' : 'default'}
        className={cn(fullWidth && 'w-full', className)}
        style={{ ...(style || {}), ...(sx || {}) }}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent {...contentProps}>{children}</SelectContent>
    </Select>
  );
}

export interface SelectProps<T = any> extends SelectCompatProps<T> {}
export { SelectItem as MenuItem }

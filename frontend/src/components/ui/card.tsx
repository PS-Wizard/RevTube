import * as React from "react"
import { cn } from "@/lib/utils"

function Card({
  className,
  size = "default",
  variant: _variant,
  sx,
  style,
  ...props
}: React.ComponentProps<"div"> & { size?: "default" | "sm"; variant?: string; sx?: Record<string, any> }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        "group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-lg border border-border bg-card py-(--card-spacing) text-sm text-card-foreground [--card-spacing:var(--rt-card-padding)] has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:var(--rt-space-4)] *:[img:first-child]:rounded-t-lg *:[img:last-child]:rounded-b-lg",
        className
      )}
      style={{ ...(style || {}), ...(sx || {}) }}
      {...props}
    />
  )
}

function CardHeader({ className, sx, style, ...props }: React.ComponentProps<"div"> & { sx?: Record<string, any> }) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1.5 rounded-t-lg px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)",
        className
      )}
      style={{ ...(style || {}), ...(sx || {}) }}
      {...props}
    />
  )
}

function CardTitle({ className, sx, style, ...props }: React.ComponentProps<"div"> & { sx?: Record<string, any> }) {
  return (
    <div
      data-slot="card-title"
      className={cn("font-heading text-[length:var(--rt-section-title-size)] font-semibold tracking-[var(--rt-tracking-ui)]", className)}
      style={{ ...(style || {}), ...(sx || {}) }}
      {...props}
    />
  )
}

function CardDescription({ className, sx, style, ...props }: React.ComponentProps<"div"> & { sx?: Record<string, any> }) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      style={{ ...(style || {}), ...(sx || {}) }}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, sx, style, ...props }: React.ComponentProps<"div"> & { sx?: Record<string, any> }) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-(--card-spacing)", className)}
      style={{ ...(style || {}), ...(sx || {}) }}
      {...props}
    />
  )
}

function CardFooter({ className, sx, style, ...props }: React.ComponentProps<"div"> & { sx?: Record<string, any> }) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center rounded-b-lg px-(--card-spacing) [.border-t]:pt-(--card-spacing)",
        className
      )}
      style={{ ...(style || {}), ...(sx || {}) }}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}

// ── MUI compat shim ──────────────────────────────────────────────────────────
// CardActions is what MUI calls CardFooter
export { CardFooter as CardActions }

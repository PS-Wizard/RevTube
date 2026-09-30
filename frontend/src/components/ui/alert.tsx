import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-lg border px-4 py-3 text-left text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2.5 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        destructive:
          "border-destructive/30 bg-destructive/10 text-destructive focus:border-destructive/40 focus:ring-destructive/20 dark:border-destructive/40 dark:bg-destructive/20 dark:focus:border-destructive/40 dark:focus:ring-destructive/40",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "font-heading col-start-2 line-clamp-1 min-h-4 text-sm font-medium tracking-tight",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-sm text-balance text-muted-foreground md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
        className
      )}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("absolute top-2.5 right-3", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }

// ── MUI compat shim ──────────────────────────────────────────────────────────
export type AlertSeverity = 'error' | 'warning' | 'info' | 'success';

const SEVERITY_VARIANT: Record<string, 'default' | 'destructive'> = {
  error: 'destructive',
  warning: 'default',
  info: 'default',
  success: 'default',
};

export interface AlertCompatProps extends Omit<React.ComponentProps<'div'>, 'title'> {
  severity?: AlertSeverity | string;
  variant?: 'default' | 'destructive' | string;
  title?: React.ReactNode;
  sx?: Record<string, any>;
}

export const AlertCompat = React.forwardRef<HTMLDivElement, AlertCompatProps>(function AlertCompat(
  { severity, variant, title, sx, style, children, ...props },
  ref
) {
  const resolvedVariant = (variant ?? (severity ? SEVERITY_VARIANT[severity] : 'default') ?? 'default') as any;
  return (
    <Alert
      ref={ref as any}
      variant={resolvedVariant}
      style={{ ...(style || {}), ...(sx || {}) }}
      {...props}
    >
      {title && <AlertTitle>{title}</AlertTitle>}
      {children}
    </Alert>
  );
});
AlertCompat.displayName = 'Alert';

export { AlertCompat as default };

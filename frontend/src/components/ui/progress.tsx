import * as React from "react"
import { cn } from "@/lib/utils"
import { Progress as ProgressPrimitive } from "radix-ui"

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        "relative flex h-3 w-full items-center overflow-x-hidden rounded-full bg-muted",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="size-full flex-1 bg-primary transition-all"
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }

// ── MUI compat shim ──────────────────────────────────────────────────────────
export interface ProgressProps extends React.ComponentProps<typeof Progress> {
  variant?: 'determinate' | 'indeterminate' | 'buffer' | 'query';
  sx?: Record<string, any>;
}
export const ProgressCompat = React.forwardRef<HTMLDivElement, ProgressProps>(
  function ProgressCompat({ variant: _v, sx, style, ...props }, ref) {
    return (
      <Progress
        ref={ref as any}
        style={{ ...(style || {}), ...(sx || {}) }}
        {...props}
      />
    );
  }
);
ProgressCompat.displayName = 'Progress';
export type ProgressSize = 'sm' | 'default';

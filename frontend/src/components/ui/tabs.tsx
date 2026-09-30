import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Tabs as TabsPrimitive } from "radix-ui"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-full items-center justify-start gap-1 rounded-none border-b border-border bg-transparent p-0 text-muted-foreground group-data-horizontal/tabs:h-auto group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col group-data-vertical/tabs:items-stretch group-data-vertical/tabs:w-fit group-data-vertical/tabs:rounded-lg group-data-vertical/tabs:border-0 group-data-vertical/tabs:bg-muted group-data-vertical/tabs:p-1 data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        // Both variants share the canonical underline chrome used by the
        // analytics tabs (.analytics-tab in page-chrome.css): transparent
        // list, 1px bottom rail, active trigger carries a 2px underline.
        default: "",
        line: "",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

export interface TabsTriggerProps extends React.ComponentProps<typeof TabsPrimitive.Trigger> {
  label?: React.ReactNode;
  icon?: React.ReactNode;
  iconPosition?: 'top' | 'bottom' | 'start' | 'end' | string;
  sx?: Record<string, any>;
}

function TabsTrigger({
  className,
  label,
  icon,
  iconPosition = "start",
  children,
  sx,
  style,
  ...props
}: TabsTriggerProps) {
  const isTop = iconPosition === "top";
  const isBottom = iconPosition === "bottom";
  const isEnd = iconPosition === "end" || iconPosition === "right";
  const isStart = iconPosition === "start" || iconPosition === "left";

  const content = children ?? label;

  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex items-center justify-center gap-2 rounded-none border-0 border-b-2 border-transparent bg-transparent px-3 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--rt-color-accent)] disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
        "data-[state=active]:text-foreground data-[state=active]:font-semibold data-[state=active]:border-foreground",
        (isTop || isBottom) && "flex-col gap-1",
        className
      )}
      style={{ ...(style || {}), ...(sx || {}) }}
      {...props}
    >
      {(isStart || isTop) && icon}
      {content}
      {(isEnd || isBottom) && icon}
    </TabsPrimitive.Trigger>
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }

// ── MUI compat shim ──────────────────────────────────────────────────────────
// MUI Tabs uses onChange(event, value) while shadcn uses onValueChange(value).
// Radix TabsPrimitive.Trigger requires a parent TabsPrimitive.List (RovingFocusGroup).
export interface TabsCompatProps extends Omit<React.ComponentProps<typeof TabsPrimitive.Root>, 'onChange' | 'onValueChange'> {
  onChange?: (event: any, value: any) => void;
  sx?: Record<string, any>;
  className?: string;
}

export const TabsCompat = React.forwardRef<HTMLDivElement, TabsCompatProps>(
  function TabsCompat({ onChange, sx, style, children, className, ...props }, ref) {
    const childrenArray = React.Children.toArray(children);
    const hasTabsList = childrenArray.some(
      (child) =>
        React.isValidElement(child) &&
        (child.type === TabsList || (child.props as any)?.['data-slot'] === 'tabs-list')
    );

    return (
      <Tabs
        ref={ref as any}
        onValueChange={(v) => onChange?.(null, v)}
        style={{ ...(style || {}), ...(sx || {}) }}
        className={cn('w-full', className)}
        {...props}
      >
        {hasTabsList ? (
          children
        ) : (
          <TabsList
            variant="line"
            className="w-full justify-start h-auto p-0 bg-transparent border-b border-border rounded-none gap-2"
          >
            {children}
          </TabsList>
        )}
      </Tabs>
    );
  }
);
TabsCompat.displayName = 'Tabs';

// MUI calls it Tab not TabsTrigger
export const Tab = TabsTrigger;
export type { TabsCompatProps as TabsProps };
export type TabProps = TabsTriggerProps;

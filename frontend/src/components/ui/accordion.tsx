import * as React from "react"
import { cn } from "@/lib/utils"
import { Accordion as AccordionPrimitive } from "radix-ui"
import { ChevronDownIcon } from "lucide-react"

function Accordion({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Root>) {
  return (
    <AccordionPrimitive.Root
      data-slot="accordion"
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-2xl border",
        className
      )}
      {...props}
    />
  )
}

function AccordionItem({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn("not-last:border-b data-open:bg-muted/50", className)}
      {...props}
    />
  )
}

function AccordionTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "flex flex-1 items-center justify-between gap-4 rounded-2xl p-4 text-left text-sm font-medium transition-all outline-none hover:underline focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 [&[data-state=open]>svg]:rotate-180",
          className
        )}
        {...props}
      >
        {children}
        <ChevronDownIcon className="pointer-events-none size-4 shrink-0 text-muted-foreground transition-transform duration-200" />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  )
}

function AccordionContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      data-slot="accordion-content"
      className="overflow-hidden text-sm data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down"
      {...props}
    >
      <div
        className={cn(
          "h-(--radix-accordion-content-height) px-5 pt-3 pb-5 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
          className
        )}
      >
        {children}
      </div>
    </AccordionPrimitive.Content>
  )
}

// ── MUI compat shim ──────────────────────────────────────────────────────────
// MUI Accordion is a controlled single-item accordion with expanded/onChange props.
export interface AccordionCompatProps {
  id?: string;
  expanded?: boolean;
  defaultExpanded?: boolean;
  onChange?: (event: any, isExpanded: any) => void;
  disableGutters?: boolean;
  sx?: Record<string, any>;
  style?: React.CSSProperties;
  className?: string;
  children?: React.ReactNode;
  type?: "single" | "multiple";
  collapsible?: boolean;
  value?: any;
  onValueChange?: any;
  [key: string]: any;
}

function AccordionCompat({
  expanded,
  defaultExpanded = false,
  onChange,
  disableGutters: _dg,
  sx,
  style,
  className,
  children,
  type,
  ...props
}: AccordionCompatProps) {
  if (type) {
    return (
      <Accordion
        type={type as any}
        style={{ ...(style || {}), ...(sx || {}) }}
        className={className}
        {...props}
      >
        {children}
      </Accordion>
    );
  }

  const isControlled = expanded !== undefined;
  const [open, setOpen] = React.useState(defaultExpanded ? 'item' : '');
  const value = isControlled ? (expanded ? 'item' : '') : open;

  const handleChange = (v: string) => {
    const next = v === 'item';
    if (!isControlled) setOpen(v);
    onChange?.({} as React.SyntheticEvent, next);
  };

  // MUI nests Summary/Details as siblings, but Radix requires the Content to
  // live INSIDE its Item. Group each Summary with any following Details
  // element(s) into a single AccordionItem here so the MUI JSX pattern works.
  const childArr = React.Children.toArray(children);
  const grouped: React.ReactNode[] = [];
  for (let i = 0; i < childArr.length; i++) {
    // NOTE: cast AFTER isValidElement -- React 19's type predicate narrows
    // props to `unknown`, so the outer cast is what gives us typed props.
    const raw = childArr[i];
    const child = (React.isValidElement(raw) ? raw : null) as React.ReactElement<any> | null;
    if (child && child.type === AccordionSummary) {
      const details: React.ReactElement<any>[] = [];
      while (i + 1 < childArr.length) {
        const nextRaw = childArr[i + 1];
        const next = (React.isValidElement(nextRaw) ? nextRaw : null) as React.ReactElement<any> | null;
        if (next && next.type === AccordionDetails) {
          details.push(next);
          i++;
        } else break;
      }
      grouped.push(
        <AccordionItem value="item" key={child.key ?? i}>
          <AccordionTrigger
            style={{ ...(child.props.style || {}), ...(child.props.sx || {}) }}
            {...(Object.fromEntries(Object.entries(child.props).filter(([k]) => k !== 'sx' && k !== 'style' && k !== 'expandIcon' && k !== 'children')) as any)}
          >
            {child.props.children}
          </AccordionTrigger>
          {details.map((d, j) => (
            <AccordionContent
              key={d.key ?? j}
              style={{ ...(d.props.style || {}), ...(d.props.sx || {}) }}
              {...(Object.fromEntries(Object.entries(d.props).filter(([k]) => k !== 'sx' && k !== 'style' && k !== 'children')) as any)}
            >
              {d.props.children}
            </AccordionContent>
          ))}
        </AccordionItem>
      );
    } else {
      grouped.push(child);
    }
  }

  return (
    <Accordion
      type="single"
      collapsible
      value={value}
      onValueChange={handleChange}
      style={{ ...(style || {}), ...(sx || {}) }}
      className={className}
      {...props}
    >
      {grouped}
    </Accordion>
  );
}

// AccordionSummary = AccordionItem + AccordionTrigger wrapper
export interface AccordionSummaryProps {
  expandIcon?: React.ReactNode;
  sx?: Record<string, any>;
  children?: React.ReactNode;
}
function AccordionSummary({ expandIcon: _ei, sx, style, children, ...props }: AccordionSummaryProps & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <AccordionItem value="item">
      <AccordionTrigger style={{ ...(style || {}), ...(sx || {}) }} {...(props as any)}>
        {children}
      </AccordionTrigger>
    </AccordionItem>
  );
}

// AccordionDetails = AccordionContent
export interface AccordionDetailsProps extends React.HTMLAttributes<HTMLDivElement> {
  sx?: Record<string, any>;
}
function AccordionDetails({ sx, style, className, children, ...props }: AccordionDetailsProps) {
  const resolvedStyle: React.CSSProperties = { ...(style || {}) };
  if (sx) {
    for (const [key, value] of Object.entries(sx)) {
      if (value === undefined || value === null) continue;
      const numToPx = (v: any) => (typeof v === "number" ? `${v * 8}px` : v);
      if (key === "p" || key === "padding") {
        resolvedStyle.padding = numToPx(value);
      } else if (key === "px") {
        resolvedStyle.paddingLeft = numToPx(value);
        resolvedStyle.paddingRight = numToPx(value);
      } else if (key === "py") {
        resolvedStyle.paddingTop = numToPx(value);
        resolvedStyle.paddingBottom = numToPx(value);
      } else if (key === "pt" || key === "paddingTop") {
        resolvedStyle.paddingTop = numToPx(value);
      } else if (key === "pb" || key === "paddingBottom") {
        resolvedStyle.paddingBottom = numToPx(value);
      } else if (key === "pl" || key === "paddingLeft") {
        resolvedStyle.paddingLeft = numToPx(value);
      } else if (key === "pr" || key === "paddingRight") {
        resolvedStyle.paddingRight = numToPx(value);
      } else if (key === "borderTop") {
        resolvedStyle.borderTop = value;
      } else if (key === "borderBottom") {
        resolvedStyle.borderBottom = value;
      } else if (key === "bgcolor" || key === "backgroundColor") {
        resolvedStyle.backgroundColor = value;
      } else {
        (resolvedStyle as any)[key] = value;
      }
    }
  }

  return (
    <AccordionContent style={resolvedStyle} className={className} {...(props as any)}>
      {children}
    </AccordionContent>
  );
}

export {
  AccordionCompat as Accordion,
  Accordion as ShadcnAccordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  AccordionCompat,
  AccordionSummary,
  AccordionDetails,
}
export type AccordionProps = AccordionCompatProps;

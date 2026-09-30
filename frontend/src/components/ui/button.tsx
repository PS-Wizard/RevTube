import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { parseSx } from "./Box"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-md text-sm font-medium transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 gap-2 cursor-pointer",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:opacity-90 active:opacity-95 shadow-xs border border-transparent",
        primary: "bg-primary text-primary-foreground hover:opacity-90 active:opacity-95 shadow-xs border border-transparent",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-muted border border-border",
        outline:
          "border border-border bg-background hover:bg-muted hover:text-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-xs border border-transparent",
        danger:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-xs border border-transparent",
        youtube:
          "bg-[var(--rt-color-youtube)] text-white hover:bg-[var(--rt-color-youtube-hover)] shadow-xs border border-transparent",
        link: "text-primary underline-offset-4 hover:underline",
        bare: "border-none bg-transparent shadow-none hover:bg-transparent text-inherit p-0 h-auto",
      },
      size: {
        default: "h-[var(--rt-control-height-md)] px-4 py-2 text-sm",
        md: "h-[var(--rt-control-height-md)] px-4 py-2 text-sm",
        sm: "h-[var(--rt-control-height-sm)] px-3 text-xs",
        xs: "h-[var(--rt-toolbar-height)] px-2.5 text-xs",
        lg: "h-[var(--rt-control-height-lg)] px-5 text-base",
        icon: "size-[var(--rt-control-height-md)] p-0",
        "icon-xs": "size-6 p-0 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-[var(--rt-control-height-sm)] p-0",
        "icon-lg": "size-[var(--rt-control-height-lg)] p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

// ── MUI compat shim ──────────────────────────────────────────────────────────
// Wraps shadcn Button to accept the full MUI prop surface that existing pages use.
const MUI_VARIANT: Record<string, string> = {
  contained: 'primary',
  outlined: 'outline',
  text: 'ghost',
  danger: 'destructive',
  primary: 'primary',
  cta: 'primary',
  secondary: 'secondary',
  ghost: 'ghost',
};

const MUI_SIZE: Record<string, string> = {
  small: 'sm',
  medium: 'default',
  large: 'lg',
  sm: 'sm',
  md: 'default',
  lg: 'lg',
  xs: 'xs',
};

const tokenVariantClassMap: Record<string, string> = {
  default: 'rt-btn--primary',
  primary: 'rt-btn--primary',
  secondary: 'rt-btn--secondary',
  outline: 'rt-btn--ghost',
  ghost: 'rt-btn--ghost',
  destructive: 'rt-btn--danger',
  danger: 'rt-btn--danger',
  youtube: 'rt-btn--youtube',
};

export interface ButtonProps extends Omit<React.ComponentProps<'button'>, 'color'> {
  variant?: string;
  size?: string;
  startIcon?: React.ReactNode;
  endIcon?: React.ReactNode;
  fullWidth?: boolean;
  block?: boolean;
  pill?: boolean;
  bare?: boolean;
  component?: React.ElementType;
  to?: string;
  href?: string;
  target?: string;
  rel?: string;
  sx?: Record<string, any>;
  color?: string;
  asChild?: boolean;
}

const ButtonCompat = React.forwardRef<HTMLButtonElement, ButtonProps>(function ButtonCompat(
  {
    variant = 'default',
    size = 'default',
    // Default to type="button" so buttons rendered inside <form> don't trigger
    // an accidental submit (HTML's implicit default is "submit"). Explicit
    // type="submit" call-sites still pass their own value through.
    type = 'button',
    startIcon,
    endIcon,
    fullWidth,
    block,
    pill,
    bare,
    component: Component,
    sx,
    style,
    color,
    className,
    children,
    asChild,
    ...rest
  },
  ref
) {
  const resolvedVariant = bare ? 'bare' : (MUI_VARIANT[variant] ?? variant);
  let resolvedColor = resolvedVariant;
  if (color === 'error') resolvedColor = 'destructive';

  const resolvedSize = (MUI_SIZE[size] ?? size) as any;

  const { classes: sxCls, style: sxStyle } = parseSx(sx || {});
  const mergedStyle = { ...(style || {}), ...sxStyle };
  const Comp: any = Component ?? 'button';

  const baseTokenClass = bare ? 'rt-btn--bare' : cn('rt-btn', tokenVariantClassMap[resolvedColor] || '');

  if (Component && Component !== 'button') {
    return (
      <Comp
        ref={ref}
        type={type}
        className={cn(
          buttonVariants({ variant: resolvedColor as any, size: resolvedSize }),
          baseTokenClass,
          ...sxCls,
          (fullWidth || block) && 'w-full rt-btn--block',
          pill && 'rounded-full rt-btn--pill',
          bare && 'border-none bg-transparent shadow-none p-0',
          className
        )}
        style={mergedStyle}
        {...rest}
      >
        {startIcon && <span className="inline-flex shrink-0 items-center">{startIcon}</span>}
        {children}
        {endIcon && <span className="inline-flex shrink-0 items-center">{endIcon}</span>}
      </Comp>
    );
  }

  // Radix Slot (asChild) requires exactly ONE element child. startIcon/endIcon
  // spans or fragment children would crash with "Slot failed to slot onto its
  // children", so strip the icon slots and wrap non-single children.
  const slotChildren = (() => {
    if (startIcon || endIcon) return <span>{startIcon}{children}{endIcon}</span>;
    return React.isValidElement(children) && children.type !== React.Fragment
      ? children
      : <span>{children}</span>;
  })();

  return (
    <Button
      ref={ref}
      type={type}
      variant={resolvedColor as any}
      size={resolvedSize}
      className={cn(
        baseTokenClass,
        ...sxCls,
        (fullWidth || block) && 'w-full rt-btn--block',
        pill && 'rounded-full rt-btn--pill',
        bare && 'border-none bg-transparent shadow-none hover:bg-transparent p-0',
        className
      )}
      style={mergedStyle}
      asChild={asChild}
      {...(rest as any)}
    >
      {asChild ? slotChildren : (
        <>
          {startIcon && <span className="inline-flex shrink-0 items-center">{startIcon}</span>}
          {children}
          {endIcon && <span className="inline-flex shrink-0 items-center">{endIcon}</span>}
        </>
      )}
    </Button>
  );
});
ButtonCompat.displayName = 'Button';

export {
  ButtonCompat,
  ButtonCompat as Button,
  ButtonCompat as ButtonMui,
  Button as ShadcnButton,
  buttonVariants,
};
export default ButtonCompat;


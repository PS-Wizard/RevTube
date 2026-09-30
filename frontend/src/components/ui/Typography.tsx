import React from 'react';
import { cn } from '@/lib/utils';

export type TypographyVariant =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'subtitle1'
  | 'subtitle2'
  | 'body1'
  | 'body2'
  | 'caption'
  | 'overline';

export interface TypographyProps extends React.HTMLAttributes<HTMLElement> {
  variant?: TypographyVariant;
  component?: React.ElementType;
  color?: string;
  align?: 'inherit' | 'left' | 'center' | 'right' | 'justify';
  gutterBottom?: boolean;
  noWrap?: boolean;
  sx?: Record<string, any>;
  children?: React.ReactNode;
}

const variantTagMap: Record<TypographyVariant, React.ElementType> = {
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  h4: 'h4',
  h5: 'h5',
  h6: 'h6',
  subtitle1: 'h6',
  subtitle2: 'h6',
  body1: 'p',
  body2: 'p',
  caption: 'span',
  overline: 'span',
};

const variantClasses: Record<TypographyVariant, string> = {
  h1: 'text-4xl font-extrabold tracking-tight',
  h2: 'text-3xl font-semibold tracking-tight',
  h3: 'text-2xl font-semibold tracking-tight',
  h4: 'text-xl font-semibold tracking-tight',
  h5: 'text-lg font-medium tracking-tight',
  h6: 'text-base font-medium',
  subtitle1: 'text-base font-normal text-muted-foreground',
  subtitle2: 'text-sm font-medium text-muted-foreground',
  body1: 'text-base font-normal',
  body2: 'text-sm font-normal text-muted-foreground',
  caption: 'text-xs font-normal text-muted-foreground',
  overline: 'text-[10px] font-semibold tracking-wider uppercase text-muted-foreground',
};

const alignClasses: Record<string, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
  justify: 'text-justify',
};

export const Typography = React.forwardRef<HTMLElement, TypographyProps>(function Typography(
  {
    variant = 'body1',
    component,
    align = 'inherit',
    gutterBottom = false,
    noWrap = false,
    className = '',
    style,
    sx,
    children,
    ...props
  },
  ref
) {
  const Component = component || variantTagMap[variant] || 'p';
  const Comp = Component as any;

  return (
    <Comp
      ref={ref}
      className={cn(
        variantClasses[variant],
        align !== 'inherit' && alignClasses[align],
        gutterBottom && 'mb-2',
        noWrap && 'truncate',
        'rt-typography',
        className
      )}
      style={{ ...(style || {}), ...(sx || {}) }}
      {...props}
    >
      {children}
    </Comp>
  );
});

export default Typography;
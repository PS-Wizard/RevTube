import React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { parseSx } from './Box';

export type ChipVariant =
  | 'default'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'outline'
  | 'filled'
  | 'outlined';

export interface ChipProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onClick'> {
  label?: React.ReactNode;
  variant?: ChipVariant;
  size?: 'sm' | 'md' | 'small' | 'medium';
  icon?: React.ReactNode;
  avatar?: React.ReactNode;
  clickable?: boolean;
  disabled?: boolean;
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
  onDelete?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  deleteIcon?: React.ReactNode;
  sx?: Record<string, any>;
  children?: React.ReactNode;
}

const variantClasses: Record<string, string> = {
  default: 'bg-muted text-foreground border-border',
  filled: 'bg-muted text-foreground border-border',
  primary: 'bg-primary text-primary-foreground border-primary',
  success: 'bg-[var(--rt-color-success-surface)] text-[var(--rt-color-success)] border-[var(--rt-color-success)]/30',
  warning: 'bg-[var(--rt-color-warning-surface)] text-[var(--rt-color-warning)] border-[var(--rt-color-warning)]/30',
  danger: 'bg-[var(--rt-color-danger-surface)] text-[var(--rt-color-danger)] border-[var(--rt-color-danger)]/30',
  info: 'bg-[var(--rt-color-info-surface)] text-[var(--rt-color-info)] border-[var(--rt-color-info)]/30',
  outline: 'bg-transparent text-foreground border-border',
  outlined: 'bg-transparent text-foreground border-border',
};

export const Chip = React.forwardRef<HTMLDivElement, ChipProps>(function Chip(
  {
    label,
    variant = 'default',
    size = 'md',
    icon,
    avatar,
    clickable,
    disabled = false,
    className = '',
    onClick,
    onDelete,
    deleteIcon,
    style,
    sx,
    children,
    ...props
  },
  ref
) {
  const isSm = size === 'sm' || size === 'small';
  const isClickable = (clickable || Boolean(onClick)) && !disabled;
  const { classes: sxCls, style: sxStyle } = parseSx(sx || {});

  return (
    <div
      ref={ref}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={isClickable ? onClick : undefined}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[var(--rt-radius-md)] border font-medium transition-colors',
        isSm ? 'h-5 px-2 text-[11px]' : 'h-[var(--rt-control-height-sm)] px-[var(--rt-space-3)] text-xs',
        variantClasses[variant] || variantClasses.default,
        isClickable && 'cursor-pointer hover:opacity-80',
        disabled && 'pointer-events-none opacity-50',
        ...sxCls,
        className
      )}
      style={{ ...(style || {}), ...sxStyle }}
      {...props}
    >
      {avatar && <span className="shrink-0">{avatar}</span>}
      {icon && <span className="shrink-0">{icon}</span>}
      <span className="truncate">{label ?? children}</span>
      {onDelete && !disabled && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(e);
          }}
          className="ml-0.5 -mr-1 inline-flex items-center justify-center rounded-full p-0.5 text-current opacity-70 hover:opacity-100"
        >
          {deleteIcon || <X size={isSm ? 10 : 12} />}
        </button>
      )}
    </div>
  );
});

export default Chip;
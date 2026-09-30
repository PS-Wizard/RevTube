import React from 'react';
import { cn } from '@/lib/utils';
import { parseSx } from './Box';

export interface ListProps extends React.HTMLAttributes<HTMLUListElement> {
  dense?: boolean;
  disablePadding?: boolean;
  sx?: Record<string, any>;
  children?: React.ReactNode;
}

export const List = React.forwardRef<HTMLUListElement, ListProps>(function List(
  { dense = false, disablePadding: _dp = false, className = '', style, sx, children, ...props },
  ref
) {
  const { classes: sxCls, style: sxStyle } = parseSx(sx || {});
  return (
    <ul
      ref={ref}
      className={cn('flex flex-col py-1 list-none rt-list', dense && 'py-0.5', ...sxCls, className)}
      style={{ ...(style || {}), ...sxStyle }}
      {...props}
    >
      {children}
    </ul>
  );
});

export interface ListItemProps extends React.LiHTMLAttributes<HTMLLIElement> {
  secondaryAction?: React.ReactNode;
  disablePadding?: boolean;
  sx?: Record<string, any>;
  children?: React.ReactNode;
}

export const ListItem = React.forwardRef<HTMLLIElement, ListItemProps>(function ListItem(
  { secondaryAction, disablePadding = false, className = '', style, sx, children, ...props },
  ref
) {
  const { classes: sxCls, style: sxStyle } = parseSx(sx || {});
  return (
    <li
      ref={ref}
      className={cn(
        'relative flex items-center justify-between gap-3 text-sm rt-list-item',
        !disablePadding && 'px-3 py-2',
        ...sxCls,
        className
      )}
      style={{ ...(style || {}), ...sxStyle }}
      {...props}
    >
      <div className="flex flex-1 items-center gap-3">{children}</div>
      {secondaryAction && <div className="shrink-0">{secondaryAction}</div>}
    </li>
  );
});

export interface ListItemButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  dense?: boolean;
  sx?: Record<string, any>;
  children?: React.ReactNode;
}

export const ListItemButton = React.forwardRef<HTMLButtonElement, ListItemButtonProps>(function ListItemButton(
  { selected = false, className = '', style, sx, children, ...props },
  ref
) {
  const { classes: sxCls, style: sxStyle } = parseSx(sx || {});
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60 disabled:pointer-events-none disabled:opacity-50 rt-list-item-btn',
        selected && 'bg-accent font-medium text-accent-foreground',
        ...sxCls,
        className
      )}
      style={{ ...(style || {}), ...sxStyle }}
      {...props}
    >
      {children}
    </button>
  );
});

export interface ListItemIconProps extends React.HTMLAttributes<HTMLDivElement> {
  sx?: Record<string, any>;
  children?: React.ReactNode;
}

export const ListItemIcon = React.forwardRef<HTMLDivElement, ListItemIconProps>(function ListItemIcon(
  { className = '', style, sx, children, ...props },
  ref
) {
  const { classes: sxCls, style: sxStyle } = parseSx(sx || {});
  return (
    <div
      ref={ref}
      className={cn('flex shrink-0 items-center text-muted-foreground rt-list-item-icon', ...sxCls, className)}
      style={{ ...(style || {}), ...sxStyle }}
      {...props}
    >
      {children}
    </div>
  );
});

export interface ListItemAvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  sx?: Record<string, any>;
  children?: React.ReactNode;
}

export const ListItemAvatar = React.forwardRef<HTMLDivElement, ListItemAvatarProps>(function ListItemAvatar(
  { className = '', style, sx, children, ...props },
  ref
) {
  const { classes: sxCls, style: sxStyle } = parseSx(sx || {});
  return (
    <div
      ref={ref}
      className={cn('flex shrink-0 items-center rt-list-item-avatar', ...sxCls, className)}
      style={{ ...(style || {}), ...sxStyle }}
      {...props}
    >
      {children}
    </div>
  );
});

export interface ListItemTextProps extends React.HTMLAttributes<HTMLDivElement> {
  primary?: React.ReactNode;
  secondary?: React.ReactNode;
  primaryTypographyProps?: Record<string, any>;
  secondaryTypographyProps?: Record<string, any>;
  sx?: Record<string, any>;
  children?: React.ReactNode;
}

export const ListItemText = React.forwardRef<HTMLDivElement, ListItemTextProps>(function ListItemText(
  { primary, secondary, primaryTypographyProps, secondaryTypographyProps, className = '', style, sx, children, ...props },
  ref
) {
  const { classes: sxCls, style: sxStyle } = parseSx(sx || {});
  return (
    <div
      ref={ref}
      className={cn('flex flex-col flex-1 min-w-0 rt-list-item-text', ...sxCls, className)}
      style={{ ...(style || {}), ...sxStyle }}
      {...props}
    >
      {(primary ?? children) && (
        <span className={cn('text-sm font-medium text-foreground truncate', primaryTypographyProps?.className)}>
          {primary ?? children}
        </span>
      )}
      {secondary && (
        <span className={cn('text-xs text-muted-foreground truncate', secondaryTypographyProps?.className)}>
          {secondary}
        </span>
      )}
    </div>
  );
});

export default List;
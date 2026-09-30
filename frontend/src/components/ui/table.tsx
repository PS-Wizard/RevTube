"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

export interface TableHeaderProps extends React.ComponentProps<"thead"> {
  sx?: Record<string, any>;
}

function TableHeader({ className, sx, style, ...props }: TableHeaderProps) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b [&_tr]:border-[var(--rt-table-header-border)]", className)}
      style={{ ...(style || {}), ...(sx || {}) }}
      {...props}
    />
  )
}

export interface TableBodyProps extends React.ComponentProps<"tbody"> {
  sx?: Record<string, any>;
}

function TableBody({ className, sx, style, ...props }: TableBodyProps) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      style={{ ...(style || {}), ...(sx || {}) }}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t border-[var(--rt-table-row-border)] bg-[var(--rt-table-footer-bg)] font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

export interface TableRowProps extends React.ComponentProps<"tr"> {
  sx?: Record<string, any>;
  hover?: boolean;
}

function TableRow({ className, sx, style, ...props }: TableRowProps) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b border-[var(--rt-table-row-border)] bg-[var(--rt-color-bg-elevated)] transition-colors hover:bg-[var(--rt-table-row-hover-bg)] has-aria-expanded:bg-[var(--rt-table-row-hover-bg)] data-[state=selected]:bg-[var(--rt-table-row-selected-bg)]",
        className
      )}
      style={{ ...(style || {}), ...(sx || {}) }}
      {...props}
    />
  )
}

export interface TableHeadProps extends React.ComponentProps<"th"> {
  sx?: Record<string, any>;
}

function TableHead({ className, sx, style, ...props }: TableHeadProps) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-[var(--rt-table-header-min-height)] bg-[var(--rt-table-header-bg)] px-[var(--rt-table-cell-padding-x)] py-[var(--rt-table-cell-padding-y)] text-left align-middle text-[length:var(--rt-table-header-font-size)] leading-[var(--rt-table-header-line-height)] font-semibold tracking-[var(--rt-tracking-ui)] text-[var(--rt-table-header-text)] whitespace-nowrap border-b border-[var(--rt-table-header-border)] [&:has([role=checkbox])]:pr-0",
        className
      )}
      style={{ ...(style || {}), ...(sx || {}) }}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "px-[var(--rt-table-cell-padding-x)] py-[var(--rt-table-cell-padding-y)] align-middle whitespace-nowrap text-[length:var(--rt-table-font-size)] leading-[var(--rt-table-line-height)] text-[var(--rt-table-cell-text)] [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}

// ── MUI compat shim ──────────────────────────────────────────────────────────
// MUI has TableContainer (a scrollable wrapper), size prop on Table, and align on TableCell.

export interface TableProps extends React.ComponentProps<'table'> {
  size?: 'small' | 'medium' | string;
  sx?: Record<string, any>;
}

export const TableCompat = React.forwardRef<HTMLTableElement, TableProps>(
  function TableCompat({ size: _size, sx, style, className, ...props }, ref) {
    return (
      <Table
        ref={ref}
        className={cn('w-full caption-bottom text-sm', className)}
        style={{ ...(style || {}), ...(sx || {}) }}
        {...props}
      />
    );
  }
);
TableCompat.displayName = 'Table';

export interface TableContainerProps extends React.ComponentProps<'div'> {
  sx?: Record<string, any>;
  component?: React.ElementType;
}
export const TableContainer = React.forwardRef<HTMLDivElement, TableContainerProps>(
  function TableContainer({ sx, style, className, component: Comp = 'div', children, ...props }, ref) {
    const Component = Comp as any;
    return (
      <Component
        ref={ref}
        className={cn('relative w-full overflow-x-auto', className)}
        style={{ ...(style || {}), ...(sx || {}) }}
        {...props}
      >
        {children}
      </Component>
    );
  }
);

export interface TableCellProps extends Omit<React.ComponentProps<'td'>, 'align'> {
  align?: 'left' | 'center' | 'right' | 'justify' | 'inherit';
  sx?: Record<string, any>;
  component?: React.ElementType;
}
export const TableCellCompat = React.forwardRef<HTMLTableCellElement, TableCellProps>(
  function TableCellCompat({ align, sx, style, component: Comp = 'td', className, ...props }, ref) {
    const alignClass = align && align !== 'inherit' ? `text-${align}` : undefined;
    const El = Comp as any;
    return (
      <El
        ref={ref}
        data-slot="table-cell"
        className={cn('px-[var(--rt-table-cell-padding-x)] py-[var(--rt-table-cell-padding-y)] align-middle whitespace-nowrap text-[length:var(--rt-table-font-size)] leading-[var(--rt-table-line-height)] text-[var(--rt-table-cell-text)] [&:has([role=checkbox])]:pr-0', alignClass, className)}
        style={{ ...(style || {}), ...(sx || {}) }}
        {...props}
      />
    );
  }
);
TableCellCompat.displayName = 'TableCell';

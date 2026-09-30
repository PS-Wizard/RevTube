import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

const SelectContext = createContext<any>(null);

interface MenuContextType {
  onClose?: () => void;
}

const MenuContext = createContext<MenuContextType | null>(null);

export interface MenuProps {
  open: boolean;
  anchorEl?: HTMLElement | null;
  onClose?: (event?: any, reason?: string) => void;
  onClick?: (event?: any) => void;
  slotProps?: Record<string, any>;
  anchorOrigin?: { vertical?: string; horizontal?: string };
  transformOrigin?: { vertical?: string; horizontal?: string };
  sx?: Record<string, any>;
  className?: string;
  children?: React.ReactNode;
  [key: string]: any;
}

export const Menu: React.FC<MenuProps> = ({
  open,
  anchorEl,
  onClose,
  className = '',
  children,
}) => {
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      // The panel is position:fixed, so coordinates must stay in the viewport
      // frame (getBoundingClientRect already is) — never add scroll offsets,
      // or the menu lands off-screen on scrolled pages. Clamp into view and
      // flip above the anchor when there is no room below.
      const GAP = 4;
      const EST_H = 220; // estimate; the panel caps itself at max-h-72
      const EST_W = 240;
      let top = rect.bottom + GAP;
      if (top + EST_H > window.innerHeight && rect.top - GAP - EST_H > 8) {
        top = rect.top - GAP - EST_H;
      }
      top = Math.max(8, Math.min(top, window.innerHeight - 48));
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - EST_W));
      setCoords({ top, left });
    }
  }, [open, anchorEl]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        anchorEl &&
        !anchorEl.contains(e.target as Node)
      ) {
        onClose?.();
      }
    };
    // Fixed-position menus go stale on scroll/resize — close like a native menu.
    const handleDismiss = () => onClose?.();
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleDismiss, true);
    window.addEventListener('resize', handleDismiss);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleDismiss, true);
      window.removeEventListener('resize', handleDismiss);
    };
  }, [open, anchorEl, onClose]);

  if (!open) return null;

  return (
    <MenuContext.Provider value={{ onClose }}>
      <div
        ref={menuRef}
        className={cn(
          'fixed z-50 min-w-[8rem] max-h-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-[var(--rt-shadow-md)] animate-in fade-in-0 zoom-in-95 rt-menu',
          className
        )}
        style={{
          top: coords.top,
          left: coords.left,
        }}
      >
        {children}
      </div>
    </MenuContext.Provider>
  );
};

export interface MenuItemProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: any;
  disabled?: boolean;
  dense?: boolean;
  selected?: boolean;
  sx?: Record<string, any>;
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
}

export const MenuItem = React.forwardRef<HTMLDivElement, MenuItemProps>(function MenuItem(
  {
    value,
    disabled = false,
    dense = false,
    selected = false,
    className = '',
    style,
    sx,
    children,
    onClick,
    ...props
  },
  ref
) {
  const selectCtx: any = useContext(SelectContext);
  const menuCtx = useContext(MenuContext);

  useEffect(() => {
    if (selectCtx && value !== undefined) {
      selectCtx.registerOption(value, children);
    }
  }, [selectCtx, value, children]);

  const isSelected = selected || (selectCtx && selectCtx.value === value);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (selectCtx && value !== undefined) {
      selectCtx.onSelect(value);
    }
    onClick?.(e);
    if (menuCtx && menuCtx.onClose) {
      menuCtx.onClose();
    }
  };

  return (
    <div
      ref={ref}
      role="option"
      aria-selected={isSelected}
      aria-disabled={disabled}
      onClick={handleClick}
      className={cn(
        'relative flex cursor-pointer select-none items-center rounded-sm text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 rt-menu-item',
        selectCtx?.compact || dense ? 'px-2 py-1 text-xs' : 'px-2.5 py-1.5 text-sm',
        isSelected && 'bg-accent/60 font-medium text-accent-foreground',
        disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent',
        className
      )}
      style={{ ...(style || {}), ...(sx || {}) }}
      {...props}
    >
      {children}
    </div>
  );
});

export default Menu;
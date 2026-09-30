// ─────────────────────────────────────────────────────────────────────────────
// AuditExportMenu — shared export dropdown for every audit tool.
//
// One menu shell (shadcn Menu + MenuItemBase + ListItemIcon/ListItemText,
// Tailwind only, no sx): the trigger button stays with the caller, the menu
// items come in as data. Used by the video-audit report header and the public
// (channel) audit hero — add new formats by adding items, not new menus.
// ─────────────────────────────────────────────────────────────────────────────
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { ListItemIcon, ListItemText, Menu, MenuItemBase } from '../ui';

export interface AuditExportMenuItem {
  key: string;
  /** e.g. "PDF — selectable text". */
  label: string;
  /** Optional second line, e.g. "Copyable text, smaller file". */
  hint?: string;
  icon: ReactNode;
  /** Token color for the icon, e.g. 'text-[var(--rt-color-accent)]'. */
  iconClassName?: string;
  disabled?: boolean;
  onSelect: () => void;
}

export function AuditExportMenu({
  anchorEl,
  onClose,
  items,
}: {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  items: AuditExportMenuItem[];
}) {
  return (
    <Menu
      anchorEl={anchorEl}
      open={Boolean(anchorEl)}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
    >
      {items.map((item) => (
        <MenuItemBase
          key={item.key}
          disabled={item.disabled}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
          className="text-xs"
        >
          <ListItemIcon className={cn('shrink-0', item.iconClassName ?? 'text-[var(--rt-color-accent)]')}>
            {item.icon}
          </ListItemIcon>
          <ListItemText primary={item.label} secondary={item.hint} />
        </MenuItemBase>
      ))}
    </Menu>
  );
}

import React from 'react';
import { Button } from '../ui';
import { PageHeader } from '../PageHeader';
import { cn } from '@/lib/utils';

/**
 * Shared page shell for the audit tools (Public Audit, Thumbnail Optimizer,
 * Playlist Optimizer, Video Audit, Channel Audit).
 *
 * Title band is the shared Goals-style `PageHeader` (icon + title + subtitle
 * left, help/actions right); tab rail + alerts + body below. Tailwind CSS +
 * shadcn primitives only — no custom CSS, all color from `--rt-*` tokens.
 */
interface AuditToolTabItem {
  value: string;
  label: string;
  count?: number | string;
  icon?: React.ReactNode;
}

interface AuditToolShellProps {
  /** Page title, e.g. "Thumbnail Optimizer". */
  title: string;
  /** One-line description under the title (sentence case). */
  description: string;
  /** Accent leading icon in the title band (sized ~20 by the caller). */
  icon?: React.ReactNode;
  /** Right-side header actions (guide button, export menu, etc.). */
  actions?: React.ReactNode;
  /** Optional (?) help tooltip content, rendered ahead of actions. */
  helpText?: React.ReactNode;
  /** Optional alert or warning message banner slot rendered above body. */
  alerts?: React.ReactNode;
  /** Left-aligned underline tab rail. */
  tabs?: {
    items: AuditToolTabItem[];
    value: string;
    onChange: (value: string) => void;
    ariaLabel?: string;
  };
  children: React.ReactNode;
}

export const AuditToolShell: React.FC<AuditToolShellProps> = ({
  title,
  description,
  icon,
  actions,
  helpText,
  alerts,
  tabs,
  children,
}) => {
  return (
    <div className="flex min-w-0 flex-col gap-5 overflow-x-clip">
      <PageHeader
        icon={icon}
        title={title}
        subtitle={description}
        actions={actions}
        helpText={helpText}
      />
      {tabs && (
        <nav
          aria-label={tabs.ariaLabel || 'Audit tool views'}
          className="w-full min-w-0 border-b border-[var(--rt-color-border)]"
        >
          <div role="tablist" className="flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto px-1 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {tabs.items.map((tab) => {
              const isActive = tabs.value === tab.value;
              return (
                <Button
                  key={tab.value}
                  bare
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => tabs.onChange(tab.value)}
                  className={cn(
                    'relative flex shrink-0 items-center gap-2 rounded-t-[var(--rt-radius-sm)] px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'text-[var(--rt-color-accent)] after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-[var(--rt-color-accent)]'
                      : 'text-[var(--rt-color-text-secondary)] hover:bg-[var(--rt-color-bg-subtle)] hover:text-[var(--rt-color-text)]',
                  )}
                >
                  {tab.icon && <span className="inline-flex items-center">{tab.icon}</span>}
                  <span className="truncate">{tab.label}</span>
                  {tab.count !== undefined && (
                    <span
                      className={cn(
                        'inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full px-1 text-xs font-bold',
                        isActive
                          ? 'bg-[var(--rt-color-accent-muted)] text-[var(--rt-color-accent)]'
                          : 'bg-[var(--rt-color-bg-muted)] text-[var(--rt-color-text-secondary)]',
                      )}
                    >
                      {tab.count}
                    </span>
                  )}
                </Button>
              );
            })}
          </div>
        </nav>
      )}
      {alerts && <div className="flex min-w-0 flex-col gap-3">{alerts}</div>}
      {children}
    </div>
  );
};

export default AuditToolShell;

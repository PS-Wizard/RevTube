// ─────────────────────────────────────────────────────────────────────────────
// AuditToolBody — shared content column for every audit-tool page.
//
// Centers tool content on a comfortable measure inside the wide .content-area
// (dashboard rhythm), with horizontal gutters + bottom breathing room.
// Replaces the legacy `.audit-tool-body` CSS class: Tailwind + tokens only.
// ─────────────────────────────────────────────────────────────────────────────
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function AuditToolBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'mx-auto box-border w-full min-w-0 max-w-[min(var(--rt-shell-content-max-width),100%)] px-5 pb-8 max-md:px-3 max-md:pb-6',
        className,
      )}
    >
      {children}
    </div>
  );
}

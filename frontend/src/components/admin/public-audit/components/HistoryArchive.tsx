// ─────────────────────────────────────────────────────────────────────────────
// HistoryArchive — saved channel-audit reports: open, rename inline, delete.
// Thin wrapper over the shared SearchableHistoryList + Tailwind only.
// ─────────────────────────────────────────────────────────────────────────────
import { cn } from '@/lib/utils';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../ui';
import { SearchableHistoryList } from '../../../SearchableHistoryList';
import { deletePublicAudit } from '../../../../services/publicAuditService';
import { PAGE_SIZE, formatDate, scoreBadgeClasses } from '../publicAuditUtils';
import type { PublicAuditListItem } from '../../../../services/publicAuditService';

interface HistoryArchiveProps {
  fetchHistory: (p: { page: number; search?: string }) => Promise<{ items: PublicAuditListItem[]; total: number }>;
  openingId: number | null;
  historyVersion: number;
  onOpen: (item: PublicAuditListItem) => void;
  onRename: (id: string | number, name: string) => Promise<unknown> | void;
}

export function HistoryArchive({ fetchHistory, openingId, historyVersion, onOpen, onRename }: HistoryArchiveProps) {
  return (
    <Card className="border-[var(--rt-color-border)] shadow-sm bg-[var(--rt-color-bg-elevated)]">
      <CardHeader className="pb-3 border-b border-[var(--rt-color-border)]">
        <CardTitle className="text-sm font-bold text-[var(--rt-color-text)]">
          Saved Channel Audit Reports
        </CardTitle>
        <CardDescription className="text-xs text-[var(--rt-color-text-secondary)]">
          Your saved channel audits. Open any past report to review it, or remove reports you no longer need.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <SearchableHistoryList<PublicAuditListItem>
          fetchItems={fetchHistory}
          getKey={(item) => item.id}
          renderName={(item) => (
            <span className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate text-xs font-medium text-[var(--rt-color-text)] sm:text-sm">
                {item.channelTitle || item.channelInput}
              </span>
              <Badge
                variant="outline"
                className={cn('shrink-0 px-1.5 py-0 text-[10px] font-bold tabular-nums', scoreBadgeClasses(item.overall))}
              >
                {item.overall ?? '—'}/100
              </Badge>
            </span>
          )}
          renderMeta={(item) => (
            <span className="block truncate text-[11px] text-[var(--rt-color-text-tertiary)]">
              {`${item.channelInput} · ${item.videoCount} video${item.videoCount === 1 ? '' : 's'} · ${formatDate(
                item.createdAt,
              )}${item.createdByEmail ? ` · ${item.createdByEmail}` : ''}`}
            </span>
          )}
          onLoad={onOpen}
          onDelete={async (id) => {
            await deletePublicAudit(Number(id));
          }}
          getName={(item) => item.channelTitle || item.channelInput}
          onRename={onRename}
          loadingId={openingId}
          refreshKey={historyVersion}
          pageSize={PAGE_SIZE}
          emptyText="No channel audits saved yet. Run an audit above and it will appear here."
          deleteTitle="Delete this saved channel audit?"
        />
      </CardContent>
    </Card>
  );
}

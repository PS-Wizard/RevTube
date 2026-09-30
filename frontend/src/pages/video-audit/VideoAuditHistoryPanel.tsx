// ─────────────────────────────────────────────────────────────────────────────
// Video Audit -- History panel (search + tap-to-open, mirrors optimizer panels)
// ─────────────────────────────────────────────────────────────────────────────
import { Box } from '../../components/ui';
import { SearchableHistoryList } from '../../components/SearchableHistoryList';
import { getVideoAuditHistory, renameVideoAuditHistory } from '../../services/videoAuditService';
import type { VideoAuditHistoryItem } from '../../types/videoAudit';

interface Props {
  onLoad: (id: number) => void;
  onDelete: (id: number) => Promise<void> | void;
  loadingSaved?: number | null;
  refreshKey?: number;
  /** Hide delete/rename controls (read-only org members). */
  readOnly?: boolean;
}

export function VideoAuditHistoryPanel({ onLoad, onDelete, loadingSaved, refreshKey = 0, readOnly = false }: Props) {
  return (
    <SearchableHistoryList<VideoAuditHistoryItem>
      fetchItems={({ page, search }) => getVideoAuditHistory({ page, search, limit: 10 })}
      getKey={(item) => item.id}
      renderName={(item) => item.name || `Video Audit #${item.id}`}
      renderMeta={(item) => (
        <>
          {item.channelTitle && (
            <Box component="span" sx={{ fontSize: 'var(--rt-text-xs)', color: 'var(--rt-color-text-tertiary)' }}>
              {item.channelTitle}
            </Box>
          )}
          <Box component="span" sx={{ fontSize: 'var(--rt-text-xs)', color: 'var(--rt-color-text-tertiary)' }}>
            · {new Date(item.createdAt).toLocaleString()}
          </Box>
        </>
      )}
      onLoad={(item) => onLoad(item.id)}
      onDelete={(id) => onDelete(Number(id))}
      onRename={(id, name) => renameVideoAuditHistory(Number(id), name)}
      getName={(item) => item.name || `Video Audit #${item.id}`}
      loadingId={loadingSaved ?? null}
      refreshKey={refreshKey}
      readOnly={readOnly}
      emptyText="Run a video audit and it will be auto-saved here for later reference."
      deleteTitle="Delete this saved video audit?"
    />
  );
}

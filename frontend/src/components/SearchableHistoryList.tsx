// ─────────────────────────────────────────────────────────────────────────────
// SearchableHistoryList -- Reusable saved-audit history list with search,
// tap-to-open, pagination, and delete confirmation.
//
// Tailwind CSS + shadcn primitives (Input, Button, IconButton, Pagination,
// Dialog, Typography). Spacing scale: root `flex-col gap-4`, toolbar
// `gap-2 sm:gap-3`, rows `px-3 py-2.5 gap-2`. No `rt-history-*` classes,
// no Box/Flex/Stack shims, no raw hex — tokens via `--rt-*`.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  Button,
  IconButton,
  Input,
  Pagination,
  Dialog,
  DialogTitle,
  DialogBody,
  DialogActions,
  Typography,
} from './ui';
import { Trash2, Search, Pencil, Check, X, RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Skeleton } from './Skeleton';
import { EmptyState } from './EmptyState';

export interface HistoryPage<T> {
  items: T[];
  total: number;
}

interface Props<T> {
  fetchItems: (p: { page: number; search?: string }) => Promise<HistoryPage<T>>;
  getKey: (item: T) => string | number;
  renderName: (item: T) => ReactNode;
  renderMeta?: (item: T) => ReactNode;
  onLoad: (item: T) => void;
  onDelete: (id: string | number) => Promise<void> | void;
  onRename?: (id: string | number, name: string) => Promise<unknown> | void;
  getName?: (item: T) => string;
  loadingId?: string | number | null;
  refreshKey?: number;
  pageSize?: number;
  emptyText?: string;
  deleteTitle?: string;
  /** Hide delete/rename controls (used for read-only org members). */
  readOnly?: boolean;
}

export function SearchableHistoryList<T>({
  fetchItems,
  getKey,
  renderName,
  renderMeta,
  onLoad,
  onDelete,
  onRename,
  getName,
  loadingId,
  refreshKey = 0,
  pageSize = 10,
  emptyText = 'No saved audits yet.',
  deleteTitle = 'Delete saved audit?',
  readOnly = false,
}: Props<T>) {
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string | number; key: string | number } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [editKey, setEditKey] = useState<string | number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [savingName, setSavingName] = useState(false);
  const queryClient = useQueryClient();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchItems({ page, search: search.trim() || undefined });
      setItems(res.items);
      setTotal(res.total);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [fetchItems, page, search]);

  useEffect(() => {
    // setState lands here on purpose: the spinner must be up before the
    // (prop-driven) fetch starts, and there is no event handler to hook into.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, refreshKey]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
    setPage(1);
  };

  // Hard refresh: invalidate any cached audit/history query data (TanStack
  // Query) so dependent UI refetches, then re-fetch this list from the API.
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ['history'] });
      await queryClient.invalidateQueries({ queryKey: ['audit'] });
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load, queryClient]);

  const startEdit = (item: T) => {
    const key = getKey(item);
    setEditKey(key);
    setEditValue(getName ? getName(item) : String(renderName(item)));
  };

  const cancelEdit = () => {
    setEditKey(null);
    setEditValue('');
  };

  const handleConfirmRename = async () => {
    if (editKey === null) return;
    const trimmed = editValue.trim();
    if (!trimmed) return;
    setSavingName(true);
    try {
      await onRename?.(editKey, trimmed);
      cancelEdit();
      load();
    } finally {
      setSavingName(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      await onDelete(deleteConfirm.id);
      setDeleteConfirm(null);
      load();
    } finally {
      setDeleting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      {/* Toolbar: search + refresh — wraps on mobile, single row on sm+ */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="min-w-0 flex-1 sm:max-w-md">
          <Input
            value={search}
            onChange={handleSearchChange}
            placeholder="Search saved audits..."
            aria-label="Search saved audits"
            startAdornment={<Search size={16} aria-hidden />}
            clearable
            onClear={() => {
              setSearch('');
              setPage(1);
            }}
            compact
            className="h-9 text-sm"
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          startIcon={<RefreshCw size={14} aria-hidden className={refreshing ? 'animate-spin' : undefined} />}
          onClick={() => void handleRefresh()}
          disabled={loading || refreshing}
          title="Hard refresh (clear cache and re-fetch)"
          aria-label="Refresh history"
          className="shrink-0 self-start sm:self-auto"
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2 py-4">
          <Skeleton height={56} />
          <Skeleton height={56} />
          <Skeleton height={56} />
        </div>
      ) : error ? (
        <EmptyState
          variant="error"
          title="Failed to Load History"
          description={error}
        />
      ) : items.length === 0 ? (
        <EmptyState
          variant={search ? 'no-results' : 'zero'}
          title={search ? 'No Matching History' : 'No History Yet'}
          description={search ? 'No saved audits match your search.' : emptyText}
        />
      ) : (
        <div className="flex min-w-0 flex-col gap-2">
          <Typography variant="caption" className="text-[var(--rt-color-text-tertiary)]">
            {total} saved audit(s)
          </Typography>
          <ul className="flex min-w-0 flex-col divide-y divide-[var(--rt-color-border)] overflow-hidden rounded-[var(--rt-radius-md)] border border-[var(--rt-color-border)] bg-[var(--rt-color-bg-elevated)]">
            {items.map((item) => {
              const key = getKey(item);
              const isEditing = editKey === key;
              return (
                <li
                  key={key}
                  className="flex min-w-0 items-center gap-2 px-3 py-2.5 transition-colors hover:bg-[var(--rt-color-bg-subtle)]"
                >
                  {isEditing ? (
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <Input
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void handleConfirmRename();
                            if (e.key === 'Escape') cancelEdit();
                          }}
                          aria-label="Rename saved audit"
                          compact
                          className="h-8 text-sm"
                        />
                      </div>
                      <IconButton
                        size="xs"
                        variant="primary"
                        onClick={() => void handleConfirmRename()}
                        disabled={savingName}
                        aria-label="Save name"
                        className="shrink-0"
                      >
                        <Check size={14} />
                      </IconButton>
                      <IconButton
                        size="xs"
                        variant="ghost"
                        onClick={cancelEdit}
                        disabled={savingName}
                        aria-label="Cancel rename"
                        className="shrink-0 text-[var(--rt-color-text-tertiary)]"
                      >
                        <X size={14} />
                      </IconButton>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => onLoad(item)}
                        disabled={loadingId === key}
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-[var(--rt-radius-sm)] px-1 py-0.5 text-left transition-colors hover:bg-[var(--rt-color-bg-muted)] disabled:cursor-wait disabled:opacity-60"
                      >
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="min-w-0 truncate text-xs font-medium text-[var(--rt-color-text)] sm:text-sm">
                            {renderName(item)}
                          </span>
                          {renderMeta && (
                            <span className="min-w-0 truncate text-[11px] text-[var(--rt-color-text-tertiary)]">
                              {renderMeta(item)}
                            </span>
                          )}
                        </span>
                        {loadingId === key && (
                          <span
                            className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[var(--rt-color-border)] border-t-[var(--rt-color-accent)]"
                            aria-label="Loading audit"
                          />
                        )}
                      </button>
                      {!readOnly && (
                        <span className="flex shrink-0 items-center gap-1">
                          {onRename && (
                            <IconButton
                              size="xs"
                              variant="ghost"
                              onClick={() => startEdit(item)}
                              aria-label="Rename saved audit"
                              className="text-[var(--rt-color-text-tertiary)] hover:text-[var(--rt-color-text)]"
                            >
                              <Pencil size={14} />
                            </IconButton>
                          )}
                          <IconButton
                            size="xs"
                            variant="ghost"
                            onClick={() => setDeleteConfirm({ key, id: key })}
                            aria-label="Delete saved audit"
                            className="text-[var(--rt-color-text-tertiary)] hover:text-[var(--rt-color-danger)]"
                          >
                            <Trash2 size={14} />
                          </IconButton>
                        </span>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>

          {totalPages > 1 && (
            <div className="flex justify-center pt-1">
              <Pagination
                count={totalPages}
                page={page}
                onChange={(_, p) => setPage(p)}
                size="small"
              />
            </div>
          )}
        </div>
      )}

      <Dialog open={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} maxWidth="xs">
        <DialogTitle>{deleteTitle}</DialogTitle>
        <DialogBody>
          <Typography variant="body2" component="p" className="text-[var(--rt-color-text-secondary)]">
            This action cannot be undone. The saved audit will be permanently removed.
          </Typography>
        </DialogBody>
        <DialogActions>
          <Button variant="secondary" size="sm" onClick={() => setDeleteConfirm(null)} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={handleConfirmDelete} disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}

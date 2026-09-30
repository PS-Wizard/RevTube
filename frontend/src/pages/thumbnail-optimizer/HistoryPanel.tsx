// ─────────────────────────────────────────────────────────────────────────────
// HistoryPanel -- Past saved thumbnail audits
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Button,
  Typography,
  Spinner,
  TextField,
  InputAdornment,
  List,
  ListItem,
  ListItemText,
  ListItemButton,
  IconButton,
  Chip,
  Pagination,
  DialogTitle,
  DialogBody,
  DialogActions,
} from '../../components/ui';
import { OptimizerDialog } from './OptimizerDialog';
import { Clock, Trash2, Search, RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { ThumbnailOptimizerService } from '../../services/thumbnailOptimizerService';
import type { SavedAuditSummary } from '../../types/thumbnailOptimizer';

import { EmptyState } from '../../components/EmptyState';

const PAGE_SIZE = 10;


interface HistoryPanelProps {
  onLoadAudit: (id: number) => void;
  loadingId?: number | null;
  /** When true, hide delete actions (read-only org members can still view history). */
  readOnly?: boolean;
}

export const HistoryPanel: React.FC<HistoryPanelProps> = ({ onLoadAudit, loadingId, readOnly = false }) => {
  const [items, setItems] = useState<SavedAuditSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const queryClient = useQueryClient();

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await ThumbnailOptimizerService.history({
        limit: PAGE_SIZE,
        page,
        search: search || undefined,
      });
      setItems(result.items);
      setTotal(result.total);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Hard refresh: invalidate cached audit/history query data so dependent UI
  // refetches, then re-fetch this list from the API.
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ['history'] });
      await queryClient.invalidateQueries({ queryKey: ['audit'] });
      await fetchHistory();
    } finally {
      setRefreshing(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await ThumbnailOptimizerService.deleteHistory(id);
      setDeleteConfirm(null);
      fetchHistory();
    } catch {
      // ignore
    }
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Box>
      {/* Search bar */}
      <TextField
        fullWidth
        size="small"
        placeholder="Search saved audits..."
        value={search}
        onChange={handleSearchChange}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <Search size={16} />
              </InputAdornment>
            ),
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  size="small"
                  onClick={handleRefresh}
                  disabled={refreshing}
                  title="Hard refresh (clear cache and re-fetch)"
                  aria-label="Refresh history"
                >
                  <RefreshCw size={14} className={refreshing ? 'rt-spin' : undefined} />
                </IconButton>
              </InputAdornment>
            ),
          },
        }}
        sx={{ mb: 2, fontSize: 'var(--rt-text-sm)' }}
      />

      {/* Content */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <Spinner size={24} />
        </Box>
      ) : error ? (
        <EmptyState
          variant="error"
          title="Failed to Load History"
          description={error}
        />
      ) : items.length === 0 ? (
        <EmptyState
          variant={search ? 'no-results' : 'zero'}
          title={search ? 'No Matching Audits' : 'No Saved Audits'}
          description={search ? 'No audits match your search.' : 'No saved audits yet. Run an audit and save it!'}
        />
      ) : (
        <>
          <Typography variant="caption" sx={{ color: 'var(--rt-color-text-muted)', mb: 1, display: 'block' }}>
            {total} audit(s)
          </Typography>
          <List dense sx={{ bgcolor: 'var(--rt-color-bg-subtle)', borderRadius: 'var(--rt-radius-md)' }}>
            {items.map((item) => (
              <ListItem
                key={item.id}
                disablePadding
                secondaryAction={
                  readOnly ? undefined : (
                    <IconButton
                      edge="end"
                      size="small"
                      onClick={() => setDeleteConfirm(item.id)}
                      sx={{ color: 'var(--rt-color-text-muted)', '&:hover': { color: 'var(--rt-color-danger)' } }}
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  )
                }
              >
                <ListItemButton
                  onClick={() => onLoadAudit(item.id)}
                  disabled={loadingId === item.id}
                  sx={{ borderRadius: 'var(--rt-radius-sm)' }}
                >
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 'var(--rt-text-sm)', fontWeight: 'var(--rt-weight-semibold)' }}>
                          {item.name}
                        </span>
                        {item.hasErrors && (
                          <Chip
                            label="errors"
                            size="small"
                            color="warning"
                            variant="outlined"
                            sx={{ height: 18, fontSize: 'var(--rt-text-xs)' }}
                          />
                        )}
                      </Box>
                    }
                    secondary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mt: 0.25 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 'var(--rt-text-xs)' }}>
                          <Clock size={11} />
                          {item.createdAt ? new Date(item.createdAt).toLocaleDateString() : 'Unknown'}
                        </span>
                        {item.channelTitle && (
                          <Chip
                            label={item.channelTitle}
                            size="small"
                            variant="outlined"
                            sx={{ height: 18, fontSize: 'var(--rt-text-xs)' }}
                          />
                        )}
                        <Chip
                          label={`${item.totalVideos} video(s)`}
                          size="small"
                          sx={{ height: 18, fontSize: 'var(--rt-text-xs)' }}
                        />
                      </Box>
                    }
                  />
                  {loadingId === item.id && (
                    <Spinner size={16} sx={{ ml: 1 }} />
                  )}
                </ListItemButton>
              </ListItem>
            ))}
          </List>

          {totalPages > 1 && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
              <Pagination
                count={totalPages}
                page={page}
                onChange={(_, p) => setPage(p)}
                size="small"
                sx={{
                  '& .MuiPaginationItem-root': {
                    fontSize: 'var(--rt-text-xs)',
                  },
                }}
              />
            </Box>
          )}
        </>
      )}

      {/* Delete confirmation dialog */}
      <OptimizerDialog
        open={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        maxWidth="xs"
      >
        <DialogTitle sx={{ fontSize: 'var(--rt-text-md)', fontWeight: 'var(--rt-weight-bold)' }}>
          Delete Audit?
        </DialogTitle>
        <DialogBody>
          <Typography variant="body2" sx={{ color: 'var(--rt-color-text-secondary)' }}>
            This action cannot be undone. The audit will be permanently removed.
          </Typography>
        </DialogBody>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)} variant="ghost">
            Cancel
          </Button>
          <Button
            onClick={() => deleteConfirm !== null && handleDelete(deleteConfirm)}
            color="error"
            variant="contained"
          >
            Delete
          </Button>
        </DialogActions>
      </OptimizerDialog>
    </Box>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// PlaylistHistoryPanel -- Past saved playlist analyses
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
  Dialog,
  DialogTitle,
  DialogBody,
  DialogActions,
} from '../../components/ui';
import { Clock, Trash2, Search, AlertCircle, History, RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { PlaylistOptimizerService } from '../../services/playlistOptimizerService';
import type { HistoryItem } from '../../types/playlistOptimizer';

const PAGE_SIZE = 10;

interface PlaylistHistoryPanelProps {
  onLoadAnalysis: (id: number) => void;
  loadingId?: number | null;
  /** When true, hide delete actions (read-only org members can still view history). */
  readOnly?: boolean;
}

export const PlaylistHistoryPanel: React.FC<PlaylistHistoryPanelProps> = ({ onLoadAnalysis, loadingId, readOnly = false }) => {
  const [items, setItems] = useState<HistoryItem[]>([]);
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
      const result = await PlaylistOptimizerService.history({
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
      await PlaylistOptimizerService.deleteHistory(id);
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
        placeholder="Search saved analyses..."
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
        sx={{
          mb: 2,
          '& .MuiOutlinedInput-root': {
            fontSize: 'var(--rt-text-sm)',
            backgroundColor: 'var(--rt-color-bg-subtle)',
            borderRadius: 'var(--rt-radius-md)',
          },
        }}
      />

      {/* Content */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <Spinner size={24} />
        </Box>
      ) : error ? (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            p: 2,
            borderRadius: 'var(--rt-radius-md)',
            bgcolor: '#fef2f2',
            color: '#991b1b',
            fontSize: 'var(--rt-text-sm)',
          }}
        >
          <AlertCircle size={16} style={{ flexShrink: 0 }} />
          <span>{error}</span>
        </Box>
      ) : items.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 4, color: 'var(--rt-color-text-muted)' }}>
          <History size={32} style={{ margin: '0 auto 8px', opacity: 0.5 }} />
          <Typography variant="body2">
            {search ? 'No saved analyses match your search.' : 'No saved analyses yet. Run an analysis and save it!'}
          </Typography>
        </Box>
      ) : (
        <>
          <Typography variant="caption" sx={{ color: 'var(--rt-color-text-muted)', mb: 1, display: 'block' }}>
            {total} analysis(es)
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
                  onClick={() => onLoadAnalysis(item.id)}
                  disabled={loadingId === item.id}
                  sx={{ borderRadius: 'var(--rt-radius-sm)' }}
                >
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 'var(--rt-text-sm)', fontWeight: 'var(--rt-weight-semibold)' }}>
                          {item.name || 'Untitled Analysis'}
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
      <Dialog
        open={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        maxWidth="xs"
      >
        <DialogTitle sx={{ fontSize: 'var(--rt-text-md)', fontWeight: 'var(--rt-weight-bold)' }}>
          Delete Analysis?
        </DialogTitle>
        <DialogBody>
          <Typography variant="body2" sx={{ color: 'var(--rt-color-text-secondary)' }}>
            This action cannot be undone. The analysis will be permanently removed.
          </Typography>
        </DialogBody>
        <DialogActions>
          <Button
            onClick={() => setDeleteConfirm(null)}
            sx={{ textTransform: 'none', color: 'var(--rt-color-text-secondary)' }}
          >
            Cancel
          </Button>
          <Button
            onClick={() => deleteConfirm !== null && handleDelete(deleteConfirm)}
            color="error"
            variant="contained"
            sx={{ textTransform: 'none' }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import type { PlaylistMetadata } from '../../types/youtube';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  type SortingState,
  type ColumnDef,
  type PaginationState,
  type Row,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import '../VideoTable.css'; // Reuse existing table styles
import { normalizePrivacyStatus } from '../../utils/dashboardUtils';
import { Button } from '../ui';
import { EmptyState } from '../EmptyState';
import { DropdownHeader, DropdownItem, DropdownList, DropdownPanel, DropdownTitle, DropdownTrigger } from '../ui';

interface PlaylistTableProps {
  playlists: PlaylistMetadata[];
  /** Channel-level playlist truth (backend catalog total).
   *  When larger than the visible rows, the subtitle reads "N of M playlists"
   *  instead of claiming the visible slice is the total. The gap covers active
   *  filters; not-yet-loaded backend pages are reported separately via
   *  hasMoreBackend (see the "more in catalog" hint). */
  totalCount?: number;
  isLoading?: boolean;
  /** Refetch playlists (empty state / recovery) */
  onRetryLoad?: () => void | Promise<void>;
  onExportCSV?: () => void;
  activeRangeLabel?: string;
  // Row-level checkboxes for analytics filtering
  checkedPlaylistIds?: Set<string>;
  onCheckedPlaylistsChange?: (ids: Set<string>) => void;
  /** Backend catalog pagination -- Next on the last client page fetches more (no separate Load-more button) */
  hasMoreBackend?: boolean;
  onLoadMoreBackend?: () => void | Promise<void>;
  isLoadingMoreBackend?: boolean;
  totalBackendCount?: number;
  /** "Select all" with unloaded backend pages -- drains the catalog, then selects everything */
  onSelectAllCatalog?: () => void | Promise<void>;
  /** Last load failure message (query error). Shown in the empty state so a
   *  failed fetch is distinguishable from a genuinely empty catalog. */
  loadError?: string | null;
  /** Set when rows are a public-only substitution (private-inclusive leg
   *  failed/empty). Rendered as a warning badge so a subset is never mistaken
   *  for the whole catalog. */
  partialNotice?: string | null;
}

// Sentinel pageSize meaning "show all loaded rows". Large enough that TanStack
// reports a single client page; the auto-fetch effect keeps loading backend
// pages until the catalog is exhausted while this is selected.
const SHOW_ALL_PAGE_SIZE = 1000000;

export const PlaylistTable: React.FC<PlaylistTableProps> = ({
  playlists,
  totalCount,
  isLoading = false,
  onRetryLoad,
  onExportCSV,
  activeRangeLabel = 'Current Range',
  checkedPlaylistIds: externalCheckedPlaylistIds,
  onCheckedPlaylistsChange,
  hasMoreBackend = false,
  onLoadMoreBackend,
  isLoadingMoreBackend = false,
  totalBackendCount,
  onSelectAllCatalog,
  loadError = null,
  partialNotice = null,
}) => {
  const computedPlaylists = useMemo(
    () =>
      playlists.map((playlist) => ({
        ...playlist,
        publishedAtLabel: playlist.publishedAt ? new Date(playlist.publishedAt).toLocaleDateString() : '-',
        periodViewsValue: playlist.periodViewCount ?? 0,
      })),
    [playlists]
  );

  const [sorting, setSorting] = useState<SortingState>([{ id: 'periodViewCount', desc: true }]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });
  const tableWrapperRef = useRef<HTMLDivElement>(null);
  
  const [showDimensionsDropdown, setShowDimensionsDropdown] = useState(false);
  const [showMetricsDropdown, setShowMetricsDropdown] = useState(false);
  const [selectedDimensions, setSelectedDimensions] = useState<Set<string>>(new Set(['thumbnailUrl', 'title', 'visibility', 'publishedAt', 'lastVideoPublishedAt']));
  const [selectedMetrics, setSelectedMetrics] = useState<Set<string>>(new Set(['itemCount', 'periodViewCount', 'videoPeriodViewCount']));

  // Internal checked state -- default all checked (controlled externally if prop provided)
  const [internalCheckedPlaylistIds, setInternalCheckedPlaylistIds] = useState<Set<string>>(
    () => new Set(playlists.map(p => p.id))
  );

  const playlistIdsSignature = useMemo(
    () => computedPlaylists.map(p => p.id).sort().join('\0'),
    [computedPlaylists]
  );

  // When playlists list changes, add newly appeared playlists as checked by default
  useEffect(() => {
    if (externalCheckedPlaylistIds !== undefined) return;
    setInternalCheckedPlaylistIds(prev => {
      const next = new Set(prev);
      computedPlaylists.forEach(p => {
        if (!next.has(p.id)) next.add(p.id); // new playlist → default checked
      });
      next.forEach(id => {
        if (!computedPlaylists.some(p => p.id === id)) next.delete(id);
      });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlistIdsSignature, externalCheckedPlaylistIds]);

  const checkedPlaylistIds = externalCheckedPlaylistIds ?? internalCheckedPlaylistIds;

  const handleCheckPlaylist = useCallback((playlistId: string, checked: boolean) => {
    const next = new Set(checkedPlaylistIds);
    if (checked) next.add(playlistId); else next.delete(playlistId);
    if (onCheckedPlaylistsChange) onCheckedPlaylistsChange(next);
    else setInternalCheckedPlaylistIds(next);
  }, [checkedPlaylistIds, onCheckedPlaylistsChange]);

  const allChecked = computedPlaylists.length > 0 && computedPlaylists.every(p => checkedPlaylistIds.has(p.id));
  const someChecked = !allChecked && computedPlaylists.some(p => checkedPlaylistIds.has(p.id));

  const handleCheckAll = useCallback((checked: boolean) => {
    const next = checked ? new Set(computedPlaylists.map(p => p.id)) : new Set<string>();
    if (onCheckedPlaylistsChange) onCheckedPlaylistsChange(next);
    else setInternalCheckedPlaylistIds(next);
    // "Select all" means the whole catalog: when backend pages are still
    // unloaded, drain them first (the caller then selects everything).
    if (checked && hasMoreBackend && onSelectAllCatalog) {
      void onSelectAllCatalog();
    }
  }, [computedPlaylists, onCheckedPlaylistsChange, hasMoreBackend, onSelectAllCatalog]);

  const dimensionOptions = [
    { id: 'thumbnailUrl', label: 'Thumbnail' },
    { id: 'title', label: 'Playlist Title' },
    { id: 'visibility', label: 'Visibility' },
    { id: 'publishedAt', label: 'Published Date' },
    { id: 'lastVideoPublishedAt', label: 'Last Video Added' },
  ];

  const metricOptions = [
    { id: 'itemCount', label: 'Videos' },
    { id: 'periodViewCount', label: 'Views from Playlist' },
    { id: 'videoPeriodViewCount', label: 'Video Views' },
  ];

  // Keep the page index valid when the row set changes. Clamp instead of
  // resetting: progressive page loads (25 -> 50 -> 67 rows) must not bounce
  // the user back to page 1 mid-click -- only drop to first page when the
  // current page no longer exists (e.g. a filter shrank 9 pages to 1).
  // (TanStack's own autoResetPageIndex is disabled below for the same reason.)
  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(computedPlaylists.length / pagination.pageSize) - 1);
    setPagination((prev) => (prev.pageIndex > maxPage ? { ...prev, pageIndex: 0 } : prev));
  }, [computedPlaylists.length, pagination.pageSize]);

  const columnDefs = useMemo<ColumnDef<PlaylistMetadata>[]>(() => {
    const cols: ColumnDef<PlaylistMetadata>[] = [];
    
    // Add checkbox column first
    cols.push({
      id: 'checkbox',
      header: () => (
        <input
          type="checkbox"
          className="row-checkbox"
          checked={allChecked}
          ref={el => { if (el) el.indeterminate = someChecked; }}
          onChange={e => handleCheckAll(e.target.checked)}
          title="Select all"
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          className="row-checkbox"
          checked={checkedPlaylistIds.has(row.original.id)}
          onChange={e => handleCheckPlaylist(row.original.id, e.target.checked)}
        />
      ),
      size: 56,
    });
    
    if (selectedDimensions.has('thumbnailUrl')) {
      cols.push({
        id: 'thumbnail',
        header: 'Thumbnail',
        accessorKey: 'thumbnailUrl',
        cell: info => (
          <img 
            src={info.getValue() as string} 
            alt="Playlist" 
            style={{ width: '120px', borderRadius: '4px', aspectRatio: '16/9', objectFit: 'cover' }} 
            referrerPolicy="no-referrer"
          />
        ),
      });
    }

    if (selectedDimensions.has('title')) {
      cols.push({
        id: 'title',
        header: 'Playlist Title',
        accessorKey: 'title',
        cell: info => {
          const playlist = info.row.original;
          return (
            <div className="title-cell">
              <a
                href={`https://www.youtube.com/playlist?list=${playlist.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="title-link"
                title={playlist.title}
              >
                {playlist.title}
              </a>
              {playlist.privacyStatus && playlist.privacyStatus !== 'public' && (
                <span
                  title={`This playlist is ${playlist.privacyStatus} and is hidden from the public. Use the Visibility filter to include it.`}
                  style={{
                    marginLeft: 6,
                    fontSize: '0.72em',
                    padding: '1px 7px',
                    borderRadius: 999,
                    verticalAlign: 'middle',
                    border: '1px solid var(--rt-border, var(--rt-border-color, currentColor))',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {playlist.privacyStatus}
                </span>
              )}
              {playlist.description && (
                <p className="description-cell" style={{ margin: '2px 0 0', fontSize: 'var(--rt-table-font-size)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {playlist.description}
                </p>
              )}
            </div>
          );
        },
      });
    }

    if (selectedDimensions.has('visibility')) {
      cols.push({
        id: 'visibility',
        header: 'Visibility',
        accessorKey: 'privacyStatus',
        cell: info => {
          const raw = info.getValue() as string | undefined;
          const status = normalizePrivacyStatus(raw);
          const label = status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';
          const cls = !status ? 'unknown' : status === 'private' ? 'private' : status === 'unlisted' ? 'unlisted' : 'public';
          return (
            <span className={`status-badge ${cls}`}>
              {label}
            </span>
          );
        },
      });
    }

    if (selectedMetrics.has('itemCount')) {
      cols.push({
        id: 'itemCount',
        header: 'Videos',
        accessorKey: 'itemCount',
        meta: { align: 'center' },
        cell: info => (
          <span className="num-cell">{(info.getValue() as number).toLocaleString()}</span>
        ),
      });
    }

    if (selectedMetrics.has('periodViewCount')) {
      cols.push({
        id: 'periodViewCount',
        header: 'Views from Playlist',
        accessorKey: 'periodViewCount',
        meta: { align: 'center' },
        cell: info => {
          const raw = info.getValue() as number | undefined;
          const views = typeof raw === 'number' && !Number.isNaN(raw) ? raw : 0;
          return <span className="num-cell">{views.toLocaleString()}</span>;
        },
      });
    }

    if (selectedMetrics.has('videoPeriodViewCount')) {
      cols.push({
        id: 'videoPeriodViewCount',
        header: 'Video Views',
        accessorKey: 'videoPeriodViewCount',
        meta: { align: 'center' },
        cell: info => {
          const raw = info.getValue() as number | undefined;
          return (
            <span className="num-cell">
              {raw !== undefined ? raw.toLocaleString() : <span style={{ color: 'var(--text-tertiary, #9ca3af)' }}>--</span>}
            </span>
          );
        },
      });
    }

    if (selectedDimensions.has('publishedAt')) {
      cols.push({
        id: 'publishedAt',
        header: 'Published At',
        accessorKey: 'publishedAt',
        cell: info => {
          const date = new Date(info.getValue() as string);
          return <span>{date.toLocaleDateString()}</span>;
        },
      });
    }

    if (selectedDimensions.has('lastVideoPublishedAt')) {
      cols.push({
        id: 'lastVideoPublishedAt',
        header: 'Last Video Added',
        accessorKey: 'lastVideoPublishedAt',
        cell: info => {
          const raw = info.getValue() as string | null | undefined;
          return (
            <span style={{ whiteSpace: 'nowrap' }}>
              {raw
                ? new Date(raw).toLocaleDateString()
                : <span style={{ color: 'var(--text-tertiary, #9ca3af)' }}>--</span>}
            </span>
          );
        },
      });
    }

    return cols;
  }, [selectedDimensions, selectedMetrics, activeRangeLabel, allChecked, someChecked, checkedPlaylistIds, handleCheckAll, handleCheckPlaylist]);

  const table = useReactTable({
    data: computedPlaylists,
    columns: columnDefs,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    // Never reset the page on data changes internally either -- the clamp
    // effect above owns that decision (progressive loads must not bounce).
    autoResetPageIndex: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });
  const rows = table.getRowModel().rows;
  const shouldVirtualizeRows = rows.length > 40;
  const rowVirtualizer = useVirtualizer({
    count: shouldVirtualizeRows ? rows.length : 0,
    getScrollElement: () => tableWrapperRef.current,
    estimateSize: () => 64,
    overscan: 8,
    measureElement: (el: Element | null) => el?.getBoundingClientRect().height ?? 64,
  });
  const virtualRows = shouldVirtualizeRows ? rowVirtualizer.getVirtualItems() : [];
  const virtualPaddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const virtualPaddingBottom =
    virtualRows.length > 0 ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end : 0;

  // Next/Last on the final client page fetches the next backend page instead
  // of needing a separate Load-more button. The advance happens once new rows land.
  const pendingBackendAdvanceRef = useRef(false);
  const canGoNextPage = table.getCanNextPage() || (hasMoreBackend && !!onLoadMoreBackend);
  const handleNextPage = () => {
    if (table.getCanNextPage()) {
      table.nextPage();
      return;
    }
    if (hasMoreBackend && onLoadMoreBackend && !isLoadingMoreBackend) {
      pendingBackendAdvanceRef.current = true;
      void onLoadMoreBackend();
    }
  };
  const handleLastPage = () => {
    if (table.getCanNextPage()) {
      table.setPageIndex(table.getPageCount() - 1);
      return;
    }
    if (hasMoreBackend && onLoadMoreBackend && !isLoadingMoreBackend) {
      pendingBackendAdvanceRef.current = true;
      void onLoadMoreBackend();
    }
  };
  useEffect(() => {
    if (pendingBackendAdvanceRef.current && table.getCanNextPage()) {
      pendingBackendAdvanceRef.current = false;
      table.nextPage();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computedPlaylists.length]);

  // Rows-per-page drives the backend fetch: when the selected page size needs
  // more rows than are loaded (backend pages are 20/request), keep pulling
  // backend pages until the current page is filled or the catalog is exhausted.
  // "All" (SHOW_ALL_PAGE_SIZE sentinel) loads the entire catalog the same way.
  const isShowingAll = pagination.pageSize >= SHOW_ALL_PAGE_SIZE;
  // Safety brake: the catalog caps at 500 rows (25 backend pages). Past that
  // the fetches are a failure/loop, not data -- stop auto-fetching so a
  // persistently failing backend isn't hammered forever. Manual Next/Retry
  // still works.
  const autoFillCountRef = useRef(0);
  useEffect(() => {
    autoFillCountRef.current = 0;
  }, [pagination.pageSize]);
  useEffect(() => {
    if (!hasMoreBackend || !onLoadMoreBackend || isLoadingMoreBackend) return;
    const needsMore = isShowingAll || computedPlaylists.length < pagination.pageSize;
    if (!needsMore || autoFillCountRef.current >= 25) return;
    autoFillCountRef.current += 1;
    void onLoadMoreBackend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.pageSize, computedPlaylists.length, hasMoreBackend, isLoadingMoreBackend]);

  if (isLoading && playlists.length === 0) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p>Loading playlist analytics...</p>
      </div>
    );
  }

  const handleDimensionToggle = (id: string) => {
    setSelectedDimensions(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleMetricToggle = (id: string) => {
    setSelectedMetrics(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="table-container table-report">
      <div className="table-header table-header--surface">
        <div className="table-header-title">
            <h2 className="section-title">Playlist Performance</h2>
            <p className="section-subtitle">{
              hasMoreBackend && typeof totalBackendCount === 'number' && totalBackendCount > computedPlaylists.length
                ? `${computedPlaylists.length} of ${totalBackendCount} playlists loaded — press Next to load more`
                : totalCount !== undefined && totalCount > computedPlaylists.length
                  ? `${computedPlaylists.length} of ${totalCount} playlists`
                  : `${computedPlaylists.length} playlists total`
            }</p>
           {isLoading && playlists.length > 0 && (
            <div className="table-updating-badge" aria-live="polite">
              <span className="seo-refreshing-dot" />
              Updating playlist data...
            </div>
           )}
           {partialNotice && computedPlaylists.length > 0 && (
            <div className="table-updating-badge" role="alert">
              <span aria-hidden>⚠</span>
              Showing public playlists only — {partialNotice}
            </div>
           )}
           {loadError && computedPlaylists.length > 0 && (
            <div className="table-updating-badge" role="alert">
              <span aria-hidden>⚠</span>
              {loadError}
            </div>
           )}
        </div>
        <div className="table-header-actions-container">
          <div className="table-header-actions">
            {/* Dimensions Dropdown */}
            <div className="rt-dropdown-anchor">
              <DropdownTrigger variant="ghost" bare
               
                onClick={() => setShowDimensionsDropdown(!showDimensionsDropdown)}
                title="Select dimension columns to show"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
                </svg>
                Dimensions
                <span className="filter-badge">{selectedDimensions.size}</span>
              </DropdownTrigger>
              {showDimensionsDropdown && (
                <DropdownPanel align="right">
                  <DropdownHeader>
                    <DropdownTitle>Show Dimensions</DropdownTitle>
                  </DropdownHeader>
                  <DropdownList>
                    {dimensionOptions.map((dim) => {
                      const isSelected = selectedDimensions.has(dim.id);
                      return (
                        <DropdownItem
                          key={dim.id}
                         
                          onClick={() => handleDimensionToggle(dim.id)}
                         selected={isSelected}>
                          <div className="filter-checkbox">
                            {isSelected && (
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                <polyline points="20 6 9 17 4 12"></polyline>
                              </svg>
                            )}
                          </div>
                          <span className="filter-item-label">{dim.label}</span>
                        </DropdownItem>
                      );
                    })}
                  </DropdownList>
                </DropdownPanel>
              )}
            </div>

            {/* Metrics Dropdown */}
            <div className="rt-dropdown-anchor">
              <DropdownTrigger variant="ghost" bare
               
                onClick={() => setShowMetricsDropdown(!showMetricsDropdown)}
                title="Select columns to show"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 3h18v18H3zM9 3v18M15 3v18M3 9h18M3 15h18" />
                </svg>
                Metrics
                <span className="filter-badge">{selectedMetrics.size}</span>
              </DropdownTrigger>
              {showMetricsDropdown && (
                <DropdownPanel align="right">
                  <DropdownHeader>
                    <DropdownTitle>Show Metrics</DropdownTitle>
                  </DropdownHeader>
                  <DropdownList>
                    {metricOptions.map((metric) => {
                      const isSelected = selectedMetrics.has(metric.id);
                      return (
                        <DropdownItem
                          key={metric.id}
                         
                          onClick={() => handleMetricToggle(metric.id)}
                         selected={isSelected}>
                          <div className="filter-checkbox">
                            {isSelected && (
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                <polyline points="20 6 9 17 4 12"></polyline>
                              </svg>
                            )}
                          </div>
                          <span className="filter-item-label">{metric.label}</span>
                        </DropdownItem>
                      );
                    })}
                  </DropdownList>
                </DropdownPanel>
              )}
            </div>

            {onExportCSV && (
              <Button
                variant="secondary"
                size="sm"
               
                onClick={onExportCSV}
                title="Export to CSV file"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
                Export CSV
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className={`table-card ${computedPlaylists.length > 10 ? 'table-card--paginated' : ''}`}>
      <div
        className={`table-wrapper ${computedPlaylists.length > 10 ? 'has-pagination' : ''} ${shouldVirtualizeRows ? 'table-wrapper--virtualized' : ''}`}
        ref={tableWrapperRef}
      >
        <table className="rt-data-table video-table">
          <thead>
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <th 
                    key={header.id}
                    onClick={header.column.getCanSort() ? header.column.getToggleSortingHandler() : undefined}
                    style={{
                      cursor: header.column.getCanSort() ? 'pointer' : 'default',
                      textAlign: (header.column.columnDef.meta as { align?: string } | undefined)?.align as React.CSSProperties['textAlign'] ?? 'left',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', justifyContent: ({ right: 'flex-end', center: 'center' } as Record<string, string>)[(header.column.columnDef.meta as { align?: string } | undefined)?.align ?? ''] ?? 'flex-start' }}>
                      {header.isPlaceholder ? null : (
                        <>
                          {typeof header.column.columnDef.header === 'function' 
                            ? header.column.columnDef.header(header.getContext())
                            : header.column.columnDef.header}
                          {header.column.getCanSort() && (
                            <span className="sort-icon">
                              {{
                                asc: '↑',
                                desc: '↓',
                               }[header.column.getIsSorted() as string] ?? '↕'}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {computedPlaylists.length === 0 && !isLoading ? (
              <tr>
                <td colSpan={Math.max(1, table.getAllLeafColumns().length)} className="empty-table-message">
                  <EmptyState
                    variant="zero"
                    title={loadError ? "Couldn't Load Playlists" : "No Playlists Loaded"}
                    description={
                      loadError ??
                      "No playlists loaded for this channel yet. Try the Reload button below."
                    }
                    action={
                      onRetryLoad ? (
                        <Button variant="secondary" size="sm" onClick={() => void onRetryLoad()}>
                          Reload Playlists
                        </Button>
                      ) : undefined
                    }
                  />
                </td>
              </tr>
            ) : (
              <>
                {shouldVirtualizeRows && virtualPaddingTop > 0 && (
                  <tr>
                    <td colSpan={Math.max(1, table.getAllLeafColumns().length)} style={{ height: `${virtualPaddingTop}px`, padding: 0, border: 'none' }} />
                  </tr>
                )}
                {(shouldVirtualizeRows ? virtualRows.map((vRow) => rows[vRow.index]) : rows).map((row: Row<PlaylistMetadata>) => (
                  <tr key={row.id} ref={shouldVirtualizeRows ? rowVirtualizer.measureElement : undefined} data-index={row.index}>
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} style={{ textAlign: (cell.column.columnDef.meta as { align?: string } | undefined)?.align as React.CSSProperties['textAlign'] ?? 'left' }}>
                        {typeof cell.column.columnDef.cell === 'function'
                          ? cell.column.columnDef.cell(cell.getContext())
                          : (cell.getValue() as React.ReactNode)}
                      </td>
                    ))}
                  </tr>
                ))}
                {shouldVirtualizeRows && virtualPaddingBottom > 0 && (
                  <tr>
                    <td colSpan={Math.max(1, table.getAllLeafColumns().length)} style={{ height: `${virtualPaddingBottom}px`, padding: 0, border: 'none' }} />
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </div>

      {computedPlaylists.length > 10 && (() => {
          // Page counts come from the backend-sent catalog total when more
          // rows may still be unloaded: ceil(total / rowsPerPage).
          const catalogTotal = typeof totalBackendCount === 'number' && totalBackendCount > 0
            ? totalBackendCount
            : undefined;
          const effectiveTotal = catalogTotal ?? computedPlaylists.length;
          const pageSize = table.getState().pagination.pageSize;
          const pageIndex = table.getState().pagination.pageIndex;
          const totalPages = catalogTotal !== undefined
            ? Math.max(1, Math.ceil(effectiveTotal / pageSize))
            : table.getPageCount();
          const showPlus = catalogTotal === undefined && hasMoreBackend;
          return (
        <div className="pagination-container">
          <div className="pagination-info">
            Showing {pageIndex * pageSize + 1} to{' '}
            {Math.min(
              (pageIndex + 1) * pageSize,
              computedPlaylists.length
            )}{' '}
            of {effectiveTotal} playlists
            {catalogTotal !== undefined && hasMoreBackend && (
              <> · more in catalog — press Next to load</>
            )}
          </div>
          
          <div className="pagination-controls">
            <Button variant="ghost" size="sm" bare
              
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage()}
              title="First page"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />
              </svg>
            </Button>
            
            <Button variant="ghost" size="sm" bare
              
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              title="Previous page"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </Button>

            <div className="pagination-pages">
              <span className="pagination-current">
                Page {pageIndex + 1} of {totalPages}{showPlus ? '+' : ''}
              </span>
            </div>

            <Button variant="ghost" size="sm" bare
              
              onClick={handleNextPage}
              disabled={!canGoNextPage || isLoadingMoreBackend}
              title={table.getCanNextPage() ? "Next page" : hasMoreBackend ? "Load more from catalog and go to next page" : "Next page"}
            >
              {isLoadingMoreBackend && !table.getCanNextPage() ? (
                <span className="spinner-small" aria-label="Loading more playlists" />
              ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18l6-6-6-6" />
              </svg>
              )}
            </Button>

            <Button variant="ghost" size="sm" bare
              
              onClick={handleLastPage}
              disabled={!canGoNextPage || isLoadingMoreBackend}
              title="Last page"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M13 17l5-5-5-5M6 17l5-5-5-5" />
              </svg>
            </Button>
          </div>

          <div className="pagination-size">
            <label htmlFor="playlist-page-size">Rows per page:</label>
            <select
              id="playlist-page-size"
              className="rt-select-native"
              value={isShowingAll ? 'all' : String(table.getState().pagination.pageSize)}
              onChange={(e) => {
                const v = e.target.value;
                if (v === 'all') {
                  setPagination({ pageIndex: 0, pageSize: SHOW_ALL_PAGE_SIZE });
                } else {
                  setPagination({ pageIndex: 0, pageSize: Number(v) });
                }
              }}
            >
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="all">All{typeof totalBackendCount === 'number' && totalBackendCount > 0 ? ` (${totalBackendCount})` : ''}</option>
            </select>
            {isLoadingMoreBackend && isShowingAll && hasMoreBackend && (
              <span className="pagination-loading-hint" aria-live="polite">Loading all playlists…</span>
            )}
          </div>
        </div>
          );
        })()}
      </div>
    </div>
  );
};

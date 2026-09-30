import React, { useState, useMemo, useEffect, useRef, type MutableRefObject } from 'react';
import { SkeletonVideoTable } from './SkeletonLoaders';
import type { VideoMetadata, PlaylistMetadata } from '../types/youtube';
import { getVideoType, formatSeconds, formatMinutes } from '../utils/timeUtils';
import { normalizePrivacyStatus } from '../utils/dashboardUtils';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  type SortingState,
  type ColumnDef,
  type PaginationState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { TableContainer, Paper } from './ui';
import './VideoTable.css';
import { Button, DropdownFooter, DropdownHeader, DropdownItem, DropdownList, DropdownPanel, DropdownTitle, DropdownTrigger, Toggle, Box } from './ui';
import { EmptyState } from './EmptyState';

interface VideoWithSource extends VideoMetadata {
  sourcePlaylistIds?: string[];
}

interface VideoTableProps {
  videos: VideoWithSource[];
  showChannelColumn?: boolean;
  onExportCSV?: () => void;
  onShare?: () => void;
  sourceType?: 'playlist' | 'channel' | 'videos';
  sourceName?: string;
  playlists?: PlaylistMetadata[];
  showPlaylistColumn?: boolean;
  allVideos?: VideoWithSource[]; // All videos before filtering
  filterByPlaylists?: boolean;
  onFilterByPlaylistsChange?: (value: boolean) => void;
  selectedPlaylists?: Set<string>;
  onSelectedPlaylistsChange?: (playlists: Set<string>) => void;
  filterByVideos?: boolean;
  onFilterByVideosChange?: (value: boolean) => void;
  selectedVideos?: Set<string>;
  onSelectedVideosChange?: (videos: Set<string>) => void;
  onLoadPlaylists?: () => Promise<void>; // Callback to load playlists
  isLoadingPlaylists?: boolean;
  showPlaylistFilter?: boolean; // Whether to show playlist filter button
  selectedMetrics?: Set<string>;
  onSelectedMetricsChange?: (metrics: Set<string>) => void;
  selectedDimensions?: Set<string>;
  onSelectedDimensionsChange?: (dims: Set<string>) => void;
  selectedPlaylistMetas?: Set<string>;
  onSelectedPlaylistMetasChange?: (metas: Set<string>) => void;
  viewsColumnLabel?: string;
  viewsColumnTooltip?: string;
  allowPrivateMetrics?: boolean;
  videoSearchQuery?: string;
  onVideoSearchQueryChange?: (query: string) => void;
  // Row-level checkboxes for analytics filtering
  checkedVideoIds?: Set<string>;
  onCheckedVideosChange?: (ids: Set<string>) => void;
  isLoading?: boolean;
  /** Dashboard: refetch videos from YouTube (e.g. empty / error recovery) */
  onRetryVideos?: () => void | Promise<void>;
  /** Open video detail dialog on title/thumbnail click */
  onVideoClick?: (video: VideoWithSource) => void;
  /** When set, kept in sync with the full filtered list in current table sort order (all pages), for CSV export parity */
  tableExportRowsRef?: MutableRefObject<VideoWithSource[]>;
  /** Backend catalog pagination -- Next on the last client page fetches more (no separate Load-more button) */
  hasMoreBackend?: boolean;
  onLoadMoreBackend?: () => void | Promise<void>;
  isLoadingMoreBackend?: boolean;
  totalBackendCount?: number;
}

type SortableField = 'publishedAt' | 'viewCount' | 'likeCount' | 'commentCount' | 'retention' | 'averageViewDuration' | 'engagedViews' | 'estimatedMinutesWatched';

// Sentinel pageSize meaning "show all loaded rows". Large enough that TanStack
// reports a single client page; the auto-fetch effect keeps loading backend
// pages until the catalog is exhausted while this is selected.
const SHOW_ALL_PAGE_SIZE = 1000000;

// Headless sort icon -- reads from TanStack sorting state
const SortIcon = ({ field, sorting }: { field: SortableField; sorting: SortingState }) => {
  const col = sorting.find(s => s.id === field);
  if (!col) return <span className="sort-icon">↕</span>;
  return <span className="sort-icon">{col.desc ? '↓' : '↑'}</span>;
};

// Privacy status helpers -- backend + dashboardUtils normalize the raw API value
// ("PRIVACY_PUBLIC" / "PRIVACY_UNLISTED" / "PRIVACY_PRIVATE" or lowercase) to the
// canonical public | unlisted | private. A missing/undefined value means the status
// is genuinely unknown (e.g. API-key / non-owner fetch), so render "Unknown".
const privacyLabel = (privacyStatus?: string): string => {
  const status = normalizePrivacyStatus(privacyStatus);
  if (!status) return 'Unknown';
  return status.charAt(0).toUpperCase() + status.slice(1);
};

const privacyClass = (privacyStatus?: string): string => {
  const status = normalizePrivacyStatus(privacyStatus);
  if (!status) return 'unknown';
  if (status === 'private') return 'private';
  if (status === 'unlisted') return 'unlisted';
  return 'public';
};

// Label map for sort dropdown display
const sortLabels: Record<SortableField, string> = {
  publishedAt: 'Publish Date',
  viewCount: 'Views',
  likeCount: 'Likes',
  commentCount: 'Comments',
  retention: 'Retention',
  averageViewDuration: 'Avg View Duration',
  engagedViews: 'Engaged Views',
  estimatedMinutesWatched: 'Watch Time',
};

export const VideoTable: React.FC<VideoTableProps> = ({ 
  videos, 
  showChannelColumn = true, 
  onExportCSV,
  onShare,
  sourceType = 'playlist',
  sourceName,
  playlists = [],
  showPlaylistColumn = false,
  allVideos = [],
  filterByPlaylists = false,
  onFilterByPlaylistsChange,
  selectedPlaylists = new Set(),
  onSelectedPlaylistsChange,
  filterByVideos = false,
  onFilterByVideosChange,
  selectedVideos = new Set(),
  onSelectedVideosChange,
  onLoadPlaylists,
  isLoadingPlaylists = false,
  showPlaylistFilter = false,
  selectedMetrics,
  onSelectedMetricsChange,
  selectedDimensions,
  onSelectedDimensionsChange,
  selectedPlaylistMetas,
  onSelectedPlaylistMetasChange,
  viewsColumnLabel = 'Views',
  viewsColumnTooltip = 'Views for the active dashboard time window',
  allowPrivateMetrics = false,
  videoSearchQuery: externalVideoSearchQuery,
  onVideoSearchQueryChange,
  checkedVideoIds: externalCheckedVideoIds,
  onCheckedVideosChange,
  isLoading = false,
  onRetryVideos,
  onVideoClick,
  tableExportRowsRef,
  hasMoreBackend = false,
  onLoadMoreBackend,
  isLoadingMoreBackend = false,
  totalBackendCount,
}) => {
  // TanStack Table sorting state replaces manual sortField/sortDirection
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });
  const [copySuccess, setCopySuccess] = useState(false);
  const [copiedVideoId, setCopiedVideoId] = useState<string | null>(null);
  const [showMetricsDropdown, setShowMetricsDropdown] = useState(false);
  const [showDimensionsDropdown, setShowDimensionsDropdown] = useState(false);
  const [showPlaylistDropdown, setShowPlaylistDropdown] = useState(false);
  const [showPlaylistMetaDropdown, setShowPlaylistMetaDropdown] = useState(false);
  const [showVideoDropdown, setShowVideoDropdown] = useState(false);
  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const [playlistSearchQuery, setPlaylistSearchQuery] = useState('');
  const [internalVideoSearchQuery, setInternalVideoSearchQuery] = useState('');
  
  const videoSearchQuery = externalVideoSearchQuery !== undefined ? externalVideoSearchQuery : internalVideoSearchQuery;
  const setVideoSearchQuery = onVideoSearchQueryChange || setInternalVideoSearchQuery;

  /** Toolbar search narrows visible rows (picker list shares the same query). */
  const displayVideos = useMemo(() => {
    const q = videoSearchQuery.trim().toLowerCase();
    if (!q) return videos;
    return videos.filter((v) => {
      const title = v.title?.toLowerCase() ?? '';
      const id = v.videoId?.toLowerCase() ?? '';
      const channel = v.channelTitle?.toLowerCase() ?? '';
      const desc = v.description?.toLowerCase() ?? '';
      return title.includes(q) || id.includes(q) || channel.includes(q) || desc.includes(q);
    });
  }, [videos, videoSearchQuery]);

  const tableSubtitle = useMemo(() => {
    const q = videoSearchQuery.trim();
    const scopedCount = videos.length;
    const catalogTotal = typeof totalBackendCount === 'number' && totalBackendCount > scopedCount
      ? totalBackendCount
      : (allVideos.length > scopedCount ? allVideos.length : scopedCount);
    if (q && displayVideos.length !== scopedCount) {
      return `${displayVideos.length} of ${scopedCount} videos match search`;
    }
    return catalogTotal > scopedCount
      ? `${scopedCount} of ${catalogTotal} videos (current filter)`
      : `${catalogTotal} videos`;
  }, [videoSearchQuery, displayVideos.length, videos.length, allVideos.length, totalBackendCount]);

  // Internal checked state -- default all checked (controlled externally if prop provided)
  const [internalCheckedVideoIds, setInternalCheckedVideoIds] = useState<Set<string>>(
    () => new Set(videos.map(v => v.videoId))
  );

  // Only re-sync when the *set* of row video IDs changes -- not when the parent passes a new
  // array reference with the same rows (Playlist page used inline getFilteredVideos() every render).
  const videoIdsSignature = useMemo(
    () => videos.map(v => v.videoId).sort().join('\0'),
    [videos]
  );

  // When videos list changes, add newly appeared videos as checked by default
  useEffect(() => {
    if (externalCheckedVideoIds !== undefined) return;
    setInternalCheckedVideoIds(prev => {
      const next = new Set(prev);
      videos.forEach(v => {
        if (!next.has(v.videoId)) next.add(v.videoId); // new video → default checked
      });
      // Remove stale ids no longer in videos
      next.forEach(id => {
        if (!videos.some(v => v.videoId === id)) next.delete(id);
      });
      return next;
    });
    // `videos` omitted on purpose: `videoIdsSignature` tracks identity; avoids spurious sync when only the array reference changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoIdsSignature, externalCheckedVideoIds]);

  // Keep the page index valid when rows change. Growth (backend load-more
  // batches, playlist hydration, analytics enrichment) must never bounce the
  // user back to page 1 -- only drop to the first page when the current page
  // no longer exists (e.g. a filter shrank 9 pages to 1). Search always
  // restarts from page 1 (effect below). TanStack's own autoResetPageIndex is
  // disabled in useReactTable for the same reason.
  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(displayVideos.length / pagination.pageSize) - 1);
    setPagination((prevP) => (prevP.pageIndex > maxPage ? { ...prevP, pageIndex: 0 } : prevP));
  }, [displayVideos.length, pagination.pageSize]);
  useEffect(() => {
    setPagination(prevP => ({ ...prevP, pageIndex: 0 }));
  }, [videoSearchQuery]);

  /** Set when Next/Last is pressed on the last client page while the backend has more -- advance once the new rows arrive. */
  const pendingBackendAdvanceRef = useRef(false);

  const checkedVideoIds = externalCheckedVideoIds ?? internalCheckedVideoIds;

  const handleCheckVideo = (videoId: string, checked: boolean) => {
    const next = new Set(checkedVideoIds);
    if (checked) next.add(videoId); else next.delete(videoId);
    if (onCheckedVideosChange) onCheckedVideosChange(next);
    else setInternalCheckedVideoIds(next);
  };

  const allChecked =
    displayVideos.length > 0 && displayVideos.every((v) => checkedVideoIds.has(v.videoId));
  const someChecked = !allChecked && displayVideos.some((v) => checkedVideoIds.has(v.videoId));

  const handleCheckAll = (checked: boolean) => {
    const next = new Set(checkedVideoIds);
    if (checked) {
      displayVideos.forEach((v) => next.add(v.videoId));
    } else {
      displayVideos.forEach((v) => next.delete(v.videoId));
    }
    if (onCheckedVideosChange) onCheckedVideosChange(next);
    else setInternalCheckedVideoIds(next);
  };

  const [activeActionRow, setActiveActionRow] = useState<string | null>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  
  // Internal state for uncontrolled mode
  const [internalSelectedMetrics, setInternalSelectedMetrics] = useState<Set<string>>(
    selectedMetrics || new Set(
      allowPrivateMetrics 
        ? ['viewCount', 'publishedAt', 'retention']
        : ['viewCount', 'publishedAt', 'likeCount', 'commentCount']
    )
  );

  const [internalSelectedDimensions, setInternalSelectedDimensions] = useState<Set<string>>(
    selectedDimensions || new Set(['thumbnail', 'title', 'status'])
  );

  const [internalSelectedPlaylistMetas, setInternalSelectedPlaylistMetas] = useState<Set<string>>(
    selectedPlaylistMetas || new Set(['title'])
  );

  const playlistsById = useMemo(() => {
    const map = new Map<string, PlaylistMetadata>();
    playlists.forEach((playlist) => {
      map.set(playlist.id, playlist);
    });
    return map;
  }, [playlists]);

  // Use props if provided, otherwise internal state
  const effectiveSelectedMetrics = selectedMetrics || internalSelectedMetrics;
  const effectiveSelectedDimensions = selectedDimensions || internalSelectedDimensions;
  const effectiveSelectedPlaylistMetas = selectedPlaylistMetas || internalSelectedPlaylistMetas;

  const canShowPlaylistMetaColumns = showPlaylistColumn && playlists.length > 0;

  // Flatten videos: if a video is in multiple playlists, create a row for each
  const flattenedVideos = useMemo(() => {
    const flattened: VideoWithSource[] = [];
    displayVideos.forEach((video) => {
      if (video.sourcePlaylistIds && video.sourcePlaylistIds.length > 1) {
        video.sourcePlaylistIds.forEach((playlistId) => {
          flattened.push({
            ...video,
            sourcePlaylistIds: [playlistId] // Each row gets exactly one playlist ID
          });
        });
      } else {
        flattened.push(video);
      }
    });
    return flattened;
  }, [displayVideos]);

  const metricsDropdownRef = useRef<HTMLDivElement>(null);
  const dimensionsDropdownRef = useRef<HTMLDivElement>(null);
  const playlistDropdownRef = useRef<HTMLDivElement>(null);
  const playlistMetaDropdownRef = useRef<HTMLDivElement>(null);
  const videoDropdownRef = useRef<HTMLDivElement>(null);
  const sortDropdownRef = useRef<HTMLDivElement>(null);
  const tableWrapperRef = useRef<HTMLDivElement>(null);

  // Track horizontal scroll state
  useEffect(() => {
    const tableWrapper = tableWrapperRef.current;
    if (!tableWrapper) return;

    const updateScrollState = () => {
      const { scrollLeft, scrollWidth, clientWidth } = tableWrapper;
      setCanScrollLeft(scrollLeft > 0);
      setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 1);
    };

    const handleTableScroll = () => {
      updateScrollState();
    };

    const updateStateOnResize = () => {
      updateScrollState();
    };

    tableWrapper.addEventListener('scroll', handleTableScroll);

    updateScrollState();

    const observer = new ResizeObserver(updateStateOnResize);
    observer.observe(tableWrapper);

    return () => {
      tableWrapper.removeEventListener('scroll', handleTableScroll);
      observer.disconnect();
    };
  }, [flattenedVideos]);

  const scrollTable = (direction: 'left' | 'right') => {
    const el = tableWrapperRef.current;
    if (!el) return;
    // Increase scroll distance for better UX
    el.scrollBy({ left: direction === 'left' ? -600 : 600, behavior: 'smooth' });
  };
  
  const dimensionOptions = [
    { id: 'thumbnail', label: 'Thumbnail' },
    { id: 'title', label: 'Title' },
    { id: 'videoId', label: 'Video ID' },
    { id: 'type', label: 'Video Type' },
    { id: 'status', label: 'Status' },
    { id: 'duration', label: 'Duration' },
    { id: 'description', label: 'Description' },
    { id: 'tags', label: 'Tags' },
  ];

  const metricOptions = [
    { id: 'publishedAt', label: 'Publish Date' },
    { id: 'viewCount', label: viewsColumnLabel },
    { id: 'likeCount', label: 'Likes' },
    { id: 'commentCount', label: 'Comments' },
    // Private metrics only if allowed
    ...(allowPrivateMetrics ? [
      { id: 'retention', label: 'Retention (%)' },
      { id: 'averageViewDuration', label: 'Avg View Duration' },
      { id: 'engagedViews', label: 'Engaged Views' },
      { id: 'estimatedMinutesWatched', label: 'Watch Time (min)' },
    ] : []),
  ];

  const playlistMetaOptions = [
    { id: 'title', label: 'Playlists Title' },
    { id: 'id', label: 'Playlist ID' },
    { id: 'url', label: 'Playlist URL' },
    { id: 'description', label: 'Playlist Description' },
    { id: 'keywords', label: 'Playlists Keywords' },
    { id: 'thumbnailUrl', label: 'Playlist Thumbnail URL' },
  ];

  const handleMetricToggle = (metricId: string) => {
    const newSelected = new Set(effectiveSelectedMetrics);
    if (newSelected.has(metricId)) {
      newSelected.delete(metricId);
    } else {
      newSelected.add(metricId);
    }
    if (onSelectedMetricsChange) onSelectedMetricsChange(newSelected);
    else setInternalSelectedMetrics(newSelected);
  };

  const handleSelectAllMetrics = (all: boolean) => {
    const newSelected = all 
      ? new Set(metricOptions.map(m => m.id))
      : new Set<string>();
    if (onSelectedMetricsChange) onSelectedMetricsChange(newSelected);
    else setInternalSelectedMetrics(newSelected);
  };

  const handleDimensionToggle = (dimId: string) => {
    const newSelected = new Set(effectiveSelectedDimensions);
    if (newSelected.has(dimId)) {
      newSelected.delete(dimId);
    } else {
      newSelected.add(dimId);
    }
    if (onSelectedDimensionsChange) onSelectedDimensionsChange(newSelected);
    else setInternalSelectedDimensions(newSelected);
  };

  const handleSelectAllDimensions = (all: boolean) => {
    const newSelected = all
      ? new Set(dimensionOptions.map(d => d.id))
      : new Set<string>();
    if (onSelectedDimensionsChange) onSelectedDimensionsChange(newSelected);
    else setInternalSelectedDimensions(newSelected);
  };

  const handleSelectAllPlaylistMetas = (all: boolean) => {
    const newSelected = all 
      ? new Set(playlistMetaOptions.map(m => m.id))
      : new Set<string>();
    
    if (onSelectedPlaylistMetasChange) {
      onSelectedPlaylistMetasChange(newSelected);
    } else {
      setInternalSelectedPlaylistMetas(newSelected);
    }
  };

  const handlePlaylistMetaToggle = (metaId: string) => {
    const newSelected = new Set(effectiveSelectedPlaylistMetas);
    if (newSelected.has(metaId)) {
      newSelected.delete(metaId);
    } else {
      newSelected.add(metaId);
    }
    
    if (onSelectedPlaylistMetasChange) {
      onSelectedPlaylistMetasChange(newSelected);
    } else {
      setInternalSelectedPlaylistMetas(newSelected);
    }
  };

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (playlistDropdownRef.current && !playlistDropdownRef.current.contains(event.target as Node)) {
        setShowPlaylistDropdown(false);
      }
      if (videoDropdownRef.current && !videoDropdownRef.current.contains(event.target as Node)) {
        setShowVideoDropdown(false);
      }
      if (metricsDropdownRef.current && !metricsDropdownRef.current.contains(event.target as Node)) {
        setShowMetricsDropdown(false);
      }
      if (dimensionsDropdownRef.current && !dimensionsDropdownRef.current.contains(event.target as Node)) {
        setShowDimensionsDropdown(false);
      }
      if (playlistMetaDropdownRef.current && !playlistMetaDropdownRef.current.contains(event.target as Node)) {
        setShowPlaylistMetaDropdown(false);
      }
      if (actionMenuRef.current && !actionMenuRef.current.contains(event.target as Node)) {
        setActiveActionRow(null);
      }
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(event.target as Node)) {
        setShowSortDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // --- TanStack Table (headless) ---
  // We define minimal column defs so TanStack knows which fields are sortable.
  // Cell rendering, headers, and all UI is still handled by our own JSX below.
  const columnDefs = useMemo<ColumnDef<VideoWithSource>[]>(() => [
    { id: 'publishedAt', accessorFn: (v) => new Date(v.publishedAt).getTime() },
    { id: 'viewCount',   accessorFn: (v) => v.viewCount   ?? 0 },
    { id: 'likeCount',   accessorFn: (v) => v.likeCount   ?? 0 },
    { id: 'commentCount',accessorFn: (v) => v.commentCount ?? 0 },
    { id: 'retention',   accessorFn: (v) => v.retention   ?? 0 },
    { id: 'averageViewDuration', accessorFn: (v) => v.averageViewDuration ?? 0 },
    { id: 'engagedViews', accessorFn: (v) => v.engagedViews ?? 0 },
    { id: 'estimatedMinutesWatched', accessorFn: (v) => v.estimatedMinutesWatched ?? 0 },
  ], []);

  const table = useReactTable({
    data: displayVideos,
    columns: columnDefs,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    // Never reset the page on data changes internally -- the clamp effect
    // above owns that decision (load-more batches must not bounce to page 1).
    autoResetPageIndex: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    // Default: descending on first click (matches previous behaviour)
    enableSortingRemoval: true,
  });

  // Sorted rows in the same shape as before -- we just extract original video objects
  const sortedVideos = useMemo(
    () => table.getRowModel().rows.map(r => r.original),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [table.getRowModel().rows]
  );
  const shouldVirtualizeRows = sortedVideos.length > 40;
  const videoRowVirtualizer = useVirtualizer({
    count: shouldVirtualizeRows ? sortedVideos.length : 0,
    getScrollElement: () => tableWrapperRef.current,
    estimateSize: () => 76,
    overscan: 8,
    measureElement: (el: Element | null) => el?.getBoundingClientRect().height ?? 76,
  });
  const virtualRows = shouldVirtualizeRows ? videoRowVirtualizer.getVirtualItems() : [];
  const virtualPaddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const virtualPaddingBottom =
    virtualRows.length > 0
      ? videoRowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
      : 0;

  const allSortedVideos = useMemo(
    () => table.getSortedRowModel().rows.map(row => row.original),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [table.getSortedRowModel().rows]
  );

  useEffect(() => {
    if (tableExportRowsRef) tableExportRowsRef.current = allSortedVideos;
  }, [allSortedVideos, tableExportRowsRef]);

  // Next/Last on the final client page fetches the next backend page instead
  // of needing a separate Load-more button. The advance happens once new rows land.
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
  }, [displayVideos.length]);

  // Rows-per-page drives the backend fetch: when the selected page size needs
  // more rows than are loaded (backend pages are 20/request), keep pulling
  // backend pages until the current page is filled or the catalog is exhausted.
  // "All" (SHOW_ALL_PAGE_SIZE sentinel) loads the entire catalog the same way.
  const isShowingAll = pagination.pageSize >= SHOW_ALL_PAGE_SIZE;
  // Safety brake: past ~25 backend pages the fetches are a failure/loop, not
  // data -- stop auto-fetching so a persistently failing backend isn't
  // hammered forever. Manual Next/Retry still works.
  const autoFillCountRef = useRef(0);
  useEffect(() => {
    autoFillCountRef.current = 0;
  }, [pagination.pageSize]);
  useEffect(() => {
    if (videoSearchQuery.trim() !== '') return;
    if (!hasMoreBackend || !onLoadMoreBackend || isLoadingMoreBackend) return;
    const needsMore = isShowingAll || displayVideos.length < pagination.pageSize;
    if (!needsMore || autoFillCountRef.current >= 25) return;
    autoFillCountRef.current += 1;
    void onLoadMoreBackend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.pageSize, displayVideos.length, hasMoreBackend, isLoadingMoreBackend, videoSearchQuery]);

  // For copy/export we still need the flattened+sorted list
  const sortedFlattenedVideos = useMemo(() => {
    if (sorting.length === 0) return flattenedVideos;
    const col = sorting[0];
    return [...flattenedVideos].sort((a, b) => {
      let av = 0, bv = 0;
      if (col.id === 'publishedAt') { av = new Date(a.publishedAt).getTime(); bv = new Date(b.publishedAt).getTime(); }
      else if (col.id === 'viewCount')    { av = a.viewCount    ?? 0; bv = b.viewCount    ?? 0; }
      else if (col.id === 'likeCount')    { av = a.likeCount    ?? 0; bv = b.likeCount    ?? 0; }
      else if (col.id === 'commentCount') { av = a.commentCount ?? 0; bv = b.commentCount ?? 0; }
      else if (col.id === 'retention')    { av = a.retention    ?? 0; bv = b.retention    ?? 0; }
      else if (col.id === 'averageViewDuration') { av = a.averageViewDuration ?? 0; bv = b.averageViewDuration ?? 0; }
      else if (col.id === 'engagedViews') { av = a.engagedViews ?? 0; bv = b.engagedViews ?? 0; }
      else if (col.id === 'estimatedMinutesWatched') { av = a.estimatedMinutesWatched ?? 0; bv = b.estimatedMinutesWatched ?? 0; }
      return col.desc ? bv - av : av - bv;
    });
  }, [flattenedVideos, sorting]);

  // Helper: toggle a sortable column via TanStack (preserves default-desc behaviour)
  const handleSort = (field: SortableField) => {
    const existing = sorting.find(s => s.id === field);
    if (!existing) {
      setSorting([{ id: field, desc: true }]); // first click → desc
    } else if (existing.desc) {
      setSorting([{ id: field, desc: false }]); // second click → asc
    } else {
      setSorting([]); // third click → unsorted
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Compact number format: 1.2M, 45K, 999 etc. for table cells
  const formatNumber = (num?: number) => {
    if (num === undefined) return 'N/A';
    return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(num);
  };

  // Full number for tooltips
  const formatNumberFull = (num?: number) => {
    if (num === undefined) return 'N/A';
    return num.toLocaleString();
  };

  // Human-readable duration from ISO 8601 (PT1H2M3S → 1:02:03 or 12:34)
  const formatDuration = (iso?: string): string => {
    if (!iso) return '-';
    const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return '-';
    const h = parseInt(match[1] || '0');
    const m = parseInt(match[2] || '0');
    const s = parseInt(match[3] || '0');
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    return `${m}:${String(s).padStart(2,'0')}`;
  };

  const escapeTsvField = (field: string): string => {
    // Remove tabs and replace newlines with spaces
    let escaped = field.replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
    // Remove excessive whitespace
    escaped = escaped.replace(/\s+/g, ' ').trim();
    // If field contains quotes, escape them by doubling
    if (escaped.includes('"')) {
      escaped = escaped.replace(/"/g, '""');
    }
    // Quote the field if it contains special characters
    if (escaped.includes('\t') || escaped.includes('\n') || escaped.includes('"') || escaped.includes(',')) {
      escaped = `"${escaped}"`;
    }
    return escaped;
  };


  const getPlaylistDataArray = (video: VideoWithSource, type: 'title' | 'id' | 'url' | 'description' | 'keywords' | 'tags' | 'thumbnailUrl'): string[] => {
    if (!video.sourcePlaylistIds || video.sourcePlaylistIds.length === 0) {
      return [];
    }

    const flatResult: string[] = [];
    video.sourcePlaylistIds.forEach(id => {
      const playlist = playlistsById.get(id);
      if (!playlist) {
        if (type === 'id') flatResult.push(id);
        return;
      }
      
      switch (type) {
        case 'title': flatResult.push(playlist.title); break;
        case 'id': flatResult.push(playlist.id); break;
        case 'url': flatResult.push(`https://www.youtube.com/playlist?list=${playlist.id}`); break;
        case 'description': flatResult.push(playlist.description); break;
        case 'keywords': 
          if (playlist.keywords) flatResult.push(...playlist.keywords);
          break;
        case 'thumbnailUrl': flatResult.push(playlist.thumbnailUrl); break;
      }
    });

    // Only split by commas for keywords. Descriptions and titles should remain intact.
    if (type === 'keywords') {
      return flatResult.flatMap(val => 
        val.includes(',') ? val.split(',').map(s => s.trim()).filter(Boolean) : val
      ).filter(Boolean);
    }

    return flatResult.filter(Boolean);
  };

  const getSinglePlaylistData = (id: string, type: 'title' | 'id' | 'url' | 'description' | 'keywords' | 'thumbnailUrl'): string[] => {
    const playlist = playlistsById.get(id);
    if (!playlist) {
      return type === 'id' ? [id] : [];
    }
    
    switch (type) {
      case 'title': return [playlist.title];
      case 'id': return [playlist.id];
      case 'url': return [`https://www.youtube.com/playlist?list=${playlist.id}`];
      case 'description': return [playlist.description];
      case 'keywords': {
        const kws = playlist.keywords || [];
        return kws.flatMap(val => 
          val.includes(',') ? val.split(',').map(s => s.trim()).filter(Boolean) : val
        ).filter(Boolean);
      }
      case 'thumbnailUrl': return [playlist.thumbnailUrl];
      default: return [];
    }
  };

  const getPlaylistDataString = (video: VideoWithSource, type: 'title' | 'id' | 'url' | 'description' | 'keywords' | 'tags' | 'thumbnailUrl'): string => {
    const data = getPlaylistDataArray(video, type);
    // Use newline for better copy/csv representation if data exists
    return data.length > 0 ? data.join('\n') : '-';
  };

  const handleCopyVideoUrl = async (videoId: string) => {
    try {
      const url = `https://www.youtube.com/watch?v=${videoId}`;
      await navigator.clipboard.writeText(url);
      setCopiedVideoId(videoId);
      setTimeout(() => setCopiedVideoId(null), 2000);
    } catch (err) {
      console.error('Failed to copy URL:', err);
    }
  };

  const handleCopyTable = async () => {
    try {
      // Create header row
      const headers = [
        '#',
        ...(effectiveSelectedDimensions.has('thumbnail') ? ['Video Thumbnail URL'] : []),
        ...(effectiveSelectedDimensions.has('title') ? ['Video Title'] : []),
        ...(effectiveSelectedDimensions.has('videoId') ? ['Video ID'] : []),
        'Video URL',
        ...(effectiveSelectedDimensions.has('type') ? ['Video Type'] : []),
        ...(effectiveSelectedDimensions.has('status') ? ['Status'] : []),
        ...(effectiveSelectedDimensions.has('duration') ? ['Duration'] : []),
        ...(effectiveSelectedMetrics.has('publishedAt') ? ['Publish Date'] : []),
        ...(effectiveSelectedMetrics.has('viewCount') ? [viewsColumnLabel] : []),
        ...(effectiveSelectedMetrics.has('likeCount') ? ['Video Likes'] : []),
        ...(effectiveSelectedMetrics.has('commentCount') ? ['Video Comments'] : []),
        ...(effectiveSelectedDimensions.has('description') ? ['Video Description'] : []),
        ...(effectiveSelectedDimensions.has('tags') ? ['Video Tags'] : []),
        ...(canShowPlaylistMetaColumns && effectiveSelectedPlaylistMetas.has('title') ? ['Playlists Title'] : []),
        ...(canShowPlaylistMetaColumns && effectiveSelectedPlaylistMetas.has('id') ? ['Playlist ID'] : []),
        ...(canShowPlaylistMetaColumns && effectiveSelectedPlaylistMetas.has('url') ? ['Playlist URL'] : []),
        ...(canShowPlaylistMetaColumns && effectiveSelectedPlaylistMetas.has('description') ? ['Playlist Description'] : []),
        ...(canShowPlaylistMetaColumns && effectiveSelectedPlaylistMetas.has('keywords') ? ['Playlists Keywords'] : []),
        ...(canShowPlaylistMetaColumns && effectiveSelectedPlaylistMetas.has('thumbnailUrl') ? ['Playlist Thumbnail URL'] : []),
        // Private metrics
        ...(effectiveSelectedMetrics.has('retention') ? ['Retention (%)'] : []),
        ...(effectiveSelectedMetrics.has('averageViewDuration') ? ['Avg View Duration (s)'] : []),
        ...(effectiveSelectedMetrics.has('engagedViews') ? ['Engaged Views'] : []),
        ...(effectiveSelectedMetrics.has('estimatedMinutesWatched') ? ['Watch Time (min)'] : []),
        ...(showChannelColumn ? ['Channel'] : [])
      ];

      // Create data rows with properly escaped fields
      const rows = (sortedFlattenedVideos as VideoWithSource[]).map((video: VideoWithSource, index: number) => [
        String(index + 1),
        ...(effectiveSelectedDimensions.has('thumbnail') ? [escapeTsvField(video.thumbnailUrl)] : []),
        ...(effectiveSelectedDimensions.has('title') ? [escapeTsvField(video.title)] : []),
        ...(effectiveSelectedDimensions.has('videoId') ? [video.videoId] : []),
        `https://www.youtube.com/watch?v=${video.videoId}`,
        ...(effectiveSelectedDimensions.has('type') ? [getVideoType(video.duration)] : []),
        ...(effectiveSelectedDimensions.has('status') ? [privacyLabel(video.privacyStatus)] : []),
        ...(effectiveSelectedDimensions.has('duration') ? [formatDuration(video.duration)] : []),
        ...(effectiveSelectedMetrics.has('publishedAt') ? [formatDate(video.publishedAt)] : []),
        ...(effectiveSelectedMetrics.has('viewCount') ? [video.viewCount?.toString() ?? ''] : []),
        ...(effectiveSelectedMetrics.has('likeCount') ? [video.likeCount?.toString() ?? ''] : []),
        ...(effectiveSelectedMetrics.has('commentCount') ? [video.commentCount?.toString() ?? ''] : []),
        ...(effectiveSelectedDimensions.has('description') ? [escapeTsvField(video.description || '')] : []),
        ...(effectiveSelectedDimensions.has('tags') ? [escapeTsvField(video.tags?.join(', ') || '')] : []),
        ...(canShowPlaylistMetaColumns && effectiveSelectedPlaylistMetas.has('title')
          ? [escapeTsvField(getPlaylistDataString(video, 'title'))]
          : []),
        ...(canShowPlaylistMetaColumns && effectiveSelectedPlaylistMetas.has('id')
          ? [escapeTsvField(getPlaylistDataString(video, 'id'))]
          : []),
        ...(canShowPlaylistMetaColumns && effectiveSelectedPlaylistMetas.has('url')
          ? [escapeTsvField(getPlaylistDataString(video, 'url'))]
          : []),
        ...(canShowPlaylistMetaColumns && effectiveSelectedPlaylistMetas.has('description')
          ? [escapeTsvField(getPlaylistDataString(video, 'description'))]
          : []),
        ...(canShowPlaylistMetaColumns && effectiveSelectedPlaylistMetas.has('keywords')
          ? [escapeTsvField(getPlaylistDataString(video, 'keywords'))]
          : []),
        ...(canShowPlaylistMetaColumns && effectiveSelectedPlaylistMetas.has('thumbnailUrl')
          ? [escapeTsvField(getPlaylistDataString(video, 'thumbnailUrl'))]
          : []),
        // Private metrics
        ...(effectiveSelectedMetrics.has('retention') ? [video.retention !== undefined ? `${video.retention.toFixed(1)}%` : 'N/A'] : []),
        ...(effectiveSelectedMetrics.has('averageViewDuration') ? [video.averageViewDuration !== undefined ? formatSeconds(video.averageViewDuration) : 'N/A'] : []),
        ...(effectiveSelectedMetrics.has('engagedViews') ? [video.engagedViews !== undefined ? video.engagedViews.toLocaleString() : 'N/A'] : []),
        ...(effectiveSelectedMetrics.has('estimatedMinutesWatched') ? [video.estimatedMinutesWatched !== undefined ? formatMinutes(video.estimatedMinutesWatched) : 'N/A'] : []),
        ...(showChannelColumn ? [escapeTsvField(video.channelTitle)] : [])
      ]);

      // Combine headers and rows with tab separation
      const tsvContent = [
        headers.join('\t'),
        ...rows.map((row: string[]) => row.join('\t'))
      ].join('\n');

      await navigator.clipboard.writeText(tsvContent);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.error('Failed to copy table:', err);
    }
  };

  // If we have no videos at all (not even filtered ones), and no allVideos passed, then return null
  // But if we have allVideos (meaning we have data but it might be filtered out), we should still render
  if (videos.length === 0 && (!allVideos || allVideos.length === 0)) {
    return null;
  }

  // Determine the title based on source info
  const renderTitle = () => {
    const fromLabel = <span className="section-title-prefix">Videos from</span>;

    if (sourceName) {
      return (
        <h2 className="section-title">
          {fromLabel} {sourceName}
        </h2>
      );
    }
    
    return (
      <h2 className="section-title">
        {fromLabel} {sourceType === 'channel' ? 'Channel' : 'Playlist'}
      </h2>
    );
  };

  return (
    <div className="table-container table-report">
      <div className="table-header table-header--surface">
        <div className="table-header-title">
          {renderTitle()}
          <p className="section-subtitle">{tableSubtitle}</p>
        </div>
        <div className="table-header-actions-container">
          <div className="table-header-actions">
            {/* Filter by Playlists Dropdown or Load Button */}
            {showPlaylistFilter && (
              <div className="rt-dropdown-anchor" ref={playlistDropdownRef}>
                {playlists.length === 0 && onLoadPlaylists ? (
                  <Button variant="ghost" bare
                   
                    onClick={async () => {
                      if (!isLoadingPlaylists) {
                        await onLoadPlaylists();
                      }
                    }}
                    title="Load playlists from channel"
                    disabled={isLoadingPlaylists}
                  >
                    {isLoadingPlaylists ? (
                      <>
                        <div className="spinner-small"></div>
                        Loading...
                      </>
                    ) : (
                      <>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                        </svg>
                        Load Playlists
                      </>
                    )}
                  </Button>
                ) : (
                  playlists.length > 0 && onFilterByPlaylistsChange && (
                    <>
                      <DropdownTrigger variant="ghost" bare
                       
                        onClick={() => setShowPlaylistDropdown(!showPlaylistDropdown)}
                        title="Filter by playlists"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
                        </svg>
                        Playlists
                        {filterByPlaylists && selectedPlaylists.size > 0 && (
                          <span className="filter-badge">{selectedPlaylists.size}</span>
                        )}
                      </DropdownTrigger>
                    </>
                  )
                )}
                {showPlaylistDropdown && (
                  <DropdownPanel align="right">
                    <DropdownHeader>
                      <input
                        type="text"
                        className="rt-dropdown-search-input"
                        placeholder="Search playlists..."
                        value={playlistSearchQuery}
                        onChange={(e) => setPlaylistSearchQuery(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </DropdownHeader>
                    <DropdownList>
                      {playlists
                        .filter(p => p.title.toLowerCase().includes(playlistSearchQuery.toLowerCase()))
                        .map((playlist) => (
                          <DropdownItem
                            key={playlist.id}
                           
                            onClick={() => {
                              const newSelected = new Set(selectedPlaylists);
                              if (newSelected.has(playlist.id)) {
                                newSelected.delete(playlist.id);
                              } else {
                                newSelected.add(playlist.id);
                              }
                              onSelectedPlaylistsChange?.(newSelected);
                              if (newSelected.size > 0) {
                                onFilterByPlaylistsChange?.(true);
                              } else {
                                onFilterByPlaylistsChange?.(false);
                              }
                            }}
                           selected={selectedPlaylists.has(playlist.id)}>
                            <div className="filter-checkbox">
                              {selectedPlaylists.has(playlist.id) && (
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                  <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                              )}
                            </div>
                            <span className="filter-item-label">{playlist.title}</span>
                          </DropdownItem>
                        ))}
                    </DropdownList>
                    <DropdownFooter>
                      <div className="filter-footer-left">
                        <Button variant="ghost" bare
                         
                          onClick={() => {
                            onSelectedPlaylistsChange?.(new Set(playlists.map(p => p.id)));
                            onFilterByPlaylistsChange?.(true);
                          }}
                        >
                          Select All
                        </Button>
                        <Button variant="ghost" bare
                          type="button"
                         
                          onClick={() => {
                            onSelectedPlaylistsChange?.(new Set());
                            onFilterByPlaylistsChange?.(false);
                          }}
                        >
                          Unselect All
                        </Button>
                      </div>
                      <div className="filter-toggle-wrapper">
                        <span className="filter-toggle-label">
                          {filterByPlaylists ? 'On' : 'Off'}
                        </span>
                        <Toggle
                          checked={filterByPlaylists}
                          onChange={(checked) => onFilterByPlaylistsChange?.(checked)}
                          ariaLabel={filterByPlaylists ? 'Turn playlist filter off' : 'Turn playlist filter on'}
                        />
                      </div>
                    </DropdownFooter>
                  </DropdownPanel>
                )}
              </div>
            )}

            {/* Filter by Videos Dropdown */}
            {allVideos.length > 0 && onFilterByVideosChange && (
              <div className="rt-dropdown-anchor" ref={videoDropdownRef}>
                <DropdownTrigger variant="ghost" bare
                 
                  onClick={() => setShowVideoDropdown(!showVideoDropdown)}
                  title="Filter by videos"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
                  </svg>
                  Videos
                  {filterByVideos && selectedVideos.size > 0 && (
                    <span className="filter-badge">{selectedVideos.size}</span>
                  )}
                </DropdownTrigger>
                {showVideoDropdown && (
                  <DropdownPanel align="right">
                    <DropdownHeader>
                      <input
                        type="text"
                        className="rt-dropdown-search-input"
                        placeholder="Search videos..."
                        value={videoSearchQuery}
                        onChange={(e) => setVideoSearchQuery(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </DropdownHeader>
                    <DropdownList>
                      {allVideos
                        .filter(v => v.title.toLowerCase().includes(videoSearchQuery.toLowerCase()))
                        .map((video) => (
                          <DropdownItem
                            key={video.videoId}
                           
                            onClick={() => {
                              const newSelected = new Set(selectedVideos);
                              if (newSelected.has(video.videoId)) {
                                newSelected.delete(video.videoId);
                              } else {
                                newSelected.add(video.videoId);
                              }
                              onSelectedVideosChange?.(newSelected);
                              if (newSelected.size > 0) {
                                onFilterByVideosChange?.(true);
                              } else {
                                onFilterByVideosChange?.(false);
                              }
                            }}
                           selected={selectedVideos.has(video.videoId)}>
                            <div className="filter-checkbox">
                              {selectedVideos.has(video.videoId) && (
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                  <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                              )}
                            </div>
                            <span className="filter-item-label">{video.title}</span>
                          </DropdownItem>
                        ))}
                    </DropdownList>
                    <DropdownFooter>
                      <div className="filter-footer-left">
                        <Button variant="ghost" bare
                         
                          onClick={() => {
                            onSelectedVideosChange?.(new Set(allVideos.map(v => v.videoId)));
                            onFilterByVideosChange?.(true);
                          }}
                        >
                          Select All
                        </Button>
                        <Button variant="ghost" bare
                          type="button"
                         
                          onClick={() => {
                            onSelectedVideosChange?.(new Set());
                            onFilterByVideosChange?.(false);
                          }}
                        >
                          Unselect All
                        </Button>
                      </div>
                      <div className="filter-toggle-wrapper">
                        <span className="filter-toggle-label">
                          {filterByVideos ? 'On' : 'Off'}
                        </span>
                        <Toggle
                          checked={filterByVideos}
                          onChange={(checked) => onFilterByVideosChange?.(checked)}
                          ariaLabel={filterByVideos ? 'Turn video filter off' : 'Turn video filter on'}
                        />
                      </div>
                    </DropdownFooter>
                  </DropdownPanel>
                )}
              </div>
            )}

            {/* Dimensions Selection Dropdown */}
            {onSelectedDimensionsChange && (
              <div className="rt-dropdown-anchor" ref={dimensionsDropdownRef}>
                <DropdownTrigger variant="ghost" bare
                 
                  onClick={() => setShowDimensionsDropdown(!showDimensionsDropdown)}
                  title="Select dimension columns to show"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
                  </svg>
                  Dimensions
                  <span className="filter-badge">{effectiveSelectedDimensions.size}</span>
                </DropdownTrigger>
                {showDimensionsDropdown && (
                  <DropdownPanel align="right">
                    <DropdownHeader>
                      <DropdownTitle>Show Dimensions</DropdownTitle>
                    </DropdownHeader>
                    <DropdownList>
                      {dimensionOptions.map((dim) => {
                        const isSelected = effectiveSelectedDimensions.has(dim.id);
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
                    <DropdownFooter>
                      <div className="filter-footer-left">
                        <Button variant="ghost" bare onClick={() => handleSelectAllDimensions(true)}>Select All</Button>
                        <Button variant="ghost" bare onClick={() => handleSelectAllDimensions(false)}>Unselect All</Button>
                      </div>
                    </DropdownFooter>
                  </DropdownPanel>
                )}
              </div>
            )}

            {/* Metrics Selection Dropdown */}
            {onSelectedMetricsChange && (
              <div className="rt-dropdown-anchor" ref={metricsDropdownRef}>
                <DropdownTrigger variant="ghost" bare
                 
                  onClick={() => setShowMetricsDropdown(!showMetricsDropdown)}
                  title="Select columns to show"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 3h18v18H3zM9 3v18M15 3v18M3 9h18M3 15h18" />
                  </svg>
                  Metrics
                  <span className="filter-badge">{effectiveSelectedMetrics.size}</span>
                </DropdownTrigger>
                {showMetricsDropdown && (
                  <DropdownPanel align="right">
                    <DropdownHeader>
                      <DropdownTitle>Show Metrics</DropdownTitle>
                    </DropdownHeader>
                    <DropdownList>
                      {metricOptions.map((metric) => {
                        const isSelected = effectiveSelectedMetrics.has(metric.id);
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
                    <DropdownFooter>
                      <div className="filter-footer-left">
                        <Button variant="ghost" bare
                         
                          onClick={() => handleSelectAllMetrics(true)}
                        >
                          Select All
                        </Button>
                        <Button variant="ghost" bare
                         
                          onClick={() => handleSelectAllMetrics(false)}
                        >
                          Unselect All
                        </Button>
                      </div>
                    </DropdownFooter>
                  </DropdownPanel>
                )}
              </div>
            )}

            {/* Sort Dropdown */}
            <div className="rt-dropdown-anchor" ref={sortDropdownRef}>
              <DropdownTrigger variant="ghost" bare
               
                onClick={() => setShowSortDropdown(!showSortDropdown)}
                title="Sort videos by metric"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 9l4-4 4 4M7 5v14M21 15l-4 4-4-4M17 19V5" />
                </svg>
                Sort
                {sorting.length > 0 && (
                  <span className="filter-badge">
                    {sortLabels[sorting[0].id as SortableField] || sorting[0].id}
                    {sorting[0].desc ? ' ↓' : ' ↑'}
                  </span>
                )}
              </DropdownTrigger>
              {showSortDropdown && (
                <DropdownPanel align="right">
                  <DropdownHeader>
                    <DropdownTitle>Sort By</DropdownTitle>
                  </DropdownHeader>
                  <DropdownList>
                    {(Object.entries(sortLabels) as [SortableField, string][]).map(([field, label]) => {
                      const active = sorting.find(s => s.id === field);
                      return (
                        <DropdownItem
                          key={field}
                         
                          onClick={() => {
                            if (active) {
                              // Already sorted by this field -- toggle direction or remove
                              if (active.desc) {
                                setSorting([{ id: field, desc: false }]);
                              } else {
                                setSorting([]);
                              }
                            } else {
                              setSorting([{ id: field, desc: true }]);
                            }
                            setShowSortDropdown(false);
                          }}
                         selected={active}>
                          <div className="filter-checkbox">
                            {active && (
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                <polyline points="20 6 9 17 4 12"></polyline>
                              </svg>
                            )}
                          </div>
                          <span className="filter-item-label">{label}</span>
                          {active && (
                            <span className="sort-direction-indicator" style={{ marginLeft: 'auto', fontWeight: 600 }}>
                              {active.desc ? '↓' : '↑'}
                            </span>
                          )}
                        </DropdownItem>
                      );
                    })}
                  </DropdownList>
                  {sorting.length > 0 && (
                    <DropdownFooter>
                      <DropdownTrigger variant="ghost" bare onClick={() => { setSorting([]); setShowSortDropdown(false); }}>
                        Clear Sort
                      </DropdownTrigger>
                    </DropdownFooter>
                  )}
                </DropdownPanel>
              )}
            </div>

            {/* Playlist Meta Selection Dropdown */}
            {playlists.length > 0 && (
              <div className="rt-dropdown-anchor" ref={playlistMetaDropdownRef}>
                <DropdownTrigger variant="ghost" bare
                 
                  onClick={() => setShowPlaylistMetaDropdown(!showPlaylistMetaDropdown)}
                  title="Select playlist columns to show"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2H2v10h10V2zM22 2h-8v10h8V2zM12 14H2v8h10v-8zM22 14h-8v8h8v-8z" />
                  </svg>
                  Playlist Meta
                  <span className="filter-badge">{effectiveSelectedPlaylistMetas.size}</span>
                </DropdownTrigger>
                {showPlaylistMetaDropdown && (
                  <DropdownPanel align="right">
                    <DropdownHeader>
                      <DropdownTitle>Playlist Columns</DropdownTitle>
                    </DropdownHeader>
                    <DropdownList>
                      {playlistMetaOptions.map((meta) => {
                        const isSelected = effectiveSelectedPlaylistMetas.has(meta.id);
                        return (
                          <DropdownItem
                            key={meta.id}
                           
                            onClick={() => handlePlaylistMetaToggle(meta.id)}
                           selected={isSelected}>
                            <div className="filter-checkbox">
                              {isSelected && (
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                  <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                              )}
                            </div>
                            <span className="filter-item-label">{meta.label}</span>
                          </DropdownItem>
                        );
                      })}
                    </DropdownList>
                    <DropdownFooter>
                      <div className="filter-footer-left">
                        <Button variant="ghost" bare
                         
                          onClick={() => handleSelectAllPlaylistMetas(true)}
                        >
                          Select All
                        </Button>
                        <Button variant="ghost" bare
                         
                          onClick={() => handleSelectAllPlaylistMetas(false)}
                        >
                          Unselect All
                        </Button>
                      </div>
                    </DropdownFooter>
                  </DropdownPanel>
                )}
              </div>
            )}
          </div>
          
          <div className="table-header-actions secondary">
            <div className="search-input-wrapper-table">
              <input
                type="text"
                className="table-search-input"
                placeholder="Search videos..."
                value={videoSearchQuery}
                onChange={(e) => setVideoSearchQuery(e.target.value)}
              />
              {videoSearchQuery && (
                <Button variant="ghost" bare onClick={() => setVideoSearchQuery('')}>&times;</Button>
              )}
            </div>

            <Button
              variant="secondary"
              size="sm"
             
              onClick={handleCopyTable}
              title="Copy table to clipboard"
            >
              {copySuccess ? (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                  Copied!
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
                  </svg>
                  Copy Table
                </>
              )}
            </Button>
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
            {onShare && (
              <Button
                variant="secondary"
                size="sm"
               
                onClick={onShare}
                title="Share this page"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="18" cy="5" r="3"></circle>
                  <circle cx="6" cy="12" r="3"></circle>
                  <circle cx="18" cy="19" r="3"></circle>
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                </svg>
                Share
              </Button>
            )}
          </div>
        </div>
      </div>
      {/* Top scrollbar mirror */}
      <div className="table-scroll-area">
        {/* Left scroll button */}
        {canScrollLeft && (
          <Button bare
            className="table-scroll-btn table-scroll-btn--left"
            onClick={() => scrollTable('left')}
            title="Scroll table left"
            aria-label="Scroll table left"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </Button>
        )}
        {/* Right scroll button */}
        {canScrollRight && (
          <Button bare
            className="table-scroll-btn table-scroll-btn--right"
            onClick={() => scrollTable('right')}
            title="Scroll table right"
            aria-label="Scroll table right"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </Button>
        )}
        <div className={`table-card ${displayVideos.length > 10 ? 'table-card--paginated' : ''}`}>
        <TableContainer
          component={Paper}
          className={`table-wrapper ${displayVideos.length > 10 ? 'has-pagination' : ''} ${shouldVirtualizeRows ? 'table-wrapper--virtualized' : ''}`}
          ref={tableWrapperRef}
        >
        <table className="rt-data-table video-table">
          <thead>
            <tr>
              <th className="checkbox-header">
                <input
                  type="checkbox"
                  className="row-checkbox"
                  checked={allChecked}
                  ref={el => { if (el) el.indeterminate = someChecked; }}
                  onChange={e => handleCheckAll(e.target.checked)}
                  title="Select all"
                />
              </th>
              <th>#</th>
              {effectiveSelectedDimensions.has('thumbnail') && <th>Video Thumbnail URL</th>}
              {effectiveSelectedDimensions.has('title') && <th>Video Title</th>}
              {effectiveSelectedDimensions.has('videoId') && <th>Video ID</th>}
              {effectiveSelectedDimensions.has('type') && <th>Video Type</th>}
              {effectiveSelectedDimensions.has('status') && <th>Status</th>}
              {effectiveSelectedMetrics.has('publishedAt') && (
                <th 
                  className={`sortable ${sorting.find(s => s.id === 'publishedAt') ? 'active' : ''}`}
                  onClick={() => handleSort('publishedAt')}
                >
                  Publish Date
                  <SortIcon field="publishedAt" sorting={sorting} />
                </th>
              )}
              {effectiveSelectedDimensions.has('duration') && <th title="Video duration">Duration</th>}
              {effectiveSelectedMetrics.has('viewCount') && (
                <th 
                  className={`sortable ${sorting.find(s => s.id === 'viewCount') ? 'active' : ''}`}
                  onClick={() => handleSort('viewCount')}
                  title={viewsColumnTooltip}
                  style={{ textAlign: 'center' }}
                >
                  {viewsColumnLabel}
                  <SortIcon field="viewCount" sorting={sorting} />
                </th>
              )}
              {effectiveSelectedMetrics.has('likeCount') && (
                <th 
                  className={`sortable ${sorting.find(s => s.id === 'likeCount') ? 'active' : ''}`}
                  onClick={() => handleSort('likeCount')}
                  title="Total likes for this video"
                  style={{ textAlign: 'center' }}
                >
                  Video Likes
                  <SortIcon field="likeCount" sorting={sorting} />
                </th>
              )}
              {effectiveSelectedMetrics.has('commentCount') && (
                <th 
                  className={`sortable ${sorting.find(s => s.id === 'commentCount') ? 'active' : ''}`}
                  onClick={() => handleSort('commentCount')}
                  title="Total comments on this video"
                  style={{ textAlign: 'center' }}
                >
                  Video Comments
                  <SortIcon field="commentCount" sorting={sorting} />
                </th>
              )}
              {effectiveSelectedMetrics.has('retention') && (
                <th
                  className={`sortable ${sorting.find(s => s.id === 'retention') ? 'active' : ''}`}
                  onClick={() => handleSort('retention')}
                  title="Average percentage of the video watched"
                  style={{ textAlign: 'center' }}
                >
                  Retention (%)
                  <SortIcon field="retention" sorting={sorting} />
                </th>
              )}
              {effectiveSelectedMetrics.has('averageViewDuration') && (
                <th
                  className={`sortable ${sorting.find(s => s.id === 'averageViewDuration') ? 'active' : ''}`}
                  onClick={() => handleSort('averageViewDuration')}
                  title="Average view duration in seconds"
                  style={{ textAlign: 'center' }}
                >
                  Avg View Duration
                  <SortIcon field="averageViewDuration" sorting={sorting} />
                </th>
              )}
              {effectiveSelectedMetrics.has('engagedViews') && (
                <th
                  className={`sortable ${sorting.find(s => s.id === 'engagedViews') ? 'active' : ''}`}
                  onClick={() => handleSort('engagedViews')}
                  title="Engaged views: favorited, liked, commented, shared, or subscribed"
                  style={{ textAlign: 'center' }}
                >
                  Engaged Views
                  <SortIcon field="engagedViews" sorting={sorting} />
                </th>
              )}
              {effectiveSelectedMetrics.has('estimatedMinutesWatched') && (
                <th
                  className={`sortable ${sorting.find(s => s.id === 'estimatedMinutesWatched') ? 'active' : ''}`}
                  onClick={() => handleSort('estimatedMinutesWatched')}
                  title="Watch time in minutes for this video (range-scoped)"
                  style={{ textAlign: 'center' }}
                >
                  Watch Time
                  <SortIcon field="estimatedMinutesWatched" sorting={sorting} />
                </th>
              )}
              {effectiveSelectedDimensions.has('description') && <th>Video Description</th>}
              {effectiveSelectedDimensions.has('tags') && <th>Video Tags</th>}
              {canShowPlaylistMetaColumns && effectiveSelectedPlaylistMetas.has('title') && <th>Playlists Title</th>}
              {canShowPlaylistMetaColumns && effectiveSelectedPlaylistMetas.has('id') && <th className="monospace-header">Playlist ID</th>}
              {canShowPlaylistMetaColumns && effectiveSelectedPlaylistMetas.has('description') && (
                <th className="description-header">Playlist Description</th>
              )}
              {canShowPlaylistMetaColumns && effectiveSelectedPlaylistMetas.has('keywords') && <th>Playlists Keywords</th>}
              {canShowPlaylistMetaColumns && effectiveSelectedPlaylistMetas.has('tags') && <th>Playlists Tags</th>}
              {canShowPlaylistMetaColumns && effectiveSelectedPlaylistMetas.has('thumbnailUrl') && (
                <th>Playlist Thumbnail URL</th>
              )}
              <th className="actions-header">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && videos.length === 0 ? (
              <tr>
                <td colSpan={14} className="loading-table-cell">
                   <SkeletonVideoTable rows={pagination.pageSize} />
                </td>
              </tr>
            ) : displayVideos.length === 0 ? (
              <tr>
                <td
                  colSpan={
                    showChannelColumn && canShowPlaylistMetaColumns
                      ? 14
                      : showChannelColumn || canShowPlaylistMetaColumns
                        ? 13
                        : 12
                  }
                  className="empty-table-message"
                >
                  <EmptyState
                    variant={videos.length === 0 ? 'zero' : 'no-results'}
                    title={videos.length === 0 ? 'No Videos Loaded' : 'No Videos Match Filters'}
                    description={
                      videos.length === 0
                        ? 'No videos loaded for this channel yet. Click Load in the filter bar, or adjust content type.'
                        : 'No videos match your active filter or search criteria.'
                    }
                    action={
                      videos.length === 0 ? (
                        onRetryVideos ? (
                          <Button variant="secondary" size="sm" onClick={() => void onRetryVideos()}>
                            Reload Videos
                          </Button>
                        ) : undefined
                      ) : (
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              if (onFilterByPlaylistsChange) onFilterByPlaylistsChange(false);
                              if (onFilterByVideosChange) onFilterByVideosChange(false);
                              if (onSelectedPlaylistsChange) onSelectedPlaylistsChange(new Set());
                              if (onSelectedVideosChange) onSelectedVideosChange(new Set());
                              setVideoSearchQuery('');
                            }}
                          >
                            Clear All Filters
                          </Button>
                          {onRetryVideos && (
                            <Button variant="secondary" size="sm" onClick={() => void onRetryVideos()}>
                              Reload Videos
                            </Button>
                          )}
                        </div>
                      )
                    }
                  />
                </td>
              </tr>
            ) : (
              <>
              {shouldVirtualizeRows && virtualPaddingTop > 0 && (
                <tr>
                  <td
                    colSpan={
                      showChannelColumn && canShowPlaylistMetaColumns
                        ? 14
                        : showChannelColumn || canShowPlaylistMetaColumns
                          ? 13
                          : 12
                    }
                    style={{ height: `${virtualPaddingTop}px`, padding: 0, border: 'none' }}
                  />
                </tr>
              )}
              {(shouldVirtualizeRows ? virtualRows.map((row) => row.index) : sortedVideos.map((_, index: number) => index)).map((index: number) => {
                const video = sortedVideos[index];
                const rowNumber = table.getState().pagination.pageIndex * table.getState().pagination.pageSize + index + 1;
                return (
                <tr
                  key={`${video.videoId}-${video.sourcePlaylistIds?.[0] || 'none'}-${index}`}
                  className={`${video.isUnavailable ? 'row-unavailable' : ''} ${!checkedVideoIds.has(video.videoId) ? 'row-unchecked' : ''}`}
                  ref={shouldVirtualizeRows ? videoRowVirtualizer.measureElement : undefined}
                  data-index={index}
                >
                  <td className="checkbox-cell">
                    <input
                      type="checkbox"
                      className="row-checkbox"
                      checked={checkedVideoIds.has(video.videoId)}
                      onChange={e => handleCheckVideo(video.videoId, e.target.checked)}
                    />
                  </td>
                  <td>{rowNumber}</td>
                  {effectiveSelectedDimensions.has('thumbnail') && (
                    <td>
                      <img src={video.thumbnailUrl} alt={video.title} className="thumbnail" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                    </td>
                  )}
                  {effectiveSelectedDimensions.has('title') && (
                    <td className="title-cell">
                      <div className="title-cell-content">
                        <a
                          href={video.isUnavailable ? '#' : `https://www.youtube.com/watch?v=${video.videoId}`}
                          target={video.isUnavailable ? undefined : "_blank"}
                          rel={video.isUnavailable ? undefined : "noopener noreferrer"}
                          className={`title-link ${video.isUnavailable ? 'unavailable' : ''}`}
                          onClick={(e) => {
                            if (video.isUnavailable) { e.preventDefault(); return; }
                            e.preventDefault(); // Don't navigate -- open dialog instead
                            onVideoClick?.(video);
                          }}
                          title={video.title}
                        >
                          {video.title}
                        </a>
                          {video.isUnavailable && <span className="unavailable-badge">Unavailable</span>}
                          {(() => {
                            const pubDate = new Date(video.publishedAt);
                            const now = new Date();
                            const diffDays = (now.getTime() - pubDate.getTime()) / (1000 * 3600 * 24);
                            return diffDays < 7 ? <span className="new-badge">NEW</span> : null;
                          })()}
                          <Button variant="secondary" bare
                           
                            onClick={() => handleCopyVideoUrl(video.videoId)}
                            title="Copy video URL"
                          >
                            {copiedVideoId === video.videoId ? (
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="20 6 9 17 4 12"></polyline>
                              </svg>
                            ) : (
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                              </svg>
                            )}
                          </Button>
                      </div>
                    </td>
                  )}
                  {effectiveSelectedDimensions.has('videoId') && <td className="video-id-cell" title={video.videoId}>{video.videoId}</td>}
                  {effectiveSelectedDimensions.has('type') && (
                    <td>
                      <span className={`badge ${getVideoType(video.duration).toLowerCase()}`}>
                        {getVideoType(video.duration)}
                      </span>
                    </td>
                  )}
                  {effectiveSelectedDimensions.has('status') && (
                    <td>
                      <span className={`status-badge ${privacyClass(video.privacyStatus)}`}>
                        {privacyLabel(video.privacyStatus)}
                      </span>
                    </td>
                  )}
                  {effectiveSelectedMetrics.has('publishedAt') && <td className="date-cell">{formatDate(video.publishedAt)}</td>}
                  {effectiveSelectedDimensions.has('duration') && (
                    <td className="number-cell" title={video.duration}>
                      {formatDuration(video.duration)}
                    </td>
                  )}
                  {effectiveSelectedMetrics.has('viewCount') && <td className="number-cell" title={formatNumberFull(video.viewCount)}>{formatNumber(video.viewCount)}</td>}
                  {effectiveSelectedMetrics.has('likeCount') && <td className="number-cell" title={formatNumberFull(video.likeCount)}>{formatNumber(video.likeCount)}</td>}
                  {effectiveSelectedMetrics.has('commentCount') && <td className="number-cell" title={formatNumberFull(video.commentCount)}>{formatNumber(video.commentCount)}</td>}
                  {effectiveSelectedMetrics.has('retention') && (
                     <td className="number-cell retention-cell">
                        {video.retention !== undefined ? `${video.retention.toFixed(1)}%` : <Box component="span" sx={{ color: 'var(--rt-color-text-secondary)' }}>N/A</Box>}
                     </td>
                  )}
                  {effectiveSelectedMetrics.has('averageViewDuration') && (
                     <td className="number-cell avg-view-duration-cell">
                        {video.averageViewDuration !== undefined ? formatSeconds(video.averageViewDuration) : <Box component="span" sx={{ color: 'var(--rt-color-text-secondary)' }}>N/A</Box>}
                     </td>
                  )}
                  {effectiveSelectedMetrics.has('engagedViews') && (
                     <td className="number-cell engaged-views-cell">
                        {video.engagedViews !== undefined ? video.engagedViews.toLocaleString() : <Box component="span" sx={{ color: 'var(--rt-color-text-secondary)' }}>N/A</Box>}
                     </td>
                  )}
                  {effectiveSelectedMetrics.has('estimatedMinutesWatched') && (
                     <td className="number-cell watch-time-cell">
                        {video.estimatedMinutesWatched !== undefined ? formatMinutes(video.estimatedMinutesWatched) : <Box component="span" sx={{ color: 'var(--rt-color-text-secondary)' }}>N/A</Box>}
                     </td>
                  )}
                   {effectiveSelectedDimensions.has('description') && (
                     <td className="description-cell" title={video.description ?? ''}>
                       {video.description
                         ? video.description.length > 100
                           ? video.description.substring(0, 100) + '...'
                           : video.description
                         : '-'}
                     </td>
                   )}
                   {effectiveSelectedDimensions.has('tags') && (
                      <td className="tags-cell">
                        {video.tags && video.tags.length > 0 ? (
                          <div className="tag-pills">
                            {video.tags.map((tag, i) => (
                              <span key={i} className="tag-pill tag-pill--clickable" title={`Filter by "${tag}"`} onClick={() => setVideoSearchQuery(tag)}>{tag}</span>
                            ))}
                          </div>
                        ) : (
                          <span className="playlist-empty">-</span>
                        )}
                      </td>
                   )}
                     {canShowPlaylistMetaColumns && effectiveSelectedPlaylistMetas.has('title') && (
                       <td className="playlist-cell">
                          {video.sourcePlaylistIds && video.sourcePlaylistIds.length > 0 ? (
                            <div className="metadata-groups">
                              {video.sourcePlaylistIds.map((id, i) => (
                                <div key={i} className="metadata-group">
                                  {getSinglePlaylistData(id, 'title').map((title, j) => (
                                    <span key={j} className="playlist-pill" title={title}>{title}</span>
                                  ))}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="playlist-empty">-</span>
                          )}
                       </td>
                     )}
                     {canShowPlaylistMetaColumns && effectiveSelectedPlaylistMetas.has('id') && (
                       <td className="playlist-cell monospace">
                          {video.sourcePlaylistIds && video.sourcePlaylistIds.length > 0 ? (
                            <div className="metadata-groups">
                              {video.sourcePlaylistIds.map((id, i) => (
                                <div key={i} className="metadata-group">
                                  {getSinglePlaylistData(id, 'id').map((pid, j) => (
                                    <span key={j} className="playlist-pill monospace" title={pid}>{pid}</span>
                                  ))}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="playlist-empty">-</span>
                          )}
                       </td>
                     )}
                     {canShowPlaylistMetaColumns && effectiveSelectedPlaylistMetas.has('description') && (
                       <td className="playlist-cell description-cell">
                          {video.sourcePlaylistIds && video.sourcePlaylistIds.length > 0 ? (
                            <div className="metadata-groups">
                              {video.sourcePlaylistIds.map((id, i) => (
                                <div key={i} className="metadata-group">
                                  {getSinglePlaylistData(id, 'description').map((d, j) => (
                                    <div key={j} className="description-text-block" title={d}>
                                      {d.length > 100 ? d.substring(0, 100) + '...' : d}
                                    </div>
                                  ))}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="playlist-empty">-</span>
                          )}
                       </td>
                     )}
                    {canShowPlaylistMetaColumns && effectiveSelectedPlaylistMetas.has('keywords') && (
                       <td className="playlist-cell">
                         {video.sourcePlaylistIds && video.sourcePlaylistIds.length > 0 ? (
                           <div className="metadata-groups">
                             {video.sourcePlaylistIds.map((id, i) => {
                               const kws = getSinglePlaylistData(id, 'keywords');
                               return (
                                 <div key={i} className="metadata-group">
                                   {kws.length > 0 ? (
                                     <div className="tag-pills">
                                       {kws.map((kw, j) => (
                                         <span key={j} className="tag-pill" title={kw}>
                                           {kw.length > 50 ? kw.substring(0, 50) + '...' : kw}
                                         </span>
                                       ))}
                                     </div>
                                   ) : (
                                     <span className="playlist-empty">-</span>
                                   )}
                                 </div>
                               );
                             })}
                           </div>
                         ) : (
                           <span className="playlist-empty">-</span>
                         )}
                       </td>
                    )}
                    {canShowPlaylistMetaColumns && effectiveSelectedPlaylistMetas.has('thumbnailUrl') && (
                       <td className="playlist-cell">
                         {video.sourcePlaylistIds && video.sourcePlaylistIds.length > 0 ? (
                           <div className="metadata-groups">
                             {video.sourcePlaylistIds.map((id, i) => {
                               const urls = getSinglePlaylistData(id, 'thumbnailUrl');
                               return (
                                 <div key={i} className="metadata-group">
                                   {urls.map((u, j) => (
                                     <img key={j} src={u} alt="Playlist thumbnail" className="thumbnail-small" referrerPolicy="no-referrer" />
                                   ))}
                                 </div>
                               );
                             })}
                           </div>
                         ) : (
                           <span className="playlist-empty">-</span>
                         )}
                       </td>
                    )}
                     <td className="actions-cell">
                        <div className="action-menu-container" ref={activeActionRow === video.videoId ? actionMenuRef : null}>
                          <Button bare 
                            className={`action-dots-btn ${activeActionRow === video.videoId ? 'active' : ''}`}
                            onClick={() => setActiveActionRow(activeActionRow === video.videoId ? null : video.videoId)}
                            title="Quick Actions"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <circle cx="12" cy="12" r="1"></circle>
                              <circle cx="12" cy="5" r="1"></circle>
                              <circle cx="12" cy="19" r="1"></circle>
                            </svg>
                          </Button>
                          
                          {activeActionRow === video.videoId && (
                            <DropdownPanel align="action">
                              <Button variant="ghost" size="sm" bare onClick={() => { handleCopyVideoUrl(video.videoId); setActiveActionRow(null); }}>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                                </svg>
                                Copy Link
                              </Button>
                              <Button variant="ghost" size="sm" bare onClick={() => { navigator.clipboard.writeText(video.videoId); setCopiedVideoId(video.videoId); setTimeout(() => setCopiedVideoId(null), 2000); setActiveActionRow(null); }}>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
                                </svg>
                                Copy ID
                              </Button>
                              <DropdownItem
                                href={`https://www.youtube.com/watch?v=${video.videoId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={() => setActiveActionRow(null)}
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"></path>
                                  <polyline points="15 3 21 3 21 9"></polyline>
                                  <line x1="10" y1="14" x2="21" y2="3"></line>
                                </svg>
                                View on YouTube
                              </DropdownItem>
                            </DropdownPanel>
                          )}
                        </div>
                     </td>
                </tr>
              );
              })}
              {shouldVirtualizeRows && virtualPaddingBottom > 0 && (
                <tr>
                  <td
                    colSpan={
                      showChannelColumn && canShowPlaylistMetaColumns
                        ? 14
                        : showChannelColumn || canShowPlaylistMetaColumns
                          ? 13
                          : 12
                    }
                    style={{ height: `${virtualPaddingBottom}px`, padding: 0, border: 'none' }}
                  />
                </tr>
              )}
              </>
            )}
          </tbody>
        </table>
        </TableContainer>

        {/* Pagination Controls */}
        {displayVideos.length > 10 && (() => {
          // Backend `totalpages` is counted in backend pages (20/request) while the
          // table pages by rows-per-page, so the exact client page count is derived
          // from the backend-sent catalog total: ceil(total / rowsPerPage).
          // Toolbar search only covers loaded rows, so it uses client counts.
          const searching = videoSearchQuery.trim() !== '';
          const catalogTotal = !searching && typeof totalBackendCount === 'number' && totalBackendCount > 0
            ? totalBackendCount
            : undefined;
          const effectiveTotal = catalogTotal ?? displayVideos.length;
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
                displayVideos.length
              )}{' '}
              of {effectiveTotal} videos
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
                  <span className="spinner-small" aria-label="Loading more videos" />
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
              <label htmlFor="page-size">Rows per page:</label>
              <select
                id="page-size"
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
                <span className="pagination-loading-hint" aria-live="polite">Loading all videos…</span>
              )}
            </div>
          </div>
          );
        })()}
        </div>
      </div>
    </div>
  );
};


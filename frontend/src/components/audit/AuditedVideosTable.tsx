// ─────────────────────────────────────────────────────────────────────────────
// AuditedVideosTable — extracted from AuditOrchestratorPage.tsx
// Shows all videos audited in a Channel Audit run with search, sort, pagination,
// score pills, view counts, and expandable per-video deep analysis rows.
//
// Tailwind CSS + shadcn primitives (Input, Button, NativeSelect, Badge,
// Progress, Tooltip, Typography, Table). Spacing scale: root `gap-4`,
// toolbar `gap-3 p-3 sm:p-4`, table cells `px-4 py-3`, pagination `gap-3 p-3`.
// No `adt-*` / `aop-*` classes, no `sx` props, no custom CSS, no raw hex.
// ─────────────────────────────────────────────────────────────────────────────
import { Fragment, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import {
  Button,
  Badge,
  Input,
  NativeSelect,
  Progress,
  Tooltip,
  Typography,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
  ShadcnTableCell,
} from '../ui';
import { Check, Copy, ExternalLink, Search } from 'lucide-react';
import { ScorePill } from './AuditDataTable';
import { useColumnWidths } from './useColumnWidths';
import { ColGroup, ResizeHandle } from './ResizableColumns';
import type { AuditedVideoItem } from '../../services/auditOrchestratorService';
import { VideoDeepDetail } from '../../pages/audit-orchestrator';

// Column widths for the audited-videos table
const COL_WIDTHS = [40, 380, 90, 130, 130, 100, 90];
const COL_LABELS = ['#', 'Video Title', 'Score', 'Views', 'Published Date', 'Video ID', 'YouTube'];

const SORT_OPTIONS = [
  { value: 'views-desc', label: 'Views: Highest to Lowest' },
  { value: 'views-asc', label: 'Views: Lowest to Highest' },
  { value: 'score-desc', label: 'Score: Highest First' },
  { value: 'score-asc', label: 'Score: Lowest First' },
  { value: 'date-desc', label: 'Published: Newest First' },
  { value: 'date-asc', label: 'Published: Oldest First' },
  { value: 'title-asc', label: 'Title: A → Z' },
  { value: 'title-desc', label: 'Title: Z → A' },
];

export function AuditedVideosTable({ videos = [] }: { videos?: AuditedVideoItem[] }) {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<string>('views-desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { widths, total, startResize } = useColumnWidths(COL_WIDTHS);

  const toggleExpand = (id: string) =>
    setExpandedId((prev) => (prev === id ? null : id));

  const handleCopyId = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    toast.success(`Copied Video ID: ${id}`);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredAndSortedVideos = useMemo(() => {
    let list = [...videos];
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter(
        (v) => v.title?.toLowerCase().includes(q) || v.videoId?.toLowerCase().includes(q),
      );
    }
    list.sort((a, b) => {
      switch (sortBy) {
        case 'views-desc': return (b.viewCount || 0) - (a.viewCount || 0);
        case 'views-asc': return (a.viewCount || 0) - (b.viewCount || 0);
        case 'date-desc':
          return (b.publishedAt ? Date.parse(b.publishedAt) : 0) - (a.publishedAt ? Date.parse(a.publishedAt) : 0);
        case 'date-asc':
          return (a.publishedAt ? Date.parse(a.publishedAt) : 0) - (b.publishedAt ? Date.parse(b.publishedAt) : 0);
        case 'title-asc': return (a.title || '').localeCompare(b.title || '');
        case 'title-desc': return (b.title || '').localeCompare(a.title || '');
        case 'score-desc': return ((b.score as number) || 0) - ((a.score as number) || 0);
        case 'score-asc': return ((a.score as number) || 0) - ((b.score as number) || 0);
        default: return 0;
      }
    });
    return list;
  }, [videos, search, sortBy]);

  const maxViews = useMemo(
    () => Math.max(1, ...videos.map((v) => v.viewCount || 0)),
    [videos],
  );

  const total_rows = filteredAndSortedVideos.length;
  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(total_rows / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedVideos =
    pageSize === 0
      ? filteredAndSortedVideos
      : filteredAndSortedVideos.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  if (videos.length === 0) return null;

  return (
    <section aria-label="Audited videos" className="flex w-full min-w-0 flex-col gap-4">
      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 rounded-[var(--rt-radius-md)] border border-[var(--rt-color-border)] bg-[var(--rt-color-bg-elevated)] p-3 sm:p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <Typography variant="body2" className="truncate font-bold text-[var(--rt-color-text)]">
            Audited Videos ({videos.length})
          </Typography>
          <Typography variant="caption" className="text-[var(--rt-color-text-tertiary)]">
            Order and review video titles, views, publish dates, IDs and YouTube links.
          </Typography>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="min-w-0 sm:w-56">
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search title or ID..."
              aria-label="Search audited videos by title or ID"
              startAdornment={<Search size={14} aria-hidden />}
              clearable
              onClear={() => { setSearch(''); setPage(1); }}
              compact
              className="h-9 text-xs"
            />
          </div>

          <NativeSelect
            value={sortBy}
            onChange={(e) => { setSortBy(e.target.value); setPage(1); }}
            aria-label="Sort audited videos"
            className="h-9 text-xs sm:w-52"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </NativeSelect>
        </div>
      </div>

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      <div className="w-full min-w-0 overflow-x-auto rounded-[var(--rt-radius-lg)] border border-[var(--rt-color-border)] bg-[var(--rt-color-bg-elevated)] shadow-xs">
        <table
          aria-label="audited videos"
          style={{ tableLayout: 'fixed', minWidth: total, width: '100%', borderCollapse: 'collapse' }}
          className="w-full caption-bottom text-sm"
        >
          <ColGroup widths={widths} />
          <TableHeader className="bg-[var(--rt-color-bg-subtle)]">
            <TableRow className="border-b border-[var(--rt-color-border)] bg-[var(--rt-color-bg-subtle)] hover:bg-[var(--rt-color-bg-subtle)]">
              {COL_LABELS.map((label, i) => (
                <TableHead
                  key={label}
                  style={{ width: widths[i], minWidth: widths[i] }}
                  className={`relative px-4 py-3 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap text-[var(--rt-color-text-secondary)] select-none ${i === COL_LABELS.length - 1 ? 'text-right' : 'text-left'}`}
                >
                  {label}
                  <ResizeHandle onResizeStart={(e) => startResize(i, e)} />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedVideos.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <ShadcnTableCell colSpan={COL_LABELS.length} className="px-4 py-8 text-center text-xs text-[var(--rt-color-text-tertiary)] italic">
                  No videos match your search query.
                </ShadcnTableCell>
              </TableRow>
            ) : (
              <>
                {pagedVideos.map((v, index) => {
                  const rank = (currentPage - 1) * pageSize + index + 1;
                  const viewPct = maxViews > 0 ? Math.round(((v.viewCount || 0) / maxViews) * 100) : 0;
                  const ytUrl = v.url || (v.videoId ? `https://www.youtube.com/watch?v=${v.videoId}` : '');
                  const formattedDate = v.publishedAt
                    ? new Date(v.publishedAt).toLocaleDateString(undefined, {
                        year: 'numeric', month: 'short', day: 'numeric',
                      })
                    : '—';
                  const hasDepth = v.score != null || (v.elements && v.elements.length > 0);
                  const isExpanded = expandedId === (v.videoId || String(index));

                  return (
                    <Fragment key={v.videoId || index}>
                      <TableRow
                        onClick={hasDepth ? () => toggleExpand((v.videoId || String(index))) : undefined}
                        className={`border-b border-[var(--rt-color-border)] transition-colors last:border-0 hover:bg-[var(--rt-color-bg-subtle)] ${hasDepth ? 'cursor-pointer' : ''}`}
                      >
                        {/* # */}
                        <ShadcnTableCell className="px-4 py-3 text-xs font-medium text-[var(--rt-color-text-tertiary)]">{rank}</ShadcnTableCell>

                        {/* Title */}
                        <ShadcnTableCell className="min-w-0 px-4 py-3">
                          <span className="block truncate text-xs font-semibold text-[var(--rt-color-text)]" title={v.title}>
                            {v.title}
                          </span>
                          {hasDepth && (
                            <span className="block truncate text-[11px] text-[var(--rt-color-text-tertiary)]">
                              {isExpanded ? 'Click to hide deep analysis' : 'Click to view deep analysis'}
                            </span>
                          )}
                        </ShadcnTableCell>

                        {/* Score */}
                        <ShadcnTableCell className="px-4 py-3">
                          <ScorePill score={v.score != null ? Number(v.score) : null} max={100} />
                        </ShadcnTableCell>

                        {/* Views */}
                        <ShadcnTableCell className="min-w-20 px-4 py-3">
                          <span className="block text-xs font-bold tabular-nums text-[var(--rt-color-text)]">
                            {(v.viewCount || 0).toLocaleString()}
                          </span>
                          <Progress value={viewPct} className="mt-1.5 h-1 bg-[var(--rt-color-bg-muted)]" />
                        </ShadcnTableCell>

                        {/* Published */}
                        <ShadcnTableCell className="whitespace-nowrap px-4 py-3 text-xs text-[var(--rt-color-text-secondary)]">
                          {formattedDate}
                        </ShadcnTableCell>

                        {/* Video ID */}
                        <ShadcnTableCell className="px-4 py-3">
                          {v.videoId ? (
                            <Tooltip title="Click to copy Video ID">
                              <Badge
                                variant="secondary"
                                role="button"
                                tabIndex={0}
                                onClick={(e) => handleCopyId(v.videoId, e)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleCopyId(v.videoId, e as unknown as React.MouseEvent); }}
                                className="max-w-full cursor-pointer gap-1 font-mono text-[11px] hover:border-[var(--rt-color-accent)] hover:text-[var(--rt-color-accent)]"
                              >
                                {copiedId === v.videoId ? <Check size={11} className="shrink-0" /> : <Copy size={11} className="shrink-0" />}
                                <span className="truncate">{v.videoId}</span>
                              </Badge>
                            </Tooltip>
                          ) : (
                            <span className="text-xs text-[var(--rt-color-text-tertiary)]">—</span>
                          )}
                        </ShadcnTableCell>

                        {/* YouTube link */}
                        <ShadcnTableCell className="px-4 py-3 text-right">
                          {ytUrl ? (
                            <Button
                              variant="outline"
                              size="xs"
                              component="a"
                              href={ytUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              startIcon={<ExternalLink size={12} />}
                              onClick={(e) => e.stopPropagation()}
                              className="h-7 px-2 text-[11px]"
                            >
                              Watch
                            </Button>
                          ) : (
                            <span className="text-xs text-[var(--rt-color-text-tertiary)]">—</span>
                          )}
                        </ShadcnTableCell>
                      </TableRow>

                      {/* Expanded deep-dive sub-row */}
                      {isExpanded && hasDepth && (
                        <TableRow className="hover:bg-transparent">
                          <ShadcnTableCell colSpan={COL_LABELS.length} className="border-b border-[var(--rt-color-border)] bg-[var(--rt-color-bg-subtle)] p-0">
                            <div className="p-3 sm:p-4">
                              <VideoDeepDetail item={v} />
                            </div>
                          </ShadcnTableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </>
            )}
          </TableBody>
        </table>
      </div>

      {/* ── Pagination ────────────────────────────────────────────────────── */}
      <div className="flex flex-col items-center justify-between gap-3 rounded-[var(--rt-radius-md)] border border-[var(--rt-color-border)] bg-[var(--rt-color-bg-elevated)] p-3 sm:flex-row">
        <span className="text-xs text-[var(--rt-color-text-tertiary)]">
          Showing {total_rows === 0 ? 0 : (currentPage - 1) * pageSize + 1}–
          {Math.min(currentPage * pageSize, total_rows)} of {total_rows} videos
        </span>

        <div className="flex items-center gap-2">
          <NativeSelect
            compact
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
            aria-label="Videos per page"
            className="h-7 text-xs"
          >
            <option value={10}>10 per page</option>
            <option value={25}>25 per page</option>
            <option value={50}>50 per page</option>
          </NativeSelect>

          <Button
            size="sm"
            variant="outline"
            disabled={currentPage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="h-7 text-xs"
          >
            Previous
          </Button>
          <span className="min-w-12 text-center text-xs font-bold tabular-nums text-[var(--rt-color-text-secondary)]">
            {currentPage} / {totalPages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={currentPage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="h-7 text-xs"
          >
            Next
          </Button>
        </div>
      </div>
    </section>
  );
}

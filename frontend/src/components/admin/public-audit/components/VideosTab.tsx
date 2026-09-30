// ─────────────────────────────────────────────────────────────────────────────
// VideosTab — audited-videos workspace: search + score/type filters, sort
// dropdown, table/cards view switcher, resizable AuditDataTable (clickable
// tri-state headers), video cards, and pagination. Table columns live here
// next to the table that renders them. Shared primitives + Tailwind only.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo } from 'react';
import { ArrowUpRight, Clock3, ExternalLink, Eye, Film, LayoutGrid, MessageCircle, Search, Table2, ThumbsUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  AuditDataTable,
  ScorePill,
  getScorePillVariant,
  type AuditColumnDef,
} from '../../../../components/audit/AuditDataTable';
import {
  Badge,
  Button,
  Card,
  CardContent,
  IconButton,
  Input,
  NativeSelect,
  Tooltip,
  Typography,
} from '../../../ui';
import {
  ELEMENT_ORDER,
  ageLabel,
  engagementRate,
  formatDate,
  formatShort,
  labelForElement,
  scoreTextClass,
  type SortColumnKey,
  type VideoSort,
} from '../publicAuditUtils';
import type { PublicAuditVideo } from '../usePublicAuditPanel';

interface VideosTabProps {
  reportVideoCount: number;
  filteredVideos: PublicAuditVideo[];
  pagedVideos: PublicAuditVideo[];
  videoTotalPages: number;
  currentVideoPage: number;
  viewMode: 'table' | 'cards';
  setViewMode: (v: 'table' | 'cards') => void;
  videoSearch: string;
  setVideoSearch: (v: string) => void;
  scoreTierFilter: 'all' | 'needs-attention' | 'moderate' | 'high';
  setScoreTierFilter: (v: 'all' | 'needs-attention' | 'moderate' | 'high') => void;
  formatFilter: 'all' | 'shorts' | 'long';
  setFormatFilter: (v: 'all' | 'shorts' | 'long') => void;
  sortBy: VideoSort;
  setSortBy: (v: VideoSort) => void;
  videoPageSize: number;
  setVideoPageSize: (v: number) => void;
  setVideoPage: (v: number) => void;
  activeSort: { key: SortColumnKey | null; dir: 'asc' | 'desc' | null };
  onHeaderSort: (key: string) => void;
  onInspect: (video: PublicAuditVideo) => void;
}

export function VideosTab({
  reportVideoCount,
  filteredVideos,
  pagedVideos,
  videoTotalPages,
  currentVideoPage,
  viewMode,
  setViewMode,
  videoSearch,
  setVideoSearch,
  scoreTierFilter,
  setScoreTierFilter,
  formatFilter,
  setFormatFilter,
  sortBy,
  setSortBy,
  videoPageSize,
  setVideoPageSize,
  setVideoPage,
  activeSort,
  onHeaderSort,
  onInspect,
}: VideosTabProps) {
  // Table columns definition for AuditDataTable
  const tableColumns: AuditColumnDef<PublicAuditVideo>[] = useMemo(() => {
    return [
      {
        key: '#',
        label: '#',
        width: 48,
        align: 'center',
        render: (_row, idx) => (
          <span className="font-medium text-xs text-[var(--rt-color-text-tertiary)]">
            {idx + 1}
          </span>
        ),
      },
      {
        key: 'video',
        label: 'Video Details',
        width: 290,
        render: (row) => {
          const thumbUrl = `https://i.ytimg.com/vi/${row.videoId}/hqdefault.jpg`;
          return (
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="relative shrink-0 w-16 h-10 rounded-[var(--rt-radius-sm)] overflow-hidden bg-[var(--rt-color-bg-muted)] border border-[var(--rt-color-border)]">
                <img
                  src={thumbUrl}
                  alt=""
                  loading="lazy"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLElement).style.display = 'none';
                  }}
                />
                {row.durationLabel && (
                  <span className="absolute bottom-0.5 right-0.5 px-1 text-[9px] font-semibold bg-black/80 text-white rounded">
                    {row.durationLabel}
                  </span>
                )}
                {row.definition === 'hd' && (
                  <span className="absolute bottom-0.5 left-0.5 px-1 text-[9px] font-semibold bg-black/80 text-white rounded">
                    HD
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div
                  className="text-xs font-medium text-[var(--rt-color-text)] truncate"
                  title={row.videoTitle || row.videoId}
                >
                  {row.videoTitle || row.videoId}
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-[var(--rt-color-text-tertiary)]">
                  <span>{formatDate(row.publishedAt)}</span>
                  <span>·</span>
                  <a
                    href={`https://www.youtube.com/watch?v=${row.videoId}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-0.5 text-[var(--rt-color-accent)] hover:underline"
                  >
                    <span>Watch</span>
                    <ExternalLink size={10} />
                  </a>
                </div>
              </div>
            </div>
          );
        },
      },
      {
        key: 'views',
        label: 'Views',
        width: 80,
        align: 'center',
        sortable: true,
        render: (row) => (
          <span className="text-xs text-[var(--rt-color-text-secondary)] font-medium">
            {formatShort(row.statistics?.viewCount)}
          </span>
        ),
      },
      {
        key: 'engagement',
        label: 'Eng. Rate',
        width: 85,
        align: 'center',
        sortable: true,
        render: (row) => (
          <span className="text-xs text-[var(--rt-color-text-secondary)] font-medium">
            {engagementRate(row.statistics?.viewCount, row.statistics?.likeCount, row.statistics?.commentCount)}
          </span>
        ),
      },
      // 6 element score columns
      ...ELEMENT_ORDER.map((elKey): AuditColumnDef<PublicAuditVideo> => ({
        key: elKey,
        label: labelForElement(elKey),
        width: 78,
        align: 'center',
        sortable: true,
        render: (row) => {
          const el = row.elements?.find((e) => e.element === elKey);
          if (!el || el.max === 0) return <ScorePill score={null} />;
          return <ScorePill score={el.score} max={el.max} />;
        },
      })),
      // Total score + uplift
      {
        key: 'total',
        label: 'Total Score',
        width: 100,
        align: 'center',
        sortable: true,
        headerStyle: { borderLeft: '1px solid var(--rt-color-border)' },
        cellStyle: { borderLeft: '1px solid var(--rt-color-border)' },
        render: (row) => {
          const hasUplift = (row.projectedTotal ?? row.total) > row.total;
          const delta = (row.projectedTotal ?? row.total) - row.total;
          const variant = getScorePillVariant(row.total, 100);
          return (
            <div className="flex flex-col items-center gap-0.5">
              <ScorePill score={row.total} max={100} variant={variant} />
              {hasUplift && (
                <span
                  className="inline-flex items-center gap-0.5 text-[10px] text-[var(--rt-color-accent)] font-semibold"
                  title={`Fix weak areas to reach ${row.projectedTotal?.toFixed(0)}`}
                >
                  <ArrowUpRight size={10} />
                  <span>+{delta.toFixed(0)}</span>
                </span>
              )}
            </div>
          );
        },
      },
      // Actions
      {
        key: 'inspect',
        label: 'Inspect',
        width: 70,
        align: 'center',
        render: (row) => (
          <Button
            variant="ghost"
            size="xs"
            onClick={(e) => {
              e.stopPropagation();
              onInspect(row);
            }}
            title="Inspect video breakdown"
            aria-label="Inspect video breakdown"
          >
            <Eye size={13} className="text-[var(--rt-color-text-secondary)]" />
          </Button>
        ),
      },
    ];
  }, [onInspect]);

  return (
    <>
      {/* Filter & View Mode Controls Toolbar */}
      <div className="flex flex-col items-stretch justify-between gap-3 rounded-[var(--rt-radius-md)] border border-[var(--rt-color-border)] bg-[var(--rt-color-bg-elevated)] p-3 sm:p-4 md:flex-row md:items-center">
        {/* Search Input */}
        <div className="min-w-0 flex-1 md:min-w-[14rem]">
          <Input
            value={videoSearch}
            onChange={(e) => setVideoSearch(e.target.value)}
            placeholder="Filter videos by title or ID…"
            aria-label="Filter videos by title or ID"
            startAdornment={<Search size={14} aria-hidden />}
            compact
            className="h-8 text-xs"
            clearable
            onClear={() => setVideoSearch('')}
          />
        </div>

        {/* Score Tier Filter */}
        <div className="flex items-center gap-1.5 overflow-x-auto py-0.5" role="group" aria-label="Filter by score tier">
          <span className="mr-0.5 shrink-0 text-xs text-[var(--rt-color-text-tertiary)]">Score:</span>
          <Button
            size="xs"
            variant={scoreTierFilter === 'all' ? 'primary' : 'secondary'}
            onClick={() => setScoreTierFilter('all')}
            className="h-7 shrink-0 px-2.5 text-xs"
          >
            All ({reportVideoCount})
          </Button>
          <Button
            size="xs"
            variant={scoreTierFilter === 'needs-attention' ? 'primary' : 'secondary'}
            onClick={() => setScoreTierFilter('needs-attention')}
            className={cn('h-7 shrink-0 px-2.5 text-xs', scoreTierFilter !== 'needs-attention' && 'text-[var(--rt-color-danger)]')}
          >
            &lt; 50
          </Button>
          <Button
            size="xs"
            variant={scoreTierFilter === 'moderate' ? 'primary' : 'secondary'}
            onClick={() => setScoreTierFilter('moderate')}
            className={cn('h-7 shrink-0 px-2.5 text-xs', scoreTierFilter !== 'moderate' && 'text-[var(--rt-color-warning)]')}
          >
            50 - 79
          </Button>
          <Button
            size="xs"
            variant={scoreTierFilter === 'high' ? 'primary' : 'secondary'}
            onClick={() => setScoreTierFilter('high')}
            className={cn('h-7 shrink-0 px-2.5 text-xs', scoreTierFilter !== 'high' && 'text-[var(--rt-color-success)]')}
          >
            80+
          </Button>
        </div>

        {/* Format Filter */}
        <div className="flex items-center gap-1.5 overflow-x-auto py-0.5" role="group" aria-label="Filter by video format">
          <span className="mr-0.5 shrink-0 text-xs text-[var(--rt-color-text-tertiary)]">Type:</span>
          <Button
            size="xs"
            variant={formatFilter === 'all' ? 'primary' : 'secondary'}
            onClick={() => setFormatFilter('all')}
            className="h-7 shrink-0 px-2.5 text-xs"
          >
            All
          </Button>
          <Button
            size="xs"
            variant={formatFilter === 'shorts' ? 'primary' : 'secondary'}
            onClick={() => setFormatFilter('shorts')}
            className="h-7 shrink-0 px-2.5 text-xs"
          >
            Shorts
          </Button>
          <Button
            size="xs"
            variant={formatFilter === 'long' ? 'primary' : 'secondary'}
            onClick={() => setFormatFilter('long')}
            className="h-7 shrink-0 px-2.5 text-xs"
          >
            Long
          </Button>
        </div>

        {/* Sort & View Mode Switcher */}
        <div className="flex items-center gap-2 shrink-0">
          <NativeSelect
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as VideoSort)}
            aria-label="Sort videos"
            className="h-8 text-xs bg-[var(--rt-color-bg-app)] border-[var(--rt-color-border)]"
          >
            <option value="default">Default Order</option>
            <option value="score-desc">Score: High → Low</option>
            <option value="score-asc">Score: Low → High</option>
            <option value="views-desc">Views: High → Low</option>
            <option value="views-asc">Views: Low → High</option>
            <option value="likes-desc">Likes: High → Low</option>
            <option value="engagement-desc">Eng. Rate: High → Low</option>
            <option value="engagement-asc">Eng. Rate: Low → High</option>
            <option value="title-desc">Title: High → Low</option>
            <option value="title-asc">Title: Low → High</option>
            <option value="description-desc">Description: High → Low</option>
            <option value="description-asc">Description: Low → High</option>
            <option value="tags-desc">Tags: High → Low</option>
            <option value="tags-asc">Tags: Low → High</option>
            <option value="keywords-desc">Keywords: High → Low</option>
            <option value="keywords-asc">Keywords: Low → High</option>
            <option value="thumbnail-desc">Thumbnail: High → Low</option>
            <option value="thumbnail-asc">Thumbnail: Low → High</option>
            <option value="captions-desc">Captions: High → Low</option>
            <option value="captions-asc">Captions: Low → High</option>
          </NativeSelect>

          <div className="flex items-center p-0.5 rounded-[var(--rt-radius-sm)] border border-[var(--rt-color-border)] bg-[var(--rt-color-bg-app)]">
            <Tooltip title="Table View">
              <IconButton
                size="xs"
                variant={viewMode === 'table' ? 'primary' : 'ghost'}
                onClick={() => setViewMode('table')}
                aria-label="Table view"
              >
                <Table2 size={14} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Grid Cards View">
              <IconButton
                size="xs"
                variant={viewMode === 'cards' ? 'primary' : 'ghost'}
                onClick={() => setViewMode('cards')}
                aria-label="Grid cards view"
              >
                <LayoutGrid size={14} />
              </IconButton>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* View Rendering: Table vs Grid Cards */}
      {filteredVideos.length === 0 ? (
        <div className="p-8 text-center border border-[var(--rt-color-border)] rounded-[var(--rt-radius-lg)] bg-[var(--rt-color-bg-elevated)]">
          <Film size={28} className="mx-auto text-[var(--rt-color-text-tertiary)] mb-2" />
          <Typography variant="body2" className="text-[var(--rt-color-text-secondary)]">
            No videos match your current search or filter criteria.
          </Typography>
        </div>
      ) : viewMode === 'table' ? (
        <div className="border border-[var(--rt-color-border)] rounded-[var(--rt-radius-lg)] overflow-hidden bg-[var(--rt-color-bg-elevated)]">
          <AuditDataTable<PublicAuditVideo>
            columns={tableColumns}
            rows={pagedVideos}
            getRowKey={(r) => r.videoId}
            onRowClick={(r) => onInspect(r)}
            emptyMessage="No audited videos found."
                    ariaLabel="Channel audit videos table. Click a column header to sort biggest, lowest, or normal."
            sortKey={activeSort.key}
            sortDir={activeSort.dir}
            onSort={onHeaderSort}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {pagedVideos.map((r) => {
            const thumbUrl = `https://i.ytimg.com/vi/${r.videoId}/hqdefault.jpg`;
            const age = ageLabel(r.publishedAt);
            return (
              <Card
                key={r.videoId}
                className="cursor-pointer border-[var(--rt-color-border)] bg-[var(--rt-color-bg-elevated)] shadow-xs transition-colors hover:border-[var(--rt-color-accent)]/50"
                onClick={() => onInspect(r)}
              >
                <CardContent className="p-4">
                  <div className="flex min-w-0 items-start gap-3">
                    {/* Thumbnail */}
                    <div className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-[var(--rt-radius-sm)] border border-[var(--rt-color-border)] bg-[var(--rt-color-bg-muted)]">
                      <img src={thumbUrl} alt="" loading="lazy" className="w-full h-full object-cover" />
                      {r.durationLabel && (
                        <span className="absolute bottom-1 right-1 px-1 text-[9px] font-bold bg-black/85 text-white rounded">
                          {r.durationLabel}
                        </span>
                      )}
                      {r.definition === 'hd' && (
                        <span className="absolute bottom-1 left-1 px-1 text-[9px] font-bold bg-black/85 text-white rounded">
                          HD
                        </span>
                      )}
                    </div>

                    {/* Info */}
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 truncate text-xs font-semibold text-[var(--rt-color-text)]" title={r.videoTitle}>
                          {r.videoTitle || r.videoId}
                        </span>
                        <Badge variant="secondary" className={cn('shrink-0 font-bold tabular-nums', scoreTextClass(r.total))}>
                          {r.total}
                        </Badge>
                      </div>

                      <div className="flex items-center gap-1.5 text-[11px] text-[var(--rt-color-text-tertiary)]">
                        <span className="min-w-0 truncate">{r.publishedAt ? formatDate(r.publishedAt) : ''}</span>
                        {age && <span className="shrink-0">({age})</span>}
                        {r.projectedTotal !== undefined && (
                          <span className="shrink-0 font-medium text-[var(--rt-color-accent)]">
                            · Fix → {r.projectedTotal}
                          </span>
                        )}
                      </div>

                      {/* Stats Badges */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="secondary" className="gap-1 px-1.5 py-0.5 text-[10px] font-medium">
                          <Eye size={10} aria-hidden /> {formatShort(r.statistics?.viewCount)}
                        </Badge>
                        <Badge variant="secondary" className="gap-1 px-1.5 py-0.5 text-[10px] font-medium">
                          <ThumbsUp size={10} aria-hidden /> {formatShort(r.statistics?.likeCount)}
                        </Badge>
                        <Badge variant="secondary" className="gap-1 px-1.5 py-0.5 text-[10px] font-medium">
                          <MessageCircle size={10} aria-hidden /> {formatShort(r.statistics?.commentCount)}
                        </Badge>
                        <Badge variant="secondary" className="gap-1 px-1.5 py-0.5 text-[10px] font-medium">
                          <Clock3 size={10} aria-hidden /> {engagementRate(r.statistics?.viewCount, r.statistics?.likeCount, r.statistics?.commentCount)}
                        </Badge>
                      </div>

                      {/* Element Score Chips */}
                      <div className="flex flex-wrap gap-1.5">
                        {r.elements?.map((el) => (
                          <Badge
                            key={el.element}
                            variant="outline"
                            className="px-1.5 py-0.5 text-[10px] font-medium"
                          >
                            {labelForElement(el.element)} {el.score}/{el.max}
                          </Badge>
                        ))}
                      </div>

                      {/* Fix first recommendation */}
                      {r.recommendations && r.recommendations.length > 0 && (
                        <div className="flex items-center gap-1 text-[11px] text-[var(--rt-color-warning)]">
                          <ArrowUpRight size={12} className="shrink-0" />
                          <span className="min-w-0 truncate">
                            Fix first: {labelForElement(r.recommendations[0].element)} (+{r.recommendations[0].delta} → {r.recommendations[0].projected})
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {filteredVideos.length > videoPageSize && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-3">
          <span className="text-xs text-[var(--rt-color-text-tertiary)]">
            Showing {(currentVideoPage - 1) * videoPageSize + 1}–{Math.min(currentVideoPage * videoPageSize, filteredVideos.length)} of {filteredVideos.length} videos
          </span>
          <div className="flex items-center gap-2">
            <NativeSelect compact value={videoPageSize} onChange={(e) => { setVideoPageSize(Number(e.target.value)); setVideoPage(1); }} aria-label="Videos per page">
              <option value={10}>10 per page</option>
              <option value={25}>25 per page</option>
              <option value={50}>50 per page</option>
              <option value={100}>100 per page</option>
            </NativeSelect>
            <Button size="sm" variant="outline" disabled={currentVideoPage <= 1} onClick={() => setVideoPage(currentVideoPage - 1)}>Previous</Button>
            <span className="text-xs min-w-20 text-center text-[var(--rt-color-text-secondary)]">Page {currentVideoPage} of {videoTotalPages}</span>
            <Button size="sm" variant="outline" disabled={currentVideoPage >= videoTotalPages} onClick={() => setVideoPage(currentVideoPage + 1)}>Next</Button>
          </div>
        </div>
      )}
    </>
  );
}

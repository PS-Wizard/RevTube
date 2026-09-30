// ─────────────────────────────────────────────────────────────────────────────
// Video Audit -- Results table (per-video element scores)
// Uses shared AuditDataTable component for consistent UI across all audit tools.
// ─────────────────────────────────────────────────────────────────────────────
import { Box, Tooltip, IconButton } from '../../components/ui';
import { ExternalLink, Download, ArrowUpRight, CheckCircle2, Circle } from 'lucide-react';
import { AuditDataTable, ScorePill, getScorePillVariant } from '../../components/audit/AuditDataTable';
import type { AuditColumnDef } from '../../components/audit/AuditDataTable';
import type { VideoAuditVideoResult } from '../../types/videoAudit';
import { downloadIndividualPDF } from '../../services/videoAuditExport';

const ELEMENTS = [
  { key: 'title', label: 'Title' },
  { key: 'description', label: 'Desc' },
  { key: 'tags', label: 'Tags' },
  { key: 'keywords', label: 'Keywords' },
  { key: 'thumbnail', label: 'Thumb' },
  { key: 'captions', label: 'Captions' },
] as const;

const CATEGORY_LABELS = [
  { key: 'discoverability', label: 'Discover' },
  { key: 'contentQuality', label: 'Content' },
  { key: 'visualHook', label: 'Visual' },
] as const;

export function VideoAuditTable({
  results,
  onInspectVideo,
  optimizedIds,
}: {
  results: VideoAuditVideoResult[];
  onInspectVideo?: (videoId: string) => void;
  optimizedIds: Set<string>;
  onToggleOptimized?: (videoId: string, label: string, thumbnailUrl?: string) => void;
}) {
  const columns: AuditColumnDef<VideoAuditVideoResult>[] = [
    // ── Row index ──────────────────────────────────────────────────────────
    {
      key: '#',
      label: '#',
      width: 48,
      render: (_row, idx) => (
        <span className="text-xs font-medium text-[var(--rt-color-text-tertiary)]">{idx + 1}</span>
      ),
    },

    // ── Video details (thumbnail + title + link) ───────────────────────────
    {
      key: 'videoDetails',
      label: 'Video Details',
      width: 280,
      render: (row) => {
        const thumbUrl = `https://i.ytimg.com/vi/${row.videoId}/hqdefault.jpg`;
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
            <Box
              component="img"
              src={thumbUrl}
              alt={row.videoTitle}
              onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
                e.currentTarget.style.display = 'none';
              }}
              sx={{
                width: 44,
                height: 28,
                borderRadius: 'var(--rt-radius-sm)',
                objectFit: 'cover',
                bgcolor: 'var(--rt-color-bg-subtle)',
                border: '1px solid var(--rt-color-border)',
                flexShrink: 0,
              }}
            />
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Box
                sx={{
                  fontSize: 'var(--rt-text-xs)',
                  fontWeight: 'var(--rt-weight-medium)',
                  color: 'var(--rt-color-text)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={row.videoTitle}
              >
                {row.videoTitle}
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.25 }}>
                <a
                  href={`https://www.youtube.com/watch?v=${row.videoId}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '3px',
                    fontSize: 'var(--rt-text-2xs)',
                    color: 'var(--rt-color-accent)',
                    textDecoration: 'none',
                  }}
                >
                  <span>YouTube</span>
                  <ExternalLink size={10} />
                </a>
                <span style={{ fontSize: 'var(--rt-text-2xs)', color: 'var(--rt-color-text-tertiary)' }}>
                  ID: {row.videoId}
                </span>
              </Box>
            </Box>
          </Box>
        );
      },
    },

    // ── Optimized status (display-only) ──────────────────────────────────
    // Intentionally not a toggle: marking optimized lives in the deep-dive
    // accordions below. The matrix just shows optimized or not in a narrow
    // icon column so the score columns keep their space.
    {
      key: 'optimized',
      label: 'Optimized',
      width: 72,
      align: 'center',
      render: (row) => {
        const isOptimized = optimizedIds.has(row.videoId);
        return (
          <Tooltip title={isOptimized ? 'Optimized' : 'Not optimized'} arrow>
            <span
              role="img"
              aria-label={isOptimized ? 'Optimized' : 'Not optimized'}
              style={{ display: 'inline-flex', verticalAlign: 'middle' }}
            >
              {isOptimized ? (
                <CheckCircle2 size={15} style={{ color: 'var(--rt-color-success)' }} />
              ) : (
                <Circle size={15} style={{ color: 'var(--rt-color-border-strong)' }} />
              )}
            </span>
          </Tooltip>
        );
      },
    },

    // ── 6 element score columns ────────────────────────────────────────────
    ...ELEMENTS.map((el): AuditColumnDef<VideoAuditVideoResult> => ({
      key: el.key,
      label: el.label,
      width: 80,
      align: 'center',
      render: (row) => {
        const es = row.elements.find((e) => e.element === el.key);
        const noData = es
          ? es.breakdown.every((b) => b.max === 0 || b.note === 'no data')
          : true;
        if (noData) return <ScorePill score={null} />;
        return <ScorePill score={es!.score} max={es?.max ?? 100} />;
      },
    })),

    // ── 3 category score columns ───────────────────────────────────────────
    ...CATEGORY_LABELS.map((cat): AuditColumnDef<VideoAuditVideoResult> => ({
      key: cat.key,
      label: cat.label,
      width: 80,
      align: 'center',
      headerStyle: cat.key === 'discoverability' ? { borderLeft: '1px dashed var(--rt-color-border)' } : undefined,
      cellStyle: cat.key === 'discoverability' ? { borderLeft: '1px dashed var(--rt-color-border)' } : undefined,
      render: (row) => {
        const cs = (row.categories ?? []).find((c) => c.key === cat.key);
        const catElems = cs?.elements ?? [];
        const catNoData =
          catElems.length === 0 ||
          !catElems.some((en) => {
            const e = row.elements.find((el) => el.element === en);
            return e ? e.breakdown.some((b) => b.max > 0 && b.note !== 'no data') : false;
          });
        if (catNoData) return <ScorePill score={null} />;
        return <ScorePill score={cs!.score} max={100} />;
      },
    })),

    // ── Total score + uplift ───────────────────────────────────────────────
    {
      key: 'total',
      label: 'Total Score',
      width: 90,
      align: 'center',
      headerStyle: { borderLeft: '1px solid var(--rt-color-border)' },
      cellStyle: { borderLeft: '1px solid var(--rt-color-border)' },
      render: (row) => {
        const hasUplift = (row.projectedTotal ?? row.total) > row.total;
        const delta = (row.projectedTotal ?? row.total) - row.total;
        const variant = getScorePillVariant(row.total, 100);
        return (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
            <ScorePill score={row.total} max={100} variant={variant} />
            {hasUplift && (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.25,
                  fontSize: 'var(--rt-text-2xs)',
                  color: 'var(--rt-color-accent)',
                  fontWeight: 'var(--rt-weight-semibold)',
                }}
                title={`Fix weak areas to reach ${row.projectedTotal.toFixed(0)}`}
              >
                <ArrowUpRight size={10} />
                <span>+{delta.toFixed(0)}</span>
              </Box>
            )}
          </Box>
        );
      },
    },

    // ── PDF Export ─────────────────────────────────────────────────────────
    {
      key: 'export',
      label: 'Export',
      width: 64,
      align: 'center',
      render: (row) => (
        <Tooltip title="Download individual PDF report" arrow>
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              downloadIndividualPDF(row);
            }}
            sx={{
              color: 'var(--rt-color-text-secondary)',
              '&:hover': { color: 'var(--rt-color-accent)' },
            }}
          >
            <Download size={14} />
          </IconButton>
        </Tooltip>
      ),
    },
  ];

  return (
    <AuditDataTable<VideoAuditVideoResult>
      columns={columns}
      rows={results}
      getRowKey={(row, idx) => row.videoId || idx}
      onRowClick={onInspectVideo ? (row) => onInspectVideo(row.videoId) : undefined}
      emptyMessage="No videos match your filter criteria."
      ariaLabel="video audit results"
      className="va-table-wrapper"
    />
  );
}

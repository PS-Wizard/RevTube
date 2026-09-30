// ─────────────────────────────────────────────────────────────────────────────
// Thumbnail Optimizer -- Cross-video comparison table
// Uses shared AuditDataTable component for consistent UI across all audit tools.
// ─────────────────────────────────────────────────────────────────────────────
import React from 'react';
import { ExternalLink } from 'lucide-react';
import { AuditDataTable, ScorePill } from '../../components/audit/AuditDataTable';
import type { AuditColumnDef } from '../../components/audit/AuditDataTable';
import { OptimizedToggle } from '../../components/audit/OptimizedToggle';
import { extractVideoId } from '../../services/optimizedFlagService';
import type { ThumbnailAudit } from '../../types/thumbnailOptimizer';

interface AuditTableProps {
  audits: ThumbnailAudit[];
  optimizedIds?: Set<string>;
  onToggleOptimized?: (videoId: string, label: string) => void;
  /** Row click -- expand + smooth-scroll to the video's deep-dive accordion. */
  onInspectVideo?: (videoId: string) => void;
}

export const AuditTable: React.FC<AuditTableProps> = ({
  audits,
  optimizedIds,
  onToggleOptimized,
  onInspectVideo,
}) => {
  const columns: AuditColumnDef<ThumbnailAudit>[] = [
    {
      key: 'sn',
      label: 'S.N.',
      width: 48,
      align: 'center',
      render: (_row, idx) => (
        <span style={{ color: 'var(--rt-color-text-tertiary)', fontWeight: 'var(--rt-weight-medium)' }}>
          {idx + 1}
        </span>
      ),
    },
    {
      key: 'url',
      label: 'YouTube URL',
      width: 130,
      render: (row) => (
        <a
          href={row.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 'var(--rt-text-xs)',
            color: 'var(--rt-color-accent)',
            textDecoration: 'none',
            fontFamily: 'monospace',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: '100%',
          }}
        >
          <span>{row.url.length > 25 ? row.url.substring(0, 25) + '…' : row.url}</span>
          <ExternalLink size={11} style={{ flexShrink: 0 }} />
        </a>
      ),
    },
    {
      key: 'title',
      label: 'Video Title',
      width: 170,
      render: (row) => (
        <span
          style={{
            fontWeight: 'var(--rt-weight-medium)',
            fontSize: 'var(--rt-text-sm)',
            color: 'var(--rt-color-text)',
            display: 'block',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={row.videoTitle}
        >
          {row.videoTitle}
        </span>
      ),
    },
    {
      key: 'summary',
      label: 'Review Summary',
      width: 230,
      render: (row) => (
        <span style={{ fontSize: 'var(--rt-text-xs)', color: 'var(--rt-color-text-secondary)', lineHeight: 1.4 }}>
          {row.reviewSummary}
        </span>
      ),
    },
    {
      key: 'strengths',
      label: 'Strengths',
      width: 210,
      render: (row) => (
        <span style={{ fontSize: 'var(--rt-text-xs)', color: 'var(--rt-color-success)', lineHeight: 1.4 }}>
          {row.strengths}
        </span>
      ),
    },
    {
      key: 'opportunities',
      label: 'Opportunities',
      width: 210,
      render: (row) => (
        <span style={{ fontSize: 'var(--rt-text-xs)', color: 'var(--rt-color-warning)', lineHeight: 1.4 }}>
          {row.opportunities}
        </span>
      ),
    },
    {
      key: 'score',
      label: 'Score',
      width: 64,
      align: 'center',
      render: (row) => <ScorePill score={row.currentScore} max={10} />,
    },
    {
      key: 'target',
      label: 'Target',
      width: 64,
      align: 'center',
      render: (row) => <ScorePill score={row.expectedScore} max={10} />,
    },
    {
      key: 'optimized',
      label: 'Optimized',
      width: 90,
      align: 'center',
      render: (row) => {
        const videoId = extractVideoId(row.url);
        if (!videoId || !onToggleOptimized) return null;
        return (
          <OptimizedToggle
            compact
            optimized={optimizedIds?.has(videoId) ?? false}
            kindLabel="Thumbnail Audit"
            onClick={() => onToggleOptimized(videoId, row.videoTitle)}
          />
        );
      },
    },
  ];

  return (
    <div style={{ margin: '32px 0' }}>
      <div className="rtis-section-title">Cross-Video Comparison</div>
      <div
        style={{
          fontSize: 'var(--rt-text-2xs)',
          color: 'var(--rt-color-text-tertiary)',
          marginBottom: 8,
        }}
      >
        Drag a header's right edge to resize columns · S.N. matches the deep-dive accordion numbers below
      </div>
      <AuditDataTable<ThumbnailAudit>
        columns={columns}
        rows={audits}
        getRowKey={(row, idx) => extractVideoId(row.url) ?? String(idx)}
        onRowClick={
          onInspectVideo
            ? (row) => {
                const videoId = extractVideoId(row.url);
                if (videoId) onInspectVideo(videoId);
              }
            : undefined
        }
        emptyMessage="No thumbnails audited yet."
        ariaLabel="thumbnail audit cross-video comparison"
      />
    </div>
  );
};

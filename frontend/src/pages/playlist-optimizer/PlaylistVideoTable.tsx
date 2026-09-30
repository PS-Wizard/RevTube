// ─────────────────────────────────────────────────────────────────────────────
// PlaylistVideoTable -- "Included Videos & Data" cross-video comparison table.
// Uses shared AuditDataTable component for consistent UI across all audit tools.
// ─────────────────────────────────────────────────────────────────────────────
import { ExternalLink, PlayCircle } from 'lucide-react';
import type { VideoInsight } from '../../types/playlistOptimizer';
import { formatViews } from '../../utils/format';
import { AuditDataTable, ScorePill } from '../../components/audit/AuditDataTable';
import type { AuditColumnDef } from '../../components/audit/AuditDataTable';

interface PlaylistVideoTableProps {
  insights: VideoInsight[];
}

function formatDate(iso?: string): string {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatAge(ageDays?: number): string {
  if (ageDays === undefined || ageDays === null) return '';
  if (ageDays < 1) return 'today';
  if (ageDays < 60) return `${ageDays}d ago`;
  if (ageDays < 730) return `${Math.round(ageDays / 30)}mo ago`;
  return `${(ageDays / 365).toFixed(1)}y ago`;
}

export const PlaylistVideoTable: React.FC<PlaylistVideoTableProps> = ({ insights }) => {
  if (!insights.length) return null;

  const hasDecay = insights.some((i) => i.decayWeight !== undefined);
  const hasChannel = insights.some((i) => i.channelTitle);
  const hasPlaylist = insights.some((i) => i.playlistTitle || i.playlistId);
  const has7 = insights.some((i) => (i.views7 ?? 0) > 0);
  const has30 = insights.some((i) => (i.views30 ?? 0) > 0);
  const has90 = insights.some((i) => (i.views90 ?? 0) > 0);

  const columns: AuditColumnDef<VideoInsight>[] = [
    // ── Video title + YT link ──────────────────────────────────────────────
    {
      key: 'video',
      label: 'Video',
      width: 300,
      render: (row) => (
        <span>
          <span
            style={{
              display: 'inline-block',
              maxWidth: 260,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              verticalAlign: 'bottom',
              color: 'var(--rt-color-text)',
              fontWeight: 'var(--rt-weight-medium)',
              fontSize: 'var(--rt-text-xs)',
            }}
            title={row.title}
          >
            {row.title || 'Untitled'}
          </span>
          {row.url && (
            <a
              href={row.url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              aria-label="Open video on YouTube"
              style={{
                marginLeft: 6,
                display: 'inline-flex',
                alignItems: 'center',
                color: 'var(--rt-color-accent)',
                verticalAlign: 'middle',
              }}
            >
              <ExternalLink size={12} />
            </a>
          )}
        </span>
      ),
    },

    // ── Optional channel column ────────────────────────────────────────────
    ...(hasChannel
      ? ([
          {
            key: 'channel',
            label: 'Channel',
            width: 130,
            render: (row) => (
              <span style={{ color: 'var(--rt-color-text-secondary)', fontSize: 'var(--rt-text-xs)' }}>
                {row.channelTitle || '–'}
              </span>
            ),
          },
        ] as AuditColumnDef<VideoInsight>[])
      : []),

    // ── Optional playlist column ───────────────────────────────────────────
    ...(hasPlaylist
      ? ([
          {
            key: 'playlist',
            label: 'Playlist',
            width: 130,
            render: (row) => (
              <span style={{ color: 'var(--rt-color-text-secondary)', fontSize: 'var(--rt-text-xs)' }}>
                {row.playlistTitle || row.playlistId || '–'}
              </span>
            ),
          },
        ] as AuditColumnDef<VideoInsight>[])
      : []),

    // ── Published date ─────────────────────────────────────────────────────
    {
      key: 'published',
      label: 'Published',
      width: 110,
      render: (row) => (
        <span>
          <span style={{ color: 'var(--rt-color-text-secondary)', fontSize: 'var(--rt-text-xs)' }}>
            {formatDate(row.publishDate)}
          </span>
          {row.ageDays !== undefined && row.ageDays > 0 && (
            <span
              style={{
                display: 'block',
                fontSize: 'var(--rt-text-2xs)',
                color: 'var(--rt-color-text-tertiary)',
              }}
            >
              {formatAge(row.ageDays)}
            </span>
          )}
        </span>
      ),
    },

    // ── Total views ────────────────────────────────────────────────────────
    {
      key: 'views',
      label: 'Views',
      width: 90,
      align: 'right',
      render: (row) => (
        <span
          style={{
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
            color: 'var(--rt-color-text)',
            fontSize: 'var(--rt-text-xs)',
          }}
        >
          {formatViews(row.views)}
        </span>
      ),
    },

    // ── Optional 7d/30d/90d view columns ──────────────────────────────────
    ...(has7
      ? ([
          {
            key: 'views7',
            label: '7d',
            width: 72,
            align: 'right',
            render: (row) => (
              <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 'var(--rt-text-xs)' }}>
                {formatViews(row.views7)}
              </span>
            ),
          },
        ] as AuditColumnDef<VideoInsight>[])
      : []),
    ...(has30
      ? ([
          {
            key: 'views30',
            label: '30d',
            width: 72,
            align: 'right',
            render: (row) => (
              <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 'var(--rt-text-xs)' }}>
                {formatViews(row.views30)}
              </span>
            ),
          },
        ] as AuditColumnDef<VideoInsight>[])
      : []),
    ...(has90
      ? ([
          {
            key: 'views90',
            label: '90d',
            width: 72,
            align: 'right',
            render: (row) => (
              <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 'var(--rt-text-xs)' }}>
                {formatViews(row.views90)}
              </span>
            ),
          },
        ] as AuditColumnDef<VideoInsight>[])
      : []),

    // ── Optional time-decay tier ───────────────────────────────────────────
    ...(hasDecay
      ? ([
          {
            key: 'decay',
            label: 'Time-Decay',
            width: 110,
            render: (row) => {
              const tier = row.decayTier;
              let score: number | null = null;
              if (tier === 'High') score = 90;
              else if (tier === 'Medium') score = 60;
              else if (tier === 'Low') score = 30;
              return (
                <span>
                  <ScorePill score={score} max={100} variant={score === null ? 'none' : undefined} />
                  {/* Override label to show tier name */}
                  <span style={{ display: 'none' }}>{tier || '–'}</span>
                  {row.decayWeight !== undefined && (
                    <span
                      style={{
                        marginLeft: 6,
                        fontSize: 'var(--rt-text-xs)',
                        color: 'var(--rt-color-text-tertiary)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {row.decayWeight.toFixed(3)}
                    </span>
                  )}
                </span>
              );
            },
          },
        ] as AuditColumnDef<VideoInsight>[])
      : []),
  ];

  return (
    <div className="pl-included-videos">
      <div className="pl-included-videos-head">
        <h3 className="pl-included-videos-title">
          <PlayCircle size={16} /> Included Videos &amp; Data
        </h3>
        <span className="pl-included-videos-count">
          {insights.length} video{insights.length === 1 ? '' : 's'}
          {hasDecay
            ? ' · sorted by time-decay weight (newest + best performing first)'
            : ' · as added'}
        </span>
      </div>

      <AuditDataTable<VideoInsight>
        columns={columns}
        rows={insights}
        getRowKey={(row) => row.videoId}
        emptyMessage="No video insights available."
        ariaLabel="playlist included videos"
      />
    </div>
  );
};

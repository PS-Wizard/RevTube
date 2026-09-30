// ─────────────────────────────────────────────────────────────────────────────
// PlaylistsTab — Playlist Audit deep-dive + per-playlist audit table.
// Each playlist row carries its deterministic audit score + top fix (the same
// engine as the Full Audit, persisted on fullAudit.health) — the playlist
// analogue of the Videos tab's score + fix-first columns. The table itself is
// the shared resizable AuditDataTable with clickable sortable headers, just
// like the Videos tab. Clicking a row (or the Inspect action) opens the
// per-playlist Recommended Fixes dialog.
// Shared primitives + Tailwind only.
// ─────────────────────────────────────────────────────────────────────────────
import { ExternalLink, Eye, ListChecks, ListVideo } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  AuditDataTable,
  ScorePill,
  type AuditColumnDef,
} from '../../../../components/audit/AuditDataTable';
import {
  Badge,
  Button,
  NativeSelect,
  Typography,
} from '../../../ui';
import { formatDate, type PlaylistSortColumnKey } from '../publicAuditUtils';
import { CategoryAuditCard } from './CategoryAuditCard';
import { PlaylistInspectorDialog } from './PlaylistInspectorDialog';
import type { PublicAuditCategoryScore, PublicAuditIssue, PublicAuditPlaylist, PublicAuditPlaylistHealth } from '../../../../services/publicAuditService';

interface PlaylistsTabProps {
  scoredVideos: number;
  playlists: PublicAuditPlaylist[];
  pagedPlaylists: PublicAuditPlaylist[];
  playlistTotalPages: number;
  currentPlaylistPage: number;
  playlistPageSize: number;
  setPlaylistPageSize: (v: number) => void;
  setPlaylistPage: (v: number) => void;
  playlistCategory: PublicAuditCategoryScore | null | undefined;
  playlistIssues: PublicAuditIssue[];
  playlistsMissingDesc: number;
  emptyPlaylists: number;
  /** Per-playlist audit (health + top fix) keyed by playlistId; empty on old reports. */
  playlistHealthById: Map<string, PublicAuditPlaylistHealth>;
  activePlaylistSort: { key: PlaylistSortColumnKey | null; dir: 'asc' | 'desc' | null };
  onPlaylistSort: (key: string) => void;
}

const playlistUrl = (p: PublicAuditPlaylist): string =>
  `https://www.youtube.com/playlist?list=${p.playlistId}`;

export function PlaylistsTab({
  scoredVideos,
  playlists,
  pagedPlaylists,
  playlistTotalPages,
  currentPlaylistPage,
  playlistPageSize,
  setPlaylistPageSize,
  setPlaylistPage,
  playlistCategory,
  playlistIssues,
  playlistsMissingDesc,
  emptyPlaylists,
  playlistHealthById,
  activePlaylistSort,
  onPlaylistSort,
}: PlaylistsTabProps) {
  // Per-playlist inspector (Recommended Fixes per playlist, like the video
  // inspector). Local state: the dialog needs only the row + its audit.
  const [inspected, setInspected] = useState<PublicAuditPlaylist | null>(null);

  // Table columns definition for AuditDataTable (same component, resize +
  // sortable-header behavior as the Videos tab).
  const tableColumns: AuditColumnDef<PublicAuditPlaylist>[] = useMemo(() => {
    return [
      {
        key: '#',
        label: '#',
        width: 48,
        align: 'center',
        render: (_row, idx) => (
          <span className="text-xs font-medium text-[var(--rt-color-text-tertiary)]">
            {(currentPlaylistPage - 1) * playlistPageSize + idx + 1}
          </span>
        ),
      },
      {
        key: 'playlist',
        label: 'Playlist',
        width: 280,
        sortable: true,
        sortKey: 'title',
        render: (row) => (
          <div className="flex min-w-0 items-center gap-3">
            {row.thumbnailUrl && (
              <img
                src={row.thumbnailUrl}
                alt=""
                loading="lazy"
                className="h-9 w-16 shrink-0 rounded-[var(--rt-radius-sm)] object-cover"
              />
            )}
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium text-[var(--rt-color-text)]" title={row.title}>
                {row.title}
              </span>
              <span className="block truncate text-[11px] text-[var(--rt-color-text-tertiary)]" title={row.description || row.playlistId}>
                {row.description || row.playlistId}
              </span>
            </span>
          </div>
        ),
      },
      {
        key: 'score',
        label: 'Score',
        width: 90,
        align: 'center',
        sortable: true,
        render: (row) => {
          const audit = playlistHealthById.get(row.playlistId);
          return <ScorePill score={audit?.health ?? null} />;
        },
      },
      {
        key: 'topfix',
        label: 'Top fix',
        width: 220,
        render: (row) => {
          const audit = playlistHealthById.get(row.playlistId);
          if (!audit) return <span className="text-xs text-[var(--rt-color-text-tertiary)]">—</span>;
          return (
            <span className="block truncate text-[11px] leading-relaxed text-[var(--rt-color-text-secondary)]" title={audit.hint}>
              {audit.hint}
            </span>
          );
        },
      },
      {
        key: 'size',
        label: 'Videos',
        width: 80,
        align: 'center',
        sortable: true,
        render: (row) => (
          <span className="text-xs font-medium tabular-nums text-[var(--rt-color-text-secondary)]">
            {row.itemCount ?? '—'}
          </span>
        ),
      },
      {
        key: 'published',
        label: 'Published',
        width: 110,
        sortable: true,
        render: (row) => (
          <span className="whitespace-nowrap text-xs text-[var(--rt-color-text-secondary)]">
            {formatDate(row.publishedAt)}
          </span>
        ),
      },
      {
        key: 'open',
        label: 'Open',
        width: 70,
        align: 'center',
        render: (row) => (
          <a
            href={playlistUrl(row)}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-xs font-medium text-[var(--rt-color-accent)] hover:underline"
          >
            View <ExternalLink size={12} />
          </a>
        ),
      },
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
              setInspected(row);
            }}
            title="Inspect playlist fixes"
            aria-label={`Inspect fixes for ${row.title || row.playlistId}`}
          >
            <Eye size={13} className="text-[var(--rt-color-text-secondary)]" />
          </Button>
        ),
      },
    ];
  }, [currentPlaylistPage, playlistPageSize, playlistHealthById]);

  return (
    <>
      <CategoryAuditCard
        icon={<ListChecks size={18} />}
        title="Playlist Audit"
        subtitle={`Playlist Flow — scored across ${scoredVideos} videos`}
        category={playlistCategory}
        issues={playlistIssues}
      >
        {playlists.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="px-2 py-0.5 text-[11px] font-medium">
              {playlists.length} playlists
            </Badge>
            <Badge variant="secondary" className="px-2 py-0.5 text-[11px] font-medium">
              {playlistsMissingDesc} missing descriptions
            </Badge>
            {emptyPlaylists > 0 && (
              <Badge variant="outline" className="border-[var(--rt-color-warning)] px-2 py-0.5 text-[11px] font-medium text-[var(--rt-color-warning)]">
                {emptyPlaylists} empty
              </Badge>
            )}
          </div>
        )}
      </CategoryAuditCard>
      {playlists.length === 0 ? (
        <div className="rounded-[var(--rt-radius-lg)] border border-[var(--rt-color-border)] bg-[var(--rt-color-bg-elevated)] p-8 text-center">
          <ListVideo size={28} className="mx-auto mb-3 text-[var(--rt-color-text-tertiary)]" />
          <Typography variant="body2" className="text-[var(--rt-color-text-secondary)]">
            No public playlists found for this channel.
          </Typography>
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          <AuditDataTable<PublicAuditPlaylist>
            columns={tableColumns}
            rows={pagedPlaylists}
            getRowKey={(r) => r.playlistId}
            onRowClick={(r) => setInspected(r)}
            emptyMessage="No playlists found."
            ariaLabel="Channel audit playlists table. Click a column header to sort biggest, lowest, or normal."
            sortKey={activePlaylistSort.key}
            sortDir={activePlaylistSort.dir}
            onSort={onPlaylistSort}
          />
          <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
            <span className="text-xs text-[var(--rt-color-text-tertiary)]">Showing {(currentPlaylistPage - 1) * playlistPageSize + 1}–{Math.min(currentPlaylistPage * playlistPageSize, playlists.length)} of {playlists.length} playlists</span>
            <div className="flex items-center gap-2">
              <NativeSelect compact value={playlistPageSize} onChange={(e) => { setPlaylistPageSize(Number(e.target.value)); setPlaylistPage(1); }} aria-label="Playlists per page">
                <option value={10}>10 per page</option><option value={25}>25 per page</option><option value={50}>50 per page</option><option value={100}>100 per page</option>
              </NativeSelect>
              <Button size="sm" variant="outline" disabled={currentPlaylistPage <= 1} onClick={() => setPlaylistPage(currentPlaylistPage - 1)}>Previous</Button>
              <span className="min-w-20 text-center text-xs text-[var(--rt-color-text-secondary)]">Page {currentPlaylistPage} of {playlistTotalPages}</span>
              <Button size="sm" variant="outline" disabled={currentPlaylistPage >= playlistTotalPages} onClick={() => setPlaylistPage(currentPlaylistPage + 1)}>Next</Button>
            </div>
          </div>
        </div>
      )}
      <PlaylistInspectorDialog
        playlist={inspected}
        audit={inspected ? playlistHealthById.get(inspected.playlistId) ?? null : null}
        onClose={() => setInspected(null)}
      />
    </>
  );
}

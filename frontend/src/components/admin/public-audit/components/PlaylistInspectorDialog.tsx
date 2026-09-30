// ─────────────────────────────────────────────────────────────────────────────
// PlaylistInspectorDialog — per-playlist deep dive: preview, audit score,
// dimension breakdown, and Recommended Fixes with uplift (the playlist
// analogue of VideoInspectorDialog's concise Recommendation cards).
// Shared shadcn Dialog + Tailwind only.
// ─────────────────────────────────────────────────────────────────────────────
import { ArrowUpRight, ExternalLink, Image, ListVideo } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogTitleBlock,
  Progress,
} from '../../../ui';
import {
  labelForPlaylistDimension,
  recommendationForPlaylistDimension,
  scoreBadgeClasses,
} from '../publicAuditUtils';
import type {
  PublicAuditPlaylist,
  PublicAuditPlaylistHealth,
} from '../../../../services/publicAuditService';

interface PlaylistInspectorDialogProps {
  playlist: PublicAuditPlaylist | null;
  audit: PublicAuditPlaylistHealth | null | undefined;
  onClose: () => void;
}

export function PlaylistInspectorDialog({ playlist, audit, onClose }: PlaylistInspectorDialogProps) {
  const recommendations = audit?.recommendations ?? [];
  const uplift = audit && recommendations.length > 0 ? Math.max(0, 100 - audit.health) : 0;
  return (
    <Dialog
      open={playlist !== null}
      onClose={onClose}
      maxWidth={false}
      fullWidth
      className="w-[calc(100%-2rem)] sm:w-[70%] sm:max-w-[75rem]"
      closeOnBackdrop
      closeOnEscape
    >
      {playlist && (
        <>
          <DialogTitleBlock
            icon={<ListVideo size={18} aria-hidden />}
            title={playlist.title || playlist.playlistId}
            subtitle={`${playlist.itemCount ?? '—'} videos${playlist.publishedAt ? ` · Published ${new Date(playlist.publishedAt).toLocaleDateString()}` : ''}`}
          />
          <DialogBody className="flex max-h-[75vh] flex-col gap-4 overflow-y-auto px-4 py-4 sm:px-6">
            {/* Header preview row (no inline thumbnail image — link buttons only) */}
            <div className="flex min-w-0 flex-col gap-3 rounded-[var(--rt-radius-md)] border border-[var(--rt-color-border)] bg-[var(--rt-color-bg-subtle)] p-3 sm:p-4">
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-[var(--rt-color-text)]">
                  Playlist ID: <span className="font-mono text-[var(--rt-color-text-secondary)]">{playlist.playlistId}</span>
                </div>
                <div className="mt-0.5 text-xs text-[var(--rt-color-text-tertiary)]">
                  {playlist.itemCount ?? '—'} videos
                  {playlist.publishedAt ? ` · Published ${new Date(playlist.publishedAt).toLocaleDateString()}` : ''}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="xs"
                  component="a"
                  href={`https://www.youtube.com/playlist?list=${playlist.playlistId}`}
                  target="_blank"
                  rel="noreferrer"
                  startIcon={<ExternalLink size={11} />}
                >
                  Open Playlist
                </Button>
                {playlist.thumbnailUrl && (
                  <Button
                    variant="outline"
                    size="xs"
                    component="a"
                    href={playlist.thumbnailUrl}
                    target="_blank"
                    rel="noreferrer"
                    startIcon={<Image size={11} />}
                  >
                    View Thumbnail
                  </Button>
                )}
                {audit ? (
                  <Badge variant="outline" className={cn('text-xs font-bold tabular-nums', scoreBadgeClasses(audit.health))}>
                    Score: {audit.health}/100
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs text-[var(--rt-color-text-tertiary)]">
                    Not audited — re-run the audit
                  </Badge>
                )}
                {uplift > 0 && (
                  <Badge variant="outline" className="border-[var(--rt-color-accent)] text-xs text-[var(--rt-color-accent)]">
                    Fix Uplift: +{uplift} pts
                  </Badge>
                )}
              </div>
            </div>

            {/* Dimension Scores Breakdown */}
            {audit && audit.dimensions && audit.dimensions.length > 0 && (
              <div className="flex min-w-0 flex-col gap-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--rt-color-text-secondary)]">
                  Dimension Scores
                </h4>
                <ul className="flex min-w-0 flex-col divide-y divide-[var(--rt-color-border)] rounded-[var(--rt-radius-md)] border border-[var(--rt-color-border)] px-3">
                  {audit.dimensions.map((dim) => (
                    <li key={dim.key} className="flex min-w-0 flex-col gap-1 py-2">
                      <div className="flex min-w-0 items-center justify-between gap-3">
                        <span className="min-w-0 truncate text-xs text-[var(--rt-color-text-secondary)]" title={dim.label}>
                          {dim.label}
                        </span>
                        <span className="shrink-0 text-xs font-semibold tabular-nums text-[var(--rt-color-text)]">
                          {dim.current}/100
                        </span>
                      </div>
                      <Progress value={Math.max(0, Math.min(100, dim.current))} className="h-1.5 bg-[var(--rt-color-bg-muted)]" />
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Recommended Fixes */}
            {audit && (
              <div className="flex min-w-0 flex-col gap-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--rt-color-text-secondary)]">
                  Recommended Fixes &amp; Optimizations
                </h4>
                {recommendations.length === 0 ? (
                  <div className="rounded-[var(--rt-radius-sm)] border border-[var(--rt-color-border)] bg-[var(--rt-color-bg-elevated)] p-3 text-xs text-[var(--rt-color-text-secondary)]">
                    No fixes — this playlist scores 100/100 on every dimension.
                  </div>
                ) : (
                  <div className="flex min-w-0 flex-col gap-2">
                    {recommendations.map((rec) => (
                      <div
                        key={rec.dimension}
                        className="flex items-start gap-2 rounded-[var(--rt-radius-sm)] border border-[var(--rt-color-warning)]/30 bg-[var(--rt-color-warning-surface)] p-3 text-xs"
                      >
                        <ArrowUpRight size={14} className="mt-0.5 shrink-0 text-[var(--rt-color-warning)]" />
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-[var(--rt-color-text)]">
                            Fix {rec.label || labelForPlaylistDimension(rec.dimension)} — Uplift: +{rec.delta} pts
                          </div>
                          <div className="mt-1 text-[11px] leading-relaxed text-[var(--rt-color-text-secondary)]">
                            Recommendation: {recommendationForPlaylistDimension(rec.dimension)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </DialogBody>
        </>
      )}
    </Dialog>
  );
}

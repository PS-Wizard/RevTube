// ─────────────────────────────────────────────────────────────────────────────
// VideoInspectorDialog — per-video deep dive: preview, score, element
// breakdown, recommendations, and this-video-only PDF/Excel downloads.
// 70% viewport width on desktop (capped at 1200px), near-full-bleed mobile.
// Shared shadcn Dialog + Tailwind only.
// ─────────────────────────────────────────────────────────────────────────────
import { ArrowUpRight, ExternalLink, FileSpreadsheet, FileText, Film } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScorePill } from '../../../../components/audit/AuditDataTable';
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogTitleBlock,
  Spinner,
} from '../../../ui';
import { formatDate, labelForElement, recommendationForElement, scoreBadgeClasses } from '../publicAuditUtils';
import type { PublicAuditVideo } from '../usePublicAuditPanel';

interface VideoInspectorDialogProps {
  video: PublicAuditVideo | null;
  downloadingVideo: 'pdf' | 'excel' | null;
  onClose: () => void;
  onDownload: (format: 'pdf' | 'excel') => void;
}

// Public audit shows concise 1–2 sentence recommendations per fix (no full
// rewrites, no tag dumps, no AI copy). The full ready-to-use copy lives on
// the Video Audit detailed-analysis page (`SuggestionBody`).

export function VideoInspectorDialog({ video: inspectedVideo, downloadingVideo, onClose, onDownload }: VideoInspectorDialogProps) {
  return (
    <Dialog
      open={inspectedVideo !== null}
      onClose={onClose}
      maxWidth={false}
      fullWidth
      className="w-[calc(100%-2rem)] sm:w-[70%] sm:max-w-[75rem]"
      closeOnBackdrop
      closeOnEscape
    >
      {inspectedVideo && (
        <>
          <DialogTitleBlock
            icon={<Film size={18} aria-hidden />}
            title={inspectedVideo.videoTitle || inspectedVideo.videoId}
            subtitle={`Score ${inspectedVideo.total}/100 · Published ${formatDate(inspectedVideo.publishedAt)}`}
          />
          <DialogBody className="flex max-h-[75vh] flex-col gap-4 overflow-y-auto px-4 py-4 sm:px-6">
            {/* Header preview row */}
            <div className="flex min-w-0 flex-col gap-3 rounded-[var(--rt-radius-md)] border border-[var(--rt-color-border)] bg-[var(--rt-color-bg-subtle)] p-3 sm:flex-row sm:gap-4 sm:p-4">
              <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded bg-black sm:w-44">
                <img
                  src={`https://i.ytimg.com/vi/${inspectedVideo.videoId}/hqdefault.jpg`}
                  alt=""
                  className="h-full w-full object-cover"
                />
                {inspectedVideo.durationLabel && (
                  <span className="absolute right-1 bottom-1 rounded bg-black/85 px-1 text-[9px] font-bold text-white">
                    {inspectedVideo.durationLabel}
                  </span>
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-[var(--rt-color-text)]">
                    Video ID: <span className="font-mono text-[var(--rt-color-text-secondary)]">{inspectedVideo.videoId}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-[var(--rt-color-text-tertiary)]">
                    Published: {formatDate(inspectedVideo.publishedAt)}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="xs"
                    component="a"
                    href={`https://www.youtube.com/watch?v=${inspectedVideo.videoId}`}
                    target="_blank"
                    rel="noreferrer"
                    startIcon={<ExternalLink size={11} />}
                  >
                    Watch on YouTube
                  </Button>
                  <Badge variant="outline" className={cn('text-xs font-bold tabular-nums', scoreBadgeClasses(inspectedVideo.total))}>
                    Score: {inspectedVideo.total}/100
                  </Badge>
                  {inspectedVideo.projectedTotal && inspectedVideo.projectedTotal > inspectedVideo.total && (
                    <Badge variant="outline" className="border-[var(--rt-color-accent)] text-xs text-[var(--rt-color-accent)]">
                      Fix Uplift: +{inspectedVideo.projectedTotal - inspectedVideo.total} pts
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            {/* Element Scores Breakdown */}
            <div className="flex min-w-0 flex-col gap-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--rt-color-text-secondary)]">
                Element Scores &amp; Criteria Notes
              </h4>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {inspectedVideo.elements?.map((el) => (
                  <div key={el.element} className="flex min-w-0 flex-col gap-1 rounded-[var(--rt-radius-sm)] border border-[var(--rt-color-border)] bg-[var(--rt-color-bg-elevated)] p-3">
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-xs font-semibold text-[var(--rt-color-text)]">
                        {labelForElement(el.element)}
                      </span>
                      <ScorePill score={el.score} max={el.max} />
                    </div>
                    <div className="mt-1 flex flex-col gap-1 text-[11px] text-[var(--rt-color-text-secondary)]">
                      {el.breakdown?.map((b, i) => (
                        <div key={b.criterion || String(i)} className="flex items-center justify-between gap-2 text-[10px]">
                          <span className="min-w-0 truncate pr-1 text-[var(--rt-color-text-tertiary)]">{b.criterion}</span>
                          <span className="shrink-0 font-medium tabular-nums">{b.earned}/{b.max}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Actionable Recommendations */}
            {inspectedVideo.recommendations && inspectedVideo.recommendations.length > 0 && (
              <div className="flex min-w-0 flex-col gap-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--rt-color-text-secondary)]">
                  Recommended Fixes &amp; Optimizations
                </h4>
                <div className="flex min-w-0 flex-col gap-2">
                  {inspectedVideo.recommendations.map((rec, i) => {
                    return (
                      <div
                        key={rec.element || String(i)}
                        className="flex items-start gap-2 rounded-[var(--rt-radius-sm)] border border-[var(--rt-color-warning)]/30 bg-[var(--rt-color-warning-surface)] p-3 text-xs"
                      >
                        <ArrowUpRight size={14} className="mt-0.5 shrink-0 text-[var(--rt-color-warning)]" />
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-[var(--rt-color-text)]">
                            Fix {labelForElement(rec.element)} — Uplift: +{rec.delta} pts
                          </div>
                          <div className="mt-1 text-[11px] leading-relaxed text-[var(--rt-color-text-secondary)]">
                            Recommendation: {recommendationForElement(rec.element)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </DialogBody>
          <DialogFooter className="flex-col-reverse gap-2 border-t border-[var(--rt-color-border)] px-4 pt-3 pb-4 sm:flex-row sm:justify-end sm:px-6">
            <Button variant="secondary" size="sm" onClick={onClose} className="w-full sm:w-auto">
              Close
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onDownload('excel')}
              disabled={downloadingVideo !== null}
              startIcon={downloadingVideo === 'excel' ? <Spinner size="xs" /> : <FileSpreadsheet size={13} />}
              className="w-full text-xs sm:w-auto"
            >
              {downloadingVideo === 'excel' ? 'Preparing…' : 'Download Excel (this video)'}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => onDownload('pdf')}
              disabled={downloadingVideo !== null}
              startIcon={downloadingVideo === 'pdf' ? <Spinner size="xs" /> : <FileText size={13} />}
              className="w-full text-xs sm:w-auto"
            >
              {downloadingVideo === 'pdf' ? 'Preparing…' : 'Download PDF (this video)'}
            </Button>
          </DialogFooter>
        </>
      )}
    </Dialog>
  );
}

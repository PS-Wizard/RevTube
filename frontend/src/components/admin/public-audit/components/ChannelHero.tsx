// ─────────────────────────────────────────────────────────────────────────────
// ChannelHero — executive channel header: banner, avatar, identity, overall
// score medallion, Open-YouTube + Export-Report menu (Excel / selectable-text
// PDF / image PDF). Shared shadcn primitives + Tailwind only.
// ─────────────────────────────────────────────────────────────────────────────
import { Download, ExternalLink, FileImage, FileSpreadsheet, FileText, MapPin, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AuditExportMenu } from '../../../../components/audit/AuditExportMenu';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  Spinner,
} from '../../../ui';
import { formatDate, scoreBadgeClasses, scoreTextClass } from '../publicAuditUtils';
import type { PublicAuditReport } from '../../../../services/publicAuditService';

interface ChannelHeroProps {
  report: PublicAuditReport;
  toneLabel: string;
  avgProjected: number;
  potentialUplift: number;
  exporting: boolean;
  exportingPdf: boolean;
  exportingImage: boolean;
  exportMenuAnchor: HTMLElement | null;
  setExportMenuAnchor: (el: HTMLElement | null) => void;
  onExportExcel: () => void;
  onExportPdf: () => void;
  onExportImagePdf: () => void;
}

export function ChannelHero({
  report,
  toneLabel,
  avgProjected,
  potentialUplift,
  exporting,
  exportingPdf,
  exportingImage,
  exportMenuAnchor,
  setExportMenuAnchor,
  onExportExcel,
  onExportPdf,
  onExportImagePdf,
}: ChannelHeroProps) {
  const snap = report.snapshot;
  const busyExport = exporting || exportingPdf || exportingImage;
  return (
    <Card className="overflow-hidden border-[var(--rt-color-border)] bg-[var(--rt-color-bg-elevated)] shadow-sm">
      {snap?.bannerUrl && (
        <div
          className="relative h-28 sm:h-36 w-full bg-cover bg-center border-b border-[var(--rt-color-border)]"
          style={{ backgroundImage: `url(${snap.bannerUrl})` }}
          aria-hidden
        >
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        </div>
      )}
      <CardContent className="p-4 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6 min-w-0">
          {/* Left: Avatar + Channel Info */}
          <div className="flex items-start gap-4 min-w-0 flex-1">
            <Avatar
              size="lg"
              src={snap?.avatarUrl}
              alt={report.channelTitle || 'Channel avatar'}
              className="w-16 h-16 sm:w-20 sm:h-20 ring-2 ring-[var(--rt-color-border)] shrink-0 rounded-full"
            >
              {(report.channelTitle || '?').charAt(0)}
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl sm:text-2xl font-bold text-[var(--rt-color-text)] truncate" title={report.channelTitle}>
                  {report.channelTitle || report.channelInput || 'Public audit'}
                </h2>
                <Badge variant="outline" className="text-[11px] shrink-0">
                  Channel Audit
                </Badge>
              </div>

              <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-[var(--rt-color-text-tertiary)]">
                {snap?.handle && <span className="font-medium text-[var(--rt-color-text-secondary)]">{snap.handle}</span>}
                {snap?.country && (
                  <span className="inline-flex items-center gap-0.5">
                    <MapPin size={11} /> {snap.country}
                  </span>
                )}
                <span>·</span>
                <span>{report.videoCount} videos audited</span>
                <span>·</span>
                <span>Audited {formatDate(report.auditedAt || report.createdAt)}</span>
              </div>

              {snap?.description && (
                <p className="mt-2 text-xs sm:text-sm text-[var(--rt-color-text-secondary)] line-clamp-2 leading-relaxed">
                  {snap.description}
                </p>
              )}

              {/* Topics / Keywords Tags */}
              {((snap?.topics && snap.topics.length > 0) || snap?.channelKeywords) && (
                <div className="flex flex-wrap items-center gap-1.5 mt-3">
                  {snap.topics?.map((topic) => (
                    <span
                      key={topic}
                      className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-[var(--rt-color-bg-subtle)] border border-[var(--rt-color-border)] text-[var(--rt-color-text-secondary)]"
                    >
                      {topic.split('/').pop() || topic}
                    </span>
                  ))}
                  {snap.channelKeywords && (
                    <span className="text-[11px] text-[var(--rt-color-text-tertiary)] truncate max-w-md">
                      Tags: {snap.channelKeywords}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right: Standout Overall Score & CTAs */}
          <div className="flex shrink-0 flex-col items-start justify-between gap-3 border-t border-[var(--rt-color-border)] pt-4 sm:flex-row sm:items-center lg:flex-col lg:items-end lg:border-t-0 lg:pt-0">
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-start gap-1 lg:items-end">
                <span className="text-xs font-medium uppercase tracking-wider text-[var(--rt-color-text-tertiary)]">
                  Overall Score
                </span>
                <div className="flex items-baseline gap-1">
                  <span className={cn('text-3xl font-black tabular-nums sm:text-4xl', scoreTextClass(report?.overall))}>
                    {report.overall ?? '—'}
                  </span>
                  <span className="text-sm font-semibold text-[var(--rt-color-text-tertiary)]">/100</span>
                </div>
                <Badge variant="outline" className={cn('mt-0.5 text-[11px]', scoreBadgeClasses(report?.overall))}>
                  {toneLabel}
                </Badge>
                {potentialUplift > 0 && (
                  <div className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-[var(--rt-color-accent)]">
                    <TrendingUp size={12} className="shrink-0" />
                    <span>Potential: {avgProjected} (+{potentialUplift} pts)</span>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                component="a"
                href={`https://www.youtube.com/channel/${report.channelId}`}
                target="_blank"
                rel="noreferrer"
                startIcon={<ExternalLink size={13} />}
                className="text-xs"
              >
                Open YouTube
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={(e) => setExportMenuAnchor(e.currentTarget)}
                disabled={busyExport}
                startIcon={busyExport ? <Spinner size="xs" /> : <Download size={13} />}
                className="text-xs"
                aria-haspopup="menu"
              >
                {exporting ? 'Exporting Excel…' : exportingPdf ? 'Exporting PDF…' : exportingImage ? 'Exporting image…' : 'Export Report'}
              </Button>
              <AuditExportMenu
                anchorEl={exportMenuAnchor}
                onClose={() => setExportMenuAnchor(null)}
                items={[
                  {
                    key: 'excel',
                    label: 'Excel workbook (full details)',
                    icon: <FileSpreadsheet size={14} />,
                    iconClassName: 'text-[var(--rt-color-success)]',
                    onSelect: onExportExcel,
                  },
                  {
                    key: 'pdf-text',
                    label: 'PDF — selectable text',
                    hint: 'Copyable text, smaller file',
                    icon: <FileText size={14} />,
                    iconClassName: 'text-[var(--rt-color-accent)]',
                    onSelect: onExportPdf,
                  },
                  {
                    key: 'pdf-image',
                    label: 'PDF — image (as shown)',
                    hint: 'Exact pixels incl. emojis, not copyable',
                    icon: <FileImage size={14} />,
                    iconClassName: 'text-[var(--rt-color-text-tertiary)]',
                    onSelect: onExportImagePdf,
                  },
                ]}
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

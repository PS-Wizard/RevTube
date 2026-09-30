// ─────────────────────────────────────────────────────────────────────────────
// MetricsGrid — three grouped vital-metric clusters (Audience & Reach,
// Engagement & Feedback, Content Strategy & Mix) built on the shared StatCard.
// Shared shadcn primitives + Tailwind only.
// ─────────────────────────────────────────────────────────────────────────────
import { CalendarDays, Clock3, Eye, FileCheck, Film, Layers, ListVideo, MessageCircle, ThumbsUp, TrendingUp } from 'lucide-react';
import { Card, StatCard } from '../../../ui';
import { formatCount, formatShort, toneFor } from '../publicAuditUtils';
import type { PublicAuditReport } from '../../../../services/publicAuditService';

interface MetricsGridProps {
  report: PublicAuditReport;
  playlistCount: number;
}

export function MetricsGrid({ report, playlistCount }: MetricsGridProps) {
  const stats = report.snapshot?.statistics || {};
  const lifetime = report.channelLifetime ?? null;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* 1. Scale & Audience */}
      <Card className="border-[var(--rt-color-border)] bg-[var(--rt-color-bg-elevated)] p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between pb-2 border-b border-[var(--rt-color-border)]">
          <span className="text-xs font-semibold text-[var(--rt-color-text-secondary)] uppercase tracking-wider flex items-center gap-1.5">
            <Eye size={13} className="text-[var(--rt-color-accent)]" /> Audience &amp; Reach
          </span>
          <span className="text-[11px] text-[var(--rt-color-text-tertiary)]">Channel Stats</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <StatCard label="Subscribers" value={formatShort(stats.subscriberCount)} icon={<Eye size={13} aria-hidden />} />
          <StatCard label="Total Views" value={formatShort(stats.viewCount)} icon={<Eye size={13} aria-hidden />} />
          <StatCard label="Total Uploads" value={formatCount(stats.videoCount)} icon={<CalendarDays size={13} aria-hidden />} />
          <StatCard label="Avg Views / Video" value={lifetime?.avgViewsPerVideo != null ? formatShort(lifetime.avgViewsPerVideo) : '—'} icon={<TrendingUp size={13} aria-hidden />} />
        </div>
      </Card>

      {/* 2. Engagement & Reactions */}
      <Card className="border-[var(--rt-color-border)] bg-[var(--rt-color-bg-elevated)] p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between pb-2 border-b border-[var(--rt-color-border)]">
          <span className="text-xs font-semibold text-[var(--rt-color-text-secondary)] uppercase tracking-wider flex items-center gap-1.5">
            <ThumbsUp size={13} className="text-[var(--rt-color-success)]" /> Engagement &amp; Feedback
          </span>
          <span className="text-[11px] text-[var(--rt-color-text-tertiary)]">Audited Sample</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <StatCard
            tone="success"
            label="Engagement Rate"
            value={lifetime?.engagementRatePct != null ? `${lifetime.engagementRatePct}%` : '—'}
            icon={<ThumbsUp size={13} aria-hidden />}
          />
          <StatCard label="Audited Likes" value={lifetime ? formatShort(lifetime.totalLikesAudited) : '—'} icon={<ThumbsUp size={13} aria-hidden />} />
          <StatCard label="Audited Comments" value={lifetime ? formatShort(lifetime.totalCommentsAudited) : '—'} icon={<MessageCircle size={13} aria-hidden />} />
          <StatCard
            tone={toneFor(report.overall)}
            label="Video Sub-Audit"
            value={`${report.videoAuditOverall ?? report.overall ?? '—'}/100`}
            icon={<FileCheck size={13} aria-hidden />}
          />
        </div>
      </Card>

      {/* 3. Publishing Strategy & Mix */}
      <Card className="border-[var(--rt-color-border)] bg-[var(--rt-color-bg-elevated)] p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between pb-2 border-b border-[var(--rt-color-border)]">
          <span className="text-xs font-semibold text-[var(--rt-color-text-secondary)] uppercase tracking-wider flex items-center gap-1.5">
            <Film size={13} className="text-[var(--rt-color-warning)]" /> Content Strategy &amp; Mix
          </span>
          <span className="text-[11px] text-[var(--rt-color-text-tertiary)]">Cadence &amp; Playlists</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <StatCard
            label="Publishing Cadence"
            value={lifetime?.uploadCadenceDays != null ? `~${lifetime.uploadCadenceDays}d` : '—'}
            icon={<CalendarDays size={13} aria-hidden />}
          />
          <StatCard
            label="Shorts / Long-form"
            value={lifetime ? `${lifetime.shortsCount} / ${lifetime.longformCount}` : '—'}
            icon={<Clock3 size={13} aria-hidden />}
          />
          <StatCard label="Public Playlists" value={String(playlistCount)} icon={<ListVideo size={13} aria-hidden />} />
          <StatCard label="Sample Size" value={`${report.videoCount} vids`} icon={<Layers size={13} aria-hidden />} />
        </div>
      </Card>
    </div>
  );
}

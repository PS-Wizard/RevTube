// ─────────────────────────────────────────────────────────────────────────────
// Video Audit -- Report header (clean, spacious overview)
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from 'react';
import {
  Box,
  Button,
  Progress,
} from '../../components/ui';
import { AuditExportMenu } from '../../components/audit/AuditExportMenu';
import {
  Download,
  FileText,
  FileSpreadsheet,
  Table2,
  TrendingUp,
  Compass,
  FileCheck,
  Eye,
  type LucideIcon,
} from 'lucide-react';
import type { VideoAuditBatchResult } from '../../types/videoAudit';
import {
  downloadBatchPDF,
  downloadExcel,
  downloadCSV,
} from '../../services/videoAuditExport';

function scoreStatus(score: number): { text: string; bg: string; label: string } {
  if (score >= 80) {
    return {
      text: 'var(--rt-color-success)',
      bg: 'var(--rt-color-success-surface)',
      label: 'High Performance',
    };
  }
  if (score >= 50) {
    return {
      text: 'var(--rt-color-warning)',
      bg: 'var(--rt-color-warning-surface)',
      label: 'Moderate Alignment',
    };
  }
  return {
    text: 'var(--rt-color-danger)',
    bg: 'var(--rt-color-danger-surface)',
    label: 'Needs Attention',
  };
}

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  discoverability: Compass,
  contentQuality: FileCheck,
  visualHook: Eye,
};

export function VideoAuditReportHeader({ batchResult }: { batchResult: VideoAuditBatchResult }) {
  const [exportMenuAnchor, setExportMenuAnchor] = useState<null | HTMLElement>(null);
  const status = scoreStatus(batchResult.overall);

  const avgProjected =
    batchResult.results.length > 0
      ? batchResult.results.reduce((acc, r) => acc + (r.projectedTotal || r.total), 0) /
        batchResult.results.length
      : batchResult.overall;
  const potentialUplift = Math.max(0, avgProjected - batchResult.overall);

  const categoryAverages: { key: string; label: string; avg: number }[] =
    (batchResult.results[0]?.categories ?? [])
      .map((cat) => {
        const vals = batchResult.results
          .map((r) => r.categories?.find((x) => x.key === cat.key))
          .filter((x): x is NonNullable<typeof x> => !!x && x.score > 0);
        return {
          key: cat.key,
          label: cat.label,
          avg: vals.length ? vals.reduce((s, x) => s + x.score, 0) / vals.length : 0,
          hasData: vals.length > 0,
        };
      })
      // A category with no contributing data anywhere (e.g. Visual Hook when the
      // thumbnail AI pass is toggled off) is skipped entirely rather than shown
      // as a misleading 0% -- it wasn't measured, not a failing score.
      .filter((c) => c.hasData)
      .map(({ key, label, avg }) => ({ key, label, avg }));

  return (
    <Box className="va-overview-banner">
      {/* Left Column: Overall Score & Health */}
      <Box className="va-overview-score-group">
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
          <Box className="va-score-hero-val" style={{ color: status.text }}>
            {batchResult.overall.toFixed(0)}
          </Box>
          <Box className="va-score-hero-max">/100</Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          <span className="va-status-tag" style={{ backgroundColor: status.bg, color: status.text }}>
            {status.label}
          </span>
          <span className="va-meta-text">
            {batchResult.results.length} video{batchResult.results.length === 1 ? '' : 's'} audited
          </span>
        </Box>

        {potentialUplift > 0 && (
          <Box className="va-uplift-hint">
            <TrendingUp size={13} style={{ color: 'var(--rt-color-accent)' }} />
            <span>
              Potential score: <strong>{avgProjected.toFixed(0)}</strong> (+{potentialUplift.toFixed(0)} pts)
            </span>
          </Box>
        )}
      </Box>

      {/* Middle: 3 Focus Category Columns (Open, spacious layout) */}
      <Box className="va-overview-cats">
        {categoryAverages.map((cat) => {
          const CatIcon = CATEGORY_ICONS[cat.key] ?? Compass;
          const catStat = scoreStatus(cat.avg);
          return (
            <Box key={cat.key} className="va-cat-col">
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <CatIcon size={14} style={{ color: 'var(--rt-color-accent)' }} />
                  <span className="va-cat-label">{cat.label}</span>
                </Box>
                <span className="va-cat-val" style={{ color: catStat.text }}>
                  {cat.avg.toFixed(0)}%
                </span>
              </Box>
              <Progress
                variant="determinate"
                value={cat.avg}
                sx={{
                  height: 4,
                  borderRadius: 'var(--rt-radius-pill)',
                  bgcolor: 'var(--rt-color-bg-subtle)',
                  '& .MuiLinearProgress-bar': {
                    backgroundColor: catStat.text,
                  },
                }}
              />
            </Box>
          );
        })}
      </Box>

      {/* Right: Clean Export Trigger */}
      <Box className="va-overview-actions">
        <Button
          variant="outlined"
          size="small"
          onClick={(e) => setExportMenuAnchor(e.currentTarget)}
          startIcon={<Download size={14} />}
          sx={{
            textTransform: 'none',
            fontSize: 'var(--rt-text-xs)',
            fontWeight: 'var(--rt-weight-semibold)',
            borderColor: 'var(--rt-color-border)',
            color: 'var(--rt-color-text)',
            bgcolor: 'var(--rt-color-bg-elevated)',
            px: 2,
            py: 0.75,
            borderRadius: 'var(--rt-radius-sm)',
            '&:hover': {
              borderColor: 'var(--rt-color-accent)',
              bgcolor: 'var(--rt-color-bg-highlight)',
            },
          }}
        >
          Export Report
        </Button>

        <AuditExportMenu
          anchorEl={exportMenuAnchor}
          onClose={() => setExportMenuAnchor(null)}
          items={[
            {
              key: 'pdf',
              label: 'PDF Report',
              icon: <FileText size={14} />,
              iconClassName: 'text-[var(--rt-color-accent)]',
              onSelect: () => downloadBatchPDF(batchResult.results),
            },
            {
              key: 'excel',
              label: 'Excel Sheet',
              icon: <FileSpreadsheet size={14} />,
              iconClassName: 'text-[var(--rt-color-success)]',
              onSelect: () => downloadExcel(batchResult.results),
            },
            {
              key: 'csv',
              label: 'CSV File',
              icon: <Table2 size={14} />,
              iconClassName: 'text-[var(--rt-color-text-secondary)]',
              onSelect: () => downloadCSV(batchResult.results),
            },
          ]}
        />
      </Box>
    </Box>
  );
}

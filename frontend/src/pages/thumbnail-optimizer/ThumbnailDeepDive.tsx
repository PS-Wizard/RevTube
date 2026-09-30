// ─────────────────────────────────────────────────────────────────────────────
// ThumbnailDeepDive — shared deep-dive body for user + admin thumbnail optimizers
// User page and Admin page now render the same content; only the surrounding
// shell (accordion vs instance block, video chooser) differs.
// Score circle removed per request — pie chart carries the 12-pillar breakdown.
// ─────────────────────────────────────────────────────────────────────────────
import { Box } from '../../components/ui';
import { CheckCircle2 } from 'lucide-react';
import { EChartsPieChart } from '../../components/evilcharts/charts/echarts-pie-chart';
import { DetailedAnalysis } from './DetailedAnalysis';
import type { ThumbnailAudit } from '../../types/thumbnailOptimizer';

const PIE_PILLAR_COLORS: Record<string, string> = {
  promise_lock: '#3b82f6',
  one_idea_rule: '#f59e0b',
  scroll_stop_contrast: '#ef4444',
  emotional_signal: '#ec4899',
  thumb_magnet: '#8b5cf6',
  open_loop: '#06b6d4',
  visual_flow: '#10b981',
  glance_readability: '#f97316',
  pattern_break: '#eab308',
  execution_polish: '#14b8a6',
  word_economy: '#6366f1',
  platform_compliance: '#84cc16',
};

interface Props {
  audit: ThumbnailAudit;
  index: number;
  onDownload?: (audit: ThumbnailAudit) => void;
}

export function ThumbnailDeepDive({ audit }: Props) {
  const areas = Array.isArray(audit.detailedAreas) ? audit.detailedAreas : [];
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Top row: pie (left) + context+verdict stack (right) */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', lg: 'row' },
          gap: 3,
          alignItems: 'stretch',
        }}
      >
        {/* Left 38%: 12-pillar pie + download */}
        <Box
          sx={{
            width: { xs: '100%', lg: '38%' },
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            minWidth: 0,
            alignSelf: 'stretch',
          }}
        >
          <div className="rtis-pie-card">
            <div className="rtis-pie-card__header">12-Pillar Breakdown</div>
            <div className="rtis-pie-card__sub">Score share across all criteria</div>
            {areas.length > 0 ? (
              <>
                <EChartsPieChart
                  data={areas.map((a) => ({
                    name: a.area || 'Pillar',
                    value: Math.max(0.5, Number(a.score) || 0),
                  }))}
                  config={{
                    name: { label: 'Pillar', color: 'var(--rt-color-accent)' } as unknown as never,
                    ...Object.fromEntries(
                      areas.map((a) => [
                        a.area || 'Pillar',
                        { label: a.area, color: PIE_PILLAR_COLORS[(a.area || '').toLowerCase().replace(/\s+/g, '_')] || undefined },
                      ]),
                    ),
                  } as never}
                  donut="52%"
                  height={220}
                  showLegend={false}
                  showToolbar={false}
                  animation
                />
                <div className="rtis-pie-card__legend">
                  {areas.map((a) => (
                    <span key={a.area} className="rtis-pie-card__legend-item" title={`${a.area}: ${a.score}/10`}>
                      <span
                        className="rtis-pie-card__legend-dot"
                        style={{
                          background:
                            PIE_PILLAR_COLORS[(a.area || '').toLowerCase().replace(/\s+/g, '_')] || 'var(--rt-color-border-strong)',
                        }}
                      />
                      <span className="rtis-pie-card__legend-label">{a.area}</span>
                      <span className="rtis-pie-card__legend-value">{a.score}</span>
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <Box sx={{ py: 4, textAlign: 'center', color: 'var(--rt-color-text-tertiary)', fontSize: 'var(--rt-text-sm)' }}>
                No pillar data for this audit — run a new audit to see the 12-pillar pie.
              </Box>
            )}
          </div>


        </Box>

        {/* Right 62%: Context map + Verdict summary (verdict below context) */}
        <Box
          sx={{
            width: { xs: '100%', lg: '62%' },
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          <div className="rtis-context-card">
            <div className="rtis-context-header">Context Map</div>
            <div className="rtis-context-item">
              <div className="rtis-context-item-label">Niche</div>
              <div className="rtis-context-item-value">{audit.niche || 'N/A'}</div>
            </div>
            <div className="rtis-context-item">
              <div className="rtis-context-item-label">Audience</div>
              <div className="rtis-context-item-value">{audit.targetAudience || 'N/A'}</div>
            </div>
            <div className="rtis-context-item">
              <div className="rtis-context-item-label">Voice</div>
              <div className="rtis-context-item-value">{audit.brandVoice || 'N/A'}</div>
            </div>
          </div>

          <div className="rtis-verdict-card">
            <div className="rtis-verdict-label">
              <CheckCircle2 size={16} style={{ color: 'var(--rt-color-accent)' }} />
              Verdict Summary
            </div>
            <div className="rtis-verdict-text">
              &ldquo;{audit.reviewSummary}&rdquo;
            </div>
          </div>
        </Box>
      </Box>

      {/* Full-width detailed pillar cards */}
      <DetailedAnalysis areas={areas} />
    </Box>
  );
}

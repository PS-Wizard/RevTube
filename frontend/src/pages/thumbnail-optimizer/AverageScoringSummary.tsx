// ─────────────────────────────────────────────────────────────────────────────
// Thumbnail Optimizer -- Average scoring summary across all videos
// ─────────────────────────────────────────────────────────────────────────────
import React from 'react';
import { Box, Grid, Typography, Progress } from '../../components/ui';
import { BarChart3 } from 'lucide-react';
import type { ThumbnailAudit } from '../../types/thumbnailOptimizer';

interface AverageScoringSummaryProps {
  audits: ThumbnailAudit[];
}

function getScoreColor(score: number): string {
  if (score >= 8) return 'var(--rt-color-success)';
  if (score >= 5) return 'var(--rt-color-warning)';
  return 'var(--rt-color-danger)';
}

function getScoreBg(score: number): string {
  if (score >= 8) return 'var(--rt-color-success-surface)';
  if (score >= 5) return 'var(--rt-color-warning-surface)';
  return 'var(--rt-color-danger-surface)';
}

export const AverageScoringSummary: React.FC<AverageScoringSummaryProps> = ({ audits }) => {
  if (audits.length < 2) return null;

  // Collect all unique area names preserving insertion order
  const areaMap = new Map<string, number[]>();
  for (const audit of audits) {
    for (const area of audit.detailedAreas) {
      const scores = areaMap.get(area.area) || [];
      scores.push(area.score);
      areaMap.set(area.area, scores);
    }
  }

  const averages = Array.from(areaMap.entries())
    .map(([area, scores]) => ({
      area,
      avg: scores.reduce((a, b) => a + b, 0) / scores.length,
      count: scores.length,
    }))
    .sort((a, b) => b.avg - a.avg);

  const overallAvg =
    averages.reduce((sum, a) => sum + a.avg, 0) / averages.length;

  return (
    <Box
      sx={{
        mt: 6,
        p: 2.5,
        borderRadius: 'var(--rt-radius-lg)',
        bgcolor: 'var(--rt-color-bg-subtle)',
        border: '1px solid var(--rt-color-border)',
      }}
    >
      {/* ── Header ──────────────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
        <BarChart3 size={20} style={{ color: 'var(--rt-color-accent)' }} />
        <Box>
          <Typography
            variant="subtitle1"
            sx={{
              fontWeight: 'var(--rt-weight-bold)',
              fontSize: 'var(--rt-text-md)',
              color: 'var(--rt-color-text)',
              lineHeight: 1.3,
            }}
          >
            Average Scores Across {audits.length} Videos
          </Typography>
          <Typography
            variant="caption"
            sx={{
              fontSize: 'var(--rt-text-2xs)',
              color: 'var(--rt-color-text-secondary)',
              display: 'block',
              mt: 0.25,
            }}
          >
            Overall avg: {overallAvg.toFixed(1)}/10 &middot; {averages.length} evaluation pillars
          </Typography>
        </Box>
      </Box>

      {/* ── Score bars ───────────────────────────────────────────────── */}
      <Grid container spacing={1.5}>
        {averages.map(({ area, avg, count }) => (
          <Grid key={area} size={{ xs: 12, sm: 6, md: 4 }}>
            <Box
              sx={{
                p: 1.5,
                borderRadius: 'var(--rt-radius-md)',
                bgcolor: 'var(--rt-color-bg-elevated)',
                border: '1px solid var(--rt-color-border)',
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  mb: 0.75,
                }}
              >
                <Typography
                  variant="caption"
                  sx={{
                    fontSize: 'var(--rt-text-xs)',
                    fontWeight: 'var(--rt-weight-semibold)',
                    color: 'var(--rt-color-text)',
                    lineHeight: 1.2,
                    pr: 1,
                  }}
                >
                  {area}
                </Typography>
                <Box
                  sx={{
                    px: 1,
                    py: 0.15,
                    borderRadius: 'var(--rt-radius-pill)',
                    fontSize: 'var(--rt-text-2xs)',
                    fontWeight: 'var(--rt-weight-bold)',
                    flexShrink: 0,
                    bgcolor: getScoreBg(avg),
                    color: getScoreColor(avg),
                  }}
                >
                  {avg.toFixed(1)}
                </Box>
              </Box>

              <Progress
                variant="determinate"
                value={avg * 10}
                sx={{
                  height: 5,
                  borderRadius: 'var(--rt-radius-pill)',
                  bgcolor: 'var(--rt-color-border)',
                  '& .MuiLinearProgress-bar': {
                    bgcolor: getScoreColor(avg),
                    borderRadius: 'var(--rt-radius-pill)',
                  },
                }}
              />

              {count < audits.length && (
                <Typography
                  variant="caption"
                  sx={{
                    display: 'block',
                    mt: 0.35,
                    fontSize: 'var(--rt-text-3xs)',
                    color: 'var(--rt-color-text-tertiary)',
                  }}
                >
                  scored in {count}/{audits.length} videos
                </Typography>
              )}
            </Box>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
};

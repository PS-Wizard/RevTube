// ─────────────────────────────────────────────────────────────────────────────
// Thumbnail Optimizer -- Per-video deep-dive analysis cards
// ─────────────────────────────────────────────────────────────────────────────
import React from 'react';
import { Box, Card, CardContent, Typography, Progress, Grid } from '../../components/ui';
import type { OptimizationArea, Tier } from '../../types/thumbnailOptimizer';

interface DetailedAnalysisProps {
  areas: OptimizationArea[];
}

interface TierGroup {
  label: string;
  tier: Tier;
  cardClass: string;
  titleClass: string;
}

const TIER_GROUPS: TierGroup[] = [
  {
    label: 'Priority 1: Critical Fixes',
    tier: 'Red',
    cardClass: 'rtis-priority-card rtis-priority-card--red',
    titleClass: 'rtis-priority-title rtis-priority-title--red',
  },
  {
    label: 'Priority 2: Improvement Areas',
    tier: 'Yellow',
    cardClass: 'rtis-priority-card rtis-priority-card--yellow',
    titleClass: 'rtis-priority-title rtis-priority-title--yellow',
  },
  {
    label: 'Priority 3: Final Polish',
    tier: 'Grey',
    cardClass: 'rtis-priority-card rtis-priority-card--grey',
    titleClass: 'rtis-priority-title rtis-priority-title--grey',
  },
];

function getScoreBarColor(score: number): string {
  if (score >= 8) return 'var(--rt-color-success)';
  if (score >= 5) return 'var(--rt-color-warning)';
  return 'var(--rt-color-danger)';
}

function getScoreBadgeStyle(score: number) {
  if (score >= 8) {
    return {
      bgcolor: 'var(--rt-color-success-surface)',
      color: 'var(--rt-color-success)',
      borderColor: 'var(--rt-color-success)',
    };
  }
  if (score >= 5) {
    return {
      bgcolor: 'var(--rt-color-warning-surface)',
      color: 'var(--rt-color-warning)',
      borderColor: 'var(--rt-color-warning)',
    };
  }
  return {
    bgcolor: 'var(--rt-color-danger-surface)',
    color: 'var(--rt-color-danger)',
    borderColor: 'var(--rt-color-danger)',
  };
}

export const DetailedAnalysis: React.FC<DetailedAnalysisProps> = ({ areas }) => {
  return (
    <Box sx={{ mt: 2 }}>
      {TIER_GROUPS.map((tierGroup) => {
        const filteredAreas = areas.filter((a) => a.tier === tierGroup.tier);
        if (filteredAreas.length === 0) return null;

        return (
          <div key={tierGroup.tier} className={tierGroup.cardClass}>
            <div className="rtis-priority-header">
              <span className={tierGroup.titleClass}>
                {tierGroup.label}
              </span>
              <div className="rtis-priority-line" />
            </div>

            {/* 0.75rem gap (spacing=1.5) + 3-per-row from md, 4-per-row from xl.
                Previously spacing=2 (1rem gap) + md:6 meant only 2 cards fit
                per row -- the grid box sits inside the accordion's 72%-wide
                analysis column, far narrower than the viewport breakpoints
                that were deciding the layout. */}
            <Grid container spacing={1.5}>
              {filteredAreas.map((area, idx) => {
                const badgeStyle = getScoreBadgeStyle(area.score);

                return (
                  <Grid key={idx} size={{ xs: 12, sm: 6, md: 4, xl: 3 }}>
                    <Card className="rtis-area-item-card" variant="outlined">
                      <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
                        <Box
                          sx={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                            mb: 2,
                          }}
                        >
                          <Typography
                            variant="subtitle2"
                            sx={{
                              fontWeight: 'var(--rt-weight-bold)',
                              fontSize: 'var(--rt-text-sm)',
                              color: 'var(--rt-color-text)',
                              lineHeight: 1.3,
                            }}
                          >
                            {area.area}
                          </Typography>

                          <Box
                            sx={{
                              px: 1,
                              py: 0.25,
                              borderRadius: 'var(--rt-radius-pill)',
                              border: '1px solid',
                              fontSize: 'var(--rt-text-2xs)',
                              fontWeight: 'var(--rt-weight-bold)',
                              ml: 1,
                              flexShrink: 0,
                              ...badgeStyle,
                            }}
                          >
                            {area.score}/10
                          </Box>
                        </Box>

                        <Box sx={{ mb: 1.5 }}>
                          <Typography
                            variant="caption"
                            sx={{
                              fontWeight: 'var(--rt-weight-bold)',
                              textTransform: 'uppercase',
                              letterSpacing: '0.05em',
                              color: 'var(--rt-color-text-tertiary)',
                              display: 'block',
                              mb: 0.5,
                              fontSize: 'var(--rt-text-2xs)',
                            }}
                          >
                            Status
                          </Typography>
                          <Typography
                            variant="body2"
                            sx={{
                              color: 'var(--rt-color-text-secondary)',
                              fontStyle: 'italic',
                              fontSize: 'var(--rt-text-xs)',
                              lineHeight: 1.4,
                            }}
                          >
                            &ldquo;{area.status}&rdquo;
                          </Typography>
                        </Box>

                        <Box>
                          <Typography
                            variant="caption"
                            sx={{
                              fontWeight: 'var(--rt-weight-bold)',
                              textTransform: 'uppercase',
                              letterSpacing: '0.05em',
                              color: 'var(--rt-color-text-tertiary)',
                              display: 'block',
                              mb: 0.5,
                              fontSize: 'var(--rt-text-2xs)',
                            }}
                          >
                            Action Step
                          </Typography>
                          <Typography
                            variant="body2"
                            sx={{
                              color: 'var(--rt-color-text)',
                              fontSize: 'var(--rt-text-xs)',
                              lineHeight: 1.4,
                            }}
                          >
                            {area.opportunity}
                          </Typography>
                        </Box>
                      </CardContent>

                      <Box sx={{ px: 2.5, pb: 2 }}>
                        <Progress
                          variant="determinate"
                          value={area.score * 10}
                          sx={{
                            height: 4,
                            borderRadius: 'var(--rt-radius-pill)',
                            bgcolor: 'var(--rt-color-border)',
                            width: '100%',
                            maxWidth: '240px',
                            mx: 'auto',
                            '& .MuiLinearProgress-bar': {
                              bgcolor: getScoreBarColor(area.score),
                            },
                          }}
                        />
                      </Box>
                    </Card>
                  </Grid>
                );
              })}
            </Grid>
          </div>
        );
      })}
    </Box>
  );
};


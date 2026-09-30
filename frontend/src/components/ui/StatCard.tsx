import React from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from './card';
import { Flex, Stack } from './Stack';
import { Typography } from './Typography';

export type StatCardTone = 'neutral' | 'success' | 'info' | 'warning' | 'destructive';

export interface StatCardProps {
  tone?: StatCardTone;
  label: React.ReactNode;
  value: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}

const toneText: Record<StatCardTone, string> = {
  neutral: 'text-foreground',
  success: 'text-[var(--rt-color-success)]',
  info: 'text-[var(--rt-color-info)]',
  warning: 'text-[var(--rt-color-warning)]',
  destructive: 'text-[var(--rt-color-danger)]',
};

/**
 * StatCard — KPI tile: label + icon row over a large tinted value.
 *
 * The single sanctioned stat tile: pages pass `tone` + `label` + `value` +
 * `icon`, never hand-roll stat grids, emerald/amber palettes, or dark:
 * variants (tones resolve per-theme via tokens).
 */
export const StatCard: React.FC<StatCardProps> = ({
  tone = 'neutral',
  label,
  value,
  icon,
  className = '',
}) => {
  return (
    <Card size="sm" className={className}>
      <CardContent>
        <Stack gap={1}>
          <Flex justifyContent="space-between" alignItems="center" gap={0.5}>
            <Typography variant="caption" noWrap>
              {label}
            </Typography>
            {icon && <span className={cn('shrink-0', toneText[tone])}>{icon}</span>}
          </Flex>
          <Typography component="div" variant="h3" style={{ fontWeight: 700 }} className={toneText[tone]}>
            {value}
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
};

export default StatCard;

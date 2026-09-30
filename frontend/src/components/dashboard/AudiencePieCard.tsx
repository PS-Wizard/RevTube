/**
 * ECharts pie card for audience breakdowns (traffic source, device type,
 * gender): top slices plus an "Other" rollup when a total is provided, with
 * the same period-delta pills as the bar cards under each legend row.
 */
import React from 'react';
import { EChartsPieChart } from '../evilcharts/charts/echarts-pie-chart';
import { MULTI_SERIES_FALLBACK_COLORS, UI_NEUTRAL } from '../../utils/chartTheme';
import { AudienceMetricDeltas, type ChartRow } from '../DimensionsPanel';

const PALETTE = [...MULTI_SERIES_FALLBACK_COLORS, '#84cc16', '#6366f1'];

export interface PieSlice {
  name: string;
  value: number;
  isOther: boolean;
}

/**
 * Top-N slices + an "Other" rollup when totalForOther exceeds the shown sum.
 * Omit totalForOther (gender/device already sum to ~100) for no rollup.
 * Pure (unit-tested).
 */
export function buildPieSlices(
  rows: { name: string; views: number }[],
  totalForOther?: number,
  limit = 8,
): PieSlice[] {
  const top = (rows || []).slice(0, limit).map((r) => ({ name: r.name, value: Math.max(0, Number(r.views) || 0), isOther: false }));
  if (totalForOther !== undefined) {
    const rest = Math.max(0, (Number(totalForOther) || 0) - top.reduce((s, r) => s + r.value, 0));
    if (rest > 0) top.push({ name: 'Other', value: rest, isOther: true });
  }
  return top;
}

interface AudiencePieCardProps {
  data: ChartRow[];
  /** When provided and larger than the shown sum, the tail becomes "Other". */
  totalForOther?: number;
  /** Legend value text per row (traffic=share %, gender/device=raw %). */
  legendValue: (row: { views: number; pct: number }) => string;
  loading: boolean;
  primaryPeriod: 7 | 30 | 90;
  showDeltas: boolean;
  isCustom?: boolean;
  sliceLimit?: number;
}

export const AudiencePieCard: React.FC<AudiencePieCardProps> = ({
  data,
  totalForOther,
  legendValue,
  loading,
  primaryPeriod,
  showDeltas,
  isCustom = false,
  sliceLimit = 8,
}) => {
  const slices = React.useMemo(() => buildPieSlices(data, totalForOther, sliceLimit), [data, totalForOther, sliceLimit]);
  const colors = React.useMemo(() => slices.map((s, i) => (s.isOther ? UI_NEUTRAL : PALETTE[i % PALETTE.length])), [slices]);
  // Legend rows mirror slices; "Other" carries no deltas.
  const legendRows: (ChartRow & { color: string; isOther: boolean })[] = slices.map((s, i) => {
    const match = !s.isOther ? data.find((d) => d.name === s.name) : undefined;
    return {
      name: s.name,
      key: match?.key ?? s.name,
      views: s.value,
      pct: match?.pct ?? 0,
      delta7: match?.delta7 ?? null,
      delta30: match?.delta30 ?? null,
      delta90: match?.delta90 ?? null,
      color: colors[i],
      isOther: s.isOther,
    };
  });

  return (
    <div className="dp-pie-wrap">
      {loading ? (
        <div className="dp-skeleton" aria-busy="true" aria-label="Loading breakdown">
          <div className="dp-skeleton-bar-wrap"><div className="dp-skeleton-bar" style={{ width: '70%' }} /></div>
          <div className="dp-skeleton-bar-wrap"><div className="dp-skeleton-bar" style={{ width: '45%' }} /></div>
          <div className="dp-skeleton-bar-wrap"><div className="dp-skeleton-bar" style={{ width: '30%' }} /></div>
        </div>
      ) : slices.length === 0 ? (
        <div className="dp-empty"><span>No data available</span></div>
      ) : (
        <>
          <EChartsPieChart
            data={slices.map((s) => ({ name: s.name, value: Math.max(s.value, 0.5) }))}
            config={Object.fromEntries(slices.map((s, i) => [s.name, { label: s.name, color: colors[i] }]))}
            donut="52%"
            height={230}
            showLegend={false}
            showToolbar={false}
            animation
          />
          <div className="dp-donut-legend dp-pie-legend">
            {legendRows.map((row) => (
              <React.Fragment key={row.name}>
                <div className="dp-legend-item">
                  <span className="dp-legend-dot" style={{ background: row.color }} />
                  <span className="dp-legend-label" title={row.name}>{row.name}</span>
                </div>
                <span className="dp-legend-pct">{legendValue(row)}</span>
                <div className="dp-legend-deltas-cell">
                  {showDeltas && !row.isOther ? (
                    <AudienceMetricDeltas row={row} primaryPeriod={primaryPeriod} isCustom={isCustom} />
                  ) : null}
                </div>
              </React.Fragment>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

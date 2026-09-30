/**
 * Regression test: series parts wrapped in <>...</> fragments (as produced by
 * chartRenderer's compare-line + main-area grouping) must still be detected.
 * A shallow children pass sees only the fragment element, collects zero
 * series, and forces the "No data for this period." empty state even when
 * rows are present.
 */
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { EChartsAreaChart } from './echarts-area-chart';
import { buildOption } from './echarts-cartesian';
import type { EvilTokens } from '../ui/echarts-chart';

const rows = [{ date: '2026-09-11', views: 3 }];
const config = { views: { label: 'Views', color: '#3b82f6' } };

function renderChart(data: Array<Record<string, unknown>>) {
  return renderToString(
    <EChartsAreaChart data={data} config={config} xDataKey="date" height={400}>
      <EChartsAreaChart.Grid />
      <EChartsAreaChart.XAxis dataKey="date" />
      <EChartsAreaChart.YAxis />
      <EChartsAreaChart.Brush />
      <EChartsAreaChart.Tooltip />
      <>
        <EChartsAreaChart.Area dataKey="views" />
      </>
    </EChartsAreaChart>,
  );
}

describe('echarts-cartesian fragment series collection', () => {
  it('paints fragment-wrapped series instead of the empty state when rows exist', () => {
    expect(renderChart(rows)).not.toContain('No data for this period.');
  });

  it('still shows the empty state when there are no rows', () => {
    expect(renderChart([])).toContain('No data for this period.');
  });
});

describe('echarts-cartesian annotation label chrome', () => {
  const tokens: EvilTokens = {
    dark: false,
    text: '#111827',
    secondary: '#4b5563',
    tertiary: '#6b7280',
    border: '#e5e7eb',
    borderStrong: '#d1d5db',
    card: '#ffffff',
    appBg: '#f6f8fa',
    accent: '#3b82f6',
    success: '#059669',
    danger: '#dc2626',
    fontFamily: 'Inter, sans-serif',
  };

  function annotatedSeries() {
    const option = buildOption({
      data: [{ date: '2026-09-11', views: 10 }],
      config: { views: { label: 'Views', color: '#3b82f6' } },
      collected: {
        series: [
          {
            kind: 'area',
            dataKey: 'views',
            markLine: [{ y: 5, label: 'Avg' }],
            markPoint: [{ x: '2026-09-11', y: 10, label: '▲ spike' }],
          },
        ],
        xAxis: { present: true, dataKey: 'date' },
        yAxes: [],
        grid: true,
        tooltip: { present: true },
        legend: null,
        brush: null,
      },
      xKey: 'date',
      curveType: 'smooth',
      stackType: 'default',
      selectedKeys: null,
      showDataZoom: false,
      animation: false,
      tokens,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (option.series as any[])[0];
  }

  it('gives markLine labels a card background with padding', () => {
    const label = annotatedSeries().markLine.data[0].label;
    expect(label.backgroundColor).toBe('#ffffff');
    expect(label.padding).toEqual([2, 4]);
    expect(label.borderRadius).toBe(4);
    expect(label.borderColor).toBe('#e5e7eb');
  });

  it('gives markPoint labels a card background with padding', () => {
    const label = annotatedSeries().markPoint.data[0].label;
    expect(label.backgroundColor).toBe('#ffffff');
    expect(label.padding).toEqual([2, 4]);
    expect(label.borderRadius).toBe(4);
    expect(label.borderColor).toBe('#e5e7eb');
  });
});

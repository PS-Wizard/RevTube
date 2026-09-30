import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const createChart = require('./createChart');

describe('createChart tool', () => {
  it('returns a valid line chart spec with default colors', async () => {
    const result = await createChart.execute({
      type: 'line',
      title: 'Views Over Time',
      data: [
        { date: '2026-01-01', views: 100 },
        { date: '2026-01-02', views: 150 },
      ],
      xKey: 'date',
      series: [{ name: 'Views', dataKey: 'views' }],
    });

    expect(result.error).toBeUndefined();
    expect(result.chart).toBeDefined();
    expect(result.chart.type).toBe('line');
    expect(result.chart.title).toBe('Views Over Time');
    expect(result.chart.data).toHaveLength(2);
    expect(result.chart.xKey).toBe('date');
    expect(result.chart.series).toHaveLength(1);
    expect(result.chart.series[0].name).toBe('Views');
    expect(result.chart.series[0].dataKey).toBe('views');
    expect(result.chart.series[0].color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('returns a valid pie chart spec with name/value data', async () => {
    const result = await createChart.execute({
      type: 'pie',
      title: 'Traffic Sources',
      data: [
        { name: 'Search', value: 60 },
        { name: 'Suggested', value: 30 },
        { name: 'External', value: 10 },
      ],
      series: [{ name: 'Share', dataKey: 'value' }],
    });

    expect(result.error).toBeUndefined();
    expect(result.chart.type).toBe('pie');
    expect(result.chart.xKey).toBe('name');
    expect(result.chart.data).toHaveLength(3);
  });

  it('rejects an invalid chart type', async () => {
    const result = await createChart.execute({
      type: 'scatter',
      title: 'Bad',
      data: [{ x: 1, y: 2 }],
      series: [{ name: 'S', dataKey: 'y' }],
    });

    expect(result.error).toMatch(/Invalid chart type/);
    expect(result.chart).toBeUndefined();
  });

  it('rejects empty data', async () => {
    const result = await createChart.execute({
      type: 'bar',
      title: 'Empty',
      data: [],
      series: [{ name: 'S', dataKey: 'v' }],
    });

    expect(result.error).toMatch(/non-empty array/);
    expect(result.chart).toBeUndefined();
  });

  it('rejects data exceeding the max point limit', async () => {
    const data = Array.from({ length: 101 }, (_, i) => ({ label: `p${i}`, value: i }));
    const result = await createChart.execute({
      type: 'line',
      title: 'Too Many',
      data,
      series: [{ name: 'S', dataKey: 'value' }],
    });

    expect(result.error).toMatch(/exceeds 100 points/);
    expect(result.chart).toBeUndefined();
  });

  it('rejects missing series', async () => {
    const result = await createChart.execute({
      type: 'bar',
      title: 'No Series',
      data: [{ label: 'a', value: 1 }],
      series: [],
    });

    expect(result.error).toMatch(/at least one series/);
    expect(result.chart).toBeUndefined();
  });

  it('rejects more than 5 series', async () => {
    const series = Array.from({ length: 6 }, (_, i) => ({ name: `S${i}`, dataKey: `v${i}` }));
    const result = await createChart.execute({
      type: 'line',
      title: 'Too Many Series',
      data: [{ label: 'a', v0: 1, v1: 2, v2: 3, v3: 4, v4: 5, v5: 6 }],
      series,
    });

    expect(result.error).toMatch(/exceeds 5 series/);
    expect(result.chart).toBeUndefined();
  });

  it('rejects pie data missing name/value keys', async () => {
    const result = await createChart.execute({
      type: 'pie',
      title: 'Bad Pie',
      data: [{ label: 'a', amount: 1 }],
      series: [{ name: 'S', dataKey: 'value' }],
    });

    expect(result.error).toMatch(/name.*value/);
    expect(result.chart).toBeUndefined();
  });

  it('rejects non-object data items', async () => {
    const result = await createChart.execute({
      type: 'bar',
      title: 'Bad Data',
      data: [42],
      series: [{ name: 'S', dataKey: 'value' }],
    });

    expect(result.error).toMatch(/must be an object/);
    expect(result.chart).toBeUndefined();
  });

  it('preserves explicit series colors and axis labels', async () => {
    const result = await createChart.execute({
      type: 'bar',
      title: 'Channel Comparison',
      data: [
        { channel: 'A', views: 1000 },
        { channel: 'B', views: 2000 },
      ],
      xKey: 'channel',
      series: [{ name: 'Views', dataKey: 'views', color: '#ef4444' }],
      xAxisLabel: 'Channel',
      yAxisLabel: 'Views',
    });

    expect(result.error).toBeUndefined();
    expect(result.chart.series[0].color).toBe('#ef4444');
    expect(result.chart.xAxisLabel).toBe('Channel');
    expect(result.chart.yAxisLabel).toBe('Views');
  });
});
import { describe, it, expect } from 'vitest';
import { buildWorldMapOption, mapColorScale } from './echarts-map-chart';
import type { EvilTokens } from '@/components/evilcharts/ui/echarts-chart';

const TOKENS: EvilTokens = {
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

describe('mapColorScale', () => {
  it('mixes accent toward card and falls back for non-hex tokens', () => {
    const [light, strong] = mapColorScale('#3b82f6', '#ffffff');
    expect(strong).toBe('#3b82f6');
    expect(light).toMatch(/^#[0-9a-f]{6}$/);
    expect(light).not.toBe('#3b82f6');
    expect(mapColorScale('var(--x)', '#fff')).toEqual(['#dbeafe', '#1e40af']);
  });
});

describe('buildWorldMapOption', () => {
  const nameOf = (code: string) => ({ US: 'United States', DE: 'Germany' })[code] ?? code;

  it('joins data by A2 code with a max-scaled visualMap', () => {
    const option = buildWorldMapOption({
      items: [
        { name: 'US', value: 1200 },
        { name: 'DE', value: 300 },
      ],
      tokens: TOKENS,
      maxValue: 1200,
      nameOf,
    }) as unknown as {
      visualMap: { max: number; show: boolean };
      series: { data: { name: string; value: number }[] }[];
    };
    expect(option.visualMap.max).toBe(1200);
    expect(option.visualMap.show).toBe(false);
    expect(option.series[0].data).toHaveLength(2);
    // Single renderer only: a geo block + map series draws regions twice.
    expect('geo' in (option as unknown as Record<string, unknown>)).toBe(false);
  });

  it('passes zoom through to the series (card +/- controls)', () => {
    const option = buildWorldMapOption({
      items: [{ name: 'US', value: 10 }],
      tokens: TOKENS,
      maxValue: 10,
      nameOf,
      zoom: 2.5,
    }) as unknown as { series: { zoom: number }[] };
    expect(option.series[0].zoom).toBe(2.5);
  });

  it('tooltip shows display names and handles dataless regions', () => {
    const option = buildWorldMapOption({ items: [], tokens: TOKENS, maxValue: 0, nameOf }) as unknown as {
      tooltip: { formatter: (p: unknown) => string };
    };
    const withData = option.tooltip.formatter({ name: 'US', value: 1200 });
    expect(withData).toContain('United States');
    expect(withData).toContain('1,200');
    const withoutData = option.tooltip.formatter({ name: 'AQ' });
    expect(withoutData).toContain('AQ');
    expect(withoutData).toContain('No watch data');
  });
});

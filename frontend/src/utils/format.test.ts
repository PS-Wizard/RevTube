import { describe, expect, it } from 'vitest';
import { deltaPct, deltaTone, formatDelta, formatViews } from './format';

describe('formatViews', () => {
  it('renders a dash for missing values', () => {
    expect(formatViews(undefined)).toBe('–');
    expect(formatViews(null as unknown as number)).toBe('–');
  });

  it('keeps small counts exact', () => {
    expect(formatViews(0)).toBe('0');
    expect(formatViews(999)).toBe('999');
  });

  it('compacts larger counts', () => {
    expect(formatViews(1234)).toBe('1.2K');
    expect(formatViews(15000)).toBe('15K');
    expect(formatViews(1200000)).toBe('1.2M');
  });
});

describe('deltaPct', () => {
  it('returns null when a side is missing', () => {
    expect(deltaPct(undefined, 10)).toBeNull();
    expect(deltaPct(10, undefined)).toBeNull();
  });

  it('computes a positive change', () => {
    expect(deltaPct(110, 100)).toBe(10);
  });

  it('computes a negative change', () => {
    expect(deltaPct(90, 100)).toBe(-10);
  });

  it('treats no change as 0', () => {
    expect(deltaPct(0, 0)).toBe(0);
    expect(deltaPct(100, 100)).toBe(0);
  });

  it('hides growth from zero as not calculable', () => {
    expect(deltaPct(5, 0)).toBeNull();
  });
});

describe('formatDelta', () => {
  it('renders a dash for not calculable', () => {
    expect(formatDelta(null)).toBe('–');
  });

  it('renders arrows with sign', () => {
    expect(formatDelta(12)).toBe('↑ 12.0%');
    expect(formatDelta(-5)).toBe('↓ 5.0%');
    expect(formatDelta(0)).toBe('0.0%');
  });
});

describe('deltaTone', () => {
  it('maps positive, negative and flat to tones', () => {
    expect(deltaTone(12)).toBe('up');
    expect(deltaTone(-5)).toBe('down');
    expect(deltaTone(0)).toBe('neutral');
    expect(deltaTone(null)).toBe('neutral');
  });
});

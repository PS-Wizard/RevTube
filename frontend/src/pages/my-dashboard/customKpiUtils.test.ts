import { describe, it, expect } from 'vitest';
import {
  calcMetricDeltaPct,
  customCardMetricOptions,
  formatCustomCardValue,
  validateCustomCard,
  windowKeyForPeriod,
} from './customKpiUtils';

describe('custom KPI utils', () => {
  it('offers every channel metric as a builder option', () => {
    const options = customCardMetricOptions();
    expect(options.length).toBeGreaterThan(10);
    const ids = options.map((o) => o.id);
    expect(ids).toContain('views');
    expect(ids).toContain('watchTime');
    expect(ids).toContain('videosUploaded');
    for (const o of options) {
      expect(o.label).not.toBe(o.id);
    }
  });

  it('formats values by metric kind, never inventing zeros', () => {
    expect(formatCustomCardValue('views', 1234)).toBe('1,234');
    expect(formatCustomCardValue('views', null)).toBe('—');
    expect(formatCustomCardValue('views', Number.NaN)).toBe('—');
    expect(formatCustomCardValue('viewerPercentage', 12.345)).toBe('12.3%');
    expect(formatCustomCardValue('averageViewDuration', 65)).toBe('1:05');
  });

  it('computes null-safe delta percents (shared helper)', () => {
    expect(calcMetricDeltaPct(110, 100)).toBeCloseTo(10);
    expect(calcMetricDeltaPct(0, 0)).toBe(0);
    expect(calcMetricDeltaPct(5, 0)).toBe(100);
    expect(calcMetricDeltaPct(Number.NaN, 100)).toBeNull();
  });

  it('maps builder periods to stats windows', () => {
    expect(windowKeyForPeriod(7)).toBe('d7');
    expect(windowKeyForPeriod(30)).toBe('d30');
    expect(windowKeyForPeriod(90)).toBe('d90');
  });

  it('validates builder input', () => {
    expect(validateCustomCard({ label: '', metric: 'views', period: 30 })).toBe(
      'Give the card a name.',
    );
    expect(validateCustomCard({ label: 'x', metric: 'nope', period: 30 })).toBe(
      'Pick a metric for the card.',
    );
    expect(validateCustomCard({ label: 'x', metric: 'views', period: 14 })).toBe(
      'Pick a comparison window.',
    );
    expect(validateCustomCard({ label: 'My views', metric: 'views', period: 30 })).toBeNull();
  });
});

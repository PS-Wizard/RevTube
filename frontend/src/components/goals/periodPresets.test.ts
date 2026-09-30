import { describe, it, expect } from 'vitest';
import { buildPeriodPresets } from './periodPresets';

describe('buildPeriodPresets', () => {
  const mockDate = new Date('2026-08-20T12:00:00Z');

  it('generates weekly, monthly, 90-day, quarterly, half-yearly, and yearly presets', () => {
    const presets = buildPeriodPresets(mockDate);

    expect(presets.length).toBeGreaterThan(5);

    const types = presets.map((p) => p.periodType);
    expect(types).toContain('weekly');
    expect(types).toContain('monthly');
    expect(types).toContain('90_days');
    expect(types).toContain('quarterly');
    expect(types).toContain('half_yearly');
    expect(types).toContain('yearly');

    const q3 = presets.find((p) => p.periodKey === '2026-Q3');
    expect(q3).toBeDefined();
    expect(q3?.startDate).toBe('2026-07-01');
    expect(q3?.endDate).toBe('2026-09-30');

    const fullYear = presets.find((p) => p.periodKey === '2026');
    expect(fullYear).toBeDefined();
    expect(fullYear?.startDate).toBe('2026-01-01');
    expect(fullYear?.endDate).toBe('2026-12-31');
  });
});

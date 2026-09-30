import { describe, it, expect } from 'vitest';
import { buildPieSlices } from './AudiencePieCard';

describe('buildPieSlices', () => {
  it('takes the top slices and rolls the tail into Other when a total is given', () => {
    const rows = Array.from({ length: 9 }, (_, i) => ({ name: `S${i + 1}`, views: 100 - i * 10 }));
    const slices = buildPieSlices(rows, 1000, 6);
    expect(slices).toHaveLength(7);
    expect(slices[0]).toMatchObject({ name: 'S1', value: 100, isOther: false });
    // Top-6 sum = 100+90+80+70+60+50 = 450; Other = 1000-450.
    expect(slices[6]).toMatchObject({ name: 'Other', value: 550, isOther: true });
  });

  it('omits Other when the shown sum covers the total', () => {
    const slices = buildPieSlices(
      [
        { name: 'A', views: 60 },
        { name: 'B', views: 40 },
      ],
      100,
    );
    expect(slices).toHaveLength(2);
    expect(slices.every((s) => !s.isOther)).toBe(true);
  });

  it('adds no rollup without a total (gender/device shares)', () => {
    const slices = buildPieSlices([
      { name: 'Male', views: 55 },
      { name: 'Female', views: 45 },
    ]);
    expect(slices).toHaveLength(2);
  });

  it('returns [] with no data', () => {
    expect(buildPieSlices([], 0)).toEqual([]);
  });
});

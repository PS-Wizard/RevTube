import { describe, it, expect } from 'vitest';
import { computeAudienceHero } from './AudienceHeroRow';

const COUNTRY = {
  rows: [
    ['US', 1200],
    ['DE', 300],
    ['IN', 500],
  ] as [string, number][],
  nameOf: (c: string) => ({ US: 'United States', DE: 'Germany', IN: 'India' })[c] ?? c,
};
const TRAFFIC = {
  rows: [
    ['YT_SEARCH', 1000],
    ['SHORTS', 600],
  ] as [string, number][],
  nameOf: (k: string) => ({ YT_SEARCH: 'YouTube Search', SHORTS: 'Shorts Feed' })[k] ?? k,
};
const DEVICE = { rows: [['MOBILE', 1400], ['DESKTOP', 600]] as [string, number][] };

describe('computeAudienceHero', () => {
  it('picks top country/traffic by views and mobile share', () => {
    const tiles = computeAudienceHero({ country: COUNTRY, traffic: TRAFFIC, device: DEVICE });
    expect(tiles).toHaveLength(4);
    expect(tiles[0]).toMatchObject({ label: 'Top country', value: 'United States' });
    expect(tiles[0].sub).toContain('60.0%');
    expect(tiles[1]).toMatchObject({ label: 'Countries tracked', value: '3' });
    expect(tiles[2]).toMatchObject({ label: 'Top traffic source', value: 'YouTube Search' });
    expect(tiles[3]).toMatchObject({ label: 'Mobile share', value: '70.0%' });
  });

  it('returns [] with no data (never zero-fills)', () => {
    expect(computeAudienceHero({ country: null, traffic: null, device: null })).toEqual([]);
    expect(
      computeAudienceHero({
        country: { rows: [], nameOf: (c) => c },
        traffic: { rows: [], nameOf: (k) => k },
        device: { rows: [] },
      }),
    ).toEqual([]);
  });
});

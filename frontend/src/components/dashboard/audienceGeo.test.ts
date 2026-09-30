import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  A2_TO_A3,
  buildCountryMapData,
  loadWorldGeoJSON,
  renameFeaturesToA2,
  __resetGeoCache,
  type WorldGeoJSON,
} from './audienceGeo';

afterEach(() => {
  __resetGeoCache();
});

describe('A2_TO_A3', () => {
  it('covers the panel country codes with valid ISO_A3 values', () => {
    for (const code of ['US', 'GB', 'IN', 'DE', 'BR', 'JP', 'LA', 'CI', 'KR', 'TW']) {
      expect(A2_TO_A3[code], code).toMatch(/^[A-Z]{3}$/);
    }
    expect(A2_TO_A3.US).toBe('USA');
    expect(A2_TO_A3.GB).toBe('GBR');
    expect(A2_TO_A3.DE).toBe('DEU');
  });
});

describe('renameFeaturesToA2', () => {
  it('renames matched features and is idempotent', () => {
    const geo: WorldGeoJSON = {
      features: [
        { id: 'USA', properties: { name: 'United States of America' } },
        { id: 'DEU', properties: { name: 'Germany' } },
        { id: 'ATA', properties: { name: 'Antarctica' } },
      ],
    };
    expect(renameFeaturesToA2(geo)).toBe(2);
    expect(geo.features[0].properties?.name).toBe('US');
    expect(renameFeaturesToA2(geo)).toBe(2);
    expect(geo.features[2].properties?.name).toBe('Antarctica');
  });
});

describe('buildCountryMapData', () => {
  it('joins known codes and skips unknown ones', () => {
    expect(
      buildCountryMapData([
        { key: 'US', views: 1200 },
        { key: 'XX', views: 5 },
        { key: 'de', views: 300 },
      ]),
    ).toEqual([
      { name: 'US', value: 1200 },
      { name: 'DE', value: 300 },
    ]);
  });
});

describe('loadWorldGeoJSON', () => {
  const payload: WorldGeoJSON = {
    features: [{ id: 'USA', properties: { name: 'United States of America' } }],
  };

  it('fetches once, renames, and caches per page load', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => payload }) as Response);
    const first = await loadWorldGeoJSON(fetchImpl);
    const second = await loadWorldGeoJSON(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(first.features[0].properties?.name).toBe('US');
  });

  it('throws on HTTP errors and does not cache the failure', async () => {
    const failing = vi.fn(async () => ({ ok: false, status: 503 }) as Response);
    await expect(loadWorldGeoJSON(failing)).rejects.toThrow('HTTP 503');
    const succeeding = vi.fn(async () => ({ ok: true, json: async () => payload }) as Response);
    await expect(loadWorldGeoJSON(succeeding)).resolves.toBeTruthy();
    expect(succeeding).toHaveBeenCalledTimes(1);
  });
});

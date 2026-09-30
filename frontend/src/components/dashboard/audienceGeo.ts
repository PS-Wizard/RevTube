/**
 * World-map data helpers for the Audience tab.
 *
 * Country shapes come from a runtime CDN fetch (johan/world.geo.json,
 * Feature `id` = ISO_A3). The YouTube dimensions API reports ISO_A2, so
 * this module maps A2 -> A3 and renames matched GeoJSON features to their
 * A2 code -- ECharts joins series data to regions by feature name. Unknown
 * or unmatched countries stay in the ranked list below the map (graceful
 * degradation, same as the offline fallback).
 */

export const WORLD_GEOJSON_URL =
  'https://cdn.jsdelivr.net/gh/johan/world.geo.json@master/countries.geo.json';

export const MAP_NAME = 'revtube-world';

/** ISO_A2 -> ISO_A3 for every code in the panel's COUNTRY_NAMES. */
export const A2_TO_A3: Record<string, string> = {
  US: 'USA', GB: 'GBR', IN: 'IND', CA: 'CAN', AU: 'AUS', DE: 'DEU', FR: 'FRA',
  BR: 'BRA', JP: 'JPN', KR: 'KOR', MX: 'MEX', ID: 'IDN', RU: 'RUS', IT: 'ITA',
  ES: 'ESP', TR: 'TUR', SA: 'SAU', PK: 'PAK', NG: 'NGA', PH: 'PHL', EG: 'EGY',
  TH: 'THA', VN: 'VNM', UA: 'UKR', PL: 'POL', NL: 'NLD', AR: 'ARG', MY: 'MYS',
  ZA: 'ZAF', BD: 'BGD', CO: 'COL', CL: 'CHL', RO: 'ROU', SE: 'SWE', BE: 'BEL',
  PT: 'PRT', GR: 'GRC', CZ: 'CZE', HU: 'HUN', AT: 'AUT', CH: 'CHE', NO: 'NOR',
  DK: 'DNK', FI: 'FIN', NZ: 'NZL', SG: 'SGP', HK: 'HKG', TW: 'TWN', IL: 'ISR',
  AE: 'ARE', IQ: 'IRQ', MA: 'MAR', DZ: 'DZA', KE: 'KEN', GH: 'GHA', ET: 'ETH',
  TZ: 'TZA', UG: 'UGA', CM: 'CMR', CI: 'CIV', PE: 'PER', VE: 'VEN', EC: 'ECU',
  BO: 'BOL', PY: 'PRY', UY: 'URY', CR: 'CRI', GT: 'GTM', CU: 'CUB',
  DO: 'DOM', SK: 'SVK', HR: 'HRV', BG: 'BGR', RS: 'SRB', LT: 'LTU', LV: 'LVA',
  EE: 'EST', SI: 'SVN', BY: 'BLR', KZ: 'KAZ', UZ: 'UZB', AZ: 'AZE', GE: 'GEO',
  AM: 'ARM', LK: 'LKA', NP: 'NPL', MM: 'MMR', KH: 'KHM', LA: 'LAO',
};

const A3_TO_A2: Record<string, string> = Object.fromEntries(
  Object.entries(A2_TO_A3).map(([a2, a3]) => [a3, a2]),
);

export interface GeoFeature {
  id?: string;
  properties?: { name?: string; [k: string]: unknown };
}

export interface WorldGeoJSON {
  features: GeoFeature[];
  [k: string]: unknown;
}

/**
 * Rename matched features to their A2 code so ECharts series data
 * ({name: 'US', value}) joins by feature name. Idempotent -- rerunning is
 * a no-op. Returns how many features were matched (for diagnostics).
 */
export function renameFeaturesToA2(geo: WorldGeoJSON): number {
  let matched = 0;
  for (const f of geo.features || []) {
    const a2 = f.id ? A3_TO_A2[String(f.id).toUpperCase()] : undefined;
    if (a2) {
      if (!f.properties) f.properties = {};
      f.properties.name = a2;
      matched++;
    }
  }
  return matched;
}

export interface MapDatum {
  /** A2 code. */
  name: string;
  value: number;
}

/** Join ranked country rows onto the map. Unknown codes are skipped (list still shows them). */
export function buildCountryMapData(rows: { key: string; views: number }[]): MapDatum[] {
  return (rows || [])
    .filter((r) => A2_TO_A3[String(r.key || '').toUpperCase()])
    .map((r) => ({ name: String(r.key).toUpperCase(), value: Number(r.views) || 0 }));
}

let geoPromise: Promise<WorldGeoJSON> | null = null;

/** Fetch + prepare the world shapes once per page load (module-level cache). */
export function loadWorldGeoJSON(fetchImpl: typeof fetch = fetch): Promise<WorldGeoJSON> {
  if (!geoPromise) {
    geoPromise = (async () => {
      const res = await fetchImpl(WORLD_GEOJSON_URL);
      if (!res.ok) throw new Error(`Map shapes unavailable (HTTP ${res.status})`);
      const geo = (await res.json()) as WorldGeoJSON;
      if (!Array.isArray(geo.features) || geo.features.length === 0) {
        throw new Error('Map shapes payload has no features');
      }
      renameFeaturesToA2(geo);
      return geo;
    })();
    // Don't cache rejections -- a retry after reconnect should refetch.
    geoPromise.catch(() => {
      geoPromise = null;
    });
  }
  return geoPromise;
}

/** Test hook: reset the module cache. */
export function __resetGeoCache(): void {
  geoPromise = null;
}

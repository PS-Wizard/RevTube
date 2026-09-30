/**
 * Audience hero tiles: top country, countries tracked, top traffic source,
 * mobile share. Presentational -- DimensionsPanel computes the numbers via
 * computeAudienceHero (pure, unit-tested) from the primary bundle reports.
 */

export interface HeroTile {
  label: string;
  value: string;
  sub: string;
  /** Card customization: false hides the detail line (layout `compact`). */
  showSub?: boolean;
}

interface RawReport {
  rows: [string, number][];
}

function share(rows: RawReport['rows'], key: string): number | null {
  const total = rows.reduce((s, r) => s + (Number(r[1]) || 0), 0);
  if (total <= 0) return null;
  const row = rows.find((r) => String(r[0]) === key);
  if (!row) return null;
  return ((Number(row[1]) || 0) / total) * 100;
}

export interface HeroInput {
  country: (RawReport & { nameOf: (code: string) => string }) | null;
  traffic: (RawReport & { nameOf: (key: string) => string }) | null;
  device: RawReport | null;
}

export function fmtCompact(n: number): string {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

/** Pure hero computation (unit-tested). Nulls mean "no data", never zero-fill. */
export function computeAudienceHero(input: HeroInput): HeroTile[] {
  const tiles: HeroTile[] = [];

  const cRows = input.country?.rows ?? [];
  const cTotal = cRows.reduce((s, r) => s + (Number(r[1]) || 0), 0);
  if (cRows.length > 0 && cTotal > 0) {
    const [code, views] = [...cRows].sort((a, b) => Number(b[1]) - Number(a[1]))[0];
    const pct = ((Number(views) || 0) / cTotal) * 100;
    tiles.push({
      label: 'Top country',
      value: input.country?.nameOf(String(code)) ?? String(code),
      sub: `${fmtCompact(Number(views))} views · ${pct.toFixed(1)}% share`,
    });
    tiles.push({ label: 'Countries tracked', value: String(cRows.length), sub: `${fmtCompact(cTotal)} views total` });
  }

  const tRows = input.traffic?.rows ?? [];
  const tTotal = tRows.reduce((s, r) => s + (Number(r[1]) || 0), 0);
  if (tRows.length > 0 && tTotal > 0) {
    const [key, views] = [...tRows].sort((a, b) => Number(b[1]) - Number(a[1]))[0];
    const pct = ((Number(views) || 0) / tTotal) * 100;
    tiles.push({
      label: 'Top traffic source',
      value: input.traffic?.nameOf(String(key)) ?? String(key),
      sub: `${pct.toFixed(1)}% of views`,
    });
  }

  const mobile = input.device ? share(input.device.rows, 'MOBILE') : null;
  if (mobile !== null) {
    tiles.push({ label: 'Mobile share', value: `${mobile.toFixed(1)}%`, sub: 'of watch views' });
  }

  return tiles;
}

export const AudienceHeroRow: React.FC<{ tiles: HeroTile[]; loading: boolean }> = ({ tiles, loading }) => {
  if (loading) {
    return (
      <div className="aud-hero-grid" aria-busy="true" aria-label="Loading audience highlights">
        {[0, 1, 2, 3].map((i) => (
          <div className="dp-card aud-hero-tile" key={i}>
            <div className="aud-hero-label"><div className="dp-skeleton-mini" style={{ width: 90, justifySelf: 'start' }} /></div>
            <div className="aud-hero-value"><div className="dp-skeleton-mini" style={{ width: 120, justifySelf: 'start' }} /></div>
            <div className="aud-hero-sub"><div className="dp-skeleton-mini" style={{ width: 140, justifySelf: 'start' }} /></div>
          </div>
        ))}
      </div>
    );
  }
  if (tiles.length === 0) return null;
  return (
    <div className="aud-hero-grid">
      {tiles.map((t) => (
        <div className="dp-card aud-hero-tile" key={t.label}>
          <div className="aud-hero-label">{t.label}</div>
          <div className="aud-hero-value" title={t.value}>{t.value}</div>
          {t.showSub !== false && <div className="aud-hero-sub">{t.sub}</div>}
        </div>
      ))}
    </div>
  );
};

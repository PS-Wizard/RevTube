/** Compact count formatting, e.g. 1234 -> "1.2K", 0 -> "0", undefined -> "–". */
export function formatViews(n?: number): string {
  if (n === undefined || n === null) return '–';
  return Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

/** Percent change vs the previous period. null when not calculable (growth from zero). */
export function deltaPct(current: number | undefined, previous: number | undefined): number | null {
  if (current === undefined || previous === undefined) return null;
  if (isNaN(current) || isNaN(previous)) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  const pct = ((current - previous) / previous) * 100;
  return isFinite(pct) ? pct : null;
}

/** Tailwind-free trend styling helpers shared by the playlist picker + optimizer page. */
export function deltaTone(pct: number | null): 'up' | 'down' | 'neutral' {
  if (pct === null) return 'neutral';
  if (pct > 0) return 'up';
  if (pct < 0) return 'down';
  return 'neutral';
}

/** Signed delta text, e.g. 12 -> "↑ 12.0%", -5 -> "↓ 5.0%", 0 -> "0.0%", null -> "–". */
export function formatDelta(pct: number | null): string {
  if (pct === null) return '–';
  if (pct === 0) return '0.0%';
  return `${pct > 0 ? '↑' : '↓'} ${Math.abs(pct).toFixed(1)}%`;
}

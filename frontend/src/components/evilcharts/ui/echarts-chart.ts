/**
 * EvilCharts shared contract for RevTube (ECharts provider).
 *
 * Mirrors https://evilcharts.com/docs/echarts/installation : Apache ECharts under the
 * hood, Canvas by default with `renderer="svg"` opt-in, `data` + `config` on every
 * chart root, declarative children (`<Area/>`, `<XAxis/>`, `<Tooltip/>`, ...).
 *
 * Series hex stays in `utils/chartTheme.ts` (single source of truth, synced with
 * `--rt-chart-*` tokens). Neutrals (axis text, grid, tooltip surface) resolve from
 * live `--rt-*` CSS vars at runtime, because the ECharts canvas cannot read CSS vars
 * and must follow light/dark mode switches.
 */
import { useSyncExternalStore } from 'react';
import { MULTI_SERIES_FALLBACK_COLORS } from '@/utils/chartTheme';

export type EChartsRenderer = 'canvas' | 'svg';

export interface ChartSeriesEntry {
  label?: string;
  color?: string;
  colors?: { light: string[]; dark: string[] };
}

export type ChartConfig = Record<string, ChartSeriesEntry>;

export interface EvilTokens {
  dark: boolean;
  text: string;
  secondary: string;
  tertiary: string;
  border: string;
  borderStrong: string;
  card: string;
  appBg: string;
  accent: string;
  success: string;
  danger: string;
  fontFamily: string;
}

const FALLBACKS: EvilTokens = {
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
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
};

export function cssVar(name: string): string {
  if (typeof window === 'undefined' || typeof getComputedStyle === 'undefined') return '';
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  } catch {
    return '';
  }
}

export function isDarkMode(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.documentElement;
  return el.dataset.theme === 'dark' || el.classList.contains('dark');
}

/** Resolve neutral tokens from live CSS vars (follows light/dark mode). */
export function evilTokens(): EvilTokens {
  const dark = isDarkMode();
  if (typeof window === 'undefined') return { ...FALLBACKS, dark };
  const pick = (n: string, fb: string) => cssVar(n) || fb;
  return {
    dark,
    text: pick('--rt-color-text', FALLBACKS.text),
    secondary: pick('--rt-color-text-secondary', FALLBACKS.secondary),
    tertiary: pick('--rt-color-text-tertiary', FALLBACKS.tertiary),
    border: pick('--rt-color-border', FALLBACKS.border),
    borderStrong: pick('--rt-color-border-strong', FALLBACKS.borderStrong),
    card: pick('--rt-card-bg', FALLBACKS.card) || pick('--rt-color-bg-elevated', FALLBACKS.card),
    appBg: pick('--rt-color-bg-app', FALLBACKS.appBg),
    accent: pick('--rt-color-accent', FALLBACKS.accent),
    success: pick('--rt-color-success', FALLBACKS.success),
    danger: pick('--rt-color-danger', FALLBACKS.danger),
    fontFamily: pick('--rt-font-sans', FALLBACKS.fontFamily) || FALLBACKS.fontFamily,
  };
}

// ── Theme subscription (re-render on light/dark flip) ───────────────────────

const themeListeners = new Set<() => void>();
let themeObserved = false;

function themeSnapshot(): string {
  if (typeof document === 'undefined') return 'light';
  const el = document.documentElement;
  return el.dataset.theme === 'dark' || el.classList.contains('dark') ? 'dark' : 'light';
}

function subscribeTheme(fn: () => void): () => void {
  themeListeners.add(fn);
  if (!themeObserved && typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    themeObserved = true;
    new MutationObserver(() => {
      themeListeners.forEach((l) => l());
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
  }
  return () => {
    themeListeners.delete(fn);
  };
}

/** Re-renders the caller when light/dark mode flips so ECharts options rebuild with fresh tokens. */
export function useEvilThemeKey(): string {
  return useSyncExternalStore(subscribeTheme, themeSnapshot, () => 'light');
}

/** Paint color for a series key: explicit color > light/dark slot > fallback rotation. */
export function seriesColor(key: string, config: ChartConfig, dark: boolean, index = 0): string {
  const entry = config[key];
  if (entry?.color) return entry.color;
  if (entry?.colors) {
    const slots = dark ? entry.colors.dark : entry.colors.light;
    if (slots?.length) return slots[index % slots.length];
  }
  return MULTI_SERIES_FALLBACK_COLORS[index % MULTI_SERIES_FALLBACK_COLORS.length];
}

export function seriesLabel(key: string, config: ChartConfig): string {
  const label = config[key]?.label;
  return typeof label === 'string' && label ? label : key;
}

// ── Formatters ──────────────────────────────────────────────────────────────

/**
 * Shared tooltip surface for custom `tooltipFormatter`s. The cartesian factory
 * renders tooltip containers transparent with zero padding (`backgroundColor:
 * 'transparent', borderWidth: 0, padding: 0`), so any custom formatter MUST
 * wrap its rows in this shell or the text floats over the plot with no
 * background. Theme-aware via `--rt-*` tokens (follows light/dark mode with
 * no token plumbing at the call site). Mirrors the factory default popup.
 */
export const tooltipShellStyle =
  'min-width:150px;max-width:320px;box-sizing:border-box;white-space:normal;overflow-wrap:break-word;' +
  'border-radius:8px;border:1px solid var(--rt-color-border);' +
  'background:var(--rt-card-bg, var(--rt-color-bg-elevated));box-shadow:0 4px 12px rgba(0,0,0,0.12);' +
  'padding:8px 12px;font-family:var(--rt-font-sans);font-size:12px;line-height:1.45;color:var(--rt-color-text);';

export const fmtCompact = (n: number): string => {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n * 10) / 10);
};

export const fmtFull = (n: number): string =>
  Number.isFinite(n) ? n.toLocaleString('en-US') : '—';

export const fmtDateShort = (v: unknown): string => {
  if (typeof v !== 'string' || !v) return String(v ?? '');
  const d = new Date(v.includes('T') ? v : `${v}T00:00:00`);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export const fmtDateLong = (v: unknown): string => {
  if (typeof v !== 'string' || !v) return String(v ?? '');
  const d = new Date(v.includes('T') ? v : `${v}T00:00:00`);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

export const fmtSeconds = (totalSeconds: number): string => {
  if (!Number.isFinite(totalSeconds)) return '—';
  const m = Math.floor(totalSeconds / 60);
  const s = Math.round(totalSeconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
};

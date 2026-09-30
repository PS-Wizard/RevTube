/**
 * RevTube palette for MUI -- values must stay aligned with `design-tokens.css`
 * (:root and [data-theme='dark']). Type scale: `--rt-text-md` (body), `--rt-text-sm`,
 * `--rt-text-xs`, `--rt-text-2xs`, `--rt-text-badge-sm`, `--rt-text-pill`.
 */

export type PaletteMode = 'light' | 'dark';

/** Matches `--rt-shell-content-max-width` */
export const RT_SHELL_CONTENT_MAX_WIDTH_PX = 1440;

/**
 * Accent scale -- mirrors `--rt-color-accent` / `--rt-color-accent-hover` in
 * design-tokens.css so MUI and CSS never drift apart.
 */
export const RT_ACCENT = { light: '#3b82f6', dark: '#60a5fa' } as const;
export const RT_ACCENT_STRONG = { light: '#2563eb', dark: '#3b82f6' } as const;

/** Solid action surface -- mirrors `--rt-color-btn-primary(-hover)`. */
export const RT_BTN_SOLID = { light: '#111111', dark: '#3b82f6' } as const;
export const RT_BTN_SOLID_HOVER = { light: '#000000', dark: '#2563eb' } as const;

export interface RtSemanticPalette {
  bgApp: string;
  bgElevated: string;
  bgSubtle: string;
  bgMuted: string;
  border: string;
  borderStrong: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  divider: string;
  shadowXs: string;
  shadowSm: string;
  radiusMd: number;
  radiusLg: number;
  radiusPaper: number;
}

const light: RtSemanticPalette = {
  bgApp: '#f5f7fa',
  bgElevated: '#ffffff',
  bgSubtle: '#f8fafc',
  bgMuted: '#f1f5f9',
  border: '#e5e7eb',
  borderStrong: '#d1d5db',
  text: '#111827',
  textSecondary: '#4b5563',
  textTertiary: '#6b7280',
  divider: '#e5e7eb',
  shadowXs: '0 1px 2px rgba(15, 23, 42, 0.04)',
  shadowSm: '0 1px 3px rgba(0, 0, 0, 0.06)',
  radiusMd: 4,
  radiusLg: 8,
  radiusPaper: 8,
};

const dark: RtSemanticPalette = {
  bgApp: '#0f1117',
  bgElevated: '#1a1d27',
  bgSubtle: '#141720',
  bgMuted: '#22252e',
  border: 'rgba(255, 255, 255, 0.1)',
  borderStrong: 'rgba(255, 255, 255, 0.16)',
  text: 'rgba(255, 255, 255, 0.92)',
  textSecondary: 'rgba(255, 255, 255, 0.65)',
  textTertiary: 'rgba(255, 255, 255, 0.45)',
  divider: 'rgba(255, 255, 255, 0.1)',
  shadowXs: '0 1px 2px rgba(0, 0, 0, 0.2)',
  shadowSm: '0 1px 3px rgba(0, 0, 0, 0.25)',
  radiusMd: 4,
  radiusLg: 8,
  radiusPaper: 8,
};

export function getRtSemanticPalette(mode: PaletteMode): RtSemanticPalette {
  return mode === 'dark' ? dark : light;
}

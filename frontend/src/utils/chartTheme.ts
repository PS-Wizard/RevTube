/**
 * Shared Recharts layout + axis styling for dashboard analytics charts.
 * Series colors live in design-tokens.css as --rt-chart-*.
 */

export const CHART_MARGIN_DESKTOP = { top: 14, right: 48, bottom: 28, left: 48 } as const;
export const CHART_MARGIN_MOBILE = { top: 16, right: 16, bottom: 24, left: 12 } as const;

export const isMobileViewport = () =>
  typeof globalThis.window !== 'undefined' && globalThis.window.matchMedia('(max-width: 768px)').matches;

export const getChartMargin = () =>
  isMobileViewport() ? { ...CHART_MARGIN_MOBILE } : { ...CHART_MARGIN_CLEAN };
export const getYAxisWidth = () => (isMobileViewport() ? 34 : 44);

/** Ledger-style minimal axes (no spine / tick marks). */
export const CHART_AXIS_PROPS = {
  axisLine: false,
  tickLine: false,
  stroke: 'var(--rt-color-text-tertiary)',
  tick: { fill: 'var(--rt-color-text-tertiary)', fontSize: 11, fontFamily: 'var(--rt-font-sans)' },
  minTickGap: 24,
  interval: 'preserveStartEnd' as const,
} as const;

export const CHART_Y_AXIS_PROPS = {
  ...CHART_AXIS_PROPS,
  tick: { fill: 'var(--rt-color-text-tertiary)', fontSize: 11, fontFamily: 'var(--rt-font-sans)' },
  width: undefined as number | undefined,
} as const;

export const CHART_GRID_PROPS = {
  strokeDasharray: '4 4',
  vertical: false,
  stroke: 'var(--rt-color-border)',
} as const;

/** Tighter margins when axes have no spines (ledger dashboards). */
export const CHART_MARGIN_CLEAN = { top: 18, right: 12, bottom: 24, left: 4 } as const;

/** Area fill under line -- subtle, matches video analytics charts */
export const AREA_GRADIENT_OPACITY = { top: 0.18, bottom: 0.02 } as const;

/** Area interpolation: `natural` overshoots extrema between points. `monotone` is smooth for time series with far less overshoot; `linear` is sharpest. */
export const CHART_AREA_CURVE = 'monotone' as const;

/** Shared sync id when multiple charts should share hover index (ledger `syncId="dashboard"`). */
export const CHART_SYNC_ID = 'revtube-analytics';

/** Vertical crosshair on area charts -- light band + dashed line */
export const TOOLTIP_CURSOR_AREA = {
  stroke: 'var(--rt-color-border-strong)',
  strokeWidth: 1,
  strokeDasharray: '4 4',
  fill: 'color-mix(in srgb, var(--rt-color-text-tertiary) 8%, transparent)',
} as const;

/**
 * Resolved hex for Recharts SVG strokes/gradients (CSS vars often fail in `<stop>`).
 * Keep in sync with `--rt-chart-*` in design-tokens.css.
 */
export const CHANNEL_CHART_COLORS = {
  views: '#ef4444',
  subscribersGained: '#059669',
  subscribersLost: '#ea580c',
  watchTime: '#4f46e5',
  likes: '#db2777',
  comments: '#0891b2',
  videosUploaded: '#ca8a04',
  averageViewDuration: '#8b5cf6',
  engagedViews: '#0ea5e9',
  viewerPercentage: '#14b8a6',
  cardClicks: '#f43f5e',
  cardClickRate: '#f97316',
  cardImpressions: '#a855f7',
  cardTeaserClicks: '#ec4899',
  cardTeaserClickRate: '#84cc16',
  cardTeaserImpressions: '#22c55e',
  averageConcurrentViewers: '#eab308',
  peakConcurrentViewers: '#dc2626',
  netSubscribers: '#0f766e',
  cumulativeSubscribers: '#1d4ed8',
} as const;

/** CSS variables for chips, sparklines, and DOM swatches */
export const CHANNEL_CHART_SERIES = {
  views: 'var(--rt-chart-views)',
  subscribersGained: 'var(--rt-chart-subs-gained)',
  subscribersLost: 'var(--rt-chart-subs-lost)',
  watchTime: 'var(--rt-chart-watch-time)',
  likes: 'var(--rt-chart-likes)',
  comments: 'var(--rt-chart-comments)',
  videosUploaded: 'var(--rt-chart-uploads)',
  averageViewDuration: 'var(--rt-chart-avg-view-duration)',
  engagedViews: 'var(--rt-chart-engaged-views)',
  viewerPercentage: 'var(--rt-chart-viewer-percentage)',
  cardClicks: 'var(--rt-chart-card-clicks)',
  cardClickRate: 'var(--rt-chart-card-click-rate)',
  cardImpressions: 'var(--rt-chart-card-impressions)',
  cardTeaserClicks: 'var(--rt-chart-card-teaser-clicks)',
  cardTeaserClickRate: 'var(--rt-chart-card-teaser-click-rate)',
  cardTeaserImpressions: 'var(--rt-chart-card-teaser-impressions)',
  averageConcurrentViewers: 'var(--rt-chart-avg-concurrent)',
  peakConcurrentViewers: 'var(--rt-chart-peak-concurrent)',
  netSubscribers: 'var(--rt-chart-subs-net)',
  cumulativeSubscribers: 'var(--rt-chart-subs-total)',
} as const;

export type ChannelChartSeriesKey = keyof typeof CHANNEL_CHART_COLORS;

export const channelChartColor = (key: ChannelChartSeriesKey) => CHANNEL_CHART_COLORS[key];

/** Neutral for list presets and de-emphasized series */
export const UI_NEUTRAL = '#6b7280';

/** Default swatch when creating a saved list */
export const DEFAULT_LIST_COLOR = CHANNEL_CHART_COLORS.subscribersGained;

/** Saved-list color picker (stored as hex on list records) */
export const LIST_PRESET_COLORS = [
  CHANNEL_CHART_COLORS.subscribersGained,
  CHANNEL_CHART_COLORS.watchTime,
  CHANNEL_CHART_COLORS.views,
  CHANNEL_CHART_COLORS.videosUploaded,
  CHANNEL_CHART_COLORS.comments,
  UI_NEUTRAL,
] as const;

/** Fallback rotation when a list has no color */
export const MULTI_SERIES_FALLBACK_COLORS = [
  CHANNEL_CHART_COLORS.views,
  CHANNEL_CHART_COLORS.watchTime,
  CHANNEL_CHART_COLORS.subscribersGained,
  CHANNEL_CHART_COLORS.videosUploaded,
  CHANNEL_CHART_COLORS.comments,
  CHANNEL_CHART_COLORS.likes,
  CHANNEL_CHART_COLORS.subscribersLost,
  UI_NEUTRAL,
] as const;

export const TREND_COLOR_POSITIVE = CHANNEL_CHART_COLORS.subscribersGained;
export const TREND_COLOR_NEGATIVE = CHANNEL_CHART_COLORS.views;
export const TREND_COLOR_NEUTRAL = UI_NEUTRAL;

/** Video analytics chart types (extends channel series where applicable) */
export const VIDEO_CHART_COLORS = {
  views: CHANNEL_CHART_COLORS.views,
  subscribers: CHANNEL_CHART_COLORS.subscribersGained,
  subscribersGained: CHANNEL_CHART_COLORS.subscribersGained,
  subscribersLost: CHANNEL_CHART_COLORS.subscribersLost,
  watchTime: CHANNEL_CHART_COLORS.watchTime,
  likes: CHANNEL_CHART_COLORS.likes,
  comments: CHANNEL_CHART_COLORS.comments,
  shares: '#06b6d4',
  retention: CHANNEL_CHART_COLORS.videosUploaded,
  ctr: CHANNEL_CHART_COLORS.watchTime,
} as const;

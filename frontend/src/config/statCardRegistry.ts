/**
 * Registry of customizable dashboard stat cards.
 *
 * One entry per customizable surface (a surface = one tab's stat-card group).
 * Card ids are the stable contract between the UI and the persisted layout in
 * `users/{uid}.uiPreferences.cardLayout` (see `utils/cardLayout.ts`): renaming a
 * label is safe, renaming an id is a breaking change for saved layouts (unknown
 * ids are dropped, so the card simply returns to its default position).
 *
 * Adding a new customizable tab = add a surface here + apply
 * `orderedCardIds()` where that tab renders its cards. No backend change.
 */

export type StatCardSurface = 'dashboard:channelAnalytics' | 'dashboard:audience' | 'dashboard:custom';

export interface StatCardDefinition {
  /** Stable id (never change once shipped). */
  id: string;
  /** Human label shown in the customizer. */
  label: string;
}

/** Channel tab -- ids match `SERIES_METRICS` series keys + the two extras. */
const CHANNEL_ANALYTICS_CARDS: StatCardDefinition[] = [
  { id: 'views', label: 'Total Views' },
  { id: 'subscribersGained', label: 'Subscribers Gained' },
  { id: 'subscribersLost', label: 'Subscribers Lost' },
  { id: 'netSubscribers', label: 'Total Subscribers' },
  { id: 'watchTime', label: 'Minutes Watched' },
  { id: 'likes', label: 'Likes' },
  { id: 'comments', label: 'Comments' },
  { id: 'averageViewDuration', label: 'Avg View Duration' },
  { id: 'engagedViews', label: 'Engaged Views' },
  { id: 'viewerPercentage', label: 'Viewer %' },
  { id: 'videosUploaded', label: 'Videos Uploaded' },
  { id: 'cardImpressions', label: 'Card Impressions' },
  { id: 'cardClicks', label: 'Card Clicks' },
  { id: 'cardClickRate', label: 'Card Click Rate' },
  { id: 'cardTeaserImpressions', label: 'Card Teaser Impressions' },
  { id: 'cardTeaserClicks', label: 'Card Teaser Clicks' },
  { id: 'cardTeaserClickRate', label: 'Card Teaser CTR' },
  { id: 'averageConcurrentViewers', label: 'Avg Concurrent Viewers' },
  { id: 'peakConcurrentViewers', label: 'Peak Concurrent Viewers' },
];

/** Audience tab -- 4 hero tiles + 6 breakdown cards. */
const AUDIENCE_CARDS: StatCardDefinition[] = [
  { id: 'hero:topCountry', label: 'Top Country (tile)' },
  { id: 'hero:countriesTracked', label: 'Countries Tracked (tile)' },
  { id: 'hero:topTrafficSource', label: 'Top Traffic Source (tile)' },
  { id: 'hero:mobileShare', label: 'Mobile Share (tile)' },
  { id: 'countries', label: 'Top Countries' },
  { id: 'trafficSource', label: 'Traffic Source' },
  { id: 'deviceType', label: 'Device Type' },
  { id: 'ageGroup', label: 'Age Group' },
  { id: 'subscriberStatus', label: 'Subscriber Status' },
  { id: 'gender', label: 'Gender' },
];

/**
 * Custom user dashboard (`pages/my-dashboard/`) — widget ids. These are the
 * stable persistence contract for the `dashboard:custom` surface: renaming a
 * label is safe, renaming an id drops the widget back to its default slot.
 */
const CUSTOM_DASHBOARD_WIDGETS: StatCardDefinition[] = [
  { id: 'channel-kpis', label: 'Channel performance' },
  { id: 'audience', label: 'Audience breakdown' },
  { id: 'insights', label: 'Posting insights' },
  { id: 'goals', label: 'Goals & pacing' },
  { id: 'anomalies', label: 'Anomaly watch' },
  { id: 'video-performance', label: 'Video performance' },
  { id: 'playlist-performance', label: 'Playlist performance' },
  { id: 'top-videos', label: 'Top videos' },
  { id: 'top-playlists', label: 'Top playlists' },
];

/** Grid footprint per custom-dashboard widget (`full` = 12 cols, `half` = 6 on lg+). */
export type CustomDashboardWidgetSpan = 'full' | 'half';

export const CUSTOM_DASHBOARD_WIDGET_SPANS: Record<string, CustomDashboardWidgetSpan> = {
  'channel-kpis': 'full',
  audience: 'half',
  insights: 'half',
  goals: 'full',
  anomalies: 'half',
  'video-performance': 'full',
  'playlist-performance': 'half',
  'top-videos': 'half',
  'top-playlists': 'half',
};

export function getCustomDashboardWidgetSpan(id: string): CustomDashboardWidgetSpan {
  // User-built custom KPI cards (`custom:*`) are compact half-width tiles.
  if (id.startsWith('custom:')) return 'half';
  return CUSTOM_DASHBOARD_WIDGET_SPANS[id] ?? 'full';
}

export const STAT_CARD_REGISTRY: Record<StatCardSurface, StatCardDefinition[]> = {
  'dashboard:channelAnalytics': CHANNEL_ANALYTICS_CARDS,
  'dashboard:audience': AUDIENCE_CARDS,
  'dashboard:custom': CUSTOM_DASHBOARD_WIDGETS,
};

/** Surface ids as constants so components/actions never re-type the literals. */
export const CHANNEL_ANALYTICS_CARD_SURFACE: StatCardSurface = 'dashboard:channelAnalytics';
export const AUDIENCE_CARD_SURFACE: StatCardSurface = 'dashboard:audience';
/** Custom user dashboard (`pages/my-dashboard/`) — widget ids, not stat cards. */
export const CUSTOM_DASHBOARD_SURFACE: StatCardSurface = 'dashboard:custom';

/** Panel heading per surface, e.g. "Customize Channel cards". */
export const STAT_CARD_SURFACE_LABELS: Record<StatCardSurface, string> = {
  'dashboard:channelAnalytics': 'Channel',
  'dashboard:audience': 'Audience',
  'dashboard:custom': 'My Dashboard',
};

/** Dashboard tab -> customizable surface. Tabs without an entry have no customizer. */
export const STAT_CARD_SURFACE_BY_TAB: Record<string, StatCardSurface> = {
  channelAnalytics: 'dashboard:channelAnalytics',
  audience: 'dashboard:audience',
};

/**
 * Hero tiles are computed by `computeAudienceHero` (which owns their labels);
 * the layout filters/orders them by label so that pure function stays untouched.
 */
export const AUDIENCE_HERO_CARD_BY_LABEL: Record<string, string> = {
  'Top country': 'hero:topCountry',
  'Countries tracked': 'hero:countriesTracked',
  'Top traffic source': 'hero:topTrafficSource',
  'Mobile share': 'hero:mobileShare',
};

export function isStatCardSurface(value: string): value is StatCardSurface {
  return Object.prototype.hasOwnProperty.call(STAT_CARD_REGISTRY, value);
}

export function getStatCardDefinitions(surface: StatCardSurface): StatCardDefinition[] {
  return STAT_CARD_REGISTRY[surface] ?? [];
}

export function getStatCardSurfaceForTab(tab: string): StatCardSurface | null {
  return STAT_CARD_SURFACE_BY_TAB[tab] ?? null;
}

export function getStatCardLabel(surface: StatCardSurface, id: string): string {
  return getStatCardDefinitions(surface).find((d) => d.id === id)?.label ?? id;
}

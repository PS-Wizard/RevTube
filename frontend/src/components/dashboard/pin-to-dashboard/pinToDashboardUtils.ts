/**
 * Pin-to-dashboard catalogue helpers.
 *
 * Each pinnable source section maps 1:1 to a `dashboard:custom` widget id
 * (see `config/statCardRegistry.ts`). The mapping is the single home for
 * pin copy so every section header stays consistent.
 */

import { getStatCardLabel, CUSTOM_DASHBOARD_SURFACE } from '@/config/statCardRegistry';
import { isCustomWidgetId, findCustomCardDef, useCustomCardsStore } from '@/stores/customCardsStore';

export type PinnableWidgetId =
  | 'channel-kpis'
  | 'audience'
  | 'insights'
  | 'goals'
  | 'anomalies'
  | 'video-performance'
  | 'playlist-performance'
  | 'top-videos'
  | 'top-playlists';

export const PINNABLE_WIDGET_IDS: PinnableWidgetId[] = [
  'channel-kpis',
  'audience',
  'insights',
  'goals',
  'anomalies',
  'video-performance',
  'playlist-performance',
  'top-videos',
  'top-playlists',
];

export function isPinnableWidgetId(value: string): boolean {
  // User-built custom cards pin/unpin through the same toggle (WidgetCard).
  if (isCustomWidgetId(value)) return true;
  return (PINNABLE_WIDGET_IDS as string[]).includes(value);
}

/** Display label for a pinnable widget (custom cards resolve via their definition). */
export function pinnableWidgetLabel(id: string): string {
  if (isCustomWidgetId(id)) {
    return findCustomCardDef(useCustomCardsStore.getState().cardsByScope, id)?.label ?? id;
  }
  return getStatCardLabel(CUSTOM_DASHBOARD_SURFACE, id);
}

/** Route of the custom dashboard (single home for pin affordance links). */
export const CUSTOM_DASHBOARD_ROUTE = '/my-dashboard';

export function pinTitle(id: string, pinned: boolean): string {
  const label = pinnableWidgetLabel(id);
  return pinned
    ? `${label} is on your dashboard — click to remove`
    : `Pin ${label} to your dashboard`;
}

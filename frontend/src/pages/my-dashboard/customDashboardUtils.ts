/**
 * Custom user dashboard (`/my-dashboard`) — catalogue helpers.
 *
 * Widget ids/labels/spans come from `config/statCardRegistry.ts`; the grid
 * matrix math lives in `utils/dashboardLayoutMatrix.ts`. This module is the
 * page-level facade over both.
 */

import {
  CUSTOM_DASHBOARD_SURFACE,
  getCustomDashboardWidgetSpan,
  getStatCardDefinitions,
  getStatCardLabel,
  type CustomDashboardWidgetSpan,
} from '../../config/statCardRegistry';
import { isCustomWidgetId, findCustomCardDef, useCustomCardsStore } from '../../stores/customCardsStore';

export { CUSTOM_DASHBOARD_SURFACE };
export type { CustomDashboardWidgetSpan };

/** Registry widget ids in default order. */
export function defaultWidgetIds(): string[] {
  return getStatCardDefinitions(CUSTOM_DASHBOARD_SURFACE).map((d) => d.id);
}

/** Display label for a widget id (custom cards resolve via their definition). */
export function widgetLabel(id: string): string {
  if (isCustomWidgetId(id)) {
    const found = findCustomCardDef(useCustomCardsStore.getState().cardsByScope, id);
    return found?.label ?? id;
  }
  return getStatCardLabel(CUSTOM_DASHBOARD_SURFACE, id);
}

/** Grid footprint for a widget id (`full` = whole row, `half` = side-by-side). */
export function widgetSpan(id: string): CustomDashboardWidgetSpan {
  return getCustomDashboardWidgetSpan(id);
}

/** `true` when a widget id is part of the catalogue. */
export function isKnownWidget(id: string): boolean {
  return defaultWidgetIds().includes(id);
}

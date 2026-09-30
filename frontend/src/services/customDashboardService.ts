/**
 * Custom-dashboard layouts (Postgres-backed, per-user personal + per-org).
 *
 * Same origin/header conventions as `uiPreferencesService.ts`: base URL from
 * `VITE_BACKEND_URL` and the Firebase ID token in `X-Firebase-Token`.
 * Both calls are best-effort -- a failure degrades to the localStorage mirror
 * (`stores/customDashboardStore.ts`) instead of breaking the dashboard.
 * A `{ supported: false }` response means Postgres is unavailable, which the
 * store treats as local-only mode.
 */

import { getFirebaseAuthHeader } from './authHeaders';
import { apiUrl } from '../utils/apiBase';
import { parseJsonFromText } from '../utils/readJsonResponse';
import { normalizeDbLayout } from '../utils/dashboardLayoutMatrix';
import { getStatCardDefinitions, CUSTOM_DASHBOARD_SURFACE } from '../config/statCardRegistry';
import { selectAllCustomCardIds, useCustomCardsStore } from '../stores/customCardsStore';
import type { DashboardLayout } from '../types/customDashboard';

const DASHBOARDS_PATH = '/custom-dashboards';
const DASHBOARD_NAME = 'default';

function knownIds(): string[] {
  const registry = getStatCardDefinitions(CUSTOM_DASHBOARD_SURFACE).map((d) => d.id);
  // Scope-less read path: keep every locally-known custom card id so a
  // backend-synced layout never drops user-built cards. Scopes without a
  // local definition skip the card at render time.
  const customs = selectAllCustomCardIds(useCustomCardsStore.getState().cardsByScope);
  const merged = [...registry];
  for (const id of customs) {
    if (!merged.includes(id)) merged.push(id);
  }
  return merged;
}

export interface CustomDashboardFetch {
  supported: boolean;
  layout: DashboardLayout | null;
}

export const getCustomDashboardLayout = async (
  orgId: string | null,
): Promise<CustomDashboardFetch> => {
  const fallback: CustomDashboardFetch = { supported: true, layout: null };
  try {
    const params = new URLSearchParams({ name: DASHBOARD_NAME });
    if (orgId) params.set('orgId', orgId);
    const response = await fetch(apiUrl(`${DASHBOARDS_PATH}?${params.toString()}`), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(await getFirebaseAuthHeader()),
      },
    });
    if (response.status === 503) return { supported: false, layout: null };
    if (!response.ok) {
      console.warn(`[customDashboard] GET failed: HTTP ${response.status}`);
      return fallback;
    }
    const text = await response.text();
    const body = parseJsonFromText(text, response.status, 'getCustomDashboardLayout') as {
      layout?: unknown;
      supported?: unknown;
    };
    if (body?.supported === false) return { supported: false, layout: null };
    return {
      supported: true,
      layout: body?.layout ? normalizeDbLayout(body.layout, knownIds()) : null,
    };
  } catch (error) {
    console.warn('[customDashboard] GET error:', error);
    return fallback;
  }
};

export const saveCustomDashboardLayout = async (
  orgId: string | null,
  layout: DashboardLayout,
): Promise<boolean> => {
  try {
    const response = await fetch(apiUrl(DASHBOARDS_PATH), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(await getFirebaseAuthHeader()),
      },
      body: JSON.stringify({ orgId: orgId ?? '', name: DASHBOARD_NAME, layout }),
    });
    if (!response.ok) {
      console.warn(`[customDashboard] PUT failed: HTTP ${response.status}`);
      return false;
    }
    return true;
  } catch (error) {
    console.warn('[customDashboard] PUT error:', error);
    return false;
  }
};

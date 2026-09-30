/**
 * Per-user UI preferences (dashboard stat-card layout).
 *
 * Same origin/header conventions as `userService.ts`: base URL from
 * `VITE_BACKEND_URL` and the Firebase ID token in `X-Firebase-Token`.
 * Both calls are best-effort -- a failure degrades to the localStorage mirror
 * (`stores/cardLayoutStore.ts`) instead of breaking the dashboard.
 */

import { getFirebaseAuthHeader } from './authHeaders';
import { apiUrl } from '../utils/apiBase';
import { parseJsonFromText } from '../utils/readJsonResponse';
import { sanitizeLayouts, type StatCardLayouts } from '../utils/cardLayout';

const UI_PREFS_PATH = '/user/ui-preferences';

export const getUiPreferences = async (): Promise<StatCardLayouts> => {
  try {
    const response = await fetch(apiUrl(UI_PREFS_PATH), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(await getFirebaseAuthHeader()),
      },
    });
    if (!response.ok) {
      console.warn(`[uiPreferences] GET failed: HTTP ${response.status}`);
      return {};
    }
    const text = await response.text();
    const body = parseJsonFromText(text, response.status, 'getUiPreferences') as {
      cardLayout?: unknown;
    };
    return sanitizeLayouts(body?.cardLayout);
  } catch (error) {
    console.warn('[uiPreferences] GET error:', error);
    return {};
  }
};

export const saveUiPreferences = async (layouts: StatCardLayouts): Promise<boolean> => {
  try {
    const response = await fetch(apiUrl(UI_PREFS_PATH), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(await getFirebaseAuthHeader()),
      },
      body: JSON.stringify({ cardLayout: layouts }),
    });
    if (!response.ok) {
      console.warn(`[uiPreferences] PUT failed: HTTP ${response.status}`);
      return false;
    }
    return true;
  } catch (error) {
    console.warn('[uiPreferences] PUT error:', error);
    return false;
  }
};

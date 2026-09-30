/**
 * Stat-card layout store (Zustand + immer, same shape as `dashboardStore`).
 *
 * Persistence is two-tier:
 *   1. `localStorage` mirror -- written synchronously on every change so the
 *      dashboard paints the user's layout instantly (no flash) and keeps
 *      working offline / while signed out.
 *   2. Backend (`users/{uid}.uiPreferences.cardLayout`) -- debounced PUT so a
 *      customization session costs one request, restored on the next sign-in
 *      from any browser.
 *
 * Only the mutations here write layouts; components read `state.layouts` and
 * pass it through the pure helpers in `utils/cardLayout.ts`.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { StatCardSurface } from '../config/statCardRegistry';
import {
  moveCard as moveCardInLayout,
  resetSurfaceLayout,
  sanitizeLayouts,
  setCardCompact as setCardCompactInLayout,
  setCardHidden as setCardHiddenInLayout,
  setSurfaceOrder as setSurfaceOrderInLayout,
  type StatCardLayouts,
} from '../utils/cardLayout';
import { getUiPreferences, saveUiPreferences } from '../services/uiPreferencesService';

export const STAT_CARD_LAYOUT_STORAGE_KEY = 'revtube_stat_card_layout';
const PERSIST_DEBOUNCE_MS = 600;

interface CardLayoutState {
  layouts: StatCardLayouts;
  /** uid the layouts are synced with; null = signed out (localStorage only). */
  syncedForUid: string | null;
  loadedFromStorage: boolean;
  syncingFromBackend: boolean;
}

interface CardLayoutActions {
  loadFromStorage: () => void;
  syncFromBackend: (uid: string | null) => Promise<void>;
  setCardHidden: (surface: StatCardSurface, id: string, hidden: boolean) => void;
  setCardCompact: (surface: StatCardSurface, id: string, compact: boolean) => void;
  moveCard: (surface: StatCardSurface, id: string, delta: number) => void;
  setSurfaceOrder: (surface: StatCardSurface, order: string[]) => void;
  resetSurface: (surface: StatCardSurface) => void;
}

export type CardLayoutStore = CardLayoutState & CardLayoutActions;

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function writeStorage(layouts: StatCardLayouts): void {
  try {
    localStorage.setItem(STAT_CARD_LAYOUT_STORAGE_KEY, JSON.stringify(layouts));
  } catch {
    /* storage full / disabled -- the in-memory layout still applies */
  }
}

function readStorage(): StatCardLayouts {
  try {
    const raw = localStorage.getItem(STAT_CARD_LAYOUT_STORAGE_KEY);
    return raw ? sanitizeLayouts(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

/** Debounced backend save; skipped entirely while signed out. */
function scheduleBackendSave(get: () => CardLayoutStore) {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const { syncedForUid, layouts } = get();
    if (!syncedForUid) return;
    void saveUiPreferences(layouts);
  }, PERSIST_DEBOUNCE_MS);
}

export const useCardLayoutStore = create<CardLayoutStore>()(
  devtools(
    immer((set, get) => ({
      layouts: {},
      syncedForUid: null,
      loadedFromStorage: false,
      syncingFromBackend: false,

      loadFromStorage: () => {
        if (get().loadedFromStorage) return;
        const stored = readStorage();
        set((state) => {
          state.layouts = stored;
          state.loadedFromStorage = true;
        });
      },

      syncFromBackend: async (uid) => {
        if (!uid) {
          set((state) => {
            state.syncedForUid = null;
          });
          return;
        }
        if (get().syncedForUid === uid || get().syncingFromBackend) return;

        set((state) => {
          state.syncingFromBackend = true;
        });
        try {
          const remote = await getUiPreferences();
          const hasRemote = Object.keys(remote).length > 0;
          if (hasRemote) {
            writeStorage(remote);
            set((state) => {
              state.layouts = remote;
            });
          } else if (Object.keys(get().layouts).length > 0) {
            // Local-only customization made before the first sync -- push it up.
            void saveUiPreferences(get().layouts);
          }
        } finally {
          set((state) => {
            state.syncedForUid = uid;
            state.syncingFromBackend = false;
          });
        }
      },

      setCardHidden: (surface, id, hidden) => {
        const next = setCardHiddenInLayout(surface, get().layouts[surface], id, hidden);
        set((state) => {
          state.layouts = { ...state.layouts, [surface]: next };
        });
        writeStorage(get().layouts);
        scheduleBackendSave(get);
      },

      setCardCompact: (surface, id, compact) => {
        const next = setCardCompactInLayout(surface, get().layouts[surface], id, compact);
        set((state) => {
          state.layouts = { ...state.layouts, [surface]: next };
        });
        writeStorage(get().layouts);
        scheduleBackendSave(get);
      },

      moveCard: (surface, id, delta) => {
        const next = moveCardInLayout(surface, get().layouts[surface], id, delta);
        set((state) => {
          state.layouts = { ...state.layouts, [surface]: next };
        });
        writeStorage(get().layouts);
        scheduleBackendSave(get);
      },

      setSurfaceOrder: (surface, order) => {
        const next = setSurfaceOrderInLayout(surface, get().layouts[surface], order);
        set((state) => {
          state.layouts = { ...state.layouts, [surface]: next };
        });
        writeStorage(get().layouts);
        scheduleBackendSave(get);
      },

      resetSurface: (surface) => {
        set((state) => {
          state.layouts = resetSurfaceLayout(state.layouts, surface);
        });
        writeStorage(get().layouts);
        scheduleBackendSave(get);
      },
    })),
    { name: 'cardLayoutStore' },
  ),
);

/** Flush a pending debounced save immediately (used when unmounting the dashboard). */
export const flushCardLayoutSave = (): void => {
  if (!persistTimer) return;
  clearTimeout(persistTimer);
  persistTimer = null;
  const { syncedForUid, layouts } = useCardLayoutStore.getState();
  if (!syncedForUid) return;
  void saveUiPreferences(layouts);
};

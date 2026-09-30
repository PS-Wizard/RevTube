/**
 * Custom-dashboard layout store (Zustand + immer) — Postgres-backed, scoped.
 *
 * Scope = `(uid, orgId)` with `orgId ''` meaning personal, so every user gets
 * one layout per org context plus their personal one. Persistence is two-tier:
 *   1. `localStorage` mirror per scope — written synchronously so the grid
 *      paints instantly and keeps working offline / without Postgres.
 *   2. Postgres (`custom_dashboard_layouts`) — debounced PUT, restored on the
 *      next sign-in from any browser. When the backend reports
 *      `supported: false` the scope stays local-only.
 *
 * The first successful personal sync migrates a legacy Firestore
 * `dashboard:custom` layout (the v1 surface) once, then retires it — so
 * early adopters keep their arrangement instead of silently resetting.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import {
  CUSTOM_DASHBOARD_SURFACE,
  getStatCardDefinitions,
} from '../config/statCardRegistry';
import {
  cellsToOrder,
  defaultDbLayout,
  hideWidgetInLayout,
  normalizeDbLayout,
  packOrderToCells,
  reorderVisibleInLayout,
  showWidgetInLayout,
} from '../utils/dashboardLayoutMatrix';
import { normalizeLayout, orderedCardIds } from '../utils/cardLayout';
import type { DashboardLayout } from '../types/customDashboard';
import {
  getCustomDashboardLayout,
  saveCustomDashboardLayout,
} from '../services/customDashboardService';
import { useCardLayoutStore } from './cardLayoutStore';
import { selectCustomCardIds, useCustomCardsStore } from './customCardsStore';

export interface DashboardScope {
  uid: string;
  /** Organization id, or '' for the personal scope. */
  orgId: string;
}

export const scopeKey = (scope: DashboardScope): string =>
  `${scope.uid}::${scope.orgId || 'personal'}`;

const STORAGE_PREFIX = 'revtube_custom_dashboard_v2';
const PERSIST_DEBOUNCE_MS = 600;

interface ScopeState {
  layout: DashboardLayout | null;
  loaded: boolean;
  synced: boolean;
  /** False once the backend reports Postgres unavailable (local-only mode). */
  supported: boolean;
}

interface CustomDashboardState {
  scopes: Record<string, ScopeState>;
}

interface CustomDashboardActions {
  loadScope: (scope: DashboardScope) => void;
  syncScopeFromBackend: (scope: DashboardScope) => Promise<void>;
  setLayout: (scope: DashboardScope, layout: DashboardLayout) => void;
  hideWidget: (scope: DashboardScope, id: string) => void;
  showWidget: (scope: DashboardScope, id: string) => void;
  reorderVisible: (scope: DashboardScope, visibleOrder: string[]) => void;
  resetScope: (scope: DashboardScope) => void;
  flushScopeSave: (scope: DashboardScope) => void;
}

export type CustomDashboardStore = CustomDashboardState & CustomDashboardActions;

function knownIds(scope?: DashboardScope): string[] {
  const registry = getStatCardDefinitions(CUSTOM_DASHBOARD_SURFACE).map((d) => d.id);
  if (!scope) return registry;
  const customs = selectCustomCardIds(useCustomCardsStore.getState().cardsByScope, scope);
  const merged = [...registry];
  for (const id of customs) {
    if (!merged.includes(id)) merged.push(id);
  }
  return merged;
}

function storageKey(scope: DashboardScope): string {
  return `${STORAGE_PREFIX}:${scopeKey(scope)}`;
}

function readStorage(scope: DashboardScope): DashboardLayout | null {
  try {
    const raw = localStorage.getItem(storageKey(scope));
    return raw ? normalizeDbLayout(JSON.parse(raw), knownIds(scope)) : null;
  } catch {
    return null;
  }
}

function writeStorage(scope: DashboardScope, layout: DashboardLayout): void {
  try {
    localStorage.setItem(storageKey(scope), JSON.stringify(layout));
  } catch {
    /* storage full / disabled -- the in-memory layout still applies */
  }
}

function blankScope(): ScopeState {
  return { layout: null, loaded: false, synced: false, supported: true };
}

/**
 * One-time v1 migration: a Firestore `dashboard:custom` customization becomes
 * a packed Postgres matrix. Returns null when there is nothing to migrate.
 */
function readLegacyLayout(): DashboardLayout | null {
  const legacy = useCardLayoutStore.getState().layouts[CUSTOM_DASHBOARD_SURFACE];
  if (!legacy) return null;
  const normalized = normalizeLayout(CUSTOM_DASHBOARD_SURFACE, legacy);
  const visible = orderedCardIds(CUSTOM_DASHBOARD_SURFACE, legacy);
  const defaults = knownIds();
  const isDefault =
    normalized.hidden.length === 0 &&
    visible.join('|') === defaults.join('|');
  if (isDefault) return null;
  return { cells: packOrderToCells(visible), hidden: [...normalized.hidden] };
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingScope: DashboardScope | null = null;

/** Debounced backend save for the pending scope; skipped in local-only mode. */
function scheduleBackendSave(
  get: () => CustomDashboardStore,
  scope: DashboardScope,
) {
  pendingScope = scope;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const key = scopeKey(scope);
    const entry = get().scopes[key];
    if (!entry || !entry.supported || !entry.layout) {
      pendingScope = null;
      return;
    }
    pendingScope = null;
    void saveCustomDashboardLayout(
      scope.orgId || null,
      entry.layout,
    );
  }, PERSIST_DEBOUNCE_MS);
}

export const useCustomDashboardStore = create<CustomDashboardStore>()(
  devtools(
    immer((set, get) => ({
      scopes: {},

      loadScope: (scope) => {
        const key = scopeKey(scope);
        if (get().scopes[key]?.loaded) return;
        const stored = readStorage(scope);
        set((state) => {
          state.scopes[key] = { ...(state.scopes[key] ?? blankScope()), layout: stored, loaded: true };
        });
      },

      syncScopeFromBackend: async (scope) => {
        const key = scopeKey(scope);
        if (get().scopes[key]?.synced) return;
        set((state) => {
          state.scopes[key] = state.scopes[key] ?? blankScope();
        });
        try {
          const { supported, layout } = await getCustomDashboardLayout(scope.orgId || null);
          if (!supported) {
            set((state) => {
              state.scopes[key].supported = false;
              state.scopes[key].synced = true;
            });
            return;
          }
          if (layout) {
            writeStorage(scope, layout);
            set((state) => {
              state.scopes[key].layout = layout;
            });
          } else if (scope.orgId === '') {
            // Nothing stored yet -- adopt the legacy v1 layout once, if any.
            const legacy = readLegacyLayout();
            if (legacy) {
              writeStorage(scope, legacy);
              set((state) => {
                state.scopes[key].layout = legacy;
              });
              void saveCustomDashboardLayout(null, legacy).catch(() => undefined);
              useCardLayoutStore.getState().resetSurface(CUSTOM_DASHBOARD_SURFACE);
            }
          }
        } finally {
          set((state) => {
            state.scopes[key].synced = true;
          });
        }
      },

      setLayout: (scope, layout) => {
        const key = scopeKey(scope);
        const clean = normalizeDbLayout(layout, knownIds(scope));
        set((state) => {
          state.scopes[key] = { ...(state.scopes[key] ?? blankScope()), layout: clean, loaded: true };
        });
        writeStorage(scope, clean);
        scheduleBackendSave(get, scope);
      },

      hideWidget: (scope, id) => {
        const key = scopeKey(scope);
        const current = get().scopes[key]?.layout ?? defaultDbLayout(knownIds(scope));
        get().setLayout(scope, hideWidgetInLayout(current, id));
      },

      showWidget: (scope, id) => {
        const key = scopeKey(scope);
        const current = get().scopes[key]?.layout ?? defaultDbLayout(knownIds(scope));
        get().setLayout(scope, showWidgetInLayout(current, id));
      },

      reorderVisible: (scope, visibleOrder) => {
        const key = scopeKey(scope);
        const current = get().scopes[key]?.layout ?? defaultDbLayout(knownIds(scope));
        get().setLayout(scope, reorderVisibleInLayout(current, visibleOrder));
      },

      resetScope: (scope) => {
        get().setLayout(scope, { cells: [], hidden: [] });
      },

      flushScopeSave: (scope) => {
        if (!persistTimer || !pendingScope || scopeKey(pendingScope) !== scopeKey(scope)) return;
        clearTimeout(persistTimer);
        persistTimer = null;
        pendingScope = null;
        const entry = get().scopes[scopeKey(scope)];
        if (!entry || !entry.supported || !entry.layout) return;
        void saveCustomDashboardLayout(scope.orgId || null, entry.layout);
      },
    })),
    { name: 'customDashboardStore' },
  ),
);

/** Visible widget ids for a scope (defaults when nothing stored yet). */
export function selectVisibleIds(
  scopes: Record<string, ScopeState>,
  scope: DashboardScope,
): string[] {
  const layout = scopes[scopeKey(scope)]?.layout ?? defaultDbLayout(knownIds(scope));
  return cellsToOrder(layout.cells.length > 0 ? layout.cells : defaultDbLayout(knownIds(scope)).cells);
}

/** Hidden widget ids for a scope. */
export function selectHiddenIds(
  scopes: Record<string, ScopeState>,
  scope: DashboardScope,
): string[] {
  return scopes[scopeKey(scope)]?.layout?.hidden ?? [];
}

/**
 * User-built custom KPI cards for My Dashboard (`custom:*` widgets).
 *
 * Definitions live in a single localStorage record keyed by dashboard scope
 * (`uid::orgId`, personal when `orgId` is empty) — the same scoping the
 * layout store uses. Layouts (Postgres + localStorage mirror) carry only the
 * widget ids; this store owns the `{ label, metric, period }` definitions
 * that `CustomKpiWidget` renders.
 *
 * v1 is local-only (no backend table yet): ids still sync cross-device via
 * the layout, but scopes without a local definition skip the card instead of
 * rendering a shell (see `useCustomDashboard` cells filter).
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import {
  CHANNEL_ANALYTICS_CARD_SURFACE,
  getStatCardDefinitions,
} from '../config/statCardRegistry';
import { scopeKey, type DashboardScope } from './customDashboardStore';

export type CustomCardPeriod = 7 | 30 | 90;

export interface CustomCardDef {
  /** Stable id (`custom:<slug>-<suffix>`, matches the layout id pattern). */
  id: string;
  label: string;
  /** Channel-analytics metric key (see `dashboard:channelAnalytics` surface). */
  metric: string;
  period: CustomCardPeriod;
  createdAt: number;
}

export interface NewCustomCard {
  label: string;
  metric: string;
  period: CustomCardPeriod;
}

const STORAGE_KEY = 'revtube_custom_cards_v1';
export const CUSTOM_CARD_PREFIX = 'custom:';
export const MAX_CUSTOM_CARDS_PER_SCOPE = 20;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$/;

function channelMetricIds(): string[] {
  return getStatCardDefinitions(CHANNEL_ANALYTICS_CARD_SURFACE).map((d) => d.id);
}

/** Metric allowlist for validation + the builder form (single home). */
export function customCardMetricIds(): string[] {
  return channelMetricIds();
}

export function isCustomWidgetId(id: string): boolean {
  return id.startsWith(CUSTOM_CARD_PREFIX);
}

function isValidPeriod(value: unknown): value is CustomCardPeriod {
  return value === 7 || value === 30 || value === 90;
}

function sanitizeDef(raw: unknown): CustomCardDef | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const def = raw as Partial<CustomCardDef>;
  if (typeof def.id !== 'string' || !ID_PATTERN.test(def.id.trim())) return null;
  if (!def.id.startsWith(CUSTOM_CARD_PREFIX)) return null;
  if (typeof def.label !== 'string') return null;
  const label = def.label.trim().slice(0, 60);
  if (label.length === 0) return null;
  if (typeof def.metric !== 'string' || !channelMetricIds().includes(def.metric)) return null;
  if (!isValidPeriod(def.period)) return null;
  return {
    id: def.id.trim(),
    label,
    metric: def.metric,
    period: def.period,
    createdAt: typeof def.createdAt === 'number' ? def.createdAt : 0,
  };
}

function readStorage(): Record<string, CustomCardDef[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, CustomCardDef[]> = {};
    for (const [key, list] of Object.entries(parsed)) {
      if (!Array.isArray(list)) continue;
      const clean = list
        .map(sanitizeDef)
        .filter((d): d is CustomCardDef => d !== null)
        .slice(0, MAX_CUSTOM_CARDS_PER_SCOPE);
      if (clean.length > 0) out[key] = clean;
    }
    return out;
  } catch {
    return {};
  }
}

function writeStorage(cardsByScope: Record<string, CustomCardDef[]>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cardsByScope));
  } catch {
    /* storage full / disabled — the in-memory defs still apply */
  }
}

function slugify(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return slug || 'card';
}

interface CustomCardsState {
  cardsByScope: Record<string, CustomCardDef[]>;
}

interface CustomCardsActions {
  addCard: (scope: DashboardScope, input: NewCustomCard) => string | null;
  removeCard: (scope: DashboardScope, id: string) => void;
}

export type CustomCardsStore = CustomCardsState & CustomCardsActions;

export const useCustomCardsStore = create<CustomCardsStore>()(
  devtools(
    immer((set, get) => ({
      cardsByScope: readStorage(),

      addCard: (scope, input) => {
        const label = input.label.trim().slice(0, 60);
        if (label.length === 0) return null;
        if (!channelMetricIds().includes(input.metric)) return null;
        if (!isValidPeriod(input.period)) return null;
        const key = scopeKey(scope);
        const existing = get().cardsByScope[key] ?? [];
        if (existing.length >= MAX_CUSTOM_CARDS_PER_SCOPE) return null;
        const taken = new Set(existing.map((c) => c.id));
        const base = slugify(label);
        let id = `${CUSTOM_CARD_PREFIX}${base}-${Date.now().toString(36).slice(-4)}`;
        let attempt = 0;
        while ((taken.has(id) || !ID_PATTERN.test(id)) && attempt < 10) {
          attempt += 1;
          id = `${CUSTOM_CARD_PREFIX}${base}-${attempt}-${Math.floor(Math.random() * 1296).toString(36)}`;
        }
        if (taken.has(id) || !ID_PATTERN.test(id)) return null;
        const def: CustomCardDef = {
          id,
          label,
          metric: input.metric,
          period: input.period,
          createdAt: Date.now(),
        };
        set((state) => {
          state.cardsByScope[key] = [...(state.cardsByScope[key] ?? []), def];
        });
        writeStorage(get().cardsByScope);
        return id;
      },

      removeCard: (scope, id) => {
        const key = scopeKey(scope);
        if (!(get().cardsByScope[key] ?? []).some((c) => c.id === id)) return;
        set((state) => {
          state.cardsByScope[key] = (state.cardsByScope[key] ?? []).filter((c) => c.id !== id);
          if (state.cardsByScope[key].length === 0) delete state.cardsByScope[key];
        });
        writeStorage(get().cardsByScope);
      },
    })),
    { name: 'customCardsStore' },
  ),
);

/** Definitions for a scope (reactive when read via the hook selector). */
export function selectCustomCards(
  cardsByScope: Record<string, CustomCardDef[]>,
  scope: DashboardScope,
): CustomCardDef[] {
  return cardsByScope[scopeKey(scope)] ?? [];
}

/** Widget ids for a scope's custom cards. */
export function selectCustomCardIds(
  cardsByScope: Record<string, CustomCardDef[]>,
  scope: DashboardScope,
): string[] {
  return selectCustomCards(cardsByScope, scope).map((c) => c.id);
}

/** Find a custom-card definition by id across all scopes (for labels). */
export function findCustomCardDef(
  cardsByScope: Record<string, CustomCardDef[]>,
  id: string,
): CustomCardDef | null {
  for (const defs of Object.values(cardsByScope)) {
    const found = defs.find((d) => d.id === id);
    if (found) return found;
  }
  return null;
}

/** Every custom-card id across all scopes (for scope-less normalization). */
export function selectAllCustomCardIds(
  cardsByScope: Record<string, CustomCardDef[]>,
): string[] {
  const ids = new Set<string>();
  for (const defs of Object.values(cardsByScope)) {
    for (const def of defs) ids.add(def.id);
  }
  return [...ids];
}

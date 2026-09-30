/**
 * Pure helpers for the customizable dashboard stat-card layout.
 *
 * A layout is stored per surface:
 *   { order: string[], hidden: string[], compact: string[] }
 *   - order   : card ids in the user's display order
 *   - hidden  : card ids the user hid
 *   - compact : card ids rendered without their detail rows (deltas / sub-line)
 *
 * `order` is always normalized against the registry, so a saved layout keeps
 * working when cards are added (they append at their default position) or
 * removed (stale ids drop silently). The layout never blanks a surface: if the
 * user hides everything, the first default card stays visible.
 */

import { getStatCardDefinitions, type StatCardSurface } from '../config/statCardRegistry';

export interface StatCardLayout {
  order: string[];
  hidden: string[];
  compact: string[];
}

export type StatCardLayouts = Partial<Record<StatCardSurface, StatCardLayout>>;

export const EMPTY_STAT_CARD_LAYOUT: StatCardLayout = { order: [], hidden: [], compact: [] };

/** Mirrors `backend/utils/cardLayoutPrefs.js` (bounded, pattern-checked ids). */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$/;
const SURFACE_PATTERN = /^[a-z][A-Za-z0-9]*:[A-Za-z0-9]+$/;
const MAX_IDS_PER_LIST = 100;
const MAX_SURFACES = 24;

function sanitizeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const id = raw.trim();
    if (!ID_PATTERN.test(id) || out.includes(id)) continue;
    if (out.length >= MAX_IDS_PER_LIST) break;
    out.push(id);
  }
  return out;
}

/** Defensive read of a persisted payload (localStorage or backend response). */
export function sanitizeLayouts(input: unknown): StatCardLayouts {
  const out: StatCardLayouts = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;

  let kept = 0;
  for (const surface of Object.keys(input as Record<string, unknown>)) {
    if (kept >= MAX_SURFACES) break;
    if (!SURFACE_PATTERN.test(surface)) continue;
    const raw = (input as Record<string, unknown>)[surface];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;

    const entry = raw as Partial<StatCardLayout>;
    const order = sanitizeIdList(entry.order);
    const hidden = sanitizeIdList(entry.hidden);
    const compact = sanitizeIdList(entry.compact);
    if (order.length === 0 && hidden.length === 0 && compact.length === 0) continue;

    out[surface as StatCardSurface] = { order, hidden, compact };
    kept += 1;
  }
  return out;
}

/**
 * Registry ids in the user's order (unknown ids dropped, new ids appended at
 * their default position) + hidden/compact lists narrowed to real cards.
 */
export function normalizeLayout(
  surface: StatCardSurface,
  layout?: Partial<StatCardLayout> | null,
): StatCardLayout {
  const defaults = getStatCardDefinitions(surface).map((d) => d.id);
  const defaultSet = new Set(defaults);

  const order = sanitizeIdList(layout?.order).filter((id) => defaultSet.has(id));
  for (const id of defaults) {
    if (!order.includes(id)) order.push(id);
  }

  return {
    order,
    hidden: sanitizeIdList(layout?.hidden).filter((id) => defaultSet.has(id)),
    compact: sanitizeIdList(layout?.compact).filter((id) => defaultSet.has(id)),
  };
}

/**
 * Card ids to render, in order: user order minus hidden, minus cards the caller
 * knows are empty (`hiddenByData`). Never returns an empty list unless every
 * card is data-hidden -- a "hidden everything" state falls back to the first
 * default card so customization can never blank a surface.
 */
export function orderedCardIds(
  surface: StatCardSurface,
  layout?: Partial<StatCardLayout> | null,
  hiddenByData?: Iterable<string>,
): string[] {
  const normalized = normalizeLayout(surface, layout);
  const userVisible = normalized.order.filter((id) => !normalized.hidden.includes(id));
  const base = userVisible.length > 0 ? userVisible : normalized.order.slice(0, 1);
  if (!hiddenByData) return base;
  const dataHidden = new Set(hiddenByData);
  return base.filter((id) => !dataHidden.has(id));
}

/** True when a card should render its detail rows (deltas / sub-line / description). */
export function hasDetails(
  surface: StatCardSurface,
  layout: Partial<StatCardLayout> | null | undefined,
  id: string,
): boolean {
  return !normalizeLayout(surface, layout).compact.includes(id);
}

/** Move a card one slot up (-1) or down (+1) within the surface order. */
export function moveCard(
  surface: StatCardSurface,
  layout: Partial<StatCardLayout> | null | undefined,
  id: string,
  delta: number,
): StatCardLayout {
  const normalized = normalizeLayout(surface, layout);
  const index = normalized.order.indexOf(id);
  const target = index + delta;
  if (index === -1 || delta === 0 || target < 0 || target >= normalized.order.length) {
    return normalized;
  }
  const order = [...normalized.order];
  [order[index], order[target]] = [order[target], order[index]];
  return { ...normalized, order };
}

/** Hide/show a card. Refuses to hide the last visible card. */
export function setCardHidden(
  surface: StatCardSurface,
  layout: Partial<StatCardLayout> | null | undefined,
  id: string,
  hidden: boolean,
): StatCardLayout {
  const normalized = normalizeLayout(surface, layout);
  if (!normalized.order.includes(id)) return normalized;

  const visibleCount = normalized.order.filter((cardId) => !normalized.hidden.includes(cardId)).length;
  if (hidden && visibleCount <= 1) return normalized;

  const next = new Set(normalized.hidden);
  if (hidden) next.add(id);
  else next.delete(id);
  return { ...normalized, hidden: normalized.order.filter((cardId) => next.has(cardId)) };
}

/** Turn a card's detail rows on/off. */
export function setCardCompact(
  surface: StatCardSurface,
  layout: Partial<StatCardLayout> | null | undefined,
  id: string,
  compact: boolean,
): StatCardLayout {
  const normalized = normalizeLayout(surface, layout);
  if (!normalized.order.includes(id)) return normalized;
  const next = new Set(normalized.compact);
  if (compact) next.add(id);
  else next.delete(id);
  return { ...normalized, compact: normalized.order.filter((cardId) => next.has(cardId)) };
}

/** Replace a surface's order wholesale (drag-and-drop result). Unknown ids
 *  drop; ids missing from the request (hidden cards, brand-new registry ids)
 *  keep their relative order at the end. */
export function setSurfaceOrder(
  surface: StatCardSurface,
  layout: Partial<StatCardLayout> | null | undefined,
  order: string[],
): StatCardLayout {
  const normalized = normalizeLayout(surface, layout);
  const seen = new Set<string>();
  const next: string[] = [];
  for (const raw of order) {
    if (typeof raw !== 'string') continue;
    const id = raw.trim();
    if (!normalized.order.includes(id) || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  for (const id of normalized.order) {
    if (!seen.has(id)) next.push(id);
  }
  return { ...normalized, order: next };
}

/** Drop a surface's customization (back to registry defaults). */
export function resetSurfaceLayout(layouts: StatCardLayouts, surface: StatCardSurface): StatCardLayouts {
  const next: StatCardLayouts = { ...layouts };
  delete next[surface];
  return next;
}

/** True when the surface carries any user customization (drives the reset button). */
export function isSurfaceCustomized(
  surface: StatCardSurface,
  layout?: Partial<StatCardLayout> | null,
): boolean {
  const normalized = normalizeLayout(surface, layout);
  const defaults = getStatCardDefinitions(surface).map((d) => d.id);
  return (
    normalized.hidden.length > 0 ||
    normalized.compact.length > 0 ||
    normalized.order.join('|') !== defaults.join('|')
  );
}

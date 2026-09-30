# 2026-09-24 — Customizable stat cards (Channel Analytics + Audience)

Sources: `frontend/src/config/statCardRegistry.ts`, `frontend/src/utils/cardLayout.ts`
(+`.test.ts`), `frontend/src/services/uiPreferencesService.ts`,
`frontend/src/stores/cardLayoutStore.ts`, `frontend/src/hooks/useStatCardLayout.ts`,
`frontend/src/components/dashboard/StatCardsCustomizer.tsx`,
`frontend/src/components/dashboard/{DashboardHeader,ChannelAnalyticsInsights,AudienceHeroRow}.tsx`,
`frontend/src/components/DimensionsPanel.tsx`, `frontend/src/pages/DashboardPage.tsx`,
`backend/routes/user.js`, `backend/utils/cardLayoutPrefs.js` (+`.test.js`).
Verified locally: `pnpm test` (frontend 190 passed / backend 473 passed), `eslint` on
touched files (no new findings), `pnpm ui:boundary` (no new violations), `pnpm design:lint`
(exit 0), `vite build` (built in 20.12s).

## What changed

Dashboard stat cards can now be **hidden, reordered and compacted (detail rows off)**
per user, persisted in the backend, and restored on any device.

Scope shipped now (2 surfaces):

| Surface id | Tab | Cards |
|---|---|---|
| `dashboard:channelAnalytics` | Channel | 19: 17 metric cards with mini-graphs + `netSubscribers` (Total Subscribers) + `videosUploaded` (Uploads) |
| `dashboard:audience` | Audience | 10: 4 hero tiles (`hero:topCountry`, `hero:countriesTracked`, `hero:topTrafficSource`, `hero:mobileShare`) + 6 breakdown cards (`countries`, `trafficSource`, `deviceType`, `ageGroup`, `subscriberStatus`, `gender`) |

Videos / Playlists / Insights tabs are intentionally not wired yet — the registry, store and
backend are surface-agnostic, so adding one = a registry entry + `orderedCardIds()` where that
tab renders (no backend change).

## Model & contract

```ts
type StatCardLayout = { order: string[]; hidden: string[]; compact: string[] };
type StatCardLayouts = Partial<Record<StatCardSurface, StatCardLayout>>;
```

- `order` is always normalized against the registry: unknown ids drop, new registry ids append
  at their default position → shipping a new card never invalidates a saved layout.
- `hidden` = user-hidden cards; `compact` = cards rendered **without detail rows**
  (Channel: the 90/30/7d delta pills; Audience: hero sub-line + pie delta pills).
- Customization layers **on top of** the existing data-driven empty-series filter, and a surface
  can never be blanked: hiding the last visible card is refused, and `orderedCardIds()` falls
  back to the first default card for corrupted payloads.

## Persistence (two-tier)

1. `localStorage` key `revtube_stat_card_layout` — written synchronously on every change
   (instant paint, works signed out/offline).
2. Backend — `users/{uid}.uiPreferences.cardLayout` via new endpoints on the existing
   `/api/user` router (already behind the auth wall at `index.js:1005`):

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/api/user/ui-preferences` | `{ cardLayout }` from Firestore; `serverCache` key `uiPrefs:{uid}` (24 h TTL); Firestore failure degrades to `{}` |
| `PUT` | `/api/user/ui-preferences` | sanitize → `set({ uiPreferences: { cardLayout, updatedAt } }, { merge: true })` → cache invalidate → `{ cardLayout }`; 503 on failure (client keeps local layout) |

Sanitizer `backend/utils/cardLayoutPrefs.js` (pure, 10 tests): surface pattern
`^[a-z][A-Za-z0-9]*:[A-Za-z0-9]+$`, id pattern `^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$`,
≤24 surfaces, ≤100 ids per list, trimmed/deduped, empty surfaces dropped, input never mutated.
The frontend mirrors the same limits in `utils/cardLayout.ts#sanitizeLayouts`.

Write path: optimistic store update → localStorage mirror → **debounced PUT (600 ms)**;
`flushCardLayoutSave()` on dashboard unmount. First sign-in with local-only customization
pushes the local layout up instead of overwriting it.

## UI

- `StatCardsCustomizer` (one trigger + Radix `Popover`) is mounted once in `DashboardHeader`'s
  tab rail and resolves the active tab's surface via `getStatCardSurfaceForTab` — so Videos /
  Playlists / Insights simply show no trigger today.
- Rows: position number, label (`min-w-0` + `truncate`), ▲/▼ position buttons (no drag-and-drop
  dependency exists in this repo), a "details" `IconButton` (active state = details on), and the
  visibility `Toggle`; header has `Reset`, footer states the last-card rule.
- Styling is primitives + the `.rt-dropdown-trigger` token class and inline `sx`/`style` only —
  no Tailwind outside `components/ui|layout`, no new CSS file (`pnpm ui:boundary` clean).
- Ordering is applied with CSS `order` on grid items (Channel grid + `dp-grid` for Audience), so
  the existing markup/classes and their CSS stay untouched.

## Notable implementation details

- Audience cards moved from the fixed `.aud-row-2` / `.aud-row-3` containers into **one** `.dp-grid`
  (uniform `repeat(3, 1fr)`, countries keeps `dp-card--wide` spanning all columns). This is what
  makes cross-row positioning possible; the trade-off is that the pies are now a uniform 3-up grid
  (2-up was the old row split). No new CSS was needed — `.dp-grid` / `.dp-card--wide` already exist.
- `computeAudienceHero` and its test are untouched: hero tiles map to ids **by label** through
  `AUDIENCE_HERO_CARD_BY_LABEL`, and `HeroTile` gained an optional `showSub` for the compact toggle.
- `ChannelInsightGridSkeleton` takes `count` so the loading state matches the visible card count.

## Verify

- `frontend`: `pnpm test` → 29 files / 190 tests pass (incl. `src/utils/cardLayout.test.ts`, 19);
  `pnpm design:lint` exit 0; `pnpm ui:boundary` → no new violations in new files;
  `pnpm exec vite build` → built in 20.12s.
- `backend`: `pnpm exec vitest run utils/cardLayoutPrefs.test.js` → 10 pass.
  Full `pnpm test`: 473 pass, 1 pre-existing date-sensitive failure
  (`services/orgAnalyticsService.test.mjs` leaderboard fixture dated 2026-08-20 falls outside the
  30d window as of 2026-09-24) — unrelated to this change.
- Pre-existing, untouched: `tsc -b` errors in `VideoDetailDialog.tsx` / `GoalDetailPage.tsx`,
  and `ui:boundary` violations in FeatureGuard / ChannelChooserDialog / ChannelPage / ChatPage /
  GoalDetailPage / OptimizedListPage (other in-flight work in the same working tree).
- Manual: reorder/hide on Channel + Audience → refresh (localStorage) → sign out/in and a second
  browser (Firestore restore) → `Reset` returns to defaults.

## Follow-ups (not done)

- Wire Videos, Playlists and Insights surfaces; per-section Insights micro-tiles (`insight-stat`).
- Optional: drag-and-drop reordering, per-org/workspace scoping of layouts, ChannelPage stat strip.

## Update — tab-rail trigger polish (2026-09-24, same day)

Reported: the "Cards" pill overlapped the trailing tab (Insights) on narrower viewports, because the
tab list could not scroll and simply spilled over its sibling.

Changes:

- `DashboardHeader.tsx` — the tab rail is now `nav.analytics-tabs` > `div.analytics-tabs__scroller` >
  `div.analytics-tabs__list[role=tablist]` + `div.analytics-tabs__actions`. The actions wrapper is a
  sibling of the scroll region, so tabs scroll **under** nothing: the button always stays pinned.
- `StatCardsCustomizer.tsx` — trigger changed from a labelled `.rt-dropdown-trigger` pill to an
  icon-only `IconButton` (`size="sm"`, `variant="ghost"`, lucide `Settings2`); the `title`/`aria-label`
  still name the surface ("Customize Channel cards").
- `styles/page-chrome.css` (shared chrome, also the canonical rail for other screens) —
  - `.analytics-tabs__list` keeps natural tab widths (`min-width: max-content`) instead of squeezing;
  - new `.analytics-tabs__scroller`: `flex: 1 1 auto`, `min-width: 0`, `overflow-x: auto`, hidden
    scrollbar, `overscroll-behavior-x: contain`, touch momentum;
  - new `.analytics-tabs__actions`: `flex: 0 0 auto` + 12px left margin/padding and a left border
    divider, so the settings button has clear spacing from the tabs.
- `pages/DashboardPage.css` — the mobile media query that made the whole `.analytics-tabs` scroll was
  retargeted to `.analytics-tabs__scroller` (otherwise the pinned button would scroll away on phones).

Re-verified: `pnpm test` → 29 files / 190 tests pass; `pnpm exec tsc -b` → only the 5 pre-existing
errors in untouched files; `eslint` on the two touched components → exit 0; `pnpm design:lint` →
exit 0; `pnpm ui:boundary` → no new violations (the 6 reported files are pre-existing);
`pnpm exec vite build` → exit 0 (built in 51.93s).

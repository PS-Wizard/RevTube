# 2026-09-23 — Audit tab-rail navbar responsive

Sources: `frontend/src/components/audit/audit-tools.css` (`.audit-tool-tabs`),
`frontend/src/components/audit/AuditToolShell.tsx`, `frontend/src/styles/page-chrome.css` (`.analytics-tabs`)

## Problem
On the Optimized Content page (PWA/mobile) the Videos/Playlists navbar rail
misbehaved: `.audit-tool-tabs` was the only shell band without the centered
`max-width: min(var(--rt-shell-content-max-width), 100%)` rhythm the body,
alerts, and dashboard header rows all share, and the inherited
`.analytics-tabs { overflow-x: hidden }` clipped tabs (icon + label + count
pill) instead of letting them scroll on narrow screens.

## Fix (`audit-tools.css` only — shared by all `AuditToolShell` pages)
- `.audit-tool-tabs`: added `max-width` + `margin-inline: auto` (same as body/
  alerts; no visual change while the token is `100%`).
- `.audit-tool-tabs .analytics-tabs__list`: `overflow-x: auto` + `flex-wrap:
  nowrap` + hidden scrollbar (swipe to reach tabs), `min-width: 0`.
- `.audit-tool-tabs .analytics-tab`: `flex-shrink: 0` so labels stay intact
  while scrolling.
- `@media (max-width: 640px)`: tighter rail padding, compact tab padding/
  font, smaller count-pill gap. Scoped to `.audit-tool-tabs` so dashboard/
  channel rails are untouched.

## Verify
- Stylelint on `audit-tools.css` + `OptimizedListPage.css` passes. CSS-only,
  no TS impact.

## Update — navbar still PC-wide on mobile PWA (page-level overflow)
Rail CSS alone couldn't fix it: the rail's container itself was stretched —
`.content-area` scrolls, so any page content wider than the viewport pulls all
full-width bands (header, tab navbar) PC-wide with sideways scrolling. Prime
suspect on this page: unbreakable KPI counts in the 3-column stats strip.
- `audit-tools.css`: `.audit-tool-page` gets `min-width: 0; overflow-x: clip`
  (page-level guard for all shell pages; `clip` keeps sticky working, inner
  scroll containers unaffected).
- `OptimizedListPage.css`: `.opt-stat-card` gets `overflow: hidden`,
  `.opt-stat-card__value` truncates with ellipsis instead of stretching,
  `.opt-toolbar > *` gets `min-width: 0`.

## Update — guard works in old webviews too
`overflow-x: clip` is ignored pre-Chrome 90 (some PWA webviews), which would
drop the guard entirely. Now declared as a progressive pair:
`overflow-x: hidden` first, then `overflow-x: clip`. Note: no service worker
in this app, but installed PWAs still HTTP-cache bundles — a stale cached
build will keep showing the old wide navbar until the PWA refreshes.

# 2026-09-23 — Mobile sidebar auto-close + chat avatar chooser

Sources: `frontend/src/components/Layout.tsx` (sidebar `nav`),
`frontend/src/pages/ChatPage.tsx` (composer channel button)

## Mobile sidebar auto-close
Tapping a sidebar destination on mobile navigated but left the drawer open.
One delegated `onClick` on `<nav class="sidebar-nav">` now closes the drawer
when the tap lands on `a[href]` (all NavLinks) or `.recent-item-main`
(recent channels/playlists/comparisons, which navigate via handler) — desktop
unaffected (`drawerBreakpointMatches` guard). Delete buttons stop propagation
in their own handlers, so they never trigger it.

## Chat channel chooser → circular avatar
The composer channel pill (avatar + truncated name + chevron, ~150px wide)
is now a 40px circular avatar button (`Avatar size="lg"` in a plain
round button): details via `Tooltip` (desktop hover) + native `title`
(touch long-press), tap opens the existing Select Channel dialog (search,
rows, badges unchanged). Frees ~110px of composer width on phones.

## Verify
- `tsc` clean for `Layout`/`ChatPage`. ESLint: only pre-existing issues
  (Layout 3 hook-ref errors and ChatPage 8 `any` + 3 hook-dep warnings,
  identical counts on HEAD).

# 2026-09-22 — Channel chooser rebuilt as a dialog (mobile actions didn't fit)

Sources: `frontend/src/components/dashboard/ChannelChooserDialog.tsx` (new),
`frontend/src/components/dashboard/ChannelSelector.tsx`,
`frontend/src/components/dashboard/DashboardHeader.tsx`,
`frontend/src/pages/DashboardPage.tsx`, `frontend/src/stores/dashboardStore.ts`,
`frontend/src/types/dashboard.ts`, `frontend/src/hooks/useDashboardUI.ts`,
`frontend/src/pages/DashboardPage.css`.

## Problem

Per-channel focus / move-to-org / delete buttons lived in dropdown rows with
`opacity: 0` + `:hover` reveal — unreachable on touch screens (tap selects and
closes). A first attempt (always-visible in-flow actions via media query) still
felt cramped, so the chooser was rebuilt as a dialog.

## Change

- New `ChannelChooserDialog`: `Modal` (`maxWidth="sm"`) with search, full-width
  rows (avatar, ellipsized title, ORG badge, selected check), and **labeled**
  action buttons on their own wrapping line (Focus / Move to org / Remove) —
  roomy on mobile and desktop. Footer: channel count + "Add another channel"
  with connecting spinner.
- `ChannelSelector` is now trigger + dialog (same trigger look/classes);
  dropdown open state, Escape/click-outside handling, and `DropdownPanel`
  removed. `DashboardHeader`/`DashboardPage` props simplified accordingly.
- Deleted now-dead state: `modals.showChannelDropdown` + setter (store, types,
  `useDashboardUI`). (`useDashboardState` still carries a local copy but has
  zero consumers — pre-existing dead code, left alone.)
- Removed orphaned CSS: all `.channel-dropdown-*` rules, `.org-channel-badge`,
  `.check-icon` (verified zero TSX references first).

## Verify

- `tsc -b` → no errors in touched files; `eslint` on all 7 touched TS files →
  clean; `stylelint DashboardPage.css` → clean.
- No existing tests reference these components.

## Update — Tailwind rewrite + repo-wide UI rule (same day)

- The dialog's first version used MUI `sx` compat primitives and still
  overflowed horizontally on mobile (compat internals break the ellipsis
  chain). Rewrote `ChannelChooserDialog` with Tailwind utilities + shared
  primitives only (`Modal`, `Button`, `Input` from `components/ui`, plain
  elements otherwise): strict `min-w-0` + `truncate` on every text-bearing flex
  row, `flex-wrap` action lines, `pl-11` action indent. No custom CSS, no `sx`.
- New mandatory convention (user request, now in core agent files):
  `AGENTS.md` Conventions gained a **Frontend UI** rule — Tailwind +
  `components/ui` first; no new custom CSS files, page-specific classes, or
  MUI `sx`; no raw hex; `min-w-0` + `truncate` chains on text rows; no
  `:hover`-only touch targets. Mirrored in `frontend/docs/UI_STANDARDS.md`
  Core Rules.
- Verify: `tsc -b` / `eslint ChannelChooserDialog` clean.

## Update — chat-modal model with expandable rows (same day)

- The Tailwind rewrite still overflowed on real mobile viewports (the always
  visible wrapping action cluster + `pl-11` indent left too little room).
- Rebuilt rows on the chat channel modal model: single-line rows (avatar +
  truncated title + ORG badge + check, tap = select + close). Management
  actions moved behind a per-row ⋯ expander rendering in normal flow below the
  row — no popovers/menus that could clip off-screen. Expanded state resets on
  every close (via a `handleClose` wrapper, not a setState-in-effect, per the
  react-hooks v6 rule).
- Verify: `tsc -b` / `eslint` clean.

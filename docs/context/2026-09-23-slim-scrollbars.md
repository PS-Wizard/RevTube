# 2026-09-23 — App-wide slim creative scrollbars

Sources: `frontend/src/index.css` (global `::-webkit-scrollbar` set)

## Change
Replaced the old app-wide scrollbar (10px, hardcoded gray/blue `rgba`, wrong
in dark mode) with a slim theme-aware design:
- 8px wide/tall, transparent track and corner.
- Floating pill thumb: token tertiary at 55% via `color-mix`, `2px`
  transparent border + `background-clip: padding-box` (≈4px visible), full
  pill radius.
- Hover: solid `--rt-color-accent`.
- Firefox: `scrollbar-width: thin` + matching `scrollbar-color` pair.
- Component-level variants (sidebar 6px, data tables 8px) intentionally kept.

## Verify
- Stylelint on `src/index.css` passes (tokens only, no raw colors). CSS-only,
  no TS impact.

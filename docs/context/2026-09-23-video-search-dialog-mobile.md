# 2026-09-23 — Video chooser dialog mobile/PWA overflow

Sources: `frontend/src/pages/thumbnailOptimizer/VideoSearchDialog.tsx` (used by `OptimizedListPage.tsx:695`)

## Problem
The Optimized Content video chooser opened overflowing on phones/PWA:
`PaperProps.sx` pinned `width`/`minWidth` to `70vw` — a ~250px sliver on a
360px phone — so every inner row (sort bar, select-all bar, footer bar)
spilled horizontally out of the dialog. Those bars were also no-wrap flex
rows, and `minHeight: 480` could exceed short PWA viewport heights.

## Fix (`VideoSearchDialog.tsx` only, inline `sx`)
- Paper: `width: min(960px, calc(100vw - 2rem))` (full-bleed on phones, ~old
  70vw cap on desktop), dropped `minWidth: 70vw`, `minHeight: min(480px, 60vh)`.
- Sort bar, select-all bar, footer count bar: added `flexWrap: wrap` (+ row/
  column gaps); select-all label gets `minWidth: 0` so long text truncates
  instead of forcing width.
- Header channel `Select`: `minWidth: 180 → 140`, `maxWidth: 320 → 100%` +
  `flexShrink: 1` so it squeezes beside the close button on ~320px screens.
- Cancel/Confirm actions already stack on mobile via shared `DialogFooter`
  (`flex-col-reverse`); untouched.

## Verify
- `tsc --noEmit -p tsconfig.app.json` → no `VideoSearchDialog` errors.
- ESLint on the file shows only pre-existing warnings (set-state-in-effect
  reset block, missing `initialSelectedIds` dep) — not introduced here.

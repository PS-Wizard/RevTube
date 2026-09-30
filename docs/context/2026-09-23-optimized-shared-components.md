# 2026-09-23 — Optimized page rebuilt on shared components (no custom CSS)

Sources: `frontend/src/pages/OptimizedListPage.tsx`,
deleted `frontend/src/pages/OptimizedListPage.css` (~570 lines)

## Change
`OptimizedListPage` no longer ships page-specific CSS. All `opt-*` classes
are replaced with shared primitives + Tailwind token utilities (GoalsPage
pattern), so responsiveness comes from the primitives instead of hand-rolled
media queries:
- Stats strip → `Grid container spacing` + `Grid size={{xs:6, sm:4}}` +
  `StatCard` (2/row on phones, 3/row from sm; tones neutral/success/info).
- Toolbar / loading → `Card size="sm"` + `Flex wrap`; `Spinner` + `Typography`.
- Both tables → `TableContainer` (built-in `overflow-x-auto`) +
  `Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell`.
- Progress bars → shared `Progress`; row actions → `IconButton size="xs"`
  (danger hover via tokens); toggles/tooltips/inputs/selects unchanged.
- Cell interiors use `Flex`/`Stack`/`Box` (no raw flex/grid/gap/items/justify
  utilities per Stack rule); text rows keep the `min-w-0` + `truncate` chain.
- Complete-row tint kept via inline `color-mix` success style; dead classes
  (`opt-audited`, `opt-progress-ring`, `opt-add-row`, …) removed with the file.
- Behavior/logic untouched (filter, sort, toggles, browse dialog, navigation).

## Verify
- `tsc --noEmit -p tsconfig.app.json` → no `OptimizedListPage` errors.
- ESLint on the file clean. No tests reference the page. No remaining
  `OptimizedListPage.css` imports.

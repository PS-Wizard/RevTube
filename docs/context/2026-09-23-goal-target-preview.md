# 2026-09-23 — Goal target bidirectional preview

Sources: `frontend/src/components/goals/CreateGoalModal.tsx` (~1198), `frontend/src/components/goals/CreateGoalModal.css` (`.cgm-target-mode__preview`)

## Change
The target preview under Add/Final in the goal creation modal was `%`-mode only.
Now it shows in both modes whenever the baseline is loaded and usable (`canUsePercent && parsedTarget > 0`):

- `# Number` mode: `Starting + Add = Final (+X%)` — the % equivalent appears while typing a number.
- `% Percent` mode: `Starting + X% (+N absolute) = Final` — the absolute Add equivalent appears while typing a %.

## Verify
- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → no `CreateGoalModal` errors (full `pnpm build` still fails on pre-existing `VideoDetailDialog` / `GoalDetailPage` unused-var errors, unrelated).
- No CSS change; existing `.cgm-target-mode__preview` class reused.

## Update — mobile footer overflow fix
Root cause: `.cgm-footer` was a no-wrap `justify-content: flex-end` row, so on
narrow screens the buttons overflowed to the left (Cancel pushed off-screen).
Wide inner grids (5-col subframes summary, `auto 1fr` baseline range) forced
the whole dialog wider than the viewport, compounding it.
Fix (`CreateGoalModal.css` only): footer gets `flex-wrap: wrap` + `min-width: 0`
on children; new `@media (max-width: 480px)` block stacks footer buttons
full-width (Cancel top, Create Goal bottom), collapses the summary to one
column, stacks the baseline-range select, and lets the adaptive card wrap.
Stylelint on the file passes.

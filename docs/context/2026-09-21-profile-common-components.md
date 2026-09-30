# 2026-09-21 — Profile page rebuilt on shared components

Sources: `frontend/src/pages/ProfilePage.tsx`, `frontend/src/components/ui/`
(`FormField`, `Divider`, `Grid`, `Stack`, `Flex`, `Box`, `Typography`,
`Avatar`, `Card`, `Input`, `Button`, `Badge`), `frontend/docs/UI_STANDARDS.md`,
`frontend/scripts/check-ui-boundary.mjs`.

## Change

`ProfilePage` no longer defines its own `SettingRow` component and no longer
carries per-panel inline overrides (custom `borderBottom`/`backgroundColor`
header tints, `var(--border)` / `var(--foreground)` / `var(--muted)` values).
Everything now composes from the `components/ui` barrel:

- Page-local `SettingRow` (label column + control column) deleted. Each row is
  now `FormField` (`label` + `hint` built in, `htmlFor` wired to the `Input`
  `id`) with a `Flex wrap` row of `Input` (in a `flexGrow` `Box`) + `Button`.
  FormField is the sanctioned stacked-settings pattern per UI_STANDARDS.
- Card header tint + hairline overrides replaced by plain `CardHeader` /
  `CardTitle` / `CardDescription` with a shared `Divider` between header and
  content — the app-wide card rhythm instead of a one-off look.
- Rail metadata (`Member since`, `User ID`) labels use `Typography`
  `variant="overline"` (uppercase micro-label is built in); the hand-drawn
  `borderTop` separator is a shared `Divider`.
- Sizing/positioning that remains (`Avatar` 72px, sticky rail, bottom gutter,
  text wrapping) is passed via `sx` props on shared components, not custom
  classes or stylesheets. No `ProfilePage.css` exists or is needed.
- Kept as-is (already shared): `page-container` / `page-header` /
  `page-description` chrome (canonical per UI_STANDARDS, not custom CSS),
  `Avatar`, `Badge`, `Button` variants, toast feedback, all auth logic —
  behavior unchanged.

Also fixed in passing: `ChannelFocusDialog`'s two-column pairs used raw
Tailwind (`grid … sm:grid-cols-2`), a `ui:boundary` violation introduced with
the wide-dialog change — now shared `Grid container spacing={1.5}` +
`Grid size={{ xs: 12, sm: 6 }}` (same 12px gap, `sm` breakpoint).

## Verify

- `pnpm exec eslint` on changed files — clean.
- `pnpm exec tsc -b` — only the 6 pre-existing errors in untouched files
  (`VideoDetailDialog.tsx`, `GoalDetailPage.tsx`).
- `node scripts/check-ui-boundary.mjs` — changed files clean. One remaining
  failure is pre-existing in untouched `components/FeatureGuard.tsx` (stale
  baseline, out of scope for this migration).
- Visual check still open: no screenshot run — rail/Card rhythm and the
  stacked (was side-by-side label/control) rows deserve a glance at desktop
  and mobile widths.

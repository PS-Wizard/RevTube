# UI Standards

## Purpose
Define consistent, lightweight, and maintainable UI patterns across the app.

## Core Rules
- Use design tokens from `src/styles/design-tokens.css` for all new UI colors/spacing/radius/typography.
- Use shared primitives from `src/components/ui/` for all new UI controls.
- Do not introduce new page-local button systems.
- Prefer component-level composition over broad global CSS selectors.
- Tailwind CSS first: style new UI with Tailwind utilities + `--rt-*` tokens via arbitrary values (e.g. `bg-[var(--rt-color-bg-subtle)]`). Do NOT add custom CSS files or page-specific classes for new UI; no raw hex colors anywhere.
- Do not use the `sx` prop in new code. It still exists on `<Button>`, `<Dialog>` and `<Select>` as a **MUI compatibility shim**, and `ui/accordion.tsx` still emits `Mui*` class names for legacy selectors. Both are migration debt. See
  [Design System & UI Component Library](../../docs/06-Frontend%20Architecture/02-Design%20System%20%26%20UI%20Component%20Library.md).
- Mobile overflow: every flex row that holds text must carry a `min-w-0` + `truncate` chain so viewports never scroll horizontally.
- No `:hover`-only reveals for touch targets — touch devices have no hover.

## Button Contract
`<Button />` (`src/components/ui/button.tsx`) is a `class-variance-authority` component.
Canonical variants:

| Variant | Use for |
|---|---|
| `default` | The implicit default. Identical styling to `primary`. |
| `primary` | The main action on a screen. |
| `secondary` | Supporting / lower-emphasis actions. |
| `outline` | Low-emphasis, still needs a visible boundary. |
| `ghost` | Tertiary / toolbar actions with no fill. |
| `danger` | Destructive actions only, in an explicit destructive flow. |
| `link` | Text that navigates rather than acts. |

Sizes: `default`, `sm`, `lg`, and the icon-only sizes `icon`, `icon-xs`, `icon-sm`,
`icon-lg`.

### Legacy prop compatibility
`button.tsx` still accepts the old MUI prop names and maps them, so existing call sites
keep working without a migration pass:

| Legacy | Maps to |
|---|---|
| `variant="contained"` | `primary` |
| `variant="outlined"` | `outline` |
| `variant="text"` | `ghost` |
| `variant="cta"` | `primary` |
| `color="error"` | `destructive` |
| `size="small" / "medium" / "large"` | `sm` / `default` / `lg` |

It also accepts an `sx` prop, parsed by `parseSx` into classes and inline style. This
is a **compatibility shim, not a recommendation**. New code should use the plain
cva variant names and a `className`, not `sx`.

Do not create new semantic button classes in feature CSS.

## Mapping Guide
> The legacy class names below were removed from the CSS in the shadcn migration.
> They are recorded here only so you can recognise them in old diffs and git history.
> If you find one still in use, that is a migration bug, not a pattern to follow.

| Removed class | Replacement |
|---|---|
| `.button-primary` | `<Button variant="primary" />` |
| `.button-secondary` | `<Button variant="secondary" />` |
| `.action-btn` / `.org-action-btn` | `<Button variant="secondary" />` by default |
| `.danger-btn` | `<Button variant="danger" />` only for destructive actions |
| `.connect-button` | `<Button variant="primary" />` |
| `.header-expert-btn` | still present in `Layout.css`; migrate to `<Button variant="primary" />` when touched |

## Form Controls
- Use:
  - `<Input />` (`ui/Input.tsx`) for text/number/date fields
  - `<Select />` (`ui/select.tsx`, lowercase `s`) for the shadcn select. It exposes a
    `SelectCompat` shim that still accepts the old MUI-style `onChange`/`value` props
    alongside the Radix API, so older call sites keep working.
  - `<NativeSelect />` (`ui/NativeSelect.tsx`) when a real `<select>` is wanted
  - `<FormField />` (defined in `ui/Form.tsx`) as the label/control wrapper
  - `.rt-input-native` / `.rt-select-native` classes only when primitives are not feasible.
    Both still exist (9 and 15 references respectively), so they are maintained, not
    deprecated.


## Modals And Cards
- Use `<Dialog />` from `src/components/ui/dialog.tsx` for ALL dialogs. It is the single
  centralized dialog primitive: one component renders the Radix Root + Portal + Overlay +
  Content, so there is no separate shell to compose.
  - It accepts **MUI-style props** (`open` / `onClose` / `maxWidth` / `fullWidth` /
    `PaperProps`) alongside the Radix `onOpenChange`. This is deliberate: it lets old
    call sites keep working and new code use plain shadcn props, without a migration pass.
  - Compose the sub-parts (`DialogTitle`, `DialogBody`, `DialogActions`, `DialogHeader`,
    `DialogFooter`) **inside** it. They render no portal or overlay of their own, so
    nesting is safe.
  - Backdrop-click and Escape are blocked by default so form input is never lost. Opt in
    with `closeOnBackdrop` / `closeOnEscape`.
- Use `<Modal />` for the non-Radix modal shell and `<Card />` for surfaces.
- Keep per-feature modal CSS minimal; avoid redefining shared modal shells.

> **Correction.** This doc previously required `<AppDialog />` from
> `src/components/AppDialog.tsx`. **That file does not exist.** `AppDialog` was the old
> MUI-backed dialog; it was consolidated into `ui/dialog.tsx`, whose own header comment
> still refers to `AppDialog` as the thing it replaced. `ui/Modal.tsx` is the closest
> current equivalent. There are zero `AppDialog` imports left in `frontend/src`.

### Legacy alias
- `OptimizerDialog` (`src/pages/thumbnail-optimizer/OptimizerDialog.tsx`) is a one-line
  re-export for backward compatibility:
  `export { Dialog as OptimizerDialog } from '../../components/ui';`
- New features should import `Dialog` directly from `src/components/ui`.

## Page Layouts & Shell Contracts

> All layout guide specs live in [`docs/06-Frontend Architecture/layout-guides/`](../../docs/06-Frontend%20Architecture/layout-guides/README.md):
> - [`02-Audit & Optimizer.md`](../../docs/06-Frontend%20Architecture/layout-guides/02-Audit%20%26%20Optimizer.md) — Video Audit, Thumbnail Optimizer, Playlist Optimizer, Full Audit, Optimized Content.
> - [`03-Data Explorer.md`](../../docs/06-Frontend%20Architecture/layout-guides/03-Data%20Explorer.md) — Videos, Channel, Playlist, Specific Videos, Compare.
> - [`01-Analytics Dashboard.md`](../../docs/06-Frontend%20Architecture/layout-guides/01-Analytics%20Dashboard.md) — Channel and Org Dashboards.
> - [`04-Management & Admin.md`](../../docs/06-Frontend%20Architecture/layout-guides/04-Management%20%26%20Admin.md) — Admin, Org, Profile.
> - [`05-Workspace & Utility.md`](../../docs/06-Frontend%20Architecture/layout-guides/05-Workspace%20%26%20Utility.md) — Goals, Chat, Docs.

### Shell Components

| Shell | Source | Used By |
|-------|--------|---------|
| `<AuditToolShell />` | `src/components/audit/AuditToolShell.tsx` | All audit & optimizer pages |
| `<DataExplorerShell />` | `src/components/shells/DataExplorerShell.tsx` | Videos, Channel, Playlist, SpecificVideos |
| `<PageShell />` | `src/components/layout/PageShell.tsx` | Route pages that are not audit/optimizer shaped |
| `<AuthShell />` | `src/components/layout/AuthShell.tsx` | Sign-in and auth pages |
| Import barrel | `src/components/shells/index.ts` | `import { DataExplorerShell, AuditToolShell, PageShell, AuthShell } from '../components/shells'` |

### CSS Primitives for Page Chrome

| Class | File | Purpose |
|-------|------|---------|
| `.page-container` | `styles/page-shell.css` | Outer page wrapper — no padding, no max-width |
| `.page-header` | `styles/page-chrome.css` | Title band with fixed min-height and bottom border |
| `.page-header--split` | `styles/page-chrome.css` | Adds `space-between` for title + action cluster |
| `.page-description` | `styles/page-chrome.css` | Muted subtitle below `<h1>` |
| `.page-body` | `styles/page-chrome.css` | Constrained-width body area with standard padding and vertical gap — use for Workspace pages (Goals, GoalDetail, etc.) that don't need a tabbed shell |
| `.analytics-tabs` / `.analytics-tab` | `styles/page-chrome.css` | Underline tab rail used by dashboard and audit shells |
| `.form-section` | `styles/page-chrome.css` | Standard toolbar container below the header |
| `.data-explorer-alerts` / `.data-explorer-usage` | `styles/page-chrome.css` | Alert / usage banner slots below the header |
| `.audit-tool-alerts` | `styles/page-chrome.css` | Alert banner slot inside `AuditToolShell` |

## Component Boundary (enforced)

Tailwind utilities live **only** inside shared primitives
(`src/components/ui/**` and `src/components/layout/**`).
Pages and feature components compose shared components and pass props —
never raw Tailwind classNames, hand-rolled SVGs for built-in behaviors,
or per-page layout CSS.

| Instead of … | Use … |
|---|---|
| `className="flex …"` / `grid …` / `gap-*` in a page | `<Stack>` / `<Flex>` (both in `ui/Stack.tsx`) / `<Container>` / `<Grid>` / `<PageShell>` (`components/layout/PageShell.tsx`) |
| Raw `<input type="password">` + eye toggle SVG | `<Input type="password" />` (toggle is built in; `passwordToggle={false}` opts out) |
| Raw `<input>` / `<select>` in forms | `<Input>` / `<TextField>` / `<NativeSelect>` inside `<FormField>` (defined in `ui/Form.tsx`) |
| Toggle chip chrome + SVGs | `<ToggleChip pressed size icon label onToggle />` |
| Wide guide dialog classes | `<Modal guide …>` |


Enforcement: `pnpm ui:boundary` (fails on NEW violations vs
`scripts/ui-boundary-baseline.json`; refresh with `--update-baseline`
only when a page migration lands).

## Performance Guidelines
- Use narrow Zustand selectors and avoid object-wide subscriptions.
- Keep large lists paginated or virtualized.
- Precompute expensive display values when data is loaded.
- Prefer route/component lazy loading for heavy dashboard-only features.



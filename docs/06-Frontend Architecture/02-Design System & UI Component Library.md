## Design System & UI Component Library

Relevant source files

-   [DESIGN_LANGUAGE](05-Design%20Language.md)
-   [frontend/docs/UI_STANDARDS.md](../../frontend/docs/UI_STANDARDS.md)
-   [frontend/src/components/ui/index.ts](../../frontend/src/components/ui/index.ts)
-   [frontend/src/components/ui/button.tsx](../../frontend/src/components/ui/button.tsx)
-   [frontend/src/components/ui/card.tsx](../../frontend/src/components/ui/card.tsx)
-   [frontend/src/components/ui/Input.tsx](../../frontend/src/components/ui/Input.tsx)
-   [frontend/src/components/ui/Modal.tsx](../../frontend/src/components/ui/Modal.tsx)
-   [frontend/src/components/ui/popover.tsx](../../frontend/src/components/ui/popover.tsx)
-   [frontend/src/components/ui/select.tsx](../../frontend/src/components/ui/select.tsx)
-   [frontend/src/components/SaveListModal.tsx](../../frontend/src/components/SaveListModal.tsx)
-   [frontend/src/styles/data-table.css](../../frontend/src/styles/data-table.css)
-   [frontend/src/styles/design-tokens.css](../../frontend/src/styles/design-tokens.css)

> **Naming note.** `components/ui/` mixes two conventions. shadcn primitives are
> lowercase (`button.tsx`, `card.tsx`, `popover.tsx`, `select.tsx`, `dialog.tsx`,
> `table.tsx`, `tabs.tsx`, `tooltip.tsx`, `accordion.tsx`, `pagination.tsx`), and
> RevTube's own additions are PascalCase (`Box.tsx`, `Container.tsx`, `Grid.tsx`,
> `Stack.tsx`, `Paper.tsx`, `Modal.tsx`, `Dropdown.tsx`, `Menu.tsx`, `Input.tsx`,
> `TextField.tsx`, `Typography.tsx`, `List.tsx`, `Chip.tsx`, `StatCard.tsx`,
> `Spinner.tsx`, `Form.tsx`, `FormControl.tsx`, `Link.tsx`, `Divider.tsx`,
> `Toggle.tsx`, `ToggleChip.tsx`, `SegmentedControl.tsx`, `IconButton.tsx`,
> `NativeSelect.tsx`, `DialogTitleBlock.tsx`, `VisuallyHidden.tsx`).
> Match the existing casing of the file you are editing. On a case-insensitive
> filesystem (Windows, macOS default) a wrong case looks fine and then breaks on
> Linux and in CI.

The RevTube design system is an enterprise-focused framework for high-density
analytics workflows. It prioritises functional clarity, accessibility (WCAG AA) and
scalability across complex data views. It is built on three foundations: CSS design
tokens, Tailwind CSS 4 utility styling, and a shared library of React primitives in
`frontend/src/components/ui/`.

> **Correction: Material UI is gone.** These primitives no longer wrap MUI. The
> project migrated to shadcn (Radix UI + `class-variance-authority` + Tailwind).
> `@mui/material` and `@emotion/*` are not in `frontend/package.json` and appear
> nowhere in `frontend/src`. `frontend/src/styles/muiTheme.ts` survives only as a
> deprecated shim whose own header reads "MUI Theme removed in favor of shadcn and
> Tailwind CSS"; it exports `getMuiTheme = () => null` plus a small `appLayout`
> constant, and has no consumers. Do not add new code against it.

## Design Tokens & Theme Architecture

`design-tokens.css` is the single source of truth for all visual primitives,
expressed as CSS custom properties. Light and dark mode are driven by the
`data-theme` attribute on the document root.

Tokens are grouped semantically so styling expresses intent rather than hardcoded
values. The `--rt-*` prefix is mandatory, and Stylelint enforces it:
`pnpm design:lint` fails on any raw hex color outside `design-tokens.css`.

## Tailwind integration

Tailwind 4 is wired through `@tailwindcss/vite`. There is no `tailwind.config.js`;
Tailwind 4 is configured in CSS. Tokens are consumed as Tailwind arbitrary values,
for example `bg-[var(--rt-color-bg-subtle)]`, rather than being mirrored into a
second set of Tailwind color names. That keeps a single source of truth.

The `cn()` helper (`frontend/src/lib/utils.ts`) wraps `clsx` + `tailwind-merge`, so
a component can accept a `className` override without specificity fights.


## Migrated components: the `sx` / `Mui*` compat layer

MUI itself is gone, but its *call sites* were not all rewritten at the same time.
`components/ui/accordion.tsx` is the clearest example and explains the "MUI" and
`sx` references that still appear across the page docs.

That file exports two things:

1. **`Accordion` / `AccordionSummary` / `AccordionDetails`** are hand-written Radix
   wrappers used by new code, styled with Tailwind and `data-slot` attributes.
2. **`AccordionCompat` (exported under the name `Accordion`)** is a compatibility
   shim for the old MUI call sites. It accepts an `sx` prop, merges it into inline
   `style`, and emits elements carrying `Mui*` class names so page-level CSS such
   as `.MuiAccordionSummary-root` keeps matching.

The shim even normalises the MUI JSX shape: `Accordion` inspects its children and
folds them into a single `AccordionItem` internally, because that is what the old
code assumed.

Two practical consequences:

- `sx={{ ... }}` in `ThumbnailOptimizerPage.tsx` and other older pages is **not**
  MUI. It is this shim's inline-style escape hatch.
- `querySelector('.MuiAccordionSummary-root')` in the optimizer page targets the
  shim's class names, not a real MUI runtime.

Both are technical debt to remove under the boy-scout rule, not a reason to
reintroduce MUI. When you touch one of these call sites, migrate it to the Radix
`AccordionItem` / `AccordionTrigger` form and drop the `Mui*` selectors with it.

## Shared UI Component Library

`frontend/src/components/ui/` holds the primitives. `index.ts` is the barrel and is
the import surface feature code should use. Composition rules:

- Build from the shared primitives plus Tailwind.
- Do **not** add new custom CSS files or page-specific classes for new UI.
- Do **not** introduce new `sx` usage or new `Mui*` class selectors.
- Every flex row holding text needs a `min-w-0` + `truncate` chain so mobile
  viewports never overflow horizontally.
- Touch targets must not depend on `:hover` reveal.

Legacy `.rt-*` classes (`.rt-btn`, `.rt-input-native`, `.rt-modal-overlay`,
`.rt-dropdown-panel`) still exist in `design-tokens.css` and are used by
`SaveListModal` and similar older components. They are maintained, not extended.
New UI uses the primitives. This is the **boy-scout rule**: when you touch a file
that still uses a legacy custom CSS class, migrate that usage to Tailwind or a
shared primitive in the same change, and delete the CSS file if nothing imports it
any more.

## Specialized UI Systems

### Data tables

`data-table.css` styles analytics report tables. The `.table-report` shell
encapsulates a header toolbar, the grid and pagination into one bordered unit.

- Sticky headers use `position: sticky` with `--rt-table-header-bg` and a subtle
  shadow for depth while scrolling.
- Numeric columns (`.number-cell`, `.rt-table-th--numeric`) are centre-aligned.
- `components/audit/AuditDataTable.tsx` and `AuditedVideosTable.tsx` build on this,
  with `ResizableColumns.tsx` and `useColumnWidths.ts` for column sizing.

### Charts

Charts consume `--rt-chart-*` tokens so a metric keeps the same colour identity
everywhere it appears. See
[Data Visualization & Chart System](04-Data%20Visualization%20%26%20Chart%20System.md).

## Feature-folder decomposition

New or refactored UI is split into a feature folder with a thin entry component,
`components/` (one file per visual section), a `use<Feature>.ts` holding all state
and handlers, a `<feature>Utils.ts` for constants and formatters, and an
`index.ts` barrel. No page or panel file should exceed roughly 500 lines.
`components/admin/public-audit/` is the reference implementation.

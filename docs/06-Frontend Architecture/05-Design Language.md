# RevTube design language

RevTube is an **enterprise analytics product**. This document is our single source of truth for how it should look and behave: calm, functional, and consistent across hundreds of screens--without relying on external design-system packages.

**Implementation lives in the repo:** `frontend/src/styles/design-tokens.css`, optional `.rt-*` utilities, the token bridge via `rtPalette.ts`, and public URLs in `frontend/src/constants/productUrls.ts` (product site **tubeketer.ai**; **revketer.ai/contact** is reserved for the in-app **Expert Help** CTA only).

---

## Guiding philosophy

### Simple, clear, functional

The domain is complex (channels, videos, playlists, date ranges, comparisons). The interface should not be. Prefer familiar patterns; when we diverge, choose the option that is easier to understand and complete the task.

### Scalable

Components, tokens, and layout rules must work as we add tabs, metrics, and org features. Build from shared primitives; avoid one-off page styling that cannot be reused.

### Efficient in code and performance

Favor clear CSS and React over decorative layers. Keep bundles and runtime cost in mind--especially charts, tables, and dashboard shells. Skeletons should match final layout density.

### Intentional color (neutrals first)

Color is for **meaning**, not decoration. Default UI is neutral surfaces and restrained borders. Semantic hues (success, warning, danger, accent, chart series) appear only when they communicate state or data.

### Accessibility

Target **WCAG AA** minimum for text and interactive contrast in light and dark themes. Preserve visible focus, keyboard paths, and readable type hierarchy. Test interactive states, not only static mocks.

### Personality comes from the product

The design system shell stays neutral. RevTube’s character shows through **YouTube-context content** (thumbnails, channel names, metrics), layout density tuned for analysts, and scarce use of brand red--not through loud chrome or marketing gradients in the app shell.

---

## Visual identity

| Principle | Rule |
|-----------|------|
| **Analytics instrument** | Data and hierarchy lead; chrome supports scanning. |
| **One strong accent per view** | Everything else is secondary or neutral. |
| **Primary actions** | Black button surface (`--rt-color-btn-primary`) or blue accent (`--rt-color-accent`) for emphasis--pick one pattern per flow and stay consistent. |
| **YouTube red is scarce** | `--rt-color-youtube` only for Connect YouTube, Watch on YouTube, or deliberate export emphasis. |
| **Destructive** | Always `--rt-color-danger` / `.rt-btn--danger`--never reuse primary styles. |
| **Radius** | `4px` controls (`--rt-radius-md`); `8px` cards and modals (`--rt-radius-lg`). |
| **Type** | **Inter** only; action labels **semibold**; no uppercase except legal or tiny badges. Scale: `--rt-font-sans`, `--rt-text-pill` / `--rt-text-badge-sm` (badges), `--rt-text-2xs` (overlines), `--rt-text-xs`–`--rt-text-display`, `--rt-page-body-size` (default app body = `--rt-text-md`). |
| **Elevation** | Border + `--rt-shadow-xs` by default; `--rt-shadow-md` for modals and dropdowns only. |
| **Tier indicator** | Header profile avatar uses tier‑based border colors: `--rt-color-tier-org` (blue), `--rt-color-tier-admin` (red), `--rt-color-tier-pro` (golden), `--rt-color-tier-free` (muted grey). A small pill (`.header-plan-pill--{tier}`) shows “Org”, “Admin”, “Pro”, or “Free”. In org mode the profile text is hidden, showing only the avatar and tier chip. |

---

## Tokens and utilities

**File:** `frontend/src/styles/design-tokens.css` (imported from `index.css`).

| Category | Examples |
|----------|----------|
| Surfaces | `--rt-color-bg-app`, `--rt-color-bg-elevated`, `--rt-color-bg-subtle`, `--rt-color-bg-muted` |
| Text | `--rt-color-text`, `--rt-color-text-secondary`, `--rt-color-text-tertiary` |
| Borders | `--rt-color-border`, `--rt-color-border-strong` |
| Semantic | `--rt-color-accent`, `--rt-color-danger`, `--rt-color-success`, `--rt-color-warning` |
| Charts | `--rt-chart-*` (see `frontend/src/utils/chartTheme.ts` for SVG-safe hex) |
| Space / radius / shadow | `--rt-space-*`, `--rt-radius-*`, `--rt-shadow-*` |
| Type scale | `--rt-font-sans`, `--rt-page-body-size` (→ `--rt-text-md`), `--rt-text-sm` … `--rt-text-display`, `--rt-text-2xs`, `--rt-text-badge-sm`, `--rt-text-pill` |
| Controls | `--rt-control-height-*`, `--rt-toolbar-height` |

Legacy `--primary-color` / `--bg-surface` map to `--rt-*` for older CSS.

### Button variants

| Intent | Class | Notes |
|--------|-------|-------|
| Primary / solid | `.rt-btn--primary` | Main submit, save, apply |
| Secondary | `.rt-btn--secondary` | Cancel, alternate actions |
| Ghost | `.rt-btn--ghost` | Toolbar, low emphasis |
| Danger | `.rt-btn--danger` | Irreversible delete |
| YouTube CTA | `.rt-btn--youtube` | Scarce platform tie-in |

Do not add new button “themes” per page. Extend tokens or variants here first.

### Shell layout (dashboard)

| Token | Role |
|-------|------|
| `--rt-shell-content-max-width` | Main column (1440px) |
| `--rt-shell-page-gutter-x` / `-y` | Page inset |
| `--rt-shell-toolbar-*` | Toolbar card padding and gaps |
| `--rt-shell-workspace-*` | Elevated main column (radius, gap, shadow) in `shell-workspace.css` |
| `--rt-panel-header-height` | 60px bars: page header, `.dp-panel-header`, dashboard sticky header |
| `--rt-filter-field-width` | ~16rem max width for report-style toolbar filters |

**Rules:**

1. Routed pages render inside `.content-area` (elevated island on `--rt-color-bg-app`). Use transparent `.page-container` backgrounds.
2. Dashboard shell CSS lives in one place: `/* Dashboard app shell */` in `frontend/src/pages/dashboard/DashboardPage.css`.
3. Full-width header uses negative margin equal to page gutter; inner content aligns to max width.
4. Toolbar row: `.dashboard-toolbar` wraps `SavedListsPanel` + `VideoFiltersBar`--filters in `--rt-filter-field-width` groups; primary actions in `.dashboard-toolbar-inline-row--controls` at the end.

### Page chrome

Title band and fetch toolbars: `frontend/src/styles/page-chrome.css`.

- **`.page-header`** -- page title + description (highlight band, 60px min height). Used on Videos, Channel, Playlist, Compare, Profile.
- **`.dashboard-header-container`** -- sticky dashboard bar (channel selector, analytics tabs, date range); same visual language as page header.
- **`.form-section`** -- card-style input toolbar below the title band (ledger filter panel).

### Data tables

Shared report-style tables: `frontend/src/styles/data-table.css` + `--rt-table-*` tokens.

- Shell: `.table-report` wraps toolbar strip + `.table-card` (grid + pagination) as one bordered card.
- Grid: `class="rt-data-table"` on `<table>` inside `.table-wrapper`.
- Headers: sentence case, `--rt-color-bg-highlight` band, sticky with subtle shadow; body rows use `--rt-table-cell-padding-*` and neutral hover.

### Dashboard widgets

Use the same token vocabulary in `DimensionsPanel.css`, `.seo-widget`, `.dp-panel`, and `.content-section` — plus Tailwind `*- [var(--rt-*)]` classes in `ChannelAnalyticsInsights.tsx` and its extracted parts (`ChannelSeriesToggle`, `ChannelInsightCard`, `ChannelSparkline`). No duplicate hex blocks at the bottom of `DashboardPage.css`.

### EmptyState

A reusable placeholder for empty or not-yet-loaded views:

```
┌─────────────────────┐
│      [icon]         │
│                     │
│    Title            │
│  Description text   │
│                     │
│  [Action button]    │
└─────────────────────┘
```

- **File**: `frontend/src/components/EmptyState.tsx` + `EmptyState.css`
- **Props**: `icon?: ReactNode`, `title: string`, `description: string`, `action?: ReactNode`
- **Styling**: Centered flex column, `max-width: 480px`, no border/card shell. Icon 40px in tertiary color. Title `--rt-text-lg` semibold, description `--rt-text-sm` secondary.
- **When to use**: Channel not selected, no data fetched, no results, access denied, empty lists -- any page-level zero state. Do not use inside table rows or data-grid toolbars.
- **Used by**: ChannelPage, ComparePage, OrganizationPage (×3), PlaylistPage, SpecificVideosPage, VideosPage.

### Confirmation dialogs

Destructive or irreversible actions (logout, cache refresh, delete) must show a confirmation dialog before executing:

- **File**: Uses the existing `ConfirmModal` component (built on the shared `Modal` primitive)
- **Behavior**: Open modal → user reads warning → Confirm executes action / Cancel closes
- **Pattern**: `show<Action>Confirm` boolean state in the component, `onConfirm` async handler, `onCancel` resets state
- **Implemented for**: Logout (`Layout.tsx`), Refresh All Cache (`AdminPage.tsx`)
- **Rule**: Never use `window.confirm()` -- always use the `ConfirmModal` component for consistent styling and async support.

### Auth error toast

A centered, card-style toast shown on the sign-in page when Firebase authentication fails:

- **File**: `App.tsx` (rendered inside `ProtectedRoute`) + `App.css`
- **Layout**: Fixed position at `top:50%; left:50%; transform:translate(-50%,-50%)`. Card with 14px border-radius, shadow, `authToastIn` scale animation.
- **Structure**: Icon column (warning SVG) + title/body text column + dismiss (X) button.
- **Mobile (≤520px)**: Icon hidden, `max-width: none`, `width: calc(100% - 1.5rem)`.

### Dashboard error banner

Shown inline on the dashboard when channel data fails to load (token revoked, API error):

- **File**: `DashboardPage.tsx` + `DashboardPage.css`
- **Layout**: Card with 12px radius, shadow. Icon container (40px, danger-surface, 10px radius) + body (title + detail text) + action buttons.
- **Actions**: Retry button (refresh icon) + Re-authorize button (YouTube red logo, links to OAuth flow).
- **Mobile (≤768px)**: Full-width, no border-radius, buttons stack vertically.

### Deprecated: `muiTheme.ts`

1. MUI has been removed. `frontend/src/styles/muiTheme.ts` is a dead shim
   (`getMuiTheme = () => null`) with no consumers. Leave it for now if you like, but
   do not add code against it and do not treat it as a theme source of truth.
2. `appLayout.pageMaxWidth` = `RT_SHELL_CONTENT_MAX_WIDTH_PX` (1440) is the one value
   still read from it, via `rtPalette.ts`.

---

## Legacy audit (migration context)

We still carry inconsistent patterns from early screens. New work must not add to this debt.

### Buttons (historical)

Multiple “primary” meanings (red CTA, blue modal primary, gradient invite) and mixed radii/weights. **Migrate to `.rt-btn` variants and tokens.**

### Cards (historical)

Same white-on-gray idea with different border hex and shadow habits. **Migrate to `--rt-card-*` and `--rt-color-border`.**

### Raw hex in components

Many files bypass `:root` tokens. **Replace with `var(--rt-*)` when touching a file.**

---

## Migration strategy

1. **New UI** -- Tokens + `.rt-btn` / `.rt-card` only.
2. **Modals** -- One pass per modal family to approved button variants.
3. **Auth / marketing** -- Keep layout personality; swap hex → tokens and standard radius.
4. **Dashboard** -- Tokenize `DashboardPage.css` section by section.
5. **Tokens** -- `design-tokens.css` is the only source of truth; `rtPalette.ts` is the token bridge, not a second palette.

---

## Shipping checklist

Use before merge on any UI change.

### Visual tone

- Neutral surfaces; restrained borders; no decorative uppercase in analytics views.
- One dominant accent per screen; chart colors from `--rt-chart-*` / `chartTheme.ts`.

### Layout

- One column rhythm (`--rt-shell-content-max-width`, gutters).
- No nested card shells around the same control group.
- `--rt-space-*` between header → controls → chart → table.
- On small screens: data before secondary chrome where possible.

### Components

- Buttons: approved `.rt-btn` variants only.
- Inputs: `.rt-input-native`, `.rt-select-native`, `.rt-dropdown-*`.
- Tabs vs toggles: navigation tabs use underline/bottom border; filters use **detached chips**, not tab strips.
- Tables: calm headers, clear hover, stable pagination.

### Color

- Accent = primary action; red = danger or explicit YouTube moment; green/amber = semantic only.
- No new hex without a token and short justification in the PR.

### Responsive

Verify 360, 390, 768, 1024, 1280, 1440+ where the surface changes layout. No clipped popovers or obscured sticky content.

### Interaction

- Consistent hover / focus-visible / disabled / loading.
- Skeletons match final density.

### PR template

```md
- [ ] Used `--rt-*` / `.rt-btn` / `.rt-card` (no new one-off chrome).
- [ ] No raw hex without token updates.
- [ ] Spacing and elevation match neighboring canonical UI.
- [ ] Checked mobile + desktop breakpoints for this surface.
- [ ] Hover, focus, disabled, and loading states verified.
- [ ] Screenshots attached for visible changes.
```

### Cleanup backlog

1. Channels page -- controls and cards.
2. Playlists -- filters and toolbar.
3. Videos -- search, bulk actions, pagination density.
4. Profile / settings -- align with dashboard card language.

---

## Contributor quick links

| Need | Where |
|------|--------|
| Tokens | `frontend/src/styles/design-tokens.css` |
| Chart colors / ECharts | `frontend/src/utils/chartTheme.ts` |
| Token bridge / chart palette | `frontend/src/styles/rtPalette.ts` |
| Lint | `pnpm design:lint` from `frontend/` |

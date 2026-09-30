---
name: frontend-dashboard
description: Analytics dashboard UI for RevTube — layouts, KPI cards, tables, filters, sidebar/nav, loading/empty/error states. Covers the yafa-ui-dashboard pattern (React+Vite analytics/admin, no Next.js needed). Use for pages, shells, shared components.
---

# Frontend Dashboard (yafa-style, RevTube-flavored)

This is the `yafa-ui-dashboard` pattern applied to RevTube: analytics/admin dashboards on a React+Vite SPA. No Next.js required.

## Layout primitives

- Shell: `src/components/shells/DataExplorerShell.tsx` — Channel/Playlist/Videos pages render through it. Reuse, don't fork per page.
- Sidebar/nav: responsive collapse; org switcher lives in shell context, not per page. Route map in `AppRoutes`.
- Filters (date range, dimension, channel) are URL + store state so back/forward and share work. Filter changes re-fire Query hooks, not manual refetch chains.

## Building blocks

- **KPI cards**: title, big value, delta vs prior period, sparkline optional. Null (missing data) renders `—`, never `0` (missing-vs-zero rule).
- **Tables**: server-paginated where possible; virtualize >100 rows client-side. Column defs colocated with the page, cell components memoized.
- **States**: every data view handles `loading` (skeleton, not spinner wall) / `empty` (CTA: connect channel / adjust filters) / `error` (retry + snapshot-fallback note). No blank screens.

## Design-system compliance (see revtube-design skill)

- Tokens only: `--rt-*` vars from `src/styles/design-tokens.css`. `pnpm design:lint` fails raw hex outside tokens. Component contracts in `frontend/docs/UI_STANDARDS.md`.
- Charts via Recharts (see `data-visualization` skill). Numbers/dates formatted in one `utils/format*` path so KPI/table/tooltip agree.

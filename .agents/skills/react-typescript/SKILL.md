---
name: react-typescript
description: React 19 + TypeScript 5.9 strict conventions for RevTube frontend — component architecture, hooks, Zustand/XState/TanStack Query state, type-safe services. Use when touching frontend/src/.
---

# React + TypeScript (RevTube)

## Toolchain facts

- React 19 SPA, entry `src/main.tsx`. TS 5.9 strict + `verbatimModuleSyntax` + `noUnusedLocals` + bundler resolution. `pnpm build` = `tsc -b && vite build` — type errors fail the build.
- State: Zustand 5 (dashboard store) + XState 5 (tab machine) + TanStack Query 5 (server data). Don't mix roles: server data → Query, UI/transient → Zustand, tab lifecycle → XState.

## Component rules

- Services layer for all API calls — never `fetch` in components. Components call `services/*.ts` or `hooks/queries/*.ts` (`useChannelAnalyticsQuery` pattern).
- Types live in `src/types/` (`youtube.ts` etc.). API responses typed at the service boundary; narrow `unknown` once with a `parse*` helper (see `parseUserInitResponse` in `userService.ts`), don't re-validate per component.
- `verbatimModuleSyntax`: `import type { X }` for type-only imports. No unused locals — clean as you go.

## Hooks

- Data hooks wrap TanStack Query (`hooks/queries/`). Keep query keys org/user-aware (personal vs org caches must not leak — same rule as backend cache scoping).
- Local org caches use `localStorage` with org-scoped keys. Clear on org switch / logout.
- Effects: fetch-once in services + Query, not in `useEffect` chains. An `useEffect` that fetches usually means a missing Query hook.

## Performance hooks

- `React.memo` for KPI/table cells, `useMemo` for derived aggregations, `useCallback` only for memoized-child callbacks. Don't memo everything — measure first (see `performance` skill).
- Virtualize tables > ~100 rows; paginate server-side where the API supports it.

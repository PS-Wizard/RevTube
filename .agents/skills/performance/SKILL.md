---
name: performance
description: RevTube rendering + bundle performance — large tables, chart perf, code splitting, Vite budget. Use when views feel slow or before adding heavy deps.
---

# Performance (RevTube)

## Measure first

- Bundle: `pnpm perf:budget` (frontend) before/after dep changes. Render: React DevTools Profiler on the slow view; network tab to confirm cache-hit vs live-fetch (live YouTube calls on every interaction = missing cache, not slow React).

## React / charts / tables

- Tables: virtualize >100 rows, memoize cells, paginate server-side. Charts: cap ~300 points, disable animation on big series (ECharts `animation: false` via the evilcharts wrapper), memoize transforms (see `data-visualization` skill).
- Code-split optimizer/audit/chat routes with `React.lazy`; keep dashboard shell + KPI path in the initial chunk. One chart lib per page (see `vite` skill chunking).

## Backend perf

- `ServerCache` (Redis, LRU fallback 1000 entries/24h) + `withInFlightTimeout` dedup. Hot paths: PG aggregation over JS loops; chunked (50) YouTube calls; cron caps respected.
- Never fix slow dashboards with more live API calls — fix the cache key/snapshot coverage.

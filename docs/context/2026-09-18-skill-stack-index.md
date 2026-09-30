# 2026-09-18 — Skill stack index (11 new shared skills)

Sources: `.agents/skills/*/SKILL.md`, `.claude/skills/revtube-*/SKILL.md`, `frontend/package.json`, `frontend/vite.config.ts`.

## New (`.agents/skills/`, shared across agents)

| Skill | Covers | Pairs with (existing) |
|---|---|---|
| `youtube-analytics` | Data API v3 + Analytics API v2, OAuth tokens, quota, metrics/dimensions, tz, snapshots, errors | `revtube-backend`, `revtube-cache` |
| `react-typescript` | React 19 + TS 5.9 strict, components/hooks, Zustand/XState/Query split | `revtube-frontend-data` |
| `vite` | Vite 7.3.6 proxy/build/chunks, `VITE_*` envs, `perf:budget` | `performance` |
| `frontend-dashboard` | yafa-style analytics layouts, KPI/table/filter, shell reuse, states | `revtube-design`, `revtube-frontend-data` |
| `data-visualization` | ECharts 6 via `evilcharts/` wrappers, tooltips, retention, responsive | `frontend-dashboard`, `performance` |
| `api-design` | Envelopes, pagination/filtering, tz ranges, shared typing | `revtube-backend` |
| `postgres` | PG16 snapshots/aggregation/indexes, `NNN_*.sql` migrations | `revtube-backend` |
| `performance` | Tables/charts/render, code-split, ServerCache hot paths | `vite`, `data-visualization` |
| `playwright` | E2E: mocked OAuth, dashboard/filter/compare flows | `systematic-debugging` |
| `systematic-debugging` | Layer-by-layer protocol + RevTube failure map | all |
| `security-review` | OAuth tokens, authZ chain, org isolation, sensitive data | `revtube-backend` |

## Existing (do not duplicate)

- `.claude/skills/revtube-{orient,backend,cache,frontend-data,design,deploy,testing}` — source of truth for DI wiring, cache/quota, services-layer, tokens, envs, Vitest. New skills reference them instead of restating.
- `.agents/skills/{frontend-design,checklist-design}` — visual craft + QA checklists; `frontend-dashboard` handles analytics structure, these handle look/polish.

## Corrections applied during creation (DeepWiki vs local truth)

1. **Charts are ECharts, not Recharts.** `frontend/package.json` has `echarts@6.1.0`, no recharts; `src/components/evilcharts/` is the wrapper. Skill written accordingly.
2. **Vite 7.3.6 → `build.rollupOptions` is correct.** DeepWiki describes Rolldown (`rolldownOptions`) as the Vite 7 successor path, but the pinned `7.3.6` + `vite.config.ts:99` uses `rollupOptions.output.manualChunks` — do not migrate until the Vite upgrade.

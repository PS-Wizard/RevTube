# 2026-09-18 — Docs audit (stale candidates + verification)

Sources: `Get-ChildItem docs/*.md, fulldocs -Recurse` mtimes; DeepWiki `recharts/recharts`, `vitejs/vite`; `frontend/package.json`, `frontend/vite.config.ts`, `frontend/src/components/evilcharts/`.

## How to read this

- `docs/*.md` + `fulldocs/*` are **living references** — updated in place only for corrections.
- Dated findings live here in `docs/context/`. This file is the 2026-09-18 baseline; next audit adds a new dated file, never rewrites this one.

## Stale candidates (oldest first, verify before trusting)

| Last write | File(s) | Risk |
|---|---|---|
| 2026-06-24 | `fulldocs/02-Backend Service/02-Design System & UI Component Library.md`, `01-Getting Started & Environment Setup.md` | Setup/design-token drift (tokens now `--rt-*`, Stylelint enforced) |
| 2026-06-24/27 | `fulldocs/01-Project Overview/Project Overview.md`, `Analytics Dashboard.md`, `Content Discovery Pages.md`, channel/video browser docs | Pre-dates shell refactor (`DataExplorerShell`), org scoping |
| 2026-06-30–07-13 | Auth/OAuth flow, service layer, comparison tool, dashboard state, chart system, org/permission docs | Token sync (`syncOrgChannelTokens`), `resolveOrgToken` (7 routes), Query-hook patterns may be newer than text |
| 2026-07-13/15 | `Infrastructure & Deployment.md`, `01-Docker & Deployment Configuration.md`, `05-Dashboard UI Components.md` | Coolify/Traefik + PWA/workbox config drift |
| 2026-07-28 | `DESIGN_LANGUAGE.md`, `DRIZZLE_ORM.md`, `PROD_vs_LOCAL_Comparison.md`, `TEST_PLAN.md`, `USAGE_LIMIT_SYSTEM.md` | Large; quota/usage paths changed (miss-only increment) |
| 2026-08-04 | `UNDOCUMENTED_FINDINGS.md` (61k) | Audit notes partially fixed since (helmet, admin guards, in-flight timeout ✅; `USAGE_DEDUP_WINDOW_SEC` / `MAX_VIDEOS_PER_CHANNEL` still unwired) |

## Verified current (2026-09-18, do not "fix")

- `CACHING.md`, `03-PostgreSQL Ingestion & Read Models.md`, `02-Caching Architecture.md` (09-10) — match `ServerCache` + ingestion code.
- `CHAT.md` / `AI Chat System.md` (09-12), `CSS_TO_SHARED_COMPONENTS_MIGRATION.md` (09-17) — fresh.
- `docs/layout-guides/*` (09-07), `DATA_COVERAGE.md` (09-10) — fresh.

## DeepWiki cross-checks (2026-09-18)

- **Recharts Tooltip (recharts/recharts wiki):** `shared` axis-vs-item semantics, custom `content`, memoize/throttle for large series. **Applicability: reference only** — RevTube renders ECharts, not Recharts. Recharts 3.x Redux-tooltip internals do not transfer; the *pattern* (shared cross-series tooltip, stable refs, capped points) does and is already encoded in `data-visualization`.
- **Vite 7 proxy + chunking (vitejs/vite wiki):** `server.proxy` semantics confirmed (matches `vite.config.ts:87-94` incl. `VITE_DEV_API_PROXY_TARGET` override). Chunking: wiki describes `build.rolldownOptions.output.codeSplitting.groups` as successor — **not applicable** to pinned `vite@7.3.6`, which correctly uses `build.rollupOptions.output.manualChunks`. Revisit on Vite 8+ upgrade.

## Suggested next audits (new dated files)

1. `2026-0X — getting-started refresh` (re-verify env/proxy/pnpm pins against `example.env`).
2. `2026-0X — auth/org/token refresh` (Firestore paths + 7 `resolveOrgToken` routes).
3. `2026-0X — chart-system refresh` (`evilcharts/` API as the documented standard).

---
name: vite
description: Vite 7 config, env vars, dev/prod builds, proxy, chunking for RevTube frontend. Use when touching frontend/vite.config.*, .env, or build output.
---

# Vite (RevTube)

## Dev / prod facts

- Dev: `pnpm dev` in `frontend/` — Vite proxies `/api` → `http://127.0.0.1:3000` (IPv4 loopback, not `localhost`). If API calls fail locally, check the proxy target is up, not CORS.
- Build: `pnpm build` (`tsc -b && vite build`). Budget check: `pnpm perf:budget`.
- pnpm `10.33.2` pinned in both `package.json` files.

## Env vars

- Only `VITE_*` is client-exposed. Secrets stay server-side. Never read backend `.env`/`.env.prod` — reference `example.env` only (repo policy).
- Env resolution order: `.env.local` > `.env.{mode}` > `.env`. Document new vars in `example.env`.

## Build optimization

- `manualChunks`: vendor (react/react-dom), charts (recharts), state (zustand/xstate/tanstack). Route-level `React.lazy` for optimizer/audit pages — dashboard shell stays in the initial chunk.
- Analyze with `vite-bundle-visualizer` or `rollup-plugin-visualizer` before adding a dep. Charts + date libs are the usual bloat sources.
- Proxy + chunking regressions surface in `perf:budget` — run it before merging dep changes.

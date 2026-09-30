# 2026-09-27 — Audit pipeline: parallel fetch, staged progress, transactional persist

Sources: `backend/services/auditInputService.js` (+`.test.js`), `backend/services/auditOrchestratorService.js` (+`.test.js`), `backend/queue/auditOrchestratorQueue.js` (+`.test.mjs`), `backend/index.js`, `frontend/src/pages/audit-orchestrator/AuditPipelineCard.tsx`, `frontend/src/pages/audit-orchestrator/AuditOrchestratorPage.tsx` · verification: backend `vitest` 534/534 (56 files), frontend `vitest` 241/241, `tsc` clean, `eslint` clean on touched files

## Change

Reworked the Full Audit run from fetch-everything-then-score-then-persist into a
pipelined flow with incremental progress, parallel stages, and an atomic final
rollup — per the streaming design (fetch → calculate per stage → DB writes per
stage → overall aggregation last, transactions for ACID):

- **Fetch stage extracted** (`services/auditInputService.js`, was inline in
  `index.js:567-751`, same requests/shapes/fallbacks): channel meta + sections
  + videos + playlists now fetch **concurrently** (was four serial awaits);
  playlist→video membership is a **worker pool (4)** instead of a serial
  per-playlist loop, with claims merged in playlist order so "first playlist
  wins" stays deterministic; `scope === "channel"` skips playlists + membership
  entirely (that run never scores them — videos stay, cadence/niche need them).
  Each stage reports `onProgress`; every stage keeps its own try/catch fallback.
- **Calc starts on ready input + reports**: the 5 setup lookups (profile,
  params, availability, focus, criteria) run in one `Promise.all` (was serial);
  sub-audits report completion individually; the video `auditBatch` percent
  threads out through the existing (previously unwired) `onProgress` param.
- **DB writes per stage, ACID at the end**: engine histories persist
  concurrently (`Promise.all`); the final `persistRun` (run row + 4 sub-run
  rows) commits in **one Postgres transaction** (`BEGIN` … `COMMIT`, `ROLLBACK`
  on failure) via `withClient` — a crash can never leave a half-persisted run.
  The transaction wraps DB-only INSERTs (never network calls) and falls back
  to the old serial pool queries when no dedicated client is available.
  Transactions are short by construction; per-chunk incremental history writes
  stay single-statement atomic as before.
- **Progress users can see**: queue worker maps pipeline phases to a monotonic
  10→100 job percent (input stages 10-35, sub-audits 40-75, history 85-90,
  persist 90-96); the frontend `AuditPipelineCard` bar is now determinate with
  a percent label when the job reports progress (falls back to indeterminate).
- **Measurement**: `perfLog` spans (`audit:input`, `:channel/:videos/
  :playlists/:membership`, `:subaudits`, `:persist`, no-op unless `PERF_LOG=1`)
  so the next slow run attributes to fetch vs scoring vs persist.

## Also fixed (incidental)

- The full-run sub-audit fan-out double-wrapped `general` in `safeSub`
  (`safeSub("general", safeSub("general", …))`) — harmless (idempotent
  wrapper) but now single-wrapped with progress tracking like the rest.

## Verify

- `backend`: `vitest` **537/537 (56 files)** — new `auditInputService.test.js`
  (6: pool bounds, shapes, maxVideos passthrough, channel-scope skip,
  deterministic merge, progress + degradation), +3 orchestrator tests
  (tx commit order, rollback, progress phases), +4 queue mapper tests +3 queue
  processor tests (end-to-end through the BullMQ processor with fakes: scope +
  progress threading, monotonic percent to 100, missing-channelId rejection).
  Existing orchestrator suite untouched except the `gatherAuditInput` call
  assertion (now includes `scope` + `onProgress`).
- `frontend`: `vitest` **241/241** · `tsc` clean · `eslint` clean on the two
  touched files (4 `no-explicit-any` errors on the page are pre-existing,
  stash-verified).
- Behavior preserved: same YouTube requests/params, same result shapes, same
  error fallbacks, same quota cost (parallelism cuts time, not units).

## Follow-ups (not done)

- Window-aware fetch cap (`videoSelection` recent-N → `maxVideos`) to shrink
  huge-catalog runs — changes scoring semantics, needs a product call.
- Defer per-video suggestion/alternative LLM re-scoring to on-demand
  (biggest remaining LLM cost); RevSerp-engine replacement per earlier discussion.
- `audit-orchestrator` completion notifications (other audit queues notify;
  this one still requires an open tab).

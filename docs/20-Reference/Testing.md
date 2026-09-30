# RevTube Testing (Vitest)

Vitest is the standardized test runner for the whole monorepo. New and changed
code ships with tests. The security-critical core has retroactive coverage that
must stay green.

## Running

From each package directory:

```bash
cd backend && pnpm test    # CommonJS, no TS step (vitest run)
cd frontend && pnpm test   # TS/Vite, explicit vitest imports
```

Tests are colocated next to source and matched by each package's Vitest include
glob:

- Backend: `*.test.{js,mjs}` beside the module.
- Frontend: `src/**/*.test.{ts,tsx}` beside the module.

Vitest 4 requires ESM in test files, so backend tests are `.test.mjs` and use
`import`. Because the backend source is CommonJS, CJS modules are imported with a
default import then destructured:

```js
import ServerCache from "../cache/ServerCache.js";      // CJS default export
const { shortHash, OAUTH_TOKEN_CACHE_TTL_MS } = cacheScope;
import cacheScope from "../utils/cacheScope.js";
```

## Golden rules

- **No real services.** Pass plain DI fakes. Every backend module is a factory
  taking `deps`; inject `vi.fn()` for each dep. Tests must pass with no env file,
  no Redis, no Firestore, no network.
- **Guard env for `ServerCache`.** Its constructor reads `process.env.REDIS_URL`
  (triggers a real Redis connect) and `process.env.DISABLE_COMPRESSION`. In tests:
  `delete process.env.REDIS_URL` (and set `DISABLE_COMPRESSION=1` if you do not
  want compression) so the in-memory path is exercised.
- **Imports.** Backend: `import { describe, it, expect, vi } from "vitest"`.
  Frontend: `import { describe, it, expect, vi } from "vitest"` -- do NOT use
  Vitest globals, so `tsc -b` / `pnpm build` stays green.
- **Unit, not integration.** Test a module's logic with fakes; do not spin up
  Express/DB unless the module under test genuinely requires it.

## The critical gotcha: `vi.mock` cannot intercept CJS internals

Vitest 4 loads CommonJS source natively (externalized). That means a mock created
with `vi.mock("axios", ...)` or `vi.mock("firebase-admin", ...)` is **not** seen by
the module's internal `require("axios")` / `require("firebase-admin")` -- the real
package runs and the test hits real network/Firebase.

> **Correction.** This section previously also claimed `server.deps.inline` does not
> help. It **does**, for these two packages specifically, and the backend
> `vitest.config.js` relies on exactly that:
>
> ```js
> server: { deps: { inline: ["firebase-admin", "axios"] } }
> ```
>
> The config comment states the intent: "Inline these CJS deps so `vi.mock()`
> intercepts the source module's internal `require()` calls (org token + auth + token
> refresh paths)." The catch is that inlining is **opt-in per package**. Any other CJS
> dependency that reaches for a module the source `require`s internally still needs
> dependency injection, because nothing is inlined for it by default.

**The reliable fix, which works for every package, is dependency injection.** Auth
and org-token paths accept optional injected deps that default to the real `require`:

- `middleware/auth.js` -- `checkAdmin(getUserAccessByEmail, upsertUserAccess, firestoreDb)`
- `middleware/orgToken.js` -- `resolveOrgToken(getCachedOrgMembership, { db, axiosInstance })`
- `services/tokenService.js` -- `createTokenService({ ..., axios })`

When a test needs to fake an external package, add an optional injected param at
the factory boundary (backward compatible, no `index.js` change) and pass a plain
fake. See the tests below for the pattern.

## Current suite size

Measured on 2026-09-28 with `pnpm test` in each package. Both suites are green.

| Package | Test files | Tests |
|---|---|---|
| `backend` | 58 | 557 |
| `frontend` | 38 | 259 |

Re-measure rather than trusting these numbers; they drift with every change.

## The security-core suite (keep green)

Retroactive tests guarding the fragile, security-sensitive paths. New tests are
added here when these areas are touched:

| Test file | Covers |
|-----------|--------|
| `backend/utils/cacheScope.test.mjs` | Cache-key sanitization, org/user/pub scoping, cross-org isolation, TTL constants |
| `backend/cache/ServerCache.test.mjs` | In-memory set/get, TTL expiry, LRU eviction, delete/clear/deleteKeysContaining, gzip round-trip, metrics |
| `backend/middleware/configVersion.test.mjs` | Analytics-cache invalidation on config version bump |
| `backend/middleware/orgToken.test.mjs` | Org-token resolution, membership gating, refresh + fallback (injected `db`/`axiosInstance`) |
| `backend/services/quotaService.test.mjs` | Quota keys, pro-access resolution, read/increment/dedup |
| `backend/middleware/quota.test.mjs` | `requireQuota` 429, admin bypass, consume-on-hit, dedup |
| `backend/middleware/premiumAccess.test.mjs` | Free/pro/org gating |
| `backend/middleware/auth.test.mjs` | `authenticateRequest`, `checkAdmin`, `resolveUser` |
| `backend/services/tokenService.test.mjs` | Google token refresh success/failure (injected `axios`) |
| `frontend/src/stores/usageStore.test.ts` | Monotonic quota guard (counter never decreases) |
| `frontend/src/services/analyticsCache.test.ts` | Org-scoped cache key isolation, determinism |
| `frontend/src/utils/dashboardWorkspaceScope.test.ts` | Personal vs org workspace key scoping |

## Audit & scoring suite

Tests guarding the unified audit / scoring feature (deterministic engine,
Firestore-backed config, admin editor, and `/audit` route):

| Test file | Covers |
|-----------|--------|
| `backend/config/channelAuditScoring.test.mjs` | `DEFAULT_AUDIT_SCORING` maxes sum to 100, Firestore merge + fallback, category validity |
| `backend/config/featureConfig.test.mjs` | Feature config includes the `audit` page key |
| `backend/services/channelAuditScoringService.test.mjs` | `scoreVideo` / `scoreChannel` / `scorePlaylist` / `scoreAll` / thumbnail analysis scoring |
| `backend/routes/adminAuditCriteria.test.mjs` | Admin GET/PUT, sum-to-100 validation, configVersion bump |
| `backend/queue/auditOrchestratorQueue.test.mjs` | Audit processor: gathers input, scores, updates progress, rejects missing channelId |
| `backend/routes/auditOrchestrator.test.mjs` | POST `/audit` enqueues + channel ownership gating, GET `/audit/jobs/:id` polling |
| `frontend/src/utils/featureConfigSchema.test.ts` | Frontend schema validates the `audit` page key |

## Writing a test for a `create*Service` / `create*Middleware` factory

```js
// services/quotaService.test.mjs
import { describe, it, expect, vi } from "vitest";
import quotaService from "./quotaService.js";
const { createQuotaService } = quotaService;

function makeService() {
  const serverCache = { useRedis: false };
  const getFeatureConfig = vi.fn(async () => ({
    pages: { search: { freeLimit: 5, proLimit: 999, label: "Search" } },
  }));
  const getCachedOrgMembership = vi.fn(async () => false);
  const getCachedOrg = vi.fn(async () => null);
  return {
    service: createQuotaService({ serverCache, getFeatureConfig, getCachedOrgMembership, getCachedOrg }),
    fakes: { getFeatureConfig },
  };
}

describe("quotaService", () => {
  it("returns the free limit for a non-pro user", async () => {
    const { service } = makeService();
    const resolved = await service.resolvePageLimit("search", { uid: "u1", package: "free" }, { headers: {} });
    expect(resolved.limit).toBe(5);
    expect(resolved.isPro).toBe(false);
  });
});
```

Pure helper exports (e.g. `currentMonth`, `usageKey`, `sanitizeCacheSegment`,
`limitExceededPayload`) are tested directly without a factory.

## Frontend specifics

Frontend tests use explicit `import { ... } from "vitest"` (no globals) so the
`tsc -b` build is unaffected. Reset Zustand stores in `beforeEach`:

```ts
beforeEach(() => {
  useUsageStore.setState({ usage: {} });
});
```

Pass only type-valid values to typed functions (`buildCacheKey` accepts
`string | number | boolean | undefined`, not `null`).

## Don'ts

- Do not call `new Date()` / fake timers carelessly on TTL/dedup tests -- use
  Vitest's `vi.useFakeTimers()` + `vi.advanceTimersByTime()` when time matters and
  restore with `vi.useRealTimers()`.
- Do not assert on `console.*` noise; mock dependencies so the happy path avoids
  warning branches.
- Do not test implementation by reaching into `ServerCache` internals; use the
  public API (`set/get/delete/...`).
- Do not rely on `vi.mock()` for external CJS packages required internally -- inject
  fakes at the factory boundary instead (see the gotcha above).

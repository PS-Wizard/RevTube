# Testing (Vitest)

Relevant source files

- [Testing](../20-Reference/Testing) — canonical testing guide (run, conventions, security-core suite)
- [backend/vitest.config.js](../../backend/vitest.config.js)
- [frontend/vitest.config.ts](../../frontend/vitest.config.ts)
- [backend/cache/ServerCache.test.mjs](../../backend/cache/ServerCache.test.mjs)
- [backend/middleware/auth.test.mjs](../../backend/middleware/auth.test.mjs)
- [backend/middleware/orgToken.test.mjs](../../backend/middleware/orgToken.test.mjs)
- [backend/services/tokenService.test.mjs](../../backend/services/tokenService.test.mjs)
- [backend/config/auditScoring.test.mjs](../../backend/config/channelAuditScoring.test.mjs)
- [backend/config/featureConfig.test.mjs](../../backend/config/featureConfig.test.mjs)
- [backend/services/auditScoringService.test.mjs](../../backend/services/channelAuditScoringService.test.mjs)
- [backend/routes/adminAuditScoring.test.mjs](../../backend/routes/adminAuditCriteria.test.mjs)
- [backend/routes/audit.test.mjs](../../backend/routes/auditOrchestrator.test.mjs)
- [frontend/src/utils/featureConfigSchema.test.ts](../../frontend/src/utils/featureConfigSchema.test.ts)

RevTube standardizes on **Vitest** for unit testing across both packages. New and
changed code ships with tests, and the security-critical core has retroactive
coverage that must stay green.

## Running

From each package directory:

```bash
cd backend && pnpm test     # vitest run (CommonJS, no TS step)
cd frontend && pnpm test    # vitest run (TS/Vite)
```

Tests are colocated next to source and matched by each package's include glob:
backend `*.test.{js,mjs}`, frontend `src/**/*.test.{ts,tsx}`. Backend tests are
`.test.mjs` because Vitest 4 requires ESM in test files.

## Convention: inject fakes, no real services

Every backend module is a factory taking `deps`, so tests inject plain `vi.fn()`
fakes. Tests must pass with no env file, no Redis, no Firestore, no network. For
`ServerCache`, tests `delete process.env.REDIS_URL` to exercise the in-memory
path.

Frontend tests use explicit `import { describe, it, expect, vi } from "vitest"`
(no Vitest globals) so `tsc -b` / `pnpm build` stays green.

## The CJS `vi.mock` gotcha

Vitest 4 loads CommonJS source natively, so `vi.mock("axios")` /
`vi.mock("firebase-admin")` is NOT seen by a CJS module's internal `require()`;
`server.deps.inline` does not help. The reliable fix is **dependency injection**:
`middleware/auth.js` (`checkAdmin(..., firestoreDb)`), `middleware/orgToken.js`
(`resolveOrgToken(getCachedOrgMembership, { db, axiosInstance })`), and
`services/tokenService.js` (`createTokenService({ ..., axios })`) accept optional
injected deps that default to the real `require`. Pass fakes to test those paths.

## Security-core coverage

Retroactive tests guard the fragile paths: cache scoping (`cacheScope`), the
`ServerCache` in-memory store, config-version invalidation (`configVersion`),
org-token resolution (`orgToken`), quota accounting (`quotaService`, `quota`),
premium gating (`premiumAccess`), auth (`auth`), and Google token refresh
(`tokenService`). Frontend: the `usageStore` monotonic quota guard, `buildCacheKey`
org isolation, and `dashboardWorkspaceScope` personal/org keys.

See [Testing](../20-Reference/Testing) for the full suite table, factory-test
example, and don'ts.

## Audit & scoring suite

The unified audit / scoring feature ships with focused tests: `auditScoring` and
`featureConfig` (config), `auditScoringService` (the deterministic engine),
`adminAuditScoring` (admin editor + sum-to-100 validation + configVersion bump),
`auditQueue` (the BullMQ processor: gathers input, scores, updates progress) and
`audit` (POST /audit enqueues a job + channel ownership gating + GET /audit/jobs/:id
polling). Frontend coverage is `featureConfigSchema` validating the `audit` page key.

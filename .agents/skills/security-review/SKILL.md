---
name: security-review
description: Security review for RevTube — Google OAuth tokens, API authorization, sensitive analytics data. Use before shipping auth, token, org, admin, or quota changes.
---

# Security Review (RevTube)

## Checklist

- **Tokens**: YouTube access/refresh tokens live in Firestore (`users/{uid}/youtubeTokens`, org channel snapshots) — never in logs, URLs, PG, or client storage beyond memory. `X-Firebase-Token` verified via `firebase-admin` (`authenticateRequest`); YouTube bearer checked per-call.
- **Authorization**: routes chain `authenticateRequest → resolveUser → checkPremiumAccess + quota`; org endpoints add `resolveOrgToken`. AI optimizer routes enforce `validateVideos` ownership (non-admins: own channels only). Admin cron endpoints require `authenticateRequest + checkAdmin`.
- **Org isolation**: cache keys org/user-scoped (`dashboardScope`/`youtubeDataScope`); no personal↔org leakage. `X-Org-Id` must resolve before token use.
- **Transport/headers**: `helmet()` on (CSP disabled by design — note before tightening), rate limiters per tier (`middleware/rateLimiter.js`), monthly quotas via Firestore `config/features` (miss-path increment only).

## Sensitive data

Analytics (views, revenue-adjacent, retention, tokens) = sensitive. No analytics payloads in client logs, error messages, or Playwright snapshots. Firestore rules in `firestore.rules` + indexes in `firestore.indexes.json` ship with token/org changes.

---
name: playwright
description: Playwright regression tests for RevTube — OAuth flow, dashboard interactions, filters, charts. Use for E2E coverage of user-visible flows.
---

# Playwright (RevTube web testing)

## Scope

Cover: login → connect channel (mocked OAuth) → dashboard renders KPIs/charts → filters change data → compare/optimizer flows. Chart assertions = data-driven (legend/values present), not pixel diffs.

## OAuth in tests

Never hit real Google. Stub token endpoints + `youtubeTokens` fixtures; test the real callback handling (`OAuthCallback`, `consumePendingAuthorization`) and the revoked-token → re-auth CTA path.

## Conventions

- Tests live with the E2E suite (not colocated unit tests — those are Vitest per `revtube-testing`). Selectors: `data-testid` on KPI/filter/chart containers, not CSS classes or text that copy changes.
- Keep the suite small and deterministic: one spec per critical flow (auth, dashboard, filters, compare). Quarantine flaky chart-animation waits by disabling animation in test env (ECharts `animation: false` path in the evilcharts wrapper).

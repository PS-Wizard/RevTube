---
name: systematic-debugging
description: Structured debugging for RevTube — YouTube API failures, OAuth problems, data mismatches, frontend/backend bugs. Use when a fix isn't obvious or a first attempt failed.
---

# Systematic Debugging (RevTube)

## Protocol

1. Reproduce with the minimal path (one channel, one date range, one endpoint). Note perspective: cached vs live vs PG snapshot.
2. Localize the layer: shell/page → Query hook → service → `/api` route → middleware (auth/org/quota) → cache → PG → YouTube. Check each boundary's actual payload, not assumptions.
3. State one hypothesis + the cheapest disproof. Fix, then re-run the Vitest file for the touched module (`pnpm test` in the package).

## RevTube failure map

- **YouTube 401** → revoked refresh token (`users/.../youtubeTokens`) or stale org snapshot — re-auth, check `syncOrgChannelTokens`.
- **403 quotaExceeded** → live-call storm (Compare page, unwired `USAGE_DEDUP_WINDOW_SEC`) — confirm cache-miss path, serve snapshot.
- **Data mismatch** → tz bucketing, org/user cache-key leak, or JS zero-fill hiding nulls. Compare PG row → API payload → rendered value at each step.
- **Blank dashboard** → missing loading/empty/error branch or thrown raw `Response` escaping the service parser.
- **Local-only API failure** → Vite proxy target (`127.0.0.1:3000`) down, not app code.

Log channel/org/endpoint/quota-cost on live calls so the next debug starts with evidence.

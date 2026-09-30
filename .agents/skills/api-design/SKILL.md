---
name: api-design
description: RevTube frontend/backend contracts — REST envelopes, pagination, filtering, error handling, shared typing. Use when adding or changing any /api endpoint or frontend service.
---

# API Design (RevTube contracts)

## Envelope + errors

- Success: `{ success: true, data }`. Errors: project error helper (not raw 500) with `{ success: false, error: { code, message } }`. Frontend services parse once (`parseJsonFromText` + `parse*` pattern in `userService.ts`) and return typed values or `null`, never throw raw `Response`.
- Auth: `X-Firebase-Token` (Firebase ID token) + `Authorization: Bearer <YouTube OAuth>` for YouTube features. Org scoping via `X-Org-Id` header.

## Pagination / filtering / ranges

- Paginate list endpoints (`page/limit` or cursor; max 50 for YouTube-passthrough). Filters as query params (`channelId, startDate, endDate, dimension, sort`). Validate + clamp server-side; `MAX_VIDEOS_PER_CHANNEL` is declared-but-unwired — don't rely on it until wired.
- Date ranges require explicit timezone; echo it back so frontend tooltips match backend buckets.

## Typing

- Backend (JS, CommonJS): JSDoc + runtime validation at the boundary. Frontend (TS): types in `src/types/`, services own the fetch→type mapping. Keep the contract in one place per endpoint — a backend route + one frontend service function.
- Breaking changes: version the route or add fields; never rename in place without a migration note in `docs/context/`.

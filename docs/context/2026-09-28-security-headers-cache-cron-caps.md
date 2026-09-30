# Security headers, cache tuning and cron caps

Date: 2026-09-28

## Why

The source audit carried four open items that were cheap to close properly rather than
carry forward as caveats:

1. `helmet()` was applied with `contentSecurityPolicy: false`, so no CSP was enforced.
2. `ServerCache` was constructed with a 24h fallback TTL while the class default is 12h,
   so losing Redis could serve day-old data.
3. The scheduled channel caps were hardcoded at 50/100 in the `cron.schedule` callback.
4. `collectTokens()` returned channels in arbitrary Firestore order, so a capped run
   starved an arbitrary subset rather than the least-used ones.

Items 1-3 are pure hardening. Item 4 is the only behavioural change, and it only
reorders which channels are processed first.

## What changed

### Content-Security-Policy (new)

`backend/config/securityHeaders.js` -- a new module exporting `CSP_DIRECTIVES` and a
`securityHeaders()` factory. `backend/index.js` calls `helmet(securityHeaders())`.

The policy is strict because the backend is a JSON API and renders no user-facing HTML:

| Directive | Value | Reason |
|---|---|---|
| `default-src` | `'self'` | |
| `script-src` | `'self'` | No inline script, no `unsafe-eval`, no CDN. |
| `style-src` | `'self' 'unsafe-inline'` | The only relaxation. The Bull Board React runtime at `/admin/queues` injects inline styles. |
| `object-src` | `'none'` | Blocks plugins. |
| `frame-ancestors` | `'none'` | Blocks framing. |
| `base-uri` | `'self'` | Blocks base-tag hijacking. |
| `form-action` | `'self'` | Blocks form exfiltration. |
| `upgrade-insecure-requests` | `[]` (empty) | Emit with no host list so the header is identical on local http and production https. |

`crossOriginResourcePolicy` stays `cross-origin`, because the API is consumed from the
separate frontend origin. CSP -- not CORP -- is what restricts content.

### Cache tuning

`backend/index.js` now reads `CACHE_MAX_ENTRIES` (default `1000`) and
`CACHE_FALLBACK_TTL_HOURS` (default `12`, down from 24). The startup log reports the
resolved fallback TTL rather than a hardcoded string.

### Cron caps and ordering

`backend/cron.js`:

- `collectTokens()` dedupes by `channelId` keeping the most recently active token, and
  returns the map sorted most-recently-active first. The activity signal is the token
  document's `updatedAt`, normalised across Firestore `Timestamp`, `Date`, ISO string and
  epoch millis. Documents with no timestamp sort last but stay eligible.
- New env vars: `CRON_WARM_MAX_CHANNELS` (50), `CRON_INGEST_MAX_CHANNELS` (100),
  `CRON_INGEST_DAYS` (730), `CRON_STAGGER_MS` (500). A cap of `0` means no cap.
- The 500ms enqueue delay is now `staggerMs`, plumbed through both runners so it can be
  tuned alongside the caps.

The `slice(0, cap)` call in both runners is replaced by a shared `take(map, cap)` helper
that honours `0` as "unlimited".

### Files

- `backend/config/securityHeaders.js` (new)
- `backend/config/securityHeaders.test.mjs` (new, 6 tests)
- `backend/index.js` -- cache env wiring, `helmet(securityHeaders())`
- `backend/cron.js` -- token ordering, env caps, stagger
- `example.env` -- 6 new documented variables

## Tests

`backend/config/securityHeaders.test.mjs` boots a real Express app with the real helmet
options, issues one request, and asserts against the emitted header string -- so the test
verifies the policy that ships, not the config object. It asserts the header is present,
`script-src` excludes `'unsafe-inline'` and `'unsafe-eval'`, inline styles are allowed,
`object-src`/`frame-ancestors`/`base-uri`/`form-action` are locked down, and CORP stays
permissive.

Note: this is `.mjs`, not `.test.js`. Vitest 4 cannot be `require()`d from CommonJS --
`require('vitest')` fails with "Vitest cannot be imported in a CommonJS module using
require()". The existing backend `.test.mjs` files follow the same convention.

## Verify

- `cd backend && pnpm test` -- 59 files, 563 tests passing (was 58/557; +1 file, +6 tests).
- `cd frontend && pnpm test` -- 38 files, 259 tests passing, unaffected.
- `node --check backend/index.js` and `node --check backend/cron.js` both clean.

## Not changed (deliberate)

The JS zero-fill in `readModels.js` still cannot distinguish a true zero from a missing
row. It is load-bearing: the charting layer requires a dense daily series. Changing it
would ripple into every chart for no user-visible benefit. The `Source Audit Findings`
entry now explains the trade-off instead of reporting it as a defect.

## Docs updated

- `docs/20-Reference/Source Audit Findings.md` -- TTL entry marked resolved; gap-fill
  note reframed
- `docs/20-Reference/Environment Variables.md` -- new cache and scheduled-ingestion
  tables; added `MAX_VIDEOS_PER_CHANNEL`
- `docs/20-Reference/Test Plan.md` -- section 11.1 now asserts the enforced CSP
- `docs/02-Backend Service/01-API Endpoints & Middleware.md` -- app-shape line
- `docs/02-Backend Service/02-Caching Architecture (ServerCache & Redis).md` -- fallback
  description
- `docs/02-Backend Service/04-Scheduled Tasks & Cache Warming (cron.js).md` -- discovery
  ordering and a new "Scheduled caps" subsection
- `AGENTS.md` (gitignored, local) -- three items moved to Resolved

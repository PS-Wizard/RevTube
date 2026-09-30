# No hardcoded production host

Date: 2026-09-28

## Why

The production PWA origin `https://rev.sachinsubedi.com.np` was hardcoded in two
places in the backend, which tied the source to one specific deployment. A new
host, a preview deployment or a client handover would need a code edit, and the
domain leaked into docs as if it were part of the product.

## What changed

### Code -- both hosts now come from env only

- `backend/index.js` `parseAllowedOrigins()`: removed the prod origin from the
  built-in CORS `defaults`. The localhost/127.0.0.1 set is unchanged; every real
  origin already came from `FRONTEND_URL` / `VITE_FRONTEND_URL` /
  `SERVICE_URL_FRONTEND` / `CORS_ORIGINS`.
- `backend/routes/oauth.js` `redirectUriAllowed()`: removed
  `allow.push("https://rev.sachinsubedi.com.np/oauth-callback.html")`. The list
  is now built purely from `YOUTUBE_OAUTH_REDIRECT_URIS` plus the
  `VITE_FRONTEND_URL`-derived callback, with loopback still allowed for dev.

### New: malformed-redirect-URI warning

`redirectUriAllowed()` now warns when an allowlist entry has a doubled scheme
(`https://https://host`). Such an entry can never match, so it presents as the
backend rejecting its own callback with no obvious cause. A live `.env` was
found to contain exactly this shape (see below), so the warning is not
hypothetical.

### Tests

`backend/routes/oauth.redirectAllowlist.test.mjs` (new, 7 tests) drives the real
router over HTTP and asserts on the status code: loopback always allowed;
a host from `YOUTUBE_OAUTH_REDIRECT_URIS` allowed; a host implied by
`VITE_FRONTEND_URL` allowed including a trailing slash; unlisted hosts rejected
with 400; and a **regression guard** asserting that the previously hardcoded
domain is now rejected when not configured -- if a host is ever baked back into
the source, that test fails.

Note: the import is `import { createOAuthRouter } from './oauth.js'` -- the module
exports a named binding, not a default.

### Docs

- `example.env`: documented that no production host is hardcoded, that
  `YOUTUBE_OAUTH_REDIRECT_URIS` must match the Google Cloud OAuth client's
  registered URIs, and added a commented `CORS_ORIGINS` example.
- `docs/20-Reference/Environment Variables.md`: "Frontend URLs" section now
  states plainly that no production host is hardcoded, adds
  `YOUTUBE_OAUTH_REDIRECT_URIS` to the table, and documents the doubled-scheme
  warning.
- `docs/context/2026-09-22-auth-oauth-resume-ref-fix.md`: concrete domain
  replaced with `<your-frontend-origin>` so the runbook stays accurate, plus an
  Update section recording this change.

## Verify

- `cd backend && pnpm test` -- 60 files, 570 tests passing (was 59/563;
  +1 file, +7 tests).
- `cd frontend && pnpm test` -- 38 files, 259 tests passing, unchanged. A scan
  confirmed the frontend never hardcoded the domain.
- Repo-wide scan (excluding `node_modules`, `.git` and `.env`) returns no
  matches for the domain.

## Two issues found while doing this

1. **A live Google App Password was committed to `example.env`** (lines 64-65,
   in the Gmail SMTP example block), together with a real account address. The
   file is tracked by git and the credential is in history since commit
   `50ec14d`. Both lines were redacted to placeholders. **The App Password should
   be revoked in the Google account** -- redaction does not remove it from git
   history, and a compromised SMTP credential is enough to send mail as the
   account.
2. **A malformed value in the gitignored `.env`**:
   `YOUTUBE_OAUTH_REDIRECT_URIS` contains `https://https://rev.sachinsubedi.com.np/oauth-callback.html`
   -- a doubled scheme that can never match, so the callback for that host is
   currently rejected by the allowlist. Not edited, because the repo rule is to
   not touch `.env`; it needs the `https://` prefix removed. This is exactly the
   failure the new warning surfaces.

## Behaviour change

None for the current deployment. Its env already supplies `VITE_FRONTEND_URL`
and `YOUTUBE_OAUTH_REDIRECT_URIS`, and the deploy runbook in the 09-22 context
file already required them to be set. The only deployment affected is one that
was relying on the baked-in origin without configuring env -- which is precisely
the misconfiguration that runbook was written to correct.

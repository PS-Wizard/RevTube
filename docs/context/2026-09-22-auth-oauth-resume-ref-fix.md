# 2026-09-22 — AuthContext: fix render-time ref write (react-hooks compiler rule) + mobile PWA connect race

Sources: `frontend/src/contexts/AuthContext.tsx`, `frontend/eslint.config.js`, `frontend/src/components/charts/RtECharts.tsx` (precedent pattern), eslint + tsc runs.

## Change

`eslint-plugin-react-hooks` v6 `flat.recommended` (compiler-powered purity rules, wired in `frontend/eslint.config.js`) reported:

> Line 450: Cannot update ref during render

The PWA-resume "latest ref" pattern in `AuthProvider` mutated a ref during render:

```tsx
const applyOAuthResultRef = useRef(applyOAuthResult);
applyOAuthResultRef.current = applyOAuthResult; // ❌ render-time ref write
```

## Fix

- Moved the ref write into a `useEffect(..., [applyOAuthResult])` declared **before** the consumer effect, so the ref is always fresh when the OAuth-resume effect runs (same pattern already used in `RtECharts.tsx` `initRef`).
- Wrapped `applyOAuthResult` in `useCallback([user, setAccessToken])` (and memoized the trivial `setAccessToken` wrapper with `useCallback(..., [])`) to keep identities stable and satisfy `react-hooks/exhaustive-deps`. Behavior unchanged — both only close over `user` and stable state setters.

## Verify

- `eslint src/contexts/AuthContext.tsx` → 0 errors, 0 warnings (was 1 error + 1 warning).
- `tsc -b` → no errors in `AuthContext.tsx` (remaining project errors are pre-existing in `VideoDetailDialog.tsx` / `GoalDetailPage.tsx`, untouched).

## Update

- 2026-09-21: initial fix.
- 2026-09-22: mobile PWA YouTube-connect race — selecting a channel showed
  "no channel exists" without waiting. Two compounding causes, both fixed:

  Sources: `frontend/src/services/youtubeOAuth.ts`, `frontend/src/contexts/AuthContext.tsx`,
  `frontend/src/pages/DashboardPage.tsx`, `frontend/src/pages/OrganizationPage.tsx`,
  `frontend/src/services/youtubeOAuth.test.ts` (new).

  1. **Premature "no channel" error.** `getAllChannels()` did a single fetch to
     `GET /channels/mine?fresh=true` and returned `[]` for *every* failure mode
     (network timeout, HTTP 4xx/5xx, genuinely-empty account). Right after Google
     consent YouTube can briefly return an empty list (propagation lag), and mobile
     networks flake — so the app wrongly reported "account has no channel".
     Fix: retry with backoff (immediate + 1.2s + 3s), 15s per-attempt timeout, and a
     tri-state result — channel list / `[]` (confirmed empty, only after all attempts)
     / `null` (fetch failed: network error or non-retryable 4xx). Both `authorize()`
     and `consumePendingAuthorization()` now map `null` to a generic failure ("try
     again") and only `[]` to the "create a YouTube channel first" message.
  2. **Popup handoff loss in installed PWA.** Standalone display (`display-mode:
     standalone`, iOS `navigator.standalone`) was opened with `window.open`, whose
     postMessage/localStorage handoff back to the PWA is unreliable (iOS partitions
     PWA storage; the OS may suspend the PWA behind Google consent). Fix:
     `YouTubeOAuth.isStandalonePwa()` check + blocked/dead-popup detection now fall
     back to a full-page redirect (`window.location.assign`); `oauth-callback.html`
     persists the result and the existing `consumePendingAuthorization()` resume
     completes it on return.
  3. **Waiting state during resume.** New `isResumingOAuth` flag in `AuthContext`
     (true while the redirect result is being completed on load). `DashboardPage`
     and `OrganizationPage` treat it like `isConnectingChannel` (spinner, connect
     button disabled, no second flow started), so the UI waits instead of flashing
     the no-channel empty state.

## Verify (2026-09-22)

- `pnpm exec tsc -b` → no new errors (only pre-existing `VideoDetailDialog.tsx` /
  `GoalDetailPage.tsx` errors, untouched).
- `eslint` on `youtubeOAuth.ts`, `youtubeOAuth.test.ts`, `AuthContext.tsx`,
  `DashboardPage.tsx` → clean (`OrganizationPage.tsx` has 2 pre-existing
  `react-hooks` errors, verified identical on HEAD).
- `pnpm vitest run src/services/youtubeOAuth.test.ts` → 5 passed (immediate
  success, propagation-lag retry, network-failure → null, 401 → null no-retry,
  non-PWA detection).

## Follow-up fix (same day): redirect flow stranded on callback page

- Symptom after the above shipped: connect ended stuck on the static
  "you can close this window now" page; going back manually left the channel
  unconnected.
- Root cause: the new full-page redirect fallback navigates the app window
  itself to Google and back to `/oauth-callback.html`, but that static page
  never navigated back to the app (it only tried `window.close()`, a no-op for
  non-popup windows) — and the resume effect in `AuthContext` never ran because
  the React app wasn't loaded.
- Fix (`frontend/public/oauth-callback.html`, `youtubeOAuth.ts` `beginFlow`):
  `beginFlow()` now stores `returnUrl` (page where connect started) on the
  pending flow; the callback page calls `returnToAppIfMainWindow()` — when
  `window.opener` is absent (i.e. this tab IS the app after a redirect) it
  shows "Returning to the app…" and `location.replace(returnUrl)` after 800ms
  so the app reloads and the resume effect completes the connection. Real
  popups (opener present) keep the close behavior; `returnUrl` is
  same-origin-validated (`/`-prefixed) against open-redirect.
- Verify: `node --check` on the extracted callback script → OK; `tsc -b` →
  no errors in touched files; `vitest` youtubeOAuth suite → 5 passed;
  `eslint youtubeOAuth.ts` → clean.

## Root cause found in backend logs: redirectUri allowlist (deploy config)

- Symptom after auto-redirect worked: still not connecting. Backend log:
  `[OAuth Exchange] Rejected redirectUri outside allowlist:
  <production frontend origin>/oauth-callback.html` → `POST
  /api/oauth/exchange 400`.
- `backend/routes/oauth.js` `redirectUriAllowed()` only forwards allow-listed
  URIs (loopback + `YOUTUBE_OAUTH_REDIRECT_URIS` + `VITE_FRONTEND_URL` +
  `/oauth-callback.html`). The deployed backend's env did not include the PWA
  domain, so every exchange from that origin failed — this affected popup and
  redirect flows equally on that host.
- **Deploy fix (Coolify, backend service env, then redeploy/restart):** add
  `YOUTUBE_OAUTH_REDIRECT_URIS=<your-frontend-origin>/oauth-callback.html`
  (comma-separated if more hosts) — or set `VITE_FRONTEND_URL` to that origin.
  Also register the same URI under Authorized redirect URIs on the Google Cloud
  OAuth client, or Google's token endpoint will reject with
  `redirect_uri_mismatch` after the allowlist passes. (The `ytReport` bundle
  400s in the same log are unrelated noise — unsupported Analytics queries for
  that channel.)
- **Code change so this is diagnosable:** `YouTubeOAuth.lastError` now captures
  the failure reason — exchange rejections surface the backend's message
  (e.g. "redirectUri not allowed"), channel-list failures a retry message.
  `loginWithYouTube()` and the resume effect use it for `authError` instead of
  the generic "authorization failed". Added a 6th unit test (400 +
  `redirectUri not allowed` body → null + `lastError` contains the reason).

## Allowlist entry was attempted but broken + uncommitted (same day)

- `grep` showed the prod PWA URL had been added to `backend/routes/oauth.js`
  and `backend/index.js` (CORS), but both are **uncommitted working-tree
  edits**, so Coolify (auto-deploys from `dev`/`prod`) never got them.
- Worse, the oauth.js edit was buggy string concatenation:
  `process.env.YOUTUBE_OAUTH_REDIRECT_URIS + "https://..."` yields
  `"undefinedhttps://..."` (env unset) or a comma-less merge (env set) — never
  matches. Fixed to parse the env properly and `push()` the prod PWA URI as
  its own entry (same precedent as the hardcoded CORS origin in `index.js`).
- Verify: mounted the real router with stub deps and POSTed the exact prod
  redirectUri — log shows `Exchanging code for tokens...` (passes allowlist),
  previously `Rejected redirectUri outside allowlist`.
- **Still required to ship:** commit + push to `dev` (or `prod`) so Coolify
  redeploys; and register the URI on the Google Cloud OAuth client.

## Connect follow-ups: branded callback page + token merge (same day)

- **Branded `oauth-callback.html`.** Static page restyled: dark app theme,
  `TubeKeter Analytics` brand header with `/logo.png` (hidden on error),
  status pills (green check / red error / CSS spinner while connecting),
  responsive card. `showStatus()` builds the same brand header via
  `textContent` (XSS-safe). No logic changes — verified with `node --check`.
- **New channel wiped the existing one (needed full refresh for 2 channels).**
  Root cause: `applyOAuthResult()` did `setAllTokens([...newTokens])` — a
  replace. With channel A connected, adding B set `allTokens=[B]`; the personal
  channels query (keyed off `allTokens`) returned only B, the store sync
  overwrote, and selection reset ("switch"). Full reload re-read Firestore
  (per-channel docs, always correct) → both appeared. Fix: functional merge by
  `channelId` (update in place, else append).
- Verify: `tsc -b` / `eslint AuthContext` clean.

## Update (2026-09-28) -- no hardcoded production host

- The production domain is no longer hardcoded in the source. ackend/index.js
  no longer adds the prod origin to the CORS defaults, and
  ackend/routes/oauth.js no longer pushes a hardcoded callback URI into the
  redirect allowlist.
- Both now read only from env: `VITE_FRONTEND_URL` / `FRONTEND_URL` /
  `SERVICE_URL_FRONTEND` / `CORS_ORIGINS` for origins, and
  `YOUTUBE_OAUTH_REDIRECT_URIS` / `VITE_FRONTEND_URL` for callbacks.
- The deployed env already supplies `VITE_FRONTEND_URL` and
  `YOUTUBE_OAUTH_REDIRECT_URIS`, so removing the hardcoded host is a no-op for
  the current deployment. The only behavioural change is for a deployment that
  relied on the baked-in origin without setting env -- which is exactly the case
  the deploy fix above already required.
- This file's concrete domain references were replaced with
  `<your-frontend-origin>` so the log stays accurate as a runbook.

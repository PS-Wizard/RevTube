# 2026-09-21 — Playlist catalog pagination (video parity, DB-backed)

Sources: `backend/services/channelPlaylistsService.js`, `backend/routes/dashboard.js` (POST /dashboard/playlists),
`backend/routes/playlists.js` (GET /playlists/:channelId), `backend/index.js` (service wiring),
`frontend/src/services/youtubeService.ts`, `frontend/src/hooks/queries/usePlaylistsQuery.ts`,
`frontend/src/components/dashboard/PlaylistTable.tsx`, `frontend/src/pages/DashboardPage.tsx`,
`frontend/src/pages/PlaylistPage.tsx`.

## Problem

Dashboard Playlist Performance showed "34 of 76 playlists" and stopped: playlists were single-shot
fetched (plain `useQuery`, cap coupled to the video toolbar limit, default 25) with client-only paging,
while videos use `useInfiniteQuery` (20/page) with Next-fetching-more. Filtering + silent partial page
failures widened the loaded-vs-truth gap, and "select all" covered only loaded rows.

## Change

Playlists now paginate exactly like videos, reading the ingestion-warmed Postgres catalog:

- New `generateChannelPlaylists` service: L1 `serverCache` (one full-catalog key per
  scope+channel+privacy) → L2 `loadPlaylistsFromPostgres` (freshness via `getPlaylistsSyncedAt` +
  `isPlaylistDataStale`, stale rows kept for degrade) → L3 live YouTube loop (cap 500, owner-only
  rows merged ONCE via `mergeOwnedHiddenPlaylists`). Returns YouTube-shaped `{ items, catalogTotal }`.
  Quota is marked billable only on L3 hits (read-on-miss rule).
- `POST /dashboard/playlists` accepts `page/perPage` (legacy `offset/maxResults` mapped) and returns
  `{ playlists, items, catalogTotal, pagination: { totaldata, currentpage, perpageitem, totalpages, hasMore } }`.
  Legacy `pageToken`-only callers still get one live page (rollout compat).
- `GET /playlists/:channelId` accepts `?page=&perPage=` from the same service (legacy token mode unchanged).
- Frontend: `fetchDashboardChannelPlaylists` / new `fetchChannelPlaylistPage` fetch ONE page each
  (shared `parsePlaylistPageResponse`, shared `mapPlaylistItem`, per-page client cache);
  `usePlaylistsQuery` is `useInfiniteQuery` (PAGE_SIZE 20, no fetch cap);
  `PlaylistTable` gained `hasMoreBackend/onLoadMoreBackend/isLoadingMoreBackend/totalBackendCount`
  (Next/Last backend advance, page-size auto-fill, "All" sentinel, "more in catalog" hints, split subtitle);
  Dashboard select-all drains all pages then selects the full set; explorer channel-browse pages
  20/request with cap-aware `goToChannelPage` and drain-on-non-newest-sort.

## Verify

- `pnpm vitest run services/channelPlaylistsService.test.js` (backend): 9 passed — L1/L2/L3 tiers,
  privacy key scoping, hidden merge + catalogTotal, stale degrade, 404-empty, youtube-only skip.
- Rewrote `youtubeService.playlists.test.ts`: 7 passed — page/perPage body, envelope parse, offset
  advance, client-cache hit, legacy fallback, catalogTotal preference, quota surfacing.
- Full suites: frontend 25 files / 148 tests pass; backend 441/442 (1 pre-existing failure in
  `orgAnalyticsService.test.mjs`, fails on clean tree too).
- `tsc -b`: only pre-existing errors in untouched files (`VideoDetailDialog`, `GoalDetailPage`).
- ESLint on touched files: 0 errors (2 pre-existing warnings in PlaylistTable).

## Update — total overcount ("3 playlists but shows out of 4") + graphs ignoring selection/filters

Sources (add): `frontend/src/utils/graphScope.ts`, `frontend/src/hooks/queries/useAnalyticsQuery.ts`
(`buildVideoFilters`/queryKey/prefetch/empty-scope short-circuit), DashboardPage graph memos + overlay
intersect, `usePlaylistsQuery` exhausted-clamp, `PlaylistPage` effective-total clamp.

Total fix (4 layers, stale `pageInfo.totalResults` can no longer inflate): L3 service reports the
enumerated set size when fully looped (estimate kept only when the page cap truncates); legacy
single-page route clamps `catalogTotal` to rows when no `nextPageToken`; `usePlaylistsQuery` clamps
to enumerated rows once `hasNextPage === false`; explorer clamps once `!hasMore`.

Graph fix (legacy `useDashboardAnalytics` parity the RQ migration dropped): new `graphScope` utils —
`resolveGraphPlaylistIds` (checked ∩ visible rows, so status/activity changes refetch) and
`resolveGraphVideoIds` (opened video → row checks → narrowing toolbar filters expanded via
`getVideosByActiveFilters` → channel-wide). `useAnalyticsQuery` consumes the scoped sets in filter +
queryKey; empty playlist scope short-circuits to an empty bundle without fetching (no quota burn);
prefetch keys realigned; multi-list overlay intersects each saved list with the scoped set and
refetches on scope change. Channel tab stays channel-wide by design.

Verify: backend 443 passed / 1 pre-existing failure (`orgAnalyticsService`, fails on clean tree);
frontend 26 files / 157 tests pass (incl. 9 new `graphScope`); `tsc`/`eslint` show only pre-existing
issues in untouched files.

## Update 2 — "All (incl. private & unlisted)" never finishes loading

Sources (add): `backend/utils/pagination.js` (+ test), `routes/dashboard.js` + `routes/playlists.js`
(sliced via helper), `services/channelPlaylistsService.js` (no 404-empty L1 write, `v2` cache key),
`youtubeService.resolveNextOffsetParam` (+ test), `usePlaylistsQuery`/`useVideosQuery` next-page,
`PlaylistTable`/`VideoTable` auto-fill brake.

Root cause (two definite stuck-loading defects in this path): when a stale-high backend total
outruns the rows that exist (deleted/privatized playlists still counted upstream), (a) the backend
reported `hasMore=true` for phantom pages and (b) the client offset advanced by loaded rows, so an
empty page refetched the SAME offset forever -- the "All" drain / Next spun without ever completing.
Separately, a transient 404 once cached `{items: [], catalogTotal: 0}` in L1 for 2h, masking the
channel with no recovery except TTL expiry (privacy-keyed, so Public kept working while All stayed
empty).

Fix: shared `paginateCatalog` helper -- a short slice IS exhaustion (`hasMore` false even when the
total claims more), used by all three paged routes; `resolveNextOffsetParam` stops on empty pages
(both hooks; videos keeps its `maxItems` cap); 404-empty is served but never cached; L1 key bumped
to `channel_playlists:v2:` to flush pre-fix entries on deploy; auto-fill capped at 25 backend pages
(manual Next/Retry unaffected).

Verify: backend 447 passed / same 1 pre-existing failure (incl. 4 new `paginateCatalog` tests);
frontend 27 files / 160 tests pass (incl. 3 new offset tests); `tsc`/`eslint` unchanged
(pre-existing only).

## Update 3 -- empty table on "All (incl. private & unlisted)", Public works, no console error

Symptoms isolate it to the fresh `includePrivate` request (Public is served from layered caches
while the new privacy key goes live): either the live request errors (silently swallowed by the
old empty-state copy) or a poisoned/zero backend tier answers. Changes:

- `PlaylistTable` takes `loadError` and renders it: failure now reads "Couldn't Load Playlists"
  + the real message with Reload, instead of the misleading "No playlists loaded..." copy (which
  also wrongly referenced a removed video-limit setting). DashboardPage wires `query.error` through.
- `usePlaylistsQuery` flatten dedupes by id (mixed-version/stale backends repeating rows across
  pages can no longer inflate table, counts, or selection).

Next step is deployment-driven: the box title/message names the cause (quota/token/network error
vs genuine zero rows). Verify: frontend 160/160, `tsc`/eslint pre-existing only.

## Update 4 -- all-public channel: All-filter must never show less than Public

New fact: the channel holds only public playlists, so both filters must agree. Root problem: the
fresh private-inclusive request could fail (or answer empty) while Public coasted on layered
caches, and the UI swallowed the difference into one empty state. Changes (frontend only):

- `fetchDashboardChannelPlaylists`: private-inclusive page empty (first page) or failed falls back
  to the public page, tagged `partial: true` + `partialError` (never client-cached, so the next
  mount retries the inclusive leg; quota exhaustion skips the retry and surfaces immediately;
  both-empty resolves empty; both-failed throws the original error).
- `usePlaylistsQuery`: `placeholderData: keepPreviousData` (filter switches no longer blank a
  working table) + exposes `partialError`.
- `PlaylistTable`: `partialNotice` warning badge ("Showing public playlists only -- <reason>") and
  `loadError` banner also render above a non-empty table, so stale/partial rows never mislead silently.
- `usePlaylistsQuery` flatten dedupes by id (stale/mixed backends repeating rows can't inflate rows/counts/selection).

Verify: frontend 165/165 (incl. 5 new fallback tests); `tsc`/eslint pre-existing only.

## Update 5 -- warning removed: silent substitution on empty-answer, badge only on real failure

User report: "Showing public playlists only -- private-inclusive catalog came back empty" nagged
on an all-public channel where the fallback set IS the whole catalog. Root trigger: pre-fallback
builds cached successful-but-empty inclusive pages (client cache), so every load hit the poisoned
entry and warned. Changes (frontend only):

- Client dashboard-playlists cache key bumped to `yt:dashboard:playlists:v2:...` (drops poisoned
  entries instantly; old ones expire naturally).
- Empty-answer substitution is now silent (`partial: true`, no `partialError`, console.info only):
  an answered-empty leg is always bogus upstream state, never proof of missing rows.
- The ⚠ badge now fires only when the inclusive leg actually errored (quota/token/network reason
  shown); both-empty resolves empty; both-failed throws the original error; quota skips the retry.
- Hook surfaces `partialError` only when a message exists.

Verify: frontend 165/165 (empty-fallback asserts no `partialError`); `tsc`/eslint pre-existing only.

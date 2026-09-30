## Notification System

RevTube notifies a user when a channel audit, video audit, thumbnail analysis, or
playlist analysis completes. This document covers the full architecture: the three
delivery channels, the ServerCache-backed store, the BullMQ completion hook, and
every source file involved. For the short version and the test list, see
[Notification System](../13-Notification System/02-Notification Reference).

### Delivery channels (chosen automatically)

| Channel | Trigger | Code |
|---|---|---|
| In-app bell + dropdown | User is signed in and browsing the app | `NotificationBell` polls `GET /notifications` every 30s |
| Email | Always, alongside the in-app one | `sendAuditCompleteEmail` on the BullMQ `email` queue |
| OS-level notification | App is open but backgrounded (`document.hidden`) and the user granted OS permission | Web Notifications API via `showNativeNotification` |

All three are fired from the **same** server-side completion event, so one audit
produces exactly one in-app notification, one email, and (only if away + permitted)
one OS toast. There is no Firestore `notifications` collection -- the in-app store is
`ServerCache` to minimize quota.

### Why audits survive navigation / tab close

Audits are server-side BullMQ jobs (`audit`, `videoAudit`, and shared `optimizer`
queues). The browser losing focus, navigating, or closing never stops the job; it
only drops the local `jobId` React state, which made it look cancelled.
`frontend/src/hooks/useSessionJobId.ts` persists `jobId` in `sessionStorage` (key
`rt:jobId:${scope}:org:${orgId}`), restoring it on mount to resume polling. The
thumbnail/playlist optimizer pages additionally mount `useOptimizerJobWatcher` in
`Layout`, which polls leftover optimizer jobIds every 5s even when the user never
returns to the page, and clears the sessionStorage key once the job completes or
fails. See [Video Audit](../12-Video Audit/02-Video Audit Reference),
[Full Audit Orchestrator](../16-Full Audit Orchestrator/Full Audit Orchestrator), and
[Thumbnail Optimizer Reference](../10-Thumbnail Optimizer/02-Thumbnail Optimizer Reference).

### Data model

```ts
interface NotificationItem {
  id: string;        // crypto.randomUUID()
  type: 'auditComplete' | 'videoAuditComplete' | 'thumbnailAuditComplete' | 'playlistAuditComplete';
  title: string;
  body: string;
  link: string;      // '/audit', '/video-audit', '/thumbnail-optimizer', or '/playlist-optimizer'
  read: boolean;
  createdAt: string; // ISO
  userId: string;    // recipient email (cache key)
}
```

Cache key `notif:${email}`, capped to the last **50** items, 30-day TTL. Each write
is read-modify-write through `ServerCache` (`get` -> mutate -> `set(key, arr, TTL)`).
`ServerCache.setIfAbsent(key, value, ttlMs)` (added for this feature;
`backend/cache/ServerCache.js:268`) performs an atomic `SET ... NX EX` on Redis, or an
in-memory check-then-set fallback.

### Backend

#### Store -- `backend/services/notificationService.js`

`createNotificationService({ serverCache })`. Methods: `createNotification`
(prepend + `slice(0,50)`), `getNotifications` -> `{ items, unreadCount }`,
`markRead(userId, id)`, `markAllRead(userId)`. All four read, mutate, and `set` the
per-user array. `id` comes from `crypto.randomUUID()` (matches repo id style in
`chat/ConversationMemory.js`).

#### Route -- `backend/routes/notification.js`

`createNotificationRouter(deps)` with `deps = { resolveUser, handleApiError, notificationService }`
(same DI shape as `routes/audit.js`). Routes, all guarded by `resolveUser`:

- `GET /` -> `getNotifications(req.authUser.email)`
- `PATCH /:id/read` -> `markRead(email, params.id)`
- `PATCH /read-all` -> `markAllRead(email)`

Wrapped in `try/catch (e) { handleApiError(e, res); }`. Mounted in
`backend/index.js` at line 721: `apiRouter.use("/notifications", notificationRouter);`.

#### Completion hook -- `backend/queue/index.js`

`setupWorkerEvents(worker, label)` registers `worker.on('completed', job => ...)`.
For the `audit` and `video-audit` workers the handler calls:

```js
handleAuditCompleted(
  { notificationService: deps.notificationService, emailQueue, serverCache: deps.serverCache },
  { label, job },
);
```

The `optimizer` worker (shared by thumbnail + playlist kinds) cannot use a fixed
label, so it derives one per job from `job.data.kind` before calling the same
handler:

```js
optimizerWorker.on('completed', (job) => {
  const kind = job.data?.kind;
  const label = kind === 'thumbnail' ? 'thumbnail-optimizer' : kind === 'playlist' ? 'playlist-optimizer' : 'optimizer';
  handleAuditCompleted(
    { notificationService: deps.notificationService, emailQueue, serverCache: deps.serverCache },
    { label, job },
  );
});
```

`handleAuditCompleted({ notificationService, emailQueue, serverCache }, { label, job })`
(`backend/queue/index.js:34`):

1. Returns early unless `label` is `'audit'`, `'video-audit'`,
   `'thumbnail-optimizer'`, or `'playlist-optimizer'`.
2. **Idempotency lock** -- the `completed` event is *global* across every worker/pod
   on the queue, so without a lock each replica (Coolify dev runs multiple; a
   lingering `node --watch` worker counts too) would duplicate the side effects.
   It acquires `serverCache.setIfAbsent('notif:lock:${jobId}', true, 7*24*60*60*1000)`
   and returns early if it didn't win. Absent `serverCache` is treated as "won" so the
   notification still fires.
3. Reads `email = job.data.email`; returns early if missing.
4. Derives `score = rv.overall ?? rv.score ?? null` and `channelName` from
   `rv.input?.channel?.name ?? rv.channelName ?? job.data.channelId`, unwrapping a
   health-wrapped `{ value, health }` channel name to `.value` so the body never
   serializes as `[object Object]`.
5. Creates the in-app notification and enqueues `sendAuditCompleteEmail` with
   `{ toEmail, channelName, score, auditType }`. The notification `type` + link are
   derived from the label: `videoAuditComplete`/`/video-audit` for `video-audit`,
   `thumbnailAuditComplete`/`/thumbnail-optimizer` for `thumbnail-optimizer`,
   `playlistAuditComplete`/`/playlist-optimizer` for `playlist-optimizer`, else
   `auditComplete`/`/audit`.
6. The whole block is inside `try/catch` -- a notification/email failure never fails
   the audit job or blocks the worker.

It is exported (`module.exports = { createQueueService, handleAuditCompleted }`) so it
can be unit-tested without BullMQ.

#### Email -- `backend/emailService.js` + `backend/queue/emailQueue.js`

- `emailService.sendAuditCompleteEmail(toEmail, { channelName, score, auditType })`
  (line 182) reuses `createTransporter()` and the inline-HTML card pattern. `link` is
  built from `FRONTEND_URL` (line 32) and `auditType`: `video` → `/video-audit`,
  `thumbnail` → `/thumbnail-optimizer`, `playlist` → `/playlist-optimizer`, else
  `/audit`. A `title` var names each feature ("Video Audit", "Thumbnail Optimizer",
  "Playlist Optimizer", "Channel Audit") and for thumbnail/playlist the score line
  reads "See your results inside." (no single overall score to show). Exported at
  line 230.
- `emailQueue.js` destructures `sendAuditCompleteEmail` from `deps` (line 11) and adds
  a `case 'sendAuditCompleteEmail'` (line 49) that validates `toEmail`, calls the
  sender, `job.updateProgress(100)`, and returns the result.

#### Wiring -- `backend/index.js`

- Line 115 / 153 / 155: imports `sendAuditCompleteEmail`, `createNotificationRouter`,
  `createNotificationService`.
- Line 253: `sendAuditCompleteEmail` added to `sharedDeps`.
- Line 411: `const notificationService = createNotificationService({ serverCache });`
  declared *before* `serviceDeps` (moving it above fixed a boot-time TDZ
  `ReferenceError: Cannot access 'notificationService' before initialization`).
- Line 422: `notificationService` included in `serviceDeps`.
- Line 503: `const notificationRouter = createNotificationRouter(routeDeps);`.
- Line 721: `apiRouter.use("/notifications", notificationRouter);`.

#### Recipient identity at enqueue

Because completion has no `req`, the recipient is attached to the job payload at
enqueue:

- `backend/routes/videoAudit.js:33-40`: `{ channelId, videoIds, authHeader, uid, email: req.authUser?.email, orgId: req.headers["x-org-id"] || null }`.
- `backend/routes/auditOrchestrator.js:27-33`: same shape with `channelId` only.

### Frontend

| File | Responsibility |
|---|---|
| `src/types/notification.ts` | `NotificationItem`, `NotificationType`, `GetNotificationsResponse`. |
| `src/services/notificationService.ts` | `getNotifications`, `markRead(id)`, `markAllRead()` -- mirror `auditService` (apiUrl + Firebase auth header + optional X-Org-Id). |
| `src/stores/notificationStore.ts` | Zustand store: `items`, `unreadCount`, `setNotifications`, `markOneRead`, `markAllReadLocal`, `reset`. Optimistic flips recompute `unreadCount`. |
| `src/hooks/queries/useNotifications.ts` | `useQuery({ queryKey: ['notifications'], queryFn: getNotifications, refetchInterval: 30_000, refetchIntervalInBackground: true })`. Background polling keeps OS notifications firing while the tab is hidden. |
| `src/components/NotificationBell.tsx` | Bell + unread badge, dropdown list, click -> mark read + navigate, "mark all read", new-arrival toast + OS notify when `document.hidden`. |
| `src/services/nativeNotify.ts` | Web Notifications API helpers: `getNotificationPermission`, `requestNotificationPermission`, `showNativeNotification`. |
| `src/hooks/useSessionJobId.ts` | Persists in-flight `jobId` in `sessionStorage` so audits survive navigation/tab-close. |
| `src/hooks/useOptimizerJobWatcher.ts` | App-level poller mounted in `Layout` -- reads leftover `rt:jobId:thumbnail-optimizer[:org:{orgId}]` / `rt:jobId:playlist-optimizer[:org:{orgId}]` keys, polls every 5s, clears the key on completed/failed. Only handles cleanup; the NotificationBell owns the arrival toast/OS notify. |
| `src/App.tsx` | Calls `requestNotificationPermission()` once at mount (prompts only when `'default'`). |
| `src/pages/VideoAuditPage.tsx` | Uses `useSessionJobId("video-audit", orgId)`; on completion invalidates `['notifications']`. |
| `src/pages/AuditPage.tsx` | Uses `useSessionJobId("audit", orgId)`; on completion invalidates `['notifications']`. |
| `src/pages/ThumbnailOptimizerPage.tsx` | Uses `useSessionJobId("thumbnail-optimizer", orgId)`; polls `GET /jobs/:id`, renders result on completion, clears jobId. |
| `src/pages/PlaylistOptimizerPage.tsx` | Uses `useSessionJobId("playlist-optimizer", orgId)`; polls `GET /jobs/:id`, renders result on completion, clears jobId. |

#### Toast / OS-notify dedup rules (why earlier bugs happened)

- The bell's arrival toast fires only for items that arrive **after** first hydration,
  tracked by a `seen` ref seeded with all existing ids on mount. Historical unread
  items therefore never re-toast (this was the "toast flood" bug).
- The page-level toasts were **removed**; the bell owns the single arrival toast, so
  one audit yields one toast, not two.
- The OS notification fires only when `document.hidden` (user is away but app open) and
  permission is granted.

### Tests

- `backend/services/notificationService.test.mjs` -- prepend/cap/unreadCount/markRead/markAllRead (fake `serverCache` Map).
- `backend/queue/auditCompleted.test.mjs` -- `handleAuditCompleted` fires for all four labels (`video-audit`, `audit`, `thumbnail-optimizer`, `playlist-optimizer`), skips when `email` absent, unwraps health-wrapped channel name, creates notification + email exactly once across 3 fires (idempotency lock).
- `backend/cache/ServerCache.test.mjs` -- `setIfAbsent` true on first call, false + no overwrite on second.
- `frontend/src/services/nativeNotify.test.ts` -- permission states + native notify (jsdom).
- `frontend/src/hooks/useSessionJobId.test.ts` -- restore / persist / clear / org-scoped key (jsdom).
- `frontend/src/hooks/queries/useNotifications.ts` + `frontend/src/stores/notificationStore.ts` -- the store's optimistic read flip and unread-count logic are **not covered by a test**. `notificationStore.test.ts` and `notificationService.test.ts` are referenced in older notes but do not exist in the tree, so this is a known coverage gap rather than a passing suite.

> Note: frontend test files for this feature require a jsdom environment
> (`// @vitest-environment jsdom`) and `jsdom` is a devDependency. `eslint.config.js`
> switches off `react-hooks/immutability` and `react-hooks/globals` for
> `**/*.test.{ts,tsx}` so render-time capture in hook tests is allowed.

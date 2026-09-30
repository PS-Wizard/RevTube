# Notification System

RevTube notifies a user when an audit (channel, video, thumbnail, or playlist)
finishes. Completion is signalled through three channels, chosen automatically by
where the user is at the moment the job completes on the server:

| Channel | When | Implemented by |
|---|---|---|
| In-app bell + dropdown | User is on the site and signed in | `NotificationBell` polls `GET /notifications` |
| Email | Always (sent alongside the in-app one) | `sendAuditCompleteEmail` on the BullMQ `email` queue |
| OS-level notification | App is open but backgrounded (`document.hidden`) and the user granted OS permission | Web Notifications API via `showNativeNotification` |

The whole system is deliberately cheap on datastore quota: in-app notifications
live in `ServerCache` (Redis, in-memory fallback) as a capped per-user JSON array,
**not** in Firestore. There is no `notifications` collection.

## Why audits never "cancel"

Channel and video audits, plus thumbnail/playlist optimizer analyses, run as
**server-side BullMQ jobs**. Leaving the page, closing the tab, or ending the
browser session does **not** stop them -- the job keeps running on the worker. The
only thing the browser loses is its local React `jobId`, which made it *look*
cancelled. The frontend persists that `jobId` in `sessionStorage` via
`useSessionJobId("video-audit" | "audit" | "thumbnail-optimizer" | "playlist-optimizer", orgId)`,
so returning to the page restores it and resumes polling. Optimizer pages also
mount an app-level `useOptimizerJobWatcher` in `Layout`, which keeps polling the
jobId even when the user never returns to the page. See the Video Audit doc and
the Full Audit Orchestrator doc.

## Data model

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

Cache key `notif:${email}`, capped to the last **50**, 30-day TTL. Each write is
read-modify-write through `ServerCache`. `ServerCache.setIfAbsent` (added for this
feature; see `backend/cache/ServerCache.js`) is used for the per-job idempotency
lock below.

## Backend flow

1. At enqueue, the route attaches the recipient identity to the job payload
   (`backend/routes/videoAudit.js:33-40`, `backend/routes/auditOrchestrator.js:27-33`):
   `{ channelId, videoIds, authHeader, uid, email, orgId }`. The `email` is read
   from `req.authUser` set by the auth middleware.
2. When the BullMQ worker finishes, `backend/queue/index.js` fires its
   `worker.on('completed')` handler (`setupWorkerEvents`), which calls
   `handleAuditCompleted({ notificationService, emailQueue, serverCache }, { label, job })`.
3. `handleAuditCompleted` (full source in `backend/queue/index.js:34`) is a no-op
   for any label other than `'audit'` / `'video-audit'` / `'thumbnail-optimizer'` /
   `'playlist-optimizer'`. For those it:
   - **Locks per job id** with `serverCache.setIfAbsent('notif:lock:${jobId}', true, 7d)`
     and returns early if it didn't win. The `completed` event is *global* -- every
     worker/pod connected to the queue receives it -- so without the lock multiple
     pods (Coolify dev runs replicas) or a lingering `node --watch` worker would
     each create a duplicate notification + email. This is the root cause that was
     fixed (the "2 notifications" bug).
   - Reads `email` and `job.returnvalue` to derive `score` (`rv.overall ?? rv.score`)
     and `channelName` (unwrap defensively: `rv.input?.channel?.name` may be a
     `{ value, health }` health object, so read `.value`; fall back to `job.data.channelId`).
   - Creates the in-app notification and enqueues `sendAuditCompleteEmail` on the
     `email` queue, all inside `try/catch` so a notification failure can **never**
     fail the audit job or block the worker.

   The notification type + destination link are derived from the label:
   `video-audit` → `videoAuditComplete` / `/video-audit`; `thumbnail-optimizer` →
   `thumbnailAuditComplete` / `/thumbnail-optimizer`; `playlist-optimizer` →
   `playlistAuditComplete` / `/playlist-optimizer`; else `auditComplete` / `/audit`.
   The optimizer worker derives its label per job from `job.data.kind` because one
   `optimizer` queue serves both thumbnail and playlist analyses.

   A fix for "video audit finished but no notification": the notification was
   already fired server-side, but `useNotifications` had `refetchIntervalInBackground: false`,
   so the browser stopped polling when the tab lost focus and the OS toast never
   fired. It is now `true` -- polling continues while backgrounded, so the arrival
   toast + OS notification surface even when the app is in another tab/window.

## Frontend flow

- `hooks/queries/useNotifications.ts` runs `useQuery({ queryKey: ['notifications'],
  refetchInterval: 30_000, refetchIntervalInBackground: true })` -- the lightweight
  polling pattern reused across the app. `refetchIntervalInBackground: true` keeps
  polling while the tab is backgrounded so OS notifications for completed
  audits/analyses still fire when the app is in another tab. `services/notificationService.ts`
  calls `GET /notifications`, `PATCH /notifications/:id/read`,
  `PATCH /notifications/read-all` with the Firebase auth header + optional `X-Org-Id`.
- `stores/notificationStore.ts` (Zustand) holds `items` + `unreadCount` and applies
  optimistic read flips. The store recomputes `unreadCount` locally; the server call
  is fired from the hook/page.
- `components/NotificationBell.tsx` renders the bell + red unread badge, lists items
  with relative times, and on click does `markRead` + optimistic `markOneRead` +
  `navigate(link)`. "Mark all read" does `markAllRead` + `markAllReadLocal`.
  - A `seen` ref seeds all pre-existing unread ids on first hydration so historical
    items don't re-toast (the cause of earlier toast floods). Only *new* unread items
    arriving after hydration toast once via `react-hot-toast`, and only surface an OS
    notification when `document.hidden`.
- `App.tsx` calls `requestNotificationPermission()` once at mount; the browser only
  prompts when permission is currently `'default'`.

## Files

See [docs/13-Notification System/Notification System.md](./Notification System)
for the full architecture, every file, and test coverage.

## Tests

- `backend/services/notificationService.test.mjs` -- prepend/cap/unreadCount/markRead/markAllRead with a fake `serverCache`.
- `backend/queue/auditCompleted.test.mjs` -- `handleAuditCompleted` fires for all four labels (`video-audit`, `audit`, `thumbnail-optimizer`, `playlist-optimizer`), skips when `email` absent, unwraps the health-wrapped channel name, and creates the notification + email **exactly once** even when fired 3x for the same job (idempotency lock).
- `backend/cache/ServerCache.test.mjs` -- `setIfAbsent` returns true first call, false + no overwrite second call.
- `frontend/src/services/nativeNotify.test.ts` -- permission states + native notify (jsdom).
- `frontend/src/hooks/useSessionJobId.test.ts` -- restore / persist / clear / org-scoped key (jsdom).
- The store's optimistic read flip and unread-count logic have **no test**. `notificationStore.test.ts` and `notificationService.test.ts` are referenced in older notes but do not exist in the tree, so this is a known coverage gap.

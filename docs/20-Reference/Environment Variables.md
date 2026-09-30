# Environment Variables

Everything the backend reads. Source of truth is `example.env` plus the code that
consumes each variable. `docker-compose.yml` is the other place to check, because a
variable not passed through there will not reach the container.

> Never read `.env` or `.env.prod`. Use `example.env`.

## Core

| Variable | Default | Effect |
|---|---|---|
| `PORT` | `3000` | Express listen port. Always `0.0.0.0` in the container. |
| `NODE_ENV` | unset | `dotenv` loads only when this is **not** `production`. Also gates dev-only CORS origins. |
| `REQUEST_LOG` | unset | Enables the request logger middleware. |
| `PERF_LOG` | unset | `1` enables performance logging. |
| `ANALYTICS_SOURCE` | `postgres-first` | `postgres-first` reads Redis, then Postgres, then falls back to live YouTube. `youtube-only` uses the request-time fetch path. |

## YouTube

| Variable | Effect |
|---|---|
| `YOUTUBE_API_KEY` | Server API key for public Data API calls. Required for [Public Audit](../17-Public%20Audit/Public%20Audit.md) and any path not using user OAuth. |
| `YOUTUBE_CLIENT_ID` | OAuth client id for the YouTube connect flow. |
| `YOUTUBE_CLIENT_SECRET` | OAuth client secret. |
| `YOUTUBE_OAUTH_REDIRECT_URIS` | Comma-separated redirect allowlist for `/api/oauth/exchange`. Defaults to `$VITE_FRONTEND_URL + /oauth-callback.html`; loopback is always allowed. No production host is hardcoded in the source, so a new deployment must set this (or `VITE_FRONTEND_URL`) *and* register the same URI in the Google Cloud OAuth client. |

A malformed value — most commonly a doubled scheme such as
`https://https://your-domain.com` — is warned about at request time rather than
silently never matching, which otherwise presents as the backend rejecting its own callback.

## Firebase

| Variable | Effect |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Service account JSON. Accepts raw JSON, base64-encoded JSON, or a filesystem path. Literal `\n` in `private_key` is unescaped automatically. |
| `VITE_FIREBASE_PROJECT_ID` | Passed through so the backend addresses the right project. |

The loader in `backend/index.js` tries all three forms in order and throws only if none
parse. This is deliberate: the same variable then works in Coolify (inline JSON) and
in local dev (path to a downloaded key).

## Frontend URLs

| Variable | Effect |
|---|---|
| `VITE_FRONTEND_URL` | Public frontend URL, no trailing slash. Used to build invite and ownership-transfer links in emails, and to derive the OAuth redirect URI allowlist. |
| `FRONTEND_URL` | Overrides the above; also feeds the CORS allowlist. |
| `CORS_ORIGINS` | Extra comma-separated CORS origins. |
| `SERVICE_URL_FRONTEND` | Coolify magic variable; compose falls back to it. |
| `YOUTUBE_OAUTH_REDIRECT_URIS` | Comma-separated OAuth callback URIs. `VITE_FRONTEND_URL` is always implied; loopback stays allowed for local dev. |

**No production host is hardcoded anywhere in the source.** CORS always allows a
built-in localhost/127.0.0.1 set; every real origin comes from the variables above.
The same applies to the OAuth redirect-URI allowlist in `routes/oauth.js`, which reads
`YOUTUBE_OAUTH_REDIRECT_URIS` and `VITE_FRONTEND_URL` only.

Deploying a new host therefore means adding it to the deployment env **and** to the
Google Cloud OAuth client's Authorized redirect URIs — not editing code.

## Email (SMTP)

`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_FROM_NAME`.

Any provider works (Gmail, Resend, SendGrid, Mailgun, Zoho). Needed for invitation and
ownership-transfer emails, and for the audit-complete notification. On Gmail use an
App Password, not the account password.

## Redis

| Variable | Default | Effect |
|---|---|---|
| `REDIS_URL` | unset | Enables Redis in `ServerCache`. Unset falls back to the in-memory LRU. |
| `QUEUE_REDIS_URL` | `REDIS_URL` | Separate Redis for BullMQ. |
| `REDIS_PASSWORD` | `revtube_secure_cache` | Compose-level; used to build both URLs. |
| `DISABLE_COMPRESSION` | unset | `1` disables gzip on cached payloads. |
| `CACHE_MAX_ENTRIES` | `1000` | In-process LRU size, used when Redis is unavailable. |
| `CACHE_FALLBACK_TTL_HOURS` | `12` | Max age of an entry in the in-process fallback cache. Deliberately conservative so a Redis outage cannot serve day-old data. |

Two Redis containers run in compose on purpose:

- `redis` uses `allkeys-lru`, 256MB. Cache keys are disposable.
- `redis-queue` uses `noeviction`, 64MB. Evicting a BullMQ job key loses work.

With `REDIS_URL` unset the whole BullMQ layer becomes a no-op
(`createNullQueueService`) and every `enqueue*` call is a no-op. Routes that require a
job return 503.

## PostgreSQL

`POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`.

Migrations run from **both** `db/migrations/` (hand-authored) and `db/drizzle/`
(generated). See
[Drizzle ORM & Migration Runner](../07-Infrastructure%20%26%20Deployment/03-Drizzle%20ORM%20%26%20Migration%20Runner.md).

## Quota

| Variable | Default | Effect |
|---|---|---|
| `USAGE_DEDUP_WINDOW_SEC` | `5` | Dedup window for parallel cache misses. |
| `QUOTA_DEDUP_WINDOW_SEC` | falls back to the above | Takes precedence over `USAGE_DEDUP_WINDOW_SEC`. |


## AI chat

| Variable | Default | Effect |
|---|---|---|
| `DEEPSEEK_API_KEY` | unset | Enables the chat agent. |
| `DEEPSEEK_MODEL` | `deepseek-v4-flash` in `example.env`, `deepseek-chat` in compose | Model id. |
| `CHAT_MAX_TOKENS` | `4096` | User-level output budget. |
| `CHAT_USER_MAX_TOKENS` | `4096` | Per-user-mode budget. |
| `CHAT_ADMIN_MAX_TOKENS` | `8192` | Admin ceiling (the model API caps output at 8192). |
| `CHAT_MAX_ITERATIONS` | `10` | Max agent tool-call iterations. |
| `CHAT_MAX_HISTORY` | `20` | Conversation window, user mode. |
| `CHAT_ADMIN_MAX_HISTORY` | `60` | Conversation window, admin mode. |
| `CHAT_CONV_TTL_MINUTES` | `30` | Conversation lifetime. |
| `CHAT_MAX_TOOL_REPEATS` | `3` | Identical consecutive tool calls before the loop breaker trips. |
| `GEMINI_API_KEY` | unset | Enables the Thumbnail Optimizer. |

## Playlist read model

| Variable | Default | Effect |
|---|---|---|
| `PLAYLISTS_READ_MODEL_MAX_AGE_HOURS` | `6` | How stale the Postgres playlist mirror may be before reads fall back to the live API. `0` always refreshes. |
| `PLAYLIST_SYNC_LIMIT` | `50` | Playlists ingested per channel per run. |
| `PLAYLIST_ITEMS_SYNC_LIMIT` | `500` | Membership rows per playlist. `0` syncs the catalog only. |
| `MAX_VIDEOS_PER_CHANNEL` | `10000` | Video catalog cap per channel per ingestion run. |

## Scheduled ingestion

The cron schedule is `0 3,9,15,21 * * *`. Both scheduled jobs order channels
**most-recently-active first** (from the token document's `updatedAt`) before
applying a cap, so a capped run starves the least recently used channels rather
than an arbitrary set.

| Variable | Default | Effect |
|---|---|---|
| `CRON_WARM_MAX_CHANNELS` | `50` | Channels warmed per scheduled cache refresh. `0` = no cap. |
| `CRON_INGEST_MAX_CHANNELS` | `100` | Channels ingested per scheduled Postgres run. `0` = no cap. |
| `CRON_INGEST_DAYS` | `730` | Days of metric history re-ingested per run. |
| `CRON_STAGGER_MS` | `500` | Delay between enqueues, spreading the burst across workers. |

Because the caps are env-tunable, growing past the default channel base needs no
code change. Raise a cap (or set it to `0`) and leave `CRON_STAGGER_MS` alone
unless the enqueue burst starts to starve workers.

## Rate limits

`OAUTH_LIMIT_MAX` (30), `AUTH_LIMIT_MAX` (240), `ANALYTICS_READ_LIMIT_MAX` (1200),
`ADMIN_LIMIT_MAX` (60), `RESOLVE_LIMIT_MAX` (60). All windows are 15 minutes. See
[Reference.md](Reference.md) for what each governs.

## Anomaly detection

`ANOMALY_LOOKBACK_DAYS`, `ANOMALY_WINDOW_DAYS`, `ANOMALY_MIN_HISTORY_DAYS`,
`ANOMALY_Z_THRESHOLD`, `ANOMALY_MIN_REL_DELTA`, `ANOMALY_MAX_PER_SCAN`,
`ANOMALY_SNAPSHOT_MAX_VIDEOS`, `ANOMALY_SNAPSHOT_RECENT_DAYS`,
`ANOMALY_SNAPSHOT_RETENTION_DAYS`, `ANOMALY_AUTO_EXPLAIN_MAX`, `ANOMALY_LAG_DAYS`.

Full table with meanings in
[Anomaly Detection](../15-Anomaly%20Detection/Anomaly%20Detection.md).

## Ingestion

| Variable | Default | Effect |
|---|---|---|
| `MAX_VIDEOS_PER_CHANNEL` | `DEFAULT_MAX_VIDEOS_PER_CHANNEL` in `ingestion/sync.js` | Cap on videos ingested per channel. Single source shared by cron, queue workers and the manual admin endpoints. |

## Frontend build args

`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
`VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`,
`VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MEASUREMENT_ID`, `VITE_GOOGLE_CLIENT_ID`,
`VITE_BACKEND_URL`.

`VITE_BACKEND_URL` is `/api` in production (same origin, nginx proxies to Express) and
`http://localhost:3000/api` for local dev without a proxy.

## Compose-only

| Variable | Default | Effect |
|---|---|---|
| `BACKEND_PORT` | `3000` | Host port mapping. |
| `FRONTEND_PORT` | `8081` | Host port mapping. |
| `GENERATE_DB_MIGRATIONS` | `false` | Build arg. When `true`, Drizzle migrations are generated during the image build. Off by default so production always ships the committed SQL. |

## Corrections against older documentation

Two items were previously reported as "declared but never wired". Both are now wired,
and the older claim is the stale part:

- `USAGE_DEDUP_WINDOW_SEC` is read and forwarded into the quota middleware as
  `dedupWindowSec` (defaulting from `QUOTA_DEDUP_WINDOW_SEC` first).
- `MAX_VIDEOS_PER_CHANNEL` is imported from `ingestion/sync.js` and forwarded to
  ingestion by `cron.js` and the queue workers.

`0` disables dedup. Only fully effective with Redis; the in-memory fallback keeps its
own dedup map.

The dedup key is time-bucketed:
`quota:dedup:{uid}:{pageKey}:{floor(now / (windowSec * 1000))}`, set with `NX EX`.
Usage counters are `usage:{uid}:{pageKey}:{YYYY-MM}`, incremented atomically and given
a TTL expiring at the end of the current month.

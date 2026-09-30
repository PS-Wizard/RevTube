# Backend Service

## ⚠️ IMPORTANT: Security Notice

**NEVER commit the following files to git:**
- Firebase service account JSON files (`*-adminsdk-*.json`)
- `.env` files with sensitive credentials
- Any files containing API keys, secrets, or passwords

These files are already in `.gitignore`, but always double-check before committing.

## Features

- **YouTube Analytics API** - Fetch channel and video analytics
- **Firebase Admin** - User management and Firestore access
- **Email Service** - Send invitation and transfer emails via SMTP
- **Organization Management** - Multi-user collaboration features
- **Redis Caching** - Persistent server-side cache for performance
- **PostgreSQL Analytics Store** - Daily-ingested materialized analytics/video data
- **Usage Limits** - Track and enforce API usage quotas via `middleware/usageLimit.js` (increments only on cache miss, not on cached responses)
- **Org membership cache** - Short-TTL membership checks with explicit invalidation on member removal via `cache/orgCache.js`
- **Modular Architecture** - Routes in `routes/`, middleware in `middleware/`, services in `services/`, cache in `cache/`, config in `config/`, utilities in `utils/`

## Setup

1. Copy `.env.example` to `.env` and fill in your credentials
2. Place your Firebase service account JSON file in this directory
3. Update the filename in your environment variables or code
4. (Optional) Set up Redis for persistent caching

## Environment Variables

Required environment variables:
- `YOUTUBE_API_KEY` - YouTube Data API key
- `YOUTUBE_CLIENT_ID` - OAuth client ID
- `YOUTUBE_CLIENT_SECRET` - OAuth client secret
- `VITE_FRONTEND_URL` - Frontend URL for email links
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` - Email configuration
- `FIREBASE_SERVICE_ACCOUNT` - Firebase service account JSON (as string) or path to JSON file

Optional environment variables:
- `REDIS_URL` - Redis connection URL (e.g., `redis://localhost:6379`)
  - If not set, uses in-memory cache (lost on restart)
  - If set, uses Redis for persistent caching
- `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`
- `ANALYTICS_SOURCE` - `postgres-first` (default) or `youtube-only`
- `USAGE_DEDUP_WINDOW_SEC` - Seconds for parallel usage counter dedup (default 5, set 0 to disable). **Declared but not wired yet.**
- `MAX_VIDEOS_PER_CHANNEL` - Max videos ingested per channel (default 10000). Lower it if YouTube quota is tight (~1 unit per 50 videos per run); the dashboard read path serves whatever is stored (no cap).
- `PLAYLIST_SYNC_LIMIT` - Max playlists ingested per channel per run (default 10000). Same quota math: ~1 unit per 50 playlists.

## Running

### Local Development

```bash
pnpm install
pnpm start
```

### With Redis (Recommended)

```bash
# Start Redis
docker run -d --name redis -p 6379:6379 redis:alpine

# Start backend
pnpm start
```

### PostgreSQL Migration

```bash
pnpm install
pnpm run db:migrate
```

### Docker Compose (Full Stack)

```bash
# Start all services (backend, frontend, redis, postgres)
docker-compose up -d

# View logs
docker-compose logs -f backend

# Stop all services
docker-compose down
```

## Caching

The backend implements a three-tier caching strategy:

1. **In-Memory Cache (Default)** - Fast, zero-config, lost on restart (`cache/ServerCache.js`)
2. **Redis Cache (Production)** - Persistent, distributed, survives restarts (`cache/ServerCache.js`)
3. **PostgreSQL Materialized Store** - Daily-ingested analytics and videos for read-heavy endpoints (`ingestion/readModels.js`)

**Full documentation:** [Caching Architecture](../docs/02-Backend%20Service/02-Caching%20Architecture%20%28ServerCache%20%26%20Redis%29.md) (architecture, key prefixes, TTLs, YouTube/API cache behavior, usage accounting, OAuth token cache, org membership invalidation, admin endpoints). See also the [API reference](../docs/02-Backend%20Service/01-API%20Endpoints%20%26%20Middleware.md) and [Environment Variables](../docs/20-Reference/Environment%20Variables.md).

### Rate limiting

The backend uses two layers of request throttling:

**1. Rate limiting (express-rate-limit)** -- Protects against request floods per endpoint group:

| Limiter | Scope | Window | Default max | Key |
|---------|-------|--------|-------------|-----|
| `oauthLimiter` | OAuth token exchange | 15 min | 30 | IP |
| `authLimiter` | General API (non-analytics) | 15 min | 240 | User UID / email / IP fallback |
| `analyticsReadLimiter` | Analytics read routes | 15 min | 1200 | User UID / email |
| `adminLimiter` | Admin-only endpoints | 15 min | 60 | IP |

The `authLimiter` uses **user-based keys** (`req.authUser?.uid || req.authUser?.email || req.ip`) so each authenticated user gets their own rate limit bucket. Behind Docker/nginx, IP-based keys would collapse all users to the gateway IP (`172.18.0.1`), causing one user to exhaust the shared bucket for everyone.

Rate-limited requests receive a structured 429 JSON response:
```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "You've sent too many requests. This limit resets in 45s. Please wait and try again.",
    "scope": "api",
    "path": "/channel/username/MrBeast",
    "method": "GET",
    "limit": 240,
    "remaining": 0,
    "retryAfterSeconds": 45
  }
}
```

**2. Usage limits (monthly quota)** -- Tracks per-user monthly API call budget:

- **`checkUsageLimit(pageKey)`** middleware verifies the user has remaining monthly quota but does **not** increment.
- **`incrementUsageLimit(req)`** runs after a **cache miss**, immediately before a live Google API call.
- Cached responses (Redis or in-memory) do not count against free-tier limits.
- Cron cache warming does not increment user usage (no `req` context).

### Cache key scoping (org isolation)

Dashboard, analytics, and YouTube Data API cache keys are scoped by organization or user to prevent cross-org data leakage when the same `channelId` is accessed from multiple organizations.

**`dashboardScope(req, { orgId, channelId })`** -- used for dashboard bundle, summary, dimensions, and snapshot keys:

| Priority | Source | Scope format |
|----------|--------|--------------|
| 1 | `X-Org-Id` header or `req._resolvedOrgId` | `org:{orgId}` |
| 2 | Authenticated user email | `u:{email}` |
| 3 | Bearer token hash (no email) | `anon:{shortHash(authHeader)}` |
| 4 | No auth | `pub` |

**`youtubeDataScope(req, hasBearerAuth)`** -- used for YouTube Data API proxy routes (channel lookups, playlists, videos):

| Condition | Scope format |
|-----------|--------------|
| No `Authorization` header | `pub` (shared public cache) |
| Bearer token + `X-User-Email` | `u:{email}` |
| Bearer token, no email | `t:{shortHash(authorization)}` |

**Channel-videos scope** -- The `GET /api/channel-videos/:channelId` endpoint builds an `effectiveCacheScope`:
- In org context: `org:{orgId}:{channelId}` -- all org members share one cache entry
- Personal context: user email or token hash -- per-user isolation

**Cron cache warming** (`backend/cron.js`) builds a `channelId` → `orgId` map from Firestore `collectionGroup('channels')`. Uses `org:{orgId}:{channelId}` scope for org-owned channels (matching org member request scope) instead of `cron:{channelId}` -- cron-warmed entries are served to org members instead of producing cache misses.

### OAuth token cache

`refreshGoogleToken()` caches access tokens under `oauth:token:{shortHash(refreshToken)}` for **55 minutes**, reducing redundant Google token exchanges during cron runs.

### Enable Redis Caching

Add to `.env`:
```bash
REDIS_URL=redis://localhost:6379
```

### Test Redis Connection

```bash
node test-redis.js
```

### Cache Endpoints (Admin Only)

- `GET /api/admin/cache/stats` - View cache statistics
- `POST /api/admin/cache/clear` - Clear all cache entries
- `POST /api/admin/ingestion/refresh-all` - Trigger full Postgres ingestion
- `POST /api/admin/ingestion/refresh-channel` - Trigger one-channel ingestion

## API Endpoints

### Public
- `POST /api/oauth/exchange` - Exchange OAuth code for tokens (`routes/oauth.js`)
- `POST /api/oauth/refresh` - Refresh access token (`routes/oauth.js`)
- `GET /api/admin/config` - Get feature configuration (`config/featureConfig.js`)

### Authenticated
- `POST /api/user/sync` - Sync user data with Firestore (`routes/user.js`)
- `POST /api/user/init` - Initialize user profile (`routes/user.js`)
- `POST /api/organization/send-invitation` - Send org invite email (`routes/organization.js`)
- `POST /api/organization/send-ownership-transfer` - Send ownership transfer email (`routes/organization.js`)
- `POST /api/organization/invalidate-member` - Evict org membership cache after member removal (`routes/organization.js`)
- `GET /api/channels/mine` - Get authorized channels (`routes/channels.js`)
- `GET /api/channel/id/:id` - Lookup channel by ID (`routes/channels.js`)
- `GET /api/channel/handle/:handle` - Lookup channel by handle (`routes/channels.js`)
- `GET /api/channel/username/:username` - Lookup channel by username (`routes/channels.js`)
- `GET /api/analytics/report` - Get YouTube Analytics data (`routes/analytics.js`)
- `POST /api/dashboard/bundle` - Get all dashboard data (`routes/dashboard.js`, `services/dashboardBundle.js`)
- `POST /api/dashboard/summary` - Fast 7/30/90 summary stats (`routes/dashboard.js`)
- `POST /api/analytics/dimensions` - Get audience breakdown data (`routes/analytics.js`, `services/dimensionsService.js`)
- `GET /api/videos` - Get video metadata (`routes/videos.js`)
- `GET /api/video/:videoId` - Resolve video→channel (`routes/videos.js`)
- `GET /api/specific-videos` - Get specific videos by ID (`inline in index.js`)
- `GET /api/playlists/:channelId` - Get channel playlists (`routes/playlists.js`)
- `GET /api/playlist/:id` - Get single playlist (`routes/playlists.js`)
- `GET /api/playlist-items/:playlistId` - Get playlist items (`routes/playlists.js`)
- `GET /api/channel-videos/:channelId` - Get channel video list (`routes/channelVideos.js`, `services/channelVideosService.js`)
- `GET /api/usage/me` - Get current usage stats (`routes/usage.js`)
- `POST /api/usage/track` - Track usage for synthetic endpoints (`routes/usage.js`)
- `POST /api/compare/videos` - Fetch channel videos + pre-computed metrics for comparison tool (`routes/compare.js`)

### Admin Only
- `GET /api/admin/users` - List all users (`routes/admin.js`)
- `PUT /api/admin/users/:uid/package` - Update user package (`routes/admin.js`)
- `PUT /api/admin/users/:uid/role` - Update user role (`routes/admin.js`)
- `PUT /api/admin/config` - Update feature configuration (`routes/admin.js`)
- `GET /api/admin/cache/stats` - View cache statistics (`routes/admin.js`)
- `POST /api/admin/cache/clear` - Clear cache (`routes/admin.js`)
- `POST /api/admin/cache/metrics/reset` - Reset cache metrics (`routes/admin.js`)

## Performance

### Without Cache
- Dashboard load: ~6,300ms (14 API calls)
- API quota usage: ~700 calls/day (10 users)

### With Redis Cache
- Dashboard load: ~50ms (cached) or ~2,000ms (first load)
- API quota usage: ~140 calls/day (80% reduction)
- Cache hit rate: ~80% after warm-up
- Free-tier usage counters increment only on cache misses (cached refreshes do not consume monthly quota)

## Development

```bash
# Watch mode (auto-restart on changes)
npm run dev

# Test Redis connection
node test-redis.js

# Check syntax
node -c index.js
```

## Troubleshooting

### Redis Connection Issues

If you see `[Cache] Redis not available, using in-memory cache`:
1. Check if Redis is running: `redis-cli ping`
2. Verify REDIS_URL in .env
3. Test connection: `node test-redis.js`

### PostgreSQL Connection Issues

If Postgres-backed reads are skipped:
1. Verify `POSTGRES_*` env vars are set.
2. Run migration: `pnpm run db:migrate`.
3. Confirm database health in compose: `docker-compose ps`.
4. Temporarily force legacy reads with `ANALYTICS_SOURCE=youtube-only`.

### Firebase Admin Issues

If you see Firebase errors:
1. Verify FIREBASE_SERVICE_ACCOUNT is set correctly
2. Check service account has proper permissions
3. Ensure project ID matches

### Email Issues

If emails aren't sending:
1. Verify SMTP credentials
2. Check SMTP_HOST and SMTP_PORT
3. For Gmail, use App Password (not account password)

## Production Deployment

1. Set up managed Redis (AWS ElastiCache, Redis Cloud, etc.)
2. Configure REDIS_URL with production Redis endpoint
3. Set up proper SMTP service (Resend, SendGrid, etc.)
4. Use environment variables for all secrets
5. Enable HTTPS/TLS for Redis connection
6. Monitor cache hit rates and API quota usage

## Coolify Deployment Notes

- Prefer one Compose stack for `frontend`, `backend`, and `redis` so internal DNS names (`backend`, `redis`) resolve correctly.
- Avoid fixed `container_name` values and host `ports` mappings in production stacks to prevent collisions across redeploys.
- Ensure Redis health checks authenticate when `--requirepass` is enabled.
- Set `VITE_FRONTEND_URL` to your public HTTPS domain (not localhost) for invite and ownership email links.
- If deploying frontend and backend as separate apps, update `frontend/nginx.conf` upstream from `backend:3000` to your backend public URL.

### Fixing "No available server" in Coolify

Traefik shows this when it has no **healthy** backend for your route. Common causes in this stack:

1. **Failed Docker health checks** -- `node:18-alpine` does not ship `wget`. Health checks that call `wget` fail, Docker marks the container `unhealthy`, and Traefik stops routing. Images here use `curl` (Coolify recommends `curl` or `wget` in the image).
2. **Proxy / magic variables** -- Coolify’s compose examples use `SERVICE_URL_<service>_<port>` so Traefik knows the container port (same idea as the Appwrite example in the [Compose docs](https://coolify.io/docs/knowledge-base/docker/compose)).

This repo uses:

- `SERVICE_URL_FRONTEND_80` and `SERVICE_URL_FRONTEND` on `frontend` -- public entrypoint on container port 80; nginx proxies `/api/` to `backend` internally.
- `SERVICE_URL_BACKEND_3000` on `backend` -- optional API hostname; leave the backend domain empty in Coolify if you only use `/api` via the frontend.

Deployment checklist:

1. Set the domain on the `frontend` service in Coolify (e.g. `https://revtube.example.com`). Leave the `backend` domain empty unless you need a separate API host.
2. Production traffic should go through Traefik, not ad-hoc host `ports:` mappings.
3. Set `VITE_FRONTEND_URL` to that public URL if you want it fixed; otherwise the backend falls back to `$SERVICE_URL_FRONTEND`.
4. Redeploy after domain changes. If it still fails, check **Servers → Proxy → Logs** and `docker ps` for `(unhealthy)` containers.

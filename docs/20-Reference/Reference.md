# Reference

Cross-cutting material that does not belong to a single subsystem.

| Document | Contents |
|---|---|
| [Testing.md](Testing.md) | Vitest setup and conventions for both packages |
| [Test Plan.md](Test%20Plan.md) | Historical test plan (pre-consolidation) |
| [Source Audit Findings.md](Source%20Audit%20Findings.md) | Findings from the source audit, including known open issues |
| [Legacy Project Guide.md](Legacy%20Project%20Guide.md) | The old `docs/PROJECT_GUIDE.md`, preserved for history. Superseded by the numbered sections. |
| [Environment Variables](Environment%20Variables.md) | Every env var the backend reads, with defaults and effect |
| [Plans/](Plans/) | Superseded design specs and implementation plans, kept for history only |

## Quick reference: feature config defaults

From `backend/config/featureConfig.js`, used when Firestore `config/features` has no
entry. `-1` means unlimited.

| Page key | Label | Free | Pro |
|---|---|---|---|
| `dashboard` | Channel Analytics | 10 | 100 |
| `videos` | Videos | 20 | 200 |
| `channel` | Channel | 10 | 200 |
| `playlists` | Playlists | 10 | 200 |
| `compare` | Compare | 5 | 100 |
| `specificVideos` | Specific Videos | 10 | 200 |
| `chat` | AI Chat | 50 | 500 |
| `thumbnailOptimizer` | Thumbnail Optimizer | 5 | 100 |
| `playlistOptimizer` | Playlist Optimizer | 5 | 100 |
| `audit` | Audit | 5 | 100 |
| `auditVideos` | Channel Audit Videos | 15 | 30 |
| `videoAudit` | Video Audit | 5 | 100 |
| `goals` | Goals & Pacing | -1 | -1 |
| `anomalies` | Anomalies | 20 | 500 |
| `customDashboard` | My Dashboard | -1 | -1 |
| `optimized` | Optimized Content | -1 | -1 |
| `captions` | Captions / Transcripts | 20 | 200 (**disabled by default**) |

`captions` is the one page that ships disabled. Enabling it turns on the captions
route and the transcript surface.

Config is read from Firestore with a **10-minute** backend cache, invalidated on admin
write. The frontend polls roughly every minute.

## Quick reference: rate limits

All windows are 15 minutes. Configured in `backend/middleware/rateLimiter.js`.

| Limiter | Default | Env override | Key | Scope |
|---|---|---|---|---|
| `oauthLimiter` | 30 | `OAUTH_LIMIT_MAX` | IP | `/api/oauth/*` |
| `authLimiter` | 240 | `AUTH_LIMIT_MAX` | uid, else email, else IP | All authenticated API, skipping analytics reads |
| `analyticsReadLimiter` | 1200 | `ANALYTICS_READ_LIMIT_MAX` | uid, else email | Read-heavy analytics endpoints |
| `adminLimiter` | 60 | `ADMIN_LIMIT_MAX` | uid, else email, else IP | Admin endpoints |
| `resolveLimiter` | 60 | `RESOLVE_LIMIT_MAX` | uid, else email, else IP | Channel resolution, tier-aware from feature config |

`analyticsReadLimiter` exists because the dashboard fires many read calls per page
view. Bucketing those under the general API limit would break normal usage.

## Quick reference: queue concurrency

From `backend/queue/index.js`. All queues retry with exponential backoff.

| Queue | Concurrency | Attempts | Job retention | Notes |
|---|---|---|---|---|
| `ingestion` | 3 | 3 | 7 days | Default lock window |
| `cache-warm` | 5 | 2 | 3 days | Default lock window |
| `email` | 2 | 3 | 1 day | Default lock window |
| `video-audit` | 2 | 3 | 1 day | Long lock window, `maxStalledCount: 3` |
| `optimizer` | 2 | 3 | 1 day | Long lock window; thumbnail + playlist by `job.data.kind` |
| `audit-orchestrator` | 2 | 3 | 1 day | Long lock window |
| `public-audit` | 2 | 2 | 1 day | Long lock window |

The long-lock queues use `AUDIT_LOCK_MS` with `maxStalledCount: 3` because an LLM audit
can exceed BullMQ's default 30-second lock window, which would otherwise cause the job
to be redelivered while still running.

## Quick reference: database tables

Owned by `backend/db/migrations/` (hand-authored) and `backend/db/drizzle/`
(generated). See [Database Schema & Migrations](../07-Infrastructure%20%26%20Deployment/02-Database%20Schema%20%26%20Migrations.md).

| Migration | Tables |
|---|---|
| `001_init_analytics` | `analytics_channels`, `analytics_videos`, `analytics_channel_metrics_daily`, `analytics_video_metrics_daily`, `analytics_sync_runs` |
| `002_dashboard_snapshots` | `analytics_dashboard_snapshots` |
| `003_user_access_flags` | `user_access_flags` |
| `004_thumbnail_audits` | `thumbnail_audits` |
| `005_playlist_audits` | `playlist_audits` |
| `006_audits` | `audits` |
| `007_video_audits` | `video_audits` |
| `008_channel_goals` | `channel_goals` |
| `009_playlists` | `analytics_playlists`, `analytics_playlist_items` |
| `010_channel_focus` | `channel_focus` |
| `011_public_audits` | `public_audits` |
| `012_anomalies` | `analytics_anomalies`, `analytics_video_view_snapshots` |
| `013_custom_dashboard_layouts` | `custom_dashboard_layouts` |

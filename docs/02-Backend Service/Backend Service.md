## Backend Service

Relevant source files

-   [backend/README.md](../../backend/README.md)
-   [backend/index.js](../../backend/index.js)
-   [backend/routes/*.js](../../backend/routes)
-   [backend/services/*.js](../../backend/services)
-   [backend/middleware/*.js](../../backend/middleware)
-   [backend/cache/ServerCache.js](../../backend/cache/ServerCache.js)
-   [backend/config/featureConfig.js](../../backend/config/featureConfig.js)
-   [Project Overview](../20-Reference/Legacy Project Guide)
-   [Testing (Vitest)](05-Testing (Vitest)).md) — unit-testing conventions and the security-core suite
-   [AI Chat System (09-AI Chat System)](../09-AI%20Chat%20System/AI%20Chat%20System.md) — streaming DeepSeek agent subsystem

The Backend Service is a Node.js application built on the Express framework that serves as the central orchestration layer for RevTube (TubeKeter Analytics). It manages data flow between the React frontend, external Google APIs (YouTube Data and Analytics), Firebase/Firestore for user metadata, and local PostgreSQL/Redis stores [Project Overview#7-9](../20-Reference/Legacy Project Guide)

### Modular Architecture

The backend has been refactored from a monolithic `index.js` (~5200 lines) into a modular structure with domain-separated files:

| Directory | Purpose | Key Files |
|-----------|---------|-----------|
| `routes/` | Express router factories | oauth, user, organization, admin, usage, channels, playlists, videos, dashboard, analytics, compare, channelVideos |
| `middleware/` | Request processing pipeline | auth, premiumAccess, quota, rateLimiter, orgToken, configVersion, requestLogger |
| `services/` | Business logic | analyticsService, dashboardBundle, dimensionsService, channelVideosService, tokenService, quotaService |
| `queue/` | BullMQ job queue system | index (queue service factory), ingestionQueue, cacheWarmQueue, emailQueue |
| `cache/` | Caching layer | ServerCache, userCache, orgCache |
| `config/` | Feature configuration | featureConfig, configVersion |
| `utils/` | Shared utilities | perfLog, inflight, cacheScope, handleApiError |

All files use the **factory function pattern** (`create*Router(deps)` / `create*Service(deps)`) for dependency injection. The `deps` object flows from `index.js` → services → routes, ensuring loose coupling and testability.

> **Note**: The **AI Chat system** (`backend/chat/`) is a self-contained DeepSeek-powered agent and is documented separately in [AI Chat System](../09-AI%20Chat%20System/AI%20Chat%20System.md).

### Core Responsibilities

The backend is responsible for several critical domains:

-   API Proxying: Interfacing with YouTube Data API v3 and YouTube Analytics API v2 using OAuth2 tokens [Project Overview#46-50](../20-Reference/Legacy Project Guide)
-   Authentication & Authorization: Validating Firebase ID tokens and enforcing multi-tenant organization permissions [Project Overview#72-74](../20-Reference/Legacy Project Guide)
-   Analytics Ingestion: Syncing daily YouTube metrics into a local PostgreSQL database for high-performance "postgres-first" reads [ingestion/sync.js](../../backend/ingestion/sync.js)
-   Caching: Maintaining a dual-layer cache (Redis + In-memory) to minimize latency and manage Google API quota consumption [cache/ServerCache.js](../../backend/cache/ServerCache.js)
-   Job Queues: Managing async work via BullMQ queues (ingestion, cache-warming, email) with retries, concurrency control, and full observability via Bull Board [queue/index.js](../../backend/queue/index.js)
-   Scheduled Tasks: Enqueuing background jobs on a cron schedule for cache warming and daily data synchronization [cron.js](../../backend/cron.js)

___

### System Integration Map

The following diagram illustrates how backend code entities bridge the gap between high-level system components and external services.

Backend Entity & Data Flow

Sources: [index.js](../../backend/index.js) [Project Overview#12-65](../20-Reference/Legacy Project Guide)

___

### Middleware Pipeline

Every request to the `/api` mount point passes through a structured middleware pipeline to ensure security and resource management:

1.  `checkConfigVersion` ([middleware/configVersion.js](../../backend/middleware/configVersion.js)): Compares live Firestore config version against request-scoped version; invalidates analytics cache on mismatch.
2.  `authLimiter` ([middleware/rateLimiter.js](../../backend/middleware/rateLimiter.js)): Per-user rate limiting (240 req/15min) to prevent abuse.
3.  `authenticateRequest` ([middleware/auth.js](../../backend/middleware/auth.js)): Validates the Firebase ID token in the `X-Firebase-Token` header using `firebase-admin` [Project Overview#73](../20-Reference/Legacy Project Guide)
4.  `resolveUser` ([middleware/auth.js](../../backend/middleware/auth.js)): Retrieves the user's profile and subscription package (Free/Pro) from PostgreSQL or Firestore [Project Overview#74](../20-Reference/Legacy Project Guide)
5.  `resolveOrgToken` ([middleware/orgToken.js](../../backend/middleware/orgToken.js)): Determines if the request is operating within an organization context and validates permissions [Project Overview#3](../20-Reference/Legacy Project Guide)
6.  `checkPremiumAccess` ([middleware/premiumAccess.js](../../backend/middleware/premiumAccess.js)): Restricts pro-tier features.
7.  `requireQuota` ([middleware/quota.js](../../backend/middleware/quota.js)): Enforces tier-based monthly quota limits before processing heavy analytics operations [Project Overview#75](../20-Reference/Legacy Project Guide)

For a full reference of endpoints and the logic within this pipeline, see [API Endpoints & Middleware](01-API Endpoints & Middleware.md).

Sources: [Project Overview#72-76](../20-Reference/Legacy Project Guide) [middleware/auth.js](../../backend/middleware/auth.js) [middleware/quota.js](../../backend/middleware/quota.js)

___

### Major Subsystems

#### Caching Architecture

The `ServerCache` class ([cache/ServerCache.js](../../backend/cache/ServerCache.js)) provides a unified interface for data persistence. It prioritizes Redis for shared caching across horizontal instances but falls back to a local In-memory Map if Redis is unavailable. It features automatic Gzip compression for large JSON payloads to optimize memory usage. For details, see [Caching Architecture (ServerCache & Redis)](02-Caching Architecture (ServerCache & Redis).md).

#### Data Ingestion & Read Models

To avoid the latency and quota limits of live YouTube API calls, the backend uses a "postgres-first" strategy (controlled by `ANALYTICS_SOURCE` env var). Data is ingested into PostgreSQL via `ingestChannelDaily` and served through optimized Read Models like `loadBundleFromPostgres` ([ingestion/readModels.js](../../backend/ingestion/readModels.js)). For details, see [PostgreSQL Ingestion & Read Models](03-PostgreSQL Ingestion & Read Models.md).

#### Scheduled Tasks

Background operations are managed by `cron.js`, which uses `node-cron` to schedule tasks such as `runCacheRefresh` (cache warming) and `runPostgresIngestion` (daily sync). These tasks ensure that dashboard data is pre-computed and ready for users at the start of their day. For details, see [Scheduled Tasks & Cache Warming (cron.js)](04-Scheduled Tasks & Cache Warming (cron.js).md).

#### Job Queue System

The backend uses BullMQ on the same Redis instance as ServerCache to manage async background work. Six queues run in-process workers: `ingestion` (concurrency: 3), `cache-warm` (concurrency: 5), `email` (concurrency: 2), `video-audit` (2), `audit` (2), and `optimizer` (2, thumbnail + playlist analyses dispatched by `job.data.kind`). Jobs have automatic retries with exponential backoff, 7–14 day retention for debugging, and a Bull Board monitoring UI at `/admin/queues`. See [Job Queues](06-Job Queues (BullMQ)).

For details, see [Scheduled Tasks & Cache Warming (cron.js)](04-Scheduled Tasks & Cache Warming (cron.js).md).

___

### Backend Code Entity Relationships

This diagram maps specific code functions and classes to their functional roles within the backend architecture.

Backend Code Entity Space

Sources: [cache/ServerCache.js](../../backend/cache/ServerCache.js) [services/dashboardBundle.js](../../backend/services/dashboardBundle.js) [services/dimensionsService.js](../../backend/services/dimensionsService.js) [services/channelVideosService.js](../../backend/services/channelVideosService.js) [cron.js](../../backend/cron.js) [ingestion/readModels.js](../../backend/ingestion/readModels.js)

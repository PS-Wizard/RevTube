## System Architecture

Relevant source files

-   [README.md](../README.md)
-   [backend/README.md](../../backend/README.md)
-   [backend/index.js](../../backend/index.js)
-   [backend/routes/*.js](../../backend/routes)
-   [backend/middleware/*.js](../../backend/middleware)
-   [backend/services/*.js](../../backend/services)
-   [backend/cache/ServerCache.js](../../backend/cache/ServerCache.js)
-   [docker-compose.yml](../../docker-compose.yml)
-   [Project Overview](../20-Reference/Legacy Project Guide)

The RevTube (TubeKeter Analytics) system is designed as a high-performance, multi-tenant analytics platform. It utilizes a React-based Single Page Application (SPA) for the frontend, a Node.js/Express backend for data orchestration, and a hybrid storage strategy involving PostgreSQL for high-frequency analytics and Firebase for user identity and credentials.

### 1\. High-Level Topology

The system is deployed using a five-service Docker Compose topology, consisting of a frontend proxy, an application backend, a relational database, and **two Redis instances** [docker-compose.yml#1-142](../../docker-compose.yml)

1.  Frontend (Nginx + React): Serves static assets and acts as a reverse proxy for API requests [frontend/nginx.conf#1-25](../../frontend/nginx.conf)
2.  Backend (Node.js/Express): Handles business logic via a modular architecture with separate files for `routes/`, `middleware/`, `services/`, `cache/`, `config/`, and `utils/` directories. The main `backend/index.js` is a wiring hub (~470 lines) that connects all modules [backend/index.js](../../backend/index.js)
3.  PostgreSQL: Stores daily ingested analytics, video metadata, and dashboard snapshots [Project Overview#138-145](../20-Reference/Legacy Project Guide)
4.  **Redis (cache)**: Provides a persistent, low-latency JSON response cache using `allkeys-lru` eviction [cache/ServerCache.js](../../backend/cache/ServerCache.js)
5.  **Redis (queue)**: A separate instance dedicated to BullMQ job state, locks, and stall-detection, using `noeviction` policy to prevent cache eviction from affecting queue integrity

#### System Component Overview

Sources: [Project Overview#11-65](../20-Reference/Legacy Project Guide) [README.md#56-83](../README.md) [docker-compose.yml#1-131](../../docker-compose.yml)

___

### 2\. Frontend Architecture

The frontend is a React 19 SPA built with Vite [README.md#13](../README.md) It follows a modular structure where state is partitioned between server-side state (TanStack Query) and client-side UI state (Zustand).

-   Routing & Layout: Managed by `react-router-dom`. The `App.tsx` file defines protected routes and lazy-loads major page components like `DashboardPage` and `VideosPage` [frontend/src/App.tsx#20-42](../../frontend/src/App.tsx)
-   State Management:
    -   `dashboardStore`: A Zustand store managing filters, selections, and UI slices [README.md#27](../README.md)
    -   `dashboardMachine`: An XState machine that governs the transitions between dashboard tabs and loading states [frontend/src/machines/dashboardMachine.ts#31-131](../../frontend/src/machines/dashboardMachine.ts)
-   Data Fetching: The application uses a "bundle" pattern where `AnalyticsService` fetches large sets of related data (e.g., `getDashboardBundle`) to minimize round-trips [backend/README.md#172](../../backend/README.md)

Sources: [frontend/src/App.tsx#1-102](../../frontend/src/App.tsx) [frontend/src/machines/dashboardMachine.ts#6-30](../../frontend/src/machines/dashboardMachine.ts) [README.md#20-38](../README.md)

___

### 3\. Backend & Data Orchestration

The backend is an Express server [backend/index.js#L1-L50](../../backend/index.js) that serves as a secure proxy and data aggregator. The codebase has been refactored from a 5200-line monolith into a modular architecture:

```
backend/
├── index.js              # Wiring hub (~470 lines)
├── routes/               # 11 Express router factories
├── middleware/           # 7 middleware modules
├── services/            # 6 business logic services (inc. insightsService)
├── queue/               # BullMQ job queue system (ingestion, cache-warm, email)
├── cache/               # ServerCache, userCache, orgCache
├── config/              # featureConfig, configVersion
├── utils/               # perfLog, inflight, cacheScope, handleApiError
├── cron.js              # Scheduled queue enqueue + admin trigger endpoints
├── drizzle.config.js    # Drizzle-kit CLI configuration
├── ingestion/           # PostgreSQL ingestion engine + Drizzle read models
└── db/                  # Database client + Drizzle ORM + migrations
    ├── client.js        # pg Pool setup
    ├── drizzle.js       # Singleton getDb() — Drizzle ORM wrapper
    ├── schema.js        # Drizzle ORM pgTable definitions (7 tables)
    ├── migrate.js       # Hash-based migration runner (SQL files)
    └── drizzle/         # Auto-generated migration .sql files
```

#### Middleware Pipeline

Every request passes through a validation pipeline:

1.  `checkConfigVersion` ([middleware/configVersion.js](../../backend/middleware/configVersion.js)): Compares live Firestore version against request-scoped version.
2.  `authLimiter` ([middleware/rateLimiter.js](../../backend/middleware/rateLimiter.js)): Per-user rate limiting.
3.  `authenticateRequest` ([middleware/auth.js](../../backend/middleware/auth.js)): Verifies the Firebase ID token via `firebase-admin` [Project Overview#73](../20-Reference/Legacy Project Guide)
4.  `resolveUser` ([middleware/auth.js](../../backend/middleware/auth.js)): Loads the user profile and subscription tier (free/pro) [Project Overview#74](../20-Reference/Legacy Project Guide)
5.  `requireQuota` ([middleware/quota.js](../../backend/middleware/quota.js)): Verifies monthly API quotas before proceeding [backend/README.md#131](../../backend/README.md)

#### Data Flow & Caching (ServerCache)

The `ServerCache` class ([cache/ServerCache.js](../../backend/cache/ServerCache.js)) implements a dual-layer strategy. It first checks for a `REDIS_URL` to enable persistent caching; if unavailable, it falls back to an in-memory `Map`.

-   Compression: Payloads are gzipped before storage to reduce Redis memory footprint.
-   In-Flight Deduplication: The `withInFlightTimeout` function ([utils/inflight.js](../../backend/utils/inflight.js)) prevents "cache stampedes" by ensuring multiple concurrent requests for the same resource only trigger one upstream fetch.

#### Code Entity Mapping: Data Fetching

Sources: [cache/ServerCache.js](../../backend/cache/ServerCache.js) [utils/inflight.js](../../backend/utils/inflight.js) [services/dashboardBundle.js](../../backend/services/dashboardBundle.js) [Project Overview#67-76](../20-Reference/Legacy Project Guide) [backend/README.md#129-135](../../backend/README.md)

___

### 4\. Storage & Persistence

The system utilizes a multi-database strategy to balance flexibility and performance.

| Store | Technology | Purpose | Key Entities |
| --- | --- | --- | --- |
| Relational | PostgreSQL | Materialized analytics and video metadata for fast reads. | `analytics_videos`, `analytics_video_metrics_daily` |
| Document | Firestore | Hierarchical user accounts, organizations, and OAuth tokens. | `users`, `organizations`, `oauth_tokens` |
| Cache | Redis | Ephemeral storage for JSON API responses and session-related data. | `oauth:token:*`, `bundle:*` |

#### Data Ingestion Pipeline

The `cron.js` worker runs daily to sync data from the YouTube API into PostgreSQL. It uses `runPostgresIngestion` to populate the `analytics_` tables, which are then queried by the `readModels.js` layer for the dashboard [Project Overview#94-105](../20-Reference/Legacy Project Guide)

Sources: [Project Overview#136-145](../20-Reference/Legacy Project Guide) [backend/README.md#18-21](../../backend/README.md) [ingestion/readModels.js](../../backend/ingestion/readModels.js)

___

### 5\. Audit & Scoring

The `/audit` feature provides a unified, deterministic channel health score. The
scoring engine ([backend/services/auditScoringService.js](../../backend/services/channelAuditScoringService.js))
exposes `createAuditScoringService` with `scoreVideo` / `scoreChannel` /
`scorePlaylist` / `scoreAll`. It is rule-based (no LLM) and returns
`{ total, breakdown: [{ key, label, earned, max }] }`.

- Scoring weights live in [backend/config/auditScoring.js](../../backend/config/channelAuditScoring.js)
  as `DEFAULT_AUDIT_SCORING` (video 20/15/10/5/50, channel 20/10/5/15/20/30,
  playlist 20/30/30/20), overridable via the Firestore doc `config/auditScoring`
  (10-min cache, `invalidateAuditScoringCache()`). Category maxes must sum to
  100; an invalid category falls back to `DEFAULT_AUDIT_SCORING`.
- Admin config is served by `GET/PUT /admin/audit-scoring` in
  [backend/routes/admin.js](../../backend/routes/admin.js) (validates sum-to-100 and
  bumps `configVersion`), with the frontend "Scoring" tab in `AdminPage.tsx`
  (`ScoringConfigEditor.tsx`) at route `/admin/scoring`.
- The `/audit` page ([frontend/src/pages/AuditPage.tsx](../../frontend/src/pages/audit-orchestrator/AuditOrchestratorPage.tsx))
  is quota-gated via the `audit` page key and wrapped in `FeatureGuard`. POST
  `/audit` enforces quota, channel ownership, and org token. Audit history is
  persisted to the PostgreSQL `audits` table via `GET/POST/DELETE
  /audit/history[:id]`. Criterion help is rendered by the reusable
  [frontend/src/components/ScoringHelpPanel.tsx](../../frontend/src/components/AuditCriteriaHelpButton.tsx),
  mounted on `/audit` and the optimizers (Phase 2).

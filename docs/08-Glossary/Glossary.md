## Glossary

Relevant source files

-   [README.md](../README.md)
-   [backend/cache/ServerCache.js](../../backend/cache/ServerCache.js)
-   [backend/utils/inflight.js](../../backend/utils/inflight.js)
-   [backend/middleware/quota.js](../../backend/middleware/quota.js)
-   [backend/ingestion/readModels.js](../../backend/ingestion/readModels.js)
-   [PROJECT_GUIDE](../20-Reference/Legacy Project Guide)
-   [frontend/src/contexts/AuthContext.tsx](../../frontend/src/contexts/AuthContext.tsx)
-   [frontend/src/contexts/OrganizationContext.tsx](../../frontend/src/contexts/OrganizationContext.tsx)
-   [frontend/src/hooks/queries/useAnalyticsQuery.ts](../../frontend/src/hooks/queries/useAnalyticsQuery.ts)
-   [frontend/src/hooks/queries/useChannelAnalyticsQuery.ts](../../frontend/src/hooks/queries/useChannelAnalyticsQuery.ts)
-   [frontend/src/hooks/useAuth.ts](../../frontend/src/hooks/useAuth.ts)
-   [frontend/src/hooks/useDashboardAnalytics.ts](../../frontend/src/hooks/useDashboardAnalytics.ts)
-   [frontend/src/hooks/useOrganization.ts](../../frontend/src/hooks/useOrganization.ts)
-   [frontend/src/machines/dashboardMachine.ts](../../frontend/src/machines/dashboardMachine.ts)
-   [frontend/src/services/userService.ts](../../frontend/src/services/userService.ts)
-   [frontend/src/stores/dashboardStore.ts](../../frontend/src/stores/dashboardStore.ts)
-   [frontend/src/styles/design-tokens.css](../../frontend/src/styles/design-tokens.css)
-   [frontend/src/utils/resolveVideoAnomalyInsights.ts](../../frontend/src/utils/resolveVideoAnomalyInsights.ts)

This page defines codebase-specific terms, abbreviations, and domain concepts used throughout RevTube (TubeKeter Analytics). It serves as a technical reference for onboarding engineers to understand the mapping between natural language business logic and specific code entities.

## 1\. Core Domain Concepts

| Term | Definition | Key Code Entities |
| --- | --- | --- |
| Bundle | A consolidated data package containing metrics for multiple periods (current, previous, d7, d30, d90). | `getDashboardBundle` [frontend/src/services/analyticsService.ts](../../frontend/src/services/analyticsService.ts) `loadBundleFromPostgres` [backend/ingestion/readModels.js#166](../../backend/ingestion/readModels.js) |
| Workspace Key | A unique string identifying the current data context (User vs. Organization). | `getDashboardWorkspaceKey` [frontend/src/utils/dashboardWorkspaceScope.ts](../../frontend/src/utils/dashboardWorkspaceScope.ts) `workspaceKey` [frontend/src/hooks/queries/useAnalyticsQuery.ts#64-69](../../frontend/src/hooks/queries/useAnalyticsQuery.ts) |
| True Delta | An analytics mode that anchors comparison periods to a fixed 8-day offset to account for YouTube's 48-72 hour data lag. | `trueDeltaEnabled` [frontend/src/hooks/queries/useChannelAnalyticsQuery.ts#60](../../frontend/src/hooks/queries/useChannelAnalyticsQuery.ts) `periodWindow` [frontend/src/hooks/queries/useChannelAnalyticsQuery.ts#115-121](../../frontend/src/hooks/queries/useChannelAnalyticsQuery.ts) |
| Ingestion | The process of syncing data from YouTube APIs into the local PostgreSQL analytics store. | `runPostgresIngestion` [backend/cron.js](../../backend/cron.js) `ingestChannelDaily` [backend/ingestion/sync.js](../../backend/ingestion/sync.js) |
| Usage Limit | Tiered quotas (Free/Pro) governing API calls and data access. | `requireQuota`/`consumeQuota` [backend/middleware/quota.js](../../backend/middleware/quota.js) | `UsageLimitError` [frontend/src/services/analyticsService.ts#3](../../frontend/src/services/analyticsService.ts) |

Sources: [frontend/src/hooks/queries/useAnalyticsQuery.ts#64-69](../../frontend/src/hooks/queries/useAnalyticsQuery.ts) [backend/ingestion/readModels.js#166-201](../../backend/ingestion/readModels.js) [frontend/src/hooks/queries/useChannelAnalyticsQuery.ts#60-125](../../frontend/src/hooks/queries/useChannelAnalyticsQuery.ts) [PROJECT_GUIDE#72-76](../20-Reference/Legacy Project Guide)

___

## 2\. Backend & Data Infrastructure

### ServerCache & Redis

The system employs a dual-layer caching strategy via [cache/ServerCache.js](../../backend/cache/ServerCache.js). It defaults to an in-memory `Map` (max 1000 entries, 24h TTL) but promotes to Redis if `REDIS_URL` is provided.

-   In-Flight Deduplication ([utils/inflight.js](../../backend/utils/inflight.js)): Prevents "cache stampede" by tracking active requests in `DASHBOARD_INFLIGHT` and using `withInFlightTimeout` to share a single promise across concurrent identical requests.
-   Compression ([cache/ServerCache.js](../../backend/cache/ServerCache.js)): Payloads exceeding ~1KB are gzipped before storage to minimize memory footprint.

### Read Models

Read models are optimized PostgreSQL queries that bypass the expensive YouTube API when materialized data is available.

-   `loadBundleFromPostgres`: Aggregates daily metrics into the standard dashboard bundle format [backend/ingestion/readModels.js#166-201](../../backend/ingestion/readModels.js)
-   `getLatestMetricDate`: Determines the "anchor" date for a channel's available data in the DB [backend/ingestion/readModels.js#25-38](../../backend/ingestion/readModels.js)

### Data Flow: Request to Storage

The following diagram bridges the natural language concept of "Fetching Analytics" to the specific code functions involved.

Analytics Fetching Pipeline

Sources: [cache/ServerCache.js](../../backend/cache/ServerCache.js) [utils/inflight.js](../../backend/utils/inflight.js) [backend/ingestion/readModels.js#166-201](../../backend/ingestion/readModels.js) [frontend/src/hooks/queries/useAnalyticsQuery.ts#137-147](../../frontend/src/hooks/queries/useAnalyticsQuery.ts) [PROJECT_GUIDE#56-65](../20-Reference/Legacy Project Guide)

___

## 3\. Frontend Architecture

### Dashboard State Management

RevTube uses a hybrid state approach:

1.  Zustand (`useDashboardStore`): Manages UI state, filters, and current selections [frontend/src/stores/dashboardStore.ts#186-189](../../frontend/src/stores/dashboardStore.ts)
2.  XState (`dashboardMachine`): Orchestrates tab transitions and high-level loading sequences [frontend/src/machines/dashboardMachine.ts#31-131](../../frontend/src/machines/dashboardMachine.ts)
3.  TanStack Query: Handles server state, caching, and background refetching [frontend/src/hooks/queries/useAnalyticsQuery.ts#104-161](../../frontend/src/hooks/queries/useAnalyticsQuery.ts)

### Component Definitions

-   Layout Rail: The sidebar and top bar navigation system [frontend/src/styles/design-tokens.css#43-48](../../frontend/src/styles/design-tokens.css)
-   Design Tokens: CSS variables (e.g., `--rt-color-accent`) that serve as the single source of truth for the UI [frontend/src/styles/design-tokens.css#7-15](../../frontend/src/styles/design-tokens.css)
-   Anomaly Insights: Heuristics that detect view spikes or dips by comparing current metrics to historical averages [frontend/src/utils/resolveVideoAnomalyInsights.ts](../../frontend/src/utils/resolveVideoAnomalyInsights.ts)

### State Interaction Diagram

This diagram maps UI interactions to the specific state management entities.

UI State Transition Map

Sources: [frontend/src/stores/dashboardStore.ts#153-163](../../frontend/src/stores/dashboardStore.ts) [frontend/src/machines/dashboardMachine.ts#43-53](../../frontend/src/machines/dashboardMachine.ts) [frontend/src/hooks/queries/useAnalyticsQuery.ts#104-121](../../frontend/src/hooks/queries/useAnalyticsQuery.ts) [README.md#27-36](../README.md)

___

## 4\. Authentication & Authorization

| Term | Implementation Detail |
| --- | --- |
| Auth Hint | A lightweight localStorage object (`revtube:auth-hint:v1`) used to provide an "optimistic" authenticated state before Firebase fully initializes [frontend/src/contexts/AuthContext.tsx#16-17](../../frontend/src/contexts/AuthContext.tsx) |
| Profile Cache | Cached user role and package data (`revtube:auth-profile:v1`) to prevent UI flickering on reload [frontend/src/contexts/AuthContext.tsx#14-15](../../frontend/src/contexts/AuthContext.tsx) |
| Effective Token | A logic wrapper that resolves whether to use a personal YouTube OAuth token or an organization-wide shared token [frontend/src/hooks/queries/useAnalyticsQuery.ts#129-132](../../frontend/src/hooks/queries/useAnalyticsQuery.ts) |
| Org Context Cache | Stores the `currentOrganization` and `currentMember` details for a user to maintain context across sessions [frontend/src/contexts/OrganizationContext.tsx#15-19](../../frontend/src/contexts/OrganizationContext.tsx) |

Sources: [frontend/src/contexts/AuthContext.tsx#14-56](../../frontend/src/contexts/AuthContext.tsx) [frontend/src/contexts/OrganizationContext.tsx#15-46](../../frontend/src/contexts/OrganizationContext.tsx) [frontend/src/hooks/queries/useAnalyticsQuery.ts#129-134](../../frontend/src/hooks/queries/useAnalyticsQuery.ts)

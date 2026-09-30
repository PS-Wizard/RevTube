## Project Overview

Relevant source files

-   [CHANGELOG.md](../../CHANGELOG.md)
-   [README.md](../README.md)
-   [backend/README.md](../../backend/README.md)
-   [docker-compose.yml](../../docker-compose.yml)
-   [PROJECT_GUIDE](../20-Reference/Legacy Project Guide)
-   [frontend/src/machines/dashboardMachine.ts](../../frontend/src/machines/dashboardMachine.ts)

RevTube (also known as TubeKeter Analytics) is a high-performance, enterprise-grade YouTube channel analytics and list management platform. It provides creators and organizations with deep insights into channel performance, video trends, and audience demographics through a centralized dashboard.

The system is designed with a "PostgreSQL-first" analytics strategy, where daily metrics are ingested from the YouTube Analytics API and materialized into a local relational store to enable low-latency, complex querying that exceeds the performance of direct API proxying [PROJECT_GUIDE#3-9](../20-Reference/Legacy Project Guide)

## System Capabilities

-   Multi-Tenant Analytics: Support for individual creators and large organizations with role-based access control (Owner, Admin, Write) [backend/README.md#14-17](../../backend/README.md)
-   Performance Caching: A two-tier caching strategy utilizing Redis for persistent storage and an in-memory LRU fallback for extreme low-latency [backend/README.md#88-96](../../backend/README.md)
-   Data Ingestion: Automated daily syncs that map YouTube API JSON responses into optimized PostgreSQL tables for videos and daily metrics [PROJECT_GUIDE#101-105](../20-Reference/Legacy Project Guide)
-   Usage Governance: Tiered subscription enforcement (Free vs. Pro) with monthly quota tracking that only increments on cache misses [backend/README.md#129-134](../../backend/README.md)

## Full-Stack Architecture

RevTube is structured as a React Single Page Application (SPA) communicating with a Node.js/Express REST API. The infrastructure is containerized using Docker Compose, orchestrating the frontend, backend, Redis, and PostgreSQL services [PROJECT_GUIDE#7-9](../20-Reference/Legacy Project Guide)

### High-Level Component Interaction

The following diagram illustrates the flow of data from the browser through the proxy layer to the core services and external APIs.

System Architecture Flow

Sources: [PROJECT_GUIDE#11-65](../20-Reference/Legacy Project Guide) [README.md#56-83](../README.md)

## Key Technologies

## Code-to-System Mapping

To navigate the codebase effectively, it is essential to understand how logical system components map to specific directories and files.

Backend Service Mapping

Sources: [PROJECT_GUIDE#91-105](../20-Reference/Legacy Project Guide) [README.md#114-126](../README.md)

Frontend Dashboard Mapping

Sources: [PROJECT_GUIDE#118-121](../20-Reference/Legacy Project Guide) [README.md#101-110](../README.md)

## Subsystem Relationships

1.  Authentication & API Proxying: The client authenticates via Firebase. The backend `authenticateRequest` middleware validates the Firebase token, while `resolveOrgToken` handles switching between personal and organizational YouTube OAuth credentials stored in Firestore [CHANGELOG.md#13](../../CHANGELOG.md) [PROJECT_GUIDE#72-74](../20-Reference/Legacy Project Guide)
2.  Analytics Pipeline: The `ingestChannelDaily` function (triggered by `cron.js`) pulls data from YouTube and populates PostgreSQL. When a user views the dashboard, the `loadBundleFromPostgres` read model fetches this data, which is then cached in Redis by the `ServerCache` layer [PROJECT_GUIDE#101-105](../20-Reference/Legacy Project Guide) [backend/README.md#90-96](../../backend/README.md)
3.  UI State Management: The `dashboardStore.ts` (Zustand) manages filters and selections, while `dashboardMachine.ts` (XState) ensures that the UI transitions correctly between loading, success, and error states during data fetches [frontend/src/machines/dashboardMachine.ts#31-40](../../frontend/src/machines/dashboardMachine.ts) [README.md#109-110](../README.md)

___

## Detailed Documentation

For deeper technical dives into specific areas of the system, refer to the following child pages:

-   [Getting Started & Environment Setup](01-Getting Started & Environment Setup.md): Instructions for local development, Docker setup, and configuring external API keys.
-   [System Architecture](02-System Architecture.md): A deep dive into the networking, database schemas, and the "PostgreSQL-first" data strategy.
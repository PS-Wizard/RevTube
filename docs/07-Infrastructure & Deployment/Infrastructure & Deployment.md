## Infrastructure & Deployment

Relevant source files

-   [backend/Dockerfile](../../backend/Dockerfile)
-   [backend/README.md](../../backend/README.md)
-   [docker-compose.yml](../../docker-compose.yml)
-   [frontend/Dockerfile](../../frontend/Dockerfile)

This page provides a high-level overview of the infrastructure topology, containerization strategy, and data persistence layers used in the RevTube (TubeKeter Analytics) ecosystem. The system is designed to be portable and scalable using Docker, with a focus on high-performance data retrieval via a multi-tier caching and storage strategy.

## System Topology

The application is deployed as a suite of four interconnected services managed via Docker Compose. This architecture separates the concerns of static content delivery, application logic, volatile caching, and persistent relational storage.

### Deployment Architecture Diagram

The following diagram illustrates the relationship between the containerized services and their respective code-defined roles.

Sources: [docker-compose.yml#1-142](../../docker-compose.yml) [backend/README.md#75-86](../../backend/README.md)

## Containerization Strategy

The project utilizes multi-stage Docker builds to optimize image size and security.

-   Frontend: A React SPA built using Vite, served by an Nginx instance. Environment variables are injected at build-time as `ARG` values to be bundled into the static assets [frontend/Dockerfile#21-38](../../frontend/Dockerfile)
-   Backend: A Node.js service using `pnpm` for efficient dependency management. It runs on `node:22-alpine` and utilizes a non-root user for enhanced security [backend/Dockerfile#18-34](../../backend/Dockerfile)
-   Health Checks: Every service includes a `HEALTHCHECK` instruction using `curl` or native CLI tools (like `pg_isready`) to ensure the orchestration layer (e.g., Coolify or Docker Compose) can monitor service viability [docker-compose.yml#13-17](../../docker-compose.yml) [docker-compose.yml#31-35](../../docker-compose.yml) [docker-compose.yml#82-87](../../docker-compose.yml)

For a deep dive into environment variables, Traefik routing, and Nginx configurations, see [Docker & Deployment Configuration](01-Docker & Deployment Configuration.md).

## Persistence & Caching Layers

RevTube employs a three-tier data strategy to balance real-time YouTube API constraints with the need for fast dashboard loads.

| Layer | Technology | Role | Persistence |
| --- | --- | --- | --- |
| Primary Store | PostgreSQL | Materialized analytics, video metadata, and sync logs. | Permanent (Volume-backed) |
| Cache Layer | Redis | API response caching, OAuth token storage, org membership, **and BullMQ job queues**. | Volatile (LRU Eviction) |
| Transient Store | Firestore | User profiles, organization memberships, and encrypted credentials. | External (Managed) |

### Code-to-Infrastructure Mapping

This diagram bridges the code-level configuration to the infrastructure components.

Sources: [backend/README.md#88-96](../../backend/README.md) [docker-compose.yml#29](../../docker-compose.yml) [backend/README.md#44-45](../../backend/README.md)

### Database Management

The PostgreSQL instance stores the results of daily ingestion runs. This allows the dashboard to load massive datasets (e.g., `analytics_video_metrics_daily`) without hitting YouTube API quotas on every page refresh [backend/README.md#19-20](../../backend/README.md) The schema is managed via a custom migration runner.

For details on the table structures and the migration lifecycle, see [Database Schema & Migrations](02-Database Schema & Migrations.md).

## Environment & Secrets

Security is enforced by strict `.gitignore` rules and the use of environment variables for all sensitive credentials, including Firebase Service Accounts and YouTube API keys [backend/README.md#3-10](../../backend/README.md) In production environments like Coolify, these are injected via the container runtime [docker-compose.yml#50-75](../../docker-compose.yml)

Sources: [backend/README.md#30-47](../../backend/README.md) [frontend/Dockerfile#21-28](../../frontend/Dockerfile)
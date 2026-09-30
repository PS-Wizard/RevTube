## Docker & Deployment Configuration

Relevant source files

-   [backend/Dockerfile](../../backend/Dockerfile)
-   [backend/README.md](../../backend/README.md)
-   [backend/db/client.js](../../backend/db/client.js)
-   [backend/db/migrate.js](../../backend/db/migrate.js)
-   [backend/db/schema.js](../../backend/db/schema.js)
-   [backend/drizzle.config.js](../../backend/drizzle.config.js)
-   [backend/start.sh](../../backend/start.sh)
-   [docker-compose.yml](../../docker-compose.yml)
-   [frontend/Dockerfile](../../frontend/Dockerfile)

The RevTube application is containerized using a multi-service Docker topology designed for high availability, persistent caching, and automated database management. The deployment architecture leverages Docker Compose for orchestration, Nginx as a reverse proxy, and a two-tier storage system involving PostgreSQL and Redis.

## System Topology

The infrastructure consists of four primary services orchestrated via `docker-compose.yml`. Communication between services occurs over an internal Docker network, with only the frontend and backend exposing ports to the host or load balancer.

### Service Architecture

-   Frontend: A React SPA served by Nginx. It acts as the primary entry point.
-   Backend: A Node.js/Express API that handles business logic, YouTube API integration, and scheduled tasks.
-   Redis: A high-performance key-value store used for the `ServerCache` system, OAuth token caching, and **BullMQ job queues** (ingestion, cache-warming, email delivery).
-   PostgreSQL: The primary relational database for analytics read models and dashboard snapshots.

### Deployment Component Map

The following diagram maps the logical infrastructure components to their specific code entities and configuration blocks.

"Deployment Entity Mapping"

Sources: [docker-compose.yml#1-142](../../docker-compose.yml) [backend/Dockerfile#1-43](../../backend/Dockerfile) [frontend/Dockerfile#1-57](../../frontend/Dockerfile)

___

## Service Configurations

### 1\. PostgreSQL (Data Store)

The `postgres` service uses the `postgres:16-alpine` image [docker-compose.yml#3](../../docker-compose.yml) It is configured with a health check using `pg_isready` to ensure the database is accepting connections before the backend attempts to start [docker-compose.yml#13-17](../../docker-compose.yml)

-   Persistence: Data is persisted in the `postgres-data` volume [docker-compose.yml#10-11](../../docker-compose.yml)
-   Resources: Memory is limited to 512MB in the deploy configuration [docker-compose.yml#21](../../docker-compose.yml)

### 2\. Redis — Cache Layer

The `redis` service uses `redis:7-alpine` [docker-compose.yml#24](../../docker-compose.yml) for analytics cache, OAuth tokens, and rate limiter data.

-   Eviction Policy: `allkeys-lru` with `maxmemory` 256MB [docker-compose.yml#33](../../docker-compose.yml). Old cache entries are automatically evicted when memory fills.
-   Persistence: Uses AOF (`--appendonly yes`) to survive container restarts [docker-compose.yml#33](../../docker-compose.yml)
-   Container Limit: 384MB [docker-compose.yml#48](../../docker-compose.yml)

### 3\. Redis — Queue Layer (BullMQ)

An additional `redis-queue` service [docker-compose.yml#53](../../docker-compose.yml) is dedicated to BullMQ job state, locks, and stalled-job detection. This isolation prevents cache eviction from ever interfering with queue integrity.

-   Eviction Policy: `noeviction` with `maxmemory` 64MB [docker-compose.yml#65](../../docker-compose.yml). BullMQ creates short-lived Redis TTL keys for locks and stall detection; any eviction policy that removes TTL-bearing keys can cause duplicate processing and stuck jobs.
-   Persistence: Uses AOF (`--appendonly yes`) [docker-compose.yml#65](../../docker-compose.yml)
-   Container Limit: 128MB [docker-compose.yml#80](../../docker-compose.yml)

### 4\. Backend (API & Worker)

The backend container manages both the REST API and the background cron jobs.

-   Startup Logic: The container executes `start.sh`, which performs a TCP check on the PostgreSQL port before running migrations via `db/migrate.js` [backend/start.sh#12-33](../../backend/start.sh). The backend Dockerfile is a multi-stage build that auto-generates Drizzle ORM migrations: Stage 1 installs all deps (including `drizzle-kit`), runs `npx drizzle-kit generate`, then prunes to production-only. The generated `.sql` files are copied into the runtime image and applied at startup via `node db/migrate.js` (hash-based SQL runner).
-   Environment Injection: It consumes `REDIS_URL` (cache), `QUEUE_REDIS_URL` (BullMQ), and `POSTGRES_HOST` variables to connect to the internal service network [docker-compose.yml#82-84](../../docker-compose.yml)

### 5\. Frontend (Nginx Proxy)

The frontend is a multi-stage build. The first stage builds the React application using `pnpm`, while the second stage serves the static files using `nginx:stable-alpine` [frontend/Dockerfile#1-41](../../frontend/Dockerfile)

-   Nginx Role: Serves the SPA and handles client-side routing by redirecting non-file requests to `index.html`.
-   Environment Variables: Since Vite embeds variables at build time, these must be passed as `ARG` during the Docker build process [frontend/Dockerfile#21-38](../../frontend/Dockerfile)

Sources: [docker-compose.yml#2-101](../../docker-compose.yml) [backend/start.sh#1-43](../../backend/start.sh) [backend/db/migrate.js#14-47](../../backend/db/migrate.js)

___

## Deployment & Variable Injection

RevTube is designed for deployment on platforms like Coolify or generic Traefik-based VPS setups.

### Environment Variable Flow

The application distinguishes between server-side runtime variables and client-side build-time variables.

| Variable Type | Mechanism | Target Service |
| --- | --- | --- |
| Runtime | `environment` in Compose | Backend, Postgres, Redis |
| Build-Time | `args` in Dockerfile | Frontend (VITE\_\*) |

For the frontend, the `docker-compose.yml` passes variables like `VITE_FIREBASE_API_KEY` as build arguments [docker-compose.yml#103-114](../../docker-compose.yml) These are then used by the `pnpm build` command in the Dockerfile to bake the configuration into the JS bundle [frontend/Dockerfile#30-38](../../frontend/Dockerfile)

### Health Checks & Dependency Management

The stack uses a strict dependency graph to prevent race conditions during startup:

1.  Postgres/Redis Health: The backend waits for `service_healthy` status from both storage providers [docker-compose.yml#76-80](../../docker-compose.yml)
2.  Backend Health: Verified via a `GET /health` request [backend/Dockerfile#39-40](../../backend/Dockerfile)
3.  Frontend Health: Verified by checking if the Nginx server returns a 200 OK for the root path [frontend/Dockerfile#53-54](../../frontend/Dockerfile)

### Startup & Migration Data Flow

"Backend Initialization Sequence"

Sources: [backend/start.sh#6-39](../../backend/start.sh) [backend/db/migrate.js#5-12](../../backend/db/migrate.js) [backend/db/client.js#19-21](../../backend/db/client.js)

___

## Reverse Proxy Configuration

The Nginx configuration within the frontend container serves two purposes: static file delivery and API request forwarding.

-   Static Assets: Files are served from `/usr/share/nginx/html` [frontend/Dockerfile#47](../../frontend/Dockerfile)
-   SPA Routing: The configuration includes a `try_files $uri /index.html` directive (implied by standard SPA Nginx patterns) to support React Router.
-   API Proxy: Requests to `/api` are typically proxied to the `backend:3000` service within the Docker network.
-   Security: The backend implementation uses `authLimiter` which relies on `req.authUser` rather than just IP addresses [backend/README.md#107-111](../../backend/README.md) This prevents the "Gateway IP Collapse" issue where all users behind the Nginx proxy appear as a single IP (`172.18.0.1`) to the rate limiter.

Sources: [backend/README.md#100-112](../../backend/README.md) [frontend/Dockerfile#48-50](../../frontend/Dockerfile) [docker-compose.yml#116-122](../../docker-compose.yml)
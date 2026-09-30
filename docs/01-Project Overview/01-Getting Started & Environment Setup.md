## Getting Started & Environment Setup

Relevant source files

- [backend/Dockerfile](../../backend/Dockerfile)
- [backend/README.md](../../backend/README.md)
- [backend/db/client.js](../../backend/db/client.js)
- [backend/db/migrate.js](../../backend/db/migrate.js)
- [backend/package.json](../../backend/package.json)
- [backend/start.sh](../../backend/start.sh)
- [docker-compose.yml](../../docker-compose.yml)
- [example.env](../../example.env)
- [frontend/.env.example](../../frontend/.env.example)
- [frontend/Dockerfile](../../frontend/Dockerfile)
- [frontend/README.md](../../frontend/README.md)
- [frontend/src/config/firebase.ts](../../frontend/src/config/firebase.ts)
- [frontend/src/vite-env.d.ts](../../frontend/src/vite-env.d.ts)
- [frontend/tsconfig.json](../../frontend/tsconfig.json)
- [frontend/vite.config.ts](../../frontend/vite.config.ts)

This page provides a comprehensive technical guide for setting up the RevTube (TubeKeter Analytics) development environment. It covers prerequisites, external service configuration (Firebase/Google OAuth), environment variable mapping, and local orchestration using Docker Compose.

## Purpose and Scope

The goal of this setup is to establish a functional local environment that mirrors production as closely as possible. This includes a React frontend (Vite), a Node.js/Express backend, a PostgreSQL database for analytics ingestion, and a Redis instance for caching.

## Prerequisites

Before beginning, ensure the following tools are installed:

- Node.js: v18 or higher [frontend/README.md#20](../../frontend/README.md)
- pnpm: v10.33.2 (pinned version) [backend/package.json#6](../../backend/package.json) [frontend/Dockerfile#7](../../frontend/Dockerfile)
- Docker & Docker Compose: For running the database and cache layers [docker-compose.yml#1-148](../../docker-compose.yml)
- Google Cloud Account: For YouTube Data API v3 and OAuth credentials [frontend/README.md#76-81](../../frontend/README.md)
- Firebase Project: For Authentication and Firestore [frontend/README.md#44-47](../../frontend/README.md)

---

## 1\. External Service Configuration

RevTube relies on Google and Firebase for identity and data.

### Google Cloud Console (YouTube API & OAuth)

1.  Enable API: Enable the YouTube Data API v3 [frontend/README.md#79](../../frontend/README.md)
2.  API Key: Create an API Key for public data fetching [frontend/README.md#80-81](../../frontend/README.md)
3.  OAuth Credentials:
    - Create an OAuth 2.0 Client ID (Web application).
    - Set the Authorized redirect URIs to match your environment (e.g., `http://localhost:5173/oauth-callback.html` for local dev) [frontend/.env.example#19-21](../../frontend/.env.example)
    - Note the `Client ID` and `Client Secret`.

### Firebase Console

1.  Authentication: Enable the Google provider [frontend/README.md#50](../../frontend/README.md)
2.  Firestore: Initialize a Firestore database in "Production" or "Test" mode.
3.  Service Account: Navigate to Project Settings > Service Accounts and click Generate new private key. This JSON file is required by the backend to verify tokens and manage organizations [example.env#27-30](../../example.env)

---

## 2\. Environment Variables

The project uses `.env` files to manage secrets and configuration. Copy the provided examples to start:

- `cp example.env .env` (Root/Backend)
- `cp frontend/.env.example frontend/.env` (Frontend)

### Key Variable Mapping

Sources: [example.env#1-92](../../example.env) [frontend/.env.example#1-42](../../frontend/.env.example) [backend/README.md#30-48](../../backend/README.md)

---

## 3\. Data Flow: Environment to Code

The following diagram illustrates how environment variables are consumed by specific code entities during the initialization phase.

### Configuration Injection Diagram

Sources: [frontend/src/config/firebase.ts#6-42](../../frontend/src/config/firebase.ts) [backend/db/client.js#1-10](../../backend/db/client.js) [frontend/vite.config.ts#6-21](../../frontend/vite.config.ts) [example.env#1-92](../../example.env)

---

## 4\. Local Development Setup

### Option A: Docker Compose (Recommended)

The project includes a `docker-compose.yml` that orchestrates all four major services.

1.  Ensure all variables in `.env` are filled.
2.  Run the stack:
3.  Automated Migrations: The `backend` service runs `start.sh`, which waits for PostgreSQL to be reachable via `net.createConnection` and then executes `node db/migrate.js` [backend/start.sh#12-33](../../backend/start.sh)

### Option B: Manual Process

If running services individually:

1.  Infrastructure: Start Redis and Postgres (e.g., via Docker).
2.  Backend:

    ```
    <p><span><span>cd</span><span> </span><span>backend</span></span></p><p><span><span>pnpm</span><span> </span><span>install</span></span></p><p><span><span>pnpm</span><span> </span><span>run</span><span> </span><span>db:migrate</span><span>  </span><span># Initialize schema [backend/package.json:10-10]</span></span></p><p><span><span>pnpm</span><span> </span><span>dev</span><span>             </span><span># Starts with --watch [backend/package.json:9-9]</span></span></p>
    ```

3.  Frontend:

    ```
    <p><span><span>cd</span><span> </span><span>frontend</span></span></p><p><span><span>pnpm</span><span> </span><span>install</span></span></p><p><span><span>pnpm</span><span> </span><span>dev</span><span>             </span><span># Starts Vite dev server [frontend/README.md:67-67]</span></span></p>
    ```

---

## 5\. System Initialization Flow

When the backend starts, it follows a specific sequence to ensure data integrity and connectivity.

### Startup Sequence Diagram

Sources: [backend/start.sh#1-43](../../backend/start.sh) [backend/package.json#8-10](../../backend/package.json) [docker-compose.yml#41-81](../../docker-compose.yml)

---

## 6\. Verification & Health Checks

Once running, you can verify the status of the environment:

- Frontend: Accessible at `http://localhost:8081` (Docker) or `http://localhost:5173` (Manual) [docker-compose.yml#120](../../docker-compose.yml)
- Backend Health: `GET http://localhost:3000/health` should return a 200 OK [backend/Dockerfile#40](../../backend/Dockerfile)
- Cache Stats (Admin): `GET /api/admin/cache/stats` (requires admin auth) [backend/README.md#155](../../backend/README.md)
- Database: Connect to PostgreSQL on port 5432 and verify the `schema_migrations` table exists [backend/start.sh#33](../../backend/start.sh)

### Common Setup Issues

- `redirect_uri_mismatch`: Ensure the URI in Google Cloud Console exactly matches the one used by the frontend. You can hardcode this via `VITE_OAUTH_REDIRECT_URI` [frontend/.env.example#19-21](../../frontend/.env.example)
- Firestore Connectivity: In some environments (like Firefox or behind strict proxies), Firestore's WebChannel can fail. The app automatically detects Firefox and forces `experimentalForceLongPolling: true` [frontend/src/config/firebase.ts#24-42](../../frontend/src/config/firebase.ts)

Sources: [frontend/src/config/firebase.ts#21-42](../../frontend/src/config/firebase.ts) [backend/README.md#100-112](../../backend/README.md) [docker-compose.yml#1-148](../../docker-compose.yml)

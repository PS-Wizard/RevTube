# Stage 1: Install production dependencies only.
# devDeps (drizzle-kit, vitest) are NOT needed in the runtime image: migrations
# run via `node db/migrate.js` (drizzle-orm is a prod dep) and drizzle-kit is
# only invoked in the separate migrations stage when GENERATE_DB_MIGRATIONS=true
# (development builds). This replaces the old install-all + pnpm prune flow,
# which re-linked the whole tree and doubled install time.
FROM node:22-alpine AS dependencies

WORKDIR /app

# Enable corepack and prepare the pinned pnpm version used by this project
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

# Copy package files first for better layer caching
COPY package.json pnpm-lock.yaml ./


RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --prod --frozen-lockfile

# Stage 2: Migration generation (development only).
FROM node:22-alpine AS migrations
WORKDIR /app

ARG GENERATE_DB_MIGRATIONS=false

# Enable corepack and prepare the pinned pnpm version used by this project
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

# Copy package files first for better layer caching
COPY package.json pnpm-lock.yaml ./

# Full install (includes devDeps) ONLY when migration generation is on.
# Production builds pass GENERATE_DB_MIGRATIONS=false (the default), so this
# stage skips the second dependency install entirely and just forwards the
# committed db/drizzle/ via `COPY --from=migrations` below. Previously every
# prod build paid for two installs (prod + full incl. drizzle-kit/vitest/tsc).
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    if [ "$GENERATE_DB_MIGRATIONS" = "true" ]; then \
      pnpm config set store-dir /pnpm/store && \
      pnpm install --frozen-lockfile; \
    fi

# Copy source (schema.js + drizzle.config.js + committed db/drizzle/) into the stage.
COPY . .

# Development convenience: when GENERATE_DB_MIGRATIONS=true, re-run
# `drizzle-kit generate` so any schema drift that wasn't committed yet is turned
# into a fresh .sql file on the fly. Defaults to OFF so production ships exactly
# the committed, reviewed migrations — nothing is auto-generated in prod.
RUN if [ "$GENERATE_DB_MIGRATIONS" = "true" ]; then \
      pnpm exec drizzle-kit generate; \
    fi

# Stage 3: Runtime
FROM node:22-alpine

WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# curl for Docker/Coolify health checks (node:alpine has no wget)
RUN apk add --no-cache curl

# Copy production node_modules from dependency stage
COPY --from=dependencies /app/node_modules ./node_modules

# Copy source files. This includes db/drizzle/, which is read at runtime by
# `node db/migrate.js` (start.sh applies pending migrations on boot).
COPY . .

# Overlay the migration set produced in the migrations stage. When generation was
# off this equals the committed db/drizzle/ (harmless). When it was on, this adds
# any freshly generated migration .sql files that didn't exist in the build context.
COPY --from=migrations /app/db/drizzle ./db/drizzle

RUN sed -i 's/\r$//' ./start.sh && chmod +x ./start.sh

# Use non-root user for security
USER node

EXPOSE 3000

# Healthcheck to ensure service is responding
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/health >/dev/null || exit 1

CMD ["./start.sh"]

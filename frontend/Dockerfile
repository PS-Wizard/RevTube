# Stage 1: Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Enable corepack and prepare the pinned pnpm version used by this project
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

# Copy package files first for dependency caching
COPY package.json pnpm-lock.yaml ./

# Use BuildKit cache mount for pnpm store
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile

# Copy config files (change less often than source)
COPY tsconfig*.json vite.config.ts index.html ./

# Copy source code separately to allow .tsbuildinfo caching
COPY src/ src/
COPY public/ public/

# Pass build-time variables if needed
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_STORAGE_BUCKET
ARG VITE_FIREBASE_MESSAGING_SENDER_ID
ARG VITE_FIREBASE_APP_ID
ARG VITE_BACKEND_URL
ARG VITE_GOOGLE_CLIENT_ID

# Build the SPA only. Typechecking (tsc -b) is intentionally NOT run here --
# it already runs in dev/CI via `pnpm build`, and re-running a full strict
# check of ~380 files on a small production host is the slowest part of this
# image build. `vite build` (esbuild, no typecheck) produces identical output.
# DOCKER_BUILD=true also disables vite's gzip-size reporting (see vite.config.ts).
RUN --mount=type=cache,id=vite-cache,target=/app/node_modules/.vite \
    VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY \
    VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN \
    VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID \
    VITE_FIREBASE_STORAGE_BUCKET=$VITE_FIREBASE_STORAGE_BUCKET \
    VITE_FIREBASE_MESSAGING_SENDER_ID=$VITE_FIREBASE_MESSAGING_SENDER_ID \
    VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID \
    VITE_BACKEND_URL=$VITE_BACKEND_URL \
    VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID \
    DOCKER_BUILD=true \
    pnpm build:docker

# Stage 2: Serve with Nginx
FROM nginx:stable-alpine

# curl for Docker/Coolify health checks (reliable across alpine variants)
RUN apk add --no-cache curl

# Copy build artifacts
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

# Healthcheck to ensure Nginx is serving content
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:80/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]

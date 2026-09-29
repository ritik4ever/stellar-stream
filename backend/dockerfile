# ──────────────────────────────────────────────────────────────────────────────
# Stage 1: builder
#   - Installs ALL dependencies (including devDependencies)
#   - Compiles TypeScript → dist/
# ──────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy manifests first to maximise layer cache reuse
COPY package*.json ./

# Install all deps (including devDeps needed for tsc)
RUN npm ci --ignore-scripts

# Copy source and compile
COPY tsconfig.json ./
COPY src/ ./src/
COPY migrations/ ./migrations/

RUN npm run build

# ──────────────────────────────────────────────────────────────────────────────
# Stage 2: production dependency installer
#   - Installs only production dependencies into a clean prefix
#   - better-sqlite3 requires a native build step (rebuild against Node headers)
# ──────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS prod-deps

WORKDIR /app

COPY package*.json ./

# Install production dependencies only; rebuild native addons
RUN apk add --no-cache python3 make g++ \
    && npm ci --omit=dev --ignore-scripts \
    && npm rebuild better-sqlite3 \
    && apk del python3 make g++

# ──────────────────────────────────────────────────────────────────────────────
# Stage 3: runtime
#   - Minimal image — only compiled JS, prod node_modules, migrations
#   - Runs as non-root user "node" (uid 1000, built into node:alpine)
# ──────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

# Create a data directory with proper ownership for SQLite volume mount
RUN mkdir -p /app/data && chown -R node:node /app/data

WORKDIR /app

# Copy production node_modules and compiled output from earlier stages
COPY --from=prod-deps  --chown=node:node /app/node_modules ./node_modules
COPY --from=builder    --chown=node:node /app/dist         ./dist
COPY --from=builder    --chown=node:node /app/migrations   ./migrations
COPY --chown=node:node package.json ./

# Run as non-root
USER node

EXPOSE 3001

# Healthcheck — lightweight; relies on curl being present in node:alpine
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=10s \
  CMD wget -qO- http://localhost:3001/api/health || exit 1

CMD ["node", "dist/index.js"]

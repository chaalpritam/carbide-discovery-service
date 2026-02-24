# Stage 1: Builder
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files for dependency caching
COPY package.json package-lock.json* ./

# Install all dependencies (including dev for build)
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src/ src/

# Build TypeScript
RUN npm run build

# Stage 2: Runtime
FROM node:20-slim

WORKDIR /app

# Copy built output and production dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Create data directory for SQLite
RUN mkdir -p /data && chown -R node:node /app /data

USER node

VOLUME ["/data"]
EXPOSE 9090

ENV NODE_ENV=production
ENV DATABASE_PATH=/data/carbide-discovery.db

CMD ["node", "dist/server.js"]

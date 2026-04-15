# ── Stage 1: install production dependencies ─────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Copy manifests first so Docker cache skips npm install when only source changes
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Stage 2: production image ─────────────────────────────────────────────────
FROM node:20-alpine AS runner

# Non-root user for least-privilege container execution
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy production node_modules from the deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY server/   ./server/
COPY public/   ./public/
COPY package.json ./

# Ensure writable upload dirs exist with correct ownership before dropping privileges.
# /app/uploads is the mount point for the Azure Files share in production
# (see server/config/paths.js — UPLOAD_ROOT).
RUN mkdir -p /app/public/assets/content /app/uploads/news /app/uploads/party /app/uploads/projects \
 && chown -R appuser:appgroup /app/public/assets /app/uploads

# Drop to non-root user
USER appuser

# Railway injects PORT at runtime; default to 3000 for local docker run
ENV NODE_ENV=production
EXPOSE 3000

# Health check using Node.js (Alpine has no curl/wget by default)
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# Graceful-shutdown-aware start command
CMD ["node", "server/server.js"]

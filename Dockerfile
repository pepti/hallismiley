# ── Stage 1: install production dependencies ─────────────────────────────────
FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS deps

WORKDIR /app

# Copy manifests first so Docker cache skips npm install when only source changes
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Stage 2: production image ─────────────────────────────────────────────────
FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS runner

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

# ── Build identity ───────────────────────────────────────────────────────────
# Stamp server/version.json into the image so the running container can answer
# "which release am I?" — the question the whole self-update mechanism turns on
# (see docs/SELF-UPDATE.md). Build ARGs are exposed to RUN as env vars, which is
# exactly what generate-version.js reads. There is no .git in the build context,
# so GIT_SHA must be passed by CI; without it the stamp reads "unknown", which
# is honest rather than wrong.
#
# These ARGs sit AFTER the source COPYs on purpose: they change on every commit,
# and an ARG invalidates every layer below it. Here they only bust the tiny
# stamp layer, not the ~200 MB node_modules layer above. It must run BEFORE
# USER appuser: the stamp writes /app/server/version.json, which appuser cannot.
ARG APP_VERSION
ARG GIT_SHA
ARG BUILT_AT
ARG RELEASE_CHANNEL
COPY scripts/generate-version.js ./scripts/generate-version.js
RUN node scripts/generate-version.js

# Drop to non-root user
USER appuser

# Azure App Service injects PORT (=8080 by default) at runtime; default to
# 3000 for local docker run.
ENV NODE_ENV=production
EXPOSE 3000


# Health check using Node.js (Alpine has no curl/wget by default)
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# Graceful-shutdown-aware start command
CMD ["node", "server/server.js"]

# ── Stage 1: install production dependencies ─────────────────────────────────
FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS deps

WORKDIR /app

# Copy manifests first so Docker cache skips npm install when only source changes
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Stage 2: production image ─────────────────────────────────────────────────
FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS runner

# Apply Alpine security updates on top of the pinned digest (ice #230).
#
# The digest is what makes the build reproducible, and it is also what freezes
# the OS packages inside it: when Alpine ships a fix, the image stays vulnerable
# until the upstream Node image is rebuilt — days, and outside our control. Not
# theoretical: the repo's FIRST CI run (2026-09-03, PR #2) red-gated on
# CVE-2026-14456 (openssl DoS: libcrypto3/libssl3 3.5.7-r0, fixed in 3.5.8-r0)
# with the newest published node:24-alpine still carrying the vulnerable build.
# `apk upgrade` patches the installed packages from the current Alpine branch
# repositories, so the pinned digest stays the reproducible base while the
# security fixes ride on top. Runner stage only: the deps stage contributes
# node_modules and nothing of its filesystem reaches production.
#
# The layer must NOT be cacheable across builds. deploy.yml builds with a GHA
# layer cache, and a RUN whose instruction string and parent digest never
# change is restored from the first build forever — the packages would be
# frozen exactly as the pin froze them, with a green Trivy scan from CI's
# uncached build to hide it. APK_REFRESH gets a fresh value per build
# (github.run_id) and appears in the instruction, so the cache key changes.
# (`--no-cache` below is apk's flag — keep no package index — not Docker's.)
#
# The same RUN drops the npm CLI the base image bundles. The runtime never
# calls it (CMD, HEALTHCHECK and generate-version.js all run plain node), and
# its vendored dependency tree (tar, undici, brace-expansion, ip-address, …)
# is what Trivy flags as HIGH/CRITICAL node-pkg findings on every scan — none
# of them are our app's dependencies (npm ls shows the patched versions), so
# the only way to stop shipping them is to not ship npm. This does NOT make
# the image smaller: npm lives in the pinned base layer and a delete in a
# later layer only writes overlay whiteouts, so the bytes are still pushed and
# pulled. What changes is the merged filesystem — the one Trivy scans and the
# one a process in this container can reach.
ARG APK_REFRESH=manual
RUN echo "apk refresh ${APK_REFRESH}" && apk upgrade --no-cache \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# Non-root user for least-privilege container execution
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy production node_modules from the deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY server/   ./server/
COPY public/   ./public/
COPY package.json ./

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
# stamp layer, not the ~200 MB node_modules layer above.
ARG APP_VERSION
ARG GIT_SHA
ARG BUILT_AT
ARG RELEASE_CHANNEL
COPY scripts/generate-version.js ./scripts/generate-version.js
RUN node scripts/generate-version.js

# Ensure writable upload dirs exist with correct ownership before dropping privileges.
# /app/uploads is the mount point for the Azure Files share in production
# (see server/config/paths.js — UPLOAD_ROOT).
RUN mkdir -p /app/public/assets/content /app/uploads/news /app/uploads/party /app/uploads/projects \
 && chown -R appuser:appgroup /app/public/assets /app/uploads

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

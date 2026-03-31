# Changelog

All notable changes to Halli Smiley are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

---

## [1.0.0] — 2026-03-30

Initial production release.

### Added
- Vanilla JS SPA with hash-based routing (Home, Projects, About, Admin, Privacy, Terms)
- RS256 JWT authentication with 15-minute access tokens and 7-day refresh token rotation
- Refresh token storage and revocation in PostgreSQL (replay-attack prevention)
- Admin panel for creating, editing, and deleting portfolio projects
- Project filtering by category, featured status, and year
- Pagination support on GET /api/v1/projects (limit/offset query params)
- Featured projects endpoint with 5-minute public Cache-Control
- Contact form endpoint
- Structured HTTP request logging with pino/pino-http
- Sentry error tracking integration (opt-in via SENTRY_DSN env var)
- Global unhandledRejection and uncaughtException process handlers
- Rate limiting: global (200/15 min), auth login (10/15 min), auth refresh (20/15 min), writes (30/15 min)
- Helmet CSP, HSTS, frame protection, Permissions-Policy headers
- CORS whitelist, HPP protection, body size limit (100 KB)
- Gzip compression, ETag/Last-Modified caching on static assets
- No-cache policy on index.html and SPA fallback routes
- robots.txt, sitemap.xml, manifest.json (PWA shell)
- PostgreSQL schema with migration runner, auto-updated `updated_at` trigger
- Token cleanup service (expired/revoked tokens pruned every 24 hours)
- Railway deployment config with Docker multi-stage build and Node.js healthcheck
- HTTPS redirect in production, non-root Docker user
- Comprehensive integration test suite (auth, projects, contact, rate limits, security)

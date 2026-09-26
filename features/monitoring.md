---
id: monitoring
name: {is: "Vöktun", en: Monitoring}
domain: 13
owner: engine
status: live
flag: null
paths:
  - server/routes/eventRoutes.js
  - server/routes/adminEventRoutes.js
  - server/controllers/eventLogController.js
  - server/models/EventLog.js
  - server/services/eventLogCleanup.js
  - server/observability/**
  - server/middleware/eventLogOn5xx.js
  - server/logger.js
  - public/js/views/AdminMonitoringView.js
  - public/js/services/adminEvents.js
  - public/js/services/errorReporter.js
  - public/js/services/usage.js
  - public/css/admin-monitoring.css
  - tests/integration/eventLog.test.js
  - tests/integration/observability.test.js
  - tests/integration/authLoginMetrics.test.js
  - tests/unit/httpMetrics.test.js
  - tests/unit/loggerScrub.test.js
  - tests/unit/aiLogStream.test.js
  - tests/unit/trackedFetch.test.js
  - e2e/admin-monitoring.spec.js
migrations: [087_event_logs]
since: 2026-08-22
origin: null
history: [harvest-1, harvest-2, review-099, harvest-ice-f-2026-09-24]
---

Event logs (087) with the public error beacon, the `/health`, `/ready` and Prometheus `/metrics` endpoints, the DB circuit breaker, memory watch and error-rate alerts in `server/observability`, pino logging with secret scrubbing, and the `/admin/monitoring` screen (which also reads the staff audit log).

**Rules**
- Logs scrub secrets and the `q` param; pino only, no `console.log` (invariant 6).
- `auth_login_attempts_total{result}` is written by authController on every sign-in outcome (`success`, `failure`, `locked`, `refused`, `totp_required`; icelandicstore #55 + harvest2) — a series that is declared is also incremented.
- The client rate-limit toast ignores the error beacon and stays silent before the dictionary loads.
- `/ready` details (`checks`) follow the `/metrics` access rule; `uptime` stays public for `deploy.yml`; admins read the full report at `GET /api/v1/admin/events/health` ([history](../docs/HISTORY.md#ready-and-import-order-2026-09-23)).
- Full rules: [../docs/ARCHITECTURE.md#13-monitoring--event-logs-metrics-analytics](../docs/ARCHITECTURE.md#13-monitoring--event-logs-metrics-analytics).

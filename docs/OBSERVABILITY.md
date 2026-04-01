# Observability Stack

This document describes the production observability setup for the portfolio server.

---

## Table of Contents

1. [Metrics (`/metrics`)](#metrics)
2. [Health Checks](#health-checks)
3. [Structured Logging](#structured-logging)
4. [Security Event Logging](#security-event-logging)
5. [Error Tracking (Sentry)](#error-tracking-sentry)
6. [Alerting](#alerting)
7. [Request Tracing](#request-tracing)
8. [Grafana Setup](#grafana-setup)
9. [Alert Thresholds](#alert-thresholds)
10. [Runbook](#runbook)

---

## Metrics

### Endpoint

```
GET /metrics
Content-Type: text/plain; version=0.0.4
```

**Authentication** (one of):
- Set `METRICS_TOKEN=<secret>` in env and pass `Authorization: Bearer <secret>` header.
- Leave `METRICS_TOKEN` unset — endpoint is then restricted to `127.0.0.1` in production.
- In development/test — no auth required.

### HTTP Metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `http_requests_total` | Counter | `method`, `route`, `status_code` | Total requests completed |
| `http_request_duration_seconds` | Histogram | `method`, `route`, `status_code` | Request latency (buckets: 10ms–10s) |
| `http_request_size_bytes` | Histogram | `method`, `route` | Request body size |
| `http_response_size_bytes` | Histogram | `method`, `route`, `status_code` | Response body size |

### Database Metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `db_pool_total_connections` | Gauge | — | Connections in pool |
| `db_pool_idle_connections` | Gauge | — | Idle connections |
| `db_pool_waiting_clients` | Gauge | — | Clients waiting for a connection |
| `db_query_duration_seconds` | Histogram | `query_name` | Query execution time |

Slow queries (>500 ms) are also logged at `warn` level.

### Auth Metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `auth_login_attempts_total` | Counter | `result` (`success`/`failure`/`locked`) | Login attempts |
| `auth_signup_total` | Counter | `result` (`success`/`failure`) | Signup attempts |
| `auth_active_sessions` | Gauge | — | Active authenticated sessions |

### Business Metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `projects_total` | Gauge | — | Total projects in DB |
| `users_total` | Gauge | `role` | Users by role |
| `media_uploads_total` | Counter | — | Media file uploads |

### Default Node.js Metrics

Collected automatically via `prom-client.collectDefaultMetrics()`:
- `process_cpu_seconds_total`
- `process_resident_memory_bytes`
- `nodejs_heap_size_used_bytes`
- `nodejs_eventloop_lag_seconds`
- `nodejs_gc_duration_seconds` (GC pause time by type)
- HTTP active handles/requests

---

## Health Checks

### `GET /health` — Liveness Probe

Returns `200 OK` if the process is running. Used by the Dockerfile `HEALTHCHECK`.
Does **not** check the database — this ensures the process is never killed during a DB outage.

```json
{
  "status": "ok",
  "uptime": 3600,
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

### `GET /ready` — Readiness Probe

Full system readiness check. Used by Railway's `healthcheckPath`.
Returns `200` only when all critical checks pass; otherwise `503`.

```json
{
  "status": "ok",
  "uptime": 3600,
  "timestamp": "2026-01-01T00:00:00.000Z",
  "checks": {
    "database":      { "status": "ok" },
    "dbPool":        { "status": "ok", "total": 3, "idle": 2, "waiting": 0 },
    "circuitBreaker":{ "status": "ok", "state": "closed" },
    "memory":        { "status": "ok", "heapUsedMb": 80, "heapTotalMb": 128, "ratio": "62.5%" },
    "eventLoop":     { "status": "ok", "lagMs": 1 }
  }
}
```

**Check statuses:**
- `ok` — healthy
- `degraded` — elevated concern but not failing (memory 80–90%, event loop lag >100 ms, pool waiting >5)
- `error` / `critical` — failing (DB unreachable, memory >90%)

---

## Structured Logging

All logs are JSON in production and pretty-printed in development.

**Set `LOG_LEVEL`** in env: `trace | debug | info | warn | error | fatal` (default: `info`).

### Fields

Every log line includes:
- `level` — numeric pino level
- `time` — epoch milliseconds
- `msg` — human-readable message
- `requestId` — unique per-request ID (also sent as `X-Request-ID` header)
- `traceId` — trace ID (honoured from `X-Trace-ID` or generated; echoed as `X-Trace-ID` response header)
- `userId` / `userRole` — present when request is authenticated

### Sensitive Field Redaction

The following fields are automatically redacted:
- `req.headers.authorization`
- `req.headers.cookie`
- `req.body.password`
- `req.body.token`
- `*.password_hash`
- `*.secret`

### Example

```json
{
  "level": 30,
  "time": 1735689600000,
  "msg": "GET /api/v1/projects → 200",
  "requestId": "a1b2c3d4e5f6a7b8",
  "traceId": "deadbeef12345678",
  "userId": "user_123",
  "userRole": "admin",
  "responseTime": 42
}
```

---

## Security Event Logging

All security events are written with `security: true` for easy filtering.

```sh
# Filter security events in production logs
journalctl -u portfolio | jq 'select(.security == true)'
```

| Event | Level | Fields |
|-------|-------|--------|
| `login_failed` | warn | `ip`, `username` |
| `account_locked` | warn | `ip`, `username`, `userId` |
| `login_success` | info | `ip`, `username`, `userId` |
| `rate_limit_hit` | warn | `ip`, `path` |
| `csrf_failure` | warn | `ip`, `path`, `method` |
| `disabled_account_access` | warn | `userId`, `username`, `ip` |
| `signup_attempt` | info | `ip`, `username`, `result` |
| `admin_action` | warn | `adminId`, `action`, `targetId` |
| `alert` | varies | `severity`, `details` |

---

## Error Tracking (Sentry)

Set `SENTRY_DSN` in env to enable.

```
SENTRY_DSN=https://examplePublicKey@o0.ingest.sentry.io/0
```

**What is captured:**
- All unhandled exceptions and promise rejections
- User context (ID, role) attached to events
- Environment tag (`NODE_ENV`)
- Release tag (Railway git commit SHA or `npm_package_version`)
- Trace sample rate: 20% in production, 100% in development

**Express error handler** is wired in `server.js` before the app starts.

---

## Alerting

Configure `ALERT_WEBHOOK_URL` to receive critical alerts in Slack, Discord, or PagerDuty.

### Supported webhooks

**Slack / Discord:** paste the incoming webhook URL directly.
**PagerDuty:** use a PagerDuty Events API v2 webhook endpoint.

### Triggers

| Alert | Severity | Condition |
|-------|----------|-----------|
| Brute-force login | critical | 5+ failed logins from same IP in 5 min |
| High error rate | critical | >5% of requests return 5xx in 5 min window (min 50 requests) |
| High memory | critical | heap usage >90% |
| Health check failure | critical | `/ready` check returns `error` |
| Circuit breaker opened | critical | 3 consecutive DB failures |
| Circuit breaker closed | info | DB recovered |

### Default (no webhook)

Alerts are logged at the appropriate level with `alert: true` and `security: true` fields.

---

## Request Tracing

Every request gets a trace ID.

- If the client sends `X-Trace-ID: <id>`, that value is reused (distributed tracing propagation).
- Otherwise a new random ID is generated.
- The trace ID is echoed back in every response as `X-Trace-ID`.
- The trace ID appears in all log lines for that request (`traceId` field).
- Error responses include `traceId` so users can report it for support.

**Tip:** use the trace ID to correlate logs across microservices if you split the app in the future.

---

## Grafana Setup

1. Add a **Prometheus data source** pointed at your server's `/metrics` endpoint.
   - Set the bearer token under *HTTP Auth → Authorization Header* if `METRICS_TOKEN` is configured.

2. Import the dashboards for Node.js default metrics (Grafana ID **11159** — "Node.js Application Dashboard").

3. **Recommended panels to build:**

```
# Request rate (requests per second)
rate(http_requests_total[1m])

# p99 latency by route
histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, route))

# Error rate
sum(rate(http_requests_total{status_code=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))

# DB pool pressure
db_pool_waiting_clients

# Auth failure rate
rate(auth_login_attempts_total{result="failure"}[5m])

# Memory usage
nodejs_heap_size_used_bytes / nodejs_heap_size_total_bytes
```

---

## Alert Thresholds

| Metric | Warning | Critical |
|--------|---------|---------|
| p99 request latency | >500 ms | >2 s |
| Error rate (5xx) | >1% | >5% |
| DB pool waiting clients | >3 | >8 |
| DB query p99 | >200 ms | >1 s |
| Heap usage | >80% | >90% |
| Event loop lag | >50 ms | >200 ms |
| Login failure rate | >10/min | >30/min |
| Circuit breaker | open | open |

---

## Runbook

### Alert: Brute-force login attempt

1. Check `securityLogger` logs for the offending IP: `jq 'select(.event=="login_failed") | .ip'`
2. Consider adding the IP to an upstream WAF/firewall block list.
3. Verify no accounts were compromised (check `account_locked` events for same IP).

### Alert: High error rate

1. Check error logs: `jq 'select(.level>=50)'` (50 = error in pino)
2. Look for a specific route causing the spike: `jq 'select(.level>=50) | .url'`
3. Check DB connectivity via `/ready`.
4. Roll back the last deploy if the spike correlates with a deployment.

### Alert: High memory usage

1. Check `/ready` for current memory numbers.
2. Inspect `nodejs_gc_duration_seconds` — if GC time is spiking, there may be a memory leak.
3. Restart the process as a short-term fix; investigate heap dumps for root cause.

### Alert: Database circuit breaker opened

1. Check Railway PostgreSQL health dashboard.
2. Check `db_query_duration_seconds` for the query that triggered failures.
3. The circuit will auto-retry after 30 seconds (`half-open` state).
4. Manual recovery: restart the server if the DB is healthy but the circuit won't close.

### Alert: Health check failure

1. Hit `/ready` manually to see which check is failing.
2. `database` failure → check DB connectivity and credentials.
3. `memory` critical → see high memory runbook above.
4. `eventLoop` degraded → check for CPU-blocking code or high GC pressure.

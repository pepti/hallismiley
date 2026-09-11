# SLO.md — Service Levels for Orange Smiley

> **Status:** skeleton scaffolded 2026-08-09. Every `TODO` below must be filled in before go-live (PLAN Phase 5).
> Until then this is a plan, not a commitment — do not quote it to the customer.

This document defines the **SLIs** (what we measure), the **SLOs** (the targets), the **error-budget policy**, and the **customer-facing uptime promise**. It is the authoritative reliability contract for this project; update it as targets and infrastructure change.

---

## 1. Scope & environment model

**The stack:** a single Node.js / Express container (vanilla-JS SPA served from the same origin), backed by PostgreSQL, plus external dependencies. One process, one DB pool.

**Environments:** TODO — describe each tier (e.g. a TEST/eval tier the customer validates on, and the PROD tier the promise below applies to). State which tier the customer-facing promise in §5 covers.

**Explicitly out of scope of the uptime promise:**
- The customer's legacy platform, if it remains the system of record during a parallel run.
- Third-party provider outages, where the app degrades gracefully — tracked as dependency SLIs (§2.4) instead.
- Planned deploy restarts — see the maintenance caveat in §5.

---

## 2. SLI catalog

### 2.1 Availability

Primary signal = **request success rate** = `1 − (5xx responses / total responses)`. A synthetic probe against `/health` is the **zero-traffic backstop** — it answers "is the service reachable at all" when there is no organic traffic to compute a ratio from.

`4xx` responses are **not** failures for availability (client errors, auth gates, validation) — only `5xx` burn the budget.

### 2.2 Latency (per critical journey)

Derive the journeys from this project's route map (`server/app.js` + the controllers), not from a generic list. Fill in:

| Journey | Endpoint(s) | Why it matters |
|---|---|---|
| Browse catalogue (public) | TODO | Public, search-indexable, highest traffic |
| Sign in / session restore | TODO | Gates pricing and ordering |
| Submit order | TODO | The money path |
| TODO — staff/ops journey | TODO | TODO |
| Reports / exports | TODO | Heavy aggregates; tolerant tier |

### 2.3 Correctness / data-integrity (binary invariants)

Not latency — invariants that must **never** be violated, validated by **scheduled audit queries** (§6), target **0 violations**. Cover the load-bearing money and stock paths. Typical set (adapt to this schema):

- No duplicate order numbers.
- No gaps in invoice / credit-note / journal sequences (gapless counters via `SELECT … FOR UPDATE`).
- No discount over-redemption beyond the global or per-customer limit.
- No orphaned stock/ledger movements — every movement reconciles to a balance row.
- No invoice over-payment.

> Confirm exact table and column names against the migration list in `server/config/schema.js` before scheduling these.

### 2.4 Dependencies (degradation contracts)

What matters for the SLO is how the app behaves when each dependency is down:

| Dependency | Hard/soft | Behaviour on failure | Burns availability budget? |
|---|---|---|---|
| PostgreSQL | **Hard** | Circuit breaker opens → `503` on DB routes | Yes |
| Payments (Stripe) | TODO | TODO | TODO |
| Email | Soft | Senders no-op; the action still succeeds | No |
| TODO — accounting/ERP | Soft | Feature-flagged; admin sees "unavailable" | No |
| OAuth providers | Soft | Email/password sign-in still works | No |

---

## 3. SLO targets

28-day rolling window. "p95/p99" are server response time.

| SLI | Initial / eval | Go-live | Source |
|---|---|---|---|
| Site availability (request success) | TODO (e.g. 99.5%) | TODO (e.g. 99.9%) | TODO |
| Catalogue browse latency | TODO | | TODO |
| Sign-in latency | TODO | | TODO |
| Submit-order latency | TODO | | TODO |
| Reports / exports | TODO | | TODO |
| Correctness invariants (§2.3) | **0 violations** | **0 violations** | Scheduled audit queries |

> **Be honest about the infra ceiling.** On a single-instance tier where every deploy restarts the container, 99.9% is not achievable — commit to the number the architecture can actually hold, and record what would have to change to raise it.

---

## 4. Error budget & burn-rate alerting

- **Budget** = `1 − SLO`. At 99.5% that is ~3.6 h per 28 days; at 99.9%, ~40 min.
- **Multi-window burn-rate alerts** (Google-SRE style):
  - **Fast burn** — consuming budget ≥ **14.4×** (≈2% of the budget in 1 h) → page immediately.
  - **Slow burn** — consuming budget ≥ **6×** (≈5% in 6 h) → notify.
- **Policy:** when a window's budget is exhausted, **reliability work takes priority over features** until the SLO recovers.
- Where the alert definitions live today (read 2026-09-11): `server/observability/alerts.js` —
  a flat **5 % error rate over a 5-minute window** (with a request-volume floor), **90 %
  memory**, and **5 failed logins per IP in 5 minutes**, delivered through `ALERT_WEBHOOK_URL`
  and the loud-mail path. The 14.4× / 6× burn-rate alerts above have **no code counterpart**;
  they stay here as the target for when an APM sink exists (ENHANCEMENTS #10).

---

## 5. Customer-facing uptime promise (non-contractual)

> A good-faith service commitment, **not a contract** — no service credits. Applies to the TODO tier.

- **Availability:** TODO monthly uptime.
- **Support response:** TODO for normal issues; TODO for "the store cannot take orders".
- **Planned maintenance:** TODO — disclose any deploy-time restart window honestly, and name the infra change that would remove it.
- **Exclusions:** third-party outages where the app degrades gracefully (§2.4); the customer's legacy platform; force majeure.

---

## 6. Measurement & ownership

| SLI group | Where it is observed | Who responds |
|---|---|---|
| Availability, latency, exceptions, dependencies | TODO (APM) | TODO |
| External reachability (zero-traffic backstop) | TODO (synthetic `/health` probe) | TODO |
| In-app metric detail (pool, query duration, login attempts) | Prometheus `/metrics` + pino logs | TODO |
| Correctness invariants (§2.3) | Scheduled audit queries | TODO |

Write the audit queries as SQL in this section once the schema is settled, and schedule them.

---

## 7. Instrumentation that backs these SLIs

The base ships the observability plumbing — record here what is actually **live** (a wired-but-dark exporter measures nothing):

- **APM / request telemetry** — TODO: is it configured, and behind which env var?
- **HTTP metrics** — `server/observability/httpMetrics.js`: per-route count, duration, sizes.
- **DB query timing + circuit breaker** — `server/config/database.js`.
- **Health/readiness** — `/health` (liveness) and `/ready` (DB + pool + breaker + memory). Note: `/health` does **not** check the DB — `/ready` does. Get this right in the runbook; it is a classic incident-time misdiagnosis.

---

## 8. Known gaps & follow-ups

TODO — list what this version knowingly does not cover, so the next reader does not mistake silence for coverage.

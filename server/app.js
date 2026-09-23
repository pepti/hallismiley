const crypto     = require('crypto');
const express    = require('express');
const logger     = require('./logger');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const hpp        = require('hpp');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const path       = require('path');
const projectRoutes  = require('./routes/projectRoutes');
const authRoutes     = require('./routes/authRoutes');
const contactRoutes  = require('./routes/contactRoutes');
const userRoutes     = require('./routes/userRoutes');
const adminRoutes    = require('./routes/adminRoutes');
const contentRoutes  = require('./routes/contentRoutes');
const newsRoutes     = require('./routes/newsRoutes');
const partyRoutes    = require('./routes/partyRoutes');
const shopRoutes     = require('./routes/shopRoutes');
const adminShopRoutes = require('./routes/adminShopRoutes');
const analyticsRoutes      = require('./routes/analyticsRoutes');
const analyticsAdminRoutes = require('./routes/analyticsAdminRoutes');
const adminGeneralSettingsRoutes = require('./routes/adminGeneralSettingsRoutes');
const adminDiscountRoutes = require('./routes/adminDiscountRoutes');
const adminBackgroundRoutes = require('./routes/adminBackgroundRoutes');
const changeRequestRoutes = require('./routes/changeRequestRoutes');
const adminChangeRequestRoutes = require('./routes/adminChangeRequestRoutes');
const adminNavRoutes = require('./routes/adminNavRoutes');
const adminRolesRoutes = require('./routes/adminRolesRoutes');
const adminBinsRoutes = require('./routes/adminBinsRoutes');
const adminCustomerRoutes = require('./routes/adminCustomerRoutes');
const adminCustomerNotesRoutes = require('./routes/adminCustomerNotesRoutes');
const adminBookkeepingRoutes = require('./routes/adminBookkeepingRoutes');
const systemRoutes = require('./routes/systemRoutes');
const { router: sitemapRoutes } = require('./routes/sitemapRoutes');
const { router: manifestRoutes } = require('./routes/manifestRoutes');
const { router: robotsRoutes } = require('./routes/robotsRoutes');
const shopController = require('./controllers/shopController');
const errorHandler   = require('./middleware/errorHandler');
const { sanitizeBody } = require('./middleware/sanitize');
const { normalizeForwardedFor } = require('./middleware/forwardedFor');
const localeMiddleware = require('./middleware/locale');
const { generateCsrfToken } = require('./middleware/csrf');
const { register, dbPoolTotal, dbPoolIdle, dbPoolWaiting } = require('./observability/metrics');
const httpMetrics     = require('./observability/httpMetrics');
const { dbCircuitBreakerMiddleware, dbCircuitBreaker } = require('./observability/circuitBreaker');
const { healthCheckFailed } = require('./observability/alerts');
const { readMemory } = require('./observability/memoryUsage');
const { safeEqual } = require('./utils/safeEqual');

const app = express();

// Trust the first proxy (Azure App Service's reverse proxy) so req.ip and rate limiting work correctly
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}
// App Service forwards `ip:port`; without this every IP-keyed limiter and the
// brute-force tracker keys per TCP CONNECTION (icelandicstore 2026-09-12; seen
// here 2026-09-22 — see middleware/forwardedFor.js). Must run before any limiter.
app.use(normalizeForwardedFor);

// ── Prometheus HTTP metrics — must be first to capture all requests ────────────
app.use(httpMetrics);

// ── Structured HTTP request logging with pino-http (skipped in test mode) ─────
if (process.env.NODE_ENV !== 'test') {
  const pinoHttp = require('pino-http');
  app.use(pinoHttp({
    logger,
    genReqId(req) {
      return req.requestId || crypto.randomBytes(8).toString('hex');
    },
    // scrubUrl, not req.url: these message strings bypass the `req` serializer
    // where the redaction otherwise lives, so a search term or a token in the
    // query string would land in the log verbatim.
    customSuccessMessage(req, res) {
      return `${req.method} ${logger.scrubUrl(req.url)} → ${res.statusCode}`;
    },
    customErrorMessage(req, res, err) {
      return `${req.method} ${logger.scrubUrl(req.url)} → ${res.statusCode} — ${err.message}`;
    },
  }));
}

// ── A05 Security Misconfiguration: HTTP security headers ──────────────────────
//
// CSP violation reports are POSTed by the browser to /csp-report (registered
// below, BEFORE the global rate limiter so reports aren't 429'd). The endpoint
// just structured-logs the report and returns 204 — no auth, no DB write.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", 'https://www.googletagmanager.com'],
      styleSrc:   ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      imgSrc:     ["'self'", 'data:', 'https:'],
      // blob: is needed for the party album's client-side video poster-frame
      // capture (the picked file is loaded into a <video> via
      // URL.createObjectURL, then drawn to canvas). Photos use
      // createImageBitmap and never touch the DOM, so imgSrc needs no blob:.
      // Explicit allowlist extension, not a defaultSrc relaxation.
      mediaSrc:   ["'self'", 'blob:'],
      connectSrc: ["'self'", 'https://www.google-analytics.com', 'https://analytics.google.com'],
      fontSrc:    ["'self'", 'https://fonts.gstatic.com'],
      objectSrc:  ["'none'"],
      // Clickjacking: nothing embeds this site. Modern browsers honor
      // frame-ancestors; helmet's default X-Frame-Options (SAMEORIGIN) still
      // covers legacy browsers.
      frameAncestors: ["'self'"],
      // Allow YouTube iframes so project Video sections can embed videos.
      // Stripe Checkout is allowed so the hosted-checkout redirect works.
      frameSrc:   ["'self'", 'https://www.youtube.com', 'https://www.youtube-nocookie.com', 'https://checkout.stripe.com'],
      // Allow shop checkout redirect to POST to Stripe
      formAction: ["'self'", 'https://checkout.stripe.com'],
      // Browser POSTs CSP violations here so they show up in our log aggregator.
      reportUri:  ['/csp-report'],
      // Helmet 8 adds upgrade-insecure-requests by default; disable it so the
      // site works over plain HTTP on LAN IPs (e.g. phone testing on 192.168.x.x).
      // The directive upgrades sub-resource requests to HTTPS — fine in production
      // but breaks dev because 192.168.x.x has no TLS cert.
      upgradeInsecureRequests: null,
    },
  },
  // Block other origins from loading our uploaded media via <img>/<script>/etc.
  // 'same-site' (rather than 'same-origin') keeps subdomain + apex compatible
  // and doesn't break the Stripe/YouTube cross-origin embeds we already allow
  // via frameSrc above.
  crossOriginResourcePolicy: { policy: 'same-site' },
  // NOTE: /assets/brand carries a per-route cross-origin override below —
  // transactional email images render on foreign origins (ice #190).
  crossOriginEmbedderPolicy: false,
}));

// CSP violation report sink — register BEFORE the global rate limiter so a
// page that triggers many violations doesn't 429 itself. Browsers send the
// report with Content-Type: application/csp-report (legacy) or
// application/reports+json (newer Reporting API). Accept both.
app.post(
  '/csp-report',
  express.json({ type: ['application/csp-report', 'application/reports+json', 'application/json'], limit: '32kb' }),
  (req, res) => {
    // The report body carries live URLs — document-uri is whatever page the
    // violation happened on, and the password-reset page URL contains a valid
    // single-use token (see emailService). scrubUrl is only wired into the req
    // serializer, which nothing here uses, so scrub explicitly before logging.
    const report = req.body && req.body['csp-report'] ? req.body['csp-report'] : req.body;
    const cspViolation = (report && typeof report === 'object')
      ? Object.fromEntries(Object.entries(report).map(([k, v]) => [
          k,
          (typeof v === 'string' && /uri|referrer|source-file/i.test(k)) ? logger.scrubUrl(v) : v,
        ]))
      : report;
    logger.warn({ cspViolation }, 'CSP violation reported');
    res.status(204).end();
  },
);

// Restrict access to browser features not used by this app.
// payment=* allowed so Stripe Checkout can use the Payment Request API.
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// ── A05 Security Misconfiguration: CORS whitelist ─────────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',').map(o => o.trim());

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    // Allow any localhost or private LAN IP in development for preview/phone testing
    if (process.env.NODE_ENV !== 'production' && (
      /^https?:\/\/localhost(:\d+)?$/.test(origin) ||
      /^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/.test(origin)
    )) {
      return cb(null, true);
    }
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Trace-ID', 'X-Locale'],
  credentials: true, // required for httpOnly session cookie
}));

// ── A03 Injection: HTTP Parameter Pollution protection ────────────────────────
app.use(hpp());

// ── Stripe webhook — MUST be registered BEFORE express.json() so the raw
// body bytes are available for HMAC signature verification. Stripe's
// constructEvent is byte-exact; a JSON re-serialisation would break it.
// This route is deliberately NOT protected by CSRF (Stripe can't produce a
// CSRF token) nor by sanitizeBody (must not mutate the Buffer).
app.post('/api/v1/shop/webhook',
  express.raw({ type: 'application/json', limit: '1mb' }),
  shopController.handleStripeWebhook);

// Seller-area ingest (D-020) — the same raw-body rule as the Stripe webhook:
// the HMAC covers the exact bytes ops sent, so this router mounts its own
// express.raw parser and MUST sit before express.json(). No CSRF (no cookie,
// machine-to-machine; the signature is the authentication) and no sanitizeBody
// (it would mutate the signed Buffer) — the reasons are in the router's header.
// 404 unless INSTANCE_ROLE=public with SELLER_PUBLISH_SECRET set.
app.use('/api/v1/seller-publish', require('./routes/sellerPublishRoutes'));

// Change-request submissions may carry an inline base64 screenshot, so this
// path gets a larger JSON limit. Mounted BEFORE the global 100 kb parser —
// once body-parser sets req._body the global parser short-circuits for this
// path. Note this parser also runs before the rate limiters and the route's
// gate (middleware/changeRequestGate.js): a body on this path is parsed before
// anything can refuse it, which is the price of the ordering trick above.
app.use('/api/v1/change-requests', express.json({ limit: '5mb' }));

// Product CSV import posts the whole catalogue as JSON rows (up to 4 MB). That
// body is NOT parsed here: until 2026-09-23 a 4 MB parser sat at this point,
// ahead of the rate limiters and the admin gate, so an anonymous caller got a
// 4 MB body parsed and sanitized before anything could refuse it. The global
// parser below now skips the import path, and adminShopRoutes.js parses it
// (and runs sanitizeBody on it) only after requireAuth, requireView('products'),
// both limiters and — for apply — CSRF. The match is case-insensitive like
// Express routing, and ends at a slash or end of path, so only the import
// routes themselves are skipped.
const PRODUCT_IMPORT_PATH = /^\/api\/v1\/admin\/shop\/products\/import(\/|$)/i;
const defaultJson = express.json({ limit: '100kb' });

// ── A04 Insecure Design: limit request body size (100 kb) ────────────────────
app.use((req, res, next) => (PRODUCT_IMPORT_PATH.test(req.path) ? next() : defaultJson(req, res, next)));
app.use(cookieParser());

// ── A03 Injection: sanitize all incoming body strings ────────────────────────
app.use(sanitizeBody);

// ── Locale detection — sets req.locale for every API request ──────────────
// Must run after cookieParser() so req.cookies is available.
app.use(localeMiddleware);

// ── A01 Broken Access Control: global rate limiter ───────────────────────────
// Static asset reads are exempt. The router imports all 58 view modules eagerly
// (ENHANCEMENTS #6), so a single cold page load costs ~120 sendfile requests
// before the Iceland scene renditions (multi-width AVIF/WebP srcsets) and the
// fonts are counted — the 400/15 min budget 429'd ordinary browsing, which
// renders as broken images and an unstyled page. Base fix 2b6842c, ported
// 2026-09-01; predicate extracted to utils/staticAsset.js with the three root
// files added and unit-tested (ice #201, 2026-09-02).
//
// This is scoping, not loosening, and the scope is exact:
//   • only GET/HEAD, only paths whose RAW pathname begins with one of the four
//     baked/upload static prefixes followed by a slash — '/assetsfoo/x' and
//     '/is/js/x.js' do not match;
//   • nothing dynamic is mounted under those prefixes (they are express.static
//     mounts plus the /assets/brand CORP header, checked at port time), so an
//     exempt request can only ever reach a cheap sendfile;
//   • a miss under them never reaches the SSR/DB path — the '/{*splat}'
//     catch-all 404s them (KEEP THE TWO IN SYNC; ssrMeta only skips paths that
//     carry a file extension, so an extensionless '/assets/x' with an HTML
//     Accept header would otherwise hit the database unthrottled).
// API, auth, page loads and every write limiter are unchanged.
const { isStaticAsset, STATIC_PREFIX } = require('./utils/staticAsset');

// Bulk background-media uploads are carved out of the global limiter as well.
// Standing product decision (Halli, 2026-09-01): a large upload must ALWAYS be
// allowed to finish — throttling one is a broken-product experience, not a
// safety feature. This route takes one file per request, so an admin dropping a
// folder of stills spends a request per file and would otherwise burn the whole
// 2000/15 min budget and 429 half-way through the batch.
//
// A deliberate exemption, not an oversight (invariant 7): the access control on
// this route is requireAuth + requireView('background') + CSRF, unchanged — the
// limiter never was the gate. Prevention is replaced by detection —
// services/uploadVolumeAlert.js records a warn row in Admin → Monitoring when a
// burst is large, and the upload still completes.
const BG_MEDIA_UPLOAD_PATH = '/api/v1/admin/background/media';
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Raised 400 → 2000 with every other ceiling ×5 (ice #201): the customer
  // instance's owner drained 400 doing ordinary admin work. Halli accepted the
  // same raise here, auth routes included (2026-09-02).
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) =>
    process.env.NODE_ENV === 'test' ||
    process.env.NODE_ENV === 'development' ||
    ((req.method === 'GET' || req.method === 'HEAD') && isStaticAsset(req)) ||
    (req.method === 'POST' && req.path === BG_MEDIA_UPLOAD_PATH),
  message: { error: 'Too many requests, please try again later.', code: 429 },
});
app.use(globalLimiter);

// ── A01 Broken Access Control: stricter limiter on write endpoints ─────────────
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 450, // was 90 — ×5 with the rest (ice #201)
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development',
  message: { error: 'Too many write requests, please try again later.', code: 429 },
});
app.use('/api/v1/projects', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return writeLimiter(req, res, next);
  }
  next();
});
app.use('/api/v1/party', (req, res, next) => {
  // EXEMPT: POST /photos (album upload). Guests bulk-upload whole camera rolls
  // after the party — 90 writes/15 min would stall a batch after ~90 files.
  // The album is fully PUBLIC by owner decision (2026-07-26) — no auth on the
  // route — so the dedicated abuse backstop (partyUploadLimiter, 1000/15 min,
  // in partyRoutes.js) plus CSRF are the only gates. DELETE /photos/:id
  // deliberately stays under writeLimiter — deletes are rare and need no bulk
  // allowance.
  if (req.method === 'POST' && req.path === '/photos') return next();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return writeLimiter(req, res, next);
  }
  next();
});
app.use('/api/v1/admin/shop', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return writeLimiter(req, res, next);
  }
  next();
});
app.use('/api/v1/admin/bins', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return writeLimiter(req, res, next);
  }
  next();
});
app.use('/api/v1/admin/handbok', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return writeLimiter(req, res, next);
  }
  next();
});
app.use('/api/v1/admin/leads', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return writeLimiter(req, res, next);
  }
  next();
});
app.use('/api/v1/admin/markadur', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return writeLimiter(req, res, next);
  }
  next();
});
app.use('/api/v1/admin/accounts', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return writeLimiter(req, res, next);
  }
  next();
});
app.use('/api/v1/admin/bookkeeping', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return writeLimiter(req, res, next);
  }
  next();
});

// ── Request ID + Trace ID — attach to every request for log correlation ────────
app.use((req, res, next) => {
  // Honor incoming trace propagation header, or generate a new one
  const traceId = req.headers['x-trace-id'] || crypto.randomBytes(8).toString('hex');
  const reqId   = crypto.randomBytes(8).toString('hex');

  req.requestId = reqId;
  req.traceId   = traceId;

  res.setHeader('X-Request-ID', reqId);
  res.setHeader('X-Trace-ID', traceId);
  next();
});

// Redirect HTTP → HTTPS in production (skip the probes so internal health checks
// aren't redirected — the canonical-host middleware below exempts the same two).
// The target host is the CANONICAL one, not the request's Host header: echoing
// the header let a client choose where its own 301 pointed (harmless behind
// Azure's front end, which sets Host, but a reflected value in a redirect is
// the kind of thing the next reviewer flags). One hop now covers both scheme
// and host.
if (process.env.NODE_ENV === 'production') {
  // The canonical host comes from APP_URL — the same source ssrMeta.js,
  // sitemapRoutes.js and the email links use — so one setting names the
  // site. Until 2026-09-12 this was the literal 'www.hallismiley.is' with no
  // override, which would have 301-redirected a first deploy of this repo to
  // the base owner's personal site (docs sync, PR #4). The literal stays as
  // the fallback for an instance that never set APP_URL, matching ssrMeta.
  // Resolved once, above both redirects, so they agree on the target.
  const CANONICAL_HOST = (() => {
    try { return new URL(process.env.APP_URL || 'https://www.orangesmiley.is').host.toLowerCase(); }
    catch { return 'www.orangesmiley.is'; }
  })();
  app.use((req, res, next) => {
    if (req.path === '/health' || req.path === '/ready') return next();
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${CANONICAL_HOST}${req.url}`);
    }
    next();
  });

  // Canonicalize the host. Prevents duplicate-content indexing across the
  // apex, the Azure default hostname (<app>.azurewebsites.net) and any legacy
  // aliases. Skip probes so Azure load-balancer health checks still reach
  // /health and /ready regardless of which hostname they use.
  app.use((req, res, next) => {
    if (req.path === '/health' || req.path === '/ready') return next();
    const host = (req.headers.host || '').toLowerCase();
    if (host && host !== CANONICAL_HOST) {
      return res.redirect(301, `https://${CANONICAL_HOST}${req.url}`);
    }
    next();
  });
}

// ── Liveness probe — returns 200 if the process is alive ──────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({
    status:    'ok',
    uptime:    Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// Who may read process internals (/metrics, and the `checks` detail of /ready):
// a bearer METRICS_TOKEN when one is configured, otherwise localhost only in
// production, anyone in dev/test. Returns null when allowed, else the HTTP
// status /metrics answers with. One rule for both endpoints, so /ready can
// never disclose what /metrics refuses.
function internalsDenied(req) {
  const metricsToken = process.env.METRICS_TOKEN;
  if (metricsToken) {
    // Constant-time: `!==` returns at the first differing byte, so response
    // time would tell a caller how much of a guessed token was right.
    return safeEqual(req.headers.authorization || '', `Bearer ${metricsToken}`) ? null : 401;
  }
  if (process.env.NODE_ENV === 'production') {
    const ip = req.ip || req.socket.remoteAddress;
    return (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') ? null : 403;
  }
  return null;
}

// ── Readiness probe — checks DB and system health before accepting traffic ─────
// Anyone gets the verdict: the HTTP status (200/503), `status`, `uptime` and
// `timestamp`. `uptime` stays public on purpose — deploy.yml reads it to prove
// the answering process is younger than the container swap. The `checks`
// detail (pool counts, breaker state, heap and RSS, event-loop lag) goes only
// to a caller who may read /metrics (internalsDenied above): it told anonymous
// callers how loaded and how close to its limits the instance was.
app.get('/ready', async (req, res) => {
  const { query: dbQuery, pool } = require('./config/database');

  async function measureEventLoopLag() {
    return new Promise(resolve => {
      const start = process.hrtime.bigint();
      setImmediate(() => resolve(Number(process.hrtime.bigint() - start) / 1e6));
    });
  }

  const checks = {};
  let overallOk = true;

  // DB connectivity
  try {
    await Promise.race([
      dbQuery('SELECT 1'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
    checks.database = { status: 'ok' };
  } catch (err) {
    checks.database = { status: 'error', message: err.message };
    overallOk = false;
    healthCheckFailed('database', { message: err.message });
  }

  // DB pool health
  checks.dbPool = {
    status:   pool.waitingCount > 5 ? 'degraded' : 'ok',
    total:    pool.totalCount,
    idle:     pool.idleCount,
    waiting:  pool.waitingCount,
  };
  if (pool.waitingCount > 5) overallOk = false;

  // Circuit breaker state
  checks.circuitBreaker = {
    status: dbCircuitBreaker.state === 'closed' ? 'ok' : 'degraded',
    state:  dbCircuitBreaker.state,
  };
  if (dbCircuitBreaker.state === 'open') overallOk = false;

  // Memory usage — reported for visibility; does not flip readiness. Reading
  // comes from observability/memoryUsage.js, shared with the periodic alert so
  // the two can never disagree again (they did: both used heapUsed/heapTotal,
  // which V8 grows on demand — see the module header). Ported from
  // icelandicstore #180.
  const mem = readMemory();
  checks.memory = {
    status:      mem.heapRatio > 0.9 ? 'critical' : mem.heapRatio > 0.8 ? 'degraded' : 'ok',
    heapUsedMb:  mem.heapUsedMb,
    heapLimitMb: mem.heapLimitMb,
    rssMb:       mem.rssMb,
    ratio:       mem.ratioPct,
  };

  // Event loop lag — reported for visibility; does not flip readiness.
  // Short-lived spikes (GC, test noise) shouldn't evict the pod from the LB.
  const lagMs = await measureEventLoopLag();
  checks.eventLoop = {
    status: lagMs > 100 ? 'degraded' : 'ok',
    lagMs:  Math.round(lagMs),
  };

  const status = overallOk ? 200 : 503;
  res.status(status).json({
    status:    overallOk ? 'ok' : 'degraded',
    uptime:    Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    ...(internalsDenied(req) ? {} : { checks }),
  });
});

// ── Prometheus metrics endpoint ───────────────────────────────────────────────
app.get('/metrics', async (req, res) => {
  const denied = internalsDenied(req);
  if (denied) return res.status(denied).json({ error: denied === 401 ? 'Unauthorized' : 'Forbidden', code: denied });

  try {
    // prom-client gauges are pull-based: refresh the pool numbers at scrape
    // time or db_pool_* reports 0 forever (ice wiring). Required locally, like
    // /ready above, so a DB outage cannot take the metrics endpoint with it.
    const { pool } = require('./config/database');
    dbPoolTotal.set(pool.totalCount);
    dbPoolIdle.set(pool.idleCount);
    dbPoolWaiting.set(pool.waitingCount);

    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).end(err.message);
  }
});

// ── Gzip/deflate compression for all responses ────────────────────────────────
app.use(compression());

// ── CSRF token endpoint — call before any state-changing request ──────────────
app.get('/api/v1/csrf-token', (req, res) => {
  const token = generateCsrfToken(req, res);
  return res.json({ token });
});

// ── DB circuit breaker — applied to all routes that touch the database ─────────
app.use(['/auth', '/api/v1'], dbCircuitBreakerMiddleware);

// ── User-uploaded media — served from UPLOAD_ROOT ─────────────────────────────
// These routes are registered BEFORE the baked `public/` static so uploads take
// precedence. A request that doesn't exist under UPLOAD_ROOT falls through to
// the static middleware below, which still serves committed baked content
// (e.g. `/assets/waterfall-cover.jpg`, `/assets/party/venue/*.jpg`,
// `/assets/projects/<slug>/*.jpg`, avatars, etc.).
//
// In production UPLOAD_ROOT is the Azure Files mount (/app/uploads) so
// user uploads survive container redeploys.
const { UPLOAD_ROOT } = require('./config/paths');
// Uploaded file names embed a timestamp + random suffix (see server/middleware/upload.js),
// so the URL is effectively unique per file — safe to serve with immutable + a long max-age.
const uploadStaticOpts = {
  maxAge: '365d',
  immutable: true,
  etag: true,
  lastModified: true,
  fallthrough: true,
};
app.use('/assets/news',     express.static(path.join(UPLOAD_ROOT, 'news'),     uploadStaticOpts));
app.use('/assets/party',    express.static(path.join(UPLOAD_ROOT, 'party'),    uploadStaticOpts));
app.use('/assets/projects', express.static(path.join(UPLOAD_ROOT, 'projects'), uploadStaticOpts));
app.use('/assets/avatars',  express.static(path.join(UPLOAD_ROOT, 'avatars'),  uploadStaticOpts));
app.use('/assets/products', express.static(path.join(UPLOAD_ROOT, 'products'), uploadStaticOpts));
app.use('/assets/content',  express.static(path.join(UPLOAD_ROOT, 'content'),  uploadStaticOpts));
// Change-request screenshots: persistScreenshot (changeRequestController.js)
// writes under UPLOAD_ROOT/change-requests and links /assets/change-requests/…
// from the admin inbox. This mount was missing, so on every stack with
// UPLOAD_ROOT set — which production requires — the link 404ed (PR #2 review).
app.use('/assets/change-requests', express.static(path.join(UPLOAD_ROOT, 'change-requests'), uploadStaticOpts));
// Iceland scene renditions — baked (not uploads), but they share the uploads'
// immutable policy: filenames are content-hashed by build-iceland-scenes.js,
// so a year of immutable caching is correct where the generic public/ mount
// below would give them only 1h.
// Brand assets referenced from transactional email. helmet's site-wide CORP
// same-site makes mail clients (rendering on their own origin) refuse the
// image bytes; this narrow override keeps the exemption to exactly the files
// meant to be embedded elsewhere. Pinned both ways in tests/integration/
// security-headers coverage. Ported from icelandicstore #190.
app.use('/assets/brand', (req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
});
app.use('/assets/iceland',  express.static(path.join(__dirname, '../public/assets/iceland'), uploadStaticOpts));

// Dynamic /sitemap.xml — must come BEFORE express.static so it shadows
// any stale public/sitemap.xml file and reflects live DB state.
app.use('/', sitemapRoutes);
// /manifest.json named after the product (identity.brand) — before the
// static mount for the same reason; public/manifest.json is the engine
// default it fills in.
app.use('/', manifestRoutes);
// /robots.txt with the Disallow lines derived from identity.surface
// .hiddenRoutes — before the static mount; public/robots.txt is the engine
// default it replaces.
app.use('/', robotsRoutes);

// IndexNow key-file endpoint — Bing fetches `/<INDEXNOW_KEY>.txt` to verify
// ownership before accepting our IndexNow API submissions. Serve it from an
// env var rather than dropping a file on disk so key rotation is a one-line
// app-settings change and survives container redeploys with no fs writes.
// The route is constrained to the IndexNow key character set (hex + dash,
// 8-128 chars) so it can't be coerced into serving arbitrary paths.
// Express 5: path-to-regexp v8 dropped inline param regexes
// ('/:key(...)'), so the constraint is now a plain RegExp route — Express
// matches it directly and exposes the capture as req.params[0].
app.get(/^\/([A-Za-z0-9-]{8,128})\.txt$/, (req, res, next) => {
  const expected = process.env.INDEXNOW_KEY;
  if (!expected) return next();
  if (req.params[0] !== expected) return next();
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(expected);
});

// Routes
app.use(express.static(path.join(__dirname, '../public'), {
  maxAge: '1h',
  etag: true,
  lastModified: true,
  // index: false so '/' falls through to our SSR meta catch-all and can
  // get locale-redirected / meta-injected rather than silently serving
  // raw index.html with placeholder tags.
  index: false,
  setHeaders(res, filePath) {
    // Never cache the HTML entry point — the SPA must always get a fresh shell
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
    // In development, don't cache JS/CSS/JSON either — avoids stale ES modules
    // and stale i18n locale files when iterating on the frontend.
    if (process.env.NODE_ENV !== 'production' &&
        (filePath.endsWith('.js') || filePath.endsWith('.css') || filePath.endsWith('.json'))) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));
app.use('/auth',              authRoutes);
app.use('/api/v1/projects',   projectRoutes);
app.use('/api/v1/contact',    contactRoutes);
app.use('/api/v1/users',      userRoutes);
app.use('/api/v1/analytics',  analyticsRoutes);
app.use('/api/v1/change-requests', changeRequestRoutes);
app.use('/api/v1/system',     systemRoutes);
app.use('/api/v1/admin/shop', adminShopRoutes); // must come before /api/v1/admin catch-all
app.use('/api/v1/admin/analytics', analyticsAdminRoutes); // must come before /api/v1/admin catch-all
app.use('/api/v1/admin/general-settings', adminGeneralSettingsRoutes); // must come before /api/v1/admin catch-all
app.use('/api/v1/admin/discounts', adminDiscountRoutes); // must come before /api/v1/admin catch-all
app.use('/api/v1/admin/background', adminBackgroundRoutes); // must come before /api/v1/admin catch-all
app.use('/api/v1/admin/change-requests', adminChangeRequestRoutes); // must come before /api/v1/admin catch-all
app.use('/api/v1/admin/nav-config', adminNavRoutes); // must come before /api/v1/admin catch-all
app.use('/api/v1/admin/roles', adminRolesRoutes); // must come before /api/v1/admin catch-all
app.use('/api/v1/admin/bins', adminBinsRoutes); // must come before /api/v1/admin catch-all
app.use('/api/v1/admin/customers', adminCustomerRoutes); // must come before /api/v1/admin catch-all
app.use('/api/v1/admin/customer-notes', adminCustomerNotesRoutes); // must come before /api/v1/admin catch-all
app.use('/api/v1/admin/bookkeeping', adminBookkeepingRoutes); // must come before /api/v1/admin catch-all
app.use('/api/v1/admin/handbok', require('./routes/salesGuidesRoutes')); // must come before /api/v1/admin catch-all
app.use('/api/v1/admin/leads', require('./routes/leadsRoutes')); // must come before /api/v1/admin catch-all
app.use('/api/v1/admin/markadur', require('./routes/marketRoutes')); // must come before /api/v1/admin catch-all
app.use('/api/v1/admin/accounts', require('./routes/adminAccountRoutes')); // must come before /api/v1/admin catch-all
app.use('/api/v1/admin/commission', require('./routes/adminCommissionRoutes')); // must come before /api/v1/admin catch-all
app.use('/api/v1/admin/audit', require('./routes/adminAuditRoutes')); // must come before /api/v1/admin catch-all
app.use('/api/v1/admin',      adminRoutes);
app.use('/api/v1/content',    contentRoutes);
// Seller area (D-020): read-only, published copy; 404 unless INSTANCE_ROLE=public.
app.use('/api/v1/seller',     require('./routes/sellerRoutes'));
// Client error beacon + admin event log (harvest 2026-08-22, ice #195). The
// beacon route carries its own tighter limiter (routes/eventRoutes.js).
// MCP connector (ships dark: MCP_ENABLED unset → 404 before auth). Bearer-only
// (middleware/mcpAuth.js reads no cookies — the documented reason the router
// omits csrfProtect). Ported from icelandicstore #188; ENHANCEMENTS #13.
// Mount ORDER: this sits after sanitizeBody and after globalLimiter (above),
// so tool arguments are tag-stripped and MCP traffic counts against the IP
// limit — the router's header comment used to claim the opposite (fixed
// 2026-09-11, docs/mcp.md). Moving it above those two is a decision, not a
// tidy-up: it would exempt MCP from two global protections (invariant 7).
app.use('/api/v1/mcp', require('./routes/mcpRoutes'));
app.use('/api/v1/events',     require('./routes/eventRoutes'));
app.use('/api/v1/admin/mcp-tokens', require('./routes/mcpAdminRoutes')); // before the /api/v1/admin catch-all
app.use('/api/v1/admin/events', require('./routes/adminEventRoutes')); // must come before /api/v1/admin catch-all
app.use('/api/v1/ambience',   require('./routes/ambienceRoutes')); // live-Iceland scene layer
app.use('/api/v1/news',       newsRoutes);
app.use('/api/v1/party',      partyRoutes);
app.use('/api/v1/shop',       shopRoutes);

// ── SPA catch-all with server-side meta tag injection ─────────────────────
// Unmatched paths land here. We do three things in order:
//   1. Refuse anything under /api/ or /auth/ — those are data endpoints,
//      and a miss is a real 404.
//   2. Redirect root-level paths ('/', '/en', '/is' with no trailing segment)
//      to a locale prefix: the locale_choice cookie (an explicit switcher
//      choice) if there is one, otherwise PUBLIC_DEFAULT_LOCALE. This gives
//      crawlers + humans a clean 302 to the right language instead of
//      ambiguous content.
//   3. Redirect locale-locked routes (the Icelandic-only party pages) to
//      their one true locale, so /en/party never renders.
//   4. Serve index.html with <title>, <meta description>, og:*, canonical,
//      and hreflang tags filled in per-route. JS-free crawlers (Bing,
//      Facebook, LinkedIn, X) get the right preview cards; humans get the
//      SPA shell and client-side hydration kicks in.
const ssrMetaMiddleware = require('./middleware/ssrMeta');
const { PUBLIC_DEFAULT_LOCALE, SUPPORTED_LOCALES, forcedLocaleFor } = require('./config/i18n');

// Only an explicit switcher choice moves the landing page off Icelandic.
// Accept-Language is not consulted — see the note in middleware/locale.js:
// most Icelandic browsers send en-US, so honouring it would hand the
// English site to the very audience this one is for.
function pickLocaleForRedirect(req) {
  const cookie = req.cookies?.locale_choice;
  if (cookie && SUPPORTED_LOCALES.includes(cookie)) return cookie;
  return PUBLIC_DEFAULT_LOCALE;
}

// Express 5: path-to-regexp v8 rejects a bare '*' — the catch-all is now a
// named splat. KEEP THE BRACES: '/{*splat}' also matches '/' itself, while
// '/*splat' would not, silently breaking the root locale redirect below.
app.get('/{*splat}', (req, res, next) => {
  // Real 404s for data paths — don't serve HTML for missed API calls.
  if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) {
    return res.status(404).json({ error: 'Not found', code: 404 });
  }

  // Asset-path misses are real 404s too, never the SPA shell. These prefixes
  // are exempt from the global rate limiter (utils/staticAsset.js — same
  // regex, KEEP IN SYNC), so they must not fall through to the SSR/DB path.
  if (STATIC_PREFIX.test(req.path)) {
    return res.status(404).json({ error: 'Not found', code: 404 });
  }

  const parts  = req.path.split('/').filter(Boolean);
  const search = req.url.slice(req.path.length); // '' | '?token=…'

  // Locale-locked routes: the party pages are Icelandic-only. Any other locale
  // prefix — and the unprefixed /party a shared link or the sitemap might carry
  // — collapses onto /is/… before the SPA or SSR ever picks a language. Done
  // here rather than in the SPA so crawlers and JS-less clients see the same
  // single URL, and so magic-link tokens in ?query survive the hop.
  const forced = forcedLocaleFor(req.path);
  if (forced) {
    const hasLocale = parts[0] && SUPPORTED_LOCALES.includes(parts[0]);
    if (!hasLocale || parts[0] !== forced) {
      const rest = (hasLocale ? parts.slice(1) : parts).join('/');
      return res.redirect(301, `/${forced}/${rest}${search}`);
    }
  }

  // '/', '/en', '/en/', '/is', '/is/' → redirect to `/<locale>/`
  if (parts.length === 0) {
    const locale = pickLocaleForRedirect(req);
    return res.redirect(302, `/${locale}/${req.url.slice(1)}`);
  }
  if (parts.length === 1 && SUPPORTED_LOCALES.includes(parts[0]) && !req.path.endsWith('/')) {
    return res.redirect(301, `/${parts[0]}/${req.url.slice(parts[0].length + 1)}`);
  }
  return ssrMetaMiddleware(req, res, next);
});

app.use(errorHandler);

module.exports = app;

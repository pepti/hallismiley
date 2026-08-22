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
const shopController = require('./controllers/shopController');
const errorHandler   = require('./middleware/errorHandler');
const { sanitizeBody } = require('./middleware/sanitize');
const localeMiddleware = require('./middleware/locale');
const { generateCsrfToken } = require('./middleware/csrf');
const { register }   = require('./observability/metrics');
const httpMetrics     = require('./observability/httpMetrics');
const { dbCircuitBreakerMiddleware, dbCircuitBreaker } = require('./observability/circuitBreaker');
const { healthCheckFailed } = require('./observability/alerts');
const { readMemory } = require('./observability/memoryUsage');
const { trackRequest } = require('./observability/alerts');

const app = express();

// Trust the first proxy (Azure App Service's reverse proxy) so req.ip and rate limiting work correctly
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

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
    customSuccessMessage(req, res) {
      return `${req.method} ${req.url} → ${res.statusCode}`;
    },
    customErrorMessage(req, res, err) {
      return `${req.method} ${req.url} → ${res.statusCode} — ${err.message}`;
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

// Change-request submissions (non-prod) may carry an inline base64 screenshot,
// so this path gets a larger JSON limit. Mounted BEFORE the global 100 kb
// parser — once body-parser sets req._body the global parser short-circuits for
// this path. The route is still 404 in production via requireTestEnv.
app.use('/api/v1/change-requests', express.json({ limit: '5mb' }));

// Product CSV import posts the whole catalogue as JSON rows, so this path gets a
// larger JSON limit. Mounted BEFORE the global 100 kb parser (same pattern as
// change-requests above); still admin-gated downstream by the shop routes.
app.use('/api/v1/admin/shop/products/import', express.json({ limit: '4mb' }));

// ── A04 Insecure Design: limit request body size (100 kb) ────────────────────
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// ── A03 Injection: sanitize all incoming body strings ────────────────────────
app.use(sanitizeBody);

// ── Locale detection — sets req.locale for every API request ──────────────
// Must run after cookieParser() so req.cookies is available.
app.use(localeMiddleware);

// ── A01 Broken Access Control: global rate limiter ───────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 400,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development',
  message: { error: 'Too many requests, please try again later.', code: 429 },
});
app.use(globalLimiter);

// ── A01 Broken Access Control: stricter limiter on write endpoints ─────────────
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 90,
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
// aren't redirected — the canonical-host middleware below exempts the same two)
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.path === '/health' || req.path === '/ready') return next();
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });

  // Canonicalize host → www.hallismiley.is. Prevents duplicate-content
  // indexing across apex (hallismiley.is), the Azure default hostname
  // (hallismiley-app.azurewebsites.net), and any legacy aliases.
  // Skip probes so Azure load-balancer health checks still reach /health
  // and /ready regardless of which hostname they use.
  const CANONICAL_HOST = 'www.hallismiley.is';
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

// ── Readiness probe — checks DB and system health before accepting traffic ─────
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
    checks,
  });
});

// ── Prometheus metrics endpoint ───────────────────────────────────────────────
app.get('/metrics', async (req, res) => {
  // Track request outcome (not an error)
  trackRequest(false);

  // Auth: bearer token if METRICS_TOKEN is set, otherwise localhost only
  const metricsToken = process.env.METRICS_TOKEN;
  if (metricsToken) {
    const authHeader = req.headers.authorization || '';
    if (authHeader !== `Bearer ${metricsToken}`) {
      return res.status(401).json({ error: 'Unauthorized', code: 401 });
    }
  } else if (process.env.NODE_ENV === 'production') {
    // In prod without a token configured, only allow localhost
    const ip = req.ip || req.socket.remoteAddress;
    if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
      return res.status(403).json({ error: 'Forbidden', code: 403 });
    }
  }

  try {
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

// Brand assets referenced from transactional email. helmet's site-wide CORP
// same-site makes mail clients (rendering on their own origin) refuse the
// image bytes; this narrow override keeps the exemption to exactly the files
// meant to be embedded elsewhere. Ported from icelandicstore #190.
app.use('/assets/brand', (req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
});

// Dynamic /sitemap.xml — must come BEFORE express.static so it shadows
// any stale public/sitemap.xml file and reflects live DB state.
app.use('/', sitemapRoutes);

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
app.use('/api/v1/admin',      adminRoutes);
app.use('/api/v1/content',    contentRoutes);
// Client error beacon + admin event log (harvest 2026-08-22, ice #195). The
// beacon route carries its own tighter limiter (routes/eventRoutes.js).
// MCP connector (ships dark: MCP_ENABLED unset → 404 before auth). Bearer-only
// (middleware/mcpAuth.js reads no cookies — the documented reason the router
// omits csrfProtect). Ported from icelandicstore #188; ENHANCEMENTS #13.
app.use('/api/v1/mcp', require('./routes/mcpRoutes'));
app.use('/api/v1/events',     require('./routes/eventRoutes'));
app.use('/api/v1/admin/mcp-tokens', require('./routes/mcpAdminRoutes')); // before the /api/v1/admin catch-all
app.use('/api/v1/admin/events', require('./routes/adminEventRoutes')); // must come before /api/v1/admin catch-all
app.use('/api/v1/news',       newsRoutes);
app.use('/api/v1/party',      partyRoutes);
app.use('/api/v1/shop',       shopRoutes);
// Self-update module (dormant unless config/client.json enables it — the
// routes 404 while selfUpdate.enabled is false).
app.use('/api/v1/system',     systemRoutes);

// ── SPA catch-all with server-side meta tag injection ─────────────────────
// Unmatched paths land here. We do three things in order:
//   1. Refuse anything under /api/ or /auth/ — those are data endpoints,
//      and a miss is a real 404.
//   2. Redirect root-level paths ('/', '/en', '/is' with no trailing segment)
//      to a locale prefix chosen from the locale_choice cookie (explicit
//      switcher choice only) → Accept-Language → DEFAULT_LOCALE. This gives
//      crawlers + humans a clean 302 to the right language instead of
//      ambiguous content.
//   3. Redirect locale-locked routes (the Icelandic-only party pages) to
//      their one true locale, so /en/party never renders.
//   4. Serve index.html with <title>, <meta description>, og:*, canonical,
//      and hreflang tags filled in per-route. JS-free crawlers (Bing,
//      Facebook, LinkedIn, X) get the right preview cards; humans get the
//      SPA shell and client-side hydration kicks in.
const ssrMetaMiddleware = require('./middleware/ssrMeta');
const { SUPPORTED_LOCALES, forcedLocaleFor } = require('./config/i18n');

function pickLocaleForRedirect(req) {
  const cookie = req.cookies?.locale_choice;
  if (cookie && SUPPORTED_LOCALES.includes(cookie)) return cookie;
  const accept = (req.headers['accept-language'] || '').toLowerCase();
  for (const part of accept.split(',')) {
    const code = part.split(';')[0].trim().split('-')[0];
    if (SUPPORTED_LOCALES.includes(code)) return code;
  }
  return 'en';
}

// Express 5: path-to-regexp v8 rejects a bare '*' — the catch-all is now a
// named splat. KEEP THE BRACES: '/{*splat}' also matches '/' itself, while
// '/*splat' would not, silently breaking the root locale redirect below.
// (Ported with the Express 5 bump from icelandicstore #112.)
app.get('/{*splat}', (req, res, next) => {
  // Real 404s for data paths — don't serve HTML for missed API calls.
  if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) {
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

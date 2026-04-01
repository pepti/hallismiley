const crypto     = require('crypto');
const express    = require('express');
const logger     = require('./observability/logger');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const hpp        = require('hpp');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const path       = require('path');
const projectRoutes    = require('./routes/projectRoutes');
const authRoutes       = require('./routes/authRoutes');
const contactRoutes    = require('./routes/contactRoutes');
const userRoutes       = require('./routes/userRoutes');
const adminRoutes      = require('./routes/adminRoutes');
const contentRoutes    = require('./routes/contentRoutes');
const partyRoutes      = require('./routes/partyRoutes');
const errorHandler     = require('./middleware/errorHandler');
const healthController = require('./controllers/healthController');
const { sanitizeBody } = require('./middleware/sanitize');
const { generateCsrfToken } = require('./middleware/csrf');
const { register }   = require('./observability/metrics');
const httpMetrics     = require('./observability/httpMetrics');
const { dbCircuitBreakerMiddleware } = require('./observability/circuitBreaker');
const { trackRequest } = require('./observability/alerts');

const app = express();

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
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", 'https://www.googletagmanager.com'],
      styleSrc:   ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      imgSrc:     ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https://www.google-analytics.com', 'https://analytics.google.com'],
      fontSrc:    ["'self'", 'https://fonts.gstatic.com'],
      objectSrc:  ["'none'"],
      frameSrc:   ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// Restrict access to browser features not used by this app
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  next();
});

// ── A05 Security Misconfiguration: CORS whitelist ─────────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',').map(o => o.trim());

app.use(cors({
  origin(origin, cb) {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Trace-ID'],
  credentials: true, // required for httpOnly session cookie
}));

// ── A03 Injection: HTTP Parameter Pollution protection ────────────────────────
app.use(hpp());

// ── A04 Insecure Design: limit request body size (100 kb) ────────────────────
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// ── A03 Injection: sanitize all incoming body strings ────────────────────────
app.use(sanitizeBody);

// ── A01 Broken Access Control: global rate limiter ───────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'Too many requests, please try again later.', code: 429 },
});
app.use(globalLimiter);

// ── A01 Broken Access Control: stricter limiter on write endpoints ─────────────
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'Too many write requests, please try again later.', code: 429 },
});
app.use('/api/v1/projects', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return writeLimiter(req, res, next);
  }
  next();
});
app.use('/api/v1/party', (req, res, next) => {
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

// Redirect HTTP → HTTPS in production
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

// ── Liveness probe — returns 200 if the process is alive ──────────────────────
app.get('/health', healthController.liveness);

// ── Readiness probe — checks DB and system health before accepting traffic ─────
app.get('/ready', healthController.readiness);

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

// Routes
app.use(express.static(path.join(__dirname, '../public'), {
  maxAge: '1h',
  etag: true,
  lastModified: true,
  setHeaders(res, filePath) {
    // Never cache the HTML entry point — the SPA must always get a fresh shell
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));
app.use('/auth',              authRoutes);
app.use('/api/v1/projects',   projectRoutes);
app.use('/api/v1/contact',    contactRoutes);
app.use('/api/v1/users',      userRoutes);
app.use('/api/v1/admin',      adminRoutes);
app.use('/api/v1/content',    contentRoutes);
app.use('/api/v1/party',      partyRoutes);

// Fallback SPA route — never cache, browser must revalidate on every navigation
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.use(errorHandler);

module.exports = app;

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
const errorHandler   = require('./middleware/errorHandler');
const { sanitizeBody } = require('./middleware/sanitize');

const app = express();

// ── Structured HTTP request logging with pino-http (skipped in test mode) ─────
if (process.env.NODE_ENV !== 'test') {
  const pinoHttp = require('pino-http');
  app.use(pinoHttp({ logger }));
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
  allowedHeaders: ['Content-Type', 'Authorization'],
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

// Attach a unique request ID to every request for log correlation
app.use((req, res, next) => {
  const id = crypto.randomBytes(8).toString('hex');
  req.requestId = id;
  res.setHeader('X-Request-ID', id);
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

// ── Health check — used by Railway uptime monitoring ──────────────────────────
app.get('/health', async (req, res) => {
  try {
    await require('./config/database').query('SELECT 1');
    res.status(200).json({
      status:    'ok',
      uptime:    Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      database:  'ok',
    });
  } catch {
    res.status(503).json({
      status:    'degraded',
      uptime:    Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      database:  'error',
    });
  }
});

// ── Gzip/deflate compression for all responses ────────────────────────────────
app.use(compression());

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
app.use('/auth',            authRoutes);
app.use('/api/v1/projects', projectRoutes);
app.use('/api/v1/contact',  contactRoutes);

// Fallback SPA route — never cache, browser must revalidate on every navigation
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.use(errorHandler);

module.exports = app;

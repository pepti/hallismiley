'use strict';

const client = require('prom-client');

const register = new client.Registry();

// Default Node.js metrics (CPU, memory, event loop lag, GC stats)
client.collectDefaultMetrics({ register });

// ── HTTP metrics ───────────────────────────────────────────────────────────────
const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

const httpRequestSize = new client.Histogram({
  name: 'http_request_size_bytes',
  help: 'Size of HTTP request bodies in bytes',
  labelNames: ['method', 'route'],
  buckets: [100, 1000, 5000, 10000, 50000, 100000],
  registers: [register],
});

const httpResponseSize = new client.Histogram({
  name: 'http_response_size_bytes',
  help: 'Size of HTTP response bodies in bytes',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [100, 1000, 5000, 10000, 50000, 100000, 500000],
  registers: [register],
});

// ── Database metrics ───────────────────────────────────────────────────────────
const dbPoolTotal = new client.Gauge({
  name: 'db_pool_total_connections',
  help: 'Total number of connections in the DB pool',
  registers: [register],
});

const dbPoolIdle = new client.Gauge({
  name: 'db_pool_idle_connections',
  help: 'Number of idle connections in the DB pool',
  registers: [register],
});

const dbPoolWaiting = new client.Gauge({
  name: 'db_pool_waiting_clients',
  help: 'Number of clients waiting for a DB connection',
  registers: [register],
});

const dbQueryDuration = new client.Histogram({
  name: 'db_query_duration_seconds',
  help: 'Duration of database queries in seconds',
  labelNames: ['query_name'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [register],
});

// ── Auth metrics ───────────────────────────────────────────────────────────────
const authLoginAttempts = new client.Counter({
  name: 'auth_login_attempts_total',
  help: 'Total login attempts',
  labelNames: ['result'], // success | failure | locked
  registers: [register],
});

const authSignupTotal = new client.Counter({
  name: 'auth_signup_total',
  help: 'Total signup attempts',
  labelNames: ['result'], // success | failure
  registers: [register],
});

const authActiveSessions = new client.Gauge({
  name: 'auth_active_sessions',
  help: 'Number of active authenticated sessions',
  registers: [register],
});

// ── Business metrics ───────────────────────────────────────────────────────────
const projectsTotal = new client.Gauge({
  name: 'projects_total',
  help: 'Total number of projects',
  registers: [register],
});

const usersTotal = new client.Gauge({
  name: 'users_total',
  help: 'Total number of users',
  labelNames: ['role'],
  registers: [register],
});

const mediaUploadsTotal = new client.Counter({
  name: 'media_uploads_total',
  help: 'Total number of media uploads',
  registers: [register],
});

module.exports = {
  register,
  httpRequestsTotal,
  httpRequestDuration,
  httpRequestSize,
  httpResponseSize,
  dbPoolTotal,
  dbPoolIdle,
  dbPoolWaiting,
  dbQueryDuration,
  authLoginAttempts,
  authSignupTotal,
  authActiveSessions,
  projectsTotal,
  usersTotal,
  mediaUploadsTotal,
};

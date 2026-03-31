const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  // Suppress all output during tests to keep test output clean
  enabled: process.env.NODE_ENV !== 'test',
});

module.exports = logger;

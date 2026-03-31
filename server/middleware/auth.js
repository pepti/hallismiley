// Re-exports requireAuth from server/auth/middleware.js so existing route
// imports (require('../middleware/auth')) continue to work unchanged.
const { requireAuth } = require('../auth/middleware');

module.exports = { requireAuth };

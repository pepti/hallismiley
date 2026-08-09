// Thin re-export so callers can use `require('./logger')` from server/
// and `require('../logger')` from subdirs without knowing the observability layout.
module.exports = require('./observability/logger');

// JWT Bearer token verification — replaces the previous API key approach
// Validates RS256-signed tokens using the public key (same pattern as Azure AD)
const jwt = require('jsonwebtoken');
const { publicKey } = require('../config/keys');

function requireAuth(req, res, next) {
  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized', code: 401 });
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, publicKey, {
      algorithms: ['RS256'],
      issuer: 'halliprojects',
    });
    req.user = payload; // { sub, role, iat, exp, iss }
    next();
  } catch (err) {
    const expired = err.name === 'TokenExpiredError';
    return res.status(401).json({
      error: expired ? 'Token expired' : 'Invalid token',
      code: 401,
    });
  }
}

module.exports = { requireAuth };

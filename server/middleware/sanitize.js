// A03 Injection: strip HTML/script tags and null bytes from string inputs
// Prevents stored XSS and null-byte injection

function sanitizeString(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/\0/g, '')                        // null bytes
    .replace(/<[^>]*>/g, '')                   // HTML tags
    .trim();
}

function sanitizeBody(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }
  next();
}

function sanitizeObject(obj) {
  const clean = {};
  for (const [key, val] of Object.entries(obj)) {
    if (Array.isArray(val)) {
      clean[key] = val.map(v => (typeof v === 'string' ? sanitizeString(v) : v));
    } else if (typeof val === 'string') {
      clean[key] = sanitizeString(val);
    } else {
      clean[key] = val;
    }
  }
  return clean;
}

module.exports = { sanitizeBody };

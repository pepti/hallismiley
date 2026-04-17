// A03 Injection: strip HTML/script tags and null bytes from string inputs.
// Prevents stored XSS and null-byte injection.
//
// RICH_TEXT_FIELDS are excluded from tag-stripping because they legitimately
// contain HTML markup (e.g. news article body, content sections).  These fields
// are protected downstream by:
//   - Parameterized SQL queries (no injection risk)
//   - Server-side allowed-list HTML sanitization (TODO: add sanitize-html)
//   - Client-side DOMParser allowlist in ArticleView.js at display time
const RICH_TEXT_FIELDS = new Set(['body', 'content']);

function sanitizeString(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/\0/g, '')                        // null bytes
    .replace(/<[^>]*>/g, '')                   // HTML tags
    .trim();
}

// Only strip null bytes from rich-text fields; preserve their HTML markup.
function sanitizeRichText(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/\0/g, '');
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
    if (RICH_TEXT_FIELDS.has(key)) {
      // Preserve rich HTML; only remove null bytes
      clean[key] = typeof val === 'string' ? sanitizeRichText(val) : val;
    } else if (Array.isArray(val)) {
      clean[key] = val.map(v =>
        typeof v === 'string'               ? sanitizeString(v) :
        (v !== null && typeof v === 'object') ? sanitizeObject(v) : v
      );
    } else if (typeof val === 'string') {
      clean[key] = sanitizeString(val);
    } else if (val !== null && typeof val === 'object') {
      // Recurse into nested objects (e.g. RSVP answers, section metadata)
      clean[key] = sanitizeObject(val);
    } else {
      clean[key] = val;
    }
  }
  return clean;
}

module.exports = { sanitizeBody };

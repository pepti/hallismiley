// A03 Injection: strip HTML/script tags and null bytes from string inputs.
// Prevents stored XSS and null-byte injection.
//
// RICH_TEXT_FIELDS are excluded from tag-stripping because they legitimately
// contain HTML markup (e.g. news article body, content sections). They are
// instead passed through an allowlist-based HTML sanitizer (sanitize-html)
// whose tag/attribute set MIRRORS the client-side allowlist in
// public/js/views/ArticleView.js. The two layers must stay in sync — the
// client-side check is for display, this server-side check is the durable
// guard against stored XSS payloads from non-browser clients.
const sanitizeHtml = require('sanitize-html');

const RICH_TEXT_FIELDS = new Set(['body', 'content']);

// Mirror of ALLOWED_TAGS in public/js/views/ArticleView.js (lowercased).
const RICH_TEXT_ALLOWED_TAGS = [
  'p', 'h2', 'h3', 'h4', 'strong', 'em', 'b', 'i', 'a',
  'ul', 'ol', 'li', 'blockquote', 'br', 'hr',
  'span', 'div', 'figure', 'figcaption',
];

const RICH_TEXT_OPTIONS = {
  allowedTags:    RICH_TEXT_ALLOWED_TAGS,
  allowedAttributes: { a: ['href', 'target', 'rel'] },
  // Restrict link schemes — bans javascript:, data:, vbscript:.
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href'],
  // Drop disallowed tags entirely (and their content) when they're known
  // script-bearing elements; default for unknown tags is unwrap (keep text).
  nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript'],
  // Force external link safety attributes.
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }, /* merge */ true),
  },
};

function sanitizeString(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/\0/g, '')                        // null bytes
    .replace(/<[^>]*>/g, '')                   // HTML tags
    .trim();
}

// Allowlist-based HTML sanitization for rich-text fields. Strips tags and
// attributes outside RICH_TEXT_ALLOWED_TAGS and forces rel=noopener noreferrer
// on anchors. Also strips null bytes (not handled by sanitize-html).
function sanitizeRichText(value) {
  if (typeof value !== 'string') return value;
  return sanitizeHtml(value.replace(/\0/g, ''), RICH_TEXT_OPTIONS);
}

function sanitizeBody(req, res, next) {
  // Top-level arrays (e.g. PUT /api/v1/content/party_rsvp_form sends the
  // form definition as a bare array) need to stay arrays — sanitizeObject
  // would coerce them to plain objects with numeric string keys. Sanitize
  // each element in place but preserve the array shape.
  if (Array.isArray(req.body)) {
    req.body = sanitizeArray(req.body);
  } else if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }
  next();
}

function sanitizeArray(arr) {
  return arr.map(v =>
    typeof v === 'string'                 ? sanitizeString(v) :
    Array.isArray(v)                      ? sanitizeArray(v)  :
    (v !== null && typeof v === 'object') ? sanitizeObject(v) : v
  );
}

function sanitizeObject(obj) {
  const clean = {};
  for (const [key, val] of Object.entries(obj)) {
    if (RICH_TEXT_FIELDS.has(key)) {
      // Preserve rich HTML; only remove null bytes
      clean[key] = typeof val === 'string' ? sanitizeRichText(val) : val;
    } else if (Array.isArray(val)) {
      clean[key] = sanitizeArray(val);
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

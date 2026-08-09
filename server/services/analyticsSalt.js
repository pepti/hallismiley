// Cookieless visitor identification for first-party analytics.
//
// A visitor_token is SHA-256(dailySalt | ip | user-agent), base64url-encoded.
// The salt is 32 random bytes held ONLY in process memory and regenerated
// whenever the UTC date changes. Consequences:
//   - The token cannot be reversed to an IP (one-way hash + secret salt).
//   - The token cannot be correlated across days (the salt differs each day).
//   - Nothing is persisted that identifies a person, so the data is anonymous.
// This is the standard Plausible/Fathom approach and the basis for running
// without a consent banner. Trade-off: a mid-day process restart rotates the
// salt early, so "unique visitors today" can over-count slightly after a
// restart. That is an accepted limitation of the cookieless design.

const crypto = require('crypto');

let _salt = null;
let _saltDate = null;

function _utcDate() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

function _currentSalt() {
  const today = _utcDate();
  if (_salt === null || _saltDate !== today) {
    _salt = crypto.randomBytes(32);
    _saltDate = today;
  }
  return _salt;
}

// Irreversible per-day visitor token. 22 base64url chars ≈ 132 bits — far more
// than enough to avoid collisions for a low-traffic site.
function visitorToken(ip, userAgent) {
  return crypto
    .createHash('sha256')
    .update(_currentSalt())
    .update('|')
    .update(String(ip || ''))
    .update('|')
    .update(String(userAgent || ''))
    .digest('base64url')
    .slice(0, 22);
}

// Crawlers / monitors / preview bots. Not exhaustive by design — perfect bot
// detection is impossible; we flag the obvious ones and let the dashboard
// exclude them.
const BOT_RE = /bot|crawl|spider|slurp|headless|lighthouse|monitor|pingdom|uptime|facebookexternalhit|bingpreview|googlebot|duckduckbot|yandex|baidu|semrush|ahrefs/i;

function isBot(userAgent) {
  return BOT_RE.test(String(userAgent || ''));
}

function _browser(ua) {
  if (/edg(e|ios|a)?\//i.test(ua)) return 'Edge';
  if (/opr\/|opera/i.test(ua))     return 'Opera';
  if (/firefox|fxios/i.test(ua))   return 'Firefox';
  if (/samsungbrowser/i.test(ua))  return 'Samsung';
  // Chrome must be tested before Safari (Chrome UA also contains "Safari").
  if (/chrome|crios|chromium/i.test(ua)) return 'Chrome';
  if (/safari/i.test(ua))          return 'Safari';
  return 'unknown';
}

function _os(ua) {
  if (/windows nt/i.test(ua))           return 'Windows';
  if (/iphone|ipad|ipod/i.test(ua))     return 'iOS';
  if (/android/i.test(ua))              return 'Android';
  if (/mac os x|macintosh/i.test(ua))   return 'macOS';
  if (/linux/i.test(ua))                return 'Linux';
  return 'unknown';
}

// device: 'bot' | 'mobile' | 'tablet' | 'desktop' | 'unknown'.
// UA is primary; the optional screen width is a tiebreaker only when the UA
// alone leaves the form factor ambiguous.
function _device(ua, screenWidth) {
  if (!ua) return 'unknown';
  if (isBot(ua)) return 'bot';
  const isTablet = /ipad/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua)) || /tablet/i.test(ua);
  if (isTablet) return 'tablet';
  if (/mobi|iphone|ipod|android.*mobile|windows phone/i.test(ua)) return 'mobile';
  // UA looks like a desktop — but a tiny viewport says otherwise.
  const w = Number(screenWidth);
  if (Number.isFinite(w) && w > 0) {
    if (w < 768)  return 'mobile';
    if (w < 1024) return 'tablet';
  }
  return 'desktop';
}

function parseUserAgent(userAgent, screenWidth) {
  const ua = String(userAgent || '');
  return {
    device:  _device(ua, screenWidth),
    browser: _browser(ua),
    os:      _os(ua),
  };
}

module.exports = { visitorToken, parseUserAgent, isBot };

'use strict';

const DEFAULT_LOCALE    = process.env.DEFAULT_LOCALE    || 'en';
const SUPPORTED_LOCALES = (process.env.SUPPORTED_LOCALES || 'en,is')
  .split(',').map(l => l.trim()).filter(Boolean);

// The /party page is a birthday landing for an Iceland-based event — visitors
// with no saved locale preference get Icelandic regardless of browser language.
// Saved preference (cookie / users.preferred_locale) still wins.
const PARTY_DEFAULT_LOCALE = 'is';

function isPartyPath(pathname) {
  if (!pathname) return false;
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] && SUPPORTED_LOCALES.includes(parts[0])) parts.shift();
  const stripped = '/' + parts.join('/');
  if (stripped === '/party' || stripped === '/party/admin') return true;
  if (stripped === '/api/v1/party' || stripped.startsWith('/api/v1/party/')) return true;
  return false;
}

module.exports = { DEFAULT_LOCALE, SUPPORTED_LOCALES, PARTY_DEFAULT_LOCALE, isPartyPath };

// Locale-aware formatters. These read `window.__locale` (set by
// i18n.loadLocale) instead of the browser's default locale so dates, times,
// and numbers render in the user's chosen app language — not the language
// their OS happens to be in.
//
// BCP-47 tags: 'en' → 'en-GB' (closest to our app's voice), 'is' → 'is-IS'.

function _tag() {
  return window.__locale === 'is' ? 'is-IS' : 'en-GB';
}

export function formatDate(str, opts = { year: 'numeric', month: 'short', day: 'numeric' }) {
  if (!str) return '—';
  return new Date(str).toLocaleDateString(_tag(), opts);
}

export function formatDateTime(str, opts = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) {
  if (!str) return '—';
  return new Date(str).toLocaleString(_tag(), opts);
}

/**
 * Format a money amount stored as an integer in the currency's smallest unit
 * (ISK has no subunit, EUR stored in cents). Uses Intl.NumberFormat with the
 * active locale so separators ("1.234" vs "1,234") match the UI language.
 */
export function formatMoney(amount, currency) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  if (currency === 'ISK') {
    return new Intl.NumberFormat(_tag(), {
      style: 'currency', currency: 'ISK', maximumFractionDigits: 0,
    }).format(n);
  }
  if (currency === 'EUR') {
    return new Intl.NumberFormat(_tag(), {
      style: 'currency', currency: 'EUR',
    }).format(n / 100);
  }
  return `${n} ${currency}`;
}

/** Plain number formatter (thousands separator in active locale). */
export function formatNumber(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  return new Intl.NumberFormat(_tag()).format(v);
}

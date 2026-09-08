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

// Largest-first, so the first unit the gap clears is the one we speak in.
const REL_STEPS = [
  ['year',   31536000],
  ['month',   2592000],
  ['week',     604800],
  ['day',       86400],
  ['hour',       3600],
  ['minute',       60],
];

/**
 * "3 days ago" / "fyrir 3 dögum" — a coarse, human gap rather than a timestamp.
 *
 * Use it where the ANSWER is recency (an audit row, a lead's last touch, an
 * error in the log) and the exact minute is noise. Where the exact moment
 * matters — an invoice date, a VSK deadline — keep formatDateTime. A good
 * pattern is both: relative as the label, absolute in the `title`.
 *
 * Reads the app locale like every other formatter here, not the OS locale.
 *
 * @param {string} str  ISO timestamp
 * @param {number} now  epoch ms, injectable so tests need no clock control
 */
export function formatRelative(str, now = Date.now()) {
  if (!str) return '—';
  const then = new Date(str).getTime();
  if (!Number.isFinite(then)) return '—';

  // Intl.RelativeTimeFormat is absent on some embedded webviews. cart.js records
  // an ISK-grouping bug seen in exactly such a browser while Node on the same
  // machine was fine, so a missing formatter is a real case here, not a
  // theoretical one — fall back to the absolute date rather than throwing.
  if (typeof Intl.RelativeTimeFormat !== 'function') return formatDate(str);

  const sec = Math.round((then - now) / 1000);
  const abs = Math.abs(sec);
  const rtf = new Intl.RelativeTimeFormat(_tag(), { numeric: 'auto' });

  // Under three quarters of a minute reads as "now" rather than "in 43 seconds".
  if (abs < 45) return rtf.format(0, 'second');

  // Round the MAGNITUDE and reapply the sign. Math.round(-1.5) is -1 while
  // Math.round(1.5) is 2, so rounding the signed value made the past and the
  // future disagree: 90 s ago read "1 minute ago" while 90 s ahead read
  // "in 2 minutes".
  const sign = sec < 0 ? -1 : 1;
  for (const [unit, size] of REL_STEPS) {
    if (abs >= size) return rtf.format(sign * Math.round(abs / size), unit);
  }
  // 45–59 s: no step claimed it, and "1 minute" is the honest rounding.
  return rtf.format(sign, 'minute');
}

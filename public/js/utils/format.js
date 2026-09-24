// Locale-aware formatters. These read `window.__locale` (set by
// i18n.loadLocale) instead of the browser's default locale so dates, times,
// and numbers render in the user's chosen app language — not the language
// their OS happens to be in.
//
// BCP-47 tags: 'en' → 'en-GB' (closest to our app's voice), 'is' → 'is-IS'.

function _tag() {
  return window.__locale === 'is' ? 'is-IS' : 'en-GB';
}

// Ported from icelandicstore #313/#324 (harvest-ice-e-2026-09-24): Intl with
// 'is-IS' is not trusted in the browser for money, numbers or dates.
//
// Icelandic dates, built by hand for the same reason as the numbers below:
// Chrome ships no Icelandic ICU data, so toLocaleDateString('is-IS') quietly
// answers in English ("14 Sept 2026" where Icelandic is "14. sep. 2026" —
// QA 2026-09-13). The output matches what a full-ICU runtime (Node) gives.
const IS_MONTHS_SHORT = ['jan.', 'feb.', 'mar.', 'apr.', 'maí', 'jún.', 'júl.', 'ágú.', 'sep.', 'okt.', 'nóv.', 'des.'];
const IS_MONTHS_LONG = ['janúar', 'febrúar', 'mars', 'apríl', 'maí', 'júní', 'júlí', 'ágúst', 'september', 'október', 'nóvember', 'desember'];
const _pad2 = (v) => String(v).padStart(2, '0');

// The option shapes built by hand: a full date (day numeric|2-digit, month
// short|long, year numeric), optionally with hour (numeric|2-digit) and a
// 2-digit minute, optionally in a given timeZone. Anything else returns null
// and falls through to the runtime.
const IS_SHAPE_KEYS = new Set(['year', 'month', 'day', 'hour', 'minute', 'timeZone']);
function _isDate(date, opts) {
  const o = opts || {};
  if (Object.keys(o).some((k) => !IS_SHAPE_KEYS.has(k))) return null;
  if (o.year !== 'numeric' || !['short', 'long'].includes(o.month) || !['numeric', '2-digit'].includes(o.day)) return null;
  const withTime = o.hour !== undefined || o.minute !== undefined;
  if (withTime && (!['numeric', '2-digit'].includes(o.hour) || o.minute !== '2-digit')) return null;

  // The calendar fields in the zone the runtime would have used — the
  // browser's own unless the caller passed timeZone. en-US is in every ICU
  // build, and only its digits are read here, never its words.
  const parts = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone: o.timeZone, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
  }).formatToParts(date).forEach((p) => { parts[p.type] = Number(p.value); });

  const day = o.day === '2-digit' ? _pad2(parts.day) : String(parts.day);
  const month = (o.month === 'long' ? IS_MONTHS_LONG : IS_MONTHS_SHORT)[parts.month - 1];
  let out = `${day}. ${month} ${parts.year}`;
  if (withTime) {
    const hour = parts.hour % 24; // h23; guards an engine that still says "24" at midnight
    out += `, ${o.hour === '2-digit' ? _pad2(hour) : hour}:${_pad2(parts.minute)}`;
  }
  return out;
}

export function formatDate(str, opts = { year: 'numeric', month: 'short', day: 'numeric' }) {
  if (!str) return '—';
  const date = new Date(str);
  if (_tag() === 'is-IS' && !Number.isNaN(date.getTime())) {
    const is = _isDate(date, opts);
    if (is !== null) return is;
  }
  return date.toLocaleDateString(_tag(), opts);
}

export function formatDateTime(str, opts = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) {
  if (!str) return '—';
  const date = new Date(str);
  if (_tag() === 'is-IS' && !Number.isNaN(date.getTime())) {
    const is = _isDate(date, opts);
    if (is !== null) return is;
  }
  return date.toLocaleString(_tag(), opts);
}

// Icelandic number shape, built by hand: "." groups thousands, "," is the
// decimal mark. Intl cannot be trusted for 'is-IS' in the browser: a runtime
// whose ICU data lacks Icelandic silently falls back to en-US, and in the QA
// run's Chrome every Icelandic admin page that used this formatter read
// "ISK 8,400" (QA 2026-09-13 — order builder, invoice detail). A comma there
// reads as a decimal mark. services/cart.js groups by hand for the same reason.
// The output matches what a full-ICU runtime (Node) gives for is-IS.
function _isNumber(value, fractionDigits) {
  const sign = value < 0 ? '-' : '';
  const fixed = Math.abs(value).toFixed(fractionDigits);
  const [int, frac] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return sign + grouped + (frac ? `,${frac}` : '');
}

/**
 * Format a money amount stored as an integer in the currency's smallest unit
 * (ISK has no subunit, EUR stored in cents). Separators follow the active UI
 * language ("8.400 kr." in Icelandic, "ISK 8,400" in English).
 */
export function formatMoney(amount, currency) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  if (_tag() === 'is-IS') {
    // A no-break space before the unit, as ICU writes it, so "8.400 kr." never
    // wraps between the number and its currency.
    const NBSP = String.fromCharCode(0xa0);
    if (currency === 'ISK') return `${_isNumber(Math.round(n), 0)}${NBSP}kr.`;
    if (currency === 'EUR') return `${_isNumber(n / 100, 2)}${NBSP}EUR`;
  }
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

/**
 * ISK with up to two decimals — for an invoice line's unit price, which is the
 * line total ÷ quantity and so is often not whole ("1.333,67 kr."). A whole
 * amount prints exactly like formatMoney(n, 'ISK').
 */
export function formatIskExact(amount) {
  const n = Math.round((Number(amount) || 0) * 100) / 100;
  if (Number.isInteger(n)) return formatMoney(n, 'ISK');
  if (_tag() === 'is-IS') return `${_isNumber(n, 2)}${String.fromCharCode(0xa0)}kr.`;
  return new Intl.NumberFormat(_tag(), {
    style: 'currency', currency: 'ISK', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n);
}

/** Plain number formatter (thousands separator in active locale). */
export function formatNumber(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  if (_tag() === 'is-IS') {
    // Intl's default: at most three fraction digits, trailing zeros dropped.
    const s = _isNumber(v, 3);
    return s.includes(',') ? s.replace(/,?0+$/, '') : s;
  }
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

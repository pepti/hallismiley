// Accounting dates are calendar days, not instants.
//
// The books use Postgres DATE for every accounting date (entry_date, expense_date,
// rate_date, period bounds), and node-postgres hands those back as JavaScript Date
// objects constructed at LOCAL midnight. Two traps follow:
//
//   String(dateObj).slice(0, 10)  ->  "Wed Aug 05"   (toString, not ISO)
//   dateObj.toISOString()         ->  shifts a day backwards for any server
//                                     running at a positive UTC offset
//
// Iceland is UTC+0 all year so both happen to look fine locally, and would start
// misreporting dates the moment the app runs anywhere else — which it does, on
// Azure. toIsoDate reads the local calendar components directly, which is exactly
// what pg put there, so it round-trips the stored day unchanged from any timezone.

class DateError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DateError';
    this.status = 400;
  }
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Normalise anything date-ish to 'YYYY-MM-DD'. Returns null for null/undefined so
// nullable columns pass through cleanly.
function toIsoDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    // Shape alone is not enough: '2026-08-99' and '2026-13-01' both match the
    // pattern. Without a real-calendar check they flow through as strings, compare
    // as "in the future", and produce a nonsense error — or worse, reach a DATE
    // column and fail deep inside a transaction.
    if (ISO_DATE_RE.test(trimmed)) {
      assertRealCalendarDate(trimmed);
      return trimmed;
    }
    // A full timestamp string: take the date part as written, without re-parsing,
    // so no timezone conversion can move the day.
    const m = /^(\d{4}-\d{2}-\d{2})[T ]/.exec(trimmed);
    if (m) return m[1];
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) throw new DateError(`Not a valid date: ${value}`);
    return fromLocalParts(parsed);
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new DateError('Not a valid date: Invalid Date');
    return fromLocalParts(value);
  }
  throw new DateError(`Not a valid date: ${value}`);
}

// Reject an ISO-shaped string that is not a real day. Round-tripping through
// Date.UTC catches both an impossible month and a day past the end of its month
// (including 29 February in a non-leap year), because JS would otherwise roll
// them over into the following month.
function assertRealCalendarDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) {
    throw new DateError(`Not a valid date: ${iso}`);
  }
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    throw new DateError(`Not a valid date: ${iso}`);
  }
  return iso;
}

function fromLocalParts(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Validate a user-supplied accounting date. Returns 'YYYY-MM-DD'.
// `allowFuture` is false by default: an accounting date after today is almost
// always a typo, and a future-dated entry quietly distorts every period between.
function assertAccountingDate(value, label = 'date', { allowFuture = false } = {}) {
  const iso = toIsoDate(value);
  if (!iso) throw new DateError(`${label} is required`);
  if (!allowFuture && iso > todayIso()) {
    throw new DateError(`${label} is in the future: ${iso}`);
  }
  return iso;
}

function todayIso() {
  return fromLocalParts(new Date());
}

// Add days to an ISO date, staying in the calendar domain. Used for invoice due
// dates (issue date + payment terms).
function addDays(isoDate, days) {
  const iso = toIsoDate(isoDate);
  if (!iso) throw new DateError('addDays requires a date');
  const n = Number(days);
  if (!Number.isInteger(n)) throw new DateError(`addDays requires whole days, got: ${days}`);
  // Compute in UTC so DST transitions cannot shift the result by a day.
  const [y, m, d] = iso.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + n));
  return shifted.toISOString().slice(0, 10);
}

// Whole days between two ISO dates (b - a). Used for AR aging buckets.
function daysBetween(a, b) {
  const isoA = toIsoDate(a);
  const isoB = toIsoDate(b);
  if (!isoA || !isoB) throw new DateError('daysBetween requires two dates');
  const ms = Date.parse(`${isoB}T00:00:00Z`) - Date.parse(`${isoA}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

module.exports = {
  DateError, toIsoDate, assertAccountingDate, assertRealCalendarDate,
  todayIso, addDays, daysBetween,
};

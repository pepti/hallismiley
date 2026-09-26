// The report window a request asks for — ?from&to (+ ?compare_from&compare_to,
// ?bucket) on the admin sales, insights and marketing reports (harvest 2 lane
// 5, 2026-09-26; the rules are icelandicstore #414's). Pure: the query object in,
// a window or an error out.
//
//   * A bare 'YYYY-MM-DD' is that day's midnight on the shop's clock —
//     Atlantic/Reykjavik, which is UTC all year, so UTC midnight. A full ISO
//     instant is taken as given: the dashboard compares a window that runs to
//     the end of today only up to the same moment of the matching day
//     (utils/dateRanges.js prevCut).
//   * The window is half-open [from, to). Empty or backwards — or a date that
//     does not parse — is invalid, for either window.
//   * `to` defaults to now and `from` to 30 days before it, so a caller that
//     names neither still gets the trailing month.
//   * The bucket is one of hour / day / week / month; anything else (or none)
//     follows the span, the same thresholds as the client's granularity().

const BUCKETS = ['hour', 'day', 'week', 'month'];
const DAY = 86400000;
const DEFAULT_DAYS = 30;

function parseInstant(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Chart resolution for a span: one day by the hour, ≤ 45 days by the day, ≤ 200 by the week. */
function bucketFor(from, to) {
  const days = Math.round((to.getTime() - from.getTime()) / DAY);
  if (days <= 1) return 'hour';
  if (days <= 45) return 'day';
  if (days <= 200) return 'week';
  return 'month';
}

/**
 * @param {object} q  req.query
 * @param {Date}   [now]
 * @returns {{ ok: true, from: Date, to: Date, compare: {from: Date, to: Date}|null, bucket: string }
 *          | { ok: false }}
 */
function parseReportWindow(q = {}, now = new Date()) {
  const toRaw = parseInstant(q.to);
  const fromRaw = parseInstant(q.from);
  if (toRaw === undefined || fromRaw === undefined) return { ok: false };
  const to = toRaw || now;
  const from = fromRaw || new Date(to.getTime() - DEFAULT_DAYS * DAY);
  if (from >= to) return { ok: false };

  let compare = null;
  if (q.compare_from !== undefined || q.compare_to !== undefined) {
    const cf = parseInstant(q.compare_from);
    const ct = parseInstant(q.compare_to);
    if (!cf || !ct || cf >= ct) return { ok: false };
    compare = { from: cf, to: ct };
  }
  const bucket = BUCKETS.includes(q.bucket) ? q.bucket : bucketFor(from, to);
  return { ok: true, from, to, compare, bucket };
}

module.exports = { parseReportWindow, bucketFor, BUCKETS };

// Period presets for the admin sales report — "Í dag", "Síðasti mánuður", "Á
// árinu" … — each resolved to a half-open window [from, to) of YYYY-MM-DD
// dates plus the window it is compared against.
//
// Ported from icelandicstore #414 (harvest 2 lane 5, 2026-09-26), unchanged
// but for the Icelandic labels: Chrome ships no Icelandic ICU data, so
// formatRange / bucketLabel build 'is' by hand (as utils/format.js does) where
// ice relied on Intl's 'is-IS'.
//
// Everything is UTC: Iceland keeps UTC all year (no DST), so a UTC calendar day
// IS the shop's day, and the server reads `new Date('YYYY-MM-DD')` as UTC
// midnight too. Same assumption as server/utils/announcementWindow.js.
//
// The comparison window:
//   - calendar presets (this week / month / year to date / last 12 months) move back one
//     calendar unit and keep the same length — "this month so far" (1–23 Sept)
//     is compared with 1–23 Aug, not with the 23 days before 1 Sept;
//   - rolling presets (last 7 / 30 / 90 days) compare with the equally long
//     window just before;
//   - `all` has nothing to compare with.
//
// A window that runs to the end of TODAY is only part-way through its last
// day, so it is compared up to the same moment of the matching day — `prevCut`,
// an instant — not the whole of it: "today so far" against "yesterday up to
// this time", or every morning would read as a fall.

const DAY = 86400000;

export const PRESETS = [
  'today', 'yesterday', 'thisWeek', 'last7',
  'thisMonth', 'lastMonth', 'last30', 'last90',
  'ytd', 'last12m', 'all',
];

export const DEFAULT_PRESET = 'thisMonth';

// Where "all time" starts. Earlier than any order this store can hold.
const EPOCH = Date.UTC(2000, 0, 1);

export function isoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// Midnight UTC of a YYYY-MM-DD string (or of a Date / ms).
export function dayMs(value) {
  if (typeof value === 'string') {
    const [y, m, d] = value.slice(0, 10).split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  }
  const dt = new Date(value);
  return Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
}

// Monday of the ISO week that contains `ms` (a UTC midnight).
export function mondayOf(ms) {
  const dow = new Date(ms).getUTCDay(); // 0 = Sunday
  return ms - ((dow + 6) % 7) * DAY;
}

// Shift a UTC midnight by whole calendar months / years. Date.UTC normalises
// overflow (31 Mar − 1 month = 3 Mar), which is why every caller clamps the
// result to the start of the window it must not run past.
function shift(ms, { months = 0, years = 0 } = {}) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear() + years, d.getUTCMonth() + months, d.getUTCDate());
}

/**
 * Resolve a preset against `now` (default: the current time).
 * Returns { preset, from, to, prevFrom, prevTo, prevCut } — YYYY-MM-DD strings,
 * `to` and `prevTo` exclusive (they label the windows); `prevCut` is the ISO
 * instant the comparison is actually queried up to. The prev* fields are null
 * when there is no comparison.
 */
export function resolvePreset(preset, now = Date.now()) {
  const key = PRESETS.includes(preset) ? preset : DEFAULT_PRESET;
  const nowMs    = new Date(now).getTime();
  const today    = dayMs(now);
  const tomorrow = today + DAY;
  let from, to, prevFrom = null, prevTo = null, clamped = false;

  switch (key) {
    case 'today':
      from = today; to = tomorrow;
      prevFrom = today - DAY; prevTo = today;
      break;
    case 'yesterday':
      from = today - DAY; to = today;
      prevFrom = today - 2 * DAY; prevTo = today - DAY;
      break;
    case 'thisWeek':
      from = mondayOf(today); to = tomorrow;
      prevFrom = from - 7 * DAY; prevTo = to - 7 * DAY;
      break;
    case 'thisMonth': {
      from = Date.UTC(new Date(today).getUTCFullYear(), new Date(today).getUTCMonth(), 1);
      to = tomorrow;
      prevFrom = shift(from, { months: -1 });
      const back = shift(to, { months: -1 });
      clamped = back >= from; // reaches the whole previous unit: compare all of it
      prevTo = Math.min(back, from);
      break;
    }
    case 'lastMonth': {
      const thisFirst = Date.UTC(new Date(today).getUTCFullYear(), new Date(today).getUTCMonth(), 1);
      from = shift(thisFirst, { months: -1 }); to = thisFirst;
      prevFrom = shift(from, { months: -1 }); prevTo = from;
      break;
    }
    case 'ytd': {
      from = Date.UTC(new Date(today).getUTCFullYear(), 0, 1);
      to = tomorrow;
      prevFrom = shift(from, { years: -1 });
      const back = shift(to, { years: -1 });
      clamped = back >= from; // reaches the whole previous unit: compare all of it
      prevTo = Math.min(back, from);
      break;
    }
    case 'last12m': {
      // Twelve calendar months, this one included — so the chart's first bar
      // is a whole month, not the last week of one. Compared with the same
      // months a year earlier.
      const d = new Date(today);
      from = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 11, 1); to = tomorrow;
      prevFrom = shift(from, { years: -1 });
      const back = shift(to, { years: -1 });
      clamped = back >= from; // reaches the whole previous unit: compare all of it
      prevTo = Math.min(back, from);
      break;
    }
    case 'all':
      from = EPOCH; to = tomorrow;
      break;
    default: { // last7 / last30 / last90
      const n = Number(key.slice(4));
      from = tomorrow - n * DAY; to = tomorrow;
      prevFrom = from - n * DAY; prevTo = from;
    }
  }

  // The comparison's cut-off instant (see the header). A comparison that had
  // to be shortened to fit a shorter month / year is already the whole of it.
  let prevCut = null;
  if (prevTo != null) {
    prevCut = (to === tomorrow && !clamped) ? prevTo - DAY + (nowMs - today) : prevTo;
  }

  return {
    preset: key,
    from: isoDay(from),
    to: isoDay(to),
    prevFrom: prevFrom == null ? null : isoDay(prevFrom),
    prevTo:   prevTo   == null ? null : isoDay(prevTo),
    prevCut:  prevCut  == null ? null : new Date(prevCut).toISOString(),
  };
}

/** Whole days in [from, to). */
export function spanDays(from, to) {
  return Math.round((dayMs(to) - dayMs(from)) / DAY);
}

/**
 * How finely to draw the chart for a window: one day by the hour, up to ~6
 * weeks by the day, up to ~6½ months by the week, anything longer by month.
 */
export function granularity(from, to) {
  const n = spanDays(from, to);
  if (n <= 1)   return 'hour';
  if (n <= 45)  return 'day';
  if (n <= 200) return 'week';
  return 'month';
}

// The bucket a server point ('YYYY-MM-DD' or 'YYYY-MM-DDTHH') falls into.
function bucketKey(point, gran) {
  if (gran === 'hour')  return point.slice(0, 13);
  if (gran === 'day')   return point.slice(0, 10);
  if (gran === 'month') return point.slice(0, 7);
  return isoDay(mondayOf(dayMs(point)));
}

// Every bucket key from `startMs` up to (not including) `endMs`.
function bucketKeys(startMs, endMs, gran) {
  const keys = [];
  if (gran === 'hour') {
    for (let t = startMs; t < endMs; t += 3600000) keys.push(new Date(t).toISOString().slice(0, 13));
    return keys;
  }
  if (gran === 'day') {
    for (let t = startMs; t < endMs; t += DAY) keys.push(isoDay(t));
    return keys;
  }
  if (gran === 'week') {
    for (let t = mondayOf(startMs); t < endMs; t += 7 * DAY) keys.push(isoDay(t));
    return keys;
  }
  const d = new Date(startMs);
  for (let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); t < endMs; t = shift(t, { months: 1 })) {
    keys.push(isoDay(t).slice(0, 7));
  }
  return keys;
}

/**
 * Fold the server's points ({ day, …numeric fields }) into the window's
 * buckets, with an explicit zero for every bucket that sold nothing — a line
 * drawn only through the days that had orders hides the quiet ones.
 * `trimLeading` starts at the first bucket with data (for "all time", which
 * would otherwise open on 25 years of zeros).
 */
export function fillSeries(points, { from, to, gran, fields, trimLeading = false, until = null }) {
  const sums = new Map();
  for (const p of points || []) {
    const key = bucketKey(String(p.day), gran);
    const acc = sums.get(key) || Object.fromEntries(fields.map(f => [f, 0]));
    for (const f of fields) acc[f] += Number(p[f]) || 0;
    sums.set(key, acc);
  }
  let start = dayMs(from);
  if (trimLeading) {
    if (!sums.size) return [];
    const first = [...sums.keys()].sort()[0];
    start = dayMs(first.length === 7 ? `${first}-01` : first);
  }
  // `until`: an hourly "today" stops at the current hour instead of drawing
  // the rest of the day as a row of zeros that have not happened yet.
  let end = dayMs(to);
  if (until != null && gran === 'hour') end = Math.min(end, Math.floor(new Date(until).getTime() / 3600000) * 3600000 + 3600000);
  return bucketKeys(start, end, gran).map(key => ({
    key,
    ...(sums.get(key) || Object.fromEntries(fields.map(f => [f, 0]))),
  }));
}

// Icelandic short month names, the kit's (utils/format.js IS_MONTHS_SHORT).
const IS_MONTHS = ['jan.', 'feb.', 'mar.', 'apr.', 'maí', 'jún.', 'júl.', 'ágú.', 'sep.', 'okt.', 'nóv.', 'des.'];

function isParts(ms) {
  const d = new Date(ms);
  return { day: d.getUTCDate(), month: IS_MONTHS[d.getUTCMonth()], year: d.getUTCFullYear() };
}

// "1.–23. sep. 2026", "28. ágú.–3. sep. 2026", "28. des. 2025 – 3. jan. 2026".
function formatRangeIs(a, b) {
  const x = isParts(a);
  if (a >= b) return `${x.day}. ${x.month} ${x.year}`;
  const y = isParts(b);
  if (x.year !== y.year) return `${x.day}. ${x.month} ${x.year} – ${y.day}. ${y.month} ${y.year}`;
  if (x.month !== y.month) return `${x.day}. ${x.month}–${y.day}. ${y.month} ${y.year}`;
  return `${x.day}.–${y.day}. ${y.month} ${y.year}`;
}

/**
 * "1.–23. sep. 2026" (is) / "1–23 Sept 2026" (en) for [from, to) — the last
 * day shown is the day BEFORE `to`. A single day reads as one date.
 */
export function formatRange(from, to, locale = 'is') {
  const a = dayMs(from);
  const b = dayMs(to) - DAY;
  if (locale === 'is') return formatRangeIs(a, b);
  const fmt = new Intl.DateTimeFormat('en-GB',
    { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  if (a >= b) return fmt.format(new Date(a));
  return typeof fmt.formatRange === 'function'
    ? fmt.formatRange(new Date(a), new Date(b))
    : `${fmt.format(new Date(a))} – ${fmt.format(new Date(b))}`;
}

/** Axis label for a fillSeries bucket key. */
export function bucketLabel(key, gran, locale = 'is') {
  if (gran === 'hour') return `${key.slice(11, 13)}:00`;
  if (gran === 'month') {
    const ms = dayMs(`${key.slice(0, 7)}-01`);
    if (locale === 'is') { const p = isParts(ms); return `${p.month} ${p.year}`; }
    return new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(ms));
  }
  if (locale === 'is') { const p = isParts(dayMs(key)); return `${p.day}. ${p.month}`; }
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(dayMs(key)));
}

/** Percent change from `prev` to `cur`, or null when there is no base. */
export function percentChange(cur, prev) {
  const c = Number(cur) || 0;
  const p = Number(prev) || 0;
  if (!p) return null;
  return ((c - p) / Math.abs(p)) * 100;
}

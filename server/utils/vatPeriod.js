// Icelandic VSK settlement periods.
//
// The default settlement window is bi-monthly: Jan+Feb, Mar+Apr, ... Nov+Dec.
// A period is keyed 'YYYY-P{1..6}'.
//
// Filing DEADLINES are deliberately NOT computed here. The statutory rule is
// "one month and five days after the period ends", but the actual date shifts
// for weekends and public holidays, so the real dates are stored as data in the
// tax_deadlines table, copied from Skatturinn's Skattadagatal. Computing them
// with naive date math produces a date that is right most years and quietly
// wrong in the years that matter.

const { toIsoDate } = require('./booksDate');

const PERIODS_PER_YEAR = 6;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;
// Guards a stray far-future or far-past date from expanding a range into
// hundreds of thousands of periods.
const MAX_PERIODS = 120;

class PeriodError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PeriodError';
    this.status = 400;
  }
}

function periodKey(year, index) {
  return `${year}-P${index}`;
}

// Which period does this date fall in? Accepts a Date, an ISO 'YYYY-MM-DD', or a
// timestamp string.
//
// Goes through toIsoDate rather than reading UTC parts off a Date. node-postgres
// hands back DATE columns as Date objects at LOCAL midnight, so `getUTCMonth()` on
// a server at a positive offset reports the PREVIOUS day — which at a period
// boundary silently files a transaction under the wrong VSK return.
function periodForDate(date) {
  let iso;
  try {
    iso = toIsoDate(date);
  } catch (_err) {
    throw new PeriodError(`Invalid date: ${date}`);
  }
  if (!iso) throw new PeriodError(`Invalid date: ${date}`);
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7)) - 1; // 0-11
  return periodKey(year, Math.floor(month / 2) + 1);
}

function parsePeriod(period) {
  const m = /^(\d{4})-P([1-6])$/.exec(String(period || '').trim());
  if (!m) throw new PeriodError(`Invalid VSK period: ${period} (expected e.g. 2026-P3)`);
  const year = Number(m[1]);
  const index = Number(m[2]);
  if (year < MIN_YEAR || year > MAX_YEAR) {
    throw new PeriodError(`Period year out of range: ${year}`);
  }
  return { year, index };
}

// Inclusive [starts_on, ends_on] as ISO date strings, matching the DATE columns
// in fiscal_periods. The end is the last day of the second month, which
// Date.UTC handles for us by asking for day 0 of the following month.
function periodBounds(period) {
  const { year, index } = parsePeriod(period);
  const startMonth = (index - 1) * 2;
  const starts = new Date(Date.UTC(year, startMonth, 1));
  const ends = new Date(Date.UTC(year, startMonth + 2, 0));
  return {
    period,
    year,
    index,
    starts_on: starts.toISOString().slice(0, 10),
    ends_on: ends.toISOString().slice(0, 10),
  };
}

// Previous / next, wrapping across the year boundary.
function previousPeriod(period) {
  const { year, index } = parsePeriod(period);
  return index === 1 ? periodKey(year - 1, PERIODS_PER_YEAR) : periodKey(year, index - 1);
}

function nextPeriod(period) {
  const { year, index } = parsePeriod(period);
  return index === PERIODS_PER_YEAR ? periodKey(year + 1, 1) : periodKey(year, index + 1);
}

// The same period one year earlier — the comparison the "output VAT is well below
// last year" anomaly check needs.
function samePeriodLastYear(period) {
  const { year, index } = parsePeriod(period);
  return periodKey(year - 1, index);
}

// All periods from `from` to `to` inclusive, oldest first.
function listPeriods(from, to) {
  const a = parsePeriod(from);
  const b = parsePeriod(to);
  const ordinal = p => p.year * PERIODS_PER_YEAR + (p.index - 1);
  if (ordinal(a) > ordinal(b)) throw new PeriodError(`Period range is reversed: ${from} > ${to}`);
  const count = ordinal(b) - ordinal(a) + 1;
  if (count > MAX_PERIODS) {
    throw new PeriodError(`Period range too wide: ${count} periods (max ${MAX_PERIODS})`);
  }
  const out = [];
  let cur = from;
  for (let i = 0; i < count; i += 1) {
    out.push(cur);
    cur = nextPeriod(cur);
  }
  return out;
}

// Every period of a calendar year — the fiscal-year P&L and the annual RSK 10.25
// reconciliation both work on this.
function periodsInYear(year) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < MIN_YEAR || y > MAX_YEAR) {
    throw new PeriodError(`Invalid year: ${year}`);
  }
  return Array.from({ length: PERIODS_PER_YEAR }, (_, i) => periodKey(y, i + 1));
}

module.exports = {
  PERIODS_PER_YEAR,
  MAX_PERIODS,
  PeriodError,
  periodForDate,
  parsePeriod,
  periodBounds,
  previousPeriod,
  nextPeriod,
  samePeriodLastYear,
  listPeriods,
  periodsInYear,
};

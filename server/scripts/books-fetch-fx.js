#!/usr/bin/env node
// Maintain the fx_rates table used to translate EUR documents into ISK.
//
// Three modes, in order of how much you should trust them:
//
//   1. Manual, one rate:
//        node server/scripts/books-fetch-fx.js --date=2026-08-06 --rate=143.20
//      Always works. This is the mode to use when an invoice is blocked.
//
//   2. Bulk import from a file you downloaded yourself:
//        node server/scripts/books-fetch-fx.js --import=rates.json
//        node server/scripts/books-fetch-fx.js --import=rates.csv
//      JSON: [{ "date": "2026-08-05", "currency": "EUR", "rate": 142.9 }, ...]
//      CSV:  date,currency,rate  (header required)
//      Use this after downloading the official daily rates from the Central Bank
//      of Iceland (cb.is / sedlabanki.is), which publishes them each business day
//      around 16:00.
//
//   3. Automated fetch from a feed URL:
//        BOOKS_FX_FEED_URL=... node server/scripts/books-fetch-fx.js --fetch
//      DELIBERATELY NOT PRE-CONFIGURED. The Central Bank's public rate page is
//      JavaScript-rendered and its Data Portal API requires credentials issued for
//      regulatory data submission, so at the time of writing there is no verified
//      stable public endpoint to hardcode. Rather than ship a URL that silently
//      404s (and leaves the books quietly running on a stale rate), this mode only
//      runs when you supply an endpoint you have checked yourself. See
//      docs/BOOKKEEPING-SYSTEM.md for what shape the response must have.
//
// Whatever the mode, every rate is written with its provenance ('cbi' or 'manual')
// and is plausibility-checked, so a rate typed as 1.43 instead of 143 is refused
// rather than understating revenue a hundredfold.

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const logger = require('../logger');
const FxRate = require('../models/FxRate');
const { assertSupportedCurrency, FxError } = require('../utils/fx');
const { assertAccountingDate, toIsoDate, todayIso, DateError } = require('../utils/booksDate');

const DEFAULT_CURRENCY = 'EUR';

function parseArgs(argv) {
  const args = { _: [] };
  for (const raw of argv.slice(2)) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(raw);
    if (m) args[m[1]] = m[2] === undefined ? true : m[2];
    else args._.push(raw);
  }
  return args;
}

// A rate dated in the future cannot be an official published rate, so the shared
// accounting-date guard (which rejects future dates by default) is exactly right.
function assertIsoDate(value, label) {
  return assertAccountingDate(value, label);
}

// ── Mode 2: file import ───────────────────────────────────────────────────────

function readRateFile(filePath) {
  const resolved = path.resolve(filePath);
  const raw = fs.readFileSync(resolved, 'utf8');
  if (resolved.toLowerCase().endsWith('.json')) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('JSON rate file must be an array of {date, currency, rate}');
    return parsed;
  }
  // CSV: header row, then date/currency/rate columns in any order.
  const lines = raw.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error('CSV rate file needs a header row and at least one data row');

  // Detect the delimiter from the HEADER rather than splitting on /[,;]/.
  // Icelandic locale writes decimals with a comma ("143,05"), and a semicolon-
  // delimited file is the normal export shape here — so splitting on either
  // character would cut "143,05" into two cells and silently book the rate as 143.
  // A ~1% error in every converted invoice, with nothing to show it happened.
  const delimiter = lines[0].includes(';') ? ';' : ',';
  const split = line => line.split(delimiter).map(c => c.trim());

  const header = split(lines[0]).map(h => h.toLowerCase());
  const iDate = header.indexOf('date');
  const iCur = header.indexOf('currency');
  const iRate = header.indexOf('rate');
  if (iDate < 0 || iRate < 0) throw new Error('CSV rate file needs at least "date" and "rate" columns');

  return lines.slice(1).map((line, rowIndex) => {
    const cells = split(line);
    const rawRate = String(cells[iRate] ?? '');
    // Only treat a comma as a decimal separator when it cannot be the delimiter.
    const normalised = delimiter === ';' ? rawRate.replace(',', '.') : rawRate;
    const rate = Number(normalised);
    if (!Number.isFinite(rate)) {
      throw new Error(
        `Row ${rowIndex + 2}: cannot read a rate from "${rawRate}". ` +
        `The file is being read as "${delimiter}"-delimited — check the delimiter and decimal separator.`
      );
    }
    return { date: cells[iDate], currency: iCur >= 0 ? cells[iCur] : DEFAULT_CURRENCY, rate };
  });
}

// ── Mode 3: configured feed ───────────────────────────────────────────────────

async function fetchFromFeed(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Rate feed returned HTTP ${res.status} ${res.statusText}`);
  const body = await res.json();
  // Accept either a bare array or a { rates: [...] } envelope, since the exact
  // feed is operator-supplied.
  const list = Array.isArray(body) ? body : body.rates;
  if (!Array.isArray(list)) {
    throw new Error('Rate feed response must be an array, or an object with a "rates" array');
  }
  return list.map(r => ({
    date: r.date || r.rate_date || r.Date,
    currency: (r.currency || r.Currency || DEFAULT_CURRENCY).toUpperCase(),
    rate: Number(r.rate ?? r.value ?? r.Rate),
  }));
}

// ── Writing ───────────────────────────────────────────────────────────────────

async function persist(entries, source, { dryRun }) {
  const results = { written: 0, skipped: 0, errors: [] };
  for (const entry of entries) {
    try {
      const date = assertIsoDate(entry.date, 'date');
      const currency = assertSupportedCurrency(entry.currency || DEFAULT_CURRENCY);
      if (currency === 'ISK') { results.skipped += 1; continue; }
      if (dryRun) {
        console.log(`  would set ${currency} ${date} = ${entry.rate}`);
        results.written += 1;
        continue;
      }
      const row = await FxRate.set({ rateDate: date, currency, rate: entry.rate, source });
      console.log(`  ${row.currency} ${toIsoDate(row.rate_date)} = ${Number(row.rate)}`);
      results.written += 1;
    } catch (err) {
      // Collect rather than abort: one bad row in a bulk file should not discard
      // the good ones, and the operator needs to see all the problems at once.
      results.errors.push(`${entry.date || '?'} ${entry.currency || '?'}: ${err.message}`);
    }
  }
  return results;
}

function usage() {
  console.log(`
Maintain EUR/ISK (and other) exchange rates for the books.

  --date=YYYY-MM-DD --rate=143.20 [--currency=EUR]   set one rate manually
  --import=path.json|path.csv                        bulk import a downloaded file
  --fetch                                            pull from BOOKS_FX_FEED_URL
  --status [--currency=EUR]                          show how fresh the table is
  --dry-run                                          print what would change
  --json                                             machine-readable output

Rates are per one unit of foreign currency, in ISK (EUR 1 = 143.20 ISK -> 143.20).
`.trim());
}

async function main() {
  const args = parseArgs(process.argv);
  const currency = String(args.currency || DEFAULT_CURRENCY).toUpperCase();
  const dryRun = Boolean(args['dry-run']);
  const asJson = Boolean(args.json);

  if (args.help || args.h) { usage(); return 0; }

  // --status: is the table fresh enough to invoice a EUR order today?
  if (args.status) {
    const freshness = await FxRate.freshness(currency);
    if (asJson) {
      console.log(JSON.stringify(freshness, null, 2));
    } else if (!freshness.has_rate) {
      console.log(`No ${currency} rates stored at all. Add one with --date=... --rate=...`);
    } else {
      console.log(
        `${currency}: latest ${freshness.latest_rate} on ${freshness.latest_rate_date} ` +
        `(${freshness.source}), ${freshness.stale_days} day(s) old — ` +
        (freshness.ok ? 'usable' : `TOO STALE (limit ${FxRate.MAX_STALENESS_DAYS} days)`)
      );
    }
    return freshness.ok ? 0 : 1;
  }

  let entries;
  let source;

  if (args.rate !== undefined) {
    const date = args.date ? assertIsoDate(args.date, '--date') : todayIso();
    entries = [{ date, currency, rate: Number(String(args.rate).replace(',', '.')) }];
    source = 'manual';
  } else if (args.import) {
    entries = readRateFile(args.import);
    // A file downloaded from the Central Bank is an official rate, but we cannot
    // verify that from here, so it is recorded as operator-supplied.
    source = args['from-cbi'] ? 'cbi' : 'manual';
    console.log(`Read ${entries.length} row(s) from ${args.import}`);
  } else if (args.fetch) {
    const url = process.env.BOOKS_FX_FEED_URL;
    if (!url) {
      console.error(
        'BOOKS_FX_FEED_URL is not set.\n' +
        'There is no verified public Central Bank of Iceland rate endpoint to default to, so\n' +
        'this mode requires an endpoint you have checked yourself. Until then use:\n' +
        '  --date=YYYY-MM-DD --rate=<ISK per EUR>     (one rate)\n' +
        '  --import=rates.csv                         (a file downloaded from cb.is)'
      );
      return 2;
    }
    entries = await fetchFromFeed(url);
    source = 'cbi';
    console.log(`Fetched ${entries.length} row(s) from the configured feed`);
  } else {
    usage();
    return 2;
  }

  const results = await persist(entries, source, { dryRun });

  if (asJson) {
    console.log(JSON.stringify({ ...results, dry_run: dryRun, source }, null, 2));
  } else {
    console.log(
      `${dryRun ? '[dry run] ' : ''}${results.written} rate(s) written, ` +
      `${results.skipped} skipped, ${results.errors.length} error(s)`
    );
    results.errors.forEach(e => console.error(`  ! ${e}`));
  }

  // Non-zero when nothing landed, so a cron wrapper notices.
  if (results.errors.length && results.written === 0) return 1;
  return 0;
}

if (require.main === module) {
  main()
    .then(async (code) => { await db.pool.end(); process.exit(code); })
    .catch(async (err) => {
      // FxError and DateError are operator-facing refusals with a usable message —
      // a stack trace there is noise that buries the actual instruction. Anything
      // else is a bug and gets the full trace.
      const isExpected = err instanceof FxError || err instanceof DateError
        || err instanceof SyntaxError || err.code === 'ENOENT';
      if (isExpected) {
        console.error(`Refused: ${err.message}`);
      } else {
        logger.error({ err: err.message }, 'books-fetch-fx failed');
        console.error(err.stack || err.message);
      }
      await db.pool.end().catch(() => {});
      process.exit(1);
    });
}

module.exports = { parseArgs, readRateFile, assertIsoDate };

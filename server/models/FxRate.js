// Exchange rates used to translate foreign-currency documents into ISK.
//
// A rate is looked up for the document's own date. If that exact date has no rate
// (weekends, holidays, or a feed that has not run), the most recent EARLIER rate
// is used — which is what an accountant does by hand, and is deterministic in a
// way that "nearest rate" is not. Never fall forward to a later rate: that would
// value a transaction using information that did not exist when it happened.

const db = require('../config/database');
const { assertPlausibleRate, assertSupportedCurrency, FxError } = require('../utils/fx');
const { toIsoDate, daysBetween, todayIso } = require('../utils/booksDate');

// How far back a lookup may reach before giving up. A gap this wide means the feed
// is broken, and silently valuing a January invoice at October's rate is worse
// than refusing and asking someone to enter the rate.
const MAX_STALENESS_DAYS = 14;

class FxRate {
  // Rate for a currency on a date. Returns { rate, rate_date, source, stale_days }.
  // ISK short-circuits to 1 — it is the reporting currency, not a conversion.
  static async forDate(currency, date, client = db) {
    const cur = assertSupportedCurrency(currency);
    if (cur === 'ISK') {
      return { currency: 'ISK', rate: 1, rate_date: toIsoDate(date), source: 'reporting', stale_days: 0 };
    }
    const day = toIsoDate(date);
    const { rows } = await client.query(
      `SELECT rate_date, currency, rate, source
         FROM fx_rates
        WHERE currency = $1 AND rate_date <= $2::date
        ORDER BY rate_date DESC
        LIMIT 1`,
      [cur, day]
    );
    if (!rows.length) {
      throw new FxError(
        `No ${cur} exchange rate on or before ${day}. Run "npm run books:fx" or enter the rate manually.`
      );
    }
    const row = rows[0];
    const staleDays = daysBetween(toIsoDate(row.rate_date), day);
    if (staleDays > MAX_STALENESS_DAYS) {
      throw new FxError(
        `The most recent ${cur} rate is from ${toIsoDate(row.rate_date)}, ` +
        `${staleDays} days before ${day}. Refusing to translate at a stale rate — update the rate table first.`
      );
    }
    return {
      currency: cur,
      rate: Number(row.rate),
      rate_date: toIsoDate(row.rate_date),
      source: row.source,
      stale_days: staleDays,
    };
  }

  // Upsert one rate. Re-running the fetch script for a day it already has is a
  // no-op on the value but refreshes provenance, so a manual rate can be
  // corrected by a later official one.
  static async set({ rateDate, currency, rate, source = 'manual', createdBy = null }, client = db) {
    const cur = assertSupportedCurrency(currency);
    if (cur === 'ISK') throw new FxError('ISK is the reporting currency; it has no stored rate');
    const value = assertPlausibleRate(cur, rate);
    const { rows } = await client.query(
      `INSERT INTO fx_rates (rate_date, currency, rate, source, created_by)
       VALUES ($1::date, $2, $3, $4, $5)
       ON CONFLICT (rate_date, currency)
         DO UPDATE SET rate = EXCLUDED.rate, source = EXCLUDED.source, created_by = EXCLUDED.created_by
       RETURNING rate_date, currency, rate, source`,
      [toIsoDate(rateDate), cur, value, source, createdBy]
    );
    return rows[0];
  }

  // Recent rates for the settings screen, newest first.
  static async recent(currency = 'EUR', limit = 30, client = db) {
    const cur = assertSupportedCurrency(currency);
    const capped = Math.min(Math.max(Number(limit) || 30, 1), 365);
    const { rows } = await client.query(
      `SELECT rate_date, currency, rate, source, created_at
         FROM fx_rates WHERE currency = $1
        ORDER BY rate_date DESC LIMIT $2`,
      [cur, capped]
    );
    return rows.map(r => ({ ...r, rate: Number(r.rate), rate_date: toIsoDate(r.rate_date) }));
  }

  // Is the rate table fresh enough to invoice a foreign-currency order today?
  // Surfaced on the books dashboard so a broken feed is visible before it blocks
  // an invoice rather than after.
  static async freshness(currency = 'EUR', client = db) {
    const cur = assertSupportedCurrency(currency);
    const { rows } = await client.query(
      `SELECT rate_date, rate, source FROM fx_rates
        WHERE currency = $1 ORDER BY rate_date DESC LIMIT 1`,
      [cur]
    );
    if (!rows.length) return { currency: cur, has_rate: false, stale_days: null, ok: false };
    const staleDays = daysBetween(toIsoDate(rows[0].rate_date), todayIso());
    return {
      currency: cur,
      has_rate: true,
      latest_rate_date: toIsoDate(rows[0].rate_date),
      latest_rate: Number(rows[0].rate),
      source: rows[0].source,
      stale_days: staleDays,
      ok: staleDays <= MAX_STALENESS_DAYS,
    };
  }
}

FxRate.MAX_STALENESS_DAYS = MAX_STALENESS_DAYS;
module.exports = FxRate;

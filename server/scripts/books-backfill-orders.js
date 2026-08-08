#!/usr/bin/env node
// Issue invoices for paid orders that predate the books.
//
// The shop has been taking orders for longer than this accounting module has existed, so
// there are paid orders in the database with no invoice and no ledger entry. This script
// walks them oldest-first and issues an invoice for each, exactly as the admin screen
// would — same service, same VAT rules, same gapless numbering, same postings.
//
// WHY THIS IS A SCRIPT AND NOT A MIGRATION
//
// A migration runs automatically at container start. This one must not: it allocates real
// invoice numbers in a statutory series and posts real entries to the ledger, and both are
// append-only afterwards. Issuing the wrong set of invoices is not something a rollback
// undoes — the numbers are consumed and the entries have to be reversed one by one.
//
// So it is a script, it defaults to a DRY RUN, and it refuses to touch anything until the
// seller identity is set (an invoice without a kennitala and VSK number is not a valid
// sales document, and back-filling a hundred invalid ones would be worse than having none).
//
// USAGE
//
//   node server/scripts/books-backfill-orders.js                          # dry run, all
//   node server/scripts/books-backfill-orders.js --from=2026-01-01
//   node server/scripts/books-backfill-orders.js --as=halli --limit=5 --commit
//   node server/scripts/books-backfill-orders.js --as=halli --commit      # all of it
//
//   --as=USERNAME      who is issuing these. Required with --commit: Reglugerd 505/2013
//                      gr. 8 wants an identifiable person behind every entry, and "the
//                      script" is not one. Must be an existing admin.
//   --from=YYYY-MM-DD  only orders paid on or after this date
//   --to=YYYY-MM-DD    only orders paid on or before this date
//   --limit=N          at most N orders (default: no limit)
//   --commit           actually issue. WITHOUT THIS NOTHING IS WRITTEN.
//   --continue-on-error  keep going past a failing order instead of stopping
//
// Start with a small --limit --commit and look at the result before doing the rest.

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const db = require('../config/database');
const logger = require('../logger');
const ledger = require('../services/bookkeeping/ledgerService');
const invoiceService = require('../services/bookkeeping/invoiceService');
const Setting = require('../models/Setting');
const { assertAccountingDate, toIsoDate } = require('../utils/booksDate');

function parseArgs(argv) {
  const args = {
    from: null, to: null, limit: null, as: null, commit: false, continueOnError: false,
  };
  for (const raw of argv.slice(2)) {
    if (raw === '--commit') { args.commit = true; continue; }
    if (raw === '--continue-on-error') { args.continueOnError = true; continue; }
    const m = raw.match(/^--([a-z-]+)=(.*)$/);
    if (!m) throw new Error(`Unrecognised argument: ${raw}`);
    const [, key, value] = m;
    if (key === 'as') args.as = String(value).trim();
    else if (key === 'from') args.from = assertAccountingDate(value, 'from');
    else if (key === 'to') args.to = assertAccountingDate(value, 'to');
    else if (key === 'limit') {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1) throw new Error('--limit must be a whole number of orders');
      args.limit = n;
    } else throw new Error(`Unrecognised argument: --${key}`);
  }
  if (args.from && args.to && args.from > args.to) {
    throw new Error(`--from (${args.from}) is after --to (${args.to})`);
  }
  if (args.commit && !args.as) {
    throw new Error('--as=USERNAME is required with --commit: every entry needs a person behind it');
  }
  return args;
}

/**
 * Paid orders with no invoice, oldest first.
 *
 * Oldest first matters: invoice numbers come from a gapless counter, so issuing in payment
 * order means the series runs in the same direction as time. Back-filling newest-first
 * would leave a series where number 1050 predates 1049, which is legal but reads as a
 * mistake to anyone auditing it.
 */
async function findCandidates({ from, to, limit }) {
  const params = [];
  const where = [
    "o.payment_status = 'paid'",
    'o.paid_at IS NOT NULL',
    'NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id)',
  ];
  if (from) { params.push(from); where.push(`o.paid_at >= $${params.length}::date`); }
  if (to) { params.push(to); where.push(`o.paid_at < ($${params.length}::date + 1)`); }

  let sql = `SELECT o.id, o.order_number, o.paid_at, o.total, o.currency,
                    COALESCE(o.guest_name, u.username, '') AS who,
                    (SELECT COUNT(*)::int FROM order_items WHERE order_id = o.id) AS item_count
               FROM orders o
               LEFT JOIN users u ON u.id = o.user_id
              WHERE ${where.join(' AND ')}
              ORDER BY o.paid_at, o.order_number`;
  if (limit) { params.push(limit); sql += ` LIMIT $${params.length}`; }

  const { rows } = await db.query(sql, params);
  return rows;
}

async function main() {
  const args = parseArgs(process.argv);

  // Refused up front rather than per order: back-filling a hundred invoices that are all
  // missing the seller's kennitala would be worse than having none, and each one consumes
  // a number from a series that cannot be rewound.
  const settings = await Setting.getBookkeepingSettings();
  if (!settings.seller_complete) {
    logger.error(
      'The seller name, kennitala and VSK number must be set in the books settings before '
      + 'back-filling. An invoice without them is not a valid sales document.'
    );
    process.exitCode = 1;
    return;
  }

  // Resolved before anything is written, so a typo in --as fails now rather than after
  // the first invoice number has been consumed.
  let actorId = null;
  if (args.commit) {
    const { rows } = await db.query(
      `SELECT id, username, role FROM users WHERE username = $1`, [args.as]
    );
    if (!rows.length) {
      logger.error({ as: args.as }, 'No such user — --as must name an existing admin');
      process.exitCode = 1;
      return;
    }
    if (rows[0].role !== 'admin') {
      logger.error({ as: args.as, role: rows[0].role },
        'That user is not an admin. Issuing invoices is an admin action.');
      process.exitCode = 1;
      return;
    }
    actorId = rows[0].id;
  }

  const candidates = await findCandidates(args);
  if (!candidates.length) {
    logger.info({ from: args.from, to: args.to }, 'No paid orders are missing an invoice');
    return;
  }

  const totalMinor = candidates.reduce((a, o) => a + Number(o.total || 0), 0);
  logger.info({
    orders: candidates.length,
    oldest: toIsoDate(candidates[0].paid_at),
    newest: toIsoDate(candidates[candidates.length - 1].paid_at),
    total: totalMinor,
    mode: args.commit ? 'COMMIT' : 'dry run',
    as: args.as || '(dry run)',
  }, args.commit ? 'issuing invoices for orders with none' : 'DRY RUN — nothing will be written');

  for (const o of candidates) {
    logger.info({
      order: o.order_number,
      paid_at: toIsoDate(o.paid_at),
      who: o.who,
      items: o.item_count,
      total: Number(o.total),
      currency: o.currency,
    }, args.commit ? 'issuing' : 'would issue');
  }

  if (!args.commit) {
    logger.info(
      `Dry run only. Re-run with --commit to issue these ${candidates.length} invoice(s). `
      + 'Consider --limit=5 --commit first, and look at the result.'
    );
    return;
  }

  // One transaction PER ORDER, not one for the whole run. A single transaction would hold
  // the invoice-counter row lock for the entire back-fill, serialising every other
  // document in the system behind it; and a failure at order 90 would roll back 89 good
  // invoices whose numbers were already reported in the log.
  let issued = 0;
  let skipped = 0;
  const failures = [];
  for (const o of candidates) {
    try {
      const result = await ledger.withTransaction(client =>
        // Attributed to whoever ran it. There is deliberately no system actor:
        // Reglugerð 505/2013 gr. 8 wants an identifiable person behind every entry, and
        // "the back-fill script" is not one.
        invoiceService.createFromOrder(client, o.id, { createdBy: actorId }));
      if (result.created) {
        issued += 1;
        logger.info({
          order: o.order_number,
          invoice_number: Number(result.invoice.invoice_number),
          gross: Number(result.invoice.total_gross),
        }, 'invoice issued');
      } else {
        // createFromOrder is idempotent, so a concurrent issue lands here rather than
        // producing a duplicate.
        skipped += 1;
        logger.warn({ order: o.order_number }, 'already invoiced — skipped');
      }
    } catch (err) {
      failures.push({ order: o.order_number, error: err.message });
      logger.error({ order: o.order_number, err: err.message }, 'could not issue an invoice');
      if (!args.continueOnError) {
        logger.error(
          `Stopped at order ${o.order_number}. ${issued} invoice(s) were issued and are `
          + 'permanent — fix the cause and re-run; already-invoiced orders are skipped. '
          + 'Use --continue-on-error to push past a bad order.'
        );
        process.exitCode = 1;
        break;
      }
    }
  }

  logger.info({ issued, skipped, failed: failures.length }, 'back-fill finished');
  if (failures.length) {
    logger.error({ failures }, 'some orders could not be invoiced');
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main()
    .then(() => db.pool.end())
    .catch(async (err) => {
      logger.error({ err: err.message }, 'back-fill failed');
      await db.pool.end().catch(() => {});
      process.exit(1);
    });
}

module.exports = { parseArgs, findCandidates };

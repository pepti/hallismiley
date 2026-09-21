// Seller area — /api/v1/seller (D-020). READ-ONLY by construction: every route
// is a GET over the published_* tables, which only the signed ingest writes.
//
// Gating, in order:
//   1. INSTANCE_ROLE=public, else 404 — on ops, sellers use the admin shell.
//   2. requireAuth.
//   3. requireSeller: the user's proven email is in the latest snapshot
//      (auth/publishedSeller.js), else 404 — a non-seller learns nothing.
//   4. Everything except GET /me also needs 2FA enrolled (totp_enabled). The
//      login path challenges published sellers (mfaService.protectedRole), so
//      once enrolled every session here went through the second factor. /me
//      answers without it so the SPA can send the seller to enrol.
//   5. Per section: the view ops granted (can_leads / can_accounts /
//      can_commission), else 403. Rows are scoped to the seller's email in SQL;
//      a foreign statement id is 404, never 403.
// Every response is Cache-Control: no-store.
const express = require('express');
const db = require('../config/database');
const { requireAuth } = require('../auth/middleware');
const { isPublicInstance } = require('../config/instanceRole');
const { findPublishedSeller } = require('../auth/publishedSeller');
const { t } = require('../i18n');

const router = express.Router();

const notFound = (res) => res.status(404).json({ error: 'Not found', code: 404 });

router.use((req, res, next) => {
  if (!isPublicInstance()) return notFound(res);
  res.setHeader('Cache-Control', 'no-store');
  return next();
});
router.use(requireAuth);
router.use(async (req, res, next) => {
  try {
    const seller = await findPublishedSeller(db.query, req.user.id);
    if (!seller) return notFound(res);
    req.seller = seller;
    return next();
  } catch (err) { return next(err); }
});

async function lastPublishedAt() {
  const { rows } = await db.query(
    'SELECT generated_at FROM seller_publications ORDER BY generated_at DESC LIMIT 1'
  );
  return rows[0] ? rows[0].generated_at : null;
}

router.get('/me', async (req, res, next) => {
  try {
    const s = req.seller;
    return res.json({
      seller: {
        email: s.email,
        display_name: s.display_name,
        can_leads: s.can_leads,
        can_accounts: s.can_accounts,
        can_commission: s.can_commission,
      },
      mfa_ready: req.user.totp_enabled === true,
      published_at: await lastPublishedAt(),
    });
  } catch (err) { return next(err); }
});

router.use((req, res, next) => {
  if (req.user.totp_enabled !== true) {
    return res.status(403).json({ error: t(req.locale, 'errors.seller.mfaRequired'), code: 403 });
  }
  return next();
});

const needs = (flag) => (req, res, next) => (req.seller[flag]
  ? next()
  : res.status(403).json({ error: 'Forbidden', code: 403 }));

const DATE_ONLY = (col) => `to_char(${col}, 'YYYY-MM-DD') AS ${col}`;

router.get('/leads', needs('can_leads'), async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT ops_id, received_at, name, email, company, phone, current_platform, message,
              status, owner_email, owner_name, contacted_at, note
         FROM published_leads ORDER BY received_at DESC, ops_id DESC LIMIT 1000`
    );
    return res.json({ leads: rows, published_at: await lastPublishedAt() });
  } catch (err) { return next(err); }
});

router.get('/accounts', needs('can_accounts'), async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT ops_id, slug, name, tier, status, contact_name, contact_email, contact_phone, prod_url,
              ${DATE_ONLY('contract_start')}, ${DATE_ONLY('contract_end')},
              build_fee_isk::float8 AS build_fee_isk, monthly_fee_isk::float8 AS monthly_fee_isk,
              quota_units, updated_at
         FROM published_accounts WHERE seller_email = $1 ORDER BY name, ops_id`,
      [req.seller.email]
    );
    return res.json({ accounts: rows, published_at: await lastPublishedAt() });
  } catch (err) { return next(err); }
});

const STATEMENT_COLS = `ops_id, ${DATE_ONLY('period')}, status, payee_kind,
  opening_balance_isk::float8 AS opening_balance_isk, earned_isk::float8 AS earned_isk,
  clawback_isk::float8 AS clawback_isk, adjustment_isk::float8 AS adjustment_isk,
  settled_isk::float8 AS settled_isk, closing_balance_isk::float8 AS closing_balance_isk,
  minimum_isk::float8 AS minimum_isk, payable_isk::float8 AS payable_isk,
  carried_isk::float8 AS carried_isk, amount_paid_isk::float8 AS amount_paid_isk,
  note, issued_at`;

router.get('/statements', needs('can_commission'), async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT ${STATEMENT_COLS} FROM published_statements
        WHERE seller_email = $1 ORDER BY period DESC, ops_id DESC LIMIT 200`,
      [req.seller.email]
    );
    return res.json({ statements: rows, published_at: await lastPublishedAt() });
  } catch (err) { return next(err); }
});

router.get('/statements/:id', needs('can_commission'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid statement id', code: 400 });
    }
    const { rows: [statement] } = await db.query(
      `SELECT ${STATEMENT_COLS} FROM published_statements WHERE ops_id = $1 AND seller_email = $2`,
      [id, req.seller.email]
    );
    if (!statement) return res.status(404).json({ error: 'Statement not found', code: 404 });
    const [{ rows: lines }, { rows: payouts }] = await Promise.all([
      db.query(
        `SELECT line_kind, account_name, invoice_number, description, amount_isk::float8 AS amount_isk
           FROM published_statement_lines WHERE statement_ops_id = $1 ORDER BY id`,
        [id]
      ),
      db.query(
        `SELECT ${DATE_ONLY('paid_on')}, method, seller_invoice_number, amount_isk::float8 AS amount_isk
           FROM published_payouts WHERE statement_ops_id = $1 ORDER BY id`,
        [id]
      ),
    ]);
    return res.json({ statement, lines, payouts });
  } catch (err) { return next(err); }
});

module.exports = router;

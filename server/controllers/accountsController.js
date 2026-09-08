// Customer accounts — /api/v1/admin/accounts (migration 098; ENHANCEMENTS #17).
//
// Access model (server/routes/adminAccountRoutes.js):
//   read / create / patch / provision-request → requireView('accounts') +
//     accountScope: a seller sees and edits ONLY the accounts they own;
//     admin ('*') and the `allaccounts` permission see every account.
//   PATCH /:id/owner → hard admin — moving an owner moves future commission.
// Row scope is enforced in the model (a foreign id answers 404, not 403).
// Every response is Cache-Control: no-store; every write lands in
// staff_audit_log in the same transaction.

const { pool } = require('../config/database');
const { t } = require('../i18n');
const CustomerAccount = require('../models/CustomerAccount');
const Commission = require('../models/Commission');
const staffAudit = require('../services/staffAudit');
const { hasRole } = require('../auth/roles');
const { toIsoDate } = require('../utils/booksDate');
const { buyerPartyProblems, buyerOfAccount, invoiceableProblems } = require('../services/bookkeeping/peppol/party');
const logger = require('../logger');

// Commission rates decide what the company pays the account's owner, so only an
// admin may set them — a seller editing their own account must not be able to
// raise their own percentage. The validator whitelists the fields for shape;
// this strips them for everyone else, because `req.accountScope.all` is the
// WRONG test (the seeded `verktaki` is unscoped but earns no commission).
const RATE_FIELDS = ['build_rate_bp', 'recurring_rate_bp'];

function stripRateFields(req) {
  if (hasRole(req.user, 'admin')) return;
  for (const f of RATE_FIELDS) delete req.body[f];
}

// Two readiness answers, deliberately separate — the same split Setting makes
// between seller_complete and peppol_complete. `invoice_ready` is the STATUTORY
// minimum and gates issuing; `peppol_complete` gates only the downstream export,
// so a missing postal code can never stop the company invoicing. Both come from
// peppol/party.js — the same rules the export preflight applies — so the screen
// and the 409 can never disagree.
function _withReadiness(account) {
  if (!account) return account;
  const invoiceProblems = invoiceableProblems(account);
  const peppolProblems = buyerPartyProblems(buyerOfAccount(account));
  return {
    ...account,
    invoice_ready: invoiceProblems.length === 0,
    invoice_problems: invoiceProblems,
    peppol_complete: peppolProblems.length === 0,
    peppol_problems: peppolProblems,
  };
}

function _noStore(res) { res.setHeader('Cache-Control', 'no-store'); }

function _id(req) {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* already gone */ }
    throw err;
  } finally {
    client.release();
  }
}

function sendError(req, res, err) {
  if (err && err.status && err.status < 500) {
    const key = {
      ACCOUNT_NOT_FOUND: 'errors.accounts.notFound',
      MARKET_COMPANY_NOT_FOUND: 'errors.accounts.marketCompanyNotFound',
      BAD_TRANSITION: 'errors.accounts.badTransition',
      OWNER_NOT_FOUND: 'errors.accounts.ownerNotFound',
      ACCOUNT_INVALID: 'errors.accounts.invalid',
    }[err.code];
    return res.status(err.status).json({ error: key ? t(req.locale, key) : err.message, code: err.status });
  }
  if (err && err.code === '23505') {
    // slug or kennitala already taken
    return res.status(409).json({ error: t(req.locale, 'errors.accounts.duplicate'), code: 409 });
  }
  return null;
}

const accountsController = {

  // GET /api/v1/admin/accounts?status=&tier=&q=&page=&limit=
  async list(req, res, next) {
    _noStore(res);
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
      const page = Math.max(Number(req.query.page) || 1, 1);
      const { accounts, total } = await CustomerAccount.list(req.accountScope, {
        status: req.query.status || null,
        tier: req.query.tier || null,
        q: (req.query.q && String(req.query.q).trim().slice(0, 100)) || null,
        limit, offset: (page - 1) * limit,
      });
      return res.json({
        accounts, total, page, limit,
        scope: req.accountScope.all ? 'all' : 'own',
        statuses: CustomerAccount.STATUSES, tiers: CustomerAccount.TIERS, transitions: CustomerAccount.TRANSITIONS,
      });
    } catch (err) { next(err); }
  },

  // GET /api/v1/admin/accounts/:id
  async getOne(req, res, next) {
    _noStore(res);
    try {
      const id = _id(req);
      if (!id) return res.status(400).json({ error: t(req.locale, 'errors.accounts.invalidId'), code: 400 });
      const account = await CustomerAccount.findById(req.accountScope, id);
      if (!account) return res.status(404).json({ error: t(req.locale, 'errors.accounts.notFound'), code: 404 });
      return res.json({ account: _withReadiness(account), transitions: CustomerAccount.TRANSITIONS[account.status] || [] });
    } catch (err) { next(err); }
  },

  // POST /api/v1/admin/accounts — body whitelisted by validateAccountCreate.
  // `owner_user_id` is honoured only for an unscoped caller; a seller always
  // owns what they create. `market_company_id` = the #16 hand-off.
  async create(req, res, next) {
    _noStore(res);
    try {
      stripRateFields(req);
      const body = req.body;
      const ownerUserId = (req.accountScope.all && body.owner_user_id) ? String(body.owner_user_id) : req.user.id;
      const account = await withTx(client => CustomerAccount.create(client, {
        fields: body,
        ownerUserId,
        marketCompanyId: body.market_company_id || null,
        slug: body.slug || null,
      }, staffAudit.actorOf(req)));
      return res.status(201).json({ account });
    } catch (err) {
      if (err && err.code === '23503') return res.status(400).json({ error: t(req.locale, 'errors.accounts.ownerNotFound'), code: 400 });
      if (sendError(req, res, err)) return;
      next(err);
    }
  },

  // PATCH /api/v1/admin/accounts/:id — editable fields + status transitions.
  async update(req, res, next) {
    _noStore(res);
    try {
      const id = _id(req);
      if (!id) return res.status(400).json({ error: t(req.locale, 'errors.accounts.invalidId'), code: 400 });
      stripRateFields(req);
      const account = await withTx(client =>
        CustomerAccount.update(client, req.accountScope, id, req.body, staffAudit.actorOf(req)));
      if (!account) return res.status(404).json({ error: t(req.locale, 'errors.accounts.notFound'), code: 404 });
      return res.json({ account: _withReadiness(account), transitions: CustomerAccount.TRANSITIONS[account.status] || [] });
    } catch (err) {
      if (sendError(req, res, err)) return;
      next(err);
    }
  },

  // PATCH /api/v1/admin/accounts/:id/owner — admin only.
  async changeOwner(req, res, next) {
    _noStore(res);
    try {
      const id = _id(req);
      if (!id) return res.status(400).json({ error: t(req.locale, 'errors.accounts.invalidId'), code: 400 });
      const ownerUserId = String((req.body || {}).owner_user_id || '').trim();
      if (!ownerUserId || ownerUserId.length > 64) {
        return res.status(400).json({ error: t(req.locale, 'errors.accounts.ownerNotFound'), code: 400 });
      }
      const account = await withTx(client =>
        CustomerAccount.changeOwner(client, id, ownerUserId, staffAudit.actorOf(req)));
      if (!account) return res.status(404).json({ error: t(req.locale, 'errors.accounts.notFound'), code: 404 });
      return res.json({ account });
    } catch (err) {
      if (sendError(req, res, err)) return;
      next(err);
    }
  },

  // POST /api/v1/admin/accounts/:id/provision-request
  async requestProvision(req, res, next) {
    _noStore(res);
    try {
      const id = _id(req);
      if (!id) return res.status(400).json({ error: t(req.locale, 'errors.accounts.invalidId'), code: 400 });
      const account = await withTx(client =>
        CustomerAccount.requestProvision(client, req.accountScope, id, staffAudit.actorOf(req)));
      if (!account) return res.status(404).json({ error: t(req.locale, 'errors.accounts.notFound'), code: 404 });
      logger.info({ accountId: id, userId: req.user.id }, 'provision requested');
      return res.status(202).json({ account });
    } catch (err) { next(err); }
  },

  // GET /api/v1/admin/accounts/:id/audit — the account's own trail (scoped).
  async audit(req, res, next) {
    _noStore(res);
    try {
      const id = _id(req);
      if (!id) return res.status(400).json({ error: t(req.locale, 'errors.accounts.invalidId'), code: 400 });
      const account = await CustomerAccount.findById(req.accountScope, id);
      if (!account) return res.status(404).json({ error: t(req.locale, 'errors.accounts.notFound'), code: 404 });
      const { entries } = await staffAudit.list({ entityType: 'account', entityId: id, limit: 100 });
      return res.json({ entries });
    } catch (err) { next(err); }
  },

  // GET /api/v1/admin/accounts/:id/commission — the account's commission events (scoped).
  async commission(req, res, next) {
    _noStore(res);
    try {
      const id = _id(req);
      if (!id) return res.status(400).json({ error: t(req.locale, 'errors.accounts.invalidId'), code: 400 });
      const account = await CustomerAccount.findById(req.accountScope, id);
      if (!account) return res.status(404).json({ error: t(req.locale, 'errors.accounts.notFound'), code: 404 });
      // Unscoped ON PURPOSE, after the parent account passed the scope check:
      // an account's history includes commission earned by a PREVIOUS owner,
      // and hiding it would make the trail lie. The route carries
      // requireView('commission') so only commission-holders reach it.
      const events = await Commission.events({ all: true }, { accountId: id });
      return res.json({ events: events.map(e => ({ ...e, period: toIsoDate(e.period) })) });
    } catch (err) { next(err); }
  },
};

module.exports = accountsController;

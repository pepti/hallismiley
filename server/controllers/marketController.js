// Markaður — the prospect list over market_companies ⋈ latest market_financials
// (migration 093; ENHANCEMENTS #16, Halli 2026-09-07).
//
// Read-only apart from ONE workflow write: shortlist → handed_to_sales /
// rejected (admin/moderator). The rows are public-source company data —
// no persons — but the list is internal: every route sits behind requireAuth
// + requireView('markadur') and every response is Cache-Control: no-store.
//
// Sort keys map to fixed SQL fragments; nothing from the query string is ever
// interpolated. Money arrives as BIGINT strings from pg — the client formats.
//
// Audit for the status write: a pino info line + the 093 updated_at trigger.
// 093 has no actor column and `researched_by` is the importer's researcher
// name (overwritten on re-import), so it is NOT reused for this; a durable
// "who" is a future two-column migration if Halli wants it.

const db = require('../config/database');
const logger = require('../logger');
const { t } = require('../i18n');

// Mirrors the 093 CHECK constraints.
const SECTORS    = ['smasala', 'heildsala', 'idnadur', 'thjonusta', 'annad'];
const LIST_TYPES = ['smb', 'large'];
const TIERS      = ['vefur', 'verslun', 'rekstur'];
const STATUSES   = ['candidate', 'researched', 'shortlist', 'handed_to_sales', 'rejected'];
// The one transition the app performs. Everything else is the importer's.
const TRANSITIONS = { shortlist: ['handed_to_sales', 'rejected'] };
const TARGET_STATUSES = TRANSITIONS.shortlist;

const SORTS = {
  fit_score:        'c.fit_score',
  admin_cost_ratio: 'lf.admin_cost_ratio',
  revenue:          'lf.revenue_isk',
  employees:        'lf.employees',
  name:             'c.name',
  updated:          'c.updated_at',
};

const COMPANY_COLS = `
  c.id, c.kennitala, c.name, c.isat_code, c.isat_label, c.sector_group, c.postcode,
  c.municipality, c.website, c.platform_detected, c.list_type, c.fit_score, c.tier_fit,
  c.status, c.researched_at, c.updated_at
`;
const LATEST_COLS = `
  lf.fiscal_year, lf.revenue_isk, lf.operating_profit_isk, lf.net_profit_isk, lf.equity_isk,
  lf.total_assets_isk, lf.admin_cost_isk, lf.admin_cost_ratio, lf.employees, lf.fte
`;
const LATEST_JOIN = `
  LEFT JOIN LATERAL (
    SELECT * FROM market_financials f WHERE f.company_id = c.id
     ORDER BY f.fiscal_year DESC LIMIT 1
  ) lf ON TRUE
`;
const FINANCIAL_COLS = `
  id, fiscal_year, revenue_isk, operating_profit_isk, net_profit_isk, equity_isk,
  total_assets_isk, admin_cost_isk, admin_cost_ratio, employees, fte, source_url, extracted_at
`;

function _noStore(res) { res.setHeader('Cache-Control', 'no-store'); }

function _id(req) {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Split a joined row into { ...company, latest: {...} | null }.
function shapeRow(row) {
  const { fiscal_year, revenue_isk, operating_profit_isk, net_profit_isk, equity_isk,
    total_assets_isk, admin_cost_isk, admin_cost_ratio, employees, fte, ...company } = row;
  const latest = fiscal_year == null ? null : {
    fiscal_year, revenue_isk, operating_profit_isk, net_profit_isk, equity_isk,
    total_assets_isk, admin_cost_isk, admin_cost_ratio, employees, fte,
  };
  return { ...company, latest };
}

function _filter(q) {
  const clauses = [];
  const params  = [];
  const inSet = (value, set, col) => {
    if (set.includes(value)) { params.push(value); clauses.push(`${col} = $${params.length}`); }
  };
  inSet(q.list_type,    LIST_TYPES, 'c.list_type');
  inSet(q.sector_group, SECTORS,    'c.sector_group');
  inSet(q.status,       STATUSES,   'c.status');
  inSet(q.tier_fit,     TIERS,      'c.tier_fit');
  const text = q.q && String(q.q).trim().slice(0, 100);
  if (text) {
    params.push(`%${text}%`);
    clauses.push(`(c.name ILIKE $${params.length} OR c.kennitala LIKE $${params.length})`);
  }
  return { clause: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

const marketController = {

  // GET /api/v1/admin/markadur?list_type&sector_group&status&tier_fit&q&sort&dir&page&limit
  async list(req, res, next) {
    _noStore(res);
    try {
      const sortKey = req.query.sort === undefined ? 'fit_score' : req.query.sort;
      if (!Object.prototype.hasOwnProperty.call(SORTS, sortKey)) {
        return res.status(400).json({ error: t(req.locale, 'validation.marketSort.invalid'), code: 400 });
      }
      const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';
      const limit  = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
      const page   = Math.max(Number(req.query.page) || 1, 1);
      const offset = (page - 1) * limit;

      const { clause, params } = _filter(req.query);
      const listParams = [...params, limit, offset];
      const [{ rows }, { rows: [{ n: total }] }] = await Promise.all([
        db.query(
          `SELECT ${COMPANY_COLS}, ${LATEST_COLS}
             FROM market_companies c ${LATEST_JOIN} ${clause}
            ORDER BY ${SORTS[sortKey]} ${dir} NULLS LAST, c.name ASC
            LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
          listParams
        ),
        db.query(`SELECT COUNT(*)::int AS n FROM market_companies c ${clause}`, params),
      ]);
      return res.json({
        companies: rows.map(shapeRow),
        total, page, limit, sort: sortKey, dir: dir.toLowerCase(),
        filters: { sectors: SECTORS, listTypes: LIST_TYPES, statuses: STATUSES, tiers: TIERS },
      });
    } catch (err) { next(err); }
  },

  // GET /api/v1/admin/markadur/:id — the company plus every fiscal year.
  async getOne(req, res, next) {
    _noStore(res);
    try {
      const id = _id(req);
      if (!id) return res.status(400).json({ error: t(req.locale, 'errors.markadur.invalidId'), code: 400 });
      const { rows } = await db.query(
        `SELECT ${COMPANY_COLS}, c.fit_notes, c.summary, c.sources, c.report_path, c.researched_by, c.created_at
           FROM market_companies c WHERE c.id = $1`,
        [id]
      );
      const company = rows[0];
      if (!company) return res.status(404).json({ error: t(req.locale, 'errors.markadur.notFound'), code: 404 });
      const { rows: financials } = await db.query(
        `SELECT ${FINANCIAL_COLS} FROM market_financials WHERE company_id = $1 ORDER BY fiscal_year DESC`,
        [id]
      );
      return res.json({ company: { ...company, financials } });
    } catch (err) { next(err); }
  },

  // PATCH /api/v1/admin/markadur/:id/status — shortlist → handed_to_sales | rejected.
  // validateMarketStatus has already confirmed the target; the current status
  // is checked here against the live row, and the WHERE makes the write
  // race-safe (two people handing off the same company: one wins, one 409s).
  async setStatus(req, res, next) {
    _noStore(res);
    try {
      const id = _id(req);
      if (!id) return res.status(400).json({ error: t(req.locale, 'errors.markadur.invalidId'), code: 400 });
      const { status: next_ } = req.body;
      const { rows: [current] } = await db.query(`SELECT id, status FROM market_companies WHERE id = $1`, [id]);
      if (!current) return res.status(404).json({ error: t(req.locale, 'errors.markadur.notFound'), code: 404 });
      const allowed = TRANSITIONS[current.status] || [];
      if (!allowed.includes(next_)) {
        return res.status(409).json({ error: t(req.locale, 'errors.markadur.badTransition'), code: 409 });
      }
      const { rows: [updated] } = await db.query(
        `UPDATE market_companies SET status = $1 WHERE id = $2 AND status = 'shortlist'
         RETURNING id, kennitala, name, sector_group, list_type, fit_score, tier_fit, status, updated_at`,
        [next_, id]
      );
      if (!updated) return res.status(409).json({ error: t(req.locale, 'errors.markadur.badTransition'), code: 409 });
      logger.info({ companyId: id, from: current.status, to: next_, userId: req.user.id }, 'market status changed');
      return res.json({ company: updated });
    } catch (err) { next(err); }
  },
};

module.exports = marketController;
module.exports.SORTS = SORTS;
module.exports.TARGET_STATUSES = TARGET_STATUSES;

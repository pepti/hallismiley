// Market-research importer — upserts the Markaðsstjóri agent's staged JSON into
// market_companies / market_financials / market_stats (migration 093).
//
// Usage:
//   node server/scripts/market-import.js company/markadur/market.json [--dry-run]
//   npm run market:import -- company/markadur/market.json
//
// Idempotent: companies upsert by kennitala, financials by (company, fiscal_year),
// stats by (sector_group, isat_code, size_class, metric, reference_year). The whole
// file is validated first and written in ONE transaction — a bad row anywhere means
// nothing is written. `status` is a workflow field (sales moves rows to
// handed_to_sales later), so it is only overwritten when the JSON row carries one.
// admin_cost_ratio is a GENERATED column and is never written here.
//
// JSON shape (financials nested so the agent never needs a company_id):
// {
//   "companies": [{
//     "kennitala": "5001234567", "name": "Dæmi ehf.",
//     "isat_code": "47.11.0", "isat_label": "Stórmarkaðir", "sector_group": "smasala",
//     "postcode": "220", "municipality": "Hafnarfjörður",
//     "website": "https://daemi.is", "platform_detected": "shopify",
//     "list_type": "smb", "fit_score": 82.5, "tier_fit": "verslun",
//     "fit_notes": "...", "summary": "...", "status": "researched",
//     "sources": [{ "type": "arsreikningaskra", "url": "https://...", "fetched_at": "2026-09-01T10:00:00Z" }],
//     "report_path": "company/markadur/arsreikningar/5001234567-2024.pdf",
//     "researched_by": "markadsstjori", "researched_at": "2026-09-01T10:00:00Z",
//     "financials": [{
//       "fiscal_year": 2024, "revenue_isk": 512000000, "operating_profit_isk": 31000000,
//       "net_profit_isk": 24000000, "equity_isk": 90000000, "total_assets_isk": 210000000,
//       "admin_cost_isk": 41000000, "employees": 12, "fte": 10.5, "source_url": "https://..."
//     }]
//   }],
//   "stats": [{
//     "sector_group": "smasala", "isat_code": "47", "size_class": "10-49",
//     "metric": "company_count", "value": 412, "unit": "count",
//     "reference_year": 2024, "source_url": "https://hagstofa.is/..."
//   }]
// }
require('dotenv').config({ path: require('path').join(__dirname, '../../.env'), quiet: true });

const fs = require('fs');
const { pool } = require('../config/database');

const KENNITALA_RE  = /^\d{10}$/;
const SECTORS       = ['smasala', 'heildsala', 'idnadur', 'thjonusta', 'annad'];
const STAT_SECTORS  = ['all', ...SECTORS];
const LIST_TYPES    = ['smb', 'large'];
const TIERS         = ['vefur', 'verslun', 'rekstur'];
const STATUSES      = ['candidate', 'researched', 'shortlist', 'handed_to_sales', 'rejected'];
const UNITS         = ['count', 'isk', 'fte', 'pct'];
// Mirrors contactController.js KNOWN_PLATFORMS + 'custom'/'unknown' (and the 093 CHECK).
const PLATFORMS     = ['shopify', 'wix', 'wordpress', 'woocommerce', 'squarespace',
  'dk', 'regla', 'payday', 'none', 'other', 'custom', 'unknown'];
const MONEY_FIELDS  = ['revenue_isk', 'operating_profit_isk', 'net_profit_isk',
  'equity_isk', 'total_assets_isk', 'admin_cost_isk'];

function parseArgs(argv) {
  const args = { file: null, dryRun: false };
  for (const a of argv.slice(2)) {
    if (a === '--dry-run') args.dryRun = true;
    else if (a.startsWith('--')) throw new Error(`unknown flag ${a}`);
    else args.file = a;
  }
  if (!args.file) throw new Error('Usage: node server/scripts/market-import.js <file.json> [--dry-run]');
  return args;
}

const isYear = (y) => Number.isInteger(y) && y >= 1990 && y <= 2100;

// Collects every problem in the file and throws once, naming each bad row.
function validate(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid import file: expected an object');
  const errors = [];
  const seen = new Set();

  (payload.companies || []).forEach((c, i) => {
    const at = `companies[${i}] (${c.kennitala || '?'})`;
    if (!KENNITALA_RE.test(c.kennitala || ''))       errors.push(`${at}: kennitala must be 10 digits`);
    else if (seen.has(c.kennitala))                  errors.push(`${at}: kennitala appears twice in the file`);
    seen.add(c.kennitala);
    if (!c.name || typeof c.name !== 'string')        errors.push(`${at}: name required`);
    if (!LIST_TYPES.includes(c.list_type))            errors.push(`${at}: list_type must be smb|large`);
    if (c.sector_group != null && !SECTORS.includes(c.sector_group))
      errors.push(`${at}: bad sector_group "${c.sector_group}"`);
    if (c.tier_fit != null && !TIERS.includes(c.tier_fit))
      errors.push(`${at}: bad tier_fit "${c.tier_fit}"`);
    if (c.status != null && !STATUSES.includes(c.status))
      errors.push(`${at}: bad status "${c.status}"`);
    if (c.platform_detected != null && !PLATFORMS.includes(c.platform_detected))
      errors.push(`${at}: bad platform_detected "${c.platform_detected}"`);
    if (c.fit_score != null && !(typeof c.fit_score === 'number' && c.fit_score >= 0 && c.fit_score <= 100))
      errors.push(`${at}: fit_score must be a number 0–100`);
    if (c.sources !== undefined && !Array.isArray(c.sources))
      errors.push(`${at}: sources must be an array`);
    const years = new Set();
    (c.financials || []).forEach((f, j) => {
      const fat = `${at}.financials[${j}]`;
      if (!isYear(f.fiscal_year))                     errors.push(`${fat}: fiscal_year must be a year`);
      else if (years.has(f.fiscal_year))              errors.push(`${fat}: fiscal_year ${f.fiscal_year} appears twice`);
      years.add(f.fiscal_year);
      for (const k of MONEY_FIELDS) {
        if (f[k] != null && !Number.isInteger(f[k]))  errors.push(`${fat}: ${k} must be whole ISK`);
      }
      if (f.employees != null && !(Number.isInteger(f.employees) && f.employees >= 0))
        errors.push(`${fat}: employees must be a whole number`);
      if (f.fte != null && !(typeof f.fte === 'number' && f.fte >= 0))
        errors.push(`${fat}: fte must be a number`);
    });
  });

  (payload.stats || []).forEach((s, i) => {
    const at = `stats[${i}]`;
    if (!s.metric || typeof s.metric !== 'string')    errors.push(`${at}: metric required`);
    if (typeof s.value !== 'number')                  errors.push(`${at}: value must be a number`);
    if (!isYear(s.reference_year))                    errors.push(`${at}: reference_year must be a year`);
    if (s.sector_group != null && !STAT_SECTORS.includes(s.sector_group))
      errors.push(`${at}: bad sector_group "${s.sector_group}"`);
    if (s.unit != null && !UNITS.includes(s.unit))    errors.push(`${at}: bad unit "${s.unit}"`);
  });

  if (errors.length) throw new Error('Invalid import file:\n  ' + errors.join('\n  '));
}

// xmax = 0 on the returned row means it was freshly inserted, not updated.
async function upsertCompany(client, c) {
  const { rows } = await client.query(
    `INSERT INTO market_companies
       (kennitala, name, isat_code, isat_label, sector_group, postcode, municipality, website,
        platform_detected, list_type, fit_score, tier_fit, fit_notes, summary, status, sources,
        report_path, researched_by, researched_at)
     VALUES ($1, $2, $3, $4, COALESCE($5::varchar, 'annad'), $6, $7, $8, $9, $10, $11, $12, $13, $14,
             COALESCE($15::varchar, 'candidate'), $16::jsonb, $17, $18, $19::timestamptz)
     ON CONFLICT (kennitala) DO UPDATE SET
       name              = EXCLUDED.name,
       isat_code         = EXCLUDED.isat_code,
       isat_label        = EXCLUDED.isat_label,
       sector_group      = EXCLUDED.sector_group,
       postcode          = EXCLUDED.postcode,
       municipality      = EXCLUDED.municipality,
       website           = EXCLUDED.website,
       platform_detected = EXCLUDED.platform_detected,
       list_type         = EXCLUDED.list_type,
       fit_score         = EXCLUDED.fit_score,
       tier_fit          = EXCLUDED.tier_fit,
       fit_notes         = EXCLUDED.fit_notes,
       summary           = EXCLUDED.summary,
       status            = COALESCE($15::varchar, market_companies.status),
       sources           = EXCLUDED.sources,
       report_path       = EXCLUDED.report_path,
       researched_by     = EXCLUDED.researched_by,
       researched_at     = EXCLUDED.researched_at
     RETURNING id, (xmax = 0) AS inserted`,
    [c.kennitala, c.name, c.isat_code ?? null, c.isat_label ?? null, c.sector_group ?? null,
      c.postcode ?? null, c.municipality ?? null, c.website ?? null, c.platform_detected ?? null,
      c.list_type, c.fit_score ?? null, c.tier_fit ?? null, c.fit_notes ?? null, c.summary ?? null,
      c.status ?? null, JSON.stringify(c.sources ?? []), c.report_path ?? null,
      c.researched_by ?? null, c.researched_at ?? null]
  );
  return rows[0];
}

async function upsertFinancial(client, companyId, f) {
  const { rows } = await client.query(
    `INSERT INTO market_financials
       (company_id, fiscal_year, revenue_isk, operating_profit_isk, net_profit_isk, equity_isk,
        total_assets_isk, admin_cost_isk, employees, fte, source_url, extracted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12::timestamptz, NOW()))
     ON CONFLICT (company_id, fiscal_year) DO UPDATE SET
       revenue_isk          = EXCLUDED.revenue_isk,
       operating_profit_isk = EXCLUDED.operating_profit_isk,
       net_profit_isk       = EXCLUDED.net_profit_isk,
       equity_isk           = EXCLUDED.equity_isk,
       total_assets_isk     = EXCLUDED.total_assets_isk,
       admin_cost_isk       = EXCLUDED.admin_cost_isk,
       employees            = EXCLUDED.employees,
       fte                  = EXCLUDED.fte,
       source_url           = EXCLUDED.source_url,
       extracted_at         = EXCLUDED.extracted_at
     RETURNING (xmax = 0) AS inserted`,
    [companyId, f.fiscal_year, f.revenue_isk ?? null, f.operating_profit_isk ?? null,
      f.net_profit_isk ?? null, f.equity_isk ?? null, f.total_assets_isk ?? null,
      f.admin_cost_isk ?? null, f.employees ?? null, f.fte ?? null, f.source_url ?? null,
      f.extracted_at ?? null]
  );
  return rows[0];
}

async function upsertStat(client, s) {
  const { rows } = await client.query(
    `INSERT INTO market_stats
       (sector_group, isat_code, size_class, metric, value, unit, reference_year, source_url, notes)
     VALUES (COALESCE($1::varchar, 'all'), COALESCE($2::varchar, ''), COALESCE($3::varchar, 'all'),
             $4, $5, COALESCE($6::varchar, 'count'), $7, $8, $9)
     ON CONFLICT (sector_group, isat_code, size_class, metric, reference_year) DO UPDATE SET
       value      = EXCLUDED.value,
       unit       = EXCLUDED.unit,
       source_url = EXCLUDED.source_url,
       notes      = EXCLUDED.notes
     RETURNING (xmax = 0) AS inserted`,
    [s.sector_group ?? null, s.isat_code ?? null, s.size_class ?? null, s.metric, s.value,
      s.unit ?? null, s.reference_year, s.source_url ?? null, s.notes ?? null]
  );
  return rows[0];
}

// Exported for the integration test: takes the parsed payload, returns counts.
async function importMarketData(payload, { dryRun = false } = {}) {
  validate(payload);
  const counts = {
    companies:  { inserted: 0, updated: 0 },
    financials: { inserted: 0, updated: 0 },
    stats:      { inserted: 0, updated: 0 },
  };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const c of payload.companies || []) {
      const { id, inserted } = await upsertCompany(client, c);
      counts.companies[inserted ? 'inserted' : 'updated']++;
      for (const f of c.financials || []) {
        const r = await upsertFinancial(client, id, f);
        counts.financials[r.inserted ? 'inserted' : 'updated']++;
      }
    }
    for (const s of payload.stats || []) {
      const r = await upsertStat(client, s);
      counts.stats[r.inserted ? 'inserted' : 'updated']++;
    }
    await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
    return counts;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const { file, dryRun } = parseArgs(process.argv);
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  const counts  = await importMarketData(payload, { dryRun });
  const prefix  = dryRun ? '[dry-run] ' : '';
  for (const [table, c] of Object.entries(counts)) {
    console.log(`${prefix}${table.padEnd(10)} inserted=${c.inserted} updated=${c.updated}`);
  }
  if (dryRun) console.log('[dry-run] rolled back — nothing written');
}

module.exports = { parseArgs, validate, importMarketData };

if (require.main === module) {
  main()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => { console.error('Import failed:', err.message); process.exit(1); });
}

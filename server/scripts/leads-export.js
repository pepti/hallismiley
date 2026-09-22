#!/usr/bin/env node
// Leads export — dumps THIS instance's `leads` (migration 097) as JSON so the
// enquiries a public box captures can be carried to the private ops instance
// (D-020 step 4: "weekly and by hand while there are 1–3 customers"). The
// other half is server/scripts/leads-import.js, run on ops.
//
// Usage:
//   node server/scripts/leads-export.js [--since <ISO date>] [--out <file>]
//   npm run leads:export -- --since 2026-09-15 --out data/leads-2026-09-22.json
//
// Default is stdout; --since keeps rows with created_at >= the date (the whole
// table when omitted — the import is idempotent, so over-exporting only costs
// bytes). --out writes the file instead.
//
// SUBMISSION FIELDS ONLY. The export carries what the visitor typed plus the
// receipt time (submission_id, name, email, company, phone, current_platform,
// message, source, locale, created_at) and NEVER the ops workflow columns
// (status, owner_user_id, contacted_*, note): on ops those are the seller's
// work product, and a file that carried them could clobber it on re-import.
// `instance` is the APP_URL host (falling back to INSTANCE_ROLE) so the ops
// side can label the source.
//
// PII. Every row is personal data (/personuvernd §3). The file goes under
// gitignored `data/` (never a tracked path), is carried by hand, and is
// deleted after the import on ops — ops then holds the row under the same
// 24-month retention (§6, LEAD_RETENTION_DAYS). Field values never reach the
// log: this script prints only counts.
//
// JSON shape:
// {
//   "exportedAt": "2026-09-22T10:00:00.000Z",
//   "instance": "www.orangesmiley.is",
//   "leads": [{
//     "submission_id": "8d3e…", "name": "Jóna Jónsdóttir", "email": "jona@example.is",
//     "company": "Ísprjón ehf.", "phone": "555 1234", "current_platform": "shopify",
//     "message": "…", "source": "hafa-samband", "locale": "is",
//     "created_at": "2026-09-20T08:15:00.000Z"
//   }]
// }
require('dotenv').config({ path: require('path').join(__dirname, '../../.env'), quiet: true });

const fs = require('fs');
const { pool } = require('../config/database');
const { instanceRole } = require('../config/instanceRole');

// The whitelist. Adding a column here is a deliberate act — the importer's
// validator and the shape test in tests/integration/leadsTransfer.test.js
// pin the same list.
const EXPORT_COLUMNS = [
  'submission_id', 'name', 'email', 'company', 'phone', 'current_platform',
  'message', 'source', 'locale', 'created_at',
];

function parseArgs(argv) {
  const args = { since: null, out: null };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--since' || a === '--out') {
      const v = rest[++i];
      if (v == null || v.startsWith('--')) throw new Error(`${a} needs a value`);
      if (a === '--since') {
        if (Number.isNaN(Date.parse(v))) throw new Error(`--since must be an ISO date, got "${v}"`);
        args.since = v;
      } else {
        args.out = v;
      }
    } else {
      throw new Error('Usage: node server/scripts/leads-export.js [--since <ISO date>] [--out <file>]');
    }
  }
  return args;
}

/** The label the import side uses for `source`: APP_URL's host, else the role. */
function instanceLabel(env = process.env) {
  try {
    if (env.APP_URL) return new URL(env.APP_URL).host;
  } catch { /* fall through to the role */ }
  return instanceRole();
}

// Exported for the integration test: takes an optional since, returns the
// payload object (not yet serialised).
async function buildExport({ since = null } = {}, client = pool) {
  const { rows } = await client.query(
    `SELECT ${EXPORT_COLUMNS.join(', ')}
       FROM leads
      WHERE $1::timestamptz IS NULL OR created_at >= $1::timestamptz
      ORDER BY created_at ASC, id ASC`,
    [since]
  );
  return {
    exportedAt: new Date().toISOString(),
    instance: instanceLabel(),
    leads: rows.map((r) => {
      const out = {};
      for (const k of EXPORT_COLUMNS) out[k] = k === 'created_at' ? new Date(r[k]).toISOString() : r[k];
      return out;
    }),
  };
}

async function main() {
  const { since, out } = parseArgs(process.argv);
  const payload = await buildExport({ since });
  const body = JSON.stringify(payload, null, 2) + '\n';
  if (out) {
    fs.writeFileSync(out, body);
    // Counts only — never a field value.
    console.error(`Wrote ${out}: ${payload.leads.length} lead(s) from ${payload.instance}${since ? ` since ${since}` : ''}`);
  } else {
    process.stdout.write(body);
  }
}

module.exports = { parseArgs, buildExport, instanceLabel, EXPORT_COLUMNS };

if (require.main === module) {
  main()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => { console.error('Export failed:', err.message); process.exit(1); });
}

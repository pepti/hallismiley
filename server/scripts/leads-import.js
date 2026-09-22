#!/usr/bin/env node
// Leads import — reads a file written by server/scripts/leads-export.js on
// another instance (the public orangesmiley.is; rekstrarkerfi.is once grafted)
// and inserts the enquiries into THIS instance's `leads` (migration 097).
// Run on the private ops instance (D-020 step 4).
//
// Usage:
//   node server/scripts/leads-import.js <file.json> [--dry-run] [--source <label>]
//   npm run leads:import -- data/leads-2026-09-22.json
//
// Idempotent, insert-only: rows upsert by submission_id with
// ON CONFLICT DO NOTHING — an existing lead is NEVER updated. The ops row is
// the seller's work product (status, owner, note, contacted_*), and the
// submission fields are immutable everywhere (Lead model rule), so a
// re-import of the same file — or a corrected one — can add rows but never
// change one. Inserted rows start as status 'new' with no owner; `created_at`
// is the receipt time on the exporting instance, kept so the 24-month
// retention counts from when the visitor actually wrote. `source` = --source
// when given, else the file's `instance` (the exporting host), so the inbox
// shows where an enquiry came from.
//
// The whole file is validated first — the contact form's own limits
// (contactController: name ≤100, email ≤200 and well-formed, message 10–2000,
// company ≤150, phone ≤40; Lead.CAPS for platform/locale/source) — and
// written in ONE transaction: a bad row anywhere means nothing is written.
// --dry-run validates, counts and rolls back.
//
// PII. Every row is personal data (/personuvernd §3). The export file lives
// under gitignored `data/` (never a tracked path) and is DELETED after a
// successful import — ops then holds the rows under the same 24-month
// retention (§6, LEAD_RETENTION_DAYS). Field values never reach the log: this
// script prints counts and, on a bad row, the row index and submission id only.
require('dotenv').config({ path: require('path').join(__dirname, '../../.env'), quiet: true });

const fs = require('fs');
const { pool } = require('../config/database');

// Mirrors contactController.js (EMAIL_RE, the length checks) and Lead.CAPS.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMITS = {
  name: 100, email: 200, company: 150, phone: 40, platform: 20,
  message: 2000, locale: 5, source: 30,
};
const MIN_MESSAGE = 10;

function parseArgs(argv) {
  const args = { file: null, dryRun: false, source: null };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--source') {
      const v = rest[++i];
      if (v == null || v.startsWith('--') || !v.trim()) throw new Error('--source needs a label');
      if (v.trim().length > LIMITS.source) throw new Error(`--source must be at most ${LIMITS.source} characters`);
      args.source = v.trim();
    } else if (a.startsWith('--')) throw new Error(`unknown flag ${a}`);
    else if (args.file) throw new Error('only one file per run');
    else args.file = a;
  }
  if (!args.file) throw new Error('Usage: node server/scripts/leads-import.js <file.json> [--dry-run] [--source <label>]');
  return args;
}

const str = (v) => (typeof v === 'string' ? v.trim() : null);

// Collects every problem in the file and throws once, naming each bad row by
// index and submission id (never by a field value).
function validate(payload, { source = null } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Invalid import file: expected an object');
  }
  if (!Array.isArray(payload.leads)) throw new Error('Invalid import file: `leads` must be an array');
  const errors = [];
  const label = source ?? str(payload.instance);
  if (!label) errors.push('file: `instance` missing — pass --source <label>');
  else if (label.length > LIMITS.source) errors.push(`file: instance label longer than ${LIMITS.source} characters — pass --source <label>`);

  const seen = new Set();
  payload.leads.forEach((l, i) => {
    const id = typeof l?.submission_id === 'string' ? l.submission_id : '?';
    const at = `leads[${i}] (${id})`;
    if (!l || typeof l !== 'object') { errors.push(`${at}: not an object`); return; }
    if (!UUID_RE.test(id))          errors.push(`${at}: submission_id must be a UUID`);
    else if (seen.has(id.toLowerCase())) errors.push(`${at}: submission_id appears twice in the file`);
    seen.add(id.toLowerCase());

    const name = str(l.name);
    if (!name)                              errors.push(`${at}: name required`);
    else if (name.length > LIMITS.name)     errors.push(`${at}: name longer than ${LIMITS.name}`);

    const email = str(l.email);
    if (!email || !EMAIL_RE.test(email))    errors.push(`${at}: email missing or malformed`);
    else if (email.length > LIMITS.email)   errors.push(`${at}: email longer than ${LIMITS.email}`);

    const message = str(l.message);
    if (!message || message.length < MIN_MESSAGE) errors.push(`${at}: message shorter than ${MIN_MESSAGE}`);
    else if (message.length > LIMITS.message)     errors.push(`${at}: message longer than ${LIMITS.message}`);

    for (const [k, max] of [['company', LIMITS.company], ['phone', LIMITS.phone],
      ['current_platform', LIMITS.platform], ['locale', LIMITS.locale]]) {
      if (l[k] == null) continue;
      if (typeof l[k] !== 'string')        errors.push(`${at}: ${k} must be a string or null`);
      else if (l[k].trim().length > max)   errors.push(`${at}: ${k} longer than ${max}`);
    }

    if (typeof l.created_at !== 'string' || Number.isNaN(Date.parse(l.created_at))) {
      errors.push(`${at}: created_at must be an ISO timestamp`);
    }
  });

  if (errors.length) throw new Error('Invalid import file:\n  ' + errors.join('\n  '));
  return label;
}

const nul = (v, max) => {
  const s = str(v);
  return s ? s.slice(0, max) : null;
};

async function insertLead(client, l, source) {
  const { rows } = await client.query(
    `INSERT INTO leads
       (submission_id, name, email, company, phone, current_platform, message, source, locale, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz)
     ON CONFLICT (submission_id) DO NOTHING
     RETURNING id`,
    [
      l.submission_id.toLowerCase(),
      l.name.trim(), l.email.trim(),
      nul(l.company, LIMITS.company), nul(l.phone, LIMITS.phone),
      nul(l.current_platform, LIMITS.platform),
      l.message.trim(), source, nul(l.locale, LIMITS.locale), l.created_at,
    ]
  );
  return rows.length > 0;
}

// Exported for the integration test: takes the parsed payload, returns
// { inserted, skipped, source }.
async function importLeads(payload, { dryRun = false, source = null } = {}) {
  const label = validate(payload, { source });
  const counts = { inserted: 0, skipped: 0, source: label };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const l of payload.leads) {
      if (await insertLead(client, l, label)) counts.inserted++;
      else counts.skipped++;
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
  const { file, dryRun, source } = parseArgs(process.argv);
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  const counts  = await importLeads(payload, { dryRun, source });
  const prefix  = dryRun ? '[dry-run] ' : '';
  console.log(`${prefix}leads inserted=${counts.inserted} skipped=${counts.skipped} source=${counts.source}`);
  if (dryRun) console.log('[dry-run] rolled back — nothing written');
  else console.log(`Done — delete ${file} now (PII; ops holds the rows under LEAD_RETENTION_DAYS).`);
}

module.exports = { parseArgs, validate, importLeads, LIMITS };

if (require.main === module) {
  main()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => { console.error('Import failed:', err.message); process.exit(1); });
}

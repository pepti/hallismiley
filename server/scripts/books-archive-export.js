#!/usr/bin/env node
// Export the books as a self-contained, checksummed archive.
//
// WHY THIS EXISTS
//
// Bókhaldslög 145/1994 gr. 20 requires accounting records to be retained for seven
// years AND kept in Iceland. This application runs on Azure App Service, and Azure
// has no Iceland region — the nearest are North Europe (Dublin) and West Europe
// (Amsterdam). So the live database cannot satisfy the location requirement on its
// own, and no amount of configuration changes that.
//
// This script is therefore not a convenience. It is the only route to compliance:
// it produces a complete, verifiable copy of the books that can be written to
// storage physically in Iceland — a local disk, an Icelandic hosting provider, an
// external drive in a drawer. Run it at least once per financial year, keep every
// run, and store them somewhere in the country.
//
// WHAT IT PRODUCES
//
//   <out>/manifest.json          what this archive contains, and every checksum
//   <out>/journal.csv            every posted line — the ledger in full
//   <out>/journal-entries.csv    one row per entry, with its source and author
//   <out>/trial-balance.csv      account totals, and whether they balance
//   <out>/invoices.csv           every invoice issued, with its VAT split
//   <out>/invoice-lines.csv      the lines behind them
//   <out>/settlements.csv        payments, refunds and credit notes
//   <out>/expenses.csv           every expense, with its VAT verdict and reason
//   <out>/vat-returns.csv        every filed VSK return, as filed
//   <out>/accounts.csv           the chart of accounts as it stood
//   <out>/audit-log.csv          who did what, when
//   <out>/documents/…            every receipt and supporting file, by id
//
// The manifest carries a SHA-256 for every file, and for the document files it
// carries BOTH the checksum recorded at upload and the checksum computed now. A
// mismatch means the stored file has changed since it was filed — which is exactly
// the "áreiðanleiki" (reliability) property Reglugerð 505/2013 gr. 14 is about, and
// exactly what silent bit-rot or a careless restore would otherwise hide.
//
// USAGE
//
//   npm run books:archive -- --out=./archive/2026
//   node server/scripts/books-archive-export.js --out=D:/bokhald/2026 --year=2026
//   node server/scripts/books-archive-export.js --out=./archive/2026 --verify-only
//
//   --out=DIR        where to write. Required. Created if missing; refuses to write
//                    into a directory that already holds an archive unless --force.
//   --year=YYYY      restrict to one financial year. Omit for everything to date.
//   --no-documents   skip the document files (metadata and checksums still exported).
//                    Faster, smaller, and NOT sufficient for gr. 20 on its own.
//   --verify-only    re-check an existing archive against its manifest and exit.
//   --force          overwrite an existing archive in --out.

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const db = require('../config/database');
const logger = require('../logger');
const { BOOKS_UPLOAD_ROOT } = require('../config/paths');
const { toCsv, csvCell } = require('../utils/csv');

// Rows are streamed to disk in pages rather than assembled in memory: an archive is
// the one operation guaranteed to touch every row in the books, and a seven-year-old
// set of books is exactly the case where "it all fits in memory" stops being true.
const PAGE = 2000;

function parseArgs(argv) {
  const args = { out: null, year: null, documents: true, verifyOnly: false, force: false };
  for (const raw of argv.slice(2)) {
    if (raw === '--no-documents') { args.documents = false; continue; }
    if (raw === '--verify-only') { args.verifyOnly = true; continue; }
    if (raw === '--force') { args.force = true; continue; }
    const m = raw.match(/^--([a-z-]+)=(.*)$/);
    if (!m) throw new Error(`Unrecognised argument: ${raw}`);
    const [, key, value] = m;
    if (key === 'out') args.out = value;
    else if (key === 'year') {
      if (!/^\d{4}$/.test(value)) throw new Error(`--year must be a four-digit year, got ${value}`);
      args.year = Number(value);
    } else throw new Error(`Unrecognised argument: --${key}`);
  }
  if (!args.out) throw new Error('--out=DIR is required');
  return args;
}

function yearRange(year) {
  if (!year) return { from: null, to: null };
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

async function sha256File(absPath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(absPath)) hash.update(chunk);
  return hash.digest('hex');
}

function isoDay(value) {
  if (!value) return '';
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function isoStamp(value) {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * Write one CSV, paging through the query, and return its checksum.
 *
 * The checksum is computed over the bytes actually written, not over the rows in
 * memory — so it certifies the file on disk, which is the thing that will be read
 * back in seven years.
 */
async function writeCsv(outDir, name, headers, pager) {
  const abs = path.join(outDir, name);
  const stream = fs.createWriteStream(abs, { encoding: 'utf8' });
  const write = chunk => new Promise((resolve, reject) => {
    stream.write(chunk, err => (err ? reject(err) : resolve()));
  });
  const line = row => `${row.map(csvCell).join(',')}\r\n`;

  // Built from csvCell rather than toCsv(), because toCsv() emits a BOM and a header
  // per call — correct for a one-shot download, wrong for a file written in pages.
  // The BOM is written once, here, and it matters: without it Excel on Windows
  // mangles every ð þ æ ö in an otherwise-correct export.
  await write('\uFEFF');
  await write(line(headers));

  let rowCount = 0;
  for (let offset = 0; ; offset += PAGE) {
    const rows = await pager(offset, PAGE);
    for (const row of rows) await write(line(row));
    rowCount += rows.length;
    if (rows.length < PAGE) break;
  }
  await new Promise((resolve, reject) => stream.end(err => (err ? reject(err) : resolve())));

  return { file: name, rows: rowCount, sha256: await sha256File(abs), bytes: (await fsp.stat(abs)).size };
}

// A date filter written once and reused, so no export can accidentally run unfiltered
// while the manifest claims a single year.
function dateFilter(column, { from, to }, params) {
  const parts = [];
  if (from) { params.push(from); parts.push(`${column} >= $${params.length}::date`); }
  if (to) { params.push(to); parts.push(`${column} <= $${params.length}::date`); }
  return parts;
}

// ── The exports ──────────────────────────────────────────────────────────────

const JOURNAL_HEADERS = ['Færslunr.', 'Dagsetning', 'Uppruni', 'Uppruna-id', 'Skýring',
  'Lykill', 'Lykilheiti', 'Debet', 'Kredit', 'Línuskýring', 'VSK %', 'Leiðrétting',
  'Bakfærir', 'Bókað af', 'Bókað tímastimpill', 'Fylgiskjal'];

function journalLinesExport(range) {
  return async (offset, limit) => {
    const params = [];
    const where = ['je.posted_at IS NOT NULL', ...dateFilter('je.entry_date', range, params)];
    params.push(limit, offset);
    const { rows } = await db.query(
      `SELECT je.entry_number, je.entry_date, je.source_type, je.source_id, je.memo,
              la.code, la.name, jl.debit, jl.credit, jl.memo AS line_memo, jl.vat_rate,
              je.is_correction, je.reverses_entry_id, u.username, je.posted_at, je.document_id
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.entry_id
         JOIN ledger_accounts la ON la.id = jl.account_id
         LEFT JOIN users u ON u.id = je.created_by
        WHERE ${where.join(' AND ')}
        ORDER BY je.entry_number, jl.sort_order
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return rows.map(r => [
      r.entry_number, isoDay(r.entry_date), r.source_type, r.source_id || '', r.memo,
      r.code, r.name, r.debit, r.credit, r.line_memo || '',
      r.vat_rate === null ? '' : r.vat_rate,
      r.is_correction ? 'já' : '', r.reverses_entry_id || '', r.username || '',
      isoStamp(r.posted_at), r.document_id || '',
    ]);
  };
}

const ENTRY_HEADERS = ['Færslunr.', 'Dagsetning', 'Uppruni', 'Uppruna-id', 'Skýring',
  'Fjárhæð', 'Leiðrétting', 'Bakfærir', 'Fylgiskjal', 'Bókað af', 'Bókað tímastimpill', 'Id'];

function journalEntriesExport(range) {
  return async (offset, limit) => {
    const params = [];
    const where = ['je.posted_at IS NOT NULL', ...dateFilter('je.entry_date', range, params)];
    params.push(limit, offset);
    const { rows } = await db.query(
      `SELECT je.id, je.entry_number, je.entry_date, je.source_type, je.source_id, je.memo,
              je.is_correction, je.reverses_entry_id, je.document_id, je.posted_at,
              u.username,
              (SELECT COALESCE(SUM(debit), 0) FROM journal_lines WHERE entry_id = je.id) AS total
         FROM journal_entries je
         LEFT JOIN users u ON u.id = je.created_by
        WHERE ${where.join(' AND ')}
        ORDER BY je.entry_number
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return rows.map(r => [
      r.entry_number, isoDay(r.entry_date), r.source_type, r.source_id || '', r.memo,
      r.total, r.is_correction ? 'já' : '', r.reverses_entry_id || '',
      r.document_id || '', r.username || '', isoStamp(r.posted_at), r.id,
    ]);
  };
}

const INVOICE_HEADERS = ['Sería', 'Reikningsnr.', 'Útgefinn', 'Gjalddagi', 'Staða',
  'Viðskiptavinur', 'Kennitala', 'Heimilisfang', 'Netfang', 'Land', 'Mynt',
  'Upphafleg mynt', 'Upphafleg fjárhæð', 'Gengi', 'Án VSK', 'VSK', 'Afsláttur',
  'Sending', 'Með VSK', 'Greitt', 'Kreditfært', 'Endurgreitt', 'Ástæða núllskatts',
  'Pöntun', 'Athugasemd', 'Búið til', 'Id'];

// Drafts are excluded on purpose: a draft is not a document that has been issued to
// anyone, so it is not part of the record that must be retained.
function invoicesExport(range) {
  return async (offset, limit) => {
    const params = [];
    const where = ["i.status <> 'draft'", ...dateFilter('i.issued_at', range, params)];
    params.push(limit, offset);
    const { rows } = await db.query(
      `SELECT i.series, i.invoice_number, i.issued_at, i.due_at, i.status,
              i.customer_name, i.customer_kennitala, i.customer_address, i.customer_email,
              i.customer_country, i.currency, i.original_currency, i.original_total_gross,
              i.fx_rate, i.subtotal_net, i.vat_total, i.discount_total, i.shipping_gross,
              i.total_gross, i.amount_paid, i.amount_credited, i.amount_refunded,
              i.zero_rate_reason, i.order_id, i.note, i.created_at, i.id
         FROM invoices i
        WHERE ${where.join(' AND ')}
        ORDER BY i.invoice_number
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return rows.map(r => [
      r.series, r.invoice_number, isoDay(r.issued_at), isoDay(r.due_at), r.status,
      r.customer_name || '', r.customer_kennitala || '', r.customer_address || '',
      r.customer_email || '', r.customer_country || '',
      r.currency, r.original_currency || '',
      r.original_total_gross === null ? '' : r.original_total_gross,
      r.fx_rate === null ? '' : r.fx_rate,
      r.subtotal_net, r.vat_total, r.discount_total, r.shipping_gross, r.total_gross,
      r.amount_paid, r.amount_credited, r.amount_refunded, r.zero_rate_reason || '',
      r.order_id || '', r.note || '', isoStamp(r.created_at), r.id,
    ]);
  };
}

const LINE_HEADERS = ['Reikningsnr.', 'Röð', 'Vörunr.', 'Lýsing', 'Magn',
  'Verð með VSK', 'VSK %', 'Fyrir afslátt', 'Afsláttur', 'Lína án VSK', 'Lína VSK',
  'Lína með VSK', 'Tekjulykill', 'Vara'];

function invoiceLinesExport(range) {
  return async (offset, limit) => {
    const params = [];
    const where = ["i.status <> 'draft'", ...dateFilter('i.issued_at', range, params)];
    params.push(limit, offset);
    const { rows } = await db.query(
      `SELECT i.invoice_number, il.sort_order, il.sku, il.description, il.quantity,
              il.unit_price_gross, il.vat_rate, il.gross_before_discount, il.discount_gross,
              il.line_net, il.line_vat, il.line_gross, il.revenue_account, il.product_id
         FROM invoice_lines il
         JOIN invoices i ON i.id = il.invoice_id
        WHERE ${where.join(' AND ')}
        ORDER BY i.invoice_number, il.sort_order
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return rows.map(r => [
      r.invoice_number, r.sort_order, r.sku || '', r.description, r.quantity,
      r.unit_price_gross, r.vat_rate, r.gross_before_discount, r.discount_gross,
      r.line_net, r.line_vat, r.line_gross, r.revenue_account || '', r.product_id || '',
    ]);
  };
}

const SETTLEMENT_HEADERS = ['Reikningsnr.', 'Dagsetning', 'Tegund', 'Fjárhæð',
  'Greiðslumáti', 'Tilvísun', 'Ástæða / samsemdarlykill', 'Skráð', 'Id'];

// Payments, refunds and credit notes in one file, because from the archive's point of
// view they are the same kind of fact: something happened to an invoice after issue.
function settlementsExport(range) {
  return async (offset, limit) => {
    const params = [];
    const pw = dateFilter('p.received_at', range, params);
    const cw = dateFilter('cn.issued_at', range, params);
    params.push(limit, offset);
    const { rows } = await db.query(
      `SELECT * FROM (
         SELECT i.invoice_number, p.received_at AS happened_at,
                CASE WHEN p.direction = 'out' THEN 'endurgreiðsla' ELSE 'greiðsla' END AS kind,
                p.amount, p.method, p.reference, p.idempotency_key AS note,
                p.created_at, p.id
           FROM payments p JOIN invoices i ON i.id = p.invoice_id
          ${pw.length ? `WHERE ${pw.join(' AND ')}` : ''}
         UNION ALL
         SELECT i.invoice_number, cn.issued_at AS happened_at, 'kreditnóta' AS kind,
                cn.amount_gross AS amount, '' AS method,
                cn.credit_note_number::text AS reference, cn.reason AS note,
                cn.created_at, cn.id
           FROM credit_notes cn JOIN invoices i ON i.id = cn.invoice_id
          ${cw.length ? `WHERE ${cw.join(' AND ')}` : ''}
       ) s
       ORDER BY s.happened_at, s.invoice_number
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return rows.map(r => [
      r.invoice_number, isoDay(r.happened_at), r.kind, r.amount,
      r.method || '', r.reference || '', r.note || '', isoStamp(r.created_at), r.id,
    ]);
  };
}

const EXPENSE_HEADERS = ['Dagsetning', 'Seljandi', 'Kennitala seljanda', 'Land',
  'Reikningsnr. seljanda', 'Lýsing', 'Með VSK', 'Án VSK', 'VSK', 'VSK-kóði',
  'Innskattur frádráttarbær', 'Ástæða ef ekki', 'Lykill', 'Lykilheiti',
  'Upphafleg mynt', 'Upphafleg fjárhæð', 'Gengi', 'Fylgiskjal', 'Skráð af', 'Skráð', 'Id'];

function expensesExport(range) {
  return async (offset, limit) => {
    const params = [];
    const where = dateFilter('e.expense_date', range, params);
    params.push(limit, offset);
    const { rows } = await db.query(
      `SELECT e.expense_date, e.supplier_name, e.supplier_kennitala, e.supplier_country,
              e.supplier_invoice_no, e.description,
              e.amount_gross, e.amount_net, e.amount_vat, e.vat_code,
              e.vat_deductible, e.non_deductible_reason, la.code AS account_code,
              la.name AS account_name, e.original_currency, e.original_amount_gross,
              e.fx_rate, e.document_id, u.username, e.created_at, e.id
         FROM expenses e
         LEFT JOIN ledger_accounts la ON la.id = e.account_id
         LEFT JOIN users u ON u.id = e.created_by
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY e.expense_date, e.created_at
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return rows.map(r => [
      isoDay(r.expense_date), r.supplier_name || '', r.supplier_kennitala || '',
      r.supplier_country || '', r.supplier_invoice_no || '', r.description,
      r.amount_gross, r.amount_net, r.amount_vat, r.vat_code || '',
      r.vat_deductible ? 'já' : 'nei', r.non_deductible_reason || '',
      r.account_code || '', r.account_name || '', r.original_currency || '',
      r.original_amount_gross === null ? '' : r.original_amount_gross,
      r.fx_rate === null ? '' : r.fx_rate, r.document_id || '',
      r.username || '', isoStamp(r.created_at), r.id,
    ]);
  };
}

const VAT_HEADERS = ['Tímabil', 'A netto 24%', 'B netto 11%', 'C núllskatt',
  'D útskattur', 'E innskattur', 'F til greiðslu', 'Skilað', 'Skilað af',
  'Athugasemd', 'Hnekkt fyrirvörum', 'Fyrirvarar', 'Uppruni (JSON)'];

// The filed returns, as filed — snapshot figures, not re-derived ones. A return that
// re-derived itself at export time would not be evidence of what was reported.
function vatReturnsExport() {
  return async (offset, limit) => {
    const { rows } = await db.query(
      `SELECT vr.period, vr.box_a_net_24, vr.box_b_net_11, vr.box_c_net_zero,
              vr.box_d_output, vr.box_e_input, vr.box_f_payable,
              vr.detail, vr.preflight, vr.filed_at, vr.note, u.username
         FROM vat_returns vr
         LEFT JOIN users u ON u.id = vr.filed_by
        ORDER BY vr.period
        LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return rows.map((r) => {
      const pre = r.preflight || {};
      const findings = Array.isArray(pre.findings) ? pre.findings : [];
      return [
        r.period, r.box_a_net_24, r.box_b_net_11, r.box_c_net_zero,
        r.box_d_output, r.box_e_input, r.box_f_payable,
        isoStamp(r.filed_at), r.username || '', r.note || '',
        pre.overridden ? 'já' : '',
        findings.filter(f => f.level === 'blocker').map(f => f.code).join(' '),
        // The whole derivation, verbatim. It is the only record of WHICH accounts
        // produced the figure that was reported, and re-deriving it from a
        // seven-year-old ledger is not the same evidence.
        JSON.stringify(r.detail || {}),
      ];
    });
  };
}

const ACCOUNT_HEADERS = ['Lykill', 'Heiti', 'Heiti (EN)', 'Tegund', 'VSK-kóði',
  'Innskattur bannaður', 'Skýring', 'Í notkun', 'Röð'];

// The chart of accounts AS IT STOOD. Without it, a seven-year-old journal is a list of
// numbers against codes whose meaning has been edited since.
function accountsExport() {
  return async (offset, limit) => {
    const { rows } = await db.query(
      `SELECT code, name, name_en, type, vat_code, input_vat_blocked, description,
              is_active, sort
         FROM ledger_accounts ORDER BY sort, code LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return rows.map(r => [
      r.code, r.name, r.name_en || '', r.type, r.vat_code || '',
      r.input_vat_blocked ? 'já' : 'nei', r.description || '',
      r.is_active ? 'já' : 'nei', r.sort,
    ]);
  };
}

const AUDIT_HEADERS = ['Tímastimpill', 'Aðgerð', 'Tegund', 'Id', 'Samantekt',
  'Notandi', 'Beiðni'];

function auditExport(range) {
  return async (offset, limit) => {
    const params = [];
    const where = dateFilter('a.created_at', range, params);
    params.push(limit, offset);
    const { rows } = await db.query(
      `SELECT a.created_at, a.action, a.entity_type, a.entity_id, a.summary,
              u.username, a.request_id
         FROM books_audit_log a
         LEFT JOIN users u ON u.id = a.actor_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY a.created_at
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return rows.map(r => [
      isoStamp(r.created_at), r.action, r.entity_type, r.entity_id || '',
      JSON.stringify(r.summary || {}), r.username || '', r.request_id || '',
    ]);
  };
}

// Small enough to write in one go, and worth writing through the same reportService
// the screens use — so the archived trial balance is the same computation, not a
// second implementation that could drift from it.
async function trialBalanceExport(outDir, range) {
  const reports = require('../services/bookkeeping/reportService');
  const tb = await reports.trialBalance({ from: range.from, to: range.to });
  const abs = path.join(outDir, 'trial-balance.csv');
  await fsp.writeFile(abs, toCsv(
    ['Lykill', 'Heiti', 'Tegund', 'Debet', 'Kredit', 'Staða'],
    [
      ...tb.accounts.map(a => [a.code, a.name, a.type, a.debit, a.credit, a.balance]),
      ['', 'SAMTALS', '', tb.debit_total, tb.credit_total, ''],
    ]
  ), 'utf8');
  return {
    entry: {
      file: 'trial-balance.csv',
      rows: tb.accounts.length,
      sha256: await sha256File(abs),
      bytes: (await fsp.stat(abs)).size,
    },
    balanced: tb.balanced,
    difference: tb.difference,
    debit_total: tb.debit_total,
    credit_total: tb.credit_total,
  };
}

/**
 * Copy every document, and verify each one as it goes.
 *
 * The file is copied under its document id rather than its original name, because
 * original names collide ("skanni.pdf" three times over) and an archive that silently
 * overwrites a receipt is worse than one that is awkward to browse. The manifest maps
 * ids back to original names.
 */
async function exportDocuments(outDir) {
  const docDir = path.join(outDir, 'documents');
  await fsp.mkdir(docDir, { recursive: true });

  const documents = [];
  const problems = [];
  for (let offset = 0; ; offset += PAGE) {
    const { rows } = await db.query(
      `SELECT id, kind, original_name, file_path, mime_type, byte_size,
              checksum_sha256, note, created_at
         FROM books_documents ORDER BY created_at LIMIT $1 OFFSET $2`,
      [PAGE, offset]
    );
    for (const doc of rows) {
      const src = path.resolve(BOOKS_UPLOAD_ROOT, doc.file_path);
      const ext = path.extname(doc.original_name) || '';
      const destName = `${doc.id}${ext}`;
      const dest = path.join(docDir, destName);
      const entry = {
        id: doc.id,
        kind: doc.kind,
        original_name: doc.original_name,
        archived_as: `documents/${destName}`,
        mime_type: doc.mime_type,
        byte_size_recorded: Number(doc.byte_size),
        checksum_recorded: doc.checksum_sha256,
        created_at: isoStamp(doc.created_at),
      };
      try {
        await fsp.copyFile(src, dest);
        entry.checksum_now = await sha256File(dest);
        entry.byte_size_now = (await fsp.stat(dest)).size;
        // Reported, not repaired. A changed checksum is a fact about the stored file
        // that the archive must carry — quietly re-recording the new hash would
        // destroy the only evidence that something moved underneath the books.
        entry.verified = entry.checksum_now === doc.checksum_sha256;
        if (!entry.verified) {
          problems.push(`${doc.id} (${doc.original_name}): checksum differs from the one recorded at upload`);
        }
      } catch (err) {
        entry.verified = false;
        entry.error = err.code === 'ENOENT' ? 'file missing from storage' : err.message;
        problems.push(`${doc.id} (${doc.original_name}): ${entry.error}`);
      }
      documents.push(entry);
    }
    if (rows.length < PAGE) break;
  }
  return { documents, problems };
}

// ── Verify ───────────────────────────────────────────────────────────────────

/**
 * Re-check an archive against its own manifest.
 *
 * This is the half that makes the archive worth having. A backup nobody has ever read
 * back is a hope, not a record — so verification is a first-class mode rather than a
 * comment telling the reader to check by hand.
 */
async function verify(outDir) {
  const manifest = JSON.parse(await fsp.readFile(path.join(outDir, 'manifest.json'), 'utf8'));
  const failures = [];
  let checked = 0;

  for (const f of manifest.files || []) {
    try {
      const now = await sha256File(path.join(outDir, f.file));
      checked++;
      if (now !== f.sha256) failures.push(`${f.file}: checksum differs from manifest`);
    } catch (err) {
      failures.push(`${f.file}: ${err.code === 'ENOENT' ? 'missing' : err.message}`);
    }
  }
  for (const d of manifest.documents || []) {
    if (!d.archived_as) continue;
    try {
      const now = await sha256File(path.join(outDir, d.archived_as));
      checked++;
      // Against the checksum recorded AT UPLOAD, not the one recorded at export: the
      // upload checksum is the statutory anchor, and comparing against the export
      // checksum would happily certify a file that was already wrong when archived.
      if (now !== d.checksum_recorded) {
        failures.push(`${d.archived_as} (${d.original_name}): checksum differs from the upload record`);
      }
    } catch (err) {
      failures.push(`${d.archived_as}: ${err.code === 'ENOENT' ? 'missing' : err.message}`);
    }
  }

  return { checked, failures, manifest };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function exportArchive(args) {
  const outDir = path.resolve(args.out);
  const existing = path.join(outDir, 'manifest.json');
  if (fs.existsSync(existing) && !args.force) {
    throw new Error(`${outDir} already holds an archive. Use --force to overwrite, or pick another --out.`);
  }
  await fsp.mkdir(outDir, { recursive: true });

  const range = yearRange(args.year);
  const files = [];
  files.push(await writeCsv(outDir, 'journal.csv', JOURNAL_HEADERS, journalLinesExport(range)));
  files.push(await writeCsv(outDir, 'journal-entries.csv', ENTRY_HEADERS, journalEntriesExport(range)));
  files.push(await writeCsv(outDir, 'invoices.csv', INVOICE_HEADERS, invoicesExport(range)));
  files.push(await writeCsv(outDir, 'invoice-lines.csv', LINE_HEADERS, invoiceLinesExport(range)));
  files.push(await writeCsv(outDir, 'settlements.csv', SETTLEMENT_HEADERS, settlementsExport(range)));
  files.push(await writeCsv(outDir, 'expenses.csv', EXPENSE_HEADERS, expensesExport(range)));
  files.push(await writeCsv(outDir, 'vat-returns.csv', VAT_HEADERS, vatReturnsExport()));
  files.push(await writeCsv(outDir, 'accounts.csv', ACCOUNT_HEADERS, accountsExport()));
  files.push(await writeCsv(outDir, 'audit-log.csv', AUDIT_HEADERS, auditExport(range)));

  const tb = await trialBalanceExport(outDir, range);
  files.push(tb.entry);

  let documents = [];
  let problems = [];
  if (args.documents) {
    const result = await exportDocuments(outDir);
    documents = result.documents;
    problems = result.problems;
  }

  const manifest = {
    schema: 'hallismiley.books.archive/1',
    generated_at: new Date().toISOString(),
    year: args.year || null,
    range,
    // The reason this file exists, stated in the file itself. A future reader — an
    // accountant, Skatturinn, or the owner in 2033 — should not have to find this
    // script to know what they are holding.
    purpose: 'Retention copy of the accounting records, for bókhaldslög 145/1994 gr. 20 '
      + '(seven years, retained in Iceland). The live system runs on Azure, which has no '
      + 'Iceland region, so this archive is the copy that satisfies the location '
      + 'requirement. Store it on media physically located in Iceland.',
    integrity: {
      trial_balance_balanced: tb.balanced,
      trial_balance_difference: tb.difference,
      debit_total: tb.debit_total,
      credit_total: tb.credit_total,
      documents_included: args.documents,
      document_count: documents.length,
      documents_failing_verification: documents.filter(d => !d.verified).length,
    },
    files,
    documents,
    verify_with: 'node server/scripts/books-archive-export.js --verify-only --out=<this directory>',
  };
  await fsp.writeFile(path.join(outDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return { outDir, manifest, files, documents, problems, trialBalance: tb };
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.verifyOnly) {
    const { checked, failures, manifest } = await verify(path.resolve(args.out));
    logger.info({ out: args.out, checked, generated_at: manifest.generated_at },
      'archive verification complete');
    if (failures.length) {
      logger.error({ failures }, `${failures.length} file(s) failed verification`);
      process.exitCode = 1;
      return;
    }
    logger.info(`✓ all ${checked} file(s) match the manifest`);
    return;
  }

  logger.info({ out: args.out, year: args.year || 'all', documents: args.documents },
    'exporting books archive');
  const { outDir, files, documents, problems, trialBalance } = await exportArchive(args);

  logger.info({
    outDir,
    files: files.length,
    rows: files.reduce((a, f) => a + f.rows, 0),
    documents: documents.length,
  }, 'archive written');

  // An unbalanced trial balance in an archive is worth shouting about: the archive is
  // still a faithful copy of the books, but the books themselves are wrong.
  if (!trialBalance.balanced) {
    logger.error({ difference: trialBalance.difference },
      'the exported trial balance does NOT balance — the books are wrong, not just the archive');
    process.exitCode = 1;
  }
  if (problems.length) {
    logger.error({ problems: problems.slice(0, 20), count: problems.length },
      'some documents could not be verified; the manifest records each one');
    process.exitCode = 1;
  }
  if (!args.documents) {
    logger.warn('documents were skipped (--no-documents): this archive alone does not satisfy gr. 20');
  }
  if (trialBalance.balanced && !problems.length) {
    logger.info(`✓ archive complete and verified: ${outDir}`);
  }
}

if (require.main === module) {
  main()
    .then(() => db.pool.end())
    .catch(async (err) => {
      logger.error({ err: err.message }, 'archive export failed');
      await db.pool.end().catch(() => {});
      process.exit(1);
    });
}

module.exports = { parseArgs, yearRange, exportArchive, verify, sha256File };

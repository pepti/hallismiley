// The pure half of the replay benchmark — no database, no services. Everything
// here is requireable from the unit tier.
//
// WHAT A REPLAY IS
//
// The books have never carried a real filing, so the honest question about the
// ledger is not "does it compute a VSK return" but "does it compute the return
// that was actually FILED for a real period". A CASE is a JSON file describing a
// period of history (settings, rates, entries, expenses, counter sales) and the
// figures as submitted to Skatturinn. The runner (replay.js) pushes that history
// through the same services a person uses, derives the return, and this module
// says whether the case is well-formed and whether the derived figures match.
//
// Run once, it is a parallel run. Kept as a fixture and run in CI, it is the
// only test that checks the ledger against external reality rather than against
// itself — a change that breaks reverse charge, or the VAT-inclusive split, or
// period bounds, turns it red with the box named.
//
// The D-split is deliberately part of the comparison. A reverse-charge error moves
// boxes D and E by the SAME amount, so box F — the payable — is unchanged and a
// totals-only benchmark would pass a release that had broken reverse charge
// entirely. Asserting output_vat_domestic and output_vat_reverse_charge separately
// is what catches it.

const { periodBounds } = require('../../utils/vatPeriod');

class ReplayError extends Error {
  constructor(message, code = 'BAD_CASE', field = null) {
    super(message);
    this.name = 'ReplayError';
    this.code = code;
    this.field = field;
  }
}

// Every figure the comparison is over, in the order the RSK 10.01 form reads.
const BOXES = [
  'box_a_net_24',
  'box_b_net_11',
  'box_c_net_zero',
  'box_d_output',
  'output_vat_domestic',
  'output_vat_reverse_charge',
  'box_e_input',
  'box_f_payable',
];

const BOX_LABELS = {
  box_a_net_24: 'A  net turnover 24%',
  box_b_net_11: 'B  net turnover 11%',
  box_c_net_zero: 'C  zero-rated turnover',
  box_d_output: 'D  output VAT',
  output_vat_domestic: '   ├ domestic',
  output_vat_reverse_charge: '   └ reverse charge',
  box_e_input: 'E  input VAT',
  box_f_payable: 'F  payable (D − E)',
};

// Preflight levels a case may pin. `info` findings (deadline, refund position) are
// never asserted — they describe the calendar and the sign of F, not correctness.
const PREFLIGHT_LEVELS = ['blocker', 'warning'];

// ── The target database ─────────────────────────────────────────────────────

/**
 * A replay WIPES its target (drop schema, migrate, apply). The one property that
 * makes it safe to run without thinking is that it will only ever do that to a
 * database whose name ends in `_replay` — no override flag, no environment
 * variable that relaxes it. Postgres URLs parse with the WHATWG URL class (the
 * scheme is non-special, so the pathname is the database name).
 */
function assertReplayDatabase(url) {
  let parsed;
  try {
    parsed = new URL(String(url || ''));
  } catch {
    throw new ReplayError(`Not a database URL: ${url}`, 'BAD_DB');
  }
  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!dbName || !/_replay$/.test(dbName)) {
    throw new ReplayError(
      `Refusing to touch database "${dbName || '(none)'}" — a replay drops and recreates its ` +
      'target schema, so the database name must end in _replay (e.g. orangesmiley_replay).',
      'BAD_DB'
    );
  }
  return { url: String(url), dbName };
}

// `postgresql://…/orangesmiley` → `postgresql://…/orangesmiley_replay`. The default
// target when neither --db nor REPLAY_DATABASE_URL is given: a sibling of whatever
// the .env points at, never the .env database itself.
function replayUrlFrom(url) {
  const parsed = new URL(String(url));
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, '')) || 'orangesmiley';
  parsed.pathname = `/${name.replace(/_replay$/, '')}_replay`;
  return parsed.toString();
}

// ── Case validation ─────────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate a case definition. Throws ReplayError naming the field. Returns the
 * period bounds, whether the case is `pending` (no filed figures recorded yet —
 * the runner then reports the derived figures without comparing), and which
 * dated items fall BEFORE the period (opening balances, prior history — allowed,
 * reported). Anything dated AFTER the period is refused outright: it belongs to a
 * later return and would silently not count, which is the worst kind of fixture.
 */
function validateCase(def) {
  const fail = (field, message) => {
    throw new ReplayError(`${field}: ${message}`, 'BAD_CASE', field);
  };

  if (!def || typeof def !== 'object' || Array.isArray(def)) fail('case', 'a case is a JSON object');
  if (!def.case || typeof def.case !== 'string') fail('case', 'a case needs a name');

  let bounds;
  try {
    bounds = periodBounds(def.period);
  } catch (err) {
    fail('period', err.message);
  }

  const pending = def.pending === true;
  if (!pending) {
    if (!def.expected || typeof def.expected !== 'object') {
      fail('expected', 'missing — record the figures AS FILED, or set "pending": true until they exist');
    }
    for (const box of BOXES) {
      const v = def.expected[box];
      if (!Number.isInteger(v)) fail(`expected.${box}`, `must be a whole number of krónur, got ${JSON.stringify(v)}`);
    }
    // The form's own arithmetic. A fixture that fails this was typed wrong, not filed wrong.
    if (def.expected.box_f_payable !== def.expected.box_d_output - def.expected.box_e_input) {
      fail('expected.box_f_payable', 'must equal box_d_output − box_e_input');
    }
    if (def.expected.box_d_output !== def.expected.output_vat_domestic + def.expected.output_vat_reverse_charge) {
      fail('expected.box_d_output', 'must equal output_vat_domestic + output_vat_reverse_charge');
    }
  }

  for (const key of ['fx_rates', 'manual_entries', 'expenses', 'pos_sales']) {
    if (def[key] !== undefined && !Array.isArray(def[key])) fail(key, 'must be an array');
  }
  if (def.settings !== undefined && (typeof def.settings !== 'object' || def.settings === null)) {
    fail('settings', 'must be an object of books settings');
  }

  const dated = [
    ...(def.manual_entries || []).map((e, i) => [`manual_entries[${i}].entry_date`, e.entry_date]),
    ...(def.expenses || []).map((e, i) => [`expenses[${i}].expense_date`, e.expense_date]),
    ...(def.pos_sales || []).map((s, i) => [`pos_sales[${i}].sold_at`, s.sold_at]),
  ];
  const prior = [];
  for (const [field, d] of dated) {
    if (!ISO_DATE.test(String(d || ''))) fail(field, 'must be an ISO date (YYYY-MM-DD)');
    if (d > bounds.ends_on) {
      fail(field, `is after the period ends (${bounds.ends_on}) — it belongs to a later return and would silently not count`);
    }
    if (d < bounds.starts_on) prior.push(field);
  }

  if (def.expected_preflight !== undefined) {
    if (typeof def.expected_preflight !== 'object' || def.expected_preflight === null) {
      fail('expected_preflight', 'must be an object with optional "blockers" and "warnings" arrays');
    }
    for (const level of PREFLIGHT_LEVELS) {
      const v = def.expected_preflight[`${level}s`];
      if (v !== undefined && !(Array.isArray(v) && v.every(c => typeof c === 'string'))) {
        fail(`expected_preflight.${level}s`, 'must be an array of finding codes');
      }
    }
  }

  return { bounds, pending, prior };
}

// ── Comparison ──────────────────────────────────────────────────────────────

function compare(derived, expected) {
  const rows = BOXES.map((box) => {
    const e = Number(expected[box]);
    const a = Number(derived[box]);
    return { box, label: BOX_LABELS[box], expected: e, actual: a, diff: a - e, ok: a === e };
  });
  return { ok: rows.every(r => r.ok), rows };
}

// Codes by level, not messages — messages get reworded; codes are the contract.
function comparePreflight(findings, expectedPreflight = {}) {
  const out = { ok: true, levels: {} };
  for (const level of PREFLIGHT_LEVELS) {
    const want = expectedPreflight[`${level}s`];
    if (!Array.isArray(want)) continue; // not asserted for this level
    const got = (findings || []).filter(f => f.level === level).map(f => f.code);
    const unexpected = got.filter(c => !want.includes(c));
    const missing = want.filter(c => !got.includes(c));
    out.levels[level] = { expected: want, actual: got, unexpected, missing };
    if (unexpected.length || missing.length) out.ok = false;
  }
  return out;
}

// ── Report ──────────────────────────────────────────────────────────────────

const kr = n => Number(n).toLocaleString('is-IS');

function formatReport(result) {
  const lines = [];
  const { def, meta } = result;
  lines.push(`books:replay — ${def.case} (${def.period}, ${meta.bounds.starts_on} … ${meta.bounds.ends_on})`);
  if (def.description) lines.push(`  ${def.description}`);
  lines.push('');

  if (result.comparison) {
    lines.push(`  ${'box'.padEnd(30)} ${'expected'.padStart(14)} ${'derived'.padStart(14)} ${'diff'.padStart(12)}`);
    for (const r of result.comparison.rows) {
      lines.push(`  ${r.label.padEnd(30)} ${kr(r.expected).padStart(14)} ${kr(r.actual).padStart(14)} ${kr(r.diff).padStart(12)}   ${r.ok ? 'ok' : '✗ MISMATCH'}`);
    }
  } else {
    lines.push('  no filed figures recorded ("pending") — derived figures only:');
    for (const box of BOXES) {
      lines.push(`  ${BOX_LABELS[box].padEnd(30)} ${kr(result.derived[box]).padStart(14)}`);
    }
  }
  lines.push('');

  const p = result.preflight;
  const blockers = p.findings.filter(f => f.level === 'blocker').map(f => f.code);
  const warnings = p.findings.filter(f => f.level === 'warning').map(f => f.code);
  let preflightLine = `  preflight: ${blockers.length} blocker(s)${blockers.length ? ` [${blockers.join(', ')}]` : ''}, `
    + `${warnings.length} warning(s)${warnings.length ? ` [${warnings.join(', ')}]` : ''}`;
  if (result.preflightComparison) {
    preflightLine += result.preflightComparison.ok ? ' — as expected' : ' — ✗ NOT AS EXPECTED';
    for (const [level, cmp] of Object.entries(result.preflightComparison.levels)) {
      if (cmp.unexpected.length) preflightLine += `\n    unexpected ${level}s: ${cmp.unexpected.join(', ')}`;
      if (cmp.missing.length) preflightLine += `\n    missing ${level}s: ${cmp.missing.join(', ')}`;
    }
  }
  lines.push(preflightLine);

  const tb = result.trialBalance;
  lines.push(`  trial balance: debits ${kr(tb.debit_total)} = credits ${kr(tb.credit_total)} — ${tb.balanced ? 'balanced' : `✗ OFF BY ${kr(tb.difference)}`}`);

  const c = result.counts;
  lines.push(`  applied: ${c.manual_entries} manual entr${c.manual_entries === 1 ? 'y' : 'ies'}, ${c.expenses} expense(s), `
    + `${c.pos_sales} counter sale(s), ${c.fx_rates} rate(s); documents: ${c.documents_stubbed} stubbed`);
  if (meta.prior.length) lines.push(`  prior-period items (allowed, do not count toward the return): ${meta.prior.join(', ')}`);
  lines.push('');

  const verdict = result.ok === null ? 'PENDING' : (result.ok ? 'MATCH' : 'MISMATCH');
  lines.push(`  RESULT: ${verdict}`);
  return lines.join('\n');
}

module.exports = {
  ReplayError,
  BOXES,
  BOX_LABELS,
  PREFLIGHT_LEVELS,
  assertReplayDatabase,
  replayUrlFrom,
  validateCase,
  compare,
  comparePreflight,
  formatReport,
};

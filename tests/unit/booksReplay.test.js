/**
 * The pure half of the replay benchmark (server/services/bookkeeping/replayCase.js):
 * the `_replay` database guard, case validation, and the box-by-box comparison.
 * No database — the runner is covered in tests/integration/booksReplay.test.js.
 */
const path = require('path');
const {
  ReplayError, BOXES, assertReplayDatabase, replayUrlFrom, validateCase, compare, comparePreflight, formatReport,
} = require('../../server/services/bookkeeping/replayCase');

const SYNTHETIC = require('../fixtures/replay/2017-P1-synthetic.json');

describe('assertReplayDatabase — a replay wipes its target, so the name must say so', () => {
  test('accepts a database whose name ends in _replay', () => {
    expect(assertReplayDatabase('postgresql://u:p@localhost:5432/orangesmiley_replay'))
      .toEqual({ url: 'postgresql://u:p@localhost:5432/orangesmiley_replay', dbName: 'orangesmiley_replay' });
  });

  test.each([
    'postgresql://u:p@localhost:5432/orangesmiley',
    'postgresql://u:p@localhost:5432/orangesmiley_books',
    'postgresql://u:p@localhost:5432/orangesmiley_test',
    'postgresql://u:p@localhost:5432/orangesmiley_replay_prod',
    'postgresql://u:p@localhost:5432/',
    'not a url',
  ])('refuses %s', (url) => {
    expect(() => assertReplayDatabase(url)).toThrow(ReplayError);
  });

  test('replayUrlFrom derives a _replay sibling and never returns the input database', () => {
    expect(replayUrlFrom('postgresql://u:p@localhost:5432/orangesmiley'))
      .toBe('postgresql://u:p@localhost:5432/orangesmiley_replay');
    expect(replayUrlFrom('postgresql://u:p@localhost:5432/orangesmiley_books'))
      .toBe('postgresql://u:p@localhost:5432/orangesmiley_books_replay');
    // Idempotent: already a replay target stays that target.
    expect(replayUrlFrom('postgresql://u:p@localhost:5432/x_replay'))
      .toBe('postgresql://u:p@localhost:5432/x_replay');
  });
});

describe('validateCase', () => {
  const good = () => JSON.parse(JSON.stringify(SYNTHETIC));

  test('the committed synthetic fixture is well-formed and claims 2017', () => {
    const meta = validateCase(good());
    expect(meta.pending).toBe(false);
    expect(meta.bounds).toMatchObject({ starts_on: '2017-01-01', ends_on: '2017-02-28' });
    expect(meta.prior).toEqual([]);
  });

  test('a non-pending case must record every box, as whole krónur', () => {
    const c = good();
    delete c.expected;
    expect(() => validateCase(c)).toThrow(/expected: missing/);
    const d = good();
    d.expected.box_e_input = 2880.5;
    expect(() => validateCase(d)).toThrow(/expected\.box_e_input/);
  });

  test('the form arithmetic is checked: F = D − E and D = domestic + reverse charge', () => {
    const c = good();
    c.expected.box_f_payable += 1;
    expect(() => validateCase(c)).toThrow(/box_f_payable: must equal/);
    const d = good();
    d.expected.output_vat_domestic += 1;
    expect(() => validateCase(d)).toThrow(/box_d_output: must equal/);
  });

  test('a pending case needs no expected block', () => {
    const c = good();
    delete c.expected;
    c.pending = true;
    expect(validateCase(c).pending).toBe(true);
  });

  test('an invalid period is refused', () => {
    const c = good();
    c.period = '2017-P7';
    expect(() => validateCase(c)).toThrow(/period/);
  });

  test('anything dated AFTER the period is refused — it would silently not count', () => {
    const c = good();
    c.expenses[0].expense_date = '2017-03-01';
    expect(() => validateCase(c)).toThrow(/expenses\[0\]\.expense_date: is after the period ends \(2017-02-28\)/);
  });

  test('anything dated BEFORE the period is allowed and reported as prior', () => {
    const c = good();
    c.manual_entries[0].entry_date = '2016-12-31';
    expect(validateCase(c).prior).toEqual(['manual_entries[0].entry_date']);
  });

  test('expected_preflight must be arrays of codes', () => {
    const c = good();
    c.expected_preflight = { blockers: 'UNSUBSTANTIATED_INPUT_VAT' };
    expect(() => validateCase(c)).toThrow(/expected_preflight\.blockers/);
  });
});

describe('compare — box by box, D split included', () => {
  test('identical figures match on every row', () => {
    const r = compare(SYNTHETIC.expected, SYNTHETIC.expected);
    expect(r.ok).toBe(true);
    expect(r.rows.map(x => x.box)).toEqual(BOXES);
  });

  test('one króna in one box is a mismatch naming that box', () => {
    const derived = { ...SYNTHETIC.expected, box_e_input: SYNTHETIC.expected.box_e_input + 1 };
    const r = compare(derived, SYNTHETIC.expected);
    expect(r.ok).toBe(false);
    expect(r.rows.filter(x => !x.ok)).toEqual([
      expect.objectContaining({ box: 'box_e_input', diff: 1 }),
    ]);
  });

  test('a reverse-charge error that leaves F unchanged is still caught by the D split', () => {
    // D and E both up by 480 → F identical. A totals-only benchmark would pass this.
    const derived = {
      ...SYNTHETIC.expected,
      box_d_output: SYNTHETIC.expected.box_d_output + 480,
      output_vat_reverse_charge: SYNTHETIC.expected.output_vat_reverse_charge + 480,
      box_e_input: SYNTHETIC.expected.box_e_input + 480,
    };
    const r = compare(derived, SYNTHETIC.expected);
    expect(r.ok).toBe(false);
    expect(r.rows.find(x => x.box === 'box_f_payable').ok).toBe(true);
    expect(r.rows.find(x => x.box === 'output_vat_reverse_charge').ok).toBe(false);
  });
});

describe('comparePreflight — codes by level, info never asserted', () => {
  const findings = [
    { level: 'blocker', code: 'UNSUBSTANTIATED_INPUT_VAT' },
    { level: 'warning', code: 'NIL_RETURN' },
    { level: 'info', code: 'DEADLINE' },
  ];

  test('unexpected and missing codes are both reported', () => {
    const r = comparePreflight(findings, { blockers: [], warnings: ['NIL_RETURN', 'SUSPENSE_NOT_EMPTY'] });
    expect(r.ok).toBe(false);
    expect(r.levels.blocker.unexpected).toEqual(['UNSUBSTANTIATED_INPUT_VAT']);
    expect(r.levels.warning.missing).toEqual(['SUSPENSE_NOT_EMPTY']);
  });

  test('a level that is not asserted is ignored, and info never counts', () => {
    const r = comparePreflight(findings, { warnings: ['NIL_RETURN'] });
    expect(r.ok).toBe(true);
    expect(r.levels.blocker).toBeUndefined();
  });
});

describe('formatReport', () => {
  test('renders a match, a mismatch and a pending case legibly', () => {
    const meta = validateCase(SYNTHETIC);
    const base = {
      def: SYNTHETIC, meta,
      derived: SYNTHETIC.expected,
      preflight: { findings: [{ level: 'info', code: 'DEADLINE' }] },
      trialBalance: { debit_total: 1000, credit_total: 1000, balanced: true, difference: 0 },
      preflightComparison: comparePreflight([], SYNTHETIC.expected_preflight),
      counts: { settings: 4, fx_rates: 1, manual_entries: 1, expenses: 2, pos_sales: 1, documents_stubbed: 2 },
    };
    const match = formatReport({ ...base, comparison: compare(SYNTHETIC.expected, SYNTHETIC.expected), ok: true });
    expect(match).toContain('RESULT: MATCH');
    expect(match).toContain('reverse charge');
    expect(match).toContain('documents: 2 stubbed');

    const wrong = { ...SYNTHETIC.expected, box_e_input: 1 };
    const mismatch = formatReport({ ...base, derived: wrong, comparison: compare(wrong, SYNTHETIC.expected), ok: false });
    expect(mismatch).toContain('RESULT: MISMATCH');
    expect(mismatch).toContain('✗ MISMATCH');

    const pendingDef = { ...SYNTHETIC, pending: true };
    const pending = formatReport({ ...base, def: pendingDef, meta: validateCase(pendingDef), comparison: null, ok: null });
    expect(pending).toContain('RESULT: PENDING');
    expect(pending).toContain('derived figures only');
  });

  test('the committed company case is pending and well-formed', () => {
    const company = require(path.join('..', '..', 'server', 'fixtures', 'books-replay', '2026-P4-orangesmiley.json'));
    const meta = validateCase(company);
    expect(meta.pending).toBe(true);
    expect(meta.bounds.ends_on).toBe('2026-08-31');
  });
});

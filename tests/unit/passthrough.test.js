/**
 * The pass-through arithmetic (D-022) has two copies: the server's
 * invoiceService.computePassthrough, which the invoice is built from, and the
 * admin preview's public/js/utils/passthrough.js. This pins both to the same
 * answers, and pins the terms to the product seam (billing.passthrough in the
 * client config), never a literal in engine code.
 * babel-jest compiles the ESM module to CJS for require() (see money.client.test.js).
 */
const { previewPassthrough } = require('../../public/js/utils/passthrough.js');
const {
  computePassthrough, passthroughTerms, COMMISSIONABLE_KINDS, SERVICE_KINDS, InvoiceError,
} = require('../../server/services/bookkeeping/invoiceService');
const { resolveConfig, defaults, clientConfig } = require('../../server/config/clientConfig');

const TERMS = { markupBp: 1500, aiAllowanceIsk: 2000 };
const server = (lines, terms = TERMS) => computePassthrough({
  lines: lines.map(([type, costIsk]) => ({ type, description: 'x', costIsk })), ...terms,
});
const client = (lines, terms = TERMS) => previewPassthrough(
  lines.map(([type, cost]) => ({ type, description: 'x', cost: String(cost) })),
  { markup_bp: terms.markupBp, ai_allowance_isk: terms.aiAllowanceIsk, vat_rate: 24 },
);

describe('computePassthrough', () => {
  test('cost + 15 % per line; the AI allowance off the AI total, never below zero', () => {
    const r = server([['hosting', 10000], ['ai', 3500]]);
    expect(r.lines.map(l => l.netIsk)).toEqual([11500, 1725]);
    expect(r.lines[1]).toMatchObject({ costIsk: 3500, allowanceIsk: 2000, billableIsk: 1500 });
    expect(r).toMatchObject({ netTotal: 13225, aiCostIsk: 3500, aiAllowanceUsedIsk: 2000, markupBp: 1500 });
  });

  test('the allowance is spread over AI lines in order and hosting never touches it', () => {
    const r = server([['ai', 800], ['hosting', 100], ['ai', 800], ['ai', 800]]);
    expect(r.lines.map(l => l.allowanceIsk)).toEqual([800, 0, 800, 400]);
    expect(r.lines.map(l => l.netIsk)).toEqual([0, 115, 0, 460]);
    expect(r.aiAllowanceUsedIsk).toBe(2000);
  });

  test('AI under the allowance uses only what it costs', () => {
    const r = server([['ai', 1200]]);
    expect(r).toMatchObject({ netTotal: 0, aiAllowanceUsedIsk: 1200 });
  });

  test('Math.round per line: .5 rounds up, below .5 down', () => {
    expect(server([['hosting', 10]]).lines[0].netIsk).toBe(12);   // 11.5
    expect(server([['hosting', 7]]).lines[0].netIsk).toBe(8);     // 8.05
    expect(server([['hosting', 1234]]).lines[0].netIsk).toBe(1419); // 1419.1
  });

  test('other terms are honoured (a product with its own values)', () => {
    const r = server([['hosting', 1000], ['ai', 1000]], { markupBp: 1000, aiAllowanceIsk: 0 });
    expect(r.lines.map(l => l.netIsk)).toEqual([1100, 1100]);
  });

  test.each([
    ['no lines', []],
    ['an unknown type', [{ type: 'email', description: 'x', costIsk: 1 }]],
    ['a blank description', [{ type: 'ai', description: ' ', costIsk: 1 }]],
    ['a zero cost', [{ type: 'ai', description: 'x', costIsk: 0 }]],
    ['a fractional cost', [{ type: 'ai', description: 'x', costIsk: 1.5 }]],
    ['21 lines', Array.from({ length: 21 }, () => ({ type: 'ai', description: 'x', costIsk: 1 }))],
  ])('refuses %s with a 400', (_n, lines) => {
    let err;
    try { computePassthrough({ lines, ...TERMS }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(InvoiceError);
    expect(err.status).toBe(400);
  });

  test('missing terms are a 500, not a silent 0 % markup', () => {
    expect(() => computePassthrough({ lines: [{ type: 'ai', description: 'x', costIsk: 1 }], markupBp: NaN, aiAllowanceIsk: 2000 }))
      .toThrow(/markupBp/);
  });
});

describe('the preview agrees with the server', () => {
  const cases = [
    [['hosting', 10000], ['ai', 3500]],
    [['ai', 800], ['hosting', 100], ['ai', 800], ['ai', 800]],
    [['hosting', 1234], ['hosting', 10], ['hosting', 7]],
    [['ai', 1999]],
    [['ai', 123457], ['hosting', 98765]],
  ];
  test.each(cases.map(c => [JSON.stringify(c), c]))('%s', (_n, lines) => {
    const s = server(lines);
    const c = client(lines);
    expect(c.lines.map(l => l.net)).toEqual(s.lines.map(l => l.netIsk));
    expect(c.lines.map(l => l.included)).toEqual(s.lines.map(l => l.allowanceIsk));
    expect(c.net).toBe(s.netTotal);
    expect(c.vat).toBe(Math.round(s.netTotal * 24 / 100));
    expect(c.gross).toBe(c.net + c.vat);
  });

  test('a row without a valid cost is shown but not counted', () => {
    const c = previewPassthrough(
      [{ type: 'hosting', description: 'a', cost: '' }, { type: 'ai', description: 'b', cost: '3000' }],
      { markup_bp: 1500, ai_allowance_isk: 2000, vat_rate: 24 },
    );
    expect(c.lines[0].valid).toBe(false);
    expect(c.net).toBe(1150);
  });
});

describe('the terms come from the product seam', () => {
  test('schema defaults are D-022: 15 % markup, 2.000 kr. AI allowance', () => {
    expect(defaults().billing.passthrough).toEqual({ markupBp: 1500, aiAllowanceIsk: 2000 });
  });

  test('the running instance reads them from the resolved config', () => {
    expect(passthroughTerms()).toEqual({ ...clientConfig.billing.passthrough });
  });

  test('a product overrides them in its file or by env, and a bad value is refused', () => {
    const file = { billing: { passthrough: { markupBp: 2000 } } };
    const env = { CLIENT_CONFIG_BILLING_PASSTHROUGH_AI_ALLOWANCE_ISK: '5000' };
    const { config, warnings } = resolveConfig({ fileConfig: file, env });
    expect(config.billing.passthrough).toEqual({ markupBp: 2000, aiAllowanceIsk: 5000 });
    expect(warnings).toEqual([]);
    const bad = resolveConfig({ fileConfig: { billing: { passthrough: { markupBp: -1 } } }, env: {} });
    expect(bad.config.billing.passthrough.markupBp).toBe(1500);
    expect(bad.warnings.length).toBe(1);
  });
});

describe('commission is an allow-list', () => {
  test('only build and recurring pay a seller (D-003); passthrough and overage never', () => {
    expect(COMMISSIONABLE_KINDS).toEqual(['build', 'recurring']);
    expect(SERVICE_KINDS).toContain('passthrough');
    expect(COMMISSIONABLE_KINDS).not.toContain('passthrough');
    expect(COMMISSIONABLE_KINDS).not.toContain('overage');
  });
});

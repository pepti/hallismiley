/**
 * The pure half of the intake queue (server/services/bookkeeping/intakeShape.js).
 * No database — the gate itself is proven in tests/integration/booksIntake.test.js.
 */
const {
  SOURCE_KINDS, dedupeHash, expenseInputFromOperator, denormalise,
} = require('../../server/services/bookkeeping/intakeShape');

describe('dedupeHash — one pending row per identical delivery', () => {
  const checksum = 'a'.repeat(64);

  test('stable for the same channel, bytes and reference', () => {
    expect(dedupeHash({ sourceKind: 'peppol', checksum, sourceRef: 'msg-1' }))
      .toBe(dedupeHash({ sourceKind: 'peppol', checksum, sourceRef: 'msg-1' }));
  });

  test('differs when any of the three differs', () => {
    const base = dedupeHash({ sourceKind: 'manual', checksum });
    expect(dedupeHash({ sourceKind: 'extracted', checksum })).not.toBe(base);
    expect(dedupeHash({ sourceKind: 'manual', checksum: 'b'.repeat(64) })).not.toBe(base);
    expect(dedupeHash({ sourceKind: 'manual', checksum, sourceRef: 'x' })).not.toBe(base);
  });

  test('a missing reference and an empty reference hash the same', () => {
    expect(dedupeHash({ sourceKind: 'manual', checksum })).toBe(dedupeHash({ sourceKind: 'manual', checksum, sourceRef: '' }));
  });

  test('refuses an unknown rung of the ladder or a missing checksum', () => {
    expect(() => dedupeHash({ sourceKind: 'ocr', checksum })).toThrow(TypeError);
    expect(() => dedupeHash({ sourceKind: 'manual', checksum: '' })).toThrow(TypeError);
    expect(SOURCE_KINDS).toEqual(['peppol', 'embedded_xml', 'extracted', 'manual']);
  });
});

describe('expenseInputFromOperator — the suggestion is never what gets posted', () => {
  const intake = {
    id: 'i1', document_id: 'doc-1',
    suggested: { supplier_name: 'Machine Read Ltd', amount_gross: 999999, vat_code: 'input_24' },
  };

  test('takes the operator body, forces the intake document and the accepting person', () => {
    const out = expenseInputFromOperator(
      { supplierName: 'Cloud Vendor', amountGross: 2000, documentId: 'someone-elses-doc', createdBy: 'spoof' },
      intake, { createdBy: 'halli', requestId: 'r1' }
    );
    expect(out).toEqual({ supplierName: 'Cloud Vendor', amountGross: 2000, documentId: 'doc-1', createdBy: 'halli', requestId: 'r1' });
  });

  test('a suggested amount that the operator did not submit does not appear', () => {
    const out = expenseInputFromOperator({ supplierName: 'X', amountGross: 100 }, intake, { createdBy: 'halli' });
    expect(out.amountGross).toBe(100);
    expect(JSON.stringify(out)).not.toContain('999999');
  });

  test('refuses without a person or without a document', () => {
    expect(() => expenseInputFromOperator({}, intake, {})).toThrow(TypeError);
    expect(() => expenseInputFromOperator({}, { id: 'i2' }, { createdBy: 'halli' })).toThrow(TypeError);
  });
});

describe('denormalise — the four columns the queue sorts on', () => {
  test('lifts what parses and nulls what does not', () => {
    expect(denormalise({
      supplier_name: '  Azure  ', supplier_invoice_no: 'INV-1', expense_date: '2026-08-14', amount_gross: '2000', currency: 'usd',
    })).toEqual({
      supplier_name: 'Azure', supplier_kennitala: null, supplier_invoice_no: 'INV-1',
      document_date: '2026-08-14', amount_gross: 2000, currency: 'usd',
    });
    expect(denormalise({ expense_date: '14.08.2026', amount_gross: -5 })).toMatchObject({ document_date: null, amount_gross: null, currency: 'ISK' });
    expect(denormalise(null)).toMatchObject({ supplier_name: null, currency: 'ISK' });
  });
});

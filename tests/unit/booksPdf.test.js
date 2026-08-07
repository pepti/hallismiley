// Invoice-PDF helpers.
//
// The HTTP test asserts the response is a PDF, which proves the plumbing but says
// nothing about what the document says. These pin the formatting that appears on a
// statutory document — the earlier audit of the module this replaces flagged exactly
// this gap, where a hardcoded "VSK 24%" label sat on every invoice regardless of the
// actual rates and no test could see it.
const { isk, kennitalaDisplay, drawInvoice } = require('../../server/services/bookkeepingPdf');

describe('isk', () => {
  it('formats with Icelandic thousands separators and the króna suffix', () => {
    expect(isk(1234567)).toBe('1.234.567 kr.');
    expect(isk(12400)).toBe('12.400 kr.');
    expect(isk(999)).toBe('999 kr.');
    expect(isk(0)).toBe('0 kr.');
  });

  it('keeps the sign in front of the digits', () => {
    expect(isk(-12400)).toBe('-12.400 kr.');
  });

  it('rounds to whole krónur, because ISK has no subunit', () => {
    expect(isk(100.4)).toBe('100 kr.');
    expect(isk(100.6)).toBe('101 kr.');
  });

  it('treats absent input as zero rather than printing NaN on a document', () => {
    expect(isk(null)).toBe('0 kr.');
    expect(isk(undefined)).toBe('0 kr.');
  });
});

describe('kennitalaDisplay', () => {
  it('formats a 10-digit kennitala as DDMMYY-NNNN', () => {
    expect(kennitalaDisplay('1203894599')).toBe('120389-4599');
  });

  it('strips a dash that is already there rather than doubling it', () => {
    expect(kennitalaDisplay('120389-4599')).toBe('120389-4599');
  });

  it('passes through anything that is not ten digits, instead of mangling it', () => {
    expect(kennitalaDisplay('12345')).toBe('12345');
    expect(kennitalaDisplay('')).toBe('');
    expect(kennitalaDisplay(null)).toBe('');
  });
});

describe('drawInvoice', () => {
  // A minimal pdfkit stand-in that records the text drawn, so the assertions are
  // about document CONTENT rather than about bytes. Chainable, because the drawing
  // code chains .text().text().
  function fakeDoc() {
    const drawn = [];
    const doc = {
      page: { width: 595 },
      y: 0,
      drawn,
      font() { return doc; },
      fontSize() { return doc; },
      fillColor() { return doc; },
      strokeColor() { return doc; },
      lineWidth() { return doc; },
      moveTo() { return doc; },
      lineTo() { return doc; },
      stroke() { return doc; },
      addPage() { doc.y = 0; return doc; },
      heightOfString() { return 10; },
      text(str) { drawn.push(String(str)); doc.y += 12; return doc; },
    };
    return doc;
  }

  const baseInvoice = (over = {}) => ({
    series: 'invoice',
    invoice_number: 1001,
    seller_name: 'Halli Smiley ehf.',
    seller_kennitala: '1203894599',
    seller_vat_number: '123456',
    seller_address: 'Dæmigata 1\n101 Reykjavík',
    customer_name: 'Jón Jónsson',
    customer_address: 'Bæjargata 5\n101 Reykjavík',
    customer_email: 'jon@example.is',
    issued_at: '2026-07-15',
    due_at: '2026-07-29',
    subtotal_net: 10000,
    vat_total: 2400,
    total_gross: 12400,
    discount_total: 0,
    amount_paid: 0,
    amount_credited: 0,
    amount_refunded: 0,
    outstanding: 12400,
    original_currency: 'ISK',
    note: 'Þessi reikningur er rafrænt ytra frumgagn.',
    lines: [{
      description: 'Eikarborð', sku: 'SKU-OAK-1', quantity: 1,
      unit_price_gross: 12400, vat_rate: 24, discount_gross: 0, line_gross: 12400,
    }],
    vat_by_rate: [{ rate: 24, net: 10000, vat: 2400, gross: 12400 }],
    ...over,
  });

  const render = (inv) => {
    const doc = fakeDoc();
    drawInvoice(doc, inv);
    return doc.drawn.join('\n');
  };

  it('prints the statutory seller and buyer identification', () => {
    const out = render(baseInvoice());
    expect(out).toContain('Halli Smiley ehf.');
    expect(out).toContain('Kt. 120389-4599');       // formatted, not raw digits
    expect(out).toContain('VSK-nr. 123456');
    expect(out).toContain('Jón Jónsson');
    expect(out).toContain('2026-07-15');            // issue date
    expect(out).toContain('Nr. 1001');
  });

  it('states VAT PER RATE, not as one aggregate figure', () => {
    // The whole point of tracking rates per line. A mixed-rate document with a
    // single "VSK" total is not a valid Icelandic invoice.
    const out = render(baseInvoice({
      subtotal_net: 20000,
      vat_total: 3500,
      total_gross: 23500,
      outstanding: 23500,
      lines: [
        { description: 'Eikarborð', quantity: 1, unit_price_gross: 12400, vat_rate: 24, discount_gross: 0, line_gross: 12400 },
        { description: 'Bók', quantity: 1, unit_price_gross: 11100, vat_rate: 11, discount_gross: 0, line_gross: 11100 },
      ],
      vat_by_rate: [
        { rate: 11, net: 10000, vat: 1100, gross: 11100 },
        { rate: 24, net: 10000, vat: 2400, gross: 12400 },
      ],
    }));
    expect(out).toContain('VSK 11%');
    expect(out).toContain('VSK 24%');
    expect(out).toContain('1.100 kr.');
    expect(out).toContain('2.400 kr.');
  });

  it('labels zero-rated turnover as such rather than as 0 VAT', () => {
    const out = render(baseInvoice({
      subtotal_net: 12400, vat_total: 0,
      vat_by_rate: [{ rate: 0, net: 12400, vat: 0, gross: 12400 }],
      zero_rate_reason: 'Útflutningur — sala til útlanda, 0% VSK.',
    }));
    expect(out).toContain('Núllskattlagt');
    expect(out).toContain('Útflutningur');
  });

  it('carries the electronic-document annotation Reglugerð 505/2013 requires', () => {
    expect(render(baseInvoice())).toContain('rafrænt ytra frumgagn');
  });

  it('states that VAT is included in the total', () => {
    expect(render(baseInvoice())).toContain('Virðisaukaskattur er innifalinn');
  });

  it('shows an allocated discount on its own sub-line', () => {
    const out = render(baseInvoice({
      discount_total: 1240,
      total_gross: 11160,
      outstanding: 11160,
      lines: [{
        description: 'Eikarborð', quantity: 1, unit_price_gross: 12400,
        vat_rate: 24, discount_gross: 1240, line_gross: 11160,
      }],
    }));
    // The quoted price stays visible AND the discount is stated, so the arithmetic
    // on the page is followable.
    expect(out).toContain('12.400 kr.');
    expect(out).toContain('Afsláttur: -1.240 kr.');
  });

  it('stamps GREITT only when money was actually received', () => {
    // An invoice settled entirely by credit note owes nothing but was never paid;
    // calling it paid would misrepresent the document.
    const paid = render(baseInvoice({ amount_paid: 12400, outstanding: 0 }));
    expect(paid).toContain('GREITT');

    const credited = render(baseInvoice({ amount_credited: 12400, outstanding: 0 }));
    expect(credited).not.toContain('GREITT');

    const refunded = render(baseInvoice({
      amount_paid: 12400, amount_refunded: 12400, amount_credited: 12400, outstanding: 0,
    }));
    expect(refunded).not.toContain('GREITT');
  });

  it('notes the original currency and rate on a translated invoice', () => {
    const out = render(baseInvoice({
      original_currency: 'EUR', original_total_gross: 8900, fx_rate: 150,
    }));
    expect(out).toContain('EUR');
    expect(out).toContain('150');
  });

  it('titles a receipt differently and omits the due date', () => {
    const out = render(baseInvoice({ series: 'receipt', amount_paid: 12400, outstanding: 0 }));
    expect(out).toContain('KVITTUN');
    expect(out).not.toContain('Gjalddagi');
  });

  it('caps a pathologically long address instead of walking over the totals', () => {
    const out = render(baseInvoice({
      customer_address: Array.from({ length: 50 }, (_, i) => `Line ${i}`).join('\n'),
    }));
    expect(out).toContain('Line 5');
    expect(out).not.toContain('Line 20');
    // The totals still made it onto the page.
    expect(out).toContain('Samtals með VSK');
  });
});

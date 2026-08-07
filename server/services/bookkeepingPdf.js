// Invoice and receipt PDFs (pdfkit), streamed straight into the HTTP response.
//
// The layout is driven by what Reglugerð 50/1993 requires an Icelandic sales
// invoice to show, not by aesthetics:
//   seller name + kennitala + VSK number · buyer name · issue date · per-line
//   quantity and unit price · VAT stated explicitly AND separated by rate ·
//   the total, with whether VAT is included stated plainly.
// Plus the electronic-system annotation ("rafrænt ytra frumgagn") that replaces the
// old pre-numbered-stationery rule.
//
// Everything printed comes from the INVOICE ROW, never from live settings — the
// seller block was snapshotted at issue precisely so that reprinting an old
// invoice years later reproduces the document as issued.
//
// Standard Helvetica uses WinAnsi encoding, which covers Icelandic (ð þ æ ö á í),
// so no font embedding is needed — same approach as server/services/pdfService.js.

const PDFDocument = require('pdfkit');

const MARGIN = 50;
const INK = '#111111';
const MUTED = '#555555';
const RULE = '#bbbbbb';
const PAGE_BOTTOM = 780;

// ISK has no subunit and is conventionally written with a thousands separator and
// " kr." — 1.234.567 kr.
function isk(amount) {
  const n = Math.round(Number(amount) || 0);
  const sign = n < 0 ? '-' : '';
  const digits = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${digits} kr.`;
}

function qty(value) {
  const n = Number(value) || 0;
  // Whole numbers print without decimals; fractional quantities (hours) keep them.
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function kennitalaDisplay(digits) {
  const d = String(digits || '').replace(/\D/g, '');
  return d.length === 10 ? `${d.slice(0, 6)}-${d.slice(6)}` : d;
}

function splitLines(text) {
  return String(text || '').split('\n').map(s => s.trim()).filter(Boolean);
}

/**
 * Draw one invoice onto the current page.
 * @param {PDFDocument} doc
 * @param {object} invoice  an Invoice.findDetail() result (header + lines + vat_by_rate)
 */
function drawInvoice(doc, invoice) {
  const isReceipt = invoice.series === 'receipt';
  const rightEdge = doc.page.width - MARGIN;
  let y = MARGIN;

  // ── Header: seller block (left), document identity (right) ──────────────────
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(18)
    .text(invoice.seller_name || '', MARGIN, y);
  y = doc.y + 2;
  doc.font('Helvetica').fontSize(9).fillColor(MUTED);
  const sellerMeta = [
    invoice.seller_kennitala ? `Kt. ${kennitalaDisplay(invoice.seller_kennitala)}` : null,
    invoice.seller_vat_number ? `VSK-nr. ${invoice.seller_vat_number}` : null,
  ].filter(Boolean).join(' · ');
  if (sellerMeta) { doc.text(sellerMeta, MARGIN, y); y = doc.y; }
  for (const line of splitLines(invoice.seller_address)) {
    doc.text(line, MARGIN, y); y = doc.y;
  }

  // Document title and number, right-aligned.
  doc.font('Helvetica-Bold').fontSize(16).fillColor(INK)
    .text(isReceipt ? 'KVITTUN' : 'REIKNINGUR', MARGIN, MARGIN, { width: rightEdge - MARGIN, align: 'right' });
  doc.font('Helvetica').fontSize(10).fillColor(MUTED)
    .text(`Nr. ${invoice.invoice_number}`, MARGIN, MARGIN + 20, { width: rightEdge - MARGIN, align: 'right' })
    .text(`Dagsetning: ${invoice.issued_at}`, MARGIN, MARGIN + 34, { width: rightEdge - MARGIN, align: 'right' });
  if (!isReceipt) {
    doc.text(`Gjalddagi: ${invoice.due_at}`, MARGIN, MARGIN + 48, { width: rightEdge - MARGIN, align: 'right' });
  }

  y = Math.max(y, MARGIN + 66) + 16;

  // ── Bill-to ────────────────────────────────────────────────────────────────
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text('Viðtakandi', MARGIN, y);
  y = doc.y + 2;
  doc.font('Helvetica').fontSize(10).fillColor(INK).text(invoice.customer_name || '', MARGIN, y);
  y = doc.y;
  doc.fontSize(9).fillColor(MUTED);
  if (invoice.customer_kennitala) {
    doc.text(`Kt. ${kennitalaDisplay(invoice.customer_kennitala)}`, MARGIN, y); y = doc.y;
  }
  // Cap the address: an unbounded address would otherwise walk over the totals.
  for (const line of splitLines(invoice.customer_address).slice(0, 6)) {
    doc.text(line, MARGIN, y); y = doc.y;
  }
  if (invoice.customer_email) { doc.text(invoice.customer_email, MARGIN, y); y = doc.y; }

  y += 18;

  // ── Line table ─────────────────────────────────────────────────────────────
  const COL = {
    desc: MARGIN,
    qty: 300,
    unit: 340,
    vat: 415,
    total: 460,
  };
  const colWidths = {
    desc: COL.qty - COL.desc - 8,
    qty: COL.unit - COL.qty - 6,
    unit: COL.vat - COL.unit - 6,
    vat: COL.total - COL.vat - 6,
    total: rightEdge - COL.total,
  };

  const drawHead = () => {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED);
    doc.text('Lýsing', COL.desc, y, { width: colWidths.desc });
    doc.text('Magn', COL.qty, y, { width: colWidths.qty, align: 'right' });
    doc.text('Verð', COL.unit, y, { width: colWidths.unit, align: 'right' });
    doc.text('VSK', COL.vat, y, { width: colWidths.vat, align: 'right' });
    doc.text('Samtals', COL.total, y, { width: colWidths.total, align: 'right' });
    y = doc.y + 4;
    doc.moveTo(MARGIN, y).lineTo(rightEdge, y).strokeColor(RULE).lineWidth(0.5).stroke();
    y += 6;
  };
  drawHead();

  doc.font('Helvetica').fontSize(9).fillColor(INK);
  for (const line of invoice.lines || []) {
    const label = line.sku ? `${line.description}  (${line.sku})` : line.description;
    // Measure before drawing so a long description cannot silently overlap the
    // next row — pdfkit will not wrap-and-advance for us across columns.
    const height = doc.heightOfString(label, { width: colWidths.desc });
    if (y + height + 14 > PAGE_BOTTOM) {
      doc.addPage();
      y = MARGIN;
      drawHead();
      doc.font('Helvetica').fontSize(9).fillColor(INK);
    }
    const rowTop = y;
    doc.text(label, COL.desc, rowTop, { width: colWidths.desc });
    const afterDesc = doc.y;
    doc.text(qty(line.quantity), COL.qty, rowTop, { width: colWidths.qty, align: 'right' });
    doc.text(isk(line.unit_price_gross), COL.unit, rowTop, { width: colWidths.unit, align: 'right' });
    doc.text(`${line.vat_rate}%`, COL.vat, rowTop, { width: colWidths.vat, align: 'right' });
    doc.text(isk(line.line_gross), COL.total, rowTop, { width: colWidths.total, align: 'right' });
    y = Math.max(afterDesc, rowTop + 11);

    // An allocated discount is shown on its own sub-line, so the customer sees the
    // price they were quoted AND what was taken off it.
    if (line.discount_gross > 0) {
      doc.fillColor(MUTED).fontSize(8)
        .text(`Afsláttur: -${isk(line.discount_gross)}`, COL.desc + 10, y, { width: colWidths.desc });
      y = doc.y;
      doc.fillColor(INK).fontSize(9);
    }
    y += 3;
  }

  y += 4;
  doc.moveTo(MARGIN, y).lineTo(rightEdge, y).strokeColor(RULE).lineWidth(0.5).stroke();
  y += 8;

  // ── Totals, with VAT separated by rate ─────────────────────────────────────
  const totalRow = (label, value, { bold = false, size = 10 } = {}) => {
    if (y + 16 > PAGE_BOTTOM) { doc.addPage(); y = MARGIN; }
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(bold ? INK : MUTED);
    doc.text(label, COL.unit - 120, y, { width: 220, align: 'right' });
    doc.text(value, COL.total, y, { width: colWidths.total, align: 'right' });
    y += size + 5;
  };

  if (invoice.discount_total > 0) {
    totalRow('Afsláttur samtals', `-${isk(invoice.discount_total)}`);
  }
  totalRow('Samtals án VSK', isk(invoice.subtotal_net));
  // Per rate, as the regulation requires — one aggregate VAT figure is not enough
  // on a mixed-rate document.
  for (const bucket of invoice.vat_by_rate || []) {
    if (bucket.rate === 0) {
      totalRow('Núllskattlagt (0% VSK)', isk(bucket.net));
    } else {
      totalRow(`VSK ${bucket.rate}%`, isk(bucket.vat));
    }
  }
  totalRow('Samtals með VSK', isk(invoice.total_gross), { bold: true, size: 12 });

  if (invoice.amount_credited > 0) totalRow('Kreditnóta', `-${isk(invoice.amount_credited)}`);
  if (invoice.amount_paid > 0) totalRow('Greitt', `-${isk(invoice.amount_paid)}`);
  if (invoice.amount_refunded > 0) totalRow('Endurgreitt', isk(invoice.amount_refunded));
  const outstanding = Number(invoice.outstanding ?? 0);
  if (!isReceipt && outstanding > 0) {
    totalRow('Ógreitt', isk(outstanding), { bold: true });
  }
  // "GREITT" means money was actually received — not merely that nothing is owed.
  // An invoice settled entirely by credit note owes nothing and was never paid,
  // and stamping it paid would misrepresent the document.
  const netPaid = Number(invoice.amount_paid || 0) - Number(invoice.amount_refunded || 0);
  if (netPaid > 0 && outstanding <= 0) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK)
      .text('GREITT', COL.total, y, { width: colWidths.total, align: 'right' });
    y = doc.y + 6;
  }

  y += 10;

  // ── Footer: statutory annotations ──────────────────────────────────────────
  if (y + 60 > PAGE_BOTTOM) { doc.addPage(); y = MARGIN; }
  doc.font('Helvetica').fontSize(8).fillColor(MUTED);
  doc.text('Virðisaukaskattur er innifalinn í heildarfjárhæð.', MARGIN, y, { width: rightEdge - MARGIN });
  y = doc.y + 2;
  if (invoice.zero_rate_reason) {
    doc.text(invoice.zero_rate_reason, MARGIN, y, { width: rightEdge - MARGIN });
    y = doc.y + 2;
  }
  if (invoice.original_currency && invoice.original_currency !== 'ISK') {
    doc.text(
      `Upphafleg fjárhæð: ${invoice.original_total_gross / 100} ${invoice.original_currency} `
      + `· umreiknað á gengi ${invoice.fx_rate} kr./${invoice.original_currency}.`,
      MARGIN, y, { width: rightEdge - MARGIN }
    );
    y = doc.y + 2;
  }
  // Reglugerð 505/2013: an invoice printed in a single copy from an electronic
  // system must say so, in place of pre-numbered stationery.
  if (invoice.note) {
    doc.text(invoice.note, MARGIN, y, { width: rightEdge - MARGIN });
  }
}

/**
 * Stream one invoice as a complete PDF into `res`.
 *
 * Once piping starts the response headers are gone, so nothing here may try to
 * send an error status. A client that aborts mid-download otherwise leaves an
 * unhandled stream 'error' event, and a throw inside drawInvoice would reach an
 * error handler that calls res.status() on an already-committed response.
 */
function streamInvoice(res, { invoice }) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN });
  doc.on('error', () => { try { res.destroy(); } catch { /* already gone */ } });
  res.on('close', () => doc.destroy());
  doc.pipe(res);
  try {
    drawInvoice(doc, invoice);
    doc.end();
  } catch (err) {
    doc.destroy();
    res.destroy();
    throw err;
  }
}

// ── Payslip (launaseðill) ────────────────────────────────────────────────────
//
// An employee is entitled to a statement showing what they earned, what was deducted
// and why. This one is built to be READ rather than filed: the deductions are named,
// the tax bands that produced the withholding are shown with the rate and the slice
// they applied to, and the employer's own contributions are printed in a separate block
// so nobody mistakes them for money taken off the employee — which is the single most
// common misreading of an Icelandic payslip.
//
// Every figure comes from the PAYSLIP ROW, never from live rates or the employee
// record. That is the point of storing them: reprinting a payslip years later must
// reproduce the document as issued, not recompute it against today's tax table.

function drawPayslip(doc, { payslip: s, seller }) {
  const right = doc.page.width - MARGIN;
  const rates = (s.breakdown && s.breakdown.rates) || {};
  const bands = (s.breakdown && s.breakdown.bands) || [];
  const pct = bp => `${(Number(bp || 0) / 100).toFixed(2).replace(/\.?0+$/, '')}%`;

  doc.fillColor(INK).font('Helvetica-Bold').fontSize(20).text('LAUNASEÐILL', MARGIN, MARGIN);
  doc.font('Helvetica').fontSize(10).fillColor(MUTED)
    .text(`Tímabil ${s.period} · útborgað ${s.pay_date}`, MARGIN, MARGIN + 26);

  // Employer block, from the books settings. Unlike an invoice, a payslip's issuer
  // block is not snapshotted per row — the employer of record does not change
  // retrospectively, and the kennitala is the identifier that matters.
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(10)
    .text(seller.seller_name || '', right - 220, MARGIN, { width: 220, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor(MUTED);
  if (seller.seller_kennitala) {
    doc.text(`Kennitala ${kennitalaDisplay(seller.seller_kennitala)}`,
      right - 220, doc.y, { width: 220, align: 'right' });
  }
  if (seller.seller_address) {
    doc.text(seller.seller_address, right - 220, doc.y, { width: 220, align: 'right' });
  }

  let y = MARGIN + 70;
  doc.moveTo(MARGIN, y).lineTo(right, y).strokeColor(RULE).stroke();
  y += 14;

  doc.fillColor(MUTED).font('Helvetica').fontSize(9).text('LAUNÞEGI', MARGIN, y);
  y += 12;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(s.employee_name || '', MARGIN, y);
  y += 14;
  doc.font('Helvetica').fontSize(9).fillColor(MUTED)
    .text(`Kennitala ${kennitalaDisplay(s.employee_kennitala || '')}`, MARGIN, y);
  y += 24;

  // ── Earnings and deductions ────────────────────────────────────────────────
  const row = (label, amount, { bold = false, note = '' } = {}) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(INK);
    doc.text(label, MARGIN, y, { width: 300 });
    if (note) {
      doc.font('Helvetica').fontSize(8).fillColor(MUTED)
        .text(note, MARGIN + 300, y + 1, { width: 110 });
    }
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(INK)
      .text(isk(amount), right - 110, y, { width: 110, align: 'right' });
    y += 16;
  };

  doc.fillColor(MUTED).font('Helvetica').fontSize(9).text('LAUN OG FRÁDRÁTTUR', MARGIN, y);
  y += 14;
  row('Laun', s.gross, { bold: true });
  row('Lífeyrissjóður', -s.pension_employee, { note: pct(rates.pension_employee_bp) });
  if (s.extra_pension_employee) {
    row('Séreignarsparnaður', -s.extra_pension_employee,
      { note: pct(rates.extra_pension_employee_bp) });
  }
  // Stated explicitly, because "why is the tax not a percentage of my salary" is the
  // question this line answers: pension comes off before tax.
  row('Skattstofn', s.taxable_base, { note: 'laun að frádregnum lífeyri' });
  row('Reiknaður skattur', s.computed_tax);
  row('Persónuafsláttur', -s.allowance_used, {
    note: rates.allowance_factor_bp && rates.allowance_factor_bp !== 10_000
      ? `${pct(rates.allowance_factor_bp)} af afslætti` : '',
  });
  row('Staðgreiðsla', -s.withholding, { bold: true });
  if (s.union_dues) row('Félagsgjöld', -s.union_dues, { note: pct(rates.union_rate_bp) });

  y += 4;
  doc.moveTo(MARGIN, y).lineTo(right, y).strokeColor(RULE).stroke();
  y += 10;
  row('ÚTBORGAÐ', s.net_pay, { bold: true });

  // ── The tax working ────────────────────────────────────────────────────────
  //
  // The bands, with the slice each rate applied to. Without this the withholding is a
  // number the employee has to take on trust; with it, they can check it.
  if (bands.length) {
    y += 14;
    doc.fillColor(MUTED).font('Helvetica').fontSize(9)
      .text('ÚTREIKNINGUR SKATTS', MARGIN, y);
    y += 14;
    for (const b of bands) {
      const range = b.to
        ? `${isk(b.from)} – ${isk(b.to)}`
        : `yfir ${isk(b.from)}`;
      doc.font('Helvetica').fontSize(9).fillColor(INK)
        .text(`${range} · ${pct(b.rate_bp)} af ${isk(b.amount)}`, MARGIN, y, { width: 340 });
      doc.text(isk(b.tax), right - 110, y, { width: 110, align: 'right' });
      y += 13;
    }
  }

  // ── Employer's own contributions ───────────────────────────────────────────
  //
  // In its own block, with a sentence saying it is NOT deducted from the employee. This
  // is the part people misread, and a payslip that lets them misread it is doing harm.
  y += 14;
  doc.fillColor(MUTED).font('Helvetica').fontSize(9)
    .text('FRAMLAG VINNUVEITANDA — EKKI DREGIÐ AF LAUNUM', MARGIN, y);
  y += 14;
  row('Tryggingagjald', s.social_security, { note: pct(rates.social_security_bp) });
  row('Lífeyrisframlag', s.pension_employer, { note: pct(rates.pension_employer_bp) });
  if (s.extra_pension_employer) {
    row('Séreignarframlag', s.extra_pension_employer,
      { note: pct(rates.extra_pension_employer_bp) });
  }
  row('Kostnaður vinnuveitanda samtals',
    Number(s.gross) + Number(s.social_security) + Number(s.pension_employer)
      + Number(s.extra_pension_employer || 0),
    { bold: true });

  y += 20;
  doc.font('Helvetica').fontSize(8).fillColor(MUTED)
    .text(
      'Launaseðill úr rafrænu bókhaldskerfi. Fjárhæðir eru í íslenskum krónum. '
      + `Skattþrep og persónuafsláttur eru fyrir skattár ${(s.breakdown || {}).tax_year || ''}.`,
      MARGIN, y, { width: right - MARGIN }
    );

  if (s.run_status === 'draft') {
    // A draft payslip is not a document anyone should act on, and a PDF that does not
    // say so will be forwarded as though it were final.
    doc.fillColor('#b04040').font('Helvetica-Bold').fontSize(9)
      .text('UPPKAST — EKKI BÓKAÐ', MARGIN, y + 22);
  }
}

function streamPayslip(res, { payslip, seller }) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN });
  doc.on('error', () => { try { res.destroy(); } catch { /* already gone */ } });
  res.on('close', () => doc.destroy());
  doc.pipe(res);
  try {
    drawPayslip(doc, { payslip, seller: seller || {} });
    doc.end();
  } catch (err) {
    doc.destroy();
    res.destroy();
    throw err;
  }
}

module.exports = { streamInvoice, drawInvoice, streamPayslip, drawPayslip, isk, kennitalaDisplay };

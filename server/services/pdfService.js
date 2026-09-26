// PDF generation (pdfkit) — order delivery note. Streams straight into the HTTP
// response; no temp files. The standard Helvetica fonts use WinAnsi encoding,
// which covers Icelandic (ð þ æ ö á í …), so no font embedding is needed.
// Adapted from the icelandicstore wholesale note: no SKU column (order_items
// carry no SKU here) and no prices (a delivery note, not an invoice).
const PDFDocument = require('pdfkit');
const { identity } = require('../config/identity');

const MARGIN = 50;
const INK    = '#111111';
const MUTED  = '#555555';
const RULE   = '#bbbbbb';

function fmtDate(d) {
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

// Ship-to lines from the order's shipping address (falls back to guest name/email).
function shipToLines(order) {
  const out = [];
  const addr = order.shipping_address || null;
  if (addr && typeof addr === 'object') {
    if (addr.name) out.push(addr.name);
    if (addr.line1) out.push(addr.line1);
    if (addr.line2) out.push(addr.line2);
    out.push([addr.postal, addr.city].filter(Boolean).join(' '));
    if (addr.country) out.push(addr.country);
    if (addr.phone) out.push(addr.phone);
  } else if (order.guest_name) {
    out.push(order.guest_name);
  }
  if (order.guest_email) out.push(order.guest_email);
  return out.filter(s => s && String(s).trim());
}

/**
 * Draw ONE delivery note onto the current page of `doc`. The caller owns the
 * document lifecycle: a fresh PDFDocument for a single note, or one doc with a
 * doc.addPage() before each subsequent note for a combined bulk PDF, then a
 * single doc.end().
 */
function drawDeliveryNote(doc, { order, items, store }) {
  items = (items || []).slice().sort((a, b) =>
    String(a.product_name_snapshot || '').localeCompare(String(b.product_name_snapshot || '')));

  const pageW  = doc.page.width;
  const innerW = pageW - MARGIN * 2;

  // ── Header: store identity left, document title right ──────────────────────
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(20)
    .text(store.store_name || 'Orange Smiley', MARGIN, MARGIN, { width: innerW * 0.6 });
  doc.font('Helvetica').fontSize(9).fillColor(MUTED);
  [store.address1, store.address2, [store.zip, store.city].filter(Boolean).join(' '), store.country, store.phone]
    .filter(s => s && String(s).trim())
    .forEach(line => doc.text(line, { width: innerW * 0.6 }));

  doc.font('Helvetica-Bold').fontSize(16).fillColor(INK)
    .text('DELIVERY NOTE', MARGIN + innerW * 0.6, MARGIN, { width: innerW * 0.4, align: 'right' });
  doc.font('Helvetica').fontSize(10).fillColor(MUTED)
    .text('Fylgiseðill', { width: innerW * 0.4, align: 'right' })
    .moveDown(0.6);
  doc.fillColor(INK).fontSize(10)
    .text(`${order.order_number}`, { width: innerW * 0.4, align: 'right' })
    .text(fmtDate(order.created_at), { width: innerW * 0.4, align: 'right' });

  // ── Ship to ─────────────────────────────────────────────────────────────────
  let y = Math.max(doc.y, MARGIN + 90) + 20;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(MUTED).text('SHIP TO', MARGIN, y);
  doc.font('Helvetica').fontSize(10).fillColor(INK);
  shipToLines(order).forEach(line => doc.text(line, { width: innerW * 0.6 }));
  if (order.shipping_method === 'local_pickup') {
    doc.fillColor(MUTED).text('Local pickup', { width: innerW * 0.6 });
  }

  // ── Items table ─────────────────────────────────────────────────────────────
  y = doc.y + 24;
  const col = {
    idx:  { x: MARGIN,              w: 26 },
    name: { x: MARGIN + 30,         w: innerW - 30 - 60 },
    qty:  { x: pageW - MARGIN - 55, w: 55 },
  };
  const tableHeader = () => {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED);
    doc.text('#', col.idx.x, y, { width: col.idx.w });
    doc.text('PRODUCT', col.name.x, y, { width: col.name.w });
    doc.text('QTY', col.qty.x, y, { width: col.qty.w, align: 'right' });
    y += 14;
    doc.moveTo(MARGIN, y).lineTo(pageW - MARGIN, y).strokeColor(RULE).lineWidth(0.5).stroke();
    y += 8;
  };
  tableHeader();

  doc.font('Helvetica').fontSize(10).fillColor(INK);
  let totalUnits = 0;
  items.forEach((it, i) => {
    const name = String(it.product_name_snapshot || '');
    const qty  = Number(it.quantity) || 0;
    totalUnits += qty;
    const rowH = Math.max(doc.heightOfString(name, { width: col.name.w }), 12) + 8;
    if (y + rowH > doc.page.height - 140) {
      doc.addPage(); y = MARGIN; tableHeader();
      doc.font('Helvetica').fontSize(10).fillColor(INK);
    }
    doc.text(String(i + 1), col.idx.x, y, { width: col.idx.w });
    doc.text(name, col.name.x, y, { width: col.name.w });
    doc.text(String(qty), col.qty.x, y, { width: col.qty.w, align: 'right' });
    y += rowH;
    doc.moveTo(MARGIN, y - 4).lineTo(pageW - MARGIN, y - 4).strokeColor('#e5e5e5').lineWidth(0.5).stroke();
  });

  // ── Totals (units only — no prices on a delivery note) ─────────────────────
  y += 6;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK)
    .text(`${items.length} lines · ${totalUnits} units`, col.name.x, y, { width: col.name.w, align: 'right' });

  // ── Signature footer ────────────────────────────────────────────────────────
  const footY = Math.max(doc.y + 60, doc.page.height - 110);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED);
  const half = innerW / 2 - 20;
  doc.moveTo(MARGIN, footY).lineTo(MARGIN + half, footY).strokeColor(RULE).lineWidth(0.7).stroke();
  doc.text('Received by / Móttekið af', MARGIN, footY + 4, { width: half });
  doc.moveTo(pageW - MARGIN - half, footY).lineTo(pageW - MARGIN, footY).strokeColor(RULE).lineWidth(0.7).stroke();
  doc.text('Date / Dagsetning', pageW - MARGIN - half, footY + 4, { width: half });
}

/**
 * Stream a single-order A4 delivery note (no prices) into an HTTP response.
 * @param {object} opts
 * @param {import('http').ServerResponse} opts.res
 * @param {object} opts.order  Order.findById row (with shipping_address JSON)
 * @param {Array}  opts.items  order_items rows
 * @param {object} opts.store  Setting.getGeneralSettings()
 */
function streamDeliveryNote({ res, order, items, store }) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `inline; filename="delivery-note-${String(order.order_number).replace(/[^\w.-]/g, '_')}.pdf"`
  );
  doc.pipe(res);
  drawDeliveryNote(doc, { order, items, store });
  doc.end();
}

/**
 * Stream a single combined PDF with one delivery note per order, page-break
 * separated, so a whole batch prints in one job.
 * @param {object} opts
 * @param {import('http').ServerResponse} opts.res
 * @param {Array<{order: object, items: Array}>} opts.orders
 * @param {object} opts.store  Setting.getGeneralSettings()
 */
function streamBulkDeliveryNotes({ res, orders, store }) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="delivery-notes.pdf"');
  doc.pipe(res);
  orders.forEach((entry, i) => {
    if (i > 0) doc.addPage();
    drawDeliveryNote(doc, { order: entry.order, items: entry.items, store });
  });
  doc.end();
}

// ── Goods receipt (harvest2-lane6a-2026-09-26; after ice #23's
// receiptReportPdf.js, redrawn on this file's patterns) ─────────────────────
// What arrived against what the supplier's file said: one row per line with
// expected, received and the difference, then what was scanned but not on the
// file. Bilingual labels like the delivery note; no prices (unit costs are a
// supplier reference, not our stock value).
function attrLabel(attributes) {
  if (!attributes || typeof attributes !== 'object') return '';
  return Object.values(attributes).filter(v => v != null && String(v).trim()).join(' / ');
}

const VARIANCE_LABEL = {
  exact: 'OK', short: 'Short / Vantar', over: 'Over / Umfram',
  not_received: 'Not received / Kom ekki', pending: '—',
};

function drawGoodsReceipt(doc, { receipt, lines, extras, store }) {
  const pageW  = doc.page.width;
  const innerW = pageW - MARGIN * 2;

  doc.fillColor(INK).font('Helvetica-Bold').fontSize(20)
    .text(store.store_name || identity.brand.name, MARGIN, MARGIN, { width: innerW * 0.6 });
  doc.font('Helvetica-Bold').fontSize(16).fillColor(INK)
    .text('GOODS RECEIPT', MARGIN + innerW * 0.6, MARGIN, { width: innerW * 0.4, align: 'right' });
  doc.font('Helvetica').fontSize(10).fillColor(MUTED)
    .text('Vörumóttaka', { width: innerW * 0.4, align: 'right' })
    .moveDown(0.6);
  doc.fillColor(INK).fontSize(10)
    .text(fmtDate(receipt.finalized_at || receipt.created_at), { width: innerW * 0.4, align: 'right' });

  let y = Math.max(doc.y, MARGIN + 70) + 16;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(MUTED).text('SUPPLIER / BIRGIR', MARGIN, y);
  doc.font('Helvetica').fontSize(10).fillColor(INK).text(String(receipt.supplier_name || ''), { width: innerW * 0.6 });
  if (receipt.reference) doc.fillColor(MUTED).text(`Ref: ${receipt.reference}`, { width: innerW * 0.6 });
  const statusLine = receipt.status === 'finalized'
    ? `Finalised / Frágengið ${fmtDate(receipt.finalized_at)}${receipt.finalized_by_name ? ' · ' + receipt.finalized_by_name : ''}`
    : `Status / Staða: ${receipt.status}`;
  doc.fillColor(MUTED).text(statusLine, { width: innerW * 0.6 });

  y = doc.y + 20;
  const col = {
    sku:  { x: MARGIN,               w: 80 },
    name: { x: MARGIN + 84,          w: innerW - 84 - 190 },
    exp:  { x: pageW - MARGIN - 186, w: 44 },
    rec:  { x: pageW - MARGIN - 138, w: 44 },
    var:  { x: pageW - MARGIN - 90,  w: 90 },
  };
  const tableHeader = () => {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED);
    doc.text('SKU', col.sku.x, y, { width: col.sku.w });
    doc.text('ITEM / VARA', col.name.x, y, { width: col.name.w });
    doc.text('EXP.', col.exp.x, y, { width: col.exp.w, align: 'right' });
    doc.text('REC.', col.rec.x, y, { width: col.rec.w, align: 'right' });
    doc.text('', col.var.x, y, { width: col.var.w });
    y += 13;
    doc.moveTo(MARGIN, y).lineTo(pageW - MARGIN, y).strokeColor(RULE).lineWidth(0.5).stroke();
    y += 6;
  };
  const row = (sku, name, exp, rec, variance) => {
    const rowH = Math.max(doc.heightOfString(name, { width: col.name.w }), 11) + 6;
    if (y + rowH > doc.page.height - 90) {
      doc.addPage(); y = MARGIN; tableHeader();
    }
    doc.font('Helvetica').fontSize(9).fillColor(INK);
    doc.text(sku, col.sku.x, y, { width: col.sku.w });
    doc.text(name, col.name.x, y, { width: col.name.w });
    doc.text(exp, col.exp.x, y, { width: col.exp.w, align: 'right' });
    doc.text(rec, col.rec.x, y, { width: col.rec.w, align: 'right' });
    doc.text(variance, col.var.x, y, { width: col.var.w, align: 'right' });
    y += rowH;
    doc.moveTo(MARGIN, y - 3).lineTo(pageW - MARGIN, y - 3).strokeColor('#e5e5e5').lineWidth(0.5).stroke();
  };
  tableHeader();

  let expected = 0; let received = 0;
  for (const l of lines || []) {
    const skipped = l.match_status === 'skipped' || l.match_status === 'new_product';
    const name = [l.product_name || l.supplier_description || '', attrLabel(l.attributes)].filter(Boolean).join(' — ')
      + (skipped ? ' (skipped / sleppt)' : '');
    if (!skipped) { expected += Number(l.expected_qty) || 0; received += Number(l.received_qty) || 0; }
    row(String(l.sku || l.file_sku || l.barcode || ''), name, String(l.expected_qty || 0),
      String(l.received_qty || 0), skipped ? '' : (VARIANCE_LABEL[l.variance] || ''));
  }

  if ((extras || []).length) {
    y += 10;
    if (y > doc.page.height - 120) { doc.addPage(); y = MARGIN; }
    doc.font('Helvetica-Bold').fontSize(10).fillColor(MUTED)
      .text('NOT ON THE INVOICE / EKKI Á REIKNINGI', MARGIN, y);
    y = doc.y + 6;
    for (const x of extras) {
      received += Number(x.qty) || 0;
      row(String(x.sku || ''), [x.product_name || '', attrLabel(x.attributes)].filter(Boolean).join(' — '),
        '0', String(x.qty || 0), VARIANCE_LABEL.over);
    }
  }

  y += 8;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK)
    .text(`${expected} expected · ${received} received`, MARGIN, y, { width: innerW, align: 'right' });

  const footY = Math.max(doc.y + 50, doc.page.height - 100);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED);
  const half = innerW / 2 - 20;
  doc.moveTo(MARGIN, footY).lineTo(MARGIN + half, footY).strokeColor(RULE).lineWidth(0.7).stroke();
  doc.text('Received by / Móttekið af', MARGIN, footY + 4, { width: half });
  doc.moveTo(pageW - MARGIN - half, footY).lineTo(pageW - MARGIN, footY).strokeColor(RULE).lineWidth(0.7).stroke();
  doc.text('Date / Dagsetning', pageW - MARGIN - half, footY + 4, { width: half });
}

/**
 * Stream a goods receipt as an A4 PDF into an HTTP response.
 * @param {object} opts
 * @param {import('http').ServerResponse} opts.res
 * @param {object} opts.receipt  GoodsReceipt.findById row
 * @param {Array}  opts.lines    GoodsReceipt.lines(id)
 * @param {Array}  opts.extras   GoodsReceipt.extras(id)
 * @param {object} opts.store    Setting.getGeneralSettings()
 */
function streamGoodsReceipt({ res, receipt, lines, extras, store }) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  const ref = String(receipt.reference || receipt.id).replace(/[^\w.-]/g, '_').slice(0, 60);
  res.setHeader('Content-Disposition', `inline; filename="goods-receipt-${ref}.pdf"`);
  doc.pipe(res);
  drawGoodsReceipt(doc, { receipt, lines, extras, store });
  doc.end();
}

module.exports = { streamDeliveryNote, streamBulkDeliveryNotes, streamGoodsReceipt };

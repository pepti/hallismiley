// PDF generation (pdfkit) — order delivery note. Streams straight into the HTTP
// response; no temp files. The standard Helvetica fonts use WinAnsi encoding,
// which covers Icelandic (ð þ æ ö á í …), so no font embedding is needed.
// Adapted from the icelandicstore wholesale note: no SKU column (order_items
// carry no SKU here) and no prices (a delivery note, not an invoice).
const PDFDocument = require('pdfkit');

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
 * Stream an A4 delivery note (no prices) into an HTTP response.
 * @param {object} opts
 * @param {import('http').ServerResponse} opts.res
 * @param {object} opts.order  Order.findById row (with shipping_address JSON)
 * @param {Array}  opts.items  order_items rows
 * @param {object} opts.store  Setting.getGeneralSettings()
 */
function streamDeliveryNote({ res, order, items, store }) {
  items = (items || []).slice().sort((a, b) =>
    String(a.product_name_snapshot || '').localeCompare(String(b.product_name_snapshot || '')));

  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `inline; filename="delivery-note-${String(order.order_number).replace(/[^\w.-]/g, '_')}.pdf"`
  );
  doc.pipe(res);

  const pageW  = doc.page.width;
  const innerW = pageW - MARGIN * 2;

  // ── Header: store identity left, document title right ──────────────────────
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(20)
    .text(store.store_name || 'Halli Smiley', MARGIN, MARGIN, { width: innerW * 0.6 });
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

  doc.end();
}

module.exports = { streamDeliveryNote };

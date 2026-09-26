// PDF generation (pdfkit) — order delivery note. Streams straight into the HTTP
// response; no temp files. The standard Helvetica fonts use WinAnsi encoding,
// which covers Icelandic (ð þ æ ö á í …), so no font embedding is needed.
// Adapted from the icelandicstore wholesale note, no prices (a delivery note,
// not an invoice). Since harvest 2 lane 6c (2026-09-26; ported from
// icelandicstore #8, #334, #335) the note is a pick list: a picture per line,
// the variant's size under the name, BIN and SKU columns, and the lines walked
// by shelf (BIN, then SKU). The lines come from services/deliveryNote.js.
const PDFDocument = require('pdfkit');
const { compareSku, compareBin } = require('../utils/skuCompare');

const MARGIN = 50;
const INK    = '#111111';
const MUTED  = '#555555';
const RULE   = '#bbbbbb';
const PIC    = 40;   // pt — the line picture's box (a 120 px JPEG, ~215 dpi)

// pdfkit caches an image only when it was opened from a PATH; a Buffer is
// re-embedded on every doc.image() call. services/deliveryNote.js hands the
// SAME Buffer to every line (and every order of a bulk print) showing that
// photo, so open it once per document and reuse the XObject — one copy in the
// file, not fifty.
const openedImages = new WeakMap();
function openImageOnce(doc, buf) {
  let perDoc = openedImages.get(doc);
  if (!perDoc) { perDoc = new Map(); openedImages.set(doc, perDoc); }
  if (!perDoc.has(buf)) perDoc.set(buf, doc.openImage(buf));
  return perDoc.get(buf);
}

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

// Pick-list order: walk the warehouse by BIN (shelf), then SKU, numbers
// compared as numbers ("B-2" before "B-10"); a line without a shelf or code
// sorts last. Exported for the tests.
function sortLines(items) {
  return (items || []).slice().sort((a, b) => compareBin(a.bin, b.bin) || compareSku(a.sku, b.sku));
}

/**
 * Draw ONE delivery note onto the current page of `doc`. The caller owns the
 * document lifecycle: a fresh PDFDocument for a single note, or one doc with a
 * doc.addPage() before each subsequent note for a combined bulk PDF, then a
 * single doc.end().
 *
 * @param {object} opts.order  Order.findById row
 * @param {Array}  opts.items  services/deliveryNote rows — order lines with the
 *   live `sku`/`bin`, plus `variant_label` ("White / M") and `image` (a small
 *   JPEG Buffer), both optional
 * @param {object} opts.store  Setting.getGeneralSettings()
 */
function drawDeliveryNote(doc, { order, items, store }) {
  items = sortLines(items);

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
  // # | picture | PRODUCT (name, then the size in bold) | BIN | SKU | QTY — the
  // shape of the retail packing slip a warehouse already picks from.
  y = doc.y + 24;
  const col = {
    idx:  { x: MARGIN,               w: 18 },
    pic:  { x: MARGIN + 20,          w: PIC },
    name: { x: MARGIN + 68,          w: innerW - 68 - 202 - 6 },
    bin:  { x: pageW - MARGIN - 202, w: 80 },
    sku:  { x: pageW - MARGIN - 116, w: 70 },
    qty:  { x: pageW - MARGIN - 40,  w: 40 },
  };
  const tableHeader = () => {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED);
    doc.text('#', col.idx.x, y, { width: col.idx.w });
    doc.text('PRODUCT', col.name.x, y, { width: col.name.w });
    doc.text('BIN', col.bin.x, y, { width: col.bin.w });
    doc.text('SKU', col.sku.x, y, { width: col.sku.w });
    doc.text('QTY', col.qty.x, y, { width: col.qty.w, align: 'right' });
    y += 14;
    doc.moveTo(MARGIN, y).lineTo(pageW - MARGIN, y).strokeColor(RULE).lineWidth(0.5).stroke();
    y += 8;
  };
  tableHeader();

  let totalUnits = 0;
  items.forEach((it, i) => {
    const name  = String(it.product_name_snapshot || '');
    const label = it.variant_label ? String(it.variant_label) : '';
    const sku   = String(it.sku || '—');
    const bin   = it.bin ? String(it.bin) : '—';
    const qty   = Number(it.quantity) || 0;
    totalUnits += qty;

    doc.font('Helvetica').fontSize(10);
    const nameH = doc.heightOfString(name, { width: col.name.w });
    const skuH  = doc.heightOfString(sku, { width: col.sku.w });
    doc.font('Helvetica-Bold').fontSize(11);
    const labelH = label ? doc.heightOfString(label, { width: col.name.w }) + 2 : 0;
    const binH   = doc.heightOfString(bin, { width: col.bin.w });
    const rowH = Math.max(nameH + labelH, skuH, binH, it.image ? PIC : 0, 12) + 8;

    if (y + rowH > doc.page.height - 140) {
      doc.addPage(); y = MARGIN; tableHeader();
    }

    doc.font('Helvetica').fontSize(10).fillColor(INK);
    doc.text(String(i + 1), col.idx.x, y, { width: col.idx.w });
    if (it.image) {
      try {
        doc.image(openImageOnce(doc, it.image), col.pic.x, y - 2, { fit: [PIC, PIC], align: 'center', valign: 'center' });
      } catch {
        // An undecodable buffer costs the line its picture, never the whole PDF.
      }
    }
    doc.font('Helvetica').fontSize(10).fillColor(INK).text(name, col.name.x, y, { width: col.name.w });
    if (label) {
      doc.font('Helvetica-Bold').fontSize(11).fillColor(INK)
        .text(label, col.name.x, y + nameH + 2, { width: col.name.w });
    }
    doc.font(it.bin ? 'Helvetica-Bold' : 'Helvetica').fontSize(it.bin ? 11 : 10).fillColor(INK)
      .text(bin, col.bin.x, y, { width: col.bin.w });
    doc.font('Helvetica').fontSize(10).fillColor(INK);
    doc.text(sku, col.sku.x, y, { width: col.sku.w });
    doc.text(String(qty), col.qty.x, y, { width: col.qty.w, align: 'right' });
    y += rowH;
    doc.moveTo(MARGIN, y - 4).lineTo(pageW - MARGIN, y - 4).strokeColor('#e5e5e5').lineWidth(0.5).stroke();
  });

  // ── Totals (units only — no prices on a delivery note) ─────────────────────
  y += 6;
  const totalsW = pageW - MARGIN - col.name.x;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK)
    .text(`${items.length} lines · ${totalUnits} units`, col.name.x, y, { width: totalsW, align: 'right' });
  doc.font('Helvetica').fontSize(8).fillColor(MUTED)
    .text('Sorted by BIN / Raðað eftir hillu', col.name.x, doc.y + 2, { width: totalsW, align: 'right' });
  y = doc.y;

  // ── Signature footer ────────────────────────────────────────────────────────
  const footY = Math.max(y + 60, doc.page.height - 110);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED);
  const half = innerW / 2 - 20;
  doc.moveTo(MARGIN, footY).lineTo(MARGIN + half, footY).strokeColor(RULE).lineWidth(0.7).stroke();
  doc.text('Received by / Móttekið af', MARGIN, footY + 4, { width: half });
  doc.moveTo(pageW - MARGIN - half, footY).lineTo(pageW - MARGIN, footY).strokeColor(RULE).lineWidth(0.7).stroke();
  doc.text('Date / Dagsetning', pageW - MARGIN - half, footY + 4, { width: half });
}

function newDoc() {
  return new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
}

/**
 * Stream a single-order A4 delivery note (no prices) into an HTTP response.
 * @param {object} opts
 * @param {import('http').ServerResponse} opts.res
 * @param {object} opts.order  Order.findById row (with shipping_address JSON)
 * @param {Array}  opts.items  services/deliveryNote rows
 * @param {object} opts.store  Setting.getGeneralSettings()
 */
function streamDeliveryNote({ res, order, items, store }) {
  const doc = newDoc();
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
  const doc = newDoc();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="delivery-notes.pdf"');
  doc.pipe(res);
  orders.forEach((entry, i) => {
    if (i > 0) doc.addPage();
    drawDeliveryNote(doc, { order: entry.order, items: entry.items, store });
  });
  doc.end();
}

module.exports = { streamDeliveryNote, streamBulkDeliveryNotes, drawDeliveryNote, sortLines, newDoc };

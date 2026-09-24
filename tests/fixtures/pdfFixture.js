'use strict';

// Shared pdfkit fixture builder for the PDF-reading suites. Fixtures are built
// rather than committed because the documents that prompted the PDF readers are
// real purchase orders / sales reports, and another company's trading terms do
// not belong in git. Kept free of DB helpers so unit suites can require it.
//
// Every run is one absolutely-positioned text run, the way a generated trade
// document lays out its blocks: { x, y, text }. `pdfLines` is the shorthand for a
// plain top-to-bottom list.
const PDFDocument = require('pdfkit');

function pdfBuffer(runs) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.font('Helvetica').fontSize(10);
    for (const r of runs) doc.text(String(r.text), r.x, r.y, { lineBreak: false });
    doc.end();
  });
}

// ['SKU', 'MAG-1'] → one run per line, 20pt apart, starting at (40, 80).
function pdfLines(lines) {
  return pdfBuffer(lines.map((text, i) => ({ x: 40, y: 80 + i * 20, text })));
}

// The multer memory-file shape the parse services take.
async function pdfFile(runs, { filename = 'order.pdf' } = {}) {
  return { buffer: await pdfBuffer(runs), originalname: filename, mimetype: 'application/pdf' };
}

module.exports = { pdfBuffer, pdfLines, pdfFile };

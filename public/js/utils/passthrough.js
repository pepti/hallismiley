// The pass-through arithmetic (D-022) for the admin's live PREVIEW on the
// account screen (AdminAccountDetailView). The invoice itself is built by the
// server's copy of the same rule, invoiceService.computePassthrough — this one
// only shows the figures before issuing, and tests/unit/passthrough.test.js
// holds the two to the same answers.
//
// The rule: the AI allowance comes off the AI lines in order, never below
// zero; the markup is applied per line to what is left, Math.round to whole
// ISK; VSK once on the net total. A row without a valid cost is shown but not
// counted. `terms` is the account response's `passthrough_terms`
// ({ markup_bp, ai_allowance_isk, vat_rate }), read from the product config.
export function previewPassthrough(rows, terms) {
  const markupBp = Number(terms.markup_bp) || 0;
  const vatRate = Number(terms.vat_rate) || 0;
  let left = Number(terms.ai_allowance_isk) || 0;
  const lines = rows.map(r => {
    const cost = Number(r.cost);
    if (r.cost === '' || r.cost == null || !Number.isInteger(cost) || cost <= 0) return { ...r, valid: false };
    let included = 0;
    if (r.type === 'ai') { included = Math.min(left, cost); left -= included; }
    const net = Math.round((cost - included) * (10000 + markupBp) / 10000);
    return { ...r, valid: true, cost, included, net };
  });
  const net = lines.reduce((s, l) => s + (l.valid ? l.net : 0), 0);
  const vat = Math.round(net * vatRate / 100);
  return { lines, net, vat, gross: net + vat };
}

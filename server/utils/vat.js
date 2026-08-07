// VSK (Icelandic VAT) arithmetic.
//
// Two rules govern everything in this file:
//
// 1. Shop prices in this system are VAT-INCLUSIVE (see server/migrations/022_ecommerce.sql:
//    "Prices are VAT-inclusive (24% VSK)"). So VAT is always *extracted from* a
//    gross amount, never added on top of a net one. Getting this backwards
//    inflates every invoice by the VAT rate.
//
// 2. Money is an integer number of ISK. Never a float. Rounding happens once,
//    explicitly, at each split — and where a total must be divided across lines
//    the largest-remainder method guarantees the parts sum exactly to the whole.
//
// Historical note worth keeping: the system this replaces resolved a line's VAT
// rate with `Number(candidate)`, and `Number(null) === 0` while 0 is a valid
// Icelandic rate. Every line with an absent rate therefore silently booked at
// 0% VAT — under-declaring output VAT on every counter sale. resolveVatRate below
// rejects absent input instead of coercing it, and that behaviour is pinned by a
// regression test.

// The only VAT rates Iceland has. 11% is a closed, enumerated list (accommodation,
// food, books, passenger transport...); Halli's joinery, furniture and software
// work are all 24%. 0% is exports and other zero-rated turnover.
const ALLOWED_RATES = [0, 11, 24];
const STANDARD_VAT_RATE = 24;
const REDUCED_VAT_RATE = 11;

// Reverse charge on services bought from abroad kicks in at this much per
// two-month period (electronic/telecom/broadcast services). Any foreign SaaS
// stack clears it easily, so the books have to handle it rather than ignore it.
const REVERSE_CHARGE_THRESHOLD_ISK = 10000;

class VatError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VatError';
    this.status = 400;
  }
}

// Strict: an absent or unrecognised rate is a programming error, not a 0% sale.
// Pass an explicit 0 when you really mean zero-rated.
function resolveVatRate(rate) {
  if (rate === null || rate === undefined || rate === '') {
    throw new VatError('VAT rate is required (pass an explicit 0 for zero-rated turnover)');
  }
  // Objects and arrays have to go before Number(), for the same reason null does:
  // Number([]) === 0 and 0 is a valid rate, so `[]` walks straight through the
  // check above and books the line at 0% VAT — the inherited bug in the header
  // comment, reached through a JSON array instead of a null. Number([24]) === 24
  // is the same door: a rate that happens to be right by accident is still a rate
  // nobody validated. Only numbers and numeric strings are rates.
  if (typeof rate !== 'number' && typeof rate !== 'string') {
    throw new VatError(`VAT rate must be a number, got: ${JSON.stringify(rate)}`);
  }
  const n = Number(rate);
  if (!Number.isInteger(n) || !ALLOWED_RATES.includes(n)) {
    throw new VatError(`Unsupported VAT rate: ${rate} (allowed: ${ALLOWED_RATES.join(', ')})`);
  }
  return n;
}

function assertIntegerIsk(value, label) {
  // Reject absent input BEFORE coercing. Number(null) and Number('') are both 0,
  // and 0 is a perfectly valid amount, so coercion would turn a missing figure
  // into a zero-ISK line or a silently dropped payment — the same trap that made
  // resolveVatRate book every counter sale at 0% VAT in the previous system.
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
    throw new VatError(`${label} is required and must be a number, got: ${value}`);
  }
  // Same trap one type further out: Number([]) === 0 and Number([1000]) === 1000,
  // so an array slips past every check below and lands in a BIGINT money column
  // as a figure nobody validated.
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new VatError(`${label} must be a number, got: ${JSON.stringify(value)}`);
  }
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new VatError(`${label} must be an integer number of ISK, got: ${value}`);
  }
  // Postgres BIGINT tops out far above this, but JS loses integer precision past
  // Number.MAX_SAFE_INTEGER, so refuse anything that could silently round.
  if (!Number.isSafeInteger(n)) {
    throw new VatError(`${label} is too large to represent exactly: ${value}`);
  }
  return n;
}

// Split a VAT-inclusive gross amount into { net, vat, gross }.
// gross = net + vat holds exactly, by construction: vat is derived and net is
// the remainder, so the rounding error can never open a gap between the two.
function splitVatInclusive(gross, rate) {
  const g = assertIntegerIsk(gross, 'gross');
  const r = resolveVatRate(rate);
  if (g < 0) throw new VatError(`gross must not be negative, got: ${gross}`);
  if (r === 0) return { net: g, vat: 0, gross: g, rate: 0 };
  const vat = Math.round((g * r) / (100 + r));
  return { net: g - vat, vat, gross: g, rate: r };
}

// Add VAT to a net amount. Used for reverse-charge self-assessment, where the
// foreign supplier's invoice IS the net figure and Icelandic VAT goes on top.
function addVat(net, rate) {
  const n = assertIntegerIsk(net, 'net');
  const r = resolveVatRate(rate);
  if (n < 0) throw new VatError(`net must not be negative, got: ${net}`);
  const vat = Math.round((n * r) / 100);
  return { net: n, vat, gross: n + vat, rate: r };
}

// Distribute `total` across `weights` so the parts sum EXACTLY to total.
// Largest-remainder (Hare) method: floor everything, then hand the leftover
// units to whichever entries lost the most to flooring. Used for allocating an
// order-level discount across lines, and for FX conversion of a line set.
//
// Sign-agnostic: a negative total distributes negative parts the same way.
function allocateProportional(total, weights) {
  const t = assertIntegerIsk(total, 'total');
  const w = weights.map((x, i) => assertIntegerIsk(x, `weights[${i}]`));
  if (w.some(x => x < 0)) throw new VatError('weights must not be negative');
  const sum = w.reduce((a, b) => a + b, 0);
  const out = new Array(w.length).fill(0);
  if (t === 0) return out;
  if (sum === 0) {
    // Nothing to weight by: put the whole amount on the first slot rather than
    // dividing by zero, and let the caller's reconciliation catch it.
    if (out.length) out[0] = t;
    return out;
  }
  const sign = t < 0 ? -1 : 1;
  const abs = Math.abs(t);
  const exact = w.map(x => (abs * x) / sum);
  const floored = exact.map(x => Math.floor(x));
  let remainder = abs - floored.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const result = floored.slice();
  for (let k = 0; remainder > 0; k = (k + 1) % order.length) {
    result[order[k].i] += 1;
    remainder -= 1;
  }
  return result.map(x => x * sign);
}

// Group already-split lines into the per-rate totals the VSK return needs.
// RSK 10.01 wants turnover excluding VAT per rate (boxes A and B), zero-rated
// turnover separately (box C) and total output VAT (box D) — which is only
// possible if VAT was tracked per rate all along.
function summariseByRate(lines) {
  const byRate = new Map();
  for (const line of lines) {
    const rate = resolveVatRate(line.vat_rate ?? line.rate);
    const net = assertIntegerIsk(line.line_net ?? line.net, 'line_net');
    const vat = assertIntegerIsk(line.line_vat ?? line.vat, 'line_vat');
    const cur = byRate.get(rate) || { rate, net: 0, vat: 0, gross: 0 };
    cur.net += net;
    cur.vat += vat;
    cur.gross += net + vat;
    byRate.set(rate, cur);
  }
  const rates = [...byRate.values()].sort((a, b) => a.rate - b.rate);
  return {
    rates,
    net_total: rates.reduce((a, r) => a + r.net, 0),
    vat_total: rates.reduce((a, r) => a + r.vat, 0),
    gross_total: rates.reduce((a, r) => a + r.gross, 0),
  };
}

module.exports = {
  ALLOWED_RATES,
  STANDARD_VAT_RATE,
  REDUCED_VAT_RATE,
  REVERSE_CHARGE_THRESHOLD_ISK,
  VatError,
  resolveVatRate,
  assertIntegerIsk,
  splitVatInclusive,
  addVat,
  allocateProportional,
  summariseByRate,
};

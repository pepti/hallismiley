// Header vocabulary for the products import: which column of an uploaded file
// feeds which product field. Harvested from icelandicstore (ice@4694289,
// harvest-ice-d-2026-09-24); the synonym list is cut to the fields the engine's
// import knows (no cost / vendor / VAT / pack columns here).
//
// The CANONICAL headers come from the caller's own PRODUCT_CSV_COLUMNS table
// (adminShopController), so the file this page exports always round-trips and
// the two can never drift. On top of those sit SUPPLIER synonyms — what a
// wholesaler's own order confirmation or price list calls the same thing, in
// English and Icelandic — because the whole point of accepting .xlsx and PDF is
// that those files were written by somebody else.
//
// The one rule worth stating out loud: an ORDER quantity is not a stock level.
// "Order Quantity" on a purchase order is how many units somebody is buying,
// and this import writes stock through an AUDITED adjustment (reason 'import'),
// so mapping the two would post fictional inventory movements that then have to
// be unpicked. Those headers are recognised only so the modal can report that
// they were skipped; nothing but a real Stock/Birgðir column writes stock.

// Kinds in PRODUCT_CSV_COLUMNS that import may write.
const WRITABLE_KINDS = ['str', 'int', 'bool'];

// Supplier / trade-document synonyms → internal field. Keys are normalised.
const SYNONYMS = {
  // ── our own code (the match key) ──
  'vörunúmer':              'sku',
  'vorunumer':              'sku',
  'vörunr':                 'sku',
  'vörukóði':               'sku',
  'kóði':                   'sku',
  'item':                   'sku',
  'item no':                'sku',
  'item number':            'sku',
  'item code':              'sku',
  'article':                'sku',
  'article no':             'sku',
  'article number':         'sku',
  'artikel':                'sku',
  'artikelnummer':          'sku',
  'material':               'sku',
  'material no':            'sku',
  'material number':        'sku',
  'your material number':   'sku',
  'your article number':    'sku',
  'your item number':       'sku',
  'product code':           'sku',
  'product no':             'sku',
  'product number':         'sku',
  'part number':            'sku',
  'part no':                'sku',
  'ref':                    'sku',

  // ── barcode (the fallback match key: a supplier sheet has OUR barcode but
  //    THEIR article number) ──
  'bar code':               'barcode',
  'gtin':                   'barcode',
  'ean':                    'barcode',
  'ean13':                  'barcode',
  'ean 13':                 'barcode',
  'upc':                    'barcode',
  'gtin ean upc':           'barcode',
  'int article no ean upc': 'barcode',
  'strikamerki':            'barcode',
  'strikanúmer':            'barcode',

  // ── writable values ──
  'hilla':                  'bin',
  'hólf':                   'bin',
  'staðsetning':            'bin',
  'location':               'bin',
  'shelf':                  'bin',

  'verð':                   'price_isk',
  'verð isk':               'price_isk',
  'verð í isk':             'price_isk',
  'söluverð':               'price_isk',
  'söluverð isk':           'price_isk',
  'price in isk':           'price_isk',
  'verð eur':               'price_eur',
  'price in eur':           'price_eur',

  'stock qty':              'stock',
  'stock quantity':         'stock',
  'on hand':                'stock',
  'qty on hand':            'stock',
  'quantity on hand':       'stock',
  'inventory':              'stock',
  'birgðir':                'stock',
  'birgðastaða':            'stock',
  'lager':                  'stock',
  'lagerstaða':             'stock',

  'heiti':                  'name',
  'vara':                   'name',
  'virk':                   'active',
  'virkt':                  'active',
  'staða':                  'active',
};

// Quantity headers that must NOT become `stock`. Bare "qty" / "quantity" /
// "magn" / "fjöldi" are in here deliberately: ambiguous is not good enough to
// post an audited inventory adjustment from.
const ORDER_QTY_HEADERS = new Set([
  'order quantity', 'order qty', 'ordered quantity', 'ordered qty',
  'open quantity', 'delivered quantity', 'confirmed quantity',
  'qty', 'quantity', 'pcs', 'units',
  'magn', 'fjöldi', 'fjoldi', 'pöntunarmagn', 'pantað magn', 'pöntun',
]);

// Per-axis columns a supplier grid carries instead of one "Variant" cell
// ("Stærð" and "Litur" side by side). Folded to the lowercase axis names the
// product form stores — and folded ONLY here, at the import boundary:
// utils/variantAxis stays synonym-free on purpose, because a recipe that
// quietly matched `colour` to `color` would decrement the wrong stock.
const AXIS_HEADERS = {
  'size':   'size', 'sizes': 'size', 'stærð': 'size', 'stærðir': 'size', 'staerd': 'size', 'str': 'size',
  'color':  'color', 'colour': 'color', 'colors': 'color', 'colours': 'color', 'litur': 'color', 'litir': 'color',
};

// Columns that identify a row rather than carry a value to write.
const IDENTIFIER_FIELDS = new Set(['sku', 'barcode']);
// Carried through for the create path but never counted as a writable change.
const PASSTHROUGH_FIELDS = new Set(['slug', '__variant']);

// Lowercase, punctuation → single spaces. Unicode-aware so Icelandic headers
// survive ("Vörunúmer" stays "vörunúmer", not "v runumer").
function normalizeHeader(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Build the header map for one import.
 * `columns` is PRODUCT_CSV_COLUMNS: [header, field, kind][].
 * → { fieldFor(header), isOrderQty(header), writable:Set, identifiers:Set }
 */
function buildHeaderMap(columns) {
  const byHeader = new Map();
  const writable = new Set();

  for (const [header, field, kind] of columns || []) {
    byHeader.set(normalizeHeader(header), field);
    if (WRITABLE_KINDS.includes(kind)) writable.add(field);
  }
  // Synonyms never override a canonical header of the same name.
  for (const [key, field] of Object.entries(SYNONYMS)) {
    if (!byHeader.has(key)) byHeader.set(key, field);
  }

  return {
    fieldFor(header) {
      const key = normalizeHeader(header);
      if (!key) return null;
      return byHeader.get(key) || null;
    },
    isOrderQty(header) {
      return ORDER_QTY_HEADERS.has(normalizeHeader(header));
    },
    // The variant axis a column names, or null. Checked only for columns no
    // field claimed, so a canonical header can never be mistaken for an axis.
    axisFor(header) {
      return AXIS_HEADERS[normalizeHeader(header)] || null;
    },
    writable,
    identifiers: IDENTIFIER_FIELDS,
    passthrough: PASSTHROUGH_FIELDS,
  };
}

module.exports = {
  buildHeaderMap,
  normalizeHeader,
  AXIS_HEADERS,
  ORDER_QTY_HEADERS,
  IDENTIFIER_FIELDS,
  PASSTHROUGH_FIELDS,
  WRITABLE_KINDS,
};

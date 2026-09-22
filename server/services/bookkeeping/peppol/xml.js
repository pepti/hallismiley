// A minimal XML writer for a fixed, flat document.
//
// A UBL 2.1 invoice under BIS 3.0 is ~150 lines with no polymorphism: there is
// nothing for a builder library to abstract, and the libraries that would
// genuinely help — an XSD or Schematron validator — are native builds or JVM
// shells, which is the wrong trade for the Docker image. So: escaping, attributes,
// and element nesting, and nothing else. The repo already hand-rolls XML the same
// way (server/routes/sitemapRoutes.js).

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

function escText(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escAttr(s) {
  return escText(s).replace(/"/g, '&quot;');
}

/**
 * One element. `inner` is either text (escaped) or an array of already-rendered
 * children (falsy entries dropped, so optional elements can be written inline as
 * `cond && tag(...)`). Attributes with an empty/null value are omitted.
 */
function tag(name, attrs, inner) {
  const a = attrs
    ? Object.entries(attrs)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => ` ${k}="${escAttr(v)}"`)
      .join('')
    : '';
  if (inner === undefined || inner === null) return `<${name}${a}/>`;
  if (Array.isArray(inner)) return `<${name}${a}>${inner.filter(Boolean).join('')}</${name}>`;
  return `<${name}${a}>${escText(inner)}</${name}>`;
}

// EN 16931 amounts carry at most two decimals (BR-DEC-*). ISK has no subunit, so
// every amount ends in ".00" — which is inside the cap, and is the case the
// cross-implementation test asks the other side about.
function formatAmount(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) throw new TypeError(`Not an amount: ${n}`);
  return v.toFixed(2);
}

function moneyTag(name, n, currency) {
  return tag(name, { currencyID: currency }, formatAmount(n));
}

// Quantities may carry decimals; trailing zeros are dropped ("2", "1.5").
function formatQuantity(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) throw new TypeError(`Not a quantity: ${n}`);
  return String(Number(v.toFixed(3)));
}

module.exports = { XML_DECLARATION, escText, escAttr, tag, formatAmount, moneyTag, formatQuantity };

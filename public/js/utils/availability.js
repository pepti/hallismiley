// Client-side availability rules for the basket (harvested from icelandicstore
// #244, harvest-ice-c-2026-09-24; ENHANCEMENTS #25).
//
// The public catalogue carries ONE inventory number per product/variant,
// `available` (on hand − what paid, unshipped orders hold — server
// models/Inventory.js). The engine does not oversell: the checkout answers 409
// for a line Available cannot cover, and the webhook re-checks when the payment
// lands. Everything here is the UX layer in front of that: the product page,
// the cart and the checkout apply the same rule through these helpers, so a
// basket line that went stale (stock sold out after it was added) is caught
// before the customer is sent to Stripe — before this, a sold-out line went
// straight to payment. Bookable services (no variant) are never stock-limited.

export const MAX_QTY_PER_ITEM = 50;   // mirrors shopController.MAX_QTY_PER_ITEM

// Same key the cart uses for a line: variant wins over product.
export function lineKey(productId, variantId) {
  return variantId ? `v:${variantId}` : `p:${productId}`;
}

// { available, unlimited } for a product + optional variant.
export function availabilityOf(product, variant = null) {
  const raw = variant ? variant.available : (product && product.available);
  const unlimited = Boolean(!variant && product && product.is_bookable === true);
  return { available: Number(raw ?? 0), unlimited };
}

// Highest quantity that may be ordered: what is available (never negative),
// or the server cap for a service.
export function capFor({ available, unlimited }) {
  return unlimited ? MAX_QTY_PER_ITEM : Math.max(0, Math.min(MAX_QTY_PER_ITEM, Number(available) || 0));
}

// Clamp a requested quantity to the cap. 0 = nothing fits.
export function cappedQty(qty, cap) {
  const q = Math.max(0, Math.floor(Number(qty) || 0));
  return Math.min(q, Math.max(0, Math.floor(Number(cap) || 0)));
}

// lineKey → { available, unlimited, name } over every orderable SKU in a
// /api/v1/shop/products payload (variant products expand to their variants).
export function indexAvailability(products) {
  const index = new Map();
  for (const p of products || []) {
    const hasVariants = Array.isArray(p.variant_axes) && p.variant_axes.length &&
                        Array.isArray(p.variants) && p.variants.length;
    if (hasVariants) {
      for (const v of p.variants) {
        if (v.active === false) continue;
        index.set(lineKey(p.id, v.id), { ...availabilityOf(p, v), name: p.name });
      }
    } else {
      index.set(lineKey(p.id, null), { ...availabilityOf(p, null), name: p.name });
    }
  }
  return index;
}

// For a stored cart line: null when it can be ordered as is, otherwise
// { available, out } — `out` when nothing is available at all. Lines whose SKU
// is missing from the catalogue are left alone (the server answers 404 for
// those with a clear message).
export function shortfallOf(line, index) {
  if (!line || !index) return null;
  const entry = index.get(lineKey(line.productId, line.variantId));
  if (!entry || entry.unlimited) return null;
  const qty = Math.max(0, Math.floor(Number(line.qty) || 0));
  if (qty <= entry.available) return null;
  return { available: Math.max(0, entry.available), out: entry.available <= 0 };
}

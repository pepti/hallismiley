// Client-side shopping cart. State lives in localStorage so guests can shop
// without any backend state and the nav badge updates across tabs/views. The
// basket is NAMESPACED PER ACCOUNT (`…::<userId>`, or `…::guest`) so one account
// never inherits another's basket on a shared browser; currency stays a global
// preference.
import { getUser } from './auth.js';

const ITEMS_NS     = 'shop.cart.items';    // per-account → `${ITEMS_NS}::${owner}`
const CURRENCY_KEY = 'shop.cart.currency'; // global preference, not account-specific

// One-time migration: drop the pre-namespacing global key so a basket left by a
// previous session/account can't leak into — or be adopted by — the next login.
try {
  localStorage.removeItem(ITEMS_NS);
} catch { /* ignore */ }

const _ownerId  = () => { const u = getUser(); return u && u.id != null ? String(u.id) : 'guest'; };
const _itemsKey = () => `${ITEMS_NS}::${_ownerId()}`;

const _listeners = new Set();

function _emit() {
  for (const fn of _listeners) {
    try { fn(); } catch (err) { console.error('[cart] listener error', err); }
  }
  // Also dispatch a DOM event so outside components can subscribe loosely.
  window.dispatchEvent(new CustomEvent('cartchange'));
}

function _load() {
  try {
    const raw = localStorage.getItem(_itemsKey());
    const items = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(items)) return [];
    return items;
  } catch {
    return [];
  }
}

function _save(items) {
  try {
    localStorage.setItem(_itemsKey(), JSON.stringify(items));
  } catch (err) {
    console.warn('[cart] failed to save', err);
  }
  _emit();
}

export function getCurrency() {
  const c = localStorage.getItem(CURRENCY_KEY);
  return c === 'EUR' ? 'EUR' : 'ISK';
}

export function setCurrency(currency) {
  if (currency !== 'ISK' && currency !== 'EUR') return;
  localStorage.setItem(CURRENCY_KEY, currency);
  _emit();
}

export function list() {
  return _load();
}

export function itemCount() {
  return _load().reduce((n, it) => n + Number(it.qty || 0), 0);
}

export function total(currency = getCurrency()) {
  const items = _load();
  return items.reduce((s, it) => {
    const price = currency === 'ISK' ? Number(it.priceIsk) : Number(it.priceEur);
    return s + price * Number(it.qty || 0);
  }, 0);
}

// A cart line is uniquely identified by variantId when a product has variants,
// otherwise by productId. We generate a stable "lineKey" the caller uses to
// update/remove the line without caring which case it is.
function lineKeyOf(line) {
  return line.variantId ? `v:${line.variantId}` : `p:${line.productId}`;
}

// Human-readable variant subtitle, e.g. "Black / M".
function variantLabel(attributes, axes) {
  if (!attributes) return null;
  const order = Array.isArray(axes) && axes.length ? axes : Object.keys(attributes);
  const bits = order
    .map(k => attributes[k])
    .filter(Boolean)
    .map(v => String(v).charAt(0).toUpperCase() + String(v).slice(1));
  return bits.length ? bits.join(' / ') : null;
}

// Add a product + variant combination. `variant` may be null for single-SKU
// products. Prices fall back from variant → product.
export function add(product, variant = null, qty = 1) {
  const items = _load();
  const lineKey = variant
    ? `v:${variant.id}`
    : `p:${product.id}`;
  const i = items.findIndex(x => lineKeyOf(x) === lineKey);
  if (i >= 0) {
    items[i].qty += qty;
  } else {
    const priceIsk = variant?.price_isk ?? product.price_isk;
    const priceEur = variant?.price_eur ?? product.price_eur;
    items.push({
      productId: product.id,
      variantId: variant?.id || null,
      variantAttributes: variant?.attributes || null,
      variantLabel: variantLabel(variant?.attributes, product.variant_axes),
      slug: product.slug,
      name: product.name,
      priceIsk,
      priceEur,
      qty,
      imageUrl: product.images?.[0]?.url || null,
    });
  }
  _save(items);
}

export function updateQty(lineKey, qty) {
  const items = _load();
  const i = items.findIndex(x => lineKeyOf(x) === lineKey);
  if (i < 0) return;
  const q = Math.max(0, Math.floor(Number(qty)));
  if (q === 0) items.splice(i, 1);
  else items[i].qty = q;
  _save(items);
}

export function remove(lineKey) {
  const items = _load().filter(x => lineKeyOf(x) !== lineKey);
  _save(items);
}

export { lineKeyOf };

export function clear() {
  localStorage.removeItem(_itemsKey());
  _emit();
}

export function subscribe(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

// Listen to storage events from other tabs so the badge stays in sync. Item keys
// are per-account (`shop.cart.items::<owner>`), so match by namespace prefix.
window.addEventListener('storage', (e) => {
  if (!e.key) return;
  if (e.key === CURRENCY_KEY || e.key.startsWith(ITEMS_NS)) _emit();
});

// The basket is keyed per account — when the signed-in user changes, re-emit so
// the cart badge + cart view re-read the now-current account's basket.
window.addEventListener('authchange', () => _emit());

export function formatMoney(amount, currency = getCurrency()) {
  if (currency === 'ISK') {
    return `${Number(amount).toLocaleString('is-IS')} kr.`;
  }
  if (currency === 'EUR') {
    return `€${(Number(amount) / 100).toFixed(2)}`;
  }
  return `${amount}`;
}

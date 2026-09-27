// ProductCard — grid tile for the shop listing.
import { formatMoney, getCurrency } from '../services/cart.js';
import { t, href } from '../i18n/i18n.js';

// Shared across ProductCard + ProductView so "low" means the same everywhere.
export const LOW_STOCK_THRESHOLD = 3;

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function stockBadgeHtml(stock) {
  // <= 0, not === 0: a short fulfilment or an admin correction can leave a
  // NEGATIVE count, which must still read as sold out (ice #202).
  if (stock <= 0) {
    return `<span class="product-card__badge product-card__badge--out"
                   data-testid="stock-badge-out">${t('shop.outOfStock')}</span>`;
  }
  if (stock > 0 && stock <= LOW_STOCK_THRESHOLD) {
    return `<span class="product-card__badge product-card__badge--low"
                   data-testid="stock-badge-low">${t('shop.lowStock', { n: stock })}</span>`;
  }
  return '';
}

// A variant product carries no product-level SKU; its first variant's stands in.
function skuOf(product) {
  return product.sku || (product.variants || []).find(v => v && v.sku)?.sku || '';
}

// `showSku`: the caller found another product with the same name on the page
// (utils/duplicateNames.js) — print the SKU under the name so the two differ.
// Ported from icelandicstore #399.
export function renderProductCard(product, { showSku = false } = {}) {
  const cur   = getCurrency();
  const price = cur === 'ISK' ? product.price_isk : product.price_eur;
  const cover = product.images?.[0]?.url || '';

  // The card shows `available` — on hand minus what paid orders already hold,
  // the only inventory number the public API sends (server models/Inventory.js).
  // The server rolls it up across active variants, so no client-side sum.
  const stock = Number(product.available ?? 0);

  const a = document.createElement('a');
  a.className = 'product-card';
  // Clean URL — the Router's click interceptor only catches `<a>` clicks whose
  // href starts with '/'. The legacy `#/shop/<slug>` form just mutates the
  // fragment and stagnates (migrateLegacyHash only runs once at boot), so
  // navigation never fires when a user clicks a card after the SPA is live.
  a.href = href(`/shop/${encodeURIComponent(product.slug)}`);
  a.setAttribute('data-testid', `product-card-${product.slug}`);
  a.innerHTML = `
    <div class="product-card__media">
      ${cover
        ? `<img src="${_esc(cover)}" alt="${_esc(product.name)}" loading="lazy"/>`
        : `<div class="product-card__placeholder" aria-hidden="true">${t('shop.noImage')}</div>`}
      ${stockBadgeHtml(stock)}
    </div>
    <div class="product-card__body">
      <h3 class="product-card__name">${_esc(product.name)}</h3>
      ${showSku && skuOf(product) ? `<p class="product-card__sku"><span class="product-card__sku-chip" data-testid="card-dup-sku">${_esc(skuOf(product))}</span></p>` : ''}
      <p class="product-card__price">${formatMoney(price, cur)}</p>
    </div>
  `;
  return a;
}

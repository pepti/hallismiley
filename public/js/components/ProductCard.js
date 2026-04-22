// ProductCard — grid tile for the shop listing.
import { formatMoney, getCurrency } from '../services/cart.js';
import { t } from '../i18n/i18n.js';

// Shared across ProductCard + ProductView so "low" means the same everywhere.
export const LOW_STOCK_THRESHOLD = 3;

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function stockBadgeHtml(stock) {
  if (stock === 0) {
    return `<span class="product-card__badge product-card__badge--out"
                   data-testid="stock-badge-out">${t('shop.outOfStock')}</span>`;
  }
  if (stock > 0 && stock <= LOW_STOCK_THRESHOLD) {
    return `<span class="product-card__badge product-card__badge--low"
                   data-testid="stock-badge-low">${t('shop.lowStock', { n: stock })}</span>`;
  }
  return '';
}

export function renderProductCard(product) {
  const cur   = getCurrency();
  const price = cur === 'ISK' ? product.price_isk : product.price_eur;
  const cover = product.images?.[0]?.url || '';

  // Stock shown on the card is the aggregate across active variants when the
  // product uses variants; otherwise the single products.stock column.
  const variants = Array.isArray(product.variants) ? product.variants.filter(v => v.active) : [];
  const stock = variants.length > 0
    ? variants.reduce((sum, v) => sum + Number(v.stock || 0), 0)
    : Number(product.stock);

  const a = document.createElement('a');
  a.className = 'product-card';
  a.href = `#/shop/${encodeURIComponent(product.slug)}`;
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
      <p class="product-card__price">${formatMoney(price, cur)}</p>
    </div>
  `;
  return a;
}

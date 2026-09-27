// Shared bits of the stock screens (harvest2-lane6a-2026-09-26): Inventory
// Watch, the stock count and goods receiving all name a "stocked unit" — a
// product without variants, or one variant — the same way, offer the same
// adjustment reasons and check a typed count the same way.
import { t, href } from '../i18n/i18n.js';
import { escHtml } from './escHtml.js';

// Mirrors Inventory.ADJUSTMENT_REASONS (server/models/Inventory.js); the
// server re-validates the choice.
export const REASONS = ['correction', 'recount', 'received', 'damaged', 'returned', 'theft_loss', 'other'];
// Mirrors Inventory.MAX_STOCK_VALUE.
export const MAX_STOCK = 100000000;

export function attrLabel(attributes) {
  if (!attributes || typeof attributes !== 'object') return '';
  return Object.values(attributes).filter(v => v != null && String(v).trim()).join(' / ');
}

// "Name — M / Red" for a variant, the plain name otherwise.
export function unitName(item) {
  if (!item) return '';
  const name = String(item.name || item.product_name || '');
  const attrs = attrLabel(item.attributes);
  return attrs ? `${name} — ${attrs}` : name;
}

// A typed count: a whole number 0..MAX_STOCK (the engine keeps stock >= 0).
// → { value } or { error: 'invalid' | 'tooLarge' }. An empty field is invalid,
// never read as 0 (ice #15).
export function parseCount(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!/^\d+$/.test(s)) return { error: 'invalid' };
  const n = Number(s);
  if (!Number.isSafeInteger(n)) return { error: 'tooLarge' };
  if (n > MAX_STOCK) return { error: 'tooLarge' };
  return { value: n };
}

// The Inventory Watch ↔ stock count switch (one view id, two routes).
export function stockTabsHtml(active) {
  const tab = (id, route, key) => {
    const on = id === active;
    return `<a class="stock-tabs__tab${on ? ' is-active' : ''}" href="${href(route)}" data-route="${route}"${on ? ' aria-current="page"' : ''}>${escHtml(t(key))}</a>`;
  };
  return `<nav class="stock-tabs" aria-label="${escHtml(t('adminInventory.tabsLabel'))}">
    ${tab('inventory', '/admin/inventory', 'adminInventory.title')}
    ${tab('count', '/admin/stock-count', 'adminStockCount.title')}
  </nav>`;
}

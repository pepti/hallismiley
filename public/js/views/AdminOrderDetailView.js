// AdminOrderDetailView (/admin/shop/orders/:id) — single-order back office:
// independent payment + fulfillment status with mark-* actions, line items,
// totals, customer info, order tags, and the delivery-note PDF link.
import { isAuthenticated, isAdmin } from '../services/auth.js';
import { fetchOrder, setOrderStatuses, setOrderTags, paymentBadge, fulfillmentBadge } from '../services/adminOrders.js';
import { escHtml } from '../utils/escHtml.js';
import { t, href } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { showToast } from '../components/Toast.js';
import * as cart from '../services/cart.js';

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export class AdminOrderDetailView {
  constructor(id) { this._id = id; this._el = null; this._order = null; this._items = []; }

  async render() {
    if (!isAuthenticated() || !isAdmin()) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }
    this._el = document.createElement('div');
    this._el.className = 'main admin-page ord-detail';
    this._el.innerHTML = `<div class="admin-loading">${t('form.loading')}</div>`;
    await this._load();
    return renderAdminShell({ activePath: '/admin/shop/orders', content: this._el });
  }

  async _load() {
    try {
      const data = await fetchOrder(this._id);
      this._order = data.order;
      this._items = data.items || [];
      this._paint();
    } catch (err) {
      this._el.innerHTML = `<p class="admin-error">${escHtml(err.message)}</p>
        <p><a class="btn btn--ghost" href="${href('/admin/shop/orders')}" data-route="/admin/shop/orders">← ${t('adminOrders.title')}</a></p>`;
    }
  }

  _paint() {
    const o = this._order;
    const money = (v) => cart.formatMoney(v, o.currency);
    const customer = o.user_email || o.guest_email || o.guest_name || '—';

    this._el.innerHTML = `
      <p class="ord-detail__back">
        <a href="${href('/admin/shop/orders')}" data-route="/admin/shop/orders">← ${t('adminOrders.title')}</a>
      </p>
      <div class="ord-detail__head">
        <div>
          <h1 class="admin-title"><code>${escHtml(o.order_number)}</code></h1>
          <p class="ord-detail__date">${fmtDate(o.created_at)}</p>
        </div>
        <div class="ord-detail__badges">
          ${paymentBadge(t, o.payment_status)}
          ${fulfillmentBadge(t, o.fulfillment_status)}
        </div>
      </div>

      <div class="ord-detail__grid">
        <section class="ord-detail__card">
          <h2>${t('adminOrders.items')}</h2>
          <table class="admin-table ord-detail__items">
            <thead><tr><th>${t('adminOrders.item')}</th><th>${t('adminOrders.qty')}</th><th>${t('orders.total')}</th></tr></thead>
            <tbody>
              ${this._items.map(it => `
                <tr>
                  <td>${escHtml(it.product_name_snapshot)}</td>
                  <td>${it.quantity}</td>
                  <td>${money(it.product_price_snapshot * it.quantity)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
          <dl class="ord-detail__totals">
            <div><dt>${t('checkout.subtotal')}</dt><dd>${money(o.subtotal)}</dd></div>
            <div><dt>${t('checkout.shipping')}</dt><dd>${money(o.shipping)}</dd></div>
            ${o.discount_amount ? `<div><dt>${t('adminOrders.discount')}${o.discount_code ? ` (${escHtml(o.discount_code)})` : ''}</dt><dd>−${money(o.discount_amount)}</dd></div>` : ''}
            <div class="ord-detail__grand"><dt>${t('orders.total')}</dt><dd>${money(o.total)}</dd></div>
          </dl>
          <p><a class="ord-detail__pdf" href="/api/v1/admin/shop/orders/${escHtml(o.id)}/delivery-note" target="_blank" rel="noopener">${t('adminOrders.deliveryNote')}</a></p>
        </section>

        <aside class="ord-detail__side">
          <section class="ord-detail__card">
            <h2>${t('adminOrders.customer')}</h2>
            <p>${escHtml(customer)}</p>
            ${o.user_email ? `<p class="ord-detail__muted">${t('adminOrders.ordersCount', { n: o.user_order_count })}</p>` : `<p class="ord-detail__muted">${t('adminOrders.guest')}</p>`}
          </section>

          <section class="ord-detail__card">
            <h2>${t('adminOrders.payment')}</h2>
            <div class="ord-detail__actions">
              ${o.payment_status !== 'paid'     ? `<button type="button" class="btn btn--sm" data-pay="paid">${t('adminOrders.markPaid')}</button>` : ''}
              ${o.payment_status === 'paid'     ? `<button type="button" class="btn btn--sm btn--ghost" data-pay="refunded">${t('adminOrders.markRefunded')}</button>` : ''}
              ${o.payment_status !== 'pending'  ? `<button type="button" class="btn btn--sm btn--ghost" data-pay="pending">${t('adminOrders.markUnpaid')}</button>` : ''}
            </div>
            <h2>${t('adminOrders.fulfillment')}</h2>
            <div class="ord-detail__actions">
              ${o.fulfillment_status === 'unfulfilled' ? `<button type="button" class="btn btn--sm" data-ful="fulfilled">${t('adminOrders.markFulfilled')}</button>` : ''}
              ${o.fulfillment_status === 'fulfilled'   ? `<button type="button" class="btn btn--sm" data-ful="delivered">${t('adminOrders.markDelivered')}</button>` : ''}
              ${o.fulfillment_status !== 'unfulfilled' ? `<button type="button" class="btn btn--sm btn--ghost" data-ful="unfulfilled">${t('adminOrders.markUnfulfilled')}</button>` : ''}
            </div>
          </section>

          <section class="ord-detail__card">
            <h2>${t('adminOrders.tags')}</h2>
            <div class="ord-detail__tags" id="ord-tags">${this._tagsHtml()}</div>
            <form class="ord-detail__tag-form" id="ord-tag-form">
              <input type="text" id="ord-tag-input" maxlength="40" placeholder="${t('adminOrders.addTag')}" autocomplete="off"/>
              <button type="submit" class="btn btn--sm btn--ghost">${t('adminOrders.addTag')}</button>
            </form>
          </section>
        </aside>
      </div>
    `;
    this._bind();
  }

  _tagsHtml() {
    const tags = Array.isArray(this._order.tags) ? this._order.tags : [];
    if (!tags.length) return `<p class="ord-detail__muted">${t('adminOrders.noTags')}</p>`;
    return tags.map(tag =>
      `<span class="ord-tag">${escHtml(tag)}<button type="button" class="ord-tag__x" data-rm-tag="${escHtml(tag)}" aria-label="${t('admin.delete')}">×</button></span>`
    ).join('');
  }

  _bind() {
    this._el.querySelectorAll('[data-pay]').forEach(b =>
      b.addEventListener('click', () => this._setStatus({ payment_status: b.dataset.pay })));
    this._el.querySelectorAll('[data-ful]').forEach(b =>
      b.addEventListener('click', () => this._setStatus({ fulfillment_status: b.dataset.ful })));
    this._el.querySelectorAll('[data-rm-tag]').forEach(b =>
      b.addEventListener('click', () => {
        const next = (this._order.tags || []).filter(x => x !== b.dataset.rmTag);
        this._saveTags(next);
      }));
    const form = this._el.querySelector('#ord-tag-form');
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = this._el.querySelector('#ord-tag-input');
      const val = (input.value || '').trim();
      if (!val) return;
      const next = [...(this._order.tags || []), val];
      this._saveTags(next);
    });
  }

  async _setStatus(body) {
    try {
      this._order = await setOrderStatuses(this._id, body);
      this._paint();
      showToast(t('form.saved'), 'success');
    } catch (err) { showToast(err.message, 'error'); }
  }

  async _saveTags(tags) {
    try {
      this._order = await setOrderTags(this._id, tags);
      this._paint();
    } catch (err) { showToast(err.message, 'error'); }
  }

  destroy() {}
}

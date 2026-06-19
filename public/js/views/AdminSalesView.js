// AdminSalesView (/admin/sales) — paid-order sales report: summary cards
// (orders + revenue per currency), an orders-per-day line chart (lazy-loaded
// vendored Chart.js, same as the analytics dashboard), and top products by
// units. Standalone admin page. Read-only over the orders/order_items tables.
import { isAuthenticated, isAdmin } from '../services/auth.js';
import { escHtml } from '../utils/escHtml.js';
import { t, href } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import * as cart from '../services/cart.js';

const RANGES = [7, 30, 90];

export class AdminSalesView {
  constructor() { this._el = null; this._days = 30; this._chart = null; this._destroyed = false; }

  async render() {
    if (!isAuthenticated() || !isAdmin()) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }
    this._el = document.createElement('div');
    this._el.className = 'main admin-page sales-page';
    this._el.innerHTML = `
      <div class="sales-head">
        <h1 class="admin-title">${t('adminSales.title')}</h1>
        <div class="sales-ranges">
          ${RANGES.map(r => `<button type="button" class="sales-range${r === this._days ? ' is-active' : ''}" data-days="${r}">${t('adminSales.range' + r)}</button>`).join('')}
        </div>
      </div>
      <div id="sales-body"><div class="admin-loading">${t('form.loading')}</div></div>
    `;
    this._el.querySelectorAll('.sales-range').forEach(b => b.addEventListener('click', () => {
      this._days = Number(b.dataset.days);
      this._el.querySelectorAll('.sales-range').forEach(x => x.classList.toggle('is-active', x === b));
      this._load();
    }));
    await this._load();
    return renderAdminShell({ activePath: '/admin/sales', content: this._el });
  }

  destroy() {
    this._destroyed = true;
    if (this._chart) { this._chart.destroy(); this._chart = null; }
  }

  async _load() {
    const body = this._el.querySelector('#sales-body');
    body.innerHTML = `<div class="admin-loading">${t('form.loading')}</div>`;
    if (this._chart) { this._chart.destroy(); this._chart = null; }
    try {
      const res  = await fetch('/api/v1/admin/shop/reports?days=' + this._days, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load report');
      this._paint(data.report);
    } catch (err) {
      body.innerHTML = `<p class="admin-error">${escHtml(err.message)}</p>`;
    }
  }

  _paint(r) {
    const body = this._el.querySelector('#sales-body');
    const revCards = (r.revenueByCurrency || []).map(rc =>
      `<div class="sales-card">
         <div class="sales-card__label">${t('adminSales.revenue')} (${escHtml(rc.currency)})</div>
         <div class="sales-card__value">${cart.formatMoney(rc.revenue, rc.currency)}</div>
       </div>`).join('');
    const top = r.topProducts || [];
    body.innerHTML = `
      <div class="sales-cards">
        <div class="sales-card">
          <div class="sales-card__label">${t('adminSales.orders')}</div>
          <div class="sales-card__value">${r.orders}</div>
        </div>
        ${revCards}
      </div>
      <div class="sales-chart-wrap"><canvas id="sales-chart"></canvas></div>
      <h2 class="sales-subtitle">${t('adminSales.topProducts')}</h2>
      ${top.length ? `<table class="admin-table sales-top">
        <thead><tr><th>${t('adminSales.product')}</th><th>${t('adminSales.units')}</th></tr></thead>
        <tbody>${top.map(p => `<tr><td>${escHtml(p.name)}</td><td>${p.qty}</td></tr>`).join('')}</tbody>
      </table>` : `<p>${t('adminSales.noData')}</p>`}
    `;
    this._renderChart(r.byDay || []);
  }

  async _renderChart(byDay) {
    let Chart;
    try { if (!window.Chart) await import('/js/vendor/chart.umd.js'); Chart = window.Chart; } catch { return; }
    if (!Chart || this._destroyed) return;
    const canvas = this._el.querySelector('#sales-chart');
    if (!canvas) return;
    const css    = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue('--gold').trim() || '#C8AA6E';
    const axis   = css.getPropertyValue('--text-muted').trim() || '#888';
    Chart.defaults.color = axis;
    Chart.defaults.font.family = "'Barlow', 'Inter', system-ui, sans-serif";
    this._chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: byDay.map(d => d.date),
        datasets: [{
          label: t('adminSales.ordersPerDay'),
          data: byDay.map(d => d.orders),
          borderColor: accent, backgroundColor: 'transparent', tension: 0.25, pointRadius: 2,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
      },
    });
  }
}

// AdminSalesView (/admin/sales) — the sales report (harvest 2 lane 5,
// 2026-09-26; icelandicstore #414 and #419 on the engine's own report).
//
//   * Period presets (utils/dateRanges.js — Í dag, Þessi mánuður, Á árinu …)
//     replace the fixed 7/30/90 buttons; the choice is remembered per browser
//     (utils/localPref.js, try/catch inside) and the exact dates are printed
//     under the picker with the window they are compared against.
//   * Every KPI shows its change against that comparison window: up on
//     --success, down on --error, "—" when there is nothing to compare with.
//   * Net sales ("Sala án VSK") are the headline per currency, the amount with
//     VAT under it (migration 121's snapshot). Money is never summed across
//     currencies.
//   * The chart follows the period — by the hour, day, week or month — and
//     draws a quiet bucket as 0. A canvas does not react to the data-theme
//     flip, so its colours are read from utils/chartTheme.js at draw time and
//     it is redrawn on `themechange`.
//   * Below: the insights (fulfilment time, new and dormant customers) and the
//     marketing overview (visits by channel, sales with a discount,
//     campaigns). Each is its OWN request, so the sales block paints first and
//     never waits for them; a failed one says so in its own place.
//
// The server gates every block (the `sales` view on the route; customer names
// and the traffic block narrower still); this view only renders what it is sent.
import { isAuthenticated, canSeeView } from '../services/auth.js';
import { escHtml } from '../utils/escHtml.js';
import { formatMoney, formatNumber, formatDate } from '../utils/format.js';
import { readPref, writePref } from '../utils/localPref.js';
import { chartTokens } from '../utils/chartTheme.js';
import {
  PRESETS, DEFAULT_PRESET, resolvePreset, granularity, fillSeries, formatRange, bucketLabel, percentChange,
} from '../utils/dateRanges.js';
import { t, href, plural, getLocale } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';

const PREF_KEY = 'admin.sales.preset';
const API = '/api/v1/admin/shop/reports';

async function getJson(url) {
  const res = await fetch(url, { credentials: 'include' });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error((data && data.error) || t('adminSales.loadFailed'));
  return data;
}

// "+12 %" / "−8 %" on the status tokens; "—" when there is no base.
function changeHtml(cur, prev) {
  const pct = percentChange(cur, prev);
  const label = escHtml(t('adminSales.changeLabel'));
  if (pct === null) {
    return `<span class="sales-delta sales-delta--none" title="${escHtml(t('adminSales.noBase'))}">—</span>`;
  }
  const r = Math.round(pct);
  const cls = r > 0 ? 'up' : r < 0 ? 'down' : 'flat';
  const sign = r > 0 ? '+' : r < 0 ? '−' : '±';
  return `<span class="sales-delta sales-delta--${cls}" title="${label}"><span class="sales-sr">${label}: </span>${sign}${escHtml(formatNumber(Math.abs(r)))}${getLocale() === 'is' ? ' %' : '%'}</span>`;
}

// 4 h 12 min → "4,2 klst."; under an hour in minutes; two days and more in days.
function duration(seconds) {
  const s = Number(seconds) || 0;
  if (s < 3600) return t('adminSales.duration.minutes', { n: formatNumber(Math.max(1, Math.round(s / 60))) });
  if (s < 48 * 3600) return t('adminSales.duration.hours', { n: formatNumber(Math.round(s / 360) / 10) });
  const d = Math.round(s / 8640) / 10;
  return plural(d, 'adminSales.duration.days.one', 'adminSales.duration.days.many', { n: formatNumber(d) });
}

export class AdminSalesView {
  constructor() {
    this._el = null;
    this._chart = null;
    this._destroyed = false;
    this._gen = 0;
    const saved = readPref(PREF_KEY, DEFAULT_PRESET);
    this._preset = PRESETS.includes(saved) ? saved : DEFAULT_PRESET;
    this._shown = this._preset; // the preset whose report is on screen
    this._report = null;
    this._window = null;
    this._onTheme = () => { if (this._report) this._renderChart(); };
  }

  async render() {
    if (!isAuthenticated() || !canSeeView('sales')) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }
    this._el = document.createElement('div');
    this._el.className = 'main admin-page sales-page';
    this._el.innerHTML = `
      <div class="sales-head">
        <h1 class="admin-title">${escHtml(t('adminSales.title'))}</h1>
        <div class="sales-period">
          <label class="sales-period__label" for="sales-preset">${escHtml(t('adminSales.period'))}</label>
          <select id="sales-preset" class="form-input sales-period__select">
            ${PRESETS.map(p => `<option value="${p}"${p === this._preset ? ' selected' : ''}>${escHtml(t(`adminSales.preset.${p}`))}</option>`).join('')}
          </select>
          <p class="sales-period__dates" id="sales-dates" aria-live="polite"></p>
        </div>
      </div>
      <div id="sales-body"><div class="admin-loading">${escHtml(t('form.loading'))}</div></div>
      <div id="sales-insights" class="sales-section"></div>
      <div id="sales-marketing" class="sales-section"></div>
    `;
    this._el.querySelector('#sales-preset').addEventListener('change', (e) => {
      this._preset = e.target.value;
      this._load();
    });
    window.addEventListener('themechange', this._onTheme);
    await this._load();
    return renderAdminShell({ activePath: '/admin/sales', content: this._el });
  }

  destroy() {
    this._destroyed = true;
    window.removeEventListener('themechange', this._onTheme);
    if (this._chart) { this._chart.destroy(); this._chart = null; }
  }

  _query(w, { compare = false, bucket = null } = {}) {
    const p = new URLSearchParams({ from: w.from, to: w.to });
    if (compare && w.prevFrom) { p.set('compare_from', w.prevFrom); p.set('compare_to', w.prevCut); }
    if (bucket) p.set('bucket', bucket);
    return p.toString();
  }

  async _load() {
    const gen = ++this._gen;
    const w = resolvePreset(this._preset);
    const gran = granularity(w.from, w.to);
    const body = this._el.querySelector('#sales-body');
    body.setAttribute('aria-busy', 'true');

    // The two analyses start now, in parallel, and paint whenever they land.
    this._loadInsights(gen, w);
    this._loadMarketing(gen, w);

    let data;
    try {
      data = await getJson(`${API}?${this._query(w, { compare: true, bucket: gran })}`);
    } catch (err) {
      if (gen !== this._gen || this._destroyed) return;
      body.removeAttribute('aria-busy');
      // The picker goes back to what is on screen; the error says why.
      this._preset = this._shown;
      const sel = this._el.querySelector('#sales-preset');
      if (sel) sel.value = this._shown;
      const note = this._el.querySelector('#sales-error') || document.createElement('p');
      note.id = 'sales-error';
      note.className = 'admin-error';
      note.setAttribute('role', 'alert');
      note.textContent = err.message;
      if (!note.isConnected) body.prepend(note);
      return;
    }
    if (gen !== this._gen || this._destroyed) return;
    body.removeAttribute('aria-busy');
    this._shown = this._preset;
    writePref(PREF_KEY, this._preset);
    this._window = { ...w, gran };
    this._report = data.report;
    this._paintDates(w);
    this._paint(data.report);
  }

  _paintDates(w) {
    const loc = getLocale();
    const range = formatRange(w.from, w.to, loc);
    const cmp = w.prevFrom
      ? t('adminSales.comparedWith', { range: formatRange(w.prevFrom, w.prevTo, loc) })
      : t('adminSales.noComparison');
    this._el.querySelector('#sales-dates').textContent = `${range} · ${cmp}`;
  }

  _paint(r) {
    const body = this._el.querySelector('#sales-body');
    const prevBy = new Map(((r.kpisPrev && r.kpisPrev.byCurrency) || []).map(c => [c.currency, c]));
    const hasPrev = Boolean(r.kpisPrev);
    const cmp = (cur, prev) => (hasPrev ? changeHtml(cur, prev) : '');
    const currencies = (r.kpis.byCurrency || []).length ? r.kpis.byCurrency : [{
      currency: 'ISK', orders: 0, revenue: 0, vat: 0, revenue_net: 0, avg_order_value_net: 0,
    }];
    const zero = { orders: 0, revenue: 0, vat: 0, revenue_net: 0, avg_order_value_net: 0 };

    const blocks = currencies.map((c) => {
      const p = prevBy.get(c.currency) || zero;
      return `<div class="sales-cards" data-currency="${escHtml(c.currency)}">
        <div class="sales-card sales-card--headline">
          <div class="sales-card__label">${escHtml(t('adminSales.netSales', { currency: c.currency }))}</div>
          <div class="sales-card__value">${escHtml(formatMoney(c.revenue_net, c.currency))} ${cmp(c.revenue_net, p.revenue_net)}</div>
          <div class="sales-card__sub">${escHtml(t('adminSales.grossSales', { amount: formatMoney(c.revenue, c.currency) }))}</div>
        </div>
        <div class="sales-card">
          <div class="sales-card__label">${escHtml(t('adminSales.avgOrderNet', { currency: c.currency }))}</div>
          <div class="sales-card__value">${escHtml(formatMoney(c.avg_order_value_net, c.currency))} ${cmp(c.avg_order_value_net, p.avg_order_value_net)}</div>
        </div>
        <div class="sales-card">
          <div class="sales-card__label">${escHtml(t('adminSales.vat', { currency: c.currency }))}</div>
          <div class="sales-card__value">${escHtml(formatMoney(c.vat, c.currency))} ${cmp(c.vat, p.vat)}</div>
        </div>
      </div>`;
    }).join('');

    const top = r.topProducts || [];
    body.innerHTML = `
      <div class="sales-cards sales-cards--count">
        <div class="sales-card">
          <div class="sales-card__label">${escHtml(t('adminSales.orders'))}</div>
          <div class="sales-card__value">${escHtml(formatNumber(r.kpis.orders))} ${cmp(r.kpis.orders, hasPrev ? r.kpisPrev.orders : 0)}</div>
        </div>
      </div>
      ${blocks}
      <div class="sales-chart-wrap"><canvas id="sales-chart" role="img" aria-label="${escHtml(t('adminSales.chartLabel'))}"></canvas></div>
      <h2 class="sales-subtitle">${escHtml(t('adminSales.topProducts'))}</h2>
      ${top.length ? `<div class="admin-table-wrap"><table class="admin-table sales-top">
        <thead><tr><th>${escHtml(t('adminSales.product'))}</th><th class="num">${escHtml(t('adminSales.units'))}</th></tr></thead>
        <tbody>${top.map(p => `<tr><td>${escHtml(p.name)}</td><td class="num">${escHtml(formatNumber(p.qty))}</td></tr>`).join('')}</tbody>
      </table></div>` : `<p class="sales-empty">${escHtml(t('adminSales.noData'))}</p>`}
    `;
    this._renderChart();
  }

  // The chart's currency: ISK when the window sold in ISK, else the first one.
  _chartSeries() {
    const r = this._report;
    const w = this._window;
    const currencies = (r.kpis.byCurrency || []).map(c => c.currency);
    const currency = currencies.includes('ISK') || !currencies.length ? 'ISK' : currencies[0];
    const money = fillSeries((r.series || []).filter(p => p.currency === currency),
      { from: w.from, to: w.to, gran: w.gran, fields: ['revenue_net'], trimLeading: w.preset === 'all', until: Date.now() });
    const counts = fillSeries(r.series || [],
      { from: w.from, to: w.to, gran: w.gran, fields: ['orders'], trimLeading: w.preset === 'all', until: Date.now() });
    const orders = new Map(counts.map(b => [b.key, b.orders]));
    const keys = [...new Set([...money.map(b => b.key), ...counts.map(b => b.key)])].sort();
    const net = new Map(money.map(b => [b.key, b.revenue_net]));
    return { currency, keys, net: keys.map(k => net.get(k) || 0), orders: keys.map(k => orders.get(k) || 0) };
  }

  async _renderChart() {
    let Chart;
    try { if (!window.Chart) await import('../vendor/chart.umd.js'); Chart = window.Chart; } catch { return; }
    if (!Chart || this._destroyed || !this._report) return;
    const canvas = this._el.querySelector('#sales-chart');
    if (!canvas) return;
    if (this._chart) { this._chart.destroy(); this._chart = null; }
    const s = this._chartSeries();
    const loc = getLocale();
    // Live tokens, read at draw time — a canvas doesn't react to data-theme.
    const ct = chartTokens();
    Chart.defaults.color = ct.axis;
    Chart.defaults.borderColor = ct.grid;
    Chart.defaults.font.family = ct.font;
    const minor = s.currency === 'ISK' ? 1 : 100;
    this._chart = new Chart(canvas, {
      data: {
        labels: s.keys.map(k => bucketLabel(k, this._window.gran, loc)),
        datasets: [
          {
            type: 'bar', label: `${t('adminSales.chartNet')} (${s.currency})`, yAxisID: 'y',
            data: s.net.map(v => v / minor), backgroundColor: ct.fill(ct.accent, 55), borderColor: ct.accent, borderWidth: 1,
          },
          {
            type: 'line', label: t('adminSales.chartOrders'), yAxisID: 'y1',
            data: s.orders, borderColor: ct.info, backgroundColor: 'transparent', tension: 0.25, pointRadius: 2,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom' } },
        scales: {
          y: { beginAtZero: true, position: 'left' },
          y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { precision: 0 } },
        },
      },
    });
  }

  // ── Insights (icelandicstore #419) ─────────────────────────────────────────
  async _loadInsights(gen, w) {
    const host = this._el.querySelector('#sales-insights');
    host.innerHTML = `<div class="admin-loading">${escHtml(t('form.loading'))}</div>`;
    let data;
    try {
      data = await getJson(`${API}/insights?${this._query(w)}`);
    } catch {
      if (gen !== this._gen || this._destroyed) return;
      host.innerHTML = `<p class="admin-error" role="alert">${escHtml(t('adminSales.insightsFailed'))}</p>`;
      return;
    }
    if (gen !== this._gen || this._destroyed) return;
    host.innerHTML = this._insightsHtml(data.insights);
  }

  _customerList(rows, extra) {
    if (!Array.isArray(rows) || !rows.length) return '';
    return `<ol class="sales-customers">${rows.map(c => `<li>
        <span class="sales-customers__name">${escHtml(c.name || '—')}</span>
        <span class="sales-customers__meta">${escHtml(plural(c.orders, 'adminSales.customer.orders.one', 'adminSales.customer.orders.many', { n: formatNumber(c.orders) }))}${extra(c)}</span>
        <span class="sales-customers__amount">${escHtml(formatMoney(c.net, c.currency))}</span>
      </li>`).join('')}</ol>`;
  }

  _insightsHtml(i) {
    const f = i.fulfilment;
    const fulfil = f.count
      ? `<div class="sales-insight__value">${escHtml(duration(f.medianSeconds))}</div>
         <div class="sales-insight__sub">${escHtml(t('adminSales.fulfilment.median'))} · ${escHtml(t('adminSales.fulfilment.average', { time: duration(f.averageSeconds) }))}</div>
         <div class="sales-insight__sub">${escHtml(plural(f.count, 'adminSales.fulfilment.count.one', 'adminSales.fulfilment.count.many', { n: formatNumber(f.count) }))}</div>`
      : `<p class="sales-empty">${escHtml(t('adminSales.fulfilment.none'))}</p>`;
    const n = i.newCustomers;
    const fresh = n.count
      ? `<div class="sales-insight__value">${escHtml(formatNumber(n.count))}</div>
         <div class="sales-insight__sub">${escHtml(plural(n.count, 'adminSales.newCustomers.lead.one', 'adminSales.newCustomers.lead.many', { n: formatNumber(n.count) }))}</div>
         ${this._customerList(n.top, () => '')}`
      : `<p class="sales-empty">${escHtml(t('adminSales.newCustomers.none'))}</p>`;
    const d = i.dormant;
    const asleep = d.count
      ? `<div class="sales-insight__value">${escHtml(formatNumber(d.count))}</div>
         <div class="sales-insight__sub">${escHtml(plural(d.count, 'adminSales.dormant.lead.one', 'adminSales.dormant.lead.many', { n: formatNumber(d.count), days: d.days }))}</div>
         ${this._customerList(d.top, c => ` · ${escHtml(t('adminSales.customer.lastOrder', { date: formatDate(c.last_paid) }))}`)}`
      : `<p class="sales-empty">${escHtml(t('adminSales.dormant.none'))}</p>`;
    return `<div class="sales-insights">
      <section class="sales-insight" data-insight="fulfilment">
        <h2 class="sales-insight__title">${escHtml(t('adminSales.fulfilment.title'))}</h2>
        <p class="sales-insight__note">${escHtml(t('adminSales.fulfilment.basis'))}</p>${fulfil}
      </section>
      <section class="sales-insight" data-insight="new">
        <h2 class="sales-insight__title">${escHtml(t('adminSales.newCustomers.title'))}</h2>${fresh}
      </section>
      <section class="sales-insight sales-insight--now" data-insight="dormant">
        <h2 class="sales-insight__title">${escHtml(t('adminSales.dormant.title'))}</h2>
        <p class="sales-insight__note">${escHtml(t('adminSales.dormant.now'))}</p>${asleep}
      </section>
    </div>`;
  }

  // ── Marketing overview ─────────────────────────────────────────────────────
  async _loadMarketing(gen, w) {
    const host = this._el.querySelector('#sales-marketing');
    host.innerHTML = '';
    let data;
    try {
      data = await getJson(`${API}/marketing?${this._query(w)}`);
    } catch {
      if (gen !== this._gen || this._destroyed) return;
      host.innerHTML = `<p class="admin-error" role="alert">${escHtml(t('adminSales.marketingFailed'))}</p>`;
      return;
    }
    if (gen !== this._gen || this._destroyed) return;
    host.innerHTML = this._marketingHtml(data.marketing);
    // Bar widths through the CSSOM, never a style="" attribute (CSP).
    host.querySelectorAll('[data-share]').forEach((el) => {
      el.style.inlineSize = `${Math.max(0, Math.min(100, Number(el.dataset.share) || 0))}%`;
    });
  }

  _marketingHtml(m) {
    const parts = [];
    if (m.traffic) {
      const tr = m.traffic;
      const rows = tr.channels.map((c) => {
        const share = tr.total ? Math.round((c.sessions / tr.total) * 100) : 0;
        return `<li class="sales-channel" data-channel="${escHtml(c.channel)}">
          <span class="sales-channel__name">${escHtml(t(`adminSales.traffic.channel.${c.channel}`))}</span>
          <span class="sales-channel__bar" aria-hidden="true"><span class="sales-channel__fill" data-share="${share}"></span></span>
          <span class="sales-channel__n">${escHtml(formatNumber(c.sessions))}</span>
          <span class="sales-channel__pct">${escHtml(formatNumber(share))}${getLocale() === 'is' ? ' %' : '%'}</span>
        </li>`;
      }).join('');
      const refs = tr.topReferrers.length
        ? `<p class="sales-insight__sub">${escHtml(t('adminSales.traffic.topReferrers'))}: ${tr.topReferrers.map(r => `${escHtml(r.host)} (${escHtml(formatNumber(r.sessions))})`).join(', ')}</p>`
        : '';
      parts.push(`<section class="sales-insight sales-insight--wide" data-marketing="traffic">
        <h3 class="sales-insight__title">${escHtml(t('adminSales.traffic.title'))}</h3>
        <p class="sales-insight__note">${escHtml(t('adminSales.traffic.note'))}</p>
        ${tr.total ? `<div class="sales-insight__sub">${escHtml(plural(tr.total, 'adminSales.traffic.total.one', 'adminSales.traffic.total.many', { n: formatNumber(tr.total) }))}</div>
          <ul class="sales-channels">${rows}</ul>${refs}` : `<p class="sales-empty">${escHtml(t('adminSales.traffic.none'))}</p>`}
      </section>`);
    }
    const sales = m.discountSales || [];
    parts.push(`<section class="sales-insight" data-marketing="discounts">
      <h3 class="sales-insight__title">${escHtml(t('adminSales.discounts.title'))}</h3>
      ${sales.length ? sales.map(s => `<div class="sales-discount" data-currency="${escHtml(s.currency)}">
          <div class="sales-insight__value">${escHtml(formatMoney(s.discountedNet, s.currency))}</div>
          <div class="sales-insight__sub">${escHtml(t('adminSales.discounts.share', { used: formatNumber(s.discountedOrders), orders: formatNumber(s.orders) }))}</div>
          <div class="sales-insight__sub">${escHtml(t('adminSales.discounts.given', { amount: formatMoney(s.discountGiven, s.currency) }))}</div>
        </div>`).join('') : `<p class="sales-empty">${escHtml(t('adminSales.discounts.none'))}</p>`}
    </section>`);
    const camps = m.campaigns || [];
    const money = list => (list.length ? list.map(x => formatMoney(x.net, x.currency)).join(' · ') : '—');
    const given = list => (list.length ? list.map(x => formatMoney(x.discount, x.currency)).join(' · ') : '—');
    parts.push(`<section class="sales-insight sales-insight--wide" data-marketing="campaigns">
      <h3 class="sales-insight__title">${escHtml(t('adminSales.campaigns.title'))}</h3>
      ${camps.length ? `<div class="admin-table-wrap"><table class="admin-table sales-campaigns">
        <thead><tr>
          <th>${escHtml(t('adminSales.campaigns.code'))}</th><th>${escHtml(t('adminSales.campaigns.status'))}</th>
          <th class="num">${escHtml(t('adminSales.campaigns.orders'))}</th><th class="num">${escHtml(t('adminSales.campaigns.net'))}</th>
          <th class="num">${escHtml(t('adminSales.campaigns.discount'))}</th><th class="num">${escHtml(t('adminSales.campaigns.uses'))}</th>
        </tr></thead>
        <tbody>${camps.map(c => `<tr>
          <td><code>${escHtml(c.code)}</code><span class="sales-campaigns__title">${escHtml(c.title)}</span></td>
          <td><span class="sales-status sales-status--${escHtml(c.status)}">${escHtml(t(`adminSales.campaigns.state.${c.status}`))}</span></td>
          <td class="num">${escHtml(formatNumber(c.orders))}</td>
          <td class="num">${escHtml(money(c.sales))}</td>
          <td class="num">${escHtml(given(c.sales))}</td>
          <td class="num">${escHtml(formatNumber(c.used_count))}${c.usage_limit ? ` / ${escHtml(formatNumber(c.usage_limit))}` : ''}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : `<p class="sales-empty">${escHtml(t('adminSales.campaigns.none'))}</p>`}
    </section>`);
    return `<h2 class="sales-subtitle">${escHtml(t('adminSales.marketing.title'))}</h2>
      <div class="sales-insights">${parts.join('')}</div>`;
  }
}

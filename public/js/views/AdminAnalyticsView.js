import { isAuthenticated, isAdmin } from '../services/auth.js';
import { escHtml } from '../utils/escHtml.js';
import { t } from '../i18n/i18n.js';
import { renderAdminShell } from '../components/AdminSidebar.js';

const RANGES  = [7, 30, 90];
// Palette drawn from the site's design tokens (variables.css).
const GOLD    = '#C8AA6E'; // --gold
const TEAL    = '#0BC4E3'; // --teal
const PALETTE = ['#C8AA6E', '#0BC4E3', '#A9B4C0', '#4caf78', '#e05c5c', '#785A28', '#8c6aaf', '#A08B6A'];
const AXIS    = '#A9B4C0'; // --text-secondary
const GRID    = 'rgba(120, 90, 40, 0.3)'; // --border-dim

export class AdminAnalyticsView {
  constructor() {
    this._el         = null;
    this._charts     = [];
    this._range      = 30;
    this._gen        = 0;
    this._destroyed  = false;
    this._pagesSort  = null;
    this._refsSort   = null;
    this._onClick    = this._onClick.bind(this);
    this._onKeydown  = this._onKeydown.bind(this);
  }

  async render() {
    const el = document.createElement('div');
    el.className = 'view admin-analytics-view';
    this._el = el;

    if (!isAuthenticated() || !isAdmin()) {
      el.innerHTML = `<div class="analytics-error"><p>${t('analytics.accessRequired')}</p></div>`;
      return el;
    }

    // Delegated listeners on the persistent root survive in-place table
    // re-renders, so they're bound once here rather than per render pass.
    el.addEventListener('click', this._onClick);
    el.addEventListener('keydown', this._onKeydown);

    el.innerHTML = `<div class="analytics-loading">${t('form.loading')}</div>`;
    try {
      await this._loadAndRender();
    } catch {
      el.innerHTML = `<div class="analytics-error"><p>${t('analytics.loadError')}</p></div>`;
    }
    return renderAdminShell({ activePath: '/admin/analytics', content: el });
  }

  // Router calls this on navigation away — tear down chart instances so we
  // don't leak detached <canvas> + listeners every time the admin leaves.
  destroy() {
    this._destroyed = true;
    this._destroyCharts();
  }

  _destroyCharts() {
    this._charts.forEach(c => { try { c.destroy(); } catch { /* already gone */ } });
    this._charts = [];
  }

  _rangeDates() {
    const fmt = d => d.toISOString().slice(0, 10);
    return {
      from: fmt(new Date(Date.now() - (this._range - 1) * 86400000)),
      to:   fmt(new Date()),
    };
  }

  async _loadAndRender() {
    this._destroyCharts();
    const gen = ++this._gen;

    const { from, to } = this._rangeDates();
    const qs = `?from=${from}&to=${to}`;
    const get = (path) => fetch(`/api/v1/admin/analytics/${path}${qs}`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))));

    const [summary, timeseries, topPages, topReferrers, devices, conversions] = await Promise.all([
      get('summary'), get('timeseries'), get('top-pages'),
      get('top-referrers'), get('devices'), get('conversions'),
    ]);
    if (gen !== this._gen || this._destroyed) return; // superseded by a newer range

    this._summary      = summary || {};
    this._timeseries   = Array.isArray(timeseries)   ? timeseries   : [];
    this._topPages     = Array.isArray(topPages)     ? topPages     : [];
    this._topReferrers = Array.isArray(topReferrers) ? topReferrers : [];
    this._devices      = Array.isArray(devices)      ? devices      : [];
    this._conversions  = Array.isArray(conversions)  ? conversions  : [];

    this._el.innerHTML = this._renderAll();
    // Fire-and-forget: render() must resolve so the router can append the
    // element before charts are built (canvases need real dimensions).
    this._renderCharts(gen);
  }

  _renderAll() {
    return `
      <div class="analytics">
        <div class="analytics__header">
          <h1 class="analytics__title">${t('analytics.title')}</h1>
          <div class="analytics__range" role="group" aria-label="${escHtml(t('analytics.title'))}">
            ${RANGES.map(d => `<button type="button" class="analytics__range-btn${d === this._range ? ' is-active' : ''}" data-range="${d}">${escHtml(t('analytics.range' + d))}</button>`).join('')}
          </div>
        </div>
        ${this._renderKpis()}
        <div class="analytics__charts">
          <div class="analytics-card analytics-card--wide">
            <h2 class="analytics-card__title">${t('analytics.viewsOverTime')}</h2>
            <div class="analytics-chart"><canvas id="analytics-timeseries"></canvas></div>
          </div>
          <div class="analytics-card">
            <h2 class="analytics-card__title">${t('analytics.byDevice')}</h2>
            <div class="analytics-chart"><canvas id="analytics-devices"></canvas></div>
          </div>
          <div class="analytics-card">
            <h2 class="analytics-card__title">${t('analytics.byBrowser')}</h2>
            <div class="analytics-chart"><canvas id="analytics-browsers"></canvas></div>
          </div>
          <div class="analytics-card analytics-card--wide">
            <h2 class="analytics-card__title">${t('analytics.conversionsTitle')}</h2>
            <div class="analytics-chart"><canvas id="analytics-conversions"></canvas></div>
          </div>
        </div>
        <div class="analytics__tables">
          ${this._renderTopPages()}
          ${this._renderTopReferrers()}
        </div>
      </div>`;
  }

  _renderKpis() {
    const s = this._summary || {};
    const card = (label, value) =>
      `<div class="analytics-kpi"><div class="analytics-kpi__value">${escHtml(String(value ?? 0))}</div><div class="analytics-kpi__label">${escHtml(label)}</div></div>`;
    return `<div class="analytics__kpis">
      ${card(t('analytics.totalViews'),      s.total_views)}
      ${card(t('analytics.uniqueVisitors'),  s.unique_visitors)}
      ${card(t('analytics.pages'),           s.distinct_pages)}
      ${card(t('analytics.conversions'),     s.total_conversions)}
    </div>`;
  }

  _renderTopPages() {
    const rows = this._sorted(this._topPages, this._pagesSort);
    const body = rows.length
      ? rows.map(r => `<tr><td class="analytics-td--path">${escHtml(r.path)}</td><td>${escHtml(String(r.views))}</td><td>${escHtml(String(r.uniques))}</td></tr>`).join('')
      : `<tr><td colspan="3" class="analytics-empty">${t('analytics.noData')}</td></tr>`;
    return `<div class="analytics-card" id="analytics-top-pages" data-table="pages">
      <h2 class="analytics-card__title">${t('analytics.topPages')}</h2>
      <table class="analytics-table"><thead><tr>
        ${this._sortableTh('path', 'string', t('analytics.colPath'), this._pagesSort)}
        ${this._sortableTh('views', 'number', t('analytics.colViews'), this._pagesSort)}
        ${this._sortableTh('uniques', 'number', t('analytics.colUniques'), this._pagesSort)}
      </tr></thead><tbody>${body}</tbody></table>
    </div>`;
  }

  _renderTopReferrers() {
    const rows = this._sorted(this._topReferrers, this._refsSort);
    const body = rows.length
      ? rows.map(r => `<tr><td>${escHtml(r.referrer)}</td><td>${escHtml(String(r.views))}</td></tr>`).join('')
      : `<tr><td colspan="2" class="analytics-empty">${t('analytics.noData')}</td></tr>`;
    return `<div class="analytics-card" id="analytics-top-referrers" data-table="referrers">
      <h2 class="analytics-card__title">${t('analytics.topReferrers')}</h2>
      <table class="analytics-table"><thead><tr>
        ${this._sortableTh('referrer', 'string', t('analytics.colReferrer'), this._refsSort)}
        ${this._sortableTh('views', 'number', t('analytics.colViews'), this._refsSort)}
      </tr></thead><tbody>${body}</tbody></table>
    </div>`;
  }

  // ── Charts (lazy-loaded, vendored Chart.js — never on the public bundle) ────

  async _loadChart() {
    if (!window.Chart) {
      // Vendored UMD build, served same-origin (CSP script-src 'self').
      await import('/js/vendor/chart.umd.js');
    }
    return window.Chart || null;
  }

  async _renderCharts(gen) {
    let Chart;
    try { Chart = await this._loadChart(); } catch { return; } // charts are enhancement-only
    if (!Chart || gen !== this._gen || this._destroyed) return;
    // Wait one frame so the canvases are in the document with real dimensions.
    await new Promise(requestAnimationFrame);
    if (gen !== this._gen || this._destroyed || !this._el || !this._el.isConnected) return;
    this._buildCharts(Chart);
  }

  _buildCharts(Chart) {
    // Theme Chart.js for the dark surface (default text is near-black).
    Chart.defaults.color = AXIS;
    Chart.defaults.borderColor = GRID;
    Chart.defaults.font.family = "'Barlow', 'Inter', system-ui, sans-serif";

    const ts = this._el.querySelector('#analytics-timeseries');
    if (ts && this._timeseries.length) {
      this._charts.push(new Chart(ts, {
        type: 'line',
        data: {
          labels: this._timeseries.map(d => d.date),
          datasets: [
            { label: t('analytics.views'),   data: this._timeseries.map(d => d.views),   borderColor: GOLD, backgroundColor: 'rgba(200,170,110,0.15)', fill: true, tension: 0.3 },
            { label: t('analytics.uniques'), data: this._timeseries.map(d => d.uniques), borderColor: TEAL, backgroundColor: 'rgba(11,196,227,0.12)', fill: true, tension: 0.3 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
        },
      }));
    }

    this._doughnut(Chart, '#analytics-devices', this._aggregate(this._devices, 'device'));
    this._doughnut(Chart, '#analytics-browsers', this._aggregate(this._devices, 'browser'));

    const conv = this._el.querySelector('#analytics-conversions');
    if (conv && this._conversions.length) {
      this._charts.push(new Chart(conv, {
        type: 'bar',
        data: {
          labels: this._conversions.map(c => this._convLabel(c.event_type)),
          datasets: [{ label: t('analytics.conversions'), data: this._conversions.map(c => c.total), backgroundColor: GOLD }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
        },
      }));
    }
  }

  _doughnut(Chart, sel, agg) {
    const ctx = this._el.querySelector(sel);
    if (!ctx || !agg.labels.length) return;
    this._charts.push(new Chart(ctx, {
      type: 'doughnut',
      data: { labels: agg.labels, datasets: [{ data: agg.values, backgroundColor: PALETTE }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } },
    }));
  }

  _aggregate(rows, key) {
    const map = new Map();
    for (const r of rows) {
      const k = r[key] || 'unknown';
      map.set(k, (map.get(k) || 0) + Number(r.views || 0));
    }
    return { labels: [...map.keys()], values: [...map.values()] };
  }

  _convLabel(type) {
    const keys = { contact_submit: 'analytics.convContact', party_rsvp: 'analytics.convRsvp', shop_checkout: 'analytics.convCheckout' };
    return keys[type] ? t(keys[type]) : type;
  }

  // ── Sorting (adapted from PartyAdminView's shared sort helpers) ─────────────

  _sorted(rows, sort) {
    if (!sort) return rows;
    return this._sortRows(rows, r => r[sort.field], sort.dir, sort.type || 'string');
  }

  _sortRows(rows, accessor, dir, type) {
    const mul = dir === 'desc' ? -1 : 1;
    const cmp = (a, b) => {
      if (type === 'number') {
        const an = Number(a), bn = Number(b);
        if (Number.isNaN(an) || Number.isNaN(bn)) return String(a).localeCompare(String(b));
        return an - bn;
      }
      return String(a).localeCompare(String(b));
    };
    return [...rows].sort((ra, rb) => {
      const va = accessor(ra), vb = accessor(rb);
      const aEmpty = va == null || va === '';
      const bEmpty = vb == null || vb === '';
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      return mul * cmp(va, vb);
    });
  }

  _sortableTh(field, type, label, sort) {
    const active = sort?.field === field;
    const arrow  = active && sort.dir === 'desc' ? '▼' : '▲';
    const aria   = !active ? 'none' : (sort.dir === 'asc' ? 'ascending' : 'descending');
    const cls    = 'analytics-th--sortable' + (active ? ' analytics-th--active' : '');
    return `<th data-sort-field="${escHtml(field)}" data-sort-type="${escHtml(type)}" class="${cls}" aria-sort="${aria}" tabindex="0">${escHtml(label)}<span class="analytics-sort-arrow" aria-hidden="true">${arrow}</span></th>`;
  }

  _cycleSort(current, field) {
    if (current?.field !== field) return { field, dir: 'asc' };
    if (current.dir === 'asc')    return { field, dir: 'desc' };
    return null;
  }

  // ── Event delegation ────────────────────────────────────────────────────────

  _onClick(e) {
    const rangeBtn = e.target.closest('.analytics__range-btn');
    if (rangeBtn && this._el.contains(rangeBtn)) {
      const r = Number(rangeBtn.dataset.range);
      if (r !== this._range) { this._range = r; this._loadAndRender(); }
      return;
    }
    const th = e.target.closest('th[data-sort-field]');
    if (th && this._el.contains(th)) this._handleSort(th);
  }

  _onKeydown(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const th = e.target.closest('th[data-sort-field]');
    if (th && this._el.contains(th)) { e.preventDefault(); this._handleSort(th); }
  }

  _handleSort(th) {
    const table = th.closest('[data-table]')?.dataset.table;
    const field = th.dataset.sortField;
    const type  = th.dataset.sortType;
    if (table === 'pages') {
      this._pagesSort = this._cycleWithType(this._pagesSort, field, type);
      this._replaceCard('#analytics-top-pages', this._renderTopPages());
    } else if (table === 'referrers') {
      this._refsSort = this._cycleWithType(this._refsSort, field, type);
      this._replaceCard('#analytics-top-referrers', this._renderTopReferrers());
    }
  }

  _cycleWithType(current, field, type) {
    const next = this._cycleSort(current, field);
    if (next) next.type = type;
    return next;
  }

  _replaceCard(sel, html) {
    const old = this._el.querySelector(sel);
    if (!old) return;
    const tmp = document.createElement('template');
    tmp.innerHTML = html.trim();
    old.replaceWith(tmp.content.firstElementChild);
  }
}

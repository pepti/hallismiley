// AdminMarketView (/admin/markadur) — Markaður, the prospect list: Icelandic
// companies the Markaðsstjóri research pass judged from their annual
// accounts (market_companies ⋈ latest market_financials, migration 093).
// Read = admin view 'markadur'; the one write (shortlist → handed_to_sales /
// rejected) is admin/moderator and only renders for editors.
//
// Structural model: AdminLeadsView (admin shell + class shape). Money arrives
// as BIGINT strings — formatted here in m.kr. The report_path is a file on the
// work machine (gitignored PDFs under company/): rendered as text, NEVER a
// link. Theme rule: tokens only (invariant 15).
import { isAuthenticated, canSeeView, canEdit } from '../services/auth.js';
import { getCompanies, getCompany, setCompanyStatus } from '../services/market.js';
import { createAccount } from '../services/accounts.js';
import { escHtml } from '../utils/escHtml.js';
import { formatDate } from '../utils/format.js';
import { t, href, getLocale } from '../i18n/i18n.js';
import { navigate, navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { showToast } from '../components/Toast.js';

const PAGE_SIZE = 50;

// Literal keys so check:i18n can see every label.
const SECTOR_KEY = {
  smasala:   'markadur.sector.smasala',
  heildsala: 'markadur.sector.heildsala',
  idnadur:   'markadur.sector.idnadur',
  thjonusta: 'markadur.sector.thjonusta',
  annad:     'markadur.sector.annad',
};
const LIST_KEY = { smb: 'markadur.listType.smb', large: 'markadur.listType.large' };
const TIER_KEY = { vefur: 'markadur.tier.vefur', verslun: 'markadur.tier.verslun', rekstur: 'markadur.tier.rekstur' };
const STATUS_KEY = {
  candidate:       'markadur.status.candidate',
  researched:      'markadur.status.researched',
  shortlist:       'markadur.status.shortlist',
  handed_to_sales: 'markadur.status.handed_to_sales',
  rejected:        'markadur.status.rejected',
};
const label = (map, v) => (map[v] ? t(map[v]) : (v || '—'));

// market_companies is agent-scraped from third-party sites, so a `website` or
// a `sources[].url` is untrusted input that lands in an href. escHtml stops the
// attribute break-out but not the SCHEME: `javascript:…` would still be a
// clickable script link in the admin. Same rule as utils/sanitizeHtml.js.
function safeUrl(u) {
  return (typeof u === 'string' && /^https?:\/\//i.test(u)) ? u : null;
}

function mkr(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat(getLocale() === 'en' ? 'en-GB' : 'is-IS', { maximumFractionDigits: 1 }).format(n / 1e6) + ' m.kr.';
}
function pct(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return Number.isFinite(n) ? `${(n * 100).toFixed(1)} %` : '—';
}
function num(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : '—';
}
function chip(status) {
  return `<span class="markadur-chip markadur-chip--${escHtml(status)}">${escHtml(label(STATUS_KEY, status))}</span>`;
}

const SORTABLE = [
  ['fit_score', 'markadur.col.fit'],
  ['admin_cost_ratio', 'markadur.col.adminRatio'],
  ['revenue', 'markadur.col.revenue'],
  ['employees', 'markadur.col.employees'],
  ['name', 'markadur.col.company'],
];

export class AdminMarketView {
  constructor() {
    this._el = null;
    this._filters = { list_type: '', sector_group: '', status: '', tier_fit: '' };
    this._q = '';
    this._sort = 'fit_score';
    this._dir = 'desc';
    this._page = 1;
    this._data = { companies: [], total: 0, filters: { sectors: [], listTypes: [], statuses: [], tiers: [] } };
    this._searchDebounce = null;
    this._drawer = null;
    this._returnFocus = null;
    this._loadSeq = 0;
    this._destroyed = false;
  }

  // The router calls destroy() on every navigation. Without it the drawer's
  // document-level keydown listener outlives the view: navigate away with the
  // drawer open and every later Escape in the SPA runs _close() on dead nodes.
  destroy() {
    this._destroyed = true;
    clearTimeout(this._searchDebounce);
    this._close();
  }

  async render() {
    if (!isAuthenticated() || !canSeeView('markadur')) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }
    this._el = document.createElement('div');
    this._el.className = 'main admin-page admin-markadur';
    this._el.innerHTML = `
      <div class="admin-header">
        <div>
          <h1 class="admin-title">${escHtml(t('markadur.title'))}</h1>
          <p class="admin-shop__hint">${escHtml(t('markadur.subtitle'))}</p>
        </div>
      </div>
      <div class="admin-toolbar markadur-toolbar" id="markadur-toolbar">
        ${this._select('list_type', 'markadur.filter.listType')}
        ${this._select('sector_group', 'markadur.filter.sector')}
        ${this._select('status', 'markadur.filter.status')}
        ${this._select('tier_fit', 'markadur.filter.tier')}
        <input type="search" id="markadur-q" class="admin-shop__search"
               placeholder="${escHtml(t('markadur.searchPlaceholder'))}"
               aria-label="${escHtml(t('markadur.searchPlaceholder'))}" autocomplete="off" />
      </div>
      <p class="markadur-count" id="markadur-count"></p>
      <div class="admin-table-wrap" id="markadur-body"><div class="admin-loading">${escHtml(t('form.loading'))}</div></div>
    `;
    this._bindToolbar();
    await this._load();
    return renderAdminShell({ activePath: '/admin/markadur', content: this._el });
  }

  _select(name, labelKey) {
    return `<label class="markadur-filter"><span>${escHtml(t(labelKey))}</span>
      <select name="${name}" data-filter="${name}"><option value="">${escHtml(t('markadur.filter.any'))}</option></select></label>`;
  }

  _fillSelects() {
    const f = this._data.filters || {};
    const opts = { list_type: [f.listTypes, LIST_KEY], sector_group: [f.sectors, SECTOR_KEY], status: [f.statuses, STATUS_KEY], tier_fit: [f.tiers, TIER_KEY] };
    for (const [name, [values, map]] of Object.entries(opts)) {
      const sel = this._el.querySelector(`[data-filter="${name}"]`);
      if (!sel || sel.options.length > 1) continue;   // filled once
      for (const v of (values || [])) {
        const o = document.createElement('option');
        o.value = v; o.textContent = label(map, v);
        sel.appendChild(o);
      }
      sel.value = this._filters[name];
    }
  }

  _bindToolbar() {
    this._el.querySelector('#markadur-toolbar').addEventListener('change', (e) => {
      const sel = e.target.closest('[data-filter]');
      if (!sel) return;
      this._filters[sel.dataset.filter] = sel.value;
      this._page = 1;
      this._load();
    });
    this._el.querySelector('#markadur-q').addEventListener('input', (e) => {
      clearTimeout(this._searchDebounce);
      const v = e.target.value.trim();
      this._searchDebounce = setTimeout(() => { this._q = v; this._page = 1; this._load(); }, 250);
    });
  }

  _params() {
    return { ...this._filters, q: this._q || undefined, sort: this._sort, dir: this._dir, page: this._page, limit: PAGE_SIZE };
  }

  async _load() {
    const body = this._el.querySelector('#markadur-body');
    // Sequence guard: a debounced search and a filter/sort click can be in
    // flight together, and the SLOWER one used to win — painting unfiltered
    // rows under an active filter chip.
    const seq = ++this._loadSeq;
    try {
      const data = await getCompanies(this._params());
      if (this._destroyed || seq !== this._loadSeq) return;
      this._data = data;
      this._fillSelects();
      this._el.querySelector('#markadur-count').textContent = t('markadur.count', { count: this._data.total });
      this._paintTable();
    } catch (err) {
      if (this._destroyed || seq !== this._loadSeq) return;
      body.innerHTML = `<p class="admin-error">${escHtml(err.message || t('markadur.loadError'))}</p>`;
    }
  }

  _th(key, labelKey) {
    const active = this._sort === key;
    const ariaSort = active ? (this._dir === 'asc' ? 'ascending' : 'descending') : 'none';
    return `<th aria-sort="${ariaSort}"><button type="button" class="markadur-sort${active ? ' is-active' : ''}" data-sort="${key}">${escHtml(t(labelKey))}${active ? (this._dir === 'asc' ? ' ↑' : ' ↓') : ''}</button></th>`;
  }

  _paintTable() {
    const body = this._el.querySelector('#markadur-body');
    const rows = this._data.companies || [];
    if (!rows.length) {
      body.innerHTML = `<div class="empty-state"><div class="empty-state__icon">📊</div><p>${escHtml(t('markadur.empty'))}</p></div>`;
      return;
    }
    const sortable = Object.fromEntries(SORTABLE);
    body.innerHTML = `
      <table class="admin-table markadur-table">
        <thead><tr>
          ${this._th('name', sortable.name)}
          <th>${escHtml(t('markadur.col.sector'))}</th>
          <th>${escHtml(t('markadur.col.list'))}</th>
          <th>${escHtml(t('markadur.col.tier'))}</th>
          <th class="num">${escHtml(t('markadur.col.year'))}</th>
          ${this._th('revenue', sortable.revenue)}
          ${this._th('admin_cost_ratio', sortable.admin_cost_ratio)}
          ${this._th('employees', sortable.employees)}
          ${this._th('fit_score', sortable.fit_score)}
          <th>${escHtml(t('markadur.col.status'))}</th>
        </tr></thead>
        <tbody>${rows.map(c => this._row(c)).join('')}</tbody>
      </table>
      ${this._pagerHtml()}`;

    body.querySelectorAll('[data-sort]').forEach(b => b.addEventListener('click', () => {
      const key = b.dataset.sort;
      if (this._sort === key) this._dir = this._dir === 'asc' ? 'desc' : 'asc';
      else { this._sort = key; this._dir = key === 'name' ? 'asc' : 'desc'; }
      this._page = 1;
      this._load();
    }));
    body.querySelectorAll('tr.markadur-row').forEach(tr => {
      tr.addEventListener('click', () => this._open(Number(tr.dataset.id), tr));
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._open(Number(tr.dataset.id), tr); }
      });
    });
    body.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => {
      this._page = Number(b.dataset.page); this._load();
    }));
  }

  _row(c) {
    const l = c.latest || {};
    return `<tr class="markadur-row" data-id="${c.id}" tabindex="0">
      <td class="markadur-cell--name"><span class="markadur-name">${escHtml(c.name)}</span><span class="markadur-kt">${escHtml(c.kennitala)}</span></td>
      <td>${escHtml(label(SECTOR_KEY, c.sector_group))}</td>
      <td>${escHtml(label(LIST_KEY, c.list_type))}</td>
      <td>${escHtml(c.tier_fit ? label(TIER_KEY, c.tier_fit) : '—')}</td>
      <td class="num">${escHtml(num(l.fiscal_year))}</td>
      <td class="num">${escHtml(mkr(l.revenue_isk))}</td>
      <td class="num">${escHtml(pct(l.admin_cost_ratio))}</td>
      <td class="num">${escHtml(num(l.employees))}</td>
      <td class="num">${escHtml(c.fit_score == null ? '—' : String(Number(c.fit_score)))}</td>
      <td>${chip(c.status)}</td>
    </tr>`;
  }

  _pagerHtml() {
    const total = this._data.total || 0;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (pages <= 1) return '';
    const p = this._page;
    return `<div class="admin-pagination">
      <button type="button" class="btn btn--sm btn--ghost" data-page="${p - 1}" ${p <= 1 ? 'disabled' : ''}>←</button>
      <span>${p} / ${pages}</span>
      <button type="button" class="btn btn--sm btn--ghost" data-page="${p + 1}" ${p >= pages ? 'disabled' : ''}>→</button>
    </div>`;
  }

  // ── Detail drawer ────────────────────────────────────────────────────────
  async _open(id, rowEl) {
    this._returnFocus = rowEl || null;
    this._close();
    const backdrop = document.createElement('div');
    backdrop.className = 'markadur-backdrop';
    const drawer = document.createElement('aside');
    drawer.className = 'markadur-drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.setAttribute('aria-labelledby', 'markadur-drawer-title');
    drawer.innerHTML = `<div class="admin-loading">${escHtml(t('form.loading'))}</div>`;
    backdrop.addEventListener('click', () => this._close());
    this._onKey = (e) => { if (e.key === 'Escape') this._close(); };
    document.addEventListener('keydown', this._onKey);
    this._el.append(backdrop, drawer);
    this._drawer = { backdrop, drawer, companyId: id };
    try {
      const { company } = await getCompany(id);
      if (this._drawer?.drawer !== drawer) return;
      drawer.innerHTML = this._drawerHtml(company);
      this._bindDrawer(drawer, company);
      drawer.querySelector('[data-close]').focus();
    } catch (err) {
      drawer.innerHTML = `<p class="admin-error">${escHtml(err.message || t('markadur.loadError'))}</p>`;
    }
  }

  _close() {
    if (!this._drawer) return;
    const id = this._drawer.companyId;
    this._drawer.backdrop.remove();
    this._drawer.drawer.remove();
    this._drawer = null;
    document.removeEventListener('keydown', this._onKey);
    if (this._destroyed) return;
    // Re-find the row rather than reusing the node captured at open: a
    // hand-off calls _load(), which rebuilds the tbody, so the captured <tr>
    // is detached by then and focus would silently drop to <body>.
    const row = id != null && this._el?.querySelector(`tr.markadur-row[data-id="${id}"]`);
    (row || this._returnFocus)?.focus?.();
  }

  _drawerHtml(c) {
    const years = (c.financials || []);
    const yearsHtml = years.length ? `
      <div class="markadur-years-wrap"><table class="admin-table markadur-years">
        <thead><tr>
          <th>${escHtml(t('markadur.col.year'))}</th>
          <th class="num">${escHtml(t('markadur.col.revenue'))}</th>
          <th class="num">${escHtml(t('markadur.detail.operatingProfit'))}</th>
          <th class="num">${escHtml(t('markadur.detail.netProfit'))}</th>
          <th class="num">${escHtml(t('markadur.detail.equity'))}</th>
          <th class="num">${escHtml(t('markadur.col.adminRatio'))}</th>
          <th class="num">${escHtml(t('markadur.col.employees'))}</th>
        </tr></thead>
        <tbody>${years.map(y => `<tr>
          <td>${escHtml(num(y.fiscal_year))}</td>
          <td class="num">${escHtml(mkr(y.revenue_isk))}</td>
          <td class="num">${escHtml(mkr(y.operating_profit_isk))}</td>
          <td class="num">${escHtml(mkr(y.net_profit_isk))}</td>
          <td class="num">${escHtml(mkr(y.equity_isk))}</td>
          <td class="num">${escHtml(pct(y.admin_cost_ratio))}</td>
          <td class="num">${escHtml(num(y.employees))}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : `<p class="markadur-drawer__muted">${escHtml(t('markadur.detail.noFinancials'))}</p>`;

    const sources = Array.isArray(c.sources) ? c.sources : [];
    const sourcesHtml = sources.length
      ? `<ul class="markadur-sources">${sources.map(s => `<li>
          <span class="markadur-sources__type">${escHtml(s.type || '')}</span>
          ${safeUrl(s.url)
    ? `<a href="${escHtml(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">${escHtml(s.url)}</a>`
    : (s.url ? `<span class="markadur-drawer__muted">${escHtml(s.url)}</span>` : '')}
          ${s.fetched_at ? `<span class="markadur-drawer__muted">${escHtml(formatDate(s.fetched_at))}</span>` : ''}
        </li>`).join('')}</ul>`
      : `<p class="markadur-drawer__muted">—</p>`;

    const canHand = canEdit();
    const isShort = c.status === 'shortlist';
    // The #17 hand-off: a customer account created from the market row (name,
    // kennitala, tier copied; the row moves to handed_to_sales). Anyone holding
    // `accounts` may do it for a shortlisted or already handed-off company.
    const canAccount = canSeeView('accounts') && (isShort || c.status === 'handed_to_sales');
    const actions = (canHand || canAccount) ? `
      <div class="markadur-drawer__actions">
        ${canHand ? `
        <button type="button" class="btn btn--sm btn--primary" data-set-status="handed_to_sales" ${isShort ? '' : 'disabled'}>${escHtml(t('markadur.handToSales'))}</button>
        <button type="button" class="btn btn--sm btn--outline" data-set-status="rejected" ${isShort ? '' : 'disabled'}>${escHtml(t('markadur.reject'))}</button>` : ''}
        ${canAccount ? `<button type="button" class="btn btn--sm btn--outline" data-create-account>${escHtml(t('markadur.createAccount'))}</button>` : ''}
        ${canHand && !isShort ? `<span class="markadur-drawer__muted">${escHtml(t('markadur.handOnlyShortlist'))}</span>` : ''}
      </div>` : '';

    const fact = (k, v) => `<div class="markadur-fact"><span>${escHtml(t(k))}</span><strong>${v}</strong></div>`;
    return `
      <div class="markadur-drawer__head">
        <div>
          <h2 class="markadur-drawer__title" id="markadur-drawer-title">${escHtml(c.name)}</h2>
          <p class="markadur-drawer__muted">${escHtml(c.kennitala)}${c.isat_label ? ` · ${escHtml(c.isat_label)}` : ''}${c.municipality ? ` · ${escHtml(c.municipality)}` : ''}</p>
        </div>
        <button type="button" class="markadur-drawer__close" data-close aria-label="${escHtml(t('markadur.close'))}">×</button>
      </div>
      <div class="markadur-drawer__status">${chip(c.status)}${c.fit_score != null ? ` <span class="markadur-fit">${escHtml(t('markadur.col.fit'))} ${escHtml(String(Number(c.fit_score)))}</span>` : ''}</div>
      ${actions}
      <div class="markadur-facts">
        ${fact('markadur.col.sector', escHtml(label(SECTOR_KEY, c.sector_group)))}
        ${fact('markadur.col.list', escHtml(label(LIST_KEY, c.list_type)))}
        ${fact('markadur.col.tier', escHtml(c.tier_fit ? label(TIER_KEY, c.tier_fit) : '—'))}
        ${fact('markadur.detail.platform', escHtml(c.platform_detected || '—'))}
        ${fact('markadur.detail.website', safeUrl(c.website)
    ? `<a href="${escHtml(safeUrl(c.website))}" target="_blank" rel="noopener noreferrer">${escHtml(c.website)}</a>`
    : escHtml(c.website || '—'))}
        ${fact('markadur.detail.researched', escHtml([c.researched_by, c.researched_at ? formatDate(c.researched_at) : null].filter(Boolean).join(' · ') || '—'))}
      </div>
      <h3 class="markadur-drawer__h">${escHtml(t('markadur.detail.summary'))}</h3>
      <p class="markadur-drawer__text">${escHtml(c.summary || '—')}</p>
      <h3 class="markadur-drawer__h">${escHtml(t('markadur.detail.fitNotes'))}</h3>
      <p class="markadur-drawer__text">${escHtml(c.fit_notes || '—')}</p>
      <h3 class="markadur-drawer__h">${escHtml(t('markadur.detail.financials'))}</h3>
      ${yearsHtml}
      <h3 class="markadur-drawer__h">${escHtml(t('markadur.detail.sources'))}</h3>
      ${sourcesHtml}
      <h3 class="markadur-drawer__h">${escHtml(t('markadur.detail.report'))}</h3>
      <p class="markadur-drawer__report">${c.report_path ? `<code>${escHtml(c.report_path)}</code> <span class="markadur-drawer__muted">${escHtml(t('markadur.reportNote'))}</span>` : '—'}</p>
    `;
  }

  async _hand(company, status) {
    const key = status === 'rejected' ? 'markadur.confirmReject' : 'markadur.confirmHand';
    if (!confirm(t(key, { name: company.name }))) return;
    try {
      await setCompanyStatus(company.id, status);
      showToast(t('markadur.statusSaved'), 'success');
      const drawer = this._drawer?.drawer;
      await this._load();
      if (drawer) {
        // Re-render the open drawer against the fresh row.
        const { company: fresh } = await getCompany(company.id);
        if (this._drawer?.drawer === drawer) {
          drawer.innerHTML = this._drawerHtml(fresh);
          this._bindDrawer(drawer, fresh);
        }
      }
    } catch (err) {
      showToast(err.message || t('markadur.statusError'), 'error');
    }
  }

  _bindDrawer(drawer, company) {
    drawer.querySelector('[data-close]').addEventListener('click', () => this._close());
    drawer.querySelectorAll('[data-set-status]').forEach(b => b.addEventListener('click', () => this._hand(company, b.dataset.setStatus)));
    drawer.querySelector('[data-create-account]')?.addEventListener('click', () => this._createAccount(company));
  }

  // POST /api/v1/admin/accounts with the market row: the server copies name,
  // kennitala and tier_fit and moves the row to handed_to_sales in one
  // transaction, then we land on the new account.
  async _createAccount(company) {
    if (!confirm(t('markadur.createAccountConfirm', { name: company.name }))) return;
    try {
      const { account } = await createAccount({ market_company_id: company.id });
      showToast(t('accounts.created'), 'success');
      this._close();
      navigate(href(`/admin/accounts/${account.id}`));
    } catch (err) {
      showToast(err.message || t('accounts.saveError'), 'error');
    }
  }
}

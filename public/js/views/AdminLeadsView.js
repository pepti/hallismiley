// AdminLeadsView (/admin/leads) — Fyrirspurnir, the leads inbox: every
// /hafa-samband enquiry, newest first, with the sales team's workflow on
// each row (status, owner, notes). Read + workflow = admin view 'leads' (the
// `solufolk` role); delete (erasure) and CSV export are admin-only and only
// render for admins.
//
// Structural model: AdminHandbookView (admin shell + class shape). Personal
// data on screen, so everything visitor-written goes through escHtml and the
// message keeps its line breaks with CSS, never innerHTML. Theme rule: tokens
// only (invariant 15) — the status chips use the --success/--warning/--error
// washes, and unread emphasis is weight, not colour.
//
// Lead ids are STRINGS here, end to end (rk-feed, 2026-09-23): the engine's
// are SERIAL, a product whose table predates the engine's (rekstrarkerfid)
// holds TEXT uuids, and `Number(dataset.id)` turned those into NaN so the
// detail never opened. Every compare is `String(l.id) === id`; the API client
// URL-encodes whatever it is given.
//
// A row whose notification email never went out (notify_error set, migration
// 108) carries a small "ekki sent" mark next to the status with the reason on
// hover, so an enquiry nobody was emailed about is not mistaken for one that
// was.
import { isAuthenticated, canSeeView, isAdmin, getUser } from '../services/auth.js';
import { getLeads, updateLead, deleteLead, leadsCsvUrl } from '../services/leads.js';
import { escHtml } from '../utils/escHtml.js';
import { formatDateTime } from '../utils/format.js';
import { t, href } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { showToast } from '../components/Toast.js';

const PAGE_SIZE = 50;

// Literal keys so check:i18n can see every label.
const STATUS_KEY = {
  new:       'leads.status.new',
  contacted: 'leads.status.contacted',
  won:       'leads.status.won',
  lost:      'leads.status.lost',
};
const STATUSES = Object.keys(STATUS_KEY);

function chip(status) {
  const key = STATUS_KEY[status] || STATUS_KEY.new;
  return `<span class="leads-chip leads-chip--${escHtml(status)}">${escHtml(t(key))}</span>`;
}

// The "not emailed" mark: only when the outcome was recorded as a failure.
// A null/null row (pre-108, or the email still in flight) shows nothing.
function unsentMark(l) {
  if (!l.notify_error) return '';
  const hint = t('leads.notEmailedHint', { error: l.notify_error });
  return ` <span class="leads-mark leads-mark--unsent" title="${escHtml(hint)}" aria-label="${escHtml(hint)}" data-unsent>${escHtml(t('leads.notEmailed'))}</span>`;
}

export class AdminLeadsView {
  constructor() {
    this._el = null;
    this._status = '';
    this._q = '';
    this._mine = false;
    this._page = 1;
    this._openId = null;
    this._data = { leads: [], total: 0, counts: {}, retentionDays: 730 };
    this._searchDebounce = null;
    this._loadSeq = 0;
    this._destroyed = false;
  }

  // The router calls destroy() on navigation. Without it a debounced search
  // fires ~250 ms after the view is gone and _load() writes into a detached
  // tree (or throws on a null #leads-body).
  destroy() {
    this._destroyed = true;
    clearTimeout(this._searchDebounce);
  }

  async render() {
    if (!isAuthenticated() || !canSeeView('leads')) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }
    this._el = document.createElement('div');
    this._el.className = 'main admin-page admin-leads';
    this._el.innerHTML = `
      <div class="admin-header">
        <div>
          <h1 class="admin-title">${escHtml(t('leads.title'))}</h1>
          <p class="admin-shop__hint">${escHtml(t('leads.subtitle'))}</p>
        </div>
        ${isAdmin() ? `<div class="admin-header__actions">
          <button type="button" class="btn btn--outline btn--sm" id="leads-csv">${escHtml(t('leads.exportCsv'))}</button>
        </div>` : ''}
      </div>
      <div class="admin-toolbar leads-toolbar">
        <div class="leads-filters" role="group" aria-label="${escHtml(t('leads.col.status'))}" id="leads-filters"></div>
        <input type="search" id="leads-q" class="admin-shop__search"
               placeholder="${escHtml(t('leads.searchPlaceholder'))}"
               aria-label="${escHtml(t('leads.searchPlaceholder'))}" autocomplete="off" />
        <label class="leads-mine"><input type="checkbox" id="leads-mine" /> ${escHtml(t('leads.mine'))}</label>
      </div>
      <div class="admin-table-wrap" id="leads-body"><div class="admin-loading">${escHtml(t('form.loading'))}</div></div>
      <p class="leads-retention" id="leads-retention"></p>
    `;
    this._bindToolbar();
    await this._load();
    return renderAdminShell({ activePath: '/admin/leads', content: this._el });
  }

  _params() {
    return {
      status: this._status || undefined,
      q: this._q || undefined,
      owner: this._mine ? 'me' : undefined,
      page: this._page,
      limit: PAGE_SIZE,
    };
  }

  _bindToolbar() {
    this._el.querySelector('#leads-q').addEventListener('input', (e) => {
      clearTimeout(this._searchDebounce);
      const v = e.target.value.trim();
      this._searchDebounce = setTimeout(() => { this._q = v; this._page = 1; this._load(); }, 250);
    });
    this._el.querySelector('#leads-mine').addEventListener('change', (e) => {
      this._mine = !!e.target.checked; this._page = 1; this._load();
    });
    this._el.querySelector('#leads-csv')?.addEventListener('click', () => {
      // A Content-Disposition: attachment response never leaves the page.
      window.location.href = leadsCsvUrl({ status: this._status || undefined, q: this._q || undefined, owner: this._mine ? 'me' : undefined });
    });
    this._el.querySelector('#leads-filters').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-status]');
      if (!btn) return;
      this._status = btn.dataset.status;
      this._page = 1;
      this._load();
    });
  }

  _paintFilters() {
    const counts = this._data.counts || {};
    const all = Object.values(counts).reduce((a, b) => a + b, 0);
    const btn = (value, label, n) =>
      `<button type="button" class="leads-filter${this._status === value ? ' is-active' : ''}" data-status="${escHtml(value)}" aria-pressed="${this._status === value ? 'true' : 'false'}">${escHtml(label)} <span class="leads-filter__n">${n}</span></button>`;
    this._el.querySelector('#leads-filters').innerHTML =
      btn('', t('leads.filterAll'), all)
      + STATUSES.map(s => btn(s, t(STATUS_KEY[s]), counts[s] || 0)).join('');
  }

  async _load() {
    const body = this._el.querySelector('#leads-body');
    // Sequence guard: a status chip and the debounced search can be in flight
    // together, and the slower response used to paint over the newer one.
    const seq = ++this._loadSeq;
    try {
      const data = await getLeads(this._params());
      if (this._destroyed || seq !== this._loadSeq) return;
      this._data = data;
      this._paintFilters();
      this._el.querySelector('#leads-retention').textContent =
        t('leads.retentionNote', { days: this._data.retentionDays });
      this._paintTable();
    } catch (err) {
      if (this._destroyed || seq !== this._loadSeq) return;
      body.innerHTML = `<p class="admin-error">${escHtml(err.message || t('leads.loadError'))}</p>`;
    }
  }

  _paintTable() {
    const body = this._el.querySelector('#leads-body');
    const leads = this._data.leads || [];
    if (!leads.length) {
      body.innerHTML = `<div class="empty-state"><div class="empty-state__icon">📨</div><p>${escHtml(t('leads.empty'))}</p></div>`;
      return;
    }
    body.innerHTML = `
      <table class="admin-table leads-table">
        <thead><tr>
          <th>${escHtml(t('leads.col.received'))}</th>
          <th>${escHtml(t('leads.col.name'))}</th>
          <th>${escHtml(t('leads.col.company'))}</th>
          <th>${escHtml(t('leads.col.platform'))}</th>
          <th>${escHtml(t('leads.col.status'))}</th>
          <th>${escHtml(t('leads.col.owner'))}</th>
        </tr></thead>
        <tbody>${leads.map(l => this._row(l)).join('')}</tbody>
      </table>
      ${this._pagerHtml()}`;

    body.querySelectorAll('tr.leads-row').forEach(tr => {
      tr.addEventListener('click', (e) => {
        if (e.target.closest('a, button')) return;
        this._toggle(tr.dataset.id);
      });
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._toggle(tr.dataset.id); }
      });
    });
    body.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => {
      this._page = Number(b.dataset.page); this._load();
    }));
    if (this._openId) this._paintDetail(this._openId);
  }

  _row(l) {
    const open = String(l.id) === this._openId;
    return `<tr class="leads-row${l.status === 'new' ? ' leads-row--new' : ''}${open ? ' is-open' : ''}" data-id="${escHtml(String(l.id))}" tabindex="0" aria-expanded="${open ? 'true' : 'false'}">
      <td class="leads-cell--date">${escHtml(formatDateTime(l.created_at))}</td>
      <td class="leads-cell--name">${escHtml(l.name)}</td>
      <td>${escHtml(l.company || '—')}</td>
      <td>${escHtml(l.current_platform || t('leads.platform.none'))}</td>
      <td>${chip(l.status)}${unsentMark(l)}</td>
      <td>${escHtml(l.owner_name || t('leads.ownerNone'))}</td>
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

  _toggle(id) {
    const key = String(id);
    this._openId = this._openId === key ? null : key;
    this._paintTable();
  }

  _paintDetail(id) {
    const l = (this._data.leads || []).find(x => String(x.id) === id);
    const tr = [...this._el.querySelectorAll('tr.leads-row')].find(row => row.dataset.id === id);
    if (!l || !tr) return;
    const me = getUser()?.id;
    const mine = l.owner_user_id && l.owner_user_id === me;
    const contacted = l.contacted_at
      ? `<p class="leads-detail__meta">${escHtml(t('leads.contactedLine', { date: formatDateTime(l.contacted_at), name: l.contacted_by_name || '' }))}</p>`
      : '';
    const statusBtn = (s, key, cls) => `<button type="button" class="btn btn--sm ${cls}" data-set-status="${s}" ${l.status === s ? 'disabled' : ''}>${escHtml(t(key))}</button>`;
    const detail = document.createElement('tr');
    detail.className = 'leads-detail-row';
    detail.innerHTML = `<td colspan="6">
      <div class="leads-detail">
        <div class="leads-detail__contact">
          <a href="mailto:${escHtml(l.email)}">${escHtml(l.email)}</a>
          ${l.phone ? ` · <a href="tel:${escHtml(l.phone.replace(/\s+/g, ''))}">${escHtml(l.phone)}</a>` : ''}
          ${l.company ? ` · ${escHtml(l.company)}` : ''}
        </div>
        <h3 class="leads-detail__h">${escHtml(t('leads.message'))}</h3>
        <p class="leads-detail__message">${escHtml(l.message)}</p>
        ${contacted}
        <div class="leads-detail__actions">
          ${statusBtn('contacted', 'leads.markContacted', 'btn--primary')}
          ${statusBtn('won', 'leads.markWon', 'btn--outline')}
          ${statusBtn('lost', 'leads.markLost', 'btn--outline')}
          <button type="button" class="btn btn--sm btn--ghost" data-owner="${mine ? 'release' : 'take'}">${escHtml(t(mine ? 'leads.unassign' : 'leads.assignToMe'))}</button>
          ${isAdmin() ? `<button type="button" class="btn btn--sm btn--danger" data-delete>${escHtml(t('leads.delete'))}</button>` : ''}
        </div>
        <label class="leads-detail__note">
          <span>${escHtml(t('leads.note'))}</span>
          <textarea rows="3" data-note>${escHtml(l.note || '')}</textarea>
        </label>
        <button type="button" class="btn btn--sm btn--outline" data-save-note>${escHtml(t('leads.saveNote'))}</button>
      </div>
    </td>`;
    tr.after(detail);

    detail.querySelectorAll('[data-set-status]').forEach(b => b.addEventListener('click', () =>
      this._save(id, { status: b.dataset.setStatus })));
    detail.querySelector('[data-owner]').addEventListener('click', (e) =>
      this._save(id, { owner_user_id: e.currentTarget.dataset.owner === 'take' ? me : null }));
    detail.querySelector('[data-save-note]').addEventListener('click', () =>
      this._save(id, { note: detail.querySelector('[data-note]').value }));
    detail.querySelector('[data-delete]')?.addEventListener('click', () => this._delete(id));
  }

  async _save(id, body) {
    try {
      await updateLead(id, body);
      showToast(t('leads.saved'), 'success');
      await this._load();
    } catch (err) {
      showToast(err.message || t('leads.saveError'), 'error');
    }
  }

  async _delete(id) {
    if (!confirm(t('leads.deleteConfirm'))) return;
    try {
      await deleteLead(id);
      this._openId = null;
      showToast(t('leads.deleted'), 'success');
      await this._load();
    } catch (err) {
      showToast(err.message || t('leads.saveError'), 'error');
    }
  }
}

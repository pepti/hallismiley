// AdminMonitoringView — Admin → Monitoring.
//
// Three sections:
//   1. Server event log — failures across ALL users, from the database. 5xx
//      recorded by the central error handler plus the SPA's error-toast beacon.
//   2. This session's notifications — the sessionStorage toast log, i.e. what
//      THIS admin saw in THIS tab. Rendered by the same helper the toast-click
//      modal uses. It is a "what did that message say?" surface, not an audit log.
//   3. A live snapshot of the server readiness probe (/ready).

import { isAuthenticated, isAdmin } from '../services/auth.js';
import { escHtml } from '../utils/escHtml.js';
import { t, href } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { getToastLog, clearToastLog } from '../services/toastLog.js';
import { toastLogHtml } from '../components/ToastLog.js';
import { fetchEvents } from '../services/adminEvents.js';

const PAGE_SIZE = 50;

const OK_STATUSES = new Set(['ok', 'closed']);

function statusClass(status) {
  if (status == null) return '';
  if (OK_STATUSES.has(String(status))) return 'mon-pill--ok';
  if (String(status) === 'critical' || String(status) === 'error') return 'mon-pill--error';
  return 'mon-pill--warn';
}

function formatUptime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

function row(label, value, status) {
  const pill = status == null ? ''
    : `<span class="mon-pill ${statusClass(status)}">${escHtml(status)}</span>`;
  return `<div class="mon-row">`
    + `<span class="mon-row__label">${escHtml(label)}</span>`
    + `<span class="mon-row__value">${escHtml(value)}</span>`
    + pill
    + `</div>`;
}

function eventRowsHtml(events) {
  if (!events.length) return `<p class="toast-log__empty">${escHtml(t('adminMonitoring.eventsEmpty'))}</p>`;
  return `<ul class="toast-log">`
    + events.map(e => {
      const when = new Date(e.created_at);
      const stamp = isNaN(when.getTime()) ? '' : when.toLocaleString();
      const who = e.username || t('toast.userAnonymous');
      // Meta line: where it happened, plus how we heard about it when the answer
      // isn't "the app showed the user a toast" — an uncaught exception is a
      // materially different signal from a handled failure.
      const kind = e.context && e.context.kind;
      const parts = [
        e.status ? `${e.path || ''} → ${e.status}` : (e.path || ''),
        (kind && kind !== 'toast') ? t('adminMonitoring.kind.' + kind) : '',
        (e.context && e.context.where) || '',
      ].filter(Boolean);
      const where = parts.join(' · ');
      return `<li class="toast-log__item toast-log__item--${e.level === 'error' ? 'error' : 'info'} mon-event">`
        + `<span class="toast-log__time">${escHtml(stamp)}</span>`
        + `<span class="toast-log__user${e.username ? '' : ' is-anon'}">${escHtml(who)}</span>`
        + `<span class="toast-log__badge">${escHtml(t('adminMonitoring.source.' + e.source))}</span>`
        + `<span class="toast-log__msg">${escHtml(e.message)}`
        + (where ? `<span class="mon-event__path">${escHtml(where)}</span>` : '')
        + `</span>`
      + `</li>`;
    }).join('')
    + `</ul>`;
}

export class AdminMonitoringView {
  constructor() {
    this._health = null;
    this._healthError = null;
    this._destroyed = false;
    this._events = null;
    this._eventsTotal = 0;
    this._eventsError = null;
    this._retentionDays = null;
    this._eventFilter = { source: null, q: null };
    this._eventOffset = 0;
    // Typing in the search box fires overlapping requests; without a sequence
    // guard a slow earlier response lands last and overwrites the newer one, so
    // the list ends up showing results for a query you already changed. Same
    // pattern as the router's _navSeq.
    this._eventSeq = 0;
  }

  async render() {
    if (!isAuthenticated() || !isAdmin()) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }
    const el = document.createElement('div');
    el.className = 'view admin-page';
    this._el = el;
    this._build();
    // Both remote reads render into their own section, so a slow or failing one
    // never blocks (or error-banners) the rest of the page.
    this._loadEvents();
    this._loadHealth();
    return renderAdminShell({ activePath: '/admin/monitoring', content: el });
  }

  destroy() {
    this._destroyed = true;
    clearTimeout(this._eventsSearchTimer);
  }

  _build() {
    this._el.innerHTML = `
      <div class="cd-head">
        <div>
          <p class="admin-eyebrow">${t('adminMonitoring.eyebrow')}</p>
          <h1 class="admin-title">${t('adminMonitoring.title')}</h1>
          <p class="cd-sub">${t('adminMonitoring.subtitle')}</p>
        </div>
        <button type="button" class="btn btn--sm btn--outline" id="mon-refresh">${t('adminMonitoring.refresh')}</button>
      </div>

      <section class="mon-card">
        <div class="mon-card__head">
          <h2 class="mon-card__title">${t('adminMonitoring.eventsSection')}</h2>
          <div class="mon-filters">
            <input type="search" id="mon-events-q" class="form-input mon-filters__q"
                   placeholder="${escHtml(t('adminMonitoring.searchPlaceholder'))}"
                   aria-label="${escHtml(t('adminMonitoring.searchPlaceholder'))}" />
            <select id="mon-events-source" class="form-input mon-filters__select"
                    aria-label="${escHtml(t('adminMonitoring.sourceFilter'))}">
              <option value="">${t('adminMonitoring.sourceAll')}</option>
              <option value="server">${t('adminMonitoring.source.server')}</option>
              <option value="client">${t('adminMonitoring.source.client')}</option>
            </select>
          </div>
        </div>
        <p class="mon-card__help">${t('adminMonitoring.eventsHelp')}<span id="mon-events-retention"></span></p>
        <div id="mon-events"></div>
        <div class="mon-pager" id="mon-events-pager" hidden>
          <button type="button" class="btn btn--sm btn--outline" id="mon-events-prev">${t('adminMonitoring.prev')}</button>
          <span class="mon-pager__label" id="mon-events-count"></span>
          <button type="button" class="btn btn--sm btn--outline" id="mon-events-next">${t('adminMonitoring.next')}</button>
        </div>
      </section>

      <section class="mon-card">
        <div class="mon-card__head">
          <h2 class="mon-card__title">${t('adminMonitoring.logSection')}</h2>
          <button type="button" class="btn btn--sm btn--outline" id="mon-log-clear">${t('adminMonitoring.clear')}</button>
        </div>
        <p class="mon-card__help">${t('adminMonitoring.logHelp')}</p>
        <div id="mon-log"></div>
      </section>

      <section class="mon-card">
        <h2 class="mon-card__title">${t('adminMonitoring.healthSection')}</h2>
        <p class="mon-card__help">${t('adminMonitoring.healthHelp')}</p>
        <div id="mon-health"></div>
      </section>
    `;

    this._renderLog();
    this._renderEvents();
    this._renderHealth();

    this._el.querySelector('#mon-refresh').addEventListener('click', () => {
      this._renderLog();
      this._events = null;
      this._eventsError = null;
      this._renderEvents();
      this._loadEvents();
      this._health = null;
      this._healthError = null;
      this._renderHealth();
      this._loadHealth();
    });
    this._el.querySelector('#mon-log-clear').addEventListener('click', () => {
      clearToastLog();
      this._renderLog();
    });

    // Filters reset paging — page 3 of the old filter is meaningless under a new one.
    const qInput = this._el.querySelector('#mon-events-q');
    qInput.addEventListener('input', () => {
      clearTimeout(this._eventsSearchTimer);
      this._eventsSearchTimer = setTimeout(() => {
        this._eventFilter.q = qInput.value.trim() || null;
        this._eventOffset = 0;
        this._loadEvents();
      }, 300);
    });
    this._el.querySelector('#mon-events-source').addEventListener('change', (e) => {
      this._eventFilter.source = e.target.value || null;
      this._eventOffset = 0;
      this._loadEvents();
    });
    this._el.querySelector('#mon-events-prev').addEventListener('click', () => {
      this._eventOffset = Math.max(0, this._eventOffset - PAGE_SIZE);
      this._loadEvents();
    });
    this._el.querySelector('#mon-events-next').addEventListener('click', () => {
      if (this._eventOffset + PAGE_SIZE < this._eventsTotal) {
        this._eventOffset += PAGE_SIZE;
        this._loadEvents();
      }
    });
  }

  _renderLog() {
    const host = this._el.querySelector('#mon-log');
    if (host) host.innerHTML = toastLogHtml(getToastLog());
  }

  async _loadEvents() {
    const seq = ++this._eventSeq;
    try {
      const data = await fetchEvents({
        source: this._eventFilter.source,
        q: this._eventFilter.q,
        limit: PAGE_SIZE,
        offset: this._eventOffset,
      });
      if (seq !== this._eventSeq) return;        // superseded — a newer query is in flight
      this._events = data.events || [];
      this._eventsTotal = data.total || 0;
      this._retentionDays = data.retentionDays ?? null;
      this._eventsError = null;
    } catch (err) {
      if (seq !== this._eventSeq) return;
      this._events = [];
      this._eventsError = err.message;
    }
    if (!this._destroyed) this._renderEvents();
  }

  _renderEvents() {
    const host = this._el.querySelector('#mon-events');
    if (!host) return;
    if (this._eventsError) {
      host.innerHTML = `<p class="mon-error">${escHtml(t('adminMonitoring.eventsError'))} ${escHtml(this._eventsError)}</p>`;
    } else if (this._events == null) {
      host.innerHTML = `<p class="mon-loading">${t('form.loading')}</p>`;
    } else {
      host.innerHTML = eventRowsHtml(this._events);
    }

    const note = this._el.querySelector('#mon-events-retention');
    if (note) {
      note.textContent = this._retentionDays == null ? ''
        : ' ' + t('adminMonitoring.retentionNote', { days: this._retentionDays });
    }

    const pager = this._el.querySelector('#mon-events-pager');
    if (!pager) return;
    const hasPages = !this._eventsError && this._eventsTotal > PAGE_SIZE;
    pager.hidden = !hasPages;
    if (!hasPages) return;
    const from = this._eventOffset + 1;
    const to   = Math.min(this._eventOffset + PAGE_SIZE, this._eventsTotal);
    this._el.querySelector('#mon-events-count').textContent =
      t('adminMonitoring.pageRange', { from, to, total: this._eventsTotal });
    this._el.querySelector('#mon-events-prev').disabled = this._eventOffset === 0;
    this._el.querySelector('#mon-events-next').disabled = to >= this._eventsTotal;
  }

  async _loadHealth() {
    try {
      // /ready answers 503 with the SAME body when degraded — that body is
      // exactly what we want to show, so don't gate on res.ok.
      const res = await fetch('/ready', { credentials: 'include' });
      this._health = await res.json();
      this._healthError = null;
    } catch (err) {
      this._health = null;
      this._healthError = err.message;
    }
    if (!this._destroyed) this._renderHealth();
  }

  _renderHealth() {
    const host = this._el.querySelector('#mon-health');
    if (!host) return;
    host.innerHTML = this._healthHtml();
  }

  _healthHtml() {
    if (this._healthError) {
      return `<p class="mon-error">${escHtml(t('adminMonitoring.healthError'))} ${escHtml(this._healthError)}</p>`;
    }
    if (!this._health) return `<p class="mon-loading">${t('form.loading')}</p>`;

    const h = this._health;
    const c = h.checks || {};
    const checkedAt = h.timestamp ? new Date(h.timestamp).toLocaleString() : '';
    const parts = [
      // The pill already carries the word — no value column for this one.
      row(t('adminMonitoring.status'), '', h.status),
      row(t('adminMonitoring.uptime'), formatUptime(h.uptime), null),
      checkedAt ? row(t('adminMonitoring.checkedAt'), checkedAt, null) : '',
    ];
    if (c.database) {
      parts.push(row(t('adminMonitoring.database'), c.database.message || '', c.database.status));
    }
    if (c.dbPool) {
      parts.push(row(t('adminMonitoring.dbPool'), t('adminMonitoring.dbPoolValue', {
        total: c.dbPool.total, idle: c.dbPool.idle, waiting: c.dbPool.waiting,
      }), c.dbPool.status));
    }
    if (c.circuitBreaker) {
      parts.push(row(t('adminMonitoring.circuitBreaker'), c.circuitBreaker.state || '', c.circuitBreaker.status));
    }
    if (c.memory) {
      parts.push(row(t('adminMonitoring.memory'), t('adminMonitoring.memoryValue', {
        used: c.memory.heapUsedMb, limit: c.memory.heapLimitMb, ratio: c.memory.ratio,
      }), c.memory.status));
    }
    if (c.eventLoop) {
      parts.push(row(t('adminMonitoring.eventLoop'),
        t('adminMonitoring.eventLoopValue', { ms: c.eventLoop.lagMs }), c.eventLoop.status));
    }
    return `<div class="mon-rows">${parts.join('')}</div>`;
  }
}

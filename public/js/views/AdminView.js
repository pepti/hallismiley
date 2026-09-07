// AdminView — /admin, the company overview.
//
// Orange Smiley's console opens on where the company stands today: the books
// (last 30 days), open change requests (the support product), the system
// (errors, the changes this build carries), the sales handbook and the user
// list. Every card reads an endpoint that already exists — nothing here has a
// data path of its own — and every card is gated on the view (or admin role)
// the endpoint demands, so a custom role sees only its own cards and never a
// 403. Cards load independently: one failing endpoint blanks one card.
//
// The portfolio projects board that used to live here is AdminProjectsView.js
// at /admin/projects (unlisted; 2026-09-07).

import { isAuthenticated, isAdmin, canEdit, canSeeView, adminGetUsers } from '../services/auth.js';
import { escHtml }         from '../utils/escHtml.js';
import { t, href }         from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell, ADMIN_NAV } from '../components/AdminSidebar.js';
import { fetchDashboard } from '../services/adminBookkeeping.js';
import { fetchEvents } from '../services/adminEvents.js';
import { getChanges } from '../services/buildInfo.js';
import { getGuides, getManageList } from '../services/salesGuides.js';
import { updateRowHtml } from '../components/ChangesList.js';
import { isk } from './booksShared.js';

const BOOKS_DAYS    = 30;
const CHANGES_SHOWN = 5;
// The change-request list has no count endpoint; one page is enough to say
// "N open" or "50+ open" on a card.
const FEEDBACK_PAGE = 50;
// Pending approvals are counted over the newest accounts (the list has no
// approval filter); on a company site that is the whole list for a long time.
const USERS_PAGE    = 100;

function stat(label, value, tone = '') {
  return `<div class="dash-stat${tone ? ` dash-stat--${tone}` : ''}">`
    + `<span class="dash-stat__label">${escHtml(label)}</span>`
    + `<span class="dash-stat__value">${escHtml(value)}</span>`
    + `</div>`;
}

function big(value, label, tone = '') {
  return `<div class="dash-big${tone ? ` dash-big--${tone}` : ''}">`
    + `<span class="dash-big__value">${escHtml(value)}</span>`
    + `<span class="dash-big__label">${escHtml(label)}</span>`
    + `</div>`;
}

async function fetchOpenChangeRequests() {
  const res = await fetch(`/api/v1/admin/change-requests?status=open&limit=${FEEDBACK_PAGE}`, { credentials: 'include' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load change requests');
  return data.batches || [];
}

// Card table. `gate` decides whether the card exists for this account; `load`
// fetches; `render` turns the result into the card body. `route` is the
// screen the card's "Open" link goes to (only when the account can see it).
const CARDS = [
  {
    key: 'books', title: 'adminDashboard.books', route: '/admin/books',
    gate: () => canSeeView('books'),
    load: () => {
      const to = new Date();
      const from = new Date(to.getTime() - BOOKS_DAYS * 86400000);
      return fetchDashboard({ from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) });
    },
    render: (data) => {
      const m = data.metrics || {};
      return stat(t('adminDashboard.booksInvoiced'), isk(m.invoiced_gross))
        + stat(t('adminDashboard.booksReceivable'), isk(m.ar_outstanding))
        + stat(t('adminDashboard.booksOverdue', { count: m.ar_overdue_count ?? 0 }), isk(m.ar_overdue), m.ar_overdue > 0 ? 'warn' : '')
        + stat(t('adminDashboard.booksVat'), isk(m.output_vat), m.output_vat > 0 ? 'warn' : '');
    },
  },
  {
    key: 'feedback', title: 'adminDashboard.feedback', route: '/admin/feedback',
    gate: () => canSeeView('feedback'),
    load: fetchOpenChangeRequests,
    render: (batches) => {
      const open = batches.reduce((n, b) => n + ((b.items && b.items.length) || 0), 0);
      const capped = batches.length >= FEEDBACK_PAGE;
      const label = t(capped ? 'adminDashboard.feedbackOpenMany' : 'adminDashboard.feedbackOpen', { count: open });
      return big(capped ? `${open}+` : String(open), label, open > 0 ? 'warn' : '');
    },
  },
  {
    key: 'monitoring', title: 'adminDashboard.monitoring', route: '/admin/monitoring',
    gate: () => isAdmin(),
    load: () => fetchEvents({ level: 'error', limit: 1 }),
    render: (data) => {
      const total = Number(data.total) || 0;
      return big(String(total), t('adminDashboard.monitoringErrors', { count: total, days: data.retentionDays ?? '' }), total > 0 ? 'warn' : 'ok');
    },
  },
  {
    key: 'changes', title: 'adminDashboard.changes', route: '/admin/monitoring',
    gate: () => isAdmin(),
    load: getChanges,
    render: (data) => {
      const changes = (data && data.changes) || [];
      if (!changes.length) return `<p class="dash-card__note">${escHtml(t('adminDashboard.changesNone'))}</p>`;
      return `<ul class="mon-updates">${changes.slice(0, CHANGES_SHOWN).map(updateRowHtml).join('')}</ul>`;
    },
  },
  {
    key: 'handbok', title: 'adminDashboard.handbok', route: '/admin/handbok',
    gate: () => canSeeView('handbok'),
    load: () => (canEdit() ? getManageList() : getGuides()),
    render: (data) => {
      const guides = (data && data.guides) || [];
      const published = guides.filter(g => g.published !== false).length;
      let html = stat(t('adminDashboard.handbokPublished', { count: published }), '');
      if (canEdit()) html += stat(t('adminDashboard.handbokDrafts', { count: guides.length - published }), '');
      return html;
    },
  },
  {
    key: 'users', title: 'adminDashboard.users', route: '/admin/users',
    gate: () => canSeeView('users'),
    load: () => adminGetUsers({ limit: USERS_PAGE, sort: 'created_at', order: 'desc' }),
    render: (data) => {
      const users = Array.isArray(data) ? data : (data.users || []);
      const total = Number(data.total) || users.length;
      const pending = users.filter(u => u.approval_status === 'pending').length;
      return stat(t('adminDashboard.usersTotal', { count: total }), '')
        + stat(t('adminDashboard.usersPending', { count: pending }), '', pending > 0 ? 'warn' : '');
    },
  },
];

export class AdminView {
  async render() {
    if (!isAuthenticated()) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }

    // A user whose role grants OTHER admin views but not this one — e.g.
    // `solufolk` with only 'handbok' — lands here from the NavBar "Admin"
    // entry; forward them to the first sidebar item their role can actually
    // see instead of a screen of 403s.
    if (!canSeeView('dashboard') && !canEdit()) {
      const first = ADMIN_NAV.flatMap(g => g.items)
        .find(item => !item.soon && item.route !== '/admin' && canSeeView(item.id));
      navigateReplace(href(first ? first.route : '/'));
      return document.createTextNode('');
    }

    const cards = CARDS.filter(c => c.gate());
    const el = document.createElement('div');
    el.className = 'main admin-page';
    el.innerHTML = `
      <div class="admin-header">
        <div>
          <p class="admin-eyebrow">${t('admin.dashboard')}</p>
          <h1 class="admin-title">${t('adminDashboard.title')}</h1>
          <p class="admin-subtitle">${escHtml(t('adminDashboard.subtitle'))}</p>
        </div>
        ${canEdit() ? `<div class="admin-header__actions">
          <a href="${href('/admin/projects')}" class="btn btn--outline btn--sm" data-route="/admin/projects">${escHtml(t('adminDashboard.projectsLink'))}</a>
        </div>` : ''}
      </div>
      ${cards.length ? `<div class="dash-grid">${cards.map(c => this._cardShell(c)).join('')}</div>`
        : `<p class="dash-empty">${escHtml(t('adminDashboard.empty'))}</p>`}
    `;

    // Independent loads — a slow or failing endpoint affects one card only.
    cards.forEach(c => this._fill(el, c));
    return renderAdminShell({ activePath: '/admin', content: el });
  }

  _cardShell(c) {
    const open = canSeeView(c.route === '/admin/monitoring' ? 'monitoring' : c.key) || isAdmin();
    return `<article class="dash-card" data-card="${escHtml(c.key)}">
      <div class="dash-card__head">
        <h2 class="dash-card__title">${escHtml(t(c.title))}</h2>
        ${open ? `<a class="dash-card__link" href="${href(c.route)}" data-route="${c.route}">${escHtml(t('adminDashboard.open'))} →</a>` : ''}
      </div>
      <div class="dash-card__body"><p class="dash-card__loading">${escHtml(t('form.loading'))}</p></div>
    </article>`;
  }

  // No `isConnected` guard here on purpose: the router awaits render() and
  // attaches the element afterwards (inside a view transition when allowed),
  // and a local endpoint answers in a few ms — before the swap. Writing into
  // the not-yet-attached element is exactly right; a stale element after a
  // later navigation is garbage either way.
  async _fill(el, c) {
    const body = el.querySelector(`[data-card="${c.key}"] .dash-card__body`);
    if (!body) return;
    try {
      const data = await c.load();
      body.innerHTML = c.render(data);
    } catch {
      body.innerHTML = `<p class="dash-card__error">${escHtml(t('adminDashboard.loadError'))}</p>`;
    }
  }
}

// AdminCustomersView (/admin/customers) — a shop-customer lens on the users
// table: list + search with order aggregates, Export CSV, Add (a passwordless
// account + "set your password" invite), and CSV Import. B2C: no companies/
// kennitala. Add/Import are admin-only; listing is gated by the 'customers' view.
import { isAuthenticated, canSeeView, isAdmin } from '../services/auth.js';
import { escHtml } from '../utils/escHtml.js';
import { t, href, getLocale } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { showToast } from '../components/Toast.js';
import { downloadCsv } from '../utils/downloadCsv.js';
import { formatDate, formatMoney } from '../utils/format.js';
import {
  adminListCustomers, adminCreateCustomer,
  adminPreviewCustomerImport, adminApplyCustomerImport, adminDeleteCustomers,
  adminGetInvitePreview, adminRenderInvitePreview, adminSaveInviteTemplate, adminSendBulkInvites,
  adminGetCustomer, adminUpdateCustomer, adminInviteCustomer,
} from '../services/adminCustomers.js';
import { parseCsvRecords } from '../utils/csv.js';
import { CustomerNotes } from '../components/CustomerNotes.js';
import { credentialsPanelHtml, wireCredentialsPanel } from '../components/OneTimeCredentials.js';
import { expiryFieldHtml, wireExpiryField, readExpiryField } from '../components/ExpiryPicker.js';

// Parse an Email/Name/Phone CSV → [{ email, display_name, phone }]. Tolerant of
// either English or Icelandic header names; rows without an email are dropped.
function parseCustomerCsv(text) {
  const records = parseCsvRecords(text);
  if (!records.length) return [];
  const header = records[0].map(h => h.trim().toLowerCase());
  const find = (names) => header.findIndex(h => names.includes(h));
  const ei = find(['email', 'e-mail', 'netfang']);
  const ni = find(['name', 'display name', 'nafn']);
  const pi = find(['phone', 'phone number', 'sími', 'simi']);
  if (ei < 0) return [];
  const out = [];
  for (let i = 1; i < records.length; i += 1) {
    const c = records[i];
    const email = String(c[ei] != null ? c[ei] : '').trim();
    if (!email) continue;
    out.push({
      email,
      display_name: ni >= 0 ? String(c[ni] != null ? c[ni] : '').trim() : '',
      phone:        pi >= 0 ? String(c[pi] != null ? c[pi] : '').trim() : '',
    });
  }
  return out;
}

export class AdminCustomersView {
  constructor() {
    this._el = null; this._customers = []; this._q = ''; this._searchDebounce = null;
    this._selected = new Set(); // selected customer ids (role='user' rows only)
    this._invite = null;        // send-invites panel state { data, locale, edits, removed }
    this._previewTimer = null;
  }

  async render() {
    if (!isAuthenticated() || !canSeeView('customers')) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }
    const admin = isAdmin();
    this._el = document.createElement('div');
    this._el.className = 'view admin-shop';
    this._el.innerHTML = `
      <div class="admin-shop__inner">
        <header class="admin-shop__header">
          <h1>${t('adminCustomers.title')}</h1>
          <div class="admin-shop__header-actions">
            <button type="button" id="cust-export" class="admin-shop__primary-btn">${t('adminProducts.export')}</button>
            ${admin ? `<button type="button" id="cust-send-invites" class="admin-shop__primary-btn" aria-expanded="false">${t('adminCustomers.sendInvites')}</button>
            <button type="button" id="cust-import" class="admin-shop__primary-btn">${t('adminProducts.import')}</button>
            <button type="button" id="cust-add" class="admin-shop__primary-btn">${t('adminCustomers.add')}</button>` : ''}
          </div>
        </header>
        <div class="admin-shop__header-controls">
          <input type="search" id="cust-q" class="admin-shop__search"
                 placeholder="${t('adminCustomers.searchPlaceholder')}" autocomplete="off"/>
        </div>
        <div class="inv-panel" id="inv-panel" hidden></div>
        <div class="cust-bulkbar" id="cust-bulkbar" hidden></div>
        <div id="cust-body"><p>${t('form.loading')}</p></div>
      </div>`;

    this._el.querySelector('#cust-export').addEventListener('click', () => this._exportCsv());
    this._el.querySelector('#cust-add')?.addEventListener('click', () => this._openAddModal());
    this._el.querySelector('#cust-import')?.addEventListener('click', () => this._openImportModal());
    this._el.querySelector('#cust-send-invites')?.addEventListener('click', () => this._toggleInvitePanel());
    const search = this._el.querySelector('#cust-q');
    search.addEventListener('input', (e) => {
      clearTimeout(this._searchDebounce);
      const v = e.target.value;
      this._searchDebounce = setTimeout(() => { this._q = v; this._load(); }, 250);
    });

    await this._load();
    return renderAdminShell({ activePath: '/admin/customers', content: this._el });
  }

  async _load() {
    const body = this._el.querySelector('#cust-body');
    // Selection is per-rendered-list: reset on every (re)load so you can never
    // act on rows you can't see (searching funnels through here too).
    this._selected.clear();
    this._syncBulkBar();
    try {
      const data = await adminListCustomers(this._q);
      this._customers = data.customers || [];
      this._paint();
    } catch (err) {
      body.innerHTML = `<p class="admin-shop__error">${escHtml(err.message)}</p>`;
    }
  }

  // The kit formatter, which follows the app locale (was toLocaleDateString
  // ('en-GB') — English in the Icelandic admin). Ported from icelandicstore #324.
  _date(iso) {
    return iso ? formatDate(iso, { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  }

  // invited_at is stamped only on a confirmed send (ice #258), so "Invited
  // <date>" is a receipt the admin can trust; a name-only login (no email,
  // ice #397) has nothing to verify or invite.
  _statusLabel(c) {
    if (c.disabled) return t('adminCustomers.disabled');
    if (!c.email) return t('adminCustomers.noEmailLogin');
    if (c.email_verified) return t('adminCustomers.verified');
    return c.invited_at ? t('adminCustomers.invitedOn', { date: this._date(c.invited_at) }) : t('adminCustomers.pending');
  }

  _paint() {
    const body  = this._el.querySelector('#cust-body');
    const admin = isAdmin();
    if (!this._customers.length) { body.innerHTML = `<p>${t('adminCustomers.empty')}</p>`; return; }
    body.innerHTML = `
      <table class="admin-shop__table">
        <thead><tr>
          ${admin ? `<th class="cust-select"><input type="checkbox" id="cust-select-all" aria-label="${t('adminCustomers.selectAll')}"/></th>` : ''}
          <th>${t('adminCustomers.email')}</th><th>${t('adminCustomers.name')}</th><th>${t('adminCustomers.phone')}</th>
          <th>${t('adminCustomers.orders')}</th><th>${t('adminCustomers.spent')}</th>
          <th>${t('adminCustomers.joined')}</th><th>${t('adminCustomers.status')}</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${this._customers.map(c => `
            <tr>
              ${admin ? `<td class="cust-select">${(c.role === 'user' && !c.is_party_guest)
                ? `<input type="checkbox" class="cust-row-select" data-id="${escHtml(String(c.id))}" aria-label="${t('adminCustomers.selectRow')}"/>`
                : ''}</td>` : ''}
              <td>${c.email ? escHtml(c.email) : `<span class="users-no-email">${t('adminUsers.noEmail')}</span>`}</td>
              <td>${escHtml(c.display_name || '—')}</td>
              <td>${escHtml(c.phone || '—')}</td>
              <td>${Number(c.order_count) || 0}</td>
              <td>${Number(c.total_spent) ? formatMoney(c.total_spent, 'ISK') : '—'}</td>
              <td>${this._date(c.created_at)}</td>
              <td>${escHtml(this._statusLabel(c))}</td>
              <td class="cust-actions">${c.role === 'user'
                ? `${c.is_party_guest ? '' : `<button type="button" class="cust-notes-btn cust-edit-btn" data-edit-id="${escHtml(String(c.id))}"
                     aria-label="${escHtml(t('adminCustomers.editRow', { name: c.display_name || c.email || c.username || '' }))}">${t('adminCustomers.edit')}</button>`}
                   <button type="button" class="cust-notes-btn" data-id="${escHtml(String(c.id))}" data-email="${escHtml(c.email || c.display_name || c.username || '')}">${t('customerNotes.title')}</button>`
                : ''}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
    if (admin) this._wireSelection(body);
    body.querySelectorAll('.cust-notes-btn[data-id]').forEach(btn => {
      btn.addEventListener('click', () => this._openNotesModal(btn.dataset.id, btn.dataset.email));
    });
    body.querySelectorAll('.cust-edit-btn[data-edit-id]').forEach(btn => {
      btn.addEventListener('click', () => this._openEditModal(btn.dataset.editId, btn));
    });
  }

  // ── Edit one customer (harvest 2 lane 3; ported from icelandicstore #336) ──
  // Contact details + a postal address (migration 117_user_address), and the
  // welcome invite for a customer who has no password yet. Any holder of the
  // `customers` view may do this; the server holds the target to a plain
  // customer (a staff account or party guest is 404) and never answers with the
  // set-password link, so a failed send is reported, not worked around.
  async _openEditModal(id, opener) {
    const modal = document.createElement('div');
    modal.className = 'admin-shop__modal';
    modal.innerHTML = `
      <div class="admin-shop__modal-card cust-edit" role="dialog" aria-modal="true" aria-labelledby="cust-edit-title">
        <header>
          <h2 id="cust-edit-title">${t('adminCustomers.editTitle')}</h2>
          <button type="button" class="admin-shop__modal-close" aria-label="${t('common.close')}">✕</button>
        </header>
        <div class="cust-edit__body"><p>${t('form.loading')}</p></div>
      </div>`;
    document.body.appendChild(modal);
    const close = () => { modal.remove(); document.removeEventListener('keydown', onKey); opener?.focus(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    modal.querySelector('.admin-shop__modal-close').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    const bodyEl = modal.querySelector('.cust-edit__body');

    let c;
    try {
      c = await adminGetCustomer(id);
    } catch (err) {
      bodyEl.innerHTML = `<p class="admin-shop__error" role="alert">${escHtml(err.message)}</p>`;
      return;
    }
    if (!modal.isConnected) return;
    const field = (name, label, attrs = '') => `
      <label>${label}
        <input type="text" name="${name}" value="${escHtml(c[name] || '')}" ${attrs}/>
      </label>`;
    const inviteState = !c.email ? t('adminCustomers.noEmailNoInvite')
      : c.has_password ? t('adminCustomers.hasPasswordNote') : '';
    bodyEl.innerHTML = `
      <form class="admin-shop__form" id="cust-edit-form" novalidate>
        <label>${t('adminCustomers.email')}
          <input type="email" name="email" value="${escHtml(c.email || '')}" maxlength="254" ${c.email ? 'required' : ''} autocomplete="off"/>
        </label>
        ${field('display_name', t('adminCustomers.name'), 'maxlength="200"')}
        ${field('phone', t('adminCustomers.phone'), 'maxlength="20" inputmode="tel"')}
        ${field('address1', t('adminCustomers.address1'), 'maxlength="200" autocomplete="off"')}
        ${field('address2', t('adminCustomers.address2'), 'maxlength="200" autocomplete="off"')}
        <div class="cust-edit__row">
          ${field('zip', t('adminCustomers.zip'), 'maxlength="20" autocomplete="off"')}
          ${field('city', t('adminCustomers.city'), 'maxlength="100" autocomplete="off"')}
        </div>
        ${field('country', t('adminCustomers.country'), 'maxlength="2" autocomplete="off"')}
        <p class="admin-shop__error" id="cust-edit-error" role="alert"></p>
        <div class="admin-shop__form-actions">
          <button type="submit" class="admin-shop__primary-btn">${t('form.save')}</button>
        </div>
      </form>
      <section class="cust-edit__invite" aria-labelledby="cust-invite-head">
        <h3 class="cust-edit__subhead" id="cust-invite-head">${t('adminCustomers.inviteSection')}</h3>
        <p class="admin-shop__hint">${inviteState || t('adminCustomers.inviteHint')}</p>
        ${inviteState ? '' : `<button type="button" class="admin-shop__primary-btn" id="cust-edit-invite">${t('adminCustomers.sendInvite')}</button>`}
        <p class="cust-edit__status" id="cust-invite-status" role="status" aria-live="polite"></p>
      </section>`;
    bodyEl.querySelector('[name=email]')?.focus();

    const form = bodyEl.querySelector('#cust-edit-form');
    const errEl = bodyEl.querySelector('#cust-edit-error');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errEl.textContent = '';
      // Only what changed is sent — the server touches only the keys it gets.
      const fd = new FormData(form);
      const patch = {};
      for (const k of ['email', 'display_name', 'phone', 'address1', 'address2', 'zip', 'city', 'country']) {
        const v = String(fd.get(k) ?? '').trim();
        if (v !== String(c[k] || '')) patch[k] = v;
      }
      // The postcode rule depends on the country (an Icelandic postnúmer is
      // three digits), so the server checks them as a pair: send both.
      if ('zip' in patch || 'country' in patch) {
        patch.zip = String(fd.get('zip') ?? '').trim();
        patch.country = String(fd.get('country') ?? '').trim();
      }
      if (!Object.keys(patch).length) { close(); return; }
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        c = { ...c, ...(await adminUpdateCustomer(id, patch)) };
        showToast(t('adminCustomers.saved'), 'success');
        close();
        await this._load();
      } catch (err) {
        errEl.textContent = err.message;
        btn.disabled = false;
      }
    });

    bodyEl.querySelector('#cust-edit-invite')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const status = bodyEl.querySelector('#cust-invite-status');
      btn.disabled = true;
      status.textContent = '';
      try {
        const res = await adminInviteCustomer(id);
        // "Invite sent" means sent (ice #258): say exactly what happened.
        status.textContent = res.invited ? t('adminCustomers.inviteSentOk')
          : res.redirected ? t('adminCustomers.inviteRedirectedNoLink')
          : t('adminCustomers.inviteNotSent');
        status.classList.toggle('cust-edit__status--ok', !!res.invited);
        if (res.invited) showToast(t('adminCustomers.inviteSentOk'), 'success');
        btn.disabled = false;
      } catch (err) {
        status.textContent = err.message;
        status.classList.remove('cust-edit__status--ok');
        btn.disabled = false;
      }
    });
  }

  // ── Send-invites confirmation panel ────────────────────────────────────────
  // Bulk-send welcome invites to approved, passwordless, not-yet-invited
  // customers. Clicking "Send invites" doesn't fire immediately — it toggles a
  // panel that shows WHO will be emailed, warns that Send dispatches mail
  // immediately, previews the email, and lets the admin edit + save the copy
  // (per language) as the new default before sending.
  async _toggleInvitePanel(force) {
    const panel = this._el.querySelector('#inv-panel');
    const btn   = this._el.querySelector('#cust-send-invites');
    if (!panel) return;
    const willOpen = (typeof force === 'boolean') ? force : panel.hidden;
    if (!willOpen) {
      panel.hidden = true;
      btn?.setAttribute('aria-expanded', 'false');
      clearTimeout(this._previewTimer);
      return;
    }
    panel.hidden = false;
    btn?.setAttribute('aria-expanded', 'true');
    panel.innerHTML = `<p>${t('form.loading')}</p>`;
    this._invite = { data: null, locale: getLocale(), edits: {}, removed: new Set() };
    try {
      this._invite.data = await adminGetInvitePreview();
      this._renderInvitePanel();
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      panel.innerHTML = `<p class="admin-shop__error">${escHtml(err.message)}</p>`;
    }
  }

  // Current editor values for a locale: admin edit (if touched) over the saved/
  // default template returned by the server.
  _inviteFields(loc) {
    const tpl = (this._invite.data.template || {})[loc] || {};
    const e   = (this._invite.edits || {})[loc] || {};
    return {
      subject: e.subject ?? tpl.subject ?? '',
      heading: e.heading ?? tpl.heading ?? '',
      body:    e.body    ?? tpl.body    ?? '',
    };
  }

  _renderInvitePanel() {
    const panel = this._el.querySelector('#inv-panel');
    if (!panel || !this._invite?.data) return;
    const loc = this._invite.locale;
    const f = this._inviteFields(loc);

    const langBtns = ['en', 'is'].map(l =>
      `<button type="button" class="inv-lang__btn${l === loc ? ' is-active' : ''}" data-lang="${l}" role="tab" aria-selected="${l === loc}">${l.toUpperCase()}</button>`
    ).join('');

    panel.innerHTML = `
      <div class="inv-panel__head">
        <h2 class="inv-panel__title">${t('adminCustomers.invitePanelTitle')}</h2>
        <button type="button" class="inv-panel__close" id="inv-close" aria-label="${t('common.close')}">✕</button>
      </div>

      <div class="inv-grid">
        <section class="inv-col inv-col--recipients">
          <h3 class="inv-subhead" id="inv-recip-head"></h3>
          <div id="inv-recipients-wrap"></div>
          <p class="inv-hint">${t('adminCustomers.inviteHelp')}</p>
        </section>

        <section class="inv-col inv-col--editor">
          <div class="inv-lang" role="tablist" aria-label="${t('adminCustomers.invitePanelTitle')}">
            ${langBtns}
            <button type="button" class="inv-reset" id="inv-reset">${t('adminCustomers.inviteResetDefault')}</button>
          </div>
          <label class="inv-field"><span>${t('adminCustomers.inviteSubject')}</span>
            <input type="text" id="inv-subject" maxlength="200" value="${escHtml(f.subject)}"/></label>
          <label class="inv-field"><span>${t('adminCustomers.inviteHeading')}</span>
            <input type="text" id="inv-heading" maxlength="200" value="${escHtml(f.heading)}"/></label>
          <label class="inv-field"><span>${t('adminCustomers.inviteBody')}</span>
            <textarea id="inv-body" class="inv-textarea" maxlength="4000" rows="6">${escHtml(f.body)}</textarea></label>
          <p class="inv-hint">${t('adminCustomers.inviteBodyHint')}</p>
        </section>

        <section class="inv-col inv-col--preview">
          <h3 class="inv-subhead">${t('adminCustomers.invitePreviewTitle')}</h3>
          <iframe id="inv-preview-frame" class="inv-preview-frame" title="${t('adminCustomers.invitePreviewTitle')}" sandbox></iframe>
        </section>
      </div>

      <div class="inv-banner" id="inv-banner"></div>

      <div class="inv-actions">
        <label class="inv-ack"><input type="checkbox" id="inv-ack"/> <span>${t('adminCustomers.inviteAck')}</span></label>
        <div class="inv-actions__btns">
          <button type="button" class="admin-shop__primary-btn" id="inv-save">${t('adminCustomers.inviteSaveDefault')}</button>
          <button type="button" class="admin-shop__primary-btn" id="inv-send" disabled></button>
        </div>
      </div>
    `;

    this._wireInvitePanel();
    this._renderInviteRecipients(); // list + count-dependent labels (subhead/banner/send)
    this._invitePreviewRender();    // initial preview (immediate, no debounce)
  }

  // Candidates minus the ones the admin removed in the panel (per-row ✕).
  _activeCandidates() {
    const all = (this._invite.data && this._invite.data.candidates) || [];
    const removed = this._invite.removed || new Set();
    return all.filter(c => !removed.has(c.id));
  }

  // Render the recipient list + everything whose text depends on the live count
  // (the "Recipients (N)" head, the warn/info banner, the "Send N emails" label).
  // Called on open and after each removal — never touches the editor/preview.
  _renderInviteRecipients() {
    const panel = this._el.querySelector('#inv-panel');
    if (!panel || !this._invite?.data) return;
    const d = this._invite.data;
    const active = this._activeCandidates();
    const count = active.length;

    const head = panel.querySelector('#inv-recip-head');
    if (head) head.textContent = t('adminCustomers.inviteRecipientsHead', { n: count });

    const wrap = panel.querySelector('#inv-recipients-wrap');
    if (wrap) {
      if (!(d.candidates || []).length) {
        wrap.innerHTML = `<p class="inv-empty">${t('adminCustomers.inviteNoRecipients')}</p>`;
      } else if (!count) {
        wrap.innerHTML = `<p class="inv-empty">${t('adminCustomers.inviteAllRemoved')}</p>`;
      } else {
        wrap.innerHTML = `<ul class="inv-recipients">${active.map(r => `
          <li class="inv-recipients__row">
            <span class="inv-recipients__name">${escHtml(r.display_name || r.email)}</span>
            <span class="inv-recipients__email">${escHtml(r.email)}</span>
            <span class="inv-recipients__lang">${escHtml(String(r.preferred_locale || 'en').toUpperCase())}</span>
            <button type="button" class="inv-recipients__remove" data-id="${escHtml(String(r.id))}"
                    aria-label="${t('adminCustomers.inviteRemoveRecipient')}" title="${t('adminCustomers.inviteRemoveRecipient')}">✕</button>
          </li>`).join('')}</ul>`;
        wrap.querySelectorAll('.inv-recipients__remove').forEach(b => {
          b.addEventListener('click', () => {
            (this._invite.removed ||= new Set()).add(b.dataset.id);
            this._renderInviteRecipients();
          });
        });
      }
    }

    const banner = panel.querySelector('#inv-banner');
    if (banner) {
      banner.className = 'inv-banner ' + (d.emailConfigured ? 'inv-banner--warn' : 'inv-banner--info');
      banner.textContent = d.emailConfigured
        ? t('adminCustomers.inviteWillSendNow', { n: count })
        : t('adminCustomers.inviteEmailNotConfigured');
    }

    const send = panel.querySelector('#inv-send');
    if (send) send.textContent = t('adminCustomers.inviteSendNow', { n: count });
    this._syncInviteSend();
  }

  // Enable Send only when the ack box is ticked AND ≥1 recipient remains.
  _syncInviteSend() {
    const panel = this._el.querySelector('#inv-panel');
    const send = panel?.querySelector('#inv-send');
    const ack  = panel?.querySelector('#inv-ack');
    if (send) send.disabled = !(ack?.checked && this._activeCandidates().length > 0);
  }

  _wireInvitePanel() {
    const panel = this._el.querySelector('#inv-panel');
    if (!panel) return;

    panel.querySelector('#inv-close')?.addEventListener('click', () => this._toggleInvitePanel(false));

    panel.querySelectorAll('.inv-lang__btn').forEach(b => {
      b.addEventListener('click', () => { this._invite.locale = b.dataset.lang; this._renderInvitePanel(); });
    });

    const bind = (id, field) => {
      const inp = panel.querySelector('#' + id);
      inp?.addEventListener('input', () => {
        const loc = this._invite.locale;
        (this._invite.edits[loc] ||= {})[field] = inp.value;
        this._invitePreviewRefresh();
      });
    };
    bind('inv-subject', 'subject');
    bind('inv-heading', 'heading');
    bind('inv-body', 'body');

    panel.querySelector('#inv-reset')?.addEventListener('click', () => {
      const loc = this._invite.locale;
      const def = (this._invite.data.defaults || {})[loc] || {};
      this._invite.edits[loc] = { subject: def.subject || '', heading: def.heading || '', body: def.body || '' };
      this._renderInvitePanel();
    });

    panel.querySelector('#inv-ack')?.addEventListener('change', () => this._syncInviteSend());

    panel.querySelector('#inv-save')?.addEventListener('click', () => this._inviteSave());
    panel.querySelector('#inv-send')?.addEventListener('click', () => this._inviteSend());
  }

  _invitePreviewRefresh() {
    clearTimeout(this._previewTimer);
    this._previewTimer = setTimeout(() => this._invitePreviewRender(), 300);
  }

  async _invitePreviewRender() {
    const frame = this._el.querySelector('#inv-preview-frame');
    if (!frame) return;
    const loc = this._invite.locale;
    const f = this._inviteFields(loc);
    try {
      const html = await adminRenderInvitePreview({ locale: loc, subject: f.subject, heading: f.heading, body: f.body });
      if (frame.isConnected) frame.srcdoc = html;
    } catch {
      // Preview is best-effort; the editor stays usable without it.
    }
  }

  // Build the per-locale patch from only the fields the admin actually touched.
  _invitePatch() {
    const patch = {};
    for (const loc of ['en', 'is']) {
      const e = this._invite.edits[loc];
      if (e && Object.keys(e).length) patch[loc] = { ...e };
    }
    return patch;
  }

  async _inviteSave() {
    const btn = this._el.querySelector('#inv-save');
    if (btn) btn.disabled = true;
    try {
      const patch = this._invitePatch();
      if (Object.keys(patch).length) {
        this._invite.data.template = await adminSaveInviteTemplate(patch);
        this._invite.edits = {}; // edits are now the saved baseline
      }
      showToast(t('adminCustomers.inviteSaved'), 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async _inviteSend() {
    const send = this._el.querySelector('#inv-send');
    const save = this._el.querySelector('#inv-save');
    if (send) send.disabled = true;
    if (save) save.disabled = true;
    try {
      // Persist edits as the new default first, so what we send == what we saved.
      const patch = this._invitePatch();
      if (Object.keys(patch).length) {
        this._invite.data.template = await adminSaveInviteTemplate(patch);
        this._invite.edits = {};
      }
      const result = await adminSendBulkInvites({ recipientIds: this._activeCandidates().map(c => c.id) });
      if (result.sent === 0) {
        showToast(t('adminCustomers.sendInvitesNone'), 'info');
      } else {
        showToast(t('adminCustomers.sendInvitesSent', { n: result.sent }), 'success');
        // One run is capped server-side; if candidates are still waiting say so
        // explicitly, so a bounded run never reads as "everyone was invited".
        if (result.remaining > 0) {
          showToast(t('adminCustomers.sendInvitesRemaining', { n: result.remaining }), 'info');
        }
        if (result.devLinks?.length) {
          // Dev convenience (Resend not configured) — surface the links somewhere
          // copyable. console is deliberate here: dev-only, never in production.

          console.log('[Send invites] Dev links (Resend not configured — copy these):');

          result.devLinks.forEach(({ email, link }) => console.log(` ${email}: ${link}`));
        }
      }
      this._toggleInvitePanel(false);
      this._load();
    } catch (err) {
      showToast(err.message, 'error');
      if (send) send.disabled = false;
      if (save) save.disabled = false;
    }
  }

  // Notes modal — hosts the reusable CustomerNotes component for one customer.
  _openNotesModal(customerId, email) {
    const modal = document.createElement('div');
    modal.className = 'admin-shop__modal';
    modal.innerHTML = `
      <div class="admin-shop__modal-card">
        <header>
          <h2>${t('customerNotes.title')} — ${escHtml(email)}</h2>
          <button type="button" class="admin-shop__modal-close" aria-label="${t('common.close')}">✕</button>
        </header>
        <div class="cn-modal-body"></div>
      </div>`;
    document.body.appendChild(modal);
    const notes = new CustomerNotes({ customerId, isAdminViewer: isAdmin() });
    modal.querySelector('.cn-modal-body').appendChild(notes.mount());
    const close = () => { notes.destroy(); modal.remove(); };
    modal.querySelector('.admin-shop__modal-close').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  }

  // ── Bulk selection + delete (admin only) ──────────────────────────────────
  // Only role='user' rows get a checkbox (staff/admin accounts are managed on
  // /admin/users); the server re-guards regardless. The bar lives outside
  // #cust-body so a repaint never drops it.
  _wireSelection(body) {
    const selectAll = body.querySelector('#cust-select-all');
    const rowBoxes  = [...body.querySelectorAll('.cust-row-select')];
    const syncHeader = () => {
      if (!selectAll) return;
      const checked = rowBoxes.filter(b => b.checked).length;
      selectAll.checked = checked > 0 && checked === rowBoxes.length;
      selectAll.indeterminate = checked > 0 && checked < rowBoxes.length;
    };
    selectAll?.addEventListener('change', () => {
      rowBoxes.forEach(cb => {
        cb.checked = selectAll.checked;
        if (selectAll.checked) this._selected.add(cb.dataset.id); else this._selected.delete(cb.dataset.id);
      });
      selectAll.indeterminate = false;
      this._syncBulkBar();
    });
    rowBoxes.forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) this._selected.add(cb.dataset.id); else this._selected.delete(cb.dataset.id);
        syncHeader();
        this._syncBulkBar();
      });
    });
  }

  _syncBulkBar() {
    const bar = this._el?.querySelector('#cust-bulkbar');
    if (!bar) return;
    const n = this._selected.size;
    if (n === 0) { bar.hidden = true; bar.innerHTML = ''; return; }
    bar.innerHTML = `
      <span class="cust-bulkbar__count">${t('adminCustomers.nSelected', { n })}</span>
      <button type="button" class="admin-shop__primary-btn cust-bulkbar__delete" id="cust-bulk-delete">${t('adminCustomers.deleteSelected')}</button>
      <button type="button" class="admin-shop__primary-btn" id="cust-bulk-clear">${t('adminCustomers.clearSelection')}</button>`;
    bar.hidden = false;
    bar.querySelector('#cust-bulk-delete')?.addEventListener('click', () => this._deleteSelected());
    bar.querySelector('#cust-bulk-clear')?.addEventListener('click', () => {
      this._selected.clear();
      this._el?.querySelectorAll('.cust-row-select').forEach(cb => { cb.checked = false; });
      const all = this._el?.querySelector('#cust-select-all');
      if (all) { all.checked = false; all.indeterminate = false; }
      this._syncBulkBar();
    });
  }

  // Itemized confirm spelling out exactly what's removed vs kept, then one
  // delete request + reload.
  async _deleteSelected() {
    const ids = [...this._selected];
    if (!ids.length) return;
    const byId   = new Map(this._customers.map(c => [String(c.id), c]));
    const emails = ids.map(id => byId.get(id)?.email).filter(Boolean);
    const lines = [
      t('adminCustomers.confirmDeleteIntro'),
      '',
      ...emails.map(e => `• ${e}`),
      '',
      t('adminCustomers.confirmKeptOrders'),
    ];
    if (!confirm(lines.join('\n'))) return;

    const btn = this._el.querySelector('#cust-bulk-delete');
    if (btn) btn.disabled = true;
    try {
      const res = await adminDeleteCustomers(ids);
      showToast(t('adminCustomers.deletedN', { n: res.accounts || 0 }), 'success');
      await this._load();
    } catch (err) {
      showToast(err.message, 'error');
      if (btn) btn.disabled = false;
    }
  }

  _exportCsv() {
    const header = [
      t('adminCustomers.email'), t('adminCustomers.name'), t('adminCustomers.phone'),
      t('adminCustomers.orders'), t('adminCustomers.spent'), t('adminCustomers.joined'), t('adminCustomers.status'),
    ];
    const rows = this._customers.map(c => [
      c.email, c.display_name || '', c.phone || '',
      Number(c.order_count) || 0, Number(c.total_spent) || 0,
      this._date(c.created_at), this._statusLabel(c),
    ]);
    downloadCsv(`customers-${new Date().toISOString().slice(0, 10)}.csv`, header, rows);
  }

  _openAddModal() {
    const modal = document.createElement('div');
    modal.className = 'admin-shop__modal';
    modal.innerHTML = `
      <div class="admin-shop__modal-card">
        <header>
          <h2>${t('adminCustomers.add')}</h2>
          <button type="button" class="admin-shop__modal-close" aria-label="${t('common.close')}">✕</button>
        </header>
        <form class="admin-shop__form" id="cust-add-form">
          <label>${t('adminCustomers.email')}
            <input type="email" name="email" required maxlength="200"/>
          </label>
          <label class="admin-shop__checkbox">
            <input type="checkbox" name="no_email" id="cust-add-no-email"/>
            <span>${t('adminCustomers.noEmailOption')}</span>
          </label>
          <label>${t('adminCustomers.name')}
            <input type="text" name="display_name" maxlength="200"/>
          </label>
          <label>${t('adminCustomers.phone')}
            <input type="text" name="phone" maxlength="40"/>
          </label>
          ${expiryFieldHtml({ idPrefix: 'cust-add-expiry' })}
          <label class="admin-shop__checkbox" id="cust-add-invite-row">
            <input type="checkbox" name="send_invite" id="cust-add-send-invite"/>
            <span>${t('adminCustomers.sendInviteNow')}</span>
          </label>
          <p class="admin-shop__hint">${t('adminCustomers.addHint')}</p>
          <p class="admin-shop__error" id="cust-add-error" role="alert"></p>
          <div class="admin-shop__form-actions">
            <button type="submit" class="admin-shop__primary-btn">${t('adminCustomers.addSubmit')}</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelector('.admin-shop__modal-close').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    const errorEl = modal.querySelector('#cust-add-error');
    const form    = modal.querySelector('#cust-add-form');

    // "No email" (ice #397): the name becomes the one required field and the
    // server answers with a generated username + one-time password.
    const noEmailBox = form.querySelector('#cust-add-no-email');
    noEmailBox.addEventListener('change', () => {
      const emailInput = form.querySelector('[name=email]');
      const nameInput  = form.querySelector('[name=display_name]');
      emailInput.disabled = noEmailBox.checked;
      emailInput.required = !noEmailBox.checked;
      nameInput.required  = noEmailBox.checked;
      if (noEmailBox.checked) emailInput.value = '';
      // A name-only login has no mailbox: nothing to invite.
      form.querySelector('#cust-add-invite-row').hidden = noEmailBox.checked;
    });

    // "Gildir til" (migration 114): a demo login for a prospect stops working
    // after the chosen days or date; none = never.
    wireExpiryField(form, 'cust-add-expiry');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.textContent = '';
      const fd = new FormData(e.target);
      const noEmail = noEmailBox.checked;
      const expiry = readExpiryField(form, 'cust-add-expiry');
      if (!expiry.ok) { errorEl.textContent = expiry.message; return; }
      try {
        const res = await adminCreateCustomer({
          // "Send the invite now" is OFF by default (ice #336): the account is
          // made and nothing is mailed until the admin asks — here, or later
          // from the customer's Edit dialog.
          ...(noEmail ? { no_email: true } : {
            email: String(fd.get('email') || '').trim(),
            send_invite: form.querySelector('#cust-add-send-invite').checked,
          }),
          display_name: String(fd.get('display_name') || '').trim() || null,
          phone:        String(fd.get('phone') || '').trim() || null,
          ...(expiry.value ? { expires_at: expiry.value } : {}),
        });
        await this._load();
        if (res.noEmail) {
          // The one and only sight of the password — keep the modal open.
          form.innerHTML = credentialsPanelHtml({
            name: res.customer?.display_name, username: res.username, password: res.password, idPrefix: 'cust-otc',
            actionsHtml: `<button type="button" class="admin-shop__primary-btn" data-otc-done>${t('adminUsers.passwordDone')}</button>`,
          });
          wireCredentialsPanel(form);
          form.querySelector('[data-otc-done]').addEventListener('click', close);
          return;
        }
        if (res.invite_sent === false) {
          close();
          showToast(t('adminCustomers.createdNotInvited'), 'success');
          return;
        }
        if (res.invited) {
          close();
          showToast(t('adminCustomers.invited'), 'success');
          return;
        }
        // "Invite sent" means sent (ice #258): the mail did not reach the
        // customer, so hand the admin the set-password link to pass on.
        form.innerHTML = this._inviteLinkHtml(res);
        form.querySelector('[data-copy-link]')?.addEventListener('click', async () => {
          const input = form.querySelector('#cust-invite-link');
          input.select();
          try { await navigator.clipboard.writeText(input.value); } catch { /* selected */ }
        });
        form.querySelector('[data-link-done]').addEventListener('click', close);
        if (res.emailError) showToast(t('adminCustomers.inviteFailed'), 'error');
      } catch (err) {
        errorEl.textContent = err.message;
      }
    });
  }

  // The set-password link for a customer the invite did NOT reach: a failed
  // send (red, with the reason — staff eyes only), no mail transport, or an
  // EMAIL_ALLOWLIST redirect.
  _inviteLinkHtml(res) {
    const why = res.emailError
      ? `<p class="admin-shop__error" role="alert">${t('adminCustomers.inviteFailed')}</p>
         <p class="admin-shop__hint">${escHtml(res.emailError)}</p>`
      : `<p class="admin-shop__hint">${res.redirected ? t('adminCustomers.inviteRedirected') : t('adminCustomers.createdNoEmail')}</p>`;
    return `
      ${why}
      ${res.resetUrl ? `
      <label>${t('adminCustomers.inviteLinkLabel')}
        <input type="text" id="cust-invite-link" readonly value="${escHtml(res.resetUrl)}"/>
      </label>
      <div class="admin-shop__form-actions">
        <button type="button" class="admin-shop__primary-btn" data-copy-link>${t('adminUsers.copy')}</button>
        <button type="button" class="admin-shop__primary-btn" data-link-done>${t('adminUsers.passwordDone')}</button>
      </div>` : `
      <div class="admin-shop__form-actions">
        <button type="button" class="admin-shop__primary-btn" data-link-done>${t('adminUsers.passwordDone')}</button>
      </div>`}`;
  }

  _openImportModal() {
    const modal = document.createElement('div');
    modal.className = 'admin-shop__modal';
    modal.innerHTML = `
      <div class="admin-shop__modal-card">
        <header>
          <h2>${t('adminProducts.import')}</h2>
          <button type="button" class="admin-shop__modal-close" aria-label="${t('common.close')}">✕</button>
        </header>
        <div class="prod-import">
          <p class="admin-shop__hint">${t('adminCustomers.importIntro')}</p>
          <label class="admin-shop__upload-btn">
            <input type="file" accept=".csv,text/csv" id="cust-import-file"/>
            ${t('adminProducts.importChooseFile')}
          </label>
          <p class="admin-shop__error" id="cust-import-error" role="alert"></p>
          <div id="cust-import-preview"></div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelector('.admin-shop__modal-close').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    const errorEl   = modal.querySelector('#cust-import-error');
    const previewEl = modal.querySelector('#cust-import-preview');

    modal.querySelector('#cust-import-file').addEventListener('change', async (e) => {
      errorEl.textContent = '';
      previewEl.innerHTML = '';
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      let text;
      try { text = await file.text(); } catch { errorEl.textContent = t('adminProducts.importParseError'); return; }
      const rows = parseCustomerCsv(text);
      if (!rows.length) { errorEl.textContent = t('adminProducts.importNoRows'); return; }
      previewEl.innerHTML = `<p class="admin-shop__hint">${t('adminProducts.importPreviewing')}</p>`;
      try {
        const { counts } = await adminPreviewCustomerImport(rows);
        this._renderImportPreview(previewEl, counts, rows, close);
      } catch (err) {
        previewEl.innerHTML = '';
        errorEl.textContent = err.message;
      }
    });
  }

  _renderImportPreview(previewEl, counts, rows, close) {
    const label = (k) => `${counts[k] || 0} ${t('adminCustomers.importStatus' + k.charAt(0).toUpperCase() + k.slice(1))}`;
    const canApply = (counts.new || 0) > 0;
    previewEl.innerHTML = `
      <p class="prod-import__summary">${['new', 'existing', 'duplicate', 'invalid'].map(label).join(' · ')}</p>
      <div class="admin-shop__form-actions">
        <button type="button" class="admin-shop__primary-btn" id="cust-import-apply" ${canApply ? '' : 'disabled'}>${t('adminProducts.importApply')}</button>
      </div>
      <p class="admin-shop__hint" id="cust-import-status" aria-live="polite"></p>`;
    const statusEl = previewEl.querySelector('#cust-import-status');
    previewEl.querySelector('#cust-import-apply')?.addEventListener('click', async () => {
      const btn = previewEl.querySelector('#cust-import-apply');
      btn.disabled = true;
      statusEl.textContent = t('adminProducts.importApplying');
      try {
        const res = await adminApplyCustomerImport(rows);
        statusEl.textContent = t('adminCustomers.importDone', { n: res.created });
        await this._load();
        setTimeout(close, 1200);
      } catch (err) {
        statusEl.textContent = err.message;
        btn.disabled = false;
      }
    });
  }

  destroy() { clearTimeout(this._searchDebounce); clearTimeout(this._previewTimer); }
}

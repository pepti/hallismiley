import { t, href } from '../i18n/i18n.js';
import { escHtml } from '../utils/escHtml.js';

// One-click approval confirm page for the owner, opened from the request
// notification email (/<locale>/party/approve?token=...). GETs the pending
// request details, then POSTs approve/decline. The single-use token in the URL
// is the auth — no admin login required, so the owner can act straight from
// their inbox. Rendering only reads (prefetch-safe); the buttons mutate.
export class PartyApproveView {
  constructor(queryString = '') {
    this._token = new URLSearchParams(queryString).get('token') || '';
    this._el = null;
  }

  async render() {
    const el = document.createElement('div');
    el.className = 'main auth-page';
    this._el = el;
    el.innerHTML = `
      <div class="auth-container">
        <div class="auth-card">
          <div class="auth-card__icon" id="approve-icon">📨</div>
          <h1 class="auth-card__title" id="approve-title">${t('party.approveTitle')}</h1>
          <p class="auth-card__text" id="approve-text">${t('form.loading')}</p>
          <div id="approve-actions"></div>
        </div>
      </div>
    `;

    if (!this._token) { this._invalid(); return el; }

    try {
      const res  = await fetch(`/api/v1/party/approval/${encodeURIComponent(this._token)}`, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok || !data.valid) { this._invalid(); return el; }
      this._prompt(data);
    } catch {
      this._invalid();
    }
    return el;
  }

  _prompt(data) {
    // Re-send case: the info email already went out (e.g. via the admin queue
    // before this emailed link was clicked).
    const promptKey = data.welcome_email_sent_at ? 'party.approveResendPrompt' : 'party.approvePrompt';
    this._el.querySelector('#approve-text').innerHTML =
      t(promptKey, { name: escHtml(data.name || data.email), email: escHtml(data.email) });
    const actions = this._el.querySelector('#approve-actions');
    actions.innerHTML = `
      <button class="btn btn--primary" id="approve-yes">${t('party.approveBtn')}</button>
      <button class="btn btn--outline" id="approve-no" style="margin-left:8px">${t('party.declineBtn')}</button>
    `;
    actions.querySelector('#approve-yes').addEventListener('click', () => this._act('approve'));
    actions.querySelector('#approve-no').addEventListener('click',  () => this._act('decline'));
  }

  async _act(action) {
    const actions = this._el.querySelector('#approve-actions');
    actions.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
      const res  = await fetch(`/api/v1/party/approval/${encodeURIComponent(this._token)}`, {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Action failed');
      this._done(data.status === 'approved');
    } catch (err) {
      this._el.querySelector('#approve-text').textContent = err.message;
      actions.querySelectorAll('button').forEach(b => { b.disabled = false; });
    }
  }

  _done(approved) {
    const icon = this._el.querySelector('#approve-icon');
    icon.textContent = approved ? '✓' : '✗';
    icon.className   = 'auth-card__icon ' + (approved ? 'auth-card__icon--success' : '');
    this._el.querySelector('#approve-title').textContent = approved ? t('party.approveDone')     : t('party.declineDone');
    this._el.querySelector('#approve-text').textContent  = approved ? t('party.approveDoneText') : t('party.declineDoneText');
    this._el.querySelector('#approve-actions').innerHTML =
      `<a href="${href('/party/admin')}" class="btn btn--primary" data-route="/party/admin">${t('party.openAdmin')}</a>`;
  }

  _invalid() {
    const icon = this._el.querySelector('#approve-icon');
    icon.textContent = '✗';
    icon.className = 'auth-card__icon auth-card__icon--error';
    this._el.querySelector('#approve-title').textContent = t('common.error');
    this._el.querySelector('#approve-text').textContent  = t('party.approveInvalid');
    this._el.querySelector('#approve-actions').innerHTML =
      `<a href="${href('/party/admin')}" class="btn btn--ghost" data-route="/party/admin">${t('party.openAdmin')}</a>`;
  }
}

// ConnectClaudeView (/tengja/:id) — the OAuth consent page for the MCP
// connector (R5a, 2026-09-24).
//
// A Claude client (claude.ai, Claude Desktop, Claude Code) that was pointed at
// this instance's /api/v1/mcp registered itself and sent the browser to
// /oauth/authorize; the server validated the request, stored it as pending and
// redirected here. An ADMIN decides: approve → the server mints a single-use
// code and this page follows the returned redirect back to the client; deny →
// the client is told access_denied.
//
// What the admin must see before approving is WHERE the code goes — a
// dynamically registered client names itself, so "Claude" in the name proves
// nothing; the redirect host is the fact. It is shown as its own line, and the
// warning says to approve only a connection you started yourself.
//
// Not signed in → a sign-in button (the NavBar's modal, via 'login:open');
// the router re-renders this view on 'authchange'. Signed in but not an admin
// → a refusal. The server enforces both (routes/mcpOAuthRoutes.js).
import { isAuthenticated, isAdmin } from '../services/auth.js';
import { getOAuthRequest, decideOAuthRequest } from '../services/adminMcp.js';
import { escHtml } from '../utils/escHtml.js';
import { t } from '../i18n/i18n.js';
import { composeTitle } from '../utils/pageTitle.js';
import { mountSceneBackdrop } from '../scenes/sceneHeader.js';

export class ConnectClaudeView {
  constructor(requestId) {
    this._id = String(requestId || '');
    this.documentTitle = composeTitle(t('connect.title'));
  }

  destroy() {
    this._scene?.destroy();
  }

  async render() {
    const el = document.createElement('div');
    el.className = 'main auth-page';
    el.innerHTML = `
      <div class="auth-container">
        <div class="auth-card connect-card" data-testid="connect-card">
          <p class="auth-card__eyebrow">${escHtml(t('connect.eyebrow'))}</p>
          <h1 class="auth-card__title">${escHtml(t('connect.title'))}</h1>
          <div id="connect-body"><p class="auth-card__text">${escHtml(t('form.loading'))}</p></div>
        </div>
      </div>
    `;
    this._el = el;
    this._scene = mountSceneBackdrop(el, 'account');
    await this._fill();
    return el;
  }

  _body(html) {
    this._el.querySelector('#connect-body').innerHTML = html;
  }

  async _fill() {
    if (!isAuthenticated()) {
      this._body(`
        <p class="auth-card__text">${escHtml(t('connect.signInFirst'))}</p>
        <button type="button" class="btn btn--primary" id="connect-signin">${escHtml(t('nav.signIn'))}</button>`);
      this._el.querySelector('#connect-signin').addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('login:open'));
      });
      return;
    }
    if (!isAdmin()) {
      this._body(`<p class="auth-card__text" data-testid="connect-refused">${escHtml(t('connect.adminOnly'))}</p>`);
      return;
    }

    let req;
    try {
      req = await getOAuthRequest(this._id);
    } catch (err) {
      this._body(`<p class="auth-card__text" data-testid="connect-gone">${escHtml(err.status === 404 ? t('connect.gone') : t('connect.loadError'))}</p>`);
      return;
    }

    const asksWrite = (req.scopes || []).includes('write');
    const writeRow = asksWrite
      ? (req.write_allowed
        ? `<label class="connect-card__check"><input type="checkbox" id="connect-write"> ${escHtml(t('connect.allowWrite'))}</label>`
        : `<p class="connect-card__note">${escHtml(t('connect.writeCeiling'))}</p>`)
      : '';

    this._body(`
      <dl class="connect-card__facts">
        <dt>${escHtml(t('connect.client'))}</dt>
        <dd data-testid="connect-client">${escHtml(req.client_name)}</dd>
        <dt>${escHtml(t('connect.returnsTo'))}</dt>
        <dd data-testid="connect-host"><strong>${escHtml(req.redirect_host)}</strong></dd>
        <dt>${escHtml(t('connect.access'))}</dt>
        <dd>${escHtml(asksWrite && req.write_allowed ? t('connect.accessReadWrite') : t('connect.accessRead'))}</dd>
      </dl>
      ${writeRow}
      <p class="connect-card__warning" role="note">${escHtml(t('connect.warning'))}</p>
      <div class="connect-card__actions">
        <button type="button" class="btn btn--primary" id="connect-approve" data-testid="connect-approve">${escHtml(t('connect.approve'))}</button>
        <button type="button" class="btn btn--ghost" id="connect-deny" data-testid="connect-deny">${escHtml(t('connect.deny'))}</button>
      </div>
      <p class="auth-card__text connect-card__status" id="connect-status" aria-live="polite"></p>`);

    const decide = async (decision) => {
      const buttons = this._el.querySelectorAll('.connect-card__actions button');
      buttons.forEach((b) => { b.disabled = true; });
      const status = this._el.querySelector('#connect-status');
      status.textContent = t('connect.working');
      try {
        const allowWrite = !!this._el.querySelector('#connect-write')?.checked;
        const { redirect } = await decideOAuthRequest(this._id, decision, { allowWrite });
        status.textContent = t('connect.redirecting');
        window.location.assign(redirect);
      } catch (err) {
        status.textContent = err.status === 404 ? t('connect.gone') : t('connect.loadError');
        buttons.forEach((b) => { b.disabled = false; });
      }
    };
    this._el.querySelector('#connect-approve').addEventListener('click', () => decide('approve'));
    this._el.querySelector('#connect-deny').addEventListener('click', () => decide('deny'));
  }
}

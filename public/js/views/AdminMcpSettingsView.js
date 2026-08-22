// AdminMcpSettingsView (/admin/mcp) — manage the bearer tokens that connect
// Claude (claude.ai / Desktop / Claude Code) to THIS deployment via the MCP
// endpoint. Each environment (TEST/PROD) manages its own tokens; the page
// states which one it is and whether the stack allows write scope
// (MCP_ALLOWED_SCOPES ceiling — read-only unless the environment opted in).
//
// The plaintext token is shown exactly ONCE, in the create response, together
// with a ready-made `claude mcp add` command. After that only the prefix is
// visible; the store keeps a hash.
import { isAuthenticated, isAdmin } from '../services/auth.js';
import { listMcpTokens, createMcpToken, revokeMcpToken } from '../services/adminMcp.js';
import { escHtml } from '../utils/escHtml.js';
import { t, href } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { showToast } from '../components/Toast.js';
import { renderAdminShell } from '../components/AdminSidebar.js';

export class AdminMcpSettingsView {
  constructor() {
    this._data = null;   // { enabled, allowed_scopes, app_env, tokens }
    this._minted = null; // { token, row } — the once-only plaintext panel
  }

  async render() {
    if (!isAuthenticated() || !isAdmin()) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }
    const el = document.createElement('div');
    el.className = 'main admin-page gs-page';
    el.innerHTML = `
      <div class="gs-head">
        <h1 class="admin-title">${t('mcp.title')}</h1>
        <p class="gs-sub">${t('mcp.subtitle')}</p>
      </div>
      <div id="mcp-body"><div class="admin-loading">${t('form.loading')}</div></div>
    `;
    this._el = el;
    await this._load();
    return renderAdminShell({ activePath: '/admin/mcp', content: el });
  }

  async _load() {
    const body = this._el.querySelector('#mcp-body');
    try {
      this._data = await listMcpTokens();
      this._renderBody();
    } catch (err) {
      body.innerHTML = `<p class="admin-error">${t('mcp.loadError')}: ${escHtml(err.message)}</p>`;
    }
  }

  _endpointUrl() {
    return `${window.location.origin}/api/v1/mcp`;
  }

  _renderBody() {
    const d = this._data;
    const envLabel = d.app_env === 'test' ? t('mcp.envTest') : t('mcp.envProd');
    const canWrite = (d.allowed_scopes || []).includes('write');

    this._el.querySelector('#mcp-body').innerHTML = `
      ${!d.enabled ? `<div class="gs-card"><div class="gs-card__body"><p class="gs-row__help">${t('mcp.disabledNote')}</p></div></div>` : ''}

      ${this._card(t('mcp.connectionCard'), envLabel, `
        ${this._row(t('mcp.endpoint'), t('mcp.endpointHelp'), `<code class="mcp-code">${escHtml(this._endpointUrl())}</code>`)}
        ${this._row(t('mcp.access'), t('mcp.accessHelp'), `<span class="gs-readonly">${canWrite ? t('mcp.accessReadWrite') : t('mcp.accessReadOnly')}</span>`)}
      `)}

      ${this._minted ? this._mintedPanel() : ''}

      ${this._card(t('mcp.createCard'), '', `
        ${this._row(t('mcp.tokenName'), t('mcp.tokenNameHelp'),
          `<input type="text" class="gs-input" id="mcp-name" maxlength="100" placeholder="${escHtml(t('mcp.tokenNamePlaceholder'))}"/>`)}
        ${this._row(t('mcp.tokenScope'), canWrite ? t('mcp.tokenScopeHelp') : t('mcp.tokenScopeReadOnlyHelp'), `
          <select class="gs-select" id="mcp-scope"${canWrite ? '' : ' disabled'}>
            <option value="read" selected>${t('mcp.scopeRead')}</option>
            ${canWrite ? `<option value="read,write">${t('mcp.scopeReadWrite')}</option>` : ''}
          </select>`)}
        ${this._row(t('mcp.tokenTtl'), t('mcp.tokenTtlHelp'),
          `<input type="number" class="gs-input gs-input--number" id="mcp-ttl" value="90" min="1" max="365" step="1"/>`)}
        <div class="gs-row"><div class="gs-row__main"></div><div class="gs-row__side">
          <button type="button" class="btn btn--sm btn--primary" id="mcp-create">${t('mcp.createBtn')}</button>
        </div></div>
      `)}

      ${this._card(t('mcp.tokensCard'), '', this._tokensTable())}
    `;
    this._bind();
  }

  _mintedPanel() {
    const m = this._minted;
    const cmd = `claude mcp add --transport http icelandicstore-${escHtml(this._data.app_env)} ${escHtml(this._endpointUrl())} --header "Authorization: Bearer ${escHtml(m.token)}"`;
    return `
      <section class="gs-card mcp-minted">
        <div class="gs-card__head"><h2 class="gs-card__title">${t('mcp.mintedTitle')}</h2></div>
        <div class="gs-card__body">
          <p class="gs-row__help">${t('mcp.mintedOnce')}</p>
          <div class="mcp-secret-row"><code class="mcp-code" id="mcp-plaintext">${escHtml(m.token)}</code>
            <button type="button" class="btn btn--xs btn--outline" data-copy="#mcp-plaintext">${t('mcp.copy')}</button></div>
          <p class="gs-row__help">${t('mcp.mintedSnippet')}</p>
          <div class="mcp-secret-row"><code class="mcp-code" id="mcp-cmd">${cmd}</code>
            <button type="button" class="btn btn--xs btn--outline" data-copy="#mcp-cmd">${t('mcp.copy')}</button></div>
        </div>
      </section>`;
  }

  _tokensTable() {
    const rows = (this._data.tokens || []);
    if (!rows.length) return `<p class="admin-empty">${t('mcp.noTokens')}</p>`;
    const fmt = (v) => (v ? new Date(v).toLocaleString() : '—');
    return `
      <div class="pick-table-wrap"><table class="pick-table">
        <thead><tr>
          <th>${t('mcp.col.name')}</th><th>${t('mcp.col.prefix')}</th><th>${t('mcp.col.scope')}</th>
          <th>${t('mcp.col.expires')}</th><th>${t('mcp.col.lastUsed')}</th><th>${t('mcp.col.status')}</th><th></th>
        </tr></thead>
        <tbody>${rows.map((r) => `
          <tr class="${r.revoked_at ? 'pick-row--done' : ''}">
            <td>${escHtml(r.name)}</td>
            <td class="imp-mono">${escHtml(r.token_prefix)}…</td>
            <td>${escHtml((r.scopes || []).join(', '))}</td>
            <td>${fmt(r.expires_at)}</td>
            <td>${fmt(r.last_used_at)}</td>
            <td>${r.revoked_at ? t('mcp.statusRevoked') : (new Date(r.expires_at) < new Date() ? t('mcp.statusExpired') : t('mcp.statusActive'))}</td>
            <td>${r.revoked_at ? '' : `<button type="button" class="btn btn--xs btn--ghost" data-revoke="${r.id}">${t('mcp.revoke')}</button>`}</td>
          </tr>`).join('')}</tbody>
      </table></div>`;
  }

  _card(title, badge, inner) {
    return `
      <section class="gs-card">
        <div class="gs-card__head">
          <h2 class="gs-card__title">${escHtml(title)}</h2>
          ${badge ? `<span class="gs-badge">${escHtml(badge)}</span>` : ''}
        </div>
        <div class="gs-card__body">${inner}</div>
      </section>`;
  }

  _row(title, help, control) {
    return `
      <div class="gs-row">
        <div class="gs-row__main">
          <p class="gs-row__title">${escHtml(title)}</p>
          ${help ? `<p class="gs-row__help">${escHtml(help)}</p>` : ''}
        </div>
        <div class="gs-row__side">${control}</div>
      </div>`;
  }

  _bind() {
    const body = this._el.querySelector('#mcp-body');
    body.querySelector('#mcp-create')?.addEventListener('click', () => this._create());
    body.querySelectorAll('[data-revoke]').forEach((b) =>
      b.addEventListener('click', () => this._revoke(b.dataset.revoke)));
    body.querySelectorAll('[data-copy]').forEach((b) =>
      b.addEventListener('click', async () => {
        const el = body.querySelector(b.dataset.copy);
        try { await navigator.clipboard.writeText(el.textContent); showToast(t('mcp.copied'), 'success'); }
        catch { showToast(t('form.error'), 'error'); }
      }));
  }

  async _create() {
    const name = this._el.querySelector('#mcp-name').value.trim();
    const scopes = this._el.querySelector('#mcp-scope').value;
    const ttlDays = Number(this._el.querySelector('#mcp-ttl').value) || 90;
    const btn = this._el.querySelector('#mcp-create');
    btn.disabled = true;
    try {
      const { token, row } = await createMcpToken({ name, scopes, ttlDays });
      this._minted = { token, row };
      await this._load();      // re-list; _minted survives into the re-render
      showToast(t('mcp.created'), 'success');
    } catch (err) {
      showToast(err.message || t('form.error'), 'error', 6000);
      btn.disabled = false;
    }
  }

  async _revoke(id) {
    if (!confirm(t('mcp.revokeConfirm'))) return;
    try {
      await revokeMcpToken(id);
      if (this._minted && String(this._minted.row.id) === String(id)) this._minted = null;
      await this._load();
      showToast(t('mcp.revoked'), 'success');
    } catch (err) {
      showToast(err.message || t('form.error'), 'error', 6000);
    }
  }
}

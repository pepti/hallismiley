// AdminBackgroundView (/admin/background) — manage the home-hero background:
// pick a mode (video default | photo | plain) + a veil amount, upload background
// media, and select a library image as the hero photo. Standalone admin page.
import { isAuthenticated, isAdmin, getCSRFToken } from '../services/auth.js';
import { escHtml } from '../utils/escHtml.js';
import { t, href } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { showToast } from '../components/Toast.js';

async function csrfHeaders(extra = {}) {
  const tok = await getCSRFToken();
  return { ...(tok ? { 'X-CSRF-Token': tok } : {}), ...extra };
}

export class AdminBackgroundView {
  constructor() { this._el = null; this._landing = null; this._media = []; this._pendingPhoto = null; }

  async render() {
    if (!isAuthenticated() || !isAdmin()) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }
    this._el = document.createElement('div');
    this._el.className = 'main admin-page bg-page';
    this._el.innerHTML = `
      <h1 class="admin-title">${t('adminBg.title')}</h1>
      <p class="bg-sub">${t('adminBg.subtitle')}</p>
      <div id="bg-body"><div class="admin-loading">${t('form.loading')}</div></div>`;
    await this._load();
    return renderAdminShell({ activePath: '/admin/background', content: this._el });
  }

  async _load() {
    try {
      const [landing, media] = await Promise.all([
        fetch('/api/v1/admin/background/landing', { credentials: 'include' }).then(r => r.json()),
        fetch('/api/v1/admin/background/media',   { credentials: 'include' }).then(r => r.json()),
      ]);
      this._landing = landing;
      this._media   = Array.isArray(media) ? media : [];
      this._pendingPhoto = null;
      this._paint();
    } catch (err) {
      this._el.querySelector('#bg-body').innerHTML = `<p class="admin-error">${escHtml(err.message)}</p>`;
    }
  }

  _paint() {
    const l = this._landing || { mode: 'video', photo_url: null, veil_percent: 100 };
    const veil = Number.isFinite(l.veil_percent) ? l.veil_percent : 100;
    this._el.querySelector('#bg-body').innerHTML = `
      <div class="bg-card">
        <label class="bg-row"><span>${t('adminBg.mode')}</span>
          <select id="bg-mode">
            <option value="video" ${l.mode === 'video' ? 'selected' : ''}>${t('adminBg.modeVideo')}</option>
            <option value="photo" ${l.mode === 'photo' ? 'selected' : ''}>${t('adminBg.modePhoto')}</option>
            <option value="plain" ${l.mode === 'plain' ? 'selected' : ''}>${t('adminBg.modePlain')}</option>
          </select>
        </label>
        <label class="bg-row"><span>${t('adminBg.veil')}</span>
          <input type="range" id="bg-veil" min="0" max="100" value="${veil}"/>
          <output id="bg-veil-out">${veil}%</output>
        </label>
        <div class="bg-row">
          <button type="button" class="btn btn--primary" id="bg-save">${t('form.save')}</button>
          <span id="bg-status" class="bg-status" aria-live="polite"></span>
        </div>
      </div>
      <div class="bg-lib">
        <div class="bg-lib__head">
          <h2>${t('adminBg.library')}</h2>
          <label class="admin-shop__upload-btn">
            <input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" id="bg-upload"/>
            ${t('adminBg.upload')}
          </label>
        </div>
        <div class="bg-grid" id="bg-grid"></div>
      </div>`;
    this._paintGrid();
    const veilInput = this._el.querySelector('#bg-veil');
    const veilOut   = this._el.querySelector('#bg-veil-out');
    veilInput.addEventListener('input', () => { veilOut.textContent = veilInput.value + '%'; });
    this._el.querySelector('#bg-save').addEventListener('click', () => this._save());
    this._el.querySelector('#bg-upload').addEventListener('change', (e) => this._upload(e));
  }

  _paintGrid() {
    const grid = this._el.querySelector('#bg-grid');
    const l = this._landing || {};
    if (!this._media.length) { grid.innerHTML = `<p class="admin-shop__hint">${t('adminBg.empty')}</p>`; return; }
    const activePath = this._pendingPhoto || (l.mode === 'photo' ? l.photo_url : null);
    grid.innerHTML = this._media.map(m => `
      <div class="bg-tile${activePath === m.file_path ? ' bg-tile--active' : ''}" data-path="${escHtml(m.file_path)}">
        ${m.media_type === 'video'
          ? `<video src="${escHtml(m.file_path)}" muted></video>`
          : `<img src="${escHtml(m.file_path)}" alt=""/>`}
        <div class="bg-tile__actions">
          ${m.media_type === 'image' ? `<button type="button" class="admin-shop__link" data-use="${escHtml(m.file_path)}">${t('adminBg.useAsBg')}</button>` : '<span></span>'}
          <button type="button" class="admin-shop__link" data-del="${m.id}">${t('admin.delete')}</button>
        </div>
      </div>`).join('');
    grid.querySelectorAll('[data-use]').forEach(b => b.addEventListener('click', () => {
      this._pendingPhoto = b.dataset.use;
      this._el.querySelector('#bg-mode').value = 'photo';
      this._paintGrid();
      showToast(t('adminBg.selected'), 'success');
    }));
    grid.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => this._delete(b.dataset.del)));
  }

  async _save() {
    const mode = this._el.querySelector('#bg-mode').value;
    const veil = Number(this._el.querySelector('#bg-veil').value);
    const body = { mode, veil_percent: veil };
    if (mode === 'photo') body.photo_url = this._pendingPhoto || (this._landing && this._landing.photo_url) || null;
    const status = this._el.querySelector('#bg-status');
    try {
      const res  = await fetch('/api/v1/admin/background/landing', {
        method: 'PATCH', credentials: 'include',
        headers: await csrfHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      this._landing = data; this._pendingPhoto = null;
      status.textContent = t('adminBg.saved'); status.style.color = 'var(--success)';
      this._paintGrid();
    } catch (err) { status.textContent = err.message; status.style.color = 'var(--error)'; }
  }

  async _upload(e) {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    const status = this._el.querySelector('#bg-status');
    status.textContent = t('adminBg.uploading'); status.style.color = 'var(--text-muted)';
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch('/api/v1/admin/background/media', { method: 'POST', credentials: 'include', headers: await csrfHeaders(), body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      this._media.push(data); status.textContent = '';
      this._paintGrid();
    } catch (err) { status.textContent = err.message; status.style.color = 'var(--error)'; }
  }

  async _delete(id) {
    if (!confirm(t('adminBg.confirmDelete'))) return;
    try {
      const res = await fetch('/api/v1/admin/background/media/' + id, { method: 'DELETE', credentials: 'include', headers: await csrfHeaders() });
      if (!res.ok && res.status !== 204) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Delete failed'); }
      await this._load(); // landing may have reset to video if the active photo was deleted
    } catch (err) { showToast(err.message, 'error'); }
  }

  destroy() {}
}

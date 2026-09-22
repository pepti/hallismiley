// BackgroundLibraryAdmin — the admin-only background *library* manager: an
// enable toggle, multi-file upload, named sections with per-locale names and
// descriptions, EN/IS captions per item, arrow + drag-drop reorder within and
// across sections, and delete.
//
// Sibling of LandingBackgroundAdmin, which owns the hero mode/veil/photo choice
// and is left exactly as it was. Both are mounted, in this order, by:
//   • ProfileView          — admin-only, right after the language section
//   • AdminBackgroundView  — the standalone /admin/background page
// so neither surface can drift from the other.
//
// Every mutation goes straight to the server (services/backgroundLibrary.js)
// and repaints locally; nothing is batched behind a Save button except the
// section/caption text fields, which persist on `change` (blur).
import { t, getLocale } from '../i18n/i18n.js';
import { escHtml } from '../utils/escHtml.js';
import { showToast } from './Toast.js';
import * as api from '../services/backgroundLibrary.js';

export class BackgroundLibraryAdmin {
  /**
   * @param {object}  [opts]
   * @param {boolean} [opts.section] wrap in <section class="profile-section">
   *   with a heading — the shape ProfileView's other blocks use. The standalone
   *   admin page supplies its own page heading, so it passes false.
   */
  constructor({ section = false } = {}) {
    this._el = null;
    this._section = section;
    this._sections = [];
    this._media = [];
    this._dragId = null;
  }

  render() {
    this._el = document.createElement('div');
    this._el.className = 'bg-lib-admin';
    const loading = `<div id="bg-lib-body"><div class="admin-loading">${escHtml(t('form.loading'))}</div></div>`;
    this._el.innerHTML = this._section
      ? `<section class="profile-section">
           <h2 class="profile-section__title">${escHtml(t('bgLib.title'))}</h2>
           <p class="profile-section__hint">${escHtml(t('bgLib.hint'))}</p>
           ${loading}
         </section>`
      : loading;
    this._load();
    return this._el;
  }

  async _load() {
    try {
      const [sections, media] = await Promise.all([
        api.listSections(), api.listMedia(),
      ]);
      this._sections = Array.isArray(sections) ? sections : [];
      this._media    = Array.isArray(media) ? media : [];
      this._paint();
    } catch (err) {
      this._el.querySelector('#bg-lib-body').innerHTML = `<p class="admin-error">${escHtml(err.message)}</p>`;
    }
  }

  // Prefer the Icelandic column when the UI is in Icelandic, else the base one.
  _loc(row, base) {
    return (getLocale() === 'is' && row[`${base}_is`]) ? row[`${base}_is`] : (row[base] || '');
  }

  // ── Paint ──────────────────────────────────────────────────────────────────
  _paint() {
    // NOTE: no "enable library" switch here. Upstream that flag gates a public
    // /gallery page; this site has no such surface, so the control would be a
    // toggle that visibly does nothing. The flag and its GET/PATCH /library
    // endpoints are kept (see the service + controller) so a future public
    // gallery can adopt them without a migration — only the dead UI is omitted.
    this._el.querySelector('#bg-lib-body').innerHTML = `
      <div class="bg-lib-admin__card">
        <div class="bg-lib-admin__toolbar">
          <select class="bg-lib-admin__target" id="bg-lib-target" aria-label="${escHtml(t('bgLib.uploadTarget'))}">
            ${this._targetOptionsHtml()}
          </select>
          <input type="file" id="bg-lib-file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" multiple hidden/>
          <button type="button" class="btn btn--sm" id="bg-lib-upload">${escHtml(t('bgLib.upload'))}</button>
          <input type="text" class="bg-lib-admin__new-name" id="bg-lib-new-section"
                 placeholder="${escHtml(t('bgLib.sectionNamePlaceholder'))}" maxlength="80"/>
          <button type="button" class="btn btn--sm" id="bg-lib-add-section">${escHtml(t('bgLib.addSection'))}</button>
        </div>
        <p class="bg-lib-admin__progress" id="bg-lib-progress" aria-live="polite"></p>
      </div>

      <div class="bg-lib-admin__groups" id="bg-lib-groups">${this._groupsHtml()}</div>`;
    this._bind();
  }

  _targetOptionsHtml() {
    return `<option value="">${escHtml(t('bgLib.ungrouped'))}</option>`
      + this._sections.map(s => `<option value="${s.id}">${escHtml(this._loc(s, 'name'))}</option>`).join('');
  }

  // Ungrouped bucket first, then sections in their stored order.
  _groupBySection() {
    const byKey = new Map();
    for (const m of this._media) {
      const key = m.section_id == null ? '__u' : String(m.section_id);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(m);
    }
    const groups = [{ section: null, items: byKey.get('__u') || [] }];
    for (const s of this._sections) groups.push({ section: s, items: byKey.get(String(s.id)) || [] });
    return groups;
  }

  _groupsHtml() {
    const groups = this._groupBySection();
    return groups.map((g, gi) => {
      const sid = g.section ? g.section.id : '';
      const head = g.section
        ? `<div class="bg-lib-admin__group-head">
             <input class="bg-lib-admin__sec-name" data-field="name" value="${escHtml(g.section.name)}"
                    placeholder="${escHtml(t('bgLib.sectionName'))}" aria-label="${escHtml(t('bgLib.sectionName'))}"/>
             <input class="bg-lib-admin__sec-name" data-field="name_is" value="${escHtml(g.section.name_is || '')}"
                    placeholder="${escHtml(t('bgLib.sectionNameIs'))}" aria-label="${escHtml(t('bgLib.sectionNameIs'))}"/>
             <div class="bg-lib-admin__sec-actions">
               <button type="button" class="bg-lib-admin__icon" data-act="sec-up" ${gi <= 1 ? 'disabled' : ''}
                       aria-label="${escHtml(t('bgLib.moveUp'))}" title="${escHtml(t('bgLib.moveUp'))}">▲</button>
               <button type="button" class="bg-lib-admin__icon" data-act="sec-down" ${gi >= groups.length - 1 ? 'disabled' : ''}
                       aria-label="${escHtml(t('bgLib.moveDown'))}" title="${escHtml(t('bgLib.moveDown'))}">▼</button>
               <button type="button" class="bg-lib-admin__icon bg-lib-admin__icon--danger" data-act="sec-del"
                       aria-label="${escHtml(t('bgLib.deleteSection'))}" title="${escHtml(t('bgLib.deleteSection'))}">✕</button>
             </div>
           </div>
           <textarea class="bg-lib-admin__sec-desc" data-field="description" rows="2"
                     placeholder="${escHtml(t('bgLib.sectionDesc'))}" aria-label="${escHtml(t('bgLib.sectionDesc'))}">${escHtml(g.section.description || '')}</textarea>
           <textarea class="bg-lib-admin__sec-desc" data-field="description_is" rows="2"
                     placeholder="${escHtml(t('bgLib.sectionDescIs'))}" aria-label="${escHtml(t('bgLib.sectionDescIs'))}">${escHtml(g.section.description_is || '')}</textarea>`
        : `<div class="bg-lib-admin__group-head">
             <span class="bg-lib-admin__group-label">${escHtml(t('bgLib.ungrouped'))}</span>
           </div>`;

      const tiles = g.items.map(m => this._tileHtml(m)).join('')
        || `<p class="bg-lib-admin__drop-hint">${escHtml(t('bgLib.dropHint'))}</p>`;

      return `<div class="bg-lib-admin__group" data-section-id="${sid}">
        ${head}
        <div class="bg-lib-admin__grid" data-section-id="${sid}">${tiles}</div>
      </div>`;
    }).join('');
  }

  _tileHtml(m) {
    const thumb = m.media_type === 'video'
      ? `<div class="bg-lib-admin__video" title="${escHtml(t('bgLib.videoItem'))}">▶</div>`
      : `<img src="${escHtml(m.file_path)}" alt="" loading="lazy"/>`;
    return `<div class="bg-lib-admin__item" draggable="true" data-media-id="${m.id}" data-type="${escHtml(m.media_type)}">
      <div class="bg-lib-admin__thumb">${thumb}</div>
      <input class="bg-lib-admin__cap" data-field="caption" value="${escHtml(m.caption || '')}"
             placeholder="${escHtml(t('bgLib.captionEn'))}" aria-label="${escHtml(t('bgLib.captionEn'))}"/>
      <input class="bg-lib-admin__cap" data-field="caption_is" value="${escHtml(m.caption_is || '')}"
             placeholder="${escHtml(t('bgLib.captionIs'))}" aria-label="${escHtml(t('bgLib.captionIs'))}"/>
      <div class="bg-lib-admin__item-actions">
        <button type="button" class="bg-lib-admin__icon" data-act="m-back"
                aria-label="${escHtml(t('bgLib.moveBack'))}" title="${escHtml(t('bgLib.moveBack'))}">◀</button>
        <button type="button" class="bg-lib-admin__icon" data-act="m-fwd"
                aria-label="${escHtml(t('bgLib.moveForward'))}" title="${escHtml(t('bgLib.moveForward'))}">▶</button>
        <button type="button" class="bg-lib-admin__icon bg-lib-admin__icon--danger" data-act="m-del"
                aria-label="${escHtml(t('bgLib.deleteItem'))}" title="${escHtml(t('bgLib.deleteItem'))}">✕</button>
      </div>
    </div>`;
  }

  // Repaint just the parts that change on a library mutation, so the toolbar's
  // focused inputs and the enable checkbox are left alone.
  _repaint() {
    const groups = this._el.querySelector('#bg-lib-groups');
    if (groups) groups.innerHTML = this._groupsHtml();
    const target = this._el.querySelector('#bg-lib-target');
    if (target) {
      const cur = target.value;
      target.innerHTML = this._targetOptionsHtml();
      target.value = cur;
    }
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  _bind() {
    const root = this._el;

    const file = root.querySelector('#bg-lib-file');
    root.querySelector('#bg-lib-upload').addEventListener('click', () => file.click());
    file.addEventListener('change', () => this._upload(file));

    root.querySelector('#bg-lib-add-section').addEventListener('click', () => this._addSection());
    root.querySelector('#bg-lib-new-section').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this._addSection(); }
    });

    const groups = root.querySelector('#bg-lib-groups');
    groups.addEventListener('click',  (e) => this._onClick(e));
    groups.addEventListener('change', (e) => this._onFieldChange(e));
    this._attachDrag(groups);
  }

  async _upload(input) {
    const files = [...input.files];
    input.value = '';
    if (!files.length) return;
    const target = this._el.querySelector('#bg-lib-target');
    const sectionId = target && target.value ? Number(target.value) : null;
    const prog = this._el.querySelector('#bg-lib-progress');
    let done = 0;
    for (const f of files) {
      prog.textContent = t('bgLib.uploading', { done: done + 1, total: files.length });
      try {
        this._media.push(await api.uploadMedia(f, sectionId));
      } catch (err) {
        showToast(`${f.name}: ${err.message}`, 'error');
      }
      done++;
    }
    prog.textContent = '';
    this._repaint();
  }

  async _addSection() {
    const input = this._el.querySelector('#bg-lib-new-section');
    const name  = input.value.trim();
    if (!name) { input.focus(); return; }
    try {
      this._sections.push(await api.createSection({ name }));
      input.value = '';
      this._repaint();
    } catch (err) { showToast(err.message, 'error'); }
  }

  // Section name/description and media captions persist on blur.
  _onFieldChange(e) {
    const field = e.target.dataset.field;
    if (!field) return;
    const itemEl  = e.target.closest('.bg-lib-admin__item');
    const groupEl = e.target.closest('.bg-lib-admin__group');
    if (itemEl) {
      const id = Number(itemEl.dataset.mediaId);
      api.updateMedia(id, { [field]: e.target.value })
        .then(m => { const i = this._media.findIndex(x => x.id === id); if (i >= 0) this._media[i] = m; })
        .catch(err => showToast(err.message, 'error'));
    } else if (groupEl && groupEl.dataset.sectionId) {
      const id = Number(groupEl.dataset.sectionId);
      api.updateSection(id, { [field]: e.target.value })
        .then(s => {
          const i = this._sections.findIndex(x => x.id === id);
          if (i >= 0) this._sections[i] = s;
          this._repaint();
        })
        .catch(err => showToast(err.message, 'error'));
    }
  }

  _onClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const groupEl = btn.closest('.bg-lib-admin__group');
    const itemEl  = btn.closest('.bg-lib-admin__item');
    switch (btn.dataset.act) {
      case 'sec-up':   return this._moveSection(Number(groupEl.dataset.sectionId), -1);
      case 'sec-down': return this._moveSection(Number(groupEl.dataset.sectionId), 1);
      case 'sec-del':  return this._deleteSection(Number(groupEl.dataset.sectionId));
      case 'm-back':   return this._moveMedia(Number(itemEl.dataset.mediaId), -1);
      case 'm-fwd':    return this._moveMedia(Number(itemEl.dataset.mediaId), 1);
      case 'm-del':    return this._deleteMedia(Number(itemEl.dataset.mediaId));
    }
  }

  async _moveSection(id, dir) {
    const ordered = [...this._sections];
    const i = ordered.findIndex(s => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ordered.length) return;
    [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    this._sections = ordered;
    this._repaint();
    try {
      await api.reorderSections(ordered.map((s, idx) => ({ id: s.id, sort_order: idx })));
    } catch (err) { showToast(err.message, 'error'); }
  }

  async _deleteSection(id) {
    if (!confirm(t('bgLib.deleteSectionConfirm'))) return;
    try {
      await api.deleteSection(id);
      this._sections = this._sections.filter(s => s.id !== id);
      // The server's ON DELETE SET NULL ungrouped its media — mirror that here.
      this._media = this._media.map(m => (m.section_id === id ? { ...m, section_id: null } : m));
      this._repaint();
    } catch (err) { showToast(err.message, 'error'); }
  }

  async _moveMedia(id, dir) {
    const groups = this._groupBySection();
    const item = this._media.find(m => m.id === id);
    if (!item) return;
    const sid = item.section_id == null ? null : item.section_id;
    const bucket = groups.find(g => (g.section ? g.section.id : null) === sid);
    if (!bucket) return;
    const idx = bucket.items.findIndex(m => m.id === id);
    const tgt = idx + dir;
    if (tgt < 0 || tgt >= bucket.items.length) return;
    [bucket.items[idx], bucket.items[tgt]] = [bucket.items[tgt], bucket.items[idx]];
    this._media = groups.flatMap(g => g.items);
    this._repaint();
    this._commitOrder();
  }

  async _deleteMedia(id) {
    if (!confirm(t('bgLib.deleteItemConfirm'))) return;
    try {
      await api.deleteMedia(id);
      this._media = this._media.filter(m => m.id !== id);
      this._repaint();
    } catch (err) { showToast(err.message, 'error'); }
  }

  // Persist the whole grouped order in one request — the server writes it in a
  // single transaction, so a partial reorder can never be observed.
  _commitOrder() {
    const order = [];
    for (const g of this._groupBySection()) {
      const sid = g.section ? g.section.id : null;
      g.items.forEach((m, idx) => order.push({ id: m.id, sort_order: idx, section_id: sid }));
    }
    api.reorderMedia(order).catch(err => showToast(err.message, 'error'));
  }

  // ── Drag and drop (within and across sections) ─────────────────────────────
  _attachDrag(groups) {
    const clear = () => groups.querySelectorAll('.is-dragging, .is-drag-over, .is-drop-active')
      .forEach(el => el.classList.remove('is-dragging', 'is-drag-over', 'is-drop-active'));
    const parseSid = (raw) => (raw === '' || raw == null ? null : Number(raw));

    groups.addEventListener('dragstart', (e) => {
      const tile = e.target.closest('.bg-lib-admin__item');
      if (!tile) return;
      this._dragId = Number(tile.dataset.mediaId);
      tile.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      // Firefox refuses to start a drag unless some data is set.
      e.dataTransfer.setData('text/plain', String(this._dragId));
    });

    groups.addEventListener('dragover', (e) => {
      const grid = e.target.closest('.bg-lib-admin__grid');
      if (!grid || this._dragId == null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      groups.querySelectorAll('.is-drag-over, .is-drop-active')
        .forEach(el => el.classList.remove('is-drag-over', 'is-drop-active'));
      grid.classList.add('is-drop-active');
      const over = e.target.closest('.bg-lib-admin__item');
      if (over && Number(over.dataset.mediaId) !== this._dragId) over.classList.add('is-drag-over');
    });

    groups.addEventListener('drop', (e) => {
      const grid = e.target.closest('.bg-lib-admin__grid');
      if (!grid || this._dragId == null) { clear(); this._dragId = null; return; }
      e.preventDefault();
      const fromIdx = this._media.findIndex(m => m.id === this._dragId);
      if (fromIdx === -1) { clear(); this._dragId = null; return; }

      const targetSid = parseSid(grid.dataset.sectionId);
      const over = e.target.closest('.bg-lib-admin__item');
      const arr = [...this._media];
      const [moved] = arr.splice(fromIdx, 1);
      moved.section_id = targetSid;

      let insertAt;
      if (over && Number(over.dataset.mediaId) !== this._dragId) {
        insertAt = arr.findIndex(m => m.id === Number(over.dataset.mediaId));
        if (insertAt === -1) insertAt = arr.length;
      } else {
        // Dropped on empty grid space — append to the end of that section.
        let last = -1;
        for (let i = 0; i < arr.length; i++) if ((arr[i].section_id ?? null) === targetSid) last = i;
        insertAt = last === -1 ? arr.length : last + 1;
      }
      arr.splice(insertAt, 0, moved);
      this._media = arr;

      clear();
      this._dragId = null;
      this._repaint();
      this._commitOrder();
    });

    groups.addEventListener('dragend', () => { clear(); this._dragId = null; });
  }
}

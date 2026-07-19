// CustomerNotes — a reusable categorized note LOG about a shop customer,
// authored by staff. Embedded by the admin Customers list (per-row modal) and
// the admin order-detail page.
//
//   new CustomerNotes({ customerId, isAdminViewer }).mount() -> HTMLElement
//     customerId     the customer's users.id
//     isAdminViewer  drives the visibility toggle (non-admins only file 'staff')
//
// If the viewer lacks the 'customers' view (403 — possible on order detail),
// the component renders nothing instead of erroring. All note text is escaped;
// the server enforces per-note visibility + role.
import { t } from '../i18n/i18n.js';
import { escHtml } from '../utils/escHtml.js';
import { showToast } from './Toast.js';
import { listCustomerNotes, createCustomerNote, updateCustomerNote, deleteCustomerNote } from '../services/adminCustomerNotes.js';

const CATS = ['order_prefs', 'ordering', 'special_needs', 'general'];
const CAT_KEY = {
  order_prefs:   'catOrderPrefs',
  ordering:      'catOrdering',
  special_needs: 'catSpecialNeeds',
  general:       'catGeneral',
};

export class CustomerNotes {
  constructor({ customerId, isAdminViewer = false } = {}) {
    this._customerId = customerId;
    this._admin = !!isAdminViewer;
    this._notes = null;
    this._loading = true;
    this._forbidden = false;
    this._adding = false;
    this._editingId = null;
    this._busy = false;
    this._root = null;
    this._onClick = null;
    this._onChange = null;
    this._visTouched = false;   // has the author manually set visibility on the add form?
  }

  mount() {
    const root = document.createElement('div');
    root.className = 'cn';
    this._root = root;
    this._onClick = (e) => this._handleClick(e);
    this._onChange = (e) => this._handleChange(e);
    root.addEventListener('click', this._onClick);
    root.addEventListener('change', this._onChange);
    this._render();
    this.refresh();
    return root;
  }

  destroy() {
    if (this._root && this._onClick) this._root.removeEventListener('click', this._onClick);
    if (this._root && this._onChange) this._root.removeEventListener('change', this._onChange);
    this._root = null;
  }

  async refresh() {
    if (!this._customerId) { this._render(); return; }
    this._loading = this._notes == null;
    this._render();
    try {
      const data = await listCustomerNotes(this._customerId);
      this._notes = data.notes || [];
    } catch (err) {
      // No 'customers' view (order-detail embed) → render nothing, not an error.
      if (err.status === 403) { this._forbidden = true; this._loading = false; this._render(); return; }
      this._notes = this._notes || [];
      showToast(err.message || t('form.error'), 'error');
    }
    this._loading = false;
    this._render();
  }

  // ── helpers ─────────────────────────────────────────────────────────────────
  _fmt(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString(undefined, {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    } catch { return ''; }
  }

  _catLabel(cat) { return t('customerNotes.' + (CAT_KEY[cat] || 'catGeneral')); }
  _visLabel(vis) { return t('customerNotes.' + (vis === 'admin' ? 'visAdmin' : 'visStaff')); }

  // Pin special-needs notes to the top (safety/operational) so they're never
  // buried under newer general notes; the rest keep the server's newest-first
  // order. Array.prototype.sort is stable, so ties preserve that order.
  _sorted() {
    const rank = (n) => (n.category === 'special_needs' ? 0 : 1);
    return [...(this._notes || [])].sort((a, b) => rank(a) - rank(b));
  }

  _focusBody() {
    setTimeout(() => { const ta = this._root && this._root.querySelector('.cn-f-body'); if (ta) ta.focus(); }, 0);
  }

  // ── render ──────────────────────────────────────────────────────────────────
  _render() {
    if (!this._root) return;
    if (this._forbidden) { this._root.innerHTML = ''; return; }
    if (this._loading && this._notes == null) {
      this._root.innerHTML = `<p class="cn-empty">${escHtml(t('form.loading'))}</p>`;
      return;
    }
    this._root.innerHTML = this._listHtml() + this._addHtml();
  }

  _listHtml() {
    const notes = this._sorted();
    if (!notes.length && !this._adding) {
      return `<p class="cn-empty">${escHtml(t('customerNotes.empty'))}</p>`;
    }
    return `<div class="cn-list">${notes.map((n) => (n.id === this._editingId ? this._formHtml({ mode: 'edit', note: n }) : this._noteHtml(n))).join('')}</div>`;
  }

  _noteHtml(n) {
    const author = escHtml(n.author_display || '—');
    return `<div class="cn-note">
      <div class="cn-note__head">
        <span class="cn-chip cn-chip--${escHtml(n.category)}">${escHtml(this._catLabel(n.category))}</span>
        <span class="cn-badge cn-badge--${escHtml(n.visibility)}">${escHtml(this._visLabel(n.visibility))}</span>
        <div class="cn-actions">
          <button type="button" class="cn-link" data-action="edit" data-id="${escHtml(n.id)}">${escHtml(t('customerNotes.edit'))}</button>
          <button type="button" class="cn-link cn-link--danger" data-action="delete" data-id="${escHtml(n.id)}">${escHtml(t('customerNotes.delete'))}</button>
        </div>
      </div>
      <div class="cn-note__body">${escHtml(n.body)}</div>
      <div class="cn-byline">${t('customerNotes.byline', { author, date: this._fmt(n.created_at) })}${(n.updated_at && n.updated_at !== n.created_at) ? ` · ${escHtml(t('customerNotes.edited'))}` : ''}</div>
    </div>`;
  }

  _addHtml() {
    if (this._adding) return this._formHtml({ mode: 'new' });
    return `<div class="cn-addbar"><button type="button" class="admin-shop__primary-btn" data-action="add">+ ${escHtml(t('customerNotes.add'))}</button></div>`;
  }

  _formHtml({ mode, note = null }) {
    const isEdit = mode === 'edit';
    const cat  = note ? note.category : 'general';
    const vis  = note ? note.visibility : (this._admin ? 'admin' : 'staff');
    const body = note ? note.body : '';
    const idAttr = isEdit ? ` data-id="${escHtml(note.id)}"` : '';
    const catOpts = CATS.map((c) => `<option value="${c}"${c === cat ? ' selected' : ''}>${escHtml(this._catLabel(c))}</option>`).join('');
    // Non-admins can only file 'staff' notes; admins get the toggle.
    const visField = !this._admin
      ? `<input type="hidden" class="cn-f-visibility" value="staff"/>`
      : `<label class="cn-field"><span>${escHtml(t('customerNotes.visibility'))}</span>
           <select class="cn-f-visibility">
             <option value="admin"${vis === 'admin' ? ' selected' : ''}>${escHtml(t('customerNotes.visAdmin'))}</option>
             <option value="staff"${vis === 'staff' ? ' selected' : ''}>${escHtml(t('customerNotes.visStaff'))}</option>
           </select></label>`;
    return `<div class="cn-form"${idAttr}>
      <div class="cn-form__row">
        <label class="cn-field"><span>${escHtml(t('customerNotes.category'))}</span>
          <select class="cn-f-category">${catOpts}</select></label>
        ${visField}
      </div>
      <textarea class="cn-f-body" rows="3" placeholder="${escHtml(t('customerNotes.bodyPlaceholder'))}">${escHtml(body)}</textarea>
      <div class="cn-form__actions">
        <button type="button" class="admin-shop__primary-btn" data-action="${isEdit ? 'cancel-edit' : 'cancel-new'}">${escHtml(t('admin.cancel'))}</button>
        <button type="button" class="admin-shop__primary-btn" data-action="${isEdit ? 'save-edit' : 'save-new'}"${idAttr}>${escHtml(t('form.save'))}</button>
      </div>
    </div>`;
  }

  // ── interaction ─────────────────────────────────────────────────────────────
  _handleClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn || !this._root || !this._root.contains(btn)) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    switch (action) {
      case 'add':         this._adding = true; this._editingId = null; this._visTouched = false; this._render(); this._focusBody(); break;
      case 'cancel-new':  this._adding = false; this._render(); break;
      case 'edit':        this._editingId = id; this._adding = false; this._render(); this._focusBody(); break;
      case 'cancel-edit': this._editingId = null; this._render(); break;
      case 'save-new':    this._saveNew(btn); break;
      case 'save-edit':   this._saveEdit(btn, id); break;
      case 'delete':      this._delete(id); break;
      default: break;
    }
  }

  // Smart default (add form only): picking an operational category (special needs /
  // how they order) pre-selects 'staff' visibility so any staff role actually sees
  // it — unless the author has already chosen a visibility themselves.
  _handleChange(e) {
    const el = e.target;
    if (!this._root || !this._root.contains(el)) return;
    if (el.classList.contains('cn-f-visibility')) { this._visTouched = true; return; }
    if (el.classList.contains('cn-f-category') && this._adding && !this._visTouched) {
      const vis = this._root.querySelector('select.cn-f-visibility');
      if (vis) vis.value = (el.value === 'special_needs' || el.value === 'ordering') ? 'staff' : 'admin';
    }
  }

  _readForm(btn) {
    const form = btn.closest('.cn-form');
    if (!form) return null;
    return {
      category:   form.querySelector('.cn-f-category')?.value || 'general',
      visibility: form.querySelector('.cn-f-visibility')?.value || (this._admin ? 'admin' : 'staff'),
      body:       (form.querySelector('.cn-f-body')?.value || '').trim(),
    };
  }

  _setSaving(btn, on) {
    if (!btn) return;
    btn.disabled = on;
    btn.textContent = on ? t('form.saving') : t('form.save');
  }

  async _saveNew(btn) {
    if (this._busy) return;
    const f = this._readForm(btn);
    if (!f) return;
    if (!f.body) { this._focusBody(); return; }
    this._busy = true; this._setSaving(btn, true);
    try {
      await createCustomerNote({ customerId: this._customerId, category: f.category, visibility: f.visibility, body: f.body });
      this._adding = false;
      showToast(t('customerNotes.savedToast'), 'success');
      await this.refresh();
    } catch (err) {
      showToast(err.message || t('form.error'), 'error');
      this._setSaving(btn, false);
    } finally {
      this._busy = false;
    }
  }

  async _saveEdit(btn, id) {
    if (this._busy) return;
    const f = this._readForm(btn);
    if (!f) return;
    if (!f.body) { this._focusBody(); return; }
    this._busy = true; this._setSaving(btn, true);
    try {
      await updateCustomerNote(id, { category: f.category, visibility: f.visibility, body: f.body });
      this._editingId = null;
      showToast(t('customerNotes.savedToast'), 'success');
      await this.refresh();
    } catch (err) {
      showToast(err.message || t('form.error'), 'error');
      this._setSaving(btn, false);
    } finally {
      this._busy = false;
    }
  }

  async _delete(id) {
    if (this._busy) return;
    if (!confirm(t('customerNotes.confirmDelete'))) return;
    this._busy = true;
    try {
      await deleteCustomerNote(id);
      showToast(t('customerNotes.deletedToast'), 'success');
      await this.refresh();
    } catch (err) {
      showToast(err.message || t('form.error'), 'error');
    } finally {
      this._busy = false;
    }
  }
}

// AdminProductDuplicatesView — Products → Duplicates (/admin/shop/products/duplicates).
//
// Ported from icelandicstore #309/#312/#315 (AdminProductDuplicatesView +
// the essentials of AdminProductMergeView), cut to one screen: groups of
// products that look like the same item, each badged with the WEAKEST signal
// holding it together plus the other signals, and the evidence per product
// (SKU, barcode, variants, on hand, order lines, images, collections, other
// history). Per group the admin picks the survivor, previews the merge — every
// unit's target, the refusals and warnings, re-planned on the SERVER on every
// change — and merges. ice's pairing tray, bulk "Merge…" and free-typed new
// axis values are not ported (history fragment, harvest 2 lane 6b).
//
// Access: the `products` view (server-side gate on every route; this check is
// UX only). Theme rule: tokens only (invariant 15) — see admin-product-merge.css.
import { isAuthenticated, canSeeView } from '../services/auth.js';
import { adminGetProductDuplicates, adminPreviewProductMerge, adminMergeProducts } from '../services/adminProducts.js';
import { escHtml } from '../utils/escHtml.js';
import { t, href, getLocale } from '../i18n/i18n.js';
import { adminPageTitle } from '../utils/pageTitle.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';

// Literal keys so check:i18n can see every label.
const SIGNAL_KEY = {
  barcode:   'adminProductDuplicates.signal.barcode',
  sku:       'adminProductDuplicates.signal.sku',
  identical: 'adminProductDuplicates.signal.identical',
  colourway: 'adminProductDuplicates.signal.colourway',
  similar:   'adminProductDuplicates.signal.similar',
};
const KIND_KEY = {
  map:    'adminProductDuplicates.kind.map',
  move:   'adminProductDuplicates.kind.move',
  new:    'adminProductDuplicates.kind.new',
  master: 'adminProductDuplicates.kind.master',
};
const REASON_KEY = {
  unit_unmapped:                'adminProductDuplicates.reason.unit_unmapped',
  target_invalid:               'adminProductDuplicates.reason.target_invalid',
  target_not_live:              'adminProductDuplicates.reason.target_not_live',
  master_simple_variants:       'adminProductDuplicates.reason.master_simple_variants',
  vat_mismatch:                 'adminProductDuplicates.reason.vat_mismatch',
  bookable_mismatch:            'adminProductDuplicates.reason.bookable_mismatch',
  attributes_invalid:           'adminProductDuplicates.reason.attributes_invalid',
  attribute_collision:          'adminProductDuplicates.reason.attribute_collision',
  sku_collision:                'adminProductDuplicates.reason.sku_collision',
  already_merged:               'adminProductDuplicates.reason.already_merged',
  too_many:                     'adminProductDuplicates.reason.too_many',
  nothing_to_merge:             'adminProductDuplicates.reason.nothing_to_merge',
  unit_unknown:                 'adminProductDuplicates.reason.unit_unknown',
  master_variants_inconsistent: 'adminProductDuplicates.reason.master_variants_inconsistent',
  master_inactive:              'adminProductDuplicates.reason.master_inactive',
  category_differs:             'adminProductDuplicates.reason.category_differs',
  price_differs:                'adminProductDuplicates.reason.price_differs',
  price_kept_on_variant:        'adminProductDuplicates.reason.price_kept_on_variant',
};

const reasonText = (code) => (REASON_KEY[code] ? t(REASON_KEY[code]) : String(code || ''));

function attrsText(attrs) {
  const entries = Object.entries(attrs || {});
  return entries.length ? entries.map(([k, v]) => `${k}: ${v}`).join(' · ') : t('adminProductDuplicates.noVariant');
}

export class AdminProductDuplicatesView {
  constructor() {
    this._el = null;
    this._groups = [];
    this._plans = new Map();     // group index → { data, variantMap }
    this._timers = new Map();
    this._ctrls = new Map();
    this._destroyed = false;
  }

  destroy() {
    this._destroyed = true;
    for (const tm of this._timers.values()) clearTimeout(tm);
    for (const c of this._ctrls.values()) c.abort();
  }

  async render() {
    if (!isAuthenticated() || !canSeeView('products')) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }
    this.documentTitle = adminPageTitle(t('adminProductDuplicates.title'), getLocale());
    this._el = document.createElement('div');
    this._el.className = 'main admin-page pdup';
    this._el.innerHTML = `<div class="admin-loading">${escHtml(t('form.loading'))}</div>`;
    // Delegated once: the listeners survive every repaint of the list.
    this._wire();
    await this._load();
    return renderAdminShell({ activePath: '/admin/shop/products', content: this._el });
  }

  async _load({ announce = '' } = {}) {
    try {
      const data = await adminGetProductDuplicates();
      if (this._destroyed) return;
      this._groups = data.groups || [];
      this._plans.clear();
    } catch (err) {
      this._el.innerHTML = `${this._headHtml()}<p class="admin-error" role="alert">${escHtml(err.message)}</p>`;
      return;
    }
    this._build(announce);
  }

  _headHtml() {
    return `
      <a class="pdup-back" href="${href('/admin/shop/products')}" data-route="/admin/shop/products">‹ ${escHtml(t('adminProducts.title'))}</a>
      <div class="admin-header">
        <div>
          <p class="admin-eyebrow">${escHtml(t('adminProducts.title'))}</p>
          <h1 class="admin-title" id="pdup-title" tabindex="-1">${escHtml(t('adminProductDuplicates.title'))}</h1>
          <p class="admin-shop__hint">${escHtml(t('adminProductDuplicates.subtitle'))}</p>
        </div>
      </div>`;
  }

  _build(announce) {
    const groups = this._groups;
    this._el.innerHTML = `
      ${this._headHtml()}
      <p class="pdup-status" role="status" aria-live="polite" id="pdup-live">${escHtml(announce)}</p>
      ${groups.length
        ? `<p class="pdup-count">${escHtml(t('adminProductDuplicates.count', { n: groups.length }))}</p>
           ${groups.map((g, i) => this._groupHtml(g, i)).join('')}`
        : `<p class="pdup-empty">${escHtml(t('adminProductDuplicates.none'))}</p>`}`;
    // The router only scrolls; focus the heading so a screen reader lands here.
    // render() hands the element over before the router mounts it, so wait
    // until it is in the document (setTimeout, not rAF: rAF never fires in a
    // hidden tab — ice #309).
    let tries = 0;
    const focus = () => {
      const h = this._el && this._el.querySelector('#pdup-title');
      if (this._destroyed || !h) return;
      if (h.isConnected) h.focus();
      else if (tries++ < 40) setTimeout(focus, 25);
    };
    setTimeout(focus, 0);
  }

  _badgesHtml(g) {
    const weakest = g.type;
    const pct = weakest === 'similar' && g.confidence != null ? ` · ${Math.round(g.confidence * 100)}%` : '';
    const badge = (s, main) => `<span class="pdup-badge pdup-badge--${escHtml(s)}${main ? ' pdup-badge--main' : ''}">${escHtml(SIGNAL_KEY[s] ? t(SIGNAL_KEY[s]) : s)}${main ? pct : ''}</span>`;
    return [badge(weakest, true), ...g.signals.filter(s => s !== weakest).map(s => badge(s, false))].join(' ');
  }

  _roleHtml(p, g) {
    if (p.id === g.masterId) {
      return `<span class="pdup-role pdup-role--master">${escHtml(t(p.role === 'master'
        ? 'adminProductDuplicates.roleMaster' : 'adminProductDuplicates.roleSuggested'))}</span>`;
    }
    if (p.colour) {
      return `<span class="pdup-role">${escHtml(t('adminProductDuplicates.roleColour', { colour: p.colour }))}</span>`
        + (p.archivedColourMatch ? ` <span class="pdup-tell">${escHtml(t('adminProductDuplicates.inactiveTell'))}</span>` : '');
    }
    return '';
  }

  _groupHtml(g, idx) {
    const head = `pdup-group-${idx}`;
    const num = (n) => Number(n) || 0;
    return `
      <section class="pdup-group" aria-labelledby="${head}" data-group="${idx}">
        <div class="pdup-group__head">
          <h2 class="pdup-group__title" id="${head}">
            <span class="pdup-vh">${escHtml(t('adminProductDuplicates.groupN', { n: idx + 1 }))}: </span>${this._badgesHtml(g)}
          </h2>
          <button type="button" class="btn btn--outline btn--sm" data-preview="${idx}" aria-describedby="${head}">${escHtml(t('adminProductDuplicates.previewBtn'))}</button>
        </div>
        <div class="admin-table-wrap">
          <table class="admin-table pdup-table">
            <thead><tr>
              <th scope="col" id="pdup-mcol-${idx}">${escHtml(t('adminProductDuplicates.colSurvivor'))}</th>
              <th scope="col">${escHtml(t('adminProductDuplicates.colProduct'))}</th>
              <th scope="col">${escHtml(t('adminProductDuplicates.colRole'))}</th>
              <th scope="col">${escHtml(t('adminProductDuplicates.colCodes'))}</th>
              <th scope="col" class="pdup-num">${escHtml(t('adminProductDuplicates.colVariants'))}</th>
              <th scope="col" class="pdup-num">${escHtml(t('adminProductDuplicates.colOnHand'))}</th>
              <th scope="col" class="pdup-num">${escHtml(t('adminProductDuplicates.colOrderLines'))}</th>
              <th scope="col" class="pdup-num">${escHtml(t('adminProductDuplicates.colImages'))}</th>
              <th scope="col" class="pdup-num">${escHtml(t('adminProductDuplicates.colCollections'))}</th>
              <th scope="col" class="pdup-num">${escHtml(t('adminProductDuplicates.colReferences'))}</th>
            </tr></thead>
            <tbody>
              ${g.products.map((p, j) => `
                <tr class="${p.id === g.masterId ? 'pdup-row--survivor' : ''}">
                  <td><input type="radio" name="pdup-master-${idx}" value="${escHtml(p.id)}" aria-labelledby="pdup-mcol-${idx} pdup-name-${idx}-${j}"${p.id === g.masterId ? ' checked' : ''}></td>
                  <th scope="row" class="pdup-name" id="pdup-name-${idx}-${j}">
                    ${escHtml(p.name)}${p.active ? '' : ` <span class="pdup-draft">${escHtml(t('adminProductDuplicates.draft'))}</span>`}
                    <span class="pdup-slug">/${escHtml(p.slug)}</span>
                  </th>
                  <td>${this._roleHtml(p, g)}</td>
                  <td class="pdup-codes">${p.sku ? `<code>${escHtml(p.sku)}</code>` : '—'}${p.barcode ? `<br><code>${escHtml(p.barcode)}</code>` : ''}</td>
                  <td class="pdup-num">${num(p.variant_count)}${p.inactive_variant_count ? ` <span class="pdup-muted">(+${num(p.inactive_variant_count)} ${escHtml(t('adminProductDuplicates.inactiveShort'))})</span>` : ''}</td>
                  <td class="pdup-num">${num(p.on_hand)}</td>
                  <td class="pdup-num">${num(p.order_lines)}</td>
                  <td class="pdup-num">${num(p.image_count)}</td>
                  <td class="pdup-num">${num(p.collection_count)}</td>
                  <td class="pdup-num">${num(p.references)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="pdup-plan" id="pdup-plan-${idx}" hidden></div>
      </section>`;
  }

  _wire() {
    this._el.addEventListener('click', (e) => {
      const pv = e.target.closest('[data-preview]');
      if (pv) { this._preview(Number(pv.dataset.preview), { fresh: true }); return; }
      const mg = e.target.closest('[data-merge]');
      if (mg) this._merge(Number(mg.dataset.merge));
    });
    this._el.addEventListener('change', (e) => {
      const radio = e.target.closest('input[type=radio][name^="pdup-master-"]');
      if (radio) {
        // A different survivor is a different merge: the old plan no longer applies.
        const idx = Number(radio.name.slice('pdup-master-'.length));
        this._plans.delete(idx);
        const panel = this._el.querySelector(`#pdup-plan-${idx}`);
        if (panel) { panel.hidden = true; panel.innerHTML = ''; }
        return;
      }
      const sel = e.target.closest('select[data-unit]');
      if (sel) this._retarget(Number(sel.dataset.group), sel.dataset.unit, sel.value);
    });
  }

  _survivor(idx) {
    const g = this._groups[idx];
    const picked = this._el.querySelector(`input[name="pdup-master-${idx}"]:checked`);
    return picked ? picked.value : g.masterId;
  }

  // One server plan per change; the previous request is aborted.
  async _preview(idx, { fresh = false, variantMap = null } = {}) {
    const g = this._groups[idx];
    if (!g) return;
    const master = this._survivor(idx);
    const ids = g.products.map(p => p.id).filter(id => id !== master);
    const panel = this._el.querySelector(`#pdup-plan-${idx}`);
    panel.hidden = false;
    if (fresh) panel.innerHTML = `<p class="admin-loading">${escHtml(t('adminProductDuplicates.planning'))}</p>`;
    if (this._ctrls.has(idx)) this._ctrls.get(idx).abort();
    const ctrl = new AbortController();
    this._ctrls.set(idx, ctrl);
    try {
      const body = variantMap ? { master, ids, variant_map: variantMap } : { master, ids };
      const data = await adminPreviewProductMerge(body, { signal: ctrl.signal });
      if (this._destroyed || ctrl.signal.aborted) return;
      this._plans.set(idx, { data, variantMap: data.request.variant_map });
      panel.innerHTML = this._planHtml(idx, data);
      if (fresh) panel.querySelector('.pdup-plan__title')?.focus();
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      panel.innerHTML = `<p class="admin-error" role="alert">${escHtml(err.message)}</p>`;
    }
  }

  _retarget(idx, unitKey, value) {
    const plan = this._plans.get(idx);
    if (!plan) return;
    const unit = plan.data.plan.units.find(u => u.key === unitKey);
    const proposal = (plan.data.proposal.variant_map || [])
      .find(e => e.source.productId === unit.productId && (e.source.variantId || null) === (unit.variantId || null));
    const target = value === '' ? null
      : value === 'master' ? { master: true }
        : value === 'new' ? { attributes: (proposal && proposal.target && proposal.target.attributes) || unit.newAttributes || {} }
          : { variantId: value.slice('v:'.length) };
    const variantMap = plan.variantMap.map(e =>
      (e.source.productId === unit.productId && (e.source.variantId || null) === (unit.variantId || null)) ? { ...e, target } : e);
    clearTimeout(this._timers.get(idx));
    this._timers.set(idx, setTimeout(() => this._preview(idx, { variantMap }), 300));
  }

  _targetSelectHtml(idx, u, data) {
    const master = data.master;
    const simple = !(master.variants || []).length && !(master.variant_axes || []).length;
    const current = !u.target ? '' : u.target.master ? 'master' : u.target.variantId ? `v:${u.target.variantId}` : 'new';
    const proposal = (data.proposal.variant_map || [])
      .find(e => e.source.productId === u.productId && (e.source.variantId || null) === (u.variantId || null));
    const newAttrs = (u.target && u.target.attributes) || (proposal && proposal.target && proposal.target.attributes) || null;
    const opt = (value, label) => `<option value="${escHtml(value)}"${value === current ? ' selected' : ''}>${escHtml(label)}</option>`;
    const options = [opt('', t('adminProductDuplicates.choose'))];
    if (simple) options.push(opt('master', t('adminProductDuplicates.targetMaster')));
    else {
      for (const v of master.variants) options.push(opt(`v:${v.id}`, `${attrsText(v.attributes)} (${v.sku})`));
      if (newAttrs) options.push(opt('new', t('adminProductDuplicates.targetNew', { attrs: attrsText(newAttrs) })));
    }
    const invalid = data.plan.refusals.some(r => r.unit === u.key || (Array.isArray(r.units) && r.units.includes(u.key)));
    const label = `${u.name} — ${u.variantId ? attrsText(u.attributes) : t('adminProductDuplicates.noVariant')}`;
    return `<select class="form-select pdup-target" data-group="${idx}" data-unit="${escHtml(u.key)}"
              aria-label="${escHtml(t('adminProductDuplicates.targetFor', { unit: label }))}"${invalid ? ' aria-invalid="true"' : ''}>${options.join('')}</select>`;
  }

  _planHtml(idx, data) {
    const plan = data.plan;
    const s = plan.summary || {};
    const parts = [
      s.mapped ? t('adminProductDuplicates.sumMapped', { n: s.mapped }) : '',
      (s.moved + s.created) ? t('adminProductDuplicates.sumNew', { n: s.moved + s.created }) : '',
      s.into_master ? t('adminProductDuplicates.sumMaster', { n: s.into_master }) : '',
      s.stockMoved ? t('adminProductDuplicates.sumStock', { n: s.stockMoved }) : '',
    ].filter(Boolean);
    const survivor = data.master;
    const refusals = plan.refusals.length
      ? `<div class="pdup-refusals" role="alert"><p class="pdup-refusals__lead">${escHtml(t('adminProductDuplicates.refused'))}</p>
           <ul>${plan.refusals.map(r => `<li>${escHtml(reasonText(r.code))}${r.unit ? ` <code>${escHtml(r.unit)}</code>` : ''}</li>`).join('')}</ul></div>`
      : '';
    const warnings = plan.warnings.length
      ? `<ul class="pdup-warnings">${plan.warnings.map(w => `<li>${escHtml(reasonText(w.code))}</li>`).join('')}</ul>`
      : '';
    return `
      <h3 class="pdup-plan__title" tabindex="-1">${escHtml(t('adminProductDuplicates.planTitle', { name: survivor.name }))}</h3>
      <p class="pdup-plan__sum">${escHtml(plan.ok
        ? t('adminProductDuplicates.ready', { parts: parts.join(' · ') || '—' })
        : t('adminProductDuplicates.notReady'))}</p>
      <div class="admin-table-wrap">
        <table class="admin-table pdup-units">
          <thead><tr>
            <th scope="col">${escHtml(t('adminProductDuplicates.colUnit'))}</th>
            <th scope="col" class="pdup-num">${escHtml(t('adminProductDuplicates.colOnHand'))}</th>
            <th scope="col">${escHtml(t('adminProductDuplicates.colTarget'))}</th>
            <th scope="col">${escHtml(t('adminProductDuplicates.colWhat'))}</th>
          </tr></thead>
          <tbody>${plan.units.map(u => `
            <tr>
              <th scope="row" class="pdup-name">${escHtml(u.name)}
                <span class="pdup-slug">${escHtml(u.variantId ? attrsText(u.attributes) : t('adminProductDuplicates.noVariant'))}${u.sku ? ` · ${escHtml(u.sku)}` : ''}</span></th>
              <td class="pdup-num">${Number(u.stock) || 0}</td>
              <td>${this._targetSelectHtml(idx, u, data)}</td>
              <td>${u.kind ? escHtml(t(KIND_KEY[u.kind])) : '—'}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>
      ${refusals}${warnings}
      <p class="pdup-hint">${escHtml(t('adminProductDuplicates.mergeHint'))}</p>
      <div class="pdup-plan__actions">
        <button type="button" class="btn btn--primary" data-merge="${idx}"${plan.ok ? '' : ' disabled'}>${escHtml(t('adminProductDuplicates.mergeBtn'))}</button>
      </div>`;
  }

  async _merge(idx) {
    const plan = this._plans.get(idx);
    if (!plan || !plan.data.plan.ok) return;
    const names = plan.data.sources.map(s => s.name).join(', ');
    if (!window.confirm(t('adminProductDuplicates.confirm', { sources: names, survivor: plan.data.master.name }))) return;
    const panel = this._el.querySelector(`#pdup-plan-${idx}`);
    const btn = panel.querySelector('[data-merge]');
    if (btn) btn.disabled = true;
    try {
      await adminMergeProducts({ ...plan.data.request, expect: plan.data.expect });
      await this._load({ announce: t('adminProductDuplicates.merged', { sources: names, survivor: plan.data.master.name }) });
    } catch (err) {
      if (err.reason === 'stale_preview') {
        // Something changed since the preview: plan again and say so.
        await this._preview(idx, { variantMap: plan.variantMap });
        this._el.querySelector('#pdup-live').textContent = t('adminProductDuplicates.stale');
        return;
      }
      if (btn) btn.disabled = false;
      const msg = err.refusals && err.refusals.length
        ? `${err.message}: ${err.refusals.map(r => reasonText(r.code)).join(', ')}` : err.message;
      panel.insertAdjacentHTML('beforeend', `<p class="admin-error" role="alert">${escHtml(msg)}</p>`);
    }
  }
}

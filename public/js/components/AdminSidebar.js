// AdminSidebar — left-nav "admin shell" that wraps every /admin/* view.
//
// A shared sidebar (overview / shop / site / settings groups) plus a content
// pane. Each admin view builds its own content element as before, then returns
// renderAdminShell({ activePath, content }) so the back-office navigation is
// consistent across every section. Navigation is handled by the router's global
// anchor interceptor — sidebar links are plain locale-prefixed <a> tags, so they
// need no per-link click wiring here. (The NavBar admin dropdown is kept too — the
// two are complementary entry points.)
//
// EDIT MODE (admin only): the sidebar can be flipped into an editor where the
// admin renames lines/section titles inline, drags lines to reorder within and
// across sections, creates new sections, deletes ones they created, and resets to
// default. ADMIN_NAV is the static source of truth; a per-admin *layout snapshot*
// (persisted via adminNavLayout.js → users.admin_nav_config) is reconciled against
// it on every render. The snapshot stores only item ids + titles + label
// overrides — routes/icons always come from code, so a moved item keeps working
// and links can't break.

import { t, href, SUPPORTED_LOCALES } from '../i18n/i18n.js';
import { isAdmin, canSeeView } from '../services/auth.js';
import { showToast } from './Toast.js';
import {
  loadNavLayout, saveNavLayout, clearNavLayout, hydrateNavLayout, setNavRerender,
} from './adminNavLayout.js';

// Single source of truth for the admin information architecture. Each group has a
// stable `key` (used to map a section back to its default i18n title and to home
// items added in code later). Order here is render order. Routes mirror router.js.
export const ADMIN_NAV = [
  { key: 'overview', group: 'admin.navGroup.overview', items: [
    { id: 'dashboard', route: '/admin',               labelKey: 'admin.nav.dashboard', icon: 'grid' },
  ] },
  { key: 'shop', group: 'admin.navGroup.shop', items: [
    { id: 'products',    route: '/admin/shop/products',    labelKey: 'admin.nav.products',    icon: 'tag' },
    { id: 'collections', route: '/admin/shop/collections', labelKey: 'admin.nav.collections', icon: 'layers' },
    { id: 'orders',      route: '/admin/shop/orders',      labelKey: 'admin.nav.orders',      icon: 'receipt' },
    { id: 'discounts',   route: '/admin/discounts',        labelKey: 'admin.nav.discounts',   icon: 'percent' },
    { id: 'sales',       route: '/admin/sales',            labelKey: 'admin.nav.sales',       icon: 'chart' },
  ] },
  { key: 'site', group: 'admin.navGroup.site', items: [
    { id: 'analytics',  route: '/admin/analytics',    labelKey: 'admin.nav.analytics',  icon: 'activity' },
    { id: 'background', route: '/admin/background',    labelKey: 'admin.nav.background', icon: 'image' },
    { id: 'feedback',   route: '/admin/feedback',      labelKey: 'admin.nav.feedback',   icon: 'inbox' },
  ] },
  { key: 'settings', group: 'admin.navGroup.settings', items: [
    { id: 'general', route: '/admin/general', labelKey: 'admin.nav.general', icon: 'gear' },
    { id: 'users',   route: '/admin/users',   labelKey: 'admin.nav.users',   icon: 'shield' },
    { id: 'roles',   route: '/admin/roles',   labelKey: 'admin.nav.roles',   icon: 'key' },
  ] },
];

// Inline SVGs (stroke="currentColor"), matching the NavBar icon convention.
const ICONS = {
  grid:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>',
  receipt:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h12a1 1 0 0 1 1 1v18l-3-2-3 2-3-2-3 2V3a1 1 0 0 1 1-1Z"/><path d="M9 7h6M9 11h6M9 15h3"/></svg>',
  tag:       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L3 13V3h10l7.59 7.59a2 2 0 0 1 0 2.82Z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
  layers:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
  percent:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>',
  chart:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><line x1="8" y1="17" x2="8" y2="12"/><line x1="13" y1="17" x2="13" y2="7"/><line x1="18" y1="17" x2="18" y2="10"/></svg>',
  activity:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
  image:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
  inbox:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"/></svg>',
  gear:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>',
  shield:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg>',
  key:       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="3.5"/><path d="m10.5 12.5 8-8"/><path d="m15 6 2.5 2.5"/><path d="m18 3 2.5 2.5"/></svg>',
};

// Pencil (edit toggle) + grip (drag handle). The grip is filled dots, distinct
// from the stroke-based nav ICONS above.
const PENCIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const GRIP   = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>';

// ── Index, built once from the static ADMIN_NAV ───────────────────────────────
function buildIndex() {
  const byId = new Map();
  const groupOf = new Map();
  const groupTitleKey = {};
  const sections = [];
  for (const g of ADMIN_NAV) {
    groupTitleKey[g.key] = g.group;
    const ids = [];
    for (const it of g.items) {
      byId.set(it.id, it);
      groupOf.set(it.id, g.key);
      ids.push(it.id);
    }
    sections.push({ key: g.key, title: null, items: ids });
  }
  return { byId, groupOf, groupTitleKey, defaultSnapshot: { v: 1, sections, labels: {} } };
}
const { byId: BY_ID, groupOf: GROUP_OF, groupTitleKey: GROUP_TITLE_KEY, defaultSnapshot: DEFAULT_SNAPSHOT } = buildIndex();

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Reconcile a saved layout against the code ADMIN_NAV: drop dead/duplicate ids,
// append any code item the snapshot is missing (to its original group, else the
// first section) so new nav items never vanish, and prune stale label overrides.
// Passing null/empty yields the default layout — so the same render path covers
// the "never customized" case (and stays byte-identical to the legacy output).
function reconcile(saved) {
  const base = (saved && Array.isArray(saved.sections) && saved.sections.length) ? saved : DEFAULT_SNAPSHOT;
  const seen = new Set();
  const sections = base.sections.map(s => {
    const items = [];
    for (const id of (s.items || [])) {
      if (BY_ID.has(id) && canSeeView(id) && !seen.has(id)) { seen.add(id); items.push(id); }
    }
    return { key: String(s.key), title: (s.title == null ? null : String(s.title)), items };
  });
  // Insert any code-defined section the saved snapshot predates, at its ADMIN_NAV
  // position — so a newly-shipped nav group appears as its own section instead of
  // collapsing its items into the first section below.
  const presentKeys = new Set(sections.map(s => s.key));
  ADMIN_NAV.forEach((g, navIdx) => {
    if (presentKeys.has(g.key)) return;
    let insertAt = sections.length;
    for (let i = 0; i < sections.length; i++) {
      const si = ADMIN_NAV.findIndex(x => x.key === sections[i].key);
      if (si !== -1 && si < navIdx) insertAt = i + 1;
    }
    sections.splice(insertAt, 0, { key: g.key, title: null, items: [] });
    presentKeys.add(g.key);
  });
  for (const id of BY_ID.keys()) {
    if (seen.has(id)) continue;
    if (!canSeeView(id)) continue; // RBAC: never surface a view the role can't access
    const target = sections.find(s => s.key === GROUP_OF.get(id)) || sections[0];
    if (target) { target.items.push(id); seen.add(id); }
  }
  const labels = {};
  const raw = (saved && saved.labels && typeof saved.labels === 'object') ? saved.labels : {};
  for (const [id, val] of Object.entries(raw)) {
    if (BY_ID.has(id) && typeof val === 'string' && val !== '') labels[id] = val;
  }
  return { v: 1, sections, labels };
}

// Section title: custom sections carry an explicit string; default sections show
// their translated group title (title === null). A blanked custom title falls
// back to the "New section" placeholder so a header is never empty.
function sectionTitle(section) {
  const defKey = GROUP_TITLE_KEY[section.key];
  if (section.title != null && section.title !== '') return section.title;
  if (defKey) return t(defKey);
  return t('admin.navEdit.newSection');
}

// Item label: a per-item override wins, else the translated default.
function itemLabel(item, labels) {
  const ov = labels && labels[item.id];
  return (typeof ov === 'string' && ov !== '') ? ov : t(item.labelKey);
}

function stripLocale(pathname) {
  const parts = (pathname || '/').split('/').filter(Boolean);
  if (parts[0] && SUPPORTED_LOCALES.includes(parts[0])) parts.shift();
  return '/' + parts.join('/');
}

// Longest matching route wins, so /admin/shop/orders lights "Orders" rather than
// the /admin "Dashboard" (which would otherwise prefix-match every admin route).
// Reads the static ADMIN_NAV (not the snapshot) so the active highlight is correct
// no matter where the admin has moved an item.
function pickActiveId(path) {
  let best = null, bestLen = -1;
  for (const g of ADMIN_NAV) {
    for (const it of g.items) {
      if (!it.route) continue;
      if ((path === it.route || path.startsWith(it.route + '/')) && it.route.length > bestLen) {
        best = it.id; bestLen = it.route.length;
      }
    }
  }
  return best;
}

function itemHtml(item, activeId, labels, editing) {
  if (!item) return '';
  const icon = `<span class="admin-sidebar__item-icon" aria-hidden="true">${ICONS[item.icon] || ''}</span>`;
  const labelText = itemLabel(item, labels);
  if (editing) {
    const soonBadge = item.soon ? `<span class="admin-sidebar__soon-badge">${t('admin.soon')}</span>` : '';
    const drag = escHtml(t('admin.navEdit.dragHandle'));
    return `<div class="admin-sidebar__item admin-sidebar__item--editing" data-item-id="${escHtml(item.id)}">`
      + `<span class="admin-sidebar__drag-handle" data-drag-handle draggable="true" aria-label="${drag}" title="${drag}">${GRIP}</span>`
      + icon
      + `<span class="admin-sidebar__item-label" data-item-label contenteditable="true" spellcheck="false">${escHtml(labelText)}</span>`
      + soonBadge
      + `</div>`;
  }
  const label = `<span class="admin-sidebar__item-label">${escHtml(labelText)}</span>`;
  if (item.soon) {
    return `<span class="admin-sidebar__item admin-sidebar__item--soon" aria-disabled="true">${icon}${label}<span class="admin-sidebar__soon-badge">${t('admin.soon')}</span></span>`;
  }
  const active = item.id === activeId;
  return `<a class="admin-sidebar__item${active ? ' is-active' : ''}" href="${href(item.route)}" data-route="${item.route}"${active ? ' aria-current="page"' : ''}>${icon}${label}</a>`;
}

function sectionHtml(section, activeId, labels, editing) {
  const titleText = sectionTitle(section);
  const itemsHtml = section.items.map(id => itemHtml(BY_ID.get(id), activeId, labels, editing)).join('');
  if (!editing) {
    return `<div class="admin-sidebar__group">`
      + `<p class="admin-sidebar__group-title">${escHtml(titleText)}</p>`
      + itemsHtml
      + `</div>`;
  }
  const isCustom = !GROUP_TITLE_KEY[section.key];
  const delLabel = escHtml(t('admin.navEdit.deleteSection'));
  const del = isCustom
    ? `<button type="button" class="admin-sidebar__section-delete" data-section-delete aria-label="${delLabel}" title="${delLabel}">×</button>`
    : '';
  const empty = section.items.length ? '' : ' admin-sidebar__group--empty';
  const drag = escHtml(t('admin.navEdit.dragHandle'));
  return `<div class="admin-sidebar__group admin-sidebar__group--editing${empty}" data-section-key="${escHtml(section.key)}">`
    + `<div class="admin-sidebar__group-head">`
    + `<span class="admin-sidebar__section-handle" data-section-handle draggable="true" aria-label="${drag}" title="${drag}">${GRIP}</span>`
    + `<p class="admin-sidebar__group-title" data-section-title contenteditable="true" spellcheck="false">${escHtml(titleText)}</p>`
    + del
    + `</div>`
    + `<div class="admin-sidebar__group-items" data-section-items>${itemsHtml}</div>`
    + `</div>`;
}

function editControlsHtml(editing) {
  if (!editing) return '';
  return `<div class="admin-sidebar__edit-controls">`
    + `<button type="button" class="admin-sidebar__edit-action" data-nav-add-section>${escHtml(t('admin.navEdit.addSection'))}</button>`
    + `<button type="button" class="admin-sidebar__edit-action admin-sidebar__edit-action--reset" data-nav-reset>${escHtml(t('admin.navEdit.reset'))}</button>`
    + `</div>`;
}

function selectAllText(el) {
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  } catch { /* selection API unavailable */ }
}

/**
 * Wrap an admin view's content element in the shared sidebar shell.
 *   activePath — locale-stripped path of the view (e.g. '/admin/shop/orders').
 *                Falsy → derived from the current URL.
 *   content    — the Element the view built (its existing root).
 * Returns the shell Element; the caller returns this from render().
 */
export function renderAdminShell({ activePath, content } = {}) {
  const path     = activePath || stripLocale(window.location.pathname);
  const activeId = pickActiveId(path);
  const canEdit  = isAdmin();

  const shell = document.createElement('div');
  shell.className = 'admin-shell';
  shell.innerHTML = `
    <button type="button" class="admin-shell__menu-btn" aria-controls="admin-sidebar" aria-expanded="false">
      <span class="admin-shell__menu-icon" aria-hidden="true"><span></span><span></span><span></span></span>
      ${t('admin.menu')}
    </button>
    <aside class="admin-sidebar" id="admin-sidebar" aria-label="${t('admin.sidebarLabel')}">
      <a class="admin-sidebar__back" href="${href('/')}" data-route="/"><span aria-hidden="true">←</span> ${t('admin.backToSite')}</a>
      ${canEdit ? `<button type="button" class="admin-sidebar__edit-toggle" data-testid="admin-nav-edit-toggle" aria-pressed="false">
        <span class="admin-sidebar__edit-toggle-icon" aria-hidden="true">${PENCIL}</span>
        <span class="admin-sidebar__edit-toggle-label">${t('admin.navEdit.edit')}</span>
      </button>` : ''}
      <nav class="admin-sidebar__nav"></nav>
    </aside>
    <div class="admin-shell__content"></div>
  `;

  if (content) shell.querySelector('.admin-shell__content').appendChild(content);

  const aside   = shell.querySelector('.admin-sidebar');
  const navEl   = shell.querySelector('.admin-sidebar__nav');
  const menuBtn = shell.querySelector('.admin-shell__menu-btn');
  const toggle  = shell.querySelector('.admin-sidebar__edit-toggle');
  const toggleLabel = toggle?.querySelector('.admin-sidebar__edit-toggle-label');

  let editing = false;
  let working = reconcile(loadNavLayout());
  let drag = null;
  const indicator = document.createElement('div');
  indicator.className = 'admin-sidebar__drop-indicator';

  function renderNav() {
    // While editing we keep the working copy; otherwise re-read the latest
    // persisted layout (so a hydrate or another view's change is reflected).
    if (!editing) working = reconcile(loadNavLayout());
    // Outside edit mode, hide sections the role has no items in (e.g. a
    // shop-only role won't see an empty "Settings" header). In edit mode (admin
    // only) keep empties so they remain drop targets.
    navEl.innerHTML = editControlsHtml(editing)
      + working.sections
          .filter(s => editing || s.items.length)
          .map(s => sectionHtml(s, activeId, working.labels, editing)).join('');
  }

  function persist() { saveNavLayout(working); }

  // ── inline rename ───────────────────────────────────────────────────────────
  // Normalises the edited text into the model and back into the element (no full
  // re-render — that would re-fire focusout on the detached node and loop).
  function commitRename(el) {
    const text = (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (el.matches('[data-item-label]')) {
      const id = el.closest('[data-item-id]')?.dataset.itemId;
      const item = id && BY_ID.get(id);
      if (!item) return;
      const def = t(item.labelKey);
      if (!text || text === def) { delete working.labels[id]; el.textContent = def; }
      else { working.labels[id] = text; el.textContent = text; }
      persist();
    } else if (el.matches('[data-section-title]')) {
      const key = el.closest('[data-section-key]')?.dataset.sectionKey;
      const sec = working.sections.find(s => s.key === key);
      if (!sec) return;
      const defKey = GROUP_TITLE_KEY[key];
      if (defKey) {
        const def = t(defKey);
        if (!text || text === def) { sec.title = null; el.textContent = def; }
        else { sec.title = text; el.textContent = text; }
      } else {
        const val = text || t('admin.navEdit.newSection');
        sec.title = val; el.textContent = val;
      }
      persist();
    }
  }

  // ── structural ops ──────────────────────────────────────────────────────────
  function moveItem(id, targetKey, index) {
    for (const s of working.sections) {
      const i = s.items.indexOf(id);
      if (i !== -1) s.items.splice(i, 1);
    }
    const target = working.sections.find(s => s.key === targetKey);
    if (!target) return;
    target.items.splice(Math.max(0, Math.min(index, target.items.length)), 0, id);
    persist();
  }

  function moveSection(key, index) {
    const cur = working.sections.findIndex(s => s.key === key);
    if (cur === -1) return;
    const [sec] = working.sections.splice(cur, 1);
    working.sections.splice(Math.max(0, Math.min(index, working.sections.length)), 0, sec);
    persist();
  }

  function addSection() {
    const key = 'custom-' + Date.now().toString(36);
    working.sections.push({ key, title: t('admin.navEdit.newSection'), items: [] });
    persist();
    renderNav();
    const el = navEl.querySelector(`[data-section-key="${key}"] [data-section-title]`);
    if (el) { el.focus(); selectAllText(el); }
  }

  function deleteSection(key) {
    if (!key || GROUP_TITLE_KEY[key]) return;     // never delete a default group
    working.sections = working.sections.filter(s => s.key !== key);
    working = reconcile(working);                 // re-home orphaned items to defaults
    persist();
    renderNav();
  }

  function resetLayout() {
    clearNavLayout();
    working = reconcile(null);
    renderNav();
    showToast(t('admin.navEdit.resetDone'), 'success');
  }

  // ── drag & drop ─────────────────────────────────────────────────────────────
  function clearIndicator() {
    if (indicator.parentNode) indicator.parentNode.removeChild(indicator);
  }
  function cleanupDrag() {
    navEl.querySelectorAll('.is-dragging').forEach(el => el.classList.remove('is-dragging'));
    clearIndicator();
    drag = null;
  }
  function positionItemIndicator(e) {
    const section = e.target.closest('[data-section-key]');
    const list = section && section.querySelector('[data-section-items]');
    if (!list) { clearIndicator(); return; }
    const row = e.target.closest('[data-item-id]');
    if (row && row.parentNode === list) {
      const rect = row.getBoundingClientRect();
      list.insertBefore(indicator, (e.clientY > rect.top + rect.height / 2) ? row.nextSibling : row);
    } else {
      list.appendChild(indicator);
    }
  }
  function positionSectionIndicator(e) {
    const grp = e.target.closest('[data-section-key]');
    if (grp && grp.parentNode === navEl) {
      const rect = grp.getBoundingClientRect();
      navEl.insertBefore(indicator, (e.clientY > rect.top + rect.height / 2) ? grp.nextSibling : grp);
    } else {
      navEl.appendChild(indicator);
    }
  }
  // Index = number of like siblings before the indicator, excluding the dragged
  // element itself (it's still in the DOM during drop).
  function indicatorIndex(selector, datasetKey, excludeVal) {
    let index = 0;
    for (let n = indicator.previousSibling; n; n = n.previousSibling) {
      if (n.nodeType === 1 && n.matches(selector) && n.dataset[datasetKey] !== excludeVal) index++;
    }
    return index;
  }
  function dropItem() {
    const list = indicator.parentNode;
    if (!list || !list.matches || !list.matches('[data-section-items]')) return;
    const targetKey = list.closest('[data-section-key]')?.dataset.sectionKey;
    if (!targetKey) return;
    moveItem(drag.id, targetKey, indicatorIndex('[data-item-id]', 'itemId', drag.id));
  }
  function dropSection() {
    if (indicator.parentNode !== navEl) return;
    moveSection(drag.key, indicatorIndex('[data-section-key]', 'sectionKey', drag.key));
  }

  // ── wiring — delegated on navEl + the persistent toggle, so listeners survive
  //    the per-mutation innerHTML re-render without re-binding each row ──────────
  toggle?.addEventListener('click', () => {
    editing = !editing;
    aside.classList.toggle('admin-sidebar--editing', editing);
    toggle.setAttribute('aria-pressed', editing ? 'true' : 'false');
    if (toggleLabel) toggleLabel.textContent = editing ? t('admin.navEdit.done') : t('admin.navEdit.edit');
    if (editing) working = reconcile(loadNavLayout());
    renderNav();
  });

  navEl.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-route]');
    if (a) { aside.classList.remove('is-open'); return; } // let the router navigate
    if (!editing) return;
    if (e.target.closest('[data-nav-add-section]')) { addSection(); return; }
    if (e.target.closest('[data-nav-reset]'))       { resetLayout(); return; }
    const del = e.target.closest('[data-section-delete]');
    if (del) { deleteSection(del.closest('[data-section-key]')?.dataset.sectionKey); }
  });

  navEl.addEventListener('keydown', (e) => {
    if (!editing) return;
    const ce = e.target.closest('[contenteditable]');
    if (ce && e.key === 'Enter') { e.preventDefault(); ce.blur(); }
  });

  navEl.addEventListener('focusout', (e) => {
    if (!editing) return;
    const ce = e.target.closest('[data-item-label], [data-section-title]');
    if (ce) commitRename(ce);
  });

  navEl.addEventListener('dragstart', (e) => {
    if (!editing) return;
    const handle = e.target.closest('[data-drag-handle]');
    const secHandle = e.target.closest('[data-section-handle]');
    if (handle) {
      const row = handle.closest('[data-item-id]');
      if (!row) return;
      drag = { kind: 'item', id: row.dataset.itemId };
      row.classList.add('is-dragging');
    } else if (secHandle) {
      const grp = secHandle.closest('[data-section-key]');
      if (!grp) return;
      drag = { kind: 'section', key: grp.dataset.sectionKey };
      grp.classList.add('is-dragging');
    } else {
      return;
    }
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', drag.id || drag.key); } catch { /* legacy */ }
  });

  navEl.addEventListener('dragover', (e) => {
    if (!editing || !drag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (drag.kind === 'item') positionItemIndicator(e);
    else positionSectionIndicator(e);
  });

  navEl.addEventListener('drop', (e) => {
    if (!editing || !drag) return;
    e.preventDefault();
    if (drag.kind === 'item') dropItem();
    else dropSection();
    cleanupDrag();
    renderNav();
  });

  navEl.addEventListener('dragend', () => cleanupDrag());

  // Mobile drawer: toggle button opens it; the back link + nav anchors close it
  // (nav anchors handled in the delegated click above).
  menuBtn.addEventListener('click', () => {
    const open = aside.classList.toggle('is-open');
    menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  shell.querySelector('.admin-sidebar__back')?.addEventListener('click', () => aside.classList.remove('is-open'));

  renderNav();

  // Pull the per-admin layout from the DB once per page load; this shell's
  // re-render is the hook a late-arriving hydrate calls when it differs.
  if (canEdit) {
    setNavRerender(renderNav);
    hydrateNavLayout();
  }

  return shell;
}

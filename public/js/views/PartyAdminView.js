import { isAuthenticated, isAdmin, canEdit, adminUpdateUser, adminApproveUser } from '../services/auth.js';
import { getCsrfHeaders } from '../utils/api.js';
import { showToast }    from '../components/Toast.js';
import { escHtml }      from '../utils/escHtml.js';
import { t, href } from '../i18n/i18n.js';
import { PartyAdminStatModal } from '../components/PartyAdminStatModal.js';

export class PartyAdminView {
  constructor() {
    this._el = null;
  }

  async render() {
    const el = document.createElement('div');
    el.className = 'view party-admin-view';
    this._el = el;

    if (!isAuthenticated() || !canEdit()) {
      el.innerHTML = `<div class="party-error"><p>${t('party.admin.accessRequired')}</p></div>`;
      return el;
    }

    el.innerHTML = `<div class="party-admin-loading">${t('form.loading')}</div>`;

    try {
      await this._loadAndRender();
    } catch (err) {
      el.innerHTML = `<div class="party-error"><p>${t('party.admin.loadError')}</p></div>`;
    }

    return el;
  }

  async _loadAndRender() {
    const [rsvpsRes, infoRes, pendingRes, healthRes, guestsRes, logisticsRes, todosRes] = await Promise.all([
      fetch('/api/v1/party/rsvps',            { credentials: 'include' }),
      fetch('/api/v1/party/info',             { credentials: 'include' }),
      fetch('/api/v1/party/pending-requests', { credentials: 'include' }),
      fetch('/api/v1/admin/email-health',     { credentials: 'include' }),
      fetch('/api/v1/party/invited-guests',   { credentials: 'include' }),
      fetch('/api/v1/party/logistics',        { credentials: 'include' }),
      fetch('/api/v1/party/todos',            { credentials: 'include' }),
    ]);
    const rsvps     = await rsvpsRes.json();
    const info      = await infoRes.json();
    const pending   = pendingRes.ok ? await pendingRes.json() : [];
    const health    = healthRes.ok ? await healthRes.json() : null;
    const guests    = guestsRes.ok ? await guestsRes.json() : [];
    const logistics = logisticsRes.ok ? await logisticsRes.json() : [];
    const todos     = todosRes.ok ? await todosRes.json() : [];

    this._rsvps           = Array.isArray(rsvps) ? rsvps : [];
    this._pendingRequests = Array.isArray(pending) ? pending : [];
    this._emailHealth   = health;
    this._invitedGuests = Array.isArray(guests) ? guests : [];
    this._logistics     = Array.isArray(logistics) ? logistics : [];
    this._todos         = Array.isArray(todos) ? todos : [];
    this._peopleNames   = this._collectPeopleNames();
    const parsed   = (() => { try { return JSON.parse(info.rsvp_form || 'null'); } catch { return null; } })();
    this._rsvpForm = Array.isArray(parsed) ? parsed : [];

    // Sort state is session-only — each fresh load starts on the default view.
    this._guestSort = null;
    this._rsvpSort  = null;

    this._el.innerHTML = this._renderAll();
    this._bind();
  }

  _renderAll() {
    return `
      <div class="party-admin">
        <div class="party-admin__header">
          <h1 class="party-admin__title">🎂 ${t('party.admin.title')}</h1>
          ${this._renderHealthPill()}
          <a href="${href('/party')}" class="lol-btn lol-btn--ghost">← ${t('party.backToParty')}</a>
        </div>

        ${this._renderPendingRequests()}
        ${this._renderAcceptedAndPending()}
        ${this._renderDeclinedGuests()}
        ${this._renderLogistics()}
        ${this._renderTodoSection()}
        ${this._renderOwnerInviteSection()}
        ${this._renderStats()}
        ${this._renderAnswerTallies()}
        ${this._renderHelpersList()}
        ${this._renderRsvpTable()}
        ${this._renderGuestListExport()}
      </div>`;
  }

  // ── Sort helpers (shared by Accepted+Pending and Total RSVPs tables) ──

  // Sort rows by an accessor function. null / undefined / '' always sink to
  // the bottom regardless of direction so empty cells don't crowd the top.
  _sortRows(rows, accessor, dir, type = 'string') {
    const mul = dir === 'desc' ? -1 : 1;
    const cmpVals = (a, b) => {
      if (type === 'number') {
        const an = Number(a), bn = Number(b);
        if (Number.isNaN(an) || Number.isNaN(bn)) return String(a).localeCompare(String(b));
        return an - bn;
      }
      if (type === 'date')    return new Date(a) - new Date(b);
      if (type === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0);
      return String(a).localeCompare(String(b));
    };
    return [...rows].sort((ra, rb) => {
      const va = accessor(ra);
      const vb = accessor(rb);
      const aEmpty = va == null || va === '';
      const bEmpty = vb == null || vb === '';
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      return mul * cmpVals(va, vb);
    });
  }

  // Render a sortable <th>. The arrow is always present so column widths
  // don't jump as the user clicks around — opacity makes it visible only
  // when this is the active sort column.
  _sortableTh(field, type, label, currentSort) {
    const isActive = currentSort?.field === field;
    const arrow    = isActive && currentSort.dir === 'desc' ? '▼' : '▲';
    const ariaSort = !isActive ? 'none' : (currentSort.dir === 'asc' ? 'ascending' : 'descending');
    const cls      = 'party-admin__th--sortable' + (isActive ? ' party-admin__th--active' : '');
    return `<th data-sort-field="${escHtml(field)}" data-sort-type="${escHtml(type)}" class="${cls}" aria-sort="${ariaSort}" tabindex="0">${label}<span class="party-admin__sort-arrow" aria-hidden="true">${arrow}</span></th>`;
  }

  // Click cycle: not-sorted → asc → desc → cleared (back to default).
  _cycleSort(current, field) {
    if (current?.field !== field) return { field, dir: 'asc' };
    if (current.dir === 'asc')    return { field, dir: 'desc' };
    return null;
  }

  // Top section: everyone still in play — going, maybe, or hasn't replied.
  // Sort order: going → maybe → waiting so the most-committed guests bubble
  // up when scanning the list. Pills above the table show the breakdown and
  // host the "Email accepted + maybe" action.
  _renderAcceptedAndPending() {
    const guests = (this._invitedGuests || []).filter(g => g.rsvp_status !== 'declined');
    const showRevoke = isAdmin();

    // Default sort (no column clicked): status priority then alphabetical.
    // User-applied column sort takes over when this._guestSort is set.
    const sorted = this._guestSort
      ? this._sortRows(
          guests,
          (g) => this._guestSortValue(g, this._guestSort.field),
          this._guestSort.dir,
          this._guestSortType(this._guestSort.field),
        )
      : (() => {
          const order = { going: 0, maybe: 1, waiting: 2 };
          const byName = (a, b) =>
            (a.display_name || a.username || '').localeCompare(b.display_name || b.username || '');
          return [...guests].sort((a, b) => {
            const d = (order[a.rsvp_status] ?? 9) - (order[b.rsvp_status] ?? 9);
            return d !== 0 ? d : byName(a, b);
          });
        })();

    const counts = guests.reduce((acc, g) => {
      acc[g.rsvp_status] = (acc[g.rsvp_status] || 0) + 1;
      return acc;
    }, {});

    // Companion pills count going + maybe guests only — waiting guests
    // haven't answered the form, and declined guests are filtered out above.
    const companions = guests.reduce((acc, g) => {
      if (g.rsvp_status !== 'going' && g.rsvp_status !== 'maybe') return acc;
      const f = this._companionFlags(g);
      if (f.spouse) acc.spouse += 1;
      if (f.kids) acc.kids += 1;
      return acc;
    }, { spouse: 0, kids: 0 });

    const colSpan = this._invitedGuestColSpan(showRevoke);
    const rows = sorted.length
      ? sorted.map(g => this._renderInvitedGuestRow(g, showRevoke)).join('')
      : `<tr><td colspan="${colSpan}" class="party-empty">${t('party.admin.noGuests')}</td></tr>`;

    // Email button only renders for admins who actually have someone to email.
    const emailableCount = (counts.going || 0) + (counts.maybe || 0);
    const emailBtn = (showRevoke && emailableCount > 0)
      ? `<button type="button" class="lol-btn lol-btn--primary lol-btn--sm" id="party-admin-email-going-btn">${t('party.admin.emailGoingBtn')}</button>`
      : '';

    return `
      <section class="party-admin__section" id="party-admin-accepted-pending">
        <h2 class="party-admin__section-title">${t('party.admin.acceptedAndPending', { n: guests.length })}</h2>
        <div class="party-admin__invited-toolbar">
          <p class="party-admin__invited-summary">
            <span class="party-admin__pill party-admin__pill--going">✅ ${t('party.admin.statusGoing')}: ${counts.going || 0}</span>
            <span class="party-admin__pill party-admin__pill--spouse">💑 ${t('party.admin.pillSpouses')}: ${companions.spouse}</span>
            <span class="party-admin__pill party-admin__pill--kids">🧒 ${t('party.admin.pillKids')}: ${companions.kids}</span>
            <span class="party-admin__pill party-admin__pill--maybe">🤔 ${t('party.admin.statusMaybe')}: ${counts.maybe || 0}</span>
            <span class="party-admin__pill party-admin__pill--waiting">⏳ ${t('party.admin.statusPending')}: ${counts.waiting || 0}</span>
          </p>
          ${emailBtn}
        </div>
        <div class="party-admin__table-wrap">
          <table class="party-admin__table party-admin__table--invited" aria-label="${t('party.admin.acceptedAndPending', { n: '' }).trim()}">
            <thead>
              <tr>
                ${this._sortableTh('username', 'string', t('adminUsers.username'), this._guestSort)}
                ${this._sortableTh('email',    'string', t('adminUsers.email'),    this._guestSort)}
                ${this._sortableTh('status',   'number', t('adminOrders.status'),  this._guestSort)}
                ${this._sortableTh('bringing', 'string', t('party.admin.bringing'),this._guestSort)}
                ${this._sortableTh('rsvpdAt',  'date',   t('party.admin.rsvpdAt'), this._guestSort)}
                ${showRevoke ? '<th aria-label="Actions"></th>' : ''}
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      </section>`;
  }

  // Bottom section: declined guests, wrapped in a collapsed <details> so the
  // host can glance past them. Returns empty string when nobody has declined
  // so the empty section doesn't clutter the page.
  _renderDeclinedGuests() {
    const declined = (this._invitedGuests || []).filter(g => g.rsvp_status === 'declined');
    if (declined.length === 0) return '';
    const showRevoke = isAdmin();

    const byName = (a, b) =>
      (a.display_name || a.username || '').localeCompare(b.display_name || b.username || '');
    const sorted = [...declined].sort(byName);

    const rows = sorted.map(g => this._renderInvitedGuestRow(g, showRevoke)).join('');

    return `
      <section class="party-admin__section">
        <details class="party-admin__declined-details">
          <summary class="party-admin__declined-summary">
            <span class="party-admin__pill party-admin__pill--declined">❌ ${t('party.admin.declinedGuests', { n: declined.length })}</span>
          </summary>
          <div class="party-admin__table-wrap party-admin__declined-table-wrap">
            <table class="party-admin__table party-admin__table--invited" aria-label="${t('party.admin.declinedGuests', { n: '' }).trim()}">
              <thead>
                <tr>
                  <th>${t('adminUsers.username')}</th>
                  <th>${t('adminUsers.email')}</th>
                  <th>${t('adminOrders.status')}</th>
                  <th>${t('party.admin.bringing')}</th>
                  <th>${t('party.admin.rsvpdAt')}</th>
                  ${showRevoke ? '<th aria-label="Actions"></th>' : ''}
                </tr>
              </thead>
              <tbody>
                ${rows}
              </tbody>
            </table>
          </div>
        </details>
      </section>`;
  }

  _invitedGuestColSpan(showRevoke) {
    // Name, Email, Status, Bringing, RSVP'd at (+ Actions if admin)
    return showRevoke ? 6 : 5;
  }

  _guestSortValue(g, field) {
    switch (field) {
      case 'username': return g.display_name || g.username || '';
      case 'email':    return g.email || '';
      case 'status': {
        // Same priority as the default sort: going first, then maybe, waiting.
        const order = { going: 0, maybe: 1, waiting: 2 };
        return order[g.rsvp_status] ?? 9;
      }
      case 'bringing': {
        const b = this._bringingFor(g);
        return b === '—' ? null : b;
      }
      case 'rsvpdAt':  return g.rsvp_updated_at;
      default:         return null;
    }
  }

  _guestSortType(field) {
    if (field === 'status')  return 'number';
    if (field === 'rsvpdAt') return 'date';
    return 'string';
  }

  // Surface plus-one / family-member info from the RSVP form answers. The
  // regex is anchored at word boundaries so a generic field id like
  // "guest_message" doesn't accidentally bleed personal notes into the
  // Bringing column — only fields that clearly *name* this concept match.
  // Falls back to "—" so the layout stays consistent.
  _bringingFor(g) {
    const ans = g.rsvp_answers;
    if (!ans) return '—';
    const re = /^(plus[_-]?one|plus[_-]?ones|bringing|companions?|family|maki|fjölskylda|gestir)(_|$)/i;
    for (const [k, v] of Object.entries(ans)) {
      if (!re.test(k)) continue;
      if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
      if (v === false || v === 'false' || v === 'no' || v === 'nei') continue;
      const val = Array.isArray(v) ? v.map(escHtml).join(', ') : escHtml(String(v));
      return val;
    }
    return '—';
  }

  // Flags for the summary pills: does this guest bring a spouse and/or kids?
  // Reuses _bringingFor's key regex; values are matched loosely because the
  // option labels are admin-editable and locale-dependent ("Spouse / partner",
  // "Maki / partner", "Kids", "Börn").
  _companionFlags(g) {
    const ans = g.rsvp_answers;
    const flags = { spouse: false, kids: false };
    if (!ans) return flags;
    const keyRe = /^(plus[_-]?one|plus[_-]?ones|bringing|companions?|family|maki|fjölskylda|gestir)(_|$)/i;
    const spouseRe = /spouse|maki|partner/i;
    const kidsRe = /\bkids?\b|child|börn|barn/i;
    for (const [k, v] of Object.entries(ans)) {
      if (!keyRe.test(k)) continue;
      const vals = Array.isArray(v) ? v : [v];
      for (const val of vals) {
        if (typeof val !== 'string') continue;
        if (spouseRe.test(val)) flags.spouse = true;
        if (kidsRe.test(val)) flags.kids = true;
      }
    }
    return flags;
  }

  _renderInvitedGuestRow(g, showRevoke) {
    const name     = escHtml(g.display_name || g.username || '—');
    const email    = escHtml(g.email || '');
    const rsvpedAt = g.rsvp_updated_at
      ? new Date(g.rsvp_updated_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
      : '—';

    const statusHtml = {
      going:    `<span class="party-admin__status party-admin__status--going">✅ ${t('party.admin.statusGoing')}</span>`,
      maybe:    `<span class="party-admin__status party-admin__status--maybe">🤔 ${t('party.admin.statusMaybe')}</span>`,
      declined: `<span class="party-admin__status party-admin__status--declined">❌ ${t('party.admin.statusDeclined')}</span>`,
      waiting:  `<span class="party-admin__status party-admin__status--waiting">⏳ ${t('party.admin.statusPending')}</span>`,
    }[g.rsvp_status] || '—';

    const bringingHtml = this._bringingFor(g);

    // Detail row — full answer dump, hidden until row is clicked
    const detailFields = (this._rsvpForm || []).filter(f => !['heading','paragraph'].includes(f.type));
    const detailsHtml = g.rsvp_answers
      ? detailFields.map(f => {
          const a = g.rsvp_answers[f.id];
          if (a == null || (Array.isArray(a) && !a.length) || a === '') return '';
          const val = Array.isArray(a) ? a.map(escHtml).join(', ') : escHtml(String(a));
          return `<div><strong>${escHtml(f.label || f.id)}:</strong> ${val}</div>`;
        }).filter(Boolean).join('')
      : `<em class="party-admin__no-answers">${t('party.admin.hasntRsvpd')}</em>`;

    const colSpan = this._invitedGuestColSpan(showRevoke);
    const revokeCell = showRevoke
      ? `<td><button class="lol-btn lol-btn--ghost lol-btn--sm" data-revoke-user-id="${escHtml(g.id)}" data-revoke-user-name="${name}">${t('profile.revoke')}</button></td>`
      : '';

    return `
      <tr class="party-admin__invited-row" data-expand-guest="${escHtml(g.id)}">
        <td>${name}</td>
        <td>${email}</td>
        <td>${statusHtml}</td>
        <td class="party-admin__invited-bringing">${bringingHtml}</td>
        <td>${rsvpedAt}</td>
        ${revokeCell}
      </tr>
      <tr class="party-admin__invited-details" data-guest-details="${escHtml(g.id)}" hidden>
        <td colspan="${colSpan}">
          <div class="party-admin__invited-detail-box">${detailsHtml}</div>
        </td>
      </tr>`;
  }

  // The three logistics tables. Internal keys must match the DB CHECK
  // constraint (058) and the controller's LOGISTICS_CATEGORIES.
  _logisticsCategories() {
    return [
      { key: 'food',   label: t('party.admin.logisticsCatFood'),   icon: '🍽️' },
      { key: 'drinks', label: t('party.admin.logisticsCatDrinks'), icon: '🥤' },
      { key: 'other',  label: t('party.admin.logisticsCatOther'),  icon: '📦' },
    ];
  }

  _renderLogistics() {
    const all = this._logistics || [];
    const total    = all.length;
    const bought   = all.filter(i => i.bought).length;
    const atVenue  = all.filter(i => i.at_venue).length;

    return `
      <section class="party-admin__section" id="party-admin-logistics">
        <h2 class="party-admin__section-title">🛒 ${t('party.admin.logistics')}</h2>
        <p class="party-admin__logistics-help">${t('party.admin.logisticsHelp')}</p>
        <p class="party-admin__invited-summary">
          <span class="party-admin__pill">${t('party.admin.logisticsTotal', { n: total })}</span>
          <span class="party-admin__pill party-admin__pill--waiting">${t('party.admin.logisticsBoughtCount', { n: bought })}</span>
          <span class="party-admin__pill party-admin__pill--going">${t('party.admin.logisticsAtVenueCount', { n: atVenue })}</span>
        </p>
        <div class="party-admin__logistics-toolbar">
          <label class="party-admin__logistics-hide-bought">
            <input type="checkbox" id="party-admin-logistics-hide-bought"
                   ${this._hideBought ? 'checked' : ''}
                   aria-label="${t('party.admin.logisticsHideBoughtAria')}" />
            ${t('party.admin.logisticsHideBought')}
          </label>
          <button type="button" class="lol-btn lol-btn--ghost lol-btn--sm"
                  id="party-admin-logistics-all-at-venue"
                  ${total === 0 ? 'disabled' : ''}>
            ${t('party.admin.logisticsAllAtVenue')}
          </button>
        </div>
        ${this._logisticsCategories().map(c => this._renderLogisticsCategory(c)).join('')}
      </section>`;
  }

  // One category = one heading + add-form + table. Items are filtered to this
  // category and ordered by sort_order (then id) so the slice renders stably
  // even though sort_order is global across all three tables.
  _renderLogisticsCategory(cat) {
    const all = (this._logistics || []).filter(i => (i.category || 'other') === cat.key);
    const sorted = [...all].sort((a, b) => (a.sort_order - b.sort_order) || (a.id - b.id));

    // Hide-bought is session-only (lives on `this`, not localStorage). Filters
    // the table; the summary pills always reflect true totals.
    const visible = this._hideBought ? sorted.filter(i => !i.bought) : sorted;

    const emptyMsg = (this._hideBought && all.length > 0 && visible.length === 0)
      ? t('party.admin.logisticsAllBoughtEmpty')
      : t('party.admin.logisticsNoItems');

    const rows = visible.length
      ? visible.map(i => this._renderLogisticsRow(i)).join('')
      : `<tr><td colspan="7" class="party-empty">${emptyMsg}</td></tr>`;

    return `
      <div class="party-admin__logistics-group">
        <h3 class="party-admin__logistics-cat-title">
          ${cat.icon} ${escHtml(cat.label)}
          <span class="party-admin__logistics-cat-count">${all.length}</span>
        </h3>
        <form class="party-admin__logistics-add" data-logistics-add="${escHtml(cat.key)}" novalidate>
          <input type="text" class="lol-input party-admin__logistics-add-name"
                 placeholder="${escHtml(t('party.admin.logisticsNamePh'))}"
                 maxlength="200"
                 aria-label="${t('party.admin.logisticsItem')}" />
          <input type="text" class="lol-input party-admin__logistics-qty party-admin__logistics-add-qty"
                 placeholder="${escHtml(t('party.admin.logisticsQtyPh'))}"
                 maxlength="100"
                 aria-label="${t('party.admin.logisticsQty')}" />
          <input type="text" class="lol-input party-admin__logistics-assigned party-admin__logistics-add-assigned"
                 placeholder="${escHtml(t('party.admin.logisticsAssignedPh'))}"
                 maxlength="100"
                 aria-label="${t('party.admin.logisticsAssignedTo')}" />
          <button type="submit" class="lol-btn lol-btn--primary">${t('party.admin.logisticsAdd')}</button>
          <span class="party-admin__logistics-status" data-logistics-status="${escHtml(cat.key)}" aria-live="polite"></span>
        </form>
        <div class="party-admin__table-wrap">
          <table class="party-admin__table" aria-label="${escHtml(cat.label)}">
            <thead>
              <tr>
                <th aria-label="${t('party.admin.logisticsReorderHandle')}"></th>
                <th>${t('party.admin.logisticsItem')}</th>
                <th>${t('party.admin.logisticsQty')}</th>
                <th>${t('party.admin.logisticsAssignedTo')}</th>
                <th>${t('party.admin.logisticsBought')}</th>
                <th>${t('party.admin.logisticsAtVenue')}</th>
                <th aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody class="party-admin__logistics-tbody" data-logistics-category="${escHtml(cat.key)}">
              ${rows}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  _renderLogisticsRow(item) {
    const id   = String(item.id);
    const name = escHtml(item.name || '');
    const qty  = escHtml(item.quantity || '');
    const to   = escHtml(item.assigned_to || '');
    const rowClasses = [
      item.bought   ? 'party-admin__logistics-row--bought'   : '',
      item.at_venue ? 'party-admin__logistics-row--at-venue' : '',
    ].filter(Boolean).join(' ');

    return `
      <tr data-logistics-row="${escHtml(id)}" data-category="${escHtml(item.category || 'other')}" class="${rowClasses}" draggable="true">
        <td class="party-admin__logistics-handle"
            title="${t('party.admin.logisticsReorderHandle')}"
            aria-label="${t('party.admin.logisticsReorderHandle')}">⋮⋮</td>
        <td>
          <input type="text" class="party-admin__logistics-cell-input"
                 data-logistics-id="${escHtml(id)}" data-field="name"
                 value="${name}" maxlength="200" required
                 aria-label="${t('party.admin.logisticsItem')}" />
        </td>
        <td>
          <input type="text" class="party-admin__logistics-cell-input"
                 data-logistics-id="${escHtml(id)}" data-field="quantity"
                 value="${qty}" maxlength="100" placeholder="—"
                 aria-label="${t('party.admin.logisticsQty')}" />
        </td>
        <td>
          <input type="text" class="party-admin__logistics-cell-input"
                 data-logistics-id="${escHtml(id)}" data-field="assigned_to"
                 value="${to}" maxlength="100" placeholder="—"
                 aria-label="${t('party.admin.logisticsAssignedTo')}" />
        </td>
        <td class="party-admin__logistics-checkcell">
          <input type="checkbox" data-logistics-id="${escHtml(id)}" data-field="bought"
                 ${item.bought ? 'checked' : ''}
                 aria-label="${t('party.admin.logisticsBought')}" />
        </td>
        <td class="party-admin__logistics-checkcell">
          <input type="checkbox" data-logistics-id="${escHtml(id)}" data-field="at_venue"
                 ${item.at_venue ? 'checked' : ''}
                 aria-label="${t('party.admin.logisticsAtVenue')}" />
        </td>
        <td class="party-admin__logistics-actions">
          <button type="button" class="lol-btn lol-btn--ghost lol-btn--sm"
                  data-logistics-delete="${escHtml(id)}"
                  data-logistics-name="${name}">
            ${t('party.admin.logisticsDelete')}
          </button>
        </td>
      </tr>`;
  }

  _renderHealthPill() {
    const h = this._emailHealth;
    if (!h) return '';

    const issues = [];
    if (!h.resendConfigured) issues.push('RESEND_API_KEY is not set');
    if (!h.anyAdminVerified) issues.push('No admin email is verified — notifications would silently drop');
    if (!h.fromAddressSet)   issues.push(`EMAIL_FROM is not set (using default "${h.fromAddress}")`);

    const healthy = h.healthy;
    const label   = healthy ? '📧 Notifications: ON' : '⚠️ Notifications OFF';
    const tooltip = healthy
      ? `Resend configured. Verified admin inboxes: ${h.adminEmails.filter(a => a.verified).length}`
      : issues.join('; ');

    return `
      <span class="party-admin__health-pill party-admin__health-pill--${healthy ? 'ok' : 'bad'}"
            title="${escHtml(tooltip)}" role="status" tabindex="0">
        ${escHtml(label)}
      </span>`;
  }

  // The "send the party info email" queue: guests who signed up (access is
  // auto-granted) but haven't received the welcome/info email yet, plus
  // manual-review re-requests (approval_status='pending' — a guest whose
  // access was previously removed) which get a badge. Hidden when empty.
  // Distinct from the RSVP "pending" bucket above.
  _renderPendingRequests() {
    const pending = this._pendingRequests || [];
    if (!pending.length) return '';
    const rows = pending.map(p => `
      <li class="party-admin__pending-row" data-pending-id="${escHtml(p.id)}">
        <div class="party-admin__pending-info">
          <span class="party-admin__pending-name">${escHtml(p.display_name || p.username || '—')}</span>
          <span class="party-admin__pending-email">${escHtml(p.email)}</span>
          ${p.approval_status === 'pending'
            ? `<span class="party-admin__pending-badge">${t('party.admin.pendingNeedsApproval')}</span>`
            : ''}
        </div>
        <div class="party-admin__pending-actions">
          <button type="button" class="lol-btn lol-btn--primary" data-approve="${escHtml(p.id)}">${t('party.admin.approve')}</button>
          <button type="button" class="lol-btn lol-btn--ghost" data-decline="${escHtml(p.id)}">${t('party.admin.decline')}</button>
        </div>
      </li>`).join('');
    return `
      <section class="party-admin__section party-admin__pending">
        <h2 class="party-admin__section-title">${t('party.admin.pendingRequests', { n: pending.length })}</h2>
        <ul class="party-admin__pending-list">${rows}</ul>
      </section>`;
  }

  // Owner-initiated invites: paste emails you already have (one per line, or
  // "Name <email>"); each becomes a pre-approved guest and gets a magic-link
  // invite immediately.
  _renderOwnerInviteSection() {
    return `
      <section class="party-admin__section party-admin__invite">
        <h2 class="party-admin__section-title">${t('party.admin.ownerInviteTitle')}</h2>
        <p class="party-admin__invite-help">${t('party.admin.ownerInviteHelp')}</p>
        <form class="party-admin__invite-form" id="party-admin-owner-invite-form">
          <textarea id="party-admin-owner-invite-input" class="lol-input" rows="4"
                    placeholder="${escHtml(t('party.admin.ownerInvitePlaceholder'))}"
                    aria-label="${t('party.admin.ownerInviteTitle')}"></textarea>
          <div class="party-admin__invite-actions">
            <button type="submit" class="lol-btn lol-btn--primary">${t('party.admin.ownerInviteSend')}</button>
            <span class="party-admin__invite-status" id="party-admin-owner-invite-status" aria-live="polite"></span>
          </div>
        </form>
      </section>`;
  }

  _renderStats() {
    const rsvps = this._rsvps;
    const headcount = rsvps.filter(r => r.attending).length;

    // Try to derive day/evening/both from a radio-group field that looks like attendance timing
    const attendField = this._rsvpForm.find(f =>
      f.type === 'radio-group' &&
      (f.id === 'attend_when' || /attend|when|day|evening/i.test(f.label || ''))
    );

    let breakdownCards = '';
    if (attendField) {
      const tally = {};
      (attendField.options || []).forEach(opt => { tally[opt] = 0; });
      rsvps.forEach(r => {
        const a = r.answers?.[attendField.id];
        if (typeof a === 'string') tally[a] = (tally[a] || 0) + 1;
      });
      // pickMatch returns the first option matching `regex` along with its count,
      // so the rendered card carries the actual option string for click-to-filter.
      const pickMatch = (regex) => {
        for (const [opt, count] of Object.entries(tally)) {
          if (regex.test(opt)) return { opt, count };
        }
        return { opt: null, count: 0 };
      };
      const breakdownCard = (match, labelHtml, modifierClass = '') => {
        const dataAttrs = match.opt
          ? `data-stat-key="field:${escHtml(attendField.id)}:${escHtml(match.opt)}" data-stat-field="${escHtml(attendField.id)}" data-stat-value="${escHtml(match.opt)}" data-stat-multi="false"`
          : `data-stat-key="empty"`;
        const cls = 'party-admin__stat' + (modifierClass ? ' ' + modifierClass : '');
        return `
        <button type="button" class="${cls}" ${dataAttrs}>
          <span class="party-admin__stat-num">${match.count}</span>
          <span class="party-admin__stat-label">${labelHtml}</span>
        </button>`;
      };
      const day      = pickMatch(/day/i);
      const evening  = pickMatch(/evening/i);
      const both     = pickMatch(/both|all day/i);
      const declined = pickMatch(/can'?t|sorry|no/i);
      breakdownCards = [
        breakdownCard(day,      `☀️ ${t('party.admin.dayOnly')}`),
        breakdownCard(evening,  `🌙 ${t('party.admin.eveningOnly')}`),
        breakdownCard(both,     `🎉 ${t('party.admin.both')}`),
        breakdownCard(declined, t('party.admin.statusDeclined'), 'party-admin__stat--muted'),
      ].join('');
    }

    return `
      <section class="party-admin__section">
        <h2 class="party-admin__section-title">${t('party.admin.stats')}</h2>
        <div class="party-admin__stats">
          <button type="button" class="party-admin__stat" data-stat-key="all">
            <span class="party-admin__stat-num">${rsvps.length}</span>
            <span class="party-admin__stat-label">${t('party.admin.rsvpsSubmitted')}</span>
          </button>
          ${breakdownCards}
          <button type="button" class="party-admin__stat party-admin__stat--gold" data-stat-key="headcount">
            <span class="party-admin__stat-num">${headcount}</span>
            <span class="party-admin__stat-label">${t('party.admin.totalHeadcount')}</span>
          </button>
        </div>
      </section>`;
  }

  _dataFields() {
    // Fields that actually carry answer data (exclude pure layout)
    return this._rsvpForm.filter(f => !['heading', 'paragraph'].includes(f.type));
  }

  _formatAnswer(val) {
    if (val == null) return '—';
    if (Array.isArray(val)) return val.length ? val.map(escHtml).join(', ') : '—';
    return escHtml(String(val));
  }

  _renderRsvpTable() {
    const fields = this._dataFields();
    const colCount = 2 + fields.length; // Name + Email + one per field

    const sortedRsvps = this._rsvpSort
      ? this._sortRows(
          this._rsvps,
          (r) => this._rsvpSortValue(r, this._rsvpSort.field),
          this._rsvpSort.dir,
          this._rsvpSortType(this._rsvpSort.field, fields),
        )
      : this._rsvps;

    const rows = sortedRsvps.map(r => {
      const answers = r.answers || {};
      const fieldCells = fields.map(f => `<td>${this._formatAnswer(answers[f.id])}</td>`).join('');
      return `
        <tr>
          <td>${escHtml(r.display_name || r.username)}</td>
          <td>${escHtml(r.email)}</td>
          ${fieldCells}
        </tr>`;
    }).join('') || `<tr><td colspan="${colCount}" class="party-empty">${t('party.admin.noRsvps')}</td></tr>`;

    const fieldHeaders = fields.map(f =>
      this._sortableTh(`field:${f.id}`, this._rsvpFieldType(f), escHtml(f.label || f.id), this._rsvpSort)
    ).join('');

    return `
      <section class="party-admin__section" id="party-admin-total-rsvps">
        <h2 class="party-admin__section-title">${t('party.admin.totalRsvps')}</h2>
        <div class="party-admin__table-wrap">
          <table class="party-admin__table" aria-label="${t('party.admin.totalRsvps')}">
            <thead>
              <tr>
                ${this._sortableTh('username', 'string', t('adminUsers.username'), this._rsvpSort)}${this._sortableTh('email', 'string', t('adminUsers.email'), this._rsvpSort)}${fieldHeaders}
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      </section>`;
  }

  _rsvpFieldType(f) {
    switch (f?.type) {
      case 'number':   return 'number';
      case 'date':     return 'date';
      case 'checkbox': return 'boolean'; // single checkbox (not checkbox-group)
      default:         return 'string';
    }
  }

  _rsvpSortValue(r, field) {
    if (field === 'username') return r.display_name || r.username || '';
    if (field === 'email')    return r.email || '';
    if (field.startsWith('field:')) {
      const id = field.slice('field:'.length);
      const v  = r.answers?.[id];
      if (Array.isArray(v)) return v.length ? v.join(', ') : null;
      return v;
    }
    return null;
  }

  _rsvpSortType(field, fields) {
    if (field === 'username' || field === 'email') return 'string';
    if (field.startsWith('field:')) {
      const id = field.slice('field:'.length);
      const f  = fields.find(ff => ff.id === id);
      return this._rsvpFieldType(f);
    }
    return 'string';
  }

  _renderAnswerTallies() {
    // Tally all option-based fields (checkbox-group + radio-group)
    const groups = this._rsvpForm.filter(f =>
      (f.type === 'checkbox-group' || f.type === 'radio-group') && (f.options || []).length
    );
    if (!groups.length) return '';

    return groups.map(g => {
      const tally = {};
      (g.options || []).forEach(opt => { tally[opt] = 0; });
      this._rsvps.forEach(r => {
        const ans = r.answers?.[g.id];
        if (Array.isArray(ans)) {
          ans.forEach(v => { tally[v] = (tally[v] || 0) + 1; });
        } else if (typeof ans === 'string') {
          tally[ans] = (tally[ans] || 0) + 1;
        }
      });
      const multi = g.type === 'checkbox-group';
      const items = Object.entries(tally).map(([name, count]) => `
        <button type="button" class="party-admin__stat"
                data-stat-key="field:${escHtml(g.id)}:${escHtml(name)}"
                data-stat-field="${escHtml(g.id)}"
                data-stat-value="${escHtml(name)}"
                data-stat-multi="${multi}"
                aria-label="${escHtml(name)}: ${count}. ${t('party.admin.statClickHint')}">
          <span class="party-admin__stat-num">${count}</span>
          <span class="party-admin__stat-label">${escHtml(name)}</span>
        </button>`).join('');
      return `
        <section class="party-admin__section">
          <h2 class="party-admin__section-title">${escHtml(g.label || 'Tally')}</h2>
          <div class="party-admin__stats">${items}</div>
        </section>`;
    }).join('');
  }

  _renderHelpersList() {
    // Find the "helping" field and the conditional activity-details companion
    const helpField = this._rsvpForm.find(f =>
      f.type === 'checkbox-group' &&
      (f.id === 'helping' || /help/i.test(f.label || ''))
    );
    if (!helpField) return '';

    const activityField = this._rsvpForm.find(f =>
      f.type === 'textarea' &&
      (f.id === 'activity_details' || f.showIf?.fieldId === helpField.id)
    );

    const helpers = this._rsvps
      .map(r => ({
        rsvp:   r,
        offers: r.answers?.[helpField.id],
        detail: activityField ? r.answers?.[activityField.id] : null,
      }))
      .filter(h => Array.isArray(h.offers) && h.offers.length > 0);

    if (!helpers.length) return '';

    const cards = helpers.map(({ rsvp, offers, detail }) => {
      const chips = offers.map(o => `<span class="party-admin__chip">${escHtml(o)}</span>`).join('');
      const detailHtml = detail
        ? `<p class="party-admin__helper-detail"><strong>${t('party.admin.activity')}:</strong> ${escHtml(detail)}</p>`
        : '';
      return `
        <div class="party-admin__helper-card">
          <div class="party-admin__helper-name">${escHtml(rsvp.display_name || rsvp.username)}</div>
          <div class="party-admin__helper-email">${escHtml(rsvp.email)}</div>
          <div class="party-admin__helper-chips">${chips}</div>
          ${detailHtml}
        </div>`;
    }).join('');

    return `
      <section class="party-admin__section">
        <h2 class="party-admin__section-title">🙋 ${t('party.admin.helpers', { n: helpers.length })}</h2>
        <div class="party-admin__helpers">${cards}</div>
      </section>`;
  }

  _renderGuestListExport() {
    const fields = this._dataFields();
    const lines = this._rsvps.map(r => {
      const name = r.display_name || r.username;
      const parts = [`${name} (${r.email})`];
      for (const f of fields) {
        const a = r.answers?.[f.id];
        if (a == null || (Array.isArray(a) && !a.length) || a === '') continue;
        const val = Array.isArray(a) ? a.join(', ') : a;
        parts.push(`  ${f.label || f.id}: ${val}`);
      }
      return parts.join('\n');
    });

    return `
      <section class="party-admin__section">
        <h2 class="party-admin__section-title">${t('party.admin.guestListExport')}</h2>
        <p class="party-admin__export-note">${t('party.admin.exportNote', { n: this._rsvps.length })}</p>
        <textarea class="lol-input lol-textarea party-admin__export-area" readonly
                  aria-label="Guest list export">${lines.join('\n\n')}</textarea>
      </section>`;
  }

  _bind() {
    this._bindOwnerInvite();
    this._bindPendingRequests();
    this._bindInvitedGuests();
    this._bindGuestsSort();
    this._bindLogistics();
    this._bindTodos();
    this._bindStatCards();
    this._bindEmailGoing();
    this._bindRsvpSort();
  }

  _bindGuestsSort() {
    const thead = this._el.querySelector('#party-admin-accepted-pending thead');
    if (!thead) return;
    const handler = (e) => {
      const th = e.target.closest('th[data-sort-field]');
      if (!th || !thead.contains(th)) return;
      if (e.type === 'keydown') {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
      }
      this._guestSort = this._cycleSort(this._guestSort, th.dataset.sortField);
      this._rerenderAcceptedPending();
    };
    thead.addEventListener('click', handler);
    thead.addEventListener('keydown', handler);
  }

  _bindRsvpSort() {
    const thead = this._el.querySelector('#party-admin-total-rsvps thead');
    if (!thead) return;
    const handler = (e) => {
      const th = e.target.closest('th[data-sort-field]');
      if (!th || !thead.contains(th)) return;
      if (e.type === 'keydown') {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
      }
      this._rsvpSort = this._cycleSort(this._rsvpSort, th.dataset.sortField);
      this._rerenderRsvpTable();
    };
    thead.addEventListener('click', handler);
    thead.addEventListener('keydown', handler);
  }

  // Re-render only the Accepted+Pending section in place — keeps state in
  // other sections intact (open guest-detail rows, logistics drag state, etc).
  _rerenderAcceptedPending() {
    const old = this._el.querySelector('#party-admin-accepted-pending');
    if (!old) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = this._renderAcceptedAndPending();
    const next = tmp.firstElementChild;
    old.replaceWith(next);
    this._bindInvitedGuests();
    this._bindGuestsSort();
    this._bindEmailGoing();
  }

  // Same pattern for the Total RSVPs table.
  _rerenderRsvpTable() {
    const old = this._el.querySelector('#party-admin-total-rsvps');
    if (!old) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = this._renderRsvpTable();
    const next = tmp.firstElementChild;
    old.replaceWith(next);
    this._bindRsvpSort();
  }

  _bindEmailGoing() {
    const btn = this._el.querySelector('#party-admin-email-going-btn');
    if (!btn) return;
    btn.addEventListener('click', () => this._openEmailGoingModal());
  }

  _emailGoingRecipientCount(includeMaybe) {
    const guests = this._invitedGuests || [];
    return guests.filter(g =>
      g.rsvp_status === 'going' || (includeMaybe && g.rsvp_status === 'maybe')
    ).length;
  }

  _openEmailGoingModal() {
    // Lazy-create the overlay so we don't add a hidden DOM node on every page render.
    if (!this._emailOverlay) {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay party-admin__email-overlay';
      overlay.innerHTML = `<div class="modal party-admin__email-modal" role="dialog" aria-modal="true" aria-labelledby="party-admin-email-title" tabindex="-1"></div>`;
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) this._closeEmailGoingModal();
      });
      document.body.appendChild(overlay);
      this._emailOverlay = overlay;
      this._emailKeyHandler = (e) => {
        if (e.key === 'Escape') this._closeEmailGoingModal();
      };
    }

    const includeMaybeDefault = true;
    const initialCount = this._emailGoingRecipientCount(includeMaybeDefault);
    const modal = this._emailOverlay.querySelector('.modal');
    modal.innerHTML = `
      <button class="modal__close" type="button" aria-label="${t('common.close')}" data-email-close>&times;</button>
      <h2 class="modal__title" id="party-admin-email-title">${t('party.admin.emailGoingTitle')}</h2>
      <p class="modal__desc">${t('party.admin.emailGoingDesc')}</p>
      <form class="party-admin__email-form" id="party-admin-email-form">
        <label class="party-admin__email-field">
          <span>${t('party.admin.emailGoingSubjectLabel')}</span>
          <input type="text" class="lol-input" name="subject" maxlength="200"
                 placeholder="${escHtml(t('party.admin.emailGoingSubjectPh'))}" />
        </label>
        <label class="party-admin__email-field">
          <span>${t('party.admin.emailGoingBodyLabel')}</span>
          <textarea class="lol-input lol-textarea" name="body" rows="6" maxlength="5000"
                    placeholder="${escHtml(t('party.admin.emailGoingBodyPh'))}"></textarea>
        </label>
        <label class="party-admin__email-checkbox">
          <input type="checkbox" name="include_maybe" ${includeMaybeDefault ? 'checked' : ''} />
          ${t('party.admin.emailGoingIncludeMaybe')}
        </label>
        <p class="party-admin__email-recipients" id="party-admin-email-recipients" aria-live="polite">
          ${t('party.admin.emailGoingRecipients', { n: initialCount })}
        </p>
        <div class="party-admin__email-actions">
          <button type="button" class="lol-btn lol-btn--ghost" data-email-close>${t('party.admin.emailGoingCancel')}</button>
          <button type="submit" class="lol-btn lol-btn--primary" ${initialCount === 0 ? 'disabled' : ''}>
            ${t('party.admin.emailGoingSend')}
          </button>
        </div>
        <p class="party-admin__email-status" id="party-admin-email-status" aria-live="polite"></p>
      </form>
    `;

    // Close-button + cancel-button wiring (both use the same data-email-close attribute)
    modal.querySelectorAll('[data-email-close]').forEach(el => {
      el.addEventListener('click', () => this._closeEmailGoingModal());
    });

    // Live recipient count when Maybe checkbox flips.
    const form           = modal.querySelector('#party-admin-email-form');
    const includeMaybeCb = form.querySelector('input[name="include_maybe"]');
    const recipientsEl   = form.querySelector('#party-admin-email-recipients');
    const submitBtn      = form.querySelector('button[type="submit"]');
    includeMaybeCb.addEventListener('change', () => {
      const n = this._emailGoingRecipientCount(includeMaybeCb.checked);
      recipientsEl.textContent = t('party.admin.emailGoingRecipients', { n });
      submitBtn.disabled = n === 0;
    });

    // Submit → POST to the new endpoint.
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const statusEl = form.querySelector('#party-admin-email-status');
      const subject  = form.querySelector('input[name="subject"]').value.trim();
      const body     = form.querySelector('textarea[name="body"]').value.trim();
      const includeMaybe = includeMaybeCb.checked;

      submitBtn.disabled = true;
      statusEl.textContent = t('party.admin.emailGoingSending');
      try {
        const headers = await getCsrfHeaders();
        const res = await fetch('/api/v1/party/email-going', {
          method:      'POST',
          credentials: 'include',
          headers,
          body: JSON.stringify({
            subject: subject || undefined,
            body:    body    || undefined,
            includeMaybe,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || t('party.admin.emailGoingFailed'));
        }
        const { sent } = await res.json();
        this._closeEmailGoingModal();
        showToast(t('party.admin.emailGoingSent', { n: sent }), 'success');
      } catch (err) {
        statusEl.textContent = err.message || t('party.admin.emailGoingFailed');
        submitBtn.disabled = false;
      }
    });

    this._emailOverlay.classList.add('open');
    document.addEventListener('keydown', this._emailKeyHandler);
    modal.focus();
  }

  _closeEmailGoingModal() {
    if (!this._emailOverlay) return;
    this._emailOverlay.classList.remove('open');
    document.removeEventListener('keydown', this._emailKeyHandler);
  }

  _bindStatCards() {
    if (!this._statModal) this._statModal = new PartyAdminStatModal();
    if (this._statClickHandler) {
      // Re-render replaces the inner HTML but keeps `this._el`, so the listener
      // attached to it survives — bail out to avoid double-firing.
      return;
    }
    this._statClickHandler = (e) => {
      const card = e.target.closest('.party-admin__stat');
      if (!card || !this._el.contains(card)) return;
      const key = card.dataset.statKey;
      if (!key || key === 'empty') return;

      let rsvps;
      let title;
      if (key === 'all') {
        rsvps = this._rsvps;
        title = t('party.admin.rsvpsSubmitted');
      } else if (key === 'headcount') {
        rsvps = this._rsvps.filter(r => r.attending);
        title = t('party.admin.totalHeadcount');
      } else if (key.startsWith('field:')) {
        const fieldId = card.dataset.statField;
        const value   = card.dataset.statValue;
        const multi   = card.dataset.statMulti === 'true';
        rsvps = this._rsvps.filter(r => {
          const a = r.answers?.[fieldId];
          return multi ? Array.isArray(a) && a.includes(value) : a === value;
        });
        title = value;
      } else {
        return;
      }

      this._statModal.open({ title, rsvps });
    };
    this._el.addEventListener('click', this._statClickHandler);
  }

  _bindLogistics() {
    const section = this._el.querySelector('#party-admin-logistics');
    if (!section) return;

    // Add item — one form per category, tagged with data-logistics-add. On
    // success we re-render (which detaches the old input refs) then refocus the
    // same category's name input so the planner can keep typing.
    section.querySelectorAll('form[data-logistics-add]').forEach(form => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const category = form.dataset.logisticsAdd;
        const nameEl   = form.querySelector('.party-admin__logistics-add-name');
        const qtyEl    = form.querySelector('.party-admin__logistics-add-qty');
        const toEl     = form.querySelector('.party-admin__logistics-add-assigned');
        const status   = form.querySelector('[data-logistics-status]');
        const name = (nameEl?.value || '').trim();
        if (!name) { nameEl?.focus(); return; }
        if (status) status.textContent = t('form.saving');
        try {
          const headers = await getCsrfHeaders();
          const res = await fetch('/api/v1/party/logistics', {
            method:      'POST',
            credentials: 'include',
            headers,
            body: JSON.stringify({
              name,
              quantity:    (qtyEl?.value || '').trim() || null,
              assigned_to: (toEl?.value  || '').trim() || null,
              category,
            }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || t('party.admin.logisticsAddFailed'));
          }
          const item = await res.json();
          this._logistics = [...(this._logistics || []), item];
          this._rerenderLogistics();
          this._el.querySelector(`form[data-logistics-add="${category}"] .party-admin__logistics-add-name`)?.focus();
        } catch (err) {
          if (status) status.textContent = err.message || t('party.admin.logisticsAddFailed');
        }
      });
    });

    // Toggle bought / at_venue — optimistic, revert on failure
    section.querySelectorAll('input[type="checkbox"][data-logistics-id]').forEach(cb => {
      cb.addEventListener('change', async () => {
        const id    = cb.dataset.logisticsId;
        const field = cb.dataset.field;
        const next  = cb.checked;

        try {
          const headers = await getCsrfHeaders();
          const res = await fetch(`/api/v1/party/logistics/${encodeURIComponent(id)}`, {
            method:      'PATCH',
            credentials: 'include',
            headers,
            body: JSON.stringify({ [field]: next }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || t('party.admin.logisticsUpdateFailed'));
          }
          const updated = await res.json();
          this._logistics = (this._logistics || []).map(i => i.id === updated.id ? updated : i);
          this._rerenderLogistics();
        } catch (err) {
          cb.checked = !next;
          showToast(err.message || t('party.admin.logisticsUpdateFailed'), 'error');
        }
      });
    });

    // Delete
    section.querySelectorAll('[data-logistics-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id   = btn.dataset.logisticsDelete;
        const name = btn.dataset.logisticsName || '';
        if (!confirm(t('party.admin.logisticsConfirmDelete', { name }))) return;

        btn.disabled = true;
        try {
          const headers = await getCsrfHeaders();
          const res = await fetch(`/api/v1/party/logistics/${encodeURIComponent(id)}`, {
            method:      'DELETE',
            credentials: 'include',
            headers,
          });
          if (!res.ok && res.status !== 204) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || t('party.admin.logisticsDeleteFailed'));
          }
          this._logistics = (this._logistics || []).filter(i => String(i.id) !== String(id));
          this._rerenderLogistics();
        } catch (err) {
          showToast(err.message || t('party.admin.logisticsDeleteFailed'), 'error');
          btn.disabled = false;
        }
      });
    });

    // Inline cell editing — auto-save on blur (the 'change' event on text
    // inputs fires on blur). Enter saves and jumps to the next row's name
    // input (or the add-item name input if there is no next row).
    section.querySelectorAll('input[type="text"][data-logistics-id]').forEach(input => {
      input.addEventListener('change', () => this._saveLogisticsCell(input));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this._saveLogisticsCell(input);
          this._focusNextLogisticsName(input);
        }
      });
    });

    // Hide-bought toggle (session-only state).
    const hideBoughtCb = section.querySelector('#party-admin-logistics-hide-bought');
    hideBoughtCb?.addEventListener('change', () => {
      this._hideBought = hideBoughtCb.checked;
      this._rerenderLogistics();
    });

    // Mark-all-at-venue button.
    const allAtVenueBtn = section.querySelector('#party-admin-logistics-all-at-venue');
    allAtVenueBtn?.addEventListener('click', async () => {
      if (!confirm(t('party.admin.logisticsAllAtVenueConfirm'))) return;
      allAtVenueBtn.disabled = true;
      try {
        const headers = await getCsrfHeaders();
        const res = await fetch('/api/v1/party/logistics/all-at-venue', {
          method:      'POST',
          credentials: 'include',
          headers,
        });
        if (!res.ok && res.status !== 204) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || t('party.admin.logisticsUpdateFailed'));
        }
        this._logistics = (this._logistics || []).map(i => ({ ...i, at_venue: true }));
        this._rerenderLogistics();
        showToast(t('party.admin.logisticsAllAtVenueDone'), 'success');
      } catch (err) {
        showToast(err.message || t('party.admin.logisticsUpdateFailed'), 'error');
        allAtVenueBtn.disabled = false;
      }
    });

    // Drag-to-reorder. Rows are draggable; the handle visually telegraphs
    // it but a stray dragstart on an input is blocked so users can still
    // select text normally.
    this._bindLogisticsDrag(section);
  }

  // Save a single text-cell edit. No-op if the value is unchanged. On
  // failure (empty name, network error, etc.) reverts the input value.
  async _saveLogisticsCell(input) {
    const value = input.value.trim();
    const last  = input.dataset.lastSaved !== undefined
      ? input.dataset.lastSaved
      : (input.defaultValue ?? '');
    if (value === last) return;

    const id    = input.dataset.logisticsId;
    const field = input.dataset.field;
    input.dataset.lastSaved = value;

    try {
      const headers = await getCsrfHeaders();
      const res = await fetch(`/api/v1/party/logistics/${encodeURIComponent(id)}`, {
        method:      'PATCH',
        credentials: 'include',
        headers,
        body: JSON.stringify({ [field]: value === '' ? null : value }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || t('party.admin.logisticsUpdateFailed'));
      }
      const updated = await res.json();
      this._logistics = (this._logistics || []).map(i =>
        String(i.id) === String(updated.id) ? updated : i
      );
      // Keep the delete-button's confirm dialog in sync with the new name.
      if (field === 'name') {
        const row = input.closest('tr');
        const del = row?.querySelector('[data-logistics-delete]');
        if (del) del.dataset.logisticsName = value;
      }
    } catch (err) {
      input.value = last;
      input.dataset.lastSaved = last;
      showToast(err.message || t('party.admin.logisticsUpdateFailed'), 'error');
    }
  }

  _focusNextLogisticsName(currentInput) {
    const row = currentInput.closest('tr');
    let next = row?.nextElementSibling;
    while (next) {
      const target = next.querySelector('input[data-field="name"]');
      if (target) {
        target.focus();
        target.select();
        return;
      }
      next = next.nextElementSibling;
    }
    // No more rows in this category — jump to that category's add-item input.
    const cat = currentInput.closest('tbody[data-logistics-category]')?.dataset.logisticsCategory;
    const addInput = cat
      ? this._el.querySelector(`form[data-logistics-add="${cat}"] .party-admin__logistics-add-name`)
      : null;
    addInput?.focus();
  }

  _bindLogisticsDrag(section) {
    const tbodies = section.querySelectorAll('tbody[data-logistics-category]');
    if (!tbodies.length) return;
    let draggedId = null;

    const clearDropMarkers = () => {
      section.querySelectorAll(
        '.party-admin__logistics-row--drop-above, .party-admin__logistics-row--drop-below'
      ).forEach(r => r.classList.remove(
        'party-admin__logistics-row--drop-above',
        'party-admin__logistics-row--drop-below'
      ));
    };

    tbodies.forEach(tbody => {
      tbody.addEventListener('dragstart', (e) => {
        // Block drag from anything other than the handle so users can still
        // select text inside cell inputs without accidentally starting a drag.
        const handle = e.target.closest?.('.party-admin__logistics-handle');
        if (!handle) { e.preventDefault(); return; }
        const row = handle.closest('tr[data-logistics-row]');
        if (!row) { e.preventDefault(); return; }
        draggedId = row.dataset.logisticsRow;
        e.dataTransfer.effectAllowed = 'move';
        // Firefox requires data to be set for drag to begin.
        try { e.dataTransfer.setData('text/plain', draggedId); } catch { /* ignore */ }
        row.classList.add('party-admin__logistics-row--dragging');
      });

      tbody.addEventListener('dragend', (e) => {
        const row = e.target.closest?.('tr[data-logistics-row]');
        row?.classList.remove('party-admin__logistics-row--dragging');
        clearDropMarkers();
        draggedId = null;
      });

      // preventDefault unconditionally (when dragging) so a row can also be
      // dropped onto an empty category table, not just onto a sibling row.
      tbody.addEventListener('dragover', (e) => {
        if (!draggedId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        clearDropMarkers();
        const row = e.target.closest('tr[data-logistics-row]');
        if (row && row.dataset.logisticsRow !== draggedId) {
          const rect    = row.getBoundingClientRect();
          const isAbove = (e.clientY - rect.top) < (rect.height / 2);
          row.classList.add(isAbove
            ? 'party-admin__logistics-row--drop-above'
            : 'party-admin__logistics-row--drop-below');
        }
      });

      tbody.addEventListener('drop', async (e) => {
        e.preventDefault();
        if (!draggedId) return;
        const destCat = tbody.dataset.logisticsCategory;
        const row     = e.target.closest('tr[data-logistics-row]');
        const isAbove = !!row?.classList.contains('party-admin__logistics-row--drop-above');
        const targetId = (row && row.dataset.logisticsRow !== draggedId) ? row.dataset.logisticsRow : null;
        const moved = draggedId;
        clearDropMarkers();
        draggedId = null;
        await this._moveLogistics(moved, destCat, targetId, isAbove);
      });
    });
  }

  // Move/reorder a logistics item. Builds the destination category's id order
  // with the dragged item inserted at the drop point, optimistically updates
  // local state, then (if the category changed) PATCHes the category before
  // reordering. Reorder writes sort_order 1..N over just the destination ids;
  // that's safe because each table only renders its own category's slice.
  async _moveLogistics(draggedId, destCat, targetId, isAbove) {
    const items   = this._logistics || [];
    const dragged = items.find(i => String(i.id) === String(draggedId));
    if (!dragged) return;

    const destItems = items
      .filter(i => (i.category || 'other') === destCat && String(i.id) !== String(draggedId))
      .sort((a, b) => (a.sort_order - b.sort_order) || (a.id - b.id));

    let insertAt = destItems.length; // default: append (e.g. dropped on an empty table)
    if (targetId != null) {
      const targetIdx = destItems.findIndex(i => String(i.id) === String(targetId));
      if (targetIdx >= 0) insertAt = isAbove ? targetIdx : targetIdx + 1;
    }

    const orderedDest = [
      ...destItems.slice(0, insertAt),
      dragged,
      ...destItems.slice(insertAt),
    ];
    const ids = orderedDest.map(i => i.id);
    const movedCategory = (dragged.category || 'other') !== destCat;

    // No-op: dropped back into the same category at the same position.
    if (!movedCategory) {
      const origDest = items
        .filter(i => (i.category || 'other') === destCat)
        .sort((a, b) => (a.sort_order - b.sort_order) || (a.id - b.id))
        .map(i => i.id);
      if (JSON.stringify(origDest) === JSON.stringify(ids)) return;
    }

    const previous = this._logistics;
    this._logistics = items.map(i => {
      const pos = ids.indexOf(i.id);
      if (String(i.id) === String(draggedId)) {
        return { ...i, category: destCat, sort_order: (pos >= 0 ? pos + 1 : i.sort_order) };
      }
      if (pos >= 0) return { ...i, sort_order: pos + 1 };
      return i;
    });
    this._rerenderLogistics();

    try {
      const headers = await getCsrfHeaders();
      if (movedCategory) {
        const res = await fetch(`/api/v1/party/logistics/${encodeURIComponent(draggedId)}`, {
          method:      'PATCH',
          credentials: 'include',
          headers,
          body: JSON.stringify({ category: destCat }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || t('party.admin.logisticsReorderFailed'));
        }
      }
      const res2 = await fetch('/api/v1/party/logistics/reorder', {
        method:      'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({ ids }),
      });
      if (!res2.ok && res2.status !== 204) {
        const data = await res2.json().catch(() => ({}));
        throw new Error(data.error || t('party.admin.logisticsReorderFailed'));
      }
    } catch (err) {
      this._logistics = previous;
      this._rerenderLogistics();
      showToast(err.message || t('party.admin.logisticsReorderFailed'), 'error');
    }
  }

  // Re-render only the logistics section in place — keeps state in other
  // sections (expanded guest details, owner-invite textarea) intact.
  _rerenderLogistics() {
    const old = this._el.querySelector('#party-admin-logistics');
    if (!old) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = this._renderLogistics();
    const next = tmp.firstElementChild;
    old.replaceWith(next);
    this._bindLogistics();
  }

  // ── To-do list ─────────────────────────────────────────────────────────────
  // A collaborative checklist for the planning team. Each TODO has notes, an
  // optional due date + assignees, and breaks down into subtasks that carry
  // their own due date + assignees. Assignee names are suggested from the guest
  // list (a <datalist>) but free text is accepted too.

  // Unique, sorted suggestion list for the assignee datalist — built from
  // invited guests, RSVPs, and any names already assigned.
  _collectPeopleNames() {
    const names = new Set();
    const add = (n) => { const v = (n || '').trim(); if (v) names.add(v); };
    for (const g of (this._invitedGuests || [])) add(g.display_name || g.username);
    for (const r of (this._rsvps || []))         add(r.display_name || r.username);
    for (const td of (this._todos || [])) {
      (td.assignees || []).forEach(add);
      (td.subtasks  || []).forEach(s => (s.assignees || []).forEach(add));
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }

  _renderTodoSection() {
    const todos = this._todos || [];
    const cards = todos.length
      ? todos.map(td => this._renderTodoCard(td)).join('')
      : `<p class="party-empty">${t('party.admin.todoEmpty')}</p>`;

    return `
      <section class="party-admin__section" id="party-admin-todos">
        <h2 class="party-admin__section-title">✅ ${t('party.admin.todoTitle')}</h2>
        <p class="party-admin__logistics-help">${t('party.admin.todoHelp')}</p>

        <datalist id="party-admin-people">
          ${(this._peopleNames || []).map(n => `<option value="${escHtml(n)}"></option>`).join('')}
        </datalist>

        <form class="party-admin__todo-add" id="party-admin-todo-add" novalidate>
          <input type="text" class="lol-input party-admin__todo-add-input"
                 placeholder="${escHtml(t('party.admin.todoAddPh'))}"
                 maxlength="200"
                 aria-label="${t('party.admin.todoTitleLabel')}" />
          <button type="submit" class="lol-btn lol-btn--primary">${t('party.admin.todoAdd')}</button>
          <span class="party-admin__logistics-status" id="party-admin-todo-add-status" aria-live="polite"></span>
        </form>

        <div class="party-admin__todo-list" id="party-admin-todo-list">
          ${cards}
        </div>
      </section>`;
  }

  _renderTodoCard(todo) {
    const id   = String(todo.id);
    const subs = todo.subtasks || [];
    const doneCount = subs.filter(s => s.done).length;
    const progress = subs.length
      ? `<span class="party-admin__todo-progress">${t('party.admin.todoProgress', { done: doneCount, total: subs.length })}</span>`
      : '';
    const subRows = subs.map(s => this._renderSubtaskRow(todo.id, s)).join('');

    return `
      <div class="party-admin__todo-card ${todo.done ? 'party-admin__todo-card--done' : ''}"
           data-todo-card="${escHtml(id)}" draggable="true">
        <div class="party-admin__todo-head">
          <span class="party-admin__todo-handle" title="${t('party.admin.todoReorderHandle')}"
                aria-label="${t('party.admin.todoReorderHandle')}">⋮⋮</span>
          <input type="checkbox" class="party-admin__todo-done" data-todo-done="${escHtml(id)}"
                 ${todo.done ? 'checked' : ''} aria-label="${t('party.admin.todoMarkDone')}" />
          <input type="text" class="party-admin__todo-title-input"
                 data-todo-field="title" data-todo-id="${escHtml(id)}"
                 value="${escHtml(todo.title || '')}" maxlength="200"
                 aria-label="${t('party.admin.todoTitleLabel')}" />
          <span class="party-admin__todo-meta">
            ${progress}
            <label class="party-admin__todo-due">
              <span>${t('party.admin.todoDue')}</span>
              <input type="date" class="party-admin__todo-due-input"
                     data-todo-field="due_date" data-todo-id="${escHtml(id)}"
                     value="${escHtml(todo.due_date || '')}" />
            </label>
            <button type="button" class="lol-btn lol-btn--ghost lol-btn--sm"
                    data-todo-delete="${escHtml(id)}" data-todo-name="${escHtml(todo.title || '')}">
              ${t('party.admin.todoDelete')}
            </button>
          </span>
        </div>

        ${this._renderAssigneeControl('todo', todo.id, null, todo.assignees)}

        <textarea class="party-admin__todo-notes" data-todo-field="notes" data-todo-id="${escHtml(id)}"
                  placeholder="${escHtml(t('party.admin.todoNotesPh'))}"
                  maxlength="2000" rows="2">${escHtml(todo.notes || '')}</textarea>

        <div class="party-admin__subtasks">
          ${subRows}
        </div>

        <form class="party-admin__subtask-add" data-subtask-add="${escHtml(id)}" novalidate>
          <input type="text" class="lol-input party-admin__subtask-add-input"
                 placeholder="${escHtml(t('party.admin.subtaskAddPh'))}" maxlength="200"
                 aria-label="${t('party.admin.subtaskTitleLabel')}" />
          <button type="submit" class="lol-btn lol-btn--ghost lol-btn--sm">${t('party.admin.subtaskAdd')}</button>
        </form>
      </div>`;
  }

  _renderSubtaskRow(todoId, s) {
    const id = String(s.id);
    const tid = String(todoId);
    return `
      <div class="party-admin__subtask ${s.done ? 'party-admin__subtask--done' : ''}"
           data-subtask-row="${escHtml(id)}" data-todo="${escHtml(tid)}">
        <input type="checkbox" class="party-admin__subtask-done"
               data-subtask-done="${escHtml(id)}" data-todo="${escHtml(tid)}"
               ${s.done ? 'checked' : ''} aria-label="${t('party.admin.todoMarkDone')}" />
        <input type="text" class="party-admin__subtask-title-input"
               data-subtask-field="title" data-subtask-id="${escHtml(id)}" data-todo="${escHtml(tid)}"
               value="${escHtml(s.title || '')}" maxlength="200"
               aria-label="${t('party.admin.subtaskTitleLabel')}" />
        <label class="party-admin__todo-due">
          <span>${t('party.admin.todoDue')}</span>
          <input type="date" class="party-admin__subtask-due-input"
                 data-subtask-field="due_date" data-subtask-id="${escHtml(id)}" data-todo="${escHtml(tid)}"
                 value="${escHtml(s.due_date || '')}" />
        </label>
        ${this._renderAssigneeControl('subtask', todoId, s.id, s.assignees)}
        <button type="button" class="lol-btn lol-btn--ghost lol-btn--sm"
                data-subtask-delete="${escHtml(id)}" data-todo="${escHtml(tid)}">
          ${t('party.admin.subtaskDelete')}
        </button>
      </div>`;
  }

  // Assignee chip control, reused for both TODOs and subtasks. The container's
  // data-* attributes tell the delegated handlers which entity to PATCH.
  _renderAssigneeControl(scope, todoId, subtaskId, assignees) {
    const attrs = scope === 'subtask'
      ? `data-assignee-scope="subtask" data-todo-id="${escHtml(String(todoId))}" data-subtask-id="${escHtml(String(subtaskId))}"`
      : `data-assignee-scope="todo" data-todo-id="${escHtml(String(todoId))}"`;
    const chips = (assignees || []).map(n => `
        <span class="party-admin__chip">${escHtml(n)}<button type="button" class="party-admin__chip-remove" data-chip-remove="${escHtml(n)}" aria-label="${t('party.admin.todoRemoveAssignee')}">×</button></span>`).join('');
    return `
        <div class="party-admin__assignees" ${attrs}>
          <span class="party-admin__assignees-label">${t('party.admin.todoAssignedTo')}</span>
          <div class="party-admin__chips">${chips}</div>
          <input type="text" class="lol-input party-admin__assignee-input" list="party-admin-people"
                 placeholder="${escHtml(t('party.admin.todoAssigneePh'))}" maxlength="100"
                 aria-label="${t('party.admin.todoAssigneePh')}" />
        </div>`;
  }

  _bindTodos() {
    const section = this._el.querySelector('#party-admin-todos');
    if (!section) return;

    // Add a top-level TODO.
    const addForm = section.querySelector('#party-admin-todo-add');
    addForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input  = addForm.querySelector('.party-admin__todo-add-input');
      const status = section.querySelector('#party-admin-todo-add-status');
      const title  = (input?.value || '').trim();
      if (!title) { input?.focus(); return; }
      if (status) status.textContent = t('form.saving');
      try {
        const created = await this._todoApi('POST', '/api/v1/party/todos', { title });
        this._todos = [...(this._todos || []), created];
        this._rerenderTodos();
        this._el.querySelector('#party-admin-todo-add .party-admin__todo-add-input')?.focus();
      } catch (err) {
        if (status) status.textContent = err.message || t('party.admin.todoSaveFailed');
      }
    });

    // Add a subtask — one form per card.
    section.querySelectorAll('form[data-subtask-add]').forEach(form => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const todoId = form.dataset.subtaskAdd;
        const input  = form.querySelector('.party-admin__subtask-add-input');
        const title  = (input?.value || '').trim();
        if (!title) { input?.focus(); return; }
        try {
          const created = await this._todoApi('POST', `/api/v1/party/todos/${encodeURIComponent(todoId)}/subtasks`, { title });
          this._todos = (this._todos || []).map(td =>
            String(td.id) === String(todoId)
              ? { ...td, subtasks: [...(td.subtasks || []), created] }
              : td);
          this._rerenderTodos();
          this._el.querySelector(`form[data-subtask-add="${todoId}"] .party-admin__subtask-add-input`)?.focus();
        } catch (err) {
          showToast(err.message || t('party.admin.todoSaveFailed'), 'error');
        }
      });
    });

    // Delegated change: done toggles + inline text/date edits (fire on blur) +
    // assignee input (fires on blur after typing a name).
    section.addEventListener('change', (e) => {
      const el = e.target;
      if (el.matches?.('[data-todo-done]'))             return void this._toggleTodoDone(el);
      if (el.matches?.('[data-subtask-done]'))          return void this._toggleSubtaskDone(el);
      if (el.matches?.('[data-todo-field]'))            return void this._saveTodoText(el);
      if (el.matches?.('[data-subtask-field]'))         return void this._saveSubtaskText(el);
      if (el.matches?.('.party-admin__assignee-input')) return void this._addAssignee(el);
    });

    // Delegated click: deletes + chip removes.
    section.addEventListener('click', (e) => {
      const tdel = e.target.closest?.('[data-todo-delete]');
      if (tdel) return void this._deleteTodo(tdel);
      const sdel = e.target.closest?.('[data-subtask-delete]');
      if (sdel) return void this._deleteSubtask(sdel);
      const chip = e.target.closest?.('[data-chip-remove]');
      if (chip) return void this._removeAssignee(chip);
    });

    // Enter in the assignee input adds a chip (the control isn't a <form>).
    section.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const asg = e.target.closest?.('.party-admin__assignee-input');
      if (asg) { e.preventDefault(); this._addAssignee(asg); }
    });

    this._bindTodoDrag(section);
  }

  // Thin fetch wrapper for the todos API. Returns parsed JSON, or null on 204,
  // and throws a localized Error on failure.
  async _todoApi(method, url, body) {
    const headers = await getCsrfHeaders();
    const opts = { method, credentials: 'include', headers };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (res.status === 204) return null;
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || t('party.admin.todoSaveFailed'));
    }
    return res.json();
  }

  _patchTodoLocal(todoId, patch, rerender) {
    this._todos = (this._todos || []).map(td =>
      String(td.id) === String(todoId) ? { ...td, ...patch } : td);
    if (rerender) this._rerenderTodos();
  }

  _patchSubtaskLocal(todoId, subId, patch, rerender) {
    this._todos = (this._todos || []).map(td => {
      if (String(td.id) !== String(todoId)) return td;
      return { ...td, subtasks: (td.subtasks || []).map(s =>
        String(s.id) === String(subId) ? { ...s, ...patch } : s) };
    });
    if (rerender) this._rerenderTodos();
  }

  // Inline title/notes/due_date edit on a TODO. Mirrors _saveLogisticsCell:
  // no-op when unchanged, reverts on failure. Title is required.
  async _saveTodoText(input) {
    const field = input.dataset.todoField;       // title | notes | due_date
    const id    = input.dataset.todoId;
    let value;
    if (field === 'due_date') {
      value = input.value || null;
    } else {
      value = input.value.trim();
      if (field === 'title' && value === '') {
        input.value = input.dataset.lastSaved ?? input.defaultValue;
        return;
      }
    }
    const lastRaw = input.dataset.lastSaved !== undefined ? input.dataset.lastSaved : input.defaultValue;
    const cur = value === null ? '' : value;
    if (cur === (lastRaw ?? '')) return;
    input.dataset.lastSaved = cur;
    try {
      const updated = await this._todoApi('PATCH', `/api/v1/party/todos/${encodeURIComponent(id)}`, { [field]: value });
      this._patchTodoLocal(id, { [field]: updated[field] }, false);
      if (field === 'title') {
        const del = input.closest('[data-todo-card]')?.querySelector('[data-todo-delete]');
        if (del) del.dataset.todoName = value;
      }
    } catch (err) {
      input.value = lastRaw ?? '';
      input.dataset.lastSaved = lastRaw ?? '';
      showToast(err.message || t('party.admin.todoSaveFailed'), 'error');
    }
  }

  async _saveSubtaskText(input) {
    const field  = input.dataset.subtaskField;   // title | due_date
    const id     = input.dataset.subtaskId;
    const todoId = input.dataset.todo;
    let value;
    if (field === 'due_date') {
      value = input.value || null;
    } else {
      value = input.value.trim();
      if (field === 'title' && value === '') {
        input.value = input.dataset.lastSaved ?? input.defaultValue;
        return;
      }
    }
    const lastRaw = input.dataset.lastSaved !== undefined ? input.dataset.lastSaved : input.defaultValue;
    const cur = value === null ? '' : value;
    if (cur === (lastRaw ?? '')) return;
    input.dataset.lastSaved = cur;
    try {
      const updated = await this._todoApi('PATCH', `/api/v1/party/todos/${encodeURIComponent(todoId)}/subtasks/${encodeURIComponent(id)}`, { [field]: value });
      this._patchSubtaskLocal(todoId, id, { [field]: updated[field] }, false);
    } catch (err) {
      input.value = lastRaw ?? '';
      input.dataset.lastSaved = lastRaw ?? '';
      showToast(err.message || t('party.admin.todoSaveFailed'), 'error');
    }
  }

  async _toggleTodoDone(cb) {
    const id = cb.dataset.todoDone;
    const next = cb.checked;
    try {
      const updated = await this._todoApi('PATCH', `/api/v1/party/todos/${encodeURIComponent(id)}`, { done: next });
      this._patchTodoLocal(id, { done: updated.done }, true);
    } catch (err) {
      cb.checked = !next;
      showToast(err.message || t('party.admin.todoSaveFailed'), 'error');
    }
  }

  async _toggleSubtaskDone(cb) {
    const id = cb.dataset.subtaskDone;
    const todoId = cb.dataset.todo;
    const next = cb.checked;
    try {
      const updated = await this._todoApi('PATCH', `/api/v1/party/todos/${encodeURIComponent(todoId)}/subtasks/${encodeURIComponent(id)}`, { done: next });
      this._patchSubtaskLocal(todoId, id, { done: updated.done }, true);
    } catch (err) {
      cb.checked = !next;
      showToast(err.message || t('party.admin.todoSaveFailed'), 'error');
    }
  }

  async _deleteTodo(btn) {
    const id   = btn.dataset.todoDelete;
    const name = btn.dataset.todoName || '';
    if (!confirm(t('party.admin.todoConfirmDelete', { name }))) return;
    btn.disabled = true;
    try {
      await this._todoApi('DELETE', `/api/v1/party/todos/${encodeURIComponent(id)}`);
      this._todos = (this._todos || []).filter(td => String(td.id) !== String(id));
      this._rerenderTodos();
    } catch (err) {
      showToast(err.message || t('party.admin.todoDeleteFailed'), 'error');
      btn.disabled = false;
    }
  }

  async _deleteSubtask(btn) {
    const id     = btn.dataset.subtaskDelete;
    const todoId = btn.dataset.todo;
    btn.disabled = true;
    try {
      await this._todoApi('DELETE', `/api/v1/party/todos/${encodeURIComponent(todoId)}/subtasks/${encodeURIComponent(id)}`);
      this._todos = (this._todos || []).map(td =>
        String(td.id) === String(todoId)
          ? { ...td, subtasks: (td.subtasks || []).filter(s => String(s.id) !== String(id)) }
          : td);
      this._rerenderTodos();
    } catch (err) {
      showToast(err.message || t('party.admin.todoDeleteFailed'), 'error');
      btn.disabled = false;
    }
  }

  _assigneeContext(container) {
    const scope     = container.dataset.assigneeScope;
    const todoId    = container.dataset.todoId;
    const subtaskId = container.dataset.subtaskId;
    const td = (this._todos || []).find(x => String(x.id) === String(todoId));
    let current = [];
    if (scope === 'subtask') {
      const s = td?.subtasks?.find(x => String(x.id) === String(subtaskId));
      current = s?.assignees || [];
    } else {
      current = td?.assignees || [];
    }
    return { scope, todoId, subtaskId, current: [...current] };
  }

  async _addAssignee(input) {
    const container = input.closest('.party-admin__assignees');
    if (!container) return;
    const name = (input.value || '').trim();
    if (!name) return;
    const { scope, todoId, subtaskId, current } = this._assigneeContext(container);
    if (current.some(n => n.toLowerCase() === name.toLowerCase())) { input.value = ''; return; }
    await this._saveAssignees(scope, todoId, subtaskId, [...current, name]);
  }

  async _removeAssignee(btn) {
    const container = btn.closest('.party-admin__assignees');
    if (!container) return;
    const { scope, todoId, subtaskId, current } = this._assigneeContext(container);
    await this._saveAssignees(scope, todoId, subtaskId, current.filter(n => n !== btn.dataset.chipRemove));
  }

  async _saveAssignees(scope, todoId, subtaskId, assignees) {
    try {
      if (scope === 'subtask') {
        const updated = await this._todoApi('PATCH', `/api/v1/party/todos/${encodeURIComponent(todoId)}/subtasks/${encodeURIComponent(subtaskId)}`, { assignees });
        this._patchSubtaskLocal(todoId, subtaskId, { assignees: updated.assignees }, false);
      } else {
        const updated = await this._todoApi('PATCH', `/api/v1/party/todos/${encodeURIComponent(todoId)}`, { assignees });
        this._patchTodoLocal(todoId, { assignees: updated.assignees }, false);
      }
      this._peopleNames = this._collectPeopleNames();
      this._rerenderTodos();
    } catch (err) {
      showToast(err.message || t('party.admin.todoSaveFailed'), 'error');
    }
  }

  // Drag-to-reorder top-level TODO cards (mirrors the logistics handle drag).
  _bindTodoDrag(section) {
    const list = section.querySelector('#party-admin-todo-list');
    if (!list) return;
    let draggedId = null;

    const clearMarks = () => {
      list.querySelectorAll('.party-admin__todo-card--drop-above, .party-admin__todo-card--drop-below')
        .forEach(c => c.classList.remove('party-admin__todo-card--drop-above', 'party-admin__todo-card--drop-below'));
    };

    list.addEventListener('dragstart', (e) => {
      const handle = e.target.closest?.('.party-admin__todo-handle');
      if (!handle) { e.preventDefault(); return; }
      const card = handle.closest('[data-todo-card]');
      if (!card) { e.preventDefault(); return; }
      draggedId = card.dataset.todoCard;
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', draggedId); } catch { /* ignore */ }
      card.classList.add('party-admin__todo-card--dragging');
    });

    list.addEventListener('dragend', (e) => {
      e.target.closest?.('[data-todo-card]')?.classList.remove('party-admin__todo-card--dragging');
      clearMarks();
      draggedId = null;
    });

    list.addEventListener('dragover', (e) => {
      if (!draggedId) return;
      const card = e.target.closest('[data-todo-card]');
      if (!card || card.dataset.todoCard === draggedId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = card.getBoundingClientRect();
      const isAbove = (e.clientY - rect.top) < (rect.height / 2);
      clearMarks();
      card.classList.add(isAbove ? 'party-admin__todo-card--drop-above' : 'party-admin__todo-card--drop-below');
    });

    list.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (!draggedId) return;
      const card = e.target.closest('[data-todo-card]');
      if (!card || card.dataset.todoCard === draggedId) { clearMarks(); return; }
      const targetId = card.dataset.todoCard;
      const isAbove  = card.classList.contains('party-admin__todo-card--drop-above');
      clearMarks();
      const moved = draggedId;
      draggedId = null;

      const todos   = this._todos || [];
      const dragged = todos.find(td => String(td.id) === String(moved));
      if (!dragged) return;
      const without = todos.filter(td => String(td.id) !== String(moved));
      const idx     = without.findIndex(td => String(td.id) === String(targetId));
      if (idx < 0) return;
      const insertAt  = isAbove ? idx : idx + 1;
      const reordered = [...without.slice(0, insertAt), dragged, ...without.slice(insertAt)];
      const ids = reordered.map(td => td.id);

      const previous = this._todos;
      this._todos = reordered;
      this._rerenderTodos();
      try {
        await this._todoApi('POST', '/api/v1/party/todos/reorder', { ids });
      } catch (err) {
        this._todos = previous;
        this._rerenderTodos();
        showToast(err.message || t('party.admin.todoSaveFailed'), 'error');
      }
    });
  }

  _rerenderTodos() {
    const old = this._el.querySelector('#party-admin-todos');
    if (!old) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = this._renderTodoSection();
    const next = tmp.firstElementChild;
    old.replaceWith(next);
    this._bindTodos();
  }

  _bindInvitedGuests() {
    // Row click → toggle detail expansion. Ignores clicks on buttons within
    // the row so Revoke doesn't also open the details.
    this._el.querySelectorAll('[data-expand-guest]').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        const id = row.dataset.expandGuest;
        const details = this._el.querySelector(`[data-guest-details="${CSS.escape(id)}"]`);
        if (!details) return;
        details.hidden = !details.hidden;
      });
    });

    // Revoke → flip party_access to false, remove the two rows for this guest.
    this._el.querySelectorAll('[data-revoke-user-id]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const userId = btn.dataset.revokeUserId;
        const name   = btn.dataset.revokeUserName || 'this guest';
        if (!confirm(t('party.admin.confirmRevoke', { name }))) return;

        btn.disabled = true;
        btn.textContent = t('profile.revoking');
        try {
          await adminUpdateUser(userId, { party_access: false });
          // Remove the two related rows and any cached entry
          const row     = btn.closest('tr');
          const details = this._el.querySelector(`[data-guest-details="${CSS.escape(userId)}"]`);
          row?.remove();
          details?.remove();
          this._invitedGuests = (this._invitedGuests || []).filter(g => g.id !== userId);
          showToast(t('party.admin.revokedAccess', { name }), 'success');
        } catch (err) {
          showToast(err.message || t('party.admin.revokeFailed'), 'error');
          btn.disabled = false;
          btn.textContent = t('profile.revoke');
        }
      });
    });
  }

  // Parse the owner-invite textarea: one entry per line, "email" or "Name <email>".
  _parseInviteLines(raw) {
    return String(raw)
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const m = line.match(/^(.*?)<([^>]+)>$/);
        if (m) return { name: m[1].trim(), email: m[2].trim() };
        return { email: line };
      });
  }

  _bindOwnerInvite() {
    const form = this._el.querySelector('#party-admin-owner-invite-form');
    if (!form) return;
    const input  = form.querySelector('#party-admin-owner-invite-input');
    const status = form.querySelector('#party-admin-owner-invite-status');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const invites = this._parseInviteLines(input?.value || '');
      if (!invites.length) {
        status.textContent = t('party.admin.ownerInviteEmpty');
        return;
      }
      status.textContent = t('form.saving');
      try {
        const headers = await getCsrfHeaders();
        const res = await fetch('/api/v1/party/owner-invite', {
          method:      'POST',
          credentials: 'include',
          headers,
          body:        JSON.stringify({ invites }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Send failed');
        status.textContent = '';
        showToast(t('party.admin.inviteSent', { n: data.invited ?? invites.length }), 'success');
        if (input) input.value = '';
      } catch (err) {
        status.textContent = err.message;
      }
    });
  }

  _bindPendingRequests() {
    const section = this._el.querySelector('.party-admin__pending');
    if (!section) return;
    section.querySelectorAll('[data-approve]').forEach(btn => {
      btn.addEventListener('click', () => this._actOnPending(btn.dataset.approve, 'approve'));
    });
    section.querySelectorAll('[data-decline]').forEach(btn => {
      btn.addEventListener('click', () => this._actOnPending(btn.dataset.decline, 'decline'));
    });
  }

  async _actOnPending(id, action) {
    const row = this._el.querySelector(`[data-pending-id="${CSS.escape(String(id))}"]`);
    row?.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
      await adminApproveUser(id, action);
      showToast(action === 'approve' ? t('party.admin.approvedGuest') : t('party.admin.declinedGuest'), 'success');
      // Reload so the approved guest moves into the accepted list and the
      // pending section updates (or disappears when empty).
      await this._loadAndRender();
    } catch (err) {
      showToast(err.message, 'error');
      row?.querySelectorAll('button').forEach(b => { b.disabled = false; });
    }
  }
}

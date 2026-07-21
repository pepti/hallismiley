import { isAuthenticated, isAdmin, canEdit, adminUpdateUser, adminApproveUser } from '../services/auth.js';
import { getCsrfHeaders } from '../utils/api.js';
import { showToast }    from '../components/Toast.js';
import { escHtml }      from '../utils/escHtml.js';
import { formatMoney }  from '../utils/format.js';
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
    const [rsvpsRes, infoRes, pendingRes, healthRes, guestsRes, logisticsRes, catsRes, todosRes] = await Promise.all([
      fetch('/api/v1/party/rsvps',            { credentials: 'include' }),
      fetch('/api/v1/party/info',             { credentials: 'include' }),
      fetch('/api/v1/party/pending-requests', { credentials: 'include' }),
      fetch('/api/v1/admin/email-health',     { credentials: 'include' }),
      fetch('/api/v1/party/invited-guests',   { credentials: 'include' }),
      fetch('/api/v1/party/logistics',        { credentials: 'include' }),
      fetch('/api/v1/party/logistics/categories', { credentials: 'include' }),
      fetch('/api/v1/party/todos',            { credentials: 'include' }),
    ]);
    const rsvps     = await rsvpsRes.json();
    const info      = await infoRes.json();
    const pending   = pendingRes.ok ? await pendingRes.json() : [];
    const health    = healthRes.ok ? await healthRes.json() : null;
    const guests    = guestsRes.ok ? await guestsRes.json() : [];
    const logistics = logisticsRes.ok ? await logisticsRes.json() : [];
    const cats      = catsRes.ok ? await catsRes.json() : [];
    const todos     = todosRes.ok ? await todosRes.json() : [];

    this._rsvps           = Array.isArray(rsvps) ? rsvps : [];
    this._pendingRequests = Array.isArray(pending) ? pending : [];
    this._emailHealth   = health;
    this._invitedGuests = Array.isArray(guests) ? guests : [];
    this._logistics     = Array.isArray(logistics) ? logistics : [];
    this._logisticsCats = Array.isArray(cats) ? cats : [];
    this._todos         = Array.isArray(todos) ? todos : [];
    this._peopleNames   = this._collectPeopleNames();
    const parsed   = (() => { try { return JSON.parse(info.rsvp_form || 'null'); } catch { return null; } })();
    this._rsvpForm = Array.isArray(parsed) ? parsed : [];

    // Sort state is session-only — each fresh load starts on the default view.
    // The guest filter (name query + pill group) survives the _loadAndRender
    // reloads that follow every inline edit, so an admin working through e.g.
    // the "waiting" list doesn't lose their place after each change.
    this._guestSort   = null;
    this._rsvpSort    = null;
    this._guestFilter = this._guestFilter || { q: '', group: null };
    // Scroll-mode toggle is session-only and off by default (the guest list
    // shows in full and the page scrolls); survives inline-edit reloads.
    if (this._guestScroll === undefined) this._guestScroll = false;

    // Column widths persist across reloads (per browser). Ignored when the
    // stored array doesn't match the current column count (e.g. admin vs
    // moderator see different columns).
    if (this._guestColWidths === undefined) {
      try {
        this._guestColWidths = JSON.parse(localStorage.getItem('partyAdmin.guestColWidths') || 'null');
      } catch { this._guestColWidths = null; }
    }

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

        ${this._renderAcceptedAndPending()}
        ${this._renderAddGuestSection()}
        ${this._renderDeclinedGuests()}
        ${this._renderLogistics()}
        ${this._renderTodoSection()}
        ${this._renderCostSection()}
        ${this._renderStats()}
        ${this._renderAnswerTallies()}
        ${this._renderHelpersList()}
        ${this._renderPendingRequests()}
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
  // Sort the (already filtered) guest list. Default sort (no column clicked):
  // status priority then alphabetical. User-applied column sort takes over
  // when this._guestSort is set. Shared by the full section render and the
  // tbody-only refresh the filter box uses.
  _sortInvitedGuests(guests) {
    if (this._guestSort) {
      return this._sortRows(
        guests,
        (g) => this._guestSortValue(g, this._guestSort.field),
        this._guestSort.dir,
        this._guestSortType(this._guestSort.field),
      );
    }
    const order = { going: 0, maybe: 1, waiting: 2 };
    const byName = (a, b) =>
      (a.display_name || a.username || '').localeCompare(b.display_name || b.username || '');
    return [...guests].sort((a, b) => {
      const d = (order[a.rsvp_status] ?? 9) - (order[b.rsvp_status] ?? 9);
      return d !== 0 ? d : byName(a, b);
    });
  }

  // Apply the toolbar filters to the non-declined guest list: the active pill
  // group first (membership comes from the same lists the pills count), then
  // the name query against display name OR username (the Notendanafn column
  // shows display_name with username fallback, so match both).
  _filterGuests(guests) {
    const { q, group } = this._guestFilter || {};
    let out = guests;
    if (group) {
      const grp = this._summaryGroups(guests).find(g2 => g2.key === group);
      const ids = new Set((grp?.list || []).map(g2 => g2.id));
      out = out.filter(g2 => ids.has(g2.id));
    }
    const needle = (q || '').trim().toLowerCase();
    if (needle) {
      out = out.filter(g2 =>
        (g2.display_name || '').toLowerCase().includes(needle) ||
        (g2.username || '').toLowerCase().includes(needle));
    }
    return out;
  }

  _guestFilterActive() {
    const { q, group } = this._guestFilter || {};
    return Boolean((q || '').trim() || group);
  }

  // The tbody rows for the attendance table — empty-state message depends on
  // whether a filter is hiding everyone or there are simply no guests.
  _guestRowsHtml(sorted, showRevoke, anyGuests) {
    if (sorted.length) return sorted.map(g => this._renderInvitedGuestRow(g, showRevoke)).join('');
    const colSpan = this._invitedGuestColSpan(showRevoke);
    const msg = (anyGuests && this._guestFilterActive())
      ? t('party.admin.guestFilterNoMatch')
      : t('party.admin.noGuests');
    return `<tr><td colspan="${colSpan}" class="party-empty">${msg}</td></tr>`;
  }

  // Planned headcount over GOING guests: each guest counts as one adult, plus
  // one more when they bring a spouse/partner (admin RSVP Stýring wins over the
  // guest's own answer — _companionFlags folds that in). Kids use the admin
  // count when recorded; otherwise the original answer only tells us kids
  // exist, so it conservatively counts as 1.
  _plannedHeadcount() {
    let adults = 0, kids = 0;
    for (const g of this._invitedGuests || []) {
      if (g.rsvp_status !== 'going') continue;
      const flags = this._companionFlags(g);
      adults += 1 + (flags.spouse ? 1 : 0);
      const ac = g.admin_companions;
      if (ac && typeof ac === 'object') kids += Number(ac.kids_count) || 0;
      else if (flags.kids) kids += 1;
    }
    return { adults, kids };
  }

  _renderAcceptedAndPending() {
    const guests = (this._invitedGuests || []).filter(g => g.rsvp_status !== 'declined');
    const showRevoke = isAdmin();

    const visible = this._filterGuests(guests);
    const sorted  = this._sortInvitedGuests(visible);

    const counts = guests.reduce((acc, g) => {
      acc[g.rsvp_status] = (acc[g.rsvp_status] || 0) + 1;
      return acc;
    }, {});

    const rows = this._guestRowsHtml(sorted, showRevoke, guests.length > 0);

    // Email button only renders for admins who actually have someone to email.
    const emailableCount = (counts.going || 0) + (counts.maybe || 0);
    const emailBtn = (showRevoke && emailableCount > 0)
      ? `<button type="button" class="lol-btn lol-btn--primary lol-btn--sm" id="party-admin-email-going-btn">${t('party.admin.emailGoingBtn')}</button>`
      : '';

    // Planning stat: true mouths-to-feed count, not "guests who bring someone".
    const hc = this._plannedHeadcount();
    const headcountPill =
      `<span class="party-admin__pill party-admin__pill--headcount"
             title="${escHtml(t('party.admin.plannedHeadcount', { a: hc.adults, k: hc.kids }))}">
         ${t('party.admin.plannedHeadcount', { a: hc.adults, k: hc.kids })}
       </span>`;

    const filterActive = this._guestFilterActive();
    const filterCount  = t('party.admin.filterShowing', { x: sorted.length, y: guests.length });

    return `
      <section class="party-admin__section" id="party-admin-accepted-pending">
        <h2 class="party-admin__section-title">${t('party.admin.acceptedAndPending', { n: guests.length })}</h2>
        <div class="party-admin__invited-toolbar">
          <div class="party-admin__invited-summary">
            ${this._summaryGroups(guests).map(grp => this._renderSummaryPill(grp)).join('')}
            ${headcountPill}
          </div>
          ${emailBtn}
        </div>
        <div class="party-admin__guest-filterbar">
          <input type="search" class="lol-input party-admin__guest-filter" id="party-admin-guest-filter"
                 value="${escHtml(this._guestFilter.q || '')}"
                 placeholder="${escHtml(t('party.admin.guestFilterPlaceholder'))}"
                 aria-label="${escHtml(t('party.admin.guestFilterPlaceholder'))}" />
          <span class="party-admin__guest-filter-count" data-guest-filter-count ${filterActive ? '' : 'hidden'}>${filterCount}</span>
          <label class="party-admin__scroll-toggle" title="${escHtml(t('party.admin.scrollToggleHint'))}">
            <input type="checkbox" id="party-admin-scroll-toggle" ${this._guestScroll ? 'checked' : ''} />
            ${t('party.admin.scrollToggle')}
          </label>
        </div>
        <div class="party-admin__table-wrap${this._guestScroll ? ' party-admin__table-wrap--sticky' : ''}">
          <table class="party-admin__table party-admin__table--invited" aria-label="${t('party.admin.acceptedAndPending', { n: '' }).trim()}">
            <thead>
              <tr>
                ${this._sortableTh('username', 'string', t('adminUsers.username'), this._guestSort)}
                ${this._sortableTh('email',    'string', t('adminUsers.email'),    this._guestSort)}
                ${this._sortableTh('status',   'number', t('adminOrders.status'),  this._guestSort)}
                ${this._sortableTh('bringing', 'string', t('party.admin.bringing'),this._guestSort)}
                <th>${t('party.admin.rsvpControl')}</th>
                <th>${t('party.admin.attendCol')}</th>
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
                  <th>${t('party.admin.rsvpControl')}</th>
                  <th>${t('party.admin.attendCol')}</th>
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
    // Name, Email, Status, Bringing, RSVP Stýring, RSVP'd at (+ Actions if admin)
    return showRevoke ? 7 : 6;
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
      default:         return null;
    }
  }

  _guestSortType(field) {
    if (field === 'status') return 'number';
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
    // Admin RSVP Stýring wins outright when recorded — it's the host's own
    // note of the CURRENT plan after phone/text updates, so it overrides
    // whatever the guest originally answered on the form.
    const ac = g.admin_companions;
    if (ac && typeof ac === 'object') {
      return { spouse: !!ac.plus_one, kids: (Number(ac.kids_count) || 0) > 0 };
    }
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

  // The five clickable summary pills above the guest table. Each carries the
  // actual list of guests it counts, so clicking the pill can reveal their
  // names. Companion pills (spouse/kids) count going + maybe guests only —
  // waiting guests haven't answered the form, declined guests are filtered out.
  _summaryGroups(guests) {
    const answered = guests.filter(g => g.rsvp_status === 'going' || g.rsvp_status === 'maybe');
    return [
      { key: 'going',   cls: 'going',   icon: '✅', label: t('party.admin.statusGoing'),
        list: guests.filter(g => g.rsvp_status === 'going') },
      { key: 'spouse',  cls: 'spouse',  icon: '💑', label: t('party.admin.pillSpouses'),
        list: answered.filter(g => this._companionFlags(g).spouse) },
      { key: 'kids',    cls: 'kids',    icon: '🧒', label: t('party.admin.pillKids'),
        list: answered.filter(g => this._companionFlags(g).kids) },
      { key: 'maybe',   cls: 'maybe',   icon: '🤔', label: t('party.admin.statusMaybe'),
        list: guests.filter(g => g.rsvp_status === 'maybe') },
      { key: 'waiting', cls: 'waiting', icon: '⏳', label: t('party.admin.statusPending'),
        list: guests.filter(g => g.rsvp_status === 'waiting') },
    ];
  }

  // One summary pill: the main button toggles the table filter for that group
  // (active pill highlighted), and a small caret sub-button opens the dropdown
  // listing the names in the category. Empty groups render both disabled
  // (nothing to filter or drop down). Names sorted alphabetically. The caret
  // carries data-pill-group so _bindPillDropdowns keeps working unchanged.
  _renderSummaryPill(grp) {
    const n = grp.list.length;
    const active = this._guestFilter?.group === grp.key;
    const names = grp.list
      .map(g => g.display_name || g.username || '—')
      .sort((a, b) => a.localeCompare(b));
    const dropdown = n
      ? `<div class="party-admin__pill-dropdown" data-pill-dropdown="${escHtml(grp.key)}" role="menu" hidden>
           <ul class="party-admin__pill-names">
             ${names.map(nm => `<li role="menuitem">${escHtml(nm)}</li>`).join('')}
           </ul>
         </div>`
      : '';
    return `
      <span class="party-admin__pill-wrap">
        <button type="button"
                class="party-admin__pill party-admin__pill--${grp.cls} party-admin__pill--btn${active ? ' party-admin__pill--active' : ''}"
                data-pill-filter="${escHtml(grp.key)}"
                aria-pressed="${active}"
                ${n ? '' : 'disabled'}>
          ${grp.icon} ${escHtml(grp.label)}: ${n}
        </button>
        <button type="button"
                class="party-admin__pill-caret"
                data-pill-group="${escHtml(grp.key)}"
                aria-haspopup="true" aria-expanded="false"
                aria-label="${escHtml(t('party.admin.pillNamesAria', { label: grp.label }))}"
                ${n ? '' : 'disabled'}>▾</button>
        ${dropdown}
      </span>`;
  }

  // Placeholder emails for verbal-only guests are internal bookkeeping — show
  // an em-dash instead of "verbal-…@guest.invalid".
  _displayEmail(email) {
    if (!email || email.endsWith('@guest.invalid')) return '';
    return email;
  }

  _renderInvitedGuestRow(g, showRevoke) {
    const name     = escHtml(g.display_name || g.username || '—');
    const email    = escHtml(this._displayEmail(g.email));
    // Admins edit the display name inline; the placeholder shows the username
    // fallback so a cleared name is obviously "will show as <username>".
    const nameCell = showRevoke
      ? `<td class="party-admin__name-cell">
          <input type="text" class="party-admin__cell-input party-admin__name-input"
                 data-guest-name-for="${escHtml(g.id)}"
                 data-current="${escHtml(g.display_name || '')}"
                 value="${escHtml(g.display_name || '')}"
                 placeholder="${escHtml(g.username || '')}" maxlength="100"
                 aria-label="${escHtml(t('party.admin.editNameAria', { name: g.display_name || g.username || '—' }))}" />
        </td>`
      : `<td>${name}</td>`;

    const statusHtml = {
      going:    `<span class="party-admin__status party-admin__status--going">✅ ${t('party.admin.statusGoing')}</span>`,
      maybe:    `<span class="party-admin__status party-admin__status--maybe">🤔 ${t('party.admin.statusMaybe')}</span>`,
      declined: `<span class="party-admin__status party-admin__status--declined">❌ ${t('party.admin.statusDeclined')}</span>`,
      waiting:  `<span class="party-admin__status party-admin__status--waiting">⏳ ${t('party.admin.statusPending')}</span>`,
    }[g.rsvp_status] || '—';

    // Admins get an inline dropdown to set/correct the RSVP right from the
    // table (e.g. a guest who replied by text); everyone else sees the pill.
    const statusOptions = [
      ['going',    `✅ ${t('party.admin.statusGoing')}`],
      ['maybe',    `🤔 ${t('party.admin.statusMaybe')}`],
      ['declined', `❌ ${t('party.admin.statusDeclined')}`],
      ['waiting',  `⏳ ${t('party.admin.statusPending')}`],
    ];
    const statusCell = showRevoke
      ? `<td class="party-admin__status-cell">
          <select class="party-admin__status-select party-admin__status-select--${escHtml(g.rsvp_status || 'waiting')}"
                  data-rsvp-status-for="${escHtml(g.id)}"
                  data-current="${escHtml(g.rsvp_status || 'waiting')}"
                  aria-label="${escHtml(t('party.admin.editRsvpAria', { name: g.display_name || g.username || '—' }))}">
            ${statusOptions.map(([val, label]) =>
              `<option value="${val}"${g.rsvp_status === val ? ' selected' : ''}>${label}</option>`).join('')}
          </select>
        </td>`
      : `<td>${statusHtml}</td>`;

    const bringingHtml = this._bringingFor(g);

    // Detail row — hidden until the row is clicked. Admins get a full editable
    // form of every RSVP answer (this is what "edit all fields" means, since
    // the Bringing column is derived from these answers); everyone else sees
    // the read-only answer dump.
    const detailFields = (this._rsvpForm || []).filter(f => !['heading','paragraph'].includes(f.type));
    const detailsHtml = showRevoke
      ? this._renderGuestAnswerEditor(g, detailFields)
      : (g.rsvp_answers
          ? detailFields.map(f => {
              const a = g.rsvp_answers[f.id];
              if (a == null || (Array.isArray(a) && !a.length) || a === '') return '';
              const val = Array.isArray(a) ? a.map(escHtml).join(', ') : escHtml(String(a));
              return `<div><strong>${escHtml(f.label || f.id)}:</strong> ${val}</div>`;
            }).filter(Boolean).join('')
          : `<em class="party-admin__no-answers">${t('party.admin.hasntRsvpd')}</em>`);

    const colSpan = this._invitedGuestColSpan(showRevoke);
    // Icon-only ✕ keeps the Actions column narrow; the confirm dialog (bound
    // on data-revoke-user-id) still guards the action.
    const revokeCell = showRevoke
      ? `<td class="party-admin__actions-cell"><button class="party-admin__revoke-btn" data-revoke-user-id="${escHtml(g.id)}" data-revoke-user-name="${name}" title="${escHtml(t('profile.revoke'))}" aria-label="${escHtml(t('profile.revoke'))}">✕</button></td>`
      : '';

    return `
      <tr class="party-admin__invited-row" data-expand-guest="${escHtml(g.id)}">
        ${nameCell}
        <td>${email || '—'}</td>
        ${statusCell}
        <td class="party-admin__invited-bringing">${bringingHtml}</td>
        ${this._renderCompanionsCell(g, showRevoke)}
        ${this._renderTimingCell(g, showRevoke)}
        ${revokeCell}
      </tr>
      <tr class="party-admin__invited-details" data-guest-details="${escHtml(g.id)}" hidden>
        <td colspan="${colSpan}">
          <div class="party-admin__invited-detail-box">${detailsHtml}</div>
        </td>
      </tr>`;
  }

  // The "RSVP Stýring" cell: the host's own record of what this guest is
  // CURRENTLY bringing (after phone/text updates), separate from the guest's
  // original answer shown in the Bringing column. Admins get inline controls
  // (save on change); moderators see a read-only summary.
  _renderCompanionsCell(g, isAdminUser) {
    const ac = (g.admin_companions && typeof g.admin_companions === 'object') ? g.admin_companions : null;
    if (!isAdminUser) {
      return `<td class="party-admin__companions-cell party-admin__companions-cell--ro">${this._companionsSummary(ac)}</td>`;
    }
    const kc   = Number(ac?.kids_count) || 0;
    const ages = typeof ac?.kids_ages === 'string' ? ac.kids_ages : '';
    return `
      <td class="party-admin__companions-cell" data-companions-for="${escHtml(g.id)}">
        <label class="party-admin__companion-ctl" title="${escHtml(t('party.admin.companionPlusOne'))}">
          <span aria-hidden="true">💑</span>
          <input type="checkbox" data-companion-field="plus_one" ${ac?.plus_one ? 'checked' : ''}
                 aria-label="${escHtml(t('party.admin.companionPlusOne'))}" />
        </label>
        <label class="party-admin__companion-ctl" title="${escHtml(t('party.admin.companionKidsCount'))}">
          <span aria-hidden="true">🧒</span>
          <input type="number" min="0" max="25" step="1" class="party-admin__companion-kids"
                 data-companion-field="kids_count" value="${kc > 0 ? kc : ''}" placeholder="0"
                 aria-label="${escHtml(t('party.admin.companionKidsCount'))}" />
        </label>
        <input type="text" class="party-admin__companion-ages"
               data-companion-field="kids_ages" value="${escHtml(ages)}" maxlength="100"
               placeholder="${escHtml(t('party.admin.companionKidsAges'))}"
               aria-label="${escHtml(t('party.admin.companionKidsAges'))}" />
      </td>`;
  }

  // Compact one-line summary of an admin_companions record, e.g. "💑 🧒 2 (3, 7)".
  _companionsSummary(ac) {
    if (!ac) return '—';
    const parts = [];
    if (ac.plus_one) parts.push('💑');
    const kc = Number(ac.kids_count) || 0;
    if (kc > 0) parts.push(`🧒 ${kc}`);
    if (typeof ac.kids_ages === 'string' && ac.kids_ages) parts.push(`(${escHtml(ac.kids_ages)})`);
    return parts.length ? parts.join(' ') : '—';
  }

  // The RSVP form's attendance-timing field. The canonical `attend_when` id
  // wins outright; the id/label heuristic is only a fallback for forms that
  // renamed it. (A single find() with an OR would let an *earlier* field whose
  // label merely mentions "dag"/"kvöld" — e.g. "Verður þú í kvöldmat?" —
  // hijack the column even though attend_when exists.) Checkbox-groups qualify
  // too — the live form's attendance field ("attend", label "Svar") is one,
  // still semantically single-choice — but radio-groups are tried first so an
  // unrelated multi-pick that mentions a time can't steal the column. The
  // heuristic tests the id as well as the label because "Svar" says nothing
  // while the id "attend" does.
  _attendField() {
    const groups = (this._rsvpForm || []).filter(f =>
      f.type === 'radio-group' || f.type === 'checkbox-group');
    const canonical = groups.find(f => f.id === 'attend_when');
    if (canonical) return canonical;
    const heur = (f) => /attend|when|day|evening|hvenær|mæt|dag|kvöld/i.test(`${f.id} ${f.label || ''}`);
    return groups.filter(f => f.type === 'radio-group').find(heur)
      || groups.filter(f => f.type === 'checkbox-group').find(heur)
      || null;
  }

  // Declared status of a form option ({label,status}); legacy bare-string
  // options predate the status field and mean "going".
  _optStatus(opt) {
    if (typeof opt === 'string') return 'going';
    return ['going', 'maybe', 'declined'].includes(opt?.status) ? opt.status : 'going';
  }

  // Status of a STORED answer label. The admin's declared status on a matching
  // form option is authoritative; answers from another locale (or a renamed
  // option) aren't in the form at all, so they fall back to phrase matching —
  // the same shape as _deriveRsvpStatus on the server. Bare-string options
  // carry no declaration (only the radio editor upgrades them to objects), so
  // they use the phrase fallback too — otherwise the live checkbox form's
  // "Get ekki mætt." / "Kannski" would classify as going just for existing.
  _answerStatus(label) {
    if (typeof label !== 'string') return 'going';
    const opt = (this._attendField()?.options || []).find(o => this._optLabel(o) === label);
    if (opt && typeof opt === 'object') return this._optStatus(opt);
    const s = label.normalize('NFC');
    if (/can'?t|sorry|kemst ekki|kem ekki|get ekki|ekki mætt|afþakka|\bnei\b/i.test(s)) return 'declined';
    if (/\bmaybe\b|kannski|óvíst/i.test(s))                                            return 'maybe';
    return 'going';
  }

  // Classify a label into a timing bucket BY MEANING, across both locales and
  // old form versions: 'day' | 'evening' | 'both' | null. Matching by meaning
  // rather than exact label is what lets a guest who answered "Já, aðeins á
  // daginn" light up ☀️ even when the admin's loaded form says "☀️ Daytime
  // only". Order matters: evening first, then explicit all-day (so "all day" /
  // "allan daginn" isn't stolen by the day test), then day, and finally an
  // unqualified yes ("Já", "Yes, I'll be there") which means all day.
  // Pure text — callers go through _answerTimingBucket so a decline/maybe can
  // never land in a bucket just because its wording mentions a time.
  _timingBucket(label) {
    if (typeof label !== 'string' || !label.trim()) return null;
    const s = label.normalize('NFC');
    if (/kvöld|evening|night/i.test(s))                          return 'evening';
    if (/both|all\s*day|allan\s*dag|heilan\s*dag/i.test(s))      return 'both';
    if (/dag|day/i.test(s))                                      return 'day';
    // (?![\p{L}]) not \b — JS word boundaries are ASCII-only, so \b after the
    // 'á' in "Já" never matches and every bare-yes guest would fall through.
    if (/^[^\p{L}]*(já|jú|yes|jebb)(?![\p{L}])/iu.test(s))       return 'both';
    return null;
  }

  // Timing bucket of a stored answer: only guests who are actually coming have
  // a timing. Without this a decline worded "Can't make it that day" would
  // bucket as ☀️ — showing a timing that contradicts the Status column, and
  // letting the select's "—" wipe their real answer.
  _answerTimingBucket(label) {
    return this._answerStatus(label) === 'going' ? this._timingBucket(label) : null;
  }

  // A radio-group answer is a string; a checkbox-group answer is an array of
  // checked labels. Everything downstream of the attend field treats both as
  // a list of candidate labels.
  _answerLabels(ans) {
    if (typeof ans === 'string') return ans ? [ans] : [];
    if (Array.isArray(ans)) return ans.filter(v => typeof v === 'string' && v);
    return [];
  }

  // The timing choices offered by the current form, one per bucket (first
  // option wins). Only 'going' options qualify — a maybe/decline must never
  // back a timing slot, or picking it would flip the guest's status. `value` is
  // the real stored option label (what a save writes); icon+label are display.
  _timingOptions() {
    const f = this._attendField();
    if (!f) return [];
    const byBucket = {};
    for (const o of (f.options || [])) {
      // _answerStatus (not _optStatus) so a BARE-STRING decline/maybe worded
      // with a timing phrase can't become a selectable option either.
      if (this._answerStatus(this._optLabel(o)) !== 'going') continue;
      const label = this._optLabel(o);
      const b = this._timingBucket(label);
      if (b && !byBucket[b]) byBucket[b] = label;
    }
    return [
      byBucket.day     && { bucket: 'day',     value: byBucket.day,     icon: '☀️', label: t('party.admin.dayOnly') },
      byBucket.evening && { bucket: 'evening', value: byBucket.evening, icon: '🌙', label: t('party.admin.eveningOnly') },
      byBucket.both    && { bucket: 'both',    value: byBucket.both,    icon: '🎉', label: t('party.admin.both') },
    ].filter(Boolean);
  }

  // The attendance-timing cell (replaces the old "RSVP sent" date). Admins get
  // an inline dropdown of the timing options + a blank "—"; picking one writes
  // answers.attend_when. The guest's stored answer is matched exactly first,
  // then by bucket, so answers given in the other locale (or under renamed
  // options) still select the right entry. Non-timing answers (Maybe/Can't —
  // owned by the Status column) show blank. Moderators see a read-only label.
  _renderTimingCell(g, isAdminUser) {
    const field   = this._attendField();
    const options = this._timingOptions();
    if (!field || !options.length) return `<td>—</td>`;
    // A checkbox-group attend field stores an ARRAY of labels; treat every
    // checked label as a candidate — exact option match first, then by bucket
    // (first label that buckets wins, mirroring the single-answer path).
    const labels = this._answerLabels(g.rsvp_answers?.[field.id]);
    let match = options.find(o => labels.includes(o.value));
    if (!match) {
      const bucket = labels.map(l => this._answerTimingBucket(l)).find(Boolean);
      if (bucket) match = options.find(o => o.bucket === bucket);
    }
    // data-current mirrors the SELECTED OPTION's value (not the raw stored
    // label) so the no-op guard in the change handler compares like with like.
    const current = match ? match.value : '';

    if (!isAdminUser) {
      return `<td class="party-admin__timing-cell">${match ? `${match.icon} ${escHtml(match.label)}` : '—'}</td>`;
    }
    const opts = options.map(o =>
      `<option value="${escHtml(o.value)}"${o.value === current ? ' selected' : ''}>${o.icon} ${escHtml(o.label)}</option>`
    ).join('');
    return `
      <td class="party-admin__timing-cell">
        <select class="party-admin__timing-select" data-timing-for="${escHtml(g.id)}"
                data-field="${escHtml(field.id)}" data-current="${escHtml(current)}"
                aria-label="${escHtml(t('party.admin.attendCol'))}">
          <option value="">—</option>
          ${opts}
        </select>
      </td>`;
  }

  // An RSVP option can be a bare string or a { label, status } object (the admin
  // form editor upgrades them). Answers are always stored by label, so this is
  // the single place that resolves an option to its answer-matching label.
  _optLabel(opt) {
    if (typeof opt === 'string') return opt;
    return typeof opt?.label === 'string' ? opt.label : '';
  }

  // Can the currently-loaded form represent this stored answer? RSVP forms are
  // translated per locale, so a guest who answered in a different language (or
  // before an option was renamed) has answer labels that aren't in the option
  // list the admin is looking at. If we rendered those as editable controls
  // they'd show as unselected and a save would silently wipe them — so such
  // fields are shown read-only and preserved untouched on save. Text/textarea
  // answers are always representable; empty/absent answers have nothing to lose.
  _answerRepresentable(f, ans) {
    if (ans == null || ans === '') return true;
    if (f.type === 'radio-group') {
      if (typeof ans !== 'string') return false;
      return (f.options || []).some(o => this._optLabel(o) === ans);
    }
    if (f.type === 'checkbox-group') {
      if (!Array.isArray(ans)) return false;
      const labels = new Set((f.options || []).map(o => this._optLabel(o)));
      return ans.every(v => labels.has(v));
    }
    // text / textarea — a plain string fits; anything else (e.g. an array left
    // over from a field whose type was changed) is preserved read-only instead
    // of being lossily coerced into the input.
    return typeof ans === 'string';
  }

  // The admin's editable version of the answer dump: one typed control per RSVP
  // form field, pre-filled from the guest's answers (blank when they haven't
  // answered, so the host can fill it in). Field types mirror the guest-facing
  // form (PartyView._renderField): text, textarea, radio-group, checkbox-group.
  _renderGuestAnswerEditor(g, fields) {
    if (!fields.length) {
      return `<em class="party-admin__no-answers">${t('party.admin.noRsvpFields')}</em>`;
    }
    const ans = g.rsvp_answers || {};
    const body = fields.map(f => this._renderAnswerField(f, ans[f.id])).join('');
    return `
      <form class="party-admin__answers-form" data-guest-answers-form="${escHtml(g.id)}">
        ${body}
        <div class="party-admin__answers-actions">
          <button type="submit" class="lol-btn lol-btn--primary lol-btn--sm">${t('party.admin.saveAnswers')}</button>
          <span class="party-admin__answers-status" aria-live="polite"></span>
        </div>
      </form>`;
  }

  _renderAnswerField(f, ans) {
    const nm    = `ga_${escHtml(f.id)}`;
    const label = escHtml(f.label || f.id);
    const wrap  = (inner, extraType, extraAttr = '') =>
      `<div class="party-admin__answer-field" data-answer-field="${escHtml(f.id)}" data-answer-type="${escHtml(extraType)}"${extraAttr}>${inner}</div>`;

    // Answers the current form can't represent (other-locale / renamed options)
    // are shown read-only and skipped on save so they're never clobbered.
    if (!this._answerRepresentable(f, ans)) {
      const shown = Array.isArray(ans) ? ans.map(escHtml).join(', ') : escHtml(String(ans));
      return wrap(
        `<span class="party-admin__answer-label">${label}</span>
         <div class="party-admin__answer-readonly">${shown}
           <span class="party-admin__answer-hint">${t('party.admin.answerOtherLocale')}</span>
         </div>`, f.type, ' data-answer-skip="1"');
    }

    switch (f.type) {
      case 'checkbox-group': {
        const opts = (f.options || []).map(opt => {
          const optLabel = this._optLabel(opt);
          const checked  = Array.isArray(ans) && ans.includes(optLabel) ? 'checked' : '';
          return `<label class="party-admin__answer-check">
                    <input type="checkbox" name="${nm}" value="${escHtml(optLabel)}" ${checked} /> ${escHtml(optLabel)}
                  </label>`;
        }).join('');
        return wrap(
          `<span class="party-admin__answer-label">${label}</span>
           <div class="party-admin__answer-opts">${opts}</div>`, 'checkbox-group');
      }
      case 'radio-group': {
        const opts = (f.options || []).map(opt => {
          const optLabel = this._optLabel(opt);
          const checked  = typeof ans === 'string' && ans === optLabel ? 'checked' : '';
          return `<label class="party-admin__answer-check">
                    <input type="radio" name="${nm}" value="${escHtml(optLabel)}" ${checked} /> ${escHtml(optLabel)}
                  </label>`;
        }).join('');
        // A "no answer" radio lets the admin clear a previously-picked option.
        const clear = `<label class="party-admin__answer-check party-admin__answer-check--clear">
                    <input type="radio" name="${nm}" value="" ${typeof ans === 'string' && ans ? '' : 'checked'} /> ${t('party.admin.answerNone')}
                  </label>`;
        return wrap(
          `<span class="party-admin__answer-label">${label}</span>
           <div class="party-admin__answer-opts">${opts}${clear}</div>`, 'radio-group');
      }
      case 'textarea':
        return wrap(
          `<label class="party-admin__answer-label">${label}
             <textarea class="lol-input lol-textarea" name="${nm}" maxlength="1000">${escHtml(ans || '')}</textarea>
           </label>`, 'textarea');
      case 'text':
      default:
        return wrap(
          `<label class="party-admin__answer-label">${label}
             <input type="text" class="lol-input" name="${nm}" value="${escHtml(ans || '')}" maxlength="200" />
           </label>`, 'text');
    }
  }

  // Collect the answer editor into a { answers, clear } patch with SAFE, non-
  // destructive semantics (the server merges answers over the guest's existing
  // ones and deletes the `clear` keys):
  //   - fields with a value      → answers[id] = value (overwrites)
  //   - representable-but-emptied → id pushed to `clear` (explicit removal)
  //   - read-only unmatched fields (data-answer-skip) → neither, so the stored
  //     other-locale answer survives untouched
  // Mirrors PartyView's per-type collection (checkbox-group → array, radio-group
  // → string, text/textarea → trimmed string).
  _collectAnswers(form) {
    const answers = {};
    const clear   = [];
    form.querySelectorAll('[data-answer-field]').forEach(fieldEl => {
      if (fieldEl.dataset.answerSkip) return;           // preserve as-is
      const id   = fieldEl.dataset.answerField;
      const type = fieldEl.dataset.answerType;
      if (type === 'checkbox-group') {
        const checked = [...fieldEl.querySelectorAll('input[type="checkbox"]:checked')].map(cb => cb.value);
        if (checked.length) answers[id] = checked; else clear.push(id);
      } else if (type === 'radio-group') {
        const sel = fieldEl.querySelector('input[type="radio"]:checked');
        if (sel && sel.value) answers[id] = sel.value; else clear.push(id);
      } else {
        const el = fieldEl.querySelector('input, textarea');
        const v  = el?.value?.trim();
        if (v) answers[id] = v; else clear.push(id);
      }
    });
    return { answers, clear };
  }

  // Line cost of a logistics item — null (not 0) when qty or price is
  // missing, so incomplete rows can be surfaced instead of silently counted.
  _lineCost(item) {
    if (item.quantity == null || item.unit_price == null) return null;
    return Math.round(Number(item.quantity) * Number(item.unit_price));
  }

  _fmtIsk(n) { return formatMoney(n, 'ISK'); }

  // Subtotal for one logistics category. "missing" counts only PARTIALLY
  // priced rows (qty without price, or price without qty) — those are the
  // ones the planner clearly meant to cost out. Rows with neither (napkins,
  // "handfylli") are intentionally silent so the warning stays meaningful.
  _categorySubtotal(catKey) {
    const items = (this._logistics || []).filter(i => (i.category || 'other') === catKey);
    let sum = 0, missing = 0;
    for (const i of items) {
      const c = this._lineCost(i);
      if (c == null) {
        if ((i.quantity == null) !== (i.unit_price == null)) missing++;
      } else {
        sum += c;
      }
    }
    return { sum, missing, count: items.length };
  }

  // Subtotal label — when the hide-bought filter is on, the footer still sums
  // ALL rows (money spent is money spent), so say so to avoid reading like a
  // math bug under a filtered table.
  _subtotalLabel(sum) {
    const key = this._hideBought ? 'party.admin.logisticsSubtotalAll' : 'party.admin.logisticsSubtotal';
    return t(key, { v: this._fmtIsk(sum) });
  }

  // The logistics tables, one per section. Sections are DB rows now (068), not
  // a hardcoded triple — the planner adds their own. A row with no `label` is a
  // built-in whose name comes from i18n, so it follows the EN/IS toggle; a row
  // WITH a label shows that literal text, because planner-typed section names
  // have no translation pipeline behind them.
  //
  // The fallback keeps the section list rendering if the categories fetch
  // failed (this._logisticsCats === []): without it the whole logistics + cost
  // UI would silently vanish rather than degrade to the three built-ins.
  _logisticsCategories() {
    const BUILTIN_LABEL = {
      food:   'party.admin.logisticsCatFood',
      drinks: 'party.admin.logisticsCatDrinks',
      other:  'party.admin.logisticsCatOther',
    };
    // Per-builtin icon fallback, mirroring the label rule: a NULL icon means
    // "default", and food's default is 🍽️, not the generic 📦 — otherwise
    // clearing the icon in the rename form would "restore" the wrong one.
    const BUILTIN_ICON = { food: '🍽️', drinks: '🥤', other: '📦' };
    const rows = (this._logisticsCats || []).length
      ? this._logisticsCats
      : [
        { key: 'food',   label: null, icon: null, is_builtin: true },
        { key: 'drinks', label: null, icon: null, is_builtin: true },
        { key: 'other',  label: null, icon: null, is_builtin: true },
      ];
    return rows.map(c => ({
      key: c.key,
      label: c.label || (BUILTIN_LABEL[c.key] ? t(BUILTIN_LABEL[c.key]) : c.key),
      icon: c.icon || BUILTIN_ICON[c.key] || '📦',
      isBuiltin: !!c.is_builtin,
    }));
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
      : `<tr><td colspan="9" class="party-empty">${emptyMsg}</td></tr>`;

    const sub = this._categorySubtotal(cat.key);
    const subtotalFoot = all.length ? `
            <tfoot>
              <tr class="party-admin__logistics-subtotal-row">
                <td colspan="4" data-logistics-subtotal-note="${escHtml(cat.key)}">${sub.missing > 0 ? `<span class="party-admin__cost-missing">${t('party.admin.costNoPrice', { n: sub.missing })}</span>` : ''}</td>
                <td class="party-admin__logistics-line-cost" data-logistics-subtotal="${escHtml(cat.key)}">${this._subtotalLabel(sub.sum)}</td>
                <td colspan="4"></td>
              </tr>
            </tfoot>` : '';

    return `
      <div class="party-admin__logistics-group">
        <h3 class="party-admin__logistics-cat-title">
          ${escHtml(cat.icon)} ${escHtml(cat.label)}
          <span class="party-admin__logistics-cat-count">${all.length}</span>
        </h3>
        <form class="party-admin__logistics-add" data-logistics-add="${escHtml(cat.key)}" novalidate>
          <input type="text" class="lol-input party-admin__logistics-add-name"
                 placeholder="${escHtml(t('party.admin.logisticsNamePh'))}"
                 maxlength="200"
                 aria-label="${t('party.admin.logisticsItem')}" />
          <input type="number" min="0" step="any" class="lol-input party-admin__logistics-qty party-admin__logistics-add-qty"
                 placeholder="${escHtml(t('party.admin.logisticsQtyPh'))}"
                 aria-label="${t('party.admin.logisticsQty')}" />
          <input type="number" min="0" step="1" class="lol-input party-admin__logistics-add-price"
                 placeholder="${escHtml(t('party.admin.logisticsPricePh'))}"
                 aria-label="${t('party.admin.logisticsPrice')}" />
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
                <th>${t('party.admin.logisticsPrice')}</th>
                <th>${t('party.admin.logisticsLineCost')}</th>
                <th>${t('party.admin.logisticsAssignedTo')}</th>
                <th>${t('party.admin.logisticsBought')}</th>
                <th>${t('party.admin.logisticsAtVenue')}</th>
                <th aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody class="party-admin__logistics-tbody" data-logistics-category="${escHtml(cat.key)}">
              ${rows}
            </tbody>${subtotalFoot}
          </table>
        </div>
      </div>`;
  }

  _renderLogisticsRow(item) {
    const id   = String(item.id);
    const name = escHtml(item.name || '');
    const qty  = item.quantity == null ? '' : escHtml(String(item.quantity));
    const note = escHtml(item.quantity_note || '');
    const price = item.unit_price == null ? '' : escHtml(String(item.unit_price));
    const cost  = this._lineCost(item);
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
        <td class="party-admin__logistics-qty-cell">
          <input type="number" min="0" step="any" class="party-admin__logistics-cell-input party-admin__logistics-qty-input"
                 data-logistics-id="${escHtml(id)}" data-field="quantity"
                 value="${qty}" placeholder="—"
                 aria-label="${t('party.admin.logisticsQty')}" />
          <input type="text" class="party-admin__logistics-cell-input party-admin__logistics-unit-input"
                 data-logistics-id="${escHtml(id)}" data-field="quantity_note"
                 value="${note}" maxlength="100" placeholder="${escHtml(t('party.admin.logisticsUnitPh'))}"
                 aria-label="${t('party.admin.logisticsUnit')}" />
        </td>
        <td>
          <input type="number" min="0" step="1" class="party-admin__logistics-cell-input party-admin__logistics-price-input"
                 data-logistics-id="${escHtml(id)}" data-field="unit_price"
                 value="${price}" placeholder="—"
                 aria-label="${t('party.admin.logisticsPrice')}" />
        </td>
        <td class="party-admin__logistics-line-cost" data-line-cost="${escHtml(id)}">${cost == null ? '—' : this._fmtIsk(cost)}</td>
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

  // Add a guest straight into the attendance list. Email is optional (someone
  // who accepted verbally may not have one); when an email IS given, "send
  // invite" also mails them a magic link, which is what folds the old paste-many
  // invite box into this one form. Its own section so a partial re-render of the
  // attendance table (sort/filter) never wipes half-typed input.
  _renderAddGuestSection() {
    const statusOpts = [
      ['going',   `✅ ${t('party.admin.statusGoing')}`],
      ['maybe',   `🤔 ${t('party.admin.statusMaybe')}`],
      ['waiting', `⏳ ${t('party.admin.statusPending')}`],
    ];
    return `
      <section class="party-admin__section party-admin__add-guest party-admin__add-guest--compact">
        <h2 class="party-admin__section-title party-admin__add-guest-title">${t('party.admin.addGuestTitle')}</h2>
        <p class="party-admin__invite-help party-admin__add-guest-help">${t('party.admin.addGuestHelp')}</p>
        <form class="party-admin__add-guest-form" id="party-admin-add-guest-form" novalidate>
          <input type="text" id="party-admin-add-guest-name" class="lol-input party-admin__add-guest-name"
                 maxlength="100" required
                 placeholder="${escHtml(t('party.admin.addGuestNamePh'))}"
                 aria-label="${escHtml(t('party.admin.addGuestNamePh'))}" />
          <input type="email" id="party-admin-add-guest-email" class="lol-input party-admin__add-guest-email"
                 maxlength="200"
                 placeholder="${escHtml(t('party.admin.addGuestEmailPh'))}"
                 aria-label="${escHtml(t('party.admin.addGuestEmailPh'))}" />
          <select id="party-admin-add-guest-status" class="lol-input party-admin__add-guest-status-sel"
                  aria-label="${escHtml(t('adminOrders.status'))}">
            ${statusOpts.map(([v, l]) => `<option value="${v}"${v === 'going' ? ' selected' : ''}>${l}</option>`).join('')}
          </select>
          <label class="party-admin__add-guest-invite">
            <input type="checkbox" id="party-admin-add-guest-invite" />
            ${t('party.admin.addGuestSendInvite')}
          </label>
          <button type="submit" class="lol-btn lol-btn--primary">${t('party.admin.addGuestBtn')}</button>
          <span class="party-admin__add-guest-status" id="party-admin-add-guest-status-msg" aria-live="polite"></span>
        </form>
      </section>`;
  }

  _renderStats() {
    const rsvps = this._rsvps;
    const headcount = rsvps.filter(r => r.attending).length;

    // Try to derive day/evening/both from a field that looks like attendance timing
    const attendField = this._attendField();

    let breakdownCards = '';
    if (attendField) {
      const tally = {};
      (attendField.options || []).forEach(opt => { tally[this._optLabel(opt)] = 0; });
      rsvps.forEach(r => {
        for (const label of this._answerLabels(r.answers?.[attendField.id])) {
          tally[label] = (tally[label] || 0) + 1;
        }
      });
      // Collect EVERY tally label matching `pred`, not just the first hit. Two
      // reasons: cross-locale answers ("Já, aðeins á daginn" + "☀️ Daytime
      // only") belong to one card, and the loaded form's own labels are seeded
      // at 0 — a first-hit picker would return that 0 and report an empty card
      // while the real answers sat one key later.
      const pickWhere = (pred) => {
        const labels = [];
        let count = 0;
        for (const [opt, n] of Object.entries(tally)) {
          if (!pred(opt)) continue;
          labels.push(opt);
          count += n;
        }
        return { labels, count };
      };
      // The card carries every label it counted, so the drill-down modal shows
      // exactly the guests the number claims.
      const breakdownCard = (match, labelHtml, title, modifierClass = '') => {
        const dataAttrs = match.labels.length
          ? `data-stat-key="field:${escHtml(attendField.id)}" data-stat-field="${escHtml(attendField.id)}" data-stat-values="${escHtml(JSON.stringify(match.labels))}" data-stat-title="${escHtml(title)}" data-stat-multi="${attendField.type === 'checkbox-group'}"`
          : `data-stat-key="empty"`;
        const cls = 'party-admin__stat party-admin__stat--sm' + (modifierClass ? ' ' + modifierClass : '');
        return `
        <button type="button" class="${cls}" ${dataAttrs}>
          <span class="party-admin__stat-num">${match.count}</span>
          <span class="party-admin__stat-label">${labelHtml}</span>
        </button>`;
      };
      const day      = pickWhere(o => this._answerTimingBucket(o) === 'day');
      const evening  = pickWhere(o => this._answerTimingBucket(o) === 'evening');
      const both     = pickWhere(o => this._answerTimingBucket(o) === 'both');
      const declined = pickWhere(o => this._answerStatus(o) === 'declined');
      const dayT = t('party.admin.dayOnly'), evgT = t('party.admin.eveningOnly'),
            bothT = t('party.admin.both'),   decT = t('party.admin.statusDeclined');
      breakdownCards = [
        breakdownCard(day,      `☀️ ${dayT}`,  `☀️ ${dayT}`),
        breakdownCard(evening,  `🌙 ${evgT}`,  `🌙 ${evgT}`),
        breakdownCard(both,     `🎉 ${bothT}`, `🎉 ${bothT}`),
        breakdownCard(declined, decT,          decT, 'party-admin__stat--muted'),
      ].join('');
    }

    return `
      <section class="party-admin__section">
        <h2 class="party-admin__section-title">${t('party.admin.stats')}</h2>
        <div class="party-admin__stats party-admin__stats--compact">
          <button type="button" class="party-admin__stat party-admin__stat--sm" data-stat-key="all">
            <span class="party-admin__stat-num">${rsvps.length}</span>
            <span class="party-admin__stat-label">${t('party.admin.rsvpsSubmitted')}</span>
          </button>
          ${breakdownCards}
          <button type="button" class="party-admin__stat party-admin__stat--sm party-admin__stat--gold" data-stat-key="headcount">
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
        <details class="party-admin__declined-details">
          <summary class="party-admin__declined-summary">
            <span class="party-admin__pill">📋 ${t('party.admin.totalRsvpsSummary', { n: this._rsvps.length })}</span>
          </summary>
          <div class="party-admin__table-wrap party-admin__declined-table-wrap">
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
        </details>
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

    const groupBlocks = groups.map(g => {
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
        <button type="button" class="party-admin__stat party-admin__stat--sm"
                data-stat-key="field:${escHtml(g.id)}:${escHtml(name)}"
                data-stat-field="${escHtml(g.id)}"
                data-stat-value="${escHtml(name)}"
                data-stat-multi="${multi}"
                aria-label="${escHtml(name)}: ${count}. ${t('party.admin.statClickHint')}">
          <span class="party-admin__stat-num">${count}</span>
          <span class="party-admin__stat-label">${escHtml(name)}</span>
        </button>`).join('');
      return `
        <div class="party-admin__tally-group">
          <h3 class="party-admin__tally-title">${escHtml(g.label || 'Tally')}</h3>
          <div class="party-admin__stats party-admin__stats--compact">${items}</div>
        </div>`;
    }).join('');

    return `
      <section class="party-admin__section">
        <h2 class="party-admin__section-title">${t('party.admin.answerTallies')}</h2>
        ${groupBlocks}
      </section>`;
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
    this._bindAddGuest();
    this._bindPendingRequests();
    this._bindInvitedGuests();
    this._bindGuestsSort();
    this._bindLogistics();
    this._bindCosts();
    this._bindTodos();
    this._bindStatCards();
    this._bindEmailGoing();
    this._bindRsvpSort();
    this._applyColWidths();
  }

  _bindGuestsSort() {
    const thead = this._el.querySelector('#party-admin-accepted-pending thead');
    if (!thead) return;
    const handler = (e) => {
      // Clicks that start on a column-resize grip are drags, not sorts.
      if (e.target.closest?.('[data-col-grip]')) return;
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
    this._applyColWidths();
  }

  // Swap ONLY the attendance tbody + result counter — used by the name-filter
  // box so the input keeps focus and caret while the user types. Pills, header
  // and column widths stay untouched; row-level handlers re-bind on the fresh
  // rows (their `bound` guards make that idempotent).
  _refreshGuestTbody() {
    const section = this._el.querySelector('#party-admin-accepted-pending');
    const tbody   = section?.querySelector('tbody');
    if (!tbody) return;
    const showRevoke = isAdmin();
    const guests  = (this._invitedGuests || []).filter(g => g.rsvp_status !== 'declined');
    const visible = this._filterGuests(guests);
    const sorted  = this._sortInvitedGuests(visible);
    tbody.innerHTML = this._guestRowsHtml(sorted, showRevoke, guests.length > 0);
    this._bindGuestRows();

    const countEl = section.querySelector('[data-guest-filter-count]');
    if (countEl) {
      countEl.textContent = t('party.admin.filterShowing', { x: sorted.length, y: guests.length });
      countEl.hidden = !this._guestFilterActive();
    }
  }

  // ── Column resize (attendance table only) ────────────────────────────────
  // Injects a drag grip into each header cell (except the narrow Actions
  // column) and re-applies persisted widths. Called after every render or
  // section re-render — grip injection is idempotent per fresh <th>.
  _applyColWidths() {
    const table = this._el.querySelector('#party-admin-accepted-pending table');
    if (!table) return;
    const ths = [...table.querySelectorAll('thead th')];

    // Stored widths only apply when the column count matches (admin vs
    // moderator see different columns; stale arrays are ignored).
    if (Array.isArray(this._guestColWidths) && this._guestColWidths.length === ths.length) {
      table.style.tableLayout = 'fixed';
      ths.forEach((th, i) => {
        const w = Number(this._guestColWidths[i]);
        if (w > 0) th.style.width = `${w}px`;
      });
    }

    ths.forEach((th, i) => {
      if (th.querySelector('[data-col-grip]')) return;
      if (i === ths.length - 1) return; // last column takes the leftover space
      const grip = document.createElement('span');
      grip.className = 'party-admin__col-grip';
      grip.setAttribute('data-col-grip', '');
      grip.setAttribute('aria-hidden', 'true');
      // Grip interactions must never reach the sortable-header handler.
      grip.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
      grip.addEventListener('pointerdown', (e) => this._startColResize(e, table, th));
      th.appendChild(grip);
    });
  }

  _startColResize(e, table, th) {
    e.preventDefault();
    e.stopPropagation();
    const ths = [...table.querySelectorAll('thead th')];
    const index = ths.indexOf(th);
    if (index < 0) return;

    // Freeze the current layout so switching to table-layout:fixed doesn't
    // reshuffle the untouched columns mid-drag.
    const widths = ths.map(el => el.offsetWidth);
    table.style.tableLayout = 'fixed';
    ths.forEach((el, i) => { el.style.width = `${widths[i]}px`; });
    table.classList.add('party-admin__table--resizing');

    const grip   = e.currentTarget;
    const startX = e.clientX;
    const startW = widths[index];
    grip.setPointerCapture?.(e.pointerId);

    const onMove = (ev) => {
      const w = Math.max(60, startW + (ev.clientX - startX));
      th.style.width = `${w}px`;
    };
    const onUp = () => {
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      grip.removeEventListener('pointercancel', onUp);
      table.classList.remove('party-admin__table--resizing');
      this._guestColWidths = ths.map(el => el.offsetWidth);
      try {
        localStorage.setItem('partyAdmin.guestColWidths', JSON.stringify(this._guestColWidths));
      } catch { /* storage full/blocked — widths stay session-only */ }
    };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
    grip.addEventListener('pointercancel', onUp);
  }

  // Same pattern for the Total RSVPs table. The section re-renders on every
  // sort-header click, so the <details> open state must be carried over —
  // otherwise sorting would collapse the table the user is looking at.
  _rerenderRsvpTable() {
    const old = this._el.querySelector('#party-admin-total-rsvps');
    if (!old) return;
    const wasOpen = old.querySelector('details')?.open ?? false;
    const tmp = document.createElement('div');
    tmp.innerHTML = this._renderRsvpTable();
    const next = tmp.firstElementChild;
    const details = next.querySelector('details');
    if (details) details.open = wasOpen;
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
        const multi   = card.dataset.statMulti === 'true';
        // Bucket cards (the timing breakdown) carry every label they counted in
        // data-stat-values; plain option cards carry a single data-stat-value.
        let values;
        try {
          values = card.dataset.statValues
            ? JSON.parse(card.dataset.statValues)
            : [card.dataset.statValue];
        } catch { values = [card.dataset.statValue]; }
        rsvps = this._rsvps.filter(r => {
          const a = r.answers?.[fieldId];
          return multi
            ? Array.isArray(a) && values.some(v => a.includes(v))
            : values.includes(a);
        });
        title = card.dataset.statTitle || values[0];
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
        const priceEl  = form.querySelector('.party-admin__logistics-add-price');
        const toEl     = form.querySelector('.party-admin__logistics-add-assigned');
        const status   = form.querySelector('[data-logistics-status]');
        const name = (nameEl?.value || '').trim();
        if (!name) { nameEl?.focus(); return; }
        // badInput number fields report '' but display junk — sending null
        // would silently drop what the user typed. Make them fix it instead.
        const badEl = [qtyEl, priceEl].find(el => el?.validity?.badInput);
        if (badEl) { badEl.focus(); badEl.select?.(); return; }
        if (status) status.textContent = t('form.saving');
        try {
          const headers = await getCsrfHeaders();
          const res = await fetch('/api/v1/party/logistics', {
            method:      'POST',
            credentials: 'include',
            headers,
            body: JSON.stringify({
              name,
              quantity:    (qtyEl?.value   || '').trim() === '' ? null : Number(qtyEl.value),
              unit_price:  (priceEl?.value || '').trim() === '' ? null : Math.round(Number(priceEl.value)),
              assigned_to: (toEl?.value    || '').trim() || null,
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

    // Inline cell editing — auto-save on 'change' (fires on blur for text
    // inputs; number inputs also fire per spinner/arrow step — the save-token
    // in _saveLogisticsCell keeps rapid bursts from applying stale responses).
    // Enter saves and jumps to the next row's name input (or the add-item
    // name input if there is no next row).
    section.querySelectorAll('input.party-admin__logistics-cell-input[data-logistics-id]').forEach(input => {
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

  // Save a single cell edit. No-op if the value is unchanged. On failure
  // (empty name, network error, etc.) reverts the input value. Quantity and
  // unit_price are numeric — sent as numbers (or null when cleared); on
  // success the row's line-cost cell, the category subtotal, and the Cost
  // overview section are updated in place so focus is never lost.
  async _saveLogisticsCell(input) {
    const field   = input.dataset.field;
    const numeric = field === 'quantity' || field === 'unit_price';
    // A number input holding unparseable text ("24e", "2 kassar", Firefox
    // free-typing) reports value === '' while still DISPLAYING the junk —
    // treating that as "cleared" would silently NULL the saved value. Revert.
    if (numeric && input.validity && input.validity.badInput) {
      input.value = input.dataset.lastSaved ?? input.defaultValue ?? '';
      return;
    }
    const value = input.value.trim();
    const last  = input.dataset.lastSaved !== undefined
      ? input.dataset.lastSaved
      : (input.defaultValue ?? '');
    if (value === last) return;
    if (numeric && value !== '' && !Number.isFinite(Number(value))) {
      input.value = last;
      return;
    }

    const id = input.dataset.logisticsId;
    input.dataset.lastSaved = value;
    // Number inputs fire 'change' per spinner click / arrow step, so several
    // saves can be in flight; only the latest may apply its response.
    const token = (Number(input.dataset.saveToken) || 0) + 1;
    input.dataset.saveToken = String(token);
    const body = value === ''
      ? null
      : (field === 'unit_price' ? Math.round(Number(value))
        : field === 'quantity' ? Number(value)
        : value);

    try {
      const headers = await getCsrfHeaders();
      const res = await fetch(`/api/v1/party/logistics/${encodeURIComponent(id)}`, {
        method:      'PATCH',
        credentials: 'include',
        headers,
        body: JSON.stringify({ [field]: body }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || t('party.admin.logisticsUpdateFailed'));
      }
      const updated = await res.json();
      if (Number(input.dataset.saveToken) !== token) return; // superseded by a newer save
      this._logistics = (this._logistics || []).map(i =>
        String(i.id) === String(updated.id) ? updated : i
      );
      // Keep the delete-button's confirm dialog in sync with the new name.
      if (field === 'name') {
        const row = input.closest('tr');
        const del = row?.querySelector('[data-logistics-delete]');
        if (del) del.dataset.logisticsName = value;
      }
      if (numeric) {
        const costCell = input.closest('tr')?.querySelector('[data-line-cost]');
        if (costCell) {
          const c = this._lineCost(updated);
          costCell.textContent = c == null ? '—' : this._fmtIsk(c);
        }
        this._updateLogisticsSubtotal(updated.category || 'other');
        this._rerenderCosts();
      } else if (field === 'quantity_note' || field === 'name') {
        this._rerenderCosts();
      }
    } catch (err) {
      if (Number(input.dataset.saveToken) !== token) return; // a newer save owns the input
      input.value = last;
      input.dataset.lastSaved = last;
      showToast(err.message || t('party.admin.logisticsUpdateFailed'), 'error');
    }
  }

  // In-place refresh of one category's tfoot subtotal (called after an inline
  // numeric edit — a full re-render would blur the input mid-typing flow).
  _updateLogisticsSubtotal(catKey) {
    const sub  = this._categorySubtotal(catKey);
    const cell = this._el.querySelector(`[data-logistics-subtotal="${CSS.escape(catKey)}"]`);
    if (cell) cell.textContent = this._subtotalLabel(sub.sum);
    const noteCell = this._el.querySelector(`[data-logistics-subtotal-note="${CSS.escape(catKey)}"]`);
    if (noteCell) {
      noteCell.innerHTML = sub.missing > 0
        ? `<span class="party-admin__cost-missing">${t('party.admin.costNoPrice', { n: sub.missing })}</span>`
        : '';
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
    this._rerenderCosts();
  }

  // ── Cost overview ────────────────────────────────────────────────────────────
  // Aggregates every priced logistics item and todo into per-group breakdowns
  // and a grand total, so the final bill is never a surprise. Unpriced items
  // count as 0 but are surfaced via the "{n} without a price" hint.

  // The cost groups: one per logistics section + a pseudo-group for todos
  // (client-side only — never written to logistics). `addable` marks the groups
  // that can take a manual line; todos can't, because a todo is a task that may
  // happen to cost money, not a cost line.
  _costGroups() {
    const groups = this._logisticsCategories().map(c => ({
      key: c.key, icon: c.icon, label: c.label,
      addable: true, isBuiltin: c.isBuiltin,
      items: (this._logistics || [])
        .filter(i => (i.category || 'other') === c.key)
        .map(i => ({
          // id + quantity + unit_price ride along so the card can edit and
          // delete lines in place — the card is a second editing surface over
          // the same logistics rows, not a separate store.
          id: i.id,
          quantity: i.quantity,
          unit_price: i.unit_price,
          name: i.name || '',
          detail: this._costDetail(i),
          cost: this._lineCost(i),
          // Warn only on partially priced rows (see _categorySubtotal).
          partial: (i.quantity == null) !== (i.unit_price == null),
        })),
    }));
    groups.push({
      key: 'todos', icon: '✅', label: t('party.admin.costGroupTodos'),
      addable: false, isBuiltin: true,
      // A costless todo ("call the venue") is normal, not a warning.
      items: (this._todos || []).map(td => ({ name: td.title || '', detail: '', cost: td.cost ?? null, partial: false })),
    });
    return groups;
  }

  // The "2 kg × ISK 2,900" hint under a cost line. A manual line is stored as
  // qty 1 × the amount (see _bindCosts), so spelling that out would render a
  // noisy "1 × ISK 50,000" where the planner just entered a lump sum — an
  // unqualified quantity of exactly 1 carries no information, so it stays quiet.
  _costDetail(i) {
    if (i.quantity == null || i.unit_price == null) return i.quantity_note || '';
    if (Number(i.quantity) === 1 && !i.quantity_note) return '';
    return `${i.quantity}${i.quantity_note ? ` ${i.quantity_note}` : ''} × ${this._fmtIsk(i.unit_price)}`;
  }

  _renderCostSection() {
    const groups = this._costGroups();
    const groupSum = (g) => g.items.reduce((s, x) => s + (x.cost ?? 0), 0);
    const grand = groups.reduce((s, g) => s + groupSum(g), 0);
    const anyPriced = groups.some(g => g.items.some(x => x.cost != null));

    const tile = (num, label, extraCls = '') => `
          <div class="party-admin__stat party-admin__stat--sm${extraCls ? ' ' + extraCls : ''}">
            <span class="party-admin__stat-num">${num}</span>
            <span class="party-admin__stat-label">${label}</span>
          </div>`;

    const groupCards = groups.map(g => {
      const missing = g.items.filter(x => x.partial).length;
      const sorted = [...g.items].sort((a, b) => {
        if (a.cost == null && b.cost == null) return 0;
        if (a.cost == null) return 1;
        if (b.cost == null) return -1;
        return b.cost - a.cost;
      });
      // Todos lines stay read-only (a todo is a task, edited in its own
      // section); logistics-backed lines are editable in place. The amount is
      // only editable on lump sums — qty 1 or unpriced — because on a
      // "100 × ISK 45" row an amount edit would be ambiguous (change qty?
      // price?); those keep the computed total and are edited in the 🛒 table.
      const rows = sorted.map(x => {
        if (!g.addable) return `
            <li class="party-admin__cost-item${x.cost == null ? ' party-admin__cost-item--unpriced' : ''}">
              <span>${escHtml(x.name)}${x.detail ? ` <small>${escHtml(x.detail)}</small>` : ''}</span>
              <span>${x.cost == null ? '—' : this._fmtIsk(x.cost)}</span>
            </li>`;
        const id = escHtml(String(x.id));
        const amountEditable = x.quantity == null || Number(x.quantity) === 1;
        const amount = amountEditable ? `
              <input type="number" min="0" step="1" class="party-admin__cost-item-input party-admin__cost-item-amount"
                     data-cost-item-id="${id}" data-cost-field="amount"
                     value="${x.unit_price == null ? '' : escHtml(String(x.unit_price))}" placeholder="—"
                     aria-label="${t('party.admin.costItemAmount')}" />`
          : `<span class="party-admin__cost-item-total">${x.cost == null ? '—' : this._fmtIsk(x.cost)}</span>`;
        return `
            <li class="party-admin__cost-item${x.cost == null ? ' party-admin__cost-item--unpriced' : ''}">
              <span class="party-admin__cost-item-main">
                <input type="text" class="party-admin__cost-item-input party-admin__cost-item-name"
                       data-cost-item-id="${id}" data-cost-field="name"
                       value="${escHtml(x.name)}" maxlength="200" required
                       aria-label="${t('party.admin.costItemName')}" />
                ${x.detail ? `<small>${escHtml(x.detail)}</small>` : ''}
              </span>
              ${amount}
              <button type="button" class="party-admin__cost-del" data-cost-item-del="${id}"
                      data-cost-item-name="${escHtml(x.name)}"
                      title="${t('party.admin.costItemDel')}"
                      aria-label="${escHtml(t('party.admin.costItemDelAria', { name: x.name }))}">✕</button>
            </li>`;
      }).join('');
      // A manual line writes a real logistics item, so it shows up in the 🛒
      // tables too — one cost lives in exactly one place.
      const addForm = g.addable ? `
          <form class="party-admin__cost-add" data-cost-add="${escHtml(g.key)}" novalidate>
            <input type="text" class="lol-input party-admin__cost-add-name"
                   placeholder="${escHtml(t('party.admin.costAddNamePh'))}"
                   maxlength="200"
                   aria-label="${t('party.admin.costAddName')}" />
            <input type="number" min="0" step="1" class="lol-input party-admin__cost-add-amount"
                   placeholder="${escHtml(t('party.admin.costAddAmountPh'))}"
                   aria-label="${t('party.admin.costAddAmount')}" />
            <button type="submit" class="lol-btn lol-btn--ghost lol-btn--sm">${t('party.admin.costAddLine')}</button>
            <span class="party-admin__logistics-status" data-cost-status="${escHtml(g.key)}" aria-live="polite"></span>
          </form>` : '';

      // Built-ins have no delete button: 'other' is where a deleted section's
      // items land, and food/drinks anchor the i18n names.
      const del = (g.addable && !g.isBuiltin) ? `
            <button type="button" class="party-admin__cost-del" data-cost-del="${escHtml(g.key)}"
                    title="${t('party.admin.costDelSection')}"
                    aria-label="${escHtml(t('party.admin.costDelSectionAria', { name: g.label }))}">✕</button>` : '';

      // Rename works on built-ins too: a saved label overrides the i18n name
      // (the planner asked for that exact text), and clearing it hands the
      // name back to i18n. See _openCostRename.
      const rename = g.addable ? `
            <button type="button" class="party-admin__cost-rename" data-cost-rename="${escHtml(g.key)}"
                    title="${t('party.admin.costRenameSection')}"
                    aria-label="${escHtml(t('party.admin.costRenameSectionAria', { name: g.label }))}">✎</button>` : '';

      return `
        <div class="party-admin__cost-group">
          <h3 data-cost-head="${escHtml(g.key)}">${escHtml(g.icon)} ${escHtml(g.label)}${rename} <span>${this._fmtIsk(groupSum(g))}</span>${del}</h3>
          ${g.items.length ? `<ol class="party-admin__cost-list">${rows}</ol>` : `<p class="party-empty">${t('party.admin.logisticsNoItems')}</p>`}
          ${missing > 0 ? `<p class="party-admin__cost-missing">${t('party.admin.costNoPrice', { n: missing })}</p>` : ''}
          ${addForm}
        </div>`;
    }).join('');

    return `
      <section class="party-admin__section" id="party-admin-costs">
        <h2 class="party-admin__section-title">💰 ${t('party.admin.costTitle')}</h2>
        <p class="party-admin__logistics-help">${t('party.admin.costHelp')}</p>
        ${anyPriced ? `
        <div class="party-admin__stats party-admin__stats--compact">
          ${tile(this._fmtIsk(grand), t('party.admin.costGrandTotal'), 'party-admin__stat--gold')}
          ${groups.map(g => tile(this._fmtIsk(groupSum(g)), `${escHtml(g.icon)} ${escHtml(g.label)}`)).join('')}
        </div>` : `<p class="party-empty">${t('party.admin.costEmpty')}</p>`}
        <div class="party-admin__cost-groups">${groupCards}</div>
        <form class="party-admin__cost-add-section" id="party-admin-cost-add-section" novalidate>
          <input type="text" class="lol-input party-admin__cost-section-icon"
                 placeholder="🎈" maxlength="8"
                 aria-label="${t('party.admin.costSectionIcon')}" />
          <input type="text" class="lol-input party-admin__cost-section-label"
                 placeholder="${escHtml(t('party.admin.costSectionNamePh'))}"
                 maxlength="60"
                 aria-label="${t('party.admin.costSectionName')}" />
          <button type="submit" class="lol-btn lol-btn--primary lol-btn--sm">${t('party.admin.costAddSection')}</button>
          <span class="party-admin__logistics-status" id="party-admin-cost-section-status" aria-live="polite"></span>
        </form>
      </section>`;
  }

  // Replace-in-place. The section carries its own forms now, so the fresh node
  // has to be re-bound — a plain replaceWith would leave dead buttons behind.
  //
  // Focus survives the rebuild: cost-line inputs are identified by a stable
  // (item id, field) pair, so if the admin is mid-edit when a save — theirs or
  // a logistics-table one — triggers this, the same input is refocused in the
  // fresh DOM. The row may still jump visually (cards sort cost-descending);
  // the id-based lookup follows it. An open rename form is NOT preserved — it
  // is ephemeral by design and a concurrent rebuild simply discards it.
  _rerenderCosts() {
    const old = this._el.querySelector('#party-admin-costs');
    if (!old) return;
    const focus = this._captureCostFocus();
    const tmp = document.createElement('div');
    tmp.innerHTML = this._renderCostSection();
    old.replaceWith(tmp.firstElementChild);
    this._bindCosts();
    this._restoreCostFocus(focus);
  }

  // Captured at rebuild time (not save-start): a blur-triggered save can
  // resolve while the admin is already typing in the NEXT input, and it's
  // that input — the currently focused one — that must survive.
  _captureCostFocus() {
    const el = document.activeElement;
    if (!el || !this._el.contains(el) || !el.dataset?.costItemId) return null;
    return {
      id: el.dataset.costItemId, field: el.dataset.costField,
      start: el.selectionStart, end: el.selectionEnd,
    };
  }

  _restoreCostFocus(f) {
    if (!f) return;
    const el = this._el.querySelector(
      `input[data-cost-item-id="${CSS.escape(f.id)}"][data-cost-field="${CSS.escape(f.field)}"]`);
    if (!el) return; // line was deleted or became read-only — nothing to restore
    el.focus();
    // Number inputs throw on setSelectionRange in some browsers.
    try { if (f.start != null) el.setSelectionRange(f.start, f.end); } catch { /* ignore */ }
  }

  _bindCosts() {
    const section = this._el.querySelector('#party-admin-costs');
    if (!section) return;

    // Manual line — name + amount, stored as a real logistics item at qty 1 so
    // it lands in the 🛒 table too and stays editable there (change the qty and
    // it stops being a lump sum, which is exactly right). Both fields are
    // required: a manual line with no amount would post qty-without-price and
    // trip the "{n} without a price" warning the planner is trying to clear.
    section.querySelectorAll('form[data-cost-add]').forEach(form => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const category = form.dataset.costAdd;
        const nameEl   = form.querySelector('.party-admin__cost-add-name');
        const amtEl    = form.querySelector('.party-admin__cost-add-amount');
        const status   = form.querySelector('[data-cost-status]');
        const name = (nameEl?.value || '').trim();
        if (!name) { nameEl?.focus(); return; }
        // badInput reports '' while showing junk ("12e") — don't silently drop it.
        if (amtEl?.validity?.badInput) { amtEl.focus(); amtEl.select?.(); return; }
        if ((amtEl?.value || '').trim() === '') { amtEl?.focus(); return; }

        if (status) status.textContent = t('form.saving');
        try {
          const headers = await getCsrfHeaders();
          const res = await fetch('/api/v1/party/logistics', {
            method:      'POST',
            credentials: 'include',
            headers,
            body: JSON.stringify({
              name,
              quantity:   1,
              unit_price: Math.round(Number(amtEl.value)),
              category,
            }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || t('party.admin.logisticsAddFailed'));
          }
          const item = await res.json();
          this._logistics = [...(this._logistics || []), item];
          this._rerenderLogistics();   // also re-renders (and re-binds) costs
          this._el.querySelector(`form[data-cost-add="${category}"] .party-admin__cost-add-name`)?.focus();
        } catch (err) {
          if (status) status.textContent = err.message || t('party.admin.logisticsAddFailed');
        }
      });
    });

    // Add a section. The server derives the key from the label, so the client
    // sends only what the planner typed.
    const secForm = section.querySelector('#party-admin-cost-add-section');
    secForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const iconEl  = secForm.querySelector('.party-admin__cost-section-icon');
      const labelEl = secForm.querySelector('.party-admin__cost-section-label');
      const status  = secForm.querySelector('#party-admin-cost-section-status');
      const label = (labelEl?.value || '').trim();
      if (!label) { labelEl?.focus(); return; }

      if (status) status.textContent = t('form.saving');
      try {
        const headers = await getCsrfHeaders();
        const res = await fetch('/api/v1/party/logistics/categories', {
          method:      'POST',
          credentials: 'include',
          headers,
          body: JSON.stringify({ label, icon: (iconEl?.value || '').trim() || null }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || t('party.admin.costSectionAddFailed'));
        }
        const cat = await res.json();
        this._logisticsCats = [...(this._logisticsCats || []), cat];
        this._rerenderLogistics();   // new section needs its own 🛒 table too
        this._el.querySelector(`form[data-cost-add="${cat.key}"] .party-admin__cost-add-name`)?.focus();
      } catch (err) {
        if (status) status.textContent = err.message || t('party.admin.costSectionAddFailed');
      }
    });

    // Delete a section. Items are not deleted — the FK sweeps them into 'other'
    // (068), so the confirm says so rather than implying the costs go with it.
    section.querySelectorAll('[data-cost-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const key = btn.dataset.costDel;
        const cat = (this._logisticsCats || []).find(c => c.key === key);
        const name = cat?.label || key;
        const n = (this._logistics || []).filter(i => (i.category || 'other') === key).length;
        const msg = n > 0
          ? t('party.admin.costDelSectionConfirmItems', { name, n })
          : t('party.admin.costDelSectionConfirm', { name });
        if (!confirm(msg)) return;

        try {
          const headers = await getCsrfHeaders();
          const res = await fetch(`/api/v1/party/logistics/categories/${encodeURIComponent(key)}`, {
            method: 'DELETE', credentials: 'include', headers,
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || t('party.admin.costSectionDelFailed'));
          }
          this._logisticsCats = (this._logisticsCats || []).filter(c => c.key !== key);
          // Mirror the FK's ON DELETE SET DEFAULT locally so the items reappear
          // under Other without a refetch.
          this._logistics = (this._logistics || [])
            .map(i => ((i.category || 'other') === key ? { ...i, category: 'other' } : i));
          this._rerenderLogistics();
        } catch (err) {
          showToast(err.message || t('party.admin.costSectionDelFailed'), 'error');
        }
      });
    });

    // Inline edit of a cost line (name always; amount on lump sums only).
    // Enter commits without waiting for blur; preventDefault is belt-and-braces
    // (the inputs live in an <li>, not a form, so Enter can't submit anything).
    section.querySelectorAll('input[data-cost-item-id]').forEach(input => {
      input.addEventListener('change', () => this._saveCostLine(input));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); this._saveCostLine(input); }
      });
    });

    // Delete a cost line — the same logistics item the 🛒 table would delete,
    // so the confirm + failure strings are the table's own.
    section.querySelectorAll('[data-cost-item-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id   = btn.dataset.costItemDel;
        const name = btn.dataset.costItemName || '';
        if (!confirm(t('party.admin.logisticsConfirmDelete', { name }))) return;
        btn.disabled = true;
        try {
          const headers = await getCsrfHeaders();
          const res = await fetch(`/api/v1/party/logistics/${encodeURIComponent(id)}`, {
            method: 'DELETE', credentials: 'include', headers,
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

    // Rename a section (label + icon) — wires the PATCH endpoint that has
    // existed since 068 but had no UI.
    section.querySelectorAll('[data-cost-rename]').forEach(btn => {
      btn.addEventListener('click', () => this._openCostRename(btn.dataset.costRename));
    });
  }

  // Save a cost-card line edit. Mirrors _saveLogisticsCell: badInput guard,
  // lastSaved no-op check, save token against overlapping spinner-step saves.
  // The amount field writes unit_price; on a previously unpriced line it also
  // sets quantity to 1, so a bare name added in the 🛒 table can be priced as
  // a lump sum from the card. Clearing the amount nulls unit_price only — the
  // line goes partial and the "{n} without a price" hint surfaces it.
  async _saveCostLine(input) {
    const field  = input.dataset.costField;
    const isAmt  = field === 'amount';
    if (isAmt && input.validity && input.validity.badInput) {
      // '' value while junk is displayed — revert rather than silently null.
      input.value = input.dataset.lastSaved ?? input.defaultValue ?? '';
      return;
    }
    const value = input.value.trim();
    const last  = input.dataset.lastSaved !== undefined
      ? input.dataset.lastSaved
      : (input.defaultValue ?? '');
    if (value === last) return;
    if (isAmt && value !== '' && !Number.isFinite(Number(value))) {
      input.value = last;
      return;
    }
    if (field === 'name' && value === '') {
      // Server rejects empty names; match the table idiom and revert locally.
      input.value = last;
      return;
    }

    const id = input.dataset.costItemId;
    const item = (this._logistics || []).find(i => String(i.id) === String(id));
    if (!item) return; // deleted concurrently — the pending rebuild will drop this input

    input.dataset.lastSaved = value;
    const token = (Number(input.dataset.saveToken) || 0) + 1;
    input.dataset.saveToken = String(token);
    const body = field === 'name'
      ? { name: value }
      : value === ''
        ? { unit_price: null }
        : { unit_price: Math.round(Number(value)), ...(item.quantity == null ? { quantity: 1 } : {}) };

    try {
      const headers = await getCsrfHeaders();
      const res = await fetch(`/api/v1/party/logistics/${encodeURIComponent(id)}`, {
        method:      'PATCH',
        credentials: 'include',
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || t('party.admin.logisticsUpdateFailed'));
      }
      const updated = await res.json();
      if (Number(input.dataset.saveToken) !== token) return; // superseded
      this._logistics = (this._logistics || []).map(i =>
        String(i.id) === String(updated.id) ? updated : i
      );
      // Full logistics rebuild: the 🛒 table renders its inputs' value= from
      // _logistics, so this one call syncs name/price/line-cost/subtotal there
      // AND cascades into _rerenderCosts, whose focus capture keeps the admin
      // in this input (found again by its stable id+field).
      this._rerenderLogistics();
    } catch (err) {
      if (Number(input.dataset.saveToken) !== token) return; // a newer save owns the input
      input.value = last;
      input.dataset.lastSaved = last;
      showToast(err.message || t('party.admin.logisticsUpdateFailed'), 'error');
    }
  }

  // Swap a cost card's heading for an icon+label edit form. Explicit
  // Save/Cancel (+ Enter/Escape) — no save-on-blur, because two inputs and two
  // buttons would make blur-commit fire on every internal tab.
  //
  // Built-ins open with an empty label input and the translated name as
  // placeholder: emptiness visibly means "default". Saving a label on a
  // built-in stores that literal text (overrides i18n in BOTH locales, since
  // the planner asked for that exact name); clearing it sends label:null,
  // which hands the name back to i18n. A custom section with an emptied label
  // just refocuses — the server would 400 on a nameless section.
  _openCostRename(key) {
    // Need the RAW DB row (literal label or null), not the resolved display
    // row — resolving would bake the translated name into a built-in's label.
    const cat = (this._logisticsCats || []).find(c => c.key === key);
    if (!cat) { showToast(t('party.admin.costRenameFailed'), 'error'); return; }
    const resolved = this._logisticsCategories().find(c => c.key === key);
    const h3 = this._el.querySelector(`[data-cost-head="${CSS.escape(key)}"]`);
    if (!h3) return;

    h3.innerHTML = `
          <form class="party-admin__cost-rename-form" novalidate>
            <input type="text" class="lol-input party-admin__cost-section-icon"
                   value="${escHtml(cat.icon || '')}" maxlength="8" placeholder="📦"
                   aria-label="${t('party.admin.costSectionIcon')}" />
            <input type="text" class="lol-input party-admin__cost-rename-label"
                   value="${escHtml(cat.label || '')}" maxlength="60"
                   placeholder="${escHtml(resolved?.label || key)}"
                   ${cat.is_builtin ? `title="${escHtml(t('party.admin.costRenameBuiltinHint'))}"` : ''}
                   aria-label="${t('party.admin.costSectionName')}" />
            <button type="submit" class="lol-btn lol-btn--primary lol-btn--sm">${t('party.admin.costRenameSave')}</button>
            <button type="button" class="lol-btn lol-btn--ghost lol-btn--sm" data-rename-cancel>${t('party.admin.costRenameCancel')}</button>
            <span class="party-admin__logistics-status" aria-live="polite"></span>
          </form>`;

    const form    = h3.querySelector('form');
    const iconEl  = form.querySelector('.party-admin__cost-section-icon');
    const labelEl = form.querySelector('.party-admin__cost-rename-label');
    const status  = form.querySelector('.party-admin__logistics-status');

    // Binding on the ephemeral form (outside _bindCosts) is safe: any rebuild
    // discards the form wholesale, listeners and all.
    const close = () => {
      this._rerenderCosts(); // cheapest correct restore of the pristine h3
      this._el.querySelector(`[data-cost-rename="${CSS.escape(key)}"]`)?.focus();
    };
    form.querySelector('[data-rename-cancel]').addEventListener('click', close);
    form.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const label = (labelEl.value || '').trim();
      const icon  = (iconEl.value || '').trim();
      if (!label && !cat.is_builtin) { labelEl.focus(); return; }

      if (status) status.textContent = t('form.saving');
      try {
        const headers = await getCsrfHeaders();
        const res = await fetch(`/api/v1/party/logistics/categories/${encodeURIComponent(key)}`, {
          method:      'PATCH',
          credentials: 'include',
          headers,
          body: JSON.stringify({ label: label || null, icon: icon || null }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || t('party.admin.costRenameFailed'));
        }
        const updated = await res.json();
        this._logisticsCats = (this._logisticsCats || []).map(c => c.key === key ? updated : c);
        // Name/icon appear in the logistics heading + table aria-label, the
        // cost heading, and the stat tiles — the cascade covers all four.
        this._rerenderLogistics();
        this._el.querySelector(`[data-cost-rename="${CSS.escape(key)}"]`)?.focus();
      } catch (err) {
        if (status) status.textContent = err.message || t('party.admin.costRenameFailed');
      }
    });

    labelEl.focus();
    labelEl.select();
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
            <label class="party-admin__todo-cost">
              <span>${t('party.admin.todoCost')}</span>
              <input type="number" min="0" step="1"
                     data-todo-field="cost" data-todo-id="${escHtml(id)}"
                     value="${escHtml(String(todo.cost ?? ''))}" placeholder="—"
                     aria-label="${t('party.admin.todoCost')}" />
            </label>
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

        <details class="party-admin__todo-more" data-todo-more="${escHtml(id)}">
          <summary class="party-admin__todo-more-summary">${t('party.admin.todoDetails')} ${progress}</summary>

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
        </details>
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

  // Inline title/notes/due_date/cost edit on a TODO. Mirrors _saveLogisticsCell:
  // no-op when unchanged, reverts on failure. Title is required.
  async _saveTodoText(input) {
    const field = input.dataset.todoField;       // title | notes | due_date | cost
    const id    = input.dataset.todoId;
    let value;
    if (field === 'due_date') {
      value = input.value || null;
    } else if (field === 'cost') {
      // badInput: the number input shows junk text but reports value === ''
      // — reverting (not clearing) protects the saved cost. See
      // _saveLogisticsCell for the same guard.
      if (input.validity && input.validity.badInput) {
        input.value = input.dataset.lastSaved ?? input.defaultValue ?? '';
        return;
      }
      const raw = input.value.trim();
      if (raw !== '' && !Number.isFinite(Number(raw))) {
        input.value = input.dataset.lastSaved ?? input.defaultValue ?? '';
        return;
      }
      value = raw === '' ? null : Math.round(Number(raw));
    } else {
      value = input.value.trim();
      if (field === 'title' && value === '') {
        input.value = input.dataset.lastSaved ?? input.defaultValue;
        return;
      }
    }
    const lastRaw = input.dataset.lastSaved !== undefined ? input.dataset.lastSaved : input.defaultValue;
    const cur = value == null ? '' : String(value);
    if (cur === (lastRaw ?? '')) return;
    input.dataset.lastSaved = cur;
    // The cost input fires 'change' per spinner/arrow step — token guards
    // against a stale response overwriting a newer save (see _saveLogisticsCell).
    const token = (Number(input.dataset.saveToken) || 0) + 1;
    input.dataset.saveToken = String(token);
    try {
      const updated = await this._todoApi('PATCH', `/api/v1/party/todos/${encodeURIComponent(id)}`, { [field]: value });
      if (Number(input.dataset.saveToken) !== token) return; // superseded by a newer save
      this._patchTodoLocal(id, { [field]: updated[field] }, false);
      if (field === 'title') {
        const del = input.closest('[data-todo-card]')?.querySelector('[data-todo-delete]');
        if (del) del.dataset.todoName = value;
      }
      if (field === 'cost' || field === 'title') this._rerenderCosts();
    } catch (err) {
      if (Number(input.dataset.saveToken) !== token) return; // a newer save owns the input
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
      // "above" means insert-before in list order. On desktop the list is a
      // grid flowing left-to-right, so "before" is judged by the horizontal
      // midpoint (and the CSS shows left/right markers there); in the mobile
      // single column it stays the vertical midpoint.
      const isGrid = getComputedStyle(list).display === 'grid';
      const isBefore = isGrid
        ? (e.clientX - rect.left) < (rect.width / 2)
        : (e.clientY - rect.top) < (rect.height / 2);
      clearMarks();
      card.classList.add(isBefore ? 'party-admin__todo-card--drop-above' : 'party-admin__todo-card--drop-below');
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
    // Preserve which cards have their notes/subtasks panel open — a full
    // re-render happens on every mutation, and losing the open state would
    // slam a panel shut right as the user adds a subtask inside it.
    const openIds = new Set(
      [...old.querySelectorAll('details[data-todo-more][open]')].map(d => d.dataset.todoMore)
    );
    const tmp = document.createElement('div');
    tmp.innerHTML = this._renderTodoSection();
    const next = tmp.firstElementChild;
    next.querySelectorAll('details[data-todo-more]').forEach(d => {
      if (openIds.has(d.dataset.todoMore)) d.open = true;
    });
    old.replaceWith(next);
    this._bindTodos();
    this._rerenderCosts();
  }

  _bindInvitedGuests() {
    this._bindPillDropdowns();
    this._bindPillFilters();
    this._bindGuestFilter();
    this._bindScrollToggle();
    this._bindGuestRows();
  }

  // Scroll-mode checkbox: toggles the fixed-height scroll box (+ pinned header)
  // on the attendance table in place, no reload needed.
  _bindScrollToggle() {
    const cb = this._el.querySelector('#party-admin-scroll-toggle');
    if (!cb || cb.dataset.bound) return;
    cb.dataset.bound = '1';
    cb.addEventListener('change', () => {
      this._guestScroll = cb.checked;
      const wrap = this._el.querySelector('#party-admin-accepted-pending .party-admin__table-wrap');
      wrap?.classList.toggle('party-admin__table-wrap--sticky', cb.checked);
    });
  }

  // Pill click → toggle the table's group filter. Full section re-render so
  // the active pill highlight, rows and result count all update together.
  _bindPillFilters() {
    const section = this._el.querySelector('#party-admin-accepted-pending');
    if (!section) return;
    section.querySelectorAll('[data-pill-filter]').forEach(btn => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        const key = btn.dataset.pillFilter;
        this._guestFilter.group = this._guestFilter.group === key ? null : key;
        this._rerenderAcceptedPending();
      });
    });
  }

  // Debounced name filter (Notendanafn column = display name with username
  // fallback, so both are matched). Refreshes ONLY the tbody so the input
  // keeps focus and caret while the user types.
  _bindGuestFilter() {
    const input = this._el.querySelector('#party-admin-guest-filter');
    if (!input || input.dataset.bound) return;
    input.dataset.bound = '1';
    let timer;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const next = input.value.trim();
        if (next === this._guestFilter.q) return;
        this._guestFilter.q = next;
        this._refreshGuestTbody();
      }, 250);
    });
  }

  // Row-level bindings for the attendance tables. Split out from
  // _bindInvitedGuests so the tbody-only filter refresh can re-bind fresh rows
  // without re-touching the pills/filter controls (whose own `bound` guards
  // would otherwise be pointless — pill buttons survive a tbody swap).
  _bindGuestRows() {
    // Row click → toggle detail expansion. Ignores clicks on interactive
    // controls within the row so inline edits don't also open the details.
    this._el.querySelectorAll('[data-expand-guest]').forEach(row => {
      if (row.dataset.bound) return;
      row.dataset.bound = '1';
      row.addEventListener('click', (e) => {
        if (e.target.closest('button, input, select, textarea, label')) return;
        const id = row.dataset.expandGuest;
        const details = this._el.querySelector(`[data-guest-details="${CSS.escape(id)}"]`);
        if (!details) return;
        details.hidden = !details.hidden;
      });
    });

    // RSVP Stýring: the three companion controls share one delegated change
    // listener on the cell; any change PATCHes the full record.
    this._el.querySelectorAll('[data-companions-for]').forEach(cell => {
      if (cell.dataset.bound) return;
      cell.dataset.bound = '1';
      cell.addEventListener('click', (e) => e.stopPropagation());
      cell.addEventListener('change', async () => {
        const userId  = cell.dataset.companionsFor;
        const plusOne = cell.querySelector('[data-companion-field="plus_one"]')?.checked || false;
        const kcEl    = cell.querySelector('[data-companion-field="kids_count"]');
        const kcRaw   = kcEl?.value ?? '';
        const kids    = kcRaw === '' ? 0 : Number(kcRaw);
        const ages    = cell.querySelector('[data-companion-field="kids_ages"]')?.value.trim() || '';
        // badInput (e.g. "e" typed into the number field) yields NaN — reject
        // locally instead of round-tripping a guaranteed 400.
        if (!Number.isInteger(kids) || kids < 0 || kids > 25) {
          showToast(t('party.admin.companionsFailed'), 'error');
          return;
        }

        const inputs = cell.querySelectorAll('input');
        inputs.forEach(i => { i.disabled = true; });
        try {
          const headers = await getCsrfHeaders();
          const res = await fetch(`/api/v1/party/guests/${encodeURIComponent(userId)}/companions`, {
            method:      'PATCH',
            credentials: 'include',
            headers,
            body:        JSON.stringify({ plus_one: plusOne, kids_count: kids, kids_ages: ages }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || t('party.admin.companionsFailed'));
          }
          showToast(t('party.admin.companionsUpdated'), 'success');
          // Reload so the Maki/Börn pills and the headcount stat pick up the
          // new companion record.
          await this._loadAndRender();
        } catch (err) {
          inputs.forEach(i => { i.disabled = false; });
          showToast(err.message || t('party.admin.companionsFailed'), 'error');
        }
      });
    });

    // Inline attendance-timing edit (admin-only select). Writes answers.attend_when
    // via the merge endpoint; picking "—" clears it.
    this._el.querySelectorAll('[data-timing-for]').forEach(sel => {
      if (sel.dataset.bound) return;
      sel.dataset.bound = '1';
      sel.addEventListener('click', (e) => e.stopPropagation());
      sel.addEventListener('change', async (e) => {
        e.stopPropagation();
        const userId  = sel.dataset.timingFor;
        const fieldId = sel.dataset.field;
        const prev    = sel.dataset.current || '';
        const value   = sel.value;
        if (value === prev) return;

        sel.disabled = true;
        try {
          const headers = await getCsrfHeaders();
          // Keep the stored shape the guest's own form expects: checkbox-group
          // answers are arrays. (Replaces the whole array — the admin's pick is
          // the definitive attendance.)
          const multi = this._attendField()?.type === 'checkbox-group';
          const body = value
            ? { answers: { [fieldId]: multi ? [value] : value } }
            : { answers: {}, clear: [fieldId] };
          const res = await fetch(`/api/v1/party/guests/${encodeURIComponent(userId)}/answers`, {
            method: 'PATCH', credentials: 'include', headers, body: JSON.stringify(body),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || t('party.admin.answersFailed'));
          }
          showToast(t('party.admin.answersUpdated'), 'success');
          // Reload — attend_when drives the derived status and the Stats
          // day/evening/all-day breakdown.
          await this._loadAndRender();
        } catch (err) {
          sel.value    = prev;
          sel.disabled = false;
          showToast(err.message || t('party.admin.answersFailed'), 'error');
        }
      });
    });

    // Inline RSVP-status edit (admin-only select in the status column). The
    // `bound` guard means a partial re-render (e.g. sort) that re-runs this
    // binder won't stack a second listener on selects that already have one.
    this._el.querySelectorAll('[data-rsvp-status-for]').forEach(sel => {
      if (sel.dataset.bound) return;
      sel.dataset.bound = '1';
      // Don't let clicks bubble to the row-expand handler.
      sel.addEventListener('click', (e) => e.stopPropagation());
      sel.addEventListener('change', async (e) => {
        e.stopPropagation();
        const userId = sel.dataset.rsvpStatusFor;
        const prev   = sel.dataset.current;
        const status = sel.value;
        if (status === prev) return;

        sel.disabled = true;
        try {
          const headers = await getCsrfHeaders();
          const res = await fetch(`/api/v1/party/guests/${encodeURIComponent(userId)}/rsvp-status`, {
            method:      'PATCH',
            credentials: 'include',
            headers,
            body:        JSON.stringify({ status }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || t('party.admin.rsvpStatusFailed'));
          }
          showToast(t('party.admin.rsvpStatusUpdated'), 'success');
          // Reload so the guest re-buckets (moves between accepted/declined),
          // pills and counts update — same pattern as the pending-approval flow.
          await this._loadAndRender();
        } catch (err) {
          sel.value    = prev;   // revert the visible selection
          sel.disabled = false;
          showToast(err.message || t('party.admin.rsvpStatusFailed'), 'error');
        }
      });
    });

    // Inline display-name edit (admin-only text input in the Name column).
    this._el.querySelectorAll('[data-guest-name-for]').forEach(inp => {
      if (inp.dataset.bound) return;
      inp.dataset.bound = '1';
      // Clicks in the input shouldn't toggle the row's detail expansion.
      inp.addEventListener('click', (e) => e.stopPropagation());
      inp.addEventListener('change', async () => {
        const userId = inp.dataset.guestNameFor;
        const prev   = inp.dataset.current;
        const value  = inp.value.trim();
        if (value === prev) return;

        inp.disabled = true;
        try {
          const headers = await getCsrfHeaders();
          const res = await fetch(`/api/v1/party/guests/${encodeURIComponent(userId)}/profile`, {
            method:      'PATCH',
            credentials: 'include',
            headers,
            body:        JSON.stringify({ display_name: value }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || t('party.admin.nameFailed'));
          }
          showToast(t('party.admin.nameUpdated'), 'success');
          // Reload so the name propagates to the summary pills, sort order and
          // the declined table's copy of this guest.
          await this._loadAndRender();
        } catch (err) {
          inp.value    = prev;
          inp.disabled = false;
          showToast(err.message || t('party.admin.nameFailed'), 'error');
        }
      });
    });

    // Inline RSVP-answer edit (admin-only form in the expanded detail row).
    this._el.querySelectorAll('[data-guest-answers-form]').forEach(form => {
      if (form.dataset.bound) return;
      form.dataset.bound = '1';
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const userId          = form.dataset.guestAnswersForm;
        const { answers, clear } = this._collectAnswers(form);
        const statusEl        = form.querySelector('.party-admin__answers-status');
        const btn             = form.querySelector('[type="submit"]');

        btn.disabled = true;
        if (statusEl) statusEl.textContent = t('form.saving');
        try {
          const headers = await getCsrfHeaders();
          const res = await fetch(`/api/v1/party/guests/${encodeURIComponent(userId)}/answers`, {
            method:      'PATCH',
            credentials: 'include',
            headers,
            body:        JSON.stringify({ answers, clear }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || t('party.admin.answersFailed'));
          }
          showToast(t('party.admin.answersUpdated'), 'success');
          // Reload so the Bringing column, status derivation and tallies reflect
          // the edited answers.
          await this._loadAndRender();
        } catch (err) {
          if (statusEl) statusEl.textContent = '';
          btn.disabled = false;
          showToast(err.message || t('party.admin.answersFailed'), 'error');
        }
      });
    });

    // Revoke → flip party_access to false, remove the two rows for this guest.
    this._el.querySelectorAll('[data-revoke-user-id]').forEach(btn => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const userId = btn.dataset.revokeUserId;
        const name   = btn.dataset.revokeUserName || 'this guest';
        if (!confirm(t('party.admin.confirmRevoke', { name }))) return;

        btn.disabled = true;
        btn.textContent = '…';   // icon button — spinner-ish glyph, not text
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
          btn.textContent = '✕';
        }
      });
    });
  }

  // Wire the clickable summary pills. Each pill button toggles its own name
  // dropdown; opening one closes the others. The per-button click handlers are
  // (re)attached on every section re-render, while the document-level
  // outside-click / Escape closers are attached once per view instance (guard
  // flag) so re-renders don't stack duplicate global listeners.
  _bindPillDropdowns() {
    const section = this._el.querySelector('#party-admin-accepted-pending');
    if (!section) return;

    const openDropdowns = () =>
      section.querySelectorAll('[data-pill-dropdown]:not([hidden])');
    const closeAll = () => {
      openDropdowns().forEach(d => { d.hidden = true; });
      section.querySelectorAll('[data-pill-group]')
        .forEach(b => b.setAttribute('aria-expanded', 'false'));
    };

    section.querySelectorAll('[data-pill-group]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // don't trip the document outside-click closer
        const key = btn.dataset.pillGroup;
        const dd = section.querySelector(`[data-pill-dropdown="${CSS.escape(key)}"]`);
        if (!dd) return;
        const willOpen = dd.hidden;
        closeAll();
        if (willOpen) {
          dd.hidden = false;
          btn.setAttribute('aria-expanded', 'true');
        }
      });
    });

    // Attach the global closers only once per view instance.
    if (!this._pillGlobalClosersBound) {
      this._pillGlobalClosersBound = true;
      const closeOpen = () => {
        this._el
          .querySelectorAll('#party-admin-accepted-pending [data-pill-dropdown]:not([hidden])')
          .forEach(d => {
            d.hidden = true;
            d.closest('.party-admin__pill-wrap')
              ?.querySelector('[data-pill-group]')
              ?.setAttribute('aria-expanded', 'false');
          });
      };
      // A click anywhere except inside an open dropdown closes it. Pill buttons
      // stopPropagation, so their own clicks never reach here.
      document.addEventListener('click', (e) => {
        if (e.target.closest?.('.party-admin__pill-dropdown')) return;
        closeOpen();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeOpen();
      });
    }
  }

  _bindAddGuest() {
    const form = this._el.querySelector('#party-admin-add-guest-form');
    if (!form) return;
    const nameEl   = form.querySelector('#party-admin-add-guest-name');
    const emailEl  = form.querySelector('#party-admin-add-guest-email');
    const statusEl = form.querySelector('#party-admin-add-guest-status');
    const inviteEl = form.querySelector('#party-admin-add-guest-invite');
    const msgEl    = form.querySelector('#party-admin-add-guest-status-msg');
    const btn      = form.querySelector('[type="submit"]');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name  = (nameEl?.value || '').trim();
      const email = (emailEl?.value || '').trim();
      if (!name) {
        msgEl.textContent = t('party.admin.addGuestNameRequired');
        nameEl?.focus();
        return;
      }
      // The invite is an email — refuse the combination that can't work rather
      // than silently adding the guest with no link sent.
      const invite = !!inviteEl?.checked;
      if (invite && !email) {
        msgEl.textContent = t('party.admin.addGuestInviteNeedsEmail');
        emailEl?.focus();
        return;
      }

      btn.disabled = true;
      msgEl.textContent = t('form.saving');
      try {
        const headers = await getCsrfHeaders();
        const res = await fetch('/api/v1/party/guests', {
          method:      'POST',
          credentials: 'include',
          headers,
          body: JSON.stringify({
            name,
            email:  email || undefined,
            status: statusEl?.value || 'going',
            invite,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || t('party.admin.addGuestFailed'));
        // Report what actually happened: the server only claims `invited` once
        // the magic link is on its way. An invite that was asked for and didn't
        // send is a warning — the guest is on the list either way, but nobody
        // told them, and only this toast would say so.
        if (invite && !data.invited) {
          // 'error' for the accent colour — the add succeeded, but a silently
          // unsent invite is the failure the admin has to act on.
          showToast(t('party.admin.addGuestInviteFailed', { name }), 'error');
        } else {
          showToast(
            data.invited
              ? t('party.admin.addGuestAddedInvited', { name })
              : t('party.admin.addGuestAdded', { name }),
            'success'
          );
        }
        // Reload so the new guest appears in the attendance table with the
        // right status, and the pills/headcount update.
        await this._loadAndRender();
      } catch (err) {
        btn.disabled = false;
        msgEl.textContent = err.message || t('party.admin.addGuestFailed');
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

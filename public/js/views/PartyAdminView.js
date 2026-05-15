import { isAuthenticated, isAdmin, canEdit, adminUpdateUser } from '../services/auth.js';
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
    const [rsvpsRes, infoRes, inviteRes, healthRes, guestsRes, logisticsRes] = await Promise.all([
      fetch('/api/v1/party/rsvps',          { credentials: 'include' }),
      fetch('/api/v1/party/info',           { credentials: 'include' }),
      fetch('/api/v1/party/invite-code',    { credentials: 'include' }),
      fetch('/api/v1/admin/email-health',   { credentials: 'include' }),
      fetch('/api/v1/party/invited-guests', { credentials: 'include' }),
      fetch('/api/v1/party/logistics',      { credentials: 'include' }),
    ]);
    const rsvps     = await rsvpsRes.json();
    const info      = await infoRes.json();
    const invite    = inviteRes.ok ? await inviteRes.json() : { code: '' };
    const health    = healthRes.ok ? await healthRes.json() : null;
    const guests    = guestsRes.ok ? await guestsRes.json() : [];
    const logistics = logisticsRes.ok ? await logisticsRes.json() : [];

    this._rsvps         = Array.isArray(rsvps) ? rsvps : [];
    this._inviteCode    = invite.code || '';
    this._emailHealth   = health;
    this._invitedGuests = Array.isArray(guests) ? guests : [];
    this._logistics     = Array.isArray(logistics) ? logistics : [];
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

        ${this._renderAcceptedAndPending()}
        ${this._renderDeclinedGuests()}
        ${this._renderLogistics()}
        ${this._renderInviteCodeSection()}
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

  _renderLogistics() {
    const all = this._logistics || [];
    const total    = all.length;
    const bought   = all.filter(i => i.bought).length;
    const atVenue  = all.filter(i => i.at_venue).length;

    // Hide-bought is session-only (lives on `this`, not localStorage). Filters
    // the table; the summary pills always reflect true totals.
    const visible = this._hideBought ? all.filter(i => !i.bought) : all;

    const emptyMsg = (this._hideBought && all.length > 0 && visible.length === 0)
      ? t('party.admin.logisticsAllBoughtEmpty')
      : t('party.admin.logisticsNoItems');

    const rows = visible.length
      ? visible.map(i => this._renderLogisticsRow(i)).join('')
      : `<tr><td colspan="7" class="party-empty">${emptyMsg}</td></tr>`;

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
        <form class="party-admin__logistics-add" id="party-admin-logistics-form">
          <input type="text" id="party-admin-logistics-name" class="lol-input"
                 placeholder="${escHtml(t('party.admin.logisticsNamePh'))}"
                 maxlength="200" required
                 aria-label="${t('party.admin.logisticsItem')}" />
          <input type="text" id="party-admin-logistics-qty"
                 class="lol-input party-admin__logistics-qty"
                 placeholder="${escHtml(t('party.admin.logisticsQtyPh'))}"
                 maxlength="100"
                 aria-label="${t('party.admin.logisticsQty')}" />
          <input type="text" id="party-admin-logistics-assigned"
                 class="lol-input party-admin__logistics-assigned"
                 placeholder="${escHtml(t('party.admin.logisticsAssignedPh'))}"
                 maxlength="100"
                 aria-label="${t('party.admin.logisticsAssignedTo')}" />
          <button type="submit" class="lol-btn lol-btn--primary">${t('party.admin.logisticsAdd')}</button>
          <span class="party-admin__logistics-status" id="party-admin-logistics-status" aria-live="polite"></span>
        </form>
        <div class="party-admin__table-wrap">
          <table class="party-admin__table" aria-label="${t('party.admin.logistics')}">
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
            <tbody id="party-admin-logistics-rows">
              ${rows}
            </tbody>
          </table>
        </div>
      </section>`;
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
      <tr data-logistics-row="${escHtml(id)}" class="${rowClasses}" draggable="true">
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

  _renderInviteCodeSection() {
    return `
      <section class="party-admin__section party-admin__invite">
        <h2 class="party-admin__section-title">${t('party.inviteCode')}</h2>
        <p class="party-admin__invite-help">${t('party.admin.inviteHelp')}</p>
        <form class="party-admin__invite-form" id="party-admin-invite-form">
          <input type="text" id="party-admin-invite-input" class="lol-input"
                 value="${escHtml(this._inviteCode)}" maxlength="100" autocomplete="off"
                 aria-label="${t('party.inviteCode')}" />
          <button type="submit" class="lol-btn lol-btn--primary">${t('form.save')}</button>
          <button type="button" class="lol-btn lol-btn--ghost" id="party-admin-invite-copy">${t('party.admin.copy')}</button>
          <span class="party-admin__invite-status" id="party-admin-invite-status" aria-live="polite"></span>
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
    this._bindInviteCodeForm();
    this._bindInvitedGuests();
    this._bindGuestsSort();
    this._bindLogistics();
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

    const form    = section.querySelector('#party-admin-logistics-form');
    const status  = section.querySelector('#party-admin-logistics-status');
    const nameEl  = section.querySelector('#party-admin-logistics-name');
    const qtyEl   = section.querySelector('#party-admin-logistics-qty');
    const toEl    = section.querySelector('#party-admin-logistics-assigned');

    // Add item
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = (nameEl?.value || '').trim();
      if (!name) return;
      status.textContent = t('form.saving');
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
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || t('party.admin.logisticsAddFailed'));
        }
        const item = await res.json();
        this._logistics = [...(this._logistics || []), item];
        // _rerenderLogistics replaces the section, so old input refs are
        // detached. Re-render first, then re-query for focus so the planner
        // can keep typing the next item without clicking.
        this._rerenderLogistics();
        this._el.querySelector('#party-admin-logistics-name')?.focus();
      } catch (err) {
        status.textContent = err.message || t('party.admin.logisticsAddFailed');
      }
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
    // No more rows — jump to the add-item name input.
    const addInput = this._el.querySelector('#party-admin-logistics-name');
    addInput?.focus();
  }

  _bindLogisticsDrag(section) {
    const tbody = section.querySelector('#party-admin-logistics-rows');
    if (!tbody) return;
    let draggedId = null;

    const clearDropMarkers = () => {
      tbody.querySelectorAll(
        '.party-admin__logistics-row--drop-above, .party-admin__logistics-row--drop-below'
      ).forEach(r => r.classList.remove(
        'party-admin__logistics-row--drop-above',
        'party-admin__logistics-row--drop-below'
      ));
    };

    tbody.addEventListener('dragstart', (e) => {
      // Block drag from anything other than the handle so users can still
      // select text inside cell inputs without accidentally starting a drag.
      const handle = e.target.closest?.('.party-admin__logistics-handle');
      if (!handle) {
        e.preventDefault();
        return;
      }
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

    tbody.addEventListener('dragover', (e) => {
      if (!draggedId) return;
      const row = e.target.closest('tr[data-logistics-row]');
      if (!row || row.dataset.logisticsRow === draggedId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      const rect    = row.getBoundingClientRect();
      const isAbove = (e.clientY - rect.top) < (rect.height / 2);
      clearDropMarkers();
      row.classList.add(isAbove
        ? 'party-admin__logistics-row--drop-above'
        : 'party-admin__logistics-row--drop-below');
    });

    tbody.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (!draggedId) return;
      const row = e.target.closest('tr[data-logistics-row]');
      if (!row || row.dataset.logisticsRow === draggedId) {
        clearDropMarkers();
        return;
      }

      const targetId = row.dataset.logisticsRow;
      const isAbove  = row.classList.contains('party-admin__logistics-row--drop-above');
      clearDropMarkers();

      const items   = this._logistics || [];
      const dragged = items.find(i => String(i.id) === String(draggedId));
      if (!dragged) return;

      const without    = items.filter(i => String(i.id) !== String(draggedId));
      const targetIdx  = without.findIndex(i => String(i.id) === String(targetId));
      if (targetIdx < 0) return;
      const insertAt   = isAbove ? targetIdx : targetIdx + 1;
      const reordered  = [
        ...without.slice(0, insertAt),
        dragged,
        ...without.slice(insertAt),
      ];
      const ids = reordered.map(i => i.id);

      // Optimistic local reorder.
      const previous = this._logistics;
      this._logistics = reordered.map((i, idx) => ({ ...i, sort_order: idx + 1 }));
      this._rerenderLogistics();

      try {
        const headers = await getCsrfHeaders();
        const res = await fetch('/api/v1/party/logistics/reorder', {
          method:      'POST',
          credentials: 'include',
          headers,
          body: JSON.stringify({ ids }),
        });
        if (!res.ok && res.status !== 204) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || t('party.admin.logisticsReorderFailed'));
        }
      } catch (err) {
        this._logistics = previous;
        this._rerenderLogistics();
        showToast(err.message || t('party.admin.logisticsReorderFailed'), 'error');
      }
    });
  }

  // Re-render only the logistics section in place — keeps state in other
  // sections (expanded guest details, invite-code input value) intact.
  _rerenderLogistics() {
    const old = this._el.querySelector('#party-admin-logistics');
    if (!old) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = this._renderLogistics();
    const next = tmp.firstElementChild;
    old.replaceWith(next);
    this._bindLogistics();
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

  _bindInviteCodeForm() {
    const form   = this._el.querySelector('#party-admin-invite-form');
    if (!form) return;
    const input  = form.querySelector('#party-admin-invite-input');
    const status = form.querySelector('#party-admin-invite-status');
    const copyBtn = form.querySelector('#party-admin-invite-copy');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = (input?.value || '').trim();
      if (!code) {
        status.textContent = t('party.admin.enterCode');
        return;
      }
      status.textContent = t('form.saving');
      try {
        const headers = await getCsrfHeaders();
        const res = await fetch('/api/v1/party/info', {
          method:      'PATCH',
          credentials: 'include',
          headers,
          body:        JSON.stringify({ invite_code: code }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Save failed');
        }
        this._inviteCode = code;
        status.textContent = t('form.success');
        setTimeout(() => { if (status) status.textContent = ''; }, 2500);
      } catch (err) {
        status.textContent = err.message;
      }
    });

    copyBtn?.addEventListener('click', async () => {
      const code = (input?.value || '').trim();
      if (!code) return;
      try {
        await navigator.clipboard.writeText(code);
        showToast(t('party.admin.codeCopied'), 'success');
      } catch {
        showToast(t('party.admin.copyFailed'), 'error');
      }
    });
  }
}

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

        ${this._renderInvitedGuests()}
        ${this._renderLogistics()}
        ${this._renderInviteCodeSection()}
        ${this._renderStats()}
        ${this._renderAnswerTallies()}
        ${this._renderHelpersList()}
        ${this._renderRsvpTable()}
        ${this._renderGuestListExport()}
      </div>`;
  }

  _renderInvitedGuests() {
    const guests = this._invitedGuests || [];
    const showRevoke = isAdmin();

    // Sort: waiting first (need attention), then going, then declined. Alpha within.
    const order = { waiting: 0, rsvpd: 1, declined: 2 };
    const byName = (a, b) =>
      (a.display_name || a.username || '').localeCompare(b.display_name || b.username || '');
    const sorted = [...guests].sort((a, b) => {
      const d = (order[a.rsvp_status] ?? 9) - (order[b.rsvp_status] ?? 9);
      return d !== 0 ? d : byName(a, b);
    });

    const counts = guests.reduce((acc, g) => {
      acc[g.rsvp_status] = (acc[g.rsvp_status] || 0) + 1;
      return acc;
    }, {});

    const rows = sorted.length
      ? sorted.map(g => this._renderInvitedGuestRow(g, showRevoke)).join('')
      : `<tr><td colspan="${showRevoke ? 5 : 4}" class="party-empty">${t('party.admin.noGuests')}</td></tr>`;

    return `
      <section class="party-admin__section">
        <h2 class="party-admin__section-title">${t('party.admin.invitedGuests', { n: guests.length })}</h2>
        <p class="party-admin__invited-summary">
          <span class="party-admin__pill party-admin__pill--waiting">⏳ ${t('party.admin.statusWaiting')}: ${counts.waiting || 0}</span>
          <span class="party-admin__pill party-admin__pill--going">✅ ${t('party.admin.statusGoing')}: ${counts.rsvpd || 0}</span>
          <span class="party-admin__pill party-admin__pill--declined">❌ ${t('party.admin.statusDeclined')}: ${counts.declined || 0}</span>
        </p>
        <div class="party-admin__table-wrap">
          <table class="party-admin__table party-admin__table--invited" aria-label="${t('party.admin.invitedGuests', { n: '' }).trim()}">
            <thead>
              <tr>
                <th>${t('adminUsers.username')}</th>
                <th>${t('adminUsers.email')}</th>
                <th>${t('adminOrders.status')}</th>
                <th>${t('party.admin.rsvpdAt')}</th>
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

  _renderInvitedGuestRow(g, showRevoke) {
    const name     = escHtml(g.display_name || g.username || '—');
    const email    = escHtml(g.email || '');
    const rsvpedAt = g.rsvp_updated_at
      ? new Date(g.rsvp_updated_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
      : '—';

    const statusHtml = {
      rsvpd:    `<span class="party-admin__status party-admin__status--going">✅ ${t('party.admin.statusGoing')}</span>`,
      declined: `<span class="party-admin__status party-admin__status--declined">❌ ${t('party.admin.statusDeclined')}</span>`,
      waiting:  `<span class="party-admin__status party-admin__status--waiting">⏳ ${t('party.admin.statusWaiting')}</span>`,
    }[g.rsvp_status] || '—';

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

    const colSpan = showRevoke ? 5 : 4;
    const revokeCell = showRevoke
      ? `<td><button class="lol-btn lol-btn--ghost lol-btn--sm" data-revoke-user-id="${escHtml(g.id)}" data-revoke-user-name="${name}">${t('profile.revoke')}</button></td>`
      : '';

    return `
      <tr class="party-admin__invited-row" data-expand-guest="${escHtml(g.id)}">
        <td>${name}</td>
        <td>${email}</td>
        <td>${statusHtml}</td>
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
    const items = this._logistics || [];
    const total    = items.length;
    const bought   = items.filter(i => i.bought).length;
    const atVenue  = items.filter(i => i.at_venue).length;

    const rows = items.length
      ? items.map(i => this._renderLogisticsRow(i)).join('')
      : `<tr><td colspan="6" class="party-empty">${t('party.admin.logisticsNoItems')}</td></tr>`;

    return `
      <section class="party-admin__section" id="party-admin-logistics">
        <h2 class="party-admin__section-title">🛒 ${t('party.admin.logistics')}</h2>
        <p class="party-admin__logistics-help">${t('party.admin.logisticsHelp')}</p>
        <p class="party-admin__invited-summary">
          <span class="party-admin__pill">${t('party.admin.logisticsTotal', { n: total })}</span>
          <span class="party-admin__pill party-admin__pill--waiting">${t('party.admin.logisticsBoughtCount', { n: bought })}</span>
          <span class="party-admin__pill party-admin__pill--going">${t('party.admin.logisticsAtVenueCount', { n: atVenue })}</span>
        </p>
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
      <tr data-logistics-row="${escHtml(id)}" class="${rowClasses}">
        <td>${name}</td>
        <td>${qty || '—'}</td>
        <td>${to || '—'}</td>
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

    const rows = this._rsvps.map(r => {
      const answers = r.answers || {};
      const fieldCells = fields.map(f => `<td>${this._formatAnswer(answers[f.id])}</td>`).join('');
      return `
        <tr>
          <td>${escHtml(r.display_name || r.username)}</td>
          <td>${escHtml(r.email)}</td>
          ${fieldCells}
        </tr>`;
    }).join('') || `<tr><td colspan="${colCount}" class="party-empty">${t('party.admin.noRsvps')}</td></tr>`;

    const fieldHeaders = fields.map(f => `<th>${escHtml(f.label || f.id)}</th>`).join('');

    return `
      <section class="party-admin__section">
        <h2 class="party-admin__section-title">${t('party.admin.totalRsvps')}</h2>
        <div class="party-admin__table-wrap">
          <table class="party-admin__table" aria-label="${t('party.admin.totalRsvps')}">
            <thead>
              <tr>
                <th>${t('adminUsers.username')}</th><th>${t('adminUsers.email')}</th>${fieldHeaders}
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      </section>`;
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
    this._bindLogistics();
    this._bindStatCards();
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

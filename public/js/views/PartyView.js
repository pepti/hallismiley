import { isAuthenticated, getUser, isAdmin, canEdit, updateCachedUser } from '../services/auth.js';
import { getCsrfHeaders } from '../utils/api.js';
import { showToast }    from '../components/Toast.js';
import { escHtml }      from '../utils/escHtml.js';
import { Lightbox }     from '../components/Lightbox.js';
import { t } from '../i18n/i18n.js';

const PARTY_DATE = new Date('2026-07-25T14:00:00');
const TOTAL_GUESTS = 60;

function pad(n) { return String(n).padStart(2, '0'); }

export class PartyView {
  constructor() {
    this._el            = null;
    this._timerLoop     = null;
    this._venueLightbox = null;
    this._partyInfo     = null;
    this._rsvp          = null;
    this._rsvpCount     = 0;
  }

  _isVerified() {
    if (!isAuthenticated()) return false;
    // Admins and moderators always have access, regardless of email verification
    if (canEdit()) return true;
    return !!getUser()?.email_verified;
  }

  // Gates RSVP + Activities. Admins/moderators bypass; everyone else needs a
  // verified email AND the party_access flag (granted by redeeming an invite
  // code or by an admin toggle in Manage Users).
  _hasPartyAccess() {
    if (!isAuthenticated()) return false;
    if (canEdit()) return true;
    const u = getUser();
    return !!(u?.email_verified && u?.party_access);
  }

  async render() {
    const el = document.createElement('div');
    el.className = 'view party-view';
    this._el = el;

    // Render skeleton, then load all data
    el.innerHTML = this._renderSkeleton();

    try {
      await this._loadAll();
      el.innerHTML = this._renderHub();
      this._bindAll();
      this._startCountdown();
    } catch (err) {
      console.error('[PartyView] render failed:', err);
      el.innerHTML = `<div class="party-error"><p>${t('party.loadError')}</p></div>`;
    }

    return el;
  }

  async _loadAll() {
    // Party info is public — always fetch
    const infoRes = await fetch('/api/v1/party/info');
    this._partyInfo = await infoRes.json();

    // Admin-designed RSVP form (list of fields). Fall back to a seeded default
    // so admins have something to edit on first use.
    const parsed = this._parseJSON(this._partyInfo.rsvp_form, null);
    this._rsvpForm = Array.isArray(parsed) && parsed.length ? parsed : this._defaultRsvpForm();

    // RSVP data requires party access (verified email + invite code redeemed, or admin)
    if (this._hasPartyAccess()) {
      try {
        const rsvpRes = await fetch('/api/v1/party/rsvp', { credentials: 'include' });
        if (rsvpRes.ok) this._rsvp = await rsvpRes.json();
      } catch { /* not accessible */ }

      if (isAdmin()) {
        const rsvpsRes = await fetch('/api/v1/party/rsvps', { credentials: 'include' });
        if (rsvpsRes.ok) {
          const rsvps = await rsvpsRes.json();
          if (Array.isArray(rsvps)) this._rsvpCount = rsvps.filter(r => r.attending).length;
        }
      }
    }
  }

  // ── Locked section overlay ─────────────────────────────────────────────────

  _renderLockedSection(title, emoji, opts = {}) {
    const authed = isAuthenticated();
    const user   = getUser();
    const emailOk = authed && (canEdit() || !!user?.email_verified);
    const needsInviteCode = emailOk && !canEdit() && !user?.party_access;

    // Invited-code state: show the redemption form on the first locked section
    // (opts.primary !== false) and a "unlock above" hint on the second.
    if (needsInviteCode) {
      return this._renderInviteCodeLocked(title, emoji, opts.primary !== false);
    }

    const ctaText = authed
      ? t('party.verifyToView')
      : t('party.loginToView');
    const ctaBtn = authed
      ? ''
      : `<button class="party-locked__signin-link" type="button">${t('nav.signIn')}</button>`;

    const slug = title.toLowerCase().replace(/\s+/g, '-');
    return `
      <section class="party-section party-locked" aria-labelledby="locked-${slug}">
        <div class="party-section__inner">
          <h2 class="party-section__title" id="locked-${slug}">${emoji} ${escHtml(title)}</h2>
          <div class="party-locked__ribbon" role="note">
            <span class="party-locked__rule" aria-hidden="true"></span>
            <span class="party-locked__ornament" aria-hidden="true">✦</span>
            <span class="party-locked__rule" aria-hidden="true"></span>
          </div>
          <p class="party-locked__text">
            ${ctaText}${ctaBtn ? ` — ${ctaBtn}` : ''}
          </p>
          <div class="party-locked__ribbon" aria-hidden="true">
            <span class="party-locked__rule"></span>
            <span class="party-locked__ornament">✦</span>
            <span class="party-locked__rule"></span>
          </div>
        </div>
      </section>`;
  }

  _renderInviteCodeLocked(title, emoji, primary) {
    const slug = title.toLowerCase().replace(/\s+/g, '-');
    if (!primary) {
      return `
        <section class="party-section party-locked" aria-labelledby="locked-${slug}">
          <div class="party-section__inner">
            <h2 class="party-section__title" id="locked-${slug}">${emoji} ${escHtml(title)}</h2>
            <p class="party-locked__text">${t('party.enterCodeAbove')}</p>
          </div>
        </section>`;
    }
    return `
      <section class="party-section party-locked party-locked--invite" aria-labelledby="locked-${slug}">
        <div class="party-section__inner">
          <h2 class="party-section__title" id="locked-${slug}">${emoji} ${escHtml(title)}</h2>
          <div class="party-locked__ribbon" role="note">
            <span class="party-locked__rule" aria-hidden="true"></span>
            <span class="party-locked__ornament" aria-hidden="true">✦</span>
            <span class="party-locked__rule" aria-hidden="true"></span>
          </div>
          <p class="party-locked__text">${t('party.gotInviteCode')}</p>
          <form class="party-invite-form" id="party-invite-form" novalidate>
            <input type="text" name="code" id="party-invite-code-input"
                   class="lol-input party-invite-form__input"
                   placeholder="${t('party.inviteCode')}"
                   maxlength="100" autocomplete="off" required
                   aria-label="${t('party.inviteCode')}" />
            <button type="submit" class="lol-btn lol-btn--primary party-invite-form__submit">${t('party.submitCode')}</button>
          </form>
          <div class="party-locked__ribbon" aria-hidden="true">
            <span class="party-locked__rule"></span>
            <span class="party-locked__ornament">✦</span>
            <span class="party-locked__rule"></span>
          </div>
        </div>
      </section>`;
  }

  _renderSkeleton() {
    return `<div class="party-skeleton">
      <div class="skeleton-hero"></div>
      <div class="skeleton-body">
        <div class="skeleton-block"></div>
        <div class="skeleton-block"></div>
        <div class="skeleton-block"></div>
      </div>
    </div>`;
  }

  // ── Full hub ──────────────────────────────────────────────────────────────────

  _renderHub() {
    const info       = this._partyInfo || {};
    const schedule   = this._parseJSON(info.schedule,   []);
    const activities = this._parseJSON(info.activities, { daytime: [], evening: [] });
    const unlocked   = this._hasPartyAccess();

    return `
      ${this._renderHero()}
      ${this._renderVenue(info)}
      ${this._renderSchedule(schedule)}
      ${unlocked ? this._renderRsvp()              : this._renderLockedSection('RSVP', '🎟', { primary: true })}
      ${unlocked ? this._renderActivities(activities) : this._renderLockedSection('Activities', '🎯', { primary: false })}`;
  }

  _renderHero() {
    return `
      <section class="party-hero" aria-label="Party hero">
        <div class="party-hero__bg" aria-hidden="true"></div>
        <div class="party-hero__content">
          <p class="party-hero__eyebrow">July 25, 2026</p>
          <h1 class="party-hero__title">HALLI'S <span class="party-gold">40<sup>th</sup></span></h1>
          <p class="party-hero__sub">The big four-zero — let's make it legendary</p>
          <div class="party-countdown" id="party-countdown" aria-live="polite" aria-label="Countdown to party">
            <div class="party-countdown__unit">
              <span class="party-countdown__num" id="cd-days">--</span>
              <span class="party-countdown__label">${t('party.days')}</span>
            </div>
            <span class="party-countdown__sep" aria-hidden="true">:</span>
            <div class="party-countdown__unit">
              <span class="party-countdown__num" id="cd-hours">--</span>
              <span class="party-countdown__label">${t('party.hours')}</span>
            </div>
            <span class="party-countdown__sep" aria-hidden="true">:</span>
            <div class="party-countdown__unit">
              <span class="party-countdown__num" id="cd-mins">--</span>
              <span class="party-countdown__label">${t('party.mins')}</span>
            </div>
            <span class="party-countdown__sep" aria-hidden="true">:</span>
            <div class="party-countdown__unit">
              <span class="party-countdown__num" id="cd-secs">--</span>
              <span class="party-countdown__label">${t('party.secs')}</span>
            </div>
          </div>
        </div>
      </section>`;
  }

  _renderVenue(info) {
    const venueName    = escHtml(info.venue_name    || 'TBD — details coming soon');
    const venueAddress = escHtml(info.venue_address || '');
    const venueLink    = escHtml(info.venue_link    || '');
    const venueRating  = escHtml(info.venue_rating  || '');
    const mapsLink     = info.venue_maps_link
      ? escHtml(info.venue_maps_link)
      : venueAddress
        ? `https://www.google.com/maps/search/${encodeURIComponent(info.venue_address || '')}`
        : '';

    let detailsHtml = '';
    if (info.venue_details) {
      try {
        const details = typeof info.venue_details === 'string'
          ? JSON.parse(info.venue_details)
          : info.venue_details;
        const hallItems = (details.hall || []).map(d => `<li data-detail="hall">${escHtml(d)}</li>`).join('');
        const spaItems  = (details.spa  || []).map(d => `<li data-detail="spa">${escHtml(d)}</li>`).join('');
        detailsHtml = `
          <div class="party-venue__details">
            ${hallItems ? `<div class="party-venue__details-section" data-details-group="hall"><h3 class="party-venue__details-title">🏠 Party Hall</h3><ul class="party-venue__details-list">${hallItems}</ul></div>` : ''}
            ${spaItems  ? `<div class="party-venue__details-section" data-details-group="spa"><h3 class="party-venue__details-title">🛁 SPA</h3><ul class="party-venue__details-list">${spaItems}</ul></div>` : ''}
          </div>`;
      } catch { /* ignore malformed details */ }
    }

    const venuePhotos = [
      'Mýrarkot_veislusalur.jpg',
      'Mýrarkot_salur_til_leigu.jpg',
      'mýrarkot_salur_veislutjald.jpg',
      'salur_við_bauhaus_mýrarkot.jpg',
      'Myrarkot_við_bauhaus.jpg',
      'lambhagi_salur_til_leigu.jpg',
      'mýrarkot_lambhagi.jpg',
      'mýrarkot_SPA.jpg',
      'mýrakot_spa_salur.jpg',
      'fyrir_gjæsun_SPA_mýrarkot.jpg',
      'Gæsun_steggjun_myrarkot.jpg',
      'Steggjun_myrarkot.jpg',
      'myrarkot_fyrir_hópefli.jpg',
    ];

    const photoGrid = venuePhotos.map((file, i) => `
      <button class="party-venue__photo-btn" data-photo-index="${i}"
              aria-label="View venue photo ${i + 1}">
        <img class="party-venue__photo"
             src="/assets/party/venue/${encodeURIComponent(file)}"
             alt="Mýrarkot venue photo ${i + 1}"
             loading="lazy" width="400" height="300">
      </button>`).join('');

    const editBtn = canEdit() ? `
      <button class="party-edit-btn" data-edit-section="venue" aria-label="Edit venue section">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        ${t('admin.edit')}
      </button>` : '';

    const editControls = canEdit() ? `
      <div class="party-edit-controls party-edit-controls--hidden" data-controls="venue">
        <button class="party-edit-save" data-save-section="venue">${t('form.save')}</button>
        <button class="party-edit-cancel" data-cancel-section="venue">${t('admin.cancel')}</button>
        <span class="party-edit-status" data-status="venue" aria-live="polite"></span>
      </div>` : '';

    return `
      <section class="party-section party-venue" aria-labelledby="venue-heading">
        ${editBtn}
        <div class="party-section__inner">
          <h2 class="party-section__title" id="venue-heading">📍 ${t('party.venue')}</h2>
          <div class="party-venue__card">
            <div class="party-venue__name" data-field="venue_name">${venueName}</div>
            <div class="party-venue__address" data-field="venue_address">${venueAddress || t('party.addressTbd')}</div>
            <div class="party-venue__rating" data-field="venue_rating">${venueRating ? `⭐ ${venueRating}` : ''}</div>
            <div class="party-venue__links">
              ${mapsLink  ? `<a href="${mapsLink}"  target="_blank" rel="noopener noreferrer" class="lol-btn lol-btn--ghost party-venue__link">📍 Google Maps</a>` : ''}
              ${venueLink ? `<a href="${venueLink}" target="_blank" rel="noopener noreferrer" class="lol-btn lol-btn--ghost party-venue__link">🏠 View Venue</a>` : ''}
            </div>
            ${detailsHtml}
          </div>
          <div class="party-venue__gallery" role="list" aria-label="Venue photos">
            ${photoGrid}
          </div>
        </div>
        ${editControls}
      </section>`;
  }

  _renderSchedule(schedule) {
    const editor = canEdit();
    const items = schedule.map((item, i) => `
      <li class="party-timeline__item" data-schedule-index="${i}">
        <div class="party-timeline__time" data-sched="time">${escHtml(item.time)}</div>
        <div class="party-timeline__dot" aria-hidden="true"></div>
        <div class="party-timeline__event" data-sched="event">${escHtml(item.event)}</div>
        ${editor ? `<button class="party-edit-row-delete party-edit-row-delete--hidden" data-delete-schedule="${i}" aria-label="Remove this event" title="Remove">✕</button>` : ''}
      </li>`).join('');

    const editBtn = canEdit() ? `
      <button class="party-edit-btn" data-edit-section="schedule" aria-label="Edit schedule section">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        ${t('admin.edit')}
      </button>` : '';

    const editControls = canEdit() ? `
      <div class="party-edit-controls party-edit-controls--hidden" data-controls="schedule">
        <button class="party-edit-save" data-save-section="schedule">${t('form.save')}</button>
        <button class="party-edit-cancel" data-cancel-section="schedule">${t('admin.cancel')}</button>
        <span class="party-edit-status" data-status="schedule" aria-live="polite"></span>
      </div>` : '';

    const addBtn = editor ? `<button class="party-edit-add party-edit-add--hidden" data-add-schedule aria-label="Add new event">+ Add Event</button>` : '';

    return `
      <section class="party-section party-schedule" aria-labelledby="schedule-heading">
        ${editBtn}
        <div class="party-section__inner">
          <h2 class="party-section__title" id="schedule-heading">🗓 ${t('party.schedule')}</h2>
          <ol class="party-timeline" aria-label="Party schedule">
            ${items}
          </ol>
          ${addBtn}
        </div>
        ${editControls}
      </section>`;
  }

  _defaultRsvpForm() {
    return [
      { id: 'heading',     type: 'heading',        label: '🎟  RSVP' },
      { id: 'intro',       type: 'paragraph',      label: "Let me know if you'll make it and how you'd like to join!" },
      { id: 'attend_when', type: 'radio-group',    label: 'When will you join?',
        options: ['☀️ Daytime only (14:00–18:00)', '🌙 Evening only (18:00–22:00)', '🎉 Both — all day!', "Sorry, can't make it"] },
      { id: 'bringing',    type: 'checkbox-group', label: 'Bringing anyone with you?',
        options: ['Spouse / partner', 'Kids'] },
      { id: 'helping',     type: 'checkbox-group', label: 'Want to help out? (totally optional)',
        options: ['Help with planning', 'Host an activity', 'General help on the day'] },
      { id: 'activity_details', type: 'textarea',  label: 'What activity would you host?',
        placeholder: 'A short description — games, music, a talk, anything…',
        showIf: { fieldId: 'helping', value: 'Host an activity' } },
      { id: 'message',     type: 'textarea',       label: 'Message to host (optional)',
        placeholder: 'A note for Halli…' },
    ];
  }

  _renderRsvp() {
    const rsvp         = this._rsvp;
    const answers      = rsvp?.answers || {};
    const editor       = canEdit();
    const countHtml    = this._rsvpCount > 0
      ? `<p class="party-rsvp__count">${t('party.guestsAttending', { n: this._rsvpCount, total: TOTAL_GUESTS })}</p>`
      : '';

    const editBtn = editor ? `
      <button class="party-edit-btn" data-edit-section="rsvp" aria-label="Edit RSVP form">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        ${t('admin.edit')}
      </button>` : '';

    const editControls = editor ? `
      <div class="party-edit-controls party-edit-controls--hidden" data-controls="rsvp">
        <button class="party-edit-save" data-save-section="rsvp">${t('form.save')}</button>
        <button class="party-edit-cancel" data-cancel-section="rsvp">${t('admin.cancel')}</button>
        <span class="party-edit-status" data-status="rsvp" aria-live="polite"></span>
      </div>` : '';

    // If user already RSVP'd, show summary + "Update RSVP" toggle
    const summaryHtml = rsvp ? `
      <div class="party-rsvp__current">
        <div class="party-rsvp__status party-rsvp__status--yes">✅ ${t('party.youveRsvpd')}</div>
        ${this._rsvpForm.filter(f => !['heading','paragraph'].includes(f.type)).map(f => {
          const a = answers[f.id];
          if (a == null || (Array.isArray(a) && !a.length) || a === '') return '';
          const val = Array.isArray(a) ? a.map(x => escHtml(x)).join(', ') : escHtml(a);
          return `<p><strong>${escHtml(f.label)}:</strong> ${val}</p>`;
        }).join('')}
        <button class="lol-btn lol-btn--ghost party-rsvp__update-btn" id="rsvp-edit-btn">${t('party.updateRsvp')}</button>
      </div>` : '';

    return `
      <section class="party-section party-rsvp" aria-labelledby="rsvp-heading" id="rsvp">
        ${editBtn}
        <div class="party-section__inner" id="rsvp-inner">
          ${countHtml}
          ${summaryHtml}
          <div class="party-rsvp__form-wrap" id="rsvp-form-wrap" ${rsvp ? 'hidden' : ''}>
            ${this._renderRsvpForm(answers, !!rsvp)}
          </div>
        </div>
        ${editControls}
      </section>`;
  }

  _renderField(field, answers) {
    const id  = `rsvp-f-${field.id}`;
    const ans = answers?.[field.id];
    switch (field.type) {
      case 'heading':
        return `<h2 class="party-section__title" data-field-id="${escHtml(field.id)}">${escHtml(field.label)}</h2>`;
      case 'paragraph':
        return `<p class="party-rsvp__intro" data-field-id="${escHtml(field.id)}">${escHtml(field.label).replace(/\n/g, '<br>')}</p>`;
      case 'checkbox-group': {
        const opts = (field.options || []).map(opt => `
          <label class="party-checkbox">
            <input type="checkbox" name="f_${escHtml(field.id)}" value="${escHtml(opt)}"
                   ${Array.isArray(ans) && ans.includes(opt) ? 'checked' : ''} />
            <span>${escHtml(opt)}</span>
          </label>`).join('');
        return `
          <div class="party-form-group" data-field-id="${escHtml(field.id)}" data-field-type="checkbox-group"${this._showIfAttrs(field)}>
            <label class="party-label">${escHtml(field.label)}</label>
            <div class="party-checkbox-group">${opts}</div>
          </div>`;
      }
      case 'radio-group': {
        const opts = (field.options || []).map(opt => `
          <label class="party-checkbox">
            <input type="radio" name="f_${escHtml(field.id)}" value="${escHtml(opt)}"
                   ${typeof ans === 'string' && ans === opt ? 'checked' : ''} />
            <span>${escHtml(opt)}</span>
          </label>`).join('');
        return `
          <div class="party-form-group" data-field-id="${escHtml(field.id)}" data-field-type="radio-group"${this._showIfAttrs(field)}>
            <label class="party-label">${escHtml(field.label)}</label>
            <div class="party-checkbox-group party-radio-group">${opts}</div>
          </div>`;
      }
      case 'text':
        return `
          <div class="party-form-group" data-field-id="${escHtml(field.id)}" data-field-type="text"${this._showIfAttrs(field)}>
            <label class="party-label" for="${id}">${escHtml(field.label)}</label>
            <input id="${id}" class="lol-input" type="text" name="f_${escHtml(field.id)}"
                   placeholder="${escHtml(field.placeholder || '')}"
                   value="${escHtml(ans || '')}" maxlength="200" />
          </div>`;
      case 'textarea':
        return `
          <div class="party-form-group" data-field-id="${escHtml(field.id)}" data-field-type="textarea"${this._showIfAttrs(field)}>
            <label class="party-label" for="${id}">${escHtml(field.label)}</label>
            <textarea id="${id}" class="lol-input lol-textarea" name="f_${escHtml(field.id)}"
                      placeholder="${escHtml(field.placeholder || '')}" maxlength="1000">${escHtml(ans || '')}</textarea>
          </div>`;
      default:
        return '';
    }
  }

  _showIfAttrs(field) {
    if (!field.showIf || !field.showIf.fieldId || field.showIf.value == null) return '';
    return ` data-show-if-field="${escHtml(field.showIf.fieldId)}" data-show-if-value="${escHtml(field.showIf.value)}" style="display:none"`;
  }

  _renderRsvpForm(answers, isUpdate) {
    const fields = this._rsvpForm.map(f => this._renderField(f, answers)).join('');
    return `
      <form class="party-rsvp__form" id="rsvp-form" novalidate>
        ${fields}
        <div class="party-form-actions">
          <button type="submit" class="lol-btn lol-btn--primary party-rsvp__submit">${t('party.submitRsvp')}</button>
          ${isUpdate ? `<button type="button" class="lol-btn lol-btn--ghost" id="rsvp-cancel-btn">${t('admin.cancel')}</button>` : ''}
        </div>
      </form>`;
  }


  _renderActivities(activities) {
    const editor = canEdit();

    const renderCards = (list, group) => list.map((g, i) => `
      <div class="party-activity-card" data-activity-index="${i}" data-activity-group="${group}">
        ${editor ? `<button class="party-edit-row-delete party-edit-row-delete--hidden" data-delete-activity="${group}-${i}" aria-label="Remove this activity" title="Remove">✕</button>` : ''}
        <h3 class="party-activity-card__name" data-activity="name">${escHtml(g.name)}</h3>
        <p class="party-activity-card__desc" data-activity="desc">${escHtml(g.description)}</p>
        <p class="party-activity-card__rules" data-activity="rules"><strong>Rules:</strong> <span data-activity="rules-text">${escHtml(g.rules)}</span></p>
      </div>`).join('');

    const daytimeCards = renderCards(activities.daytime || [], 'daytime');
    const eveningCards = renderCards(activities.evening || [], 'evening');

    const addBtn = (group) => editor
      ? `<button class="party-edit-add party-edit-add--hidden" data-add-activity="${group}" aria-label="Add ${group} activity">+ Add Activity</button>`
      : '';

    const editBtn = editor ? `
      <button class="party-edit-btn" data-edit-section="activities" aria-label="Edit activities section">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        ${t('admin.edit')}
      </button>` : '';

    const editControls = editor ? `
      <div class="party-edit-controls party-edit-controls--hidden" data-controls="activities">
        <button class="party-edit-save" data-save-section="activities">${t('form.save')}</button>
        <button class="party-edit-cancel" data-cancel-section="activities">${t('admin.cancel')}</button>
        <span class="party-edit-status" data-status="activities" aria-live="polite"></span>
      </div>` : '';

    return `
      <section class="party-section party-activities" aria-labelledby="activities-heading">
        ${editBtn}
        <div class="party-section__inner">
          <h2 class="party-section__title" id="activities-heading">🎯 ${t('party.activities')}</h2>

          <h3 class="party-activities__sub-heading">☀️ ${t('party.daytimeActivities')}</h3>
          <div class="party-activities__grid" data-activities-grid="daytime">
            ${daytimeCards}
          </div>
          ${addBtn('daytime')}

          <h3 class="party-activities__sub-heading party-activities__sub-heading--evening">🌙 ${t('party.eveningActivities')}</h3>
          <div class="party-activities__grid" data-activities-grid="evening">
            ${eveningCards}
          </div>
          ${addBtn('evening')}
        </div>
        ${editControls}
      </section>`;
  }


  // ── Binding ───────────────────────────────────────────────────────────────────

  _bindAll() {
    if (this._hasPartyAccess()) this._bindRsvp();
    this._bindVenueLightbox();
    this._bindInviteCodeForm();
    if (canEdit()) this._bindEditing();

    // Sign-in links on locked sections
    this._el.querySelectorAll('.party-locked__signin-link').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('nav-auth')?.querySelector('button')?.click();
      });
    });
  }

  _bindInviteCodeForm() {
    const form  = this._el.querySelector('#party-invite-form');
    if (!form) return;
    const input = form.querySelector('#party-invite-code-input');
    const btn   = form.querySelector('.party-invite-form__submit');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = (input?.value || '').trim();
      if (!code) {
        showToast(t('party.enterCodeFirst'), 'error');
        input?.focus();
        return;
      }

      btn.disabled = true;
      btn.textContent = t('party.unlocking');
      try {
        const headers = await getCsrfHeaders();
        const res = await fetch('/api/v1/party/redeem-invite-code', {
          method:      'POST',
          credentials: 'include',
          headers,
          body:        JSON.stringify({ code }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Unable to redeem code');

        if (data.user) updateCachedUser(data.user);
        showToast(t('party.youreIn'), 'success');

        // Re-fetch RSVP data now that we have access, then re-render the hub.
        await this._loadAll();
        this._el.innerHTML = this._renderHub();
        this._bindAll();
        this._startCountdown();
      } catch (err) {
        showToast(err.message, 'error');
        btn.disabled = false;
        btn.textContent = t('party.submitCode');
      }
    });
  }

  // ── Inline Editing (admin only) ───────────────────────────────────────────

  _bindEditing() {
    this._editSnapshots = {};

    this._el.querySelectorAll('[data-edit-section]').forEach(btn => {
      btn.addEventListener('click', () => this._enterEdit(btn.dataset.editSection));
    });
    this._el.querySelectorAll('[data-save-section]').forEach(btn => {
      btn.addEventListener('click', () => this._saveSection(btn.dataset.saveSection));
    });
    this._el.querySelectorAll('[data-cancel-section]').forEach(btn => {
      btn.addEventListener('click', () => this._cancelEdit(btn.dataset.cancelSection));
    });
  }

  _enterEdit(section) {
    // RSVP uses a custom form-builder editing flow
    if (section === 'rsvp') { this._enterEditRsvpForm(); return; }

    const sectionEl = this._getSectionEl(section);
    if (!sectionEl) return;

    // Snapshot for cancel
    this._editSnapshots[section] = sectionEl.querySelector('.party-section__inner').innerHTML;

    // Show controls, hide edit button
    sectionEl.classList.add('party-section--editing');
    sectionEl.querySelector(`[data-edit-section="${section}"]`)?.classList.add('party-edit-btn--hidden');
    sectionEl.querySelector(`[data-controls="${section}"]`)?.classList.remove('party-edit-controls--hidden');

    // Enable contentEditable on data fields
    const editableSelectors = {
      venue:      '[data-field], [data-detail]',
      schedule:   '[data-sched]',
      activities: '[data-activity="name"], [data-activity="desc"], [data-activity="rules-text"]',
    };
    sectionEl.querySelectorAll(editableSelectors[section] || '[data-field]').forEach(el => {
      el.contentEditable = 'true';
      el.spellcheck = true;
    });

    // Show add/delete buttons for schedule
    if (section === 'schedule') {
      sectionEl.querySelectorAll('.party-edit-row-delete').forEach(b => b.classList.remove('party-edit-row-delete--hidden'));
      sectionEl.querySelector('[data-add-schedule]')?.classList.remove('party-edit-add--hidden');
      this._bindScheduleAddDelete(sectionEl);
    }

    // Show add/delete buttons for activities
    if (section === 'activities') {
      sectionEl.querySelectorAll('.party-edit-row-delete').forEach(b => b.classList.remove('party-edit-row-delete--hidden'));
      sectionEl.querySelectorAll('[data-add-activity]').forEach(b => b.classList.remove('party-edit-add--hidden'));
      this._bindActivitiesAddDelete(sectionEl);
    }
  }

  _enterEditRsvpForm() {
    const sectionEl = this._getSectionEl('rsvp');
    if (!sectionEl) return;

    const inner = sectionEl.querySelector('#rsvp-inner');
    this._editSnapshots['rsvp'] = inner.innerHTML;

    sectionEl.classList.add('party-section--editing');
    sectionEl.querySelector('[data-edit-section="rsvp"]')?.classList.add('party-edit-btn--hidden');
    sectionEl.querySelector('[data-controls="rsvp"]')?.classList.remove('party-edit-controls--hidden');

    // Replace inner content with the form-builder editor
    inner.innerHTML = `
      <div class="party-rsvp-builder" id="rsvp-builder">
        ${this._rsvpForm.map(f => this._renderFieldEditor(f)).join('')}
      </div>
      <div class="party-rsvp-builder__add">
        <label class="party-label" for="rsvp-add-type">Add field:</label>
        <select id="rsvp-add-type" class="lol-input">
          <option value="heading">Heading</option>
          <option value="paragraph">Paragraph</option>
          <option value="checkbox-group">Checkbox group</option>
          <option value="radio-group">Radio buttons (single choice)</option>
          <option value="text">Text input</option>
          <option value="textarea">Text area</option>
        </select>
        <button type="button" class="party-edit-add" id="rsvp-add-field-btn">+ Add Field</button>
      </div>`;

    this._bindRsvpBuilder();
  }

  _renderFieldEditor(field) {
    const id = field.id || ('f' + Date.now() + Math.random().toString(36).slice(2, 6));
    const optionsHtml = (field.options || []).map(opt => `
      <div class="party-edit-list-item" data-option-row>
        <input class="lol-input" type="text" data-option-input value="${escHtml(opt)}" />
        <button class="party-edit-row-delete" type="button" data-delete-option aria-label="Remove option" title="Remove">✕</button>
      </div>`).join('');

    const typeLabels = {
      'heading':        'Heading',
      'paragraph':      'Paragraph',
      'checkbox-group': 'Checkbox group',
      'radio-group':    'Radio buttons (single choice)',
      'text':           'Text input',
      'textarea':       'Text area',
    };

    const labelPlaceholder = field.type === 'paragraph'
      ? 'Paragraph text…'
      : (field.type === 'heading' ? 'Heading text…' : 'Question / field label');

    const showIfFieldId = field.showIf?.fieldId || '';
    const showIfValue   = field.showIf?.value || '';
    const supportsShowIf = ['text', 'textarea', 'checkbox-group', 'radio-group'].includes(field.type);

    return `
      <div class="party-field-block" data-field-block data-field-id="${escHtml(id)}" data-field-type="${escHtml(field.type)}">
        <div class="party-field-block__header">
          <span class="party-field-block__type">${typeLabels[field.type] || field.type}</span>
          <button class="party-edit-row-delete" type="button" data-delete-field aria-label="Delete field" title="Delete field">✕</button>
        </div>
        ${field.type === 'paragraph'
          ? `<textarea class="lol-input" data-field-label rows="3" placeholder="${labelPlaceholder}">${escHtml(field.label || '')}</textarea>`
          : `<input class="lol-input" type="text" data-field-label value="${escHtml(field.label || '')}" placeholder="${labelPlaceholder}" />`}
        ${['checkbox-group', 'radio-group'].includes(field.type) ? `
          <div class="party-field-block__options">
            ${optionsHtml}
            <button class="party-edit-add party-edit-add--sm" type="button" data-add-option>+ Add Option</button>
          </div>` : ''}
        ${['text','textarea'].includes(field.type) ? `
          <input class="lol-input party-field-block__placeholder" type="text"
                 data-field-placeholder value="${escHtml(field.placeholder || '')}" placeholder="Placeholder text (optional)" />` : ''}
        ${supportsShowIf ? `
          <details class="party-field-block__showif"${showIfFieldId ? ' open' : ''}>
            <summary>Show only if…</summary>
            <div class="party-field-block__showif-row">
              <input class="lol-input" type="text" data-show-if-field
                     value="${escHtml(showIfFieldId)}" placeholder="Other field id (e.g. helping)" />
              <input class="lol-input" type="text" data-show-if-value
                     value="${escHtml(showIfValue)}" placeholder="Value that must match" />
            </div>
          </details>` : ''}
      </div>`;
  }

  _bindRsvpBuilder() {
    const builder = this._el.querySelector('#rsvp-builder');
    if (!builder) return;

    const bindBlock = (block) => {
      block.querySelector('[data-delete-field]')?.addEventListener('click', () => block.remove());
      block.querySelectorAll('[data-delete-option]').forEach(btn => {
        btn.addEventListener('click', () => btn.closest('[data-option-row]')?.remove());
      });
      block.querySelector('[data-add-option]')?.addEventListener('click', () => {
        const row = document.createElement('div');
        row.className = 'party-edit-list-item';
        row.setAttribute('data-option-row', '');
        row.innerHTML = `
          <input class="lol-input" type="text" data-option-input value="" placeholder="New option…" />
          <button class="party-edit-row-delete" type="button" data-delete-option aria-label="Remove option" title="Remove">✕</button>`;
        row.querySelector('[data-delete-option]').addEventListener('click', () => row.remove());
        block.querySelector('[data-add-option]').before(row);
        row.querySelector('input')?.focus();
      });
    };

    builder.querySelectorAll('[data-field-block]').forEach(bindBlock);

    // Add field
    this._el.querySelector('#rsvp-add-field-btn')?.addEventListener('click', () => {
      const type = this._el.querySelector('#rsvp-add-type').value;
      const defaults = {
        'heading':        { label: 'New heading' },
        'paragraph':      { label: 'New paragraph of text' },
        'checkbox-group': { label: 'New question', options: ['Option 1'] },
        'radio-group':    { label: 'New question', options: ['Option 1'] },
        'text':           { label: 'New text field' },
        'textarea':       { label: 'New text area' },
      };
      const field = { id: 'f' + Date.now(), type, ...defaults[type] };
      const wrap  = document.createElement('div');
      wrap.innerHTML = this._renderFieldEditor(field);
      const block = wrap.firstElementChild;
      builder.appendChild(block);
      bindBlock(block);
      block.querySelector('[data-field-label]')?.focus();
    });
  }

  _collectRsvpForm() {
    const fields = [];
    this._el.querySelectorAll('[data-field-block]').forEach(block => {
      const id    = block.dataset.fieldId;
      const type  = block.dataset.fieldType;
      const label = block.querySelector('[data-field-label]')?.value.trim() || '';
      const field = { id, type, label };
      if (type === 'checkbox-group' || type === 'radio-group') {
        const opts = [];
        block.querySelectorAll('[data-option-input]').forEach(inp => {
          const v = inp.value.trim();
          if (v) opts.push(v);
        });
        field.options = opts;
      }
      if (type === 'text' || type === 'textarea') {
        const ph = block.querySelector('[data-field-placeholder]')?.value.trim();
        if (ph) field.placeholder = ph;
      }
      const showIfFieldId = block.querySelector('[data-show-if-field]')?.value.trim() || '';
      const showIfValue   = block.querySelector('[data-show-if-value]')?.value.trim() || '';
      if (showIfFieldId && showIfValue) {
        field.showIf = { fieldId: showIfFieldId, value: showIfValue };
      }
      // Keep headings/paragraphs even without label (empty still useful)
      // Drop option-based fields with no options — they'd be useless
      if ((type === 'checkbox-group' || type === 'radio-group') && field.options.length === 0) return;
      fields.push(field);
    });
    return fields;
  }

  _exitEdit(section) {
    const sectionEl = this._getSectionEl(section);
    if (!sectionEl) return;

    sectionEl.classList.remove('party-section--editing');
    sectionEl.querySelector(`[data-edit-section="${section}"]`)?.classList.remove('party-edit-btn--hidden');
    sectionEl.querySelector(`[data-controls="${section}"]`)?.classList.add('party-edit-controls--hidden');

    const editableSelectors = {
      venue:      '[data-field], [data-detail]',
      schedule:   '[data-sched]',
      activities: '[data-activity="name"], [data-activity="desc"], [data-activity="rules-text"]',
    };
    sectionEl.querySelectorAll(editableSelectors[section] || '[data-field]').forEach(el => {
      el.contentEditable = 'false';
    });

    // Hide add/delete buttons
    if (section === 'schedule') {
      sectionEl.querySelectorAll('.party-edit-row-delete').forEach(b => b.classList.add('party-edit-row-delete--hidden'));
      sectionEl.querySelector('[data-add-schedule]')?.classList.add('party-edit-add--hidden');
    }
    if (section === 'activities') {
      sectionEl.querySelectorAll('.party-edit-row-delete').forEach(b => b.classList.add('party-edit-row-delete--hidden'));
      sectionEl.querySelectorAll('[data-add-activity]').forEach(b => b.classList.add('party-edit-add--hidden'));
    }

    // Clear status
    const statusEl = sectionEl.querySelector(`[data-status="${section}"]`);
    if (statusEl) statusEl.textContent = '';
  }

  _cancelEdit(section) {
    if (section === 'rsvp') {
      const sectionEl = this._getSectionEl('rsvp');
      const inner     = sectionEl?.querySelector('#rsvp-inner');
      if (inner && this._editSnapshots[section]) {
        inner.innerHTML = this._editSnapshots[section];
      }
      sectionEl?.classList.remove('party-section--editing');
      sectionEl?.querySelector('[data-edit-section="rsvp"]')?.classList.remove('party-edit-btn--hidden');
      sectionEl?.querySelector('[data-controls="rsvp"]')?.classList.add('party-edit-controls--hidden');
      this._bindRsvp();
      return;
    }

    const sectionEl = this._getSectionEl(section);
    if (!sectionEl || !this._editSnapshots[section]) return;

    sectionEl.querySelector('.party-section__inner').innerHTML = this._editSnapshots[section];
    this._exitEdit(section);

    // Re-bind venue lightbox if venue was cancelled
    if (section === 'venue') this._bindVenueLightbox();
  }

  async _saveSection(section) {
    const sectionEl = this._getSectionEl(section);
    if (!sectionEl) return;

    const statusEl = sectionEl.querySelector(`[data-status="${section}"]`);
    if (statusEl) statusEl.textContent = t('form.saving');

    const payload = {};

    if (section === 'venue') {
      const getName = (f) => sectionEl.querySelector(`[data-field="${f}"]`)?.innerText.trim() || '';
      payload.venue_name    = getName('venue_name');
      payload.venue_address = getName('venue_address');
      // Strip the star emoji from rating if present
      const rawRating = getName('venue_rating');
      payload.venue_rating  = rawRating.replace(/^⭐\s*/, '').trim();

      // Collect hall + spa detail lists
      const hall = [];
      sectionEl.querySelectorAll('[data-detail="hall"]').forEach(li => {
        const text = li.innerText.trim();
        if (text) hall.push(text);
      });
      const spa = [];
      sectionEl.querySelectorAll('[data-detail="spa"]').forEach(li => {
        const text = li.innerText.trim();
        if (text) spa.push(text);
      });
      payload.venue_details = JSON.stringify({ hall, spa });
    }

    if (section === 'schedule') {
      const items = [];
      sectionEl.querySelectorAll('[data-schedule-index]').forEach(li => {
        items.push({
          time:  li.querySelector('[data-sched="time"]')?.innerText.trim()  || '',
          event: li.querySelector('[data-sched="event"]')?.innerText.trim() || '',
        });
      });
      payload.schedule = JSON.stringify(items);
    }

    if (section === 'activities') {
      const collect = (group) => {
        const items = [];
        sectionEl.querySelectorAll(`[data-activity-group="${group}"]`).forEach(card => {
          items.push({
            name:        card.querySelector('[data-activity="name"]')?.innerText.trim()       || '',
            description: card.querySelector('[data-activity="desc"]')?.innerText.trim()       || '',
            rules:       card.querySelector('[data-activity="rules-text"]')?.innerText.trim() || '',
          });
        });
        return items;
      };
      payload.activities = JSON.stringify({ daytime: collect('daytime'), evening: collect('evening') });
    }

    if (section === 'rsvp') {
      const fields = this._collectRsvpForm();
      payload.rsvp_form = JSON.stringify(fields);
    }

    try {
      const headers = await getCsrfHeaders();
      const res = await fetch('/api/v1/party/info', {
        method:      'PATCH',
        credentials: 'include',
        headers,
        body:        JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Save failed');
      }

      // Update local data
      const updated = await res.json();
      this._partyInfo = updated;

      // RSVP form changes: re-render the whole RSVP section
      if (section === 'rsvp') {
        const parsed = this._parseJSON(updated.rsvp_form, null);
        this._rsvpForm = Array.isArray(parsed) && parsed.length ? parsed : this._defaultRsvpForm();

        const rsvpSection = this._el.querySelector('.party-rsvp');
        if (rsvpSection) rsvpSection.outerHTML = this._renderRsvp();
        this._bindRsvp();
        if (canEdit()) this._bindEditing();
        showToast(t('form.success'), 'success');
        return;
      }

      if (statusEl) {
        statusEl.textContent = t('form.success');
        setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2500);
      }
      this._exitEdit(section);
    } catch (err) {
      if (statusEl) statusEl.textContent = err.message;
    }
  }

  _bindScheduleAddDelete(sectionEl) {
    // Delete buttons
    sectionEl.querySelectorAll('[data-delete-schedule]').forEach(btn => {
      const newBtn = btn.cloneNode(true);
      btn.replaceWith(newBtn);
      newBtn.addEventListener('click', () => {
        newBtn.closest('[data-schedule-index]')?.remove();
        // Re-index remaining items
        sectionEl.querySelectorAll('[data-schedule-index]').forEach((li, i) => {
          li.dataset.scheduleIndex = i;
        });
      });
    });

    // Add button
    const addBtn = sectionEl.querySelector('[data-add-schedule]');
    if (addBtn) {
      const newAdd = addBtn.cloneNode(true);
      addBtn.replaceWith(newAdd);
      newAdd.addEventListener('click', () => {
        const timeline = sectionEl.querySelector('.party-timeline');
        if (!timeline) return;
        const count = timeline.querySelectorAll('[data-schedule-index]').length;
        const li = document.createElement('li');
        li.className = 'party-timeline__item';
        li.dataset.scheduleIndex = count;
        li.innerHTML = `
          <div class="party-timeline__time" data-sched="time" contenteditable="true" spellcheck="true">00:00</div>
          <div class="party-timeline__dot" aria-hidden="true"></div>
          <div class="party-timeline__event" data-sched="event" contenteditable="true" spellcheck="true">New event</div>
          <button class="party-edit-row-delete" data-delete-schedule="${count}" aria-label="Remove this event" title="Remove">✕</button>`;
        timeline.appendChild(li);
        this._bindScheduleAddDelete(sectionEl);
        li.querySelector('[data-sched="time"]')?.focus();
      });
    }
  }

  _bindActivitiesAddDelete(sectionEl) {
    // Delete buttons
    sectionEl.querySelectorAll('[data-delete-activity]').forEach(btn => {
      const newBtn = btn.cloneNode(true);
      btn.replaceWith(newBtn);
      newBtn.addEventListener('click', () => {
        const card = newBtn.closest('[data-activity-group]');
        const group = card?.dataset.activityGroup;
        card?.remove();
        // Re-index remaining cards in that group
        sectionEl.querySelectorAll(`[data-activity-group="${group}"]`).forEach((c, i) => {
          c.dataset.activityIndex = i;
        });
      });
    });

    // Add buttons (one per group)
    sectionEl.querySelectorAll('[data-add-activity]').forEach(addBtn => {
      const newAdd = addBtn.cloneNode(true);
      addBtn.replaceWith(newAdd);
      newAdd.addEventListener('click', () => {
        const group = newAdd.dataset.addActivity;
        const grid = sectionEl.querySelector(`[data-activities-grid="${group}"]`);
        if (!grid) return;
        const count = grid.querySelectorAll('[data-activity-group]').length;
        const card = document.createElement('div');
        card.className = 'party-activity-card';
        card.dataset.activityIndex = count;
        card.dataset.activityGroup = group;
        card.innerHTML = `
          <button class="party-edit-row-delete" data-delete-activity="${group}-${count}" aria-label="Remove this activity" title="Remove">✕</button>
          <h3 class="party-activity-card__name" data-activity="name" contenteditable="true" spellcheck="true">New Activity</h3>
          <p class="party-activity-card__desc" data-activity="desc" contenteditable="true" spellcheck="true">Description</p>
          <p class="party-activity-card__rules" data-activity="rules"><strong>Rules:</strong> <span data-activity="rules-text" contenteditable="true" spellcheck="true">Rules here</span></p>`;
        grid.appendChild(card);
        this._bindActivitiesAddDelete(sectionEl);
        card.querySelector('[data-activity="name"]')?.focus();
      });
    });
  }

  _getSectionEl(section) {
    const map = {
      venue: '.party-venue', schedule: '.party-schedule', activities: '.party-activities',
      rsvp: '.party-rsvp',
    };
    return this._el.querySelector(map[section]);
  }

  _startCountdown() {
    if (this._timerLoop) clearInterval(this._timerLoop);
    this._updateCountdown();
    this._timerLoop = setInterval(() => this._updateCountdown(), 1000);
  }

  _updateCountdown() {
    const now  = Date.now();
    const diff = PARTY_DATE.getTime() - now;

    if (diff <= 0) {
      const cd = this._el?.querySelector('#party-countdown');
      if (cd) cd.innerHTML = `<span class="party-countdown__party">🎉 ${t('party.partyNow')}</span>`;
      clearInterval(this._timerLoop);
      return;
    }

    const totalSecs = Math.floor(diff / 1000);
    const secs  = totalSecs % 60;
    const mins  = Math.floor(totalSecs / 60) % 60;
    const hours = Math.floor(totalSecs / 3600) % 24;
    const days  = Math.floor(totalSecs / 86400);

    const set = (id, val) => {
      const el = this._el?.querySelector(`#${id}`);
      if (el) el.textContent = pad(val);
    };
    set('cd-days',  days);
    set('cd-hours', hours);
    set('cd-mins',  mins);
    set('cd-secs',  secs);
  }

  _bindRsvp() {
    const editBtn   = this._el.querySelector('#rsvp-edit-btn');
    const cancelBtn = this._el.querySelector('#rsvp-cancel-btn');
    const formWrap  = this._el.querySelector('#rsvp-form-wrap');
    const form      = this._el.querySelector('#rsvp-form');

    editBtn?.addEventListener('click', () => {
      if (formWrap) formWrap.hidden = false;
      const current = editBtn.closest('.party-rsvp__current');
      if (current) current.hidden = true;
    });

    cancelBtn?.addEventListener('click', () => {
      if (formWrap) formWrap.hidden = true;
      const current = this._el.querySelector('.party-rsvp__current');
      if (current) current.hidden = false;
    });

    this._bindConditionalFields(form);

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();

      // Collect answers keyed by field id
      const answers = {};
      for (const f of this._rsvpForm) {
        if (f.type === 'heading' || f.type === 'paragraph') continue;
        // Skip fields hidden by showIf — don't persist stale answers
        const group = form.querySelector(`.party-form-group[data-field-id="${f.id}"]`);
        if (group && group.style.display === 'none') continue;
        if (f.type === 'checkbox-group') {
          const checked = [...form.querySelectorAll(`[name="f_${f.id}"]:checked`)].map(cb => cb.value);
          if (checked.length) answers[f.id] = checked;
        } else if (f.type === 'radio-group') {
          const sel = form.querySelector(`[name="f_${f.id}"]:checked`);
          if (sel) answers[f.id] = sel.value;
        } else {
          const el = form.querySelector(`[name="f_${f.id}"]`);
          const v  = el?.value?.trim();
          if (v) answers[f.id] = v;
        }
      }

      const btn = form.querySelector('[type="submit"]');
      btn.disabled = true;
      btn.textContent = t('form.saving');
      try {
        const headers = await getCsrfHeaders();
        const res = await fetch('/api/v1/party/rsvp', {
          method:      'POST',
          credentials: 'include',
          headers,
          body:        JSON.stringify({ answers }),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'RSVP failed');

        this._rsvp = result;
        showToast(t('party.rsvpSubmitted'), 'success');
        // Re-render RSVP section
        const rsvpSection = this._el.querySelector('.party-rsvp');
        if (rsvpSection) rsvpSection.outerHTML = this._renderRsvp();
        this._bindRsvp();
        if (canEdit()) this._bindEditing();
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled    = false;
        btn.textContent = t('party.submitRsvp');
      }
    });
  }


  _bindConditionalFields(form) {
    if (!form) return;
    const conditionals = form.querySelectorAll('[data-show-if-field]');
    if (!conditionals.length) return;

    const apply = () => {
      conditionals.forEach(group => {
        const targetId = group.dataset.showIfField;
        const wanted   = group.dataset.showIfValue;
        const inputs = form.querySelectorAll(`[name="f_${targetId}"]`);
        let match = false;
        inputs.forEach(inp => {
          if ((inp.type === 'checkbox' || inp.type === 'radio')) {
            if (inp.checked && inp.value === wanted) match = true;
          } else if (inp.value === wanted) {
            match = true;
          }
        });
        group.style.display = match ? '' : 'none';
      });
    };

    // Listen to changes on any input within the form — cheap enough and robust.
    form.addEventListener('change', apply);
    form.addEventListener('input',  apply);
    apply();
  }

  _bindVenueLightbox() {
    if (this._venueLightbox) { this._venueLightbox.destroy(); this._venueLightbox = null; }

    const btns = Array.from(this._el.querySelectorAll('.party-venue__photo-btn'));
    if (!btns.length) return;

    const items = btns.map(btn => ({
      file_path:  btn.querySelector('img').src,
      media_type: 'image',
      caption:    btn.querySelector('img').alt,
    }));

    this._venueLightbox = new Lightbox(items);
    this._venueLightbox.mount();

    btns.forEach((btn, i) => {
      btn.addEventListener('click', () => this._venueLightbox.open(i));
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  _parseJSON(str, fallback) {
    try { return JSON.parse(str); } catch { return fallback; }
  }

  destroy() {
    clearInterval(this._timerLoop);
    if (this._venueLightbox) {
      this._venueLightbox.destroy();
      this._venueLightbox = null;
    }
  }
}

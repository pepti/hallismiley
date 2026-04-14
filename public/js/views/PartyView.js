import { isAuthenticated, getUser, isAdmin, canEdit } from '../services/auth.js';
import { getCsrfHeaders } from '../utils/api.js';
import { showToast }    from '../components/Toast.js';
import { escHtml }      from '../utils/escHtml.js';
import { avatarPathByName } from '../utils/avatar.js';
import { Lightbox }     from '../components/Lightbox.js';

const PARTY_DATE = new Date('2026-07-25T14:00:00');
const TOTAL_GUESTS = 60;

function timeAgo(str) {
  const diff  = Date.now() - new Date(str).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days  = Math.floor(hours / 24);
  if (mins < 2)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

function pad(n) { return String(n).padStart(2, '0'); }

export class PartyView {
  constructor() {
    this._el            = null;
    this._timerLoop     = null;
    this._lightbox      = null;
    this._venueLightbox = null;
    this._partyInfo     = null;
    this._rsvp          = null;
    this._guestbook     = [];
    this._photos        = [];
    this._rsvpCount     = 0;
  }

  async render() {
    const el = document.createElement('div');
    el.className = 'view party-view';
    this._el = el;

    if (!isAuthenticated()) {
      el.innerHTML = this._renderLanding();
      return el;
    }

    if (!getUser()?.email_verified && !this._skipVerification) {
      el.innerHTML = this._renderUnverified();
      el.querySelector('#party-skip-verify')?.addEventListener('click', (e) => {
        e.preventDefault();
        this._skipVerification = true;
        this.render().then(newEl => {
          el.replaceWith(newEl);
        });
      });
      return el;
    }

    // Check access
    let hasAccess = false;
    try {
      const res  = await fetch('/api/v1/party/access', { credentials: 'include' });
      const data = await res.json();
      hasAccess = data.hasAccess;
    } catch { /* network error */ }

    if (!hasAccess) {
      el.innerHTML = this._renderNoAccess();
      return el;
    }

    // Render skeleton, then load all data
    el.innerHTML = this._renderSkeleton();

    try {
      await this._loadAll();
      el.innerHTML = this._renderHub();
      this._bindAll();
      this._startCountdown();
    } catch (err) {
      console.error('[PartyView] render failed:', err);
      el.innerHTML = `<div class="party-error"><p>Failed to load party page. Please refresh.</p></div>`;
    }

    return el;
  }

  async _loadAll() {
    const [infoRes, rsvpRes, gbRes, photoRes] = await Promise.all([
      fetch('/api/v1/party/info',       { credentials: 'include' }),
      fetch('/api/v1/party/rsvp',       { credentials: 'include' }),
      fetch('/api/v1/party/guestbook',  { credentials: 'include' }),
      fetch('/api/v1/party/photos',     { credentials: 'include' }),
    ]);

    this._partyInfo = await infoRes.json();
    this._rsvp      = await rsvpRes.json();
    this._guestbook = await gbRes.json();
    this._photos    = await photoRes.json();

    // Count attending RSVPs for display
    if (isAdmin()) {
      const rsvpsRes = await fetch('/api/v1/party/rsvps', { credentials: 'include' });
      const rsvps    = await rsvpsRes.json();
      this._rsvpCount = rsvps.filter(r => r.attending).length;
    }
  }

  // ── Locked states ─────────────────────────────────────────────────────────────

  _renderLanding() {
    return `
      <div class="party-landing">
        <div class="party-landing__confetti" aria-hidden="true">
          ${Array.from({ length: 20 }, (_, i) =>
            `<span class="confetti-piece confetti-piece--${i % 5}" aria-hidden="true"></span>`
          ).join('')}
        </div>
        <div class="party-landing__content">
          <div class="party-landing__cake" aria-hidden="true">🎂</div>
          <h1 class="party-landing__title">You've been invited to<br><span class="party-gold">Halli's 40th!</span></h1>
          <p class="party-landing__sub">July 25, 2026 &mdash; A celebration to remember</p>
          <p class="party-landing__cta-text">Sign in or create an account to access the party hub.</p>
          <div class="party-landing__actions">
            <a href="#/signup" class="lol-btn lol-btn--primary party-landing__btn">Create Account</a>
            <button class="lol-btn lol-btn--ghost party-landing__btn" id="party-signin-btn">Sign In</button>
          </div>
        </div>
      </div>`;
  }

  _renderNoAccess() {
    return `
      <div class="party-no-access">
        <div class="party-no-access__icon" aria-hidden="true">🔒</div>
        <h2>Private Event</h2>
        <p>This is a private event. If you received an invitation, make sure you're using the same email address you were invited with.</p>
        <p class="party-no-access__email">Signed in as: <strong>${escHtml(getUser()?.email || '')}</strong></p>
      </div>`;
  }

  _renderUnverified() {
    return `
      <div class="party-no-access">
        <div class="party-no-access__icon" aria-hidden="true">✉️</div>
        <h2>Verify Your Email First</h2>
        <p>You need to verify your email address before you can access the party page.</p>
        <p class="party-no-access__email">A verification link was sent to <strong>${escHtml(getUser()?.email || '')}</strong>.</p>
        <p>Check your inbox (and spam folder), then reload this page once verified.</p>
        <p style="margin-top:1.2rem;font-size:0.9rem;opacity:0.8;">Note, if you haven't verified your email you might miss out on an update about the party.</p>
        <a href="#" id="party-skip-verify" style="margin-top:0.5rem;display:inline-block;color:#c9a84c;text-decoration:underline;cursor:pointer;">Continue anyway →</a>
        <br>
        <a href="#/signup" class="lol-btn lol-btn--primary" style="margin-top:1rem;">Back to Sign Up</a>
      </div>`;
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
    const info    = this._partyInfo || {};
    const schedule   = this._parseJSON(info.schedule,   []);
    const activities = this._parseJSON(info.activities, { daytime: [], evening: [] });

    return `
      ${this._renderHero()}
      ${this._renderVenue(info)}
      ${this._renderSchedule(schedule)}
      ${this._renderRsvp()}
      ${getUser()?.email_verified ? this._renderActivities(activities) : ''}`;
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
              <span class="party-countdown__label">days</span>
            </div>
            <span class="party-countdown__sep" aria-hidden="true">:</span>
            <div class="party-countdown__unit">
              <span class="party-countdown__num" id="cd-hours">--</span>
              <span class="party-countdown__label">hours</span>
            </div>
            <span class="party-countdown__sep" aria-hidden="true">:</span>
            <div class="party-countdown__unit">
              <span class="party-countdown__num" id="cd-mins">--</span>
              <span class="party-countdown__label">mins</span>
            </div>
            <span class="party-countdown__sep" aria-hidden="true">:</span>
            <div class="party-countdown__unit">
              <span class="party-countdown__num" id="cd-secs">--</span>
              <span class="party-countdown__label">secs</span>
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
        Edit
      </button>` : '';

    const editControls = canEdit() ? `
      <div class="party-edit-controls party-edit-controls--hidden" data-controls="venue">
        <button class="party-edit-save" data-save-section="venue">Save</button>
        <button class="party-edit-cancel" data-cancel-section="venue">Cancel</button>
        <span class="party-edit-status" data-status="venue" aria-live="polite"></span>
      </div>` : '';

    return `
      <section class="party-section party-venue" aria-labelledby="venue-heading">
        ${editBtn}
        <div class="party-section__inner">
          <h2 class="party-section__title" id="venue-heading">📍 Venue</h2>
          <div class="party-venue__card">
            <div class="party-venue__name" data-field="venue_name">${venueName}</div>
            <div class="party-venue__address" data-field="venue_address">${venueAddress || 'Address TBD'}</div>
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
        Edit
      </button>` : '';

    const editControls = canEdit() ? `
      <div class="party-edit-controls party-edit-controls--hidden" data-controls="schedule">
        <button class="party-edit-save" data-save-section="schedule">Save</button>
        <button class="party-edit-cancel" data-cancel-section="schedule">Cancel</button>
        <span class="party-edit-status" data-status="schedule" aria-live="polite"></span>
      </div>` : '';

    const addBtn = editor ? `<button class="party-edit-add party-edit-add--hidden" data-add-schedule aria-label="Add new event">+ Add Event</button>` : '';

    return `
      <section class="party-section party-schedule" aria-labelledby="schedule-heading">
        ${editBtn}
        <div class="party-section__inner">
          <h2 class="party-section__title" id="schedule-heading">🗓 Schedule</h2>
          <ol class="party-timeline" aria-label="Party schedule">
            ${items}
          </ol>
          ${addBtn}
        </div>
        ${editControls}
      </section>`;
  }

  _renderRsvp() {
    const rsvp = this._rsvp;
    const countHtml = this._rsvpCount > 0
      ? `<p class="party-rsvp__count">${this._rsvpCount} of ${TOTAL_GUESTS} guests attending</p>`
      : '';

    if (rsvp) {
      return `
        <section class="party-section party-rsvp" aria-labelledby="rsvp-heading" id="rsvp">
          <div class="party-section__inner">
            <h2 class="party-section__title" id="rsvp-heading">🎟 Your RSVP</h2>
            ${countHtml}
            <div class="party-rsvp__current">
              <div class="party-rsvp__status party-rsvp__status--${rsvp.attending ? 'yes' : 'no'}">
                ${rsvp.attending ? '✅ You are attending!' : '❌ You declined'}
              </div>
              ${rsvp.dietary_needs ? `<p><strong>Dietary needs:</strong> ${escHtml(rsvp.dietary_needs)}</p>` : ''}
              ${rsvp.plus_one ? `<p><strong>Plus one:</strong> ${escHtml(rsvp.plus_one_name || 'Guest')}${rsvp.plus_one_dietary ? ` (${escHtml(rsvp.plus_one_dietary)})` : ''}</p>` : ''}
              ${rsvp.message ? `<p><strong>Message:</strong> ${escHtml(rsvp.message)}</p>` : ''}
              <button class="lol-btn lol-btn--ghost party-rsvp__update-btn" id="rsvp-edit-btn">Update RSVP</button>
            </div>
            <div class="party-rsvp__form-wrap" id="rsvp-form-wrap" hidden>
              ${this._renderRsvpForm(rsvp)}
            </div>
          </div>
        </section>`;
    }

    return `
      <section class="party-section party-rsvp" aria-labelledby="rsvp-heading" id="rsvp">
        <div class="party-section__inner">
          <h2 class="party-section__title" id="rsvp-heading">🎟 RSVP</h2>
          ${countHtml}
          <p class="party-rsvp__intro">Let us know if you'll be joining the party!</p>
          <div class="party-rsvp__form-wrap" id="rsvp-form-wrap">
            ${this._renderRsvpForm(null)}
          </div>
        </div>
      </section>`;
  }

  _renderRsvpForm(existing) {
    return `
      <form class="party-rsvp__form" id="rsvp-form" novalidate>
        <div class="party-form-group">
          <label class="party-label">Will you attend?</label>
          <div class="party-radio-group">
            <label class="party-radio">
              <input type="radio" name="attending" value="yes" ${existing?.attending === true  ? 'checked' : ''} required />
              <span>Yes, I'll be there! 🎉</span>
            </label>
            <label class="party-radio">
              <input type="radio" name="attending" value="no"  ${existing?.attending === false ? 'checked' : ''} required />
              <span>Sorry, can't make it</span>
            </label>
          </div>
        </div>

        <div class="party-form-group" id="rsvp-extra" ${existing?.attending === false ? 'hidden' : ''}>
          <label class="party-label" for="rsvp-dietary">Dietary needs</label>
          <input id="rsvp-dietary" class="lol-input" type="text" name="dietary_needs"
                 placeholder="e.g. vegetarian, gluten-free, nut allergy…"
                 value="${escHtml(existing?.dietary_needs || '')}" maxlength="200" />
        </div>

        <div class="party-form-group" id="rsvp-extra2" ${existing?.attending === false ? 'hidden' : ''}>
          <label class="party-radio">
            <input type="checkbox" name="plus_one" id="rsvp-plusone" ${existing?.plus_one ? 'checked' : ''} />
            <span>Bringing a plus one?</span>
          </label>
        </div>

        <div class="party-form-group party-rsvp__plusone-fields" id="plusone-fields" ${!existing?.plus_one ? 'hidden' : ''}>
          <label class="party-label" for="rsvp-plusone-name">Plus one's name</label>
          <input id="rsvp-plusone-name" class="lol-input" type="text" name="plus_one_name"
                 placeholder="Their name" value="${escHtml(existing?.plus_one_name || '')}" maxlength="100" />
          <label class="party-label" for="rsvp-plusone-dietary">Their dietary needs</label>
          <input id="rsvp-plusone-dietary" class="lol-input" type="text" name="plus_one_dietary"
                 placeholder="Any dietary needs" value="${escHtml(existing?.plus_one_dietary || '')}" maxlength="200" />
        </div>

        <div class="party-form-group">
          <label class="party-label" for="rsvp-message">Message to host (optional)</label>
          <textarea id="rsvp-message" class="lol-input lol-textarea" name="message"
                    placeholder="A note for Halli…" maxlength="500">${escHtml(existing?.message || '')}</textarea>
        </div>

        <div class="party-form-actions">
          <button type="submit" class="lol-btn lol-btn--primary">Submit RSVP</button>
          ${existing ? '<button type="button" class="lol-btn lol-btn--ghost" id="rsvp-cancel-btn">Cancel</button>' : ''}
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
        Edit
      </button>` : '';

    const editControls = editor ? `
      <div class="party-edit-controls party-edit-controls--hidden" data-controls="activities">
        <button class="party-edit-save" data-save-section="activities">Save</button>
        <button class="party-edit-cancel" data-cancel-section="activities">Cancel</button>
        <span class="party-edit-status" data-status="activities" aria-live="polite"></span>
      </div>` : '';

    return `
      <section class="party-section party-activities" aria-labelledby="activities-heading">
        ${editBtn}
        <div class="party-section__inner">
          <h2 class="party-section__title" id="activities-heading">🎯 Activities</h2>

          <h3 class="party-activities__sub-heading">☀️ Daytime Activities</h3>
          <div class="party-activities__grid" data-activities-grid="daytime">
            ${daytimeCards}
          </div>
          ${addBtn('daytime')}

          <h3 class="party-activities__sub-heading party-activities__sub-heading--evening">🌙 Evening Activities</h3>
          <div class="party-activities__grid" data-activities-grid="evening">
            ${eveningCards}
          </div>
          ${addBtn('evening')}
        </div>
        ${editControls}
      </section>`;
  }

  _renderGuestbook() {
    const msgHtml = this._guestbook.map(entry => this._renderGuestbookEntry(entry)).join('') ||
      '<p class="party-empty">No messages yet — be the first to wish Halli happy birthday!</p>';

    return `
      <section class="party-section party-guestbook" aria-labelledby="guestbook-heading">
        <div class="party-section__inner">
          <h2 class="party-section__title" id="guestbook-heading">💌 Guestbook</h2>
          <form class="party-guestbook__form" id="guestbook-form" novalidate>
            <textarea id="guestbook-msg" class="lol-input lol-textarea party-guestbook__textarea"
                      placeholder="Write a birthday wish for Halli…" maxlength="1000"
                      aria-label="Birthday message"></textarea>
            <div class="party-guestbook__form-footer">
              <span class="party-guestbook__char" id="gb-char">0 / 1000</span>
              <button type="submit" class="lol-btn lol-btn--primary">Post Message</button>
            </div>
          </form>
          <div class="party-guestbook__wall" id="guestbook-wall">
            ${msgHtml}
          </div>
        </div>
      </section>`;
  }

  _renderGuestbookEntry(entry) {
    const me = getUser();
    const canDelete = me?.id === entry.user_id || canEdit();
    return `
      <div class="party-guestbook__entry" data-id="${entry.id}">
        <img class="party-guestbook__avatar" src="${avatarPathByName(entry.avatar)}"
             alt="${escHtml(entry.display_name || entry.username)}" />
        <div class="party-guestbook__body">
          <div class="party-guestbook__meta">
            <span class="party-guestbook__name">${escHtml(entry.display_name || entry.username)}</span>
            <span class="party-guestbook__time">${timeAgo(entry.created_at)}</span>
            ${canDelete ? `<button class="party-guestbook__delete" data-id="${entry.id}" aria-label="Delete message">✕</button>` : ''}
          </div>
          <p class="party-guestbook__msg">${escHtml(entry.message)}</p>
        </div>
      </div>`;
  }

  _renderPhotoWall() {
    const photoHtml = this._photos.map((p, i) => `
      <div class="party-photo-item" data-index="${i}">
        <img src="${escHtml(p.file_path)}" alt="${escHtml(p.caption || 'Party photo')}"
             class="party-photo-item__img" loading="lazy" />
        ${p.caption ? `<p class="party-photo-item__caption">${escHtml(p.caption)}</p>` : ''}
        ${(getUser()?.id === p.user_id || canEdit()) ? `
          <button class="party-photo-item__delete" data-id="${p.id}" aria-label="Delete photo">✕</button>` : ''}
      </div>`).join('') || '<p class="party-empty">No photos yet — be the first to upload one!</p>';

    return `
      <section class="party-section party-photos" aria-labelledby="photos-heading">
        <div class="party-section__inner">
          <h2 class="party-section__title" id="photos-heading">📸 Photo Wall</h2>
          <div class="party-photos__toolbar">
            <label class="lol-btn lol-btn--primary party-photos__upload-btn" for="party-photo-input">
              Upload Photo
              <input type="file" id="party-photo-input" accept="image/jpeg,image/png,image/webp"
                     class="party-photos__file-input" aria-label="Upload photo" />
            </label>
          </div>
          <div class="party-photos__grid" id="photo-grid">
            ${photoHtml}
          </div>
        </div>
      </section>`;
  }

  // ── Binding ───────────────────────────────────────────────────────────────────

  _bindAll() {
    this._bindRsvp();
    this._bindVenueLightbox();
    if (canEdit()) this._bindEditing();

    // Sign in button on landing (shouldn't be needed here but just in case)
    this._el.querySelector('#party-signin-btn')?.addEventListener('click', () => {
      document.getElementById('nav-auth')?.querySelector('button')?.click();
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
    if (statusEl) statusEl.textContent = 'Saving…';

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

      if (statusEl) {
        statusEl.textContent = 'Saved!';
        setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2500);
      }
      this._exitEdit(section);
    } catch (err) {
      if (statusEl) statusEl.textContent = `Error: ${err.message}`;
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
    const map = { venue: '.party-venue', schedule: '.party-schedule', activities: '.party-activities' };
    return this._el.querySelector(map[section]);
  }

  _startCountdown() {
    this._updateCountdown();
    this._timerLoop = setInterval(() => this._updateCountdown(), 1000);
  }

  _updateCountdown() {
    const now  = Date.now();
    const diff = PARTY_DATE.getTime() - now;

    if (diff <= 0) {
      const cd = this._el?.querySelector('#party-countdown');
      if (cd) cd.innerHTML = '<span class="party-countdown__party">🎉 The party is NOW!</span>';
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
      formWrap.hidden = false;
      editBtn.closest('.party-rsvp__current').hidden = true;
    });

    cancelBtn?.addEventListener('click', () => {
      formWrap.hidden = true;
      this._el.querySelector('.party-rsvp__current').hidden = false;
    });

    // Toggle extra fields based on attending yes/no
    const toggleExtra = (show) => {
      this._el.querySelector('#rsvp-extra')?.toggleAttribute('hidden', !show);
      this._el.querySelector('#rsvp-extra2')?.toggleAttribute('hidden', !show);
      if (!show) this._el.querySelector('#plusone-fields')?.setAttribute('hidden', '');
    };

    this._el.querySelectorAll('[name="attending"]').forEach(radio => {
      radio.addEventListener('change', () => toggleExtra(radio.value === 'yes'));
    });

    this._el.querySelector('#rsvp-plusone')?.addEventListener('change', (e) => {
      this._el.querySelector('#plusone-fields')?.toggleAttribute('hidden', !e.target.checked);
    });

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data     = new FormData(form);
      const attending = data.get('attending');
      if (!attending) {
        showToast('Please select yes or no', 'error');
        return;
      }

      const payload = {
        attending:        attending === 'yes',
        dietary_needs:    data.get('dietary_needs')    || null,
        plus_one:         !!form.querySelector('#rsvp-plusone')?.checked,
        plus_one_name:    data.get('plus_one_name')    || null,
        plus_one_dietary: data.get('plus_one_dietary') || null,
        message:          data.get('message')          || null,
      };

      const btn = form.querySelector('[type="submit"]');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        const headers = await getCsrfHeaders();
        const res = await fetch('/api/v1/party/rsvp', {
          method:      'POST',
          credentials: 'include',
          headers,
          body:        JSON.stringify(payload),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'RSVP failed');

        this._rsvp = result;
        showToast('RSVP saved!', 'success');
        // Re-render RSVP section
        const rsvpSection = this._el.querySelector('.party-rsvp');
        if (rsvpSection) rsvpSection.outerHTML = this._renderRsvp();
        this._bindRsvp();
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled    = false;
        btn.textContent = 'Submit RSVP';
      }
    });
  }

  _bindGuestbook() {
    const form    = this._el.querySelector('#guestbook-form');
    const textarea = this._el.querySelector('#guestbook-msg');
    const charEl  = this._el.querySelector('#gb-char');

    textarea?.addEventListener('input', () => {
      if (charEl) charEl.textContent = `${textarea.value.length} / 1000`;
    });

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = textarea?.value.trim();
      if (!msg) return;

      const btn = form.querySelector('[type="submit"]');
      btn.disabled = true;
      btn.textContent = 'Posting…';
      try {
        const headers = await getCsrfHeaders();
        const res = await fetch('/api/v1/party/guestbook', {
          method:      'POST',
          credentials: 'include',
          headers,
          body:        JSON.stringify({ message: msg }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Post failed');

        // Get username/avatar from current user
        const me = getUser();
        const entry = {
          ...data,
          user_id:      me.id,
          username:     me.username,
          display_name: me.displayName || me.display_name,
          avatar:       me.avatar,
        };
        this._guestbook.unshift(entry);

        textarea.value = '';
        if (charEl) charEl.textContent = '0 / 1000';

        const wall = this._el.querySelector('#guestbook-wall');
        if (wall) wall.insertAdjacentHTML('afterbegin', this._renderGuestbookEntry(entry));
        this._bindGuestbookDeletes();
        showToast('Message posted!', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled    = false;
        btn.textContent = 'Post Message';
      }
    });

    this._bindGuestbookDeletes();
  }

  _bindGuestbookDeletes() {
    this._el.querySelectorAll('.party-guestbook__delete').forEach(btn => {
      // Remove old listener by cloning
      const newBtn = btn.cloneNode(true);
      btn.replaceWith(newBtn);
      newBtn.addEventListener('click', async () => {
        const id = newBtn.dataset.id;
        try {
          const headers = await getCsrfHeaders();
          const res = await fetch(`/api/v1/party/guestbook/${id}`, {
            method: 'DELETE', credentials: 'include', headers,
          });
          if (!res.ok) {
            const d = await res.json();
            throw new Error(d.error);
          }
          this._el.querySelector(`.party-guestbook__entry[data-id="${id}"]`)?.remove();
          showToast('Message deleted', 'success');
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  }

  _bindPhotos() {
    const input = this._el.querySelector('#party-photo-input');
    input?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      await this._uploadPhoto(file);
      input.value = '';
    });

    this._bindPhotoDeletes();
  }

  async _uploadPhoto(file) {
    const csrfToken = await (await import('../utils/api.js')).getCSRFToken();
    const formData  = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/v1/party/photos', {
        method:      'POST',
        credentials: 'include',
        headers:     csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
        body:        formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      const me = getUser();
      const photo = { ...data, user_id: me.id, username: me.username, avatar: me.avatar };
      this._photos.unshift(photo);

      const grid = this._el.querySelector('#photo-grid');
      if (grid) {
        // Remove "no photos" empty message if present
        grid.querySelector('.party-empty')?.remove();
        const div = document.createElement('div');
        div.className  = 'party-photo-item';
        div.dataset.index = 0;
        div.innerHTML = `
          <img src="${escHtml(photo.file_path)}" alt="Party photo" class="party-photo-item__img" />
          ${photo.caption ? `<p class="party-photo-item__caption">${escHtml(photo.caption)}</p>` : ''}
          <button class="party-photo-item__delete" data-id="${photo.id}" aria-label="Delete photo">✕</button>`;
        grid.insertAdjacentElement('afterbegin', div);
        this._bindPhotoDeletes();
        this._rebuildLightbox();
      }
      showToast('Photo uploaded!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  _bindPhotoDeletes() {
    this._el.querySelectorAll('.party-photo-item__delete').forEach(btn => {
      const newBtn = btn.cloneNode(true);
      btn.replaceWith(newBtn);
      newBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = newBtn.dataset.id;
        try {
          const headers = await getCsrfHeaders();
          const res = await fetch(`/api/v1/party/photos/${id}`, {
            method: 'DELETE', credentials: 'include', headers,
          });
          if (!res.ok) {
            const d = await res.json();
            throw new Error(d.error);
          }
          newBtn.closest('.party-photo-item')?.remove();
          this._photos = this._photos.filter(p => p.id !== Number(id));
          this._rebuildLightbox();
          showToast('Photo deleted', 'success');
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  }

  _bindLightbox() {
    this._rebuildLightbox();
    this._bindVenueLightbox();
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

  _rebuildLightbox() {
    if (this._lightbox) {
      this._lightbox.destroy();
      this._lightbox = null;
    }

    const items = this._photos.map(p => ({
      file_path:  p.file_path,
      media_type: 'image',
      caption:    p.caption || '',
    }));

    if (items.length === 0) return;

    this._lightbox = new Lightbox(items);
    this._lightbox.mount();

    this._el.querySelectorAll('.party-photo-item__img').forEach((img, i) => {
      img.style.cursor = 'pointer';
      img.addEventListener('click', () => this._lightbox.open(i));
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  _parseJSON(str, fallback) {
    try { return JSON.parse(str); } catch { return fallback; }
  }

  destroy() {
    clearInterval(this._timerLoop);
    if (this._lightbox) {
      this._lightbox.destroy();
      this._lightbox = null;
    }
    if (this._venueLightbox) {
      this._venueLightbox.destroy();
      this._venueLightbox = null;
    }
  }
}

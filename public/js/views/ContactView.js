// ContactView — dedicated /contact page
// Sections: Hero → Contact card → Inquiry form → Availability → Built with → Footer

import { isAdmin, hasRole, getCSRFToken } from '../services/auth.js';
import { escHtml } from '../utils/escHtml.js';

// Default availability content — used when the site_content row doesn't exist yet.
const DEFAULT_AVAILABILITY = {
  eyebrow: 'Right now',
  title: 'What I am open to',
  cards: [
    {
      status: 'open',
      label: 'Freelance software',
      body: 'Taking on small to mid-size web projects — backend, full-stack, automation, tooling.',
    },
    {
      status: 'open',
      label: 'Carpentry commissions',
      body: 'Taking carpentry work in Iceland — joinery, furniture, interior fit-out.',
    },
    {
      status: 'limited',
      label: 'Collaborations & speaking',
      body: 'Happy to talk about interesting ideas at the intersection of craft and code.',
    },
  ],
};

// Tech stack pill list for the "Built with" section.
const TECH_STACK = [
  'Node.js', 'Express', 'PostgreSQL', 'Lucia Auth',
  'Helmet', 'CSRF', 'Resend', 'Multer',
  'Pino', 'Sentry', 'Vanilla JS SPA', 'Azure', 'Railway',
];

const TOPICS = [
  { value: '',              label: 'What is this about?' },
  { value: 'carpentry',     label: 'Carpentry commission' },
  { value: 'software',      label: 'Software work' },
  { value: 'collaboration', label: 'Collaboration' },
  { value: 'press',         label: 'Press & speaking' },
  { value: 'other',         label: 'Other' },
];

const GITHUB_URL   = 'https://github.com/pepti/hallismiley';
const LINKEDIN_URL = 'https://www.linkedin.com/in/halliv/';

export class ContactView {
  constructor() {
    this._availability = null;
  }

  async render() {
    await this._loadAvailability();

    const view = document.createElement('div');
    view.className = 'view contact-view';

    view.innerHTML = `
      ${this._hero()}
      ${this._card()}
      ${this._form()}
      ${this._availabilitySection()}
      ${this._builtWith()}
      ${this._footer()}
    `;

    this._initEmailLinks(view);
    this._initForm(view);
    this._initBuiltWithButtons(view);
    this._initAvailabilityEdit(view);
    this._initFooterLinks(view);
    return view;
  }

  // ── Availability content ───────────────────────────────────────────────
  async _loadAvailability() {
    try {
      const res = await fetch('/api/v1/content/contact_availability');
      if (res.ok) {
        const data = await res.json();
        // Merge defaults so a half-populated row still renders.
        this._availability = {
          ...DEFAULT_AVAILABILITY,
          ...data,
          cards: Array.isArray(data?.cards) && data.cards.length
            ? data.cards
            : DEFAULT_AVAILABILITY.cards,
        };
        return;
      }
    } catch { /* fall through */ }
    this._availability = JSON.parse(JSON.stringify(DEFAULT_AVAILABILITY));
  }

  // ── SECTION 1: Hero ────────────────────────────────────────────────────
  _hero() {
    return `
    <section class="contact-hero" aria-label="Contact hero">
      <div class="contact-hero__bg" aria-hidden="true"></div>
      <div class="contact-hero__inner">
        <p class="contact-hero__eyebrow">Get in touch</p>
        <h1 class="contact-hero__title">
          Let's build something<br>
          <span class="contact-hero__title-accent">in wood or in code.</span>
        </h1>
        <p class="contact-hero__subtitle">
          Commissions, collaborations, hiring, or just saying hi —
          I read every message and reply from my own inbox.
        </p>
      </div>
    </section>`;
  }

  // ── SECTION 2: Contact card ────────────────────────────────────────────
  _card() {
    return `
    <section class="contact-card-section" aria-label="Contact details">
      <div class="contact-card-section__inner">
        <div class="contact-card">

          <a class="contact-card__item" id="contact-email-link" href="#">
            <div class="contact-card__icon" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <rect x="2" y="4" width="20" height="16" rx="2"/>
                <polyline points="2,4 12,13 22,4"/>
              </svg>
            </div>
            <div class="contact-card__body">
              <div class="contact-card__label">Email</div>
              <div class="contact-card__value" id="contact-email-text">halli&#8203;@&#8203;hallismiley.is</div>
            </div>
          </a>

          <a class="contact-card__item" href="${GITHUB_URL}" target="_blank" rel="noopener noreferrer">
            <div class="contact-card__icon" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
              </svg>
            </div>
            <div class="contact-card__body">
              <div class="contact-card__label">GitHub</div>
              <div class="contact-card__value">pepti/hallismiley</div>
            </div>
          </a>

          <a class="contact-card__item" href="${LINKEDIN_URL}" target="_blank" rel="noopener noreferrer">
            <div class="contact-card__icon" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
              </svg>
            </div>
            <div class="contact-card__body">
              <div class="contact-card__label">LinkedIn</div>
              <div class="contact-card__value">halliv</div>
            </div>
          </a>

          <div class="contact-card__item contact-card__item--static">
            <div class="contact-card__icon" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M12 2a10 10 0 1 0 10 10"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </div>
            <div class="contact-card__body">
              <div class="contact-card__label">Based in</div>
              <div class="contact-card__value">Reykjavík · GMT</div>
              <div class="contact-card__meta">Typical reply within 2–3 days</div>
            </div>
          </div>

        </div>
      </div>
    </section>`;
  }

  // ── SECTION 3: Inquiry form ────────────────────────────────────────────
  _form() {
    const topicOptions = TOPICS.map(t =>
      `<option value="${escHtml(t.value)}">${escHtml(t.label)}</option>`
    ).join('');

    return `
    <section class="contact-form-section" id="contact-form-section" aria-label="Inquiry form">
      <div class="contact-form-section__inner">
        <p class="contact-form-section__eyebrow">Send a message</p>
        <h2 class="contact-form-section__title">Tell me what you are thinking about</h2>

        <form class="contact-form contact-form--page" id="contact-page-form" novalidate
              aria-label="Inquiry form">
          <!-- Honeypot — hidden from real users, bots fill it in -->
          <input type="text" name="website" id="contact-page-honeypot"
                 tabindex="-1" autocomplete="off" aria-hidden="true"
                 style="position:absolute;left:-9999px;opacity:0;height:0;width:0;pointer-events:none;" />

          <div class="contact-form__field">
            <label for="contact-page-topic" class="contact-form__label">Topic</label>
            <select id="contact-page-topic" name="topic" class="contact-form__input contact-form__select">
              ${topicOptions}
            </select>
          </div>

          <div class="contact-form__row">
            <div class="contact-form__field">
              <label for="contact-page-name" class="contact-form__label">
                Name <span aria-hidden="true" class="required-mark">*</span>
              </label>
              <input type="text" id="contact-page-name" name="name" class="contact-form__input"
                     required autocomplete="name" placeholder="Your name" maxlength="100" />
            </div>
            <div class="contact-form__field">
              <label for="contact-page-email" class="contact-form__label">
                Email <span aria-hidden="true" class="required-mark">*</span>
              </label>
              <input type="email" id="contact-page-email" name="email" class="contact-form__input"
                     required autocomplete="email" placeholder="your@email.com" maxlength="200" />
            </div>
          </div>

          <div class="contact-form__field">
            <label for="contact-page-message" class="contact-form__label">
              Message <span aria-hidden="true" class="required-mark">*</span>
            </label>
            <textarea id="contact-page-message" name="message" class="contact-form__textarea"
                      required rows="6" placeholder="What is on your mind?" maxlength="2000"></textarea>
          </div>

          <div aria-live="polite" id="contact-page-status" class="contact-form__status"></div>

          <button type="submit" class="lol-contact__btn contact-form__submit" id="contact-page-submit">
            Send Message
          </button>

          <p class="contact-form__fallback">
            Prefer email? <a id="contact-mailto-link" href="#">Write to me directly.</a>
          </p>
        </form>
      </div>
    </section>`;
  }

  // ── SECTION 4: Availability ────────────────────────────────────────────
  _availabilitySection() {
    const c = this._availability;
    const cards = c.cards.map((card, i) => {
      const status = (card.status || 'open').toLowerCase();
      const statusLabel = status === 'open' ? 'Open' : status === 'limited' ? 'Limited' : 'Closed';
      return `
        <div class="availability-card availability-card--${escHtml(status)}" data-card-index="${i}" role="listitem">
          <div class="availability-card__status">
            <span class="availability-card__dot" aria-hidden="true"></span>
            <span class="availability-card__status-text" data-field="status">${escHtml(statusLabel)}</span>
          </div>
          <h3 class="availability-card__label" data-field="label">${escHtml(card.label)}</h3>
          <p class="availability-card__body" data-field="body">${escHtml(card.body)}</p>
        </div>`;
    }).join('');

    return `
    <section class="availability" aria-label="Current availability">
      <div class="availability__inner">
        <p class="availability__eyebrow" data-field="eyebrow">${escHtml(c.eyebrow)}</p>
        <h2 class="availability__title" data-field="title">${escHtml(c.title)}</h2>
        <div class="availability__grid" role="list">
          ${cards}
        </div>
      </div>
    </section>`;
  }

  // ── SECTION 5: Built with ──────────────────────────────────────────────
  _builtWith() {
    const pills = TECH_STACK.map(t =>
      `<span class="built-with__pill">${escHtml(t)}</span>`
    ).join('');

    return `
    <section class="built-with" aria-label="How this site is built">
      <div class="built-with__inner">
        <p class="built-with__eyebrow">Under the hood</p>
        <h2 class="built-with__title">Built with — and yours to clone</h2>
        <p class="built-with__body">
          This site is a hand-built portfolio running on Node.js and Express with a PostgreSQL
          database and a vanilla-JS single-page frontend — no framework, no build step. Auth uses
          Lucia with CSRF and Helmet hardening, email goes through Resend, uploads through Multer,
          observability through Pino and Sentry, and the whole thing deploys to Azure or Railway.
        </p>
        <p class="built-with__body">
          The full source is on GitHub — feel free to fork or clone it. If you would like a hand
          getting it running or keeping it maintained, drop me a line and I am happy to help
          with setup, hosting, or ongoing maintenance.
        </p>

        <div class="built-with__stack" role="list" aria-label="Technology stack">
          ${pills}
        </div>

        <div class="built-with__actions">
          <a href="${GITHUB_URL}" target="_blank" rel="noopener noreferrer"
             class="lol-btn--gold built-with__btn">
            View on GitHub
          </a>
          <button type="button" class="lol-btn--teal built-with__btn" id="built-with-email-btn">
            Email me for setup help
          </button>
        </div>
      </div>
    </section>`;
  }

  // ── Footer (mirrors HomeView) ──────────────────────────────────────────
  _footer() {
    return `
    <footer class="lol-footer">
      <nav class="lol-footer__top" aria-label="Footer navigation">
        <a href="#/halli"    class="lol-footer__nav-link">Halli</a>
        <a href="#/projects" class="lol-footer__nav-link">Projects</a>
        <a href="${GITHUB_URL}" target="_blank" rel="noopener noreferrer" class="lol-footer__nav-link">GitHub</a>
        <a href="${LINKEDIN_URL}" target="_blank" rel="noopener noreferrer" class="lol-footer__nav-link">LinkedIn</a>
      </nav>

      <div class="lol-footer__brand">
        <div class="lol-footer__logo">Halli Smiley</div>
        <p class="lol-footer__copy">
          &copy; ${new Date().getFullYear()} Halli Smiley. A portfolio of nothing and everything.
        </p>
        <nav class="lol-footer__legal" aria-label="Legal navigation">
          <a href="#/privacy" class="lol-footer__legal-link">Privacy Policy</a>
          <a href="#/terms"   class="lol-footer__legal-link">Terms of Service</a>
        </nav>
      </div>
    </footer>`;
  }

  // ── Init: email obfuscation (build mailto from parts) ─────────────────
  _initEmailLinks(view) {
    const parts = ['halli', 'hallismiley', 'is'];
    const address = `${parts[0]}@${parts[1]}.${parts[2]}`;

    const link = view.querySelector('#contact-email-link');
    const text = view.querySelector('#contact-email-text');
    if (link) link.href = `mailto:${address}`;
    if (text) text.textContent = address;

    const mailto = view.querySelector('#contact-mailto-link');
    if (mailto) mailto.href = `mailto:${address}`;
  }

  // ── Init: "Email me for setup help" pre-fills topic + scrolls to form ──
  _initBuiltWithButtons(view) {
    const btn = view.querySelector('#built-with-email-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const topic = view.querySelector('#contact-page-topic');
      if (topic) topic.value = 'collaboration';
      const message = view.querySelector('#contact-page-message');
      if (message && !message.value.trim()) {
        message.value = 'Hi Halli — I am interested in cloning the portfolio repo and would like a hand with setup.';
      }
      view.querySelector('#contact-form-section')?.scrollIntoView({ behavior: 'smooth' });
      setTimeout(() => view.querySelector('#contact-page-name')?.focus(), 500);
    });
  }

  // ── Init: form submission ──────────────────────────────────────────────
  _initForm(view) {
    const form   = view.querySelector('#contact-page-form');
    const status = view.querySelector('#contact-page-status');
    const submit = view.querySelector('#contact-page-submit');
    if (!form) return;

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const honeypot = form.querySelector('#contact-page-honeypot').value;
      const name     = form.querySelector('#contact-page-name').value.trim();
      const email    = form.querySelector('#contact-page-email').value.trim();
      const message  = form.querySelector('#contact-page-message').value.trim();
      const topic    = form.querySelector('#contact-page-topic').value || null;

      if (!name || !email || !message) {
        status.className = 'contact-form__status contact-form__status--error';
        status.textContent = 'Please fill in all required fields.';
        return;
      }

      submit.disabled = true;
      submit.textContent = 'Sending…';
      status.className = 'contact-form__status';
      status.textContent = '';

      try {
        const res = await fetch('/api/v1/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, message, topic, website: honeypot }),
        });

        if (res.ok) {
          status.className = 'contact-form__status contact-form__status--success';
          status.textContent = "Got it — I'll reply from halli@hallismiley.is within a few days.";
          form.reset();
        } else {
          const data = await res.json().catch(() => ({}));
          const msg = data.errors?.[0] || data.error || 'Something went wrong.';
          throw new Error(msg);
        }
      } catch (err) {
        status.className = 'contact-form__status contact-form__status--error';
        status.textContent = err.message;
      } finally {
        submit.disabled = false;
        submit.textContent = 'Send Message';
      }
    });
  }

  // ── Init: admin inline edit for availability section ─────────────────
  _initAvailabilityEdit(view) {
    if (!isAdmin() && !hasRole('moderator')) return;

    const section = view.querySelector('.availability');
    if (!section) return;

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'availability__edit-btn';
    editBtn.setAttribute('aria-label', 'Edit availability section');
    editBtn.setAttribute('data-testid', 'edit-availability-btn');
    editBtn.textContent = 'Edit';
    section.style.position = 'relative';
    section.appendChild(editBtn);

    const controls = document.createElement('div');
    controls.className = 'availability__edit-controls availability__edit-controls--hidden';
    controls.innerHTML = `
      <button type="button" class="availability__save-btn" data-testid="edit-availability-save">Save</button>
      <button type="button" class="availability__cancel-btn" data-testid="edit-availability-cancel">Cancel</button>
      <span class="availability__edit-status" aria-live="polite"></span>`;
    section.appendChild(controls);

    let snapshot = null;

    editBtn.addEventListener('click', () => {
      snapshot = JSON.parse(JSON.stringify(this._availability));
      this._enterAvailabilityEdit(section, editBtn, controls);
    });

    controls.querySelector('.availability__save-btn').addEventListener('click', () =>
      this._saveAvailability(section, editBtn, controls)
    );

    controls.querySelector('.availability__cancel-btn').addEventListener('click', () => {
      if (snapshot) {
        this._availability = snapshot;
        this._restoreAvailability(section);
      }
      this._exitAvailabilityEdit(section, editBtn, controls);
    });
  }

  _enterAvailabilityEdit(section, editBtn, controls) {
    section.classList.add('availability--editing');
    editBtn.classList.add('availability__edit-btn--hidden');
    controls.classList.remove('availability__edit-controls--hidden');
    section.querySelectorAll('[data-field]').forEach(el => {
      el.contentEditable = 'true';
      el.spellcheck = true;
    });
  }

  _exitAvailabilityEdit(section, editBtn, controls) {
    section.classList.remove('availability--editing');
    editBtn.classList.remove('availability__edit-btn--hidden');
    controls.classList.add('availability__edit-controls--hidden');
    controls.querySelector('.availability__edit-status').textContent = '';
    section.querySelectorAll('[data-field]').forEach(el => {
      el.contentEditable = 'false';
      el.removeAttribute('contenteditable');
    });
  }

  _restoreAvailability(section) {
    const c = this._availability;
    section.querySelector('.availability__eyebrow').textContent = c.eyebrow;
    section.querySelector('.availability__title').textContent   = c.title;
    section.querySelectorAll('[data-card-index]').forEach((el, i) => {
      const card = c.cards[i];
      if (!card) return;
      const status = (card.status || 'open').toLowerCase();
      const statusLabel = status === 'open' ? 'Open' : status === 'limited' ? 'Limited' : 'Closed';
      el.className = `availability-card availability-card--${status}`;
      el.querySelector('[data-field="status"]').textContent = statusLabel;
      el.querySelector('[data-field="label"]').textContent  = card.label;
      el.querySelector('[data-field="body"]').textContent   = card.body;
    });
  }

  async _saveAvailability(section, editBtn, controls) {
    const status = controls.querySelector('.availability__edit-status');
    status.textContent = 'Saving…';

    const eyebrow = section.querySelector('.availability__eyebrow').innerText.trim();
    const title   = section.querySelector('.availability__title').innerText.trim();

    const cards = [];
    section.querySelectorAll('[data-card-index]').forEach(el => {
      const statusText = el.querySelector('[data-field="status"]').innerText.trim().toLowerCase();
      const normalized = ['open', 'limited', 'closed'].includes(statusText) ? statusText : 'open';
      cards.push({
        status: normalized,
        label:  el.querySelector('[data-field="label"]').innerText.trim(),
        body:   el.querySelector('[data-field="body"]').innerText.trim(),
      });
    });

    const updated = { eyebrow, title, cards };

    try {
      const token = await getCSRFToken();
      const res = await fetch('/api/v1/content/contact_availability', {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'X-CSRF-Token': token } : {}),
        },
        body: JSON.stringify(updated),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');

      this._availability = await res.json();
      this._restoreAvailability(section);
      status.textContent = 'Saved!';
      setTimeout(() => {
        status.textContent = '';
        this._exitAvailabilityEdit(section, editBtn, controls);
      }, 1200);
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
    }
  }

  // ── Init: footer links (none dynamic right now, kept for parity) ──────
  _initFooterLinks() { /* no-op — footer links are static in this view */ }
}

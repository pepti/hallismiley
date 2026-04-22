// ContactView — dedicated /contact page
// Sections: Hero → Contact card → Inquiry form → Availability → Built with → Footer
//
// All six sections are editable by admin/moderator via a single page-level
// Edit button. Content lives in `site_content` JSONB rows keyed by:
//   contact_hero, contact_card, contact_form, contact_availability,
//   contact_built_with, contact_footer
// When a row is absent, the matching DEFAULT_* constant is rendered.

import { isAdmin, hasRole, getCSRFToken } from '../services/auth.js';
import { escHtml } from '../utils/escHtml.js';
import { t, adminLocaleBadgeHtml, checkUntranslated } from '../i18n/i18n.js';

// ── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_HERO = {
  eyebrow:     'Get in touch',
  title_line1: "Let's build something",
  title_accent: 'in wood or in code.',
  subtitle:
    'Commissions, collaborations, hiring, or just saying hi — ' +
    'I read every message and reply from my own inbox.',
};

// Icons for card items are keyed by `type` and merged at render time — not editable.
const CARD_ICONS = {
  email: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <rect x="2" y="4" width="20" height="16" rx="2"/>
            <polyline points="2,4 12,13 22,4"/>
          </svg>`,
  github: `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
             <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
           </svg>`,
  linkedin: `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
               <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
             </svg>`,
  location: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="2" stroke-linecap="round">
               <path d="M12 2a10 10 0 1 0 10 10"/>
               <circle cx="12" cy="12" r="3"/>
             </svg>`,
};

const DEFAULT_CARD = {
  items: [
    { type: 'email',    label: 'Email',    value: 'halli [at] hallismiley [dot] is', href: 'halli@hallismiley.is' },
    { type: 'github',   label: 'GitHub',   value: 'pepti/hallismiley',               href: 'https://github.com/pepti/hallismiley' },
    { type: 'linkedin', label: 'LinkedIn', value: 'halliv',                          href: 'https://www.linkedin.com/in/halliv/' },
    { type: 'location', label: 'Based in', value: 'Hafnarfjörður · GMT',             meta:  'Typical reply within 2–3 days' },
  ],
};

const DEFAULT_FORM = {
  eyebrow:         'Send a message',
  title:           'Tell me what you are thinking about',
  submit_label:    'Send Message',
  fallback_prefix: 'Prefer email?',
  fallback_link:   'Write to me directly.',
};

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

const DEFAULT_BUILT_WITH = {
  eyebrow: 'Under the hood',
  title:   'Built with — and yours to clone',
  body1:
    'This site is a hand-built portfolio running on Node.js and Express with a PostgreSQL ' +
    'database and a vanilla-JS single-page frontend — no framework, no build step. Auth uses ' +
    'Lucia with CSRF and Helmet hardening, email goes through Resend, uploads through Multer, ' +
    'observability through Pino and Sentry, and the whole thing deploys to Azure or Railway.',
  body2:
    'The full source is on GitHub — feel free to fork or clone it. If you would like a hand ' +
    'getting it running or keeping it maintained, drop me a line and I am happy to help ' +
    'with setup, hosting, or ongoing maintenance.',
  pills: [
    'Node.js', 'Express', 'PostgreSQL', 'Lucia Auth',
    'Helmet', 'CSRF', 'Resend', 'Multer',
    'Pino', 'Sentry', 'Vanilla JS SPA', 'Azure', 'Railway',
  ],
  github_btn_label: 'View on GitHub',
  email_btn_label:  'Email me for setup help',
  github_url:       'https://github.com/pepti/hallismiley',
};

const DEFAULT_FOOTER = {
  brand_name:  'Halli Smiley',
  copy_suffix: 'A portfolio of nothing and everything.',
  nav_links: [
    { label: 'Halli',    href: '#/halli' },
    { label: 'Projects', href: '#/projects' },
    { label: 'GitHub',   href: 'https://github.com/pepti/hallismiley' },
    { label: 'LinkedIn', href: 'https://www.linkedin.com/in/halliv/' },
  ],
  legal_links: [
    { label: 'Privacy Policy',   href: '#/privacy' },
    { label: 'Terms of Service', href: '#/terms' },
  ],
};

const TOPICS = [
  { value: '',              label: 'What is this about?' },
  { value: 'carpentry',     label: 'Carpentry commission' },
  { value: 'software',      label: 'Software work' },
  { value: 'collaboration', label: 'Collaboration' },
  { value: 'press',         label: 'Press & speaking' },
  { value: 'other',         label: 'Other' },
];

// Each editable section's config: state field on `this`, default, and DB key.
const SECTIONS = [
  { key: 'contact_hero',        field: '_hero',       defaults: DEFAULT_HERO },
  { key: 'contact_card',        field: '_card',       defaults: DEFAULT_CARD },
  { key: 'contact_form',        field: '_form',       defaults: DEFAULT_FORM },
  { key: 'contact_availability',field: '_availability', defaults: DEFAULT_AVAILABILITY },
  { key: 'contact_built_with',  field: '_builtWith',  defaults: DEFAULT_BUILT_WITH },
  { key: 'contact_footer',      field: '_footer',     defaults: DEFAULT_FOOTER },
];

export class ContactView {
  constructor() {
    this._hero         = null;
    this._card         = null;
    this._form         = null;
    this._availability = null;
    this._builtWith    = null;
    this._footer       = null;
    // Whether this user can see inline-edit-only DOM (mailto/href helper rows).
    // Captured at render time so anonymous viewers never see the raw email
    // in the static HTML — obfuscation is preserved for non-editors.
    this._canEdit      = false;
  }

  async render() {
    this._canEdit = isAdmin() || hasRole('moderator');
    await this._loadAllContent();

    const view = document.createElement('div');
    view.className = 'view contact-view';

    view.innerHTML = `
      ${this._heroHtml()}
      ${this._cardHtml()}
      ${this._formHtml()}
      ${this._availabilityHtml()}
      ${this._builtWithHtml()}
      ${this._footerHtml()}
    `;

    this._initEmailLinks(view);
    this._initForm(view);
    this._initBuiltWithButtons(view);
    this._initPageEdit(view);
    return view;
  }

  // ── Load all site_content rows in parallel; fall back to defaults on 404 ──
  async _loadAllContent() {
    await Promise.all(SECTIONS.map(async s => {
      try {
        const res = await fetch(`/api/v1/content/${s.key}?locale=${encodeURIComponent(window.__locale || 'en')}`);
        if (res.ok) {
          const data = await res.json();
          this[s.field] = this._mergeWithDefaults(s.defaults, data);
          return;
        }
      } catch { /* fall through */ }
      this[s.field] = JSON.parse(JSON.stringify(s.defaults));
    }));
  }

  // Deep merge so a partially-populated DB row still renders missing bits.
  _mergeWithDefaults(defaults, data) {
    const out = JSON.parse(JSON.stringify(defaults));
    if (!data || typeof data !== 'object') return out;
    for (const [k, v] of Object.entries(data)) {
      if (Array.isArray(v) && v.length) out[k] = v;
      else if (v !== null && v !== undefined) out[k] = v;
    }
    return out;
  }

  // ── SECTION 1: Hero ────────────────────────────────────────────────────
  _heroHtml() {
    const h = this._hero;
    return `
    <section class="contact-hero" aria-label="Contact hero" data-section="hero">
      <div class="contact-hero__bg" aria-hidden="true"></div>
      <div class="contact-hero__inner">
        <p class="contact-hero__eyebrow" data-field="eyebrow">${escHtml(h.eyebrow)}</p>
        <h1 class="contact-hero__title">
          <span data-field="title_line1">${escHtml(h.title_line1)}</span><br>
          <span class="contact-hero__title-accent" data-field="title_accent">${escHtml(h.title_accent)}</span>
        </h1>
        <p class="contact-hero__subtitle" data-field="subtitle">${escHtml(h.subtitle)}</p>
      </div>
    </section>`;
  }

  // ── SECTION 2: Contact card ────────────────────────────────────────────
  _cardHtml() {
    const items = this._card.items.map((item, i) => this._cardItemHtml(item, i)).join('');
    return `
    <section class="contact-card-section" aria-label="Contact details" data-section="card">
      <div class="contact-card-section__inner">
        <div class="contact-card">
          ${items}
        </div>
      </div>
    </section>`;
  }

  _cardItemHtml(item, i) {
    const icon = CARD_ICONS[item.type] || '';
    const isLocation = item.type === 'location';
    const isEmail    = item.type === 'email';

    // Email: href filled lazily on interaction (obfuscation). Others: static href.
    const hrefAttr = isLocation ? ''
      : isEmail   ? `href="#" id="contact-email-link" aria-label="Send me an email"`
                  : `href="${escHtml(item.href || '#')}" target="_blank" rel="noopener noreferrer"`;

    const classes = isLocation
      ? 'contact-card__item contact-card__item--static'
      : 'contact-card__item';

    const tag = isLocation ? 'div' : 'a';

    const valueId = isEmail ? 'id="contact-email-text"' : '';
    const meta = isLocation && item.meta
      ? `<div class="contact-card__meta" data-field="meta">${escHtml(item.meta)}</div>`
      : '';

    // Edit-mode helper row: shows href (or mailto address for email) as an
    // editable line. Only rendered for editors so anonymous viewers don't
    // receive the raw email/URL in the static DOM.
    const hrefRow = (this._canEdit && !isLocation) ? `
      <div class="contact-card__href-row contact-view__edit-only">
        <span class="contact-card__href-label">${isEmail ? 'Mailto:' : 'Link:'}</span>
        <span class="contact-card__href-value" data-field="href">${escHtml(item.href || '')}</span>
      </div>` : '';

    return `
      <${tag} class="${classes}" ${hrefAttr} data-item-index="${i}" data-type="${escHtml(item.type)}">
        <div class="contact-card__icon" aria-hidden="true">${icon}</div>
        <div class="contact-card__body">
          <div class="contact-card__label" data-field="label">${escHtml(item.label)}</div>
          <div class="contact-card__value" ${valueId} data-field="value">${escHtml(item.value)}</div>
          ${meta}
          ${hrefRow}
        </div>
      </${tag}>`;
  }

  // ── SECTION 3: Inquiry form ────────────────────────────────────────────
  _formHtml() {
    const f = this._form;
    const topicOptions = TOPICS.map(t =>
      `<option value="${escHtml(t.value)}">${escHtml(t.label)}</option>`
    ).join('');

    return `
    <section class="contact-form-section" id="contact-form-section"
             aria-label="Inquiry form" data-section="form">
      <div class="contact-form-section__inner">
        <p class="contact-form-section__eyebrow" data-field="eyebrow">${escHtml(f.eyebrow)}</p>
        <h2 class="contact-form-section__title" data-field="title">${escHtml(f.title)}</h2>

        <form class="contact-form contact-form--page" id="contact-page-form" novalidate
              aria-label="Inquiry form">
          <!-- Honeypot — hidden from real users, bots fill it in -->
          <input type="text" name="website" id="contact-page-honeypot"
                 tabindex="-1" autocomplete="off" aria-hidden="true"
                 style="position:absolute;left:-9999px;opacity:0;height:0;width:0;pointer-events:none;" />

          <div class="contact-form__field">
            <label for="contact-page-topic" class="contact-form__label">${t('contact.topic')}</label>
            <select id="contact-page-topic" name="topic" class="contact-form__input contact-form__select">
              ${topicOptions}
            </select>
          </div>

          <div class="contact-form__row">
            <div class="contact-form__field">
              <label for="contact-page-name" class="contact-form__label">
                ${t('contact.name')} <span aria-hidden="true" class="required-mark">*</span>
              </label>
              <input type="text" id="contact-page-name" name="name" class="contact-form__input"
                     required autocomplete="name" placeholder="${t('contact.namePlaceholder')}" maxlength="100" />
            </div>
            <div class="contact-form__field">
              <label for="contact-page-email" class="contact-form__label">
                ${t('contact.email')} <span aria-hidden="true" class="required-mark">*</span>
              </label>
              <input type="email" id="contact-page-email" name="email" class="contact-form__input"
                     required autocomplete="email" placeholder="${t('contact.emailPlaceholder')}" maxlength="200" />
            </div>
          </div>

          <div class="contact-form__field">
            <label for="contact-page-message" class="contact-form__label">
              ${t('contact.message')} <span aria-hidden="true" class="required-mark">*</span>
            </label>
            <textarea id="contact-page-message" name="message" class="contact-form__textarea"
                      required rows="6" placeholder="${t('contact.messagePlaceholder')}" maxlength="2000"></textarea>
          </div>

          <div aria-live="polite" id="contact-page-status" class="contact-form__status"></div>

          <button type="submit" class="lol-contact__btn contact-form__submit" id="contact-page-submit">
            <span data-field="submit_label">${escHtml(f.submit_label)}</span>
          </button>

          <p class="contact-form__fallback">
            <span data-field="fallback_prefix">${escHtml(f.fallback_prefix)}</span>
            <a id="contact-mailto-link" href="#" data-field="fallback_link">${escHtml(f.fallback_link)}</a>
          </p>
        </form>
      </div>
    </section>`;
  }

  // ── SECTION 4: Availability ────────────────────────────────────────────
  _availabilityHtml() {
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
    <section class="availability" aria-label="Current availability" data-section="availability">
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
  _builtWithHtml() {
    const b = this._builtWith;
    const pills = b.pills.map((t, i) =>
      `<span class="built-with__pill" data-pill-index="${i}" data-field="pill">${escHtml(t)}</span>`
    ).join('');

    return `
    <section class="built-with" aria-label="How this site is built" data-section="built_with">
      <div class="built-with__inner">
        <p class="built-with__eyebrow" data-field="eyebrow">${escHtml(b.eyebrow)}</p>
        <h2 class="built-with__title" data-field="title">${escHtml(b.title)}</h2>
        <p class="built-with__body" data-field="body1">${escHtml(b.body1)}</p>
        <p class="built-with__body" data-field="body2">${escHtml(b.body2)}</p>

        <div class="built-with__stack" role="list" aria-label="Technology stack">
          ${pills}
        </div>

        <div class="built-with__actions">
          <a href="${escHtml(b.github_url || DEFAULT_BUILT_WITH.github_url)}"
             target="_blank" rel="noopener noreferrer"
             class="lol-btn--gold built-with__btn">
            <span data-field="github_btn_label">${escHtml(b.github_btn_label)}</span>
          </a>
          <button type="button" class="lol-btn--teal built-with__btn" id="built-with-email-btn">
            <span data-field="email_btn_label">${escHtml(b.email_btn_label)}</span>
          </button>
        </div>
      </div>
    </section>`;
  }

  // ── Footer (editable, per-page) ────────────────────────────────────────
  _footerHtml() {
    const f = this._footer;
    const hrefRow = (href) => this._canEdit
      ? `<span class="contact-view__edit-only lol-footer__href">
           <span class="contact-card__href-label">Link:</span>
           <span data-field="href">${escHtml(href)}</span>
         </span>`
      : '';

    const nav = f.nav_links.map((l, i) => {
      const external = /^https?:/.test(l.href);
      const attrs = external ? 'target="_blank" rel="noopener noreferrer"' : '';
      return `
        <a href="${escHtml(l.href)}" ${attrs} class="lol-footer__nav-link"
           data-nav-index="${i}">
          <span data-field="label">${escHtml(l.label)}</span>
          ${hrefRow(l.href)}
        </a>`;
    }).join('');

    const legal = f.legal_links.map((l, i) => `
      <a href="${escHtml(l.href)}" class="lol-footer__legal-link" data-legal-index="${i}">
        <span data-field="label">${escHtml(l.label)}</span>
        ${hrefRow(l.href)}
      </a>`).join('');

    return `
    <footer class="lol-footer" data-section="footer">
      <nav class="lol-footer__top" aria-label="Footer navigation">
        ${nav}
      </nav>

      <div class="lol-footer__brand">
        <div class="lol-footer__logo" data-field="brand_name">${escHtml(f.brand_name)}</div>
        <p class="lol-footer__copy">
          &copy; ${new Date().getFullYear()} <span data-field="brand_name_copy">${escHtml(f.brand_name)}</span>.
          <span data-field="copy_suffix">${escHtml(f.copy_suffix)}</span>
        </p>
        <nav class="lol-footer__legal" aria-label="Legal navigation">
          ${legal}
        </nav>
      </div>
    </footer>`;
  }

  // ── Init: email obfuscation — assemble mailto only on user interaction ─
  // The displayed text stays as "halli [at] hallismiley [dot] is" so the raw
  // address never lives in the static HTML source; the mailto is built lazily
  // on click/focus/hover from the stored `href` on the email card item.
  _initEmailLinks(view) {
    const emailHref = () => {
      const it = this._card.items.find(x => x.type === 'email');
      return (it && it.href) || DEFAULT_CARD.items[0].href;
    };
    const reveal = (el) => {
      if (!el || el.dataset.revealed === '1') return;
      el.href = `mailto:${emailHref()}`;
      el.dataset.revealed = '1';
    };

    ['#contact-email-link', '#contact-mailto-link'].forEach(sel => {
      const el = view.querySelector(sel);
      if (!el) return;
      el.addEventListener('mouseenter', () => reveal(el), { once: true });
      el.addEventListener('focus',      () => reveal(el), { once: true });
      el.addEventListener('touchstart', () => reveal(el), { once: true, passive: true });
      el.addEventListener('click', (e) => {
        if (el.dataset.revealed !== '1') {
          e.preventDefault();
          window.location.href = `mailto:${emailHref()}`;
        }
      });
    });
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

    const submitLabel = () => this._form.submit_label || DEFAULT_FORM.submit_label;

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const honeypot = form.querySelector('#contact-page-honeypot').value;
      const name     = form.querySelector('#contact-page-name').value.trim();
      const email    = form.querySelector('#contact-page-email').value.trim();
      const message  = form.querySelector('#contact-page-message').value.trim();
      const topic    = form.querySelector('#contact-page-topic').value || null;

      if (!name || !email || !message) {
        status.className = 'contact-form__status contact-form__status--error';
        status.textContent = t('form.requiredFields');
        return;
      }

      submit.disabled = true;
      submit.textContent = t('form.sending');
      status.className = 'contact-form__status';
      status.textContent = '';

      try {
        const res = await fetch('/api/v1/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, message, topic, website: honeypot }),
        });

        if (res.ok) {
          const emailAddr = this._card.items.find(x => x.type === 'email')?.href
            || DEFAULT_CARD.items[0].href;
          status.className = 'contact-form__status contact-form__status--success';
          status.textContent = t('contact.sent');
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
        submit.textContent = submitLabel();
      }
    });
  }

  // ── Init: page-level inline edit (admin/moderator only) ────────────────
  _initPageEdit(view) {
    if (!isAdmin() && !hasRole('moderator')) return;

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'contact-view__edit-btn';
    editBtn.setAttribute('aria-label', 'Edit Contact page');
    editBtn.setAttribute('data-testid', 'edit-contact-page-btn');
    editBtn.textContent = t('admin.editPage');
    view.appendChild(editBtn);

    const controls = document.createElement('div');
    controls.className = 'contact-view__edit-controls contact-view__edit-controls--hidden';
    controls.innerHTML = `
      ${adminLocaleBadgeHtml()}
      <button type="button" class="contact-view__save-btn"
              data-testid="edit-contact-page-save">${t('form.saveChanges')}</button>
      <button type="button" class="contact-view__cancel-btn"
              data-testid="edit-contact-page-cancel">${t('admin.cancel')}</button>
      <span class="contact-view__edit-status" aria-live="polite"></span>`;
    view.appendChild(controls);

    let snapshot = null;

    editBtn.addEventListener('click', () => {
      snapshot = SECTIONS.reduce((acc, s) => {
        acc[s.field] = JSON.parse(JSON.stringify(this[s.field]));
        return acc;
      }, {});
      this._enterPageEdit(view, editBtn, controls);
    });

    controls.querySelector('.contact-view__save-btn').addEventListener('click', () =>
      this._saveAll(view, editBtn, controls)
    );

    controls.querySelector('.contact-view__cancel-btn').addEventListener('click', () => {
      if (snapshot) {
        for (const s of SECTIONS) this[s.field] = snapshot[s.field];
        this._repaintAll(view);
      }
      this._exitPageEdit(view, editBtn, controls);
    });
  }

  _enterPageEdit(view, editBtn, controls) {
    view.classList.add('contact-view--editing');
    editBtn.classList.add('contact-view__edit-btn--hidden');
    controls.classList.remove('contact-view__edit-controls--hidden');
    // contact_hero is the canonical anchor block — if it's untranslated the
    // rest of the page almost certainly is too.
    checkUntranslated('contact_hero', controls);
    view.querySelectorAll('[data-field]').forEach(el => {
      el.contentEditable = 'true';
      el.spellcheck = true;
    });
  }

  _exitPageEdit(view, editBtn, controls) {
    view.classList.remove('contact-view--editing');
    editBtn.classList.remove('contact-view__edit-btn--hidden');
    controls.classList.add('contact-view__edit-controls--hidden');
    controls.querySelector('.contact-view__edit-status').textContent = '';
    view.querySelectorAll('[data-field]').forEach(el => {
      el.contentEditable = 'false';
      el.removeAttribute('contenteditable');
    });
  }

  // ── Collect DOM → payloads, PUT in parallel, report per-section results ──
  async _saveAll(view, editBtn, controls) {
    const status = controls.querySelector('.contact-view__edit-status');
    status.textContent = t('form.saving');

    const payloads = {
      _hero:         this._collectHero(view),
      _card:         this._collectCard(view),
      _form:         this._collectForm(view),
      _availability: this._collectAvailability(view),
      _builtWith:    this._collectBuiltWith(view),
      _footer:       this._collectFooter(view),
    };

    let token;
    try {
      token = await getCSRFToken();
    } catch {
      token = null;
    }

    const puts = SECTIONS.map(async s => {
      const body = payloads[s.field];
      const res = await fetch(`/api/v1/content/${s.key}`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'X-CSRF-Token': token } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`${s.key}: ${err.error || res.statusText}`);
      }
      const value = await res.json();
      this[s.field] = this._mergeWithDefaults(s.defaults, value);
      return s.key;
    });

    const results = await Promise.allSettled(puts);
    const failed = results
      .filter(r => r.status === 'rejected')
      .map(r => r.reason?.message || 'unknown error');

    // Repaint from updated state (so server-side normalisation is reflected)
    this._repaintAll(view);

    if (failed.length) {
      status.textContent = `Saved with errors — ${failed.join('; ')}`;
      return;
    }

    status.textContent = t('form.saved');
    setTimeout(() => this._exitPageEdit(view, editBtn, controls), 1200);
  }

  // ── Collectors: read DOM → section payload ─────────────────────────────

  _collectHero(view) {
    const section = view.querySelector('[data-section="hero"]');
    return {
      eyebrow:      this._readField(section, 'eyebrow',      this._hero.eyebrow),
      title_line1:  this._readField(section, 'title_line1',  this._hero.title_line1),
      title_accent: this._readField(section, 'title_accent', this._hero.title_accent),
      subtitle:     this._readField(section, 'subtitle',     this._hero.subtitle),
    };
  }

  _collectCard(view) {
    const section = view.querySelector('[data-section="card"]');
    const items = [];
    section.querySelectorAll('[data-item-index]').forEach(el => {
      const type = el.dataset.type;
      const base = this._card.items[parseInt(el.dataset.itemIndex, 10)] || {};
      const entry = {
        type,
        label: this._readField(el, 'label', base.label),
        value: this._readField(el, 'value', base.value),
      };
      if (type === 'location') {
        entry.meta = this._readField(el, 'meta', base.meta || '');
      } else {
        entry.href = this._readField(el, 'href', base.href || '');
      }
      items.push(entry);
    });
    return { items };
  }

  _collectForm(view) {
    const section = view.querySelector('[data-section="form"]');
    return {
      eyebrow:         this._readField(section, 'eyebrow',         this._form.eyebrow),
      title:           this._readField(section, 'title',           this._form.title),
      submit_label:    this._readField(section, 'submit_label',    this._form.submit_label),
      fallback_prefix: this._readField(section, 'fallback_prefix', this._form.fallback_prefix),
      fallback_link:   this._readField(section, 'fallback_link',   this._form.fallback_link),
    };
  }

  _collectAvailability(view) {
    const section = view.querySelector('[data-section="availability"]');
    const eyebrow = this._readField(section, 'eyebrow', this._availability.eyebrow);
    const title   = this._readField(section, 'title',   this._availability.title);
    const cards = [];
    section.querySelectorAll('[data-card-index]').forEach(el => {
      const rawStatus = (el.querySelector('[data-field="status"]')?.innerText.trim() || 'open').toLowerCase();
      const status = ['open', 'limited', 'closed'].includes(rawStatus) ? rawStatus : 'open';
      cards.push({
        status,
        label: this._readField(el, 'label', ''),
        body:  this._readField(el, 'body',  ''),
      });
    });
    return { eyebrow, title, cards };
  }

  _collectBuiltWith(view) {
    const section = view.querySelector('[data-section="built_with"]');
    const pills = [];
    section.querySelectorAll('[data-pill-index]').forEach(el => {
      pills.push(el.innerText.trim());
    });
    return {
      eyebrow:          this._readField(section, 'eyebrow',          this._builtWith.eyebrow),
      title:            this._readField(section, 'title',            this._builtWith.title),
      body1:            this._readField(section, 'body1',            this._builtWith.body1),
      body2:            this._readField(section, 'body2',            this._builtWith.body2),
      pills,
      github_btn_label: this._readField(section, 'github_btn_label', this._builtWith.github_btn_label),
      email_btn_label:  this._readField(section, 'email_btn_label',  this._builtWith.email_btn_label),
      github_url:       this._builtWith.github_url || DEFAULT_BUILT_WITH.github_url,
    };
  }

  _collectFooter(view) {
    const section = view.querySelector('[data-section="footer"]');
    const brand_name = this._readField(section, 'brand_name', this._footer.brand_name);
    const copy_suffix = this._readField(section, 'copy_suffix', this._footer.copy_suffix);

    const nav_links = [];
    section.querySelectorAll('[data-nav-index]').forEach(el => {
      nav_links.push({
        label: this._readField(el, 'label', ''),
        href:  this._readField(el, 'href',  ''),
      });
    });
    const legal_links = [];
    section.querySelectorAll('[data-legal-index]').forEach(el => {
      legal_links.push({
        label: this._readField(el, 'label', ''),
        href:  this._readField(el, 'href',  ''),
      });
    });
    return { brand_name, copy_suffix, nav_links, legal_links };
  }

  // Reads the first descendant [data-field="name"] innerText (trimmed), or fallback.
  _readField(root, name, fallback) {
    const el = root?.querySelector(`[data-field="${name}"]`);
    if (!el) return fallback;
    const txt = el.innerText.trim();
    return txt || fallback;
  }

  // ── Repaint: re-render each section after Save/Cancel so DOM mirrors state ─
  _repaintAll(view) {
    const parent = view;
    const sections = {
      hero:         this._heroHtml(),
      card:         this._cardHtml(),
      form:         this._formHtml(),
      availability: this._availabilityHtml(),
      built_with:   this._builtWithHtml(),
      footer:       this._footerHtml(),
    };
    for (const [name, html] of Object.entries(sections)) {
      const existing = parent.querySelector(`[data-section="${name}"]`);
      if (!existing) continue;
      const tmp = document.createElement('div');
      tmp.innerHTML = html.trim();
      const fresh = tmp.firstElementChild;
      existing.replaceWith(fresh);
    }
    // Re-wire handlers that targeted replaced subtrees
    this._initEmailLinks(parent);
    this._initForm(parent);
    this._initBuiltWithButtons(parent);
  }
}

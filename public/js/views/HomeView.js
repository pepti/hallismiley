// HomeView — League of Legends inspired layout
// Sections: Hero → Splash → News → Projects → Skills → Stats → Contact → Footer

import { isAdmin, hasRole, getCSRFToken } from '../services/auth.js';
import { escHtml } from '../utils/escHtml.js';


// ── Project categories (champion-selector style) ──────────────────────────
const CATEGORIES = [
  {
    id: 'tech', label: 'Tech', type: 'Full-Stack Applications',
    img: 'https://images.unsplash.com/photo-1461749280684-dccba630e2f6?w=800&h=800&fit=crop&q=80&auto=format',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
             <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
           </svg>`,
  },
  {
    id: 'carpentry', label: 'Carpentry', type: 'Joinery & Timber Work',
    img: '/assets/projects/arnarhraun/img_1795.jpg',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
             <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
             <polyline points="9 22 9 12 15 12 15 22"/>
           </svg>`,
  },
  {
    id: 'remodelling', label: 'Remodelling', type: 'Interior Renovation',
    img: '/assets/projects/arnarhraun/img_1071.jpg',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
             <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
           </svg>`,
  },
  {
    id: 'tools', label: 'Tools', type: 'Workshop & Dev Tooling',
    img: 'https://images.unsplash.com/photo-1557054055-72388d9f6141?w=800&h=800&fit=crop&q=80&auto=format',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
             <circle cx="12" cy="12" r="3"/>
             <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
           </svg>`,
  },
];

// ── Default skills content — used as fallback if API is unavailable ───────
const DEFAULT_SKILLS_CONTENT = {
  eyebrow:     'Two Decades of',
  title:       'Craft\n& Code',
  description: 'Twenty years of carpentry precision — reading grain, cutting to the line, fitting without gaps — applied to every line of code. The same principles that make a mortise-and-tenon joint last a century make software maintainable.',
  items: [
    { label: 'Languages', value: 'JS · Python · SQL' },
    { label: 'Backend',   value: 'Node · Express · REST' },
    { label: 'Database',  value: 'PostgreSQL · Redis' },
    { label: 'Carpentry', value: '20+ yrs hand & power tools' },
    { label: 'Cloud',     value: 'Azure · Railway' },
    { label: 'Security',  value: 'OWASP · OAuth 2.0 · RS256' },
  ],
  image_url: 'https://images.unsplash.com/photo-1564603527476-8837eac5a22f?w=700&h=900&fit=crop&q=80&auto=format',
};

// ── Stats ─────────────────────────────────────────────────────────────────
const STATS = [
  { num: '20+', label: 'Years Carpentry Experience' },
  { num: '80+', label: 'Projects Completed' },
  { num: '10+', label: 'Tech Projects Shipped' },
  { num: '2',   label: 'Core Disciplines' },
];

// ─────────────────────────────────────────────────────────────────────────
export class HomeView {
  constructor() {
    this._content = null; // loaded from API in render()
    this._newsArticles = [];
  }

  async render() {
    await Promise.all([this._loadContent(), this._loadNews()]);

    const view = document.createElement('div');
    view.className = 'view';

    view.innerHTML = `
      ${this._hero()}
      ${this._news()}
      ${this._projects()}
      ${this._skills()}
      ${this._stats()}
      ${this._contact()}
      ${this._footer()}
    `;

    this._initProjects(view);
    this._initContactForm(view);
    this._initHeroVideo(view);
    this._initSkillsEdit(view);
    return view;
  }

  // ── Load skills content from API ───────────────────────────────────────
  async _loadContent() {
    try {
      const res = await fetch('/api/v1/content/home_skills');
      if (res.ok) {
        this._content = await res.json();
        return;
      }
    } catch { /* network error — fall through to default */ }
    this._content = { ...DEFAULT_SKILLS_CONTENT };
  }

  // ── SECTION 1: Hero ────────────────────────────────────────────────────
  _hero() {
    return `
    <section class="lol-hero" aria-label="Introduction">
      <video class="lol-hero__bg" autoplay muted loop playsinline preload="auto" aria-hidden="true">
        <!-- TODO (production): move this video to a CDN to avoid serving large assets through Node.js -->
        <source src="/assets/videos/waterfall-bk-v1.mp4" type="video/mp4">
      </video>
      <div class="lol-hero__overlay" aria-hidden="true"></div>

      <div class="lol-hero__content">
        <h1 class="lol-hero__title">
          <span>Halli</span>
          <span class="lol-hero__title-second">Smiley</span>
        </h1>
        <p class="lol-hero__subtitle">
          Carpenter &amp; Computer Scientist — Building with wood &amp; code
        </p>
        <a href="#/projects" class="lol-hero__cta">View Projects</a>
      </div>

      <div class="lol-hero__scroll" aria-hidden="true">
        <span>Scroll</span>
        <div class="lol-hero__scroll-line"></div>
      </div>
    </section>`;
  }

  // ── Load news articles from API ─────────────────────────────────────────
  async _loadNews() {
    try {
      const res = await fetch('/api/v1/news?limit=3');
      if (res.ok) {
        const data = await res.json();
        this._newsArticles = data.articles || [];
      }
    } catch { /* network error — show empty */ }
  }

  // ── SECTION 2: News ───────────────────────────────────────────────────
  _news() {
    if (this._newsArticles.length === 0) return '';

    const catClass = cat => ['carpentry', 'tech', 'announcement'].includes(cat) ? cat : 'news';
    const fmtDate = iso => {
      if (!iso) return '';
      return new Date(iso).toLocaleDateString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
      });
    };

    const cards = this._newsArticles.map(a => {
      const imgHtml = a.cover_image
        ? `<img class="lol-news__card-img" src="${escHtml(a.cover_image)}" alt="${escHtml(a.title)}" loading="lazy" width="800" height="450">`
        : `<div class="lol-news__card-img lol-news__card-img--placeholder" aria-hidden="true"></div>`;

      return `
      <a href="#/news/${escHtml(a.slug)}" class="lol-news__card lol-news__card--link">
        ${imgHtml}
        <div class="lol-news__card-body">
          <div class="lol-news__card-meta">
            <span class="lol-news__card-tag lol-news__card-tag--${catClass(a.category)}">${escHtml((a.category || 'news').toUpperCase())}</span>
            <time class="lol-news__card-date" datetime="${escHtml(a.published_at || a.created_at)}">${fmtDate(a.published_at || a.created_at)}</time>
          </div>
          <h3 class="lol-news__card-title">${escHtml(a.title)}</h3>
          <p class="lol-news__card-desc">${escHtml(a.summary)}</p>
        </div>
      </a>`;
    }).join('');

    return `
    <section class="lol-news" id="news" aria-label="Latest news">
      <div class="lol-news__inner">
        <div class="lol-news__header">
          <a href="#/news" class="lol-news__heading-link"><h2 class="lol-news__heading">News</h2></a>
          <a href="#/news" class="lol-news__view-all">
            View All
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </a>
        </div>
        <div class="lol-news__grid">${cards}</div>
      </div>
    </section>`;
  }

  // ── SECTION 4: Projects — champion-selector style ──────────────────────
  _projects() {
    const first = CATEGORIES[0];

    const catIcons = CATEGORIES.map((c, i) => `
      <div class="lol-projects__cat${i === 0 ? ' active' : ''}"
           data-cat="${c.id}" role="tab" tabindex="${i === 0 ? '0' : '-1'}"
           aria-selected="${i === 0 ? 'true' : 'false'}" aria-label="${c.label}">
        <div class="lol-projects__cat-icon">${c.icon}</div>
        <span class="lol-projects__cat-label">${c.label}</span>
      </div>
    `).join('');

    return `
    <section class="lol-projects" aria-label="Project categories">
      <div class="lol-projects__inner">

        <div class="lol-projects__left">
          <p class="lol-projects__eyebrow">Browse by</p>
          <h2 class="lol-projects__heading">Discipline</h2>
          <p class="lol-projects__desc">
            From precision timber frames and hand-cut joinery to full-stack
            web applications — every project is built to last.
          </p>
          <div class="lol-projects__btns">
            <a href="#/projects" class="lol-btn--gold">View All Projects</a>
            <a href="#/" class="lol-btn--teal" id="contact-btn">Get in Touch</a>
          </div>
          <div class="lol-projects__categories" role="tablist" aria-label="Project disciplines">
            ${catIcons}
          </div>
        </div>

        <div class="lol-projects__right">
          <div class="lol-projects__circle">
            <img id="projects-preview-img"
                 class="lol-projects__preview-img"
                 src="${first.img}" alt="${first.label} projects preview"
                 width="800" height="800" loading="lazy">
          </div>
          <div class="lol-projects__preview-name">
            <p id="projects-preview-title" class="lol-projects__preview-title">${first.label}</p>
            <p id="projects-preview-type"  class="lol-projects__preview-type">${first.type}</p>
          </div>
        </div>

      </div>
    </section>`;
  }

  // ── SECTION 5: Skills ──────────────────────────────────────────────────
  _skills() {
    const c         = this._content;
    const titleHtml = escHtml(c.title).replace(/\n/g, '<br>');
    const items     = c.items.map((s, i) => `
      <div class="lol-skills__item" data-item-index="${i}" role="listitem">
        <div class="lol-skills__item-label" data-item="label">${escHtml(s.label)}</div>
        <div class="lol-skills__item-value" data-item="value">${escHtml(s.value)}</div>
      </div>
    `).join('');

    return `
    <section class="lol-skills" aria-label="Skills and expertise">
      <div class="lol-skills__bg" aria-hidden="true"></div>
      <div class="lol-skills__inner">

        <div>
          <p class="lol-skills__tag" data-field="eyebrow">${escHtml(c.eyebrow)}</p>
          <h2 class="lol-skills__title" data-field="title">${titleHtml}</h2>
          <p class="lol-skills__desc" data-field="desc">${escHtml(c.description)}</p>
          <div class="lol-skills__grid" role="list" aria-label="Skill areas">
            ${items}
          </div>
        </div>

        <div class="lol-skills__img-wrap">
          <img class="lol-skills__img"
               src="${escHtml(c.image_url)}"
               alt="Skills section image" loading="lazy"
               width="700" height="900">
        </div>

      </div>
    </section>`;
  }

  // ── SECTION 6: Stats ──────────────────────────────────────────────────
  _stats() {
    const items = STATS.map(s => `
      <div class="lol-stats__item">
        <div class="lol-stats__num" aria-label="${s.num} ${s.label}">${s.num}</div>
        <div class="lol-stats__label" aria-hidden="true">${s.label}</div>
      </div>
    `).join('');

    return `
    <section class="lol-stats" aria-label="Key figures">
      <div class="lol-stats__inner">${items}</div>
    </section>`;
  }

  // ── SECTION 7: Contact CTA + Form ─────────────────────────────────────
  _contact() {
    return `
    <section class="lol-contact" id="contact" aria-label="Contact">
      <div class="lol-contact__bg" aria-hidden="true"></div>
      <div class="lol-contact__inner">
        <p class="lol-contact__eyebrow">Let's build something</p>
        <h2 class="lol-contact__title">
          Get in<br>Touch
        </h2>
        <p class="lol-contact__desc">
          Whether it's a timber frame, a web platform, or a bespoke workshop fit-out —
          I'd love to hear what you're planning.
        </p>

        <form class="contact-form" id="contact-form" novalidate aria-label="Contact form">
          <!-- Honeypot — hidden from real users, bots fill it in -->
          <input type="text" name="website" id="contact-honeypot"
                 tabindex="-1" autocomplete="off" aria-hidden="true"
                 style="position:absolute;left:-9999px;opacity:0;height:0;width:0;pointer-events:none;" />
          <div class="contact-form__row">
            <div class="contact-form__field">
              <label for="contact-name" class="contact-form__label">Name <span aria-hidden="true" class="required-mark">*</span></label>
              <input type="text" id="contact-name" name="name" class="contact-form__input"
                     required autocomplete="name" placeholder="Your name" maxlength="100" />
            </div>
            <div class="contact-form__field">
              <label for="contact-email" class="contact-form__label">Email <span aria-hidden="true" class="required-mark">*</span></label>
              <input type="email" id="contact-email" name="email" class="contact-form__input"
                     required autocomplete="email" placeholder="your@email.com" maxlength="200" />
            </div>
          </div>
          <div class="contact-form__field">
            <label for="contact-message" class="contact-form__label">Message <span aria-hidden="true" class="required-mark">*</span></label>
            <textarea id="contact-message" name="message" class="contact-form__textarea"
                      required rows="5" placeholder="Tell me about your project…" maxlength="2000"></textarea>
          </div>
          <div aria-live="polite" id="contact-status" class="contact-form__status"></div>
          <button type="submit" class="lol-contact__btn contact-form__submit" id="contact-submit">
            Send Message
          </button>
        </form>

      </div>
    </section>`;
  }

  // ── Footer ─────────────────────────────────────────────────────────────
  _footer() {
    return `
    <footer class="lol-footer">

      <nav class="lol-footer__top" aria-label="Footer navigation">
        <a href="#/about"    class="lol-footer__nav-link">About</a>
        <a href="#/projects" class="lol-footer__nav-link">Projects</a>
        <!-- TODO before launch: replace YOUR_GITHUB_USERNAME with your real username -->
        <a href="https://github.com/YOUR_GITHUB_USERNAME" target="_blank" rel="noopener noreferrer" class="lol-footer__nav-link">GitHub</a>
        <!-- TODO before launch: replace YOUR_LINKEDIN_USERNAME with your real username -->
        <a href="https://linkedin.com/in/YOUR_LINKEDIN_USERNAME" target="_blank" rel="noopener noreferrer" class="lol-footer__nav-link">LinkedIn</a>
        <a href="mailto:halli@hallismiley.is" class="lol-footer__nav-link">Contact</a>
        <a href="#/" class="lol-footer__nav-link">Resume</a>
      </nav>

      <div class="lol-footer__social">
        <!-- TODO before launch: replace YOUR_GITHUB_USERNAME with your real username -->
        <a href="https://github.com/YOUR_GITHUB_USERNAME" target="_blank" rel="noopener noreferrer"
           class="lol-footer__social-icon" aria-label="GitHub profile">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
          </svg>
        </a>
        <!-- TODO before launch: replace YOUR_LINKEDIN_USERNAME with your real username -->
        <a href="https://linkedin.com/in/YOUR_LINKEDIN_USERNAME" target="_blank" rel="noopener noreferrer"
           class="lol-footer__social-icon" aria-label="LinkedIn profile">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
          </svg>
        </a>
        <a href="mailto:halli@hallismiley.is"
           class="lol-footer__social-icon" aria-label="Send email">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <rect x="2" y="4" width="20" height="16" rx="2"/>
            <polyline points="2,4 12,13 22,4"/>
          </svg>
        </a>
      </div>

      <div class="lol-footer__brand">
        <div class="lol-footer__logo">Halli Smiley</div>
        <p class="lol-footer__copy">
          &copy; ${new Date().getFullYear()} Halli Smiley. A portfolio of carpentry
          and software engineering work built with Node.js, PostgreSQL, and care.
        </p>
        <nav class="lol-footer__legal" aria-label="Legal navigation">
          <a href="#/privacy" class="lol-footer__legal-link">Privacy Policy</a>
          <a href="#/terms"   class="lol-footer__legal-link">Terms of Service</a>
          <a href="mailto:halli@hallismiley.is" class="lol-footer__legal-link">Contact</a>
        </nav>
      </div>

    </footer>`;
  }

  // ── Hero video — ensure autoplay fires after mount ────────────────────
  _initHeroVideo(view) {
    const video = view.querySelector('.lol-hero__bg');
    if (!video) return;
    requestAnimationFrame(() => {
      video.play().catch(() => {
        const resume = () => { video.play().catch(() => {}); document.removeEventListener('click', resume); };
        document.addEventListener('click', resume, { once: true });
      });
    });
  }

  // ── Projects section — category switching logic ────────────────────────
  _initProjects(view) {
    const cats    = view.querySelectorAll('.lol-projects__cat');
    const img     = view.querySelector('#projects-preview-img');
    const title   = view.querySelector('#projects-preview-title');
    const type    = view.querySelector('#projects-preview-type');
    const contact = view.querySelector('#contact-btn');

    if (contact) {
      contact.addEventListener('click', e => {
        e.preventDefault();
        const section = document.getElementById('contact');
        if (section) section.scrollIntoView({ behavior: 'smooth' });
      });
    }

    cats.forEach(cat => {
      const activate = () => {
        const id   = cat.dataset.cat;
        const data = CATEGORIES.find(c => c.id === id);
        if (!data) return;

        cats.forEach(c => {
          c.classList.toggle('active', c.dataset.cat === id);
          c.setAttribute('aria-selected', c.dataset.cat === id ? 'true' : 'false');
          c.setAttribute('tabindex', c.dataset.cat === id ? '0' : '-1');
        });

        img.style.opacity = '0';
        setTimeout(() => {
          img.src          = data.img;
          img.alt          = `${data.label} projects preview`;
          title.textContent = data.label;
          type.textContent  = data.type;
          img.style.opacity = '1';
        }, 350);
      };

      cat.addEventListener('click', activate);
      cat.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
      });
    });
  }

  // ── Skills section — inline edit for admin/moderator ──────────────────
  _initSkillsEdit(view) {
    if (!isAdmin() && !hasRole('moderator')) return;

    const section = view.querySelector('.lol-skills');
    if (!section) return;

    // Edit button
    const editBtn = document.createElement('button');
    editBtn.className   = 'lol-skills__edit-btn';
    editBtn.id          = 'home-edit-btn';
    editBtn.type        = 'button';
    editBtn.setAttribute('aria-label', 'Edit skills section');
    editBtn.setAttribute('data-testid', 'edit-page-btn');
    editBtn.innerHTML   = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>
      Edit Section`;
    section.style.position = 'relative';
    section.appendChild(editBtn);

    // Save / cancel bar
    const controls = document.createElement('div');
    controls.className  = 'lol-skills__edit-controls lol-skills__edit-controls--hidden';
    controls.id         = 'home-edit-bar';
    controls.setAttribute('data-testid', 'edit-controls');
    controls.innerHTML  = `
      <button type="button" class="lol-skills__save-btn" id="home-edit-save" data-testid="edit-save-btn">Save Changes</button>
      <button type="button" class="lol-skills__cancel-btn" id="home-edit-cancel" data-testid="edit-cancel-btn">Cancel</button>
      <span   class="lol-skills__edit-status" aria-live="polite"></span>`;
    section.appendChild(controls);

    let _snapshot = null; // saved copy for cancel

    editBtn.addEventListener('click', () => {
      _snapshot = JSON.parse(JSON.stringify(this._content));
      this._enterEdit(section, editBtn, controls);
    });

    controls.querySelector('.lol-skills__save-btn').addEventListener('click', () =>
      this._saveEdit(section, controls)
    );

    controls.querySelector('.lol-skills__cancel-btn').addEventListener('click', () => {
      this._exitEdit(section, editBtn, controls);
      if (_snapshot) this._restoreEdit(section, _snapshot);
    });
  }

  _enterEdit(section, editBtn, controls) {
    section.classList.add('lol-skills--editing');
    editBtn.classList.add('lol-skills__edit-btn--hidden');
    controls.classList.remove('lol-skills__edit-controls--hidden');

    // Make text fields editable
    section.querySelectorAll('[data-field], [data-item]').forEach(el => {
      el.contentEditable = 'true';
      el.spellcheck      = true;
    });

    // Image overlay
    const imgWrap = section.querySelector('.lol-skills__img-wrap');
    const overlay = document.createElement('div');
    overlay.className = 'lol-skills__img-overlay';
    overlay.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
        <circle cx="12" cy="13" r="4"/>
      </svg>
      <span>Change Image</span>
      <input type="file" accept="image/jpeg,image/png,image/webp"
             class="lol-img-file-input" aria-label="Upload replacement image">`;
    imgWrap.appendChild(overlay);

    overlay.querySelector('.lol-img-file-input').addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) this._uploadImage(file, section, controls);
    });
  }

  _exitEdit(section, editBtn, controls) {
    section.classList.remove('lol-skills--editing');
    editBtn.classList.remove('lol-skills__edit-btn--hidden');
    controls.classList.add('lol-skills__edit-controls--hidden');
    controls.querySelector('.lol-skills__edit-status').textContent = '';

    section.querySelectorAll('[data-field], [data-item]').forEach(el => {
      el.contentEditable = 'false';
      el.removeAttribute('contenteditable');
    });

    section.querySelector('.lol-skills__img-overlay')?.remove();
  }

  _restoreEdit(section, snapshot) {
    const titleHtml = escHtml(snapshot.title).replace(/\n/g, '<br>');
    section.querySelector('[data-field="eyebrow"]').innerHTML = escHtml(snapshot.eyebrow);
    section.querySelector('[data-field="title"]').innerHTML   = titleHtml;
    section.querySelector('[data-field="desc"]').innerHTML    = escHtml(snapshot.description);
    section.querySelector('.lol-skills__img').src             = snapshot.image_url;

    section.querySelectorAll('[data-item-index]').forEach(el => {
      const i = parseInt(el.dataset.itemIndex, 10);
      if (!snapshot.items[i]) return;
      el.querySelector('[data-item="label"]').innerHTML = escHtml(snapshot.items[i].label);
      el.querySelector('[data-item="value"]').innerHTML = escHtml(snapshot.items[i].value);
    });

    this._content = snapshot;
  }

  async _uploadImage(file, section, controls) {
    const status = controls.querySelector('.lol-skills__edit-status');
    status.textContent = 'Uploading…';

    try {
      const token = await getCSRFToken();
      const fd    = new FormData();
      fd.append('file', file);

      const res = await fetch('/api/v1/content/home_skills/image', {
        method:      'POST',
        credentials: 'include',
        headers:     token ? { 'X-CSRF-Token': token } : {},
        body:        fd,
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Upload failed');

      const { image_url } = await res.json();
      section.querySelector('.lol-skills__img').src = image_url;
      this._content = { ...this._content, image_url };
      status.textContent = 'Image updated.';
    } catch (err) {
      status.textContent = `Upload error: ${err.message}`;
    }
  }

  async _saveEdit(section, controls) {
    const status = controls.querySelector('.lol-skills__edit-status');
    status.textContent = 'Saving…';

    // Collect text from DOM
    const eyebrow = section.querySelector('[data-field="eyebrow"]')?.innerText.trim() ?? this._content.eyebrow;
    const title   = section.querySelector('[data-field="title"]')?.innerText.trim()   ?? this._content.title;
    const desc    = section.querySelector('[data-field="desc"]')?.innerText.trim()    ?? this._content.description;

    const items = [];
    section.querySelectorAll('[data-item-index]').forEach(el => {
      items.push({
        label: el.querySelector('[data-item="label"]')?.innerText.trim() ?? '',
        value: el.querySelector('[data-item="value"]')?.innerText.trim() ?? '',
      });
    });

    const updated = { ...this._content, eyebrow, title, description: desc, items };

    try {
      const token = await getCSRFToken();
      const res   = await fetch('/api/v1/content/home_skills', {
        method:      'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'X-CSRF-Token': token } : {}),
        },
        body: JSON.stringify(updated),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');

      this._content  = await res.json();
      status.textContent = 'Saved!';
      setTimeout(() => { status.textContent = ''; }, 2500);
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
    }
  }

  // ── Contact form — fetch submission ───────────────────────────────────
  _initContactForm(view) {
    const form   = view.querySelector('#contact-form');
    const status = view.querySelector('#contact-status');
    const submit = view.querySelector('#contact-submit');
    if (!form) return;

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const honeypot = form.querySelector('#contact-honeypot').value;
      const name    = form.querySelector('#contact-name').value.trim();
      const email   = form.querySelector('#contact-email').value.trim();
      const message = form.querySelector('#contact-message').value.trim();

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
          body: JSON.stringify({ name, email, message, website: honeypot }),
        });

        if (res.ok) {
          status.className = 'contact-form__status contact-form__status--success';
          status.textContent = 'Message sent — I\'ll be in touch soon.';
          form.reset();
        } else {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Something went wrong.');
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
}
